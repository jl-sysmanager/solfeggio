import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { del, patch, post } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import type { ImpersonationStart, Person, TenantInsight } from '../api/types-admin-insights';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/Button';
import { Card, StatCard } from '../components/Card';
import { Chip, StatusChip, Tag } from '../components/Chip';
import { DataTable, Pagination } from '../components/DataTable';
import { ErrorNote, Loading } from '../components/EmptyState';
import { FormError, SelectField, TextAreaField, TextField, formValues } from '../components/Field';
import { Modal } from '../components/Modal';
import { Page, PageHeader } from '../components/PageHeader';
import { LimitBar, ScoreChip, Sparkline } from '../components/admin/insights/charts';
import { bytes, date, dateTime, money } from '../lib/format';
import { tenantStatus } from '../lib/labels';

const KIND_LABEL: Record<string, string> = {
  created: 'Alta', onboarded: 'Onboarding', platform: 'Plataforma', plan: 'Plan', status: 'Estado', invoice: 'Factura', incident: 'Incidencia',
  impersonation: 'Ver como', note: 'Nota',
};

function ImpersonateModal({ tenantId, tenantName, open, onClose }: { tenantId: string; tenantName: string; open: boolean; onClose: () => void }) {
  const { startImpersonation } = useAuth();
  const navigate = useNavigate();
  const start = useApiMutation(
    async (v: { reason: string; minutes: number }) => {
      const res = await post<ImpersonationStart>('/admin/impersonation', { tenantId, ...v });
      await startImpersonation(res.accessToken);
    },
    { onSuccess: () => { onClose(); navigate('/'); } },
  );
  return (
    <Modal open={open} onClose={onClose} title={`Ver como «${tenantName}»`}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const v = formValues(e.currentTarget);
          start.mutate({ reason: v.reason ?? '', minutes: Number(v.minutes ?? 30) });
        }}
      >
        <p className="small muted">Acceso de solo lectura, sin datos sensibles (DNI, IBAN). Queda registrado y la banda lo verá en su auditoría.</p>
        <TextAreaField label="Motivo" name="reason" required minLength={10} maxLength={500} hint="Mínimo 10 caracteres." />
        <TextField label="Duración (minutos)" name="minutes" type="number" min={5} max={60} defaultValue={30} />
        <FormError error={start.error} />
        <div className="modal__footer">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={start.isPending}>Entrar</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function AdminTenantPage() {
  const { id = '' } = useParams();
  const [tlPage, setTlPage] = useState(1);
  const [viewAs, setViewAs] = useState(false);
  const q = useApi<TenantInsight>(`/admin/insights/tenants/${id}`, { page: tlPage, pageSize: 15 });
  const managers = useApi<Person[]>('/admin/insights/managers');
  const refresh = ['/admin/insights/tenants', '/admin/tenants'];
  const save = useApiMutation((body: object) => patch(`/admin/insights/tenants/${id}`, body), { success: 'Ficha actualizada', invalidate: refresh });
  const addNote = useApiMutation((body: string) => post(`/admin/insights/tenants/${id}/notes`, { body }), { success: 'Nota guardada', invalidate: refresh });
  const delNote = useApiMutation((noteId: string) => del(`/admin/insights/tenants/${id}/notes/${noteId}`), { success: 'Nota eliminada', invalidate: refresh });

  const back = (
    <Link to="/admin/tenants" className="link-arrow">
      Volver a las bandas
    </Link>
  );
  if (q.isLoading) return <Page header={<PageHeader tone="warm" eyebrow="Clientes" title="Ficha de la banda" />}><Loading /></Page>;
  if (q.error || !q.data) return <Page header={<PageHeader tone="warm" eyebrow="Clientes" title="Ficha de la banda" />}><ErrorNote error={q.error} />{back}</Page>;
  const d = q.data;
  const t = d.tenant;
  const trend = (k: 'healthScore' | 'activeUsers30d' | 'mrrCents') => d.trend.map((p) => p[k]);

  return (
    <Page
      header={
        <PageHeader
          tone="warm"
          eyebrow="Clientes"
          title={t.name}
          description={
            <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <StatusChip value={t.status} map={tenantStatus} />
              <Chip>{d.plan.name}</Chip>
              {d.snapshot && <ScoreChip score={d.snapshot.healthScore} />}
              {t.tags.map((x) => <Tag key={x}>{x}</Tag>)}
              <span className="small">Gestor: {d.accountManager?.name ?? 'sin asignar'}</span>
            </span>
          }
          actions={<Button onClick={() => setViewAs(true)}>Ver como</Button>}
        />
      }
    >
      <div className="stack" style={{ gap: 24 }}>
        {back}
        <div className="grid grid--stats">
          <StatCard label="MRR" value={money(d.mrrCents)} tone="cream" hint={d.subscription?.interval === 'YEAR' ? 'Anual (÷ 12)' : 'Mensual'} />
          <StatCard label="Puntuación de salud" value={d.snapshot?.healthScore ?? '—'} meter={d.snapshot ? d.snapshot.healthScore / 100 : undefined} />
          <StatCard label="Usuarios activos (7 d / 30 d)" value={d.snapshot ? `${d.snapshot.activeUsers7d} / ${d.snapshot.activeUsers30d}` : '—'} />
          <StatCard label="Última actividad" value={date(d.lastActivityAt)} hint={`Alta: ${date(t.createdAt)}`} />
        </div>

        <div className="grid grid--2">
          <Card title="Uso frente a límites">
            <div className="stack" style={{ gap: 12 }}>
              {d.limits.map((l) => <LimitBar key={l.key} limit={l} />)}
              <p className="small muted">Almacenamiento usado: {bytes(t.storageUsedBytes)}</p>
            </div>
          </Card>
          <Card title="Tendencia (90 días)">
            {d.trend.length === 0 ? (
              <p className="muted">Aún no hay fotos diarias de esta banda.</p>
            ) : (
              <div className="stack" style={{ gap: 12 }}>
                <div className="row between"><span className="small">Salud</span><Sparkline values={trend('healthScore')} label="Salud" /></div>
                <div className="row between"><span className="small">Usuarios activos (30 d)</span><Sparkline values={trend('activeUsers30d')} label="Usuarios activos" /></div>
                <div className="row between"><span className="small">MRR</span><Sparkline values={trend('mrrCents')} label="MRR" format={money} /></div>
              </div>
            )}
          </Card>
        </div>

        <div className="grid grid--2">
          <Card title="Contactos">
            <ul className="list-plain list-divided">
              {d.contacts.map((c) => (
                <li key={c.id} className="row between">
                  <span><strong>{c.name}</strong> <span className="small muted">{c.role.name}</span><br /><a href={`mailto:${c.email}`}>{c.email}</a></span>
                  <span className="small muted">Visto: {date(c.lastSeenAt)}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Etiquetas y gestor">
            <form
              className="form"
              key={`${t.tags.join()}|${d.accountManager?.id}`}
              onSubmit={(e) => {
                e.preventDefault();
                const v = formValues(e.currentTarget);
                save.mutate({ tags: (v.tags ?? '').split(',').map((x) => x.trim()).filter(Boolean), accountManagerId: v.manager ?? null });
              }}
            >
              <TextField label="Etiquetas" name="tags" defaultValue={t.tags.join(', ')} hint="Separadas por comas." />
              <SelectField label="Gestor asignado" name="manager" defaultValue={d.accountManager?.id ?? ''} placeholder="Sin asignar" options={(managers.data ?? []).map((m) => ({ value: m.id, label: m.name }))} />
              <FormError error={save.error} />
              <div><Button type="submit" loading={save.isPending}>Guardar</Button></div>
            </form>
          </Card>
        </div>

        <Card title="Notas internas">
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const v = formValues(form);
              if (v.body) addNote.mutate(v.body, { onSuccess: () => form.reset() });
            }}
          >
            <TextAreaField label="Nueva nota" name="body" maxLength={4000} hint="Sólo la ve el equipo de plataforma." />
            <div><Button type="submit" loading={addNote.isPending}>Añadir nota</Button></div>
          </form>
          <ul className="list-plain list-divided" style={{ marginTop: 16 }}>
            {d.notes.map((n) => (
              <li key={n.id} className="row between">
                <span>{n.body}<br /><span className="small muted">{n.authorName ?? 'Equipo'} · {dateTime(n.createdAt)}</span></span>
                <Button size="sm" variant="ghost" onClick={() => delNote.mutate(n.id)} aria-label="Eliminar nota">Eliminar</Button>
              </li>
            ))}
            {d.notes.length === 0 && <li className="muted">Sin notas.</li>}
          </ul>
        </Card>

        <Card title="Cronología">
          <DataTable
            caption="Cronología de la banda"
            rows={d.timeline.data}
            rowKey={(r) => `${r.kind}-${r.ref ?? r.at}-${r.title}`}
            columns={[
              { key: 'a', header: 'Fecha', render: (r) => dateTime(r.at), nowrap: true },
              { key: 'k', header: 'Tipo', render: (r) => <Chip>{KIND_LABEL[r.kind] ?? r.kind}</Chip>, nowrap: true },
              { key: 't', header: 'Evento', render: (r) => <span>{r.title}{r.detail && <><br /><span className="small muted">{r.detail}</span></>}</span> },
            ]}
          />
          <Pagination page={d.timeline.page} pageSize={d.timeline.pageSize} total={d.timeline.total} onPage={setTlPage} />
        </Card>

        <Card title="Accesos «ver como»">
          <DataTable
            caption="Historial de accesos ver como"
            rows={d.impersonations}
            rowKey={(r) => r.id}
            empty="Nadie ha entrado como esta banda."
            columns={[
              { key: 'a', header: 'Inicio', render: (r) => dateTime(r.createdAt), nowrap: true },
              { key: 'u', header: 'Administrador', render: (r) => r.admin?.name ?? '—' },
              { key: 'r', header: 'Motivo', render: (r) => r.reason },
              { key: 'e', header: 'Estado', render: (r) => (r.active ? <Chip tone="warning">Activo</Chip> : <Chip>{r.endedAt ? 'Terminado' : 'Caducado'}</Chip>), nowrap: true },
            ]}
          />
        </Card>
        {back}
      </div>
      <ImpersonateModal tenantId={t.id} tenantName={t.name} open={viewAs} onClose={() => setViewAs(false)} />
    </Page>
  );
}
