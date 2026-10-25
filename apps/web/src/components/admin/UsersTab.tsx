import { useState } from 'react';
import { Link } from 'react-router-dom';
import { del, patch, post } from '../../api/client';
import { useApi, useApiMutation } from '../../api/hooks';
import { useAuth } from '../../auth/AuthProvider';
import type { Paginated } from '../../api/types';
import type { AdminUser, AdminUserDetail } from '../../api/types-admin-users';
import { date, dateTime } from '../../lib/format';
import { Button, IconButton } from '../Button';
import { Card } from '../Card';
import { Chip } from '../Chip';
import { DataTable, Pagination } from '../DataTable';
import { ErrorNote, Loading } from '../EmptyState';
import { FormError, SelectField, TextAreaField, TextField, formValues } from '../Field';
import { ConfirmModal, Drawer } from '../Modal';

function statusChip(u: AdminUser) {
  if (u.blockedAt) return <Chip tone="danger">Bloqueado</Chip>;
  if (u.isPlatformAdmin) return <Chip>Equipo</Chip>;
  return <Chip tone="success">Activo</Chip>;
}

/** Equipo de administración de la plataforma. Las cuentas de cada banda se gestionan en esa banda. */
export function UsersTab() {
  const { session } = useAuth();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [blocking, setBlocking] = useState<AdminUser | null>(null);
  const [removing, setRemoving] = useState<AdminUser | null>(null);

  const list = useApi<Paginated<AdminUser>>('/admin/users', { q: q.trim() || undefined, status, page, pageSize: 25 });
  const detail = useApi<AdminUserDetail>(selected ? `/admin/users/${selected.id}` : null);
  const inv = { invalidate: ['/admin/users', '/admin/moderation'] };

  const block = useApiMutation((v: { id: string; reason: string }) => post(`/admin/users/${v.id}/block`, { reason: v.reason }), {
    success: 'Usuario bloqueado',
    ...inv,
    onSuccess: () => setBlocking(null),
  });
  const unblock = useApiMutation((id: string) => post(`/admin/users/${id}/unblock`), { success: 'Usuario desbloqueado', ...inv });
  const patchUser = useApiMutation((v: { id: string; isPlatformAdmin: boolean }) => patch(`/admin/users/${v.id}`, { isPlatformAdmin: v.isPlatformAdmin }), {
    success: 'Acceso de plataforma actualizado',
    ...inv,
  });
  const revoke = useApiMutation((id: string) => post(`/admin/users/${id}/revoke-sessions`), {
    success: 'Sesiones cerradas',
    ...inv,
  });
  const grant = useApiMutation((email: string) => post('/admin/users/grant', { email }), {
    success: 'Incorporado al equipo',
    ...inv,
  });
  const remove = useApiMutation((id: string) => del(`/admin/users/${id}`), {
    success: 'Cuenta eliminada',
    ...inv,
    onSuccess: () => {
      setRemoving(null);
      setSelected(null);
    },
  });

  const u = detail.data ?? selected;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <Card>
        <p className="small muted">Cuentas del equipo de la plataforma. Las de cada banda se gestionan dentro de esa banda.</p>
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            const email = formValues(e.currentTarget).email?.trim();
            if (email) grant.mutate(email);
          }}
        >
          <TextField label="Añadir al equipo" name="email" type="email" required placeholder="email@dominio" />
          <Button type="submit" loading={grant.isPending}>Añadir</Button>
        </form>
        <FormError error={grant.error} />
        <div className="toolbar">
          <TextField
            label="Buscar"
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Nombre o email"
          />
          <SelectField
            label="Estado"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            options={[
              { value: 'all', label: 'Todos' },
              { value: 'active', label: 'Activos' },
              { value: 'blocked', label: 'Bloqueados' },
            ]}
          />
        </div>
      </Card>
      {list.isLoading && <Loading />}
      {list.error && <ErrorNote error={list.error} />}
      {list.data && (
        <Card>
          <DataTable
            caption="Usuarios"
            rows={list.data.data}
            rowKey={(row) => row.id}
            onRowClick={setSelected}
            empty="Nadie del equipo coincide."
            columns={[
              { key: 'n', header: 'Usuario', render: (row) => `${row.name} · ${row.email}` },
              { key: 's', header: 'Estado', render: statusChip },
              { key: 'm', header: 'MFA', render: (row) => (row.mfaEnabled ? 'Sí' : 'No') },
              { key: 'b', header: 'Bandas', render: (row) => row.memberships.length || '—', numeric: true },
              { key: 'l', header: 'Último acceso', render: (row) => (row.lastLoginAt ? date(row.lastLoginAt) : '—'), nowrap: true },
              { key: 'c', header: 'Alta', render: (row) => date(row.createdAt), nowrap: true },
              {
                key: 'a',
                header: 'Acciones',
                render: (row) => <IconButton icon="eye" label={`Ver ${row.name}`} onClick={() => setSelected(row)} />,
              },
            ]}
          />
          <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
        </Card>
      )}

      <Drawer open={!!selected} onClose={() => setSelected(null)} title={u?.name ?? 'Usuario'}>
        {detail.isLoading && !detail.data && <Loading rows={3} />}
        {detail.error && <ErrorNote error={detail.error} />}
        {u && (
          <div className="stack" style={{ gap: 16 }}>
            <p className="small muted">{u.email}</p>
            <div className="form-row" style={{ flexWrap: 'wrap', gap: 8 }}>
              {statusChip(u)}
              <Chip>{u.mfaEnabled ? 'MFA activo' : 'Sin MFA'}</Chip>
              {detail.data && <Chip>{detail.data.activeSessions} sesión(es)</Chip>}
            </div>
            <dl className="stack" style={{ gap: 4 }}>
              <div>
                <dt className="label-caps">Último acceso</dt>
                <dd>{u.lastLoginAt ? dateTime(u.lastLoginAt) : '—'}</dd>
              </div>
              <div>
                <dt className="label-caps">Alta</dt>
                <dd>{dateTime(u.createdAt)}</dd>
              </div>
              {u.blockedAt && (
                <div>
                  <dt className="label-caps">Bloqueo</dt>
                  <dd>
                    {dateTime(u.blockedAt)}
                    {u.blockedReason ? ` · ${u.blockedReason}` : ''}
                  </dd>
                </div>
              )}
            </dl>

            <fieldset className="stack" style={{ gap: 8, border: 0, padding: 0 }}>
              <legend className="label-caps">Bandas</legend>
              {u.memberships.length === 0 ? (
                <p className="small muted">Sin bandas activas.</p>
              ) : (
                <ul className="stack" style={{ gap: 6, margin: 0, padding: 0, listStyle: 'none' }}>
                  {u.memberships.map((m) => (
                    <li key={m.tenantId}>
                      <Link to={`/admin/tenants/${m.tenantId}`}>{m.tenantName}</Link>
                      <span className="small muted">
                        {' '}
                        · {m.roleName} · {m.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>

            <fieldset className="stack" style={{ gap: 8, border: 0, padding: 0 }}>
              <legend className="label-caps">Acciones</legend>
              <div className="form-row" style={{ flexWrap: 'wrap' }}>
                {u.blockedAt ? (
                  <Button loading={unblock.isPending} onClick={() => unblock.mutate(u.id)}>
                    Desbloquear
                  </Button>
                ) : !u.isPlatformAdmin ? (
                  <Button variant="danger" onClick={() => setBlocking(u)}>
                    Bloquear
                  </Button>
                ) : null}
                {!u.blockedAt && u.id !== session?.user.id && (
                  <Button loading={patchUser.isPending} onClick={() => patchUser.mutate({ id: u.id, isPlatformAdmin: false })}>
                    Quitar del equipo
                  </Button>
                )}
                <Button variant="ghost" loading={revoke.isPending} onClick={() => revoke.mutate(u.id)}>
                  Cerrar sesiones
                </Button>
                {u.memberships.length === 0 && u.id !== session?.user.id && (
                  <Button variant="danger" onClick={() => setRemoving(u)}>
                    Eliminar cuenta
                  </Button>
                )}
              </div>
              <FormError error={block.error ?? unblock.error ?? patchUser.error ?? revoke.error ?? remove.error} />
            </fieldset>
          </div>
        )}
      </Drawer>

      <ConfirmModal
        open={!!removing}
        title="Eliminar cuenta"
        message={`¿Eliminar la cuenta de ${removing?.name ?? ''} (${removing?.email ?? ''})? No pertenece a ninguna banda y no se puede deshacer.`}
        confirmLabel="Eliminar"
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
        onClose={() => setRemoving(null)}
      />

      <Drawer open={!!blocking} onClose={() => setBlocking(null)} title={`Bloquear a ${blocking?.name ?? ''}`}>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            if (blocking && v.reason) block.mutate({ id: blocking.id, reason: v.reason });
          }}
        >
          <TextAreaField label="Motivo" name="reason" required minLength={3} hint="Cierra todas sus sesiones y le impide volver a entrar." />
          <FormError error={block.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setBlocking(null)}>
              Cancelar
            </Button>
            <Button type="submit" variant="danger" loading={block.isPending}>
              Bloquear
            </Button>
          </div>
        </form>
      </Drawer>
    </div>
  );
}
