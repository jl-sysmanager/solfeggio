import { InsightsService } from './insights.service';

const integrations = { get: async () => ({ config: { schoolAddonAmountCents: 1500, schoolSeatAmountCents: 100 } }) };
const basic = { status: 'ACTIVE' as const, complimentaryUntil: null, plan: { code: 'BASIC' as const, priceMonthlyCents: 900, priceYearlyCents: 9000, features: ['treasury'] }, subscription: { interval: 'MONTH' as const } };

describe('MRR con add-on Escuela', () => {
  const svc = new InsightsService({} as never, integrations as never);

  it('suma la cuota del add-on y las plazas adicionales al plan', async () => {
    await (svc as unknown as { refreshAddonPrices(): Promise<void> }).refreshAddonPrices();
    expect(svc.mrrOf({ ...basic, addons: [], studentSeats: 0 })).toBe(900);
    expect(svc.mrrOf({ ...basic, addons: ['school'], studentSeats: 10 })).toBe(900 + 1500 + 1000);
  });

  it('no cobra el add-on si el plan ya incluye la escuela ni a cuentas bonificadas', async () => {
    await (svc as unknown as { refreshAddonPrices(): Promise<void> }).refreshAddonPrices();
    const pro = { ...basic, plan: { ...basic.plan, features: ['school'] }, addons: ['school'], studentSeats: 0 };
    expect(svc.mrrOf(pro)).toBe(900);
    expect(svc.mrrOf({ ...pro, complimentaryUntil: new Date(Date.now() + 86_400_000) })).toBe(0);
  });
});
