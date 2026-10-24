import { auth, createTestApp, resetDb, signupBand, TestCtx } from './helpers';

describe('guía de puesta en marcha', () => {
  let ctx: TestCtx;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.db);
  });
  afterAll(() => ctx.app.close());

  it('el propietario ve los pasos pendientes y puede ocultar la guía al entrar', async () => {
    const band = await signupBand(ctx, 'guia', 'FREE');
    const res = await ctx.http().get('/api/v1/setup-guide').set(auth(band.token)).expect(200);
    expect(res.body.dismissed).toBe(false);
    const byId = Object.fromEntries(res.body.steps.map((s: { id: string; done: boolean }) => [s.id, s.done]));
    expect(byId).toMatchObject({ band: false, roster: false, access: false, rehearsal: false, security: false });

    await ctx.http().patch('/api/v1/tenant').set(auth(band.token)).send({ legalName: 'Asociación Musical Guía' }).expect(200);
    const progressed = await ctx.http().get('/api/v1/setup-guide').set(auth(band.token)).expect(200);
    expect(progressed.body.steps.find((s: { id: string }) => s.id === 'band').done).toBe(true);

    const hidden = await ctx.http().patch('/api/v1/setup-guide').set(auth(band.token)).send({ dismissed: true }).expect(200);
    expect(hidden.body.dismissed).toBe(true);
    const again = await ctx.http().get('/api/v1/setup-guide').set(auth(band.token)).expect(200);
    expect(again.body.dismissed).toBe(true);
  });
});
