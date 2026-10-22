import type { IntegrationsService } from '../integrations/integrations.service';

/**
 * Cobro del add-on Escuela. Dos conceptos en la suscripción de Stripe, además del precio del plan:
 * - `school_addon`: cuota fija mensual si la banda tiene `school` en `addons` y su plan no lo incluye.
 * - `school_seats`: precio por plaza de alumno adicional (cantidad = `tenant.studentSeats`).
 * Los Price IDs salen de la integración de pagos (o de STRIPE_PRICE_SCHOOL_ADDON / STRIPE_PRICE_SCHOOL_SEAT).
 * Los importes (para métricas) salen de la misma configuración; si no se conocen cuentan como 0.
 */
export interface AddonPrices {
  addonPrice: string | null;
  seatPrice: string | null;
  addonCents: number;
  seatCents: number;
}

export interface AddonTenant {
  addons: string[];
  studentSeats: number;
  plan: { features: string[] };
}

export type AddonKey = 'school_addon' | 'school_seats';

export interface AddonLine {
  key: AddonKey;
  label: string;
  quantity: number;
  unitCents: number;
  priceId: string | null;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);

export async function addonPrices(integrations: IntegrationsService): Promise<AddonPrices> {
  const cfg = (await integrations.get('payments')).config;
  return {
    addonPrice: str(cfg.schoolAddonPrice) ?? str(process.env.STRIPE_PRICE_SCHOOL_ADDON),
    seatPrice: str(cfg.schoolSeatPrice) ?? str(process.env.STRIPE_PRICE_SCHOOL_SEAT),
    addonCents: num(cfg.schoolAddonAmountCents),
    seatCents: num(cfg.schoolSeatAmountCents),
  };
}

/** Conceptos del add-on que corresponden a la banda (sin los que tienen cantidad 0). */
export function addonLines(tenant: AddonTenant, prices: AddonPrices): AddonLine[] {
  const lines: AddonLine[] = [];
  if (tenant.addons.includes('school') && !tenant.plan.features.includes('school')) {
    lines.push({ key: 'school_addon', label: 'Add-on Escuela', quantity: 1, unitCents: prices.addonCents, priceId: prices.addonPrice });
  }
  if (tenant.studentSeats > 0) {
    lines.push({ key: 'school_seats', label: 'Plazas de alumno adicionales', quantity: tenant.studentSeats, unitCents: prices.seatCents, priceId: prices.seatPrice });
  }
  return lines;
}

/** MRR del add-on Escuela en céntimos. Función pura para las métricas de plataforma. */
export function addonMrrCents(tenant: AddonTenant, prices: Pick<AddonPrices, 'addonCents' | 'seatCents'>): number {
  return addonLines(tenant, { addonPrice: null, seatPrice: null, ...prices }).reduce((s, l) => s + l.quantity * l.unitCents, 0);
}

/** Cuenta bonificada vigente. */
export const isComplimentary = (t: { complimentaryUntil: Date | null }, now = new Date()) => !!t.complimentaryUntil && t.complimentaryUntil > now;
