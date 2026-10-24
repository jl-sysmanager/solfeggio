import { Link } from 'react-router-dom';
import { post } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import type { NotificationItem, SetupGuide } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { EmptyState, ErrorNote, Loading } from '../components/EmptyState';
import { Page, PageHeader } from '../components/PageHeader';
import { pendingSteps, setupPendingCopy } from '../components/SetupGuide';
import { dateTime } from '../lib/format';

export default function NotificationsPage() {
  const { session } = useAuth();
  const q = useApi<NotificationItem[]>('/notifications');
  const guide = useApi<SetupGuide>(session?.role?.key === 'owner' ? '/setup-guide' : null);
  const pending = pendingSteps(guide.data);
  const read = useApiMutation((id: string) => post(`/notifications/${id}/read`), { invalidate: ['/notifications'] });
  const readAll = useApiMutation(() => post('/notifications/read-all'), { success: 'Todas marcadas como leídas', invalidate: ['/notifications'] });
  const unread = q.data?.filter((n) => !n.readAt).length ?? 0;
  return (
    <Page
      header={
        <PageHeader
          tone="cream"
          title="Notificaciones"
          description={`${unread} sin leer`}
          actions={unread > 0 && <Button variant="ghost" onClick={() => readAll.mutate(undefined)}>Marcar todas como leídas</Button>}
        />
      }
    >
      {pending.length > 0 && guide.data && (
        <Card>
          <div className="row between" style={{ alignItems: 'center' }}>
            <div>
              <p><strong>Configuración pendiente</strong></p>
              <p className="small">{setupPendingCopy(pending.length, guide.data.steps.length)}</p>
            </div>
            <Link className="btn" to="/?guia=1">Continuar</Link>
          </div>
        </Card>
      )}
      {q.isLoading && <Loading />}
      {q.error && <ErrorNote error={q.error} />}
      {q.data &&
        (q.data.length === 0 ? (
          pending.length > 0 ? null : <EmptyState title="Todo al día">No tienes notificaciones.</EmptyState>
        ) : (
          <Card>
            <ul className="list-plain list-divided">
              {q.data.map((n) => (
                <li key={n.id} className="row between" style={{ alignItems: 'flex-start' }}>
                  <div className="stack" style={{ gap: 4, minWidth: 0, flex: 1 }}>
                    <p>
                      {!n.readAt && <span className="chip chip--info" style={{ marginRight: 8 }}>Nueva</span>}
                      <strong>{n.title}</strong>
                    </p>
                    <p className="small">{n.body}</p>
                    <p className="small muted">{dateTime(n.createdAt)}</p>
                  </div>
                  <div className="row">
                    {n.link && (
                      <Link className="link-arrow small" to={n.link} onClick={() => !n.readAt && read.mutate(n.id)}>
                        Ver
                      </Link>
                    )}
                    {!n.readAt && (
                      <Button size="sm" variant="ghost" onClick={() => read.mutate(n.id)} aria-label={`Marcar como leída: ${n.title}`}>
                        Leída
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))}
    </Page>
  );
}
