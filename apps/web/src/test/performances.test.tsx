import { screen } from '@testing-library/react';
import { computeTotals, parseQuantity, withholding } from '../components/performances/totals';
import ReinforcementsPage from '../pages/Reinforcements';
import { makeSession, renderWithProviders } from './utils';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/reinforcements/requests')) return json({ data: [], total: 0, page: 1, pageSize: 20 });
      if (url.includes('/reinforcements/profile')) return json({ profile: null });
      return json([]);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('Totales de presupuestos y retenciones', () => {
  it('redondea por línea y aplica el impuesto sobre la base, como el servidor', () => {
    expect(computeTotals([{ quantity: 1.5, unitCents: 333 }, { quantity: 2, unitCents: 10_000 }], 21)).toEqual({ baseCents: 20_500, taxCents: 4305, totalCents: 24_805 });
    expect(parseQuantity('1,25')).toBe(1.25);
  });
  it('calcula retención y neto', () => {
    expect(withholding(20_000, 15)).toEqual({ withholdingCents: 3000, netCents: 17_000 });
  });
});

describe('Bolsa de refuerzos', () => {
  it('un músico sin permiso de gestión sólo ve sus pestañas', async () => {
    renderWithProviders(<ReinforcementsPage />);
    expect(await screen.findByRole('tab', { name: 'Necesidades abiertas' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Mi perfil de músico' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Pagos' })).not.toBeInTheDocument();
  });
  it('con reinforcements:manage aparecen las pestañas de gestión', async () => {
    renderWithProviders(<ReinforcementsPage />, { session: makeSession({ permissions: ['events:read', 'reinforcements:manage'] }) });
    expect(await screen.findByRole('tab', { name: 'Nuestras necesidades' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Músicos' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Pagos' })).toBeInTheDocument();
  });
});
