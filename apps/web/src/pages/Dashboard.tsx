import type { CSSProperties } from 'react';
import { Link, Navigate } from 'react-router-dom';
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

const PAID_FEATURES = ['treasury', 'wardrobe', 'instruments', 'communications', 'performances', 'governance', 'market', 'calendar_sync', 'school', 'reinforcements', 'archive_ai'];
const WEEK_DAYS = 7;

type DashboardEvent = Dashboard['nextEvents'][number];

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Próximos siete días como azulejos; cada día toma el esmalte de su primer evento. */
function WeekTiles({ events }: { events: DashboardEvent[] }) {
  const today = new Date();
  const byDay = new Map<string, DashboardEvent>();
  for (const e of events) {
    if (e.status === 'CANCELLED') continue;
    const k = dayKey(new Date(e.startsAt));
    if (!byDay.has(k)) byDay.set(k, e);
  }
  const days = Array.from({ length: WEEK_DAYS }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + i));
  return (
    <>
      <ol className="week-tiles" aria-label="Próximos siete días">
        {days.map((d, i) => {
          const e = byDay.get(dayKey(d));
          const weekday = d.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '');
          const cls = `week-tile${e ? ` week-tile--${e.type}` : ''}${i === 0 ? ' week-tile--today' : ''}`;
          const label = `${i === 0 ? 'Hoy, ' : ''}${date(d.toISOString(), { weekday: 'long', day: 'numeric', month: 'long' })}${e ? `: ${e.title}, ${time(e.startsAt)}` : ': sin eventos'}`;
          const body = (
            <>
              <span>{weekday}</span>
              <span className="week-tile__day">{d.getDate()}</span>
              {e && <strong>{eventType[e.type]}</strong>}
            </>
          );
          return (
            <li key={dayKey(d)}>
              {e ? (
                <Link to={`/events/${e.id}`} className={cls} aria-label={label}>
                  {body}
                </Link>
              ) : (
                <div className={cls} aria-label={label} role="img">
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="week-legend" aria-hidden="true">
        <span style={{ '--swatch': 'var(--tile-rehearsal)' } as CSSProperties}>Ensayo</span>
        <span style={{ '--swatch': 'var(--tile-performance)' } as CSSProperties}>Actuación</span>
        <span style={{ '--swatch': 'var(--tile-meeting)' } as CSSProperties}>Reunión</span>
      </div>
    </>
  );
}

/** Próxima convocatoria como placa esmaltada: lo primero que debe ver músico y junta. */
function NextEventPlaque({ event }: { event: DashboardEvent }) {
  const isToday = dayKey(new Date(event.startsAt)) === dayKey(new Date());
  return (
    <section className="plaque" aria-labelledby="next-event-title">
      <div>
        <h2 id="next-event-title" className="plaque__title">
          <Link to={`/events/${event.id}`}>{event.title}</Link>
        </h2>
        <p className="plaque__detail">
          {eventType[event.type]} · {isToday ? 'hoy' : date(event.startsAt, { weekday: 'long', day: 'numeric', month: 'long' })}, {time(event.startsAt)}
          {event.location ? ` · ${event.location}` : ''}
        </p>
        {event.counts && (
          <p className="plaque__detail">
            {event.counts.accepted} de {event.counts.called} músicos confirmados
          </p>
        )}
      </div>
      <div className="plaque__actions">
        <ButtonLink to={`/events/${event.id}`}>Ver convocatoria</ButtonLink>
      </div>
    </section>
  );
}

/** Tareas pendientes derivadas de los datos del panel: cobros y convocatorias sin respuesta completa. */
function PendingCard({ dashboard, canFinance }: { dashboard: Dashboard; canFinance: boolean }) {
  const unanswered = dashboard.nextEvents.filter((e) => e.status !== 'CANCELLED' && e.counts && e.counts.accepted < e.counts.called);
  const charges = dashboard.pendingCharges && dashboard.pendingCharges.count > 0 ? dashboard.pendingCharges : null;
  return (
    <Card title="Pendiente">
      {!charges && unanswered.length === 0 ? (
        <p className="muted">Nada pendiente por ahora.</p>
      ) : (
        <ul className="list-plain list-divided">
          {charges && (
            <li className="row" style={{ flexWrap: 'nowrap' }}>
              <span className="chip chip--warning">Cobro</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                {canFinance ? <ArrowLink to="/treasury">{charges.count} recibos por cobrar</ArrowLink> : `${charges.count} recibos por cobrar`}
              </span>
              <span className="small muted nowrap tabular-nums">{money(charges.amountCents)}</span>
            </li>
          )}
          {unanswered.map((e) => (
            <li key={e.id} className="row" style={{ flexWrap: 'nowrap' }}>
              <span className="chip chip--warning">Respuestas</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <ArrowLink to={`/events/${e.id}`}>{e.title}</ArrowLink>
              </span>
              <span className="small muted nowrap tabular-nums">
                {(e.counts?.called ?? 0) - (e.counts?.accepted ?? 0)} sin confirmar
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function DashboardPage() {
  const { session, can, hasFeature } = useAuth();
  // Las familias de la escuela sólo tienen su portal: es su página de inicio.
  const familyOnly = can('school:family') && !can('events:read');
  const q = useApi<Dashboard>(familyOnly ? null : '/dashboard');
  const d = q.data;
  const locked = PAID_FEATURES.filter((f) => !hasFeature(f));
  const firstName = session?.user.name.split(' ')[0];
  const canPlan = can('events:write') && hasFeature('events');
  const nextEvent = d?.nextEvents.find((e) => e.status !== 'CANCELLED');
  if (familyOnly) return <Navigate to="/family" replace />;

  return (
    <Page
      header={
        <PageHeader
          title={`Hola, ${firstName ?? ''}`}
          description={`Resumen de la actividad de ${session?.tenant?.name ?? 'la banda'}.`}
          actions={canPlan ? <ButtonLink to="/events?new=1" variant={nextEvent ? 'ghost' : 'primary'}>Nuevo ensayo</ButtonLink> : undefined}
        />
      }
    >
      {q.isLoading && <Loading />}
      {q.error && <ErrorNote error={q.error} />}
      {d && (
        <>
          {nextEvent && <NextEventPlaque event={nextEvent} />}
          <section aria-label="Indicadores" className="grid grid--stats">
            {d.members && <StatCard label="Socios activos" value={d.members.active} hint={`${d.members.total} en total`} />}
            {can('attendance:read') && (
              <StatCard
                label="Asistencia (30 días)"
                value={percent(d.attendanceRate30d)}
                meter={d.attendanceRate30d ?? undefined}
                hint={d.attendanceRate30d == null ? 'Sin pases de lista en 30 días' : undefined}
              />
            )}
            {d.pendingCharges && (
              <StatCard
                label="Cuotas pendientes"
                value={money(d.pendingCharges.amountCents)}
                hint={d.pendingCharges.count > 0 ? `${d.pendingCharges.count} recibos por cobrar` : 'Todo cobrado'}
                hintTone={d.pendingCharges.count > 0 ? 'warning' : 'success'}
              />
            )}
            {d.storage && (
              <StatCard
                label="Almacenamiento"
                value={bytes(d.storage.usedBytes)}
                hint={`de ${bytes(d.storage.limitBytes)}`}
                meter={d.storage.limitBytes ? d.storage.usedBytes / d.storage.limitBytes : 0}
              />
            )}
            {d.users && (
              <StatCard
                label="Usuarios"
                value={`${d.users.used} / ${d.users.limit < 0 ? '∞' : d.users.limit}`}
                meter={d.users.limit > 0 ? d.users.used / d.users.limit : undefined}
              />
            )}
          </section>

          <div className="grid grid--2">
            <div className="stack" style={{ gap: 24 }}>
            {d.nextEvents.length > 0 && (
              <Card title="Esta semana" actions={<ArrowLink to="/agenda">Abrir agenda</ArrowLink>}>
                <WeekTiles events={d.nextEvents} />
              </Card>
            )}
            <Card title="Próximos eventos" actions={<ArrowLink to="/agenda">Agenda</ArrowLink>}>
              {d.nextEvents.length === 0 ? (
                <EmptyState title="Nada programado" action={canPlan ? <ButtonLink to="/events?new=1">Nuevo ensayo</ButtonLink> : undefined}>
                  Crea un ensayo o actuación para convocar a los músicos.
                </EmptyState>
              ) : (
                <ul className="list-plain list-divided">
                  {d.nextEvents.map((e) => {
                    const start = new Date(e.startsAt);
                    return (
                      <li key={e.id} className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                        <div className={`calendar-day calendar-day--${e.status === 'CANCELLED' ? 'CANCELLED' : e.type}`} aria-hidden="true">
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
            </div>

            <div className="stack" style={{ gap: 24 }}>
              <PendingCard dashboard={d} canFinance={can('finance:read') && hasFeature('treasury')} />
              <Card title="Accesos rápidos">
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
