import { screen } from '@testing-library/react';
import { AppShell } from '../components/AppShell';
import { makeSession, renderWithProviders } from './utils';

const GUIDE = {
  dismissed: false,
  steps: [
    { id: 'band', title: 'Completa la ficha de la banda', detail: 'Ficha', to: '/settings', done: false },
    { id: 'security', title: 'Activa la verificación en dos pasos', detail: 'Cuenta', to: '/security', done: true },
  ],
};

function stubFetch(guide = GUIDE) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      const body = url.includes('/setup-guide') ? guide : url.includes('/brand') ? { hasLogo: false, version: null } : [];
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
}

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('guía de puesta en marcha', () => {
  it('abre el modal al entrar el propietario y deja un aviso para continuar', async () => {
    stubFetch();
    const session = makeSession({
      role: { id: 'r1', key: 'owner', name: 'Propietario' },
      permissions: ['tenant:manage', 'users:manage'],
    });
    renderWithProviders(<AppShell>contenido</AppShell>, { session });
    expect(await screen.findByRole('dialog', { name: 'Pon la banda en marcha' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'No volver a mostrar al entrar' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Avisos: 0 sin leer, 1 paso de configuración' })).toBeInTheDocument();
  });

  it('no abre la guía si el propietario pidió no volver a verla', async () => {
    stubFetch({ ...GUIDE, dismissed: true });
    const session = makeSession({ role: { id: 'r1', key: 'owner', name: 'Propietario' } });
    renderWithProviders(<AppShell>contenido</AppShell>, { session });
    expect(await screen.findByRole('link', { name: 'Avisos: 0 sin leer, 1 paso de configuración' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('un músico no ve la guía', () => {
    stubFetch();
    renderWithProviders(<AppShell>contenido</AppShell>);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
