import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { del, patch, post } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import type { AuditEntry, InstrumentCatalogItem, Paginated, Section, Session, Tenant } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { Person } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { StatusChip } from '../components/Chip';
import { DataTable, Pagination } from '../components/DataTable';
import { ErrorNote, Loading } from '../components/EmptyState';
import { FormError, SelectField, TextField, formValues } from '../components/Field';
import { Page, PageHeader } from '../components/PageHeader';
import { Tabs, type TabDef } from '../components/Tabs';
import { LogoEditor } from '../components/LogoEditor';
import { REGIONS } from '../components/admin/support/shared';
import { dateTime } from '../lib/format';
import { tenantStatus } from '../lib/labels';

function TenantTab() {
  const { reload, can, session, applyTokenSession, logout } = useAuth();
  const navigate = useNavigate();
  const q = useApi<Tenant & { region?: string | null }>('/tenant');
  const save = useApiMutation((body: unknown) => patch('/tenant', body), { success: 'Datos de la banda guardados', invalidate: ['/tenant'], onSuccess: () => reload() });
  const [deleting, setDeleting] = useState(false);
  const remove = useApiMutation(
    (body: { password: string; confirm: 'ELIMINAR' }) =>
      post<{ accessToken: string | null; session: Session | null; accountDeleted: boolean }>('/tenant/delete', body),
    {
      success: 'Banda eliminada',
      onSuccess: (res) => {
        if (res.accountDeleted || !res.accessToken || !res.session) {
          void logout().finally(() => navigate('/login', { replace: true }));
          return;
        }
        applyTokenSession({ accessToken: res.accessToken, session: res.session });
        navigate(res.session.memberships.length ? '/select-band' : '/onboarding', { replace: true });
      },
    },
  );
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorNote error={q.error} />;
  const t = q.data;
  const isOwner = session?.role?.key === 'owner';
  const preview = t.hasLogo ? `/api/v1/bands/${encodeURIComponent(t.slug)}/logo?v=${encodeURIComponent(t.logoVersion ?? '')}` : null;
  return (
    <div className="stack" style={{ gap: 24 }}>
    {can('tenant:manage') && (
    <Card title="Logotipo de la banda">
      <LogoEditor
        previewUrl={preview}
        confirmPath="/tenant/logo"
        deletePath="/tenant/logo"
        onChanged={() => {
          q.refetch();
          reload();
        }}
      />
    </Card>
    )}
    <Card title="Datos de la banda">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const v = formValues(e.currentTarget);
          save.mutate({ name: v.name, legalName: v.legalName ?? null, taxId: v.taxId ?? null, timezone: v.timezone, country: v.country, region: v.region ?? null });
        }}
      >
        <p>
          Estado: <StatusChip value={t.status} map={tenantStatus} /> · identificador <code>{t.slug}</code>
        </p>
        <TextField label="Nombre" name="name" required defaultValue={t.name} />
        <div className="form-row">
          <TextField label="Razón social" name="legalName" defaultValue={t.legalName ?? ''} />
          <TextField label="CIF / NIF" name="taxId" defaultValue={t.taxId ?? ''} hint="Aparece en tus facturas." />
        </div>
        <div className="form-row">
          <TextField label="País (ISO)" name="country" defaultValue={t.country} maxLength={2} />
          <TextField label="Zona horaria" name="timezone" defaultValue={t.timezone} />
        </div>
        <SelectField label="Comunidad autónoma" name="region" defaultValue={t.region ?? ''} placeholder="Sin indicar" options={REGIONS.map((r) => ({ value: r, label: r }))} hint="Nos ayuda a avisaros de novedades que afecten a vuestra comunidad." />
        <FormError error={save.error} />
        <div>
          <Button type="submit" loading={save.isPending}>
            Guardar
          </Button>
        </div>
      </form>
    </Card>
    {isOwner && (
      <Card title="Eliminar banda">
        {!deleting ? (
          <div className="stack">
            <p className="small">
              Se eliminan los ficheros de la banda y las cuentas que sólo pertenecían a ella. Quien también está en otra
              banda conserva su cuenta, pero pierde el acceso a ésta. Se cancela la suscripción si la hay y el identificador{' '}
              <code>{t.slug}</code> queda libre. Esta acción no se puede deshacer.
            </p>
            <div>
              <Button variant="danger" onClick={() => setDeleting(true)}>
                Eliminar esta banda
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              const v = formValues(e.currentTarget);
              if (v.confirm !== 'ELIMINAR') return;
              remove.mutate({ password: v.password ?? '', confirm: 'ELIMINAR' });
            }}
          >
            <TextField label="Contraseña" name="password" type="password" autoComplete="current-password" required />
            <TextField label='Escribe ELIMINAR para confirmar' name="confirm" required autoComplete="off" hint="Mayúsculas, sin espacios." />
            <FormError error={remove.error} />
            <div className="row">
              <Button type="submit" variant="danger" loading={remove.isPending}>
                Confirmar eliminación
              </Button>
              <Button variant="ghost" type="button" onClick={() => setDeleting(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        )}
      </Card>
    )}
    </div>
  );
}


function SectionsTab() {
  const q = useApi<Section[]>('/sections');
  const create = useApiMutation((body: unknown) => post('/sections', body), { success: 'Sección creada', invalidate: ['/sections'] });
  const remove = useApiMutation((id: string) => del(`/sections/${id}`), { success: 'Sección eliminada', invalidate: ['/sections'] });
  return (
    <Card title="Secciones / cuerdas">
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const v = formValues(form);
          if (v.name) create.mutate({ name: v.name, position: (q.data?.length ?? 0) + 1 }, { onSuccess: () => form.reset() });
        }}
      >
        <TextField label="Nueva sección" name="name" placeholder="Clarinetes" />
        <Button type="submit" loading={create.isPending}>
          Añadir
        </Button>
      </form>
      {q.isLoading && <Loading />}
      <ul className="list-plain list-divided" style={{ marginTop: 16 }}>
        {(q.data ?? []).map((s) => (
          <li key={s.id} className="row between">
            <span>{s.name}</span>
            <Button size="sm" variant="danger" onClick={() => remove.mutate(s.id)} aria-label={`Eliminar sección ${s.name}`}>
              Eliminar
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function InstrumentsCatalogTab() {
  const q = useApi<InstrumentCatalogItem[]>('/instrument-catalog');
  const create = useApiMutation((body: unknown) => post('/instrument-catalog', body), {
    success: 'Instrumento añadido',
    invalidate: ['/instrument-catalog'],
  });
  const remove = useApiMutation((id: string) => del(`/instrument-catalog/${id}`), {
    success: 'Instrumento eliminado',
    invalidate: ['/instrument-catalog'],
  });
  return (
    <Card title="Instrumentos">
      <p className="small muted" style={{ marginBottom: 12 }}>
        Lista usada en fichas de socios, alumnos y demás formularios. Se puede dejar el campo en blanco.
      </p>
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const v = formValues(form);
          if (v.name) create.mutate({ name: v.name, position: (q.data?.length ?? 0) + 1 }, { onSuccess: () => form.reset() });
        }}
      >
        <TextField label="Nuevo instrumento" name="name" placeholder="Clarinete en Si♭" maxLength={60} />
        <Button type="submit" loading={create.isPending}>
          Añadir
        </Button>
      </form>
      {q.isLoading && <Loading />}
      <ul className="list-plain list-divided" style={{ marginTop: 16 }}>
        {(q.data ?? []).map((s) => (
          <li key={s.id} className="row between">
            <span>{s.name}</span>
            <Button size="sm" variant="danger" onClick={() => remove.mutate(s.id)} aria-label={`Eliminar instrumento ${s.name}`}>
              Eliminar
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AuditTab() {
  const [entity, setEntity] = useState('');
  const [page, setPage] = useState(1);
  const q = useApi<Paginated<AuditEntry>>('/audit-logs', { entity, page, pageSize: 50 });
  return (
    <div className="stack" style={{ gap: 24 }}>
      <Card>
        <div className="toolbar">
          <TextField label="Entidad" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }} placeholder="member, work, transaction…" />
        </div>
      </Card>
      {q.isLoading && <Loading />}
      {q.error && <ErrorNote error={q.error} />}
      {q.data && (
        <Card>
          <p className="small muted" style={{ marginBottom: 12 }}>
            Registro inalterable de acciones. No incluye datos personales sensibles.
          </p>
          <DataTable
            caption="Registro de auditoría"
            rows={q.data.data}
            rowKey={(a) => a.id}
            columns={[
              { key: 'd', header: 'Fecha', render: (a) => dateTime(a.createdAt), nowrap: true },
              { key: 'u', header: 'Usuario', render: (a) => <Person name={a.actor?.name ?? (a.actorId ? `Usuario ${a.actorId.slice(0, 8)}` : 'Sistema')} /> },
              { key: 'a', header: 'Acción', render: (a) => <code>{a.action}</code> },
              { key: 'e', header: 'Entidad', render: (a) => `${a.entity}${a.entityId ? ` · ${a.entityId.slice(0, 8)}` : ''}` },
            ]}
          />
          <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />
        </Card>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { can } = useAuth();
  const tabs: TabDef[] = [];
  if (can('tenant:manage')) tabs.push({ id: 'tenant', label: 'Banda', content: <TenantTab /> });
  if (can('tenant:manage') || can('members:write')) {
    tabs.push({ id: 'sections', label: 'Secciones', content: <SectionsTab /> });
    tabs.push({ id: 'instruments', label: 'Instrumentos', content: <InstrumentsCatalogTab /> });
  }
  if (can('audit:read')) tabs.push({ id: 'audit', label: 'Auditoría', content: <AuditTab /> });
  return (
    <Page header={<PageHeader tone="cream" eyebrow="Ajustes" title="Configuración de la banda" />}>
      <Tabs label="Ajustes" tabs={tabs} />
    </Page>
  );
}
