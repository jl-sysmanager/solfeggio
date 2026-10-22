import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '../auth/AuthProvider';
import { ToastProvider } from '../components/Toasts';
import { ImpersonationBanner } from '../components/admin/ImpersonationBanner';
import { HealthTab } from '../components/admin/HealthTab';
import { MetricsTab } from '../components/admin/MetricsTab';
import { CohortTable } from '../components/admin/insights/FunnelAndCohorts';
import { LimitBar, ScoreChip } from '../components/admin/insights/charts';
import { getAccessToken, setAccessToken, setRefreshDisabled } from '../api/client';
import { render } from '@testing-library/react';
import { makeSession, renderWithProviders } from './utils';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const admin = () => makeSession({ user: { id: 'a1', email: 'admin@test', name: 'Admin', mfaEnabled: false, isPlatformAdmin: true }, tenant: null, role: null, permissions: [], plan: null });

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setRefreshDisabled(false);
});

describe('componentes de negocio', () => {
  it('ScoreChip escribe número y etiqueta', () => {
    renderWithProviders(<ScoreChip score={32} />);
    expect(screen.getByText(/En riesgo/)).toBeInTheDocument();
    expect(screen.getByText('32')).toBeInTheDocument();
  });

  it('LimitBar expone un meter con el porcentaje', () => {
    renderWithProviders(<LimitBar limit={{ key: 'users', label: 'Usuarios', used: 4, max: 5, ratio: 0.8 }} />);
    expect(screen.getByRole('meter', { name: 'Uso de Usuarios' })).toHaveAttribute('aria-valuenow', '80');
    expect(screen.getByText(/80 %/)).toBeInTheDocument();
  });

  it('CohortTable muestra porcentajes y guion cuando aún no toca', () => {
    renderWithProviders(<CohortTable rows={[{ month: '2026-01', size: 4, m3: { rate: 0.75, active: 3, known: 4 }, m6: null, m12: null }]} />);
    expect(screen.getByText('75 %')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
  });
});

describe('Pestañas del panel global', () => {
  it('Métricas: KPIs, embudo, cohortes y botón de foto', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('/admin/insights/metrics'))
        return json({
          current: { mrrCents: 12000, arrCents: 144000, arpaCents: 2400, payingTenants: 5, nrr12: 1.05, nrrMonthly: 1.01 },
          months: [{ month: '2026-01', mrrCents: 12000, arrCents: 144000, newCents: 2400, expansionCents: 0, contractionCents: 0, churnedCents: 900, reactivationCents: 0, payingTenants: 5, arpaCents: 2400, nrrMonthly: 0.9, nrr12: null }],
          tenantsByStatus: { ACTIVE: 5 },
          seasonality: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, signups: i === 8 ? 3 : 0, cancellations: 0 })),
        });
      if (url.includes('/admin/insights/funnel')) return json({ from: '2026-01-01', to: '2026-12-31', overall: 0.5, steps: [{ key: 'registered', label: 'Usuarios registrados', count: 10, conversion: null }, { key: 'paid', label: 'Pago', count: 5, conversion: 0.5 }] });
      if (url.includes('/admin/insights/cohorts')) return json([{ month: '2026-01', size: 2, m3: { rate: 1, active: 2, known: 2 }, m6: null, m12: null }]);
      if (url.includes('/admin/insights/snapshot')) return json({ date: '2026-10-22', tenants: 3 });
      if (url.includes('/admin/metrics')) return json({ tenants: { total: 5, byStatus: { ACTIVE: 5 } }, mrrCents: 12000, openIncidents: 0, pendingListings: 0 });
      return json({}, 404);
    }));
    const user = userEvent.setup();
    renderWithProviders(<MetricsTab />, { session: admin() });
    expect(await screen.findByText('Movimientos de MRR')).toBeInTheDocument();
    expect(screen.getByText('105 %')).toBeInTheDocument();
    expect(await screen.findByText('Usuarios registrados')).toBeInTheDocument();
    expect(await screen.findByRole('table', { name: /Porcentaje de bandas activas/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Calcular foto de hoy' }));
    await waitFor(() => expect(calls).toContain('POST /api/v1/admin/insights/snapshot'));
  });

  it('Salud: listas de riesgo y mejora enlazan a la ficha', async () => {
    const row = { id: 't1', name: 'Banda Uno', slug: 'uno', status: 'ACTIVE', planCode: 'FREE', planName: 'Free', tags: [], accountManagerId: null, createdAt: '2026-01-01', mrrCents: 0, score: 30, snapshotDate: '2026-10-22', activeUsers7d: 0, activeUsers30d: 1, usage: {}, modulesUsed: 0, lastActivityAt: null, renewalAt: null, limits: [{ key: 'users', label: 'Usuarios', used: 4, max: 5, ratio: 0.8 }] };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/health')) return json({ data: [row], total: 1, page: 1, pageSize: 25 });
      if (url.includes('/at-risk')) return json([{ ...row, reasons: [{ code: 'inactive', label: 'Sin actividad desde hace 30 días' }] }]);
      if (url.includes('/upsell')) return json([{ ...row, reasons: [{ code: 'limit_users', label: 'Usuarios: 80 % del límite' }], suggestion: { planCode: 'BASIC', addon: null } }]);
      return json({}, 404);
    }));
    renderWithProviders(<HealthTab />, { session: admin() });
    expect(await screen.findByText('Sin actividad desde hace 30 días')).toBeInTheDocument();
    expect(screen.getByText('Usuarios: 80 % del límite')).toBeInTheDocument();
    expect(screen.getByText('Sugerencia: pasar a BASIC')).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: 'Banda Uno' });
    expect(links[0]).toHaveAttribute('href', '/admin/tenants/t1');
  });
});

describe('«Ver como»', () => {
  function Starter({ token }: { token: string }) {
    const { startImpersonation } = useAuth();
    useEffect(() => {
      void startImpersonation(token);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
  }
  const impSession = (minutes: number) => ({
    ...makeSession({ role: { id: 'impersonation', key: 'impersonation', name: 'Ver como (solo lectura)' } }),
    impersonation: { sessionId: 's1', tenantName: 'Banda de Prueba', expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(), reason: 'Revisar incidencia' },
  });

  it('cambia el token, muestra el aviso con cuenta atrás y al salir restaura la cuenta del administrador', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/auth/me')) return json(impSession(30));
      if (url.endsWith('/impersonation/end')) return json({ id: 's1' });
      if (url.endsWith('/auth/refresh')) return json({ accessToken: 'admin-token' });
      return json({}, 404);
    }));
    const qc = new QueryClient();
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <MemoryRouter>
            <AuthProvider initialSession={admin()}>
              <Starter token="imp-token" />
              <ImpersonationBanner />
            </AuthProvider>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent('Viendo «Banda de Prueba» como plataforma · solo lectura · quedan 30 min');
    expect(getAccessToken()).toBe('imp-token');
    await user.click(screen.getByRole('button', { name: 'Salir' }));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(calls).toContain('POST /api/v1/impersonation/end');
    expect(getAccessToken()).toBe('admin-token');
  });

  it('una sesión caducada se cierra sola', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/auth/me')) return json(impSession(-1));
      if (url.endsWith('/impersonation/end')) return json({ id: 's1' });
      if (url.endsWith('/auth/refresh')) return json({ accessToken: 'admin-token' });
      return json({}, 404);
    }));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <MemoryRouter>
            <AuthProvider initialSession={admin()}>
              <Starter token="imp-token" />
              <ImpersonationBanner />
            </AuthProvider>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(getAccessToken()).toBe('admin-token'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await act(async () => {});
  });
});
