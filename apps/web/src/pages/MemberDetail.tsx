import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { del, get, patch, post, put } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import type { Member, Role } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { Person } from '../components/Avatar';
import { ArrowLink, Button } from '../components/Button';
import { Card } from '../components/Card';
import { Chip, StatusChip } from '../components/Chip';
import { ErrorNote, Loading } from '../components/EmptyState';
import { FormError, SelectField, TextField, formValues } from '../components/Field';
import { Modal, ConfirmModal } from '../components/Modal';
import { Page, PageHeader } from '../components/PageHeader';
import { PhotoEditor } from '../components/PhotoEditor';
import { useToast } from '../components/Toasts';
import { date } from '../lib/format';
import { memberStatus } from '../lib/labels';
import { LeaveModal, MemberFormModal } from './Members';

const GARMENTS = ['Chaqueta', 'Pantalón / falda', 'Camisa', 'Gorra', 'Zapatos'];

function SizesModal({ member, open, onClose }: { member: Member; open: boolean; onClose: () => void }) {
  const save = useApiMutation((sizes: { garment: string; size: string }[]) => put(`/members/${member.id}/sizes`, sizes), {
    success: 'Tallas guardadas',
    invalidate: [`/members/${member.id}`],
    onSuccess: onClose,
  });
  const current = Object.fromEntries((member.sizes ?? []).map((s) => [s.garment, s.size]));
  const garments = Array.from(new Set([...GARMENTS, ...Object.keys(current)]));
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const sizes = garments.map((g) => ({ garment: g, size: String(fd.get(g) ?? '').trim() })).filter((s) => s.size);
    save.mutate(sizes);
  }
  return (
    <Modal open={open} onClose={onClose} title="Tallas">
      <form className="form" onSubmit={submit}>
        <div className="form-row">
          {garments.map((g) => (
            <div className="field" key={g}>
              <label htmlFor={`size-${g}`}>{g}</label>
              <input id={`size-${g}`} className="input" name={g} defaultValue={current[g] ?? ''} />
            </div>
          ))}
        </div>
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

function AccessCard({ member }: { member: Member }) {
  const { can, session } = useAuth();
  const roles = useApi<Pick<Role, 'id' | 'key' | 'name'>[]>(can('users:manage') ? '/roles/assignable' : null);
  const [inviting, setInviting] = useState(false);
  const invite = useApiMutation((body: unknown) => post('/invitations', body), {
    success: 'Invitación enviada',
    invalidate: ['/members', '/invitations', '/users'],
    onSuccess: () => setInviting(false),
  });
  const update = useApiMutation((body: unknown) => patch(`/users/${member.access?.kind === 'user' ? member.access.membershipId : ''}`, body), {
    success: 'Acceso actualizado',
    invalidate: ['/members', '/users'],
  });
  const remove = useApiMutation(() => del(`/users/${member.access?.kind === 'user' ? member.access.membershipId : ''}`), {
    success: 'Acceso retirado',
    invalidate: ['/members', '/users', '/dashboard'],
  });
  const roleOptions = (roles.data ?? []).filter((r) => r.key !== 'owner').map((r) => ({ value: r.id, label: r.name }));

  if (member.access?.kind === 'user') {
    const a = member.access;
    const self = a.user.id === session?.user.id;
    const isOwner = a.role.key === 'owner';
    return (
      <Card title="Acceso a la app">
        <dl className="kv">
          <dt>Cuenta</dt>
          <dd>
            <Person name={a.user.name} detail={a.user.email} />
          </dd>
          <dt>Rol</dt>
          <dd>
            {can('users:manage') && !self && !isOwner ? (
              <select
                className="select"
                aria-label="Rol"
                value={a.role.id}
                onChange={(e) => update.mutate({ roleId: e.target.value })}
              >
                {!roleOptions.some((o) => o.value === a.role.id) && <option value={a.role.id}>{a.role.name}</option>}
                {roleOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              a.role.name
            )}
          </dd>
          <dt>Estado</dt>
          <dd>
            <Chip tone={a.status === 'ACTIVE' ? 'success' : 'warning'}>{a.status === 'ACTIVE' ? 'Activo' : 'Suspendido'}</Chip>
          </dd>
        </dl>
        {can('users:manage') && !self && !isOwner && (
          <div className="card__footer">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => update.mutate({ status: a.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' })}
              loading={update.isPending}
            >
              {a.status === 'ACTIVE' ? 'Suspender' : 'Reactivar'}
            </Button>
            <Button size="sm" variant="danger" onClick={() => remove.mutate(undefined)} loading={remove.isPending}>
              Quitar acceso
            </Button>
          </div>
        )}
        <p className="small muted" style={{ marginTop: 12 }}>
          Cuenta como socio y como usuario del plan.
        </p>
      </Card>
    );
  }

  return (
    <Card
      title="Acceso a la app"
      actions={
        can('users:manage') && member.email && !member.pendingInvite ? (
          <Button size="sm" variant="ghost" onClick={() => setInviting(true)}>
            Invitar a la app
          </Button>
        ) : undefined
      }
    >
      {member.pendingInvite ? (
        <p>
          Invitación pendiente a <strong>{member.pendingInvite.email}</strong> (caduca el {date(member.pendingInvite.expiresAt)}).
        </p>
      ) : (
        <p className="muted">Sin acceso a la aplicación. Sólo cuenta como socio del plan.</p>
      )}
      {!member.email && can('users:manage') && <p className="small muted">Añade un email a la ficha para poder invitarle.</p>}
      <Modal open={inviting} onClose={() => setInviting(false)} title="Invitar a la app">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            invite.mutate({ email: v.email, roleId: v.roleId, memberId: member.id });
          }}
        >
          <TextField label="Email" name="email" type="email" required defaultValue={member.email ?? ''} />
          <SelectField label="Rol" name="roleId" required options={roleOptions} />
          <p className="small muted">Recibirá un enlace válido 7 días. Al aceptar, contará también como usuario del plan.</p>
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
    </Card>
  );
}

export default function MemberDetailPage() {
  const { id } = useParams();
  const { can, session } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const q = useApi<Member>(`/members/${id}`);
  const [editing, setEditing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [sizes, setSizes] = useState(false);
  const [anonymize, setAnonymize] = useState(false);

  const rejoin = useApiMutation(() => post(`/members/${id}/rejoin`), { success: 'Socio reactivado', invalidate: ['/members'] });
  const anon = useApiMutation(() => post(`/members/${id}/anonymize`), {
    success: 'Datos personales anonimizados',
    invalidate: ['/members'],
    onSuccess: () => navigate('/members'),
  });

  async function exportData() {
    try {
      const data = await get<unknown>(`/members/${id}/export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `socio-${id}-datos.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e);
    }
  }

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <div className="container page__body"><ErrorNote error={q.error} /></div>;
  const m = q.data;
  const write = can('members:write');
  const canPhoto = write || session?.memberId === m.id;

  return (
    <Page
      header={
        <PageHeader
          eyebrow={`Socio nº ${m.memberNumber}`}
          title={`${m.firstName} ${m.lastName}`}
          description={
            <>
              <StatusChip value={m.status} map={memberStatus} />{' '}
              {m.access?.kind === 'user' ? (
                <Chip tone="success">Usuario · {m.access.role.name}</Chip>
              ) : (
                <Chip>Solo socio</Chip>
              )}
            </>
          }
          actions={
            write && (
              <>
                <Button onClick={() => setEditing(true)}>Editar</Button>
                {m.status === 'LEFT' ? (
                  <Button variant="ghost" onClick={() => rejoin.mutate(undefined)} loading={rejoin.isPending}>
                    Reactivar
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={() => setLeaving(true)}>
                    Dar de baja
                  </Button>
                )}
              </>
            )
          }
        />
      }
    >
      <ArrowLink to="/members">Volver a socios</ArrowLink>
      <div className="grid grid--2">
        <Card title="Datos personales">
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 16 }}>
            <Person name={`${m.firstName} ${m.lastName}`} photoUrl={m.photoUrl} />
          </div>
          <dl className="kv">
            <dt>Email</dt>
            <dd>{m.email ?? '—'}</dd>
            <dt>Teléfono</dt>
            <dd>{m.phone ?? '—'}</dd>
            <dt>Nacimiento</dt>
            <dd>{date(m.birthDate)}</dd>
            <dt>Dirección</dt>
            <dd>{m.address ?? '—'}</dd>
            {can('members:sensitive') && (
              <>
                <dt>DNI / NIE</dt>
                <dd>{m.nationalId ?? '—'}</dd>
              </>
            )}
          </dl>
          {canPhoto && id && (
            <div style={{ marginTop: 16 }}>
              <PhotoEditor
                previewUrl={m.photoUrl ?? null}
                confirmPath={`/members/${id}/photo`}
                deletePath={`/members/${id}/photo`}
                onChanged={() => q.refetch()}
              />
            </div>
          )}
        </Card>
        <Card title="Banda" tone="cream">
          <dl className="kv">
            <dt>Instrumento</dt>
            <dd>{m.instrument ?? '—'}</dd>
            <dt>Sección</dt>
            <dd>{m.section?.name ?? '—'}</dd>
            <dt>Alta</dt>
            <dd>{date(m.joinedAt)}</dd>
            {m.leftAt && (
              <>
                <dt>Baja</dt>
                <dd>
                  {date(m.leftAt)}
                  {m.leaveReason ? ` · ${m.leaveReason}` : ''}
                </dd>
              </>
            )}
            <dt>Notas</dt>
            <dd>{m.notes ?? '—'}</dd>
          </dl>
        </Card>
        <AccessCard member={m} />
        <Card title="Tallas" actions={write && <Button size="sm" variant="ghost" onClick={() => setSizes(true)}>Editar tallas</Button>}>
          {m.sizes && m.sizes.length > 0 ? (
            <dl className="kv">
              {m.sizes.map((s) => (
                <div key={s.garment} style={{ display: 'contents' }}>
                  <dt>{s.garment}</dt>
                  <dd>{s.size}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="muted">Sin tallas registradas.</p>
          )}
        </Card>
        <Card title="Protección de datos (RGPD)">
          <dl className="kv">
            <dt>Tratamiento</dt>
            <dd>{m.consentDataAt ? `Consentido el ${date(m.consentDataAt)}` : 'Sin consentimiento registrado'}</dd>
            <dt>Imagen</dt>
            <dd>{m.consentImages ? 'Autorizada' : 'No autorizada'}</dd>
          </dl>
          {write && (
            <div className="card__footer">
              <Button variant="ghost" size="sm" onClick={exportData}>
                Exportar datos (acceso / portabilidad)
              </Button>
              <Button variant="danger" size="sm" onClick={() => setAnonymize(true)}>
                Anonimizar (supresión)
              </Button>
            </div>
          )}
        </Card>
      </div>

      <MemberFormModal open={editing} member={m} onClose={() => setEditing(false)} />
      <LeaveModal member={leaving ? m : null} onClose={() => setLeaving(false)} />
      <SizesModal member={m} open={sizes} onClose={() => setSizes(false)} />
      <ConfirmModal
        open={anonymize}
        title="Anonimizar socio"
        message="Se eliminarán de forma irreversible nombre, contacto, DNI y dirección. Se conservarán los registros estadísticos y contables sin datos identificativos. Esta acción no se puede deshacer."
        confirmLabel="Anonimizar definitivamente"
        loading={anon.isPending}
        onConfirm={() => anon.mutate(undefined)}
        onClose={() => setAnonymize(false)}
      />
    </Page>
  );
}
