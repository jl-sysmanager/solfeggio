import { useState } from 'react';
import { post } from '../../../api/client';
import { useApi, useApiMutation } from '../../../api/hooks';
import type { DunningRow } from '../../../api/types-admin-billing';
import { Button } from '../../Button';
import { Card } from '../../Card';
import { StatusChip } from '../../Chip';
import { DataTable } from '../../DataTable';
import { ErrorNote, Loading } from '../../EmptyState';
import { FormError, TextField, formValues } from '../../Field';
import { ConfirmModal, Modal } from '../../Modal';
import { useToast } from '../../Toasts';
import { date, money } from '../../../lib/format';
import { tenantStatus } from '../../../lib/labels';

type Action = { kind: 'retry' | 'remind' | 'read-only'; row: DunningRow } | { kind: 'grace'; row: DunningRow };

const COPY = {
  retry: { title: 'Reintentar el cobro', label: 'Reintentar cobro', msg: (n: string) => `Se intentará cobrar ahora la última factura pendiente de ${n} con su método de pago.` },
  remind: { title: 'Enviar recordatorio', label: 'Enviar recordatorio', msg: (n: string) => `Se enviará un correo y un aviso a quienes gestionan la facturación de ${n}.` },
  'read-only': { title: 'Pasar a sólo lectura', label: 'Pasar a sólo lectura', msg: (n: string) => `${n} no podrá editar datos hasta que regularice el pago. Queda registrado en auditoría.` },
};

/** Cola de impagos con reintento, recordatorio, gracia y paso a sólo lectura. */
export function DunningSection() {
  const q = useApi<DunningRow[]>('/admin/billing/dunning');
  const [action, setAction] = useState<Action | null>(null);
  const toast = useToast();
  const run = useApiMutation((v: { id: string; path: string; body?: unknown }) => post<{ ok?: boolean; message?: string }>(`/admin/billing/tenants/${v.id}/${v.path}`, v.body), {
    invalidate: ['/admin/billing', '/admin/tenants'],
    onSuccess: (r, v) => {
      setAction(null);
      if (v.path === 'retry') toast.notify(r.ok === false ? `El cobro no se ha completado${r.message ? `: ${r.message}` : ''}` : 'Cobro realizado');
      else toast.notify(v.path === 'remind' ? 'Recordatorio enviado' : v.path === 'grace' ? 'Gracia ampliada' : 'Banda en sólo lectura');
    },
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />;
  const rows = q.data ?? [];
  const total = rows.reduce((s, r) => s + r.amountDueCents, 0);
  return (
    <Card title="Pagos fallidos" actions={<span className="small muted">{rows.length} bandas · {money(total)} pendientes</span>}>
      <DataTable
        caption="Bandas con pagos pendientes"
        rows={rows}
        rowKey={(r) => r.tenant.id}
        empty="Ninguna banda tiene pagos pendientes."
        columns={[
          { key: 'b', header: 'Banda', render: (r) => <><strong>{r.tenant.name}</strong><br /><span className="small muted">{r.owners[0]?.email ?? 'Sin propietario'}</span></> },
          { key: 'p', header: 'Plan', render: (r) => r.plan.name },
          { key: 's', header: 'Estado', render: (r) => <StatusChip value={r.tenant.status} map={tenantStatus} /> },
          { key: 'a', header: 'Importe', render: (r) => money(r.amountDueCents, r.currency), numeric: true, nowrap: true },
          { key: 'f', header: 'Última factura', render: (r) => (r.lastFailedInvoice ? `${r.lastFailedInvoice.number ?? 'Sin número'} · ${date(r.lastFailedInvoice.createdAt)}` : '—') },
          { key: 'g', header: 'Gracia hasta', render: (r) => date(r.graceUntil), nowrap: true },
          { key: 'd', header: 'Días de retraso', render: (r) => r.daysOverdue, numeric: true },
          {
            key: 'x',
            header: 'Acciones',
            render: (r) => (
              <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
                <Button size="sm" variant="ghost" onClick={() => setAction({ kind: 'retry', row: r })} aria-label={`Reintentar cobro de ${r.tenant.name}`}>Reintentar</Button>
                <Button size="sm" variant="ghost" onClick={() => setAction({ kind: 'remind', row: r })} aria-label={`Enviar recordatorio a ${r.tenant.name}`}>Avisar</Button>
                <Button size="sm" variant="ghost" onClick={() => setAction({ kind: 'grace', row: r })} aria-label={`Ampliar la gracia de ${r.tenant.name}`}>Gracia</Button>
                <Button size="sm" variant="danger" disabled={r.tenant.status === 'READ_ONLY' || !!r.complimentaryUntil} onClick={() => setAction({ kind: 'read-only', row: r })} aria-label={`Pasar ${r.tenant.name} a sólo lectura`}>Sólo lectura</Button>
              </div>
            ),
          },
        ]}
      />
      {action && action.kind !== 'grace' && (
        <ConfirmModal
          open
          title={COPY[action.kind].title}
          message={COPY[action.kind].msg(action.row.tenant.name)}
          confirmLabel={COPY[action.kind].label}
          loading={run.isPending}
          onClose={() => setAction(null)}
          onConfirm={() => run.mutate({ id: action.row.tenant.id, path: action.kind })}
        />
      )}
      <Modal open={action?.kind === 'grace'} onClose={() => setAction(null)} title={`Ampliar la gracia de ${action?.row.tenant.name ?? ''}`}>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (action) run.mutate({ id: action.row.tenant.id, path: 'grace', body: { days: Number(formValues(e.currentTarget).days) } });
          }}
        >
          <TextField label="Días adicionales" name="days" type="number" min={1} max={90} defaultValue={7} required hint="Se suman a la fecha actual de gracia y reabren la edición si estaba en sólo lectura." />
          <FormError error={run.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setAction(null)}>Cancelar</Button>
            <Button type="submit" loading={run.isPending}>Ampliar</Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}
