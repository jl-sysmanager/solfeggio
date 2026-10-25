import { auth, Band, createTestApp, resetDb, signupBand, TestCtx } from './helpers';

const API = '/api/v1';

describe('«Ver como» (impersonación de plataforma)', () => {
  let ctx: TestCtx;
  let band: Band;
  let admin: Band;
  let adminToken: string;
  const start = (body: object, token = adminToken) => ctx.http().post(`${API}/admin/impersonation`).set(auth(token)).send(body);

  const begin = async (over: object = {}) => {
    const res = await start({ tenantId: band.tenantId, reason: 'Revisar incidencia de soporte', minutes: 30, ...over }).expect(201);
    return { token: res.body.accessToken as string, id: res.body.session.id as string, body: res.body };
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.db);
    band = await signupBand(ctx, 'imp-band', 'PRO');
    admin = await signupBand(ctx, 'imp-admin', 'FREE');
    await ctx.db.system.user.update({ where: { id: admin.userId }, data: { isPlatformAdmin: true } });
    adminToken = admin.token;
    // Socio con datos sensibles creado por el propietario de la banda.
    await ctx.http().post(`${API}/members`).set(auth(band.token)).send({ firstName: 'Lola', lastName: 'Flores', nationalId: '12345678Z' }).expect(201);
  });
  afterAll(() => ctx.app.close());

  it('exige un motivo de al menos 10 caracteres y sólo a administradores', async () => {
    await start({ tenantId: band.tenantId, reason: 'corto' }).expect(400);
    await start({ tenantId: band.tenantId, reason: 'Motivo suficientemente largo' }, band.token).expect(403);
    await start({ tenantId: band.tenantId, reason: 'Motivo suficientemente largo', minutes: 2 }).expect(400);
    await start({ tenantId: '00000000-0000-4000-8000-000000000000', reason: 'Motivo suficientemente largo' }).expect(404);
  });

  it('inicia la sesión y devuelve token con imp y fecha de fin', async () => {
    const { body, token } = await begin({ minutes: 15 });
    expect(new Date(body.expiresAt).getTime() - Date.now()).toBeLessThan(15 * 60_000 + 5000);
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    expect(payload).toMatchObject({ sub: admin.userId, tid: band.tenantId, imp: body.session.id });
  });

  it('las lecturas funcionan en la banda visitada y /auth/me describe la sesión', async () => {
    const { token, id } = await begin();
    const members = await ctx.http().get(`${API}/members`).set(auth(token)).expect(200);
    expect(members.body.data.length).toBe(1);
    const me = await ctx.http().get(`${API}/auth/me`).set(auth(token)).expect(200);
    expect(me.body.user.id).toBe(admin.userId);
    expect(me.body.tenant.id).toBe(band.tenantId);
    expect(me.body.role.name).toBe('Ver como (solo lectura)');
    expect(me.body.impersonation).toMatchObject({ sessionId: id, tenantName: 'Banda imp-band', reason: 'Revisar incidencia de soporte' });
    expect(me.body.permissions).not.toContain('members:sensitive');
    expect(me.body.permissions.every((p: string) => p.endsWith(':read'))).toBe(true);
  });

  it('oculta el DNI', async () => {
    const { token } = await begin();
    const members = await ctx.http().get(`${API}/members`).set(auth(token)).expect(200);
    const m = members.body.data[0];
    expect(m.nationalId ?? null).toBeNull();
    const own = await ctx.http().get(`${API}/members`).set(auth(band.token)).expect(200);
    expect(own.body.data[0].nationalId).toBe('12345678Z');
  });

  it('rechaza cualquier escritura con IMPERSONATION_READ_ONLY', async () => {
    const { token } = await begin();
    const check = async (method: 'post' | 'put' | 'patch' | 'delete', path: string) => {
      const res = await ctx.http()[method](`${API}${path}`).set(auth(token)).send({}).expect(403);
      expect(res.body.code).toBe('IMPERSONATION_READ_ONLY');
    };
    await check('post', '/members');
    await check('patch', '/members/00000000-0000-4000-8000-000000000000');
    await check('delete', '/sections/00000000-0000-4000-8000-000000000000');
    await check('put', '/events/00000000-0000-4000-8000-000000000000/repertoire');
    await check('post', '/auth/switch-tenant');
    await check('post', '/billing/checkout');
  });

  it('rechaza las rutas de plataforma con el token «ver como»', async () => {
    const { token } = await begin();
    const res = await ctx.http().get(`${API}/admin/tenants`).set(auth(token)).expect(403);
    expect(res.body.code).toBe('IMPERSONATION_FORBIDDEN');
    await ctx.http().get(`${API}/admin/insights/health`).set(auth(token)).expect(403);
    await ctx.http().post(`${API}/admin/impersonation`).set(auth(token)).send({ tenantId: band.tenantId, reason: 'Motivo suficientemente largo' }).expect(403);
  });

  it('no actualiza lastSeenAt durante la sesión', async () => {
    const { token } = await begin();
    const before = await ctx.db.system.membership.findMany({ where: { tenantId: band.tenantId } });
    await ctx.http().get(`${API}/members`).set(auth(token)).expect(200);
    await new Promise((r) => setTimeout(r, 200));
    const after = await ctx.db.system.membership.findMany({ where: { tenantId: band.tenantId } });
    expect(after.map((m) => m.lastSeenAt?.getTime() ?? null)).toEqual(before.map((m) => m.lastSeenAt?.getTime() ?? null));
  });

  it('auditoría visible para la banda: inicio y fin', async () => {
    const { token, id } = await begin({ reason: 'Auditoría visible a la banda' });
    await ctx.http().post(`${API}/impersonation/end`).set(auth(token)).send({}).expect(200);
    // Segundo cierre: idempotente, sin más filas de auditoría.
    await ctx.http().post(`${API}/admin/impersonation/${id}/end`).set(auth(adminToken)).send({}).expect(200);
    const logs = await ctx.http().get(`${API}/audit-logs`).set(auth(band.token)).query({ entity: 'impersonation', pageSize: 100 }).expect(200);
    const mine = logs.body.data.filter((l: { entityId: string }) => l.entityId === id);
    expect(mine.map((l: { action: string }) => l.action).sort()).toEqual(['platform.impersonation.ended', 'platform.impersonation.started']);
    expect(mine[0].actorId).toBe(admin.userId);
    expect(mine.find((l: { action: string }) => l.action.endsWith('started')).metadata.reason).toBe('Auditoría visible a la banda');
  });

  it('tras terminar, el token deja de valer', async () => {
    const { token, id } = await begin();
    await ctx.http().post(`${API}/impersonation/end`).set(auth(token)).send({}).expect(200);
    const res = await ctx.http().get(`${API}/members`).set(auth(token)).expect(401);
    expect(res.body.code).toBe('IMPERSONATION_ENDED');
    const row = await ctx.db.system.impersonationSession.findUniqueOrThrow({ where: { id } });
    expect(row.endedAt).not.toBeNull();
  });

  it('una sesión caducada se rechaza y puede cerrarse desde el panel', async () => {
    const { token, id } = await begin();
    await ctx.db.system.impersonationSession.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await ctx.http().get(`${API}/members`).set(auth(token)).expect(401);
    await ctx.http().post(`${API}/admin/impersonation/${id}/end`).set(auth(adminToken)).send({}).expect(200);
    expect((await ctx.db.system.impersonationSession.findUniqueOrThrow({ where: { id } })).endedAt).not.toBeNull();
  });

  it('un administrador bloqueado o degradado pierde el acceso al instante', async () => {
    const { token } = await begin();
    await ctx.db.system.user.update({ where: { id: admin.userId }, data: { blockedAt: new Date() } });
    const blocked = await ctx.http().get(`${API}/members`).set(auth(token)).expect(401);
    expect(blocked.body.code).toBe('ACCOUNT_BLOCKED');
    await ctx.db.system.user.update({ where: { id: admin.userId }, data: { blockedAt: null, isPlatformAdmin: false } });
    await ctx.http().get(`${API}/members`).set(auth(token)).expect(401);
    await ctx.db.system.user.update({ where: { id: admin.userId }, data: { isPlatformAdmin: true } });
  });

  it('el historial lista las sesiones de la banda', async () => {
    const res = await ctx.http().get(`${API}/admin/impersonation`).set(auth(adminToken)).query({ tenantId: band.tenantId }).expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(5);
    expect(res.body.data[0]).toMatchObject({ tenantId: band.tenantId, admin: { email: admin.email } });
    await ctx.http().get(`${API}/admin/impersonation`).set(auth(band.token)).expect(403);
  });

  it('un usuario normal no puede cerrar sesiones ajenas', async () => {
    await ctx.http().post(`${API}/impersonation/end`).set(auth(band.token)).send({}).expect(404);
  });
});
