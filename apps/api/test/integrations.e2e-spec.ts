import { Prisma } from '@prisma/client';
import { decrypt } from '../src/common/crypto';
import { IntegrationsService } from '../src/integrations/integrations.service';
import { Mailer } from '../src/integrations/mailer.service';
import { auth, Band, createTestApp, resetDb, signupBand, TestCtx } from './helpers';

const STRIPE_KEY = 'sk_test_51AbCdEfGhIjKlMnOpQrStUvWx9876';
const WEBHOOK = 'whsec_AbCdEfGhIjKlMnOp1234';
const SENDGRID = 'SG.abcdefghijklmnop.qrstuvwxyz0123456789';

describe('Integraciones de terceros (panel global)', () => {
  let ctx: TestCtx;
  let admin: Band;
  let owner: Band;
  let fetchSpy: jest.SpyInstance;

  beforeAll(async () => {
    ctx = await createTestApp({ realStripe: true });
    await resetDb(ctx.db);
    admin = await signupBand(ctx, 'plataforma');
    await ctx.db.system.user.update({ where: { email: admin.email }, data: { isPlatformAdmin: true } });
    owner = await signupBand(ctx, 'cliente', 'FREE');
  });

  beforeEach(() => {
    ctx.app.get(IntegrationsService).invalidate();
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 202 }));
  });
  afterEach(() => fetchSpy.mockRestore());
  afterAll(() => ctx.app.close());

  const put = (category: string, body: object) => ctx.http().put(`/api/v1/admin/integrations/${category}`).set(auth(admin.token)).send(body);
  const list = async () => (await ctx.http().get('/api/v1/admin/integrations').set(auth(admin.token)).expect(200)).body as any[];

  it('sólo los administradores de plataforma acceden', async () => {
    await ctx.http().get('/api/v1/admin/integrations').set(auth(owner.token)).expect(403);
    await ctx.http().put('/api/v1/admin/integrations/email').set(auth(owner.token)).send({ provider: 'smtp', enabled: false }).expect(403);
  });

  it('lista categorías y proveedores; sin fila en BD hereda de variables de entorno', async () => {
    const cats = await list();
    expect(cats.map((c) => c.id)).toEqual(['payments', 'email']);
    expect(cats[1].providers.map((p: { id: string }) => p.id)).toEqual(['smtp', 'sendgrid', 'mailgun', 'resend', 'postmark']);
    expect(cats[0].current).toMatchObject({ source: 'none', enabled: false });
    expect(cats[1].current).toMatchObject({ source: 'env', provider: 'smtp', enabled: true });
  });

  it('valida formato, obligatorios y proveedor', async () => {
    const bad = await put('payments', { provider: 'stripe', enabled: true, secrets: { secretKey: 'pk_live_nope', webhookSecret: WEBHOOK } }).expect(400);
    expect(bad.body.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'secrets.secretKey' })]));
    const missing = await put('payments', { provider: 'stripe', enabled: true, secrets: { secretKey: STRIPE_KEY } }).expect(400);
    expect(missing.body.details).toEqual([{ path: 'secrets.webhookSecret', message: 'Obligatorio para habilitar' }]);
    await put('payments', { provider: 'paypal', enabled: false }).expect(400);
    await put('nope', { provider: 'x', enabled: false }).expect(400);
    const inj = await put('email', { provider: 'sendgrid', enabled: true, config: { fromAddress: 'a@b.es', fromName: 'X\r\nBcc: evil@x.com' }, secrets: { apiKey: SENDGRID } }).expect(400);
    expect(inj.body.details[0].path).toBe('config.fromName');
  });

  it('guarda cifrado, nunca devuelve secretos y muestra sólo una pista', async () => {
    const res = await put('payments', { provider: 'stripe', enabled: true, config: { taxEnabled: false, unknown: 'ignored' }, secrets: { secretKey: STRIPE_KEY, webhookSecret: WEBHOOK } }).expect(200);
    expect(JSON.stringify(res.body)).not.toContain(STRIPE_KEY);
    expect(JSON.stringify(res.body)).not.toContain(WEBHOOK);
    expect(res.body.current).toMatchObject({
      source: 'database', provider: 'stripe', enabled: true, config: { taxEnabled: false },
      secrets: { secretKey: { set: true, hint: '9876' }, webhookSecret: { set: true, hint: '1234' } },
    });
    expect(res.body.current.config).not.toHaveProperty('unknown');
    expect(res.body.current.updatedBy.email).toBe(admin.email);

    const row = await ctx.db.system.integrationSetting.findUniqueOrThrow({ where: { category: 'payments' } });
    expect(row.secretsEnc).toMatch(/^v1:/);
    expect(row.secretsEnc).not.toContain('sk_test');
    expect(JSON.parse(decrypt(row.secretsEnc, 'integration:payments')!)).toEqual({ secretKey: STRIPE_KEY, webhookSecret: WEBHOOK });
    // El cifrado está ligado a la categoría: no puede reutilizarse en otra fila.
    expect(() => decrypt(row.secretsEnc, 'integration:email')).toThrow();
  });

  it('el rol de aplicación no puede leer la configuración', async () => {
    await expect(ctx.db.app.$queryRaw(Prisma.sql`SELECT * FROM integration_settings`)).rejects.toThrow(/permission denied/);
  });

  it('un secreto vacío se conserva y null lo borra', async () => {
    await put('payments', { provider: 'stripe', enabled: true, config: { taxEnabled: true }, secrets: { secretKey: '' } }).expect(200);
    let cfg = await ctx.app.get(IntegrationsService).get('payments');
    expect(cfg.secrets).toEqual({ secretKey: STRIPE_KEY, webhookSecret: WEBHOOK });

    await put('payments', { provider: 'stripe', enabled: true, secrets: { webhookSecret: null } }).expect(400);
    await put('payments', { provider: 'stripe', enabled: false, secrets: { webhookSecret: null } }).expect(200);
    cfg = await ctx.app.get(IntegrationsService).get('payments');
    expect(cfg.secrets).toEqual({ secretKey: STRIPE_KEY });
    await put('payments', { provider: 'stripe', enabled: true, secrets: { webhookSecret: WEBHOOK } }).expect(200);
  });

  it('la auditoría registra los cambios sin valores secretos', async () => {
    const res = await ctx.http().get('/api/v1/admin/audit-logs?entity=integration').set(auth(admin.token)).expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0]).toMatchObject({ action: 'integration.updated', entityId: 'payments', actor: { email: admin.email } });
    expect(JSON.stringify(res.body)).not.toContain(STRIPE_KEY);
    expect(JSON.stringify(res.body)).not.toContain(WEBHOOK);
    expect(res.body.data.some((l: { metadata: { secretsChanged?: string[] } }) => l.metadata?.secretsChanged?.includes('webhookSecret'))).toBe(true);
  });

  describe('pagos deshabilitados', () => {
    it('la facturación responde 503 y la UI recibe billingEnabled=false', async () => {
      await put('payments', { provider: 'stripe', enabled: false }).expect(200);
      const res = await ctx.http().post('/api/v1/billing/checkout').set(auth(owner.token)).send({ planCode: 'PRO', interval: 'MONTH' }).expect(503);
      expect(res.body.code).toBe('BILLING_DISABLED');
      await ctx.http().post('/api/v1/billing/portal').set(auth(owner.token)).expect(503);
      const billing = await ctx.http().get('/api/v1/billing').set(auth(owner.token)).expect(200);
      expect(billing.body.billingEnabled).toBe(false);
      // Webhooks: 503 para que Stripe los reintente cuando se reactive.
      await ctx.http().post('/api/v1/webhooks/stripe').set('stripe-signature', 't=1,v1=x').set('Content-Type', 'application/json').send('{}').expect(503);
    });

    it('al habilitarse se aplica sin reiniciar', async () => {
      await put('payments', { provider: 'stripe', enabled: true }).expect(200);
      const billing = await ctx.http().get('/api/v1/billing').set(auth(owner.token)).expect(200);
      expect(billing.body.billingEnabled).toBe(true);
      // Firma inválida ya no es 503 sino 400: la integración está activa.
      await ctx.http().post('/api/v1/webhooks/stripe').set('stripe-signature', 't=1,v1=x').set('Content-Type', 'application/json').send('{}').expect(400);
    });
  });

  describe('correo', () => {
    it('envía con SendGrid usando la configuración de la BD', async () => {
      await put('email', { provider: 'sendgrid', enabled: true, config: { fromAddress: 'avisos@solfeggio.es', fromName: 'Solfeamos', replyTo: 'soporte@solfeggio.es' }, secrets: { apiKey: SENDGRID } }).expect(200);
      const result = await ctx.app.get(Mailer).send({ to: 'socio@banda.es', subject: 'Convocatoria', text: 'Hola' });
      expect(result).toEqual({ sent: true, provider: 'sendgrid' });
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.sendgrid.com/v3/mail/send');
      expect(init.headers.Authorization).toBe(`Bearer ${SENDGRID}`);
      expect(JSON.parse(init.body)).toMatchObject({
        personalizations: [{ to: [{ email: 'socio@banda.es' }] }],
        from: { email: 'avisos@solfeggio.es', name: 'Solfeamos' },
        reply_to: { email: 'soporte@solfeggio.es' },
        subject: 'Convocatoria',
      });
    });

    it('cambiar de proveedor descarta los secretos del anterior', async () => {
      await put('email', { provider: 'mailgun', enabled: true, config: { fromAddress: 'avisos@solfeggio.es', domain: 'mg.solfeggio.es', region: 'eu' }, secrets: { apiKey: 'key-0123456789abcdef' } }).expect(200);
      await ctx.app.get(Mailer).send({ to: 'socio@banda.es', subject: 'Hola', text: 'x' });
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.eu.mailgun.net/v3/mg.solfeggio.es/messages');
      expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('api:key-0123456789abcdef').toString('base64')}`);
      const row = await ctx.db.system.integrationSetting.findUniqueOrThrow({ where: { category: 'email' } });
      expect(Object.keys(JSON.parse(decrypt(row.secretsEnc, 'integration:email')!))).toEqual(['apiKey']);
    });

    it('los campos de configuración omitidos se conservan y null los borra', async () => {
      await put('email', { provider: 'mailgun', enabled: true, config: { replyTo: 'soporte@solfeggio.es' } }).expect(200);
      let cfg = await ctx.app.get(IntegrationsService).get('email');
      expect(cfg.config).toMatchObject({ fromAddress: 'avisos@solfeggio.es', domain: 'mg.solfeggio.es', replyTo: 'soporte@solfeggio.es' });
      await put('email', { provider: 'mailgun', enabled: true, config: { replyTo: null } }).expect(200);
      ctx.app.get(IntegrationsService).invalidate();
      cfg = await ctx.app.get(IntegrationsService).get('email');
      expect(cfg.config).not.toHaveProperty('replyTo');
      await put('email', { provider: 'mailgun', enabled: true, config: { domain: null } }).expect(400);
    });

    it('deshabilitado no envía nada', async () => {
      await put('email', { provider: 'mailgun', enabled: false }).expect(200);
      const result = await ctx.app.get(Mailer).send({ to: 'socio@banda.es', subject: 'Hola', text: 'x' });
      expect(result).toEqual({ sent: false, reason: 'disabled' });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('la prueba de conexión funciona aunque esté deshabilitado y no filtra secretos en errores', async () => {
      const ok = await ctx.http().post('/api/v1/admin/integrations/email/test').set(auth(admin.token)).send({ to: 'yo@solfeggio.es' }).expect(200);
      expect(ok.body).toEqual({ ok: true, message: 'Correo de prueba enviado a yo@solfeggio.es con mailgun' });
      fetchSpy.mockResolvedValueOnce(new Response('{"message":"Forbidden key-0123456789abcdef"}', { status: 401 }));
      const fail = await ctx.http().post('/api/v1/admin/integrations/email/test').set(auth(admin.token)).send({}).expect(200);
      expect(fail.body.ok).toBe(false);
      expect(fail.body.message).toContain('401');
      expect(fail.body.message).not.toContain('key-0123');
    });

    it('un error del proveedor lanza para que la cola reintente', async () => {
      await put('email', { provider: 'mailgun', enabled: true }).expect(200);
      fetchSpy.mockResolvedValueOnce(new Response('', { status: 500 }));
      await expect(ctx.app.get(Mailer).send({ to: 'a@b.es', subject: 'x', text: 'x' })).rejects.toThrow(/mailgun respondió 500/);
    });

    it('restablecer vuelve a las variables de entorno', async () => {
      const res = await ctx.http().delete('/api/v1/admin/integrations/email').set(auth(admin.token)).expect(200);
      expect(res.body.current).toMatchObject({ source: 'env', provider: 'smtp' });
    });
  });
});
