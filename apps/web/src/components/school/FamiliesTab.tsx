import { useState } from 'react';
import { Link } from 'react-router-dom';
import { del, patch, post } from '../../api/client';
import { useApi, useApiMutation } from '../../api/hooks';
import type { Member, Paginated } from '../../api/types';
import type { Family, Guardian } from '../../api/types-school';
import { useAuth } from '../../auth/AuthProvider';
import { fullName } from '../../lib/format';
import { Button } from '../Button';
import { Card } from '../Card';
import { Chip } from '../Chip';
import { DataTable } from '../DataTable';
import { ErrorNote, Loading } from '../EmptyState';
import { FormError, SelectField, TextAreaField, TextField, formValues } from '../Field';
import { Menu, type MenuItem } from '../Menu';
import { ConfirmModal, Modal } from '../Modal';

function FamilyModal({ open, onClose, family }: { open: boolean; onClose: () => void; family?: Family | null }) {
  const save = useApiMutation((body: unknown) => (family ? patch(`/school/families/${family.id}`, body) : post('/school/families', body)), {
    success: family ? 'Familia actualizada' : 'Familia creada',
    invalidate: ['/school'],
    onSuccess: onClose,
  });
  return (
    <Modal open={open} onClose={onClose} title={family ? `Editar ${family.name}` : 'Nueva familia'}>
      <form
        className="form"
        key={family?.id ?? 'new'}
        onSubmit={(e) => {
          e.preventDefault();
          const v = formValues(e.currentTarget);
          save.mutate({ name: v.name, notes: v.notes ?? null });
        }}
      >
        <TextField label="Nombre" name="name" required defaultValue={family?.name} placeholder="Familia García López" />
        <TextAreaField label="Notas" name="notes" defaultValue={family?.notes ?? ''} />
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
    </Modal>
  );
}

function GuardianModal({ open, onClose, familyId, guardian }: { open: boolean; onClose: () => void; familyId: string; guardian?: Guardian | null }) {
  const { can } = useAuth();
  const sensitive = can('members:sensitive');
  const members = useApi<Paginated<Member>>(open && can('members:read') ? '/members' : null, { status: 'ACTIVE', pageSize: 500 });
  const save = useApiMutation((body: unknown) => (guardian ? patch(`/school/guardians/${guardian.id}`, body) : post(`/school/families/${familyId}/guardians`, body)), {
    success: guardian ? 'Tutor actualizado' : 'Tutor añadido',
    invalidate: ['/school'],
    onSuccess: onClose,
  });
  return (
    <Modal open={open} onClose={onClose} title={guardian ? `Editar ${fullName(guardian)}` : 'Nuevo tutor'}>
      <form
        className="form"
        key={guardian?.id ?? 'new'}
        onSubmit={(e) => {
          e.preventDefault();
          const v = formValues(e.currentTarget);
          save.mutate({
            firstName: v.firstName, lastName: v.lastName, relationship: v.relationship ?? null, email: v.email ?? null, phone: v.phone ?? null,
            ...(can('members:read') ? { memberId: v.memberId ?? null } : {}), ...(sensitive && v.nationalId !== undefined ? { nationalId: v.nationalId } : {}),
          });
        }}
      >
        <div className="form-row">
          <TextField label="Nombre" name="firstName" required defaultValue={guardian?.firstName} />
          <TextField label="Apellidos" name="lastName" required defaultValue={guardian?.lastName} />
          <TextField label="Parentesco" name="relationship" defaultValue={guardian?.relationship ?? ''} placeholder="Madre, padre, tutor legal…" />
        </div>
        <div className="form-row">
          <TextField label="Email" name="email" type="email" defaultValue={guardian?.email ?? ''} hint="Necesario para el portal de familias." />
          <TextField label="Teléfono" name="phone" type="tel" defaultValue={guardian?.phone ?? ''} />
          {sensitive && <TextField label="DNI/NIE" name="nationalId" defaultValue={guardian?.nationalId ?? ''} autoComplete="off" />}
        </div>
        {can('members:read') && (
          <SelectField
            key={members.data ? 'ready' : 'loading'}
            label="Es socio de la banda"
            name="memberId"
            defaultValue={guardian?.memberId ?? ''}
            placeholder="No es socio"
            hint="Aplica el descuento de socio a sus hijos."
            options={(members.data?.data ?? []).map((m) => ({ value: m.id, label: `${m.lastName}, ${m.firstName}` }))}
          />
        )}
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
    </Modal>
  );
}

export function FamiliesTab() {
  const { can } = useAuth();
  const write = can('school:write');
  const [q, setQ] = useState('');
  const list = useApi<Family[]>('/school/families', { q });
  const [editing, setEditing] = useState<Family | null>(null);
  const [creating, setCreating] = useState(false);
  const [guardianFor, setGuardianFor] = useState<{ familyId: string; guardian: Guardian | null } | null>(null);
  const [removing, setRemoving] = useState<Guardian | null>(null);
  const invite = useApiMutation((g: Guardian) => post(`/school/guardians/${g.id}/invite`), { success: 'Invitación enviada al portal de familias', invalidate: ['/school/families'] });
  const remove = useApiMutation((g: Guardian) => del(`/school/guardians/${g.id}`), { success: 'Tutor eliminado', invalidate: ['/school'], onSuccess: () => setRemoving(null) });

  function actions(f: Family): MenuItem[] {
    return [
      { label: 'Editar familia', onSelect: () => setEditing(f) },
      { label: 'Añadir tutor', onSelect: () => setGuardianFor({ familyId: f.id, guardian: null }) },
      ...f.guardians.flatMap((g) => [
        { label: `Editar a ${g.firstName}`, onSelect: () => setGuardianFor({ familyId: f.id, guardian: g }) },
        ...(g.email && !g.portalAccess ? [{ label: `Invitar a ${g.firstName} al portal`, onSelect: () => invite.mutate(g) }] : []),
        { label: `Eliminar a ${g.firstName}`, onSelect: () => setRemoving(g), danger: true },
      ]),
    ];
  }

  return (
    <div className="stack" style={{ gap: 24 }}>
      <Card>
        <div className="toolbar">
          <TextField label="Buscar" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Familia o apellido del tutor" />
          {write && <Button onClick={() => setCreating(true)}>Nueva familia</Button>}
        </div>
      </Card>
      {list.isLoading && <Loading />}
      {list.error && <ErrorNote error={list.error} />}
      {list.data && (
        <Card>
          <DataTable
            caption="Familias de la escuela"
            rows={list.data}
            rowKey={(f) => f.id}
            empty="Crea una familia para agrupar hermanos y tutores."
            columns={[
              { key: 'n', header: 'Familia', render: (f) => <strong>{f.name}</strong> },
              {
                key: 'g',
                header: 'Tutores',
                render: (f) =>
                  f.guardians.length ? (
                    <ul className="list-plain">
                      {f.guardians.map((g) => (
                        <li key={g.id}>
                          {fullName(g)}
                          {g.relationship && <span className="muted"> · {g.relationship}</span>}
                          {g.email && <span className="small muted"> · {g.email}</span>} {g.portalAccess && <Chip tone="success">Portal</Chip>}
                          {g.memberId && <Chip tone="info">Socio</Chip>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    '—'
                  ),
              },
              {
                key: 's',
                header: 'Alumnos',
                render: (f) => (f.students?.length ? f.students.map((s, i) => <span key={s.id}>{i > 0 && ', '}<Link to={`/school/students/${s.id}`}>{s.firstName}</Link></span>) : '—'),
              },
              ...(write ? [{ key: 'a', header: 'Acciones', render: (f: Family) => <Menu label={`Acciones de ${f.name}`} items={actions(f)} /> }] : []),
            ]}
          />
        </Card>
      )}
      <FamilyModal open={creating || !!editing} family={editing} onClose={() => { setCreating(false); setEditing(null); }} />
      <GuardianModal open={!!guardianFor} familyId={guardianFor?.familyId ?? ''} guardian={guardianFor?.guardian} onClose={() => setGuardianFor(null)} />
      <ConfirmModal
        open={!!removing}
        title="Eliminar tutor"
        message={`Se eliminará a ${removing ? fullName(removing) : ''} y perderá el acceso al portal de familias.`}
        confirmLabel="Eliminar"
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}
