import { useState } from 'react';
import { useApi } from '../api/hooks';
import type { AttendanceStats } from '../api/types';
import { Person } from '../components/Avatar';
import { ArrowLink } from '../components/Button';
import { Card, StatCard } from '../components/Card';
import { DataTable } from '../components/DataTable';
import { ErrorNote, Loading } from '../components/EmptyState';
import { SelectField, TextField } from '../components/Field';
import { Page, PageHeader } from '../components/PageHeader';
import { date, fullName, percent } from '../lib/format';
import { eventType } from '../lib/labels';
import { useSections } from './Members';

function defaultFrom() {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.toISOString().slice(0, 10);
}

export default function AttendanceStatsPage() {
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [sectionId, setSectionId] = useState('');
  const sections = useSections();
  const q = useApi<AttendanceStats>('/attendance/stats', {
    from: new Date(from).toISOString(),
    to: new Date(`${to}T23:59:59`).toISOString(),
    sectionId,
  });
  const s = q.data;
  const low = s?.byMember.filter((m) => m.rate !== null && m.rate < 0.6).length ?? 0;

  return (
    <Page header={<PageHeader eyebrow="Control de asistencia" title="Estadísticas" description="Asistencia a ensayos y actuaciones por músico y por evento." />}>
      <Card>
        <div className="toolbar">
          <TextField label="Desde" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <TextField label="Hasta" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <SelectField
            label="Sección"
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            placeholder="Todas"
            options={(sections.data ?? []).map((x) => ({ value: x.id, label: x.name }))}
          />
        </div>
      </Card>
      {q.isLoading && <Loading />}
      {q.error && <ErrorNote error={q.error} />}
      {s && (
        <>
          <div className="grid grid--stats">
            <StatCard label="Asistencia global" value={percent(s.overallRate)} meter={s.overallRate ?? undefined} tone="cool" />
            <StatCard label="Eventos en el periodo" value={s.byEvent.length} />
            <StatCard label="Músicos por debajo del 60 %" value={low} tone={low > 0 ? 'cream' : 'paper'} />
          </div>
          <Card title="Por músico">
            <DataTable
              caption="Asistencia por músico"
              rows={[...s.byMember].sort((a, b) => (a.rate ?? 0) - (b.rate ?? 0))}
              rowKey={(r) => r.member.id}
              columns={[
                {
                  key: 'm',
                  header: 'Músico',
                  render: (r) => (
                    <Person name={fullName(r.member)}>
                      <ArrowLink to={`/members/${r.member.id}`}>{fullName(r.member)}</ArrowLink>
                    </Person>
                  ),
                },
                { key: 'p', header: 'Presente', render: (r) => r.present, numeric: true },
                { key: 'l', header: 'Retraso', render: (r) => r.late, numeric: true },
                { key: 'a', header: 'Ausente', render: (r) => r.absent, numeric: true },
                { key: 'e', header: 'Justificada', render: (r) => r.excused, numeric: true },
                {
                  key: 'r',
                  header: 'Tasa',
                  numeric: true,
                  nowrap: true,
                  render: (r) => (
                    <span className={`chip chip--plain ${r.rate === null ? '' : r.rate >= 0.8 ? 'chip--success' : r.rate >= 0.6 ? 'chip--warning' : 'chip--danger'}`}>
                      {percent(r.rate)}
                    </span>
                  ),
                },
              ]}
            />
          </Card>
          <Card title="Por evento" tone="cream">
            <DataTable
              caption="Asistencia por evento"
              rows={s.byEvent}
              rowKey={(r) => r.event.id}
              columns={[
                { key: 'd', header: 'Fecha', render: (r) => date(r.event.startsAt), nowrap: true },
                { key: 't', header: 'Evento', render: (r) => <ArrowLink to={`/events/${r.event.id}`}>{r.event.title}</ArrowLink> },
                { key: 'ty', header: 'Tipo', render: (r) => eventType[r.event.type] },
                { key: 'p', header: 'Asistentes', render: (r) => `${r.present} / ${r.total}`, numeric: true, nowrap: true },
                { key: 'r', header: 'Tasa', render: (r) => percent(r.total ? r.present / r.total : null), numeric: true, nowrap: true },
              ]}
            />
          </Card>
        </>
      )}
    </Page>
  );
}
