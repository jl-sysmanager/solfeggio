import { BadRequestException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { LimitsService } from '../tenancy/limits.service';
import { Storage } from './storage.service';

export const uploadRequest = z.object({
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.string().max(120),
  sizeBytes: z.number().int().positive(),
});

export const uploadConfirm = uploadRequest.extend({ fileKey: z.string().max(300) });

/** Flujo en dos pasos: URL prefirmada → el navegador sube a S3 → confirmación con verificación. */
@Injectable()
export class Uploads {
  constructor(
    private readonly storage: Storage,
    private readonly limits: LimitsService,
  ) {}

  async request(tenantId: string, area: string, input: z.infer<typeof uploadRequest>, allowed: readonly string[]) {
    this.storage.validate(input.mimeType, input.sizeBytes, allowed);
    const fileKey = this.storage.newKey(tenantId, area, input.fileName);
    return { fileKey, uploadUrl: await this.storage.uploadUrl(fileKey, input.mimeType, input.sizeBytes) };
  }

  /** Verifica propiedad y tamaño real y reserva cuota. Devuelve el tamaño verificado. */
  async confirm(tenantId: string, area: string, input: z.infer<typeof uploadConfirm>, allowed: readonly string[]) {
    this.storage.assertOwned(tenantId, input.fileKey, area);
    this.storage.validate(input.mimeType, input.sizeBytes, allowed);
    const actual = await this.storage.head(input.fileKey);
    if (actual === null) throw new BadRequestException({ message: 'El archivo no se ha subido', code: 'UPLOAD_MISSING' });
    await this.limits.reserveStorage(tenantId, actual);
    return actual;
  }

  async discard(tenantId: string, key: string, sizeBytes: number) {
    await this.storage.remove(key);
    await this.limits.releaseStorage(tenantId, sizeBytes);
  }
}
