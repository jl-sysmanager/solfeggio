import { useRef, useState } from 'react';
import { del, patch, post, put } from '../../api/client';
import { useApi, useApiMutation } from '../../api/hooks';
import type { Family, Room, SchoolSettings, SchoolYear, StaffUser, Subject, Teacher, TuitionPreview, TuitionTariff } from '../../api/types-school';
import { useAuth } from '../../auth/AuthProvider';
import { date, fullName, money } from '../../lib/format';
import { discountKind, subjectKind } from '../../lib/labels-school';
import { Button } from '../Button';
import { Card } from '../Card';
import { Chip } from '../Chip';
import { DataTable } from '../DataTable';
import { Loading } from '../EmptyState';
import { Checkbox, FormError, SelectField, TextAreaField, TextField, formValues } from '../Field';
import { Menu } from '../Menu';
import { ConfirmModal, Modal } from '../Modal';
import { UrlTabs } from '../Tabs';
import { useToast } from '../Toasts';
import { centsOrNull, euros, useSchoolYears } from './common';
import { HolidaysField } from './HolidaysField';
import { PublicLink } from './ApplicationsTab';
import { YearWizard } from './YearWizard';

const checked = (form: HTMLFormElement, name: string) => (form.elements.namedItem(name) as HTMLInputElement | null)?.checked ?? false;

function FormFooter({ onClose, loading }: { onClose: () => void; loading: boolean }) {
  return (
    <div className="modal__footer">
      <Button variant="ghost" onClick={onClose}>
        Cancelar
      </Button>
      <Button type="submit" loading={loading}>
        Guardar
      </Button>
    </div>
  );
}

function YearModal({ year, onClose }: { year: SchoolYear; onClose: () => void }) {
  const toast = useToast();
  const [startsOn, setStartsOn] = useState(year.startsOn.slice(0, 10));
  const [endsOn, setEndsOn] = useState(year.endsOn.slice(0, 10));
  const [holidays, setHolidays] = useState(year.holidays.map((d) => d.slice(0, 10)));
  const save = useApiMutation((body: unknown) => patch<SchoolYear & { sessions: { created: number; removed: number } | null }>(`/school/years/${year.id}`, body), {
    invalidate: ['/school'],
    onSuccess: (r) => {
      const s = r.sessions;
      toast.notify(s && (s.created || s.removed) ? `Curso guardado. Clases actualizadas: ${s.created} nuevas, ${s.removed} quitadas.` : 'Curso guardado');
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title={`Editar curso ${year.name}`} size="lg">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const v = formValues(form);
          save.mutate({ name: v.name, startsOn, endsOn, holidays, enrollmentOpen: checked(form, 'enrollmentOpen'), isCurrent: checked(form, 'isCurrent') });
        }}
      >
        <div className="form-row">
          <TextField label="Nombre" name="name" required defaultValue={year.name} placeholder="2026-27" />
          <TextField label="Inicio" type="date" required value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          <TextField label="Fin" type="date" required value={endsOn} min={startsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </div>
        <HolidaysField value={holidays} onChange={setHolidays} startsOn={startsOn} endsOn={endsOn} />
        <p className="small muted">Al cambiar fechas o festivos, las clases futuras se rehacen solas. Las que ya tienen asistencia no se tocan.</p>
        <Checkbox label="Curso actual" name="isCurrent" defaultChecked={year.isCurrent} />
        <Checkbox label="Matrícula online abierta" name="enrollmentOpen" defaultChecked={year.enrollmentOpen} />
        <FormError error={save.error} />
        <FormFooter onClose={onClose} loading={save.isPending} />
      </form>
    </Modal>
  );
}

function CopyModal({ target, years, onClose }: { target: SchoolYear | null; years: SchoolYear[]; onClose: () => void }) {
  const toast = useToast();
  const copy = useApiMutation((body: unknown) => post<{ groups: number; enrollments: number; waitlisted: number }>(`/school/years/${target!.id}/copy-from`, body), {
    invalidate: ['/school'],
    onSuccess: (r) => {
      toast.notify(`${r.groups} grupos copiados, ${r.enrollments} alumnos rematriculados${r.waitlisted ? ` y ${r.waitlisted} en lista de espera` : ''}`);
      onClose();
    },
  });
  const sources = years.filter((y) => y.id !== target?.id);
  return (
    <Modal open={!!target} onClose={onClose} title={`Copiar grupos a ${target?.name ?? ''}`}>
      <form
        className="form"
        key={target?.id}
        onSubmit={(e) => {
          e.preventDefault();
          const v = formValues(e.currentTarget);
          copy.mutate({ sourceYearId: v.sourceYearId, renewEnrollments: checked(e.currentTarget, 'renew') });
        }}
      >
        <SelectField label="Copiar grupos y horarios de" name="sourceYearId" required options={sources.map((y) => ({ value: y.id, label: y.name }))} />
        <Checkbox label="Rematricular a los alumnos activos en los mismos grupos" name="renew" defaultChecked />
        <p className="small muted">Los grupos ya copiados no se duplican. Si un grupo se llena, el resto queda en lista de espera.</p>
        <FormError error={copy.error} />
        <FormFooter onClose={onClose} loading={copy.isPending} />
      </form>
    </Modal>
  );
}

function YearsCard({ write }: { write: boolean }) {
  const q = useApi<SchoolYear[]>('/school/years');
  const [editing, setEditing] = useState<SchoolYear | null>(null);
  const [creating, setCreating] = useState(false);
  const [copying, setCopying] = useState<SchoolYear | null>(null);
  const toast = useToast();
  const quick = useApiMutation((v: { id: string; body: object; message: string }) => patch(`/school/years/${v.id}`, v.body), {
    invalidate: ['/school'],
    onSuccess: (_r, v) => toast.notify(v.message),
  });
  return (
    <Card title="Cursos escolares" actions={write && <Button size="sm" onClick={() => setCreating(true)}>Nuevo curso</Button>}>
      {q.isLoading && <Loading rows={2} />}
      {q.data && (
        <DataTable
          caption="Cursos escolares"
          rows={q.data}
          rowKey={(y) => y.id}
          empty={
            write ? (
              <span>
                Crea el primer curso escolar con el asistente. <Button size="sm" onClick={() => setCreating(true)}>Nuevo curso</Button>
              </span>
            ) : (
              'Aún no hay cursos escolares.'
            )
          }
          columns={[
            { key: 'n', header: 'Curso', render: (y) => <span><strong>{y.name}</strong> {y.isCurrent && <Chip tone="info">Actual</Chip>}</span> },
            { key: 'd', header: 'Fechas', render: (y) => `${date(y.startsOn)} – ${date(y.endsOn)}` },
            { key: 'h', header: 'Festivos', render: (y) => y.holidays.length, numeric: true },
            { key: 'g', header: 'Grupos', render: (y) => y._count?.groups ?? 0, numeric: true },
            { key: 'e', header: 'Matrícula', render: (y) => (y.enrollmentOpen ? <Chip tone="success">Abierta</Chip> : <Chip>Cerrada</Chip>) },
            ...(write
              ? [{
                  key: 'a',
                  header: 'Acciones',
                  render: (y: SchoolYear) => (
                    <Menu
                      label={`Acciones del curso ${y.name}`}
                      items={[
                        { label: 'Editar fechas y festivos', onSelect: () => setEditing(y) },
                        ...(!y.isCurrent ? [{ label: 'Marcar como curso actual', onSelect: () => quick.mutate({ id: y.id, body: { isCurrent: true }, message: `${y.name} es ahora el curso actual` }) }] : []),
                        y.enrollmentOpen
                          ? { label: 'Cerrar la matrícula online', onSelect: () => quick.mutate({ id: y.id, body: { enrollmentOpen: false }, message: 'Matrícula cerrada' }) }
                          : { label: 'Abrir la matrícula online', onSelect: () => quick.mutate({ id: y.id, body: { enrollmentOpen: true }, message: 'Matrícula abierta' }) },
                        { label: 'Copiar grupos de otro curso', onSelect: () => setCopying(y) },
                      ]}
                    />
                  ),
                }]
              : []),
          ]}
        />
      )}
      {creating && <YearWizard open years={q.data ?? []} onClose={() => setCreating(false)} />}
      {editing && <YearModal year={editing} onClose={() => setEditing(null)} />}
      <CopyModal target={copying} years={q.data ?? []} onClose={() => setCopying(null)} />
    </Card>
  );
}

function SubjectsCard({ write }: { write: boolean }) {
  const q = useApi<Subject[]>('/school/subjects');
  const [editing, setEditing] = useState<Subject | null>(null);
  const [creating, setCreating] = useState(false);
  const close = () => { setCreating(false); setEditing(null); };
  const save = useApiMutation((body: unknown) => (editing ? patch(`/school/subjects/${editing.id}`, body) : post('/school/subjects', body)), { success: 'Asignatura guardada', invalidate: ['/school'], onSuccess: close });
  return (
    <Card title="Asignaturas" actions={write && <Button size="sm" onClick={() => setCreating(true)}>Nueva asignatura</Button>}>
      {q.data && (
        <DataTable
          caption="Asignaturas"
          rows={q.data}
          rowKey={(s) => s.id}
          empty="Añade instrumentos, lenguaje musical y agrupaciones."
          columns={[
            { key: 'n', header: 'Asignatura', render: (s) => <span>{s.name} {!s.active && <Chip>Inactiva</Chip>}</span> },
            { key: 'k', header: 'Tipo', render: (s) => subjectKind[s.kind] },
            { key: 'f', header: 'Mensualidad', render: (s) => money(s.monthlyFeeCents), numeric: true, nowrap: true },
            ...(write ? [{ key: 'a', header: 'Acciones', render: (s: Subject) => <Button size="sm" variant="ghost" onClick={() => setEditing(s)} aria-label={`Editar ${s.name}`}>Editar</Button> }] : []),
          ]}
        />
      )}
      <Modal open={creating || !!editing} onClose={close} title={editing ? `Editar ${editing.name}` : 'Nueva asignatura'}>
        <form
          className="form"
          key={editing?.id ?? 'new'}
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            save.mutate({ name: v.name, kind: v.kind, monthlyFeeCents: centsOrNull(v.fee) ?? 0, active: checked(e.currentTarget, 'active') });
          }}
        >
          <div className="form-row">
            <TextField label="Nombre" name="name" required defaultValue={editing?.name} />
            <SelectField label="Tipo" name="kind" defaultValue={editing?.kind ?? 'INSTRUMENT'} options={Object.entries(subjectKind).map(([value, label]) => ({ value, label }))} />
            <TextField label="Mensualidad (€)" name="fee" inputMode="decimal" defaultValue={euros(editing?.monthlyFeeCents ?? 0)} />
          </div>
          <Checkbox label="Activa (se ofrece en la matrícula)" name="active" defaultChecked={editing?.active ?? true} />
          <FormError error={save.error} />
          <FormFooter onClose={close} loading={save.isPending} />
        </form>
      </Modal>
    </Card>
  );
}

function TeachersCard({ write }: { write: boolean }) {
  const q = useApi<Teacher[]>('/school/teachers');
  const users = useApi<StaffUser[]>(write ? '/school/staff-users' : null);
  const [editing, setEditing] = useState<Teacher | null>(null);
  const [creating, setCreating] = useState(false);
  const close = () => { setCreating(false); setEditing(null); };
  const save = useApiMutation((body: unknown) => (editing ? patch(`/school/teachers/${editing.id}`, body) : post('/school/teachers', body)), { success: 'Profesor guardado', invalidate: ['/school'], onSuccess: close });
  const userName = (id: string | null) => users.data?.find((u) => u.id === id)?.name;
  return (
    <Card title="Profesores" actions={write && <Button size="sm" onClick={() => setCreating(true)}>Nuevo profesor</Button>}>
      {q.data && (
        <DataTable
          caption="Profesores"
          rows={q.data}
          rowKey={(t) => t.id}
          empty="Añade al profesorado de la escuela."
          columns={[
            { key: 'n', header: 'Profesor', render: (t) => <span>{fullName(t)} {!t.active && <Chip>Inactivo</Chip>}</span> },
            { key: 'c', header: 'Contacto', render: (t) => [t.email, t.phone].filter(Boolean).join(' · ') || '—' },
            { key: 'u', header: 'Usuario', render: (t) => (t.userId ? userName(t.userId) ?? 'Vinculado' : '—') },
            { key: 'g', header: 'Grupos', render: (t) => t._count?.groups ?? 0, numeric: true },
            ...(write ? [{ key: 'a', header: 'Acciones', render: (t: Teacher) => <Button size="sm" variant="ghost" onClick={() => setEditing(t)} aria-label={`Editar ${fullName(t)}`}>Editar</Button> }] : []),
          ]}
        />
      )}
      <Modal open={creating || !!editing} onClose={close} title={editing ? `Editar ${fullName(editing)}` : 'Nuevo profesor'}>
        <form
          className="form"
          key={editing?.id ?? 'new'}
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            save.mutate({ firstName: v.firstName, lastName: v.lastName, email: v.email ?? null, phone: v.phone ?? null, userId: v.userId ?? null, active: checked(e.currentTarget, 'active') });
          }}
        >
          <div className="form-row">
            <TextField label="Nombre" name="firstName" required defaultValue={editing?.firstName} />
            <TextField label="Apellidos" name="lastName" required defaultValue={editing?.lastName} />
          </div>
          <div className="form-row">
            <TextField label="Email" name="email" type="email" defaultValue={editing?.email ?? ''} />
            <TextField label="Teléfono" name="phone" type="tel" defaultValue={editing?.phone ?? ''} />
          </div>
          <SelectField
            key={users.data ? 'ready' : 'loading'}
            label="Usuario de Solfeamos"
            name="userId"
            defaultValue={editing?.userId ?? ''}
            placeholder="Sin vincular"
            hint="Con el rol Profesor, verá «Mis grupos» y sólo podrá evaluar en ellos."
            options={(users.data ?? []).map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }))}
          />
          <Checkbox label="Activo" name="active" defaultChecked={editing?.active ?? true} />
          <FormError error={save.error} />
          <FormFooter onClose={close} loading={save.isPending} />
        </form>
      </Modal>
    </Card>
  );
}

function RoomsCard({ write }: { write: boolean }) {
  const q = useApi<Room[]>('/school/rooms');
  const [editing, setEditing] = useState<Room | null>(null);
  const [removing, setRemoving] = useState<Room | null>(null);
  const save = useApiMutation((body: unknown) => post('/school/rooms', body), { success: 'Aula añadida', invalidate: ['/school/rooms'] });
  const update = useApiMutation((v: { id: string; name: string; capacity: number | null }) => patch(`/school/rooms/${v.id}`, { name: v.name, capacity: v.capacity }), {
    success: 'Aula guardada',
    invalidate: ['/school'],
    onSuccess: () => setEditing(null),
  });
  const remove = useApiMutation((id: string) => del(`/school/rooms/${id}`), { success: 'Aula eliminada', invalidate: ['/school'], onSuccess: () => setRemoving(null) });
  return (
    <Card title="Aulas">
      <ul className="list-plain list-divided">
        {(q.data ?? []).map((r) => (
          <li key={r.id} className="row between">
            <span>
              {r.name}
              {r.capacity ? <span className="muted"> · {r.capacity} plazas</span> : null}
            </span>
            {write && (
              <Menu
                label={`Acciones del aula ${r.name}`}
                items={[
                  { label: 'Editar', onSelect: () => setEditing(r) },
                  { label: 'Eliminar', onSelect: () => setRemoving(r), danger: true },
                ]}
              />
            )}
          </li>
        ))}
      </ul>
      {q.data?.length === 0 && <p className="muted">Sin aulas. Con aulas, el horario avisa si dos clases coinciden en la misma.</p>}
      {write && (
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const v = formValues(form);
            save.mutate({ name: v.name, capacity: v.capacity ? Number(v.capacity) : null }, { onSuccess: () => form.reset() });
          }}
        >
          <TextField label="Nueva aula" name="name" required placeholder="Aula 2" />
          <TextField label="Capacidad" name="capacity" type="number" min={1} />
          <Button type="submit" variant="ghost" loading={save.isPending}>
            Añadir
          </Button>
        </form>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing ? `Editar ${editing.name}` : 'Aula'}>
        <form
          className="form"
          key={editing?.id}
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            if (editing) update.mutate({ id: editing.id, name: v.name ?? '', capacity: v.capacity ? Number(v.capacity) : null });
          }}
        >
          <div className="form-row">
            <TextField label="Nombre" name="name" required defaultValue={editing?.name} />
            <TextField label="Capacidad" name="capacity" type="number" min={1} defaultValue={editing?.capacity ?? ''} />
          </div>
          <FormError error={update.error} />
          <FormFooter onClose={() => setEditing(null)} loading={update.isPending} />
        </form>
      </Modal>
      <ConfirmModal
        open={!!removing}
        title="Eliminar aula"
        message={removing ? `Se eliminará ${removing.name}. Las clases que la usan se quedan sin aula.` : ''}
        confirmLabel="Eliminar"
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
        onClose={() => setRemoving(null)}
      />
    </Card>
  );
}

function FeesCard({ write }: { write: boolean }) {
  const q = useApi<SchoolSettings>('/school/settings');
  if (!q.data) return <Loading rows={2} />;
  return <FeesForm key={q.dataUpdatedAt} settings={q.data} write={write} />;
}

const pctValue = (x?: string) => Math.min(100, Math.max(0, Number(x ?? 0) || 0));
const dayOptions = Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: `Día ${i + 1}` }));

/** Cuánto pagaría una familia con los valores del formulario, sin guardarlos. */
function Simulator({ readSettings }: { readSettings: () => object }) {
  const { yearId, year } = useSchoolYears();
  const families = useApi<Family[]>('/school/families');
  const [familyId, setFamilyId] = useState('');
  const run = useApiMutation((body: unknown) => post<TuitionPreview>('/school/tuition/preview', body));
  const r = run.data;
  return (
    <Card tone="cool" title="Simulador de cuota" headingLevel={3}>
      <p className="small muted">Comprueba cuánto pagaría una familia con los valores de arriba antes de guardarlos{year ? ` (curso ${year.name})` : ''}.</p>
      <div className="toolbar">
        <SelectField label="Familia" value={familyId} onChange={(e) => setFamilyId(e.target.value)} placeholder="Toda la escuela" options={(families.data ?? []).map((f) => ({ value: f.id, label: f.name }))} />
        <Button variant="ghost" disabled={!yearId} loading={run.isPending} onClick={() => run.mutate({ yearId, familyId: familyId || undefined, settings: readSettings() })}>
          Calcular
        </Button>
      </div>
      <FormError error={run.error} />
      {r && (
        <>
          <DataTable
            caption="Cuota simulada"
            rows={r.rows}
            rowKey={(x) => x.studentId}
            empty="Sin alumnos con matrículas activas en el curso."
            columns={[
              { key: 'n', header: 'Alumno', render: (x) => fullName(x.student) },
              { key: 'b', header: 'Base', render: (x) => money(x.baseCents), numeric: true, nowrap: true },
              {
                key: 'd',
                header: 'Descuentos',
                render: (x) =>
                  [x.detail.tariff?.name, ...x.detail.discounts.map((d) => (d.kind === 'FAMILY' ? `${discountKind.FAMILY} ${money(d.cents)}` : `${discountKind[d.kind]} ${d.pct} %`))]
                    .filter(Boolean)
                    .join(', ') || '—',
              },
              { key: 'a', header: 'Paga', render: (x) => <strong>{money(x.amountCents)}</strong>, numeric: true, nowrap: true },
            ]}
          />
          <p>
            Total: <strong>{money(r.totalAmountCents)}</strong> al mes ({r.students} alumnos, {money(r.totalDiscountCents)} en descuentos).
          </p>
        </>
      )}
    </Card>
  );
}

function FeesForm({ settings, write }: { settings: SchoolSettings; write: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [mode, setMode] = useState(settings.feeMode);
  const [auto, setAuto] = useState(settings.autoIssueDay !== null);
  const [editing, setEditing] = useState<TuitionTariff | null>(null);
  const [removing, setRemoving] = useState<TuitionTariff | null>(null);
  const tariffs = useApi<TuitionTariff[]>(mode === 'FIXED' ? '/school/tariffs' : null);
  const save = useApiMutation((body: unknown) => put('/school/settings', body), { success: 'Configuración guardada', invalidate: ['/school/settings', '/school/tariffs'] });
  const saveTariff = useApiMutation(
    (body: { id?: string; name: string; monthlyCents: number; active: boolean }) => (body.id ? patch(`/school/tariffs/${body.id}`, body) : post('/school/tariffs', body)),
    { success: 'Tarifa guardada', invalidate: ['/school/tariffs'], onSuccess: () => setEditing(null) },
  );
  const removeTariff = useApiMutation((id: string) => del(`/school/tariffs/${id}`), { success: 'Tarifa eliminada', invalidate: ['/school/tariffs'], onSuccess: () => setRemoving(null) });
  return (
    <Card title="Forma de cobro y descuentos">
      <form
        className="form"
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          const v = formValues(e.currentTarget);
          save.mutate({
            feeMode: mode,
            familyDiscountCents: centsOrNull(v.family) ?? 0,
            ...(mode === 'PERCENT'
              ? { siblingDiscountPct: pctValue(v.sibling), memberDiscountPct: pctValue(v.member), multiSubjectDiscountPct: pctValue(v.multi) }
              : {}),
            autoIssueDay: auto ? Number(v.autoIssueDay ?? 1) : null,
            ...(auto ? { autoIssueDueDay: Number(v.autoIssueDueDay ?? 5) } : {}),
          });
        }}
      >
        <SelectField
          label="Forma de cobro"
          value={mode}
          onChange={(e) => setMode(e.target.value as SchoolSettings['feeMode'])}
          disabled={!write}
          options={[{ value: 'PERCENT', label: 'Descuentos por porcentaje' }, { value: 'FIXED', label: 'Tarifas fijas mensuales' }]}
        />
        {mode === 'PERCENT' && (
          <div className="form-row">
            <TextField label="Hermanos (%)" name="sibling" type="number" min={0} max={100} defaultValue={settings.siblingDiscountPct} hint="Del 2.º hermano en adelante." disabled={!write} />
            <TextField label="Socios de la banda (%)" name="member" type="number" min={0} max={100} defaultValue={settings.memberDiscountPct} hint="Alumno o tutor socio." disabled={!write} />
            <TextField label="Varias asignaturas (%)" name="multi" type="number" min={0} max={100} defaultValue={settings.multiSubjectDiscountPct} hint="Con 2 o más matrículas." disabled={!write} />
          </div>
        )}
        <TextField label="Familia (€)" name="family" inputMode="decimal" defaultValue={euros(settings.familyDiscountCents)} hint="El mismo importe por cada alumno adicional. Con 5 €, el 2.º resta 5 € y el 3.º otros 5 €. También con tarifa fija." disabled={!write} />
        {mode === 'PERCENT' && <p className="small muted">Los porcentajes se suman y no superan el 100 %. El descuento de familia se resta después y el cargo no baja de cero.</p>}
        {mode === 'FIXED' && <p className="small muted">Cada alumno paga la tarifa de su ficha. Sin tarifa, se cobra la suma de las asignaturas. El descuento de familia se resta igual.</p>}
        <fieldset className="stack" style={{ gap: 8, border: 0, padding: 0, margin: 0 }}>
          <legend className="label-caps">Emisión de mensualidades</legend>
          <Checkbox label="Emitir solas cada mes las mensualidades del curso actual" checked={auto} onChange={(e) => setAuto(e.target.checked)} disabled={!write} />
          {auto && (
            <div className="form-row">
              <SelectField label="Se emiten el" name="autoIssueDay" defaultValue={String(settings.autoIssueDay ?? 1)} options={dayOptions} disabled={!write} />
              <SelectField label="Y vencen el" name="autoIssueDueDay" defaultValue={String(settings.autoIssueDueDay)} options={dayOptions} disabled={!write} hint="Si es antes que la emisión, vencen el mismo día." />
            </div>
          )}
          {!auto && <p className="small muted">Sin emisión automática, se emiten a mano en «Mensualidades».</p>}
        </fieldset>
        <FormError error={save.error} />
        {write && (
          <div className="row">
            <Button type="submit" loading={save.isPending}>
              Guardar
            </Button>
          </div>
        )}
      </form>
      {mode === 'FIXED' && (
        <div className="stack" style={{ marginTop: 16 }}>
          {tariffs.data && (
            <DataTable
              caption="Tarifas mensuales"
              rows={tariffs.data}
              rowKey={(t) => t.id}
              empty="Crea la primera tarifa y asígnala en la ficha del alumno o a varios a la vez desde Alumnos."
              columns={[
                { key: 'n', header: 'Tarifa', render: (t) => <span>{t.name} {!t.active && <Chip>Inactiva</Chip>}</span> },
                { key: 'f', header: 'Mensualidad', render: (t) => money(t.monthlyCents), numeric: true, nowrap: true },
                { key: 'c', header: 'Alumnos', render: (t) => t._count?.students ?? 0, numeric: true },
                ...(write
                  ? [{
                      key: 'a',
                      header: 'Acciones',
                      render: (t: TuitionTariff) => (
                        <Menu
                          label={`Acciones de ${t.name}`}
                          items={[
                            { label: 'Editar', onSelect: () => setEditing(t) },
                            { label: 'Eliminar', onSelect: () => setRemoving(t), danger: true },
                          ]}
                        />
                      ),
                    }]
                  : []),
              ]}
            />
          )}
          {write && (
            <form
              className="toolbar"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const v = formValues(form);
                const monthlyCents = centsOrNull(v.fee);
                if (monthlyCents === null) return;
                saveTariff.mutate({ name: v.name ?? '', monthlyCents, active: true }, { onSuccess: () => form.reset() });
              }}
            >
              <TextField label="Nueva tarifa" name="name" required placeholder="Familiar" />
              <TextField label="Importe (€/mes)" name="fee" required inputMode="decimal" placeholder="45,00" />
              <Button type="submit" variant="ghost" loading={saveTariff.isPending}>Añadir</Button>
            </form>
          )}
          <FormError error={saveTariff.error} />
        </div>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing ? `Editar ${editing.name}` : 'Tarifa'}>
        <form
          className="form"
          key={editing?.id}
          onSubmit={(e) => {
            e.preventDefault();
            if (!editing) return;
            const form = e.currentTarget;
            const v = formValues(form);
            const monthlyCents = centsOrNull(v.fee);
            if (monthlyCents === null) return;
            saveTariff.mutate({ id: editing.id, name: v.name ?? '', monthlyCents, active: checked(form, 'active') });
          }}
        >
          <TextField label="Nombre" name="name" required defaultValue={editing?.name} />
          <TextField label="Importe (€/mes)" name="fee" required inputMode="decimal" defaultValue={euros(editing?.monthlyCents)} />
          <Checkbox label="Activa (se puede asignar)" name="active" defaultChecked={editing?.active ?? true} />
          <FormError error={saveTariff.error} />
          <FormFooter onClose={() => setEditing(null)} loading={saveTariff.isPending} />
        </form>
      </Modal>
      {write && (
        <div style={{ marginTop: 16 }}>
          <Simulator
            readSettings={() => {
              const v = formRef.current ? formValues(formRef.current) : {};
              return {
                feeMode: mode,
                familyDiscountCents: centsOrNull(v.family) ?? 0,
                ...(mode === 'PERCENT' ? { siblingDiscountPct: pctValue(v.sibling), memberDiscountPct: pctValue(v.member), multiSubjectDiscountPct: pctValue(v.multi) } : {}),
              };
            }}
          />
        </div>
      )}
      <ConfirmModal
        open={!!removing}
        title="Eliminar tarifa"
        message={removing ? `Se eliminará ${removing.name}. No se puede si algún alumno la tiene asignada.` : ''}
        confirmLabel="Eliminar"
        onConfirm={() => removing && removeTariff.mutate(removing.id)}
        onClose={() => setRemoving(null)}
        loading={removeTariff.isPending}
      />
    </Card>
  );
}

/** Matrícula online: enlace público, texto de presentación, apertura del curso actual y avisos a las familias. */
function EnrollmentCard({ write }: { write: boolean }) {
  const q = useApi<SchoolSettings>('/school/settings');
  const { year } = useSchoolYears();
  const save = useApiMutation((body: unknown) => put('/school/settings', body), { success: 'Configuración guardada', invalidate: ['/school/settings'] });
  const toggle = useApiMutation((open: boolean) => patch(`/school/years/${year!.id}`, { enrollmentOpen: open }), {
    success: 'Matrícula actualizada',
    invalidate: ['/school'],
  });
  if (!q.data) return <Loading rows={2} />;
  const settings = q.data;
  return (
    <div className="stack" style={{ gap: 24 }}>
      {settings.slug && <PublicLink slug={settings.slug} />}
      <Card title="Matrícula online">
        <div className="stack" style={{ gap: 16 }}>
          {year ? (
            <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
              <span>
                Curso {year.name}: {year.enrollmentOpen ? <Chip tone="success">Matrícula abierta</Chip> : <Chip>Matrícula cerrada</Chip>}
              </span>
              {write && (
                <Button variant={year.enrollmentOpen ? 'ghost' : 'primary'} loading={toggle.isPending} onClick={() => toggle.mutate(!year.enrollmentOpen)}>
                  {year.enrollmentOpen ? 'Cerrar la matrícula' : 'Abrir la matrícula'}
                </Button>
              )}
            </div>
          ) : (
            <p className="muted">Crea un curso para abrir la matrícula.</p>
          )}
          <form
            className="form"
            key={q.dataUpdatedAt}
            onSubmit={(e) => {
              e.preventDefault();
              const v = formValues(e.currentTarget);
              save.mutate({ publicIntro: v.publicIntro ?? null, notifyFamilies: checked(e.currentTarget, 'notifyFamilies') });
            }}
          >
            <TextAreaField label="Presentación del formulario público" name="publicIntro" rows={4} defaultValue={settings.publicIntro ?? ''} disabled={!write} hint="Horarios de atención, documentación que hay que traer, plazos…" />
            <Checkbox
              label="Avisar por email a las familias: matrícula aceptada, en lista de espera o rechazada, y cada recibo emitido"
              name="notifyFamilies"
              defaultChecked={settings.notifyFamilies}
              disabled={!write}
            />
            <FormError error={save.error} />
            {write && (
              <div className="row">
                <Button type="submit" loading={save.isPending}>
                  Guardar
                </Button>
              </div>
            )}
          </form>
        </div>
      </Card>
    </div>
  );
}

/** Configuración por secciones, enlazables desde el panel de Inicio (`?tab=settings&section=…`). */
export function SettingsTab() {
  const { can } = useAuth();
  const write = can('school:write');
  return (
    <UrlTabs
      label="Secciones de configuración"
      param="section"
      tabs={[
        { id: 'cursos', label: 'Cursos y calendario', content: <YearsCard write={write} /> },
        { id: 'oferta', label: 'Oferta educativa', content: <SubjectsCard write={write} /> },
        {
          id: 'equipo',
          label: 'Profesorado y aulas',
          content: (
            <div className="grid grid--2">
              <TeachersCard write={write} />
              <RoomsCard write={write} />
            </div>
          ),
        },
        { id: 'cobro', label: 'Cobro', content: <FeesCard write={write} /> },
        { id: 'matricula', label: 'Matrícula y avisos', content: <EnrollmentCard write={write} /> },
      ]}
    />
  );
}
