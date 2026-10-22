import { TokensService } from '../src/auth/tokens.service';
import { auth, Band, createTestApp, resetDb, signupBand, TestCtx } from './helpers';

describe('Avisos a las bandas', () => {
  let ctx: TestCtx;
  let admin: Band;
  let pro: Band;
  let free: Band;
  const http = () => ctx.http();
  const A = '/api/v1/admin/announcements';
  const active = async (b: Band) => (await http().get('/api/v1/announcements/active').set(auth(b.token)).expect(200)).body as { id: string; title: string }[];
  const titles = async (b: Band) => (await active(b)).map((a) => a.title).sort();
  const mk = (body: object) => http().post(A).set(auth(admin.token)).send({ body: 'Texto del aviso', ...body });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.db);
    admin = await signupBand(ctx, 'ann-admin');
    pro = await signupBand(ctx, 'ann-pro', 'PRO');
    free = await signupBand(ctx, 'ann-free', 'FREE');
    await ctx.db.system.user.update({ where: { email: admin.email }, data: { isPlatformAdmin: true } });
  });
  afterAll(() => ctx.app.close());

  it('la administración exige administrador de plataforma', async () => {
    await http().get(A).set(auth(pro.token)).expect(403);
    await http().post(A).set(auth(pro.token)).send({ title: 'x y z', body: 'abc' }).expect(403);
    await http().post(`${A}/preview`).set(auth(pro.token)).send({ segment: {} }).expect(403);
    await http().get('/api/v1/announcements/active').expect(401);
  });

  it('valida enlace y fechas', async () => {
    await mk({ title: 'Mal enlace', link: 'javascript:alert(1)' }).expect(400);
    await mk({ title: 'Fechas', startsAt: '2030-01-02T00:00:00Z', endsAt: '2030-01-01T00:00:00Z' }).expect(400);
    await mk({ title: 'Región', segment: { regions: ['Narnia'] } }).expect(400);
  });

  it('segmenta por plan, comunidad, módulos y bandas concretas', async () => {
    await mk({ title: 'Para todos' }).expect(201);
    await mk({ title: 'Sólo PRO', segment: { plans: ['PRO'] } }).expect(201);
    await mk({ title: 'Sólo valencianas', segment: { regions: ['Comunitat Valenciana'] } }).expect(201);
    await mk({ title: 'Con escuela', segment: { features: ['school'] } }).expect(201);
    await mk({ title: 'Sólo FREE concreta', segment: { tenantIds: [free.tenantId] } }).expect(201);
    expect(await titles(pro)).toEqual(['Con escuela', 'Para todos', 'Sólo PRO']);
    expect(await titles(free)).toEqual(['Para todos', 'Sólo FREE concreta']);

    // La banda indica su comunidad en Ajustes.
    await http().patch('/api/v1/tenant').set(auth(pro.token)).send({ region: 'Narnia' }).expect(400);
    const t = await http().patch('/api/v1/tenant').set(auth(pro.token)).send({ region: 'Comunitat Valenciana' }).expect(200);
    expect(t.body.region).toBe('Comunitat Valenciana');
    expect((await http().get('/api/v1/tenant').set(auth(pro.token)).expect(200)).body.region).toBe('Comunitat Valenciana');
    expect(await titles(pro)).toEqual(['Con escuela', 'Para todos', 'Sólo PRO', 'Sólo valencianas']);

    // Add-ons sólo cuentan con pago (bonificación o suscripción viva).
    await ctx.db.system.tenant.update({
      where: { id: free.tenantId },
      data: { addons: ['school'], complimentaryUntil: new Date(Date.now() + 86_400_000) },
    });
    expect(await titles(free)).toEqual(['Con escuela', 'Para todos', 'Sólo FREE concreta']);
  });

  it('la vista previa cuenta bandas y usuarios alcanzados', async () => {
    const all = (await http().post(`${A}/preview`).set(auth(admin.token)).send({ segment: {} }).expect(200)).body;
    expect(all.tenants).toBe(3);
    expect(all.users).toBe(3);
    const pro_ = (await http().post(`${A}/preview`).set(auth(admin.token)).send({ segment: { plans: ['PRO'], regions: ['Comunitat Valenciana'] } }).expect(200)).body;
    expect(pro_).toEqual({ tenants: 1, users: 1 });
    const list = (await http().get(A).set(auth(admin.token)).expect(200)).body;
    expect(list.find((a: any) => a.title === 'Sólo PRO')).toMatchObject({ state: 'active', reach: { tenants: 2 } });
  });

  it('respeta la ventana de fechas y permite finalizar', async () => {
    const future = (await mk({ title: 'Futuro', startsAt: new Date(Date.now() + 86_400_000).toISOString() }).expect(201)).body;
    const past = (await mk({ title: 'Pasado', startsAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), endsAt: new Date(Date.now() - 86_400_000).toISOString() }).expect(201)).body;
    expect(await titles(pro)).not.toContain('Futuro');
    expect(await titles(pro)).not.toContain('Pasado');
    const states = (await http().get(A).set(auth(admin.token)).expect(200)).body;
    expect(states.find((a: any) => a.id === future.id).state).toBe('scheduled');
    expect(states.find((a: any) => a.id === past.id).state).toBe('ended');
    const live = (await active(pro)).find((a) => a.title === 'Sólo PRO')!;
    await http().post(`${A}/${live.id}/end`).set(auth(admin.token)).expect(200);
    expect(await titles(pro)).not.toContain('Sólo PRO');
  });

  it('descartar sólo vale para el usuario y si el aviso lo permite', async () => {
    const dis = (await active(pro)).find((a) => a.title === 'Para todos')!;
    await http().post(`/api/v1/announcements/${dis.id}/dismiss`).set(auth(pro.token)).expect(204);
    await http().post(`/api/v1/announcements/${dis.id}/dismiss`).set(auth(pro.token)).expect(204);
    expect(await titles(pro)).not.toContain('Para todos');
    expect(await titles(free)).toContain('Para todos');
    const fixed = (await mk({ title: 'Fijo', dismissible: false }).expect(201)).body;
    await http().post(`/api/v1/announcements/${fixed.id}/dismiss`).set(auth(pro.token)).expect(400);
    expect(await titles(pro)).toContain('Fijo');
  });

  it('el mantenimiento llega a todos, ignora el segmento y llega al panel global sin banda', async () => {
    await mk({ title: 'Mantenimiento', level: 'MAINTENANCE', segment: { plans: ['ENTERPRISE'] }, dismissible: false }).expect(201);
    expect(await titles(pro)).toContain('Mantenimiento');
    expect(await titles(free)).toContain('Mantenimiento');
    // Administrador sin banda activa: sólo ve el mantenimiento.
    const bare = await ctx.app.get(TokensService).accessToken(admin.userId, null);
    const r = await http().get('/api/v1/announcements/active').set(auth(bare)).expect(200);
    expect(r.body.map((a: any) => a.title)).toEqual(['Mantenimiento']);
  });
});
