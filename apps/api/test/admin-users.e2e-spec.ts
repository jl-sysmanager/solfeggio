import { auth, createTestApp, PASSWORD, resetDb, signupBand, TestCtx } from './helpers';

describe('Usuarios de plataforma', () => {
  let ctx: TestCtx;
  const http = () => ctx.http();
  const U = '/api/v1/admin/users';

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.db);
  });
  afterAll(() => ctx.app.close());

  it('lista sólo el equipo; las cuentas ajenas sin banda se borran en el análisis de huérfanos', async () => {
    const admin = await signupBand(ctx, 'users-admin');
    await ctx.db.system.user.update({ where: { email: admin.email }, data: { isPlatformAdmin: true } });
    const member = await signupBand(ctx, 'users-member');

    await http().post('/api/v1/auth/register').send({ email: 'orphan@test.local', password: PASSWORD, name: 'Sin Banda' }).expect(201);
    const orphan = await ctx.db.system.user.findUniqueOrThrow({ where: { email: 'orphan@test.local' } });
    await ctx.db.system.musicianProfile.create({
      data: { userId: orphan.id, displayName: 'Sin Banda', instruments: ['Clarinete'], province: 'Madrid' },
    });

    const listed = await http().get(U).set(auth(admin.token)).expect(200);
    const emails = listed.body.data.map((u: { email: string }) => u.email);
    expect(emails).toContain(admin.email);
    expect(emails).not.toContain('orphan@test.local');
    expect(emails).not.toContain(member.email);

    await http().delete(`${U}/${orphan.id}`).set(auth(member.token)).expect(403);
    expect((await http().delete(`${U}/${orphan.id}`).set(auth(admin.token)).expect(400)).body.code).toBe('NOT_PLATFORM_USER');
    expect((await http().delete(`${U}/${member.userId}`).set(auth(admin.token)).expect(400)).body.code).toBe('NOT_PLATFORM_USER');
    expect((await http().delete(`${U}/${admin.userId}`).set(auth(admin.token)).expect(400)).body.code).toBe('CANNOT_DELETE_SELF');

    const scan = await http().post('/api/v1/admin/ops/storage/orphans/scan').set(auth(admin.token)).expect(200);
    expect(scan.body.accounts).toBeGreaterThanOrEqual(1);
    const storage = await http().get('/api/v1/admin/ops/storage').set(auth(admin.token)).expect(200);
    expect(storage.body.orphans.detail.accounts.sample.map((u: { email: string }) => u.email)).toContain('orphan@test.local');
    expect(storage.body.orphans.detail.accounts.sample.map((u: { email: string }) => u.email)).not.toContain(admin.email);
    expect(storage.body.orphans.detail.accounts.sample.map((u: { email: string }) => u.email)).not.toContain(member.email);

    await http().post('/api/v1/admin/ops/storage/orphans/accounts/delete').set(auth(admin.token)).send({}).expect(400);
    await http().post('/api/v1/admin/ops/storage/orphans/accounts/delete').set(auth(admin.token)).send({ confirm: 'ELIMINAR', ids: [member.userId] }).expect(200);
    expect(await ctx.db.system.user.findUnique({ where: { id: member.userId } })).not.toBeNull();
    const removed = await http().post('/api/v1/admin/ops/storage/orphans/accounts/delete').set(auth(admin.token)).send({ confirm: 'ELIMINAR', ids: [orphan.id] }).expect(200);
    expect(removed.body.deleted).toBe(1);
    expect(await ctx.db.system.user.findUnique({ where: { id: orphan.id } })).toBeNull();
    expect(await ctx.db.system.musicianProfile.findUnique({ where: { userId: orphan.id } })).toBeNull();
    expect(await ctx.db.system.platformAuditLog.count({ where: { action: 'ops.orphan_accounts.deleted' } })).toBe(2);
    await http().post('/api/v1/auth/login').send({ email: 'orphan@test.local', password: PASSWORD }).expect(401);
    await http().delete(`${U}/00000000-0000-4000-8000-000000000000`).set(auth(admin.token)).expect(404);
  });

  it('incorpora al equipo una cuenta existente por email', async () => {
    const admin = await signupBand(ctx, 'users-grant');
    await ctx.db.system.user.update({ where: { id: admin.userId }, data: { isPlatformAdmin: true } });
    await http().post('/api/v1/auth/register').send({ email: 'nuevo-equipo@test.local', password: PASSWORD, name: 'Nuevo' }).expect(201);
    await http().post(`${U}/grant`).set(auth(admin.token)).send({ email: 'nadie@test.local' }).expect(404);
    const granted = await http().post(`${U}/grant`).set(auth(admin.token)).send({ email: 'Nuevo-Equipo@test.local' }).expect(200);
    expect(granted.body.isPlatformAdmin).toBe(true);
    const listed = await http().get(U).set(auth(admin.token)).expect(200);
    expect(listed.body.data.map((u: { email: string }) => u.email)).toContain('nuevo-equipo@test.local');
  });

  it('un administrador sin banda también se puede eliminar, menos uno mismo', async () => {
    const admin = await signupBand(ctx, 'users-staff');
    await ctx.db.system.user.update({ where: { id: admin.userId }, data: { isPlatformAdmin: true } });
    await http().post('/api/v1/auth/register').send({ email: 'staff-libre@test.local', password: PASSWORD, name: 'Equipo Libre' }).expect(201);
    const staff = await ctx.db.system.user.findUniqueOrThrow({ where: { email: 'staff-libre@test.local' } });
    await ctx.db.system.user.update({ where: { id: staff.id }, data: { isPlatformAdmin: true } });
    const login = await http().post('/api/v1/auth/login').send({ email: 'staff-libre@test.local', password: PASSWORD }).expect(200);

    expect((await http().delete(`${U}/${staff.id}`).set(auth(login.body.accessToken)).expect(400)).body.code).toBe('CANNOT_DELETE_SELF');
    await http().delete(`${U}/${staff.id}`).set(auth(admin.token)).expect(204);
    expect(await ctx.db.system.user.findUnique({ where: { id: staff.id } })).toBeNull();
    expect(await ctx.db.system.user.findUnique({ where: { id: admin.userId } })).not.toBeNull();
  });
});
