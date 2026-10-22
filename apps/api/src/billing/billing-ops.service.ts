import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PlanCode, Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { pseudonymize } from '../common/crypto';
import { found } from '../common/errors';
import { env } from '../config/env';
import { page, PageQuery, skipTake } from '../common/pagination';
import { Db } from '../db/db.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { AddonKey, addonLines, addonPrices, isComplimentary } from './addons';
import { BillingService } from './billing.service';
import { StripeClient } from './stripe.provider';

const DAY = 86_400_000;
const PRORATION = 'create_prorations' as const;
/** Estados de Stripe en los que la suscripción sigue cobrando. */
const LIVE = ['trialing', 'active', 'past_due', 'unpaid'];

export interface Actor {
  userId: string;
  ip?: string;
}

export interface SyncResult {
  status: 'synced' | 'unchanged' | 'skipped' | 'error';
  changes: string[];
  message?: string;
}

const fmtEur = (cents: number) => (cents / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
const fmtDate = (d: Date) => d.toLocaleDateString('es-ES');

/**
 * Operación de facturación del panel global: impagos, bonificaciones, cobro del add-on Escuela y
 * webhooks de Stripe. Las acciones sobre una banda se auditan en su registro con prefijo `platform.`;
 * las globales (cupones, reprocesado de webhooks, sincronizaciones) en la auditoría de plataforma.
 */
@Injectable()
export class BillingOpsService {
  private readonly logger = new Logger(BillingOpsService.name);

  constructor(
    private readonly db: Db,
    private readonly stripe: StripeClient,
    private readonly billing: BillingService,
    private readonly integrations: IntegrationsService,
  ) {}

  private auditTenant(tenantId: string, actor: Actor | null, action: string, entityId: string, metadata?: object) {
    return this.db.system.auditLog.create({
      data: {
        tenantId, actorId: actor?.userId ?? null, action: `platform.${action}`, entity: 'billing', entityId,
        metadata: metadata as Prisma.InputJsonValue, ipHash: actor ? pseudonymize(actor.ip) : null,
      },
    });
  }

  private auditPlatform(actor: Actor | null, action: string, entity: string, entityId: string, metadata?: object) {
    return this.db.system.platformAuditLog.create({
      data: { actorId: actor?.userId ?? null, action, entity, entityId, metadata: metadata as Prisma.InputJsonValue, ipHash: actor ? pseudonymize(actor.ip) : null },
    });
  }

  private async tenant(tenantId: string) {
    return found(await this.db.system.tenant.findUnique({ where: { id: tenantId }, include: { plan: true, subscription: true } }), 'Banda');
  }

  /** Suscripción de Stripe vigente de la banda o 400. */
  private async liveSubscription(tenantId: string) {
    const t = await this.tenant(tenantId);
    const subId = t.subscription?.stripeSubscriptionId;
    if (!subId) throw new BadRequestException({ message: 'La banda no tiene suscripción en Stripe', code: 'NO_SUBSCRIPTION' });
    const api = await this.stripe.api();
    const sub = await api.subscriptions.retrieve(subId);
    if (!LIVE.includes(sub.status)) throw new BadRequestException({ message: 'La suscripción no está activa', code: 'NO_SUBSCRIPTION' });
    return { tenant: t, sub, api };
  }

  private async owners(tenantIds: string[]) {
    const rows = await this.db.system.membership.findMany({
      where: { tenantId: { in: tenantIds }, status: 'ACTIVE', role: { key: 'owner' } },
      select: { tenantId: true, user: { select: { name: true, email: true } } },
    });
    return (id: string) => rows.filter((r) => r.tenantId === id).map((r) => r.user);
  }

  // ── Pagos fallidos ─────────────────────────────────────────

  async dunning(now = new Date()) {
    const openInvoices = await this.db.system.invoice.findMany({ where: { status: { in: ['open', 'uncollectible'] } }, orderBy: { createdAt: 'asc' } });
    const tenants = await this.db.system.tenant.findMany({
      where: { deletedAt: null, OR: [{ status: { in: ['PAST_DUE', 'READ_ONLY'] } }, { id: { in: [...new Set(openInvoices.map((i) => i.tenantId))] } }] },
      include: { plan: { select: { code: true, name: true } }, subscription: true },
    });
    const ownersOf = await this.owners(tenants.map((t) => t.id));
    const rows = tenants.map((t) => {
      const inv = openInvoices.filter((i) => i.tenantId === t.id);
      const last = inv.at(-1) ?? null;
      const since = inv[0]?.createdAt ?? (t.subscription?.graceUntil ? new Date(t.subscription.graceUntil.getTime() - env().GRACE_PERIOD_DAYS * DAY) : null);
      return {
        tenant: { id: t.id, name: t.name, slug: t.slug, status: t.status },
        plan: t.plan,
        stripeStatus: t.subscription?.stripeStatus ?? null,
        amountDueCents: inv.reduce((s, i) => s + Math.max(0, i.totalCents - i.amountPaidCents), 0),
        currency: last?.currency ?? 'eur',
        openInvoices: inv.length,
        lastFailedInvoice: last && { id: last.id, number: last.number, status: last.status, totalCents: last.totalCents, createdAt: last.createdAt, hostedUrl: last.hostedUrl },
        graceUntil: t.subscription?.graceUntil ?? null,
        daysOverdue: since ? Math.max(0, Math.floor((now.getTime() - since.getTime()) / DAY)) : 0,
        complimentaryUntil: isComplimentary(t, now) ? t.complimentaryUntil : null,
        owners: ownersOf(t.id),
      };
    });
    return rows.sort((a, b) => b.daysOverdue - a.daysOverdue || b.amountDueCents - a.amountDueCents);
  }

  /** Reintenta el cobro de la última factura abierta. Si se cobra, se cierra la gracia como en el webhook. */
  async retry(tenantId: string, actor: Actor) {
    const t = await this.tenant(tenantId);
    const customer = t.subscription?.stripeCustomerId;
    if (!customer) throw new BadRequestException({ message: 'La banda no es cliente de Stripe', code: 'NO_CUSTOMER' });
    const api = await this.stripe.api();
    const open = await api.invoices.list({ customer, status: 'open', limit: 1 });
    const invoice = open.data[0];
    if (!invoice) throw new BadRequestException({ message: 'No hay facturas pendientes de cobro', code: 'NO_OPEN_INVOICE' });
    let result: { ok: boolean; invoiceId: string; status: string | null; message?: string };
    try {
      const paid = await api.invoices.pay(invoice.id!);
      await this.billing.upsertInvoice(tenantId, paid);
      if (paid.status === 'paid') await this.billing.clearGrace(tenantId);
      result = { ok: paid.status === 'paid', invoiceId: invoice.id!, status: paid.status };
    } catch (e) {
      result = { ok: false, invoiceId: invoice.id!, status: invoice.status, message: (e as Error).message.slice(0, 300) };
    }
    await this.auditTenant(tenantId, actor, 'billing.retry', invoice.id!, result);
    return result;
  }

  async remind(tenantId: string, actor: Actor) {
    const t = await this.tenant(tenantId);
    const due = (await this.dunning()).find((r) => r.tenant.id === tenantId);
    const grace = t.subscription?.graceUntil;
    await this.billing.notifyBillingManagers(
      tenantId,
      'Recordatorio: pago pendiente',
      `Tenemos pendiente el cobro de la suscripción${due?.amountDueCents ? ` (${fmtEur(due.amountDueCents)})` : ''}. ` +
        (grace ? `Actualiza el método de pago antes del ${fmtDate(grace)} para evitar el modo sólo lectura.` : 'Actualiza el método de pago desde Plan y facturación.'),
    );
    await this.auditTenant(tenantId, actor, 'billing.reminded', tenantId, { amountDueCents: due?.amountDueCents ?? 0 });
    return { ok: true };
  }

  async readOnly(tenantId: string, actor: Actor) {
    const t = await this.tenant(tenantId);
    if (isComplimentary(t)) throw new BadRequestException({ message: 'La banda tiene una cuenta bonificada', code: 'COMPLIMENTARY' });
    await this.db.system.tenant.update({ where: { id: tenantId }, data: { status: 'READ_ONLY' } });
    await this.billing.notifyBillingManagers(tenantId, 'Banda en modo sólo lectura', 'La cuenta ha pasado a modo sólo lectura por un pago pendiente. Actualiza el método de pago para recuperar la edición.');
    await this.auditTenant(tenantId, actor, 'billing.read_only', tenantId, { previousStatus: t.status });
    return { ok: true, status: 'READ_ONLY' };
  }

  /** Amplía la gracia `days` días desde hoy o desde la fecha actual si es posterior; reabre la edición. */
  async extendGrace(tenantId: string, days: number, actor: Actor) {
    const t = await this.tenant(tenantId);
    const base = Math.max(Date.now(), t.subscription?.graceUntil?.getTime() ?? 0);
    const graceUntil = new Date(base + days * DAY);
    await this.db.system.$transaction([
      this.db.system.subscription.upsert({ where: { tenantId }, create: { tenantId, graceUntil }, update: { graceUntil } }),
      this.db.system.tenant.updateMany({ where: { id: tenantId, status: 'READ_ONLY' }, data: { status: 'PAST_DUE' } }),
    ]);
    await this.auditTenant(tenantId, actor, 'billing.grace_extended', tenantId, { days, graceUntil, previous: t.subscription?.graceUntil ?? null });
    return { ok: true, graceUntil };
  }

  // ── Cupones y bonificaciones ───────────────────────────────

  async coupons() {
    const api = await this.stripe.api();
    const [coupons, codes] = await Promise.all([api.coupons.list({ limit: 100 }), api.promotionCodes.list({ limit: 100 })]);
    return coupons.data.map((c) => ({
      id: c.id, name: c.name, percentOff: c.percent_off, amountOffCents: c.amount_off, currency: c.currency,
      duration: c.duration, durationInMonths: c.duration_in_months, maxRedemptions: c.max_redemptions,
      timesRedeemed: c.times_redeemed, valid: c.valid, createdAt: new Date(c.created * 1000),
      promotionCodes: codes.data.filter((p) => p.coupon.id === c.id).map((p) => ({ id: p.id, code: p.code, active: p.active })),
    }));
  }

  async createCoupon(
    input: { name: string; percentOff?: number; amountOffCents?: number; duration: 'once' | 'repeating' | 'forever'; durationInMonths?: number; maxRedemptions?: number; promotionCode?: string },
    actor: Actor,
  ) {
    if (!input.percentOff === !input.amountOffCents) throw new BadRequestException({ message: 'Indica un porcentaje o un importe de descuento', code: 'VALIDATION_ERROR' });
    if (input.duration === 'repeating' && !input.durationInMonths) throw new BadRequestException({ message: 'Indica el número de meses', code: 'VALIDATION_ERROR' });
    const api = await this.stripe.api();
    const coupon = await api.coupons.create({
      name: input.name,
      ...(input.percentOff ? { percent_off: input.percentOff } : { amount_off: input.amountOffCents, currency: 'eur' }),
      duration: input.duration,
      ...(input.duration === 'repeating' ? { duration_in_months: input.durationInMonths } : {}),
      ...(input.maxRedemptions ? { max_redemptions: input.maxRedemptions } : {}),
    });
    const promo = input.promotionCode ? await api.promotionCodes.create({ coupon: coupon.id, code: input.promotionCode }) : null;
    await this.auditPlatform(actor, 'billing.coupon.created', 'coupon', coupon.id, { ...input });
    return { id: coupon.id, promotionCode: promo?.code ?? null };
  }

  async deleteCoupon(id: string, actor: Actor) {
    await (await this.stripe.api()).coupons.del(id);
    await this.auditPlatform(actor, 'billing.coupon.deleted', 'coupon', id);
    return { ok: true };
  }

  async applyCoupon(tenantId: string, couponId: string, actor: Actor) {
    const { sub, api } = await this.liveSubscription(tenantId);
    await api.subscriptions.update(sub.id, { discounts: [{ coupon: couponId }] });
    await this.auditTenant(tenantId, actor, 'billing.coupon_applied', couponId, { subscription: sub.id });
    return { ok: true };
  }

  /** Saldo a favor en Stripe: se descuenta de las próximas facturas. */
  async credit(tenantId: string, amountCents: number, description: string, actor: Actor) {
    const t = await this.tenant(tenantId);
    const customer = t.subscription?.stripeCustomerId;
    if (!customer) throw new BadRequestException({ message: 'La banda no es cliente de Stripe', code: 'NO_CUSTOMER' });
    const tx = await (await this.stripe.api()).customers.createBalanceTransaction(customer, { amount: -amountCents, currency: 'eur', description });
    await this.auditTenant(tenantId, actor, 'billing.credit', tx.id, { amountCents, description });
    return { ok: true, id: tx.id };
  }

  async freeMonths(tenantId: string, months: number, actor: Actor) {
    const { tenant, sub, api } = await this.liveSubscription(tenantId);
    const coupon = await api.coupons.create({
      name: `${months} ${months === 1 ? 'mes gratis' : 'meses gratis'} · ${tenant.name}`.slice(0, 40),
      percent_off: 100, duration: 'repeating', duration_in_months: months, max_redemptions: 1, metadata: { tenantId },
    });
    await api.subscriptions.update(sub.id, { discounts: [{ coupon: coupon.id }] });
    await this.auditTenant(tenantId, actor, 'billing.free_months', coupon.id, { months });
    return { ok: true, couponId: coupon.id };
  }

  async extendTrial(tenantId: string, days: number, actor: Actor) {
    const { sub, api } = await this.liveSubscription(tenantId);
    if (sub.status !== 'trialing') throw new BadRequestException({ message: 'La banda no está en periodo de prueba', code: 'NOT_TRIALING' });
    const trialEnd = Math.max(sub.trial_end ?? 0, Math.floor(Date.now() / 1000)) + days * 86_400;
    await api.subscriptions.update(sub.id, { trial_end: trialEnd, proration_behavior: 'none' });
    await this.billing.syncSubscription(sub.id);
    await this.auditTenant(tenantId, actor, 'billing.trial_extended', sub.id, { days, trialEnd: new Date(trialEnd * 1000) });
    return { ok: true, trialEndsAt: new Date(trialEnd * 1000) };
  }

  /** Cuenta bonificada: plan asignado sin Stripe hasta `until`. Stripe y el barrido de gracia no la tocan. */
  async setComplimentary(tenantId: string, input: { until: Date; reason: string; planCode: PlanCode }, actor: Actor) {
    if (input.until <= new Date()) throw new BadRequestException({ message: 'La fecha debe ser futura', code: 'VALIDATION_ERROR' });
    const t = await this.tenant(tenantId);
    const plan = await this.db.system.plan.findUniqueOrThrow({ where: { code: input.planCode } });
    await this.db.system.$transaction([
      this.db.system.tenant.update({
        where: { id: tenantId },
        data: { planId: plan.id, status: 'ACTIVE', complimentaryUntil: input.until, complimentaryReason: input.reason },
      }),
      this.db.system.subscription.updateMany({ where: { tenantId }, data: { graceUntil: null } }),
    ]);
    await this.auditTenant(tenantId, actor, 'billing.complimentary_set', tenantId, { ...input, previousPlan: t.plan.code, previousStatus: t.status });
    const stripeActive = !!t.subscription?.stripeSubscriptionId && LIVE.includes(t.subscription.stripeStatus ?? '');
    // Aviso: la suscripción de Stripe sigue cobrando; conviene cancelarla o aplicar meses gratis.
    return { ok: true, warning: stripeActive ? 'La banda tiene una suscripción activa en Stripe que sigue cobrando' : null };
  }

  async clearComplimentary(tenantId: string, actor: Actor | null) {
    const t = await this.tenant(tenantId);
    await this.db.system.tenant.update({ where: { id: tenantId }, data: { complimentaryUntil: null, complimentaryReason: null } });
    const subId = t.subscription?.stripeSubscriptionId;
    let outcome: string;
    if (subId && LIVE.includes(t.subscription?.stripeStatus ?? '')) {
      // Vuelve a mandar Stripe: plan y estado según la suscripción real.
      await this.billing.syncSubscription(subId);
      outcome = 'stripe';
    } else {
      const free = await this.db.system.plan.findUniqueOrThrow({ where: { code: 'FREE' } });
      await this.db.system.tenant.update({ where: { id: tenantId }, data: { planId: free.id, status: 'ACTIVE' } });
      outcome = 'free';
    }
    await this.auditTenant(tenantId, actor, actor ? 'billing.complimentary_cleared' : 'billing.complimentary_expired', tenantId, { until: t.complimentaryUntil, outcome });
    return { ok: true, outcome };
  }

  /** Bonificaciones: aviso 7 días antes (ventana de un día para el trabajo diario) y fin al vencer. */
  async complimentarySweep(now = new Date()) {
    const soon = await this.db.system.tenant.findMany({
      where: { deletedAt: null, complimentaryUntil: { gt: new Date(now.getTime() + 6 * DAY), lte: new Date(now.getTime() + 7 * DAY) } },
      select: { id: true, complimentaryUntil: true },
    });
    for (const t of soon) {
      await this.billing.notifyBillingManagers(
        t.id,
        'Tu cuenta bonificada termina pronto',
        `La bonificación de tu banda termina el ${fmtDate(t.complimentaryUntil!)}. Después pasará al plan Free salvo que contrates un plan de pago.`,
      );
    }
    const expired = await this.db.system.tenant.findMany({ where: { complimentaryUntil: { lte: now } }, select: { id: true } });
    for (const t of expired) await this.clearComplimentary(t.id, null);
    return { reminded: soon.length, expired: expired.length };
  }

  // ── Add-on Escuela ─────────────────────────────────────────

  /**
   * Ajusta los conceptos del add-on en la suscripción de Stripe al estado de la banda (con prorrateo).
   * Idempotente: si ya coinciden no hace nada. Debe llamarse tras cambiar `addons` o `studentSeats`.
   */
  async syncAddons(tenantId: string, actor: Actor | null = null): Promise<SyncResult> {
    const t = await this.tenant(tenantId);
    const subId = t.subscription?.stripeSubscriptionId;
    if (!subId || !LIVE.includes(t.subscription?.stripeStatus ?? '')) return { status: 'skipped', changes: [], message: 'Sin suscripción activa en Stripe' };
    let result: SyncResult;
    try {
      const prices = await addonPrices(this.integrations);
      const api = await this.stripe.api();
      const sub = await api.subscriptions.retrieve(subId);
      const wanted = new Map(addonLines(t, prices).map((l) => [l.key, l]));
      const priceOf: Record<AddonKey, string | null> = { school_addon: prices.addonPrice, school_seats: prices.seatPrice };
      const changes: string[] = [];
      for (const key of ['school_addon', 'school_seats'] as AddonKey[]) {
        const line = wanted.get(key);
        const item = sub.items.data.find((i) => i.metadata?.solfeggio === key || (!!priceOf[key] && i.price.id === priceOf[key]));
        if (line && !line.priceId) throw new Error(`Precio de Stripe no configurado para ${line.label}`);
        if (line && line.priceId && sub.items.data.some((i) => i.price.recurring?.interval === 'year')) {
          throw new Error('El add-on Escuela sólo se cobra automáticamente en suscripciones mensuales');
        }
        if (line && !item) {
          await api.subscriptionItems.create({ subscription: sub.id, price: line.priceId!, quantity: line.quantity, proration_behavior: PRORATION, metadata: { solfeggio: key } });
          changes.push(`${key}:add:${line.quantity}`);
        } else if (line && item && (item.quantity !== line.quantity || item.price.id !== line.priceId)) {
          await api.subscriptionItems.update(item.id, { quantity: line.quantity, price: line.priceId!, proration_behavior: PRORATION });
          changes.push(`${key}:update:${line.quantity}`);
        } else if (!line && item) {
          await api.subscriptionItems.del(item.id, { proration_behavior: PRORATION });
          changes.push(`${key}:remove`);
        }
      }
      result = { status: changes.length ? 'synced' : 'unchanged', changes };
    } catch (e) {
      this.logger.warn(`Sincronización del add-on de ${tenantId} fallida: ${(e as Error).message}`);
      result = { status: 'error', changes: [], message: (e as Error).message.slice(0, 300) };
    }
    // El trabajo diario sólo registra cambios y errores; la acción manual, siempre.
    if (actor || result.status !== 'unchanged') {
      await this.auditPlatform(actor, result.status === 'error' ? 'billing.addons.sync_failed' : 'billing.addons.synced', 'tenant', tenantId, result);
    }
    if (actor) await this.auditTenant(tenantId, actor, 'billing.addons_synced', tenantId, result);
    return result;
  }

  /** Trabajo diario `billing.reconcile-addons`: sincroniza el add-on y gestiona las bonificaciones. */
  async reconcileAddons(now = new Date()) {
    const complimentary = await this.complimentarySweep(now);
    const tenants = await this.db.system.tenant.findMany({
      where: { deletedAt: null, subscription: { stripeSubscriptionId: { not: null }, stripeStatus: { in: LIVE } } },
      select: { id: true },
    });
    const counts: Record<SyncResult['status'], number> = { synced: 0, unchanged: 0, skipped: 0, error: 0 };
    // Sin precios configurados no hay nada que cobrar ni que quitar.
    const prices = await addonPrices(this.integrations);
    if (prices.addonPrice || prices.seatPrice) {
      for (const t of tenants) counts[(await this.syncAddons(t.id)).status]++;
    }
    return { complimentary, addons: counts };
  }

  async addonsOverview() {
    const prices = await addonPrices(this.integrations);
    const tenants = await this.db.system.tenant.findMany({
      where: { deletedAt: null, OR: [{ addons: { has: 'school' } }, { studentSeats: { gt: 0 } }] },
      include: { plan: { select: { code: true, name: true, features: true, maxStudents: true } }, subscription: true },
      orderBy: { name: 'asc' },
    });
    const logs = await this.db.system.platformAuditLog.findMany({
      where: { entity: 'tenant', entityId: { in: tenants.map((t) => t.id) }, action: { startsWith: 'billing.addons.' } },
      orderBy: { createdAt: 'desc' },
    });
    return {
      prices: { addonConfigured: !!prices.addonPrice, seatConfigured: !!prices.seatPrice, addonCents: prices.addonCents, seatCents: prices.seatCents },
      tenants: tenants.map((t) => {
        const lines = addonLines(t, prices);
        const last = logs.find((l) => l.entityId === t.id);
        return {
          tenant: { id: t.id, name: t.name, slug: t.slug, status: t.status },
          plan: { code: t.plan.code, name: t.plan.name, maxStudents: t.plan.maxStudents, includesSchool: t.plan.features.includes('school') },
          addons: t.addons,
          studentSeats: t.studentSeats,
          lines: lines.map(({ priceId: _p, ...l }) => l),
          mrrCents: lines.reduce((s, l) => s + l.quantity * l.unitCents, 0),
          stripe: { subscriptionId: t.subscription?.stripeSubscriptionId ?? null, status: t.subscription?.stripeStatus ?? null, interval: t.subscription?.interval ?? null },
          complimentaryUntil: isComplimentary(t) ? t.complimentaryUntil : null,
          lastSync: last ? { at: last.createdAt, ...(last.metadata as object as SyncResult) } : null,
        };
      }),
    };
  }

  /** Resumen de facturación de una banda para el panel (selector de bandas de bonificaciones). */
  async tenantSummary(tenantId: string) {
    const t = await this.tenant(tenantId);
    const invoices = await this.db.system.invoice.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 6 });
    const s = t.subscription;
    return {
      tenant: { id: t.id, name: t.name, slug: t.slug, status: t.status },
      plan: { code: t.plan.code, name: t.plan.name },
      complimentaryUntil: t.complimentaryUntil,
      complimentaryReason: t.complimentaryReason,
      subscription: s
        ? { customerId: s.stripeCustomerId, subscriptionId: s.stripeSubscriptionId, status: s.stripeStatus, interval: s.interval, trialEndsAt: s.trialEndsAt, currentPeriodEnd: s.currentPeriodEnd, graceUntil: s.graceUntil }
        : null,
      invoices,
    };
  }

  // ── Webhooks de Stripe ─────────────────────────────────────

  async webhooks(q: PageQuery & { type?: string; status?: 'processed' | 'failed' | 'pending' }) {
    const where: Prisma.StripeEventWhereInput = {
      ...(q.type && { type: q.type }),
      ...(q.status === 'processed' && { processedAt: { not: null } }),
      ...(q.status === 'failed' && { processedAt: null, error: { not: null } }),
      ...(q.status === 'pending' && { processedAt: null, error: null }),
    };
    const [rows, total, types] = await Promise.all([
      this.db.system.stripeEvent.findMany({ where, orderBy: { receivedAt: 'desc' }, ...skipTake(q) }),
      this.db.system.stripeEvent.count({ where }),
      this.db.system.stripeEvent.groupBy({ by: ['type'], orderBy: { type: 'asc' } }),
    ]);
    const status = (e: { processedAt: Date | null; error: string | null }) => (e.processedAt ? 'processed' : e.error ? 'failed' : 'pending');
    return { ...page(rows.map((e) => ({ ...e, status: status(e) })), total, q), types: types.map((t) => t.type) };
  }

  /** Detalle: lee el evento de Stripe para mostrar el objeto y la banda afectada. */
  async webhook(id: string) {
    const row = found(await this.db.system.stripeEvent.findUnique({ where: { id } }), 'Evento');
    let tenant: { id: string; name: string } | null = null;
    let object: { id?: string; object?: string; status?: string } | null = null;
    let fetchError: string | null = null;
    try {
      const event = await (await this.stripe.api()).events.retrieve(id);
      const o = event.data.object as { id?: string; object?: string; status?: string; customer?: string | { id: string }; metadata?: Record<string, string> };
      object = { id: o.id, object: o.object, status: o.status };
      const customer = typeof o.customer === 'string' ? o.customer : o.customer?.id;
      const tenantId =
        o.metadata?.tenantId ?? (customer ? (await this.db.system.subscription.findUnique({ where: { stripeCustomerId: customer } }))?.tenantId : undefined);
      if (tenantId) tenant = await this.db.system.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true } });
    } catch (e) {
      fetchError = (e as Error).message.slice(0, 300);
    }
    return { ...row, status: row.processedAt ? 'processed' : row.error ? 'failed' : 'pending', object, tenant, fetchError };
  }

  async replay(id: string, actor: Actor) {
    const event = await (await this.stripe.api()).events.retrieve(id);
    let result: { ok: boolean; result?: string; error?: string };
    try {
      result = { ok: true, result: await this.billing.handleEvent(event as Stripe.Event, { force: true }) };
    } catch (e) {
      result = { ok: false, error: (e as Error).message.slice(0, 300) };
    }
    await this.auditPlatform(actor, 'billing.webhook.replayed', 'stripe_event', id, { type: event.type, ...result });
    return result;
  }
}
