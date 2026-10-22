// Tipos de Gobierno de la asociación y de los extras de Tesorería (subvenciones, lotería, donantes).
import type { Transaction } from './types';

export interface MemberRef {
  id: string;
  firstName: string;
  lastName: string;
  memberNumber?: number;
}

export type AssemblyType = 'ORDINARY' | 'EXTRAORDINARY';
export type AssemblyStatus = 'DRAFT' | 'CONVENED' | 'HELD' | 'CLOSED';
export type MotionStatus = 'DRAFT' | 'OPEN' | 'CLOSED';
export type VoteChoice = 'YES' | 'NO' | 'ABSTAIN';

export interface AgendaItem {
  title: string;
  description?: string | null;
}

export interface Assembly {
  id: string;
  type: AssemblyType;
  title: string;
  firstCallAt: string;
  secondCallAt: string | null;
  location: string | null;
  agenda: AgendaItem[];
  quorumPct: number;
  status: AssemblyStatus;
  convenedAt: string | null;
  minutesApprovedAt: string | null;
  createdAt: string;
}

export interface AssemblySummary extends Assembly {
  hasMinutes: boolean;
  _count: { motions: number };
}

export interface Quorum {
  activeMembers: number;
  present: number;
  represented: number;
  total: number;
  quorumPct: number;
  requiredFirstCall: number;
  metFirstCall: boolean;
}

export interface VoteCounts {
  YES: number;
  NO: number;
  ABSTAIN: number;
  total: number;
  remote: number;
}

export interface Motion {
  id: string;
  assemblyId: string;
  title: string;
  description: string | null;
  allowRemote: boolean;
  status: MotionStatus;
  openedAt: string | null;
  closedAt: string | null;
  results: VoteCounts;
  myVote: { choice: VoteChoice; remote: boolean } | null;
  proxyVotes?: Record<string, VoteChoice>;
  votes?: { memberId: string; member: MemberRef; choice: VoteChoice; remote: boolean; castAt: string }[];
}

export interface AttendanceRow {
  id: string;
  memberId: string;
  member: MemberRef;
  proxyForId: string | null;
  proxyFor: MemberRef | null;
}

export interface AssemblyDetail extends Assembly {
  minutes: string | null;
  attendance: AttendanceRow[];
  quorum: Quorum;
  me: { memberId: string | null; present: boolean; delegated: boolean; proxies: MemberRef[] };
  motions: Motion[];
}

export interface MinutesEntry {
  id: string;
  type: AssemblyType;
  title: string;
  firstCallAt: string;
  location: string | null;
  minutes: string;
  minutesApprovedAt: string;
}

export interface BoardPosition {
  id: string;
  memberId: string;
  member: MemberRef;
  position: string;
  startsOn: string;
  endsOn: string | null;
  notes: string | null;
  current: boolean;
  expiringSoon: boolean;
}

export interface Poll {
  id: string;
  question: string;
  options: string[];
  multiple: boolean;
  anonymous: boolean;
  closesAt: string | null;
  closedAt: string | null;
  createdAt: string;
  open: boolean;
  voteCount: number;
  myChoices: number[] | null;
}

export interface PollResults {
  id: string;
  question: string;
  options: string[];
  multiple: boolean;
  anonymous: boolean;
  open: boolean;
  totalVoters: number;
  counts: number[];
  myChoices: number[] | null;
  voters?: { name: string; choices: number[] }[];
}

// ── Tesorería ──

export type GrantStatus = 'REQUESTED' | 'AWARDED' | 'JUSTIFIED' | 'CLOSED' | 'REJECTED';

export interface Grant {
  id: string;
  name: string;
  grantor: string;
  reference: string | null;
  year: number;
  requestedCents: number | null;
  awardedCents: number | null;
  awardedAt: string | null;
  justificationDue: string | null;
  status: GrantStatus;
  notes: string | null;
}

export interface GrantRow extends Grant {
  expensesCents: number;
  incomesCents: number;
  dueSoon: boolean;
  overdue: boolean;
}

export interface GrantJustification {
  grant: Grant;
  awardedCents: number;
  expensesCents: number;
  incomesCents: number;
  pendingCents: number;
  expenses: Transaction[];
  incomes: Transaction[];
}

export interface LotterySummary {
  books: number;
  ticketsIssued: number;
  ticketsReturned: number;
  ticketsSold: number;
  expectedCents: number;
  collectedCents: number;
  pendingCents: number;
  payToAdministrationCents: number;
  surchargeCents: number;
  pendingByHolder: { memberId: string | null; name: string; books: string[]; pendingCents: number }[];
}

export interface LotteryBook {
  id: string;
  drawId: string;
  code: string;
  number: string | null;
  memberId: string | null;
  member: MemberRef | null;
  holderName: string | null;
  tickets: number;
  returnedTickets: number;
  paidCents: number;
  settledAt: string | null;
}

export interface LotteryDraw {
  id: string;
  name: string;
  drawDate: string;
  numbers: string[];
  ticketPriceCents: number;
  stakeCents: number;
  notes: string | null;
  summary: LotterySummary;
}

export interface LotteryDrawDetail extends LotteryDraw {
  books: LotteryBook[];
}

export type DonorKind = 'PERSON' | 'COMPANY';
export type DonationKind = 'DONATION' | 'SPONSORSHIP';

export interface Donor {
  id: string;
  kind: DonorKind;
  name: string;
  taxId?: string | null;
  taxIdHint: string | null;
  hasTaxId: boolean;
  address: string | null;
  postalCode: string | null;
  province: string | null;
  email: string | null;
  memberId: string | null;
  sponsor: boolean;
  yearTotalCents?: number;
}

export interface Donation {
  id: string;
  donorId: string;
  kind: DonationKind;
  date: string;
  amountCents: number;
  inKind: boolean;
  description: string | null;
  transactionId: string | null;
}

export interface DonorDetail extends Donor {
  donations: Donation[];
}

export interface DonationCertificate {
  year: number;
  issuedAt: string;
  entity: { name: string; legalName: string | null; taxId: string | null };
  donor: Donor;
  donations: { id: string; date: string; amountCents: number; inKind: boolean; description: string | null }[];
  totalCents: number;
}
