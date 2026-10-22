// Tipos del contrato docs/api.md.

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type PlanCode = 'FREE' | 'BASIC' | 'PRO' | 'ENTERPRISE';
export type TenantStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'READ_ONLY' | 'SUSPENDED' | 'CANCELLED';

export interface Membership {
  tenantId: string;
  tenantName: string;
  slug: string;
  roleKey: string;
  roleName: string;
}

export interface Session {
  user: { id: string; email: string; name: string; mfaEnabled: boolean; isPlatformAdmin: boolean };
  tenant: { id: string; name: string; slug: string; status: TenantStatus; timezone: string } | null;
  role: { id: string; key: string; name: string } | null;
  permissions: string[];
  plan: { code: PlanCode; name: string; features: string[]; maxUsers: number; maxMembers: number; storageMb: number } | null;
  memberId: string | null;
  memberships: Membership[];
}

export interface Plan {
  id: string;
  code: PlanCode;
  name: string;
  priceMonthlyCents: number;
  priceYearlyCents: number;
  currency: string;
  maxUsers: number;
  maxMembers: number;
  storageMb: number;
  features: string[];
  trialDays: number;
}

/** Cada indicador llega sólo si el rol tiene el permiso del módulo que lo origina; si no, `null`. */
export interface Dashboard {
  members: { active: number; total: number } | null;
  nextEvents: EventItem[];
  pendingCharges: { count: number; amountCents: number } | null;
  attendanceRate30d: number | null;
  storage: { usedBytes: number; limitBytes: number } | null;
  users: { used: number; limit: number } | null;
}

export interface Section {
  id: string;
  name: string;
  position: number;
}

export type MemberStatus = 'ACTIVE' | 'INACTIVE' | 'LEFT';
export interface Member {
  id: string;
  memberNumber: number;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  birthDate?: string | null;
  nationalId?: string | null;
  iban?: string | null;
  address?: string | null;
  instrument?: string | null;
  sectionId?: string | null;
  section?: Section | null;
  status: MemberStatus;
  joinedAt: string;
  leftAt?: string | null;
  leaveReason?: string | null;
  consentDataAt?: string | null;
  consentImages: boolean;
  notes?: string | null;
  sizes?: { garment: string; size: string }[];
}

export interface Composer {
  id: string;
  name: string;
  birthYear?: number | null;
  deathYear?: number | null;
  nationality?: string | null;
}

export type AssetKind = 'SCORE' | 'PART' | 'AUDIO' | 'OTHER';
export interface Asset {
  id: string;
  kind: AssetKind;
  instrument?: string | null;
  versionId?: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}
export interface WorkVersion {
  id: string;
  name: string;
  arranger?: string | null;
  notes?: string | null;
}
export interface Work {
  id: string;
  title: string;
  subtitle?: string | null;
  composerId?: string | null;
  composer?: Composer | null;
  arranger?: string | null;
  genre?: string | null;
  durationSec?: number | null;
  difficulty?: number | null;
  year?: number | null;
  publisher?: string | null;
  catalogCode?: string | null;
  tags: string[];
  notes?: string | null;
  versions?: WorkVersion[];
  assets?: Asset[];
}

export type EventType = 'REHEARSAL' | 'PERFORMANCE' | 'MEETING' | 'OTHER';
export type EventStatus = 'SCHEDULED' | 'CANCELLED' | 'DONE';
export type CallResponse = 'PENDING' | 'ACCEPTED' | 'DECLINED';
export type AttendanceStatus = 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED';
export type JustificationStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface EventItem {
  id: string;
  type: EventType;
  title: string;
  description?: string | null;
  location?: string | null;
  startsAt: string;
  endsAt: string;
  status: EventStatus;
  reminderMinutes: number[];
  counts?: { called: number; accepted: number; declined: number };
}
export interface Attendance {
  id: string;
  memberId: string;
  member?: Pick<Member, 'id' | 'firstName' | 'lastName'>;
  status: AttendanceStatus;
  justification?: string | null;
  justificationStatus: JustificationStatus;
}
export interface EventDetail extends EventItem {
  repertoire: { work: Work; position: number; notes?: string | null }[];
  calls: { member: Pick<Member, 'id' | 'firstName' | 'lastName' | 'instrument' | 'sectionId'>; response: CallResponse; note?: string | null }[];
  attendance: Attendance[];
}

export interface AgendaItem {
  id: string;
  kind: 'event' | 'fee_due' | 'loan_due';
  title: string;
  startsAt: string;
  endsAt?: string | null;
  link?: string | null;
}

export interface AttendanceStats {
  overallRate: number | null;
  byMember: {
    member: Pick<Member, 'id' | 'firstName' | 'lastName'>;
    present: number;
    late: number;
    absent: number;
    excused: number;
    rate: number | null;
  }[];
  byEvent: { event: Pick<EventItem, 'id' | 'title' | 'startsAt' | 'type'>; present: number; total: number }[];
}

export type TxKind = 'INCOME' | 'EXPENSE';
export interface FinanceCategory {
  id: string;
  name: string;
  kind: TxKind;
}
export interface Transaction {
  id: string;
  kind: TxKind;
  amountCents: number;
  currency: string;
  date: string;
  categoryId?: string | null;
  category?: FinanceCategory | null;
  description: string;
  memberId?: string | null;
}
export type Periodicity = 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'ONE_OFF';
export interface Fee {
  id: string;
  name: string;
  amountCents: number;
  periodicity: Periodicity;
  active: boolean;
}
export type ChargeStatus = 'PENDING' | 'PAID' | 'OVERDUE' | 'WAIVED';
export interface FeeCharge {
  id: string;
  feeId: string;
  fee?: Pick<Fee, 'id' | 'name'>;
  memberId: string;
  member?: Pick<Member, 'id' | 'firstName' | 'lastName'>;
  period: string;
  amountCents: number;
  dueDate: string;
  status: ChargeStatus;
  paidAt?: string | null;
}
export interface FinanceSummary {
  year: number;
  incomeCents: number;
  expenseCents: number;
  balanceCents: number;
  monthly: { month: number; incomeCents: number; expenseCents: number }[];
  byCategory: { category: string; kind: TxKind; totalCents: number }[];
  pendingCharges: { count: number; amountCents: number };
}

export type ItemCondition = 'NEW' | 'GOOD' | 'WORN' | 'DAMAGED';
export type StockStatus = 'AVAILABLE' | 'ASSIGNED' | 'MAINTENANCE' | 'RETIRED';
export interface UniformItem {
  id: string;
  code: string;
  garment: string;
  size: string;
  condition: ItemCondition;
  status: StockStatus;
  notes?: string | null;
}
export interface UniformLoan {
  id: string;
  itemId: string;
  item?: UniformItem;
  memberId: string;
  member?: Pick<Member, 'id' | 'firstName' | 'lastName'>;
  deliveredAt: string;
  dueAt?: string | null;
  returnedAt?: string | null;
  conditionOut: ItemCondition;
  conditionIn?: ItemCondition | null;
  notes?: string | null;
}

export interface Instrument {
  id: string;
  inventoryCode: string;
  type: string;
  brand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  purchaseDate?: string | null;
  purchasePriceCents?: number | null;
  condition: ItemCondition;
  status: StockStatus;
  notes?: string | null;
  assignments?: {
    id: string;
    memberId: string;
    member?: Pick<Member, 'id' | 'firstName' | 'lastName'>;
    startAt: string;
    endAt?: string | null;
    notes?: string | null;
  }[];
  maintenance?: {
    id: string;
    type: 'MAINTENANCE' | 'REPAIR';
    description: string;
    provider?: string | null;
    costCents?: number | null;
    status: 'OPEN' | 'DONE';
    startedAt: string;
    completedAt?: string | null;
  }[];
}

export type ListingStatus = 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED' | 'REJECTED' | 'SOLD' | 'ARCHIVED';
export interface Listing {
  id: string;
  title: string;
  description: string;
  category: string;
  condition: ItemCondition;
  priceCents: number;
  currency: string;
  location?: string | null;
  imageKeys: string[];
  imageUrls?: string[];
  status: ListingStatus;
  moderationNote?: string | null;
  publishedAt?: string | null;
  createdAt: string;
  seller?: { name: string };
}
export interface Inquiry {
  id: string;
  listingId: string;
  listing?: Pick<Listing, 'id' | 'title'>;
  sellerTenantId: string;
  buyerTenantId: string;
  message: string;
  createdAt: string;
  direction?: 'sent' | 'received';
}

export interface Communication {
  id: string;
  subject: string;
  body: string;
  channel: 'EMAIL' | 'IN_APP';
  audience: unknown;
  recipients: number;
  sentAt?: string | null;
  createdAt: string;
}

export interface DocumentItem {
  id: string;
  title: string;
  category: string;
  memberId?: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface Role {
  id: string;
  key: string;
  name: string;
  permissions: string[];
  isSystem: boolean;
}
export interface PermissionDef {
  key: string;
  group: string;
  label: string;
}
export interface TenantUser {
  id: string; // membershipId
  user: { id: string; email: string; name: string; mfaEnabled?: boolean };
  role: { id: string; key: string; name: string };
  status: 'ACTIVE' | 'SUSPENDED';
  memberId?: string | null;
  createdAt: string;
}
export interface Invitation {
  id: string;
  email: string;
  roleId: string;
  expiresAt: string;
  acceptedAt?: string | null;
  createdAt: string;
}
export interface AuditEntry {
  id: string;
  actorId?: string | null;
  actor?: { name: string; email: string } | null;
  action: string;
  entity: string;
  entityId?: string | null;
  metadata?: unknown;
  createdAt: string;
}
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  legalName?: string | null;
  taxId?: string | null;
  country: string;
  timezone: string;
  locale: string;
  status: TenantStatus;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  link?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export interface Incident {
  id: string;
  tenantId?: string;
  tenant?: { name: string; slug: string };
  subject: string;
  body: string;
  priority: number;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  resolution?: string | null;
  createdAt: string;
}

export interface Invoice {
  id: string;
  number?: string | null;
  status: string;
  currency: string;
  totalCents: number;
  amountPaidCents: number;
  taxCents: number;
  hostedUrl?: string | null;
  pdfUrl?: string | null;
  periodStart?: string | null;
  createdAt: string;
}
export interface Billing {
  /** false si el panel global ha deshabilitado los pagos: no se puede contratar ni gestionar el pago. */
  billingEnabled: boolean;
  plan: Plan;
  subscription: {
    status: string | null;
    interval: 'MONTH' | 'YEAR' | null;
    currentPeriodEnd: string | null;
    trialEndsAt: string | null;
    cancelAtPeriodEnd: boolean;
    graceUntil: string | null;
  } | null;
  usage: { users: number; members: number; storageBytes: number };
  invoices: Invoice[];
}

export interface AdminMetrics {
  tenants: { total: number; byStatus: Record<string, number> };
  mrrCents: number;
  openIncidents: number;
  pendingListings: number;
}
export interface AdminTenant extends Tenant {
  plan?: { code: PlanCode; name: string };
  createdAt: string;
  storageUsedBytes?: number | string;
  _count?: { memberships: number };
}

// ── Integraciones de plataforma ──────────────────────────
export type IntegrationFieldType = 'text' | 'email' | 'url' | 'number' | 'boolean' | 'select' | 'secret';

export interface IntegrationField {
  key: string;
  label: string;
  type: IntegrationFieldType;
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  default?: string | number | boolean;
  min?: number;
  max?: number;
}

export interface IntegrationProvider {
  id: string;
  label: string;
  description: string;
  docsUrl?: string;
  fields: IntegrationField[];
}

export interface IntegrationCategory {
  id: 'payments' | 'email';
  label: string;
  description: string;
  disabledBehavior: string;
  providers: IntegrationProvider[];
  current: {
    source: 'database' | 'env' | 'none';
    provider: string | null;
    enabled: boolean;
    config: Record<string, string | number | boolean>;
    secrets: Record<string, { set: boolean; hint: string | null }>;
    updatedAt: string | null;
    updatedBy: { name: string; email: string } | null;
  };
}

export interface PlatformAuditEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor: { name: string; email: string } | null;
}
