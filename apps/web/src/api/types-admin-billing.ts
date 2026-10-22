// Tipos del panel global · facturación (Fase 7, bloque 2).
export interface BillingTenantRef {
  id: string;
  name: string;
  slug: string;
  status: string;
}

export interface DunningRow {
  tenant: BillingTenantRef;
  plan: { code: string; name: string };
  stripeStatus: string | null;
  amountDueCents: number;
  currency: string;
  openInvoices: number;
  lastFailedInvoice: { id: string; number: string | null; status: string; totalCents: number; createdAt: string; hostedUrl: string | null } | null;
  graceUntil: string | null;
  daysOverdue: number;
  complimentaryUntil: string | null;
  owners: { name: string; email: string }[];
}

export interface AdminCoupon {
  id: string;
  name: string | null;
  percentOff: number | null;
  amountOffCents: number | null;
  currency: string | null;
  duration: 'once' | 'repeating' | 'forever';
  durationInMonths: number | null;
  maxRedemptions: number | null;
  timesRedeemed: number;
  valid: boolean;
  createdAt: string;
  promotionCodes: { id: string; code: string; active: boolean }[];
}

export interface BillingTenantSummary {
  tenant: BillingTenantRef;
  plan: { code: string; name: string };
  complimentaryUntil: string | null;
  complimentaryReason: string | null;
  subscription: { customerId: string | null; subscriptionId: string | null; status: string | null; interval: string | null; trialEndsAt: string | null; currentPeriodEnd: string | null; graceUntil: string | null } | null;
}

export interface SyncResultView {
  at?: string;
  status: 'synced' | 'unchanged' | 'skipped' | 'error';
  changes: string[];
  message?: string;
}

export interface AddonsOverview {
  prices: { addonConfigured: boolean; seatConfigured: boolean; addonCents: number; seatCents: number };
  tenants: {
    tenant: BillingTenantRef;
    plan: { code: string; name: string; maxStudents: number; includesSchool: boolean };
    addons: string[];
    studentSeats: number;
    lines: { key: string; label: string; quantity: number; unitCents: number }[];
    mrrCents: number;
    stripe: { subscriptionId: string | null; status: string | null; interval: string | null };
    complimentaryUntil: string | null;
    lastSync: SyncResultView | null;
  }[];
}

export interface StripeEventRow {
  id: string;
  type: string;
  receivedAt: string;
  processedAt: string | null;
  error: string | null;
  status: 'processed' | 'failed' | 'pending';
}

export interface WebhooksPage {
  data: StripeEventRow[];
  total: number;
  page: number;
  pageSize: number;
  types: string[];
}

export interface WebhookDetail extends StripeEventRow {
  object: { id?: string; object?: string; status?: string } | null;
  tenant: { id: string; name: string } | null;
  fetchError: string | null;
}

/** Campos que `GET /billing` añade para el add-on Escuela y las cuentas bonificadas. */
export interface BillingAddons {
  addons?: { key: string; label: string; quantity: number; unitCents: number }[];
  studentSeats?: number;
  complimentaryUntil?: string | null;
}
