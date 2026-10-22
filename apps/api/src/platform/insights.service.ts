import { BadRequestException, Injectable } from '@nestjs/common';
import { PlanCode, Prisma, TenantStatus } from '@prisma/client';
import type { RequestContext } from '../auth/context';
import { pseudonymize } from '../common/crypto';
import { found } from '../common/errors';
import { addonMrrCents, addonPrices } from '../billing/addons';
import { Db } from '../db/db.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { effectiveLimits } from '../tenancy/effective-limits';
import {
  addDays, addMonths, dayStart, daysBetween, healthScore, Limit, limitsOf, monthKey, monthlyMovements, MonthPoint, monthRange,
  mrrFor, ratio, Usage, USAGE_MODULES, UsageModule,
} from './insights-math';

const ALIVE: TenantStatus[] = ['ACTIVE', 'TRIALING', 'PAST_DUE'];
const NEXT_PLAN: Partial<Record<PlanCode, PlanCode>> = { FREE: 'BASIC', BASIC: 'PRO', PRO: 'ENTERPRISE' };
const DAY = 86_400_000;

/** Actividad de los últimos 30 días por módulo: una consulta agregada para todas las bandas. */
const USAGE_SQL = (from: Date, to: Date) => Prisma.sql`
  SELECT tenant_id, m, SUM(n)::int AS n FROM (
    SELECT tenant_id, 'events' AS m, COUNT(*) AS n FROM events WHERE "createdAt" >= ${from} AND "createdAt" < ${to} GROUP BY 1
    UNION ALL SELECT tenant_id, 'attendance', COUNT(*) FROM attendance WHERE "recordedAt" >= ${from} AND "recordedAt" < ${to} GROUP BY 1
    UNION ALL SELECT tenant_id, 'treasury', COUNT(*) FROM transactions WHERE "createdAt" >= ${from} AND "createdAt" < ${to} GROUP BY 1
    UNION ALL SELECT tenant_id, 'fees', COUNT(*) FROM fee_charges WHERE "dueDate" >= ${from} AND "dueDate" < ${to} GROUP BY 1
    UNION ALL SELECT tenant_id, 'tuition', COUNT(*) FROM tuition_charges WHERE "dueDate" >= ${from} AND "dueDate" < ${to} GROUP BY 1
    UNION ALL SELECT a.tenant_id, 'classes', COUNT(*) FROM class_attendance a JOIN class_sessions s ON s.id = a."sessionId"
      WHERE s.date >= ${from} AND s.date < ${to} GROUP BY 1
    UNION ALL SELECT tenant_id, 'archive', COUNT(*) FROM works WHERE "createdAt" >= ${from} AND "createdAt" < ${to} GROUP BY 1
    UNION ALL SELECT tenant_id, 'archive', COUNT(*) FROM assets WHERE "createdAt" >= ${from} AND "createdAt" < ${to} GROUP BY 1
    UNION ALL SELECT tenant_id, 'performances', COUNT(*) FROM client_invoices WHERE "createdAt" >= ${from} AND "createdAt" < ${to} GROUP BY 1
    UNION ALL SELECT tenant_id, 'market', COUNT(*) FROM listings WHERE "createdAt" >= ${from} AND "createdAt" < ${to} GROUP BY 1
    UNION ALL SELECT tenant_id, 'governance', COUNT(*) FROM assemblies WHERE "createdAt" >= ${from} AND "createdAt" < ${to} GROUP BY 1
    UNION ALL SELECT tenant_id, 'governance', COUNT(*) FROM polls WHERE "createdAt" >= ${from} AND "createdAt" < ${to} GROUP BY 1
    UNION ALL SELECT tenant_id, 'communications', COUNT(*) FROM communications WHERE "createdAt" >= ${from} AND "createdAt" < ${to} GROUP BY 1
    UNION ALL SELECT tenant_id, 'documents', COUNT(*) FROM documents WHERE "createdAt" >= ${from} AND "createdAt" < ${to} GROUP BY 1
  ) x GROUP BY 1, 2`;

export interface HealthQuery {
  q?: string;
  risk?: 'high' | 'medium' | 'low';
  status?: TenantStatus;
  plan?: PlanCode;
  sort: 'score' | '-score' | 'name' | 'activeUsers' | 'lastActivity' | 'mrr';
  page: number;
  pageSize: number;
}

export interface Reason {
  code: string;
  label: string;
}

export type HealthRow = Awaited<ReturnType<InsightsService['rows']>>[number];

/**
 * Métricas de negocio del panel global: fotos diarias por banda, MRR, embudo, cohortes, salud y
 * ficha. Todo con el cliente de sistema; las tablas de plataforma no son accesibles por la app.
 */
@Injectable()
export class InsightsService {
  /** Importes del add-on Escuela (integración de pagos); se refrescan al empezar cada cálculo. */
  private addonCents = { addonCents: 0, seatCents: 0 };

  constructor(
    private readonly db: Db,
    private readonly integrations: IntegrationsService,
  ) {}

  private async refreshAddonPrices() {
    const p = await addonPrices(this.integrations).catch(() => null);
    this.addonCents = { addonCents: p?.addonCents ?? 0, seatCents: p?.seatCents ?? 0 };
  }

  audit(tenantId: string, ctx: RequestContext, action: string, entity: string, entityId: string, metadata?: object) {
    return this.db.system.auditLog.create({
      data: {
        tenantId, actorId: ctx.userId, action: `platform.${action}`, entity, entityId,
        metadata: metadata as Prisma.InputJsonValue, ipHash: pseudonymize(ctx.ip),
      },
    });
  }

  // ───────────── Fotos diarias ─────────────

  /** Foto idempotente de cada banda no borrada en el día de `date` (UTC). */
  async snapshot(date: Date = new Date()) {
    await this.refreshAddonPrices();
    const sys = this.db.system;
    const day = dayStart(date);
    const end = addDays(day, 1);
    const from30 = addDays(end, -30);
    const from7 = addDays(end, -7);
    const tenants = await sys.tenant.findMany({ where: { deletedAt: null, createdAt: { lt: end } }, include: { plan: true, subscription: true } });
    const [usageRows, users, active7, active30, members, students] = await Promise.all([
      sys.$queryRaw<{ tenant_id: string; m: UsageModule; n: number }[]>(USAGE_SQL(from30, end)),
      sys.membership.groupBy({ by: ['tenantId'], where: { status: 'ACTIVE' }, _count: true, _max: { lastSeenAt: true } }),
      sys.membership.groupBy({ by: ['tenantId'], where: { status: 'ACTIVE', lastSeenAt: { gte: from7, lt: end } }, _count: true }),
      sys.membership.groupBy({ by: ['tenantId'], where: { status: 'ACTIVE', lastSeenAt: { gte: from30, lt: end } }, _count: true }),
      sys.member.groupBy({ by: ['tenantId'], where: { status: 'ACTIVE' }, _count: true }),
      sys.student.groupBy({ by: ['tenantId'], where: { status: { not: 'LEFT' } }, _count: true }),
    ]);
    const usage = new Map<string, Usage>();
    for (const r of usageRows) usage.set(r.tenant_id, { ...usage.get(r.tenant_id), [r.m]: Number(r.n) });
    const count = (rows: { tenantId: string; _count: number }[]) => new Map(rows.map((r) => [r.tenantId, r._count]));
    const [c7, c30, cm, cs] = [count(active7), count(active30), count(members), count(students)];
    const u = new Map(users.map((r) => [r.tenantId, r]));

    for (const t of tenants) {
      const lastSeen = u.get(t.id)?._max.lastSeenAt ?? null;
      const tenantUsage = usage.get(t.id) ?? {};
      const data = {
        planCode: t.plan.code,
        status: t.status,
        mrrCents: this.mrrOf(t, day),
        activeUsers7d: c7.get(t.id) ?? 0,
        activeUsers30d: c30.get(t.id) ?? 0,
        members: cm.get(t.id) ?? 0,
        students: cs.get(t.id) ?? 0,
        storageBytes: t.storageUsedBytes,
        usage: tenantUsage as Prisma.InputJsonValue,
        healthScore: healthScore({
          status: t.status, usage: tenantUsage, users: u.get(t.id)?._count ?? 0,
          activeUsers7d: c7.get(t.id) ?? 0, activeUsers30d: c30.get(t.id) ?? 0,
          lastActivityAt: lastSeen && lastSeen < end ? lastSeen : null, at: end,
        }),
      };
      await sys.tenantSnapshot.upsert({
        where: { tenantId_date: { tenantId: t.id, date: day } },
        create: { tenantId: t.id, date: day, ...data },
        update: data,
      });
    }
    return { date: day.toISOString().slice(0, 10), tenants: tenants.length };
  }

  /** MRR actual de una banda; punto de extensión para el ingreso de add-ons. */
  mrrOf(
    t: { status: TenantStatus; complimentaryUntil: Date | null; plan: { code: PlanCode; priceMonthlyCents: number; priceYearlyCents: number; features?: string[] }; addons?: string[]; studentSeats?: number; subscription?: { interval: 'MONTH' | 'YEAR' | null } | null },
    at: Date = new Date(),
    addonCents?: number,
  ) {
    const extra = addonCents ?? (t.addons && t.plan.features ? addonMrrCents({ addons: t.addons, studentSeats: t.studentSeats ?? 0, plan: { features: t.plan.features } }, this.addonCents) : 0);
    return mrrFor(
      {
        status: t.status, planCode: t.plan.code, priceMonthlyCents: t.plan.priceMonthlyCents, priceYearlyCents: t.plan.priceYearlyCents,
        interval: t.subscription?.interval ?? null, complimentaryUntil: t.complimentaryUntil, addonMrrCents: extra,
      },
      at,
    );
  }

  // ───────────── Métricas SaaS ─────────────

  /** Último snapshot de cada mes por banda (los meses sin datos heredan el anterior). */
  private monthPoints() {
    return this.db.system.$queryRaw<{ tenant_id: string; month: string; mrrCents: number; status: TenantStatus }[]>`
      SELECT DISTINCT ON (tenant_id, to_char(date, 'YYYY-MM')) tenant_id, to_char(date, 'YYYY-MM') AS month, "mrrCents", status
      FROM tenant_snapshots ORDER BY tenant_id, to_char(date, 'YYYY-MM'), date DESC`;
  }

  async metrics(months: number, now = new Date()) {
    await this.refreshAddonPrices();
    const sys = this.db.system;
    const [raw, allTenants, byStatus, live] = await Promise.all([
      this.monthPoints(),
      sys.tenant.findMany({ select: { id: true, createdAt: true, deletedAt: true } }),
      sys.tenant.groupBy({ by: ['status'], where: { deletedAt: null }, _count: true }),
      sys.tenant.findMany({ where: { deletedAt: null }, include: { plan: true, subscription: true } }),
    ]);
    const points: MonthPoint[] = raw.map((r) => ({ tenantId: r.tenant_id, month: r.month, mrrCents: r.mrrCents, status: r.status }));
    const deleted = new Map(allTenants.filter((t) => t.deletedAt).map((t) => [t.id, monthKey(t.deletedAt!)]));
    // Se calcula con 12 meses extra de historia para que la NRR anual tenga base.
    const earliest = points.reduce((min, p) => (p.month < min ? p.month : min), monthKey(addMonths(now, -(months - 1))));
    const start = new Date(`${earliest}-01T00:00:00Z`);
    const fullRange = monthRange(start < addMonths(now, -(months + 11)) ? start : addMonths(now, -(months + 11)), now);
    const series = monthlyMovements(points, fullRange, deleted).slice(-months);

    const liveMrr = live.map((t) => this.mrrOf(t, now));
    const paying = liveMrr.filter((v) => v > 0).length;
    const mrrCents = liveMrr.reduce((s, v) => s + v, 0);
    const last = series[series.length - 1];
    return {
      current: {
        mrrCents,
        arrCents: mrrCents * 12,
        arpaCents: paying ? Math.round(mrrCents / paying) : null,
        payingTenants: paying,
        nrr12: last?.nrr12 ?? null,
        nrrMonthly: last?.nrrMonthly ?? null,
      },
      months: series.map((m) => ({ ...m, arrCents: m.mrrCents * 12 })),
      tenantsByStatus: Object.fromEntries(byStatus.map((x) => [x.status, x._count])),
      seasonality: this.seasonality(allTenants, points),
    };
  }

  /** Altas y bajas por mes natural (todos los años), para leer la estacionalidad del curso escolar. */
  private seasonality(tenants: { id: string; createdAt: Date; deletedAt: Date | null }[], points: MonthPoint[]) {
    const out = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, signups: 0, cancellations: 0 }));
    for (const t of tenants) out[t.createdAt.getUTCMonth()].signups++;
    const cancelledAt = new Map<string, string>();
    const sorted = [...points].sort((a, b) => a.month.localeCompare(b.month));
    const prev = new Map<string, TenantStatus>();
    for (const p of sorted) {
      if (p.status === 'CANCELLED' && prev.get(p.tenantId) !== 'CANCELLED' && !cancelledAt.has(p.tenantId)) cancelledAt.set(p.tenantId, p.month);
      prev.set(p.tenantId, p.status);
    }
    for (const t of tenants) if (t.deletedAt && !cancelledAt.has(t.id)) cancelledAt.set(t.id, monthKey(t.deletedAt));
    for (const month of cancelledAt.values()) out[Number(month.slice(5, 7)) - 1].cancellations++;
    return out;
  }

  // ───────────── Embudo y cohortes ─────────────

  async funnel(from: Date, to: Date) {
    const sys = this.db.system;
    const range = { gte: from, lt: to };
    const [users, tenants] = await Promise.all([
      sys.user.count({ where: { createdAt: range, isPlatformAdmin: false } }),
      sys.tenant.findMany({ where: { createdAt: range }, select: { id: true, onboardedAt: true, subscription: { select: { trialEndsAt: true } } } }),
    ]);
    const ids = tenants.map((t) => t.id);
    const [trialSnaps, paidSnaps, paidInvoices] = await Promise.all([
      sys.tenantSnapshot.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids }, status: 'TRIALING' } }),
      sys.tenantSnapshot.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids }, mrrCents: { gt: 0 } } }),
      sys.invoice.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids }, amountPaidCents: { gt: 0 } } }),
    ]);
    const trial = new Set([...trialSnaps.map((s) => s.tenantId), ...tenants.filter((t) => t.subscription?.trialEndsAt).map((t) => t.id)]);
    const paid = new Set([...paidSnaps.map((s) => s.tenantId), ...paidInvoices.map((s) => s.tenantId)]);
    const counts = [
      { key: 'registered', label: 'Usuarios registrados', count: users },
      { key: 'tenants', label: 'Bandas creadas', count: tenants.length },
      { key: 'onboarded', label: 'Onboarding completado', count: tenants.filter((t) => t.onboardedAt).length },
      { key: 'trial', label: 'Prueba', count: trial.size },
      { key: 'paid', label: 'Pago', count: paid.size },
    ];
    return {
      from: from.toISOString().slice(0, 10),
      to: addDays(to, -1).toISOString().slice(0, 10),
      steps: counts.map((s, i) => ({ ...s, conversion: i === 0 ? null : ratio(s.count, counts[i - 1].count) })),
      overall: ratio(paid.size, tenants.length),
    };
  }

  async cohorts(now = new Date()) {
    const sys = this.db.system;
    const [tenants, raw] = await Promise.all([
      sys.tenant.findMany({ select: { id: true, createdAt: true, deletedAt: true } }),
      this.monthPoints(),
    ]);
    const byTenant = new Map<string, { month: string; status: TenantStatus }[]>();
    for (const r of raw) {
      if (!byTenant.has(r.tenant_id)) byTenant.set(r.tenant_id, []);
      byTenant.get(r.tenant_id)!.push({ month: r.month, status: r.status });
    }
    const current = monthKey(now);
    const groups = new Map<string, typeof tenants>();
    for (const t of tenants) {
      const k = monthKey(t.createdAt);
      groups.set(k, [...(groups.get(k) ?? []), t]);
    }
    const at = (cohort: string, offset: number) => {
      const target = monthKey(addMonths(new Date(`${cohort}-01T00:00:00Z`), offset));
      if (target > current) return null;
      let known = 0;
      let alive = 0;
      for (const t of groups.get(cohort)!) {
        if (t.deletedAt && monthKey(t.deletedAt) <= target) {
          known++;
          continue;
        }
        const last = (byTenant.get(t.id) ?? []).filter((p) => p.month <= target).sort((a, b) => b.month.localeCompare(a.month))[0];
        if (!last) continue;
        known++;
        if (ALIVE.includes(last.status)) alive++;
      }
      return known ? { rate: alive / known, active: alive, known } : null;
    };
    return [...groups.keys()].sort().reverse().map((month) => ({
      month,
      size: groups.get(month)!.length,
      m3: at(month, 3),
      m6: at(month, 6),
      m12: at(month, 12),
    }));
  }

  // ───────────── Salud y listas de acción ─────────────

  /** Una fila por banda viva: último snapshot, actividad real y uso frente a los límites del plan. */
  async rows(where: Prisma.TenantWhereInput = {}, now = new Date()) {
    await this.refreshAddonPrices();
    const sys = this.db.system;
    const tenants = await sys.tenant.findMany({ where: { deletedAt: null, ...where }, include: { plan: true, subscription: true }, orderBy: { name: 'asc' } });
    const ids = tenants.map((t) => t.id);
    const latestIds = await sys.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT ON (tenant_id) id FROM tenant_snapshots WHERE tenant_id = ANY(${ids}::uuid[]) ORDER BY tenant_id, date DESC`;
    const [snaps, users, members, students] = await Promise.all([
      sys.tenantSnapshot.findMany({ where: { id: { in: latestIds.map((r) => r.id) } } }),
      sys.membership.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids }, status: 'ACTIVE' }, _count: true, _max: { lastSeenAt: true } }),
      sys.member.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids }, status: 'ACTIVE' }, _count: true }),
      sys.student.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids }, status: { not: 'LEFT' } }, _count: true }),
    ]);
    const snap = new Map(snaps.map((s) => [s.tenantId, s]));
    const u = new Map(users.map((r) => [r.tenantId, r]));
    const cm = new Map(members.map((r) => [r.tenantId, r._count]));
    const cs = new Map(students.map((r) => [r.tenantId, r._count]));
    return tenants.map((t) => {
      const s = snap.get(t.id);
      const usage = (s?.usage ?? {}) as Usage;
      const lastActivityAt = u.get(t.id)?._max.lastSeenAt ?? null;
      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        status: t.status,
        planCode: t.plan.code,
        planName: t.plan.name,
        tags: t.tags,
        accountManagerId: t.accountManagerId,
        createdAt: t.createdAt,
        mrrCents: this.mrrOf(t, now),
        score: s?.healthScore ?? null,
        snapshotDate: s ? s.date.toISOString().slice(0, 10) : null,
        activeUsers7d: s?.activeUsers7d ?? 0,
        activeUsers30d: s?.activeUsers30d ?? 0,
        usage,
        modulesUsed: USAGE_MODULES.filter((m) => (usage[m] ?? 0) > 0).length,
        lastActivityAt,
        renewalAt: t.subscription?.interval === 'YEAR' ? (t.subscription.currentPeriodEnd ?? null) : null,
        limits: limitsOf({
          users: u.get(t.id)?._count ?? 0,
          members: cm.get(t.id) ?? 0,
          students: cs.get(t.id) ?? 0,
          storageBytes: Number(t.storageUsedBytes),
          plan: { ...t.plan, ...effectiveLimits(t) },
          studentSeats: t.studentSeats,
        }),
      };
    });
  }

  async health(q: HealthQuery) {
    let rows = await this.rows({
      status: q.status,
      plan: q.plan ? { code: q.plan } : undefined,
      ...(q.q && { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { slug: { contains: q.q, mode: 'insensitive' } }] }),
    });
    if (q.risk) {
      rows = rows.filter((r) => r.score !== null && (q.risk === 'high' ? r.score < 40 : q.risk === 'medium' ? r.score < 70 && r.score >= 40 : r.score >= 70));
    }
    const time = (d: Date | null) => d?.getTime() ?? 0;
    const cmp: Record<HealthQuery['sort'], (a: HealthRow, b: HealthRow) => number> = {
      score: (a, b) => (a.score ?? -1) - (b.score ?? -1),
      '-score': (a, b) => (b.score ?? -1) - (a.score ?? -1),
      name: (a, b) => a.name.localeCompare(b.name, 'es'),
      activeUsers: (a, b) => b.activeUsers30d - a.activeUsers30d,
      lastActivity: (a, b) => time(b.lastActivityAt) - time(a.lastActivityAt),
      mrr: (a, b) => b.mrrCents - a.mrrCents,
    };
    rows.sort(cmp[q.sort]);
    const start = (q.page - 1) * q.pageSize;
    return { data: rows.slice(start, start + q.pageSize), total: rows.length, page: q.page, pageSize: q.pageSize };
  }

  /** Bandas en riesgo: sin actividad en 21 días, impagos o renovación anual cercana con uso bajo. */
  async atRisk(now = new Date()) {
    const rows = await this.rows({ status: { notIn: ['CANCELLED', 'SUSPENDED'] } }, now);
    const out: (HealthRow & { reasons: Reason[] })[] = [];
    for (const r of rows) {
      const reasons: Reason[] = [];
      const idle = r.lastActivityAt ? daysBetween(r.lastActivityAt, now) : daysBetween(r.createdAt, now);
      if (idle >= 21) {
        reasons.push({ code: 'inactive', label: r.lastActivityAt ? `Sin actividad desde hace ${idle} días` : `Sin actividad desde el alta (${idle} días)` });
      }
      if (r.status === 'PAST_DUE') reasons.push({ code: 'past_due', label: 'Pago pendiente' });
      if (r.status === 'READ_ONLY') reasons.push({ code: 'read_only', label: 'En sólo lectura por impago' });
      if (r.renewalAt && r.renewalAt > now && r.renewalAt.getTime() - now.getTime() <= 45 * DAY && r.score !== null && r.score < 40) {
        reasons.push({ code: 'renewal', label: `Renueva en ${Math.ceil((r.renewalAt.getTime() - now.getTime()) / DAY)} días con salud ${r.score}` });
      }
      if (reasons.length) out.push({ ...r, reasons });
    }
    return out.sort((a, b) => b.reasons.length - a.reasons.length || (a.score ?? 0) - (b.score ?? 0));
  }

  /** Bandas listas para mejorar: algún límite al 80 % o uso intenso de un plan bajo. */
  async upsell(now = new Date()) {
    const rows = await this.rows({ status: { in: ALIVE } }, now);
    const out: (HealthRow & { reasons: Reason[]; suggestion: { planCode: PlanCode | null; addon: string | null } })[] = [];
    for (const r of rows) {
      const reasons: Reason[] = [];
      let addon: string | null = null;
      let upgrade = false;
      for (const l of r.limits) {
        if (l.ratio === null || l.ratio < 0.8) continue;
        reasons.push({ code: `limit_${l.key}`, label: `${l.label}: ${Math.round(l.ratio * 100)} % del límite` });
        upgrade = true;
      }
      if (r.planCode === 'FREE' && (r.activeUsers30d >= 4 || r.modulesUsed >= 3)) {
        reasons.push({ code: 'free_heavy_use', label: `Uso intenso del plan gratuito (${r.activeUsers30d} usuarios activos, ${r.modulesUsed} módulos)` });
        upgrade = true;
      }
      if (r.planCode === 'BASIC' && (r.activeUsers30d >= 10 || r.modulesUsed >= 5)) {
        reasons.push({ code: 'basic_heavy_use', label: `Uso intenso del plan Basic (${r.activeUsers30d} usuarios activos, ${r.modulesUsed} módulos)` });
        upgrade = true;
      }
      if (reasons.length) out.push({ ...r, reasons, suggestion: { planCode: upgrade ? (NEXT_PLAN[r.planCode] ?? null) : null, addon } });
    }
    const top = (r: HealthRow) => Math.max(0, ...r.limits.map((l: Limit) => l.ratio ?? 0));
    return out.sort((a, b) => top(b) - top(a));
  }

  // ───────────── Ficha ─────────────

  async tenantDetail(id: string, page: number, pageSize: number, now = new Date()) {
    await this.refreshAddonPrices();
    const sys = this.db.system;
    const t = found(await sys.tenant.findUnique({ where: { id }, include: { plan: true, subscription: true } }), 'Banda');
    const [row] = await this.rows({ id }, now).catch(() => []);
    const since = addDays(dayStart(now), -90);
    const [contacts, trend, latest, notes, sessions, manager] = await Promise.all([
      sys.membership.findMany({
        where: { tenantId: id, status: 'ACTIVE', role: { key: { in: ['owner', 'admin'] } } },
        select: { lastSeenAt: true, role: { select: { key: true, name: true } }, user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      sys.tenantSnapshot.findMany({
        where: { tenantId: id, date: { gte: since } }, orderBy: { date: 'asc' },
        select: { date: true, healthScore: true, activeUsers7d: true, activeUsers30d: true, mrrCents: true },
      }),
      sys.tenantSnapshot.findFirst({ where: { tenantId: id }, orderBy: { date: 'desc' } }),
      this.notes(id),
      this.sessions(id, 20).then((r) => r.data),
      t.accountManagerId ? sys.user.findUnique({ where: { id: t.accountManagerId }, select: { id: true, name: true, email: true } }) : null,
    ]);
    return {
      tenant: {
        id: t.id, name: t.name, slug: t.slug, legalName: t.legalName, taxId: t.taxId, country: t.country, region: t.region,
        status: t.status, tags: t.tags, addons: t.addons, studentSeats: t.studentSeats, createdAt: t.createdAt, onboardedAt: t.onboardedAt,
        complimentaryUntil: t.complimentaryUntil, storageUsedBytes: Number(t.storageUsedBytes),
      },
      plan: { code: t.plan.code, name: t.plan.name, priceMonthlyCents: t.plan.priceMonthlyCents, priceYearlyCents: t.plan.priceYearlyCents, features: t.plan.features },
      subscription: t.subscription,
      mrrCents: this.mrrOf(t, now),
      accountManager: manager,
      contacts: contacts.map((c) => ({ ...c.user, role: c.role, lastSeenAt: c.lastSeenAt })),
      limits: row?.limits ?? [],
      lastActivityAt: row?.lastActivityAt ?? null,
      snapshot: latest ? { ...latest, storageBytes: Number(latest.storageBytes), date: latest.date.toISOString().slice(0, 10) } : null,
      trend: trend.map((s) => ({ ...s, date: s.date.toISOString().slice(0, 10) })),
      notes,
      impersonations: sessions,
      timeline: await this.timeline(id, page, pageSize),
    };
  }

  notes(tenantId: string) {
    return this.db.system.tenantNote.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 100 }).then(async (notes) => {
      const authors = await this.db.system.user.findMany({ where: { id: { in: [...new Set(notes.map((n) => n.authorId))] } }, select: { id: true, name: true } });
      return notes.map((n) => ({ ...n, authorName: authors.find((a) => a.id === n.authorId)?.name ?? null }));
    });
  }

  async sessions(tenantId: string | undefined, take: number, skip = 0) {
    const where = tenantId ? { tenantId } : {};
    const [rows, total] = await Promise.all([
      this.db.system.impersonationSession.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip }),
      this.db.system.impersonationSession.count({ where }),
    ]);
    const [admins, tenants] = await Promise.all([
      this.db.system.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.adminId))] } }, select: { id: true, name: true, email: true } }),
      this.db.system.tenant.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.tenantId))] } }, select: { id: true, name: true } }),
    ]);
    const data = rows.map((r) => ({
      ...r,
      admin: admins.find((a) => a.id === r.adminId) ?? null,
      tenantName: tenants.find((x) => x.id === r.tenantId)?.name ?? null,
      active: !r.endedAt && r.expiresAt > new Date(),
    }));
    return { data, total };
  }

  /** Cronología: alta, cambios de plan y estado, facturas, incidencias, accesos «ver como» y notas. */
  async timeline(tenantId: string, page: number, pageSize: number) {
    const sys = this.db.system;
    const [t, audits, snaps, invoices, incidents, sessions, notes] = await Promise.all([
      sys.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { createdAt: true, onboardedAt: true } }),
      sys.auditLog.findMany({
        where: { tenantId, action: { startsWith: 'platform.' }, NOT: [{ action: { startsWith: 'platform.impersonation.' } }, { action: { startsWith: 'platform.note.' } }] },
        orderBy: { createdAt: 'desc' }, take: 500,
      }),
      sys.tenantSnapshot.findMany({ where: { tenantId }, orderBy: { date: 'asc' }, select: { date: true, planCode: true, status: true } }),
      sys.invoice.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 200 }),
      sys.incident.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 200, select: { id: true, subject: true, status: true, createdAt: true } }),
      sys.impersonationSession.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 200 }),
      sys.tenantNote.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 200 }),
    ]);
    type Item = { at: Date; kind: string; title: string; detail?: string | null; ref?: string };
    const items: Item[] = [{ at: t.createdAt, kind: 'created', title: 'Alta de la banda' }];
    if (t.onboardedAt) items.push({ at: t.onboardedAt, kind: 'onboarded', title: 'Onboarding completado' });
    for (const a of audits) {
      const m = (a.metadata ?? {}) as Record<string, unknown>;
      const parts = [m.planCode && `plan ${m.planCode}`, m.status && `estado ${m.status}`, Array.isArray(m.addons) && `add-ons: ${(m.addons as string[]).join(', ') || 'ninguno'}`]
        .filter(Boolean)
        .join(' · ');
      items.push({ at: a.createdAt, kind: 'platform', title: PLATFORM_ACTIONS[a.action] ?? a.action.replace(/^platform\./, ''), detail: parts || null, ref: a.id });
    }
    for (let i = 1; i < snaps.length; i++) {
      const [p, c] = [snaps[i - 1], snaps[i]];
      if (p.planCode !== c.planCode) items.push({ at: c.date, kind: 'plan', title: `Cambio de plan: ${p.planCode} → ${c.planCode}` });
      if (p.status !== c.status) items.push({ at: c.date, kind: 'status', title: `Cambio de estado: ${p.status} → ${c.status}` });
    }
    for (const inv of invoices) {
      items.push({ at: inv.createdAt, kind: 'invoice', title: `Factura ${inv.number ?? inv.stripeInvoiceId} (${inv.status})`, detail: `${(inv.totalCents / 100).toFixed(2)} ${inv.currency.toUpperCase()}`, ref: inv.id });
    }
    for (const inc of incidents) items.push({ at: inc.createdAt, kind: 'incident', title: `Incidencia: ${inc.subject}`, detail: inc.status, ref: inc.id });
    for (const s of sessions) items.push({ at: s.createdAt, kind: 'impersonation', title: 'Acceso «ver como»', detail: s.reason, ref: s.id });
    for (const n of notes) items.push({ at: n.createdAt, kind: 'note', title: 'Nota interna', detail: n.body.length > 140 ? `${n.body.slice(0, 140)}…` : n.body, ref: n.id });
    items.sort((a, b) => b.at.getTime() - a.at.getTime());
    const start = (page - 1) * pageSize;
    return { data: items.slice(start, start + pageSize), total: items.length, page, pageSize };
  }

  async updateAccount(id: string, ctx: RequestContext, body: { tags?: string[]; accountManagerId?: string | null }) {
    found(await this.db.system.tenant.findUnique({ where: { id } }), 'Banda');
    if (body.accountManagerId) {
      const m = await this.db.system.user.findUnique({ where: { id: body.accountManagerId } });
      if (!m?.isPlatformAdmin || m.blockedAt) throw new BadRequestException({ message: 'El gestor debe ser un administrador de plataforma', code: 'INVALID_MANAGER' });
    }
    const tags = body.tags ? [...new Set(body.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))] : undefined;
    const t = await this.db.system.tenant.update({ where: { id }, data: { tags, accountManagerId: body.accountManagerId }, select: { id: true, tags: true, accountManagerId: true } });
    await this.audit(id, ctx, 'tenant.account_updated', 'tenant', id, { tags, accountManagerId: body.accountManagerId });
    return t;
  }

  managers() {
    return this.db.system.user.findMany({ where: { isPlatformAdmin: true, blockedAt: null }, select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } });
  }

  async addNote(tenantId: string, ctx: RequestContext, body: string) {
    found(await this.db.system.tenant.findUnique({ where: { id: tenantId } }), 'Banda');
    const note = await this.db.system.tenantNote.create({ data: { tenantId, authorId: ctx.userId, body } });
    // La nota es interna: en la auditoría de la banda sólo queda constancia, sin el texto.
    await this.audit(tenantId, ctx, 'note.created', 'tenant_note', note.id);
    return note;
  }

  async deleteNote(tenantId: string, noteId: string, ctx: RequestContext) {
    found(await this.db.system.tenantNote.findFirst({ where: { id: noteId, tenantId } }), 'Nota');
    await this.db.system.tenantNote.delete({ where: { id: noteId } });
    await this.audit(tenantId, ctx, 'note.deleted', 'tenant_note', noteId);
  }
}

const PLATFORM_ACTIONS: Record<string, string> = {
  'platform.tenant.updated': 'Cambio de plataforma (plan, estado o add-ons)',
  'platform.tenant.account_updated': 'Etiquetas o gestor actualizados',
  'platform.incident.updated': 'Incidencia actualizada por soporte',
  'platform.listing.approved': 'Anuncio aprobado',
  'platform.listing.rejected': 'Anuncio rechazado',
};
