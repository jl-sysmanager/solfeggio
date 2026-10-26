import type { ChipTone } from '../components/Chip';

type LabelMap = Record<string, { label: string; tone: ChipTone }>;

export const studentStatus: LabelMap = {
  ACTIVE: { label: 'Activo', tone: 'success' },
  INACTIVE: { label: 'Inactivo', tone: 'warning' },
  LEFT: { label: 'Baja', tone: 'neutral' },
};

export const bandStage: LabelMap = {
  NONE: { label: 'Sólo escuela', tone: 'neutral' },
  EDUCANDO: { label: 'Educando', tone: 'info' },
  MUSICIAN: { label: 'Músico de la banda', tone: 'success' },
};

export const subjectKind: Record<string, string> = {
  INSTRUMENT: 'Instrumento',
  THEORY: 'Lenguaje / teoría',
  ENSEMBLE: 'Agrupación',
  OTHER: 'Otra',
};

export const enrollmentStatus: LabelMap = {
  ACTIVE: { label: 'Matriculado', tone: 'success' },
  WAITLIST: { label: 'Lista de espera', tone: 'warning' },
  WITHDRAWN: { label: 'Baja', tone: 'neutral' },
};

export const applicationStatus: LabelMap = {
  PENDING: { label: 'Pendiente', tone: 'warning' },
  ACCEPTED: { label: 'Aceptada', tone: 'success' },
  WAITLISTED: { label: 'En espera', tone: 'info' },
  REJECTED: { label: 'Rechazada', tone: 'danger' },
};

export const sessionStatus: LabelMap = {
  SCHEDULED: { label: 'Programada', tone: 'info' },
  CANCELLED: { label: 'Cancelada', tone: 'danger' },
  DONE: { label: 'Impartida', tone: 'success' },
};

export const tuitionStatus: LabelMap = {
  PENDING: { label: 'Pendiente', tone: 'warning' },
  PAID: { label: 'Pagada', tone: 'success' },
  OVERDUE: { label: 'Vencida', tone: 'danger' },
  WAIVED: { label: 'Condonada', tone: 'neutral' },
};

export const paymentMethod: Record<string, string> = {
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  TRANSFER: 'Transferencia',
  DIRECT_DEBIT: 'Domiciliación',
  BIZUM: 'Bizum',
  OTHER: 'Otro',
};

export const discountKind: Record<string, string> = {
  SIBLING: 'Hermanos',
  MEMBER: 'Socio de la banda',
  MULTI_SUBJECT: 'Varias asignaturas',
  FAMILY: 'Familia',
};

export const conflictReason: Record<string, string> = {
  ROOM: 'misma aula',
  TEACHER: 'mismo profesor',
  STUDENT: 'alumnos en común',
};

export const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const weekdayName = (n: number) => WEEKDAYS[n - 1] ?? '—';

/** Minutos desde medianoche → «17:30». */
export const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
/** «17:30» → minutos desde medianoche. */
export const toMinutes = (v: string) => {
  const [h, m] = v.split(':').map(Number);
  return h * 60 + (m || 0);
};

/** Décimas (0–100) → «8,5». */
export const score = (tenths: number | null | undefined) => (tenths === null || tenths === undefined ? '—' : (tenths / 10).toLocaleString('es-ES', { maximumFractionDigits: 1 }));

export const termName = (t: number) => (t === 4 ? 'Final' : `${t}.º trimestre`);
