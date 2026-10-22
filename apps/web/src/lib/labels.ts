import type { ChipTone } from '../components/Chip';

type LabelMap = Record<string, { label: string; tone: ChipTone }>;

export const memberStatus: LabelMap = {
  ACTIVE: { label: 'Activo', tone: 'success' },
  INACTIVE: { label: 'Inactivo', tone: 'warning' },
  LEFT: { label: 'Baja', tone: 'neutral' },
};

export const eventType: Record<string, string> = {
  REHEARSAL: 'Ensayo',
  PERFORMANCE: 'Actuación',
  MEETING: 'Reunión',
  OTHER: 'Otro',
};

export const eventStatus: LabelMap = {
  SCHEDULED: { label: 'Programado', tone: 'info' },
  CANCELLED: { label: 'Cancelado', tone: 'danger' },
  DONE: { label: 'Realizado', tone: 'success' },
};

export const callResponse: LabelMap = {
  PENDING: { label: 'Pendiente', tone: 'warning' },
  ACCEPTED: { label: 'Confirmado', tone: 'success' },
  DECLINED: { label: 'No asiste', tone: 'danger' },
};

export const attendanceStatus: LabelMap = {
  PRESENT: { label: 'Presente', tone: 'success' },
  LATE: { label: 'Retraso', tone: 'warning' },
  ABSENT: { label: 'Ausente', tone: 'danger' },
  EXCUSED: { label: 'Justificada', tone: 'info' },
};

export const justificationStatus: LabelMap = {
  NONE: { label: 'Sin justificar', tone: 'neutral' },
  PENDING: { label: 'Pendiente de revisar', tone: 'warning' },
  APPROVED: { label: 'Aprobada', tone: 'success' },
  REJECTED: { label: 'Rechazada', tone: 'danger' },
};

export const chargeStatus: LabelMap = {
  PENDING: { label: 'Pendiente', tone: 'warning' },
  PAID: { label: 'Pagada', tone: 'success' },
  OVERDUE: { label: 'Vencida', tone: 'danger' },
  WAIVED: { label: 'Condonada', tone: 'neutral' },
};

export const periodicity: Record<string, string> = {
  MONTHLY: 'Mensual',
  QUARTERLY: 'Trimestral',
  YEARLY: 'Anual',
  ONE_OFF: 'Única',
};

export const condition: Record<string, string> = {
  NEW: 'Nuevo',
  GOOD: 'Bueno',
  WORN: 'Desgastado',
  DAMAGED: 'Dañado',
};

export const stockStatus: LabelMap = {
  AVAILABLE: { label: 'Disponible', tone: 'success' },
  ASSIGNED: { label: 'Asignado', tone: 'info' },
  MAINTENANCE: { label: 'En taller', tone: 'warning' },
  RETIRED: { label: 'Retirado', tone: 'neutral' },
};

export const listingStatus: LabelMap = {
  DRAFT: { label: 'Borrador', tone: 'neutral' },
  PENDING_REVIEW: { label: 'En revisión', tone: 'warning' },
  PUBLISHED: { label: 'Publicado', tone: 'success' },
  REJECTED: { label: 'Rechazado', tone: 'danger' },
  SOLD: { label: 'Vendido', tone: 'info' },
  ARCHIVED: { label: 'Archivado', tone: 'neutral' },
};

export const tenantStatus: LabelMap = {
  TRIALING: { label: 'En prueba', tone: 'info' },
  ACTIVE: { label: 'Activa', tone: 'success' },
  PAST_DUE: { label: 'Pago pendiente', tone: 'warning' },
  READ_ONLY: { label: 'Sólo lectura', tone: 'warning' },
  SUSPENDED: { label: 'Suspendida', tone: 'danger' },
  CANCELLED: { label: 'Cancelada', tone: 'neutral' },
};

export const incidentStatus: LabelMap = {
  OPEN: { label: 'Abierta', tone: 'warning' },
  IN_PROGRESS: { label: 'En curso', tone: 'info' },
  RESOLVED: { label: 'Resuelta', tone: 'success' },
  CLOSED: { label: 'Cerrada', tone: 'neutral' },
};

export const assetKind: Record<string, string> = {
  SCORE: 'Partitura general',
  PART: 'Particella',
  AUDIO: 'Audio',
  OTHER: 'Otro',
};

/** Etiquetas de funcionalidades implementadas (alineadas con el catálogo del API). */
export const featureLabels: Record<string, string> = {
  members: 'Socios y documentos',
  archive: 'Archivo musical',
  events: 'Ensayos y agenda',
  attendance: 'Asistencia',
  treasury: 'Tesorería',
  wardrobe: 'Mayordomía',
  instruments: 'Instrumentación',
  communications: 'Comunicaciones',
  market: 'BandMarket',
  calendar_sync: 'Calendario externo',
  school: 'Escuela de música',
  performances: 'Contrataciones',
  reinforcements: 'Bolsa de refuerzos',
  governance: 'Gobierno de la asociación',
  archive_ai: 'Particellas automáticas',
};

/** Plan mínimo que incluye cada funcionalidad (para la tarjeta de mejora). */
export const featureMinPlan: Record<string, string> = {
  members: 'Free',
  archive: 'Free',
  events: 'Free',
  attendance: 'Free',
  treasury: 'Basic',
  wardrobe: 'Basic',
  instruments: 'Basic',
  communications: 'Basic',
  market: 'Pro',
  calendar_sync: 'Pro',
  school: 'Pro',
  performances: 'Basic',
  reinforcements: 'Pro',
  governance: 'Basic',
  archive_ai: 'Pro',
};
