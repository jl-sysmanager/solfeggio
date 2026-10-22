import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { post } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import type { Incident } from '../api/types';
import type { BandIncidentDetail } from '../api/types-admin-support';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Chip, StatusChip } from '../components/Chip';
import { DataTable } from '../components/DataTable';
import { ErrorNote, Loading } from '../components/EmptyState';
import { FormError, SelectField, TextAreaField, TextField, formValues } from '../components/Field';
import { Modal } from '../components/Modal';
import { Page, PageHeader } from '../components/PageHeader';
import { dateTime } from '../lib/format';
import { incidentStatus } from '../lib/labels';

export const PRIORITIES = [
  { value: '1', label: 'Crítica' },
  { value: '2', label: 'Alta' },
  { value: '3', label: 'Normal' },
  { value: '4', label: 'Baja' },
  { value: '5', label: 'Mínima' },
];

/** Conversación con el equipo de soporte; las notas internas de plataforma nunca llegan aquí. */
function IncidentConversation({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useApi<BandIncidentDetail>(id ? `/incidents/${id}` : null);
  const [text, setText] = useState('');
  const reply = useApiMutation((body: string) => post(`/incidents/${id}/messages`, { body }), {
    success: 'Mensaje enviado',
    invalidate: ['/incidents'],
    onSuccess: () => setText(''),
  });
  const inc = q.data;
  return (
    <Modal open={!!id} onClose={onClose} title={inc?.subject ?? 'Incidencia'}>
      {q.isLoading && <Loading />}
      {q.error && <ErrorNote error={q.error} />}
      {inc && (
        <div className="stack">
          <p className="small muted">
            <StatusChip value={inc.status} map={incidentStatus} /> · abierta {dateTime(inc.createdAt)}
          </p>
          <ol className="stack list-plain" aria-label="Conversación">
            <li>
              <Card tone="cream"><p style={{ whiteSpace: 'pre-wrap' }}>{inc.body}</p></Card>
            </li>
            {inc.messages.map((m) => (
              <li key={m.id}>
                <Card tone={m.authorType === 'PLATFORM' ? 'cool' : 'paper'}>
                  <p className="small muted">{m.authorType === 'PLATFORM' ? <Chip tone="info">Soporte</Chip> : 'Vosotros'} · {dateTime(m.createdAt)}</p>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{m.body}</p>
                </Card>
              </li>
            ))}
            {inc.resolution && (
              <li>
                <Card tone="warm"><p className="small muted">Resolución</p><p>{inc.resolution}</p></Card>
              </li>
            )}
          </ol>
          {inc.status !== 'CLOSED' && (
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) reply.mutate(text.trim());
              }}
            >
              <TextAreaField label={inc.status === 'RESOLVED' ? 'Responder (reabre la incidencia)' : 'Responder al equipo de soporte'} value={text} onChange={(e) => setText(e.target.value)} required />
              <FormError error={reply.error} />
              <div className="modal__footer">
                <Button variant="ghost" onClick={onClose}>Cerrar</Button>
                <Button type="submit" loading={reply.isPending}>Enviar</Button>
              </div>
            </form>
          )}
        </div>
      )}
    </Modal>
  );
}

export default function IncidentsPage() {
  const [open, setOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const openId = params.get('id');
  const q = useApi<Incident[]>('/incidents');
  const create = useApiMutation((body: unknown) => post('/incidents', body), { success: 'Incidencia enviada al equipo de soporte', invalidate: ['/incidents'], onSuccess: () => setOpen(false) });
  return (
    <Page header={<PageHeader tone="cream" eyebrow="Soporte" title="Incidencias" actions={<Button onClick={() => setOpen(true)}>Abrir incidencia</Button>} />}>
      {q.isLoading && <Loading />}
      {q.error && <ErrorNote error={q.error} />}
      {q.data && (
        <Card>
          <DataTable
            caption="Incidencias"
            rows={q.data}
            rowKey={(i) => i.id}
            empty="No has abierto ninguna incidencia."
            columns={[
              {
                key: 's',
                header: 'Asunto',
                render: (i) => (
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setParams({ id: i.id })} aria-label={`Abrir conversación: ${i.subject}`}>
                    {i.subject}
                  </button>
                ),
              },
              { key: 'p', header: 'Prioridad', render: (i) => PRIORITIES.find((p) => p.value === String(i.priority))?.label ?? i.priority },
              { key: 'st', header: 'Estado', render: (i) => <StatusChip value={i.status} map={incidentStatus} /> },
              { key: 'r', header: 'Resolución', render: (i) => i.resolution ?? '—' },
              { key: 'd', header: 'Fecha', render: (i) => dateTime(i.createdAt), nowrap: true },
            ]}
          />
        </Card>
      )}
      <IncidentConversation id={openId} onClose={() => setParams({})} />
      <Modal open={open} onClose={() => setOpen(false)} title="Abrir incidencia">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            create.mutate({ subject: v.subject, body: v.body, priority: Number(v.priority ?? 3) });
          }}
        >
          <TextField label="Asunto" name="subject" required />
          <SelectField label="Prioridad" name="priority" defaultValue="3" options={PRIORITIES} />
          <TextAreaField label="Descripción" name="body" required hint="No incluyas contraseñas ni datos bancarios." />
          <FormError error={create.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={create.isPending}>
              Enviar
            </Button>
          </div>
        </form>
      </Modal>
    </Page>
  );
}
