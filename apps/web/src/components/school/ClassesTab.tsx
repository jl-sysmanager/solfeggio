import { useEffect, useState, type FormEvent } from 'react';
import { del, post, put } from '../../api/client';
import { useApi, useApiMutation } from '../../api/hooks';
import type { ClassAttendanceStatus, ClassGroup, ClassSession, GradeRow, Justification, Notice, SessionDetail } from '../../api/types-school';
import { useAuth } from '../../auth/AuthProvider';
import { date, dateTime, today } from '../../lib/format';
import { attendanceStatus } from '../../lib/labels';
import { hhmm, sessionStatus, termName, toMinutes } from '../../lib/labels-school';
import { Button } from '../Button';
import { Card } from '../Card';
import { StatusChip } from '../Chip';
import { DataTable } from '../DataTable';
import { EmptyState, ErrorNote, Loading } from '../EmptyState';
import { FormError, SelectField, TextAreaField, TextField, formValues } from '../Field';
import { Menu } from '../Menu';
import { ConfirmModal, Modal } from '../Modal';
import { useToast } from '../Toasts';
import { groupLabel, useSchoolYears, YearSelect } from './common';

const statusOptions = Object.entries(attendanceStatus).map(([value, { label }]) => ({ value, label }));

export function AttendanceModal({ sessionId, onClose }: { sessionId: string | null; onClose: () => void }) {
  const q = useApi<SessionDetail>(sessionId ? `/school/sessions/${sessionId}` : null);
  const save = useApiMutation((body: unknown) => put(`/school/sessions/${sessionId}/attendance`, body), { success: 'Asistencia guardada', invalidate: ['/school'], onSuccess: onClose });
  const all = (status: ClassAttendanceStatus) => {
    const form = document.getElementById(`attendance-${sessionId}`) as HTMLFormElement | null;
    form?.querySelectorAll<HTMLSelectElement>('select').forEach((sel) => (sel.value = status));
  };
  const s = q.data;
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    save.mutate(s!.roster.map((st) => ({ studentId: st.id, status: fd.get(`s-${st.id}`) as ClassAttendanceStatus, note: String(fd.get(`n-${st.id}`) ?? '').trim() || null })));
  }
  return (
    <Modal open={!!sessionId} onClose={onClose} title={s ? `Pasar lista · ${date(s.date)} ${hhmm(s.startMin)}` : 'Pasar lista'}>
      {q.isLoading && <Loading rows={3} />}
      {s && (
        <form className="form" onSubmit={submit} id={`attendance-${sessionId}`}>
          {s.roster.length === 0 && <p className="muted">El grupo no tiene alumnos matriculados.</p>}
          {s.roster.length > 1 && (
            <div className="row">
              <Button size="sm" variant="ghost" onClick={() => all('PRESENT')}>
                Todos presentes
              </Button>
            </div>
          )}
          {s.roster.map((st) => {
            const current = s.attendance.find((a) => a.studentId === st.id);
            return (
              <div className="form-row" key={st.id}>
                <SelectField label={`${st.lastName}, ${st.firstName}`} name={`s-${st.id}`} defaultValue={current?.status ?? 'PRESENT'} options={statusOptions} />
                <TextField label="Nota" name={`n-${st.id}`} defaultValue={current?.note ?? ''} />
              </div>
            );
          })}
          <FormError error={save.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={save.isPending} disabled={!s.roster.length}>
              Guardar asistencia
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function MakeUpModal({ session, onClose }: { session: ClassSession | null; onClose: () => void }) {
  const save = useApiMutation((body: unknown) => post(`/school/sessions/${session!.id}/make-up`, body), { success: 'Clase de recuperación programada', invalidate: ['/school'], onSuccess: onClose });
  return (
    <Modal open={!!session} onClose={onClose} title="Clase de recuperación">
      <form
        className="form"
        key={session?.id}
        onSubmit={(e) => {
          e.preventDefault();
          const v = formValues(e.currentTarget);
          save.mutate({ date: v.date, startMin: toMinutes(v.start ?? '0:00'), endMin: toMinutes(v.end ?? '0:00'), notes: v.notes ?? null });
        }}
      >
        <p className="small muted">Recupera la clase del {date(session?.date)}.</p>
        <div className="form-row">
          <TextField label="Fecha" name="date" type="date" required defaultValue={today()} />
          <TextField label="Inicio" name="start" type="time" required defaultValue={session ? hhmm(session.startMin) : ''} />
          <TextField label="Fin" name="end" type="time" required defaultValue={session ? hhmm(session.endMin) : ''} />
        </div>
        <TextField label="Notas" name="notes" />
        <FormError error={save.error} />
        <div className="modal__footer">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            Programar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Sessions({ group }: { group: ClassGroup }) {
  const { can } = useAuth();
  const toast = useToast();
  const [past, setPast] = useState(false);
  const sessions = useApi<ClassSession[]>(`/school/groups/${group.id}/sessions`, past ? undefined : { from: today() });
  const [taking, setTaking] = useState<string | null>(null);
  const [makeUp, setMakeUp] = useState<ClassSession | null>(null);
  const [cancelling, setCancelling] = useState<ClassSession | null>(null);
  const sync = useApiMutation(() => post<{ created: number; removed: number }>(`/school/years/${group.yearId}/sessions/sync`), {
    invalidate: ['/school'],
    onSuccess: (r) => toast.notify(`${r.created} clases creadas a partir del horario`),
  });
  const cancel = useApiMutation((id: string) => post(`/school/sessions/${id}/cancel`, {}), { success: 'Clase cancelada', invalidate: [`/school/groups/${group.id}`, '/school/overview'], onSuccess: () => setCancelling(null) });

  return (
    <Card
      title="Clases"
      actions={
        <div className="segmented" role="group" aria-label="Clases visibles">
          <button aria-pressed={!past} onClick={() => setPast(false)}>
            Próximas
          </button>
          <button aria-pressed={past} onClick={() => setPast(true)}>
            Todas
          </button>
        </div>
      }
    >
      <p className="small muted">
        {group.slots.length
          ? 'Las clases se crean solas con el horario del grupo y se saltan los festivos del curso.'
          : 'El grupo no tiene horario: añádelo en «Grupos y horarios» y las clases aparecerán aquí.'}
      </p>
      {sessions.isLoading && <Loading rows={3} />}
      {sessions.data && (
        <DataTable
          caption={`Sesiones de ${group.name}`}
          rows={sessions.data}
          rowKey={(s) => s.id}
          empty={
            group.slots.length && can('school:write') ? (
              <span>
                No hay clases creadas.{' '}
                <Button size="sm" loading={sync.isPending} onClick={() => sync.mutate(undefined)}>
                  Crear las clases del curso
                </Button>
              </span>
            ) : (
              'No hay clases.'
            )
          }
          columns={[
            { key: 'd', header: 'Fecha', render: (s) => date(s.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }), nowrap: true },
            { key: 'h', header: 'Hora', render: (s) => `${hhmm(s.startMin)}–${hhmm(s.endMin)}`, nowrap: true },
            { key: 's', header: 'Estado', render: (s) => <span><StatusChip value={s.status} map={sessionStatus} />{s.makeUpForId && <span className="small muted"> recuperación</span>}</span> },
            { key: 'n', header: 'Asistencia', render: (s) => (s._count?.attendance ? `${s._count.attendance} registros` : '—') },
            {
              key: 'a',
              header: 'Acciones',
              render: (s) => (
                <Menu
                  label={`Acciones de la clase del ${date(s.date)}`}
                  items={[
                    ...(s.status !== 'CANCELLED' && can('school:teach') ? [{ label: 'Pasar lista', onSelect: () => setTaking(s.id) }, { label: 'Cancelar clase', onSelect: () => setCancelling(s), danger: true }] : []),
                    ...(s.status === 'CANCELLED' && can('school:teach') ? [{ label: 'Programar recuperación', onSelect: () => setMakeUp(s) }] : []),
                  ]}
                />
              ),
            },
          ]}
        />
      )}
      <AttendanceModal sessionId={taking} onClose={() => setTaking(null)} />
      <MakeUpModal session={makeUp} onClose={() => setMakeUp(null)} />
      <ConfirmModal
        open={!!cancelling}
        title="Cancelar clase"
        message={cancelling ? `Se cancelará la clase del ${date(cancelling.date)} a las ${hhmm(cancelling.startMin)}. Después podrás programar una recuperación.` : ''}
        confirmLabel="Cancelar clase"
        loading={cancel.isPending}
        onConfirm={() => cancelling && cancel.mutate(cancelling.id)}
        onClose={() => setCancelling(null)}
      />
    </Card>
  );
}

function Grades({ group }: { group: ClassGroup }) {
  const [term, setTerm] = useState(1);
  const q = useApi<GradeRow[]>(`/school/groups/${group.id}/grades`, { term });
  const save = useApiMutation((body: unknown) => put(`/school/groups/${group.id}/grades`, body), { success: 'Notas guardadas', invalidate: [`/school/groups/${group.id}`, '/school/students'] });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const text = (k: string) => String(fd.get(k) ?? '').trim();
    save.mutate({
      term,
      grades: (q.data ?? []).map((r) => {
        const sc = text(`sc-${r.id}`).replace(',', '.');
        return { enrollmentId: r.id, scoreTenths: sc ? Math.round(Number(sc) * 10) : null, qualitative: text(`q-${r.id}`) || null, comment: text(`c-${r.id}`) || null };
      }),
    });
  }
  return (
    <Card title="Evaluación">
      <div className="toolbar">
        <SelectField label="Evaluación" value={String(term)} onChange={(e) => setTerm(Number(e.target.value))} options={[1, 2, 3, 4].map((t) => ({ value: String(t), label: termName(t) }))} />
      </div>
      {q.isLoading && <Loading rows={3} />}
      {q.data && q.data.length === 0 && <p className="muted">Sin alumnos matriculados.</p>}
      {q.data && q.data.length > 0 && (
        <form className="form" onSubmit={submit} key={`${term}-${q.dataUpdatedAt}`}>
          {q.data.map((r) => {
            const g = r.grades[0];
            return (
              <div className="form-row" key={r.id}>
                <TextField label={`${r.student.lastName}, ${r.student.firstName} · nota (0–10)`} name={`sc-${r.id}`} inputMode="decimal" pattern="^(10([.,]0)?|[0-9]([.,][0-9])?)$" defaultValue={g?.scoreTenths != null ? String(g.scoreTenths / 10).replace('.', ',') : ''} />
                <TextField label="Calificación" name={`q-${r.id}`} defaultValue={g?.qualitative ?? ''} placeholder="Notable" />
                <TextField label="Comentario" name={`c-${r.id}`} defaultValue={g?.comment ?? ''} />
              </div>
            );
          })}
          <FormError error={save.error} />
          <div className="row">
            <Button type="submit" loading={save.isPending}>
              Guardar notas
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function Notices({ group }: { group: ClassGroup }) {
  const { session, can } = useAuth();
  const q = useApi<Notice[]>('/school/notices', { groupId: group.id });
  const [open, setOpen] = useState(false);
  const create = useApiMutation((body: unknown) => post('/school/notices', body), { success: 'Aviso publicado y enviado a las familias', invalidate: ['/school/notices'], onSuccess: () => setOpen(false) });
  const remove = useApiMutation((id: string) => del(`/school/notices/${id}`), { success: 'Aviso eliminado', invalidate: ['/school/notices'] });
  return (
    <Card title="Avisos del grupo" actions={<Button size="sm" onClick={() => setOpen(true)}>Nuevo aviso</Button>}>
      {q.data && q.data.length === 0 && <p className="muted">Sin avisos.</p>}
      <ul className="list-plain list-divided">
        {(q.data ?? []).map((n) => (
          <li key={n.id}>
            <div className="row between">
              <strong>{n.title}</strong>
              <span className="small muted">{dateTime(n.createdAt)}</span>
            </div>
            <p className="small">{n.body}</p>
            {(can('school:write') || n.authorId === session?.user.id) && (
              <Button size="sm" variant="ghost" onClick={() => remove.mutate(n.id)} aria-label={`Eliminar aviso ${n.title}`}>
                Eliminar
              </Button>
            )}
          </li>
        ))}
      </ul>
      <Modal open={open} onClose={() => setOpen(false)} title={`Aviso para ${group.name}`}>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            create.mutate({ groupId: group.id, title: v.title, body: v.body });
          }}
        >
          <TextField label="Título" name="title" required maxLength={150} />
          <TextAreaField label="Mensaje" name="body" required rows={5} />
          <FormError error={create.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={create.isPending}>
              Publicar
            </Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}

/** Faltas que las familias han justificado desde el portal: se aceptan o se rechazan aquí. */
function JustificationsCard({ yearId }: { yearId: string }) {
  const q = useApi<Justification[]>('/school/justifications', { yearId });
  const review = useApiMutation((v: { id: string; approved: boolean }) => post(`/school/attendance/${v.id}/review`, { approved: v.approved }), {
    invalidate: ['/school/justifications', '/school/overview', '/school/groups'],
    success: 'Justificación revisada',
  });
  if (!q.data?.length) return null;
  return (
    <Card title={`Justificaciones de las familias (${q.data.length})`} tone="cream">
      <ul className="list-plain list-divided">
        {q.data.map((j) => (
          <li key={j.id} className="row between" style={{ gap: 12, flexWrap: 'wrap' }}>
            <span>
              <strong>
                {j.student.firstName} {j.student.lastName}
              </strong>{' '}
              · {j.session.group.subject.name} · {j.session.group.name} · {date(j.session.date)} <StatusChip value={j.status} map={attendanceStatus} />
              <div className="small">«{j.justification}»</div>
            </span>
            <span className="row" style={{ gap: 8 }}>
              <Button size="sm" variant="ghost" loading={review.isPending && review.variables?.id === j.id && !review.variables.approved} onClick={() => review.mutate({ id: j.id, approved: false })}>
                Rechazar
              </Button>
              <Button size="sm" loading={review.isPending && review.variables?.id === j.id && review.variables.approved} onClick={() => review.mutate({ id: j.id, approved: true })}>
                Aceptar
              </Button>
            </span>
          </li>
        ))}
      </ul>
      <p className="small muted">Al aceptar, la falta pasa a «Justificada».</p>
    </Card>
  );
}

export function ClassesTab() {
  const { can } = useAuth();
  const teach = can('school:teach');
  // Quien no gestiona la escuela ve por defecto sólo sus grupos.
  const [mine, setMine] = useState(!can('school:write'));
  const { years, yearId, setYearId, isLoading } = useSchoolYears();
  const groups = useApi<ClassGroup[]>(yearId ? '/school/groups' : null, { yearId, mine: mine ? 'true' : undefined });
  const [groupId, setGroupId] = useState('');
  useEffect(() => {
    if (groups.data && !groups.data.some((g) => g.id === groupId)) setGroupId(groups.data[0]?.id ?? '');
  }, [groups.data, groupId]);
  const group = groups.data?.find((g) => g.id === groupId);

  if (isLoading) return <Loading />;
  if (!years.length) return <EmptyState title="Sin cursos" icon="calendar">Crea el primer curso escolar en Configuración.</EmptyState>;
  return (
    <div className="stack" style={{ gap: 24 }}>
      <Card>
        <div className="toolbar">
          <YearSelect years={years} value={yearId} onChange={setYearId} />
          <SelectField label="Grupo" value={groupId} onChange={(e) => setGroupId(e.target.value)} placeholder={groups.data?.length ? undefined : 'Sin grupos'} options={(groups.data ?? []).map((g) => ({ value: g.id, label: groupLabel(g) }))} />
          <div className="segmented" role="group" aria-label="Grupos visibles">
            <button aria-pressed={mine} onClick={() => setMine(true)}>
              Mis grupos
            </button>
            <button aria-pressed={!mine} onClick={() => setMine(false)}>
              Todos
            </button>
          </div>
        </div>
      </Card>
      {teach && yearId && <JustificationsCard yearId={yearId} />}
      {groups.error && <ErrorNote error={groups.error} />}
      {groups.data && !group && <EmptyState title="Sin grupos" icon="school">{mine ? 'No tienes grupos asignados en este curso.' : 'No hay grupos en este curso.'}</EmptyState>}
      {group && (
        <>
          <Sessions group={group} />
          {teach && <Grades group={group} />}
          {teach && <Notices group={group} />}
        </>
      )}
    </div>
  );
}
