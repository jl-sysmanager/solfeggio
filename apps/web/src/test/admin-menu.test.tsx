import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { Tabs, UrlTabs } from '../components/Tabs';
import { ADMIN_NAV, adminMenu } from '../nav';
import { makeSession, renderWithProviders } from './utils';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const adminUser = { id: 'a1', email: 'admin@test', name: 'Admin', mfaEnabled: false, isPlatformAdmin: true };
const tenantless = () => makeSession({ user: adminUser, tenant: null, role: null, permissions: [], plan: null, memberships: [] });

function stubApi(summary = { support: { open: 3, overdue: 1 }, moderation: { pending: 2 } }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => (String(url).includes('/admin/summary') ? json(summary) : json([]))),
  );
}
afterEach(() => vi.unstubAllGlobals());

const links = () => within(screen.getByRole('navigation', { name: 'Navegación principal' })).getAllByRole('link');

describe('menú del panel global', () => {
  it('cada entrada es una ruta propia bajo /admin y no hay rutas repetidas', () => {
    const to = ADMIN_NAV.flatMap((g) => g.items.map((i) => i.to));
    expect(to.every((t) => /^\/admin\/[a-z]+$/.test(t))).toBe(true);
    expect(new Set(to).size).toBe(to.length);
  });

  it('un administrador sin banda sólo tiene el menú del panel: nada de «Inicio» ni «Notificaciones»', async () => {
    stubApi();
    renderWithProviders(<AppShell>contenido</AppShell>, { session: tenantless(), route: '/security' });
    const labels = links().map((a) => a.textContent ?? '');
    expect(labels.some((l) => l.startsWith('Métricas'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Seguridad de la cuenta'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Inicio'))).toBe(false);
    expect(labels.some((l) => l.startsWith('Notificaciones'))).toBe(false);
    // Todos los enlaces del menú apuntan a rutas que existen para este usuario.
    for (const a of links().filter((l) => !l.classList.contains('brand'))) expect(a.getAttribute('href')).toMatch(/^\/(admin\/[a-z]+|security)$/);
  });

  it('muestra los pendientes de soporte (fuera de plazo en rojo) y de moderación', async () => {
    stubApi();
    renderWithProviders(<AppShell>x</AppShell>, { session: tenantless(), route: '/admin/support' });
    const support = await screen.findByLabelText('3 abiertas, 1 fuera de plazo');
    expect(support).toHaveClass('sidenav__count--alert');
    expect(screen.getByLabelText('2 pendientes')).toBeInTheDocument();
  });

  it('con banda, el panel ofrece volver a ella y la banda sigue con su menú', async () => {
    stubApi();
    const withBand = makeSession({ user: adminUser });
    expect(adminMenu({ hasTenant: true, hasMemberships: true }).flatMap((g) => g.items).some((i) => i.to === '/' && i.label === 'Volver a mi banda')).toBe(true);
    expect(adminMenu({ hasTenant: false, hasMemberships: true }).flatMap((g) => g.items).some((i) => i.to === '/select-band')).toBe(true);
    expect(adminMenu({ hasTenant: false, hasMemberships: false }).flatMap((g) => g.items).some((i) => i.to === '/' || i.to === '/select-band')).toBe(false);

    renderWithProviders(<AppShell>x</AppShell>, { session: withBand, route: '/members' });
    const labels = links().map((a) => a.textContent ?? '');
    expect(labels.some((l) => l.startsWith('Inicio'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Panel global'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Métricas'))).toBe(false);
  });
});

describe('pestañas en la URL', () => {
  function Where() {
    const l = useLocation();
    return <p data-testid="where">{l.pathname + l.search}</p>;
  }
  const tabs = [
    { id: 'a', label: 'Primera', content: <p>Contenido A</p> },
    { id: 'b', label: 'Segunda', content: <p>Contenido B</p> },
  ];

  it('abren la pestaña de ?tab= y la reflejan al cambiar', async () => {
    renderWithProviders(
      <Routes>
        <Route path="*" element={<><Where /><UrlTabs label="Prueba" tabs={tabs} /></>} />
      </Routes>,
      { route: '/x?tab=b' },
    );
    expect(screen.getByText('Contenido B')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Primera' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/x'));
    expect(screen.getByTestId('where').textContent).toBe('/x');
    expect(screen.getByText('Contenido A')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Segunda' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/x?tab=b'));
  });

  it('un valor desconocido cae en la primera y Tabs sin controlar sigue funcionando', async () => {
    renderWithProviders(<UrlTabs label="Prueba" tabs={tabs} />, { route: '/x?tab=zzz' });
    expect(screen.getByText('Contenido A')).toBeInTheDocument();
    renderWithProviders(<Tabs label="Libres" tabs={tabs} />);
    expect(screen.getAllByText('Contenido A').length).toBeGreaterThan(0);
  });
});
