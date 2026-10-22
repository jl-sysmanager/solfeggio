import { Link } from 'react-router-dom';
import { post } from '../../api/client';
import { useApi, useApiMutation } from '../../api/hooks';
import type { ActiveAnnouncement } from '../../api/types-admin-support';
import { Icon } from '../Icon';

const TONE = { INFO: 'info', WARNING: 'warning', MAINTENANCE: 'danger' } as const;

/** Avisos de plataforma vigentes para el usuario, sobre el contenido. El mantenimiento llega a todos. */
export function AnnouncementBanner() {
  const q = useApi<ActiveAnnouncement[]>('/announcements/active');
  const dismiss = useApiMutation((id: string) => post(`/announcements/${id}/dismiss`), { invalidate: ['/announcements'] });
  if (!q.data?.length) return null;
  return (
    <>
      {q.data.map((a) => (
        <div key={a.id} className={`status-banner status-banner--${TONE[a.level]}`} role="status">
          <Icon name="alert" size={16} />
          <span>
            <strong>{a.title}.</strong> {a.body}
          </span>
          {a.link && (a.link.startsWith('/') ? <Link to={a.link}>Más información</Link> : <a href={a.link} target="_blank" rel="noreferrer noopener">Más información</a>)}
          {a.dismissible && (
            <button type="button" className="btn btn--ghost btn--sm" style={{ marginLeft: 'auto' }} onClick={() => dismiss.mutate(a.id)} aria-label={`Descartar aviso: ${a.title}`}>
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
      ))}
    </>
  );
}
