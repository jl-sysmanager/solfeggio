import { useState, type FormEvent } from 'react';
import { post } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import type { Communication, Paginated } from '../api/types';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { DataTable } from '../components/DataTable';
import { ErrorNote, Loading } from '../components/EmptyState';
import { FormError, SelectField, TextAreaField, TextField, formValues } from '../components/Field';
import { Modal } from '../components/Modal';
import { Page, PageHeader } from '../components/PageHeader';
import { dateTime } from '../lib/format';
import { useSections } from './Members';

function audienceLabel(a: unknown) {
  const x = a as { all?: boolean; sectionIds?: string[]; memberIds?: string[] };
  if (x?.all) return 'Todos los socios';
  if (x?.sectionIds) return `${x.sectionIds.length} secciones`;
  if (x?.memberIds) return `${x.memberIds.length} socios`;
  return '—';
}

export default function CommunicationsPage() {
  const [open, setOpen] = useState(false);
  const [audience, setAudience] = useState<'all' | 'sections'>('all');
  const [sectionIds, setSectionIds] = useState<string[]>([]);
  const sections = useSections();
  const list = useApi<Communication[] | Paginated<Communication>>('/communications');
  const rows = Array.isArray(list.data) ? list.data : list.data?.data ?? [];
  const send = useApiMutation((body: unknown) => post('/communications', body), {
    success: 'Comunicación enviada',
    invalidate: ['/communications'],
    onSuccess: () => setOpen(false),
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    send.mutate({
      subject: v.subject,
      body: v.body,
      channel: v.channel,
      audience: audience === 'all' ? { all: true } : { sectionIds },
    });
  }

  return (
    <Page
      header={
        <PageHeader
          eyebrow="Secretaría"
          title="Comunicaciones"
          description="Avisos a los socios por email o dentro de la aplicación."
          actions={<Button onClick={() => setOpen(true)}>Nueva comunicación</Button>}
        />
      }
    >
      {list.isLoading && <Loading />}
      {list.error && <ErrorNote error={list.error} />}
      {list.data && (
        <Card title="Enviadas">
          <DataTable
            caption="Comunicaciones enviadas"
            rows={rows}
            rowKey={(c) => c.id}
            columns={[
              { key: 's', header: 'Asunto', render: (c) => c.subject },
              { key: 'ch', header: 'Canal', render: (c) => <Chip tone="info">{c.channel === 'EMAIL' ? 'Email' : 'En la app'}</Chip> },
              { key: 'a', header: 'Destinatarios', render: (c) => `${audienceLabel(c.audience)} (${c.recipients})` },
              { key: 'd', header: 'Fecha', render: (c) => dateTime(c.sentAt ?? c.createdAt), nowrap: true },
            ]}
          />
        </Card>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Nueva comunicación">
        <form className="form" onSubmit={submit}>
          <TextField label="Asunto" name="subject" required maxLength={200} />
          <TextAreaField label="Mensaje" name="body" required rows={6} />
          <SelectField
            label="Canal"
            name="channel"
            defaultValue="IN_APP"
            options={[
              { value: 'IN_APP', label: 'Notificación en la app' },
              { value: 'EMAIL', label: 'Email (y notificación)' },
            ]}
          />
          <fieldset style={{ border: 0, padding: 0, margin: 0 }} className="stack">
            <legend className="field__label">Destinatarios</legend>
            <div className="segmented" role="group" aria-label="Destinatarios">
              <button type="button" aria-pressed={audience === 'all'} onClick={() => setAudience('all')}>
                Todos
              </button>
              <button type="button" aria-pressed={audience === 'sections'} onClick={() => setAudience('sections')}>
                Por secciones
              </button>
            </div>
            {audience === 'sections' && (
              <div className="chips">
                {(sections.data ?? []).map((s) => {
                  const on = sectionIds.includes(s.id);
                  return (
                    <button
                      type="button"
                      key={s.id}
                      className="chip chip--plain chip--outline"
                      aria-pressed={on}
                      onClick={() => setSectionIds((x) => (on ? x.filter((i) => i !== s.id) : [...x, s.id]))}
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>
            )}
          </fieldset>
          <FormError error={send.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={send.isPending} disabled={audience === 'sections' && sectionIds.length === 0}>
              Enviar
            </Button>
          </div>
        </form>
      </Modal>
    </Page>
  );
}
