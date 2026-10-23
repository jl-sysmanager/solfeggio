import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { Db } from '../db/db.service';
import { StripeClient } from './stripe.provider';

/** Datos del plan que Stripe debe reflejar. Los límites y los módulos no se cobran allí. */
export interface PlanCatalog {
  code: string;
  name: string;
  priceMonthlyCents: number;
  priceYearlyCents: number;
  stripePriceMonthly: string | null;
  stripePriceYearly: string | null;
}

const CLOSED = new Set(['canceled', 'incomplete_expired']);

function productIdOf(price: Stripe.Price): string | null {
  const product = price.product;
  if (typeof product === 'string') return product;
  if (product && !product.deleted) return product.id;
  return null;
}

function priceFits(price: Stripe.Price, cents: number, interval: 'month' | 'year') {
  return price.active && price.unit_amount === cents && price.currency === 'eur' && price.recurring?.interval === interval;
}

/**
 * Publica en Stripe el nombre y los precios editados en el panel.
 * Un precio de Stripe no se puede modificar: si cambia el importe se crea otro,
 * las suscripciones vivas pasan a él sin prorrateo (el nuevo importe sale en el siguiente cobro)
 * y el precio anterior se archiva.
 */
@Injectable()
export class PlanSync {
  private readonly logger = new Logger(PlanSync.name);

  constructor(
    private readonly stripe: StripeClient,
    private readonly db: Db,
  ) {}

  async publish(current: PlanCatalog, next: PlanCatalog): Promise<Pick<PlanCatalog, 'stripePriceMonthly' | 'stripePriceYearly'>> {
    if (next.code === 'FREE') return { stripePriceMonthly: null, stripePriceYearly: null };
    const enabled = await this.stripe.enabled().catch(() => false);
    const priceOrName = next.name !== current.name || next.priceMonthlyCents !== current.priceMonthlyCents || next.priceYearlyCents !== current.priceYearlyCents;
    if (!enabled) {
      if (priceOrName) {
        throw new BadRequestException({ message: 'Conecta Stripe en Integraciones antes de cambiar el nombre o el precio de un plan de pago', code: 'BILLING_NOT_CONFIGURED' });
      }
      return { stripePriceMonthly: current.stripePriceMonthly, stripePriceYearly: current.stripePriceYearly };
    }
    try {
      return await this.reconcile(next);
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      const message = e instanceof Error ? e.message : 'Error de Stripe';
      throw new BadRequestException({ message: `No se pudo publicar el plan en Stripe: ${message}`, code: 'STRIPE_SYNC_FAILED' });
    }
  }

  private async reconcile(plan: PlanCatalog): Promise<Pick<PlanCatalog, 'stripePriceMonthly' | 'stripePriceYearly'>> {
    const api = await this.stripe.api();
    const monthlyExisting = await this.loadPrice(api, plan.stripePriceMonthly);
    const yearlyExisting = await this.loadPrice(api, plan.stripePriceYearly);
    const product = await this.ensureProduct(api, plan, monthlyExisting ?? yearlyExisting);
    const stripePriceMonthly = await this.ensurePrice(api, product, plan.code, monthlyExisting, plan.priceMonthlyCents, 'month');
    const stripePriceYearly = await this.ensurePrice(api, product, plan.code, yearlyExisting, plan.priceYearlyCents, 'year');
    await this.refreshPortal(api, plan.code, stripePriceMonthly, stripePriceYearly);
    return { stripePriceMonthly, stripePriceYearly };
  }

  private async loadPrice(api: Stripe, id: string | null): Promise<Stripe.Price | null> {
    if (!id) return null;
    try {
      return await api.prices.retrieve(id);
    } catch {
      return null;
    }
  }

  private async ensureProduct(api: Stripe, plan: PlanCatalog, fromPrice: Stripe.Price | null): Promise<string> {
    const existing = (fromPrice && productIdOf(fromPrice)) || (await this.findProduct(api, plan.code));
    if (!existing) {
      const created = await api.products.create({ name: plan.name, metadata: { planCode: plan.code } });
      return created.id;
    }
    await api.products.update(existing, { name: plan.name, metadata: { planCode: plan.code } });
    return existing;
  }

  private async findProduct(api: Stripe, code: string): Promise<string | null> {
    try {
      const found = await api.products.search({ query: `metadata['planCode']:'${code}'`, limit: 1 });
      return found.data[0]?.id ?? null;
    } catch {
      return null;
    }
  }

  private async ensurePrice(api: Stripe, product: string, code: string, existing: Stripe.Price | null, cents: number, interval: 'month' | 'year'): Promise<string> {
    if (existing && priceFits(existing, cents, interval)) return existing.id;
    const created = await api.prices.create(
      {
        product,
        currency: 'eur',
        unit_amount: cents,
        recurring: { interval },
        tax_behavior: 'exclusive',
        nickname: `${code} ${interval === 'month' ? 'mensual' : 'anual'}`,
        metadata: { planCode: code, interval },
      },
      { idempotencyKey: `plan-price:${code}:${interval}:${cents}` },
    );
    const price = created.active ? created : await api.prices.update(created.id, { active: true });
    if (existing && existing.id !== price.id) {
      await this.moveSubscribers(api, existing.id, price.id);
      await api.prices.update(existing.id, { active: false });
    }
    return price.id;
  }

  /** Pasa las suscripciones que aún cobran el precio anterior. No toca los demás conceptos (add-ons). */
  private async moveSubscribers(api: Stripe, fromPrice: string, toPrice: string) {
    let startingAfter: string | undefined;
    const items: string[] = [];
    for (;;) {
      const page = await api.subscriptions.list({ price: fromPrice, status: 'all', limit: 100, starting_after: startingAfter });
      for (const sub of page.data) {
        if (CLOSED.has(sub.status)) continue;
        const item = sub.items.data.find((i) => i.price.id === fromPrice);
        if (item) items.push(item.id);
      }
      if (!page.has_more || !page.data.length) break;
      startingAfter = page.data[page.data.length - 1].id;
    }
    for (const id of items) {
      await api.subscriptionItems.update(id, { price: toPrice, proration_behavior: 'none' });
    }
  }

  /** El portal de cliente ofrece los precios vigentes para cambiar de plan. Si no hay portal, no hace nada. */
  private async refreshPortal(api: Stripe, code: string, monthly: string, yearly: string) {
    try {
      const configs = await api.billingPortal.configurations.list({ is_default: true, limit: 1 });
      const cfg = configs.data[0];
      const update = cfg?.features.subscription_update;
      if (!cfg || !update?.enabled) return;
      const plans = await this.db.system.plan.findMany({
        where: { active: true, code: { not: 'FREE' } },
        select: { code: true, stripePriceMonthly: true, stripePriceYearly: true },
      });
      const products = new Map<string, string[]>();
      for (const plan of plans) {
        const ids = plan.code === code ? [monthly, yearly] : [plan.stripePriceMonthly, plan.stripePriceYearly];
        for (const id of ids) {
          if (!id) continue;
          const price = await this.loadPrice(api, id);
          const product = price && productIdOf(price);
          if (!product) continue;
          const list = products.get(product) ?? [];
          if (!list.includes(id)) list.push(id);
          products.set(product, list);
        }
      }
      if (!products.size) return;
      await api.billingPortal.configurations.update(cfg.id, {
        features: {
          subscription_update: {
            enabled: true,
            products: [...products.entries()].map(([product, prices]) => ({ product, prices })),
            default_allowed_updates: update.default_allowed_updates,
            proration_behavior: update.proration_behavior,
          },
        },
      });
    } catch (e) {
      this.logger.warn(`No se pudo actualizar el portal de Stripe: ${(e as Error).message}`);
    }
  }
}
