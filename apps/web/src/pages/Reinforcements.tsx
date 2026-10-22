import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, del, downloadFile, patch, post, put } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import type { EventItem as BandEvent, Paginated } from '../api/types';
import type {
  ExternalMusician,
  MusicianProfile,
  MyApplication,
  OwnReinforcementRequest,
  PaymentSummary,
  Prefill,
  PublicReinforcementRequest,
  ReinforcementPayment,
  RequestApplication,
} from '../api/types-performances';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/Button';
import { Card, StatCard } from '../components/Card';
import { Chip, StatusChip, Tag } from '../components/Chip';
import { DataTable, Pagination } from '../components/DataTable';
import { EmptyState, ErrorNote, Loading } from '../components/EmptyState';
import { Checkbox, FormError, SelectField, TextAreaField, TextField, formValues } from '../components/Field';
import { Menu } from '../components/Menu';
import { ConfirmModal, Modal } from '../components/Modal';
import { Page, PageHeader } from '../components/PageHeader';
import { withholding } from '../components/performances/totals';
import { Tabs } from '../components/Tabs';
import { date, dateTime, money, parseMoney, toLocalInput, today } from '../lib/format';
import { applicationDecision, PROVINCES, reinforcementStatus } from '../lib/labels-performances';

const provinceOptions = PROVINCES.slice().sort((a, b) => a.localeCompare(b, 'es')).map((p) => ({ value: p, label: p }));
const name = (m?: { firstName: string; lastName: string } | null) => (m ? `${m.firstName} ${m.lastName}`.trim() : '—');

// ── Necesidades abiertas ────────────────────────────────────────────────────

function OpenRequestsTab({ goProfile }: { goProfile: () => void }) {
  const [filters, setFilters] = useState({ instrument: '', province: '', from: '', to: '' });
  const [pageNo, setPageNo] = useState(1);
  const q = useApi<Paginated<PublicReinforcementRequest>>('/reinforcements/requests', { ...filters, page: pageNo, pageSize: 20 });
  const [applying, setApplying] = useState<PublicReinforcementRequest | null>(null);
  const apply = useApiMutation((b: { id: string; message?: string }) => post(`/reinforcements/requests/${b.id}/apply`, { message: b.message ?? null }), {
    success: 'Candidatura enviada a la banda',
    invalidate: ['/reinforcements'],
    onSuccess: () => setApplying(null),
  });
  const set = (k: keyof typeof filters) => (e: { target: { value: string } }) => (setFilters((f) => ({ ...f, [k]: e.target.value })), setPageNo(1));
  const needsProfile = apply.error instanceof ApiError && apply.error.code === 'PROFILE_REQUIRED';

  return (
    <div className="stack" style={{ gap: 24 }}>
      <Card>
        <div className="toolbar">
          <TextField label="Instrumento" value={filters.instrument} onChange={set('instrument')} placeholder="Trompeta, tuba…" />
          <SelectField label="Provincia" value={filters.province} onChange={set('province')} placeholder="Todas" options={provinceOptions} />
          <TextField label="Desde" type="date" value={filters.from} onChange={set('from')} />
          <TextField label="Hasta" type="date" value={filters.to} onChange={set('to')} />
        </div>
      </Card>
      {q.isLoading && <Loading />}
      {q.error && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}
      {q.data && q.data.data.length === 0 && (
        <EmptyState title="No hay necesidades abiertas" icon="search">
          Cuando una banda publique que necesita refuerzos de tu instrumento aparecerá aquí.
        </EmptyState>
      )}
      <div className="grid grid--2">
        {q.data?.data.map((r) => (
          <Card
            key={r.id}
            as="article"
            headingLevel={3}
            title={r.title}
            actions={<StatusChip value={r.status} map={reinforcementStatus} />}
            footer={
              r.isMine ? (
                <span className="small muted">Necesidad de tu banda</span>
              ) : r.myApplication && r.myApplication !== 'WITHDRAWN' ? (
                <StatusChip value={r.myApplication} map={applicationDecision} />
              ) : (
                <Button size="sm" onClick={() => (apply.reset(), setApplying(r))}>
                  Presentarme
                </Button>
              )
            }
          >
            <p className="small muted" style={{ marginTop: 0 }}>
              {r.band.name} · {dateTime(r.date)} · {[r.location, r.province].filter(Boolean).join(', ')}
            </p>
            <div className="chips">
              <Tag>{r.instrument}</Tag>
              <Chip tone="info">{r.quantity === 1 ? '1 plaza' : `${r.quantity} plazas`}</Chip>
              {r.feeCents ? <Chip tone="success">{money(r.feeCents)}</Chip> : null}
            </div>
            {r.description && <p style={{ whiteSpace: 'pre-wrap' }}>{r.description}</p>}
          </Card>
        ))}
      </div>
      {q.data && <Pagination page={pageNo} pageSize={q.data.pageSize} total={q.data.total} onPage={setPageNo} />}
      <Modal open={!!applying} onClose={() => setApplying(null)} title={`Presentarme: ${applying?.title ?? ''}`}>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            if (applying) apply.mutate({ id: applying.id, message: v.message });
          }}
        >
          <p className="small">La banda verá tu perfil de músico (nombre, instrumentos, provincia y presentación) y este mensaje. Tu email sólo se comparte si te aceptan.</p>
          <TextAreaField label="Mensaje para la banda" name="message" maxLength={2000} rows={4} />
          {needsProfile ? (
            <div className="callout">
              <p>Antes de presentarte completa tu perfil de músico.</p>
              <Button size="sm" variant="ghost" onClick={() => (setApplying(null), goProfile())}>
                Ir a mi perfil
              </Button>
            </div>
          ) : (
            <FormError error={apply.error} />
          )}
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setApplying(null)}>
              Cancelar
            </Button>
            <Button type="submit" loading={apply.isPending}>
              Enviar candidatura
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function MyApplicationsTab() {
  const q = useApi<MyApplication[]>('/reinforcements/my-applications');
  const withdraw = useApiMutation((id: string) => post(`/reinforcements/my-applications/${id}/withdraw`), { success: 'Candidatura retirada', invalidate: ['/reinforcements'] });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />;
  return (
    <Card>
      <DataTable
        caption="Mis candidaturas"
        rows={q.data}
        rowKey={(a) => a.id}
        empty="Todavía no te has presentado a ninguna necesidad."
        columns={[
          { key: 't', header: 'Necesidad', render: (a) => <strong>{a.request.title}</strong> },
          { key: 'b', header: 'Banda', render: (a) => a.request.band.name },
          { key: 'i', header: 'Instrumento', render: (a) => a.request.instrument },
          { key: 'd', header: 'Fecha', render: (a) => dateTime(a.request.date), nowrap: true },
          { key: 's', header: 'Estado', render: (a) => <StatusChip value={a.status} map={applicationDecision} /> },
          {
            key: 'a',
            header: 'Acciones',
            render: (a) =>
              a.status === 'PENDING' ? (
                <Button size="sm" variant="ghost" loading={withdraw.isPending && withdraw.variables === a.id} onClick={() => withdraw.mutate(a.id)}>
                  Retirar
                </Button>
              ) : null,
          },
        ]}
      />
    </Card>
  );
}

function ProfileTab() {
  const q = useApi<{ profile: MusicianProfile | null }>('/reinforcements/profile');
  const [removing, setRemoving] = useState(false);
  const save = useApiMutation((body: unknown) => put('/reinforcements/profile', body), { success: 'Perfil guardado', invalidate: ['/reinforcements'] });
  const remove = useApiMutation(() => del('/reinforcements/profile'), { success: 'Perfil eliminado', invalidate: ['/reinforcements'], onSuccess: () => setRemoving(false) });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />;
  const p = q.data.profile;
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const v = formValues(form);
    save.mutate({
      displayName: v.displayName,
      instruments: (v.instruments ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      province: v.province,
      city: v.city ?? null,
      bio: v.bio ?? null,
      available: (form.elements.namedItem('available') as HTMLInputElement).checked,
    });
  }
  return (
    <Card title="Mi perfil de músico" tone="cream">
      <p className="small">
        Tu perfil es personal y sirve para todas las bandas de Solfeggio. Las bandas que buscan refuerzos ven tu nombre, instrumentos, provincia, localidad y
        presentación; nunca tu email ni tu teléfono. Si te contactan, recibirás el mensaje por email.
      </p>
      <form className="form" key={p?.id ?? 'new'} onSubmit={submit}>
        <div className="form-row">
          <TextField label="Nombre artístico o completo" name="displayName" required minLength={2} maxLength={80} defaultValue={p?.displayName} />
          <TextField label="Instrumentos" name="instruments" required defaultValue={p?.instruments.join(', ')} hint="Separados por comas" placeholder="Trompeta, fliscorno" />
        </div>
        <div className="form-row">
          <SelectField label="Provincia" name="province" required defaultValue={p?.province ?? ''} placeholder="Elige provincia" options={provinceOptions} />
          <TextField label="Localidad" name="city" maxLength={80} defaultValue={p?.city ?? ''} />
        </div>
        <TextAreaField label="Presentación" name="bio" maxLength={1000} rows={4} defaultValue={p?.bio ?? ''} hint="Formación, experiencia, disponibilidad…" />
        <Checkbox label="Disponible para recibir propuestas" name="available" defaultChecked={p?.available ?? true} />
        <FormError error={save.error} />
        <div className="row">
          <Button type="submit" loading={save.isPending}>
            Guardar perfil
          </Button>
          {p && (
            <Button variant="ghost" onClick={() => setRemoving(true)}>
              Eliminar perfil
            </Button>
          )}
        </div>
      </form>
      <ConfirmModal
        open={removing}
        title="Eliminar perfil de músico"
        message="Dejarás de aparecer en las búsquedas de las bandas."
        confirmLabel="Eliminar"
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
        onClose={() => setRemoving(false)}
      />
    </Card>
  );
}

// ── Gestión: necesidades de la banda ────────────────────────────────────────

function RequestModal({ open, onClose, request }: { open: boolean; onClose: () => void; request?: OwnReinforcementRequest | null }) {
  const events = useApi<BandEvent[]>('/events', { from: new Date().toISOString() });
  const [eventId, setEventId] = useState(request?.eventId ?? '');
  const prefill = useApi<Prefill>(!request && eventId ? '/reinforcements/requests/prefill' : null, { eventId });
  const [draft, setDraft] = useState({ instrument: request?.instrument ?? '', quantity: String(request?.quantity ?? 1), date: toLocalInput(request?.date), location: request?.location ?? '', title: request?.title ?? '' });
  const save = useApiMutation((body: unknown) => (request ? patch(`/reinforcements/requests/${request.id}`, body) : post('/reinforcements/requests', body)), {
    success: request ? 'Necesidad actualizada' : 'Necesidad publicada en la bolsa',
    invalidate: ['/reinforcements'],
    onSuccess: onClose,
  });
  // Al vincular un evento se proponen la fecha, el lugar y la primera vacante de la plantilla.
  useEffect(() => {
    const p = prefill.data;
    if (!p) return;
    const v = p.vacancies[0];
    setDraft((d) => ({
      title: d.title || p.event.title,
      date: d.date || toLocalInput(p.event.startsAt),
      location: d.location || (p.event.location ?? ''),
      instrument: v ? v.instrument : d.instrument,
      quantity: v ? String(v.quantity) : d.quantity,
    }));
  }, [prefill.data]);
  const bind = (k: keyof typeof draft) => ({ value: draft[k], onChange: (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value })) });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    save.mutate({
      title: draft.title, instrument: draft.instrument, quantity: parseInt(draft.quantity, 10) || 1,
      date: new Date(draft.date).toISOString(), province: v.province, location: draft.location || null,
      feeCents: v.fee ? parseMoney(v.fee) : null, description: v.description ?? null, eventId: eventId || null,
    });
  }
  return (
    <Modal open={open} onClose={onClose} title={request ? 'Editar necesidad' : 'Publicar necesidad de refuerzos'}>
      <form className="form" onSubmit={submit}>
        <SelectField
          label="Evento de la banda (opcional)"
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
          placeholder="Sin vincular"
          options={(events.data ?? []).filter((x) => x.status === 'SCHEDULED').map((x) => ({ value: x.id, label: `${x.title} · ${date(x.startsAt)}` }))}
        />
        {prefill.data && (
          <p className="small muted">
            {prefill.data.vacancies.length
              ? `Vacantes de la plantilla: ${prefill.data.vacancies.map((v) => `${v.instrument} (${v.quantity})`).join(', ')}.`
              : 'La plantilla mínima del evento está cubierta o no está definida.'}
          </p>
        )}
        <TextField label="Título" required minLength={3} maxLength={160} {...bind('title')} />
        <div className="form-row">
          <TextField label="Instrumento" required maxLength={60} {...bind('instrument')} />
          <TextField label="Plazas" type="number" min={1} max={50} required {...bind('quantity')} />
        </div>
        <div className="form-row">
          <TextField label="Fecha y hora" type="datetime-local" required {...bind('date')} />
          <SelectField label="Provincia" name="province" required defaultValue={request?.province ?? ''} placeholder="Elige provincia" options={provinceOptions} />
        </div>
        <div className="form-row">
          <TextField label="Lugar" maxLength={200} {...bind('location')} />
          <TextField label="Caché por músico (€)" name="fee" inputMode="decimal" defaultValue={request?.feeCents ? (request.feeCents / 100).toFixed(2).replace('.', ',') : ''} />
        </div>
        <TextAreaField label="Descripción" name="description" maxLength={4000} defaultValue={request?.description ?? ''} hint="Repertorio, uniforme, ensayos previos, desplazamiento…" />
        <FormError error={save.error} />
        <div className="modal__footer">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {request ? 'Guardar' : 'Publicar'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ApplicationsModal({ request, onClose }: { request: OwnReinforcementRequest | null; onClose: () => void }) {
  const q = useApi<RequestApplication[]>(request ? `/reinforcements/requests/${request.id}/applications` : null);
  const decide = useApiMutation((b: { id: string; action: 'accept' | 'reject' }) => post(`/reinforcements/applications/${b.id}/${b.action}`), {
    success: 'Candidatura actualizada. Se ha avisado al músico por email.',
    invalidate: ['/reinforcements'],
  });
  return (
    <Modal open={!!request} onClose={onClose} title={`Candidaturas: ${request?.title ?? ''}`}>
      {q.isLoading && <Loading />}
      {q.error && <ErrorNote error={q.error} />}
      {q.data && q.data.length === 0 && <p className="muted">Todavía no se ha presentado nadie.</p>}
      <ul className="list-plain list-divided">
        {q.data?.map((a) => (
          <li key={a.id} className="stack" style={{ gap: 6 }}>
            <div className="row between">
              <strong>{a.musician?.displayName ?? 'Perfil eliminado'}</strong>
              <StatusChip value={a.status} map={applicationDecision} />
            </div>
            {a.musician && (
              <span className="small muted">
                {a.musician.instruments.join(', ')} · {[a.musician.city, a.musician.province].filter(Boolean).join(', ')}
              </span>
            )}
            {a.musician?.bio && <p className="small" style={{ margin: 0 }}>{a.musician.bio}</p>}
            {a.message && <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>«{a.message}»</p>}
            {a.status === 'PENDING' && request?.status === 'OPEN' && (
              <div className="row">
                <Button size="sm" onClick={() => decide.mutate({ id: a.id, action: 'accept' })} disabled={decide.isPending}>
                  Aceptar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: a.id, action: 'reject' })} disabled={decide.isPending}>
                  Descartar
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="small muted">Al aceptar, el músico se añade a vuestros músicos externos (con su email) para gestionar el pago.</p>
    </Modal>
  );
}

function OurRequestsTab() {
  const q = useApi<OwnReinforcementRequest[]>('/reinforcements/requests/mine');
  const [editing, setEditing] = useState<OwnReinforcementRequest | null>(null);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<OwnReinforcementRequest | null>(null);
  const [deleting, setDeleting] = useState<OwnReinforcementRequest | null>(null);
  const setStatus = useApiMutation((b: { id: string; status: string }) => patch(`/reinforcements/requests/${b.id}`, { status: b.status }), {
    success: 'Necesidad actualizada',
    invalidate: ['/reinforcements'],
  });
  const remove = useApiMutation((id: string) => del(`/reinforcements/requests/${id}`), { success: 'Necesidad eliminada', invalidate: ['/reinforcements'], onSuccess: () => setDeleting(null) });
  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="row">
        <Button onClick={() => setCreating(true)}>Publicar necesidad</Button>
      </div>
      {q.isLoading && <Loading />}
      {q.error && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}
      {q.data && (
        <Card>
          <DataTable
            caption="Nuestras necesidades de refuerzos"
            rows={q.data}
            rowKey={(r) => r.id}
            empty="Publica una necesidad cuando falten músicos para un evento: la verán los músicos y bandas de toda la plataforma."
            columns={[
              { key: 't', header: 'Necesidad', render: (r) => <strong>{r.title}</strong> },
              { key: 'i', header: 'Instrumento', render: (r) => `${r.instrument} × ${r.quantity}` },
              { key: 'd', header: 'Fecha', render: (r) => dateTime(r.date), nowrap: true },
              { key: 's', header: 'Estado', render: (r) => <StatusChip value={r.status} map={reinforcementStatus} /> },
              {
                key: 'c',
                header: 'Candidaturas',
                render: (r) => (
                  <Button size="sm" variant="ghost" onClick={() => setViewing(r)}>
                    {r.applications.pending} pendientes · {r.applications.accepted} aceptadas
                  </Button>
                ),
              },
              {
                key: 'a',
                header: 'Acciones',
                render: (r) => (
                  <Menu
                    label={`Acciones de ${r.title}`}
                    items={[
                      { label: 'Editar', onSelect: () => setEditing(r) },
                      ...(r.status === 'OPEN'
                        ? [{ label: 'Marcar como cubierta', onSelect: () => setStatus.mutate({ id: r.id, status: 'FILLED' }) }, { label: 'Cancelar', onSelect: () => setStatus.mutate({ id: r.id, status: 'CANCELLED' }) }]
                        : [{ label: 'Reabrir', onSelect: () => setStatus.mutate({ id: r.id, status: 'OPEN' }) }]),
                      { label: 'Eliminar', danger: true, onSelect: () => setDeleting(r) },
                    ]}
                  />
                ),
              },
            ]}
          />
        </Card>
      )}
      {(creating || editing) && <RequestModal open request={editing} onClose={() => (setCreating(false), setEditing(null))} />}
      <ApplicationsModal request={viewing} onClose={() => setViewing(null)} />
      <ConfirmModal
        open={!!deleting}
        title="Eliminar necesidad"
        message="Se eliminarán también sus candidaturas."
        confirmLabel="Eliminar"
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

function MusiciansTab() {
  const [filters, setFilters] = useState({ instrument: '', province: '' });
  const q = useApi<Omit<MusicianProfile, 'updatedAt'>[]>('/reinforcements/musicians', filters);
  const requests = useApi<OwnReinforcementRequest[]>('/reinforcements/requests/mine');
  const open = (requests.data ?? []).filter((r) => r.status === 'OPEN');
  const [contacting, setContacting] = useState<MusicianProfile | null>(null);
  const contact = useApiMutation((b: { id: string; requestId: string; message: string }) => post(`/reinforcements/musicians/${b.id}/contact`, { requestId: b.requestId, message: b.message }), {
    success: 'Propuesta enviada por email al músico',
    onSuccess: () => setContacting(null),
  });
  return (
    <div className="stack" style={{ gap: 24 }}>
      <Card>
        <div className="toolbar">
          <TextField label="Instrumento" value={filters.instrument} onChange={(e) => setFilters((f) => ({ ...f, instrument: e.target.value }))} />
          <SelectField label="Provincia" value={filters.province} onChange={(e) => setFilters((f) => ({ ...f, province: e.target.value }))} placeholder="Todas" options={provinceOptions} />
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Sólo aparecen músicos disponibles. Su email no se muestra: la propuesta se le envía desde Solfeggio y responde presentándose a vuestra necesidad.
        </p>
      </Card>
      {q.isLoading && <Loading />}
      {q.error && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && <EmptyState title="Sin músicos con esos filtros" icon="search" />}
      <div className="grid grid--2">
        {q.data?.map((m) => (
          <Card
            key={m.id}
            as="article"
            headingLevel={3}
            title={m.displayName}
            footer={
              <Button size="sm" variant="ghost" onClick={() => (contact.reset(), setContacting(m))} disabled={!open.length} title={open.length ? undefined : 'Publica antes una necesidad'}>
                Proponer refuerzo
              </Button>
            }
          >
            <p className="small muted" style={{ marginTop: 0 }}>
              {[m.city, m.province].filter(Boolean).join(', ')}
            </p>
            <div className="chips">
              {m.instruments.map((i) => (
                <Tag key={i}>{i}</Tag>
              ))}
            </div>
            {m.bio && <p className="small">{m.bio}</p>}
          </Card>
        ))}
      </div>
      <Modal open={!!contacting} onClose={() => setContacting(null)} title={`Proponer a ${contacting?.displayName ?? ''}`}>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            if (contacting && v.requestId && v.message) contact.mutate({ id: contacting.id, requestId: v.requestId, message: v.message });
          }}
        >
          <SelectField label="Necesidad" name="requestId" required options={open.map((r) => ({ value: r.id, label: `${r.title} · ${r.instrument} · ${date(r.date)}` }))} />
          <TextAreaField label="Mensaje" name="message" required minLength={5} maxLength={2000} rows={4} />
          <FormError error={contact.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setContacting(null)}>
              Cancelar
            </Button>
            <Button type="submit" loading={contact.isPending}>
              Enviar
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ── Gestión: músicos externos y pagos ───────────────────────────────────────

function ExternalModal({ musician, onClose }: { musician: ExternalMusician | null | 'new'; onClose: () => void }) {
  const { can } = useAuth();
  const sensitive = can('members:sensitive');
  const m = musician === 'new' ? null : musician;
  const save = useApiMutation((body: unknown) => (m ? patch(`/reinforcements/external-musicians/${m.id}`, body) : post('/reinforcements/external-musicians', body)), {
    success: 'Músico guardado',
    invalidate: ['/reinforcements'],
    onSuccess: onClose,
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    save.mutate({
      firstName: v.firstName, lastName: v.lastName ?? '', instrument: v.instrument ?? null, email: v.email ?? null, phone: v.phone ?? null,
      ...(sensitive && { nationalId: v.nationalId ?? null, iban: v.iban ?? null }),
    });
  }
  return (
    <Modal open={!!musician} onClose={onClose} title={m ? 'Editar músico externo' : 'Nuevo músico externo'}>
      <form className="form" key={m?.id ?? 'new'} onSubmit={submit}>
        <div className="form-row">
          <TextField label="Nombre" name="firstName" required maxLength={80} defaultValue={m?.firstName} />
          <TextField label="Apellidos" name="lastName" maxLength={120} defaultValue={m?.lastName} />
        </div>
        <div className="form-row">
          <TextField label="Instrumento" name="instrument" maxLength={60} defaultValue={m?.instrument ?? ''} />
          <TextField label="Teléfono" name="phone" maxLength={30} defaultValue={m?.phone ?? ''} />
        </div>
        <TextField label="Email" name="email" type="email" defaultValue={m?.email ?? ''} />
        {sensitive ? (
          <div className="form-row">
            <TextField label="NIF" name="nationalId" maxLength={20} defaultValue={m?.nationalId ?? ''} hint="Necesario para el modelo 190" />
            <TextField label="IBAN" name="iban" defaultValue={m?.iban ?? ''} />
          </div>
        ) : (
          <p className="small muted">El NIF y el IBAN sólo los gestiona quien tiene permiso para ver datos sensibles.</p>
        )}
        <FormError error={save.error} />
        <div className="modal__footer">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            Guardar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PaymentModal({ open, onClose, musicians }: { open: boolean; onClose: () => void; musicians: ExternalMusician[] }) {
  const [gross, setGross] = useState('');
  const [pct, setPct] = useState(15);
  const save = useApiMutation((body: unknown) => post('/reinforcements/payments', body), { success: 'Pago registrado', invalidate: ['/reinforcements'], onSuccess: onClose });
  const preview = withholding(parseMoney(gross), pct);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    save.mutate({ musicianId: v.musicianId, concept: v.concept, date: v.date, grossCents: parseMoney(gross), withholdingPct: pct });
  }
  return (
    <Modal open={open} onClose={onClose} title="Nuevo pago a músico">
      <form className="form" onSubmit={submit}>
        <SelectField label="Músico" name="musicianId" required placeholder="Elige un músico" options={musicians.map((m) => ({ value: m.id, label: `${name(m)}${m.instrument ? ` · ${m.instrument}` : ''}` }))} />
        <TextField label="Concepto" name="concept" required maxLength={200} placeholder="Refuerzo procesión del Corpus" />
        <div className="form-row">
          <TextField label="Fecha" name="date" type="date" required defaultValue={today()} />
          <TextField label="Importe bruto (€)" required inputMode="decimal" value={gross} onChange={(e) => setGross(e.target.value)} />
          <TextField label="Retención IRPF (%)" type="number" min={0} max={50} value={pct} onChange={(e) => setPct(Math.max(0, Math.min(50, parseInt(e.target.value, 10) || 0)))} />
        </div>
        <p className="small" aria-live="polite">
          Retención: <strong>{money(preview.withholdingCents)}</strong> · Neto a pagar: <strong>{money(preview.netCents)}</strong>
        </p>
        <FormError error={save.error} />
        <div className="modal__footer">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            Guardar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PaymentsTab() {
  const { can } = useAuth();
  const sensitive = can('members:sensitive');
  const [year, setYear] = useState(new Date().getFullYear());
  const musicians = useApi<ExternalMusician[]>('/reinforcements/external-musicians');
  const payments = useApi<ReinforcementPayment[]>('/reinforcements/payments', { year });
  const summary = useApi<PaymentSummary>('/reinforcements/payments/summary', { year });
  const [editingMusician, setEditingMusician] = useState<ExternalMusician | null | 'new'>(null);
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<ReinforcementPayment | null>(null);
  const pay = useApiMutation((b: { id: string; date: string }) => post(`/reinforcements/payments/${b.id}/pay`, { date: b.date }), {
    success: 'Pago registrado en tesorería',
    invalidate: ['/reinforcements', '/finance'],
    onSuccess: () => setPaying(null),
  });
  const remove = useApiMutation((id: string) => del(`/reinforcements/payments/${id}`), { success: 'Pago eliminado', invalidate: ['/reinforcements'] });
  const removeMusician = useApiMutation((id: string) => del(`/reinforcements/external-musicians/${id}`), { success: 'Músico eliminado', invalidate: ['/reinforcements'] });
  const s = summary.data;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="grid grid--stats">
        <StatCard label={`Bruto pagado ${year}`} value={money(s?.totals.grossCents ?? 0)} />
        <StatCard label="Retenciones (modelo 111)" value={money(s?.totals.withholdingCents ?? 0)} tone="cream" />
        <StatCard label="Perceptores (modelo 190)" value={s?.totals.perceptors ?? 0} tone="cool" />
      </div>

      <Card
        title="Pagos"
        actions={
          <>
            <TextField label="Ejercicio" type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(parseInt(e.target.value, 10) || new Date().getFullYear())} style={{ maxWidth: 110 }} />
            <Button onClick={() => setCreating(true)} disabled={!musicians.data?.length}>
              Nuevo pago
            </Button>
          </>
        }
      >
        {payments.isLoading && <Loading />}
        {payments.error && <ErrorNote error={payments.error} />}
        {payments.data && (
          <DataTable
            caption="Pagos a músicos de refuerzo"
            rows={payments.data}
            rowKey={(p) => p.id}
            empty="Registra los pagos a refuerzos con su retención de IRPF."
            columns={[
              { key: 'd', header: 'Fecha', render: (p) => date(p.date), nowrap: true },
              { key: 'm', header: 'Músico', render: (p) => name(p.musician) },
              { key: 'c', header: 'Concepto', render: (p) => p.concept },
              { key: 'g', header: 'Bruto', render: (p) => money(p.grossCents), numeric: true, nowrap: true },
              { key: 'w', header: 'Retención', render: (p) => `${money(p.withholdingCents)} (${p.withholdingPct} %)`, numeric: true, nowrap: true },
              { key: 'n', header: 'Neto', render: (p) => money(p.netCents), numeric: true, nowrap: true },
              { key: 's', header: 'Estado', render: (p) => (p.paidAt ? <Chip tone="success">Pagado</Chip> : <Chip tone="warning">Pendiente</Chip>) },
              {
                key: 'a',
                header: 'Acciones',
                render: (p) =>
                  p.paidAt ? null : (
                    <Menu
                      label={`Acciones del pago a ${name(p.musician)}`}
                      items={[
                        { label: 'Registrar pago', onSelect: () => setPaying(p) },
                        { label: 'Eliminar', danger: true, onSelect: () => remove.mutate(p.id) },
                      ]}
                    />
                  ),
              },
            ]}
          />
        )}
      </Card>

      <Card
        title={`Resumen anual ${year}`}
        tone="cream"
        actions={
          sensitive && (
            <Button size="sm" variant="ghost" onClick={() => downloadFile(`/reinforcements/payments/summary.csv?year=${year}`, `retenciones-refuerzos-${year}.csv`)}>
              Descargar CSV (190/111)
            </Button>
          )
        }
      >
        <p className="small muted">Pagos realizados por perceptor: datos de partida para los modelos 111 y 190. Revísalos con vuestra gestoría antes de presentarlos.</p>
        {s && (
          <DataTable
            caption="Resumen anual por perceptor"
            rows={s.rows}
            rowKey={(r) => r.musician.id}
            empty="Sin pagos realizados en este ejercicio."
            columns={[
              { key: 'm', header: 'Perceptor', render: (r) => name(r.musician) },
              { key: 'nif', header: 'NIF', render: (r) => (sensitive ? <span className="mono">{r.musician.nationalId ?? '—'}</span> : r.musician.hasNationalId ? 'Registrado' : <Chip tone="warning">Falta</Chip>) },
              { key: 'p', header: 'Pagos', render: (r) => r.payments, numeric: true },
              { key: 'g', header: 'Bruto', render: (r) => money(r.grossCents), numeric: true, nowrap: true },
              { key: 'w', header: 'Retención', render: (r) => money(r.withholdingCents), numeric: true, nowrap: true },
              { key: 'n', header: 'Neto', render: (r) => money(r.netCents), numeric: true, nowrap: true },
            ]}
          />
        )}
      </Card>

      <Card title="Músicos externos" actions={<Button size="sm" variant="ghost" onClick={() => setEditingMusician('new')}>Añadir músico</Button>}>
        {musicians.isLoading && <Loading />}
        {musicians.data && (
          <DataTable
            caption="Músicos externos"
            rows={musicians.data}
            rowKey={(m) => m.id}
            empty="Los músicos aceptados en la bolsa se añaden aquí automáticamente."
            columns={[
              { key: 'n', header: 'Nombre', render: (m) => <strong>{name(m)}</strong> },
              { key: 'i', header: 'Instrumento', render: (m) => m.instrument ?? '—' },
              { key: 'e', header: 'Contacto', render: (m) => [m.email, m.phone].filter(Boolean).join(' · ') || '—' },
              { key: 'f', header: 'Datos fiscales', render: (m) => `${m.hasNationalId ? 'NIF' : 'Sin NIF'} · ${m.ibanMasked ?? 'sin IBAN'}` },
              {
                key: 'a',
                header: 'Acciones',
                render: (m) => (
                  <Menu
                    label={`Acciones de ${name(m)}`}
                    items={[
                      { label: 'Editar', onSelect: () => setEditingMusician(m) },
                      { label: 'Eliminar', danger: true, onSelect: () => removeMusician.mutate(m.id) },
                    ]}
                  />
                ),
              },
            ]}
          />
        )}
      </Card>

      <ExternalModal musician={editingMusician} onClose={() => setEditingMusician(null)} />
      {creating && <PaymentModal open musicians={musicians.data ?? []} onClose={() => setCreating(false)} />}
      <Modal open={!!paying} onClose={() => setPaying(null)} title="Registrar pago">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            if (paying && v.date) pay.mutate({ id: paying.id, date: v.date });
          }}
        >
          <p className="small">
            Se registrará un gasto de {money(paying?.netCents)} (neto) en la categoría «Refuerzos». La retención de {money(paying?.withholdingCents)} queda pendiente de ingresar en Hacienda.
          </p>
          <TextField label="Fecha de pago" name="date" type="date" required defaultValue={today()} />
          <FormError error={pay.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setPaying(null)}>
              Cancelar
            </Button>
            <Button type="submit" loading={pay.isPending}>
              Registrar pago
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default function ReinforcementsPage() {
  const { can } = useAuth();
  const manage = can('reinforcements:manage');
  // Clave para forzar la pestaña de perfil desde «Presentarme» sin perfil.
  const [tabKey, setTabKey] = useState<{ n: number; initial: string }>({ n: 0, initial: 'open' });
  const goProfile = () => setTabKey((t) => ({ n: t.n + 1, initial: 'profile' }));
  return (
    <Page
      header={
        <PageHeader
          title="Bolsa de refuerzos"
          description="Necesidades de músicos de todas las bandas, tu perfil como refuerzo y, para la dirección, la gestión de candidaturas y pagos."
        />
      }
    >
      <Tabs
        key={tabKey.n}
        initial={tabKey.initial}
        label="Secciones de la bolsa de refuerzos"
        tabs={[
          { id: 'open', label: 'Necesidades abiertas', content: <OpenRequestsTab goProfile={goProfile} /> },
          { id: 'mine', label: 'Mis candidaturas', content: <MyApplicationsTab /> },
          { id: 'profile', label: 'Mi perfil de músico', content: <ProfileTab /> },
          ...(manage
            ? [
                { id: 'ours', label: 'Nuestras necesidades', content: <OurRequestsTab /> },
                { id: 'musicians', label: 'Músicos', content: <MusiciansTab /> },
                { id: 'payments', label: 'Pagos', content: <PaymentsTab /> },
              ]
            : []),
        ]}
      />
    </Page>
  );
}
