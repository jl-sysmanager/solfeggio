import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { patch, post } from '../../api/client';
import { useApi, useApiMutation } from '../../api/hooks';
import type { Paginated } from '../../api/types';
import type { ClassGroup, Family, SchoolSettings, Student, TuitionTariff } from '../../api/types-school';
import { useAuth } from '../../auth/AuthProvider';
import { date, fullName, money } from '../../lib/format';
import { studentStatus } from '../../lib/labels-school';
import { Person } from '../Avatar';
import { Button } from '../Button';
import { Card } from '../Card';
import { StatusChip, Tag } from '../Chip';
import { DataTable, Pagination } from '../DataTable';
import { ErrorNote, Loading } from '../EmptyState';
import { Checkbox, FormError, SelectField, TextAreaField, TextField, formValues } from '../Field';
import { InstrumentField } from '../InstrumentField';
import { Menu } from '../Menu';
import { Modal } from '../Modal';
import { useToast } from '../Toasts';
import { groupLabel, useSchoolYears } from './common';
import { ImportModal } from './ImportModal';

const NEW_FAMILY = '__new__';

type StudentLike = Pick<Student, 'id' | 'familyId' | 'firstName' | 'lastName' | 'birthDate' | 'email' | 'phone' | 'instrument' | 'imageConsent' | 'pickupAuthorized' | 'status' | 'notes' | 'tuitionTariffId'>;

/** Alta y edición de alumno. Permite crear la familia en el mismo paso. */
export function StudentFormModal({ open, onClose, student }: { open: boolean; onClose: () => void; student?: StudentLike | null }) {
  const families = useApi<Family[]>(open ? '/school/families' : null);
  const settings = useApi<SchoolSettings>(open ? '/school/settings' : null);
  const tariffs = useApi<TuitionTariff[]>(open && settings.data?.feeMode === 'FIXED' ? '/school/tariffs' : null);
  const { yearId, year } = useSchoolYears();
  const groups = useApi<ClassGroup[]>(open && !student && yearId ? '/school/groups' : null, { yearId });
  const [familyChoice, setFamilyChoice] = useState<string>('');
  const toast = useToast();
  const close = () => {
    setFamilyChoice('');
    onClose();
  };
  const save = useApiMutation(
    async (v: { body: Record<string, unknown>; newFamily?: string }) => {
      let familyId = v.body.familyId;
      if (v.newFamily) familyId = (await post<Family>('/school/families', { name: v.newFamily })).id;
      const body = { ...v.body, familyId };
      return student ? patch(`/school/students/${student.id}`, body) : post<{ enrollments?: { status: string }[] }>('/school/students', body);
    },
    {
      success: student ? 'Alumno actualizado' : 'Alumno dado de alta',
      invalidate: ['/school'],
      onSuccess: (r) => {
        const waiting = (r as { enrollments?: { status: string }[] } | undefined)?.enrollments?.filter((e) => e.status === 'WAITLIST').length;
        if (waiting) toast.notify(`${waiting} grupo(s) estaban llenos: queda en lista de espera`);
        close();
      },
    },
  );

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const v = formValues(form);
    const consent = (form.elements.namedItem('imageConsent') as HTMLInputElement).checked;
    save.mutate({
      newFamily: v.familyId === NEW_FAMILY ? v.newFamily : undefined,
      body: {
        firstName: v.firstName, lastName: v.lastName, birthDate: v.birthDate ?? null, email: v.email ?? null, phone: v.phone ?? null,
        instrument: v.instrument ?? null, familyId: v.familyId && v.familyId !== NEW_FAMILY ? v.familyId : null, imageConsent: consent,
        pickupAuthorized: (v.pickup ?? '').split('\n').map((s) => s.trim()).filter(Boolean),
        notes: v.notes ?? null, ...(student && v.status ? { status: v.status } : {}),
        ...(settings.data?.feeMode === 'FIXED' ? { tuitionTariffId: v.tariff || null } : {}),
        ...(!student ? { groupIds: Array.from(form.querySelectorAll<HTMLInputElement>('input[name="groupIds"]:checked')).map((i) => i.value) } : {}),
      },
    });
  }

  const choice = familyChoice || student?.familyId || '';
  return (
    <Modal open={open} onClose={close} title={student ? `Editar ${fullName(student)}` : 'Nuevo alumno'}>
      <form className="form" onSubmit={submit} key={student?.id ?? 'new'}>
        <div className="form-row">
          <TextField label="Nombre" name="firstName" required defaultValue={student?.firstName} />
          <TextField label="Apellidos" name="lastName" required defaultValue={student?.lastName} />
          <TextField label="Fecha de nacimiento" name="birthDate" type="date" defaultValue={student?.birthDate?.slice(0, 10)} />
        </div>
        <div className="form-row">
          <SelectField
            label="Familia"
            name="familyId"
            value={choice}
            onChange={(e) => setFamilyChoice(e.target.value)}
            placeholder="Sin familia"
            hint="Los hermanos comparten familia (descuento y portal)."
            options={[...(families.data ?? []).map((f) => ({ value: f.id, label: f.name })), { value: NEW_FAMILY, label: '+ Nueva familia…' }]}
          />
          {choice === NEW_FAMILY && <TextField label="Nombre de la familia" name="newFamily" required placeholder="Familia García López" />}
        </div>
        <div className="form-row">
          <InstrumentField name="instrument" defaultValue={student?.instrument ?? ''} />
          <TextField label="Email" name="email" type="email" defaultValue={student?.email ?? ''} />
          <TextField label="Teléfono" name="phone" type="tel" defaultValue={student?.phone ?? ''} />
        </div>
        {settings.data?.feeMode === 'FIXED' && (
          <SelectField
            label="Tarifa mensual"
            name="tariff"
            placeholder="Sin tarifa (suma de asignaturas)"
            defaultValue={student?.tuitionTariffId ?? ''}
            hint="Sustituye al precio de las asignaturas y a los descuentos."
            options={(tariffs.data ?? []).filter((t) => t.active || t.id === student?.tuitionTariffId).map((t) => ({ value: t.id, label: `${t.name} · ${money(t.monthlyCents)}/mes` }))}
          />
        )}
        {!student && (groups.data?.length ?? 0) > 0 && (
          <fieldset className="stack" style={{ gap: 8, border: 0, padding: 0 }}>
            <legend className="label-caps">Matricular ya en {year ? `el curso ${year.name}` : 'el curso'} (opcional)</legend>
            <div className="grid" style={{ gap: 4 }}>
              {groups.data!.map((g) => {
                const full = g.capacity !== null && (g.activeCount ?? 0) >= g.capacity;
                return (
                  <Checkbox
                    key={g.id}
                    name="groupIds"
                    value={g.id}
                    label={`${groupLabel(g)} — ${g.capacity ? `${Math.max(0, g.capacity - (g.activeCount ?? 0))} libres` : 'sin límite'}${full ? ' (lista de espera)' : ''}`}
                  />
                );
              })}
            </div>
          </fieldset>
        )}
        <Checkbox label="Autoriza el uso de su imagen" name="imageConsent" defaultChecked={student?.imageConsent ?? false} />
        <TextAreaField label="Personas autorizadas para recogerle" name="pickup" rows={3} hint="Una por línea (nombre y DNI parcial)." defaultValue={(student?.pickupAuthorized ?? []).join('\n')} />
        {student && (
          <SelectField label="Estado" name="status" defaultValue={student.status} options={Object.entries(studentStatus).map(([value, { label }]) => ({ value, label }))} hint="La baja libera sus plazas en los grupos." />
        )}
        <TextAreaField label="Observaciones" name="notes" defaultValue={student?.notes ?? ''} />
        <FormError error={save.error} />
        <div className="modal__footer">
          <Button variant="ghost" onClick={close}>
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

type Bulk = 'enroll' | 'tariff' | 'status';

/** Acción sobre los alumnos seleccionados: matricular en un grupo, asignar tarifa o cambiar el estado. */
function BulkModal({ kind, ids, onClose }: { kind: Bulk | null; ids: string[]; onClose: (done?: boolean) => void }) {
  const toast = useToast();
  const { yearId } = useSchoolYears();
  const groups = useApi<ClassGroup[]>(kind === 'enroll' && yearId ? '/school/groups' : null, { yearId });
  const tariffs = useApi<TuitionTariff[]>(kind === 'tariff' ? '/school/tariffs' : null);
  const run = useApiMutation((action: unknown) => post<{ updated: number; waitlisted: number; skipped: number }>('/school/students/bulk', { studentIds: ids, action }), {
    invalidate: ['/school'],
    onSuccess: (r) => {
      toast.notify(`${r.updated} alumnos actualizados${r.waitlisted ? `, ${r.waitlisted} en lista de espera` : ''}${r.skipped ? `, ${r.skipped} sin cambios` : ''}`);
      onClose(true);
    },
  });
  const title = { enroll: 'Matricular en un grupo', tariff: 'Asignar tarifa', status: 'Cambiar estado' }[kind ?? 'enroll'];
  return (
    <Modal open={!!kind} onClose={() => onClose()} title={`${title} (${ids.length} alumnos)`}>
      <form
        className="form"
        key={kind}
        onSubmit={(e) => {
          e.preventDefault();
          const v = formValues(e.currentTarget);
          if (kind === 'enroll') run.mutate({ type: 'enroll', groupId: v.groupId });
          else if (kind === 'tariff') run.mutate({ type: 'tariff', tariffId: v.tariffId || null });
          else run.mutate({ type: 'status', status: v.status });
        }}
      >
        {kind === 'enroll' && (
          <SelectField
            label="Grupo del curso"
            name="groupId"
            required
            placeholder="Elige un grupo"
            hint="Si se llena, el resto queda en lista de espera. Quien ya está en el grupo no cambia."
            options={(groups.data ?? []).map((g) => ({ value: g.id, label: `${groupLabel(g)} · ${g.activeCount ?? 0}${g.capacity ? `/${g.capacity}` : ''}` }))}
          />
        )}
        {kind === 'tariff' && (
          <SelectField
            label="Tarifa mensual"
            name="tariffId"
            placeholder="Sin tarifa (suma de asignaturas)"
            options={(tariffs.data ?? []).filter((t) => t.active).map((t) => ({ value: t.id, label: `${t.name} · ${money(t.monthlyCents)}/mes` }))}
          />
        )}
        {kind === 'status' && (
          <SelectField label="Estado" name="status" defaultValue="INACTIVE" options={Object.entries(studentStatus).map(([value, { label }]) => ({ value, label }))} hint="La baja libera sus plazas en los grupos." />
        )}
        <FormError error={run.error} />
        <div className="modal__footer">
          <Button variant="ghost" onClick={() => onClose()}>
            Cancelar
          </Button>
          <Button type="submit" loading={run.isPending}>
            Aplicar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function StudentsTab() {
  const { can } = useAuth();
  const write = can('school:write');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [page, setPage] = useState(1);
  const list = useApi<Paginated<Student>>('/school/students', { q, status, page, pageSize: 25 });
  const settings = useApi<SchoolSettings>(write ? '/school/settings' : null);
  const [editing, setEditing] = useState<Student | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<Bulk | null>(null);
  const rows = list.data?.data ?? [];
  const allOnPage = rows.length > 0 && rows.every((s) => selected.has(s.id));
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <div className="stack" style={{ gap: 24 }}>
      <Card>
        <div className="toolbar">
          <TextField label="Buscar" type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Nombre, email o instrumento" />
          <SelectField
            label="Estado"
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); setSelected(new Set()); }}
            placeholder="Todos"
            options={Object.entries(studentStatus).map(([value, { label }]) => ({ value, label }))}
          />
          {write && <Button onClick={() => setCreating(true)}>Nuevo alumno</Button>}
          {write && (
            <Button variant="ghost" onClick={() => setImporting(true)}>
              Importar
            </Button>
          )}
        </div>
      </Card>
      {write && selected.size > 0 && (
        <div className="callout" role="status">
          <div className="row between" style={{ flexWrap: 'wrap', gap: 12, width: '100%' }}>
            <span>{selected.size} alumno(s) seleccionado(s)</span>
            <span className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <Button size="sm" onClick={() => setBulk('enroll')}>
                Matricular en grupo
              </Button>
              {settings.data?.feeMode === 'FIXED' && (
                <Button size="sm" variant="ghost" onClick={() => setBulk('tariff')}>
                  Asignar tarifa
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setBulk('status')}>
                Cambiar estado
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Quitar selección
              </Button>
            </span>
          </div>
        </div>
      )}
      {list.isLoading && <Loading />}
      {list.error && <ErrorNote error={list.error} />}
      {list.data && (
        <Card
          actions={
            write &&
            rows.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setSelected((prev) => new Set(allOnPage ? [...prev].filter((id) => !rows.some((r) => r.id === id)) : [...prev, ...rows.map((r) => r.id)]))}>
                {allOnPage ? 'Quitar los de esta página' : 'Seleccionar esta página'}
              </Button>
            )
          }
        >
          <DataTable
            caption="Alumnos de la escuela"
            rows={rows}
            rowKey={(s) => s.id}
            empty={write ? 'Da de alta al primer alumno, importa tu lista o acepta solicitudes de matrícula.' : 'No hay alumnos con este filtro.'}
            columns={[
              ...(write
                ? [{
                    key: 'sel',
                    header: 'Sel.',
                    render: (s: Student) => <Checkbox label={<span className="sr-only">Seleccionar a {fullName(s)}</span>} checked={selected.has(s.id)} onChange={(e) => toggle(s.id, e.target.checked)} />,
                  }]
                : []),
              { key: 'n', header: 'Alumno', render: (s) => <Link to={`/school/students/${s.id}`}><Person name={`${s.lastName}, ${s.firstName}`} detail={s.birthDate ? `Nac. ${date(s.birthDate)}` : undefined} /></Link> },
              { key: 'f', header: 'Familia', render: (s) => s.family?.name ?? '—' },
              { key: 'i', header: 'Instrumento', render: (s) => s.instrument ?? '—' },
              {
                key: 'g',
                header: 'Grupos',
                render: (s) => (s.enrollments?.length ? <span className="chips">{s.enrollments.map((e) => <Tag key={e.id}>{e.group.subject.name}{e.status === 'WAITLIST' ? ' (espera)' : ''}</Tag>)}</span> : '—'),
              },
              { key: 's', header: 'Estado', render: (s) => <StatusChip value={s.status} map={studentStatus} /> },
              ...(write
                ? [{ key: 'a', header: 'Acciones', render: (s: Student) => <Menu label={`Acciones de ${fullName(s)}`} items={[{ label: 'Editar', onSelect: () => setEditing(s) }]} /> }]
                : []),
            ]}
          />
          <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
        </Card>
      )}
      <StudentFormModal open={creating || !!editing} student={editing} onClose={() => { setCreating(false); setEditing(null); }} />
      {importing && <ImportModal onClose={() => setImporting(false)} />}
      <BulkModal
        kind={bulk}
        ids={[...selected]}
        onClose={(done) => {
          setBulk(null);
          if (done) setSelected(new Set());
        }}
      />
    </div>
  );
}
