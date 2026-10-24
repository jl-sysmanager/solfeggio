import { useState } from 'react';
import { useApi } from '../../api/hooks';
import type { Paginated } from '../../api/types';
import type { SupportIncident, SupportKpis } from '../../api/types-admin-support';
import { dateTime } from '../../lib/format';
import { incidentStatus } from '../../lib/labels';
import { Person } from '../Avatar';
import { IconButton } from '../Button';
import { Card, StatCard } from '../Card';
import { Chip, StatusChip } from '../Chip';
import { DataTable } from '../DataTable';
import { ErrorNote, Loading } from '../EmptyState';
import { SelectField, TextField } from '../Field';
import { UrlTabs } from '../Tabs';
import { CannedReplies } from './support/CannedReplies';
import { IncidentDetail } from './support/IncidentDetail';
import { KpiRow, PRIORITY_LABEL, SlaChip, minutesLabel } from './support/shared';

/** Soporte: cola de incidencias con SLA, filtros, conversación y respuestas predefinidas. */
export function IncidentsTab() {
  const [f, setF] = useState({ status: 'ACTIVE', priority: '', assignee: '', sla: '', q: '' });
  const [open, setOpen] = useState<string | null>(null);
  const kpis = useApi<SupportKpis>('/admin/support/kpis');
  const agents = useApi<{ id: string; name: string }[]>('/admin/support/agents');
  const q = useApi<Paginated<SupportIncident>>('/admin/support/incidents', {
    status: f.status || undefined, priority: f.priority || undefined, assignee: f.assignee || undefined, sla: f.sla || undefined, q: f.q || undefined,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const k = kpis.data;
  return (
    <div className="stack" style={{ gap: 24 }}>
      {k && (
        <KpiRow>
          <StatCard label="Abiertas" value={k.open} hint={`${k.unassigned} sin asignar`} />
          <StatCard label="SLA vencido" value={k.overdue} tone={k.overdue ? 'warm' : 'paper'} hint={`${k.atRisk} en riesgo (< 1 h)`} />
          <StatCard label="Primera respuesta (mediana, 30 d)" value={minutesLabel(k.last30d.medianFirstResponseMinutes)} />
          <StatCard label="Dentro de SLA (30 d)" value={k.last30d.withinSlaPct === null ? '—' : `${k.last30d.withinSlaPct} %`} />
        </KpiRow>
      )}
      <UrlTabs
        label="Soporte"
        tabs={[
          { id: 'queue', label: 'Cola', content: (
      <Card title="Incidencias de todas las bandas">
        <div className="toolbar" role="search">
          <SelectField label="Estado" value={f.status} onChange={set('status')} options={[{ value: 'ACTIVE', label: 'Abiertas y en curso' }, ...Object.entries(incidentStatus).map(([value, { label }]) => ({ value, label }))]} placeholder="Todos" />
          <SelectField label="Prioridad" value={f.priority} onChange={set('priority')} placeholder="Todas" options={[1, 2, 3, 4, 5].map((p) => ({ value: String(p), label: PRIORITY_LABEL[p] }))} />
          <SelectField label="Responsable" value={f.assignee} onChange={set('assignee')} placeholder="Todos" options={[{ value: 'none', label: 'Sin asignar' }, { value: 'me', label: 'Asignadas a mí' }, ...(agents.data ?? []).map((a) => ({ value: a.id, label: a.name }))]} />
          <SelectField label="SLA" value={f.sla} onChange={set('sla')} placeholder="Cualquiera" options={[{ value: 'overdue', label: 'Vencido' }, { value: 'at_risk', label: 'En riesgo' }]} />
          <TextField label="Buscar" value={f.q} onChange={set('q')} placeholder="Asunto o banda" />
        </div>
        {q.isLoading && <Loading />}
        {q.error && <ErrorNote error={q.error} />}
        {q.data && (
          <DataTable
            caption="Incidencias de todas las bandas"
            rows={q.data.data}
            rowKey={(i) => i.id}
            onRowClick={(i) => setOpen(i.id)}
            empty="Sin incidencias con estos filtros."
            columns={[
              { key: 't', header: 'Banda', render: (i) => (i.tenant ? <Person name={i.tenant.name} detail={i.tenant.slug} /> : '—') },
              { key: 's', header: 'Asunto', render: (i) => i.subject },
              { key: 'p', header: 'Prioridad', render: (i) => <Chip tone={i.priority <= 2 ? 'danger' : 'neutral'}>{PRIORITY_LABEL[i.priority] ?? i.priority}</Chip> },
              { key: 'st', header: 'Estado', render: (i) => <StatusChip value={i.status} map={incidentStatus} /> },
              { key: 'sla', header: 'SLA', render: (i) => <SlaChip state={i.sla} /> },
              { key: 'a', header: 'Responsable', render: (i) => i.assignee?.name ?? <span className="muted">Sin asignar</span> },
              { key: 'd', header: 'Abierta', render: (i) => dateTime(i.createdAt), nowrap: true },
              {
                key: 'x',
                header: 'Acciones',
                render: (i) => (
                  <IconButton icon="eye" label={`Atender incidencia: ${i.subject}`} onClick={() => setOpen(i.id)} />
                ),
              },
            ]}
          />
        )}
      </Card>
          ) },
          { id: 'replies', label: 'Respuestas', content: <CannedReplies /> },
        ]}
      />
      <IncidentDetail id={open} onClose={() => setOpen(null)} />
    </div>
  );
}
