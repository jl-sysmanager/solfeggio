import { InsightsService } from './insights.service';

const integrations = { get: async () => ({ config: {} }) };
const basic = { status: 'ACTIVE' as const, complimentaryUntil: null, plan: { code: 'BASIC' as const, priceMonthlyCents: 900, priceYearlyCents: 9000, features: ['treasury'] }, subscription: { interval: 'MONTH' as const } };

describe('MRR del plan', () => {
  const svc = new InsightsService({} as never, integrations as never);

  it('usa el precio del plan sin conceptos de add-on Escuela', async () => {
    await (svc as unknown as { refreshAddonPrices(): Promise<void> }).refreshAddonPrices();
    expect(svc.mrrOf({ ...basic, addons: [], studentSeats: 0 })).toBe(900);
    expect(svc.mrrOf({ ...basic, addons: ['school'], studentSeats: 10 })).toBe(900);
  });

  it('las cuentas bonificadas no aportan MRR', async () => {
    await (svc as unknown as { refreshAddonPrices(): Promise<void> }).refreshAddonPrices();
    expect(svc.mrrOf({ ...basic, complimentaryUntil: new Date(Date.now() + 86_400_000) })).toBe(0);
  });
});
