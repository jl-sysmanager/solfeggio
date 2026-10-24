import { useEffect, useState } from 'react';
import { del, patch, post } from '../../api/client';
import { useApi, useApiMutation } from '../../api/hooks';
import type { AdminTenant, Paginated } from '../../api/types';
import type { AnnouncementRow, Segment } from '../../api/types-admin-support';
import { date, dateTime, toLocalInput } from '../../lib/format';
import { featureLabels } from '../../lib/labels';
import { Button, IconButton } from '../Button';
import { Card } from '../Card';
import { Chip, type ChipTone } from '../Chip';
import { DataTable } from '../DataTable';
import { ErrorNote, Loading } from '../EmptyState';
import { Checkbox, FormError, SelectField, TextAreaField, TextField, formValues } from '../Field';
import { ConfirmModal, Drawer } from '../Modal';
import { REGIONS } from './support/shared';

const LEVELS = { INFO: 'Novedad', WARNING: 'Aviso', MAINTENANCE: 'Mantenimiento' } as const;
const STATES: Record<AnnouncementRow['state'], { label: string; tone: ChipTone }> = {
  scheduled: { label: 'Programado', tone: 'info' },
  active: { label: 'Activo', tone: 'success' },
  ended: { label: 'Finalizado', tone: 'neutral' },
};
const PLANS = ['FREE', 'BASIC', 'PRO', 'ENTERPRISE'];

function toggle(list: string[] | undefined, v: string) {
  const cur = list ?? [];
  return cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
}

function segmentSummary(s: Segment) {
  const parts = [s.plans?.length && `planes ${s.plans.join(', ')}`, s.regions?.length && `${s.regions.length} comunidades`, s.features?.length && `módulos ${s.features.map((f) => featureLabels[f] ?? f).join(', ')}`, s.tenantIds?.length && `${s.tenantIds.length} bandas`].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Todas las bandas';
}

function AnnouncementForm({ editing, onClose }: { editing: AnnouncementRow | null; onClose: () => void }) {
  const [segment, setSegment] = useState<Segment>(editing?.segment ?? {});
  const tenants = useApi<Paginated<AdminTenant>>('/admin/tenants', { pageSize: 200 });
  const preview = useApiMutation((s: Segment) => post<{ tenants: number; users: number }>('/admin/announcements/preview', { segment: s }));
  const save = useApiMutation((v: { id?: string; body: unknown }) => (v.id ? patch(`/admin/announcements/${v.id}`, v.body) : post('/admin/announcements', v.body)), {
    success: 'Aviso guardado',
    invalidate: ['/admin/announcements'],
    onSuccess: onClose,
  });
  const run = preview.mutate;
  useEffect(() => {
    run(segment);
  }, [segment, run]);
  const seg = (k: keyof Segment) => (v: string) => setSegment((s) => ({ ...s, [k]: toggle(s[k], v) }));
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        const v = formValues(e.currentTarget);
        const iso = (x?: string) => (x ? new Date(x).toISOString() : undefined);
        save.mutate({
          id: editing?.id,
          body: {
            title: v.title, body: v.body, level: v.level, link: v.link ?? null, segment,
            startsAt: iso(v.startsAt), endsAt: iso(v.endsAt) ?? null,
            dismissible: (e.currentTarget.elements.namedItem('dismissible') as HTMLInputElement).checked,
          },
        });
      }}
    >
      <TextField label="Título" name="title" required defaultValue={editing?.title} maxLength={140} />
      <TextAreaField label="Mensaje" name="body" required defaultValue={editing?.body} maxLength={1000} />
      <div className="form-row">
        <SelectField className="field--medium" label="Tipo" name="level" defaultValue={editing?.level ?? 'INFO'} options={Object.entries(LEVELS).map(([value, label]) => ({ value, label }))} hint="El mantenimiento se muestra a todo el mundo, sin segmentar." />
        <TextField className="field--medium" label="Enlace (opcional)" name="link" defaultValue={editing?.link ?? ''} placeholder="/billing o https://…" />
      </div>
      <div className="form-row">
        <TextField className="field--medium" label="Empieza" name="startsAt" type="datetime-local" defaultValue={toLocalInput(editing?.startsAt)} hint="Vacío = ahora." />
        <TextField className="field--medium" label="Termina" name="endsAt" type="datetime-local" defaultValue={toLocalInput(editing?.endsAt)} hint="Vacío = hasta que lo finalices." />
      </div>
      <Checkbox label="Los usuarios pueden descartarlo" name="dismissible" defaultChecked={editing?.dismissible ?? true} />
      <fieldset className="stack">
        <legend>Destinatarios (vacío = todas las bandas)</legend>
        <div className="row" style={{ flexWrap: 'wrap' }} role="group" aria-label="Planes">
          {PLANS.map((p) => (
            <Checkbox key={p} label={p} checked={segment.plans?.includes(p) ?? false} onChange={() => seg('plans')(p)} />
          ))}
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }} role="group" aria-label="Módulos">
          {Object.entries(featureLabels).map(([k, label]) => (
            <Checkbox key={k} label={label} checked={segment.features?.includes(k) ?? false} onChange={() => seg('features')(k)} />
          ))}
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="seg-regions">Comunidades autónomas</label>
            <select id="seg-regions" className="select" multiple size={6} value={segment.regions ?? []} onChange={(e) => setSegment((s) => ({ ...s, regions: Array.from(e.target.selectedOptions).map((o) => o.value) }))}>
              {REGIONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="seg-tenants">Bandas concretas</label>
            <select id="seg-tenants" className="select" multiple size={6} value={segment.tenantIds ?? []} onChange={(e) => setSegment((s) => ({ ...s, tenantIds: Array.from(e.target.selectedOptions).map((o) => o.value) }))}>
              {(tenants.data?.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>
        <p role="status" className="small">
          {preview.data ? <>Alcanza <strong>{preview.data.tenants}</strong> bandas y <strong>{preview.data.users}</strong> usuarios.</> : 'Calculando alcance…'}
        </p>
      </fieldset>
      <FormError error={save.error} />
      <div className="modal__footer">
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button type="submit" loading={save.isPending}>Guardar</Button>
      </div>
    </form>
  );
}

/** Avisos a las bandas: banners de mantenimiento o novedades, por segmento y con programación. */
export function AnnouncementsTab() {
  const q = useApi<AnnouncementRow[]>('/admin/announcements');
  const [editing, setEditing] = useState<AnnouncementRow | 'new' | null>(null);
  const [ending, setEnding] = useState<AnnouncementRow | null>(null);
  const opts = { invalidate: ['/admin/announcements'] };
  const end = useApiMutation((id: string) => post(`/admin/announcements/${id}/end`), { success: 'Aviso finalizado', ...opts, onSuccess: () => setEnding(null) });
  const remove = useApiMutation((id: string) => del(`/admin/announcements/${id}`), { success: 'Aviso eliminado', ...opts });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  return (
    <Card title="Avisos a las bandas" actions={<Button onClick={() => setEditing('new')}>Nuevo aviso</Button>}>
      <DataTable
        caption="Avisos a las bandas"
        rows={q.data ?? []}
        rowKey={(a) => a.id}
        onRowClick={setEditing}
        empty="No hay avisos. Crea uno para informar de un mantenimiento o una novedad."
        columns={[
          { key: 't', header: 'Aviso', render: (a) => (<><strong>{a.title}</strong><br /><span className="small muted">{LEVELS[a.level]}</span></>) },
          { key: 's', header: 'Estado', render: (a) => <Chip tone={STATES[a.state].tone}>{STATES[a.state].label}</Chip> },
          { key: 'w', header: 'Ventana', render: (a) => `${dateTime(a.startsAt)} → ${a.endsAt ? date(a.endsAt) : 'sin fin'}`, nowrap: true },
          { key: 'g', header: 'Destinatarios', render: (a) => (<>{segmentSummary(a.segment)}<br /><span className="small muted">{a.reach.tenants} bandas · {a.reach.users} usuarios · {a.dismissals} lo han descartado</span></>) },
          {
            key: 'a',
            header: 'Acciones',
            render: (a) => (
              <span className="row">
                <IconButton icon="edit" label={`Editar aviso ${a.title}`} onClick={() => setEditing(a)} />
                {a.state !== 'ended' && <IconButton icon="check" label={`Finalizar aviso ${a.title}`} onClick={() => setEnding(a)} />}
                <IconButton icon="trash" variant="danger" label={`Eliminar aviso ${a.title}`} onClick={() => remove.mutate(a.id)} />
              </span>
            ),
          },
        ]}
      />
      <Drawer open={!!editing} onClose={() => setEditing(null)} title={editing && editing !== 'new' ? 'Editar aviso' : 'Nuevo aviso'}>
        {editing && <AnnouncementForm key={editing === 'new' ? 'new' : editing.id} editing={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      </Drawer>
      <ConfirmModal open={!!ending} title="Finalizar aviso" message={`«${ending?.title ?? ''}» dejará de mostrarse ahora mismo.`} confirmLabel="Finalizar" loading={end.isPending} onConfirm={() => ending && end.mutate(ending.id)} onClose={() => setEnding(null)} />
    </Card>
  );
}
