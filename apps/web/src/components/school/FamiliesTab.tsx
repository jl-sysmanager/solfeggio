import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { del, patch, post } from '../../api/client';
import { useApi, useApiMutation } from '../../api/hooks';
import type { Member, Paginated } from '../../api/types';
import type { Family, Guardian, PaymentMethod, TuitionCharge, TuitionPreview } from '../../api/types-school';
import { useAuth } from '../../auth/AuthProvider';
import { fullName, money } from '../../lib/format';
import { tuitionStatus } from '../../lib/labels-school';
import { Button } from '../Button';
import { Card } from '../Card';
import { Chip, StatusChip } from '../Chip';
import { DataTable } from '../DataTable';
import { ErrorNote, Loading } from '../EmptyState';
import { FormError, SelectField, TextAreaField, TextField, formValues } from '../Field';
import { Menu, type MenuItem } from '../Menu';
import { ConfirmModal, Modal } from '../Modal';
import { useSchoolYears } from './common';
import { PayModal } from './PayModal';

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
            hint="Aplica el descuento de socio y, si el socio tiene usuario, permite darle acceso al portal."
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

type StaffUser = { id: string; name: string; email: string; role?: { key: string; name: string } };

function LinkPortalModal({ guardian, onClose }: { guardian: Guardian | null; onClose: () => void }) {
  const users = useApi<StaffUser[]>(guardian ? '/school/staff-users' : null);
  const link = useApiMutation((userId: string) => post(`/school/guardians/${guardian!.id}/link`, { userId }), {
    success: 'Usuario vinculado al portal de familias',
    invalidate: ['/school/families', '/school/staff-users'],
    onSuccess: onClose,
  });
  return (
    <Modal open={!!guardian} onClose={onClose} title={guardian ? `Vincular portal · ${fullName(guardian)}` : 'Vincular portal'}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const v = formValues(e.currentTarget);
          if (v.userId) link.mutate(v.userId);
        }}
      >
        <p className="small muted">
          Elige un usuario o socio con acceso a la app. Conserva su rol actual y gana acceso al portal de familias.
        </p>
        <SelectField
          label="Usuario de la banda"
          name="userId"
          required
          placeholder="Selecciona…"
          options={(users.data ?? []).map((u) => ({
            value: u.id,
            label: `${u.name} · ${u.email}${u.role ? ` (${u.role.name})` : ''}`,
          }))}
        />
        <FormError error={link.error} />
        <div className="modal__footer">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={link.isPending}>
            Vincular
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Cuota mensual estimada de la familia en el curso actual y, para quien cobra, lo que tiene pendiente. */
function FamilyFeesModal({ family, onClose }: { family: Family; onClose: () => void }) {
  const { can } = useAuth();
  const tuition = can('school:tuition');
  const { yearId, year } = useSchoolYears();
  const estimate = useApiMutation((id: string) => post<TuitionPreview>('/school/tuition/preview', { yearId: id, familyId: family.id }));
  const run = estimate.mutate;
  useEffect(() => {
    if (yearId) run(yearId);
  }, [yearId, run]);
  const charges = useApi<Paginated<TuitionCharge>>(tuition ? '/school/tuition/charges' : null, { familyId: family.id, pageSize: 100 });
  const [paying, setPaying] = useState(false);
  const pay = useApiMutation((v: { date: string; method: PaymentMethod }) => post(`/school/tuition/families/${family.id}/pay`, v), {
    success: 'Cobro registrado en tesorería',
    invalidate: ['/school', '/finance'],
    onSuccess: () => setPaying(false),
  });
  const open = (charges.data?.data ?? []).filter((c) => c.status === 'PENDING' || c.status === 'OVERDUE');
  const openCents = open.reduce((sum, c) => sum + c.amountCents, 0);
  const r = estimate.data;
  return (
    <Modal open onClose={onClose} title={`Cuota de ${family.name}`}>
      <div className="stack" style={{ gap: 16 }}>
        <Card tone="cool" title={`Cuota mensual estimada${year ? ` (${year.name})` : ''}`} headingLevel={3}>
          {!r ? (
            estimate.isPending ? <Loading rows={2} /> : <p className="muted">{yearId ? 'Sin datos.' : 'Crea un curso para calcularla.'}</p>
          ) : r.rows.length === 0 ? (
            <p className="muted">Ningún alumno de la familia tiene matrículas activas en el curso.</p>
          ) : (
            <ul className="list-plain list-divided">
              {r.rows.map((x) => (
                <li key={x.studentId} className="row between">
                  <span>
                    {x.student.firstName}
                    {x.discountCents > 0 && <span className="small muted"> (−{money(x.discountCents)} de descuento)</span>}
                  </span>
                  <strong>{money(x.amountCents)}</strong>
                </li>
              ))}
              <li className="row between">
                <span>Total al mes</span>
                <strong>{money(r.totalAmountCents)}</strong>
              </li>
            </ul>
          )}
          <FormError error={estimate.error} />
        </Card>
        {tuition && (
          <Card title="Pendiente de cobro" headingLevel={3}>
            {charges.isLoading && <Loading rows={2} />}
            {charges.data && open.length === 0 && <p className="muted">No tiene mensualidades pendientes.</p>}
            {open.length > 0 && (
              <>
                <ul className="list-plain list-divided">
                  {open.map((c) => (
                    <li key={c.id} className="row between">
                      <span>
                        {c.period} · {c.student ? c.student.firstName : ''} <StatusChip value={c.status} map={tuitionStatus} />
                      </span>
                      <span>{money(c.amountCents)}</span>
                    </li>
                  ))}
                </ul>
                <div className="row">
                  <Button onClick={() => setPaying(true)}>Cobrar todo ({money(openCents)})</Button>
                </div>
              </>
            )}
          </Card>
        )}
      </div>
      {paying && (
        <PayModal
          open
          title={`Cobrar a ${family.name}`}
          summary={`${open.length} mensualidades pendientes:`}
          amountCents={openCents}
          loading={pay.isPending}
          error={pay.error}
          onConfirm={(v) => pay.mutate(v)}
          onClose={() => setPaying(false)}
        />
      )}
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
  const [linking, setLinking] = useState<Guardian | null>(null);
  const [removing, setRemoving] = useState<Guardian | null>(null);
  const [fees, setFees] = useState<Family | null>(null);
  const invite = useApiMutation((g: Guardian) => post<{ linked?: boolean }>(`/school/guardians/${g.id}/invite`), {
    success: 'Portal de familias actualizado',
    invalidate: ['/school/families', '/school/staff-users'],
  });
  const unlink = useApiMutation((g: Guardian) => del(`/school/guardians/${g.id}/link`), {
    success: 'Acceso al portal retirado',
    invalidate: ['/school/families', '/school/staff-users'],
  });
  const remove = useApiMutation((g: Guardian) => del(`/school/guardians/${g.id}`), { success: 'Tutor eliminado', invalidate: ['/school'], onSuccess: () => setRemoving(null) });

  function actions(f: Family): MenuItem[] {
    return [
      { label: 'Editar familia', onSelect: () => setEditing(f) },
      { label: can('school:tuition') ? 'Cuota y cobros' : 'Cuota estimada', onSelect: () => setFees(f) },
      { label: 'Añadir tutor', onSelect: () => setGuardianFor({ familyId: f.id, guardian: null }) },
      ...f.guardians.flatMap((g) => [
        { label: `Editar a ${g.firstName}`, onSelect: () => setGuardianFor({ familyId: f.id, guardian: g }) },
        ...(!g.portalAccess
          ? [
              ...(g.email || g.memberId
                ? [{ label: `Dar acceso al portal a ${g.firstName}`, onSelect: () => invite.mutate(g) }]
                : []),
              { label: `Vincular usuario a ${g.firstName}`, onSelect: () => setLinking(g) },
            ]
          : [{ label: `Quitar portal a ${g.firstName}`, onSelect: () => unlink.mutate(g) }]),
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
      <LinkPortalModal guardian={linking} onClose={() => setLinking(null)} />
      {fees && <FamilyFeesModal family={fees} onClose={() => setFees(null)} />}
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
