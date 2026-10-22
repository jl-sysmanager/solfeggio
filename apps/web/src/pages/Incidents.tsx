import { useState } from 'react';
import { post } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import type { Incident } from '../api/types';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { StatusChip } from '../components/Chip';
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
];

export default function IncidentsPage() {
  const [open, setOpen] = useState(false);
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
              { key: 's', header: 'Asunto', render: (i) => i.subject },
              { key: 'p', header: 'Prioridad', render: (i) => PRIORITIES.find((p) => p.value === String(i.priority))?.label ?? i.priority },
              { key: 'st', header: 'Estado', render: (i) => <StatusChip value={i.status} map={incidentStatus} /> },
              { key: 'r', header: 'Resolución', render: (i) => i.resolution ?? '—' },
              { key: 'd', header: 'Fecha', render: (i) => dateTime(i.createdAt), nowrap: true },
            ]}
          />
        </Card>
      )}
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
