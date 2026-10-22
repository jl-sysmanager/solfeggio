import { Prisma, PrismaClient } from '@prisma/client';
import type { RequestContext } from '../auth/context';
import { pseudonymize } from '../common/crypto';

/** Horas para la primera respuesta según la prioridad (1 = crítica … 5 = baja). */
export const SLA_HOURS: Record<number, number> = { 1: 4, 2: 8, 3: 24, 4: 48, 5: 72 };
/** Margen con el que una incidencia sin respuesta se considera «en riesgo» y se avisa. */
export const SLA_AT_RISK_MS = 3_600_000;
/** Objetivo de moderación de BandMarket. */
export const MODERATION_SLA_HOURS = 24;

export const slaDueAt = (from: Date, priority: number) => new Date(from.getTime() + (SLA_HOURS[priority] ?? SLA_HOURS[3]) * 3_600_000);

export type SlaState = 'met' | 'breached' | 'overdue' | 'at_risk' | 'ok' | 'none';

export function slaState(i: { status: string; slaDueAt: Date | null; firstResponseAt: Date | null }, now = new Date()): SlaState {
  if (!i.slaDueAt) return 'none';
  if (i.firstResponseAt) return i.firstResponseAt <= i.slaDueAt ? 'met' : 'breached';
  if (!['OPEN', 'IN_PROGRESS'].includes(i.status)) return 'none';
  if (i.slaDueAt < now) return 'overdue';
  return i.slaDueAt.getTime() - now.getTime() <= SLA_AT_RISK_MS ? 'at_risk' : 'ok';
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const pct = (part: number, total: number) => (total ? Math.round((part / total) * 1000) / 10 : null);

/** Registro de auditoría de plataforma (acciones que no pertenecen a una banda concreta). */
export function platformAudit(
  db: PrismaClient,
  ctx: Pick<RequestContext, 'userId' | 'ip'>,
  action: string,
  entity: string,
  entityId: string | null,
  metadata?: Record<string, unknown>,
) {
  return db.platformAuditLog.create({
    data: { actorId: ctx.userId, action, entity, entityId, metadata: metadata as Prisma.InputJsonValue, ipHash: pseudonymize(ctx.ip) },
  });
}

/** Auditoría en el registro de la banda afectada (visible en su auditoría). */
export function tenantAudit(
  db: PrismaClient,
  tenantId: string,
  ctx: Pick<RequestContext, 'userId' | 'ip'>,
  action: string,
  entity: string,
  entityId: string,
  metadata?: Record<string, unknown>,
) {
  return db.auditLog.create({
    data: { tenantId, actorId: ctx.userId, action: `platform.${action}`, entity, entityId, metadata: metadata as Prisma.InputJsonValue, ipHash: pseudonymize(ctx.ip) },
  });
}
