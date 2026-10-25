import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppShell } from '../components/AppShell';
import { activeGroupLabel } from '../components/useNavSections';
import { NAV } from '../nav';
import { makeSession, renderWithProviders } from './utils';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })));
});
afterEach(() => vi.unstubAllGlobals());

const nav = () => screen.getByRole('navigation', { name: 'Navegación principal' });
const section = (name: string) => within(nav()).getByRole('button', { name: new RegExp(`^${name}`) });

describe('menú lateral con secciones plegables', () => {
  it('cada sección es un botón con aria-expanded que oculta y muestra sus enlaces', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppShell>x</AppShell>, { route: '/' });
    const musica = section('Música');
    expect(musica).toHaveAttribute('aria-expanded', 'true');
    expect(within(nav()).getByRole('link', { name: 'Archivo musical' })).toBeVisible();

    await user.click(musica);
    expect(musica).toHaveAttribute('aria-expanded', 'false');
    expect(within(nav()).queryByRole('link', { name: 'Archivo musical' })).not.toBeInTheDocument();
    expect(document.getElementById(musica.getAttribute('aria-controls')!)).not.toBeVisible();

    await user.keyboard('{Enter}');
    expect(musica).toHaveAttribute('aria-expanded', 'true');
  });

  it('recuerda las secciones plegadas entre sesiones', async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<AppShell>x</AppShell>, { route: '/' });
    await user.click(section('Música'));
    expect(JSON.parse(localStorage.getItem('sf-nav-collapsed')!)).toEqual(['Música']);
    unmount();
    renderWithProviders(<AppShell>x</AppShell>, { route: '/' });
    expect(section('Música')).toHaveAttribute('aria-expanded', 'false');
  });

  it('la sección de la página actual se despliega aunque estuviera plegada', () => {
    localStorage.setItem('sf-nav-collapsed', JSON.stringify(['Música']));
    renderWithProviders(<AppShell>x</AppShell>, { route: '/archive/123' });
    expect(section('Música')).toHaveAttribute('aria-expanded', 'true');
    expect(within(nav()).getByRole('link', { name: 'Archivo musical' })).toHaveAttribute('aria-current', 'page');
  });

  it('contraer todo deja abierta sólo la sección actual y se puede deshacer', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppShell>x</AppShell>, { route: '/archive' });
    await user.click(screen.getByRole('button', { name: 'Contraer las demás secciones' }));
    expect(section('Música')).toHaveAttribute('aria-expanded', 'true');
    expect(section('General')).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('button', { name: 'Desplegar todas las secciones' }));
    expect(section('General')).toHaveAttribute('aria-expanded', 'true');
  });

  it('funciona igual para cualquier rol (también con pocas secciones)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppShell>x</AppShell>, { route: '/', session: makeSession({ permissions: [] }) });
    const buttons = within(nav()).getAllByRole('button', { expanded: true });
    expect(buttons.length).toBeGreaterThan(0);
    await user.click(buttons[0]);
    expect(buttons[0]).toHaveAttribute('aria-expanded', 'false');
  });

  it('la sección activa se calcula por el prefijo más largo', () => {
    expect(activeGroupLabel(NAV, '/')).toBe('General');
    expect(activeGroupLabel(NAV, '/members/42')).toBe('Gestión');
    expect(activeGroupLabel(NAV, '/members')).toBe('Gestión');
    expect(activeGroupLabel(NAV, '/membersx')).toBeUndefined();
  });
});
