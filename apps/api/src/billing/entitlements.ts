import type { TenantStatus } from '@prisma/client';
import type { Db } from '../db/db.service';
import { FEATURE_KEYS } from './feature-catalog';

/**
 * Funcionalidades que una banda puede usar de verdad. Las de un plan de pago y los add-ons sólo se
 * activan cuando el plan está pagado: suscripción de Stripe viva (activa, en prueba o con pago
 * pendiente/impagado, que pasa a sólo lectura sin perder datos) o cuenta bonificada vigente. Una
 * banda con un plan de pago sin pagar (plan asignado a mano, pago sin completar) se queda con las
 * funcionalidades del plan Free.
 */
export interface EntitlementTenant {
  status?: TenantStatus;
  addons: string[];
  complimentaryUntil: Date | null;
  plan: { priceMonthlyCents: number; priceYearlyCents: number; features: string[] };
  subscription?: { stripeSubscriptionId: string | null; stripeStatus: string | null } | null;
}

/** Estados de Stripe en los que la suscripción sigue contratada. */
const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'paused']);
const KNOWN = new Set<string>(FEATURE_KEYS);

export const isFreePlan = (plan: { priceMonthlyCents: number; priceYearlyCents: number }) => plan.priceMonthlyCents === 0 && plan.priceYearlyCents === 0;

/** ¿Hay un pago detrás? (suscripción viva o cuenta bonificada). El plan Free no lo necesita, los add-ons sí. */
export function hasPaidSubscription(t: Pick<EntitlementTenant, 'complimentaryUntil' | 'subscription'>, now = new Date()): boolean {
  if (t.complimentaryUntil && t.complimentaryUntil > now) return true;
  const s = t.subscription;
  return !!s?.stripeSubscriptionId && !!s.stripeStatus && LIVE_STATUSES.has(s.stripeStatus);
}

/** ¿Se aplican las funcionalidades del plan asignado? */
export function planIsActive(t: EntitlementTenant, now = new Date()): boolean {
  return isFreePlan(t.plan) || hasPaidSubscription(t, now);
}

const onlyKnown = (features: readonly string[]) => features.filter((f) => KNOWN.has(f));

export function computeFeatures(t: EntitlementTenant, freeFeatures: readonly string[], now = new Date()): Set<string> {
  const paid = hasPaidSubscription(t, now);
  const base = planIsActive(t, now) ? t.plan.features : freeFeatures;
  return new Set([...onlyKnown(base), ...(paid ? onlyKnown(t.addons) : [])]);
}

let freeCache: { features: string[]; at: number } | undefined;

/** Funcionalidades del plan Free (con una caché corta: el panel global puede editarlas). */
export async function freeFeatures(db: Db): Promise<string[]> {
  if (freeCache && Date.now() - freeCache.at < 30_000) return freeCache.features;
  const free = await db.system.plan.findUnique({ where: { code: 'FREE' }, select: { features: true } });
  freeCache = { features: free?.features ?? [], at: Date.now() };
  return freeCache.features;
}

/** Sólo para tests: el panel puede cambiar el plan Free y la caché no debe ocultarlo. */
export function resetEntitlementsCache() {
  freeCache = undefined;
}

export async function featuresFor(db: Db, t: EntitlementTenant): Promise<Set<string>> {
  return computeFeatures(t, await freeFeatures(db));
}
