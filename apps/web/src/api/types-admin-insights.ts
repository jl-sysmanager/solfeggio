import type { PlanCode, TenantStatus } from './types';

export interface InsightsKpis {
  mrrCents: number;
  arrCents: number;
  arpaCents: number | null;
  payingTenants: number;
  nrr12: number | null;
  nrrMonthly: number | null;
}
export interface MonthMetrics {
  month: string;
  mrrCents: number;
  arrCents: number;
  newCents: number;
  expansionCents: number;
  contractionCents: number;
  churnedCents: number;
  reactivationCents: number;
  payingTenants: number;
  arpaCents: number | null;
  nrrMonthly: number | null;
  nrr12: number | null;
}
export interface InsightsMetrics {
  current: InsightsKpis;
  months: MonthMetrics[];
  tenantsByStatus: Record<string, number>;
  seasonality: { month: number; signups: number; cancellations: number }[];
}
export interface FunnelStep {
  key: string;
  label: string;
  count: number;
  conversion: number | null;
}
export interface InsightsFunnel {
  from: string;
  to: string;
  steps: FunnelStep[];
  overall: number | null;
}
export interface CohortCell {
  rate: number;
  active: number;
  known: number;
}
export interface CohortRow {
  month: string;
  size: number;
  m3: CohortCell | null;
  m6: CohortCell | null;
  m12: CohortCell | null;
}
export interface LimitUse {
  key: 'users' | 'members' | 'students' | 'storage';
  label: string;
  used: number;
  max: number | null;
  ratio: number | null;
}
export interface Reason {
  code: string;
  label: string;
}
export interface HealthRow {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  planCode: PlanCode;
  planName: string;
  tags: string[];
  accountManagerId: string | null;
  createdAt: string;
  mrrCents: number;
  score: number | null;
  snapshotDate: string | null;
  activeUsers7d: number;
  activeUsers30d: number;
  usage: Record<string, number>;
  modulesUsed: number;
  lastActivityAt: string | null;
  renewalAt: string | null;
  limits: LimitUse[];
}
export interface ActionRow extends HealthRow {
  reasons: Reason[];
  suggestion?: { planCode: PlanCode | null; addon: string | null };
}
export interface Person {
  id: string;
  name: string;
  email: string;
}
export interface TimelineItem {
  at: string;
  kind: string;
  title: string;
  detail?: string | null;
  ref?: string;
}
export interface TenantNote {
  id: string;
  body: string;
  authorId: string;
  authorName: string | null;
  createdAt: string;
}
export interface ImpersonationRow {
  id: string;
  tenantId: string;
  reason: string;
  expiresAt: string;
  endedAt: string | null;
  createdAt: string;
  active: boolean;
  admin: Person | null;
  tenantName: string | null;
}
export interface TenantInsight {
  tenant: {
    id: string; name: string; slug: string; legalName: string | null; country: string; region: string | null; status: TenantStatus;
    tags: string[]; addons: string[]; studentSeats: number; createdAt: string; onboardedAt: string | null; complimentaryUntil: string | null;
    storageUsedBytes: number;
  };
  plan: { code: PlanCode; name: string; priceMonthlyCents: number; priceYearlyCents: number; features: string[] };
  subscription: { interval: 'MONTH' | 'YEAR' | null; currentPeriodEnd: string | null; trialEndsAt: string | null; stripeStatus: string | null } | null;
  mrrCents: number;
  accountManager: Person | null;
  contacts: (Person & { role: { key: string; name: string }; lastSeenAt: string | null })[];
  limits: LimitUse[];
  lastActivityAt: string | null;
  snapshot: { date: string; healthScore: number; activeUsers7d: number; activeUsers30d: number; members: number; students: number; usage: Record<string, number> } | null;
  trend: { date: string; healthScore: number; activeUsers7d: number; activeUsers30d: number; mrrCents: number }[];
  notes: TenantNote[];
  impersonations: ImpersonationRow[];
  timeline: { data: TimelineItem[]; total: number; page: number; pageSize: number };
}
export interface ImpersonationStart {
  accessToken: string;
  expiresAt: string;
  session: { id: string; tenantId: string; reason: string };
}
export interface ImpersonationInfo {
  sessionId: string;
  tenantName: string;
  expiresAt: string;
  reason: string;
}
