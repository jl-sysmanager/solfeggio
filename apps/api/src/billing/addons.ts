import type { IntegrationsService } from '../integrations/integrations.service';

/**
 * Antiguo cobro del «add-on Escuela» (cuota fija + plazas). La escuela es una funcionalidad del
 * plan; estos conceptos ya no se facturan. `addonLines` devuelve vacío para que `syncAddons`
 * retire de Stripe cualquier ítem residual `school_addon` / `school_seats`.
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

/** Precios legacy (sólo para reconocer y retirar ítems viejos en Stripe). */
export async function addonPrices(integrations: IntegrationsService): Promise<AddonPrices> {
  const cfg = (await integrations.get('payments')).config;
  return {
    addonPrice: str(cfg.schoolAddonPrice) ?? str(process.env.STRIPE_PRICE_SCHOOL_ADDON),
    seatPrice: str(cfg.schoolSeatPrice) ?? str(process.env.STRIPE_PRICE_SCHOOL_SEAT),
    addonCents: num(cfg.schoolAddonAmountCents),
    seatCents: num(cfg.schoolSeatAmountCents),
  };
}

/** Sin conceptos facturables: la escuela va en el plan. */
export function addonLines(_tenant: AddonTenant, _prices: AddonPrices): AddonLine[] {
  return [];
}

export function addonMrrCents(_tenant: AddonTenant, _prices: Pick<AddonPrices, 'addonCents' | 'seatCents'>): number {
  return 0;
}

/** Cuenta bonificada vigente. */
export const isComplimentary = (t: { complimentaryUntil: Date | null }, now = new Date()) => !!t.complimentaryUntil && t.complimentaryUntil > now;
