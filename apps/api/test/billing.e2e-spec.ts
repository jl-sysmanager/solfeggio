import { auth, Band, createTestApp, resetDb, signupBand, TestCtx } from './helpers';

/** Simula el webhook de Stripe: firma verificada por el doble `FakeStripe` ('valid'). */
const webhook = (ctx: TestCtx, event: object, signature = 'valid') =>
  ctx.http().post('/api/v1/webhooks/stripe').set('stripe-signature', signature).set('Content-Type', 'application/json').send(JSON.stringify(event));

describe('Facturación con Stripe', () => {
  let ctx: TestCtx;
  let band: Band;
  const subId = 'sub_test_1';
  const customer = () => `cus_${band.tenantId.slice(0, 8)}`;
  const subscription = (status: string, price = 'price_pro_m', extra: object = {}) => ({
    id: subId, customer: customer(), status, metadata: { tenantId: band.tenantId }, cancel_at_period_end: false,
    current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400, trial_end: null,
    items: { data: [{ price: { id: price, recurring: { interval: 'month' } } }] }, ...extra,
  });
  const tenant = () => ctx.db.system.tenant.findUniqueOrThrow({ where: { id: band.tenantId }, include: { plan: true, subscription: true } });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.db);
    await ctx.db.system.plan.update({ where: { code: 'PRO' }, data: { stripePriceMonthly: 'price_pro_m', stripePriceYearly: 'price_pro_y' } });
    await ctx.db.system.plan.update({ where: { code: 'BASIC' }, data: { stripePriceMonthly: 'price_basic_m' } });
    band = await signupBand(ctx, 'billing-band', 'FREE');
  });
  afterAll(() => ctx.app.close());

  it('checkout crea cliente y sesión con prueba gratuita, cupones e impuestos', async () => {
    const res = await ctx.http().post('/api/v1/billing/checkout').set(auth(band.token)).send({ planCode: 'PRO', interval: 'MONTH' }).expect(200);
    expect(res.body.url).toContain('checkout.stripe.test');
    const call = ctx.stripe.calls.find((c) => c.method === 'checkout.create')!.args;
    expect(call).toMatchObject({
      mode: 'subscription', customer: customer(), client_reference_id: band.tenantId,
      line_items: [{ price: 'price_pro_m', quantity: 1 }], allow_promotion_codes: true,
      automatic_tax: { enabled: true }, tax_id_collection: { enabled: true },
      subscription_data: { trial_period_days: 14, metadata: { tenantId: band.tenantId, planCode: 'PRO' } },
    });
  });

  it('rechaza firmas no válidas', async () => {
    const res = await webhook(ctx, { id: 'evt_x', type: 'invoice.paid', data: { object: {} } }, 'forged').expect(400);
    expect(res.body.code).toBe('SIGNATURE_INVALID');
  });

  it('checkout.session.completed activa el plan (prueba gratuita)', async () => {
    ctx.stripe.subscriptions.set(subId, subscription('trialing', 'price_pro_m', { trial_end: Math.floor(Date.now() / 1000) + 14 * 86400 }));
    await webhook(ctx, { id: 'evt_1', type: 'checkout.session.completed', data: { object: { client_reference_id: band.tenantId, customer: customer(), subscription: subId, metadata: {} } } }).expect(200);
    const t = await tenant();
    expect(t.plan.code).toBe('PRO');
    expect(t.status).toBe('TRIALING');
    expect(t.subscription).toMatchObject({ stripeSubscriptionId: subId, stripeStatus: 'trialing', interval: 'MONTH' });
    expect(t.subscription!.trialEndsAt).not.toBeNull();
  });

  it('los webhooks son idempotentes', async () => {
    const res = await webhook(ctx, { id: 'evt_1', type: 'checkout.session.completed', data: { object: { client_reference_id: band.tenantId, customer: customer(), subscription: subId } } }).expect(200);
    expect(res.body.result).toBe('duplicate');
    expect(await ctx.db.system.stripeEvent.count({ where: { id: 'evt_1' } })).toBe(1);
  });

  it('un pago fallido abre el periodo de gracia y avisa', async () => {
    ctx.stripe.subscriptions.set(subId, subscription('past_due'));
    const invoice = { id: 'in_1', customer: customer(), number: 'SF-0001', status: 'open', currency: 'eur', subtotal: 2400, tax: 504, total: 2904, amount_paid: 0, next_payment_attempt: Math.floor(Date.now() / 1000) + 3 * 86400 };
    await webhook(ctx, { id: 'evt_2', type: 'invoice.payment_failed', data: { object: invoice } }).expect(200);
    await webhook(ctx, { id: 'evt_3', type: 'customer.subscription.updated', data: { object: { id: subId } } }).expect(200);
    const t = await tenant();
    expect(t.status).toBe('PAST_DUE');
    expect(t.subscription!.graceUntil!.getTime()).toBeGreaterThan(Date.now() + 6 * 86400_000);
    const inv = await ctx.db.system.invoice.findUniqueOrThrow({ where: { stripeInvoiceId: 'in_1' } });
    expect(inv).toMatchObject({ totalCents: 2904, taxCents: 504, number: 'SF-0001' });
    expect(ctx.jobs.of('notify.fanout').some((j) => j.data.type === 'billing' && j.data.tenantId === band.tenantId)).toBe(true);
    // Durante la gracia se puede seguir trabajando.
    await ctx.http().post('/api/v1/members').set(auth(band.token)).send({ firstName: 'Sigue', lastName: 'Activo' }).expect(201);
  });

  it('vencida la gracia la banda pasa a sólo lectura y al pagar se reactiva', async () => {
    const billing = ctx.app.get((await import('../src/billing/billing.service')).BillingService);
    expect(await billing.sweepGracePeriods(new Date(Date.now() + 8 * 86400_000))).toBe(1);
    expect((await tenant()).status).toBe('READ_ONLY');
    const blocked = await ctx.http().post('/api/v1/members').set(auth(band.token)).send({ firstName: 'X', lastName: 'Y' }).expect(403);
    expect(blocked.body.code).toBe('TENANT_READ_ONLY');

    ctx.stripe.subscriptions.set(subId, subscription('active'));
    await webhook(ctx, { id: 'evt_4', type: 'invoice.paid', data: { object: { id: 'in_1', customer: customer(), status: 'paid', currency: 'eur', subtotal: 2400, tax: 504, total: 2904, amount_paid: 2904 } } }).expect(200);
    const t = await tenant();
    expect(t.status).toBe('ACTIVE');
    expect(t.subscription!.graceUntil).toBeNull();
  });

  it('el cambio de plan desde el portal se sincroniza', async () => {
    ctx.stripe.subscriptions.set(subId, subscription('active', 'price_basic_m'));
    await webhook(ctx, { id: 'evt_5', type: 'customer.subscription.updated', data: { object: { id: subId } } }).expect(200);
    expect((await tenant()).plan.code).toBe('BASIC');
  });

  it('la cancelación al final del periodo se refleja y al terminar vuelve a Free sin perder datos', async () => {
    ctx.stripe.subscriptions.set(subId, subscription('active', 'price_basic_m', { cancel_at_period_end: true }));
    await webhook(ctx, { id: 'evt_6', type: 'customer.subscription.updated', data: { object: { id: subId } } }).expect(200);
    expect((await tenant()).subscription!.cancelAtPeriodEnd).toBe(true);

    ctx.stripe.subscriptions.set(subId, subscription('canceled', 'price_basic_m'));
    await webhook(ctx, { id: 'evt_7', type: 'customer.subscription.deleted', data: { object: { id: subId } } }).expect(200);
    const t = await tenant();
    expect(t.plan.code).toBe('FREE');
    expect(t.status).toBe('ACTIVE');
    expect(t.subscription!.stripeSubscriptionId).toBeNull();
    const members = await ctx.http().get('/api/v1/members').set(auth(band.token)).expect(200);
    expect(members.body.total).toBe(1);
  });

  it('checkout publica el precio en Stripe si el plan todavía no lo tiene', async () => {
    await ctx.db.system.plan.update({ where: { code: 'ENTERPRISE' }, data: { stripePriceMonthly: null, stripePriceYearly: null } });
    const res = await ctx.http().post('/api/v1/billing/checkout').set(auth(band.token)).send({ planCode: 'ENTERPRISE', interval: 'MONTH' }).expect(200);
    const plan = await ctx.db.system.plan.findUniqueOrThrow({ where: { code: 'ENTERPRISE' } });
    expect(plan.stripePriceMonthly).toBe('price_ENTERPRISE_month');
    expect(plan.stripePriceYearly).toBe('price_ENTERPRISE_year');
    expect(res.body.url).toContain('checkout.stripe.test');
    const call = ctx.stripe.calls.find((c) => c.method === 'checkout.create' && c.args.metadata?.planCode === 'ENTERPRISE')!.args;
    expect(call.line_items).toEqual([{ price: 'price_ENTERPRISE_month', quantity: 1 }]);
  });

  it('una nueva suscripción tras cancelar no repite la prueba gratuita', async () => {
    ctx.stripe.calls.length = 0;
    await ctx.http().post('/api/v1/billing/checkout').set(auth(band.token)).send({ planCode: 'PRO', interval: 'MONTH' }).expect(200);
    const call = ctx.stripe.calls.find((c) => c.method === 'checkout.create')!.args;
    expect(call.subscription_data.trial_period_days).toBeUndefined();
  });

  it('un error de procesamiento devuelve 500 para que Stripe reintente', async () => {
    ctx.stripe.subscriptions.delete(subId);
    await webhook(ctx, { id: 'evt_8', type: 'customer.subscription.updated', data: { object: { id: subId } } }).expect(500);
    const ev = await ctx.db.system.stripeEvent.findUniqueOrThrow({ where: { id: 'evt_8' } });
    expect(ev.processedAt).toBeNull();
    expect(ev.error).toBeTruthy();
    // El reintento se procesa (no se trata como duplicado).
    ctx.stripe.subscriptions.set(subId, subscription('active', 'price_pro_m'));
    const retry = await webhook(ctx, { id: 'evt_8', type: 'customer.subscription.updated', data: { object: { id: subId } } }).expect(200);
    expect(retry.body.result).toBe('processed');
  });

  it('el resumen de facturación muestra plan, uso y facturas', async () => {
    const res = await ctx.http().get('/api/v1/billing').set(auth(band.token)).expect(200);
    expect(res.body.invoices).toHaveLength(1);
    expect(res.body.usage).toMatchObject({ users: 1, members: 1 });
  });
});
