import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PageHeader } from '../components/PageHeader';
import { helpRouteTopics, resolveHelpTopic } from '../help/catalog';
import { NAV } from '../nav';
import { makeSession, renderWithProviders } from './utils';

describe('ayuda contextual', () => {
  it('resuelve el topic por prefijo más largo (detalle → listado)', () => {
    expect(resolveHelpTopic('/events/abc-123')?.id).toBe('events');
    expect(resolveHelpTopic('/members')?.id).toBe('members');
    expect(resolveHelpTopic('/archive/obra-1')?.id).toBe('archive');
    expect(resolveHelpTopic('/')).toMatchObject({ id: 'home' });
    expect(resolveHelpTopic('/admin/users')).toBeNull();
    expect(resolveHelpTopic('/no-existe')).toBeNull();
  });

  it('cubre todas las rutas del menú de banda salvo Panel global', () => {
    const tenantTos = NAV.flatMap((g) => g.items.map((i) => i.to)).filter((to) => to !== '/admin');
    for (const to of tenantTos) {
      expect(resolveHelpTopic(to), `sin ayuda para ${to}`).not.toBeNull();
    }
    for (const { path, topic } of helpRouteTopics()) {
      expect(resolveHelpTopic(path)?.id).toBe(topic);
    }
  });

  it('muestra el botón Cómo funciona y abre el drawer', async () => {
    renderWithProviders(<PageHeader title="Miembros" description="Censo" />, { route: '/members' });
    const btn = screen.getByRole('button', { name: /Cómo funciona/i });
    await userEvent.click(btn);
    expect(screen.getByRole('dialog', { name: /Cómo funciona · Miembros/i })).toBeInTheDocument();
    expect(screen.getByText(/Censo de socios/i)).toBeInTheDocument();
  });

  it('no muestra el botón en rutas sin artículo', () => {
    renderWithProviders(<PageHeader title="Desconocida" />, { route: '/ruta-sin-ayuda' });
    expect(screen.queryByRole('button', { name: /Cómo funciona/i })).not.toBeInTheDocument();
  });

  it('abre con ?ayuda=1 y limpia la query', async () => {
    renderWithProviders(<PageHeader title="Archivo" />, { route: '/archive?ayuda=1' });
    expect(await screen.findByRole('dialog', { name: /Cómo funciona · Archivo musical/i })).toBeInTheDocument();
  });

  it('enlace a soporte si el usuario puede abrir incidencias', async () => {
    renderWithProviders(<PageHeader title="Inicio" />, {
      route: '/',
      session: makeSession({ permissions: ['incidents:write'] }),
    });
    await userEvent.click(screen.getByRole('button', { name: /Cómo funciona/i }));
    expect(screen.getByRole('link', { name: /Abre una incidencia de soporte/i })).toHaveAttribute('href', '/incidents');
  });
});
