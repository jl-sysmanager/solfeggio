import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';

export const LOGO_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const LOGO_MAX_BYTES = 1_048_576;

/** Tipo real a partir de la cabecera. No se sirve SVG ni HTML: el logotipo es público. */
export function sniffImage(buf: Buffer): (typeof LOGO_MIMES)[number] | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function logoFileName(mime: (typeof LOGO_MIMES)[number]) {
  if (mime === 'image/png') return 'logo.png';
  if (mime === 'image/webp') return 'logo.webp';
  return 'logo.jpg';
}

/** Lee el cuerpo de la petición (ya bufferizado o en crudo) y acepta sólo PNG, JPEG o WebP. */
export async function readLogo(req: Request): Promise<{ buf: Buffer; mime: (typeof LOGO_MIMES)[number] }> {
  const buf = Buffer.isBuffer(req.body) ? req.body : await readStream(req);
  if (!buf.length) throw new BadRequestException({ message: 'Falta la imagen del logotipo', code: 'UPLOAD_MISSING' });
  if (buf.byteLength > LOGO_MAX_BYTES) {
    throw new BadRequestException({ message: 'El logotipo no puede superar 1 MB', code: 'FILE_TOO_LARGE' });
  }
  const mime = sniffImage(buf);
  if (!mime) throw new BadRequestException({ message: 'El logotipo debe ser PNG, JPEG o WebP', code: 'MIME_NOT_ALLOWED' });
  return { buf, mime };
}

function readStream(req: Request): Promise<Buffer> {
  if (req.readableEnded) return Promise.resolve(Buffer.alloc(0));
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer | string) => {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += part.length;
      if (size > LOGO_MAX_BYTES) {
        req.destroy();
        reject(new BadRequestException({ message: 'El logotipo no puede superar 1 MB', code: 'FILE_TOO_LARGE' }));
        return;
      }
      chunks.push(part);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => reject(new BadRequestException({ message: 'No se pudo leer la imagen', code: 'UPLOAD_MISSING' })));
  });
}
