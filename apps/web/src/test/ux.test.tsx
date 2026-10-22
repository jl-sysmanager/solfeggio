import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppShell } from '../components/AppShell';
import { initials } from '../components/Avatar';
import { Menu } from '../components/Menu';
import { makeSession, renderWithProviders } from './utils';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })));
});
afterEach(() => vi.unstubAllGlobals());

describe('Avatar', () => {
  it('calcula iniciales de nombre y apellido', () => {
    expect(initials('Lucía García Pérez')).toBe('LP');
    expect(initials('García Pérez, Lucía')).toBe('GL');
    expect(initials('Ana')).toBe('AN');
    expect(initials('')).toBe('?');
  });
});

describe('Menu (patrón menu button)', () => {
  it('se abre con teclado, navega con flechas, ejecuta y devuelve el foco', async () => {
    const user = userEvent.setup();
    const edit = vi.fn();
    const remove = vi.fn();
    renderWithProviders(
      <Menu
        label="Acciones de Lucía"
        items={[
          { label: 'Editar', onSelect: edit },
          { label: 'Dar de baja', onSelect: remove, danger: true },
        ]}
      />,
    );
    const button = screen.getByRole('button', { name: 'Acciones de Lucía' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    button.focus();
    await user.keyboard('{Enter}');
    await act(() => new Promise((r) => requestAnimationFrame(r)));
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitem', { name: 'Editar' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Dar de baja' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Editar' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    await user.click(button);
    await user.click(screen.getByRole('menuitem', { name: 'Dar de baja' }));
    expect(remove).toHaveBeenCalledOnce();
    expect(edit).not.toHaveBeenCalled();
  });
});

describe('Paleta de comandos', () => {
  it('se abre con Ctrl+K, filtra sin tildes y respeta los permisos', async () => {
    const user = userEvent.setup();
    const session = makeSession({ permissions: ['archive:read', 'events:read', 'members:read'] });
    renderWithProviders(<AppShell>x</AppShell>, { session });
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = await screen.findByRole('combobox', { name: /buscar módulos/i });
    await act(() => new Promise((r) => requestAnimationFrame(r)));
    expect(input).toHaveFocus();
    await user.type(input, 'musica');
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toContain('Archivo musical');
    expect(options).not.toContain('Tesorería');
    // Búsqueda de datos en los módulos permitidos
    expect(options).toEqual(expect.arrayContaining(['Buscar «musica» en socios', 'Buscar «musica» en el archivo']));
    expect(input).toHaveAttribute('aria-activedescendant');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Buscar y navegar' })).not.toBeInTheDocument();
  });

  it('sin permiso de socios no ofrece buscar en socios', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppShell>x</AppShell>, { session: makeSession({ permissions: ['archive:read'] }) });
    await user.click(screen.getByRole('button', { name: /buscar y navegar/i }));
    await user.type(await screen.findByRole('combobox'), 'ana');
    expect(screen.queryByText('Buscar «ana» en socios')).not.toBeInTheDocument();
  });
});

describe('Shell', () => {
  it('el menú de usuario agrupa seguridad, tema y cierre de sesión', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppShell>x</AppShell>);
    await user.click(screen.getByRole('button', { name: /^Menú de / }));
    const items = screen.getAllByRole('menuitem').map((i) => i.textContent);
    expect(items[0]).toBe('Seguridad de la cuenta');
    expect(items.at(-1)).toBe('Cerrar sesión');
    expect(items.some((t) => t?.startsWith('Tema'))).toBe(true);
  });
});
