import { Navigate } from 'react-router-dom';
import { useApi } from '../api/hooks';
import type { Dashboard } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { ArrowLink, ButtonLink } from '../components/Button';
import { Card, StatCard } from '../components/Card';
import { StatusChip } from '../components/Chip';
import { EmptyState, ErrorNote, Loading } from '../components/EmptyState';
import { Page, PageHeader } from '../components/PageHeader';
import { bytes, date, money, percent, time } from '../lib/format';
import { eventStatus, eventType, featureLabels, featureMinPlan } from '../lib/labels';

const PAID_FEATURES = ['treasury', 'wardrobe', 'instruments', 'communications', 'market', 'calendar_sync'];

export function DashboardPage() {
  const { session, can, hasFeature } = useAuth();
  // Las familias de la escuela sólo tienen su portal: es su página de inicio.
  const familyOnly = can('school:family') && !can('events:read');
  const q = useApi<Dashboard>(familyOnly ? null : '/dashboard');
  const d = q.data;
  const locked = PAID_FEATURES.filter((f) => !hasFeature(f));
  const firstName = session?.user.name.split(' ')[0];
  if (familyOnly) return <Navigate to="/family" replace />;

  return (
    <Page
      header={
        <PageHeader
          title={`Hola, ${firstName ?? ''}`}
          description={`Resumen de la actividad de ${session?.tenant?.name ?? 'la banda'}.`}
          actions={
            can('events:write') && hasFeature('events') ? <ButtonLink to="/events?new=1">Nuevo ensayo</ButtonLink> : undefined
          }
        />
      }
    >
      {q.isLoading && <Loading />}
      {q.error && <ErrorNote error={q.error} />}
      {d && (
        <>
          <section aria-label="Indicadores" className="grid grid--stats">
            {d.members && <StatCard label="Socios activos" value={d.members.active} hint={`${d.members.total} en total`} icon="users" iconColor="blue" />}
            {can('attendance:read') && (
              <StatCard
                label="Asistencia últimos 30 días"
                value={percent(d.attendanceRate30d)}
                meter={d.attendanceRate30d ?? undefined}
                icon="check"
                iconColor="green"
              />
            )}
            {d.pendingCharges && (
              <StatCard label="Cuotas pendientes" value={money(d.pendingCharges.amountCents)} hint={`${d.pendingCharges.count} recibos`} icon="euro" iconColor="amber" />
            )}
            {d.storage && (
              <StatCard
                label="Almacenamiento"
                value={bytes(d.storage.usedBytes)}
                hint={`de ${bytes(d.storage.limitBytes)}`}
                icon="storage"
                iconColor="slate"
                meter={d.storage.limitBytes ? d.storage.usedBytes / d.storage.limitBytes : 0}
              />
            )}
            {d.users && (
              <StatCard
                label="Usuarios"
                value={`${d.users.used} / ${d.users.limit < 0 ? '∞' : d.users.limit}`}
                meter={d.users.limit > 0 ? d.users.used / d.users.limit : undefined}
                icon="user"
                iconColor="blue"
              />
            )}
          </section>

          <div className="grid grid--2">
            <Card title="Próximos eventos" actions={<ArrowLink to="/agenda">Agenda</ArrowLink>}>
              {d.nextEvents.length === 0 ? (
                <EmptyState title="Nada programado">Crea un ensayo o actuación para convocar a los músicos.</EmptyState>
              ) : (
                <ul className="list-plain list-divided">
                  {d.nextEvents.map((e) => {
                    const start = new Date(e.startsAt);
                    return (
                      <li key={e.id} className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                        <div className="calendar-day" aria-hidden="true">
                          <strong>{start.getDate()}</strong>
                          <span>{start.toLocaleDateString('es-ES', { month: 'short' })}</span>
                        </div>
                        <div className="stack" style={{ gap: 4, minWidth: 0 }}>
                          <ArrowLink to={`/events/${e.id}`}>{e.title}</ArrowLink>
                          <span className="small muted">
                            {eventType[e.type]} · {date(e.startsAt, { weekday: 'long', day: 'numeric', month: 'long' })} · {time(e.startsAt)}
                            {e.location ? ` · ${e.location}` : ''}
                          </span>
                          <div className="chips">
                            <StatusChip value={e.status} map={eventStatus} />
                            {e.counts && (
                              <span className="chip chip--plain">
                                {e.counts.accepted}/{e.counts.called} confirmados
                              </span>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <div className="stack" style={{ gap: 24 }}>
              <Card title="Accesos rápidos" tone="cream">
                <ul className="list-plain stack">
                  {can('archive:read') && hasFeature('archive') && <li><ArrowLink to="/archive">Buscar en el archivo</ArrowLink></li>}
                  {can('attendance:read') && <li><ArrowLink to="/attendance">Estadísticas de asistencia</ArrowLink></li>}
                  {can('members:write') && <li><ArrowLink to="/members?new=1">Dar de alta a un socio</ArrowLink></li>}
                  {can('finance:read') && hasFeature('treasury') && <li><ArrowLink to="/treasury">Informe de tesorería</ArrowLink></li>}
                  {can('market:read') && hasFeature('market') && <li><ArrowLink to="/market">Ver BandMarket</ArrowLink></li>}
                </ul>
              </Card>
              {locked.length > 0 && can('billing:manage') && (
                <Card title="Amplía tu plan" tone="warm">
                  <ul className="list-plain stack small">
                    {locked.map((f) => (
                      <li key={f}>
                        {featureLabels[f]} — desde {featureMinPlan[f]}
                      </li>
                    ))}
                  </ul>
                  <div className="card__footer">
                    <ButtonLink to="/billing">Ver planes</ButtonLink>
                  </div>
                </Card>
              )}
            </div>
          </div>
        </>
      )}
    </Page>
  );
}
