import { addonMrrCents } from '../src/billing/addons';
import { BillingOpsService } from '../src/billing/billing-ops.service';
import { BillingService } from '../src/billing/billing.service';
import { auth, Band, createTestApp, resetDb, signupBand, TestCtx } from './helpers';

const DAY = 86_400_000;
const webhook = (ctx: TestCtx, event: object) =>
  ctx.http().post('/api/v1/webhooks/stripe').set('stripe-signature', 'valid').set('Content-Type', 'application/json').send(JSON.stringify(event));

describe('Operación de facturación (panel global)', () => {
  let ctx: TestCtx;
  let admin: Band;
  let band: Band;
  const subId = 'sub_ops_1';
  const customer = () => `cus_${band.tenantId.slice(0, 8)}`;
  const base = '/api/v1/admin/billing';
  const items = (...extra: any[]) => ({ data: [{ id: 'si_plan', price: { id: 'price_pro_m', recurring: { interval: 'month' } }, quantity: 1, metadata: {} }, ...extra] });
  const subscription = (status: string, extra: object = {}) => ({
    id: subId, customer: customer(), status, metadata: { tenantId: band.tenantId }, cancel_at_period_end: false,
    current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400, trial_end: null, items: items(), ...extra,
  });
  const tenant = () => ctx.db.system.tenant.findUniqueOrThrow({ where: { id: band.tenantId }, include: { plan: true, subscription: true } });
  const post = (path: string, body: object = {}, token = admin.token) => ctx.http().post(`${base}${path}`).set(auth(token)).send(body);
  const call = (method: string) => ctx.stripe.calls.filter((c) => c.method === method);
  const seat = (q: number) => ({ id: 'si_seat', price: { id: 'price_seat', recurring: { interval: 'month' } }, quantity: q, metadata: { solfeggio: 'school_seats' } });

  beforeAll(async () => {
    process.env.STRIPE_PRICE_SCHOOL_ADDON = 'price_addon';
    process.env.STRIPE_PRICE_SCHOOL_SEAT = 'price_seat';
    ctx = await createTestApp();
    await resetDb(ctx.db);
    await ctx.db.system.plan.update({ where: { code: 'PRO' }, data: { stripePriceMonthly: 'price_pro_m' } });
    await ctx.db.system.plan.update({ where: { code: 'BASIC' }, data: { stripePriceMonthly: 'price_basic_m' } });
    admin = await signupBand(ctx, 'plataforma-ops');
    await ctx.db.system.user.update({ where: { email: admin.email }, data: { isPlatformAdmin: true } });
    band = await signupBand(ctx, 'ops-band', 'PRO');
    await ctx.db.system.subscription.upsert({
      where: { tenantId: band.tenantId },
      create: { tenantId: band.tenantId, stripeCustomerId: customer(), stripeSubscriptionId: subId, stripeStatus: 'active' },
      update: { stripeCustomerId: customer(), stripeSubscriptionId: subId, stripeStatus: 'active' },
    });
    ctx.stripe.subscriptions.set(subId, subscription('active'));
  });
  afterAll(() => ctx.app.close());

  it('sólo los administradores de plataforma acceden a todas las rutas', async () => {
    const t = band.token;
    const id = band.tenantId;
    await ctx.http().get(`${base}/dunning`).set(auth(t)).expect(403);
    await ctx.http().get(`${base}/coupons`).set(auth(t)).expect(403);
    await ctx.http().post(`${base}/coupons`).set(auth(t)).send({}).expect(403);
    await ctx.http().delete(`${base}/coupons/co_1`).set(auth(t)).expect(403);
    await ctx.http().get(`${base}/addons`).set(auth(t)).expect(403);
    await ctx.http().get(`${base}/webhooks`).set(auth(t)).expect(403);
    await ctx.http().get(`${base}/tenants/${id}`).set(auth(t)).expect(403);
    await ctx.http().delete(`${base}/tenants/${id}/complimentary`).set(auth(t)).expect(403);
    for (const a of ['retry', 'remind', 'read-only', 'grace', 'coupon', 'credit', 'free-months', 'extend-trial', 'complimentary', 'sync-addons']) {
      await ctx.http().post(`${base}/tenants/${id}/${a}`).set(auth(t)).send({}).expect(403);
    }
    await ctx.http().post(`${base}/webhooks/evt_1/replay`).set(auth(t)).expect(403);
  });

  describe('pagos fallidos', () => {
    beforeAll(async () => {
      ctx.stripe.subscriptions.set(subId, subscription('past_due'));
      const inv = { id: 'in_fail', customer: customer(), number: 'SF-9', status: 'open', currency: 'eur', subtotal: 2400, tax: 504, total: 2904, amount_paid: 0, next_payment_attempt: null };
      ctx.stripe.openInvoices = [inv];
      await webhook(ctx, { id: 'evt_f1', type: 'invoice.payment_failed', data: { object: inv } }).expect(200);
      await webhook(ctx, { id: 'evt_f2', type: 'customer.subscription.updated', data: { object: { id: subId } } }).expect(200);
    });

    it('lista la cola de impagos con importe, gracia y propietario', async () => {
      const res = await ctx.http().get(`${base}/dunning`).set(auth(admin.token)).expect(200);
      const row = res.body.find((r: any) => r.tenant.id === band.tenantId);
      expect(row).toMatchObject({ amountDueCents: 2904, openInvoices: 1, plan: { code: 'PRO' }, tenant: { status: 'PAST_DUE' } });
      expect(row.lastFailedInvoice.number).toBe('SF-9');
      expect(row.graceUntil).toBeTruthy();
      expect(row.owners[0].email).toBe(band.email);
    });

    it('recordatorio, ampliación de gracia y sólo lectura quedan auditados', async () => {
      ctx.jobs.added.length = 0;
      await post(`/tenants/${band.tenantId}/remind`).expect(200);
      expect(ctx.jobs.of('notify.fanout').some((j) => j.data.tenantId === band.tenantId && j.data.email)).toBe(true);

      const before = (await tenant()).subscription!.graceUntil!;
      const g = await post(`/tenants/${band.tenantId}/grace`, { days: 5 }).expect(200);
      expect(new Date(g.body.graceUntil).getTime()).toBeGreaterThan(before.getTime() + 4 * DAY);
      await post(`/tenants/${band.tenantId}/grace`, { days: 0 }).expect(400);

      await post(`/tenants/${band.tenantId}/read-only`).expect(200);
      expect((await tenant()).status).toBe('READ_ONLY');
      const logs = await ctx.db.system.auditLog.findMany({ where: { tenantId: band.tenantId, action: { startsWith: 'platform.billing.' } } });
      expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(['platform.billing.reminded', 'platform.billing.grace_extended', 'platform.billing.read_only']));
    });

    it('un reintento fallido se registra y uno correcto cierra la gracia', async () => {
      ctx.stripe.payError = 'Your card was declined';
      const bad = await post(`/tenants/${band.tenantId}/retry`).expect(200);
      expect(bad.body).toMatchObject({ ok: false, message: 'Your card was declined' });
      expect((await tenant()).status).toBe('READ_ONLY');

      ctx.stripe.payError = null;
      const ok = await post(`/tenants/${band.tenantId}/retry`).expect(200);
      expect(ok.body).toMatchObject({ ok: true, invoiceId: 'in_fail' });
      expect(call('invoices.pay')).toHaveLength(2);
      const t = await tenant();
      expect(t.status).toBe('ACTIVE');
      expect(t.subscription!.graceUntil).toBeNull();
      expect((await ctx.db.system.invoice.findUniqueOrThrow({ where: { stripeInvoiceId: 'in_fail' } })).status).toBe('paid');
      ctx.stripe.openInvoices = [];
      await post(`/tenants/${band.tenantId}/retry`).expect(400);
    });
  });

  describe('cupones y bonificaciones', () => {
    beforeAll(() => ctx.stripe.subscriptions.set(subId, subscription('active')));

    it('crea, lista y borra cupones con código promocional', async () => {
      await post('/coupons', { name: 'Sin tipo', duration: 'once' }).expect(400);
      await post('/coupons', { name: 'Repeat', percentOff: 20, duration: 'repeating' }).expect(400);
      const c = await post('/coupons', { name: 'Otoño 20', percentOff: 20, duration: 'repeating', durationInMonths: 3, maxRedemptions: 10, promotionCode: 'otono20' }).expect(201);
      expect(c.body.promotionCode).toBe('OTONO20');
      expect(call('coupons.create')[0].args).toMatchObject({ percent_off: 20, duration: 'repeating', duration_in_months: 3, max_redemptions: 10 });
      const list = await ctx.http().get(`${base}/coupons`).set(auth(admin.token)).expect(200);
      expect(list.body[0]).toMatchObject({ id: c.body.id, percentOff: 20, promotionCodes: [{ code: 'OTONO20' }] });
      await ctx.http().delete(`${base}/coupons/${c.body.id}`).set(auth(admin.token)).expect(200);
      expect((await ctx.http().get(`${base}/coupons`).set(auth(admin.token))).body).toHaveLength(0);
    });

    it('aplica cupón, crédito y meses gratis a la suscripción', async () => {
      const c = await post('/coupons', { name: 'Importe', amountOffCents: 500, duration: 'once' }).expect(201);
      await post(`/tenants/${band.tenantId}/coupon`, { couponId: c.body.id }).expect(200);
      expect(call('subscriptions.update').at(-1)!.args).toMatchObject({ id: subId, discounts: [{ coupon: c.body.id }] });

      await post(`/tenants/${band.tenantId}/credit`, { amountCents: 1500, description: 'Compensación' }).expect(200);
      expect(call('customers.createBalanceTransaction')[0].args).toMatchObject({ customer: customer(), amount: -1500, currency: 'eur' });
      await post(`/tenants/${band.tenantId}/credit`, { amountCents: 0, description: 'x' }).expect(400);

      await post(`/tenants/${band.tenantId}/free-months`, { months: 2 }).expect(200);
      expect(call('coupons.create').at(-1)!.args).toMatchObject({ percent_off: 100, duration: 'repeating', duration_in_months: 2 });
    });

    it('amplía la prueba sólo si está en prueba', async () => {
      await post(`/tenants/${band.tenantId}/extend-trial`, { days: 7 }).expect(400);
      const end = Math.floor(Date.now() / 1000) + 3 * 86400;
      ctx.stripe.subscriptions.set(subId, subscription('trialing', { trial_end: end }));
      const r = await post(`/tenants/${band.tenantId}/extend-trial`, { days: 7 }).expect(200);
      expect(new Date(r.body.trialEndsAt).getTime() / 1000).toBeCloseTo(end + 7 * 86400, -1);
      expect((await tenant()).status).toBe('TRIALING');
      ctx.stripe.subscriptions.set(subId, subscription('active'));
      await webhook(ctx, { id: 'evt_rs', type: 'customer.subscription.updated', data: { object: { id: subId } } }).expect(200);
    });

    it('la cuenta bonificada no la degradan ni Stripe ni el barrido de gracia', async () => {
      const until = new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10);
      await post(`/tenants/${band.tenantId}/complimentary`, { until: '2020-01-01', reason: 'x', planCode: 'PRO' }).expect(400);
      const r = await post(`/tenants/${band.tenantId}/complimentary`, { until, reason: 'Banda benéfica', planCode: 'BASIC' }).expect(200);
      expect(r.body.warning).toBeTruthy();
      let t = await tenant();
      expect(t).toMatchObject({ status: 'ACTIVE', complimentaryReason: 'Banda benéfica' });
      expect(t.plan.code).toBe('BASIC');

      // Webhook de impago + gracia vencida: nada cambia.
      ctx.stripe.subscriptions.set(subId, subscription('past_due'));
      await webhook(ctx, { id: 'evt_c1', type: 'invoice.payment_failed', data: { object: { id: 'in_c', customer: customer(), status: 'open', currency: 'eur', subtotal: 1, tax: 0, total: 1, amount_paid: 0 } } }).expect(200);
      await webhook(ctx, { id: 'evt_c2', type: 'customer.subscription.updated', data: { object: { id: subId } } }).expect(200);
      await ctx.db.system.subscription.update({ where: { tenantId: band.tenantId }, data: { graceUntil: new Date(Date.now() - DAY) } });
      await ctx.app.get(BillingService).sweepGracePeriods();
      t = await tenant();
      expect(t.status).toBe('ACTIVE');
      expect(t.plan.code).toBe('BASIC');
      await post(`/tenants/${band.tenantId}/read-only`).expect(400);
    });

    it('avisa 7 días antes y al vencer vuelve a Free (o a Stripe si hay suscripción activa)', async () => {
      const ops = ctx.app.get(BillingOpsService);
      await ctx.db.system.tenant.update({ where: { id: band.tenantId }, data: { complimentaryUntil: new Date(Date.now() + 6.5 * DAY) } });
      ctx.jobs.added.length = 0;
      expect(await ops.complimentarySweep()).toMatchObject({ reminded: 1, expired: 0 });
      expect(ctx.jobs.of('notify.fanout').some((j) => j.data.title.includes('bonificada'))).toBe(true);

      // Con suscripción activa en Stripe manda Stripe (plan PRO).
      ctx.stripe.subscriptions.set(subId, subscription('active'));
      await ctx.db.system.subscription.update({ where: { tenantId: band.tenantId }, data: { stripeStatus: 'active' } });
      await ctx.db.system.tenant.update({ where: { id: band.tenantId }, data: { complimentaryUntil: new Date(Date.now() - 1000) } });
      expect(await ops.complimentarySweep()).toMatchObject({ expired: 1 });
      let t = await tenant();
      expect(t.complimentaryUntil).toBeNull();
      expect(t.plan.code).toBe('PRO');

      // Sin suscripción de Stripe: Free.
      await ctx.db.system.subscription.update({ where: { tenantId: band.tenantId }, data: { stripeSubscriptionId: null, stripeStatus: 'canceled' } });
      await post(`/tenants/${band.tenantId}/complimentary`, { until: new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10), reason: 'Piloto', planCode: 'PRO' }).expect(200);
      await ctx.http().delete(`${base}/tenants/${band.tenantId}/complimentary`).set(auth(admin.token)).expect(200);
      t = await tenant();
      expect(t).toMatchObject({ complimentaryUntil: null, status: 'ACTIVE' });
      expect(t.plan.code).toBe('FREE');
      const actions = (await ctx.db.system.auditLog.findMany({ where: { tenantId: band.tenantId, action: { startsWith: 'platform.billing.complimentary' } } })).map((l) => l.action);
      expect(actions).toEqual(expect.arrayContaining(['platform.billing.complimentary_set', 'platform.billing.complimentary_cleared', 'platform.billing.complimentary_expired']));
    });
  });

  describe('add-on Escuela', () => {
    beforeAll(async () => {
      await ctx.db.system.plan.update({ where: { code: 'BASIC' }, data: { stripePriceMonthly: 'price_basic_m' } });
      const basic = await ctx.db.system.plan.findUniqueOrThrow({ where: { code: 'BASIC' } });
      await ctx.db.system.tenant.update({ where: { id: band.tenantId }, data: { planId: basic.id, status: 'ACTIVE', addons: ['school'], studentSeats: 20 } });
      await ctx.db.system.subscription.update({ where: { tenantId: band.tenantId }, data: { stripeSubscriptionId: subId, stripeStatus: 'active' } });
      ctx.stripe.subscriptions.set(subId, { ...subscription('active'), items: { data: [{ id: 'si_plan', price: { id: 'price_basic_m', recurring: { interval: 'month' } }, quantity: 1, metadata: {} }] } });
    });

    it('añade, actualiza y retira los conceptos de forma idempotente', async () => {
      const first = await post(`/tenants/${band.tenantId}/sync-addons`).expect(200);
      expect(first.body).toMatchObject({ status: 'synced', changes: ['school_addon:add:1', 'school_seats:add:20'] });
      expect(call('subscriptionItems.create').map((c) => c.args)).toEqual([
        expect.objectContaining({ price: 'price_addon', quantity: 1, proration_behavior: 'create_prorations' }),
        expect.objectContaining({ price: 'price_seat', quantity: 20, proration_behavior: 'create_prorations' }),
      ]);
      expect((await post(`/tenants/${band.tenantId}/sync-addons`).expect(200)).body.status).toBe('unchanged');
      expect(call('subscriptionItems.create')).toHaveLength(2);

      await ctx.db.system.tenant.update({ where: { id: band.tenantId }, data: { studentSeats: 35 } });
      expect((await ctx.app.get(BillingOpsService).syncAddons(band.tenantId)).changes).toEqual(['school_seats:update:35']);

      await ctx.db.system.tenant.update({ where: { id: band.tenantId }, data: { addons: [], studentSeats: 0 } });
      expect((await ctx.app.get(BillingOpsService).syncAddons(band.tenantId)).changes).toEqual(['school_addon:remove', 'school_seats:remove']);
      expect(ctx.stripe.subscriptions.get(subId).items.data).toHaveLength(1);
    });

    it('el webhook mantiene el plan aunque haya conceptos del add-on y reconcile los sincroniza', async () => {
      ctx.stripe.subscriptions.set(subId, { ...subscription('active'), items: { data: [seat(10), { id: 'si_plan', price: { id: 'price_basic_m', recurring: { interval: 'month' } }, quantity: 1, metadata: {} }] } });
      await webhook(ctx, { id: 'evt_ad1', type: 'customer.subscription.updated', data: { object: { id: subId } } }).expect(200);
      expect((await tenant()).plan.code).toBe('BASIC');

      await ctx.db.system.tenant.update({ where: { id: band.tenantId }, data: { studentSeats: 12 } });
      const r = await ctx.app.get(BillingOpsService).reconcileAddons();
      expect(r.addons.synced).toBe(1);
      expect(ctx.stripe.subscriptions.get(subId).items.data.find((i: any) => i.id === 'si_seat').quantity).toBe(12);
    });

    it('un plan que incluye la escuela no cobra la cuota fija; sin precio el error queda registrado', async () => {
      const pro = await ctx.db.system.plan.findUniqueOrThrow({ where: { code: 'PRO' } });
      await ctx.db.system.tenant.update({ where: { id: band.tenantId }, data: { planId: pro.id, addons: ['school'], studentSeats: 0 } });
      ctx.stripe.subscriptions.set(subId, { ...subscription('active'), items: items() });
      expect((await ctx.app.get(BillingOpsService).syncAddons(band.tenantId)).status).toBe('unchanged');

      delete process.env.STRIPE_PRICE_SCHOOL_SEAT;
      await ctx.db.system.tenant.update({ where: { id: band.tenantId }, data: { studentSeats: 5 } });
      const bad = await post(`/tenants/${band.tenantId}/sync-addons`).expect(200);
      expect(bad.body.status).toBe('error');
      process.env.STRIPE_PRICE_SCHOOL_SEAT = 'price_seat';

      const ov = await ctx.http().get(`${base}/addons`).set(auth(admin.token)).expect(200);
      expect(ov.body.tenants.find((t: any) => t.tenant.id === band.tenantId)).toMatchObject({ studentSeats: 5, lastSync: { status: 'error' } });
    });

    it('el checkout incluye los conceptos del add-on y el resumen de la banda los muestra', async () => {
      const free = await ctx.db.system.plan.findUniqueOrThrow({ where: { code: 'FREE' } });
      await ctx.db.system.tenant.update({ where: { id: band.tenantId }, data: { planId: free.id, addons: ['school'], studentSeats: 8 } });
      await ctx.db.system.subscription.update({ where: { tenantId: band.tenantId }, data: { stripeSubscriptionId: null, stripeStatus: 'canceled' } });
      await ctx.db.system.plan.update({ where: { code: 'BASIC' }, data: { stripePriceMonthly: 'price_basic_m' } });
      ctx.stripe.calls.length = 0;
      await ctx.http().post('/api/v1/billing/checkout').set(auth(band.token)).send({ planCode: 'BASIC', interval: 'MONTH' }).expect(200);
      expect(call('checkout.create')[0].args.line_items).toEqual([
        { price: 'price_basic_m', quantity: 1 },
        { price: 'price_addon', quantity: 1 },
        { price: 'price_seat', quantity: 8 },
      ]);
      const ov = await ctx.http().get('/api/v1/billing').set(auth(band.token)).expect(200);
      expect(ov.body.addons.map((l: any) => [l.key, l.quantity])).toEqual([['school_addon', 1], ['school_seats', 8]]);
      expect(ov.body.addons[0].priceId).toBeUndefined();
    });

    it('addonMrrCents suma cuota y plazas, y es 0 si el plan ya incluye la escuela', () => {
      const prices = { addonCents: 1500, seatCents: 100 };
      expect(addonMrrCents({ addons: ['school'], studentSeats: 20, plan: { features: [] } }, prices)).toBe(3500);
      expect(addonMrrCents({ addons: ['school'], studentSeats: 20, plan: { features: ['school'] } }, prices)).toBe(2000);
      expect(addonMrrCents({ addons: [], studentSeats: 0, plan: { features: [] } }, prices)).toBe(0);
      expect(addonMrrCents({ addons: ['school'], studentSeats: 3, plan: { features: [] } }, { addonCents: 0, seatCents: 0 })).toBe(0);
    });
  });

  describe('webhooks', () => {
    it('lista con filtros y vuelve a procesar un evento', async () => {
      await ctx.db.system.stripeEvent.create({ data: { id: 'evt_bad', type: 'customer.subscription.updated', error: 'boom' } });
      await ctx.db.system.stripeEvent.create({ data: { id: 'evt_wait', type: 'invoice.paid' } });
      const failed = await ctx.http().get(`${base}/webhooks`).query({ status: 'failed' }).set(auth(admin.token)).expect(200);
      expect(failed.body.data.map((e: any) => e.id)).toEqual(['evt_bad']);
      const pending = await ctx.http().get(`${base}/webhooks`).query({ status: 'pending', type: 'invoice.paid' }).set(auth(admin.token)).expect(200);
      expect(pending.body.data.map((e: any) => e.id)).toEqual(['evt_wait']);
      const processed = await ctx.http().get(`${base}/webhooks`).query({ status: 'processed' }).set(auth(admin.token)).expect(200);
      expect(processed.body.data.length).toBeGreaterThan(0);
      expect(processed.body.types).toContain('invoice.paid');

      await post('/webhooks/evt_bad/replay').expect(500);
      ctx.stripe.subscriptions.set(subId, subscription('active'));
      ctx.stripe.events.set('evt_bad', { id: 'evt_bad', type: 'customer.subscription.updated', data: { object: { id: subId, customer: customer() } } });
      const r = await post('/webhooks/evt_bad/replay').expect(200);
      expect(r.body).toEqual({ ok: true, result: 'processed' });
      const row = await ctx.db.system.stripeEvent.findUniqueOrThrow({ where: { id: 'evt_bad' } });
      expect(row.processedAt).not.toBeNull();
      expect(row.error).toBeNull();

      // Un evento ya procesado se reprocesa igualmente (force).
      const again = await post('/webhooks/evt_bad/replay').expect(200);
      expect(again.body.result).toBe('processed');
      const log = await ctx.db.system.platformAuditLog.findMany({ where: { action: 'billing.webhook.replayed', entityId: 'evt_bad' } });
      expect(log).toHaveLength(2);

      const detail = await ctx.http().get(`${base}/webhooks/evt_bad`).set(auth(admin.token)).expect(200);
      expect(detail.body).toMatchObject({ status: 'processed', tenant: { id: band.tenantId } });
    });
  });
});
