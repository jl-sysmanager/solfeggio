import { useState } from 'react';
import { patch } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import type { Plan } from '../api/types';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { DataTable } from '../components/DataTable';
import { ErrorNote, Loading } from '../components/EmptyState';
import { FormError, TextField, formValues } from '../components/Field';
import { Modal } from '../components/Modal';
import { Page, PageHeader } from '../components/PageHeader';
import { Tabs } from '../components/Tabs';
import { money, parseMoney } from '../lib/format';
import { IntegrationsTab } from './AdminIntegrations';
import { AnnouncementsTab } from '../components/admin/AnnouncementsTab';
import { BillingOpsTab } from '../components/admin/BillingOpsTab';
import { HealthTab } from '../components/admin/HealthTab';
import { IncidentsTab } from '../components/admin/IncidentsTab';
import { MetricsTab } from '../components/admin/MetricsTab';
import { ModerationTab } from '../components/admin/ModerationTab';
import { OpsTab } from '../components/admin/OpsTab';
import { TenantsTab } from '../components/admin/TenantsTab';

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
    <Page header={<PageHeader tone="warm" eyebrow="Plataforma" title="Panel global" description="Negocio y salud de las bandas, facturación, soporte, avisos, sistema, moderación, planes e integraciones." />}>
      <Tabs
        label="Panel global"
        tabs={[
          { id: 'metrics', label: 'Métricas', content: <MetricsTab /> },
          { id: 'health', label: 'Salud de clientes', content: <HealthTab /> },
          { id: 'tenants', label: 'Bandas', content: <TenantsTab /> },
          { id: 'billing', label: 'Facturación', content: <BillingOpsTab /> },
          { id: 'incidents', label: 'Soporte', content: <IncidentsTab /> },
          { id: 'announcements', label: 'Avisos', content: <AnnouncementsTab /> },
          { id: 'ops', label: 'Sistema', content: <OpsTab /> },
          { id: 'moderation', label: 'Moderación', content: <ModerationTab /> },
          { id: 'plans', label: 'Planes', content: <PlansTab /> },
          { id: 'integrations', label: 'Integraciones', content: <IntegrationsTab /> },
        ]}
      />
    </Page>
  );
}
