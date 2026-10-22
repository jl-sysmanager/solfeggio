import type { CohortCell, CohortRow, InsightsFunnel } from '../../../api/types-admin-insights';
import { percent } from '../../../lib/format';
import { monthLabel } from './charts';

/** Embudo de prueba: cada paso con su recuento y la conversión respecto al anterior. */
export function Funnel({ funnel }: { funnel: InsightsFunnel }) {
  const max = Math.max(1, funnel.steps[0]?.count ?? 1, ...funnel.steps.map((s) => s.count));
  return (
    <ol className="list-plain stack" style={{ gap: 12 }}>
      {funnel.steps.map((s) => (
        <li key={s.key}>
          <div className="row between">
            <span>{s.label}</span>
            <span className="tabular-nums">
              <strong>{s.count}</strong>
              {s.conversion !== null && <span className="muted"> · {percent(s.conversion)} del paso anterior</span>}
            </span>
          </div>
          <div className="meter" aria-hidden="true">
            <div className="meter__fill" style={{ width: `${(s.count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function Cell({ cell, label }: { cell: CohortCell | null; label: string }) {
  if (!cell) return <td className="num muted" data-label={label}>—</td>;
  // Intensidad del color según el porcentaje; el valor siempre va escrito.
  const alpha = Math.round(cell.rate * 60) + 8;
  return (
    <td
      className="num tabular-nums"
      data-label={label}
      title={`${cell.active} de ${cell.known} bandas activas`}
      style={{ background: `color-mix(in srgb, var(--primary) ${alpha}%, var(--card))`, color: 'var(--foreground)' }}
    >
      {percent(cell.rate)}
    </td>
  );
}

export function CohortTable({ rows }: { rows: CohortRow[] }) {
  return (
    <div className="table-wrap">
      <table className="table table--responsive">
        <caption className="sr-only">Porcentaje de bandas activas a los 3, 6 y 12 meses por mes de alta</caption>
        <thead>
          <tr>
            <th scope="col">Mes de alta</th>
            <th scope="col" className="num">Bandas</th>
            <th scope="col" className="num">3 meses</th>
            <th scope="col" className="num">6 meses</th>
            <th scope="col" className="num">12 meses</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.month}>
              <th scope="row" data-label="Mes de alta">{monthLabel(r.month)}</th>
              <td className="num" data-label="Bandas">{r.size}</td>
              <Cell cell={r.m3} label="3 meses" />
              <Cell cell={r.m6} label="6 meses" />
              <Cell cell={r.m12} label="12 meses" />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
