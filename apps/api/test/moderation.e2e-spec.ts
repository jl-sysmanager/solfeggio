import { addUser, auth, Band, createTestApp, PASSWORD, resetDb, signupBand, TestCtx } from './helpers';

describe('Moderación ampliada', () => {
  let ctx: TestCtx;
  let a: Band;
  let b: Band;
  let admin: Band;
  let bMusician: string;
  const ids: Record<string, string> = {};
  const http = () => ctx.http();
  const M = '/api/v1/admin/moderation';
  const R = '/api/v1/reinforcements';
  const cookieOf = (res: any) => (res.headers['set-cookie'] as string[]).map((c) => c.split(';')[0]).join('; ');

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.db);
    a = await signupBand(ctx, 'mod-a');
    b = await signupBand(ctx, 'mod-b');
    admin = await signupBand(ctx, 'mod-admin');
    await ctx.db.system.user.update({ where: { email: admin.email }, data: { isPlatformAdmin: true } });
    bMusician = await addUser(ctx, b, 'musician', 'mod-musico@test.local');
    const profile = { displayName: 'Beto Abusón', instruments: ['Trompeta'], province: 'Valencia' };
    ids.bProfile = (await http().put(`${R}/profile`).set(auth(b.token)).send(profile).expect(200)).body.profile.id;
    await http().put(`${R}/profile`).set(auth(a.token)).send({ ...profile, displayName: 'Ana' }).expect(200);
    ids.aProfile = (await ctx.db.system.musicianProfile.findFirstOrThrow({ where: { userId: a.userId } })).id;
    ids.request = (await http().post(`${R}/requests`).set(auth(a.token)).send({ title: 'Trompeta urgente', instrument: 'Trompeta', date: '2031-04-10T18:00:00Z', province: 'Valencia' }).expect(201)).body.id;
  });
  afterAll(() => ctx.app.close());

  it('toda la moderación exige administrador de plataforma', async () => {
    await http().get(`${M}/reinforcements`).set(auth(a.token)).expect(403);
    await http().get(`${M}/kpis`).set(auth(a.token)).expect(403);
    await http().post(`${M}/users/${b.userId}/block`).set(auth(a.token)).send({ reason: 'abuso' }).expect(403);
    await http().post(`${M}/users/${b.userId}/unblock`).set(auth(a.token)).expect(403);
    await http().get('/api/v1/admin/market/pending').set(auth(a.token)).expect(403);
  });

  it('las bandas denuncian necesidades y perfiles ajenos', async () => {
    await http().post(`${R}/requests/${ids.request}/report`).set(auth(a.token)).send({ reason: 'mía' }).expect(400);
    await http().post(`${R}/requests/${ids.request}/report`).set(auth(b.token)).send({ reason: 'x' }).expect(400);
    const r1 = await http().post(`${R}/requests/${ids.request}/report`).set(auth(b.token)).send({ reason: 'Oferta engañosa o fraudulenta' }).expect(201);
    const again = await http().post(`${R}/requests/${ids.request}/report`).set(auth(b.token)).send({ reason: 'Oferta engañosa o fraudulenta' }).expect(201);
    expect(again.body.id).toBe(r1.body.id);
    await http().post(`${R}/musicians/${ids.bProfile}/report`).set(auth(b.token)).send({ reason: 'Es mi perfil' }).expect(400);
    await http().post(`${R}/musicians/${ids.bProfile}/report`).set(auth(a.token)).send({ reason: 'Contacta con datos falsos' }).expect(201);
    await http().post(`${R}/requests/${ids.request}/report`).set(auth(bMusician)).send({ reason: 'Otra denuncia más' }).expect(201);
    await http().post(`${R}/requests/${'00000000-0000-4000-8000-000000000000'}/report`).set(auth(b.token)).send({ reason: 'No existe' }).expect(404);
  });

  it('la cola agrupa las denuncias por necesidad o perfil', async () => {
    const q = (await http().get(`${M}/reinforcements`).set(auth(admin.token)).expect(200)).body;
    expect(q).toHaveLength(2);
    const req = q.find((g: any) => g.kind === 'request');
    expect(req.reports).toHaveLength(2);
    expect(req.request).toMatchObject({ title: 'Trompeta urgente', band: { slug: 'mod-a' } });
    expect(q.find((g: any) => g.kind === 'profile').profile.displayName).toBe('Beto Abusón');
    ids.reqReport = (await ctx.db.system.reinforcementReport.findFirstOrThrow({ where: { requestId: ids.request } })).id;
    ids.profReport = (await ctx.db.system.reinforcementReport.findFirstOrThrow({ where: { profileId: ids.bProfile } })).id;
  });

  it('descartar, ocultar necesidad y ocultar perfil (auditado)', async () => {
    await http().post(`${M}/reinforcements/reports/${ids.reqReport}/resolve`).set(auth(admin.token)).send({ action: 'hide_profile' }).expect(400);
    await http().post(`${M}/reinforcements/reports/${ids.profReport}/resolve`).set(auth(admin.token)).send({ action: 'hide_request' }).expect(400);
    await http().post(`${M}/reinforcements/reports/${ids.reqReport}/resolve`).set(auth(admin.token)).send({ action: 'block_user' }).expect(400);

    ctx.jobs.added.length = 0;
    await http().post(`${M}/reinforcements/reports/${ids.reqReport}/resolve`).set(auth(admin.token)).send({ action: 'hide_request', note: 'Sin datos de contacto reales' }).expect(200);
    const r = await ctx.db.system.reinforcementRequest.findUniqueOrThrow({ where: { id: ids.request } });
    expect(r.status).toBe('CANCELLED');
    expect(ctx.jobs.of('notify.fanout')).toHaveLength(1);
    const open = await http().get(`${R}/requests`).set(auth(b.token)).expect(200);
    expect(open.body.data.map((x: any) => x.id)).not.toContain(ids.request);
    expect(await ctx.db.system.reinforcementReport.count({ where: { requestId: ids.request, resolvedAt: null } })).toBe(0);
    await http().post(`${M}/reinforcements/reports/${ids.reqReport}/resolve`).set(auth(admin.token)).send({ action: 'dismiss' }).expect(400);

    await http().post(`${M}/reinforcements/reports/${ids.profReport}/resolve`).set(auth(admin.token)).send({ action: 'hide_profile', note: 'Datos falsos' }).expect(200);
    expect((await ctx.db.system.musicianProfile.findUniqueOrThrow({ where: { id: ids.bProfile } })).available).toBe(false);
    expect(await http().get(`${M}/reinforcements`).set(auth(admin.token)).expect(200).then((x) => x.body)).toEqual([]);
    expect(await ctx.db.system.platformAuditLog.count({ where: { action: 'reinforcement.report.resolved' } })).toBe(2);
  });

  it('descartar una denuncia no toca el contenido', async () => {
    const rep = await http().post(`${R}/musicians/${ids.aProfile}/report`).set(auth(b.token)).send({ reason: 'Perfil sospechoso' }).expect(201);
    await http().post(`${M}/reinforcements/reports/${rep.body.id}/resolve`).set(auth(admin.token)).send({ action: 'dismiss' }).expect(200);
    expect((await ctx.db.system.musicianProfile.findUniqueOrThrow({ where: { id: ids.aProfile } })).available).toBe(true);
  });

  it('bloquear un usuario: login, refresh y token quedan rechazados; se desbloquea', async () => {
    const login = await http().post('/api/v1/auth/login').send({ email: 'mod-musico@test.local', password: PASSWORD }).expect(200);
    const cookie = cookieOf(login);
    const token = login.body.accessToken;
    await http().get('/api/v1/notifications').set(auth(token)).expect(200);

    await http().post(`${M}/users/${b.userId}/block`).set(auth(admin.token)).send({ reason: 'x' }).expect(400);
    const user = await ctx.db.system.user.findUniqueOrThrow({ where: { email: 'mod-musico@test.local' } });
    await http().post(`${M}/users/${user.id}/block`).set(auth(admin.token)).send({ reason: 'Suplantación de identidad' }).expect(200);

    expect((await http().get('/api/v1/notifications').set(auth(token)).expect(401)).body.code).toBe('ACCOUNT_BLOCKED');
    expect((await http().post('/api/v1/auth/login').send({ email: 'mod-musico@test.local', password: PASSWORD }).expect(403)).body.code).toBe('ACCOUNT_BLOCKED');
    await http().post('/api/v1/auth/refresh').set('Cookie', cookie).expect(401);
    expect(await ctx.db.system.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    const found = await http().get(`${M}/users?blocked=true`).set(auth(admin.token)).expect(200);
    expect(found.body[0]).toMatchObject({ email: 'mod-musico@test.local', blockedReason: 'Suplantación de identidad' });

    await http().post(`${M}/users/${user.id}/unblock`).set(auth(admin.token)).expect(200);
    await http().post('/api/v1/auth/login').send({ email: 'mod-musico@test.local', password: PASSWORD }).expect(200);
    expect(await ctx.db.system.platformAuditLog.count({ where: { action: { in: ['user.blocked', 'user.unblocked'] } } })).toBe(2);
  });

  it('no se puede bloquear a administradores ni a uno mismo', async () => {
    const admin2 = await signupBand(ctx, 'mod-admin2');
    await ctx.db.system.user.update({ where: { email: admin2.email }, data: { isPlatformAdmin: true } });
    expect((await http().post(`${M}/users/${admin.userId}/block`).set(auth(admin.token)).send({ reason: 'yo mismo' }).expect(400)).body.code).toBe('CANNOT_BLOCK_SELF');
    expect((await http().post(`${M}/users/${admin2.userId}/block`).set(auth(admin.token)).send({ reason: 'otro admin' }).expect(403)).body.code).toBe('CANNOT_BLOCK_ADMIN');
    await http().post(`${M}/users/00000000-0000-4000-8000-000000000000/block`).set(auth(admin.token)).send({ reason: 'no existe' }).expect(404);
  });

  it('bloquear desde una denuncia retira sus necesidades y su perfil', async () => {
    ids.req2 = (await http().post(`${R}/requests`).set(auth(b.token)).send({ title: 'Otra necesidad', instrument: 'Tuba', date: '2031-05-10T18:00:00Z', province: 'Valencia' }).expect(201)).body.id;
    const rep = await http().post(`${R}/requests/${ids.req2}/report`).set(auth(a.token)).send({ reason: 'Estafa reiterada' }).expect(201);
    await http().put(`${R}/profile`).set(auth(b.token)).send({ displayName: 'Beto', instruments: ['Tuba'], province: 'Valencia' }).expect(200);
    await http().post(`${M}/reinforcements/reports/${rep.body.id}/resolve`).set(auth(admin.token)).send({ action: 'block_user', note: 'Estafa reiterada' }).expect(200);
    expect((await ctx.db.system.user.findUniqueOrThrow({ where: { id: b.userId } })).blockedAt).not.toBeNull();
    expect((await ctx.db.system.reinforcementRequest.findUniqueOrThrow({ where: { id: ids.req2 } })).status).toBe('CANCELLED');
    expect((await ctx.db.system.musicianProfile.findUniqueOrThrow({ where: { userId: b.userId } })).available).toBe(false);
    await http().get('/api/v1/notifications').set(auth(b.token)).expect(401);
  });

  it('BandMarket: submittedAt al enviar, espera frente a 24 h e indicadores', async () => {
    const c = await signupBand(ctx, 'mod-seller');
    const l = await http().post('/api/v1/market/listings').set(auth(c.token)).send({ title: 'Bombardino Besson', description: 'En buen estado, con boquilla.', category: 'Metal', condition: 'GOOD', priceCents: 90000 }).expect(201);
    expect((await ctx.db.system.listing.findUniqueOrThrow({ where: { id: l.body.id } })).submittedAt).toBeNull();
    await http().post(`/api/v1/market/listings/${l.body.id}/submit`).set(auth(c.token)).expect(200);
    expect((await ctx.db.system.listing.findUniqueOrThrow({ where: { id: l.body.id } })).submittedAt).not.toBeNull();

    const base = { tenantId: c.tenantId, createdById: c.userId, description: 'Descripción larga', category: 'Metal', condition: 'GOOD' as const, priceCents: 100 };
    const ago = (h: number) => new Date(Date.now() - h * 3_600_000);
    const slow = await ctx.db.system.listing.create({ data: { ...base, title: 'Lenta', status: 'PENDING_REVIEW', submittedAt: ago(30) } });
    // Dos moderados en los últimos 30 días: uno en 2 h y otro en 40 h.
    await ctx.db.system.listing.create({ data: { ...base, title: 'Rápida', status: 'PUBLISHED', submittedAt: ago(10), moderatedAt: ago(8) } });
    await ctx.db.system.listing.create({ data: { ...base, title: 'Tardía', status: 'REJECTED', submittedAt: ago(50), moderatedAt: ago(10) } });

    const pending = (await http().get('/api/v1/admin/market/pending').set(auth(admin.token)).expect(200)).body.pending;
    expect(pending.find((x: any) => x.id === slow.id)).toMatchObject({ slaBreached: true });
    expect(pending.find((x: any) => x.id === slow.id).waitingHours).toBeGreaterThan(29.9);
    expect(pending.find((x: any) => x.id === l.body.id).slaBreached).toBe(false);
    expect(pending[0].id).toBe(slow.id);

    const k = (await http().get(`${M}/kpis`).set(auth(admin.token)).expect(200)).body;
    expect(k.market).toMatchObject({ pending: 2, overdue: 1 });
    expect(k.market.last30d).toEqual({ moderated: 2, medianHours: 21, within24hPct: 50 });
    expect(k.targetHours).toBe(24);
    expect(k.blockedUsers).toBe(1);
  });
});
