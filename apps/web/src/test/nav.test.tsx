import { screen, within } from '@testing-library/react';
import { AppShell } from '../components/AppShell';
import { visibleItems } from '../nav';
import { makeSession, renderWithProviders } from './utils';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })));
});
afterEach(() => vi.unstubAllGlobals());

function navLinks() {
  const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
  return within(nav)
    .getAllByRole('link')
    .map((a) => a.textContent);
}

describe('gating de navegación', () => {
  it('un músico en plan Free no ve tesorería, socios, ajustes ni facturación', () => {
    renderWithProviders(<AppShell>contenido</AppShell>);
    const links = navLinks();
    expect(links).toContain('Archivo musical');
    expect(links).toContain('Ensayos y actuaciones');
    expect(links).not.toContain('Tesorería');
    expect(links).not.toContain('Socios');
    expect(links).not.toContain('Ajustes');
    expect(links).not.toContain('Plan y facturación');
    expect(links).not.toContain('Panel global');
  });

  it('con permiso pero sin funcionalidad en el plan, la entrada se oculta', () => {
    const session = makeSession({ permissions: ['finance:read', 'market:read'] });
    renderWithProviders(<AppShell>x</AppShell>, { session });
    expect(navLinks()).not.toContain('Tesorería');
    expect(navLinks()).not.toContain('BandMarket');
  });

  it('un tesorero en plan Basic ve tesorería', () => {
    const session = makeSession({
      permissions: ['finance:read', 'finance:write', 'members:read'],
      plan: { code: 'BASIC', name: 'Basic', features: ['members', 'archive', 'events', 'attendance', 'treasury'], maxUsers: 15, maxMembers: 100, storageMb: 5120 },
    });
    renderWithProviders(<AppShell>x</AppShell>, { session });
    expect(navLinks()).toEqual(expect.arrayContaining(['Tesorería', 'Socios']));
  });

  it('el panel global sólo aparece al administrador de plataforma', () => {
    const can = () => true;
    const has = () => true;
    const flat = (admin: boolean) => visibleItems(can, has, admin).flatMap((g) => g.items.map((i) => i.to));
    expect(flat(false)).not.toContain('/admin');
    expect(flat(true)).toContain('/admin');
  });
});
