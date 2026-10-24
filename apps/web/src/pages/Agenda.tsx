import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../api/client';
import { useApi } from '../api/hooks';
import type { AgendaItem } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { EmptyState, ErrorNote, Loading } from '../components/EmptyState';
import { Page, PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toasts';
import { date, time } from '../lib/format';
import { groupByDay, monthRange, MonthNav } from './Events';

const KIND = {
  event: { label: 'Evento', tone: 'info' as const },
  fee_due: { label: 'Vence cuota', tone: 'warning' as const },
  loan_due: { label: 'Devolución', tone: 'neutral' as const },
};

export default function AgendaPage() {
  const { hasFeature } = useAuth();
  const toast = useToast();
  const [offset, setOffset] = useState(0);
  const [icsUrl, setIcsUrl] = useState<string | null>(null);
  const range = monthRange(offset);
  const q = useApi<AgendaItem[]>('/agenda', { from: range.from.toISOString(), to: range.to.toISOString() });

  async function loadIcs() {
    try {
      const { url } = await get<{ url: string }>('/agenda/ics-url');
      setIcsUrl(url);
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <Page header={<PageHeader eyebrow="Agenda" title="Calendario de la banda" description="Ensayos, actuaciones, vencimientos de cuotas y devoluciones de material." />}>
      <div className="row between">
        <MonthNav offset={offset} setOffset={setOffset} label={range.label} />
      </div>
      {q.isLoading && <Loading />}
      {q.error && <ErrorNote error={q.error} />}
      {q.data &&
        (q.data.length === 0 ? (
          <EmptyState title="Sin actividades este mes" />
        ) : (
          <Card>
            <ul className="list-plain list-divided">
              {groupByDay(q.data).map(([day, items]) => (
                <li key={day} className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                  <div className={`calendar-day calendar-day--${items.some((i) => i.kind === 'event') ? 'REHEARSAL' : items.some((i) => i.kind === 'fee_due') ? 'DUE' : 'OTHER'}`} aria-hidden="true">
                    <strong>{new Date(items[0].startsAt).getDate()}</strong>
                    <span>{new Date(items[0].startsAt).toLocaleDateString('es-ES', { weekday: 'short' })}</span>
                  </div>
                  <div className="stack" style={{ flex: 1, minWidth: 0 }}>
                    <span className="sr-only">{date(items[0].startsAt, { dateStyle: 'full' })}</span>
                    {items.map((i) => (
                      <div key={`${i.kind}-${i.id}`} className="row">
                        <Chip tone={KIND[i.kind].tone}>{KIND[i.kind].label}</Chip>
                        <span className="small muted">{i.kind === 'event' ? time(i.startsAt) : ''}</span>
                        {i.link ? (
                          <Link className="link-arrow" to={i.link}>
                            {i.title}
                          </Link>
                        ) : (
                          <span>{i.title}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))}

      <Card title="Sincronizar con tu calendario" tone="cream">
        {hasFeature('calendar_sync') ? (
          <div className="stack">
            <p className="small">
              Suscríbete desde Google Calendar, Apple Calendar u Outlook con tu enlace personal (formato iCalendar). No lo compartas: da acceso a tus eventos.
            </p>
            {icsUrl ? (
              <div className="row">
                <input className="input" readOnly value={icsUrl} aria-label="Enlace iCalendar" onFocus={(e) => e.currentTarget.select()} style={{ flex: 1 }} />
                <Button
                  variant="ghost"
                  onClick={() => navigator.clipboard?.writeText(icsUrl).then(() => toast.notify('Enlace copiado'))}
                >
                  Copiar
                </Button>
              </div>
            ) : (
              <div>
                <Button onClick={loadIcs}>Obtener enlace</Button>
              </div>
            )}
          </div>
        ) : (
          <p className="small">La sincronización de calendario está disponible a partir del plan Pro.</p>
        )}
      </Card>
    </Page>
  );
}
