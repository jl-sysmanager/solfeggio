import { authenticator } from 'otplib';
import { addUser, auth, createTestApp, PASSWORD, resetDb, signupBand, TestCtx } from './helpers';

const cookieOf = (res: { headers: Record<string, unknown> }) =>
  ((res.headers['set-cookie'] as string[]) ?? []).find((c) => c.startsWith('sf_rt='))!.split(';')[0];

describe('Autenticación', () => {
  let ctx: TestCtx;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.db);
  });
  afterAll(() => ctx.app.close());

  it('rechaza contraseñas débiles y emails duplicados', async () => {
    await ctx.http().post('/api/v1/auth/register').send({ email: 'debil@test.local', password: 'corta', name: 'Débil' }).expect(400);
    await ctx.http().post('/api/v1/auth/register').send({ email: 'dup@test.local', password: PASSWORD, name: 'Dup' }).expect(201);
    const dup = await ctx.http().post('/api/v1/auth/register').send({ email: 'DUP@test.local', password: PASSWORD, name: 'Dup' }).expect(409);
    expect(dup.body.code).toBe('EMAIL_TAKEN');
  });

  it('la contraseña se guarda con argon2id', async () => {
    const u = await ctx.db.system.user.findUniqueOrThrow({ where: { email: 'dup@test.local' } });
    expect(u.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('el refresh token es httpOnly, rota y detecta reutilización', async () => {
    const login = await ctx.http().post('/api/v1/auth/login').send({ email: 'dup@test.local', password: PASSWORD }).expect(200);
    const raw = (login.headers['set-cookie'] as unknown as string[])[0];
    expect(raw).toMatch(/HttpOnly/);
    expect(raw).toMatch(/SameSite=Strict/);
    expect(raw).toMatch(/Path=\/api\/v1\/auth/);

    const first = cookieOf(login);
    const r1 = await ctx.http().post('/api/v1/auth/refresh').set('Cookie', first).expect(200);
    const second = cookieOf(r1);
    expect(second).not.toBe(first);

    // Reutilizar el token ya rotado revoca toda la familia, incluido el nuevo.
    const reuse = await ctx.http().post('/api/v1/auth/refresh').set('Cookie', first).expect(401);
    expect(reuse.body.code).toBe('REFRESH_REUSED');
    await ctx.http().post('/api/v1/auth/refresh').set('Cookie', second).expect(401);
  });

  it('logout revoca el refresh token', async () => {
    const login = await ctx.http().post('/api/v1/auth/login').send({ email: 'dup@test.local', password: PASSWORD }).expect(200);
    const cookie = cookieOf(login);
    await ctx.http().post('/api/v1/auth/logout').set('Cookie', cookie).expect(204);
    await ctx.http().post('/api/v1/auth/refresh').set('Cookie', cookie).expect(401);
  });

  it('bloquea la cuenta tras 5 intentos fallidos', async () => {
    await ctx.http().post('/api/v1/auth/register').send({ email: 'lock@test.local', password: PASSWORD, name: 'Lock' }).expect(201);
    for (let i = 0; i < 5; i++) {
      await ctx.http().post('/api/v1/auth/login').send({ email: 'lock@test.local', password: 'incorrecta-123' }).expect(401);
    }
    const res = await ctx.http().post('/api/v1/auth/login').send({ email: 'lock@test.local', password: PASSWORD }).expect(401);
    expect(res.body.code).toBe('ACCOUNT_LOCKED');
  });

  it('no revela si el email existe', async () => {
    const a = await ctx.http().post('/api/v1/auth/login').send({ email: 'noexiste@test.local', password: 'x' }).expect(401);
    const b = await ctx.http().post('/api/v1/auth/login').send({ email: 'dup@test.local', password: 'x' }).expect(401);
    expect(a.body.code).toBe(b.body.code);
    expect(a.body.message).toBe(b.body.message);
  });

  it('MFA TOTP: activación y login en dos pasos', async () => {
    const band = await signupBand(ctx, 'mfa-band');
    const setup = await ctx.http().post('/api/v1/auth/mfa/setup').set(auth(band.token)).expect(201);
    expect(setup.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    const secret = new URL(setup.body.otpauthUrl).searchParams.get('secret')!;
    await ctx.http().post('/api/v1/auth/mfa/enable').set(auth(band.token)).send({ code: '000000' }).expect(400);
    await ctx.http().post('/api/v1/auth/mfa/enable').set(auth(band.token)).send({ code: authenticator.generate(secret) }).expect(204);

    const user = await ctx.db.system.user.findUniqueOrThrow({ where: { email: band.email } });
    expect(user.mfaSecretEnc).toMatch(/^v1:/);

    const step1 = await ctx.http().post('/api/v1/auth/login').send({ email: band.email, password: PASSWORD }).expect(401);
    expect(step1.body.code).toBe('MFA_REQUIRED');
    const bad = await ctx.http().post('/api/v1/auth/login').send({ email: band.email, password: PASSWORD, mfaCode: '123456' }).expect(401);
    expect(bad.body.code).toBe('MFA_INVALID');
    const ok = await ctx.http().post('/api/v1/auth/login').send({ email: band.email, password: PASSWORD, mfaCode: authenticator.generate(secret) }).expect(200);
    expect(ok.body.session.tenant.slug).toBe('mfa-band');
  });

  it('invitación: crea usuario, membresía con el rol y caduca tras usarse', async () => {
    const band = await signupBand(ctx, 'inv-band');
    const roles = await ctx.http().get('/api/v1/roles').set(auth(band.token)).expect(200);
    const musician = roles.body.find((r: { key: string }) => r.key === 'musician');
    await ctx.http().post('/api/v1/invitations').set(auth(band.token)).send({ email: 'nuevo@test.local', roleId: musician.id }).expect(201);
    const mail = ctx.jobs.of('email.send').find((j) => j.data.to === 'nuevo@test.local')!;
    const token = /invite\/([\w-]+)/.exec(mail.data.text)![1];

    const accepted = await ctx.http().post('/api/v1/auth/invitations/accept').send({ token, name: 'Nuevo Músico', password: PASSWORD }).expect(200);
    expect(accepted.body.session.role.key).toBe('musician');
    expect(accepted.body.session.permissions).not.toContain('members:write');
    await ctx.http().post('/api/v1/auth/invitations/accept').send({ token, name: 'Otra', password: PASSWORD }).expect(400);
  });

  it('invitación con createMember deja socio vinculado al aceptar', async () => {
    const band = await signupBand(ctx, 'inv-socio');
    const roles = await ctx.http().get('/api/v1/roles').set(auth(band.token)).expect(200);
    const musician = roles.body.find((r: { key: string }) => r.key === 'musician');
    const inv = await ctx
      .http()
      .post('/api/v1/invitations')
      .set(auth(band.token))
      .send({ email: 'socio-nuevo@test.local', roleId: musician.id, createMember: { firstName: 'Sara', lastName: 'Nueva' } })
      .expect(201);
    expect(inv.body.memberId).toBeTruthy();
    const mail = ctx.jobs.of('email.send').find((j) => j.data.to === 'socio-nuevo@test.local')!;
    const token = /invite\/([\w-]+)/.exec(mail.data.text)![1];
    const accepted = await ctx
      .http()
      .post('/api/v1/auth/invitations/accept')
      .send({ token, name: 'Sara Nueva', password: PASSWORD })
      .expect(200);
    expect(accepted.body.session.memberId).toBe(inv.body.memberId);
  });

  it('una cuenta existente acepta la invitación en el panel y puede cambiar de banda', async () => {
    const home = await signupBand(ctx, 'inv-home');
    const host = await signupBand(ctx, 'inv-host');
    const roles = await ctx.http().get('/api/v1/roles').set(auth(host.token)).expect(200);
    const musician = roles.body.find((r: { key: string }) => r.key === 'musician');
    const created = await ctx.http().post('/api/v1/invitations').set(auth(host.token)).send({ email: home.email, roleId: musician.id }).expect(201);
    const mail = ctx.jobs.of('email.send').filter((j) => j.data.to === home.email).at(-1)!;
    expect(mail.data.text).not.toContain('/invite/');
    expect(mail.data.text).toContain('/login');

    const notes = await ctx.http().get('/api/v1/notifications').set(auth(home.token)).expect(200);
    const invite = notes.body.find((n: { type: string; id: string }) => n.type === 'invitation');
    expect(invite.id).toBe(created.body.id);

    await ctx.http().post('/api/v1/auth/invitations/pending/accept').set(auth(host.token)).send({ id: invite.id }).expect(400);
    const accepted = await ctx.http().post('/api/v1/auth/invitations/pending/accept').set(auth(home.token)).send({ id: invite.id }).expect(200);
    expect(accepted.body.session.tenant.slug).toBe('inv-host');
    expect(accepted.body.session.memberships).toHaveLength(2);
    expect(accepted.body.session.role.key).toBe('musician');

    const back = await ctx.http().post('/api/v1/auth/switch-tenant').set(auth(accepted.body.accessToken)).send({ tenantId: home.tenantId }).expect(200);
    expect(back.body.session.tenant.slug).toBe('inv-home');
    expect(back.body.session.memberships).toHaveLength(2);
    const gone = (await ctx.http().get('/api/v1/notifications').set(auth(back.body.accessToken)).expect(200)).body.find(
      (n: { type: string }) => n.type === 'invitation',
    );
    expect(gone).toBeUndefined();
  });

  it('switch-tenant entre bandas del mismo usuario', async () => {
    const one = await signupBand(ctx, 'multi-uno');
    const two = await ctx.http().post('/api/v1/onboarding').set(auth(one.token)).send({ bandName: 'Multi Dos', slug: 'multi-dos' }).expect(201);
    const login = await ctx.http().post('/api/v1/auth/login').send({ email: one.email, password: PASSWORD }).expect(200);
    expect(login.body.memberships).toHaveLength(2);
    expect(login.body.session.tenant).toBeNull();
    await ctx.http().get('/api/v1/members').set(auth(login.body.accessToken)).expect(403);
    const sw = await ctx.http().post('/api/v1/auth/switch-tenant').set(auth(login.body.accessToken)).send({ tenantId: two.body.session.tenant.id }).expect(200);
    expect(sw.body.session.tenant.slug).toBe('multi-dos');
  });

  it('cambia la contraseña, rechaza la anterior y cierra las otras sesiones', async () => {
    const email = 'pwd@test.local';
    const next = 'Otra-clave-234';
    await ctx.http().post('/api/v1/auth/register').send({ email, password: PASSWORD, name: 'Pwd' }).expect(201);
    const login = await ctx.http().post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200);
    const cookie = cookieOf(login);
    await ctx.http().post('/api/v1/auth/password/change').send({ currentPassword: PASSWORD, newPassword: next }).expect(401);
    await ctx.http().post('/api/v1/auth/password/change').set(auth(login.body.accessToken)).send({ currentPassword: 'mal-123456', newPassword: next }).expect(400);
    await ctx.http().post('/api/v1/auth/password/change').set(auth(login.body.accessToken)).send({ currentPassword: PASSWORD, newPassword: 'corta' }).expect(400);
    await ctx.http().post('/api/v1/auth/password/change').set(auth(login.body.accessToken)).send({ currentPassword: PASSWORD, newPassword: PASSWORD }).expect(400);
    const changed = await ctx.http().post('/api/v1/auth/password/change').set(auth(login.body.accessToken)).send({ currentPassword: PASSWORD, newPassword: next }).expect(204);
    expect(cookieOf(changed)).toMatch(/sf_rt=/);
    await ctx.http().post('/api/v1/auth/refresh').set('Cookie', cookie).expect(401);
    await ctx.http().post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(401);
    await ctx.http().post('/api/v1/auth/login').send({ email, password: next }).expect(200);
  });

  it('recupera la contraseña sin revelar si el email existe y el enlace es de un solo uso', async () => {
    const email = 'pwd@test.local';
    const unknown = await ctx.http().post('/api/v1/auth/password/forgot').send({ email: 'nadie@test.local' }).expect(200);
    const known = await ctx.http().post('/api/v1/auth/password/forgot').send({ email }).expect(200);
    expect(unknown.body).toEqual({ accepted: true });
    expect(known.body).toEqual(unknown.body);
    expect(ctx.jobs.of('email.send').some((j) => j.data.to === 'nadie@test.local')).toBe(false);

    const first = ctx.jobs.of('email.send').filter((j) => j.data.to === email).at(-1)!;
    const stale = /reset-password\/([\w-]+)/.exec(first.data.text)![1];
    await ctx.http().post('/api/v1/auth/password/forgot').send({ email }).expect(200);
    await ctx.http().post('/api/v1/auth/password/reset').send({ token: stale, password: 'Tercera-clave-5' }).expect(400);

    const latest = ctx.jobs.of('email.send').filter((j) => j.data.to === email).at(-1)!;
    const token = /reset-password\/([\w-]+)/.exec(latest.data.text)![1];
    expect(token).not.toBe(stale);
    await ctx.http().post('/api/v1/auth/password/reset').send({ token: 'x'.repeat(24), password: 'Tercera-clave-5' }).expect(400);
    await ctx.http().post('/api/v1/auth/password/reset').send({ token, password: 'Tercera-clave-5' }).expect(204);
    await ctx.http().post('/api/v1/auth/password/reset').send({ token, password: 'Tercera-clave-6' }).expect(400);
    await ctx.http().post('/api/v1/auth/login').send({ email, password: 'Otra-clave-234' }).expect(401);
    await ctx.http().post('/api/v1/auth/login').send({ email, password: 'Tercera-clave-5' }).expect(200);
  });

  it('el slug de banda es único y no admite reservados', async () => {
    const band = await signupBand(ctx, 'slug-band');
    await ctx.http().post('/api/v1/onboarding').set(auth(band.token)).send({ bandName: 'Banda X', slug: 'slug-band' }).expect(409);
    await ctx.http().post('/api/v1/onboarding').set(auth(band.token)).send({ bandName: 'Banda X', slug: 'admin' }).expect(409);
    await ctx.http().post('/api/v1/onboarding').set(auth(band.token)).send({ bandName: 'Banda X', slug: 'Mal Slug!' }).expect(400);
  });

  it('actualiza el perfil y bloquea salir/cerrar si eres el único propietario', async () => {
    const band = await signupBand(ctx, 'perfil-band');
    const me = await ctx.http().get('/api/v1/auth/profile').set(auth(band.token)).expect(200);
    expect(me.body.user.email).toBe(band.email);
    const renamed = await ctx.http().patch('/api/v1/auth/profile').set(auth(band.token)).send({ name: 'Nombre Nuevo' }).expect(200);
    expect(renamed.body.user.name).toBe('Nombre Nuevo');

    const leave = await ctx.http().post('/api/v1/auth/leave-tenant').set(auth(band.token)).send({ password: PASSWORD }).expect(400);
    expect(leave.body.code).toBe('LAST_OWNER');
    const close = await ctx
      .http()
      .post('/api/v1/auth/close-account')
      .set(auth(band.token))
      .send({ password: PASSWORD, confirm: 'ELIMINAR' })
      .expect(400);
    expect(close.body.code).toBe('LAST_OWNER');
  });

  it('permite salir de una banda cuando hay otra y cerrar una cuenta sin bandas', async () => {
    const one = await signupBand(ctx, 'leave-a');
    const two = await ctx.http().post('/api/v1/onboarding').set(auth(one.token)).send({ bandName: 'Leave B', slug: 'leave-b' }).expect(201);
    await addUser(ctx, { ...one, tenantId: two.body.session.tenant.id }, 'owner', 'leave-b-owner@test.local');
    const left = await ctx
      .http()
      .post('/api/v1/auth/leave-tenant')
      .set(auth(two.body.accessToken))
      .send({ password: PASSWORD, tenantId: two.body.session.tenant.id })
      .expect(200);
    expect(left.body.session.memberships).toHaveLength(1);
    expect(left.body.session.memberships[0].slug).toBe('leave-a');

    const email = 'cerrar@test.local';
    await ctx.http().post('/api/v1/auth/register').send({ email, password: PASSWORD, name: 'Cerrar' }).expect(201);
    const login = await ctx.http().post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200);
    await ctx.http().post('/api/v1/auth/close-account').set(auth(login.body.accessToken)).send({ password: PASSWORD, confirm: 'BORRAR' }).expect(400);
    await ctx.http().post('/api/v1/auth/close-account').set(auth(login.body.accessToken)).send({ password: PASSWORD, confirm: 'ELIMINAR' }).expect(204);
    await ctx.http().post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(401);
  });

  it('crear una banda exige confirmar el email y el enlace es de un solo uso', async () => {
    const email = 'verificar@test.local';
    await ctx.http().post('/api/v1/auth/register').send({ email, password: PASSWORD, name: 'Vera' }).expect(201);
    const login = await ctx.http().post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200);
    expect(login.body.session.user.emailVerified).toBe(false);
    const denied = await ctx.http().post('/api/v1/onboarding').set(auth(login.body.accessToken)).send({ bandName: 'Sin verificar', slug: 'sin-verificar' }).expect(403);
    expect(denied.body.code).toBe('EMAIL_NOT_VERIFIED');

    const first = ctx.jobs.of('email.send').filter((j) => j.data.to === email).at(-1)!;
    const stale = /verify-email\/([\w-]+)/.exec(first.data.text)![1];
    await ctx.http().post('/api/v1/auth/email/send').set(auth(login.body.accessToken)).expect(200);
    await ctx.http().post('/api/v1/auth/email/verify').send({ token: stale }).expect(400);
    await ctx.http().post('/api/v1/auth/email/verify').send({ token: 'x'.repeat(24) }).expect(400);

    const latest = ctx.jobs.of('email.send').filter((j) => j.data.to === email).at(-1)!;
    const token = /verify-email\/([\w-]+)/.exec(latest.data.text)![1];
    expect(token).not.toBe(stale);
    expect((await ctx.http().post('/api/v1/auth/email/verify').send({ token }).expect(200)).body).toEqual({ verified: true });
    await ctx.http().post('/api/v1/auth/email/verify').send({ token }).expect(400);
    expect((await ctx.http().post('/api/v1/auth/email/send').set(auth(login.body.accessToken)).expect(200)).body).toEqual({ verified: true, sent: false });

    const created = await ctx.http().post('/api/v1/onboarding').set(auth(login.body.accessToken)).send({ bandName: 'Ya verificada', slug: 'ya-verificada' }).expect(201);
    expect(created.body.session.user.emailVerified).toBe(true);
  });
});
