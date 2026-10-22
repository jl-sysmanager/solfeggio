import { useState } from 'react';
import { Link } from 'react-router-dom';
import { patch } from '../../api/client';
import { useApi, useApiMutation } from '../../api/hooks';
import type { AdminTenant, Paginated, PlanCode } from '../../api/types';
import { Person } from '../Avatar';
import { Button } from '../Button';
import { Card } from '../Card';
import { StatusChip } from '../Chip';
import { DataTable, Pagination } from '../DataTable';
import { ErrorNote, Loading } from '../EmptyState';
import { Checkbox, FormError, SelectField, TextField, formValues } from '../Field';
import { Modal } from '../Modal';
import { bytes, date } from '../../lib/format';
import { tenantStatus } from '../../lib/labels';

/** Funcionalidades extra (fuera del plan) que soporte puede activar a mano. La escuela va en el plan. */
const EXTRA_FEATURES: [string, string][] = [
  ['performances', 'Contrataciones'], ['reinforcements', 'Bolsa de refuerzos'], ['governance', 'Gobierno'],
  ['treasury', 'Tesorería'], ['wardrobe', 'Mayordomía'], ['instruments', 'Instrumentación'], ['communications', 'Comunicaciones'],
  ['market', 'BandMarket'], ['calendar_sync', 'Calendario externo'], ['archive_ai', 'Particellas automáticas'],
];

type TenantDetail = AdminTenant & { addons: string[]; activeStudents: number; plan?: AdminTenant['plan'] & { features?: string[] } };

function TenantExtras({ detail }: { detail: TenantDetail }) {
  const inPlan = new Set(detail.plan?.features ?? []);
  return (
    <fieldset className="stack" style={{ gap: 8, border: 0, padding: 0 }}>
      <legend className="label-caps">Funcionalidades extra</legend>
      <p className="small muted">La escuela se habilita en el plan (Admin → Planes). Familias y profesores con acceso cuentan como usuarios del plan.</p>
      <div className="form-row">
        {EXTRA_FEATURES.map(([key, label]) => (
          <Checkbox key={key} name="addons" value={key} defaultChecked={detail.addons.includes(key)} label={`${label}${inPlan.has(key) ? ' (incluido en el plan)' : ''}`} />
        ))}
      </div>
      <p className="small">
        Alumnos activos: <strong>{detail.activeStudents}</strong>
      </p>
    </fieldset>
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
                  <Button size="sm" variant="ghost" onClick={() => setEditing(t)} aria-label={`Gestionar ${t.name}`}>
                    Gestionar
                  </Button>
                ),
              },
            ]}
          />
          <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
        </Card>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Gestionar ${editing?.name ?? ''}`}>
        <form
          className="form"
          key={editing?.id}
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const v = formValues(form);
            const extras = detail.data
              ? { addons: Array.from(form.querySelectorAll<HTMLInputElement>('input[name="addons"]:checked')).map((i) => i.value) }
              : {};
            if (editing) update.mutate({ id: editing.id, body: { status: v.status, planCode: v.planCode as PlanCode, ...extras } });
          }}
        >
          <SelectField label="Estado" name="status" defaultValue={editing?.status} options={Object.entries(tenantStatus).map(([value, { label }]) => ({ value, label }))} />
          <SelectField
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
      </Modal>
    </div>
  );
}
