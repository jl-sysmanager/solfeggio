import { addUser, auth, createTestApp, PASSWORD, resetDb, signupBand, TestCtx } from './helpers';

describe('Baja de una banda', () => {
  let ctx: TestCtx;
  const http = () => ctx.http();

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.db);
  });
  afterAll(() => ctx.app.close());

  it('borra ficheros y cuentas que sólo pertenecían a la banda', async () => {
    const a = await signupBand(ctx, 'purge-a');
    const b = await signupBand(ctx, 'purge-b');
    const soloEmail = 'purge-solo@test.local';
    await addUser(ctx, a, 'musician', soloEmail);
    const solo = await ctx.db.system.user.findUniqueOrThrow({ where: { email: soloEmail } });
    await ctx.db.system.musicianProfile.create({
      data: { userId: solo.id, displayName: 'Solo', instruments: ['Flauta'], province: 'Madrid' },
    });

    const sharedEmail = 'purge-shared@test.local';
    await http().post('/api/v1/auth/register').send({ email: sharedEmail, password: PASSWORD, name: 'Compartida' }).expect(201);
    const shared = await ctx.db.system.user.findUniqueOrThrow({ where: { email: sharedEmail } });
    const roleA = await ctx.db.system.role.findUniqueOrThrow({ where: { tenantId_key: { tenantId: a.tenantId, key: 'musician' } } });
    const roleB = await ctx.db.system.role.findUniqueOrThrow({ where: { tenantId_key: { tenantId: b.tenantId, key: 'musician' } } });
    await ctx.db.system.membership.create({ data: { tenantId: a.tenantId, userId: shared.id, roleId: roleA.id } });
    await ctx.db.system.membership.create({ data: { tenantId: b.tenantId, userId: shared.id, roleId: roleB.id } });

    const key = `tenants/${a.tenantId}/documents/partitura.pdf`;
    const other = `tenants/${b.tenantId}/documents/otra.pdf`;
    ctx.storage.put(key, Buffer.from('pdf'));
    ctx.storage.put(other, Buffer.from('pdf'));
    await ctx.db.system.tenant.update({ where: { id: a.tenantId }, data: { logoKey: key } });

    const res = await http().post('/api/v1/tenant/delete').set(auth(a.token)).send({ password: PASSWORD, confirm: 'ELIMINAR' }).expect(200);
    expect(res.body).toMatchObject({ accountDeleted: true, accessToken: null, session: null });

    expect(await ctx.db.system.user.findUnique({ where: { id: a.userId } })).toBeNull();
    expect(await ctx.db.system.user.findUnique({ where: { id: solo.id } })).toBeNull();
    expect(await ctx.db.system.musicianProfile.findUnique({ where: { userId: solo.id } })).toBeNull();
    expect(await ctx.db.system.user.findUnique({ where: { id: shared.id } })).not.toBeNull();
    expect(await ctx.db.system.membership.count({ where: { userId: shared.id, tenantId: a.tenantId } })).toBe(0);
    expect(await ctx.db.system.membership.count({ where: { userId: shared.id, tenantId: b.tenantId } })).toBe(1);
    expect(ctx.storage.objects.has(key)).toBe(false);
    expect(ctx.storage.objects.has(other)).toBe(true);
    const tenant = await ctx.db.system.tenant.findUniqueOrThrow({ where: { id: a.tenantId } });
    expect(tenant.deletedAt).not.toBeNull();
    expect(tenant.logoKey).toBeNull();
    await http().post('/api/v1/auth/login').send({ email: a.email, password: PASSWORD }).expect(401);
    await http().post('/api/v1/auth/login').send({ email: sharedEmail, password: PASSWORD }).expect(200);
  });

  it('conserva al administrador de plataforma aunque sea su única banda', async () => {
    const band = await signupBand(ctx, 'purge-admin');
    await ctx.db.system.user.update({ where: { id: band.userId }, data: { isPlatformAdmin: true } });
    const key = `tenants/${band.tenantId}/brand/logo.png`;
    ctx.storage.put(key, Buffer.from('png'));

    const res = await http().post('/api/v1/tenant/delete').set(auth(band.token)).send({ password: PASSWORD, confirm: 'ELIMINAR' }).expect(200);
    expect(res.body.accountDeleted).toBe(false);
    expect(res.body.session.memberships).toEqual([]);
    expect(await ctx.db.system.user.findUnique({ where: { id: band.userId } })).not.toBeNull();
    expect(ctx.storage.objects.has(key)).toBe(false);
  });
});
