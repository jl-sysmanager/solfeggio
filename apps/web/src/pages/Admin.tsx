import { useState } from 'react';
import { patch, post } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import type { AdminMetrics, AdminTenant, Incident, Listing, Paginated, Plan, PlanCode } from '../api/types';
import { Person } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card, StatCard } from '../components/Card';
import { Chip, StatusChip } from '../components/Chip';
import { DataTable, Pagination } from '../components/DataTable';
import { EmptyState, ErrorNote, Loading } from '../components/EmptyState';
import { Checkbox, FormError, SelectField, TextAreaField, TextField, formValues } from '../components/Field';
import { Modal } from '../components/Modal';
import { Page, PageHeader } from '../components/PageHeader';
import { Tabs } from '../components/Tabs';
import { bytes, date, dateTime, money, parseMoney } from '../lib/format';
import { condition, incidentStatus, tenantStatus } from '../lib/labels';
import { IntegrationsTab } from './AdminIntegrations';
import { PRIORITIES } from './Incidents';

const rows = <T,>(d: T[] | Paginated<T> | undefined) => (Array.isArray(d) ? d : d?.data ?? []);

function MetricsTab() {
  const q = useApi<AdminMetrics>('/admin/metrics');
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorNote error={q.error} />;
  const m = q.data;
  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="grid grid--stats">
        <StatCard label="Bandas" value={m.tenants.total} tone="cool" />
        <StatCard label="MRR" value={money(m.mrrCents)} tone="cream" />
        <StatCard label="Incidencias abiertas" value={m.openIncidents} tone={m.openIncidents > 0 ? 'warm' : 'paper'} />
        <StatCard label="Anuncios por moderar" value={m.pendingListings} />
      </div>
      <Card title="Bandas por estado">
        <ul className="list-plain list-divided">
          {Object.entries(m.tenants.byStatus).map(([s, n]) => (
            <li key={s} className="row between">
              <StatusChip value={s} map={tenantStatus} />
              <strong>{n}</strong>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/** Funcionalidades contratables aparte del plan (add-ons). */
const ADDON_FEATURES: [string, string][] = [
  ['school', 'Escuela de música'], ['performances', 'Actuaciones'], ['reinforcements', 'Bolsa de refuerzos'], ['governance', 'Gobierno'],
  ['treasury', 'Tesorería'], ['wardrobe', 'Uniformes'], ['instruments', 'Instrumentos'], ['communications', 'Comunicaciones'],
  ['market', 'BandMarket'], ['calendar_sync', 'Sincronización de calendario'], ['advanced_reports', 'Informes avanzados'], ['archive_ai', 'Archivo con IA'],
  ['sso', 'SSO'], ['priority_support', 'Soporte prioritario'], ['api_access', 'Acceso API'],
];

type TenantDetail = AdminTenant & { addons: string[]; studentSeats: number; activeStudents: number; plan?: AdminTenant['plan'] & { features?: string[]; maxStudents?: number } };

/** Add-ons y plazas de alumno de la banda (ficha de detalle). */
function TenantAddons({ detail }: { detail: TenantDetail }) {
  const inPlan = new Set(detail.plan?.features ?? []);
  const maxStudents = detail.plan?.maxStudents ?? 0;
  return (
    <fieldset className="stack" style={{ gap: 8, border: 0, padding: 0 }}>
      <legend className="label-caps">Add-ons contratados</legend>
      <div className="form-row">
        {ADDON_FEATURES.map(([key, label]) => (
          <Checkbox key={key} name="addons" value={key} defaultChecked={detail.addons.includes(key)} label={`${label}${inPlan.has(key) ? ' (incluido en el plan)' : ''}`} />
        ))}
      </div>
      <div className="form-row">
        <TextField label="Plazas de alumno adicionales" name="studentSeats" type="number" min={0} defaultValue={detail.studentSeats} hint={`El plan incluye ${maxStudents < 0 ? 'alumnos ilimitados' : `${maxStudents} alumnos`}.`} />
        <p className="small">
          Alumnos activos: <strong>{detail.activeStudents}</strong>
          {maxStudents >= 0 && ` de ${maxStudents + detail.studentSeats}`}
        </p>
      </div>
    </fieldset>
  );
}

function TenantsTab() {
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
              { key: 'n', header: 'Banda', render: (t) => <Person name={t.name} detail={t.slug} /> },
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
              ? { addons: Array.from(form.querySelectorAll<HTMLInputElement>('input[name="addons"]:checked')).map((i) => i.value), studentSeats: Number(v.studentSeats ?? 0) }
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
          {detail.data && <TenantAddons key={detail.dataUpdatedAt} detail={detail.data} />}
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

function IncidentsTab() {
  const [status, setStatus] = useState('OPEN');
  const q = useApi<Incident[] | Paginated<Incident>>('/admin/incidents', { status });
  const [editing, setEditing] = useState<Incident | null>(null);
  const update = useApiMutation((v: { id: string; body: unknown }) => patch(`/admin/incidents/${v.id}`, v.body), {
    success: 'Incidencia actualizada',
    invalidate: ['/admin'],
    onSuccess: () => setEditing(null),
  });
  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="segmented" role="group" aria-label="Filtrar incidencias" style={{ alignSelf: 'flex-start' }}>
        {Object.entries(incidentStatus).map(([k, { label }]) => (
          <button key={k} aria-pressed={status === k} onClick={() => setStatus(k)}>
            {label}
          </button>
        ))}
      </div>
      {q.isLoading && <Loading />}
      {q.error && <ErrorNote error={q.error} />}
      {q.data && (
        <Card>
          <DataTable
            caption="Incidencias de todas las bandas"
            rows={rows(q.data)}
            rowKey={(i) => i.id}
            empty="Sin incidencias en este estado."
            columns={[
              {
                key: 't',
                header: 'Banda',
                render: (i) => (i.tenant ? <Person name={i.tenant.name} detail={i.tenant.slug} /> : <span className="mono">{i.tenantId?.slice(0, 8) ?? '—'}</span>),
              },
              { key: 's', header: 'Asunto', render: (i) => i.subject },
              { key: 'p', header: 'Prioridad', render: (i) => <Chip tone={i.priority <= 2 ? 'danger' : 'neutral'}>{PRIORITIES.find((p) => p.value === String(i.priority))?.label ?? i.priority}</Chip> },
              { key: 'd', header: 'Abierta', render: (i) => dateTime(i.createdAt), nowrap: true },
              {
                key: 'a',
                header: 'Acciones',
                render: (i) => (
                  <Button size="sm" variant="ghost" onClick={() => setEditing(i)} aria-label={`Atender incidencia: ${i.subject}`}>
                    Atender
                  </Button>
                ),
              },
            ]}
          />
        </Card>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.subject ?? ''}>
        <form
          className="form"
          key={editing?.id}
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            if (editing) update.mutate({ id: editing.id, body: { status: v.status, resolution: v.resolution } });
          }}
        >
          <Card tone="cream">
            <p style={{ whiteSpace: 'pre-wrap' }}>{editing?.body}</p>
          </Card>
          <SelectField label="Estado" name="status" defaultValue={editing?.status} options={Object.entries(incidentStatus).map(([value, { label }]) => ({ value, label }))} />
          <TextAreaField label="Resolución" name="resolution" defaultValue={editing?.resolution ?? ''} />
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

function ModerationTab() {
  const q = useApi<Listing[] | Paginated<Listing>>('/admin/market/pending');
  const [rejecting, setRejecting] = useState<Listing | null>(null);
  const moderate = useApiMutation((v: { id: string; approve: boolean; note?: string }) => post(`/admin/market/listings/${v.id}/moderate`, { approve: v.approve, note: v.note }), {
    success: 'Anuncio moderado',
    invalidate: ['/admin'],
    onSuccess: () => setRejecting(null),
  });
  const list = rows(q.data);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  if (list.length === 0) return <EmptyState title="Nada pendiente">No hay anuncios esperando revisión.</EmptyState>;
  return (
    <>
      <ul className="grid grid--2 list-plain">
        {list.map((l) => (
          <li key={l.id} className="card stack">
            <div className="row between">
              <h3 className="card__title">{l.title}</h3>
              <strong>{money(l.priceCents, l.currency)}</strong>
            </div>
            <p className="small muted">
              {l.seller?.name ?? 'Banda'} · {l.category} · {condition[l.condition]} · {date(l.createdAt)}
            </p>
            {l.imageUrls?.[0] && <img className="thumb" src={l.imageUrls[0]} alt={`Foto de ${l.title}`} loading="lazy" />}
            <p className="small" style={{ whiteSpace: 'pre-wrap' }}>
              {l.description}
            </p>
            <div className="row">
              <Button size="sm" onClick={() => moderate.mutate({ id: l.id, approve: true })} disabled={moderate.isPending}>
                Publicar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRejecting(l)}>
                Rechazar
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <Modal open={!!rejecting} onClose={() => setRejecting(null)} title="Rechazar anuncio">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            if (rejecting) moderate.mutate({ id: rejecting.id, approve: false, note: v.note });
          }}
        >
          <TextAreaField label="Motivo (lo verá la banda)" name="note" required />
          <FormError error={moderate.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setRejecting(null)}>
              Cancelar
            </Button>
            <Button type="submit" loading={moderate.isPending}>
              Rechazar
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function PlansTab() {
  const q = useApi<Plan[]>('/admin/plans');
  const [editing, setEditing] = useState<Plan | null>(null);
  const save = useApiMutation((v: { id: string; body: unknown }) => patch(`/admin/plans/${v.id}`, v.body), {
    success: 'Plan actualizado',
    invalidate: ['/admin/plans', '/plans'],
    onSuccess: () => setEditing(null),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  return (
    <>
      <Card>
        <DataTable
          caption="Planes"
          rows={q.data ?? []}
          rowKey={(p) => p.id}
          columns={[
            { key: 'n', header: 'Plan', render: (p) => p.name },
            { key: 'm', header: 'Mensual', render: (p) => money(p.priceMonthlyCents), numeric: true, nowrap: true },
            { key: 'y', header: 'Anual', render: (p) => money(p.priceYearlyCents), numeric: true, nowrap: true },
            { key: 'u', header: 'Usuarios', render: (p) => (p.maxUsers < 0 ? '∞' : p.maxUsers), numeric: true },
            { key: 'mb', header: 'Socios', render: (p) => (p.maxMembers < 0 ? '∞' : p.maxMembers), numeric: true },
            { key: 's', header: 'Almacenamiento', render: (p) => `${p.storageMb} MB`, numeric: true, nowrap: true },
            { key: 't', header: 'Prueba', render: (p) => `${p.trialDays} d`, numeric: true, nowrap: true },
            {
              key: 'a',
              header: 'Acciones',
              render: (p) => (
                <Button size="sm" variant="ghost" onClick={() => setEditing(p)} aria-label={`Editar plan ${p.name}`}>
                  Editar
                </Button>
              ),
            },
          ]}
        />
      </Card>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Editar plan ${editing?.name ?? ''}`}>
        <form
          className="form"
          key={editing?.id}
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            if (editing)
              save.mutate({
                id: editing.id,
                body: {
                  priceMonthlyCents: parseMoney(v.monthly ?? '0'),
                  priceYearlyCents: parseMoney(v.yearly ?? '0'),
                  maxUsers: Number(v.maxUsers),
                  maxMembers: Number(v.maxMembers),
                  storageMb: Number(v.storageMb),
                  trialDays: Number(v.trialDays),
                },
              });
          }}
        >
          <p className="small muted">Los precios cobrados los define Stripe (Price IDs). Cambiar aquí el importe sólo actualiza el catálogo mostrado; crea un nuevo Price en Stripe y enlázalo.</p>
          <div className="form-row">
            <TextField label="Precio mensual (€)" name="monthly" defaultValue={editing ? String(editing.priceMonthlyCents / 100).replace('.', ',') : ''} />
            <TextField label="Precio anual (€)" name="yearly" defaultValue={editing ? String(editing.priceYearlyCents / 100).replace('.', ',') : ''} />
          </div>
          <div className="form-row">
            <TextField label="Máx. usuarios (−1 = ∞)" name="maxUsers" type="number" defaultValue={editing?.maxUsers} />
            <TextField label="Máx. socios (−1 = ∞)" name="maxMembers" type="number" defaultValue={editing?.maxMembers} />
          </div>
          <div className="form-row">
            <TextField label="Almacenamiento (MB)" name="storageMb" type="number" defaultValue={editing?.storageMb} />
            <TextField label="Días de prueba" name="trialDays" type="number" min={0} defaultValue={editing?.trialDays} />
          </div>
          <FormError error={save.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button type="submit" loading={save.isPending}>
              Guardar
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export default function AdminPage() {
  return (
    <Page header={<PageHeader tone="warm" eyebrow="Plataforma" title="Panel global" description="Administración de bandas, planes, incidencias, moderación de BandMarket e integraciones." />}>
      <Tabs
        label="Panel global"
        tabs={[
          { id: 'metrics', label: 'Métricas', content: <MetricsTab /> },
          { id: 'tenants', label: 'Bandas', content: <TenantsTab /> },
          { id: 'plans', label: 'Planes', content: <PlansTab /> },
          { id: 'incidents', label: 'Incidencias', content: <IncidentsTab /> },
          { id: 'moderation', label: 'Moderación', content: <ModerationTab /> },
          { id: 'integrations', label: 'Integraciones', content: <IntegrationsTab /> },
        ]}
      />
    </Page>
  );
}
