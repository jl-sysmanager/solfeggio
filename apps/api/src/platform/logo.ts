import { BadRequestException } from '@nestjs/common';
import { Storage } from '../storage/storage.service';

export const LOGO_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const LOGO_MAX_BYTES = 1_048_576;

/** Tipo real a partir de la cabecera. No se sirve SVG ni HTML: el logotipo es público. */
export function sniffImage(buf: Buffer): (typeof LOGO_MIMES)[number] | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function assertLogoRequest(mimeType: string, sizeBytes: number) {
  if (!(LOGO_MIMES as readonly string[]).includes(mimeType)) {
    throw new BadRequestException({ message: 'El logotipo debe ser PNG, JPEG o WebP', code: 'MIME_NOT_ALLOWED' });
  }
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > LOGO_MAX_BYTES) {
    throw new BadRequestException({ message: 'El logotipo no puede superar 1 MB', code: 'FILE_TOO_LARGE' });
  }
}

/** Descarga el objeto subido y acepta sólo una imagen reconocida dentro del límite. */
export async function acceptLogo(storage: Storage, key: string) {
  const buf = await storage.getObject(key).catch(() => null);
  if (!buf) throw new BadRequestException({ message: 'El archivo no se ha subido', code: 'UPLOAD_MISSING' });
  const mime = sniffImage(buf);
  if (!mime || buf.byteLength > LOGO_MAX_BYTES) {
    await storage.remove(key);
    throw new BadRequestException({ message: 'El archivo no es una imagen PNG, JPEG o WebP de hasta 1 MB', code: 'MIME_NOT_ALLOWED' });
  }
  return { mime, size: buf.byteLength };
}
