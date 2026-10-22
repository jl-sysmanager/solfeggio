import type { ReactNode } from 'react';

export type ChipTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export function Chip({ tone = 'neutral', children, plain }: { tone?: ChipTone; children: ReactNode; plain?: boolean }) {
  return <span className={`chip chip--${tone}${plain ? ' chip--plain' : ''}`}>{children}</span>;
}

/** Chip a partir de un mapa de etiquetas { VALOR: { label, tone } }. */
export function StatusChip({ value, map }: { value: string; map: Record<string, { label: string; tone: ChipTone }> }) {
  const entry = map[value] ?? { label: value, tone: 'neutral' as const };
  return <Chip tone={entry.tone}>{entry.label}</Chip>;
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="chip chip--outline chip--plain">{children}</span>;
}
