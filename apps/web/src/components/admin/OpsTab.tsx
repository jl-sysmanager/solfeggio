import { useState } from 'react';
import { del, post } from '../../api/client';
import { useApi, useApiMutation } from '../../api/hooks';
import type { OpsEmail, OpsHeartbeats, OpsQueues, OpsSchedule, OpsStorage } from '../../api/types-admin-support';
import { bytes, dateTime } from '../../lib/format';
import { Button } from '../Button';
import { Card, StatCard } from '../Card';
import { Chip } from '../Chip';
import { DataTable } from '../DataTable';
import { ErrorNote, Loading } from '../EmptyState';
import { FormError, SelectField, TextField } from '../Field';
import { ConfirmModal } from '../Modal';
import { KpiRow } from './support/shared';

const QUEUE_LABEL: Record<string, string> = { waiting: 'En espera', active: 'En curso', delayed: 'Diferidos', completed: 'Completados', failed: 'Fallidos', paused: 'En pausa' };

function Queues() {
  const q = useApi<OpsQueues>('/admin/ops/queues');
  const opts = { invalidate: ['/admin/ops/queues'] };
  const retryAll = useApiMutation(() => post<{ retried: number }>('/admin/ops/queues/failed/retry'), { success: 'Fallidos reencolados', ...opts });
  const retry = useApiMutation((id: string) => post(`/admin/ops/queues/failed/${id}/retry`), { success: 'Trabajo reencolado', ...opts });
  const remove = useApiMutation((id: string) => del(`/admin/ops/queues/failed/${id}`), { success: 'Trabajo eliminado', ...opts });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />;
  const { counts, repeatables, failed } = q.data;
  return (
    <Card title="Colas de trabajos" actions={failed.length > 0 && <Button size="sm" onClick={() => retryAll.mutate()} loading={retryAll.isPending}>Reintentar todos</Button>}>
      <div className="grid grid--stats">
        {Object.entries(QUEUE_LABEL).map(([k, label]) => (
          <StatCard key={k} label={label} value={counts[k] ?? 0} tone={k === 'failed' && counts[k] ? 'warm' : 'paper'} />
        ))}
      </div>
      <h3 className="card__title">Trabajos fallidos</h3>
      <DataTable
        caption="Trabajos fallidos"
        rows={failed}
        rowKey={(j) => j.id}
        empty="No hay trabajos fallidos."
        columns={[
          { key: 'n', header: 'Trabajo', render: (j) => <code>{j.name}</code> },
          { key: 'e', header: 'Error', render: (j) => j.error },
          { key: 'a', header: 'Intentos', render: (j) => j.attempts, numeric: true },
          { key: 'f', header: 'Fallo', render: (j) => dateTime(j.failedAt), nowrap: true },
          {
            key: 'x',
            header: 'Acciones',
            render: (j) => (
              <span className="row">
                <Button size="sm" variant="ghost" onClick={() => retry.mutate(j.id)} aria-label={`Reintentar trabajo ${j.name} ${j.id}`}>Reintentar</Button>
                <Button size="sm" variant="ghost" onClick={() => remove.mutate(j.id)} aria-label={`Eliminar trabajo ${j.name} ${j.id}`}>Eliminar</Button>
              </span>
            ),
          },
        ]}
      />
      <h3 className="card__title">Tareas repetibles registradas</h3>
      <ul className="small list-plain">
        {repeatables.map((r) => (
          <li key={r.name}><code>{r.name}</code> · {r.pattern} · próxima {dateTime(r.next)}</li>
        ))}
      </ul>
    </Card>
  );
}

function EmailPanel() {
  const q = useApi<OpsEmail>('/admin/ops/email');
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorNote error={q.error} />;
  const { last7d: a, last30d: b } = q.data;
  const rate = (c: typeof a) => (c.sent + c.failed + c.bounced ? `${Math.round(((c.failed + c.bounced + c.complained) / (c.sent + c.failed + c.bounced + c.complained)) * 1000) / 10} %` : '—');
  return (
    <Card title="Correo">
      <KpiRow>
        <StatCard label="Enviados (7 d)" value={a.sent} hint={`${a.failed} fallidos · ${a.bounced} rebotes · ${a.complained} quejas`} />
        <StatCard label="Incidencias de entrega (7 d)" value={rate(a)} tone={a.failed + a.bounced ? 'warm' : 'paper'} />
        <StatCard label="Enviados (30 d)" value={b.sent} hint={`${b.failed} fallidos · ${b.bounced} rebotes · ${b.complained} quejas`} />
        <StatCard label="Incidencias de entrega (30 d)" value={rate(b)} />
      </KpiRow>
      <h3 className="card__title">Bandas con más fallos (30 d)</h3>
      <DataTable caption="Bandas con más fallos de correo" rows={q.data.topTenants} rowKey={(t) => t.tenantId} empty="Sin fallos." columns={[{ key: 'n', header: 'Banda', render: (t) => t.name }, { key: 'f', header: 'Fallos', render: (t) => t.failures, numeric: true }]} />
      <h3 className="card__title">Últimos fallos</h3>
      <DataTable
        caption="Últimos fallos de correo"
        rows={q.data.recentFailures}
        rowKey={(r) => r.id}
        empty="Sin fallos recientes."
        columns={[
          { key: 'd', header: 'Fecha', render: (r) => dateTime(r.createdAt), nowrap: true },
          { key: 's', header: 'Tipo', render: (r) => <Chip tone="danger">{r.status === 'FAILED' ? 'Fallo' : r.status === 'BOUNCED' ? 'Rebote' : 'Queja'}</Chip> },
          { key: 't', header: 'Destinatario', render: (r) => r.to },
          { key: 'b', header: 'Banda', render: (r) => r.tenant ?? '—' },
          { key: 'e', header: 'Detalle', render: (r) => r.error ?? '—' },
        ]}
      />
    </Card>
  );
}

function StoragePanel() {
  const q = useApi<OpsStorage>('/admin/ops/storage');
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const opts = { invalidate: ['/admin/ops/storage'] };
  const scan = useApiMutation(() => post('/admin/ops/storage/orphans/scan'), { success: 'Análisis completado', ...opts });
  const purge = useApiMutation(() => post<{ deleted: number }>('/admin/ops/storage/orphans/delete', { confirm: 'ELIMINAR' }), { success: 'Huérfanos eliminados', ...opts, onSuccess: () => { setConfirming(false); setTyped(''); } });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorNote error={q.error} />;
  const o = q.data.orphans?.detail;
  return (
    <Card title="Almacenamiento" actions={<Button size="sm" variant="ghost" onClick={() => scan.mutate()} loading={scan.isPending}>Analizar huérfanos</Button>}>
      <p>Total almacenado: <strong>{bytes(q.data.totalBytes)}</strong></p>
      <DataTable
        caption="Bandas con más almacenamiento"
        rows={q.data.topTenants}
        rowKey={(t) => t.id}
        columns={[
          { key: 'n', header: 'Banda', render: (t) => t.name },
          { key: 'u', header: 'Usado', render: (t) => bytes(t.usedBytes), numeric: true },
          { key: 'c', header: 'Cuota', render: (t) => (t.quotaBytes ? `${bytes(t.quotaBytes)} (${Math.round((t.usedBytes / t.quotaBytes) * 100)} %)` : 'Sin límite'), numeric: true },
        ]}
      />
      <h3 className="card__title">Objetos huérfanos</h3>
      {!o ? (
        <p className="small muted">Aún no se ha analizado. El análisis automático se ejecuta cada domingo.</p>
      ) : (
        <div className="stack">
          <p>
            {o.count} objetos sin referencia ({bytes(o.bytes)}) de {o.scanned} revisados · último análisis {dateTime(q.data.orphans?.lastRunAt)}.
          </p>
          {o.sample.length > 0 && <ul className="small mono list-plain">{o.sample.slice(0, 10).map((s) => <li key={s.key}>{s.key} · {bytes(s.size)}</li>)}</ul>}
          {o.count > 0 && <div><Button variant="danger" size="sm" onClick={() => setConfirming(true)}>Eliminar huérfanos…</Button></div>}
        </div>
      )}
      <ConfirmModal
        open={confirming}
        title="Eliminar objetos huérfanos"
        confirmLabel="Eliminar definitivamente"
        loading={purge.isPending}
        onConfirm={() => typed === 'ELIMINAR' && purge.mutate()}
        onClose={() => setConfirming(false)}
        message={
          <div className="stack">
            <p>Se borrarán de forma permanente los archivos sin referencia con más de 24 h. Escribe ELIMINAR para confirmar.</p>
            <TextField label="Confirmación" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            <FormError error={purge.error} />
          </div>
        }
      />
    </Card>
  );
}

const SCHEDULE_PRESETS = [
  { value: '*/15 * * * *', label: 'Cada 15 minutos' },
  { value: '0 * * * *', label: 'Cada hora' },
  { value: '0 3 * * *', label: 'Todos los días, 03:00' },
  { value: '0 5 * * 0', label: 'Cada domingo, 05:00' },
  { value: '0 4 1 * *', label: 'El día 1 de cada mes, 04:00' },
];

function ScheduleEditor({ schedule }: { schedule: OpsSchedule }) {
  const [pattern, setPattern] = useState(schedule.pattern);
  const [enabled, setEnabled] = useState(schedule.enabled);
  const save = useApiMutation(
    () => post(`/admin/ops/schedules/${schedule.name}`, { pattern, timezone: 'Europe/Madrid', enabled }),
    { success: 'Programación guardada', invalidate: ['/admin/ops/schedules', '/admin/ops/queues'] },
  );
  const run = useApiMutation(() => post(`/admin/ops/schedules/${schedule.name}/run`), { success: 'Tarea encolada', invalidate: ['/admin/ops/queues'] });
  return (
    <Card title={schedule.label} actions={<Chip tone={enabled ? 'success' : 'neutral'}>{enabled ? 'Activa' : 'Pausada'}</Chip>}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(undefined);
        }}
      >
        <p className="small muted">{schedule.description}</p>
        <div className="form-row">
          <SelectField
            label="Frecuencia"
            name={`preset-${schedule.name}`}
            value={SCHEDULE_PRESETS.some((preset) => preset.value === pattern) ? pattern : 'custom'}
            onChange={(event) => setPattern(event.target.value === 'custom' ? pattern : event.target.value)}
            options={[...SCHEDULE_PRESETS, { value: 'custom', label: 'Cron personalizado' }]}
          />
          <TextField label="Programación cron" value={pattern} onChange={(event) => setPattern(event.target.value)} hint="Cinco campos: minuto, hora, día, mes y semana." required />
          <label className="field"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Activar esta tarea</label>
        </div>
        <FormError error={save.error} />
        <div className="row">
          <Button type="submit" loading={save.isPending}>Guardar</Button>
          <Button variant="ghost" type="button" onClick={() => run.mutate()} loading={run.isPending}>Ejecutar ahora</Button>
        </div>
      </form>
    </Card>
  );
}

function Schedules() {
  const q = useApi<OpsSchedule[]>('/admin/ops/schedules');
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorNote error={q.error} />;
  return (
    <section className="stack" aria-label="Tareas programadas">
      <DataTable
        caption="Tareas programadas"
        rows={q.data}
        rowKey={(s) => s.name}
        columns={[
          { key: 'n', header: 'Tarea', render: (s) => s.label },
          { key: 'p', header: 'Programación', render: (s) => s.pattern },
          { key: 's', header: 'Último resultado', render: (s) => <Chip tone={s.status === 'ok' ? 'success' : s.status === 'error' ? 'danger' : 'neutral'}>{s.status === 'ok' ? 'Correcta' : s.status === 'error' ? 'Con error' : 'Sin ejecutar'}</Chip> },
          { key: 'l', header: 'Última ejecución', render: (s) => (s.lastRunAt ? dateTime(s.lastRunAt) : '—'), nowrap: true },
          { key: 'x', header: 'Próxima', render: (s) => (s.next ? dateTime(s.next) : '—'), nowrap: true },
          { key: 'e', header: 'Detalle', render: (s) => s.detail?.error ?? '' },
        ]}
      />
      {q.data.map((schedule) => <ScheduleEditor key={schedule.name} schedule={schedule} />)}
    </section>
  );
}

function Backups() {
  const q = useApi<OpsHeartbeats>('/admin/ops/heartbeats');
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorNote error={q.error} />;
  return (
    <Card title="Copias de seguridad">
      <p className="small muted">
        La copia completa del sistema se ejecuta fuera de la aplicación. Desde la ficha de cada banda se puede crear una copia y restaurarla: la restauración sustituye los datos de esa banda y conserva su plan, su suscripción y las cuentas.
      </p>
      <DataTable
        caption="Copias de seguridad y latidos externos"
        rows={q.data.heartbeats}
        rowKey={(h) => h.name}
        columns={[
          { key: 'n', header: 'Proceso', render: (h) => <code>{h.name}</code> },
          {
            key: 's',
            header: 'Estado',
            render: (h) => (
              <Chip tone={h.healthy ? 'success' : 'danger'}>
                {h.status === 'never' ? 'Sin señal' : h.status === 'error' ? 'Con error' : h.stale ? `Sin señal en más de ${q.data.staleAfterHours} h` : 'Correcto'}
              </Chip>
            ),
          },
          { key: 'a', header: 'Antigüedad', render: (h) => (h.ageHours === null ? '—' : `${h.ageHours} h`), numeric: true },
          { key: 'l', header: 'Último aviso', render: (h) => (h.lastRunAt ? dateTime(h.lastRunAt) : '—'), nowrap: true },
        ]}
      />
    </Card>
  );
}

/** Salud técnica: colas, correo, almacenamiento, tareas programadas y copias de seguridad. */
export function OpsTab() {
  return (
    <div className="stack" style={{ gap: 24 }}>
      <Backups />
      <Queues />
      <EmailPanel />
      <StoragePanel />
      <Schedules />
    </div>
  );
}
