import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { BillingInterval, PlanCode, Prisma, TenantStatus } from '@prisma/client';
import Stripe from 'stripe';
import { env } from '../config/env';
import { Db } from '../db/db.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { Jobs } from '../jobs/jobs.service';
import { effectiveLimits } from '../tenancy/effective-limits';
import { addonLines, addonPrices, isComplimentary } from './addons';
import { PlanSync } from './plan-sync';
import { StripeClient } from './stripe.provider';

const DAY = 86_400_000;

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly db: Db,
    private readonly stripe: StripeClient,
    private readonly jobs: Jobs,
    private readonly integrations: IntegrationsService,
    private readonly planSync: PlanSync,
  ) {}

  async overview(tenantId: string) {
    const tenant = await this.db.system.tenant.findUniqueOrThrow({ where: { id: tenantId }, include: { plan: true, subscription: true } });
    const prices = await addonPrices(this.integrations);
    return this.db.tenant(tenantId, async (tx) => {
      const [users, members, invoices] = await Promise.all([
        tx.membership.count({ where: { status: 'ACTIVE' } }),
        tx.member.count({ where: { status: { not: 'LEFT' } } }),
        tx.invoice.findMany({ orderBy: { createdAt: 'desc' }, take: 24 }),
      ]);
      const s = tenant.subscription;
      const limits = effectiveLimits(tenant);
      return {
        billingEnabled: await this.stripe.enabled(),
        status: tenant.status,
        plan: { ...tenant.plan, ...limits },
        subscription: s
          ? { status: s.stripeStatus, interval: s.interval, currentPeriodEnd: s.currentPeriodEnd, trialEndsAt: s.trialEndsAt, cancelAtPeriodEnd: s.cancelAtPeriodEnd, graceUntil: s.graceUntil }
          : null,
        usage: { users, members, storageBytes: Number(tenant.storageUsedBytes) },
        addons: addonLines(tenant, prices).map(({ priceId: _p, ...l }) => l),
        studentSeats: tenant.studentSeats,
        limitOverrides: {
          maxUsers: tenant.maxUsersOverride,
          maxMembers: tenant.maxMembersOverride,
          storageMb: tenant.storageMbOverride,
        },
        complimentaryUntil: isComplimentary(tenant) ? tenant.complimentaryUntil : null,
        invoices,
      };
    });
  }

  private async ensureCustomer(tenantId: string, email: string) {
    const tenant = await this.db.system.tenant.findUniqueOrThrow({ where: { id: tenantId }, include: { subscription: true } });
    if (tenant.subscription?.stripeCustomerId) return { tenant, customerId: tenant.subscription.stripeCustomerId };
    const customer = await (await this.stripe.api()).customers.create(
      { name: tenant.legalName ?? tenant.name, email, metadata: { tenantId }, preferred_locales: ['es'] },
      { idempotencyKey: `customer:${tenantId}` },
    );
    await this.db.system.subscription.upsert({
      where: { tenantId },
      create: { tenantId, stripeCustomerId: customer.id },
      update: { stripeCustomerId: customer.id },
    });
    return { tenant, customerId: customer.id };
  }

  async checkout(tenantId: string, email: string, planCode: PlanCode, interval: BillingInterval) {
    if (planCode === 'FREE') throw new BadRequestException({ message: 'El plan Free no requiere pago', code: 'INVALID_PLAN' });
    // Comprueba primero que los pagos estén habilitados (503) antes de validar precios o crear clientes.
    const { taxEnabled } = await this.stripe.settings();
    const plan = await this.db.system.plan.findUniqueOrThrow({ where: { code: planCode } });
    const price = await this.priceForCheckout(plan, interval);
    if (!price) throw new BadRequestException({ message: 'Precio no configurado para este plan', code: 'PRICE_NOT_CONFIGURED' });

    const { tenant, customerId } = await this.ensureCustomer(tenantId, email);
    if (tenant.subscription?.stripeSubscriptionId && tenant.subscription.stripeStatus !== 'canceled') {
      throw new BadRequestException({ message: 'Ya tienes una suscripción: cambia de plan desde el portal', code: 'SUBSCRIPTION_EXISTS' });
    }
    // La prueba gratuita sólo se ofrece a bandas que nunca han tenido suscripción.
    const hadSubscription = !!(await this.db.system.invoice.findFirst({ where: { tenantId } })) || !!tenant.subscription?.stripeSubscriptionId;
    const trialDays = hadSubscription ? undefined : plan.trialDays || env().TRIAL_DAYS;
    const session = await (await this.stripe.api()).checkout.sessions.create(
      {
        mode: 'subscription',
        customer: customerId,
        client_reference_id: tenantId,
        line_items: [{ price, quantity: 1 }],
        subscription_data: { metadata: { tenantId, planCode }, ...(trialDays ? { trial_period_days: trialDays } : {}) },
        metadata: { tenantId, planCode },
        allow_promotion_codes: true,
        automatic_tax: { enabled: taxEnabled },
        tax_id_collection: { enabled: true },
        customer_update: { address: 'auto', name: 'auto' },
        billing_address_collection: 'required',
        locale: 'es',
        success_url: `${env().APP_URL}/billing?checkout=success`,
        cancel_url: `${env().APP_URL}/billing?checkout=cancel`,
      },
      // Evita sesiones duplicadas por doble clic durante un minuto.
      { idempotencyKey: `checkout:${tenantId}:${planCode}:${interval}:${Math.floor(Date.now() / 60_000)}` },
    );
    return { url: session.url };
  }

  /** Usa el precio de Stripe del plan. Si el panel tiene importe pero aún no hay precio, lo publica. */
  private async priceForCheckout(plan: { id: string; code: PlanCode; name: string; priceMonthlyCents: number; priceYearlyCents: number; stripePriceMonthly: string | null; stripePriceYearly: string | null }, interval: BillingInterval) {
    const cents = interval === 'YEAR' ? plan.priceYearlyCents : plan.priceMonthlyCents;
    const price = interval === 'YEAR' ? plan.stripePriceYearly : plan.stripePriceMonthly;
    if (price || cents <= 0) return price;
    const catalog = {
      code: plan.code,
      name: plan.name,
      priceMonthlyCents: plan.priceMonthlyCents,
      priceYearlyCents: plan.priceYearlyCents,
      stripePriceMonthly: plan.stripePriceMonthly,
      stripePriceYearly: plan.stripePriceYearly,
    };
    const synced = await this.planSync.publish(catalog, catalog);
    await this.db.system.plan.update({ where: { id: plan.id }, data: synced });
    return interval === 'YEAR' ? synced.stripePriceYearly : synced.stripePriceMonthly;
  }

  async portal(tenantId: string, email: string) {
    const { customerId } = await this.ensureCustomer(tenantId, email);
    const session = await (await this.stripe.api()).billingPortal.sessions.create({ customer: customerId, return_url: `${env().APP_URL}/billing`, locale: 'es' });
    return { url: session.url };
  }

  /**
   * Procesa un evento verificado. Idempotente: el id del evento se registra antes de procesar;
   * un evento ya procesado se ignora y uno que falló se reintenta.
   */
  async handleEvent(event: Stripe.Event, opts: { force?: boolean } = {}): Promise<'processed' | 'duplicate' | 'ignored'> {
    try {
      await this.db.system.stripeEvent.create({ data: { id: event.id, type: event.type } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const prev = await this.db.system.stripeEvent.findUnique({ where: { id: event.id } });
        // `force`: reprocesado manual desde el panel global aunque ya se procesara.
        if (prev?.processedAt && !opts.force) return 'duplicate';
      } else {
        throw e;
      }
    }

    try {
      const handled = await this.dispatch(event);
      await this.db.system.stripeEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), error: null } });
      return handled ? 'processed' : 'ignored';
    } catch (e) {
      await this.db.system.stripeEvent.update({ where: { id: event.id }, data: { error: (e as Error).message.slice(0, 500) } });
      throw e;
    }
  }

  private async dispatch(event: Stripe.Event): Promise<boolean> {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        const tenantId = s.client_reference_id ?? s.metadata?.tenantId;
        if (!tenantId || typeof s.subscription !== 'string') return false;
        await this.db.system.subscription.upsert({
          where: { tenantId },
          create: { tenantId, stripeCustomerId: s.customer as string, stripeSubscriptionId: s.subscription },
          update: { stripeCustomerId: s.customer as string, stripeSubscriptionId: s.subscription },
        });
        await this.syncSubscription(s.subscription);
        return true;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.trial_will_end':
        await this.syncSubscription(event.data.object.id);
        return true;
      case 'invoice.finalized':
      case 'invoice.paid':
      case 'invoice.payment_failed':
      case 'invoice.voided':
      case 'invoice.marked_uncollectible': {
        const invoice = event.data.object;
        const tenantId = await this.tenantForCustomer(invoice.customer as string);
        if (!tenantId) return false;
        await this.upsertInvoice(tenantId, invoice);
        if (event.type === 'invoice.payment_failed') await this.markPastDue(tenantId, invoice.next_payment_attempt);
        if (event.type === 'invoice.paid') await this.clearGrace(tenantId);
        return true;
      }
      default:
        return false;
    }
  }

  private async tenantForCustomer(customerId: string) {
    const sub = await this.db.system.subscription.findUnique({ where: { stripeCustomerId: customerId } });
    return sub?.tenantId ?? null;
  }

  /** El plan sale del concepto cuyo precio es de un plan; el resto son add-ons. */
  private async planItem(items: Stripe.SubscriptionItem[]) {
    const ids = items.map((i) => i.price.id);
    const plans = await this.db.system.plan.findMany({ where: { OR: [{ stripePriceMonthly: { in: ids } }, { stripePriceYearly: { in: ids } }] } });
    for (const item of items) {
      const plan = plans.find((p) => p.stripePriceMonthly === item.price.id || p.stripePriceYearly === item.price.id);
      if (plan) return { item, plan };
    }
    return { item: items[0], plan: null };
  }

  /** Lee el estado actual de Stripe (no el del evento) para tolerar eventos desordenados. */
  async syncSubscription(subscriptionId: string) {
    const sub = await (await this.stripe.api()).subscriptions.retrieve(subscriptionId);
    const tenantId = sub.metadata?.tenantId ?? (await this.tenantForCustomer(sub.customer as string));
    if (!tenantId) {
      this.logger.warn(`Suscripción ${sub.id} sin tenant asociado`);
      return;
    }
    const { item, plan } = await this.planItem(sub.items.data);
    const free = await this.db.system.plan.findUniqueOrThrow({ where: { code: 'FREE' } });
    const current = await this.db.system.subscription.findUnique({ where: { tenantId } });
    // Cuenta bonificada: Stripe no cambia su plan ni su estado mientras dure.
    const tenant = await this.db.system.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { complimentaryUntil: true } });
    const complimentary = isComplimentary(tenant);
    const ended = sub.status === 'canceled' || sub.status === 'incomplete_expired';

    const tenantStatus: Record<Stripe.Subscription.Status, TenantStatus | null> = {
      trialing: 'TRIALING',
      active: 'ACTIVE',
      past_due: 'PAST_DUE',
      unpaid: 'READ_ONLY',
      canceled: 'ACTIVE',
      incomplete_expired: 'ACTIVE',
      incomplete: null,
      paused: 'READ_ONLY',
    };
    const graceUntil =
      sub.status === 'past_due' ? (current?.graceUntil ?? new Date(Date.now() + env().GRACE_PERIOD_DAYS * DAY)) : null;

    await this.db.system.$transaction([
      this.db.system.subscription.upsert({
        where: { tenantId },
        create: { tenantId, stripeCustomerId: sub.customer as string },
        update: {
          stripeSubscriptionId: ended ? null : sub.id,
          stripeStatus: sub.status,
          interval: item?.price.recurring?.interval === 'year' ? 'YEAR' : 'MONTH',
          currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
          trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          graceUntil,
        },
      }),
      this.db.system.tenant.update({
        where: { id: tenantId },
        data: complimentary
          ? {}
          : {
              // Al terminar la suscripción la banda pasa a Free sin perder datos.
              planId: ended ? free.id : (plan?.id ?? undefined),
              ...(tenantStatus[sub.status] ? { status: tenantStatus[sub.status]! } : {}),
            },
      }),
    ]);
  }

  async upsertInvoice(tenantId: string, inv: Stripe.Invoice) {
    const data = {
      tenantId,
      number: inv.number,
      status: inv.status ?? 'draft',
      currency: inv.currency,
      subtotalCents: inv.subtotal,
      taxCents: inv.tax ?? 0,
      totalCents: inv.total,
      amountPaidCents: inv.amount_paid,
      hostedUrl: inv.hosted_invoice_url ?? null,
      pdfUrl: inv.invoice_pdf ?? null,
      periodStart: inv.period_start ? new Date(inv.period_start * 1000) : null,
      periodEnd: inv.period_end ? new Date(inv.period_end * 1000) : null,
    };
    await this.db.system.invoice.upsert({ where: { stripeInvoiceId: inv.id! }, create: { ...data, stripeInvoiceId: inv.id! }, update: data });
  }

  private async markPastDue(tenantId: string, nextAttempt: number | null) {
    const sub = await this.db.system.subscription.findUnique({ where: { tenantId } });
    const graceUntil = sub?.graceUntil ?? new Date(Date.now() + env().GRACE_PERIOD_DAYS * DAY);
    await this.db.system.$transaction([
      this.db.system.subscription.update({ where: { tenantId }, data: { graceUntil } }),
      this.db.system.tenant.updateMany({
        where: { id: tenantId, status: { in: ['ACTIVE', 'TRIALING'] }, OR: [{ complimentaryUntil: null }, { complimentaryUntil: { lte: new Date() } }] },
        data: { status: 'PAST_DUE' },
      }),
    ]);
    await this.notifyBillingManagers(
      tenantId,
      'Pago no completado',
      `No hemos podido cobrar la suscripción. ${nextAttempt ? `Reintentaremos el ${new Date(nextAttempt * 1000).toLocaleDateString('es-ES')}. ` : ''}` +
        `Si no se resuelve antes del ${graceUntil.toLocaleDateString('es-ES')}, la banda pasará a modo sólo lectura.`,
    );
  }

  async clearGrace(tenantId: string) {
    await this.db.system.$transaction([
      this.db.system.subscription.update({ where: { tenantId }, data: { graceUntil: null } }),
      this.db.system.tenant.updateMany({ where: { id: tenantId, status: { in: ['PAST_DUE', 'READ_ONLY'] } }, data: { status: 'ACTIVE' } }),
    ]);
  }

  /** Barrido periódico: bandas con el periodo de gracia vencido pasan a sólo lectura. */
  async sweepGracePeriods(now = new Date()) {
    const expired = await this.db.system.subscription.findMany({
      where: { graceUntil: { lt: now }, tenant: { status: 'PAST_DUE', OR: [{ complimentaryUntil: null }, { complimentaryUntil: { lte: now } }] } },
      select: { tenantId: true },
    });
    for (const { tenantId } of expired) {
      await this.db.system.tenant.update({ where: { id: tenantId }, data: { status: 'READ_ONLY' } });
      await this.notifyBillingManagers(tenantId, 'Banda en modo sólo lectura', 'El periodo de gracia ha terminado. Actualiza el método de pago para recuperar la edición.');
    }
    return expired.length;
  }

  async notifyBillingManagers(tenantId: string, title: string, body: string) {
    const managers = await this.db.system.membership.findMany({
      where: { tenantId, status: 'ACTIVE', role: { permissions: { has: 'billing:manage' } } },
      select: { userId: true },
    });
    await this.jobs.add('notify.fanout', { tenantId, userIds: managers.map((m) => m.userId), type: 'billing', title, body, link: '/billing', email: true });
  }
}
