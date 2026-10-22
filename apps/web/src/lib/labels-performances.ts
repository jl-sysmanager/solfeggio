import type { ChipTone } from '../components/Chip';

type LabelMap = Record<string, { label: string; tone: ChipTone }>;

export const clientKind: Record<string, string> = {
  CITY_COUNCIL: 'Ayuntamiento',
  BROTHERHOOD: 'Hermandad / cofradía',
  FESTIVAL_COMMITTEE: 'Comisión de fiestas',
  PRIVATE: 'Particular',
  OTHER: 'Otro',
};

export const quoteStatus: LabelMap = {
  DRAFT: { label: 'Borrador', tone: 'neutral' },
  SENT: { label: 'Enviado', tone: 'info' },
  ACCEPTED: { label: 'Contratado', tone: 'success' },
  REJECTED: { label: 'Rechazado', tone: 'danger' },
};

export const invoiceStatus: LabelMap = {
  ISSUED: { label: 'Pendiente de cobro', tone: 'warning' },
  PAID: { label: 'Cobrada', tone: 'success' },
  CANCELLED: { label: 'Anulada', tone: 'neutral' },
};

export const reinforcementStatus: LabelMap = {
  OPEN: { label: 'Abierta', tone: 'info' },
  FILLED: { label: 'Cubierta', tone: 'success' },
  CANCELLED: { label: 'Cancelada', tone: 'neutral' },
};

export const applicationDecision: LabelMap = {
  PENDING: { label: 'Pendiente', tone: 'warning' },
  ACCEPTED: { label: 'Aceptada', tone: 'success' },
  REJECTED: { label: 'No seleccionada', tone: 'danger' },
  WITHDRAWN: { label: 'Retirada', tone: 'neutral' },
};

export const chainBreakReason: Record<string, string> = {
  NUMBER_GAP: 'Salto en la numeración',
  PREV_HASH_MISMATCH: 'No enlaza con la huella anterior',
  HASH_MISMATCH: 'La huella no coincide con los datos',
};

export const PROVINCES = [
  'A Coruña', 'Álava', 'Albacete', 'Alicante', 'Almería', 'Asturias', 'Ávila', 'Badajoz', 'Barcelona', 'Burgos', 'Cáceres',
  'Cádiz', 'Cantabria', 'Castellón', 'Ceuta', 'Ciudad Real', 'Córdoba', 'Cuenca', 'Girona', 'Granada', 'Guadalajara',
  'Gipuzkoa', 'Huelva', 'Huesca', 'Illes Balears', 'Jaén', 'La Rioja', 'Las Palmas', 'León', 'Lleida', 'Lugo', 'Madrid',
  'Málaga', 'Melilla', 'Murcia', 'Navarra', 'Ourense', 'Palencia', 'Pontevedra', 'Salamanca', 'Santa Cruz de Tenerife',
  'Segovia', 'Sevilla', 'Soria', 'Tarragona', 'Teruel', 'Toledo', 'Valencia', 'Valladolid', 'Bizkaia', 'Zamora', 'Zaragoza',
];
