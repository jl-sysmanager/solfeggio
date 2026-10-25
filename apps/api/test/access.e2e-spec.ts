import { addUser, auth, Band, createTestApp, resetDb, signupBand, TestCtx } from './helpers';

describe('Revisión de accesos', () => {
  let ctx: TestCtx;
  let band: Band;
  let admin: string;
  let musician: string;
  let treasurer: string;
  let archivist: string;
  let billingRoleId: string;
  const api = (path: string) => `/api/v1${path}`;
  const get = (path: string, token: string) => ctx.http().get(api(path)).set(auth(token));
  const post = (path: string, token: string, body: object = {}) => ctx.http().post(api(path)).set(auth(token)).send(body);
  const patch = (path: string, token: string, body: object) => ctx.http().patch(api(path)).set(auth(token)).send(body);

  const roleId = async (key: string) => (await get('/roles', band.token).expect(200)).body.find((r: { key: string }) => r.key === key).id as string;
  const membershipOf = async (email: string) => (await get('/users', band.token).expect(200)).body.find((u: { user: { email: string } }) => u.user.email === email).id as string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.db);
    band = await signupBand(ctx, 'access-band');
    admin = await addUser(ctx, band, 'admin', 'admin@access.local');
    musician = await addUser(ctx, band, 'musician', 'musico@access.local');
    treasurer = await addUser(ctx, band, 'treasurer', 'tesorero@access.local');
    archivist = await addUser(ctx, band, 'archivist', 'archivero@access.local');
    await ctx.db.system.user.update({ where: { id: band.userId }, data: { isPlatformAdmin: true } });
    await post('/admin/roles', band.token, { key: 'facturacion', name: 'Facturación', permissions: ['billing:manage', 'events:read'] }).expect(201);
    billingRoleId = await roleId('facturacion');
  });
  afterAll(() => ctx.app.close());

  describe('sin escalada de privilegios', () => {
    it('la banda no puede crear ni editar roles', async () => {
      const adminRole = await roleId('admin');
      expect((await patch(`/roles/${adminRole}`, admin, { permissions: ['users:manage'] }).expect(403)).body.code).toBe('ROLES_PLATFORM_ONLY');
      expect((await post('/roles', band.token, { name: 'Lectores', permissions: ['archive:read'] }).expect(403)).body.code).toBe('ROLES_PLATFORM_ONLY');
    });

    it('sólo un propietario asigna el rol de propietario o toca a otros propietarios', async () => {
      const owner = await roleId('owner');
      const adminMembership = await membershipOf('admin@access.local');
      const musicianMembership = await membershipOf('musico@access.local');
      const ownerMembership = await membershipOf(band.email);

      expect((await patch(`/users/${musicianMembership}`, admin, { roleId: owner }).expect(403)).body.code).toBe('OWNER_ONLY');
      expect((await patch(`/users/${ownerMembership}`, admin, { status: 'SUSPENDED' }).expect(403)).body.code).toBe('OWNER_ONLY');
      await ctx.http().delete(api(`/users/${ownerMembership}`)).set(auth(admin)).expect(403);
      expect((await patch(`/users/${adminMembership}`, admin, { roleId: owner }).expect(400)).body.code).toBe('SELF_CHANGE');
      expect((await post('/invitations', admin, { email: 'nuevo@access.local', roleId: owner }).expect(400)).body.code).toBe('FORBIDDEN');
    });

    it('no se puede asignar ni invitar a un rol con permisos por encima de los propios', async () => {
      const musicianMembership = await membershipOf('musico@access.local');
      expect((await patch(`/users/${musicianMembership}`, admin, { roleId: billingRoleId }).expect(403)).body.code).toBe('PERMISSION_CEILING');
      expect((await post('/invitations', admin, { email: 'otro@access.local', roleId: billingRoleId }).expect(403)).body.code).toBe('PERMISSION_CEILING');
      // El propietario sí puede.
      await patch(`/users/${musicianMembership}`, band.token, { roleId: billingRoleId }).expect(200);
      await patch(`/users/${musicianMembership}`, band.token, { roleId: await roleId('musician') }).expect(200);
    });

    it('los roles asignables respetan el techo de quien los pide', async () => {
      const asAdmin = (await get('/roles/assignable', admin).expect(200)).body.map((r: { key: string }) => r.key);
      expect(asAdmin).toEqual(expect.arrayContaining(['musician', 'teacher', 'archivist']));
      expect(asAdmin).not.toContain('owner');
      expect(asAdmin).not.toContain('facturacion');
      const asOwner = (await get('/roles/assignable', band.token).expect(200)).body.map((r: { key: string }) => r.key);
      expect(asOwner).toEqual(expect.arrayContaining(['owner', 'facturacion']));
      await get('/roles/assignable', musician).expect(403);
    });
  });

  describe('panel de inicio', () => {
    it('cada rol sólo recibe los indicadores de sus módulos', async () => {
      const m = (await get('/dashboard', musician).expect(200)).body;
      expect(m).toMatchObject({ members: null, pendingCharges: null, storage: null, users: null });
      expect(Array.isArray(m.nextEvents)).toBe(true);

      const t = (await get('/dashboard', treasurer).expect(200)).body;
      expect(t.members).not.toBeNull();
      expect(t.pendingCharges).not.toBeNull();
      expect(t.storage).toBeNull();

      const o = (await get('/dashboard', band.token).expect(200)).body;
      expect(o.members).not.toBeNull();
      expect(o.storage).not.toBeNull();
      expect(o.users).not.toBeNull();
    });
  });

  describe('archivero', () => {
    it('cuida el archivo musical y nada más', async () => {
      await post('/works', archivist, { title: 'Pasodoble del archivero' }).expect(201);
      await get('/members', archivist).expect(403);
      await get('/finance/transactions', archivist).expect(403);
      await get('/school/students', archivist).expect(403);
    });
  });
});
