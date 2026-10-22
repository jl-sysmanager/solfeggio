import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { patch, post } from '../../api/client';
import { useApi, useApiMutation } from '../../api/hooks';
import type { Paginated } from '../../api/types';
import type { Family, Student } from '../../api/types-school';
import { useAuth } from '../../auth/AuthProvider';
import { date, fullName } from '../../lib/format';
import { studentStatus } from '../../lib/labels-school';
import { Person } from '../Avatar';
import { Button } from '../Button';
import { Card } from '../Card';
import { StatusChip, Tag } from '../Chip';
import { DataTable, Pagination } from '../DataTable';
import { ErrorNote, Loading } from '../EmptyState';
import { Checkbox, FormError, SelectField, TextAreaField, TextField, formValues } from '../Field';
import { Menu } from '../Menu';
import { Modal } from '../Modal';

const NEW_FAMILY = '__new__';

type StudentLike = Pick<Student, 'id' | 'familyId' | 'firstName' | 'lastName' | 'birthDate' | 'email' | 'phone' | 'instrument' | 'imageConsent' | 'pickupAuthorized' | 'status' | 'notes'>;

/** Alta y edición de alumno. Permite crear la familia en el mismo paso. */
export function StudentFormModal({ open, onClose, student }: { open: boolean; onClose: () => void; student?: StudentLike | null }) {
  const families = useApi<Family[]>(open ? '/school/families' : null);
  const [familyChoice, setFamilyChoice] = useState<string>('');
  const close = () => {
    setFamilyChoice('');
    onClose();
  };
  const save = useApiMutation(
    async (v: { body: Record<string, unknown>; newFamily?: string }) => {
      let familyId = v.body.familyId;
      if (v.newFamily) familyId = (await post<Family>('/school/families', { name: v.newFamily })).id;
      const body = { ...v.body, familyId };
      return student ? patch(`/school/students/${student.id}`, body) : post('/school/students', body);
    },
    { success: student ? 'Alumno actualizado' : 'Alumno dado de alta', invalidate: ['/school'], onSuccess: close },
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
          <TextField label="Instrumento" name="instrument" defaultValue={student?.instrument ?? ''} />
          <TextField label="Email" name="email" type="email" defaultValue={student?.email ?? ''} />
          <TextField label="Teléfono" name="phone" type="tel" defaultValue={student?.phone ?? ''} />
        </div>
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

export function StudentsTab() {
  const { can } = useAuth();
  const write = can('school:write');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [page, setPage] = useState(1);
  const list = useApi<Paginated<Student>>('/school/students', { q, status, page, pageSize: 25 });
  const [editing, setEditing] = useState<Student | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="stack" style={{ gap: 24 }}>
      <Card>
        <div className="toolbar">
          <TextField label="Buscar" type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Nombre, email o instrumento" />
          <SelectField
            label="Estado"
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            placeholder="Todos"
            options={Object.entries(studentStatus).map(([value, { label }]) => ({ value, label }))}
          />
          {write && <Button onClick={() => setCreating(true)}>Nuevo alumno</Button>}
        </div>
      </Card>
      {list.isLoading && <Loading />}
      {list.error && <ErrorNote error={list.error} />}
      {list.data && (
        <Card>
          <DataTable
            caption="Alumnos de la escuela"
            rows={list.data.data}
            rowKey={(s) => s.id}
            empty="Da de alta al primer alumno o acepta solicitudes de matrícula."
            columns={[
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
    </div>
  );
}
