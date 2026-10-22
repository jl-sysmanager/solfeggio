import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { RequestContext } from '../auth/context';
import { found } from '../common/errors';
import { Db } from '../db/db.service';
import { median, MODERATION_SLA_HOURS, pct, platformAudit } from './support.util';

const HOUR = 3_600_000;

/**
 * Bloqueo por moderación: el guard rechaza sus tokens (401 ACCOUNT_BLOCKED), no puede iniciar
 * sesión ni renovar la sesión. Nunca se bloquea a un administrador de plataforma ni a uno mismo.
 */
export async function blockUser(db: Db, ctx: RequestContext, userId: string, reason: string) {
  if (userId === ctx.userId) throw new BadRequestException({ message: 'No puedes bloquear tu propia cuenta', code: 'CANNOT_BLOCK_SELF' });
  const user = found(await db.system.user.findUnique({ where: { id: userId } }), 'Usuario');
  if (user.isPlatformAdmin) throw new ForbiddenException({ message: 'No se puede bloquear a un administrador de plataforma', code: 'CANNOT_BLOCK_ADMIN' });
  const now = new Date();
  await db.system.$transaction([
    db.system.user.update({ where: { id: userId }, data: { blockedAt: user.blockedAt ?? now, blockedReason: reason } }),
    db.system.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } }),
    // Su perfil deja de aparecer en la bolsa de refuerzos.
    db.system.musicianProfile.updateMany({ where: { userId }, data: { available: false } }),
    platformAudit(db.system, ctx, 'user.blocked', 'user', userId, { reason }),
  ]);
  return { id: userId, blockedAt: user.blockedAt ?? now, blockedReason: reason };
}

export async function unblockUser(db: Db, ctx: RequestContext, userId: string) {
  found(await db.system.user.findUnique({ where: { id: userId } }), 'Usuario');
  await db.system.$transaction([
    db.system.user.update({ where: { id: userId }, data: { blockedAt: null, blockedReason: null } }),
    platformAudit(db.system, ctx, 'user.unblocked', 'user', userId),
  ]);
  return { id: userId, blockedAt: null };
}

/** Tiempo de moderación de BandMarket frente al objetivo de 24 h. */
export async function moderationKpis(db: Db, now = new Date()) {
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const [pending, moderated, listingReports, reinforcementReports, blockedUsers] = await Promise.all([
    db.system.listing.findMany({ where: { status: 'PENDING_REVIEW' }, select: { submittedAt: true, updatedAt: true } }),
    db.system.listing.findMany({ where: { moderatedAt: { gte: since }, submittedAt: { not: null } }, select: { submittedAt: true, moderatedAt: true } }),
    db.system.listingReport.count({ where: { resolvedAt: null } }),
    db.system.reinforcementReport.count({ where: { resolvedAt: null } }),
    db.system.user.count({ where: { blockedAt: { not: null } } }),
  ]);
  const waits = pending.map((l) => (now.getTime() - (l.submittedAt ?? l.updatedAt).getTime()) / HOUR);
  const durations = moderated.map((l) => (l.moderatedAt!.getTime() - l.submittedAt!.getTime()) / HOUR).filter((h) => h >= 0);
  const med = median(durations);
  return {
    market: {
      pending: pending.length,
      overdue: waits.filter((h) => h > MODERATION_SLA_HOURS).length,
      oldestWaitingHours: waits.length ? Math.round(Math.max(...waits) * 10) / 10 : null,
      last30d: {
        moderated: durations.length,
        medianHours: med === null ? null : Math.round(med * 10) / 10,
        within24hPct: pct(durations.filter((h) => h <= MODERATION_SLA_HOURS).length, durations.length),
      },
    },
    reports: { listings: listingReports, reinforcements: reinforcementReports },
    blockedUsers,
    targetHours: MODERATION_SLA_HOURS,
  };
}
