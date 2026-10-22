import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { post, put } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import type { AttendanceStatus, EventDetail, Member, Paginated, Work } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { Person } from '../components/Avatar';
import { ArrowLink, Button } from '../components/Button';
import { Card } from '../components/Card';
import { StatusChip } from '../components/Chip';
import { DataTable } from '../components/DataTable';
import { ErrorNote, Loading } from '../components/EmptyState';
import { FormError, TextAreaField, TextField, formValues } from '../components/Field';
import { ConfirmModal, Modal } from '../components/Modal';
import { Page, PageHeader } from '../components/PageHeader';
import { LogisticsPanel } from '../components/performances/LogisticsPanel';
import { StaffingPanel } from '../components/performances/StaffingPanel';
import { Tabs } from '../components/Tabs';
import { date, duration, fullName, time } from '../lib/format';
import { attendanceStatus, callResponse, eventStatus, eventType, justificationStatus } from '../lib/labels';
import { useSections } from './Members';
import { EventFormModal } from './Events';

function RepertoireModal({ event, open, onClose }: { event: EventDetail; open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Work[]>([]);
  useEffect(() => {
    if (open) setSelected(event.repertoire.sort((a, b) => a.position - b.position).map((r) => r.work));
  }, [open, event.repertoire]);
  const results = useApi<Paginated<Work>>(open ? '/works' : null, { q, pageSize: 10 });
  const save = useApiMutation(() => put(`/events/${event.id}/repertoire`, selected.map((w) => ({ workId: w.id }))), {
    success: 'Repertorio guardado',
    invalidate: [`/events/${event.id}`],
    onSuccess: onClose,
  });
  const move = (i: number, d: number) =>
    setSelected((s) => {
      const next = [...s];
      const j = i + d;
      if (j < 0 || j >= next.length) return s;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  return (
    <Modal open={open} onClose={onClose} title="Repertorio del evento">
      <div className="stack">
        <TextField label="Buscar obra" type="search" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="list-plain list-divided" aria-label="Resultados">
          {(results.data?.data ?? [])
            .filter((w) => !selected.some((s) => s.id === w.id))
            .map((w) => (
              <li key={w.id} className="row between">
                <span>
                  {w.title} <span className="small muted">· {w.composer?.name ?? '—'}</span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => setSelected((s) => [...s, w])} aria-label={`Añadir ${w.title}`}>
                  Añadir
                </Button>
              </li>
            ))}
        </ul>
        <h3>Orden del programa</h3>
        {selected.length === 0 ? (
          <p className="muted">Sin obras.</p>
        ) : (
          <ol className="list-divided" style={{ paddingLeft: 20 }}>
            {selected.map((w, i) => (
              <li key={w.id}>
                <div className="row between">
                  <span>{w.title}</span>
                  <div className="row">
                    <Button size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Subir ${w.title}`}>
                      ↑
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === selected.length - 1} aria-label={`Bajar ${w.title}`}>
                      ↓
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => setSelected((s) => s.filter((x) => x.id !== w.id))} aria-label={`Quitar ${w.title}`}>
                      Quitar
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
        <FormError error={save.error} />
        <div className="modal__footer">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate(undefined)} loading={save.isPending}>
            Guardar repertorio
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CallModal({ event, open, onClose }: { event: EventDetail; open: boolean; onClose: () => void }) {
  const sections = useSections();
  const [mode, setMode] = useState<'all' | 'sections'>('all');
  const [ids, setIds] = useState<string[]>([]);
  const call = useApiMutation(() => post(`/events/${event.id}/calls`, mode === 'all' ? { all: true } : { sectionIds: ids }), {
    success: 'Convocatoria enviada',
    invalidate: [`/events/${event.id}`, '/events'],
    onSuccess: onClose,
  });
  return (
    <Modal open={open} onClose={onClose} title="Convocar músicos">
      <div className="stack">
        <p className="small">Los convocados recibirán una notificación y podrán confirmar o rechazar su asistencia.</p>
        <div className="segmented" role="group" aria-label="A quién convocar">
          <button aria-pressed={mode === 'all'} onClick={() => setMode('all')}>
            Todos los activos
          </button>
          <button aria-pressed={mode === 'sections'} onClick={() => setMode('sections')}>
            Por secciones
          </button>
        </div>
        {mode === 'sections' && (
          <div className="chips">
            {(sections.data ?? []).map((s) => {
              const on = ids.includes(s.id);
              return (
                <button key={s.id} className="chip chip--plain chip--outline" aria-pressed={on} onClick={() => setIds((x) => (on ? x.filter((i) => i !== s.id) : [...x, s.id]))}>
                  {s.name}
                </button>
              );
            })}
          </div>
        )}
        <FormError error={call.error} />
        <div className="modal__footer">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => call.mutate(undefined)} loading={call.isPending} disabled={mode === 'sections' && ids.length === 0}>
            Convocar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const STATUSES: AttendanceStatus[] = ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'];

function AttendanceGrid({ event }: { event: EventDetail }) {
  const { can } = useAuth();
  const needMembers = event.calls.length === 0 && can('members:read');
  const members = useApi<Paginated<Member>>(needMembers ? '/members' : null, { status: 'ACTIVE', pageSize: 500 });
  const roster = useMemo(() => {
    if (event.calls.length > 0) return event.calls.map((c) => c.member);
    return (members.data?.data ?? []).map((m) => ({ id: m.id, firstName: m.firstName, lastName: m.lastName, instrument: m.instrument, sectionId: m.sectionId }));
  }, [event.calls, members.data]);
  const [values, setValues] = useState<Record<string, AttendanceStatus>>({});
  useEffect(() => {
    const init: Record<string, AttendanceStatus> = {};
    for (const a of event.attendance) init[a.memberId] = a.status;
    for (const c of event.calls) if (!init[c.member.id] && c.response === 'DECLINED') init[c.member.id] = 'EXCUSED';
    setValues(init);
  }, [event.attendance, event.calls]);

  const save = useApiMutation(
    () => put(`/events/${event.id}/attendance`, Object.entries(values).map(([memberId, status]) => ({ memberId, status }))),
    { success: 'Asistencia guardada', invalidate: [`/events/${event.id}`, '/attendance', '/dashboard'] },
  );

  if (members.isLoading) return <Loading />;
  if (roster.length === 0) return <p className="muted">Convoca a los músicos para pasar lista.</p>;
  const markAll = (s: AttendanceStatus) => setValues(Object.fromEntries(roster.map((m) => [m.id, values[m.id] ?? s])));

  return (
    <div className="stack">
      <div className="row">
        <Button size="sm" variant="ghost" onClick={() => markAll('PRESENT')}>
          Marcar resto como presentes
        </Button>
        <span className="small muted">
          {Object.keys(values).length}/{roster.length} registrados
        </span>
      </div>
      <div className="table-wrap">
        <table className="table table--responsive">
          <caption className="sr-only">Pasar lista</caption>
          <thead>
            <tr>
              <th scope="col">Músico</th>
              <th scope="col">Instrumento</th>
              <th scope="col">Asistencia</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((m) => (
              <tr key={m.id}>
                <td data-label="Músico">{fullName(m)}</td>
                <td data-label="Instrumento">{m.instrument ?? '—'}</td>
                <td data-label="Asistencia">
                  <div className="segmented" role="radiogroup" aria-label={`Asistencia de ${fullName(m)}`}>
                    {STATUSES.map((s) => (
                      <button
                        key={s}
                        role="radio"
                        aria-checked={values[m.id] === s}
                        onClick={() => setValues((v) => ({ ...v, [m.id]: s }))}
                      >
                        {attendanceStatus[s].label}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <FormError error={save.error} />
      <div>
        <Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={Object.keys(values).length === 0}>
          Guardar asistencia
        </Button>
      </div>
    </div>
  );
}

export default function EventDetailPage() {
  const { id } = useParams();
  const { can, session, hasFeature } = useAuth();
  const q = useApi<EventDetail>(`/events/${id}`);
  const [editing, setEditing] = useState(false);
  const [repertoire, setRepertoire] = useState(false);
  const [calling, setCalling] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [justifyId, setJustifyId] = useState<string | null>(null);

  const cancel = useApiMutation(() => post(`/events/${id}/cancel`), {
    success: 'Evento cancelado. Se ha avisado a los convocados.',
    invalidate: [`/events`, '/agenda', '/dashboard'],
    onSuccess: () => setCancelling(false),
  });
  const respond = useApiMutation((body: { response: 'ACCEPTED' | 'DECLINED'; note?: string }) => post(`/events/${id}/respond`, body), {
    success: 'Respuesta enviada',
    invalidate: [`/events/${id}`],
  });
  const justify = useApiMutation((body: { id: string; text: string }) => post(`/attendance/${body.id}/justification`, { text: body.text }), {
    success: 'Justificación enviada',
    invalidate: [`/events/${id}`],
    onSuccess: () => setJustifyId(null),
  });
  const review = useApiMutation((body: { id: string; approved: boolean }) => post(`/attendance/${body.id}/review`, { approved: body.approved }), {
    success: 'Justificación revisada',
    invalidate: [`/events/${id}`, '/attendance'],
  });

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <div className="container page__body"><ErrorNote error={q.error} /></div>;
  const e = q.data;
  const myCall = session?.memberId ? e.calls.find((c) => c.member.id === session.memberId) : undefined;
  const myAttendance = session?.memberId ? e.attendance.find((a) => a.memberId === session.memberId) : undefined;
  const pendingJust = e.attendance.filter((a) => a.justificationStatus === 'PENDING');
  const counts = {
    accepted: e.calls.filter((c) => c.response === 'ACCEPTED').length,
    declined: e.calls.filter((c) => c.response === 'DECLINED').length,
    pending: e.calls.filter((c) => c.response === 'PENDING').length,
  };
  const memberName = (mid: string) => {
    const a = e.attendance.find((x) => x.memberId === mid);
    if (a?.member) return fullName(a.member);
    const c = e.calls.find((x) => x.member.id === mid);
    return c ? fullName(c.member) : '—';
  };
  const active = e.status === 'SCHEDULED';

  const general = (
    <>
      <div className="grid grid--2">
        <Card title="Repertorio" actions={can('events:write') && <Button size="sm" variant="ghost" onClick={() => setRepertoire(true)}>Editar</Button>}>
          {e.repertoire.length === 0 ? (
            <p className="muted">Sin obras asignadas.</p>
          ) : (
            <ol className="list-divided" style={{ paddingLeft: 20, margin: 0 }}>
              {[...e.repertoire]
                .sort((a, b) => a.position - b.position)
                .map((r) => (
                  <li key={r.work.id}>
                    <ArrowLink to={`/archive/${r.work.id}`}>{r.work.title}</ArrowLink>
                    <span className="small muted">
                      {' '}
                      · {r.work.composer?.name ?? '—'} {r.work.durationSec ? `· ${duration(r.work.durationSec)}` : ''}
                    </span>
                  </li>
                ))}
            </ol>
          )}
        </Card>
        <Card
          title="Convocatoria"
          tone="cream"
          actions={can('calls:manage') && active && <Button size="sm" variant="ghost" onClick={() => setCalling(true)}>Convocar</Button>}
        >
          <div className="chips" style={{ marginBottom: 12 }}>
            <span className="chip chip--success">{counts.accepted} confirmados</span>
            <span className="chip chip--danger">{counts.declined} no asisten</span>
            <span className="chip chip--warning">{counts.pending} pendientes</span>
          </div>
          {e.calls.length === 0 ? (
            <p className="muted">Nadie convocado todavía.</p>
          ) : (
            <ul className="list-plain list-divided" style={{ maxHeight: 320, overflowY: 'auto' }}>
              {e.calls.map((c) => (
                <li key={c.member.id} className="row between">
                  <span>
                    {fullName(c.member)} <span className="small muted">{c.member.instrument ?? ''}</span>
                  </span>
                  <StatusChip value={c.response} map={callResponse} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {can('attendance:write') && (
        <Card title="Pasar lista">
          <AttendanceGrid event={e} />
        </Card>
      )}

      {can('attendance:write') && pendingJust.length > 0 && (
        <Card title="Justificaciones pendientes" tone="cream">
          <DataTable
            caption="Justificaciones pendientes"
            rows={pendingJust}
            rowKey={(a) => a.id}
            columns={[
              { key: 'm', header: 'Músico', render: (a) => <Person name={memberName(a.memberId)} /> },
              { key: 's', header: 'Registro', render: (a) => <StatusChip value={a.status} map={attendanceStatus} /> },
              { key: 'j', header: 'Motivo', render: (a) => a.justification ?? '—' },
              {
                key: 'a',
                header: 'Revisión',
                // La revisión es la decisión principal de esta tabla: dos botones visibles, no un menú.
                render: (a) => (
                  <div className="row nowrap">
                    <Button size="sm" onClick={() => review.mutate({ id: a.id, approved: true })} aria-label={`Aprobar justificación de ${memberName(a.memberId)}`}>
                      Aprobar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => review.mutate({ id: a.id, approved: false })} aria-label={`Rechazar justificación de ${memberName(a.memberId)}`}>
                      Rechazar
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        </Card>
      )}
    </>
  );

  function submitJustification(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const v = formValues(ev.currentTarget);
    if (justifyId && v.text) justify.mutate({ id: justifyId, text: v.text });
  }

  return (
    <Page
      header={
        <PageHeader
          tone={e.type === 'PERFORMANCE' ? 'warm' : 'cool'}
          eyebrow={eventType[e.type]}
          title={e.title}
          description={`${date(e.startsAt, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${time(e.startsAt)}–${time(e.endsAt)}${e.location ? ` · ${e.location}` : ''}`}
          actions={
            can('events:write') &&
            active && (
              <>
                <Button onClick={() => setEditing(true)}>Editar</Button>
                <Button variant="ghost" onClick={() => setCancelling(true)}>
                  Cancelar evento
                </Button>
              </>
            )
          }
        />
      }
    >
      <ArrowLink to="/events">Volver a eventos</ArrowLink>
      <div className="row">
        <StatusChip value={e.status} map={eventStatus} />
      </div>
      {e.description && (
        <Card tone="cream">
          <p style={{ whiteSpace: 'pre-wrap' }}>{e.description}</p>
        </Card>
      )}

      {myCall && active && (
        <Card title="Tu convocatoria" tone="cool">
          <p>
            Estado: <StatusChip value={myCall.response} map={callResponse} />
          </p>
          <div className="card__footer">
            <Button onClick={() => respond.mutate({ response: 'ACCEPTED' })} disabled={respond.isPending || myCall.response === 'ACCEPTED'}>
              Asistiré
            </Button>
            <Button variant="ghost" onClick={() => respond.mutate({ response: 'DECLINED' })} disabled={respond.isPending || myCall.response === 'DECLINED'}>
              No podré asistir
            </Button>
          </div>
        </Card>
      )}

      {myAttendance && ['ABSENT', 'LATE'].includes(myAttendance.status) && myAttendance.justificationStatus !== 'APPROVED' && (
        <Card title="Tu asistencia" tone="cream">
          <p>
            <StatusChip value={myAttendance.status} map={attendanceStatus} /> <StatusChip value={myAttendance.justificationStatus} map={justificationStatus} />
          </p>
          {myAttendance.justificationStatus !== 'PENDING' && can('attendance:self') && (
            <div className="card__footer">
              <Button variant="ghost" onClick={() => setJustifyId(myAttendance.id)}>
                Justificar falta
              </Button>
            </div>
          )}
        </Card>
      )}

      {hasFeature('performances') ? (
        <Tabs
          label="Secciones del evento"
          tabs={[
            { id: 'general', label: 'Convocatoria', content: <div className="stack" style={{ gap: 24 }}>{general}</div> },
            { id: 'staffing', label: 'Plantilla', content: <StaffingPanel eventId={e.id} active={active} /> },
            { id: 'logistics', label: 'Logística', content: <LogisticsPanel eventId={e.id} /> },
          ]}
        />
      ) : (
        general
      )}

      <EventFormModal open={editing} event={e} onClose={() => setEditing(false)} />
      <RepertoireModal event={e} open={repertoire} onClose={() => setRepertoire(false)} />
      <CallModal event={e} open={calling} onClose={() => setCalling(false)} />
      <ConfirmModal
        open={cancelling}
        title="Cancelar evento"
        message="Se notificará la cancelación a todos los convocados."
        confirmLabel="Cancelar evento"
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate(undefined)}
        onClose={() => setCancelling(false)}
      />
      <Modal open={!!justifyId} onClose={() => setJustifyId(null)} title="Justificar falta">
        <form className="form" onSubmit={submitJustification}>
          <TextAreaField label="Motivo" name="text" required />
          <FormError error={justify.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setJustifyId(null)}>
              Cancelar
            </Button>
            <Button type="submit" loading={justify.isPending}>
              Enviar
            </Button>
          </div>
        </form>
      </Modal>
    </Page>
  );
}
