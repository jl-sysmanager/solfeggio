import { useId, type ReactNode } from 'react';
import { Chip, type ChipTone } from '../../Chip';
import { money } from '../../../lib/format';
import type { LimitUse, MonthMetrics } from '../../../api/types-admin-insights';
import { bytes } from '../../../lib/format';

export const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const monthLabel = (key: string) => `${MONTHS_ES[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`;

/** Chip de puntuación de salud: el número y la etiqueta, nunca sólo color. */
export function ScoreChip({ score }: { score: number | null | undefined }) {
  if (score === null || score === undefined) return <Chip>Sin datos</Chip>;
  const [tone, label]: [ChipTone, string] = score >= 70 ? ['success', 'Sana'] : score >= 40 ? ['warning', 'Atención'] : ['danger', 'En riesgo'];
  return (
    <Chip tone={tone}>
      <span className="tabular-nums">{score}</span> · {label}
    </Chip>
  );
}

const SERIES: { key: keyof MonthMetrics; label: string; color: string; sign: 1 | -1 }[] = [
  { key: 'newCents', label: 'Altas', color: 'var(--primary)', sign: 1 },
  { key: 'reactivationCents', label: 'Reactivaciones', color: 'var(--info)', sign: 1 },
  { key: 'expansionCents', label: 'Mejoras', color: 'var(--success)', sign: 1 },
  { key: 'contractionCents', label: 'Bajadas de plan', color: 'var(--warning-strong)', sign: -1 },
  { key: 'churnedCents', label: 'Bajas', color: 'var(--destructive)', sign: -1 },
];

/** Movimientos mensuales de MRR: lo que suma sobre el eje y lo que resta debajo. */
export function MrrMovementsChart({ months }: { months: MonthMetrics[] }) {
  const titleId = useId();
  const W = 720;
  const H = 260;
  const pad = { l: 56, r: 8, t: 12, b: 28 };
  const up = Math.max(1, ...months.map((m) => SERIES.filter((s) => s.sign > 0).reduce((t, s) => t + (m[s.key] as number), 0)));
  const down = Math.max(1, ...months.map((m) => SERIES.filter((s) => s.sign < 0).reduce((t, s) => t + (m[s.key] as number), 0)));
  const hasMovement = months.some((m) => SERIES.some((s) => (m[s.key] as number) > 0));
  const plotH = H - pad.t - pad.b;
  const scale = plotH / (up + down);
  const zero = pad.t + up * scale;
  const slot = (W - pad.l - pad.r) / Math.max(1, months.length);
  const bar = Math.min(36, slot * 0.6);
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={titleId} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <title id={titleId}>Movimientos mensuales de MRR: altas, reactivaciones, mejoras, bajadas y bajas</title>
        {[up, 0, -down].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={zero - v * scale} y2={zero - v * scale} stroke="var(--border-color)" strokeWidth={v === 0 ? 1.5 : 1} />
            <text x={pad.l - 6} y={zero - v * scale + 4} textAnchor="end" fontSize="11" fill="var(--muted-foreground)">
              {hasMovement || v === 0 ? money(Math.abs(v)) : ''}
            </text>
          </g>
        ))}
        {months.map((m, i) => {
          const x = pad.l + i * slot + (slot - bar) / 2;
          let upY = zero;
          let downY = zero;
          return (
            <g key={m.month}>
              {SERIES.map((s) => {
                const v = m[s.key] as number;
                if (!v) return null;
                const h = Math.max(2, v * scale - 2);
                const y = s.sign > 0 ? (upY -= v * scale) : downY;
                if (s.sign < 0) downY += v * scale;
                return (
                  <rect key={s.key} x={x} y={s.sign > 0 ? y + 2 : y + 2} width={bar} height={h} rx={3} fill={s.color}>
                    <title>{`${monthLabel(m.month)} · ${s.label}: ${s.sign < 0 ? '−' : '+'}${money(v)}`}</title>
                  </rect>
                );
              })}
              <text x={x + bar / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">
                {monthLabel(m.month)}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption>
        <ul className="list-plain row" style={{ gap: 16, flexWrap: 'wrap' }}>
          {SERIES.map((s) => (
            <li key={s.key} className="row small" style={{ gap: 6 }}>
              <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 2, background: s.color, display: 'inline-block' }} />
              {s.label}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

/** Barras horizontales sencillas (estacionalidad). */
export function PairBars({ rows }: { rows: { label: string; a: number; b: number }[] }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.a, r.b]));
  return (
    <div className="stack" style={{ gap: 6 }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 56px', gap: 8, alignItems: 'center' }}>
          <span className="small muted">{r.label}</span>
          <div className="stack" style={{ gap: 2 }}>
            <div style={{ height: 8, width: `${(r.a / max) * 100}%`, minWidth: r.a ? 4 : 0, background: 'var(--primary)', borderRadius: 4 }} />
            <div style={{ height: 8, width: `${(r.b / max) * 100}%`, minWidth: r.b ? 4 : 0, background: 'var(--destructive)', borderRadius: 4 }} />
          </div>
          <span className="small tabular-nums">
            {r.a} / {r.b}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Minigráfico de tendencia. */
export function Sparkline({ values, label, format = (v: number) => String(v) }: { values: number[]; label: string; format?: (v: number) => string }) {
  const W = 160;
  const H = 40;
  if (values.length === 0) return <span className="small muted">Sin datos</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${values.length === 1 ? W / 2 : (i / (values.length - 1)) * W},${H - 4 - ((v - min) / span) * (H - 8)}`);
  const last = values[values.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`${label}: último valor ${format(last)}, mínimo ${format(min)}, máximo ${format(max)}`}>
      <polyline points={pts.join(' ')} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1].split(',')[0]} cy={pts[pts.length - 1].split(',')[1]} r={3} fill="var(--primary)" stroke="var(--card)" strokeWidth={2} />
    </svg>
  );
}

/** Uso de un límite del plan: la barra se vuelve ámbar al 80 % y roja al 100 %. */
export function LimitBar({ limit }: { limit: LimitUse }) {
  const fmt = (n: number) => (limit.key === 'storage' ? bytes(n) : String(n));
  const pct = limit.ratio === null ? 0 : Math.min(1, limit.ratio);
  const color = limit.ratio !== null && limit.ratio >= 1 ? 'var(--destructive)' : limit.ratio !== null && limit.ratio >= 0.8 ? 'var(--warning-strong)' : 'var(--primary)';
  return (
    <div>
      <div className="row between small">
        <span>{limit.label}</span>
        <span className="tabular-nums">
          {fmt(limit.used)} / {limit.max === null ? '∞' : fmt(limit.max)}
          {limit.ratio !== null && ` (${Math.round(limit.ratio * 100)} %)`}
        </span>
      </div>
      <div className="meter" role="meter" aria-label={`Uso de ${limit.label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}>
        <div className="meter__fill" style={{ width: `${pct * 100}%`, background: color }} />
      </div>
    </div>
  );
}

export function Delta({ children }: { children: ReactNode }) {
  return <span className="tabular-nums">{children}</span>;
}
