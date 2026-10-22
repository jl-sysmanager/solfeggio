import { useState } from 'react';
import { post } from '../../api/client';
import { useApi, useApiMutation } from '../../api/hooks';
import type { AdminMetrics } from '../../api/types';
import type { CohortRow, InsightsFunnel, InsightsMetrics } from '../../api/types-admin-insights';
import { Button } from '../Button';
import { Card, StatCard } from '../Card';
import { StatusChip } from '../Chip';
import { DataTable } from '../DataTable';
import { ErrorNote, Loading } from '../EmptyState';
import { SelectField } from '../Field';
import { money, percent } from '../../lib/format';
import { tenantStatus } from '../../lib/labels';
import { CohortTable, Funnel } from './insights/FunnelAndCohorts';
import { MONTHS_ES, MrrMovementsChart, PairBars, monthLabel } from './insights/charts';

export function MetricsTab() {
  const [months, setMonths] = useState('12');
  const base = useApi<AdminMetrics>('/admin/metrics');
  const q = useApi<InsightsMetrics>('/admin/insights/metrics', { months });
  const funnel = useApi<InsightsFunnel>('/admin/insights/funnel');
  const cohorts = useApi<CohortRow[]>('/admin/insights/cohorts');
  const snapshot = useSnapshotMutation();

  if (q.isLoading || base.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const m = q.data;
  const k = m.current;
  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <p className="small muted">Las cifras históricas salen de las fotos diarias por banda; los meses sin foto heredan la anterior.</p>
        <Button variant="ghost" onClick={() => snapshot.mutate()} loading={snapshot.isPending}>
          Calcular foto de hoy
        </Button>
      </div>
      <div className="grid grid--stats">
        <StatCard label="MRR" value={money(k.mrrCents)} tone="cream" />
        <StatCard label="ARR" value={money(k.arrCents)} />
        <StatCard label="Ingreso medio por banda" value={money(k.arpaCents)} hint={`${k.payingTenants} ${k.payingTenants === 1 ? 'banda' : 'bandas'} de pago`} />
        <StatCard label="Retención neta (12 meses)" value={percent(k.nrr12)} hint={k.nrrMonthly !== null ? `Último mes: ${percent(k.nrrMonthly)}` : 'Faltan datos de hace un año'} />
        <StatCard label="Bandas" value={base.data?.tenants.total ?? '—'} tone="cool" />
        <StatCard label="Incidencias abiertas" value={base.data?.openIncidents ?? '—'} tone={(base.data?.openIncidents ?? 0) > 0 ? 'warm' : 'paper'} />
      </div>

      <Card
        title="Movimientos de MRR"
        actions={
          <SelectField
            label="Periodo"
            value={months}
            onChange={(e) => setMonths(e.target.value)}
            options={[{ value: '6', label: '6 meses' }, { value: '12', label: '12 meses' }, { value: '24', label: '24 meses' }]}
          />
        }
      >
        <MrrMovementsChart months={m.months} />
        <details style={{ marginTop: 16 }}>
          <summary>Ver como tabla</summary>
          <DataTable
            caption="Movimientos de MRR por mes"
            rows={m.months}
            rowKey={(r) => r.month}
            columns={[
              { key: 'm', header: 'Mes', render: (r) => monthLabel(r.month), nowrap: true },
              { key: 'mrr', header: 'MRR', render: (r) => money(r.mrrCents), numeric: true, nowrap: true },
              { key: 'n', header: 'Altas', render: (r) => money(r.newCents), numeric: true, nowrap: true },
              { key: 'r', header: 'Reactivaciones', render: (r) => money(r.reactivationCents), numeric: true, nowrap: true },
              { key: 'e', header: 'Mejoras', render: (r) => money(r.expansionCents), numeric: true, nowrap: true },
              { key: 'c', header: 'Bajadas', render: (r) => money(r.contractionCents), numeric: true, nowrap: true },
              { key: 'ch', header: 'Bajas', render: (r) => money(r.churnedCents), numeric: true, nowrap: true },
              { key: 'nrr', header: 'NRR mensual', render: (r) => percent(r.nrrMonthly), numeric: true, nowrap: true },
            ]}
          />
        </details>
      </Card>

      <div className="grid grid--2">
        <Card title="Embudo de prueba" actions={<span className="small muted">Bandas creadas en los últimos 12 meses</span>}>
          {funnel.isLoading && <Loading rows={3} />}
          {funnel.error && <ErrorNote error={funnel.error} />}
          {funnel.data && <Funnel funnel={funnel.data} />}
        </Card>
        <Card title="Bandas por estado">
          <ul className="list-plain list-divided">
            {Object.entries(m.tenantsByStatus).map(([s, n]) => (
              <li key={s} className="row between">
                <StatusChip value={s} map={tenantStatus} />
                <strong>{n}</strong>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Cohortes de retención" actions={<span className="small muted">% de bandas activas por mes de alta</span>}>
        {cohorts.isLoading && <Loading rows={3} />}
        {cohorts.error && <ErrorNote error={cohorts.error} />}
        {cohorts.data && (cohorts.data.length ? <CohortTable rows={cohorts.data} /> : <p className="muted">Aún no hay bandas.</p>)}
      </Card>

      <Card title="Estacionalidad" actions={<span className="small muted">Altas (azul) y bajas (rojo) por mes natural, todos los años</span>}>
        <PairBars rows={m.seasonality.map((s) => ({ label: MONTHS_ES[s.month - 1], a: s.signups, b: s.cancellations }))} />
      </Card>
    </div>
  );
}

function useSnapshotMutation() {
  return useApiMutation(() => post('/admin/insights/snapshot', {}), {
    success: 'Foto de hoy calculada',
    invalidate: ['/admin/insights'],
  });
}
