import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { LoginPage } from '../pages/Auth';
import { renderWithProviders } from './utils';

function renderLogin() {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<h1>Alta de cuenta</h1>} />
    </Routes>,
    { route: '/login' },
  );
}

describe('elección de entrada', () => {
  it('muestra entrar y crear, y cambia el panel al elegir crear', async () => {
    const user = userEvent.setup();
    renderLogin();
    expect(screen.getByRole('heading', { name: 'Entra o crea tu banda' })).toBeInTheDocument();
    const enter = screen.getByRole('radio', { name: /Entrar en mi banda/ });
    const create = screen.getByRole('radio', { name: /Crear una banda/ });
    expect(enter).toHaveAttribute('aria-checked', 'true');
    expect(create).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByLabelText(/Contraseña/)).toBeInTheDocument();

    await user.click(create);
    expect(create).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByLabelText(/Contraseña/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Crear la banda' })).toHaveAttribute('href', '/register');
    expect(screen.getByText(/Si te han invitado/)).toBeInTheDocument();
  });
});
