import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { patch, post } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import type { EventItem } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { ArrowLink, Button } from '../components/Button';
import { Card } from '../components/Card';
import { StatusChip } from '../components/Chip';
import { EmptyState, ErrorNote, Loading } from '../components/EmptyState';
import { Checkbox, FormError, SelectField, TextAreaField, TextField, formValues } from '../components/Field';
import { Modal } from '../components/Modal';
import { Page, PageHeader } from '../components/PageHeader';
import { date, time, toLocalInput } from '../lib/format';
import { eventStatus, eventType } from '../lib/labels';

export function monthRange(offset: number) {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const to = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
  return { from, to, label: from.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }) };
}

export function groupByDay<T extends { startsAt: string }>(items: T[]) {
  const map = new Map<string, T[]>();
  for (const i of [...items].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const key = new Date(i.startsAt).toDateString();
    map.set(key, [...(map.get(key) ?? []), i]);
  }
  return Array.from(map.entries());
}

export function MonthNav({ offset, setOffset, label }: { offset: number; setOffset: (n: number) => void; label: string }) {
  return (
    <div className="row" role="group" aria-label="Cambiar mes">
      <Button variant="ghost" size="sm" onClick={() => setOffset(offset - 1)} aria-label="Mes anterior">
        ←
      </Button>
      <strong style={{ minWidth: 170, textAlign: 'center', textTransform: 'capitalize' }} aria-live="polite">
        {label}
      </strong>
      <Button variant="ghost" size="sm" onClick={() => setOffset(offset + 1)} aria-label="Mes siguiente">
        →
      </Button>
      {offset !== 0 && (
        <Button variant="ghost" size="sm" onClick={() => setOffset(0)}>
          Hoy
        </Button>
      )}
    </div>
  );
}

const REMINDERS = [
  { value: 60, label: '1 hora antes' },
  { value: 1440, label: '1 día antes' },
  { value: 10080, label: '1 semana antes' },
];

export function EventFormModal({ open, onClose, event }: { open: boolean; onClose: () => void; event?: EventItem | null }) {
  const navigate = useNavigate();
  const save = useApiMutation(
    (body: unknown) => (event ? patch<EventItem>(`/events/${event.id}`, body) : post<EventItem>('/events', body)),
    {
      success: event ? 'Evento actualizado' : 'Evento creado',
      invalidate: ['/events', '/agenda', '/dashboard'],
      onSuccess: (ev) => {
        onClose();
        if (!event) navigate(`/events/${ev.id}`);
      },
    },
  );
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    const fd = new FormData(e.currentTarget);
    const startsAt = new Date(v.startsAt!);
    const endsAt = new Date(v.endsAt!);
    if (endsAt <= startsAt) {
      setError('La hora de fin debe ser posterior al inicio.');
      return;
    }
    setError(null);
    save.mutate({
      type: v.type,
      title: v.title,
      location: v.location ?? null,
      description: v.description ?? null,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      reminderMinutes: fd.getAll('reminder').map(Number),
    });
  }

  const defaultStart = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(20, 0, 0, 0);
    return d;
  }, []);
  const defaultEnd = new Date(defaultStart.getTime() + 2 * 3600_000);

  return (
    <Modal open={open} onClose={onClose} title={event ? 'Editar evento' : 'Nuevo evento'}>
      <form className="form" onSubmit={submit} key={event?.id ?? 'new'}>
        <div className="form-row">
          <SelectField label="Tipo" name="type" defaultValue={event?.type ?? 'REHEARSAL'} options={Object.entries(eventType).map(([value, label]) => ({ value, label }))} />
          <TextField label="Título" name="title" required defaultValue={event?.title ?? 'Ensayo general'} />
        </div>
        <div className="form-row">
          <TextField label="Inicio" name="startsAt" type="datetime-local" required defaultValue={toLocalInput(event?.startsAt ?? defaultStart.toISOString())} />
          <TextField label="Fin" name="endsAt" type="datetime-local" required defaultValue={toLocalInput(event?.endsAt ?? defaultEnd.toISOString())} />
        </div>
        <TextField label="Lugar" name="location" defaultValue={event?.location ?? ''} />
        <TextAreaField label="Descripción / indicaciones" name="description" defaultValue={event?.description ?? ''} />
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field__label" style={{ marginBottom: 8 }}>
            Recordatorios a los convocados
          </legend>
          <div className="row">
            {REMINDERS.map((r) => (
              <Checkbox key={r.value} name="reminder" value={String(r.value)} label={r.label} defaultChecked={(event?.reminderMinutes ?? [1440]).includes(r.value)} />
            ))}
          </div>
        </fieldset>
        <FormError error={error ?? save.error} />
        <div className="modal__footer">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            Guardar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function EventsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [offset, setOffset] = useState(0);
  const [type, setType] = useState('');
  const range = monthRange(offset);
  const q = useApi<EventItem[]>('/events', { from: range.from.toISOString(), to: range.to.toISOString(), type });
  const creating = params.get('new') === '1';
  const setCreating = (v: boolean) => setParams(v ? { new: '1' } : {}, { replace: true });

  return (
    <Page
      header={
        <PageHeader
          eyebrow="Ensayos y actuaciones"
          title="Eventos"
          description="Planifica ensayos, convoca a los músicos y prepara el repertorio."
          actions={can('events:write') && <Button onClick={() => setCreating(true)}>Nuevo evento</Button>}
        />
      }
    >
      <div className="row between">
        <MonthNav offset={offset} setOffset={setOffset} label={range.label} />
        <div className="segmented" role="group" aria-label="Filtrar por tipo">
          <button aria-pressed={type === ''} onClick={() => setType('')}>
            Todos
          </button>
          {Object.entries(eventType).map(([k, l]) => (
            <button key={k} aria-pressed={type === k} onClick={() => setType(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {q.isLoading && <Loading />}
      {q.error && <ErrorNote error={q.error} />}
      {q.data &&
        (q.data.length === 0 ? (
          <EmptyState title="Sin eventos este mes" action={can('events:write') ? <Button onClick={() => setCreating(true)}>Crear evento</Button> : undefined} />
        ) : (
          <div className="stack" style={{ gap: 24 }}>
            {groupByDay(q.data).map(([day, events]) => (
              <section key={day} aria-label={date(events[0].startsAt, { dateStyle: 'full' })} className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', gap: 16 }}>
                <div className="calendar-day" aria-hidden="true">
                  <strong>{new Date(events[0].startsAt).getDate()}</strong>
                  <span>{new Date(events[0].startsAt).toLocaleDateString('es-ES', { weekday: 'short' })}</span>
                </div>
                <div className="grid" style={{ flex: 1 }}>
                  {events.map((e) => (
                    <Card key={e.id} as="article" headingLevel={3} tone={e.type === 'PERFORMANCE' ? 'cream' : 'paper'}>
                      <p className="small muted">
                        {eventType[e.type]} · {time(e.startsAt)}–{time(e.endsAt)}
                      </p>
                      <h3 className="card__title" style={{ margin: '6px 0' }}>
                        <ArrowLink to={`/events/${e.id}`}>{e.title}</ArrowLink>
                      </h3>
                      {e.location && <p className="small">{e.location}</p>}
                      <div className="chips" style={{ marginTop: 12 }}>
                        <StatusChip value={e.status} map={eventStatus} />
                        {e.counts && (
                          <span className="chip chip--plain">
                            {e.counts.accepted}/{e.counts.called} confirmados
                          </span>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ))}
      <EventFormModal open={creating} onClose={() => setCreating(false)} />
    </Page>
  );
}
