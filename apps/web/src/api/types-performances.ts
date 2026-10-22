// Tipos de Actuaciones y contrataciones, plantilla mínima, logística y bolsa de refuerzos.

export type ClientKind = 'CITY_COUNCIL' | 'BROTHERHOOD' | 'FESTIVAL_COMMITTEE' | 'PRIVATE' | 'OTHER';
export type QuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED';
export type InvoiceStatus = 'ISSUED' | 'PAID' | 'CANCELLED';
export type ReinforcementStatus = 'OPEN' | 'FILLED' | 'CANCELLED';
export type ApplicationDecision = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN';

export interface Client {
  id: string;
  name: string;
  kind: ClientKind;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  contactName: string | null;
  notes: string | null;
  createdAt: string;
  _count?: { quotes: number; invoices: number };
}

export interface QuoteLine {
  description: string;
  quantity: number;
  unitCents: number;
}

export interface Quote {
  id: string;
  number: number;
  clientId: string;
  client?: Partial<Client> & { id: string; name: string };
  eventId: string | null;
  event?: { id: string; title: string; startsAt: string; status?: string } | null;
  title: string;
  performanceAt: string | null;
  location: string | null;
  lines: QuoteLine[];
  taxRatePct: number;
  baseCents: number;
  taxCents: number;
  totalCents: number;
  validUntil: string | null;
  status: QuoteStatus;
  contractTerms: string | null;
  signedAt: string | null;
  signedBy: string | null;
  notes: string | null;
  createdAt: string;
  invoices?: { id: string; series: string; number: number; status: InvoiceStatus; totalCents: number }[];
}

export interface ClientSnapshot {
  name: string;
  taxId: string | null;
  address: string | null;
  email: string | null;
  kind: ClientKind;
  issuer: { name: string; legalName: string | null; taxId: string | null };
}

export interface Invoice {
  id: string;
  series: string;
  number: number;
  issueDate: string;
  clientId: string;
  client?: { id: string; name: string };
  quoteId: string | null;
  quote?: { id: string; number: number; title: string } | null;
  clientSnapshot: ClientSnapshot;
  lines: QuoteLine[];
  taxRatePct: number;
  baseCents: number;
  taxCents: number;
  totalCents: number;
  status: InvoiceStatus;
  rectifiesId: string | null;
  paidAt: string | null;
  transactionId: string | null;
  hash: string;
  prevHash: string | null;
  createdAt: string;
}

export type ChainBreakReason = 'NUMBER_GAP' | 'PREV_HASH_MISMATCH' | 'HASH_MISMATCH';

export interface ChainVerification {
  series: string;
  count: number;
  ok: boolean;
  lastHash: string | null;
  breaks: { id: string; number: number; reason: ChainBreakReason }[];
  allSeries: string[];
}

export interface StaffingRow {
  instrument: string;
  required: number;
  called: number;
  accepted: number;
  pending: number;
  declined: number;
  missing: number;
}

export interface Staffing {
  rows: StaffingRow[];
  totals: { required: number; accepted: number; missing: number };
}

export interface StaffingAlertResult {
  notified: number;
  called: number;
  vacancies: { instrument: string; missing: number; notified: number }[];
}

export interface Logistics {
  eventId: string;
  transport: string | null;
  departurePlace: string | null;
  departureAt: string | null;
  returnAt: string | null;
  route: string | null;
  uniform: string | null;
  notes: string | null;
  updatedAt: string | null;
}

export interface MusicianProfile {
  id: string;
  displayName: string;
  instruments: string[];
  province: string;
  city: string | null;
  bio: string | null;
  available: boolean;
  updatedAt?: string;
}

export interface PublicReinforcementRequest {
  id: string;
  title: string;
  instrument: string;
  quantity: number;
  date: string;
  province: string;
  location: string | null;
  feeCents: number | null;
  description: string | null;
  status: ReinforcementStatus;
  createdAt: string;
  isMine: boolean;
  band: { name: string };
  myApplication?: ApplicationDecision | null;
}

export interface OwnReinforcementRequest {
  id: string;
  title: string;
  instrument: string;
  quantity: number;
  date: string;
  province: string;
  location: string | null;
  feeCents: number | null;
  description: string | null;
  status: ReinforcementStatus;
  eventId: string | null;
  event: { id: string; title: string; startsAt: string } | null;
  createdAt: string;
  applications: { pending: number; accepted: number; rejected: number };
}

export interface MyApplication {
  id: string;
  status: ApplicationDecision;
  message: string | null;
  createdAt: string;
  request: PublicReinforcementRequest;
}

export interface RequestApplication {
  id: string;
  status: ApplicationDecision;
  message: string | null;
  createdAt: string;
  musician: Omit<MusicianProfile, 'available'> | null;
}

export interface Prefill {
  event: { id: string; title: string; startsAt: string; location: string | null };
  vacancies: { instrument: string; quantity: number }[];
}

export interface ExternalMusician {
  id: string;
  userId: string | null;
  firstName: string;
  lastName: string;
  instrument: string | null;
  email: string | null;
  phone: string | null;
  nationalId?: string | null;
  iban?: string | null;
  ibanMasked: string | null;
  hasNationalId: boolean;
  createdAt: string;
}

export interface ReinforcementPayment {
  id: string;
  musicianId: string;
  musician: { id: string; firstName: string; lastName: string; instrument: string | null };
  eventId: string | null;
  concept: string;
  date: string;
  grossCents: number;
  withholdingPct: number;
  withholdingCents: number;
  netCents: number;
  paidAt: string | null;
  transactionId: string | null;
  createdAt: string;
}

export interface PaymentSummary {
  year: number;
  rows: {
    musician: { id: string; firstName: string; lastName: string; instrument: string | null; hasNationalId: boolean; nationalId?: string | null };
    payments: number;
    grossCents: number;
    withholdingCents: number;
    netCents: number;
  }[];
  totals: { grossCents: number; withholdingCents: number; netCents: number; perceptors: number };
}
