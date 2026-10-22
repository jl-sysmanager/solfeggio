import { useState } from 'react';
import { patch, post } from '../../../api/client';
import { useApi, useApiMutation } from '../../../api/hooks';
import type { CannedReply, Person, SupportIncidentDetail } from '../../../api/types-admin-support';
import { dateTime } from '../../../lib/format';
import { incidentStatus } from '../../../lib/labels';
import { Button } from '../../Button';
import { Card } from '../../Card';
import { Chip, StatusChip } from '../../Chip';
import { ErrorNote, Loading } from '../../EmptyState';
import { Checkbox, FormError, SelectField, TextAreaField } from '../../Field';
import { Modal } from '../../Modal';
import { PRIORITY_LABEL, SLA_HOURS, SlaChip } from './shared';

/** Conversación y gestión de una incidencia (plataforma): asignar, prioridad, estado y responder. */
export function IncidentDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useApi<SupportIncidentDetail>(id ? `/admin/support/incidents/${id}` : null);
  const agents = useApi<Person[]>('/admin/support/agents');
  const canned = useApi<CannedReply[]>('/admin/support/canned-replies');
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const refresh = { invalidate: ['/admin/support'] };
  const update = useApiMutation((b: unknown) => patch(`/admin/support/incidents/${id}`, b), { success: 'Incidencia actualizada', ...refresh });
  const reply = useApiMutation((b: { body: string; internal: boolean }) => post(`/admin/support/incidents/${id}/messages`, b), {
    success: 'Mensaje enviado',
    ...refresh,
    onSuccess: () => setBody(''),
  });
  const inc = q.data;
  return (
    <Modal open={!!id} onClose={onClose} title={inc?.subject ?? 'Incidencia'}>
      {q.isLoading && <Loading />}
      {q.error && <ErrorNote error={q.error} />}
      {inc && (
        <div className="stack">
          <p className="small muted">
            {inc.tenant?.name} · abierta {dateTime(inc.createdAt)}
            {inc.openedBy ? ` por ${inc.openedBy.name}` : ''} · <StatusChip value={inc.status} map={incidentStatus} /> <SlaChip state={inc.sla} />
          </p>
          <div className="form-row">
            <SelectField
              label="Responsable"
              value={inc.assignee?.id ?? ''}
              placeholder="Sin asignar"
              options={(agents.data ?? []).map((a) => ({ value: a.id, label: a.name }))}
              onChange={(e) => update.mutate({ assigneeId: e.target.value || null })}
            />
            <SelectField
              label="Prioridad"
              value={String(inc.priority)}
              hint={inc.firstResponseAt ? undefined : 'Cambiarla recalcula el plazo de primera respuesta.'}
              options={[1, 2, 3, 4, 5].map((p) => ({ value: String(p), label: `${PRIORITY_LABEL[p]} (${SLA_HOURS[p]} h)` }))}
              onChange={(e) => update.mutate({ priority: Number(e.target.value) })}
            />
            <SelectField
              label="Estado"
              value={inc.status}
              options={Object.entries(incidentStatus).map(([value, { label }]) => ({ value, label }))}
              onChange={(e) => update.mutate({ status: e.target.value })}
            />
          </div>
          <FormError error={update.error} />
          <ol className="stack list-plain" aria-label="Conversación">
            <li>
              <Card tone="cream">
                <p className="small muted">Descripción inicial</p>
                <p style={{ whiteSpace: 'pre-wrap' }}>{inc.body}</p>
              </Card>
            </li>
            {inc.messages.map((m) => (
              <li key={m.id}>
                <Card tone={m.internal ? 'warm' : m.authorType === 'PLATFORM' ? 'cool' : 'paper'}>
                  <p className="small muted">
                    {m.authorType === 'PLATFORM' ? (m.author?.name ?? 'Soporte') : 'Banda'} · {dateTime(m.createdAt)} {m.internal && <Chip tone="warning">Nota interna</Chip>}
                  </p>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{m.body}</p>
                </Card>
              </li>
            ))}
          </ol>
          {inc.status !== 'CLOSED' && (
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                if (body.trim()) reply.mutate({ body: body.trim(), internal });
              }}
            >
              <SelectField
                label="Insertar respuesta predefinida"
                value=""
                placeholder="Elegir…"
                options={(canned.data ?? []).map((c) => ({ value: c.id, label: c.title }))}
                onChange={(e) => {
                  const c = canned.data?.find((x) => x.id === e.target.value);
                  if (c) setBody((b) => (b ? `${b}\n\n${c.body}` : c.body));
                }}
              />
              <TextAreaField label={internal ? 'Nota interna (la banda no la ve)' : 'Respuesta a la banda (se envía por email)'} value={body} onChange={(e) => setBody(e.target.value)} required />
              <Checkbox label="Nota interna: sólo la ve el equipo de plataforma" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
              <FormError error={reply.error} />
              <div className="modal__footer">
                <Button variant="ghost" onClick={onClose}>
                  Cerrar
                </Button>
                <Button type="submit" loading={reply.isPending}>
                  {internal ? 'Guardar nota' : 'Enviar respuesta'}
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </Modal>
  );
}
