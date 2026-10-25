import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Db } from '../db/db.service';
import { Storage } from '../storage/storage.service';

export const HEARTBEAT_STALE_HOURS = 26;
/** Los objetos recién subidos pueden no estar confirmados todavía: no se consideran huérfanos. */
const ORPHAN_GRACE_MS = 24 * 3_600_000;
const SAMPLE = 50;

export const ORPHANS = 'storage.orphans';

/** Cuenta que no es del equipo y no pertenece a ninguna banda viva. */
const orphanAccountWhere = {
  isPlatformAdmin: false,
  memberships: { none: { tenant: { deletedAt: null } } },
} satisfies Prisma.UserWhereInput;

@Injectable()
export class OpsService {
  constructor(
    private readonly db: Db,
    private readonly storage: Storage,
  ) {}

  async beat(name: string, status: string, detail?: object, at = new Date()) {
    const data = { status, detail: detail as Prisma.InputJsonValue | undefined, lastRunAt: at };
    return this.db.system.opsHeartbeat.upsert({ where: { name }, create: { name, ...data }, update: data });
  }

  /** Claves de S3 que referencia la base de datos (partituras y troceados, documentos, imágenes, recibos). */
  private async referencedKeys() {
    const sys = this.db.system;
    const [assets, docs, listings, receipts] = await Promise.all([
      sys.asset.findMany({ select: { fileKey: true } }),
      sys.document.findMany({ select: { fileKey: true } }),
      sys.listing.findMany({ where: { imageKeys: { isEmpty: false } }, select: { imageKeys: true } }),
      sys.transaction.findMany({ where: { receiptKey: { not: null } }, select: { receiptKey: true } }),
    ]);
    return new Set<string>([
      ...assets.map((a) => a.fileKey),
      ...docs.map((d) => d.fileKey),
      ...listings.flatMap((l) => l.imageKeys),
      ...receipts.map((r) => r.receiptKey!),
    ]);
  }

  private async findOrphans(now = new Date()) {
    const [objects, referenced] = await Promise.all([this.storage.list('tenants/'), this.referencedKeys()]);
    const cutoff = now.getTime() - ORPHAN_GRACE_MS;
    const orphans = objects.filter((o) => !referenced.has(o.key) && (!o.lastModified || o.lastModified.getTime() < cutoff));
    return { scanned: objects.length, orphans };
  }

  private async findOrphanAccounts() {
    return this.db.system.user.findMany({
      where: orphanAccountWhere,
      select: { id: true, email: true, name: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async currentOrphanDetail() {
    const row = await this.db.system.opsHeartbeat.findUnique({ where: { name: ORPHANS } });
    return row?.detail && typeof row.detail === 'object' && !Array.isArray(row.detail) ? (row.detail as Record<string, unknown>) : {};
  }

  /** Recorre `tenants/` y las cuentas sin banda que no son del equipo. No borra nada. */
  async scanOrphans(now = new Date()) {
    const [{ scanned, orphans }, accounts] = await Promise.all([this.findOrphans(now), this.findOrphanAccounts()]);
    const accountSample = accounts.slice(0, SAMPLE).map((u) => ({ id: u.id, email: u.email, name: u.name, createdAt: u.createdAt }));
    const detail = {
      scanned,
      count: orphans.length,
      bytes: orphans.reduce((s, o) => s + o.size, 0),
      sample: orphans.slice(0, SAMPLE).map((o) => ({ key: o.key, size: o.size, lastModified: o.lastModified })),
      accounts: { count: accounts.length, sample: accountSample },
    };
    await this.beat(ORPHANS, 'ok', detail, now);
    return { count: detail.count, bytes: detail.bytes, scanned, accounts: accounts.length };
  }

  /** Borrado explícito: vuelve a calcular los huérfanos en el momento y elimina sólo los que siguen sin referencia. */
  async deleteOrphans(now = new Date()) {
    const { orphans } = await this.findOrphans(now);
    let bytes = 0;
    for (const o of orphans) {
      await this.storage.remove(o.key);
      bytes += o.size;
    }
    const prev = await this.currentOrphanDetail();
    await this.beat(ORPHANS, 'ok', { scanned: 0, count: 0, bytes: 0, sample: [], accounts: prev.accounts, deleted: { count: orphans.length, bytes, at: now } }, now);
    return { deleted: orphans.length, bytes };
  }

  /**
   * Borra cuentas que no son del equipo y no tienen banda viva.
   * Si llegan ids, sólo borra esos y sólo si siguen cumpliendo la condición.
   */
  async deleteOrphanAccounts(ids?: string[], now = new Date()) {
    const rows = await this.db.system.user.findMany({
      where: { ...orphanAccountWhere, ...(ids ? { id: { in: ids } } : {}) },
      select: { id: true },
    });
    const userIds = rows.map((u) => u.id);
    if (userIds.length > 0) {
      await this.db.system.$transaction([
        this.db.system.musicianProfile.deleteMany({ where: { userId: { in: userIds } } }),
        this.db.system.user.deleteMany({ where: { id: { in: userIds } } }),
      ]);
    }
    const remaining = ids ? await this.findOrphanAccounts() : [];
    const prev = await this.currentOrphanDetail();
    await this.beat(
      ORPHANS,
      'ok',
      {
        ...prev,
        accounts: {
          count: remaining.length,
          sample: remaining.slice(0, SAMPLE).map((u) => ({ id: u.id, email: u.email, name: u.name, createdAt: u.createdAt })),
          deleted: { count: userIds.length, at: now },
        },
      },
      now,
    );
    return { deleted: userIds.length };
  }

  async heartbeats() {
    const rows = await this.db.system.opsHeartbeat.findMany({ orderBy: { name: 'asc' } });
    const now = Date.now();
    return rows.map((r) => ({ ...r, ageHours: Math.round(((now - r.lastRunAt.getTime()) / 3_600_000) * 10) / 10 }));
  }

  async emailStats(now = new Date()) {
    const sys = this.db.system;
    const since = (d: number) => new Date(now.getTime() - d * 86_400_000);
    const stats = async (days: number) => {
      const rows = await sys.emailLog.groupBy({ by: ['status'], where: { createdAt: { gte: since(days) } }, _count: true });
      const n = (s: string) => rows.find((r) => r.status === s)?._count ?? 0;
      return { sent: n('SENT'), failed: n('FAILED'), bounced: n('BOUNCED'), complained: n('COMPLAINED') };
    };
    const [last7d, last30d, byTenant, recent] = await Promise.all([
      stats(7),
      stats(30),
      sys.emailLog.groupBy({ by: ['tenantId'], where: { status: { not: 'SENT' }, createdAt: { gte: since(30) }, tenantId: { not: null } }, _count: true, orderBy: { _count: { tenantId: 'desc' } }, take: 10 }),
      sys.emailLog.findMany({ where: { status: { not: 'SENT' } }, orderBy: { createdAt: 'desc' }, take: 30 }),
    ]);
    const tenants = await sys.tenant.findMany({ where: { id: { in: byTenant.map((b) => b.tenantId!) } }, select: { id: true, name: true } });
    return {
      last7d,
      last30d,
      topTenants: byTenant.map((b) => ({ tenantId: b.tenantId, name: tenants.find((t) => t.id === b.tenantId)?.name ?? '—', failures: b._count })),
      recentFailures: recent.map((r) => ({ ...r, tenant: tenants.find((t) => t.id === r.tenantId)?.name ?? null })),
    };
  }

  async storageStats() {
    const sys = this.db.system;
    const [top, total, orphans] = await Promise.all([
      sys.tenant.findMany({
        where: { deletedAt: null },
        orderBy: { storageUsedBytes: 'desc' },
        take: 10,
        select: { id: true, name: true, storageUsedBytes: true, storageMbOverride: true, plan: { select: { storageMb: true } } },
      }),
      sys.tenant.aggregate({ _sum: { storageUsedBytes: true } }),
      sys.opsHeartbeat.findUnique({ where: { name: ORPHANS } }),
    ]);
    return {
      totalBytes: Number(total._sum.storageUsedBytes ?? 0),
      topTenants: top.map((t) => {
        const quota = t.storageMbOverride ?? t.plan.storageMb;
        return { id: t.id, name: t.name, usedBytes: Number(t.storageUsedBytes), quotaBytes: quota < 0 ? null : quota * 1024 * 1024 };
      }),
      orphans,
    };
  }

  /** Registra rebotes y quejas del proveedor asignándolos a la banda del último envío a esa dirección. */
  async recordDelivery(provider: string, email: string, status: 'BOUNCED' | 'COMPLAINED', reason?: string) {
    const to = email.trim().toLowerCase();
    const last = await this.db.system.emailLog.findFirst({ where: { to: { equals: to, mode: 'insensitive' }, tenantId: { not: null } }, orderBy: { createdAt: 'desc' } });
    await this.db.system.emailLog.create({
      data: { tenantId: last?.tenantId ?? null, to, subject: last?.subject ?? '(rebote)', status, error: `[${provider}] ${reason ?? status}`.slice(0, 500) },
    });
  }
}
