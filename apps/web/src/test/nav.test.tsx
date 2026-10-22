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

  describe('menú por rol', () => {
    const labels = (perms: string[]) =>
      visibleItems((p) => p.some((x) => perms.includes(x)), () => true, false).flatMap((g) => g.items.map((i) => i.label));

    it('una familia sólo ve su portal, las notificaciones y la seguridad de la cuenta', () => {
      const l = labels(['school:family']);
      expect(l).toEqual(expect.arrayContaining(['Portal de familias', 'Notificaciones', 'Seguridad de la cuenta']));
      expect(l).not.toContain('Bolsa de refuerzos');
      expect(l).not.toContain('Agenda');
      expect(l).not.toContain('Archivo musical');
    });

    it('el profesorado ve la escuela pero no la secretaría ni la tesorería', () => {
      const l = labels(['archive:read', 'events:read', 'school:read', 'school:teach']);
      expect(l).toEqual(expect.arrayContaining(['Escuela de música', 'Bolsa de refuerzos']));
      expect(l).not.toContain('Socios');
      expect(l).not.toContain('Tesorería');
      expect(l).not.toContain('Portal de familias');
    });

    it('un archivero ve el archivo y los ensayos, no la gestión', () => {
      const l = labels(['archive:read', 'archive:write', 'events:read', 'attendance:self', 'governance:read']);
      expect(l).toEqual(expect.arrayContaining(['Archivo musical', 'Ensayos y actuaciones', 'Gobierno']));
      expect(l).not.toContain('Socios');
      expect(l).not.toContain('Ajustes');
    });
  });

  it('el panel global sólo aparece al administrador de plataforma', () => {
    const can = () => true;
    const has = () => true;
    const flat = (admin: boolean) => visibleItems(can, has, admin).flatMap((g) => g.items.map((i) => i.to));
    expect(flat(false)).not.toContain('/admin');
    expect(flat(true)).toContain('/admin');
  });
});
