import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import type { IntegrationProvider } from '../api/types';
import { fieldErrors, payload } from '../pages/AdminIntegrations';

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
