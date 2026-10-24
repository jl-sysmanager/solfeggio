import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

interface CardProps {
  title?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  tone?: 'paper' | 'cream' | 'cool' | 'warm';
  children?: ReactNode;
  className?: string;
  as?: 'section' | 'article' | 'div';
  headingLevel?: 2 | 3;
}

export function Card({ title, actions, footer, tone = 'paper', children, className, as = 'section', headingLevel = 2 }: CardProps) {
  const Tag = as;
  const H = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <Tag className={['card', tone !== 'paper' && `card--${tone}`, className].filter(Boolean).join(' ')}>
      {(title || actions) && (
        <div className="card__header">
          {title && <H className="card__title">{title}</H>}
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
      {footer && <div className="card__footer">{footer}</div>}
    </Tag>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'paper',
  meter,
  icon,
  iconColor = 'blue',
  hintTone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /** Color de leyenda del texto de apoyo: ocre pide atención, verde confirma. */
  hintTone?: 'warning' | 'success';
  tone?: CardProps['tone'];
  meter?: number;
  /** Icono en círculo de color, alineado a la derecha (metric card de DESIGN.md). */
  icon?: IconName;
  iconColor?: 'blue' | 'green' | 'amber' | 'red' | 'slate';
}) {
  return (
    <div className={['card metric-card', tone !== 'paper' && `card--${tone}`].filter(Boolean).join(' ')}>
      <div className="metric-card__top">
        <p className="stat__label">{label}</p>
        {icon && (
          <span className={`metric-card__icon metric-card__icon--${iconColor}`}>
            <Icon name={icon} />
          </span>
        )}
      </div>
      <p className="stat__value">{value}</p>
      {meter !== undefined && (
        <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(meter * 100)} aria-label={label}>
          <div className="meter__fill" style={{ width: `${Math.min(100, Math.max(0, meter * 100))}%` }} />
        </div>
      )}
      {hint && <p className={hintTone ? `stat__hint stat__hint--${hintTone}` : 'stat__hint'}>{hint}</p>}
    </div>
  );
}
