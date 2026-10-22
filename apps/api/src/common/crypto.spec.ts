import { resetEnvCache } from '../config/env';
import { decrypt, encrypt, mask, pseudonymize } from './crypto';

describe('crypto', () => {
  afterEach(() => {
    delete process.env.DATA_ENCRYPTION_KEY_PREVIOUS;
    resetEnvCache();
  });

  it('cifra con IV aleatorio y descifra', () => {
    const a = encrypt('ES9121000418450200051332')!;
    const b = encrypt('ES9121000418450200051332')!;
    expect(a).not.toBe(b);
    expect(a.startsWith('v1:')).toBe(true);
    expect(decrypt(a)).toBe('ES9121000418450200051332');
  });

  it('detecta manipulación (GCM autenticado)', () => {
    const c = encrypt('dato')!.split(':');
    c[3] = Buffer.from('otro').toString('base64url');
    expect(() => decrypt(c.join(':'))).toThrow();
  });

  it('descifra con la clave anterior durante una rotación', () => {
    const old = encrypt('secreto')!;
    process.env.DATA_ENCRYPTION_KEY_PREVIOUS = process.env.DATA_ENCRYPTION_KEY;
    process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
    resetEnvCache();
    expect(decrypt(old)).toBe('secreto');
    process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY_PREVIOUS;
  });

  it('valores vacíos y enmascarado', () => {
    expect(encrypt('')).toBeNull();
    expect(decrypt(null)).toBeNull();
    expect(mask('ES9121000418450200051332')).toMatch(/^•+1332$/);
  });

  it('seudonimiza de forma estable sin revelar el valor', () => {
    expect(pseudonymize('203.0.113.7')).toBe(pseudonymize('203.0.113.7'));
    expect(pseudonymize('203.0.113.7')).not.toContain('203');
  });
});
