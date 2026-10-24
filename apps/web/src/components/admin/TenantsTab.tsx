import { useState } from 'react';
import { Link } from 'react-router-dom';
import { patch } from '../../api/client';
import { useApi, useApiMutation } from '../../api/hooks';
import type { AdminTenant, Paginated, PlanCode } from '../../api/types';
import { Person } from '../Avatar';
import { Button, IconButton } from '../Button';
import { Card } from '../Card';
import { StatusChip } from '../Chip';
import { DataTable, Pagination } from '../DataTable';
import { ErrorNote, Loading } from '../EmptyState';
import { Checkbox, FormError, SelectField, TextField, formValues } from '../Field';
import { Drawer } from '../Modal';
import { bytes, date } from '../../lib/format';
import { featureLabels, tenantStatus } from '../../lib/labels';

type TenantDetail = AdminTenant & {
  addons: string[];
  activeStudents: number;
  maxUsersOverride: number | null;
  maxMembersOverride: number | null;
  storageMbOverride: number | null;
  plan?: AdminTenant['plan'] & { features?: string[]; maxUsers?: number; maxMembers?: number; storageMb?: number };
};

/** Vacío → null (usar plan); número → override. */
function parseOverride(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function TenantExtras({ detail }: { detail: TenantDetail }) {
  const inPlan = new Set(detail.plan?.features ?? []);
  const fmtCap = (n: number | undefined, unit = '') => (n == null ? '—' : n < 0 ? '∞' : `${n}${unit}`);
  return (
    <div className="stack" style={{ gap: 16 }}>
      <fieldset className="stack" style={{ gap: 8, border: 0, padding: 0 }}>
        <legend className="label-caps">Funcionalidades</legend>
        <p className="small muted">
          Las marcadas se suman al plan (add-ons). Las del plan aparecen como incluidas. Familias y profesores con acceso cuentan como usuarios.
        </p>
        <div className="form-row">
          {Object.entries(featureLabels).map(([key, label]) => (
            <Checkbox
              key={key}
              name="addons"
              value={key}
              defaultChecked={detail.addons.includes(key)}
              label={`${label}${inPlan.has(key) ? ' (incluido en el plan)' : ''}`}
            />
          ))}
        </div>
        <p className="small">
          Alumnos activos: <strong>{detail.activeStudents}</strong>
        </p>
      </fieldset>

      <fieldset className="stack" style={{ gap: 8, border: 0, padding: 0 }}>
        <legend className="label-caps">Cupos personalizados</legend>
        <p className="small muted">
          Vacío = límite del plan. Usuarios/socios: −1 = ilimitado. Almacenamiento en MB.
        </p>
        <div className="form-row">
          <TextField
            className="field--short"
            label={`Usuarios (plan: ${fmtCap(detail.plan?.maxUsers)})`}
            name="maxUsersOverride"
            type="number"
            defaultValue={detail.maxUsersOverride ?? ''}
            placeholder="Usar plan"
          />
          <TextField
            className="field--short"
            label={`Socios (plan: ${fmtCap(detail.plan?.maxMembers)})`}
            name="maxMembersOverride"
            type="number"
            defaultValue={detail.maxMembersOverride ?? ''}
            placeholder="Usar plan"
          />
          <TextField
            className="field--short"
            label={`Almacenamiento (plan: ${fmtCap(detail.plan?.storageMb, ' MB')})`}
            name="storageMbOverride"
            type="number"
            min={1}
            defaultValue={detail.storageMbOverride ?? ''}
            placeholder="Usar plan"
          />
        </div>
      </fieldset>
    </div>
  );
}

export function TenantsTab() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<AdminTenant | null>(null);
  const list = useApi<Paginated<AdminTenant>>('/admin/tenants', { q, status, page, pageSize: 25 });
  const detail = useApi<TenantDetail>(editing ? `/admin/tenants/${editing.id}` : null);
  const update = useApiMutation((v: { id: string; body: unknown }) => patch(`/admin/tenants/${v.id}`, v.body), {
    success: 'Banda actualizada',
    invalidate: ['/admin'],
    onSuccess: () => setEditing(null),
  });
  return (
    <div className="stack" style={{ gap: 24 }}>
      <Card>
        <div className="toolbar">
          <TextField label="Buscar" type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Nombre o identificador" />
          <SelectField
            label="Estado"
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            placeholder="Todos"
            options={Object.entries(tenantStatus).map(([value, { label }]) => ({ value, label }))}
          />
        </div>
      </Card>
      {list.isLoading && <Loading />}
      {list.error && <ErrorNote error={list.error} />}
      {list.data && (
        <Card>
          <DataTable
            caption="Bandas registradas"
            rows={list.data.data}
            rowKey={(t) => t.id}
            onRowClick={setEditing}
            columns={[
              { key: 'n', header: 'Banda', render: (t) => <Link to={`/admin/tenants/${t.id}`} aria-label={`Ficha de ${t.name}`}><Person name={t.name} detail={t.slug} /></Link> },
              { key: 'p', header: 'Plan', render: (t) => t.plan?.name ?? '—' },
              { key: 's', header: 'Estado', render: (t) => <StatusChip value={t.status} map={tenantStatus} /> },
              { key: 'u', header: 'Usuarios', render: (t) => t._count?.memberships ?? '—', numeric: true },
              { key: 'st', header: 'Almacenamiento', render: (t) => bytes(t.storageUsedBytes), numeric: true, nowrap: true },
              { key: 'c', header: 'Alta', render: (t) => date(t.createdAt), nowrap: true },
              {
                key: 'a',
                header: 'Acciones',
                render: (t) => (
                  <IconButton icon="settings" label={`Gestionar ${t.name}`} onClick={() => setEditing(t)} />
                ),
              },
            ]}
          />
          <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
        </Card>
      )}
      <Drawer open={!!editing} onClose={() => setEditing(null)} title={`Gestionar ${editing?.name ?? ''}`}>
        <form
          className="form"
          key={editing?.id}
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const v = formValues(form);
            const extras = detail.data
              ? {
                  addons: Array.from(form.querySelectorAll<HTMLInputElement>('input[name="addons"]:checked')).map((i) => i.value),
                  maxUsersOverride: parseOverride(String(v.maxUsersOverride ?? '')),
                  maxMembersOverride: parseOverride(String(v.maxMembersOverride ?? '')),
                  storageMbOverride: parseOverride(String(v.storageMbOverride ?? '')),
                }
              : {};
            if (editing) update.mutate({ id: editing.id, body: { status: v.status, planCode: v.planCode as PlanCode, ...extras } });
          }}
        >
          <SelectField className="field--medium" label="Estado" name="status" defaultValue={editing?.status} options={Object.entries(tenantStatus).map(([value, { label }]) => ({ value, label }))} />
          <SelectField
            className="field--medium"
            label="Plan (asignación manual, sin Stripe)"
            name="planCode"
            defaultValue={editing?.plan?.code}
            options={['FREE', 'BASIC', 'PRO', 'ENTERPRISE'].map((c) => ({ value: c, label: c }))}
          />
          {detail.isLoading && <Loading rows={2} />}
          {detail.data && <TenantExtras key={detail.dataUpdatedAt} detail={detail.data} />}
          <p className="small muted">Suspender bloquea el acceso de todos los usuarios de la banda. Queda registrado en auditoría.</p>
          <FormError error={update.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button type="submit" loading={update.isPending}>
              Guardar
            </Button>
          </div>
        </form>
      </Drawer>
    </div>
  );
}
