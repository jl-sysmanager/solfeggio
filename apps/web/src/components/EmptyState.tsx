import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/** Estado vacío: icono, título, explicación breve y la acción que lo resuelve. */
export function EmptyState({ title, children, action, icon = 'inbox' }: { title: string; children?: ReactNode; action?: ReactNode; icon?: IconName }) {
  return (
    <div className="empty">
      <span className="empty__icon">
        <Icon name={icon} size={22} />
      </span>
      <h2 className="card__title">{title}</h2>
      {children && <p className="muted">{children}</p>}
      {action && <div className="empty__action">{action}</div>}
    </div>
  );
}

/**
 * Esqueleto de carga: reserva el espacio del contenido (evita saltos de maquetación) y anuncia
 * «Cargando…» a lectores de pantalla.
 */
export function Loading({ label = 'Cargando…', rows = 4 }: { label?: string; rows?: number }) {
  return (
    <div className="skeleton-card" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="skeleton skeleton--title" aria-hidden="true" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton skeleton--row" aria-hidden="true" style={{ width: `${92 - (i % 3) * 14}%` }} />
      ))}
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Ha ocurrido un error';
  return (
    <div className="callout callout--danger" role="alert">
      <Icon name="alert" size={20} />
      <div>
        <p>
          <strong>No se pudo cargar.</strong> {message}
        </p>
        {onRetry && (
          <button className="link-arrow" onClick={onRetry}>
            Reintentar
          </button>
        )}
      </div>
    </div>
  );
}
