import { computeFeatures, hasPaidSubscription, isFreePlan, planIsActive } from './entitlements';

const free = { priceMonthlyCents: 0, priceYearlyCents: 0, features: ['members', 'archive'] };
const basic = { priceMonthlyCents: 900, priceYearlyCents: 9000, features: ['members', 'archive', 'treasury'] };
const FREE_FEATURES = ['members', 'archive'];

describe('entitlements', () => {
  it('detecta plan Free por precio cero', () => {
    expect(isFreePlan(free)).toBe(true);
    expect(isFreePlan(basic)).toBe(false);
  });

  it('considera pagado complimentary o suscripción viva', () => {
    expect(hasPaidSubscription({ complimentaryUntil: new Date(Date.now() + 60_000), subscription: null })).toBe(true);
    expect(hasPaidSubscription({ complimentaryUntil: null, subscription: { stripeSubscriptionId: 'sub_1', stripeStatus: 'trialing' } })).toBe(true);
    expect(hasPaidSubscription({ complimentaryUntil: null, subscription: { stripeSubscriptionId: 'sub_1', stripeStatus: 'canceled' } })).toBe(false);
    expect(hasPaidSubscription({ complimentaryUntil: null, subscription: null })).toBe(false);
  });

  it('plan de pago sin pagar sólo da features Free', () => {
    const t = { addons: ['school'], complimentaryUntil: null, plan: basic, subscription: null };
    expect(planIsActive(t)).toBe(false);
    expect([...computeFeatures(t, FREE_FEATURES)].sort()).toEqual(['archive', 'members']);
  });

  it('plan de pago con suscripción activa da features del plan y add-ons', () => {
    const t = {
      addons: ['school', 'sso'],
      complimentaryUntil: null,
      plan: { ...basic, features: [...basic.features, 'legacy_gone'] },
      subscription: { stripeSubscriptionId: 'sub_1', stripeStatus: 'active' },
    };
    expect([...computeFeatures(t, FREE_FEATURES)].sort()).toEqual(['archive', 'members', 'school', 'treasury']);
  });
});
