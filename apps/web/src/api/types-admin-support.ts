import type { Incident } from './types';

export type SlaState = 'met' | 'breached' | 'overdue' | 'at_risk' | 'ok' | 'none';

export interface Person {
  id: string;
  name: string;
  email: string;
}

export interface SupportIncident extends Incident {
  priority: number;
  slaDueAt: string | null;
  firstResponseAt: string | null;
  sla: SlaState;
  assignee: Person | null;
  openedBy: Person | null;
  tenant?: { id?: string; name: string; slug: string };
}

export interface SupportMessage {
  id: string;
  authorType: 'PLATFORM' | 'TENANT';
  body: string;
  internal: boolean;
  createdAt: string;
  author: { id: string; name: string } | null;
}

export interface SupportIncidentDetail extends SupportIncident {
  messages: SupportMessage[];
}

export interface SupportKpis {
  open: number;
  overdue: number;
  atRisk: number;
  unassigned: number;
  last30d: { created: number; responded: number; medianFirstResponseMinutes: number | null; withinSlaPct: number | null };
}

export interface CannedReply {
  id: string;
  title: string;
  body: string;
}

export interface BandIncidentDetail extends Incident {
  messages: { id: string; authorType: 'PLATFORM' | 'TENANT'; body: string; createdAt: string }[];
}

export interface Segment {
  plans?: string[];
  regions?: string[];
  features?: string[];
  tenantIds?: string[];
}

export interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  level: 'INFO' | 'WARNING' | 'MAINTENANCE';
  link: string | null;
  startsAt: string;
  endsAt: string | null;
  segment: Segment;
  dismissible: boolean;
  state: 'scheduled' | 'active' | 'ended';
  dismissals: number;
  reach: { tenants: number; users: number };
}

export interface ActiveAnnouncement {
  id: string;
  title: string;
  body: string;
  level: 'INFO' | 'WARNING' | 'MAINTENANCE';
  link: string | null;
  dismissible: boolean;
}

export interface OpsQueues {
  counts: Record<string, number>;
  repeatables: { name: string; pattern: string | null; next: string | null }[];
  failed: { id: string; name: string; attempts: number; error: string; failedAt: string | null; data: Record<string, unknown> }[];
}

export interface EmailCounts {
  sent: number;
  failed: number;
  bounced: number;
  complained: number;
}

export interface OpsEmail {
  last7d: EmailCounts;
  last30d: EmailCounts;
  topTenants: { tenantId: string; name: string; failures: number }[];
  recentFailures: { id: string; to: string; subject: string; status: string; error: string | null; tenant: string | null; createdAt: string }[];
}

export interface OpsStorage {
  totalBytes: number;
  topTenants: { id: string; name: string; usedBytes: number; quotaBytes: number | null }[];
  orphans: null | { lastRunAt: string; detail: { scanned: number; count: number; bytes: number; sample: { key: string; size: number }[]; deleted?: { count: number; bytes: number } } };
}

export interface OpsSchedule {
  name: string;
  label: string;
  description: string;
  pattern: string;
  timezone: string;
  enabled: boolean;
  next: string | null;
  lastRunAt: string | null;
  status: 'ok' | 'error' | 'never';
  detail: { error?: string; durationMs?: number } | null;
}

export interface OpsHeartbeats {
  staleAfterHours: number;
  heartbeats: { name: string; status: string; lastRunAt: string | null; ageHours: number | null; stale: boolean; healthy: boolean }[];
}

export interface ModerationKpis {
  market: { pending: number; overdue: number; oldestWaitingHours: number | null; last30d: { moderated: number; medianHours: number | null; within24hPct: number | null } };
  reports: { listings: number; reinforcements: number };
  blockedUsers: number;
  targetHours: number;
}

export interface MarketPending {
  id: string;
  title: string;
  description: string;
  category: string;
  condition: string;
  priceCents: number;
  currency: string;
  createdAt: string;
  imageUrls?: string[];
  seller?: { name?: string };
  waitingHours?: number;
  slaBreached?: boolean;
  reports?: { id: string; reason: string }[];
}

export interface ReinforcementGroup {
  key: string;
  kind: 'request' | 'profile';
  request?: { id: string; title: string; instrument: string; province: string; description: string | null; status: string; band: { name: string } | null; createdBy: { id: string; name: string; email: string; blockedAt: string | null } };
  profile?: { id: string; displayName: string; instruments: string[]; province: string; bio: string | null; available: boolean; user: { id: string; name: string; email: string; blockedAt: string | null } };
  reports: { id: string; reason: string; createdAt: string; reporterBand: string }[];
  firstReportedAt: string;
}

export interface ModUser {
  id: string;
  name: string;
  email: string;
  isPlatformAdmin: boolean;
  blockedAt: string | null;
  blockedReason: string | null;
}
