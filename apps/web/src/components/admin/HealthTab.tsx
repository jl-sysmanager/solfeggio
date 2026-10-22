import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../../api/hooks';
import type { Paginated } from '../../api/types';
import type { ActionRow, HealthRow } from '../../api/types-admin-insights';
import { Card } from '../Card';
import { Chip, StatusChip, Tag } from '../Chip';
import { DataTable, Pagination } from '../DataTable';
import { ErrorNote, Loading } from '../EmptyState';
import { SelectField, TextField } from '../Field';
import { date, money } from '../../lib/format';
import { tenantStatus } from '../../lib/labels';
import { ScoreChip } from './insights/charts';

const SORTS = [
  { value: 'score', label: 'Puntuación (menor primero)' },
  { value: '-score', label: 'Puntuación (mayor primero)' },
  { value: 'name', label: 'Nombre' },
  { value: 'activeUsers', label: 'Usuarios activos' },
  { value: 'lastActivity', label: 'Última actividad' },
  { value: 'mrr', label: 'MRR' },
];

const worstLimit = (r: HealthRow) => r.limits.filter((l) => l.ratio !== null).sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))[0];

function ActionList({ title, empty, rows, loading, error }: { title: string; empty: string; rows?: ActionRow[]; loading: boolean; error: unknown }) {
  return (
    <Card title={title} actions={rows ? <Chip>{rows.length}</Chip> : undefined}>
      {loading && <Loading rows={3} />}
      {!!error && <ErrorNote error={error} />}
      {rows && rows.length === 0 && <p className="muted">{empty}</p>}
      {rows && rows.length > 0 && (
        <ul className="list-plain list-divided">
          {rows.slice(0, 15).map((r) => (
            <li key={r.id} className="stack" style={{ gap: 4 }}>
              <div className="row between">
                <Link to={`/admin/tenants/${r.id}`}>
                  <strong>{r.name}</strong>
                </Link>
                <span className="row" style={{ gap: 8 }}>
                  <Tag>{r.planName}</Tag>
                  <ScoreChip score={r.score} />
                </span>
              </div>
              <ul className="list-plain small muted">
                {r.reasons.map((x) => (
                  <li key={x.code}>{x.label}</li>
                ))}
              </ul>
              {r.suggestion?.planCode && <p className="small">Sugerencia: pasar a {r.suggestion.planCode}</p>}
              {r.suggestion?.addon && <p className="small">Sugerencia: ampliar plazas de alumno</p>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function HealthTab() {
  const [q, setQ] = useState('');
  const [risk, setRisk] = useState('');
  const [plan, setPlan] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('score');
  const [page, setPage] = useState(1);
  const list = useApi<Paginated<HealthRow>>('/admin/insights/health', { q, risk, plan, status, sort, page, pageSize: 25 });
  const atRisk = useApi<ActionRow[]>('/admin/insights/at-risk');
  const upsell = useApi<ActionRow[]>('/admin/insights/upsell');
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };
  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="grid grid--2">
        <ActionList title="En riesgo" empty="Ninguna banda en riesgo esta semana." rows={atRisk.data} loading={atRisk.isLoading} error={atRisk.error} />
        <ActionList title="Listas para mejorar" empty="Ninguna banda cerca de sus límites." rows={upsell.data} loading={upsell.isLoading} error={upsell.error} />
      </div>
      <Card>
        <div className="toolbar">
          <TextField label="Buscar" type="search" value={q} onChange={(e) => reset(setQ)(e.target.value)} placeholder="Nombre o identificador" />
          <SelectField label="Riesgo" value={risk} onChange={(e) => reset(setRisk)(e.target.value)} placeholder="Todos" options={[{ value: 'high', label: 'Alto (< 40)' }, { value: 'medium', label: 'Medio (40–69)' }, { value: 'low', label: 'Bajo (≥ 70)' }]} />
          <SelectField label="Plan" value={plan} onChange={(e) => reset(setPlan)(e.target.value)} placeholder="Todos" options={['FREE', 'BASIC', 'PRO', 'ENTERPRISE'].map((c) => ({ value: c, label: c }))} />
          <SelectField label="Estado" value={status} onChange={(e) => reset(setStatus)(e.target.value)} placeholder="Todos" options={Object.entries(tenantStatus).map(([value, { label }]) => ({ value, label }))} />
          <SelectField label="Ordenar por" value={sort} onChange={(e) => reset(setSort)(e.target.value)} options={SORTS} />
        </div>
      </Card>
      {list.isLoading && <Loading />}
      {list.error && <ErrorNote error={list.error} />}
      {list.data && (
        <Card title="Salud de las bandas">
          <DataTable
            caption="Salud de las bandas"
            rows={list.data.data}
            rowKey={(r) => r.id}
            columns={[
              { key: 'n', header: 'Banda', render: (r) => <Link to={`/admin/tenants/${r.id}`}>{r.name}</Link> },
              { key: 's', header: 'Puntuación', render: (r) => <ScoreChip score={r.score} />, nowrap: true },
              { key: 'p', header: 'Plan', render: (r) => <span>{r.planName} <StatusChip value={r.status} map={tenantStatus} /></span> },
              { key: 'u', header: 'Usuarios activos (7 d / 30 d)', render: (r) => `${r.activeUsers7d} / ${r.activeUsers30d}`, numeric: true, nowrap: true },
              { key: 'm', header: 'Módulos con uso', render: (r) => r.modulesUsed, numeric: true },
              { key: 'a', header: 'Última actividad', render: (r) => date(r.lastActivityAt), nowrap: true },
              {
                key: 'l',
                header: 'Límite más cercano',
                render: (r) => {
                  const l = worstLimit(r);
                  return l?.ratio !== null && l?.ratio !== undefined ? `${l.label} ${Math.round(l.ratio * 100)} %` : '—';
                },
                nowrap: true,
              },
              { key: 'r', header: 'MRR', render: (r) => money(r.mrrCents), numeric: true, nowrap: true },
            ]}
          />
          <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
        </Card>
      )}
    </div>
  );
}
