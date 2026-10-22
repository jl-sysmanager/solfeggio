import { auth, Band, createTestApp, resetDb, signupBand, TestCtx } from './helpers';
import { SupportService } from '../src/platform/support.service';
import { SLA_HOURS, slaDueAt } from '../src/platform/support.util';

describe('Soporte del panel global', () => {
  let ctx: TestCtx;
  let band: Band;
  let admin: Band;
  let admin2: Band;
  let incidentId: string;
  const http = () => ctx.http();
  const A = '/api/v1/admin/support';

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.db);
    band = await signupBand(ctx, 'sup-band');
    admin = await signupBand(ctx, 'sup-admin');
    admin2 = await signupBand(ctx, 'sup-admin2');
    await ctx.db.system.user.updateMany({ where: { email: { in: [admin.email, admin2.email] } }, data: { isPlatformAdmin: true } });
  });
  afterAll(() => ctx.app.close());

  it('el SLA se calcula por prioridad en una sola tabla', () => {
    const t = new Date('2030-01-01T00:00:00Z');
    expect(Object.values(SLA_HOURS)).toEqual([4, 8, 24, 48, 72]);
    expect(slaDueAt(t, 2).toISOString()).toBe('2030-01-01T08:00:00.000Z');
  });

  it('la banda abre una incidencia con slaDueAt y se avisa al equipo', async () => {
    const r = await http().post('/api/v1/incidents').set(auth(band.token)).send({ subject: 'No cargan los recibos', body: 'Error al generar', priority: 2 }).expect(201);
    incidentId = r.body.id;
    const inc = await ctx.db.system.incident.findUniqueOrThrow({ where: { id: incidentId } });
    expect(inc.slaDueAt!.getTime() - inc.createdAt.getTime()).toBe(8 * 3_600_000);
    expect(ctx.jobs.of('email.send').length).toBeGreaterThanOrEqual(2);
  });

  it('todo /admin/support exige administrador de plataforma', async () => {
    await http().get(`${A}/incidents`).set(auth(band.token)).expect(403);
    await http().get(`${A}/kpis`).set(auth(band.token)).expect(403);
    await http().post(`${A}/incidents/${incidentId}/messages`).set(auth(band.token)).send({ body: 'x' }).expect(403);
    await http().get(`${A}/canned-replies`).set(auth(band.token)).expect(403);
  });

  it('lista con filtros y asigna responsable (sólo equipo de plataforma)', async () => {
    const unassigned = await http().get(`${A}/incidents?assignee=none&status=ACTIVE`).set(auth(admin.token)).expect(200);
    expect(unassigned.body.data.map((i: any) => i.id)).toContain(incidentId);
    expect(unassigned.body.data[0]).toMatchObject({ tenant: { slug: 'sup-band' }, sla: 'ok' });
    await http().patch(`${A}/incidents/${incidentId}`).set(auth(admin.token)).send({ assigneeId: band.userId }).expect(400);
    ctx.jobs.added.length = 0;
    await http().patch(`${A}/incidents/${incidentId}`).set(auth(admin.token)).send({ assigneeId: admin2.userId }).expect(200);
    expect(ctx.jobs.of('email.send').map((j) => j.data.to)).toEqual([admin2.email]);
    const mine = await http().get(`${A}/incidents?assignee=${admin2.userId}`).set(auth(admin.token)).expect(200);
    expect(mine.body.total).toBe(1);
    expect((await http().get(`${A}/incidents?q=recibos`).set(auth(admin.token)).expect(200)).body.total).toBe(1);
    expect((await http().get(`${A}/incidents?q=zzzz`).set(auth(admin.token)).expect(200)).body.total).toBe(0);
  });

  it('cambiar la prioridad recalcula el plazo mientras no haya respuesta', async () => {
    await http().patch(`${A}/incidents/${incidentId}`).set(auth(admin.token)).send({ priority: 1 }).expect(200);
    const inc = await ctx.db.system.incident.findUniqueOrThrow({ where: { id: incidentId } });
    expect(inc.slaDueAt!.getTime() - inc.createdAt.getTime()).toBe(4 * 3_600_000);
  });

  it('las notas internas no llegan a la banda, ni siquiera bajo RLS', async () => {
    ctx.jobs.added.length = 0;
    const note = await http().post(`${A}/incidents/${incidentId}/messages`).set(auth(admin.token)).send({ body: 'Nota secreta', internal: true }).expect(201);
    expect(note.body.internal).toBe(true);
    expect(ctx.jobs.added).toHaveLength(0);
    expect((await ctx.db.system.incident.findUniqueOrThrow({ where: { id: incidentId } })).firstResponseAt).toBeNull();

    const reply = await http().post(`${A}/incidents/${incidentId}/messages`).set(auth(admin.token)).send({ body: 'Estamos en ello' }).expect(201);
    expect(reply.body.internal).toBe(false);
    const fan = ctx.jobs.of('notify.fanout');
    expect(fan).toHaveLength(1);
    expect(fan[0].data).toMatchObject({ userIds: [band.userId], email: true, tenantId: band.tenantId });
    const inc = await ctx.db.system.incident.findUniqueOrThrow({ where: { id: incidentId } });
    expect(inc.firstResponseAt).not.toBeNull();
    expect(inc.status).toBe('IN_PROGRESS');
    const first = inc.firstResponseAt;
    await http().post(`${A}/incidents/${incidentId}/messages`).set(auth(admin.token)).send({ body: 'Otra' }).expect(201);
    expect((await ctx.db.system.incident.findUniqueOrThrow({ where: { id: incidentId } })).firstResponseAt).toEqual(first);

    const view = await http().get(`/api/v1/incidents/${incidentId}`).set(auth(band.token)).expect(200);
    expect(view.body.messages.map((m: any) => m.body)).toEqual(['Estamos en ello', 'Otra']);
    expect(JSON.stringify(view.body)).not.toContain('secreta');

    // Consulta directa con el rol de aplicación: la política RLS oculta las internas.
    const rows = await ctx.db.tenant(band.tenantId, (tx) => tx.incidentMessage.findMany({ where: { incidentId } }));
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.internal)).toBe(false);
    // Y la banda no puede insertar mensajes internos ni de plataforma.
    await expect(
      ctx.db.tenant(band.tenantId, (tx) => tx.incidentMessage.create({ data: { tenantId: band.tenantId, incidentId, authorType: 'PLATFORM', body: 'x' } })),
    ).rejects.toThrow();
    await expect(
      ctx.db.tenant(band.tenantId, (tx) => tx.incidentMessage.create({ data: { tenantId: band.tenantId, incidentId, authorType: 'TENANT', body: 'x', internal: true } })),
    ).rejects.toThrow();
  });

  it('la respuesta de la banda reabre una incidencia resuelta', async () => {
    ctx.jobs.added.length = 0;
    await http().patch(`${A}/incidents/${incidentId}`).set(auth(admin.token)).send({ status: 'RESOLVED', resolution: 'Arreglado' }).expect(200);
    expect(ctx.jobs.of('notify.fanout')).toHaveLength(1);
    const r = await http().post(`/api/v1/incidents/${incidentId}/messages`).set(auth(band.token)).send({ body: 'Sigue fallando' }).expect(201);
    expect(r.body.reopened).toBe(true);
    expect((await ctx.db.system.incident.findUniqueOrThrow({ where: { id: incidentId } })).status).toBe('IN_PROGRESS');
    // Sólo se avisa al responsable asignado.
    expect(ctx.jobs.of('email.send').map((j) => j.data.to)).toEqual([admin2.email]);
    await http().patch(`${A}/incidents/${incidentId}`).set(auth(admin.token)).send({ status: 'CLOSED' }).expect(200);
    await http().post(`/api/v1/incidents/${incidentId}/messages`).set(auth(band.token)).send({ body: 'tarde' }).expect(400);
  });

  it('otra banda no ve la conversación', async () => {
    const other = await signupBand(ctx, 'sup-other');
    await http().get(`/api/v1/incidents/${incidentId}`).set(auth(other.token)).expect(404);
    await http().post(`/api/v1/incidents/${incidentId}/messages`).set(auth(other.token)).send({ body: 'hola' }).expect(404);
  });

  it('respuestas predefinidas: CRUD', async () => {
    const c = await http().post(`${A}/canned-replies`).set(auth(admin.token)).send({ title: 'Saludo', body: 'Hola, gracias por escribirnos.' }).expect(201);
    await http().post(`${A}/canned-replies`).set(auth(admin.token)).send({ title: 'Saludo', body: 'otra' }).expect(409);
    await http().patch(`${A}/canned-replies/${c.body.id}`).set(auth(admin.token)).send({ body: 'Hola.' }).expect(200);
    expect((await http().get(`${A}/canned-replies`).set(auth(admin.token)).expect(200)).body[0].body).toBe('Hola.');
    await http().delete(`${A}/canned-replies/${c.body.id}`).set(auth(admin.token)).expect(204);
    expect((await http().get(`${A}/canned-replies`).set(auth(admin.token)).expect(200)).body).toHaveLength(0);
  });

  it('el barrido de SLA avisa una sola vez y calcula los indicadores', async () => {
    const support = ctx.app.get(SupportService);
    const mk = (subject: string, hoursAgo: number, priority: number) =>
      ctx.db.system.incident.create({
        data: { tenantId: band.tenantId, subject, body: 'b', priority, createdAt: new Date(Date.now() - hoursAgo * 3_600_000), slaDueAt: slaDueAt(new Date(Date.now() - hoursAgo * 3_600_000), priority) },
      });
    await mk('Vencida', 30, 3);
    await mk('En riesgo', 23.5, 3);
    await mk('Holgada', 1, 3);
    ctx.jobs.added.length = 0;
    expect(await support.slaSweep()).toEqual({ alerted: 2 });
    // 2 incidencias x 2 administradores.
    expect(ctx.jobs.of('email.send')).toHaveLength(4);
    expect(ctx.jobs.of('email.send')[0].data.subject).toContain('SLA');
    ctx.jobs.added.length = 0;
    expect(await support.slaSweep()).toEqual({ alerted: 0 });
    expect(ctx.jobs.added).toHaveLength(0);

    const k = (await http().get(`${A}/kpis`).set(auth(admin.token)).expect(200)).body;
    expect(k).toMatchObject({ open: 3, overdue: 1, atRisk: 1 });
    // Medibles: la respondida en plazo y la vencida sin respuesta (las que aún están en plazo no cuentan).
    expect(k.last30d.responded).toBe(1);
    expect(k.last30d.medianFirstResponseMinutes).toBeGreaterThanOrEqual(0);
    expect(k.last30d.withinSlaPct).toBe(50);
  });
});
