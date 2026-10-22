import type { PlanCode, TenantStatus } from '@prisma/client';

/** Cálculos puros del panel de negocio (sin acceso a datos) para poder probarlos aislados. */

const DAY = 86_400_000;

export const dayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
export const monthStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
export const addMonths = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
/** Último instante del mes de `d`. */
export const monthEnd = (d: Date) => new Date(addMonths(d, 1).getTime() - 1);
export const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
export const daysBetween = (a: Date, b: Date) => Math.floor((b.getTime() - a.getTime()) / DAY);

/** Estados que facturan: igual que el MRR de `/admin/metrics` (ACTIVE y PAST_DUE). */
const PAYING: TenantStatus[] = ['ACTIVE', 'PAST_DUE'];

export interface MrrInput {
  status: TenantStatus;
  planCode: PlanCode;
  priceMonthlyCents: number;
  priceYearlyCents: number;
  interval?: 'MONTH' | 'YEAR' | null;
  complimentaryUntil?: Date | null;
  /** Ingreso de add-ons (p. ej. plazas de la Escuela) ya normalizado a mensual. */
  addonMrrCents?: number;
}

/**
 * MRR de una banda en una fecha: 0 si es gratuita, está en prueba, bonificada, cancelada,
 * suspendida o en sólo lectura; si no, el precio del plan según el intervalo (anual / 12).
 */
export function mrrFor(t: MrrInput, at: Date = new Date()): number {
  if (t.planCode === 'FREE' || !PAYING.includes(t.status)) return 0;
  if (t.complimentaryUntil && t.complimentaryUntil > at) return 0;
  const base = t.interval === 'YEAR' ? Math.round(t.priceYearlyCents / 12) : t.priceMonthlyCents;
  return base + (t.addonMrrCents ?? 0);
}

export const USAGE_MODULES = [
  'events', 'attendance', 'treasury', 'fees', 'tuition', 'classes', 'archive', 'performances', 'market', 'governance', 'communications', 'documents',
] as const;
export type UsageModule = (typeof USAGE_MODULES)[number];
export type Usage = Partial<Record<UsageModule, number>>;

export interface ScoreInput {
  status: TenantStatus;
  usage: Usage;
  users: number;
  activeUsers7d: number;
  activeUsers30d: number;
  lastActivityAt: Date | null;
  at: Date;
}

/**
 * Puntuación de salud 0–100:
 * - Amplitud (35): módulos con actividad en 30 días, hasta 5 → 7 puntos cada uno.
 * - Usuarios activos (30): 20 × (activos 30 d / usuarios) + 10 × (activos 7 d / usuarios).
 * - Recencia (35): última actividad ≤1 d 35, ≤7 d 28, ≤14 d 20, ≤30 d 10, más antigua 0.
 * - Penalización por cobro: PAST_DUE −15, READ_ONLY −30. Canceladas o suspendidas valen 0.
 */
export function healthScore(i: ScoreInput): number {
  if (i.status === 'CANCELLED' || i.status === 'SUSPENDED') return 0;
  const modules = USAGE_MODULES.filter((m) => (i.usage[m] ?? 0) > 0).length;
  const breadth = Math.min(modules, 5) * 7;
  const users = Math.max(1, i.users);
  const active = 20 * Math.min(1, i.activeUsers30d / users) + 10 * Math.min(1, i.activeUsers7d / users);
  const days = i.lastActivityAt ? daysBetween(i.lastActivityAt, i.at) : Infinity;
  const recency = days <= 1 ? 35 : days <= 7 ? 28 : days <= 14 ? 20 : days <= 30 ? 10 : 0;
  const penalty = i.status === 'PAST_DUE' ? 15 : i.status === 'READ_ONLY' ? 30 : 0;
  return Math.max(0, Math.min(100, Math.round(breadth + active + recency - penalty)));
}

export interface LimitInput {
  users: number;
  members: number;
  students: number;
  storageBytes: number;
  plan: { maxUsers: number; maxMembers: number; maxStudents: number; storageMb: number };
  studentSeats: number;
}
export interface Limit {
  key: 'users' | 'members' | 'students' | 'storage';
  label: string;
  used: number;
  max: number | null;
  /** null si es ilimitado o no hay cupo. */
  ratio: number | null;
}

export function limitsOf(i: LimitInput): Limit[] {
  const lim = (key: Limit['key'], label: string, used: number, max: number): Limit => {
    const unlimited = max < 0;
    return { key, label, used, max: unlimited ? null : max, ratio: unlimited || max === 0 ? null : used / max };
  };
  return [
    lim('users', 'Usuarios', i.users, i.plan.maxUsers),
    lim('members', 'Socios', i.members, i.plan.maxMembers),
    lim('students', 'Alumnos', i.students, i.plan.maxStudents < 0 ? -1 : i.plan.maxStudents + i.studentSeats),
    lim('storage', 'Almacenamiento', i.storageBytes, i.plan.storageMb * 1024 * 1024),
  ];
}

export interface MonthPoint {
  tenantId: string;
  month: string;
  mrrCents: number;
  status: TenantStatus;
}

export interface MonthMetrics {
  month: string;
  mrrCents: number;
  newCents: number;
  expansionCents: number;
  contractionCents: number;
  churnedCents: number;
  reactivationCents: number;
  payingTenants: number;
  arpaCents: number | null;
  /** (MRR inicial + expansión − contracción − bajas) / MRR inicial. */
  nrrMonthly: number | null;
  /** MRR actual de las bandas que pagaban hace 12 meses / su MRR de entonces. */
  nrr12: number | null;
}

/**
 * Movimientos de MRR por mes. `points` trae, por banda, el último snapshot de cada mes con datos;
 * los meses sin snapshot heredan el valor anterior (datos dispersos). Las bandas borradas cuentan
 * como 0 desde el mes de su borrado.
 */
export function monthlyMovements(points: MonthPoint[], months: string[], deletedAt: Map<string, string>): MonthMetrics[] {
  const byTenant = new Map<string, Map<string, number>>();
  for (const p of points) {
    if (!byTenant.has(p.tenantId)) byTenant.set(p.tenantId, new Map());
    byTenant.get(p.tenantId)!.set(p.month, p.mrrCents);
  }
  // Serie continua por banda en los meses pedidos (más uno previo para el primer movimiento).
  const series = new Map<string, number[]>();
  for (const [tenantId, m] of byTenant) {
    const sorted = [...m.keys()].sort();
    const del = deletedAt.get(tenantId);
    let carry = 0;
    let idx = 0;
    // Valor heredado de meses anteriores al rango.
    while (idx < sorted.length && sorted[idx] < months[0]) carry = m.get(sorted[idx++])!;
    series.set(
      tenantId,
      months.map((month) => {
        if (m.has(month)) carry = m.get(month)!;
        return del && month >= del ? 0 : carry;
      }),
    );
  }
  const everPaid = new Map<string, boolean>();
  for (const [tenantId, m] of byTenant) {
    const first = [...m.entries()].filter(([k, v]) => k < months[0] && v > 0);
    everPaid.set(tenantId, first.length > 0);
  }
  const out: MonthMetrics[] = [];
  for (let i = 0; i < months.length; i++) {
    const row: MonthMetrics = {
      month: months[i], mrrCents: 0, newCents: 0, expansionCents: 0, contractionCents: 0, churnedCents: 0, reactivationCents: 0,
      payingTenants: 0, arpaCents: null, nrrMonthly: null, nrr12: null,
    };
    let startMrr = 0;
    let base12 = 0;
    let now12 = 0;
    for (const [tenantId, s] of series) {
      const cur = s[i];
      const prev = i > 0 ? s[i - 1] : cur;
      row.mrrCents += cur;
      if (cur > 0) row.payingTenants++;
      if (i > 0) {
        startMrr += prev;
        if (prev === 0 && cur > 0) {
          if (everPaid.get(tenantId) || s.slice(0, i).some((v) => v > 0)) row.reactivationCents += cur;
          else row.newCents += cur;
        } else if (prev > 0 && cur === 0) row.churnedCents += prev;
        else if (cur > prev) row.expansionCents += cur - prev;
        else if (cur < prev) row.contractionCents += prev - cur;
      }
      if (i >= 12 && s[i - 12] > 0) {
        base12 += s[i - 12];
        now12 += cur;
      }
    }
    row.arpaCents = row.payingTenants ? Math.round(row.mrrCents / row.payingTenants) : null;
    if (i > 0 && startMrr > 0) row.nrrMonthly = (startMrr + row.expansionCents - row.contractionCents - row.churnedCents) / startMrr;
    if (base12 > 0) row.nrr12 = now12 / base12;
    out.push(row);
  }
  return out;
}

/** Meses `YYYY-MM` desde `from` hasta `to` (ambos incluidos). */
export function monthRange(from: Date, to: Date): string[] {
  const out: string[] = [];
  for (let d = monthStart(from); d <= to; d = addMonths(d, 1)) out.push(monthKey(d));
  return out;
}

export const ratio = (num: number, den: number) => (den > 0 ? num / den : null);
