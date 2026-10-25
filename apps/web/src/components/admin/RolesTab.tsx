import { useEffect, useMemo, useState } from 'react';
import { del, patch, post } from '../../api/client';
import { useApi, useApiMutation } from '../../api/hooks';
import type { PermissionDef } from '../../api/types';
import { Button } from '../Button';
import { Card } from '../Card';
import { Chip } from '../Chip';
import { ErrorNote, Loading } from '../EmptyState';
import { Checkbox, FormError, SelectField, TextField, formValues } from '../Field';
import { ConfirmModal, Modal } from '../Modal';

interface PlatformRole {
  key: string;
  name: string;
  permissions: string[];
  isSystem: boolean;
  membershipCount: number;
  diverged: boolean;
}

function roleSummary(perms: string[], catalog: PermissionDef[]) {
  const set = new Set(perms);
  const areas = new Set(catalog.filter((p) => set.has(p.key)).map((p) => p.group));
  return { areas: areas.size, count: perms.length };
}

/** Catálogo de roles de toda la plataforma. Un cambio se aplica en todas las bandas. */
export function RolesTab() {
  const perms = useApi<PermissionDef[]>('/permissions');
  const roles = useApi<PlatformRole[]>('/admin/roles');
  const catalog = perms.data ?? [];
  const list = roles.data ?? [];
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<PlatformRole | null>(null);

  const selected = list.find((r) => r.key === selectedKey) ?? list[0] ?? null;

  useEffect(() => {
    if (!list.length) {
      setSelectedKey(null);
      return;
    }
    if (!selectedKey || !list.some((r) => r.key === selectedKey)) setSelectedKey(list[0].key);
  }, [list, selectedKey]);

  useEffect(() => {
    if (selected) setDraft(selected.key === 'owner' ? catalog.map((p) => p.key) : [...selected.permissions]);
  }, [selected?.key, selected?.permissions, catalog]);

  const groups = useMemo(() => {
    const map = new Map<string, PermissionDef[]>();
    for (const p of catalog) map.set(p.group, [...(map.get(p.group) ?? []), p]);
    return Array.from(map.entries());
  }, [catalog]);

  const inv = { invalidate: ['/admin/roles'] };
  const save = useApiMutation((body: { key: string; permissions: string[] }) => patch(`/admin/roles/${body.key}`, { permissions: body.permissions }), {
    success: 'Permisos aplicados en todas las bandas',
    ...inv,
  });
  const create = useApiMutation((body: unknown) => post<PlatformRole>('/admin/roles', body), {
    success: 'Rol creado en todas las bandas',
    ...inv,
    onSuccess: (role) => {
      setCreating(false);
      setSelectedKey(role.key);
    },
  });
  const remove = useApiMutation((key: string) => del(`/admin/roles/${key}`), {
    success: 'Rol eliminado',
    ...inv,
    onSuccess: () => setRemoving(null),
  });

  if (perms.isLoading || roles.isLoading) return <Loading />;
  if (roles.error) return <ErrorNote error={roles.error} />;

  const isOwner = selected?.key === 'owner';
  const dirty = !!selected && !isOwner && JSON.stringify([...draft].sort()) !== JSON.stringify([...selected.permissions].sort());
  const draftSet = new Set(draft);
  const toggle = (key: string) => setDraft((d) => (d.includes(key) ? d.filter((k) => k !== key) : [...d, key]));
  const setGroup = (items: PermissionDef[], on: boolean) => {
    const keys = items.map((p) => p.key);
    setDraft((d) => (on ? [...new Set([...d, ...keys])] : d.filter((k) => !keys.includes(k))));
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row between" style={{ alignItems: 'flex-start', gap: 12 }}>
        <p className="small muted" style={{ margin: 0, maxWidth: '42rem' }}>
          Estos roles valen para todas las bandas. Cada banda asigna el cargo a sus personas, pero no puede cambiar los permisos.
        </p>
        <Button onClick={() => setCreating(true)}>Nuevo rol</Button>
      </div>
      <div className="roles-layout">
        <Card className="roles-layout__list" title="Roles">
          <ul className="roles-nav" role="listbox" aria-label="Roles de la plataforma">
            {list.map((r) => {
              const summary = roleSummary(r.key === 'owner' ? catalog.map((p) => p.key) : r.permissions, catalog);
              const active = selected?.key === r.key;
              return (
                <li key={r.key}>
                  <button type="button" role="option" aria-selected={active} className={['roles-nav__item', active ? 'is-active' : ''].filter(Boolean).join(' ')} onClick={() => setSelectedKey(r.key)}>
                    <span className="roles-nav__name">{r.name}</span>
                    <span className="roles-nav__meta">
                      <Chip tone={r.isSystem ? 'info' : 'neutral'} plain>{r.isSystem ? 'De sistema' : 'Personalizado'}</Chip>
                      <span className="small muted">
                        {summary.areas} {summary.areas === 1 ? 'área' : 'áreas'}
                        {r.membershipCount > 0 ? ` · ${r.membershipCount} ${r.membershipCount === 1 ? 'persona' : 'personas'}` : ''}
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
              <Button size="sm" variant="danger" disabled={selected.membershipCount > 0} title={selected.membershipCount > 0 ? 'Reasigna a las personas antes de eliminarlo' : undefined} onClick={() => setRemoving(selected)}>
                Eliminar
              </Button>
            ) : undefined
          }
        >
          {!selected ? (
            <p className="small muted">Crea un rol para empezar.</p>
          ) : isOwner ? (
            <p className="small">El propietario tiene acceso total en su banda. Este rol no se puede modificar ni eliminar.</p>
          ) : (
            <div className="stack" style={{ gap: 16 }}>
              {selected.diverged && <p className="small">Hay bandas con una copia distinta. Al guardar, todas quedan igual.</p>}
              <p className="small muted" style={{ margin: 0 }}>
                {roleSummary(draft, catalog).count} permisos en {roleSummary(draft, catalog).areas} áreas
              </p>
              {groups.map(([group, items]) => {
                const enabled = items.filter((p) => draftSet.has(p.key)).length;
                const allOn = enabled === items.length;
                return (
                  <section key={group} className="perm-area">
                    <header className="perm-area__head">
                      <div>
                        <h3 className="perm-area__title">{group}</h3>
                        <p className="small muted" style={{ margin: 0 }}>{enabled} de {items.length}</p>
                      </div>
                      <div className="row" style={{ gap: 8 }}>
                        <Button size="sm" variant="ghost" onClick={() => setGroup(items, true)} disabled={allOn}>Marcar área</Button>
                        <Button size="sm" variant="ghost" onClick={() => setGroup(items, false)} disabled={enabled === 0}>Quitar área</Button>
                      </div>
                    </header>
                    <ul className="perm-area__list">
                      {items.map((p) => (
                        <li key={p.key}>
                          <Checkbox label={p.label} checked={draftSet.has(p.key)} onChange={() => toggle(p.key)} />
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
              {dirty && (
                <div className="roles-savebar">
                  <FormError error={save.error} />
                  <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                    <Button variant="ghost" onClick={() => selected && setDraft([...selected.permissions])} disabled={save.isPending}>Descartar</Button>
                    <Button loading={save.isPending} onClick={() => selected && save.mutate({ key: selected.key, permissions: draft })}>Guardar en todas las bandas</Button>
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
            const base = list.find((r) => r.key === v.baseRoleKey);
            create.mutate({ name: v.name, permissions: base?.permissions ?? [] });
          }}
        >
          <TextField label="Nombre" name="name" required placeholder="Archivero de refuerzo" hint="Se crea en todas las bandas con el mismo nombre y permisos." />
          <SelectField label="Empezar copiando de" name="baseRoleKey" placeholder="Ninguno (sin permisos)" options={list.filter((r) => r.key !== 'owner').map((r) => ({ value: r.key, label: r.name }))} />
          <FormError error={create.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setCreating(false)}>Cancelar</Button>
            <Button type="submit" loading={create.isPending}>Crear</Button>
          </div>
        </form>
      </Modal>
      <ConfirmModal
        open={!!removing}
        title="Eliminar rol"
        message={`¿Eliminar «${removing?.name}» de todas las bandas? No se puede deshacer.`}
        confirmLabel="Eliminar"
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.key)}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}
