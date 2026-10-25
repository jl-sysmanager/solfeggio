import { BadRequestException, Global, Injectable, Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env';

export const MIME_GROUPS = {
  score: ['application/pdf', 'image/png', 'image/jpeg', 'application/vnd.recordare.musicxml+xml', 'application/vnd.recordare.musicxml', 'application/xml', 'text/xml'],
  audio: ['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/flac', 'audio/aac'],
  document: ['application/pdf', 'image/png', 'image/jpeg', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/plain', 'text/csv'],
  image: ['image/png', 'image/jpeg', 'image/webp'],
} as const;

const URL_TTL_SECONDS = 300;
const log = new Logger('Storage');

/** Origen CORS canónico (sin path ni barra final). El navegador envía Origin exacto. */
function corsOrigin(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const u = new URL(t.includes('://') ? t : `https://${t}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * Almacenamiento S3-compatible. Las claves siempre empiezan por `tenants/{tenantId}/` y se generan
 * en servidor; la confirmación de una subida valida que la clave pertenece al tenant.
 */
@Injectable()
export class Storage implements OnApplicationBootstrap {
  private readonly client: S3Client;
  private readonly signer: S3Client;

  constructor() {
    const e = env();
    const base = {
      region: e.S3_REGION,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
      credentials: e.S3_ACCESS_KEY_ID ? { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY ?? '' } : undefined,
      // Sin checksums automáticos: en URLs prefirmadas el SDK firmaría el checksum de un cuerpo vacío.
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
      responseChecksumValidation: 'WHEN_REQUIRED' as const,
    };
    this.client = new S3Client({ ...base, endpoint: e.S3_ENDPOINT });
    // Las URL prefirmadas deben apuntar al host accesible por el navegador.
    this.signer = new S3Client({ ...base, endpoint: e.S3_PUBLIC_ENDPOINT ?? e.S3_ENDPOINT });
  }

  /**
   * En desarrollo crea el bucket si falta. En todos los entornos aplica CORS del bucket desde
   * CORS_ORIGINS/APP_URL: sin él el PUT prefirmado del navegador falla con «failed to fetch».
   */
  async onApplicationBootstrap() {
    const e = env();
    if (!e.S3_ACCESS_KEY_ID) return;
    const bucket = e.S3_BUCKET;
    if (e.NODE_ENV === 'development' && e.S3_ENDPOINT) {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
      } catch {
        await this.client.send(new CreateBucketCommand({ Bucket: bucket })).catch((err) => log.warn(`No se pudo crear el bucket: ${err.message}`));
      }
    }
    const origins = [...new Set(
      [...e.CORS_ORIGINS.split(','), e.APP_URL]
        .map((o) => corsOrigin(o))
        .filter((o): o is string => !!o),
    )];
    if (!origins.length) return;
    try {
      await this.client.send(
        new PutBucketCorsCommand({
          Bucket: bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: origins,
                // POST: Railway documenta PUT+POST; GET/HEAD para lecturas prefirmadas.
                AllowedMethods: ['GET', 'PUT', 'POST', 'HEAD'],
                // * : el navegador puede enviar cabeceras extra; listar sólo Content-Type rompe algunos S3-compatibles.
                AllowedHeaders: ['*'],
                ExposeHeaders: ['ETag'],
                MaxAgeSeconds: 3600,
              },
            ],
          },
        }),
      );
      log.log(`CORS del bucket aplicado para: ${origins.join(', ')}`);
    } catch (err) {
      log.warn(`No se pudo configurar CORS del bucket: ${(err as Error).message}`);
    }
  }

  validate(mimeType: string, sizeBytes: number, allowed: readonly string[]) {
    if (!allowed.includes(mimeType)) throw new BadRequestException({ message: 'Tipo de archivo no permitido', code: 'MIME_NOT_ALLOWED' });
    if (sizeBytes <= 0 || sizeBytes > env().MAX_UPLOAD_MB * 1024 * 1024) {
      throw new BadRequestException({ message: `El archivo supera ${env().MAX_UPLOAD_MB} MB`, code: 'FILE_TOO_LARGE' });
    }
  }

  newKey(tenantId: string, area: string, fileName: string) {
    const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) : 'bin';
    return `tenants/${tenantId}/${area}/${randomUUID()}.${ext}`;
  }

  /** Clave del logotipo de plataforma. No pertenece a ningún tenant. */
  platformLogoKey(fileName: string) {
    const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) : 'bin';
    return `platform/brand/${randomUUID()}.${ext}`;
  }

  assertPlatformLogo(key: string) {
    if (!/^platform\/brand\/[0-9a-f-]{36}\.[a-z0-9]{1,8}$/.test(key)) {
      throw new BadRequestException({ message: 'Clave de archivo no válida', code: 'INVALID_FILE_KEY' });
    }
  }

  assertOwned(tenantId: string, key: string, area: string) {
    if (!key.startsWith(`tenants/${tenantId}/${area}/`) || key.includes('..')) {
      throw new BadRequestException({ message: 'Clave de archivo no válida', code: 'INVALID_FILE_KEY' });
    }
  }

  /**
   * PUT prefirmado. Sólo se firma Content-Type: firmar Content-Length rompe la subida en el
   * navegador con varios S3-compatibles. El tamaño real se comprueba después con HeadObject.
   */
  async uploadUrl(key: string, mimeType: string, _sizeBytes: number) {
    const cmd = new PutObjectCommand({ Bucket: env().S3_BUCKET, Key: key, ContentType: mimeType });
    return getSignedUrl(this.signer, cmd, { expiresIn: URL_TTL_SECONDS, signableHeaders: new Set(['content-type']) });
  }

  /** URL prefirmada de lectura. `inline` + `mimeType` sirven para abrir/previsualizar en el navegador. */
  async downloadUrl(key: string, fileName: string, inline = false, mimeType?: string) {
    const disposition = `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(fileName)}`;
    const cmd = new GetObjectCommand({
      Bucket: env().S3_BUCKET,
      Key: key,
      ResponseContentDisposition: disposition,
      ...(mimeType ? { ResponseContentType: mimeType } : {}),
    });
    return getSignedUrl(this.signer, cmd, { expiresIn: URL_TTL_SECONDS });
  }

  /** Lectura prefirmada sin forzar descarga (fotos de perfil, etc.). */
  async viewUrl(key: string) {
    const cmd = new GetObjectCommand({ Bucket: env().S3_BUCKET, Key: key });
    return getSignedUrl(this.signer, cmd, { expiresIn: URL_TTL_SECONDS });
  }

  /** Comprueba que el objeto existe y su tamaño real, para no fiarnos del cliente. */
  async head(key: string): Promise<number | null> {
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: env().S3_BUCKET, Key: key }));
      return r.ContentLength ?? null;
    } catch {
      return null;
    }
  }

  /** Descarga el objeto completo a memoria (procesado de PDF en servidor). */
  async getObject(key: string): Promise<Buffer> {
    const r = await this.client.send(new GetObjectCommand({ Bucket: env().S3_BUCKET, Key: key }));
    if (!r.Body) throw new BadRequestException({ message: 'El archivo no existe', code: 'UPLOAD_MISSING' });
    return Buffer.from(await r.Body.transformToByteArray());
  }

  /** Sube un objeto generado en servidor. La clave debe venir de `newKey`. */
  async putObject(key: string, body: Buffer | Uint8Array, mimeType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: env().S3_BUCKET, Key: key, Body: body, ContentType: mimeType, ContentLength: body.byteLength }));
  }

  /** Lista las claves bajo un prefijo (recorrido paginado). `max` limita el recorrido. */
  async list(prefix: string, max = 200_000): Promise<{ key: string; size: number; lastModified: Date | null }[]> {
    const out: { key: string; size: number; lastModified: Date | null }[] = [];
    let token: string | undefined;
    do {
      const r = await this.client.send(new ListObjectsV2Command({ Bucket: env().S3_BUCKET, Prefix: prefix, ContinuationToken: token }));
      for (const o of r.Contents ?? []) if (o.Key) out.push({ key: o.Key, size: o.Size ?? 0, lastModified: o.LastModified ?? null });
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token && out.length < max);
    return out;
  }

  async remove(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: env().S3_BUCKET, Key: key })).catch(() => undefined);
  }
}

@Global()
@Module({ providers: [Storage], exports: [Storage] })
export class StorageModule {}
