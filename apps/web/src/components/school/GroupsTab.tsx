import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, del, patch, post } from '../../api/client';
import { useApi, useApiMutation } from '../../api/hooks';
import type { ClassGroup, ClassSlot, GroupDetail, Room, ScheduleConflict, Subject, Teacher } from '../../api/types-school';
import { useAuth } from '../../auth/AuthProvider';
import { fullName, money } from '../../lib/format';
import { conflictReason, enrollmentStatus, hhmm, toMinutes, WEEKDAYS, weekdayName } from '../../lib/labels-school';
import { Button } from '../Button';
import { Card } from '../Card';
import { StatusChip } from '../Chip';
import { DataTable } from '../DataTable';
import { EmptyState, ErrorNote, Loading } from '../EmptyState';
import { FormError, SelectField, TextField, formValues } from '../Field';
import { Menu } from '../Menu';
import { ConfirmModal, Modal } from '../Modal';
import { centsOrNull, euros, groupLabel, slotText, StudentSelect, useSchoolYears, YearSelect } from './common';

function GroupModal({ open, onClose, group, yearId }: { open: boolean; onClose: () => void; group?: ClassGroup | null; yearId: string }) {
  const subjects = useApi<Subject[]>(open ? '/school/subjects' : null);
  const teachers = useApi<Teacher[]>(open ? '/school/teachers' : null);
  const save = useApiMutation((body: unknown) => (group ? patch(`/school/groups/${group.id}`, body) : post('/school/groups', body)), {
    success: group ? 'Grupo actualizado' : 'Grupo creado',
    invalidate: ['/school'],
    onSuccess: onClose,
  });
  const ready = !!subjects.data && !!teachers.data;
  return (
    <Modal open={open} onClose={onClose} title={group ? `Editar ${group.name}` : 'Nuevo grupo'}>
      {!ready ? (
        <Loading rows={3} />
      ) : (
        <form
          className="form"
          key={group?.id ?? 'new'}
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            save.mutate({
              ...(group ? {} : { yearId }), subjectId: v.subjectId, name: v.name, level: v.level ?? null, teacherId: v.teacherId ?? null,
              capacity: v.capacity ? Number(v.capacity) : null, monthlyFeeCents: centsOrNull(v.fee),
            });
          }}
        >
          <div className="form-row">
            <SelectField label="Asignatura" name="subjectId" required defaultValue={group?.subjectId} placeholder="Elige asignatura" options={(subjects.data ?? []).filter((s) => s.active || s.id === group?.subjectId).map((s) => ({ value: s.id, label: s.name }))} />
            <TextField label="Nombre del grupo" name="name" required defaultValue={group?.name} placeholder="Grupo A" />
            <TextField label="Nivel" name="level" defaultValue={group?.level ?? ''} placeholder="1.º elemental" />
          </div>
          <div className="form-row">
            <SelectField label="Profesor" name="teacherId" defaultValue={group?.teacherId ?? ''} placeholder="Sin asignar" options={(teachers.data ?? []).filter((t) => t.active || t.id === group?.teacherId).map((t) => ({ value: t.id, label: fullName(t) }))} />
            <TextField label="Plazas" name="capacity" type="number" min={1} max={500} defaultValue={group?.capacity ?? ''} hint="Vacío: sin límite. Al llenarse, lista de espera." />
            <TextField label="Mensualidad propia (€)" name="fee" inputMode="decimal" defaultValue={euros(group?.monthlyFeeCents)} hint="Vacío: la de la asignatura." />
          </div>
          <FormError error={save.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={save.isPending}>
              Guardar
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function ConflictList({ conflicts }: { conflicts: ScheduleConflict[] }) {
  return (
    <ul className="list-plain list-divided">
      {conflicts.map((c, i) => (
        <li key={i}>
          <strong>{weekdayName(c.a.weekday)}</strong> · {c.a.groupName} ({hhmm(c.a.startMin)}–{hhmm(c.a.endMin)}) y {c.b.groupName} ({hhmm(c.b.startMin)}–{hhmm(c.b.endMin)}):{' '}
          {c.reasons.map((r) => conflictReason[r]).join(', ')}
          {c.studentIds.length > 0 && ` (${c.studentIds.length})`}
        </li>
      ))}
    </ul>
  );
}

function SlotsModal({ group, onClose }: { group: ClassGroup | null; onClose: () => void }) {
  const rooms = useApi<Room[]>(group ? '/school/rooms' : null);
  const [conflicts, setConflicts] = useState<ScheduleConflict[] | null>(null);
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const add = useApiMutation((body: Record<string, unknown>) => post<ClassSlot>(`/school/groups/${group!.id}/slots`, body), {
    success: 'Franja añadida',
    invalidate: ['/school'],
    onSuccess: () => {
      setConflicts(null);
      setPending(null);
    },
  });
  const remove = useApiMutation((id: string) => del(`/school/slots/${id}`), { success: 'Franja eliminada', invalidate: ['/school'] });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    const body = { weekday: Number(v.weekday), startMin: toMinutes(v.start ?? '0:00'), endMin: toMinutes(v.end ?? '0:00'), roomId: v.roomId ?? null };
    setPending(body);
    add.mutate(body, {
      onError: (err) => {
        if (err instanceof ApiError && err.code === 'SCHEDULE_CONFLICT') setConflicts(err.details as ScheduleConflict[]);
      },
    });
  }

  return (
    <Modal open={!!group} onClose={onClose} title={`Horario de ${group ? groupLabel(group) : ''}`}>
      <div className="stack" style={{ gap: 16 }}>
        {group?.slots.length ? (
          <ul className="list-plain list-divided">
            {group.slots.map((s) => (
              <li key={s.id} className="row between">
                <span>{slotText(s)}</span>
                <Button size="sm" variant="ghost" onClick={() => remove.mutate(s.id)} aria-label={`Eliminar franja ${slotText(s)}`}>
                  Eliminar
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Sin franjas semanales.</p>
        )}
        <form className="form" onSubmit={submit}>
          <div className="form-row">
            <SelectField label="Día" name="weekday" defaultValue="1" options={WEEKDAYS.map((d, i) => ({ value: String(i + 1), label: d }))} />
            <TextField label="Inicio" name="start" type="time" required defaultValue="17:00" />
            <TextField label="Fin" name="end" type="time" required defaultValue="18:00" />
            <SelectField label="Aula" name="roomId" placeholder="Sin aula" options={(rooms.data ?? []).map((r) => ({ value: r.id, label: r.name }))} />
          </div>
          {conflicts && (
            <div className="callout callout--danger" role="alert">
              <div>
                <p>
                  <strong>La franja se solapa con otras clases.</strong>
                </p>
                <ConflictList conflicts={conflicts} />
                <Button size="sm" variant="danger" onClick={() => pending && add.mutate({ ...pending, force: true })}>
                  Guardar igualmente
                </Button>
              </div>
            </div>
          )}
          {!conflicts && <FormError error={add.error} />}
          <div className="modal__footer">
            <Button variant="ghost" onClick={onClose}>
              Cerrar
            </Button>
            <Button type="submit" loading={add.isPending}>
              Añadir franja
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}

function RosterModal({ groupId, onClose }: { groupId: string | null; onClose: () => void }) {
  const { can } = useAuth();
  const q = useApi<GroupDetail>(groupId ? `/school/groups/${groupId}` : null);
  const enroll = useApiMutation((studentId: string) => post<{ status: string }>('/school/enrollments', { studentId, groupId }), {
    invalidate: ['/school'],
    success: 'Matrícula registrada',
  });
  const withdraw = useApiMutation((id: string) => post(`/school/enrollments/${id}/withdraw`), { success: 'Baja registrada', invalidate: ['/school'] });
  const g = q.data;
  return (
    <Modal open={!!groupId} onClose={onClose} title={g ? `Alumnos de ${groupLabel(g)}` : 'Alumnos'}>
      {q.isLoading && <Loading rows={3} />}
      {g && (
        <div className="stack" style={{ gap: 16 }}>
          <p className="small muted">
            {g.enrollments.filter((e) => e.status === 'ACTIVE').length} matriculados{g.capacity ? ` de ${g.capacity} plazas` : ''}. Al dar de baja a un alumno entra el primero de la lista de espera.
          </p>
          <DataTable
            caption="Matrículas del grupo"
            rows={g.enrollments}
            rowKey={(e) => e.id}
            columns={[
              { key: 'n', header: 'Alumno', render: (e) => <Link to={`/school/students/${e.student.id}`}>{e.student.lastName}, {e.student.firstName}</Link> },
              { key: 's', header: 'Estado', render: (e) => <StatusChip value={e.status} map={enrollmentStatus} /> },
              ...(can('school:write')
                ? [{ key: 'a', header: 'Acciones', render: (e: GroupDetail['enrollments'][number]) => <Button size="sm" variant="ghost" onClick={() => withdraw.mutate(e.id)} aria-label={`Dar de baja a ${e.student.firstName} del grupo`}>Dar de baja</Button> }]
                : []),
            ]}
          />
          {can('school:write') && (
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                const v = formValues(e.currentTarget);
                if (v.studentId) enroll.mutate(v.studentId);
              }}
            >
              <div className="form-row">
                <StudentSelect />
              </div>
              <FormError error={enroll.error} />
              <div className="modal__footer">
                <Button variant="ghost" onClick={onClose}>
                  Cerrar
                </Button>
                <Button type="submit" loading={enroll.isPending}>
                  Matricular
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Cuadrícula semanal filtrada por aula o por profesor. */
function Timetable({ groups }: { groups: ClassGroup[] }) {
  const [by, setBy] = useState<'room' | 'teacher'>('room');
  const [filter, setFilter] = useState('');
  const entries = groups.flatMap((g) => g.slots.map((s) => ({ g, s })));
  const options =
    by === 'room'
      ? [...new Map(entries.filter((e) => e.s.room).map((e) => [e.s.room!.id, e.s.room!.name])).entries()]
      : [...new Map(groups.filter((g) => g.teacher).map((g) => [g.teacher!.id, fullName(g.teacher)])).entries()];
  const visible = entries.filter((e) => !filter || (by === 'room' ? e.s.roomId === filter : e.g.teacherId === filter));
  const days = [1, 2, 3, 4, 5, 6, 7].filter((d) => d <= 5 || visible.some((e) => e.s.weekday === d));
  return (
    <Card title="Horario semanal">
      <div className="toolbar">
        <SelectField label="Ver por" value={by} onChange={(e) => { setBy(e.target.value as 'room' | 'teacher'); setFilter(''); }} options={[{ value: 'room', label: 'Aula' }, { value: 'teacher', label: 'Profesor' }]} />
        <SelectField label={by === 'room' ? 'Aula' : 'Profesor'} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Todos" options={options.map(([value, label]) => ({ value, label }))} />
      </div>
      <div className="table-wrap">
        <table className="table matrix">
          <caption className="sr-only">Horario semanal de clases</caption>
          <thead>
            <tr>
              {days.map((d) => (
                <th key={d} scope="col">
                  {weekdayName(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {days.map((d) => (
                <td key={d} style={{ verticalAlign: 'top', textAlign: 'left' }}>
                  <ul className="list-plain stack" style={{ gap: 8 }}>
                    {visible
                      .filter((e) => e.s.weekday === d)
                      .sort((a, b) => a.s.startMin - b.s.startMin)
                      .map(({ g, s }) => (
                        <li key={s.id} className="card card--cool" style={{ padding: 8 }}>
                          <strong className="mono small">
                            {hhmm(s.startMin)}–{hhmm(s.endMin)}
                          </strong>
                          <br />
                          {g.subject.name} · {g.name}
                          <br />
                          <span className="small muted">
                            {s.room?.name ?? 'Sin aula'}
                            {g.teacher ? ` · ${fullName(g.teacher)}` : ''}
                          </span>
                        </li>
                      ))}
                  </ul>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function GroupsTab() {
  const { can } = useAuth();
  const write = can('school:write');
  const { years, yearId, setYearId, isLoading } = useSchoolYears();
  const groups = useApi<ClassGroup[]>(yearId ? '/school/groups' : null, { yearId });
  const conflicts = useApi<ScheduleConflict[]>(yearId ? `/school/years/${yearId}/conflicts` : null);
  const [editing, setEditing] = useState<ClassGroup | null>(null);
  const [creating, setCreating] = useState(false);
  const [slotsFor, setSlotsFor] = useState<string | null>(null);
  const [rosterFor, setRosterFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ClassGroup | null>(null);
  const remove = useApiMutation((id: string) => del(`/school/groups/${id}`), { success: 'Grupo eliminado', invalidate: ['/school'], onSuccess: () => setDeleting(null) });
  const slotsGroup = groups.data?.find((g) => g.id === slotsFor) ?? null;

  if (isLoading) return <Loading />;
  if (!years.length) return <EmptyState title="Sin cursos" icon="calendar">Crea el primer curso escolar en Configuración.</EmptyState>;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <Card>
        <div className="toolbar">
          <YearSelect years={years} value={yearId} onChange={setYearId} />
          {write && <Button onClick={() => setCreating(true)}>Nuevo grupo</Button>}
        </div>
      </Card>
      {conflicts.data && conflicts.data.length > 0 && (
        <div className="callout callout--danger" role="status">
          <div>
            <p>
              <strong>{conflicts.data.length} conflicto(s) de horario</strong>
            </p>
            <ConflictList conflicts={conflicts.data} />
          </div>
        </div>
      )}
      {groups.isLoading && <Loading />}
      {groups.error && <ErrorNote error={groups.error} />}
      {groups.data && (
        <Card>
          <DataTable
            caption="Grupos del curso"
            rows={groups.data}
            rowKey={(g) => g.id}
            empty="Crea grupos o copia los del curso anterior desde Configuración."
            columns={[
              { key: 'g', header: 'Grupo', render: (g) => <strong>{groupLabel(g)}</strong> },
              { key: 't', header: 'Profesor', render: (g) => (g.teacher ? fullName(g.teacher) : '—') },
              { key: 'h', header: 'Horario', render: (g) => (g.slots.length ? g.slots.map((s) => <div key={s.id} className="small">{slotText(s)}</div>) : '—') },
              { key: 'p', header: 'Plazas', numeric: true, nowrap: true, render: (g) => `${g.activeCount ?? 0}${g.capacity ? ` / ${g.capacity}` : ''}${g.waitlistCount ? ` (+${g.waitlistCount} en espera)` : ''}` },
              { key: 'f', header: 'Mensualidad', numeric: true, nowrap: true, render: (g) => money(g.monthlyFeeCents ?? g.subject.monthlyFeeCents) },
              {
                key: 'a',
                header: 'Acciones',
                render: (g) => (
                  <Menu
                    label={`Acciones de ${g.name}`}
                    items={[
                      { label: 'Alumnos y matrículas', onSelect: () => setRosterFor(g.id) },
                      ...(write
                        ? [
                            { label: 'Horario', onSelect: () => setSlotsFor(g.id) },
                            { label: 'Editar', onSelect: () => setEditing(g) },
                            { label: 'Eliminar', onSelect: () => setDeleting(g), danger: true },
                          ]
                        : []),
                    ]}
                  />
                ),
              },
            ]}
          />
        </Card>
      )}
      {groups.data && groups.data.some((g) => g.slots.length) && <Timetable groups={groups.data} />}
      <GroupModal open={creating || !!editing} group={editing} yearId={yearId} onClose={() => { setCreating(false); setEditing(null); }} />
      <SlotsModal group={slotsGroup} onClose={() => setSlotsFor(null)} />
      <RosterModal groupId={rosterFor} onClose={() => setRosterFor(null)} />
      <ConfirmModal
        open={!!deleting}
        title="Eliminar grupo"
        message={`Se eliminará ${deleting?.name ?? ''} con su horario y sesiones. Sólo es posible si no tiene alumnos.`}
        confirmLabel="Eliminar"
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
