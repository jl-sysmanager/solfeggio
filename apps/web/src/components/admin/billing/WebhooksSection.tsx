import { useState } from 'react';
import { post } from '../../../api/client';
import { useApi, useApiMutation } from '../../../api/hooks';
import type { StripeEventRow, WebhookDetail, WebhooksPage } from '../../../api/types-admin-billing';
import { Button } from '../../Button';
import { Card } from '../../Card';
import { StatusChip } from '../../Chip';
import { DataTable, Pagination } from '../../DataTable';
import { ErrorNote, Loading } from '../../EmptyState';
import { SelectField } from '../../Field';
import { Modal } from '../../Modal';
import { useToast } from '../../Toasts';
import { dateTime } from '../../../lib/format';
import { EVENT_STATUS } from './helpers';

function EventDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useApi<WebhookDetail>(id ? `/admin/billing/webhooks/${id}` : null);
  const toast = useToast();
  const replay = useApiMutation((eventId: string) => post<{ ok: boolean; result?: string; error?: string }>(`/admin/billing/webhooks/${eventId}/replay`), {
    invalidate: ['/admin/billing/webhooks'],
    onSuccess: (r) => toast.notify(r.ok ? 'Evento procesado de nuevo' : `Sigue fallando: ${r.error ?? ''}`),
  });
  const e = q.data;
  return (
    <Modal open={!!id} onClose={onClose} title="Evento de Stripe">
      {q.isLoading && <Loading rows={3} />}
      {q.error && <ErrorNote error={q.error} />}
      {e && (
        <div className="stack" style={{ gap: 12 }}>
          <dl className="stack" style={{ gap: 4 }}>
            <div><dt className="label-caps">Identificador</dt><dd className="mono">{e.id}</dd></div>
            <div><dt className="label-caps">Tipo</dt><dd>{e.type}</dd></div>
            <div><dt className="label-caps">Recibido</dt><dd>{dateTime(e.receivedAt)}</dd></div>
            <div><dt className="label-caps">Banda</dt><dd>{e.tenant?.name ?? 'No identificada'}</dd></div>
            {e.object && <div><dt className="label-caps">Objeto</dt><dd className="mono">{[e.object.object, e.object.id, e.object.status].filter(Boolean).join(' · ')}</dd></div>}
          </dl>
          {e.error && <div className="callout callout--danger" role="alert"><p><strong>Error de procesamiento:</strong> {e.error}</p></div>}
          {e.fetchError && <p className="small muted">No se pudo leer el evento en Stripe: {e.fetchError}</p>}
          <div className="modal__footer">
            <Button variant="ghost" onClick={onClose}>Cerrar</Button>
            <Button loading={replay.isPending} onClick={() => replay.mutate(e.id)}>Procesar de nuevo</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Historial de eventos de Stripe con reprocesado manual. */
export function WebhooksSection() {
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const q = useApi<WebhooksPage>('/admin/billing/webhooks', { type, status, page, pageSize: 25 });
  return (
    <div className="stack" style={{ gap: 24 }}>
      <Card>
        <div className="toolbar">
          <SelectField label="Estado" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} placeholder="Todos" options={Object.entries(EVENT_STATUS).map(([value, v]) => ({ value, label: v.label }))} />
          <SelectField label="Tipo" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} placeholder="Todos" options={(q.data?.types ?? []).map((t) => ({ value: t, label: t }))} />
        </div>
      </Card>
      {q.isLoading && <Loading />}
      {q.error && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}
      {q.data && (
        <Card title="Webhooks de Stripe">
          <DataTable
            caption="Eventos recibidos de Stripe"
            rows={q.data.data}
            rowKey={(e) => e.id}
            empty="No hay eventos con esos filtros."
            columns={[
              { key: 't', header: 'Evento', render: (e: StripeEventRow) => <><strong>{e.type}</strong><br /><span className="small mono muted">{e.id}</span></> },
              { key: 'r', header: 'Recibido', render: (e) => dateTime(e.receivedAt), nowrap: true },
              { key: 's', header: 'Estado', render: (e) => <StatusChip value={e.status} map={EVENT_STATUS} /> },
              { key: 'e', header: 'Error', render: (e) => (e.error ? <span className="small">{e.error.slice(0, 80)}</span> : '—') },
              { key: 'a', header: 'Acciones', render: (e) => <Button size="sm" variant="ghost" onClick={() => setSelected(e.id)} aria-label={`Ver evento ${e.id}`}>Detalle</Button> },
            ]}
          />
          <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />
        </Card>
      )}
      <EventDetail id={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
