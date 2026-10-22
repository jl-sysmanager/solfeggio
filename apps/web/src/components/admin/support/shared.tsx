import type { ReactNode } from 'react';
import type { SlaState } from '../../../api/types-admin-support';
import { Chip, type ChipTone } from '../../Chip';

/** Comunidades autónomas y ciudades autónomas (mismos valores que valida la API). */
export const REGIONS = [
  'Andalucía', 'Aragón', 'Asturias', 'Illes Balears', 'Canarias', 'Cantabria', 'Castilla y León', 'Castilla-La Mancha', 'Cataluña',
  'Comunitat Valenciana', 'Extremadura', 'Galicia', 'La Rioja', 'Comunidad de Madrid', 'Región de Murcia', 'Navarra', 'País Vasco', 'Ceuta', 'Melilla',
];

const SLA: Record<SlaState, { label: string; tone: ChipTone } | null> = {
  met: { label: 'Respondida en plazo', tone: 'success' },
  breached: { label: 'Respondida fuera de plazo', tone: 'neutral' },
  overdue: { label: 'SLA vencido', tone: 'danger' },
  at_risk: { label: 'SLA en riesgo', tone: 'warning' },
  ok: { label: 'En plazo', tone: 'info' },
  none: null,
};

export function SlaChip({ state }: { state: SlaState }) {
  const s = SLA[state];
  return s ? <Chip tone={s.tone}>{s.label}</Chip> : <span className="muted">—</span>;
}

export const PRIORITY_LABEL: Record<number, string> = { 1: 'Crítica', 2: 'Alta', 3: 'Normal', 4: 'Baja', 5: 'Mínima' };
export const SLA_HOURS: Record<number, number> = { 1: 4, 2: 8, 3: 24, 4: 48, 5: 72 };

export function minutesLabel(min: number | null | undefined) {
  if (min === null || min === undefined) return '—';
  return min < 90 ? `${min} min` : `${Math.round((min / 60) * 10) / 10} h`;
}

export function hoursLabel(h: number | null | undefined) {
  return h === null || h === undefined ? '—' : `${h} h`;
}

export function KpiRow({ children }: { children: ReactNode }) {
  return <div className="grid grid--stats">{children}</div>;
}
