// Tipos de la Escuela de música (API /school, /public/schools).

export type StudentStatus = 'ACTIVE' | 'INACTIVE' | 'LEFT';
export type BandStage = 'NONE' | 'EDUCANDO' | 'MUSICIAN';
export type SubjectKind = 'INSTRUMENT' | 'THEORY' | 'ENSEMBLE' | 'OTHER';
export type EnrollmentStatus = 'ACTIVE' | 'WAITLIST' | 'WITHDRAWN';
export type ApplicationStatus = 'PENDING' | 'ACCEPTED' | 'WAITLISTED' | 'REJECTED';
export type SessionStatus = 'SCHEDULED' | 'CANCELLED' | 'DONE';
export type ClassAttendanceStatus = 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED';
export type TuitionStatus = 'PENDING' | 'PAID' | 'OVERDUE' | 'WAIVED';
export type PaymentMethod = 'CASH' | 'CARD' | 'TRANSFER' | 'DIRECT_DEBIT' | 'BIZUM' | 'OTHER';

export type SchoolFeeMode = 'PERCENT' | 'FIXED';

export interface SchoolSettings {
  feeMode: SchoolFeeMode;
  siblingDiscountPct: number;
  memberDiscountPct: number;
  multiSubjectDiscountPct: number;
  familyDiscountCents: number;
  publicIntro: string | null;
  /** Día del mes (1–28) de la emisión automática; nulo = manual. */
  autoIssueDay: number | null;
  autoIssueDueDay: number;
  notifyFamilies: boolean;
  /** Dar acceso al portal al aceptar una matrícula. */
  inviteOnAccept: boolean;
  slug?: string;
  /** Ya se guardó la configuración alguna vez. */
  configured?: boolean;
}

export interface TuitionTariff {
  id: string;
  name: string;
  monthlyCents: number;
  active: boolean;
  _count?: { students: number };
}

export interface Guardian {
  id: string;
  familyId: string;
  firstName: string;
  lastName: string;
  relationship: string | null;
  email: string | null;
  phone: string | null;
  memberId: string | null;
  nationalId?: string | null;
  hasNationalId: boolean;
  portalAccess?: boolean;
}

export interface Family {
  id: string;
  name: string;
  notes: string | null;
  guardians: Guardian[];
  students?: { id: string; firstName: string; lastName: string; status: StudentStatus }[];
}

export interface Subject {
  id: string;
  name: string;
  kind: SubjectKind;
  monthlyFeeCents: number;
  active: boolean;
}

export interface Teacher {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  userId: string | null;
  memberId: string | null;
  active: boolean;
  _count?: { groups: number };
}

export interface Room {
  id: string;
  name: string;
  capacity: number | null;
}

export interface SchoolYear {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  holidays: string[];
  enrollmentOpen: boolean;
  isCurrent: boolean;
  _count?: { groups: number; applications: number };
}

export interface ClassSlot {
  id: string;
  groupId: string;
  weekday: number;
  startMin: number;
  endMin: number;
  roomId: string | null;
  room?: { id: string; name: string } | null;
}

export interface ClassGroup {
  id: string;
  yearId: string;
  subjectId: string;
  name: string;
  level: string | null;
  teacherId: string | null;
  capacity: number | null;
  monthlyFeeCents: number | null;
  subject: Subject;
  teacher: { id: string; firstName: string; lastName: string; userId: string | null } | null;
  slots: ClassSlot[];
  activeCount?: number;
  waitlistCount?: number;
  year?: { id: string; name: string };
}

export interface Enrollment {
  id: string;
  studentId: string;
  groupId: string;
  status: EnrollmentStatus;
  enrolledAt: string;
  withdrawnAt: string | null;
}

export interface Grade {
  term: number;
  scoreTenths: number | null;
  qualitative: string | null;
  comment: string | null;
}

export interface GroupDetail extends ClassGroup {
  enrollments: (Enrollment & { student: { id: string; firstName: string; lastName: string; instrument: string | null; status: StudentStatus } })[];
}

export interface Student {
  id: string;
  familyId: string | null;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  email: string | null;
  phone: string | null;
  instrument: string | null;
  imageConsent: boolean;
  pickupAuthorized: string[];
  status: StudentStatus;
  bandStage: BandStage;
  memberId: string | null;
  notes: string | null;
  tuitionTariffId?: string | null;
  tuitionTariff?: { id: string; name: string; monthlyCents: number } | null;
  family?: { id: string; name: string } | null;
  enrollments?: { id: string; status: EnrollmentStatus; group: { id: string; name: string; yearId: string; subject: { name: string } } }[];
}

export interface StudentDetail extends Omit<Student, 'family' | 'enrollments'> {
  family: Family | null;
  member: { id: string; memberNumber: number; firstName: string; lastName: string; status: string } | null;
  enrollments: (Enrollment & { group: ClassGroup & { year: { id: string; name: string } }; grades: (Grade & { id: string })[] })[];
  attendanceSummary: Partial<Record<ClassAttendanceStatus, number>>;
  charges?: TuitionCharge[];
}

export interface Application {
  id: string;
  yearId: string;
  status: ApplicationStatus;
  renewal: boolean;
  studentFirstName: string;
  studentLastName: string;
  studentBirthDate: string | null;
  guardianName: string;
  guardianEmail: string;
  guardianPhone: string | null;
  subjectIds: string[];
  notes: string | null;
  consentAt: string;
  auditionAt: string | null;
  auditionResult: string | null;
  studentId: string | null;
  createdAt: string;
  year?: { id: string; name: string };
}

export interface ClassSession {
  id: string;
  groupId: string;
  date: string;
  startMin: number;
  endMin: number;
  status: SessionStatus;
  makeUpForId: string | null;
  notes: string | null;
  _count?: { attendance: number };
}

export interface SessionDetail extends ClassSession {
  attendance: { id: string; studentId: string; status: ClassAttendanceStatus; note: string | null }[];
  roster: { id: string; firstName: string; lastName: string }[];
}

export interface GradeRow {
  id: string;
  student: { id: string; firstName: string; lastName: string };
  grades: (Grade & { id: string })[];
}

export interface ScheduleConflict {
  a: { id: string; groupId: string; groupName: string; weekday: number; startMin: number; endMin: number };
  b: { id: string; groupId: string; groupName: string; weekday: number; startMin: number; endMin: number };
  reasons: ('ROOM' | 'TEACHER' | 'STUDENT')[];
  studentIds: string[];
}

export interface TuitionDetail {
  lines: { groupId: string; label: string; cents: number }[];
  discounts: { kind: 'SIBLING' | 'MEMBER' | 'MULTI_SUBJECT' | 'FAMILY'; pct: number; cents?: number }[];
  pct: number;
  tariff?: { id: string; name: string; cents: number };
  tariffMissing?: boolean;
}

export interface TuitionCharge {
  id: string;
  yearId: string;
  studentId: string;
  familyId: string | null;
  period: string;
  baseCents: number;
  discountCents: number;
  amountCents: number;
  detail: TuitionDetail;
  dueDate: string;
  status: TuitionStatus;
  paidAt: string | null;
  paymentMethod?: PaymentMethod | null;
  student?: { id: string; firstName: string; lastName: string };
  family?: { id: string; name: string } | null;
}

export interface Notice {
  id: string;
  groupId: string | null;
  title: string;
  body: string;
  authorId?: string;
  createdAt: string;
  group?: { id: string; name: string } | null;
}

export interface ReportCard {
  tenant: { name: string } | null;
  year: { id: string; name: string } | null;
  student: { id: string; firstName: string; lastName: string; birthDate: string | null; instrument: string | null };
  subjects: {
    enrollmentId: string;
    groupId: string;
    groupName: string;
    level: string | null;
    subject: string;
    subjectKind: SubjectKind;
    teacher: string | null;
    status: EnrollmentStatus;
    grades: Grade[];
    attendance: Partial<Record<ClassAttendanceStatus, number>>;
  }[];
}

export type JustificationStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface FamilyUpcomingSession {
  id: string;
  date: string;
  startMin: number;
  endMin: number;
  status: SessionStatus;
  notes: string | null;
  makeUpForId: string | null;
  group: { id: string; name: string; subject: { name: string } };
  studentIds: string[];
}

export interface Justification {
  id: string;
  status: ClassAttendanceStatus;
  note: string | null;
  justification: string | null;
  justificationStatus: JustificationStatus;
  student: { id: string; firstName: string; lastName: string };
  session: { id: string; date: string; startMin: number; endMin: number; group: { id: string; name: string; subject: { name: string } } };
}

export interface FamilyPortalData {
  guardian: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null };
  guardians: { id: string; firstName: string; lastName: string; relationship: string | null; email: string | null; phone: string | null }[];
  upcoming: FamilyUpcomingSession[];
  family: { id: string; name: string };
  students: {
    id: string;
    firstName: string;
    lastName: string;
    birthDate: string | null;
    instrument: string | null;
    status: StudentStatus;
    bandStage: BandStage;
    enrollments: {
      id: string;
      status: EnrollmentStatus;
      grades: Grade[];
      group: {
        id: string;
        name: string;
        level: string | null;
        year: { id: string; name: string };
        subject: { name: string; kind: SubjectKind };
        teacher: { firstName: string; lastName: string } | null;
        slots: { weekday: number; startMin: number; endMin: number; room: { name: string } | null }[];
      };
    }[];
  }[];
  absences: {
    id: string;
    studentId: string;
    status: ClassAttendanceStatus;
    note: string | null;
    justification: string | null;
    justificationStatus: JustificationStatus;
    session: { date: string; startMin: number; group: { name: string } };
  }[];
  charges: Omit<TuitionCharge, 'yearId' | 'familyId'>[];
  notices: Notice[];
}

export interface PublicOffer {
  band: { name: string; slug: string };
  year: { id: string; name: string; startsOn: string; endsOn: string };
  subjects: { id: string; name: string; kind: SubjectKind; monthlyFeeCents: number }[];
  publicIntro: string | null;
}

export interface StaffUser {
  id: string;
  name: string;
  email: string;
  role?: { key: string; name: string };
}

export interface TuitionPreviewRow {
  studentId: string;
  familyId: string | null;
  baseCents: number;
  discountCents: number;
  amountCents: number;
  detail: TuitionDetail;
  student: { firstName: string; lastName: string; family: { id: string; name: string } | null };
}

export interface TuitionPreview {
  rows: TuitionPreviewRow[];
  students: number;
  totalBaseCents: number;
  totalDiscountCents: number;
  totalAmountCents: number;
}

export interface SchoolChecklistItem {
  id: string;
  title: string;
  detail: string;
  /** Query string de la página de la escuela (`?tab=…&section=…`). */
  to: string;
  done: boolean;
}

export interface SchoolOverview {
  year: { id: string; name: string; isCurrent: boolean; enrollmentOpen: boolean; startsOn: string; endsOn: string } | null;
  hasYears: boolean;
  counts: {
    students: number;
    families: number;
    subjects: number;
    teachers: number;
    groups: number;
    withoutSlots: number;
    withoutTeacher: number;
    waitlist: number;
    pendingApplications: number;
    conflicts: number;
    occupied: number;
    /** Nulo si algún grupo no tiene límite de plazas. */
    capacity: number | null;
    pendingJustifications: number;
    /** Tutores invitables (con email o socio) que aún no tienen acceso al portal. */
    guardiansWithoutPortal: number;
    guardiansWithoutContact: number;
  };
  checklist: SchoolChecklistItem[];
  tuition: {
    period: string;
    issuedCount: number;
    issuedCents: number;
    pendingCount: number;
    pendingCents: number;
    overdueCount: number;
    overdueCents: number;
    autoIssueDay: number | null;
  } | null;
  today: (ClassSession & { group: { id: string; name: string; level: string | null; subject: { name: string } } })[];
}

export interface YearSummary {
  year: SchoolYear;
  groups: { id: string; name: string; level: string | null; subject: string; teacher: { firstName: string; lastName: string } | null; slots: number; students: number }[];
  students: number;
}

export interface ImportResult {
  dryRun: boolean;
  total: number;
  created: number;
  newFamilies: number;
  duplicates: number;
  errors: { row: number; message: string }[];
}
