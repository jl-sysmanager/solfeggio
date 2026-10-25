import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { del, patch, post } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import type { AuditEntry, InstrumentCatalogItem, Paginated, PermissionDef, Role, Section, Session, Tenant } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { Person } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Chip, StatusChip } from '../components/Chip';
import { DataTable, Pagination } from '../components/DataTable';
import { ErrorNote, Loading } from '../components/EmptyState';
import { Checkbox, FormError, SelectField, TextField, formValues } from '../components/Field';
import { ConfirmModal, Modal } from '../components/Modal';
import { Page, PageHeader } from '../components/PageHeader';
import { Tabs, type TabDef } from '../components/Tabs';
import { LogoEditor } from '../components/LogoEditor';
import { REGIONS } from '../components/admin/support/shared';
import { dateTime } from '../lib/format';
import { tenantStatus } from '../lib/labels';

function roleSummary(perms: string[], catalog: PermissionDef[]) {
  const set = new Set(perms);
  const areas = new Set(catalog.filter((p) => set.has(p.key)).map((p) => p.group));
  return { areas: areas.size, count: perms.length };
}

function TenantTab() {
  const { reload, can, session, applyTokenSession, logout } = useAuth();
  const navigate = useNavigate();
  const q = useApi<Tenant & { region?: string | null }>('/tenant');
  const save = useApiMutation((body: unknown) => patch('/tenant', body), { success: 'Datos de la banda guardados', invalidate: ['/tenant'], onSuccess: () => reload() });
  const [deleting, setDeleting] = useState(false);
  const remove = useApiMutation(
    (body: { password: string; confirm: 'ELIMINAR' }) =>
      post<{ accessToken: string | null; session: Session | null; accountDeleted: boolean }>('/tenant/delete', body),
    {
      success: 'Banda eliminada',
      onSuccess: (res) => {
        if (res.accountDeleted || !res.accessToken || !res.session) {
          void logout().finally(() => navigate('/login', { replace: true }));
          return;
        }
        applyTokenSession({ accessToken: res.accessToken, session: res.session });
        navigate(res.session.memberships.length ? '/select-band' : '/onboarding', { replace: true });
      },
    },
  );
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorNote error={q.error} />;
  const t = q.data;
  const isOwner = session?.role?.key === 'owner';
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
    {isOwner && (
      <Card title="Eliminar banda">
        {!deleting ? (
          <div className="stack">
            <p className="small">
              Se eliminan los ficheros de la banda y las cuentas que sólo pertenecían a ella. Quien también está en otra
              banda conserva su cuenta, pero pierde el acceso a ésta. Se cancela la suscripción si la hay y el identificador{' '}
              <code>{t.slug}</code> queda libre. Esta acción no se puede deshacer.
            </p>
            <div>
              <Button variant="danger" onClick={() => setDeleting(true)}>
                Eliminar esta banda
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              const v = formValues(e.currentTarget);
              if (v.confirm !== 'ELIMINAR') return;
              remove.mutate({ password: v.password ?? '', confirm: 'ELIMINAR' });
            }}
          >
            <TextField label="Contraseña" name="password" type="password" autoComplete="current-password" required />
            <TextField label='Escribe ELIMINAR para confirmar' name="confirm" required autoComplete="off" hint="Mayúsculas, sin espacios." />
            <FormError error={remove.error} />
            <div className="row">
              <Button type="submit" variant="danger" loading={remove.isPending}>
                Confirmar eliminación
              </Button>
              <Button variant="ghost" type="button" onClick={() => setDeleting(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        )}
      </Card>
    )}
    </div>
  );
}

function RolesTab() {
  const { can } = useAuth();
  const perms = useApi<PermissionDef[]>('/permissions');
  const roles = useApi<Role[]>('/roles');
  const catalog = perms.data ?? [];
  const list = roles.data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<Role | null>(null);

  const selected = list.find((r) => r.id === selectedId) ?? list[0] ?? null;

  useEffect(() => {
    if (!list.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !list.some((r) => r.id === selectedId)) setSelectedId(list[0].id);
  }, [list, selectedId]);

  useEffect(() => {
    if (selected) setDraft([...selected.permissions]);
  }, [selected?.id, selected?.permissions]);

  const groups = useMemo(() => {
    const map = new Map<string, PermissionDef[]>();
    for (const p of catalog) map.set(p.group, [...(map.get(p.group) ?? []), p]);
    return Array.from(map.entries());
  }, [catalog]);

  const save = useApiMutation((body: { id: string; permissions: string[] }) => patch(`/roles/${body.id}`, { permissions: body.permissions }), {
    success: 'Permisos guardados',
    invalidate: ['/roles'],
  });
  const create = useApiMutation((body: unknown) => post<Role>('/roles', body), {
    success: 'Rol creado',
    invalidate: ['/roles'],
    onSuccess: (role) => {
      setCreating(false);
      setSelectedId(role.id);
    },
  });
  const remove = useApiMutation((id: string) => del(`/roles/${id}`), {
    success: 'Rol eliminado',
    invalidate: ['/roles'],
    onSuccess: () => setRemoving(null),
  });

  if (perms.isLoading || roles.isLoading) return <Loading />;
  if (roles.error) return <ErrorNote error={roles.error} />;

  const isOwner = selected?.key === 'owner';
  const dirty =
    !!selected &&
    !isOwner &&
    JSON.stringify([...draft].sort()) !== JSON.stringify([...selected.permissions].sort());
  const draftSet = new Set(draft);

  const toggle = (key: string) => {
    setDraft((d) => (d.includes(key) ? d.filter((k) => k !== key) : [...d, key]));
  };
  const setGroup = (items: PermissionDef[], on: boolean) => {
    const keys = items.map((p) => p.key);
    setDraft((d) => {
      const without = d.filter((k) => !keys.includes(k));
      if (!on) return without;
      const add = keys.filter((k) => can(k) || d.includes(k));
      return [...new Set([...without, ...add])];
    });
  };
  const discard = () => selected && setDraft([...selected.permissions]);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row between" style={{ alignItems: 'flex-start', gap: 12 }}>
        <p className="small muted" style={{ margin: 0, maxWidth: '42rem' }}>
          Los roles definen qué puede hacer cada persona en la banda. Elige un rol y marca las acciones permitidas por área.
        </p>
        <Button onClick={() => setCreating(true)}>Nuevo rol</Button>
      </div>

      <div className="roles-layout">
        <Card className="roles-layout__list" title="Roles">
          <ul className="roles-nav" role="listbox" aria-label="Roles de la banda">
            {list.map((r) => {
              const summary = roleSummary(r.key === 'owner' ? catalog.map((p) => p.key) : r.permissions, catalog);
              const active = selected?.id === r.id;
              const people = r.membershipCount ?? 0;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={['roles-nav__item', active ? 'is-active' : ''].filter(Boolean).join(' ')}
                    onClick={() => setSelectedId(r.id)}
                  >
                    <span className="roles-nav__name">{r.name}</span>
                    <span className="roles-nav__meta">
                      <Chip tone={r.isSystem ? 'info' : 'neutral'} plain>
                        {r.isSystem ? 'De sistema' : 'Personalizado'}
                      </Chip>
                      <span className="small muted">
                        {summary.areas} {summary.areas === 1 ? 'área' : 'áreas'}
                        {people > 0 ? ` · ${people} ${people === 1 ? 'persona' : 'personas'}` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card
          className="roles-layout__editor"
          title={selected ? selected.name : 'Permisos'}
          actions={
            selected && !selected.isSystem ? (
              <Button
                size="sm"
                variant="danger"
                disabled={(selected.membershipCount ?? 0) > 0}
                title={(selected.membershipCount ?? 0) > 0 ? 'Reasigna a las personas a otro rol antes de eliminarlo' : undefined}
                onClick={() => setRemoving(selected)}
              >
                Eliminar
              </Button>
            ) : undefined
          }
        >
          {!selected ? (
            <p className="small muted">Crea un rol para empezar.</p>
          ) : isOwner ? (
            <p className="small">
              El propietario tiene acceso total a la banda. Este rol no se puede modificar ni eliminar.
            </p>
          ) : (
            <div className="stack" style={{ gap: 16 }}>
              <p className="small muted" style={{ margin: 0 }}>
                {roleSummary(draft, catalog).count} permisos en {roleSummary(draft, catalog).areas} áreas
                {(selected.membershipCount ?? 0) > 0
                  ? ` · ${selected.membershipCount} ${(selected.membershipCount ?? 0) === 1 ? 'persona' : 'personas'} con este rol`
                  : ''}
              </p>
              {groups.map(([group, items]) => {
                const enabled = items.filter((p) => draftSet.has(p.key)).length;
                const allOn = enabled === items.length;
                const someOn = enabled > 0 && !allOn;
                return (
                  <section key={group} className="perm-area">
                    <header className="perm-area__head">
                      <div>
                        <h3 className="perm-area__title">{group}</h3>
                        <p className="small muted" style={{ margin: 0 }}>
                          {enabled} de {items.length}
                        </p>
                      </div>
                      <div className="row" style={{ gap: 8 }}>
                        <Button size="sm" variant="ghost" onClick={() => setGroup(items, true)} disabled={allOn}>
                          Marcar área
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setGroup(items, false)} disabled={!someOn && !allOn}>
                          Quitar área
                        </Button>
                      </div>
                    </header>
                    <ul className="perm-area__list">
                      {items.map((p) => {
                        const checked = draftSet.has(p.key);
                        const locked = !checked && !can(p.key);
                        return (
                          <li key={p.key}>
                            <Checkbox
                              label={p.label}
                              checked={checked}
                              disabled={locked}
                              title={locked ? 'No puedes conceder un permiso que tú no tienes' : undefined}
                              onChange={() => toggle(p.key)}
                            />
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
              {dirty && (
                <div className="roles-savebar">
                  <FormError error={save.error} />
                  <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                    <Button variant="ghost" onClick={discard} disabled={save.isPending}>
                      Descartar
                    </Button>
                    <Button loading={save.isPending} onClick={() => selected && save.mutate({ id: selected.id, permissions: draft })}>
                      Guardar cambios
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="Nuevo rol">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            const base = list.find((r) => r.id === v.baseRoleId);
            create.mutate({ name: v.name, permissions: base?.permissions ?? [] });
          }}
        >
          <TextField label="Nombre" name="name" required placeholder="Archivero" hint="Cómo lo veréis al asignar el rol a una persona." />
          <SelectField
            label="Empezar copiando de"
            name="baseRoleId"
            placeholder="Ninguno (sin permisos)"
            options={list.filter((r) => r.key !== 'owner').map((r) => ({ value: r.id, label: r.name }))}
            hint="Luego podrás ajustar las áreas en el panel."
          />
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
        message={`¿Eliminar el rol «${removing?.name}»? Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
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

function InstrumentsCatalogTab() {
  const q = useApi<InstrumentCatalogItem[]>('/instrument-catalog');
  const create = useApiMutation((body: unknown) => post('/instrument-catalog', body), {
    success: 'Instrumento añadido',
    invalidate: ['/instrument-catalog'],
  });
  const remove = useApiMutation((id: string) => del(`/instrument-catalog/${id}`), {
    success: 'Instrumento eliminado',
    invalidate: ['/instrument-catalog'],
  });
  return (
    <Card title="Instrumentos">
      <p className="small muted" style={{ marginBottom: 12 }}>
        Lista usada en fichas de socios, alumnos y demás formularios. Se puede dejar el campo en blanco.
      </p>
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const v = formValues(form);
          if (v.name) create.mutate({ name: v.name, position: (q.data?.length ?? 0) + 1 }, { onSuccess: () => form.reset() });
        }}
      >
        <TextField label="Nuevo instrumento" name="name" placeholder="Clarinete en Si♭" maxLength={60} />
        <Button type="submit" loading={create.isPending}>
          Añadir
        </Button>
      </form>
      {q.isLoading && <Loading />}
      <ul className="list-plain list-divided" style={{ marginTop: 16 }}>
        {(q.data ?? []).map((s) => (
          <li key={s.id} className="row between">
            <span>{s.name}</span>
            <Button size="sm" variant="danger" onClick={() => remove.mutate(s.id)} aria-label={`Eliminar instrumento ${s.name}`}>
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

export default function SettingsPage() {
  const { can } = useAuth();
  const tabs: TabDef[] = [];
  if (can('tenant:manage')) tabs.push({ id: 'tenant', label: 'Banda', content: <TenantTab /> });
  if (can('tenant:manage') || can('members:write')) {
    tabs.push({ id: 'sections', label: 'Secciones', content: <SectionsTab /> });
    tabs.push({ id: 'instruments', label: 'Instrumentos', content: <InstrumentsCatalogTab /> });
  }
  if (can('roles:manage')) tabs.push({ id: 'roles', label: 'Roles y permisos', content: <RolesTab /> });
  if (can('audit:read')) tabs.push({ id: 'audit', label: 'Auditoría', content: <AuditTab /> });
  return (
    <Page header={<PageHeader tone="cream" eyebrow="Ajustes" title="Configuración de la banda" />}>
      <Tabs label="Ajustes" tabs={tabs} />
    </Page>
  );
}
