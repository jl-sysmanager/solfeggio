import { post } from '../../../api/client';
import { useApi, useApiMutation } from '../../../api/hooks';
import type { AddonsOverview, SyncResultView } from '../../../api/types-admin-billing';
import { Button } from '../../Button';
import { Card } from '../../Card';
import { Chip, StatusChip } from '../../Chip';
import { DataTable } from '../../DataTable';
import { ErrorNote, Loading } from '../../EmptyState';
import { dateTime, money } from '../../../lib/format';
import { tenantStatus } from '../../../lib/labels';
import { changeLabel, SYNC_STATUS } from './helpers';

/** Add-on Escuela: bandas que lo tienen o tienen plazas extra y su estado en Stripe. */
export function AddonsSection() {
  const q = useApi<AddonsOverview>('/admin/billing/addons');
  const sync = useApiMutation((id: string) => post<SyncResultView>(`/admin/billing/tenants/${id}/sync-addons`), {
    invalidate: ['/admin/billing/addons'],
    success: 'Sincronización lanzada',
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />;
  const { prices, tenants } = q.data!;
  const total = tenants.reduce((s, t) => s + t.mrrCents, 0);
  return (
    <Card title="Add-on Escuela" actions={<span className="small muted">Ingreso mensual estimado: {money(total)}</span>}>
      {(!prices.addonConfigured || !prices.seatConfigured) && (
        <div className="callout callout--warning" role="status">
          <p>
            Falta configurar {[!prices.addonConfigured && 'el precio de la cuota', !prices.seatConfigured && 'el precio por plaza'].filter(Boolean).join(' y ')} en Integraciones › Stripe.
            Mientras tanto no se cobra ese concepto.
          </p>
        </div>
      )}
      <DataTable
        caption="Bandas con el add-on Escuela"
        rows={tenants}
        rowKey={(t) => t.tenant.id}
        empty="Ninguna banda tiene el add-on ni plazas adicionales."
        columns={[
          { key: 'b', header: 'Banda', render: (t) => <><strong>{t.tenant.name}</strong><br /><StatusChip value={t.tenant.status} map={tenantStatus} /></> },
          { key: 'p', header: 'Plan', render: (t) => <>{t.plan.name}{t.plan.includesSchool && <><br /><span className="small muted">Incluye la escuela</span></>}</> },
          { key: 'l', header: 'Conceptos', render: (t) => (t.lines.length ? t.lines.map((l) => `${l.label} × ${l.quantity}`).join(' · ') : 'Sin cobro adicional') },
          { key: 'm', header: 'Mensual', render: (t) => money(t.mrrCents), numeric: true, nowrap: true },
          { key: 's', header: 'Stripe', render: (t) => (t.complimentaryUntil ? <Chip tone="info">Bonificada</Chip> : t.stripe.subscriptionId ? <Chip tone="success">{t.stripe.status}</Chip> : <Chip>Sin suscripción</Chip>) },
          {
            key: 'y',
            header: 'Última sincronización',
            render: (t) =>
              t.lastSync ? (
                <>
                  <Chip tone={SYNC_STATUS[t.lastSync.status].tone}>{SYNC_STATUS[t.lastSync.status].label}</Chip>
                  <br />
                  <span className="small muted">{dateTime(t.lastSync.at)}</span>
                  {t.lastSync.changes.length > 0 && <><br /><span className="small">{t.lastSync.changes.map(changeLabel).join(', ')}</span></>}
                  {t.lastSync.message && <><br /><span className="small field__error">{t.lastSync.message}</span></>}
                </>
              ) : (
                '—'
              ),
          },
          {
            key: 'a',
            header: 'Acciones',
            render: (t) => (
              <Button size="sm" variant="ghost" disabled={!t.stripe.subscriptionId} loading={sync.isPending && sync.variables === t.tenant.id} onClick={() => sync.mutate(t.tenant.id)} aria-label={`Sincronizar el add-on de ${t.tenant.name} con Stripe`}>
                Sincronizar
              </Button>
            ),
          },
        ]}
      />
    </Card>
  );
}
