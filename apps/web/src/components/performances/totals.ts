import type { QuoteLine } from '../../api/types-performances';

/** Mismo redondeo que el servidor (mitad lejos de cero): por línea y después el impuesto sobre la base. */
const roundCents = (x: number) => Math.sign(x) * Math.round(Math.abs(x)) || 0;

export function lineCents(l: Pick<QuoteLine, 'quantity' | 'unitCents'>) {
  return roundCents(l.quantity * l.unitCents);
}

export function computeTotals(lines: Pick<QuoteLine, 'quantity' | 'unitCents'>[], taxRatePct: number) {
  const baseCents = lines.reduce((s, l) => s + lineCents(l), 0);
  const taxCents = roundCents((baseCents * taxRatePct) / 100);
  return { baseCents, taxCents, totalCents: baseCents + taxCents };
}

export function withholding(grossCents: number, pct: number) {
  const withholdingCents = Math.round((grossCents * pct) / 100);
  return { withholdingCents, netCents: grossCents - withholdingCents };
}

/** "1,5" → 1.5 (cantidades con hasta dos decimales). */
export function parseQuantity(value: string) {
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
