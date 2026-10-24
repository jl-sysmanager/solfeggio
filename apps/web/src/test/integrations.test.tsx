import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import type { IntegrationCategory, IntegrationProvider } from '../api/types';
import { IntegrationsTab, fieldErrors, payload } from '../pages/AdminIntegrations';
import { makeSession, renderWithProviders } from './utils';

const smtp: IntegrationProvider = {
  id: 'smtp',
  label: 'SMTP',
  description: '',
  fields: [
    { key: 'host', label: 'Servidor', type: 'text', required: true },
    { key: 'port', label: 'Puerto', type: 'number' },
    { key: 'replyTo', label: 'Responder a', type: 'email' },
    { key: 'tls', label: 'TLS', type: 'boolean' },
    { key: 'password', label: 'Contraseña', type: 'secret' },
    { key: 'token', label: 'Token', type: 'secret' },
  ],
};

function form(html: string) {
  const f = document.createElement('form');
  f.innerHTML = html;
  return f;
}

describe('payload de integraciones', () => {
  it('envía la config completa y sólo los secretos escritos o marcados para borrar', () => {
    const f = form(`
      <input name="enabled" type="checkbox" checked />
      <input name="f_host" value=" smtp.banda.es " />
      <input name="f_port" value="587" />
      <input name="f_replyTo" value="" />
      <input name="f_tls" type="checkbox" />
      <input name="f_password" value="" />
      <input name="clear_password" type="checkbox" checked />
      <input name="f_token" value="nuevo-token" />`);
    expect(payload(f, smtp)).toEqual({
      provider: 'smtp',
      enabled: true,
      config: { host: 'smtp.banda.es', port: 587, replyTo: null, tls: false },
      secrets: { password: null, token: 'nuevo-token' },
    });
  });

  it('un secreto vacío sin marcar se omite (se conserva en el servidor)', () => {
    const f = form(`<input name="f_host" value="h" /><input name="f_password" value="" />`);
    const body = payload(f, smtp);
    expect(body.enabled).toBe(false);
    expect(body.secrets).toEqual({});
  });
});

function category(id: IntegrationCategory['id'], group?: IntegrationCategory['group']): IntegrationCategory {
  return {
    id,
    group: group as IntegrationCategory['group'],
    label: id === 'payments' ? 'Pagos y suscripciones' : 'Envío de correo',
    description: 'Descripción',
    disabledBehavior: 'No se usa.',
    providers: [{ id: 'stripe', label: 'Stripe', description: '', fields: [{ key: 'secretKey', label: 'Clave secreta', type: 'secret', required: true }] }],
    current: { source: 'none', provider: null, enabled: false, config: {}, secrets: {}, updatedAt: null, updatedBy: null },
  };
}

describe('pantalla de integraciones', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('muestra los formularios aunque la respuesta no traiga grupo', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const body = String(url).includes('/audit-logs') ? { data: [], total: 0, page: 1, pageSize: 20 } : [category('payments'), category('email')];
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    renderWithProviders(<IntegrationsTab />, { session: makeSession({ user: { id: 'a1', email: 'admin@test', name: 'Admin', mfaEnabled: false, isPlatformAdmin: true } }) });
    expect(await screen.findByRole('heading', { name: 'Pagos y suscripciones' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Guardar' })).toHaveLength(2);
    expect(screen.getAllByLabelText(/Clave secreta/)).toHaveLength(2);
  });

  it('agrupa las categorías cuando la API envía el grupo', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const body = String(url).includes('/audit-logs') ? { data: [], total: 0, page: 1, pageSize: 20 } : [category('payments', 'income'), category('email', 'communication')];
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    renderWithProviders(<IntegrationsTab />, { session: makeSession({ user: { id: 'a1', email: 'admin@test', name: 'Admin', mfaEnabled: false, isPlatformAdmin: true } }) });
    expect(await screen.findByRole('heading', { name: 'Ingresos' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Comunicación' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Guardar' })).toHaveLength(2));
  });
});

describe('errores por campo', () => {
  it('mapea los detalles del API a la clave del campo', () => {
    const e = new ApiError(400, 'Configuración no válida', 'VALIDATION_ERROR', [
      { path: 'config.host', message: 'Obligatorio para habilitar' },
      { path: 'secrets.password', message: 'Formato no válido' },
    ]);
    expect(fieldErrors(e)).toEqual({ host: 'Obligatorio para habilitar', password: 'Formato no válido' });
    expect(fieldErrors(new Error('x'))).toEqual({});
  });
});
