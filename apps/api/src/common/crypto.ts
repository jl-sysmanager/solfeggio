import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { env } from '../config/env';

const VERSION = 'v1';

function key(): Buffer {
  return Buffer.from(env().DATA_ENCRYPTION_KEY, 'base64');
}

/** Durante una rotación de clave se intenta primero la actual y después la anterior. */
function keys(): Buffer[] {
  const prev = env().DATA_ENCRYPTION_KEY_PREVIOUS;
  return prev ? [key(), Buffer.from(prev, 'base64')] : [key()];
}

/**
 * AES-256-GCM. Formato: v1:<iv>:<tag>:<ciphertext> (base64url).
 * `aad` (opcional) liga el cifrado a un contexto, p. ej. la categoría de una integración: descifrar
 * con otro contexto falla.
 */
export function encrypt(plain: string | null | undefined, aad?: string): string | null {
  if (plain === null || plain === undefined || plain === '') return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), data.toString('base64url')].join(':');
}

export function decrypt(payload: string | null | undefined, aad?: string): string | null {
  if (!payload) return null;
  const [version, iv, tag, data] = payload.split(':');
  if (version !== VERSION) throw new Error('Formato de cifrado desconocido');
  let lastError: unknown;
  for (const k of keys()) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64url'));
      if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Hash con sal para pseudonimizar IPs/identificadores en logs y auditoría. */
export function pseudonymize(value: string | undefined | null): string | null {
  if (!value) return null;
  return createHmac('sha256', env().LOG_HASH_SALT).update(value).digest('hex').slice(0, 16);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Enmascara un valor sensible para mostrarlo parcialmente (p. ej. IBAN). */
export function mask(value: string | null, visible = 4): string | null {
  if (!value) return null;
  return value.length <= visible ? '*'.repeat(value.length) : '•'.repeat(value.length - visible) + value.slice(-visible);
}
