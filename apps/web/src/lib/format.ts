const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });

export function money(cents: number | null | undefined, currency = 'eur') {
  if (cents === null || cents === undefined) return '—';
  if (currency.toLowerCase() === 'eur') return eur.format(cents / 100);
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
}

/** "12,50" → 1250 */
export function parseMoney(value: string): number {
  const n = Number(value.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function date(value: string | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-ES', opts).format(new Date(value));
}

export function dateTime(value: string | null | undefined) {
  return date(value, { dateStyle: 'medium', timeStyle: 'short' });
}

export function time(value: string) {
  return new Intl.DateTimeFormat('es-ES', { timeStyle: 'short' }).format(new Date(value));
}

export function percent(rate: number | null | undefined) {
  if (rate === null || rate === undefined) return '—';
  return `${Math.round(rate * 100)} %`;
}

export function bytes(n: number | string | null | undefined) {
  const v = Number(n ?? 0);
  if (v < 1024) return `${v} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let x = v / 1024;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toFixed(x < 10 ? 1 : 0)} ${units[i]}`;
}

export function duration(sec: number | null | undefined) {
  if (!sec) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** ISO → valor para <input type="datetime-local"> en hora local. */
export function toLocalInput(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function fullName(m?: { firstName: string; lastName: string } | null) {
  return m ? `${m.firstName} ${m.lastName}` : '—';
}
