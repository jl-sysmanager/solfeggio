import { BadRequestException } from '@nestjs/common';
import type { Db } from '../db/db.service';
import type { StripeClient } from './stripe.provider';
import { PlanSync, type PlanCatalog } from './plan-sync';

const basic: PlanCatalog = {
  code: 'BASIC',
  name: 'Basic',
  priceMonthlyCents: 1500,
  priceYearlyCents: 15000,
  stripePriceMonthly: 'price_month',
  stripePriceYearly: 'price_year',
};

function price(id: string, cents: number, interval: 'month' | 'year', active = true) {
  return { id, active, unit_amount: cents, currency: 'eur', recurring: { interval }, product: 'prod_basic' };
}

function harness(opts: { enabled?: boolean; monthlyCents?: number; subs?: { id: string; status: string; itemId: string; priceId: string }[] } = {}) {
  const updates: { id: string; price?: string; proration_behavior?: string; active?: boolean }[] = [];
  const created: { unit_amount?: number; interval?: string }[] = [];
  const api = {
    products: {
      search: async () => ({ data: [{ id: 'prod_basic' }] }),
      create: async (p: { name: string }) => ({ id: 'prod_new', name: p.name }),
      update: async () => ({ id: 'prod_basic' }),
    },
    prices: {
      retrieve: async (id: string) => {
        if (id === 'price_month') return price(id, opts.monthlyCents ?? 1500, 'month');
        if (id === 'price_year') return price(id, 15000, 'year');
        return price(id, 0, 'month');
      },
      create: async (p: { unit_amount: number; recurring: { interval: string } }) => {
        created.push({ unit_amount: p.unit_amount, interval: p.recurring.interval });
        return price(`price_${p.recurring.interval}_new`, p.unit_amount, p.recurring.interval as 'month' | 'year');
      },
      update: async (id: string, data: { active?: boolean }) => {
        updates.push({ id, ...data });
        return price(id, 0, 'month', data.active ?? true);
      },
    },
    subscriptions: {
      list: async () => ({
        data: (opts.subs ?? []).map((s) => ({ id: s.id, status: s.status, items: { data: [{ id: s.itemId, price: { id: s.priceId } }] } })),
        has_more: false,
      }),
    },
    subscriptionItems: {
      update: async (id: string, data: { price: string; proration_behavior: string }) => {
        updates.push({ id, ...data });
        return { id };
      },
    },
    billingPortal: { configurations: { list: async () => ({ data: [] }), update: async () => ({}) } },
  };
  const stripe = { enabled: async () => opts.enabled ?? true, api: async () => api } as unknown as StripeClient;
  const db = { system: { plan: { findMany: async () => [] } } } as unknown as Db;
  return { sync: new PlanSync(stripe, db), updates, created };
}

describe('PlanSync', () => {
  it('no llama a Stripe si sólo cambian datos que no se cobran y ya hay precios', async () => {
    const { sync, created } = harness({ enabled: false });
    const ids = await sync.publish(basic, basic);
    expect(ids).toEqual({ stripePriceMonthly: 'price_month', stripePriceYearly: 'price_year' });
    expect(created).toHaveLength(0);
  });

  it('exige Stripe para cambiar el precio de un plan de pago', async () => {
    const { sync } = harness({ enabled: false });
    await expect(sync.publish(basic, { ...basic, priceMonthlyCents: 2000 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('crea el precio nuevo y mueve la suscripción sin prorrateo', async () => {
    const { sync, updates, created } = harness({
      monthlyCents: 1500,
      subs: [{ id: 'sub_1', status: 'active', itemId: 'si_1', priceId: 'price_month' }],
    });
    const ids = await sync.publish(basic, { ...basic, priceMonthlyCents: 2000 });
    expect(created).toEqual([{ unit_amount: 2000, interval: 'month' }]);
    expect(ids.stripePriceMonthly).toBe('price_month_new');
    expect(ids.stripePriceYearly).toBe('price_year');
    expect(updates).toContainEqual({ id: 'si_1', price: 'price_month_new', proration_behavior: 'none' });
    expect(updates).toContainEqual({ id: 'price_month', active: false });
  });

  it('conserva el precio si el importe no ha cambiado', async () => {
    const { sync, created } = harness();
    const ids = await sync.publish(basic, { ...basic, name: 'Básico' });
    expect(ids.stripePriceMonthly).toBe('price_month');
    expect(created).toHaveLength(0);
  });

  it('no publica el plan Free', async () => {
    const { sync, created } = harness();
    const free: PlanCatalog = { ...basic, code: 'FREE', priceMonthlyCents: 0, priceYearlyCents: 0 };
    const ids = await sync.publish(free, free);
    expect(ids).toEqual({ stripePriceMonthly: null, stripePriceYearly: null });
    expect(created).toHaveLength(0);
  });
});
