import { Global, Injectable, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestContext } from '../auth/context';
import { pseudonymize } from '../common/crypto';
import type { Tx } from '../db/db.service';

/** Claves que nunca se guardan en metadatos de auditoría. */
const SENSITIVE = /pass|token|secret|iban|nationalid|dni|code/i;

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE.test(k) ? '[redacted]' : scrub(v)]),
    );
  }
  return value;
}

@Injectable()
export class Audit {
  /** Se ejecuta dentro de la misma transacción que el cambio auditado. */
  async log(
    tx: Tx,
    ctx: Pick<RequestContext, 'tenantId' | 'userId' | 'ip'>,
    action: string,
    entity: string,
    entityId?: string | null,
    metadata?: Record<string, unknown>,
  ) {
    await tx.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        actorId: ctx.userId || null,
        action,
        entity,
        entityId: entityId ?? null,
        metadata: metadata ? (scrub(metadata) as Prisma.InputJsonValue) : undefined,
        ipHash: pseudonymize(ctx.ip),
      },
    });
  }
}

@Global()
@Module({ providers: [Audit], exports: [Audit] })
export class AuditModule {}
