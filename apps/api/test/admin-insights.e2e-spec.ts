/* eslint-disable @typescript-eslint/no-explicit-any */
import { addUser, auth, Band, createTestApp, resetDb, signupBand, TestCtx } from './helpers';
import { addDays, addMonths, monthKey, monthStart } from '../src/platform/insights-math';

const API = '/api/v1/admin/insights';
const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe('Panel global · negocio y retención', () => {
  let ctx: TestCtx;
  let admin: Band;
  let t1: Band; // PRO activa mensual con actividad
  let t2: Band; // BASIC anual que renueva pronto sin actividad
  let t3: Band; // FREE inactiva
  let t4: Band; // PRO bonificada
  let t5: Band; // PRO en prueba
  let t6: Band; // FREE con 80 % de usuarios
  let t7: Band; // PRO impagada
  const get = (path: string, token = admin.token) => ctx.http().get(`${API}${path}`).set(auth(token));
  const snaps = (tenantId: string) => ctx.db.system.tenantSnapshot.findMany({ where: { tenantId } });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.db);
    admin = await signupBand(ctx, 'ins-admin', 'FREE');
    await ctx.db.system.user.update({ where: { id: admin.userId }, data: { isPlatformAdmin: true } });
    [t1, t2, t3, t4, t5, t6, t7] = [
      await signupBand(ctx, 'ins-t1', 'PRO'), await signupBand(ctx, 'ins-t2', 'BASIC'), await signupBand(ctx, 'ins-t3', 'FREE'),
      await signupBand(ctx, 'ins-t4', 'PRO'), await signupBand(ctx, 'ins-t5', 'PRO'), await signupBand(ctx, 'ins-t6', 'FREE'), await signupBand(ctx, 'ins-t7', 'PRO'),
    ];
    // Actividad real de T1 (un ensayo) y estados de las demás.
    await ctx.http().post('/api/v1/events').set(auth(t1.token)).send({ type: 'REHEARSAL', title: 'Ensayo', startsAt: '2030-02-01T18:00:00Z', endsAt: '2030-02-01T20:00:00Z' }).expect(201);
    await wait();
    await ctx.db.system.membership.updateMany({ where: { tenantId: t1.tenantId }, data: { lastSeenAt: addDays(new Date(), -2) } });
    await ctx.db.system.membership.updateMany({ where: { tenantId: t3.tenantId }, data: { lastSeenAt: addDays(new Date(), -40) } });
    await ctx.db.system.tenant.update({ where: { id: t4.tenantId }, data: { complimentaryUntil: addDays(new Date(), 90) } });
    await ctx.db.system.tenant.update({ where: { id: t5.tenantId }, data: { status: 'TRIALING' } });
    await ctx.db.system.tenant.update({ where: { id: t7.tenantId }, data: { status: 'PAST_DUE' } });
    await ctx.db.system.subscription.update({ where: { tenantId: t2.tenantId }, data: { interval: 'YEAR', currentPeriodEnd: addDays(new Date(), 30) } });
    for (const email of ['u1@ins.test', 'u2@ins.test', 'u3@ins.test']) await addUser(ctx, t6, 'musician', email);
  });
  afterAll(() => ctx.app.close());

  it('todas las rutas rechazan a quien no es administrador de plataforma', async () => {
    const id = t1.tenantId;
    const calls: [string, string][] = [
      ['post', '/snapshot'], ['get', '/metrics'], ['get', '/funnel'], ['get', '/cohorts'], ['get', '/health'], ['get', '/at-risk'],
      ['get', '/upsell'], ['get', '/managers'], ['get', `/tenants/${id}`], ['get', `/tenants/${id}/timeline`], ['patch', `/tenants/${id}`],
      ['post', `/tenants/${id}/notes`], ['delete', `/tenants/${id}/notes/${id}`],
    ];
    for (const [method, path] of calls) {
      await (ctx.http() as any)[method](`${API}${path}`).set(auth(t1.token)).send({}).expect(403);
    }
    await ctx.http().get(`${API}/health`).expect(401);
  });

  describe('foto diaria', () => {
    const date = iso(today());
    it('es idempotente y calcula MRR, usuarios activos y uso', async () => {
      const first = await ctx.http().post(`${API}/snapshot`).set(auth(admin.token)).send({ date }).expect(200);
      expect(first.body).toMatchObject({ date });
      await ctx.http().post(`${API}/snapshot`).set(auth(admin.token)).send({ date }).expect(200);
      const total = await ctx.db.system.tenant.count();
      expect(await ctx.db.system.tenantSnapshot.count()).toBe(total);

      const s1 = (await snaps(t1.tenantId))[0];
      expect(s1).toMatchObject({ planCode: 'PRO', status: 'ACTIVE', mrrCents: 2400, activeUsers7d: 1, activeUsers30d: 1 });
      expect((s1.usage as any).events).toBe(1);
      // breadth 7 + usuarios 30 + recencia (2 días) 28
      expect(s1.healthScore).toBe(65);
      expect((await snaps(t2.tenantId))[0].mrrCents).toBe(Math.round(9000 / 12));
      expect((await snaps(t3.tenantId))[0].mrrCents).toBe(0);
      expect((await snaps(t4.tenantId))[0].mrrCents).toBe(0);
      expect((await snaps(t5.tenantId))[0]).toMatchObject({ status: 'TRIALING', mrrCents: 0 });
      expect((await snaps(t7.tenantId))[0]).toMatchObject({ status: 'PAST_DUE', mrrCents: 2400 });
      expect((await snaps(t7.tenantId))[0].healthScore).toBeLessThan(15);
    });

    it('una segunda foto de otra fecha crea otra fila', async () => {
      await ctx.http().post(`${API}/snapshot`).set(auth(admin.token)).send({ date: iso(addDays(today(), 1)) }).expect(200);
      expect((await snaps(t1.tenantId)).length).toBe(2);
    });

    it('valida la fecha', async () => {
      await ctx.http().post(`${API}/snapshot`).set(auth(admin.token)).send({ date: '01/02/2026' }).expect(400);
    });
  });

  describe('salud y listas de acción', () => {
    it('lista bandas con puntuación, filtros y orden', async () => {
      const res = await get('/health?sort=-score').expect(200);
      expect(res.body.total).toBe(8);
      expect(res.body.data[0].id).toBe(t1.tenantId);
      expect(res.body.data[0]).toMatchObject({ score: 65, modulesUsed: 1, activeUsers30d: 1 });
      expect(res.body.data[0].limits.map((l: any) => l.key)).toEqual(['users', 'members', 'students', 'storage']);
      const q = await get('/health?q=ins-t3').expect(200);
      expect(q.body.data.map((r: any) => r.id)).toEqual([t3.tenantId]);
      const high = await get('/health?risk=high').expect(200);
      expect(high.body.data.every((r: any) => r.score < 40)).toBe(true);
      expect(high.body.data.some((r: any) => r.id === t1.tenantId)).toBe(false);
      const byName = await get('/health?sort=name&pageSize=2&page=2').expect(200);
      expect(byName.body.data).toHaveLength(2);
    });

    it('en riesgo: inactividad, impago y renovación con uso bajo, con motivos', async () => {
      const res = await get('/at-risk').expect(200);
      const by = (id: string) => res.body.find((r: any) => r.id === id);
      expect(by(t3.tenantId).reasons.map((r: any) => r.code)).toContain('inactive');
      expect(by(t7.tenantId).reasons.map((r: any) => r.code)).toContain('past_due');
      expect(by(t2.tenantId).reasons.map((r: any) => r.code)).toEqual(['renewal']);
      expect(by(t1.tenantId)).toBeUndefined();
    });

    it('listas para mejorar: algún límite al 80 %', async () => {
      const res = await get('/upsell').expect(200);
      const row = res.body.find((r: any) => r.id === t6.tenantId);
      expect(row.reasons.map((r: any) => r.code)).toContain('limit_users');
      expect(row.suggestion.planCode).toBe('BASIC');
      expect(res.body.find((r: any) => r.id === t1.tenantId)).toBeUndefined();
    });
  });

  describe('métricas de MRR', () => {
    const now = new Date();
    const at = (offset: number) => new Date(Date.UTC(addMonths(monthStart(now), offset).getUTCFullYear(), addMonths(monthStart(now), offset).getUTCMonth(), 15));
    const snap = (tenantId: string, offset: number, mrrCents: number, status: 'ACTIVE' | 'CANCELLED' = 'ACTIVE') =>
      ctx.db.system.tenantSnapshot.create({
        data: { tenantId, date: at(offset), planCode: 'PRO', status, mrrCents, activeUsers7d: 0, activeUsers30d: 0, members: 0, students: 0, storageBytes: 0, usage: {}, healthScore: 50 },
      });

    it('separa altas, mejoras, bajadas, bajas y reactivaciones, con NRR', async () => {
      await ctx.db.system.tenantSnapshot.deleteMany();
      // A: alta, mejora y bajada. B: baja y reactivación. C: estable.
      for (const [o, v] of [[-3, 0], [-2, 900], [-1, 2400], [0, 900]]) await snap(t1.tenantId, o, v);
      for (const [o, v] of [[-3, 2400], [-2, 2400], [-1, 0], [0, 2400]]) await snap(t2.tenantId, o, v, o === -1 ? 'CANCELLED' : 'ACTIVE');
      for (const o of [-3, -2, -1, 0]) await snap(t3.tenantId, o, 900);

      const res = await get('/metrics?months=4').expect(200);
      const m = res.body.months;
      expect(m.map((x: any) => x.month)).toEqual([-3, -2, -1, 0].map((o) => monthKey(addMonths(monthStart(now), o))));
      expect(m[1]).toMatchObject({ mrrCents: 4200, newCents: 900, expansionCents: 0, churnedCents: 0, payingTenants: 3, arpaCents: 1400 });
      expect(m[2]).toMatchObject({ mrrCents: 3300, expansionCents: 1500, churnedCents: 2400, contractionCents: 0, arrCents: 3300 * 12 });
      expect(m[2].nrrMonthly).toBeCloseTo((4200 + 1500 - 2400) / 4200, 5);
      expect(m[3]).toMatchObject({ mrrCents: 4200, contractionCents: 1500, reactivationCents: 2400, newCents: 0 });
      expect(m[3].nrr12).toBeNull();
      expect(res.body.current.arrCents).toBe(res.body.current.mrrCents * 12);
      expect(res.body.tenantsByStatus.ACTIVE).toBeGreaterThan(0);
      expect(res.body.seasonality).toHaveLength(12);
      expect(res.body.seasonality.reduce((s: number, x: any) => s + x.signups, 0)).toBe(await ctx.db.system.tenant.count());
      const cancelMonth = addMonths(monthStart(now), -1).getUTCMonth();
      expect(res.body.seasonality[cancelMonth].cancellations).toBe(1);
    });

    it('calcula la NRR a 12 meses con datos dispersos', async () => {
      await ctx.db.system.tenantSnapshot.deleteMany();
      await snap(t1.tenantId, -12, 1000);
      await snap(t1.tenantId, -4, 1500); // el resto de meses hereda el último valor
      await snap(t2.tenantId, -12, 1000);
      await snap(t2.tenantId, -5, 0, 'CANCELLED');
      const res = await get('/metrics?months=3').expect(200);
      const last = res.body.months[2];
      // Base hace 12 meses: 2000; ahora: 1500 + 0.
      expect(last.nrr12).toBeCloseTo(0.75, 5);
      expect(last.mrrCents).toBe(1500);
    });

    it('valida el parámetro months', async () => {
      await get('/metrics?months=99').expect(400);
    });
  });

  describe('embudo y cohortes', () => {
    it('cuenta cada paso con su conversión', async () => {
      await ctx.db.system.tenantSnapshot.deleteMany();
      await ctx.http().post(`${API}/snapshot`).set(auth(admin.token)).send({ date: iso(today()) }).expect(200);
      const from = iso(addDays(today(), -1));
      const res = await get(`/funnel?from=${from}&to=${iso(today())}`).expect(200);
      const step = (k: string) => res.body.steps.find((s: any) => s.key === k);
      const users = await ctx.db.system.user.count({ where: { isPlatformAdmin: false } });
      expect(step('registered').count).toBe(users);
      expect(step('tenants').count).toBe(8);
      expect(step('onboarded').count).toBe(8);
      expect(step('trial')).toMatchObject({ count: 1, conversion: 1 / 8 });
      // T1, T2 y T7 facturan; la bonificada, la gratuita y la de prueba no.
      expect(step('paid')).toMatchObject({ count: 3, conversion: 3 });
      expect(res.body.overall).toBeCloseTo(3 / 8, 5);
    });

    it('un pago de Stripe también cuenta como pago', async () => {
      await ctx.db.system.invoice.create({
        data: { tenantId: t6.tenantId, stripeInvoiceId: 'in_ins_1', status: 'paid', currency: 'eur', subtotalCents: 900, taxCents: 0, totalCents: 900, amountPaidCents: 900 },
      });
      const res = await get(`/funnel?from=${iso(addDays(today(), -1))}&to=${iso(today())}`).expect(200);
      expect(res.body.steps.find((s: any) => s.key === 'paid').count).toBe(4);
    });

    it('cohortes: porcentaje activo a 3, 6 y 12 meses, null si aún no toca', async () => {
      await ctx.db.system.tenantSnapshot.deleteMany();
      const cohort = addMonths(monthStart(new Date()), -13);
      await ctx.db.system.tenant.updateMany({ where: { id: { in: [t1.tenantId, t2.tenantId] } }, data: { createdAt: addDays(cohort, 5) } });
      const row = (tenantId: string, offset: number, status: 'ACTIVE' | 'CANCELLED') =>
        ctx.db.system.tenantSnapshot.create({
          data: { tenantId, date: addDays(addMonths(cohort, offset), 10), planCode: 'PRO', status, mrrCents: 0, activeUsers7d: 0, activeUsers30d: 0, members: 0, students: 0, storageBytes: 0, usage: {}, healthScore: 0 },
        });
      await row(t1.tenantId, 3, 'ACTIVE');
      await row(t1.tenantId, 6, 'CANCELLED');
      await row(t1.tenantId, 12, 'CANCELLED');
      await row(t2.tenantId, 3, 'ACTIVE'); // dispersa: hereda ACTIVE
      const res = await get('/cohorts').expect(200);
      const c = res.body.find((r: any) => r.month === monthKey(cohort));
      expect(c.size).toBe(2);
      expect(c.m3.rate).toBe(1);
      expect(c.m6.rate).toBe(0.5);
      expect(c.m12.rate).toBe(0.5);
      const current = res.body.find((r: any) => r.month === monthKey(new Date()));
      expect(current.m3).toBeNull();
      expect(current.m12).toBeNull();
    });
  });

  describe('ficha de la banda', () => {
    it('devuelve datos, contactos, uso frente a límites y tendencia', async () => {
      await ctx.http().post(`${API}/snapshot`).set(auth(admin.token)).send({ date: iso(today()) }).expect(200);
      const res = await get(`/tenants/${t1.tenantId}`).expect(200);
      expect(res.body.tenant).toMatchObject({ id: t1.tenantId, status: 'ACTIVE', tags: [] });
      expect(res.body.plan.code).toBe('PRO');
      expect(res.body.contacts[0]).toMatchObject({ email: t1.email, role: { key: 'owner' } });
      expect(res.body.limits).toHaveLength(4);
      expect(res.body.snapshot.healthScore).toBe(65);
      expect(res.body.trend.length).toBeGreaterThanOrEqual(1);
      const kinds = res.body.timeline.data.map((t: any) => t.kind);
      expect(kinds).toEqual(expect.arrayContaining(['created', 'onboarded']));
      await get(`/tenants/00000000-0000-4000-8000-000000000000`).expect(404);
    });

    it('etiquetas y gestor (sólo administradores de plataforma) con auditoría', async () => {
      const managers = await get('/managers').expect(200);
      expect(managers.body.map((m: any) => m.id)).toEqual([admin.userId]);
      await ctx.http().patch(`${API}/tenants/${t1.tenantId}`).set(auth(admin.token)).send({ accountManagerId: t2.userId }).expect(400);
      const ok = await ctx.http().patch(`${API}/tenants/${t1.tenantId}`).set(auth(admin.token)).send({ tags: ['Piloto', ' piloto ', 'Valencia'], accountManagerId: admin.userId }).expect(200);
      expect(ok.body).toMatchObject({ tags: ['piloto', 'valencia'], accountManagerId: admin.userId });
      const ficha = await get(`/tenants/${t1.tenantId}`).expect(200);
      expect(ficha.body.accountManager.id).toBe(admin.userId);
      const logs = await ctx.db.system.auditLog.findMany({ where: { tenantId: t1.tenantId, action: 'platform.tenant.account_updated' } });
      expect(logs).toHaveLength(1);
      await ctx.http().patch(`${API}/tenants/${t1.tenantId}`).set(auth(admin.token)).send({ accountManagerId: null }).expect(200);
    });

    it('notas internas: crear, listar en la ficha y borrar', async () => {
      await ctx.http().post(`${API}/tenants/${t1.tenantId}/notes`).set(auth(admin.token)).send({ body: '  ' }).expect(400);
      const note = await ctx.http().post(`${API}/tenants/${t1.tenantId}/notes`).set(auth(admin.token)).send({ body: 'Llamar tras el concierto' }).expect(201);
      const ficha = await get(`/tenants/${t1.tenantId}`).expect(200);
      expect(ficha.body.notes[0]).toMatchObject({ id: note.body.id, body: 'Llamar tras el concierto', authorName: expect.any(String) });
      expect(ficha.body.timeline.data.some((t: any) => t.kind === 'note')).toBe(true);
      // La banda no ve el texto de la nota en su auditoría.
      const audit = await ctx.db.system.auditLog.findFirstOrThrow({ where: { tenantId: t1.tenantId, action: 'platform.note.created' } });
      expect(JSON.stringify(audit.metadata ?? {})).not.toContain('Llamar');
      await ctx.http().delete(`${API}/tenants/${t2.tenantId}/notes/${note.body.id}`).set(auth(admin.token)).expect(404);
      await ctx.http().delete(`${API}/tenants/${t1.tenantId}/notes/${note.body.id}`).set(auth(admin.token)).expect(204);
      expect((await get(`/tenants/${t1.tenantId}`)).body.notes).toHaveLength(0);
    });

    it('cronología mezclada, ordenada y paginada', async () => {
      // Equivale a PATCH /admin/tenants/:id (que hoy no puede serializar storageUsedBytes: BigInt).
      await ctx.db.system.auditLog.create({
        data: { tenantId: t1.tenantId, actorId: admin.userId, action: 'platform.tenant.updated', entity: 'tenant', entityId: t1.tenantId, metadata: { planCode: 'ENTERPRISE' } },
      });
      await ctx.db.system.invoice.create({
        data: { tenantId: t1.tenantId, stripeInvoiceId: 'in_tl_1', number: 'SF-9', status: 'paid', currency: 'eur', subtotalCents: 100, taxCents: 0, totalCents: 100, amountPaidCents: 100 },
      });
      await ctx.db.system.incident.create({ data: { tenantId: t1.tenantId, subject: 'No carga el archivo', body: 'x' } });
      await ctx.http().post(`${API}/tenants/${t1.tenantId}/notes`).set(auth(admin.token)).send({ body: 'Seguimiento' }).expect(201);
      const imp = await ctx.http().post('/api/v1/admin/impersonation').set(auth(admin.token)).send({ tenantId: t1.tenantId, reason: 'Revisar el archivo musical' }).expect(201);
      expect(imp.body.session.id).toBeDefined();
      const all = await get(`/tenants/${t1.tenantId}/timeline?pageSize=100`).expect(200);
      const kinds = all.body.data.map((t: any) => t.kind);
      expect(kinds).toEqual(expect.arrayContaining(['created', 'onboarded', 'platform', 'invoice', 'incident', 'impersonation', 'note']));
      const times = all.body.data.map((t: any) => new Date(t.at).getTime());
      expect([...times].sort((a, b) => b - a)).toEqual(times);
      const p1 = await get(`/tenants/${t1.tenantId}/timeline?pageSize=2&page=1`).expect(200);
      const p2 = await get(`/tenants/${t1.tenantId}/timeline?pageSize=2&page=2`).expect(200);
      expect(p1.body).toMatchObject({ total: all.body.total, page: 1, pageSize: 2 });
      expect(p1.body.data).toHaveLength(2);
      expect(p2.body.data[0].at).not.toBe(p1.body.data[0].at);
    });
  });

  describe('lastSeenAt', () => {
    it('se actualiza como mucho una vez por hora', async () => {
      const band = await signupBand(ctx, 'ins-seen', 'PRO');
      const seen = async () => (await ctx.db.system.membership.findFirstOrThrow({ where: { tenantId: band.tenantId } })).lastSeenAt;
      expect(await seen()).toBeNull();
      await ctx.http().get('/api/v1/members').set(auth(band.token)).expect(200);
      await wait();
      const first = await seen();
      expect(first).not.toBeNull();
      await ctx.http().get('/api/v1/members').set(auth(band.token)).expect(200);
      await wait();
      expect((await seen())!.getTime()).toBe(first!.getTime());
      await ctx.db.system.membership.updateMany({ where: { tenantId: band.tenantId }, data: { lastSeenAt: addDays(new Date(), -1) } });
      await ctx.http().get('/api/v1/members').set(auth(band.token)).expect(200);
      await wait();
      expect(Date.now() - (await seen())!.getTime()).toBeLessThan(10_000);
    });
  });
});
