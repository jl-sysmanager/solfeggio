import { Fragment, useEffect, useMemo, useState } from 'react';
import { del, patch, post } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import type { AuditEntry, Invitation, Paginated, PermissionDef, Role, Section, Tenant, TenantUser } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { Person } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { DataTable, Pagination } from '../components/DataTable';
import { ErrorNote, Loading } from '../components/EmptyState';
import { FormError, SelectField, TextField, formValues } from '../components/Field';
import { Menu } from '../components/Menu';
import { ConfirmModal, Modal } from '../components/Modal';
import { Page, PageHeader } from '../components/PageHeader';
import { Tabs, type TabDef } from '../components/Tabs';
import { date, dateTime } from '../lib/format';
import { tenantStatus } from '../lib/labels';
import { StatusChip } from '../components/Chip';
import { REGIONS } from '../components/admin/support/shared';
import { LogoEditor } from '../components/LogoEditor';

function TenantTab() {
  const { reload, can } = useAuth();
  const q = useApi<Tenant & { region?: string | null }>('/tenant');
  const save = useApiMutation((body: unknown) => patch('/tenant', body), { success: 'Datos de la banda guardados', invalidate: ['/tenant'], onSuccess: () => reload() });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorNote error={q.error} />;
  const t = q.data;
  const preview = t.hasLogo ? `/api/v1/bands/${encodeURIComponent(t.slug)}/logo?v=${encodeURIComponent(t.logoVersion ?? '')}` : null;
  return (
    <div className="stack" style={{ gap: 24 }}>
    {can('tenant:manage') && (
    <Card title="Logotipo de la banda">
      <LogoEditor
        previewUrl={preview}
        confirmPath="/tenant/logo"
        deletePath="/tenant/logo"
        onChanged={() => {
          q.refetch();
          reload();
        }}
      />
    </Card>
    )}
    <Card title="Datos de la banda">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const v = formValues(e.currentTarget);
          save.mutate({ name: v.name, legalName: v.legalName ?? null, taxId: v.taxId ?? null, timezone: v.timezone, country: v.country, region: v.region ?? null });
        }}
      >
        <p>
          Estado: <StatusChip value={t.status} map={tenantStatus} /> · identificador <code>{t.slug}</code>
        </p>
        <TextField label="Nombre" name="name" required defaultValue={t.name} />
        <div className="form-row">
          <TextField label="Razón social" name="legalName" defaultValue={t.legalName ?? ''} />
          <TextField label="CIF / NIF" name="taxId" defaultValue={t.taxId ?? ''} hint="Aparece en tus facturas." />
        </div>
        <div className="form-row">
          <TextField label="País (ISO)" name="country" defaultValue={t.country} maxLength={2} />
          <TextField label="Zona horaria" name="timezone" defaultValue={t.timezone} />
        </div>
        <SelectField label="Comunidad autónoma" name="region" defaultValue={t.region ?? ''} placeholder="Sin indicar" options={REGIONS.map((r) => ({ value: r, label: r }))} hint="Nos ayuda a avisaros de novedades que afecten a vuestra comunidad." />
        <FormError error={save.error} />
        <div>
          <Button type="submit" loading={save.isPending}>
            Guardar
          </Button>
        </div>
      </form>
    </Card>
    </div>
  );
}

function RolesTab() {
  const { can } = useAuth();
  const perms = useApi<PermissionDef[]>('/permissions');
  const roles = useApi<Role[]>('/roles');
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<Role | null>(null);

  useEffect(() => {
    if (roles.data) setDraft(Object.fromEntries(roles.data.map((r) => [r.id, r.permissions])));
  }, [roles.data]);

  const groups = useMemo(() => {
    const map = new Map<string, PermissionDef[]>();
    for (const p of perms.data ?? []) map.set(p.group, [...(map.get(p.group) ?? []), p]);
    return Array.from(map.entries());
  }, [perms.data]);

  const save = useApiMutation((r: Role) => patch(`/roles/${r.id}`, { permissions: draft[r.id] }), { success: 'Permisos guardados', invalidate: ['/roles'] });
  const create = useApiMutation((body: unknown) => post('/roles', body), { success: 'Rol creado', invalidate: ['/roles'], onSuccess: () => setCreating(false) });
  const remove = useApiMutation((id: string) => del(`/roles/${id}`), { success: 'Rol eliminado', invalidate: ['/roles'], onSuccess: () => setRemoving(null) });

  if (perms.isLoading || roles.isLoading) return <Loading />;
  if (roles.error) return <ErrorNote error={roles.error} />;
  const list = roles.data ?? [];
  const toggle = (rid: string, key: string) =>
    setDraft((d) => ({ ...d, [rid]: d[rid]?.includes(key) ? d[rid].filter((k) => k !== key) : [...(d[rid] ?? []), key] }));
  const dirty = (r: Role) => JSON.stringify([...(draft[r.id] ?? [])].sort()) !== JSON.stringify([...r.permissions].sort());

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="row between">
        <p className="small">Marca qué puede hacer cada rol. El rol de propietario siempre tiene todos los permisos.</p>
        <Button onClick={() => setCreating(true)}>Nuevo rol</Button>
      </div>
      <Card>
        <div className="table-wrap">
          <table className="table matrix">
            <caption className="sr-only">Matriz de permisos por rol</caption>
            <thead>
              <tr>
                <th scope="col">Permiso</th>
                {list.map((r) => (
                  <th key={r.id} scope="col" style={{ textAlign: 'center' }}>
                    {r.name}
                    {!r.isSystem && <span className="sr-only"> (personalizado)</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map(([group, items]) => (
                <Fragment key={group}>
                  <tr>
                    <th colSpan={list.length + 1} scope="colgroup" style={{ background: 'var(--surface-alt)' }}>
                      {group}
                    </th>
                  </tr>
                  {items.map((p) => (
                    <tr key={p.key}>
                      <th scope="row">
                        {p.label}
                        <span className="small muted" style={{ display: 'block' }}>
                          {p.key}
                        </span>
                      </th>
                      {list.map((r) => (
                        <td key={r.id}>
                          <input
                            type="checkbox"
                            aria-label={`${p.label} para ${r.name}`}
                            checked={r.key === 'owner' || (draft[r.id] ?? []).includes(p.key)}
                            disabled={r.key === 'owner' || (!(draft[r.id] ?? []).includes(p.key) && !can(p.key))}
                            title={!can(p.key) ? 'No puedes conceder un permiso que no tienes' : undefined}
                            onChange={() => toggle(r.id, p.key)}
                            style={{ width: 18, height: 18, accentColor: 'var(--blue-600)' }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td />
                {list.map((r) => (
                  <td key={r.id} style={{ textAlign: 'center' }}>
                    <div className="stack" style={{ alignItems: 'center', gap: 6 }}>
                      {r.key !== 'owner' && (
                        <Button size="sm" disabled={!dirty(r)} onClick={() => save.mutate(r)}>
                          Guardar
                        </Button>
                      )}
                      {!r.isSystem && (
                        <Button size="sm" variant="danger" onClick={() => setRemoving(r)}>
                          Eliminar
                        </Button>
                      )}
                    </div>
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
      <Modal open={creating} onClose={() => setCreating(false)} title="Nuevo rol">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            const base = list.find((r) => r.id === v.baseRoleId);
            create.mutate({ name: v.name, key: v.key, permissions: base?.permissions ?? [] });
          }}
        >
          <TextField label="Nombre" name="name" required placeholder="Archivero" />
          <TextField label="Clave" name="key" required pattern="[a-z][a-z0-9_]*" placeholder="archivist" hint="Minúsculas y guiones bajos." />
          <SelectField label="Copiar permisos de" name="baseRoleId" placeholder="Ninguno" options={list.map((r) => ({ value: r.id, label: r.name }))} />
          <FormError error={create.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={create.isPending}>
              Crear
            </Button>
          </div>
        </form>
      </Modal>
      <ConfirmModal
        open={!!removing}
        title="Eliminar rol"
        message={`¿Eliminar el rol «${removing?.name}»? Los usuarios con este rol deben reasignarse antes.`}
        confirmLabel="Eliminar"
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}

function UsersTab() {
  const { session } = useAuth();
  const users = useApi<TenantUser[] | Paginated<TenantUser>>('/users');
  // Sólo los roles que quien gestiona usuarios puede asignar (dentro de sus propios permisos).
  const roles = useApi<Pick<Role, 'id' | 'key' | 'name'>[]>('/roles/assignable');
  const invites = useApi<Invitation[]>('/invitations');
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<TenantUser | null>(null);
  const rows = Array.isArray(users.data) ? users.data : users.data?.data ?? [];
  const roleOptions = (roles.data ?? []).map((r) => ({ value: r.id, label: r.name }));

  const update = useApiMutation((v: { id: string; body: unknown }) => patch(`/users/${v.id}`, v.body), { success: 'Usuario actualizado', invalidate: ['/users'] });
  const remove = useApiMutation((id: string) => del(`/users/${id}`), { success: 'Acceso retirado', invalidate: ['/users', '/dashboard'], onSuccess: () => setRemoving(null) });
  const invite = useApiMutation((body: unknown) => post('/invitations', body), { success: 'Invitación enviada', invalidate: ['/invitations'], onSuccess: () => setInviting(false) });

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="row between">
        <p className="small">El número de miembros depende del plan.</p>
        <Button onClick={() => setInviting(true)}>Invitar miembro</Button>
      </div>
      {users.isLoading && <Loading />}
      {users.error && <ErrorNote error={users.error} />}
      {users.data && (
        <Card>
          <DataTable
            caption="Miembros de la banda"
            rows={rows}
            rowKey={(u) => u.id}
            columns={[
              { key: 'n', header: 'Miembro', render: (u) => <Person name={u.user.name} detail={u.user.email} /> },
              {
                key: 'r',
                header: 'Rol',
                render: (u) =>
                  u.role.key === 'owner' || u.user.id === session?.user.id ? (
                    u.role.name
                  ) : (
                    <select
                      className="select"
                      aria-label={`Rol de ${u.user.name}`}
                      value={u.role.id}
                      onChange={(e) => update.mutate({ id: u.id, body: { roleId: e.target.value } })}
                    >
                      {!roleOptions.some((o) => o.value === u.role.id) && <option value={u.role.id}>{u.role.name}</option>}
                      {roleOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ),
              },
              { key: 'm', header: 'MFA', render: (u) => (u.user.mfaEnabled ? <Chip tone="success">Activa</Chip> : <Chip>No</Chip>) },
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
        </Card>
      )}
      {invites.data && invites.data.length > 0 && (
        <Card title="Invitaciones" tone="cream">
          <DataTable
            caption="Invitaciones"
            rows={invites.data}
            rowKey={(i) => i.id}
            columns={[
              { key: 'e', header: 'Email', render: (i) => i.email },
              { key: 'r', header: 'Rol', render: (i) => roleOptions.find((r) => r.value === i.roleId)?.label ?? '—' },
              { key: 'd', header: 'Enviada', render: (i) => date(i.createdAt), nowrap: true },
              {
                key: 's',
                header: 'Estado',
                render: (i) =>
                  i.acceptedAt ? <Chip tone="success">Aceptada</Chip> : new Date(i.expiresAt) < new Date() ? <Chip tone="danger">Caducada</Chip> : <Chip tone="warning">Pendiente</Chip>,
              },
            ]}
          />
        </Card>
      )}
      <Modal open={inviting} onClose={() => setInviting(false)} title="Invitar miembro">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            invite.mutate({ email: v.email, roleId: v.roleId });
          }}
        >
          <TextField label="Email" name="email" type="email" required />
          <SelectField label="Rol" name="roleId" required options={roleOptions.filter((r) => (roles.data ?? []).find((x) => x.id === r.value)?.key !== 'owner')} />
          <p className="small muted">Recibirá un enlace válido 7 días para unirse.</p>
          <FormError error={invite.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setInviting(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={invite.isPending}>
              Enviar invitación
            </Button>
          </div>
        </form>
      </Modal>
      <ConfirmModal
        open={!!removing}
        title="Retirar acceso"
        message={`${removing?.user.name} dejará de tener acceso a la banda. Su ficha de socio, si la tiene, se conserva.`}
        confirmLabel="Retirar acceso"
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}

function SectionsTab() {
  const q = useApi<Section[]>('/sections');
  const create = useApiMutation((body: unknown) => post('/sections', body), { success: 'Sección creada', invalidate: ['/sections'] });
  const remove = useApiMutation((id: string) => del(`/sections/${id}`), { success: 'Sección eliminada', invalidate: ['/sections'] });
  return (
    <Card title="Secciones / cuerdas">
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const v = formValues(form);
          if (v.name) create.mutate({ name: v.name, position: (q.data?.length ?? 0) + 1 }, { onSuccess: () => form.reset() });
        }}
      >
        <TextField label="Nueva sección" name="name" placeholder="Clarinetes" />
        <Button type="submit" loading={create.isPending}>
          Añadir
        </Button>
      </form>
      {q.isLoading && <Loading />}
      <ul className="list-plain list-divided" style={{ marginTop: 16 }}>
        {(q.data ?? []).map((s) => (
          <li key={s.id} className="row between">
            <span>{s.name}</span>
            <Button size="sm" variant="danger" onClick={() => remove.mutate(s.id)} aria-label={`Eliminar sección ${s.name}`}>
              Eliminar
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AuditTab() {
  const [entity, setEntity] = useState('');
  const [page, setPage] = useState(1);
  const q = useApi<Paginated<AuditEntry>>('/audit-logs', { entity, page, pageSize: 50 });
  return (
    <div className="stack" style={{ gap: 24 }}>
      <Card>
        <div className="toolbar">
          <TextField label="Entidad" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }} placeholder="member, work, transaction…" />
        </div>
      </Card>
      {q.isLoading && <Loading />}
      {q.error && <ErrorNote error={q.error} />}
      {q.data && (
        <Card>
          <p className="small muted" style={{ marginBottom: 12 }}>
            Registro inalterable de acciones. No incluye datos personales sensibles.
          </p>
          <DataTable
            caption="Registro de auditoría"
            rows={q.data.data}
            rowKey={(a) => a.id}
            columns={[
              { key: 'd', header: 'Fecha', render: (a) => dateTime(a.createdAt), nowrap: true },
              { key: 'u', header: 'Usuario', render: (a) => <Person name={a.actor?.name ?? (a.actorId ? `Usuario ${a.actorId.slice(0, 8)}` : 'Sistema')} /> },
              { key: 'a', header: 'Acción', render: (a) => <code>{a.action}</code> },
              { key: 'e', header: 'Entidad', render: (a) => `${a.entity}${a.entityId ? ` · ${a.entityId.slice(0, 8)}` : ''}` },
            ]}
          />
          <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />
        </Card>
      )}
    </div>
  );
}

/** Personas con cuenta en la banda. Vive en Gestión, no en Ajustes. */
export function BandMembersPage() {
  return (
    <Page header={<PageHeader eyebrow="Gestión" title="Miembros" description="Personas con acceso a la banda: invitación, rol y suspensión." />}>
      <UsersTab />
    </Page>
  );
}

export default function SettingsPage() {
  const { can } = useAuth();
  const tabs: TabDef[] = [];
  if (can('tenant:manage')) tabs.push({ id: 'tenant', label: 'Banda', content: <TenantTab /> });
  if (can('tenant:manage') || can('members:write')) tabs.push({ id: 'sections', label: 'Secciones', content: <SectionsTab /> });
  if (can('roles:manage')) tabs.push({ id: 'roles', label: 'Roles y permisos', content: <RolesTab /> });
  if (can('audit:read')) tabs.push({ id: 'audit', label: 'Auditoría', content: <AuditTab /> });
  return (
    <Page header={<PageHeader tone="cream" eyebrow="Ajustes" title="Configuración de la banda" />}>
      <Tabs label="Ajustes" tabs={tabs} />
    </Page>
  );
}
