import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { del, patch, post } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import type { Invitation, Member, Paginated, Role, Section, TenantUser } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { Person } from '../components/Avatar';
import { ArrowLink, Button } from '../components/Button';
import { Card } from '../components/Card';
import { Chip, StatusChip } from '../components/Chip';
import { DataTable, Pagination } from '../components/DataTable';
import { ErrorNote, Loading } from '../components/EmptyState';
import { Checkbox, FormError, SelectField, TextAreaField, TextField, formValues } from '../components/Field';
import { Menu } from '../components/Menu';
import { ConfirmModal, Modal } from '../components/Modal';
import { Page, PageHeader } from '../components/PageHeader';
import { date, today } from '../lib/format';
import { memberStatus } from '../lib/labels';

type AccessFilter = 'all' | 'users' | 'members_only';

function accessLabel(m: Member) {
  if (m.access?.kind === 'user') {
    const suspended = m.access.status === 'SUSPENDED';
    return <Chip tone={suspended ? 'warning' : 'success'}>{suspended ? 'Usuario suspendido' : `Usuario · ${m.access.role.name}`}</Chip>;
  }
  return <Chip>Solo socio</Chip>;
}

export function useSections() {
  return useApi<Section[]>('/sections');
}

export function MemberFormModal({ open, onClose, member }: { open: boolean; onClose: () => void; member?: Member | null }) {
  const { can } = useAuth();
  const sections = useSections();
  const sensitive = can('members:sensitive');
  const save = useApiMutation(
    (body: Record<string, unknown>) => (member ? patch(`/members/${member.id}`, body) : post('/members', body)),
    { success: member ? 'Socio actualizado' : 'Socio dado de alta', invalidate: ['/members', '/dashboard'], onSuccess: onClose },
  );

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    const fd = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      firstName: v.firstName,
      lastName: v.lastName,
      email: v.email ?? null,
      phone: v.phone ?? null,
      birthDate: v.birthDate ?? null,
      address: v.address ?? null,
      instrument: v.instrument ?? null,
      sectionId: v.sectionId ?? null,
      notes: v.notes ?? null,
      consentImages: fd.get('consentImages') === 'on',
    };
    if (fd.get('consentData') === 'on' && !member?.consentDataAt) body.consentDataAt = new Date().toISOString();
    if (sensitive && v.nationalId !== undefined) body.nationalId = v.nationalId;
    if (!member && v.joinedAt) body.joinedAt = v.joinedAt;
    save.mutate(body);
  }

  return (
    <Modal open={open} onClose={onClose} title={member ? 'Editar socio' : 'Alta de socio'}>
      <form className="form" onSubmit={submit} key={member?.id ?? 'new'}>
        <div className="form-row">
          <TextField label="Nombre" name="firstName" required defaultValue={member?.firstName} autoComplete="off" />
          <TextField label="Apellidos" name="lastName" required defaultValue={member?.lastName} autoComplete="off" />
        </div>
        <div className="form-row">
          <TextField label="Email" name="email" type="email" defaultValue={member?.email ?? ''} />
          <TextField label="Teléfono" name="phone" type="tel" defaultValue={member?.phone ?? ''} />
        </div>
        <div className="form-row">
          <TextField label="Instrumento" name="instrument" defaultValue={member?.instrument ?? ''} />
          <SelectField
            label="Sección"
            name="sectionId"
            defaultValue={member?.sectionId ?? ''}
            placeholder="Sin sección"
            options={(sections.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          />
        </div>
        <div className="form-row">
          <TextField label="Fecha de nacimiento" name="birthDate" type="date" defaultValue={member?.birthDate?.slice(0, 10) ?? ''} />
          {!member && <TextField label="Fecha de alta" name="joinedAt" type="date" defaultValue={today()} />}
        </div>
        <TextField label="Dirección" name="address" defaultValue={member?.address ?? ''} />
        {sensitive && (
          <TextField label="DNI / NIE" name="nationalId" defaultValue={member?.nationalId ?? ''} hint="Se guarda cifrado." autoComplete="off" />
        )}
        <TextAreaField label="Notas" name="notes" defaultValue={member?.notes ?? ''} />
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field__label" style={{ marginBottom: 8 }}>
            Consentimientos (RGPD)
          </legend>
          <Checkbox name="consentData" label="Consiente el tratamiento de sus datos para la gestión de la banda" defaultChecked={!!member?.consentDataAt} disabled={!!member?.consentDataAt} />
          <Checkbox name="consentImages" label="Consiente el uso de su imagen en publicaciones" defaultChecked={member?.consentImages} />
        </fieldset>
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

export function LeaveModal({ member, onClose }: { member: Member | null; onClose: () => void }) {
  const leave = useApiMutation((body: { date: string; reason?: string }) => post(`/members/${member!.id}/leave`, body), {
    success: 'Baja registrada',
    invalidate: ['/members', '/dashboard'],
    onSuccess: onClose,
  });
  return (
    <Modal open={!!member} onClose={onClose} title={`Baja de ${member?.firstName ?? ''} ${member?.lastName ?? ''}`}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const v = formValues(e.currentTarget);
          leave.mutate({ date: v.date ?? today(), reason: v.reason });
        }}
      >
        <TextField label="Fecha de baja" name="date" type="date" defaultValue={today()} required />
        <TextAreaField label="Motivo" name="reason" />
        <p className="small muted">El historial se conserva. Podrás reactivar al socio más adelante o anonimizar sus datos desde su ficha.</p>
        <FormError error={leave.error} />
        <div className="modal__footer">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={leave.isPending}>
            Registrar baja
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Invita a un usuario a la app; opcionalmente crea también la ficha de socio. */
export function InviteUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { can } = useAuth();
  const canWriteMembers = can('members:write');
  const roles = useApi<Pick<Role, 'id' | 'key' | 'name'>[]>(open && can('users:manage') ? '/roles/assignable' : null);
  const [withMember, setWithMember] = useState(canWriteMembers);
  const invite = useApiMutation(
    (body: { email: string; roleId: string; createMember?: { firstName: string; lastName: string } }) => post('/invitations', body),
    {
      success: 'Invitación enviada',
      invalidate: ['/members', '/invitations', '/users', '/dashboard'],
      onSuccess: onClose,
    },
  );
  const roleOptions = (roles.data ?? []).filter((r) => r.key !== 'owner').map((r) => ({ value: r.id, label: r.name }));

  return (
    <Modal
      open={open}
      onClose={() => {
        setWithMember(canWriteMembers);
        onClose();
      }}
      title="Invitar usuario"
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const v = formValues(e.currentTarget);
          const fd = new FormData(e.currentTarget);
          const createMember = canWriteMembers && fd.get('withMember') === 'on';
          invite.mutate({
            email: (v.email ?? '').toLowerCase(),
            roleId: v.roleId ?? '',
            ...(createMember && v.firstName && v.lastName
              ? { createMember: { firstName: v.firstName, lastName: v.lastName } }
              : {}),
          });
        }}
      >
        <TextField label="Email" name="email" type="email" required autoComplete="email" />
        <SelectField label="Rol" name="roleId" required options={roleOptions} />
        {canWriteMembers && (
          <Checkbox
            name="withMember"
            label="Crear también ficha de socio (recomendado)"
            checked={withMember}
            onChange={(e) => setWithMember(e.currentTarget.checked)}
          />
        )}
        {withMember && canWriteMembers && (
          <div className="form-row">
            <TextField label="Nombre" name="firstName" required maxLength={80} />
            <TextField label="Apellidos" name="lastName" required maxLength={120} />
          </div>
        )}
        <p className="small muted">
          Recibirá un enlace válido 7 días. Al aceptar, se crea su cuenta (si no existe) y entra en la banda con el rol elegido.
          {withMember && canWriteMembers
            ? ' Contará como socio y como usuario del plan.'
            : ' Solo cuenta como usuario del plan hasta vincularlo a un socio.'}
        </p>
        <FormError error={invite.error} />
        <div className="modal__footer">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={invite.isPending}>
            Enviar invitación
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function OrphanUsersCard({ onInvite }: { onInvite: () => void }) {
  const { session } = useAuth();
  const users = useApi<TenantUser[] | Paginated<TenantUser>>('/users');
  const invites = useApi<Invitation[]>('/invitations');
  const roles = useApi<Pick<Role, 'id' | 'key' | 'name'>[]>('/roles/assignable');
  const [removing, setRemoving] = useState<TenantUser | null>(null);
  const rows = (Array.isArray(users.data) ? users.data : users.data?.data ?? []).filter((u) => !u.memberId);
  const pending = (invites.data ?? []).filter((i) => !i.memberId && !i.acceptedAt);
  const update = useApiMutation((v: { id: string; body: unknown }) => patch(`/users/${v.id}`, v.body), { success: 'Usuario actualizado', invalidate: ['/users', '/members'] });
  const remove = useApiMutation((id: string) => del(`/users/${id}`), { success: 'Acceso retirado', invalidate: ['/users', '/members', '/dashboard'], onSuccess: () => setRemoving(null) });
  const revoke = useApiMutation((id: string) => del(`/invitations/${id}`), { success: 'Invitación cancelada', invalidate: ['/invitations', '/users', '/dashboard'] });
  if (!rows.length && !pending.length) return null;
  return (
    <Card
      title="Accesos sin ficha de socio"
      tone="cream"
      actions={
        <Button size="sm" variant="ghost" onClick={onInvite}>
          Invitar usuario
        </Button>
      }
    >
      <p className="small muted" style={{ marginBottom: 12 }}>
        Cuentas con acceso a la app que no están vinculadas a un socio (p. ej. familias o personal externo). Cuentan como usuarios del plan.
      </p>
      {rows.length > 0 && (
        <DataTable
          caption="Usuarios sin socio"
          rows={rows}
          rowKey={(u) => u.id}
          columns={[
            { key: 'n', header: 'Persona', render: (u) => <Person name={u.user.name} detail={u.user.email} /> },
            { key: 'r', header: 'Rol', render: (u) => u.role.name },
            { key: 's', header: 'Estado', render: (u) => <Chip tone={u.status === 'ACTIVE' ? 'success' : 'warning'}>{u.status === 'ACTIVE' ? 'Activo' : 'Suspendido'}</Chip> },
            {
              key: 'a',
              header: 'Acciones',
              render: (u) =>
                u.role.key === 'owner' || u.user.id === session?.user.id ? null : (
                  <Menu
                    label={`Acciones de ${u.user.name}`}
                    items={[
                      {
                        label: u.status === 'ACTIVE' ? 'Suspender acceso' : 'Reactivar acceso',
                        onSelect: () => update.mutate({ id: u.id, body: { status: u.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' } }),
                      },
                      { label: 'Quitar de la banda', onSelect: () => setRemoving(u), danger: true },
                    ]}
                  />
                ),
            },
          ]}
        />
      )}
      {pending.length > 0 && (
        <ul className="list-plain" style={{ marginTop: 12 }}>
          {pending.map((i) => (
            <li key={i.id} className="row" style={{ justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
              <span className="small">
                Invitación pendiente: {i.email} · {roles.data?.find((r) => r.id === i.roleId)?.name ?? '—'}
              </span>
              <Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)} loading={revoke.isPending}>
                Cancelar
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmModal
        open={!!removing}
        title="Retirar acceso"
        message={`${removing?.user.name} dejará de tener acceso a la banda.`}
        confirmLabel="Retirar acceso"
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
        onClose={() => setRemoving(null)}
      />
    </Card>
  );
}

export default function MembersPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [q, setQ] = useState(params.get('q') ?? '');
  const status = params.get('status') ?? 'ACTIVE';
  const sectionId = params.get('sectionId') ?? '';
  const access = (params.get('access') as AccessFilter) || 'all';
  const page = Number(params.get('page') ?? 1);
  const [editing, setEditing] = useState<Member | null>(null);
  const [creating, setCreating] = useState(params.get('new') === '1');
  const [inviting, setInviting] = useState(params.get('invite') === '1');
  const [leaving, setLeaving] = useState<Member | null>(null);
  const sections = useSections();
  const canReadMembers = can('members:read');
  const list = useApi<Paginated<Member>>(
    canReadMembers ? '/members' : null,
    { q: params.get('q'), status: status === 'ALL' ? undefined : status, sectionId, access, page, pageSize: 25 },
  );

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    next.delete('new');
    next.delete('invite');
    setParams(next, { replace: true });
  };

  return (
    <Page
      header={
        <PageHeader
          eyebrow="Gestión"
          title="Socios"
          description="Fichas de la banda y acceso a la app. El propietario es socio y usuario; al invitar a alguien puedes crear su ficha a la vez."
          actions={
            <div className="row" style={{ gap: 8 }}>
              {can('users:manage') && (
                <Button variant="ghost" onClick={() => setInviting(true)}>
                  Invitar usuario
                </Button>
              )}
              {can('members:write') && <Button onClick={() => setCreating(true)}>Alta de socio</Button>}
            </div>
          }
        />
      }
    >
      <div className="chips" role="group" aria-label="Filtrar por tipo">
        {(
          [
            ['all', 'Todos'],
            ['members_only', 'Solo socios'],
            ['users', 'Usuarios'],
          ] as const
        ).map(([value, label]) => (
          <button key={value} type="button" className="chip chip--plain chip--outline" aria-pressed={access === value} onClick={() => set('access', value === 'all' ? '' : value)}>
            {label}
          </button>
        ))}
      </div>
      {canReadMembers && (
        <Card>
          <form
            className="toolbar"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              set('q', q);
            }}
          >
            <TextField label="Buscar" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, email, instrumento…" />
            <SelectField
              label="Estado"
              value={status}
              onChange={(e) => set('status', e.target.value)}
              options={[
                { value: 'ACTIVE', label: 'Activos' },
                { value: 'INACTIVE', label: 'Inactivos' },
                { value: 'LEFT', label: 'Bajas' },
                { value: 'ALL', label: 'Todos' },
              ]}
            />
            <SelectField
              label="Sección"
              value={sectionId}
              onChange={(e) => set('sectionId', e.target.value)}
              placeholder="Todas"
              options={(sections.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
            />
            <Button type="submit" variant="ghost">
              Buscar
            </Button>
          </form>
        </Card>
      )}

      {canReadMembers && list.isLoading && <Loading />}
      {canReadMembers && list.error && <ErrorNote error={list.error} />}
      {canReadMembers && list.data && (
        <Card title={`${list.data.total} ${access === 'users' ? 'usuarios' : access === 'members_only' ? 'socios sin acceso' : 'personas'}`}>
          <DataTable
            caption="Listado de socios"
            rows={list.data.data}
            rowKey={(m) => m.id}
            columns={[
              { key: 'n', header: 'Nº', render: (m) => m.memberNumber, numeric: true },
              {
                key: 'name',
                header: 'Nombre',
                render: (m) => (
                  <Person name={`${m.firstName} ${m.lastName}`} detail={m.email ?? undefined} photoUrl={m.photoUrl}>
                    <ArrowLink to={`/members/${m.id}`}>{`${m.lastName}, ${m.firstName}`}</ArrowLink>
                  </Person>
                ),
              },
              { key: 'access', header: 'Acceso', render: (m) => accessLabel(m), nowrap: true },
              { key: 'inst', header: 'Instrumento', render: (m) => m.instrument ?? '—' },
              { key: 'sec', header: 'Sección', render: (m) => m.section?.name ?? '—' },
              { key: 'joined', header: 'Alta', render: (m) => date(m.joinedAt), nowrap: true },
              { key: 'status', header: 'Estado', render: (m) => <StatusChip value={m.status} map={memberStatus} /> },
              ...(can('members:write') || can('users:manage')
                ? [
                    {
                      key: 'act',
                      header: 'Acciones',
                      render: (m: Member) => (
                        <Menu
                          label={`Acciones de ${m.firstName} ${m.lastName}`}
                          items={[
                            { label: 'Ver ficha', onSelect: () => navigate(`/members/${m.id}`) },
                            ...(can('members:write')
                              ? [
                                  { label: 'Editar', onSelect: () => setEditing(m) },
                                  ...(m.status !== 'LEFT' ? [{ label: 'Dar de baja', onSelect: () => setLeaving(m), danger: true }] : []),
                                ]
                              : []),
                          ]}
                        />
                      ),
                    },
                  ]
                : []),
            ]}
          />
          <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={(p) => set('page', String(p))} />
        </Card>
      )}

      {can('users:manage') && <OrphanUsersCard onInvite={() => setInviting(true)} />}

      <MemberFormModal open={creating || !!editing} member={editing} onClose={() => { setCreating(false); setEditing(null); }} />
      <InviteUserModal open={inviting} onClose={() => setInviting(false)} />
      <LeaveModal member={leaving} onClose={() => setLeaving(null)} />
    </Page>
  );
}
