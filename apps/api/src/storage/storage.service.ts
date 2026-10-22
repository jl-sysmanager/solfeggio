import { BadRequestException, Global, Injectable, Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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

  /** En desarrollo crea el bucket si no existe; en producción lo aprovisiona la infraestructura. */
  async onApplicationBootstrap() {
    if (env().NODE_ENV !== 'development' || !env().S3_ENDPOINT) return;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: env().S3_BUCKET }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: env().S3_BUCKET })).catch((e) => new Logger('Storage').warn(`No se pudo crear el bucket: ${e.message}`));
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

  assertOwned(tenantId: string, key: string, area: string) {
    if (!key.startsWith(`tenants/${tenantId}/${area}/`) || key.includes('..')) {
      throw new BadRequestException({ message: 'Clave de archivo no válida', code: 'INVALID_FILE_KEY' });
    }
  }

  /**
   * PUT prefirmado. Se firman Content-Type y Content-Length: S3 rechaza la subida si el navegador
   * envía otro tipo o tamaño. El cifrado en reposo se configura como cifrado por defecto del bucket.
   */
  async uploadUrl(key: string, mimeType: string, sizeBytes: number) {
    const cmd = new PutObjectCommand({ Bucket: env().S3_BUCKET, Key: key, ContentType: mimeType, ContentLength: sizeBytes });
    return getSignedUrl(this.signer, cmd, { expiresIn: URL_TTL_SECONDS, signableHeaders: new Set(['content-type', 'content-length']) });
  }

  async downloadUrl(key: string, fileName: string) {
    const cmd = new GetObjectCommand({
      Bucket: env().S3_BUCKET, Key: key,
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });
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
