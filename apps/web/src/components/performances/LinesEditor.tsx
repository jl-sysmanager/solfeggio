import type { QuoteLine } from '../../api/types-performances';
import { money, parseMoney } from '../../lib/format';
import { Button } from '../Button';
import { computeTotals, lineCents, parseQuantity } from './totals';

export interface DraftLine {
  description: string;
  quantity: string;
  unit: string;
}

export const toDraft = (l: QuoteLine): DraftLine => ({
  description: l.description,
  quantity: String(l.quantity).replace('.', ','),
  unit: (l.unitCents / 100).toFixed(2).replace('.', ','),
});

export const fromDraft = (l: DraftLine): QuoteLine => ({
  description: l.description.trim(),
  quantity: parseQuantity(l.quantity),
  unitCents: parseMoney(l.unit),
});

export const emptyLine = (): DraftLine => ({ description: '', quantity: '1', unit: '' });

/** Líneas de presupuesto/factura con totales en vivo. */
export function LinesEditor({ lines, onChange, taxRatePct }: { lines: DraftLine[]; onChange: (l: DraftLine[]) => void; taxRatePct: number }) {
  const parsed = lines.map(fromDraft);
  const t = computeTotals(parsed, taxRatePct);
  const set = (i: number, patch: Partial<DraftLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="stack">
      <div className="table-wrap">
        <table className="table table--responsive">
          <caption className="sr-only">Líneas</caption>
          <thead>
            <tr>
              <th scope="col">Concepto</th>
              <th scope="col" className="num">Cantidad</th>
              <th scope="col" className="num">Precio (€)</th>
              <th scope="col" className="num">Importe</th>
              <th scope="col" className="actions">
                <span className="sr-only">Quitar</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td data-label="Concepto">
                  <input className="input" aria-label={`Concepto de la línea ${i + 1}`} value={l.description} required maxLength={300} onChange={(e) => set(i, { description: e.target.value })} />
                </td>
                <td data-label="Cantidad" className="num">
                  <input
                    className="input"
                    style={{ maxWidth: 90 }}
                    aria-label={`Cantidad de la línea ${i + 1}`}
                    inputMode="decimal"
                    pattern="\d+([.,]\d{1,2})?"
                    required
                    value={l.quantity}
                    onChange={(e) => set(i, { quantity: e.target.value })}
                  />
                </td>
                <td data-label="Precio (€)" className="num">
                  <input
                    className="input"
                    style={{ maxWidth: 120 }}
                    aria-label={`Precio unitario de la línea ${i + 1}`}
                    inputMode="decimal"
                    pattern="\d+([.,]\d{1,2})?"
                    required
                    value={l.unit}
                    onChange={(e) => set(i, { unit: e.target.value })}
                  />
                </td>
                <td data-label="Importe" className="num nowrap">
                  {money(lineCents(parsed[i]))}
                </td>
                <td className="actions">
                  <Button size="sm" variant="ghost" disabled={lines.length === 1} onClick={() => onChange(lines.filter((_, j) => j !== i))} aria-label={`Quitar línea ${i + 1}`}>
                    ×
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row between">
        <Button size="sm" variant="ghost" onClick={() => onChange([...lines, emptyLine()])} disabled={lines.length >= 50}>
          Añadir línea
        </Button>
        <div className="small" style={{ margin: 0, textAlign: 'right' }} aria-live="polite">
          <div>
            Base imponible: <strong>{money(t.baseCents)}</strong>
          </div>
          <div>
            Impuesto ({taxRatePct} %): <strong>{money(t.taxCents)}</strong>
          </div>
          <div>
            Total: <strong>{money(t.totalCents)}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
