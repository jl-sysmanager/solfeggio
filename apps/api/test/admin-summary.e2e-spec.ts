import { auth, Band, createTestApp, resetDb, signupBand, TestCtx } from './helpers';

describe('Resumen del menú del panel global', () => {
  let ctx: TestCtx;
  let band: Band;
  let admin: Band;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.db);
    band = await signupBand(ctx, 'summary-band');
    admin = await signupBand(ctx, 'summary-admin');
    await ctx.db.system.user.update({ where: { email: admin.email }, data: { isPlatformAdmin: true } });
  });
  afterAll(() => ctx.app.close());

  it('sólo lo ve el equipo de plataforma', async () => {
    await ctx.http().get('/api/v1/admin/summary').set(auth(band.token)).expect(403);
  });

  it('cuenta incidencias abiertas, vencidas y elementos por moderar', async () => {
    const empty = await ctx.http().get('/api/v1/admin/summary').set(auth(admin.token)).expect(200);
    expect(empty.body).toEqual({ support: { open: 0, overdue: 0 }, moderation: { pending: 0 } });

    await ctx.http().post('/api/v1/incidents').set(auth(band.token)).send({ subject: 'Fallo en recibos', body: 'No se generan', priority: 2 }).expect(201);
    const incident = await ctx.db.system.incident.findFirstOrThrow();
    await ctx.db.system.incident.update({ where: { id: incident.id }, data: { slaDueAt: new Date(Date.now() - 3_600_000) } });
    await ctx.db.system.reinforcementReport.create({
      data: { reporterTenantId: band.tenantId, reporterUserId: band.userId, reason: 'Anuncio sospechoso' },
    });

    const res = await ctx.http().get('/api/v1/admin/summary').set(auth(admin.token)).expect(200);
    expect(res.body).toEqual({ support: { open: 1, overdue: 1 }, moderation: { pending: 1 } });

    // Con la primera respuesta registrada deja de estar vencida, aunque siga abierta.
    await ctx.db.system.incident.update({ where: { id: incident.id }, data: { firstResponseAt: new Date() } });
    const answered = await ctx.http().get('/api/v1/admin/summary').set(auth(admin.token)).expect(200);
    expect(answered.body.support).toEqual({ open: 1, overdue: 0 });
  });
});
