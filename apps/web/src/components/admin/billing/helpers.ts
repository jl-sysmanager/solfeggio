import type { AdminCoupon, SyncResultView } from '../../../api/types-admin-billing';
import { money } from '../../../lib/format';

/** «20 % durante 3 meses», «5,00 € una vez», «100 % siempre». */
export function couponLabel(c: Pick<AdminCoupon, 'percentOff' | 'amountOffCents' | 'currency' | 'duration' | 'durationInMonths'>) {
  const what = c.percentOff ? `${c.percentOff} %` : money(c.amountOffCents, c.currency ?? 'eur');
  const when = c.duration === 'once' ? 'una vez' : c.duration === 'forever' ? 'siempre' : `durante ${c.durationInMonths} ${c.durationInMonths === 1 ? 'mes' : 'meses'}`;
  return `${what} ${when}`;
}

const CHANGE: Record<string, string> = { school_addon: 'Cuota de la escuela', school_seats: 'Plazas de alumno' };

/** «school_seats:update:35» → «Plazas de alumno: 35». */
export function changeLabel(change: string) {
  const [key, op, qty] = change.split(':');
  const name = CHANGE[key] ?? key;
  return op === 'remove' ? `${name}: retirada` : op === 'add' ? `${name}: añadida (${qty})` : `${name}: ${qty}`;
}

export const SYNC_STATUS: Record<SyncResultView['status'], { label: string; tone: 'success' | 'neutral' | 'warning' | 'danger' }> = {
  synced: { label: 'Sincronizada', tone: 'success' },
  unchanged: { label: 'Al día', tone: 'neutral' },
  skipped: { label: 'Sin suscripción', tone: 'warning' },
  error: { label: 'Error', tone: 'danger' },
};

export const EVENT_STATUS = {
  processed: { label: 'Procesado', tone: 'success' as const },
  failed: { label: 'Con error', tone: 'danger' as const },
  pending: { label: 'Pendiente', tone: 'warning' as const },
};
