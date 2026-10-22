import { useState, type FormEvent } from 'react';
import { del, patch, post } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import type { ChainVerification, Client, Invoice, Quote } from '../api/types-performances';
import { useAuth } from '../auth/AuthProvider';
import { ArrowLink, Button } from '../components/Button';
import { Card, StatCard } from '../components/Card';
import { Chip, StatusChip } from '../components/Chip';
import { DataTable } from '../components/DataTable';
import { ErrorNote, Loading } from '../components/EmptyState';
import { FormError, SelectField, TextAreaField, TextField, formValues } from '../components/Field';
import { Menu, type MenuItem } from '../components/Menu';
import { ConfirmModal, Modal } from '../components/Modal';
import { Page, PageHeader } from '../components/PageHeader';
import { ContractModal } from '../components/performances/ContractView';
import { emptyLine, fromDraft, LinesEditor, toDraft, type DraftLine } from '../components/performances/LinesEditor';
import { lineCents } from '../components/performances/totals';
import { Tabs } from '../components/Tabs';
import { date, dateTime, money, toLocalInput, today } from '../lib/format';
import { chainBreakReason, clientKind, invoiceStatus, quoteStatus } from '../lib/labels-performances';

const kindOptions = Object.entries(clientKind).map(([value, label]) => ({ value, label }));
const invoiceNo = (i: { series: string; number: number }) => `${i.series}-${String(i.number).padStart(4, '0')}`;

// ── Clientes ────────────────────────────────────────────────────────────────

function ClientModal({ open, onClose, client }: { open: boolean; onClose: () => void; client?: Client | null }) {
  const save = useApiMutation((body: unknown) => (client ? patch(`/performances/clients/${client.id}`, body) : post('/performances/clients', body)), {
    success: client ? 'Cliente actualizado' : 'Cliente creado',
    invalidate: ['/performances'],
    onSuccess: onClose,
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    save.mutate({
      name: v.name, kind: v.kind, taxId: v.taxId ?? null, email: v.email ?? null, phone: v.phone ?? null,
      address: v.address ?? null, contactName: v.contactName ?? null, notes: v.notes ?? null,
    });
  }
  return (
    <Modal open={open} onClose={onClose} title={client ? 'Editar cliente' : 'Nuevo cliente'}>
      <form className="form" key={client?.id ?? 'new'} onSubmit={submit}>
        <div className="form-row">
          <TextField label="Nombre" name="name" required maxLength={160} defaultValue={client?.name} placeholder="Ayuntamiento de…" />
          <SelectField label="Tipo" name="kind" defaultValue={client?.kind ?? 'CITY_COUNCIL'} options={kindOptions} />
        </div>
        <div className="form-row">
          <TextField label="NIF/CIF" name="taxId" maxLength={20} defaultValue={client?.taxId ?? ''} />
          <TextField label="Persona de contacto" name="contactName" maxLength={120} defaultValue={client?.contactName ?? ''} />
        </div>
        <div className="form-row">
          <TextField label="Email" name="email" type="email" defaultValue={client?.email ?? ''} />
          <TextField label="Teléfono" name="phone" maxLength={30} defaultValue={client?.phone ?? ''} />
        </div>
        <TextField label="Dirección fiscal" name="address" maxLength={300} defaultValue={client?.address ?? ''} />
        <TextAreaField label="Notas" name="notes" defaultValue={client?.notes ?? ''} />
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

function ClientsTab() {
  const { can } = useAuth();
  const write = can('performances:write');
  const [search, setSearch] = useState('');
  const q = useApi<Client[]>('/performances/clients', { q: search });
  const [editing, setEditing] = useState<Client | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Client | null>(null);
  const remove = useApiMutation((id: string) => del(`/performances/clients/${id}`), {
    success: 'Cliente eliminado',
    invalidate: ['/performances'],
    onSuccess: () => setDeleting(null),
  });
  return (
    <div className="stack" style={{ gap: 24 }}>
      <Card>
        <div className="toolbar">
          <TextField label="Buscar" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre o NIF" />
          {write && <Button onClick={() => setCreating(true)}>Nuevo cliente</Button>}
        </div>
      </Card>
      {q.isLoading && <Loading />}
      {q.error && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}
      {q.data && (
        <Card>
          <DataTable
            caption="Clientes"
            rows={q.data}
            rowKey={(c) => c.id}
            empty="Añade ayuntamientos, hermandades, comisiones de fiestas o particulares que contratan a la banda."
            columns={[
              { key: 'n', header: 'Cliente', render: (c) => <strong>{c.name}</strong> },
              { key: 'k', header: 'Tipo', render: (c) => clientKind[c.kind] },
              { key: 't', header: 'NIF', render: (c) => <span className="mono">{c.taxId ?? '—'}</span>, nowrap: true },
              { key: 'c', header: 'Contacto', render: (c) => [c.contactName, c.email, c.phone].filter(Boolean).join(' · ') || '—' },
              { key: 'q', header: 'Presupuestos', render: (c) => c._count?.quotes ?? 0, numeric: true },
              { key: 'i', header: 'Facturas', render: (c) => c._count?.invoices ?? 0, numeric: true },
              ...(write
                ? [
                    {
                      key: 'a',
                      header: 'Acciones',
                      render: (c: Client) => (
                        <Menu
                          label={`Acciones de ${c.name}`}
                          items={[
                            { label: 'Editar', onSelect: () => setEditing(c) },
                            { label: 'Eliminar', danger: true, disabled: !!(c._count?.quotes || c._count?.invoices), onSelect: () => setDeleting(c) },
                          ]}
                        />
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </Card>
      )}
      <ClientModal open={creating || !!editing} client={editing} onClose={() => (setCreating(false), setEditing(null))} />
      <ConfirmModal
        open={!!deleting}
        title="Eliminar cliente"
        message={`¿Eliminar a «${deleting?.name}»? Sólo es posible si no tiene presupuestos ni facturas.`}
        confirmLabel="Eliminar"
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

// ── Presupuestos y contratos ────────────────────────────────────────────────

function QuoteModal({ open, onClose, quote, clients }: { open: boolean; onClose: () => void; quote?: Quote | null; clients: Client[] }) {
  const [lines, setLines] = useState<DraftLine[]>(() => (quote ? quote.lines.map(toDraft) : [emptyLine()]));
  const [taxRatePct, setTaxRatePct] = useState(quote?.taxRatePct ?? 0);
  const save = useApiMutation((body: unknown) => (quote ? patch(`/performances/quotes/${quote.id}`, body) : post('/performances/quotes', body)), {
    success: quote ? 'Presupuesto actualizado' : 'Presupuesto creado',
    invalidate: ['/performances'],
    onSuccess: onClose,
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    save.mutate({
      clientId: v.clientId, title: v.title, location: v.location ?? null,
      performanceAt: v.performanceAt ? new Date(v.performanceAt).toISOString() : null,
      validUntil: v.validUntil ?? null, contractTerms: v.contractTerms ?? null, notes: v.notes ?? null,
      taxRatePct, lines: lines.map(fromDraft),
    });
  }
  return (
    <Modal open={open} onClose={onClose} title={quote ? `Editar presupuesto nº ${quote.number}` : 'Nuevo presupuesto'}>
      <form className="form" onSubmit={submit}>
        <div className="form-row">
          <SelectField label="Cliente" name="clientId" required defaultValue={quote?.clientId} placeholder="Elige un cliente" options={clients.map((c) => ({ value: c.id, label: c.name }))} />
          <TextField label="Título" name="title" required maxLength={160} defaultValue={quote?.title} placeholder="Procesión del Corpus" />
        </div>
        <div className="form-row">
          <TextField label="Fecha y hora de la actuación" name="performanceAt" type="datetime-local" defaultValue={toLocalInput(quote?.performanceAt)} />
          <TextField label="Lugar" name="location" maxLength={200} defaultValue={quote?.location ?? ''} />
        </div>
        <LinesEditor lines={lines} onChange={setLines} taxRatePct={taxRatePct} />
        <div className="form-row">
          <TextField
            label="Impuesto (%)"
            type="number"
            min={0}
            max={100}
            value={taxRatePct}
            onChange={(e) => setTaxRatePct(Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)))}
            hint="0 % si la actuación está exenta de IVA"
          />
          <TextField label="Válido hasta" name="validUntil" type="date" defaultValue={quote?.validUntil?.slice(0, 10) ?? ''} />
        </div>
        <TextAreaField label="Condiciones del contrato" name="contractTerms" rows={5} defaultValue={quote?.contractTerms ?? ''} hint="Plantilla, horario, desplazamiento, forma de pago… Se copian al contrato al firmar." />
        <TextAreaField label="Notas internas" name="notes" defaultValue={quote?.notes ?? ''} />
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

function QuotesTab() {
  const { can } = useAuth();
  const write = can('performances:write');
  const [status, setStatus] = useState('');
  const q = useApi<Quote[]>('/performances/quotes', { status });
  const clients = useApi<Client[]>('/performances/clients');
  const [editing, setEditing] = useState<Quote | null>(null);
  const [creating, setCreating] = useState(false);
  const [signing, setSigning] = useState<Quote | null>(null);
  const [eventFor, setEventFor] = useState<Quote | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Quote | null>(null);
  const opts = { invalidate: ['/performances'] };
  const send = useApiMutation((id: string) => post(`/performances/quotes/${id}/send`), { ...opts, success: 'Presupuesto marcado como enviado' });
  const reject = useApiMutation((id: string) => post(`/performances/quotes/${id}/reject`), { ...opts, success: 'Presupuesto rechazado' });
  const sign = useApiMutation((b: { id: string; signedBy: string }) => post(`/performances/quotes/${b.id}/sign`, { signedBy: b.signedBy }), {
    ...opts,
    success: 'Contrato firmado',
    onSuccess: () => setSigning(null),
  });
  const createEvent = useApiMutation((b: { id: string; startsAt?: string; endsAt?: string }) => post(`/performances/quotes/${b.id}/event`, { startsAt: b.startsAt, endsAt: b.endsAt }), {
    invalidate: ['/performances', '/events', '/agenda'],
    success: 'Actuación creada en la agenda',
    onSuccess: () => setEventFor(null),
  });
  const remove = useApiMutation((id: string) => del(`/performances/quotes/${id}`), { ...opts, success: 'Presupuesto eliminado', onSuccess: () => setDeleting(null) });

  const actions = (x: Quote): MenuItem[] => [
    { label: x.status === 'ACCEPTED' ? 'Ver contrato' : 'Ver e imprimir', onSelect: () => setViewing(x.id) },
    ...(write && x.status === 'DRAFT' ? [{ label: 'Editar', onSelect: () => setEditing(x) }, { label: 'Marcar como enviado', onSelect: () => send.mutate(x.id) }] : []),
    ...(write && ['DRAFT', 'SENT'].includes(x.status)
      ? [{ label: 'Firmar contrato', onSelect: () => setSigning(x) }, { label: 'Rechazado por el cliente', onSelect: () => reject.mutate(x.id) }]
      : []),
    ...(write && can('events:write') && !x.eventId && x.status !== 'REJECTED' ? [{ label: 'Crear actuación en la agenda', onSelect: () => setEventFor(x) }] : []),
    ...(write && x.status === 'DRAFT' ? [{ label: 'Eliminar', danger: true, onSelect: () => setDeleting(x) }] : []),
  ];

  return (
    <div className="stack" style={{ gap: 24 }}>
      <Card>
        <div className="toolbar">
          <SelectField
            label="Estado"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="Todos"
            options={Object.entries(quoteStatus).map(([value, { label }]) => ({ value, label }))}
          />
          {write && (
            <Button onClick={() => setCreating(true)} disabled={!clients.data?.length} title={clients.data?.length ? undefined : 'Crea antes un cliente'}>
              Nuevo presupuesto
            </Button>
          )}
        </div>
      </Card>
      {q.isLoading && <Loading />}
      {q.error && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}
      {q.data && (
        <Card>
          <DataTable
            caption="Presupuestos y contratos"
            rows={q.data}
            rowKey={(x) => x.id}
            empty="Crea un presupuesto con sus líneas; al firmarlo queda como contrato."
            columns={[
              { key: 'n', header: 'Nº', render: (x) => <span className="mono">{x.number}</span>, nowrap: true },
              { key: 't', header: 'Actuación', render: (x) => <strong>{x.title}</strong> },
              { key: 'c', header: 'Cliente', render: (x) => x.client?.name ?? '—' },
              { key: 'd', header: 'Fecha', render: (x) => (x.performanceAt ? dateTime(x.performanceAt) : '—'), nowrap: true },
              { key: 'tot', header: 'Total', render: (x) => money(x.totalCents), numeric: true, nowrap: true },
              { key: 's', header: 'Estado', render: (x) => <StatusChip value={x.status} map={quoteStatus} /> },
              { key: 'e', header: 'Agenda', render: (x) => (x.event ? <ArrowLink to={`/events/${x.event.id}`}>Ver evento</ArrowLink> : '—') },
              { key: 'a', header: 'Acciones', render: (x) => <Menu label={`Acciones del presupuesto ${x.number}`} items={actions(x)} /> },
            ]}
          />
        </Card>
      )}
      {(creating || editing) && (
        <QuoteModal open quote={editing} clients={clients.data ?? []} onClose={() => (setCreating(false), setEditing(null))} />
      )}
      <ContractModal quoteId={viewing} onClose={() => setViewing(null)} />
      <Modal open={!!signing} onClose={() => setSigning(null)} title={`Firmar contrato nº ${signing?.number ?? ''}`}>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            if (signing && v.signedBy) sign.mutate({ id: signing.id, signedBy: v.signedBy });
          }}
        >
          <p className="small">El presupuesto pasa a ser el contrato aceptado, con copia de sus condiciones. Total: {money(signing?.totalCents)}.</p>
          <TextField label="Firmado por (cliente)" name="signedBy" required minLength={2} maxLength={160} placeholder="Nombre y cargo" />
          <FormError error={sign.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setSigning(null)}>
              Cancelar
            </Button>
            <Button type="submit" loading={sign.isPending}>
              Firmar
            </Button>
          </div>
        </form>
      </Modal>
      <Modal open={!!eventFor} onClose={() => setEventFor(null)} title="Crear actuación en la agenda">
        <form
          className="form"
          key={eventFor?.id}
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            if (eventFor)
              createEvent.mutate({
                id: eventFor.id,
                startsAt: v.startsAt ? new Date(v.startsAt).toISOString() : undefined,
                endsAt: v.endsAt ? new Date(v.endsAt).toISOString() : undefined,
              });
          }}
        >
          <p className="small">Se crea un evento de tipo actuación vinculado a este presupuesto. Si no indicas el fin, se calculan dos horas.</p>
          <div className="form-row">
            <TextField label="Inicio" name="startsAt" type="datetime-local" required={!eventFor?.performanceAt} defaultValue={toLocalInput(eventFor?.performanceAt)} />
            <TextField label="Fin" name="endsAt" type="datetime-local" />
          </div>
          <FormError error={createEvent.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setEventFor(null)}>
              Cancelar
            </Button>
            <Button type="submit" loading={createEvent.isPending}>
              Crear actuación
            </Button>
          </div>
        </form>
      </Modal>
      <ConfirmModal
        open={!!deleting}
        title="Eliminar presupuesto"
        message={`¿Eliminar el borrador nº ${deleting?.number}?`}
        confirmLabel="Eliminar"
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

// ── Facturas ────────────────────────────────────────────────────────────────

function IssueModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<'quote' | 'manual'>('quote');
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [taxRatePct, setTaxRatePct] = useState(0);
  const quotes = useApi<Quote[]>('/performances/quotes', { status: 'ACCEPTED' });
  const clients = useApi<Client[]>('/performances/clients');
  const issue = useApiMutation((body: unknown) => post('/performances/invoices', body), { success: 'Factura emitida', invalidate: ['/performances'], onSuccess: onClose });
  const pending = (quotes.data ?? []).filter((x) => !x.invoices?.length);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    const common = { series: v.series || 'A', issueDate: v.issueDate };
    issue.mutate(mode === 'quote' ? { ...common, quoteId: v.quoteId } : { ...common, clientId: v.clientId, taxRatePct, lines: lines.map(fromDraft) });
  }
  return (
    <Modal open={open} onClose={onClose} title="Emitir factura">
      <form className="form" onSubmit={submit}>
        <div className="segmented" role="radiogroup" aria-label="Origen de la factura" style={{ alignSelf: 'flex-start' }}>
          <button type="button" role="radio" aria-checked={mode === 'quote'} onClick={() => setMode('quote')}>
            Desde contrato
          </button>
          <button type="button" role="radio" aria-checked={mode === 'manual'} onClick={() => setMode('manual')}>
            Manual
          </button>
        </div>
        {mode === 'quote' ? (
          <SelectField
            label="Contrato aceptado"
            name="quoteId"
            required
            placeholder={pending.length ? 'Elige un contrato' : 'No hay contratos pendientes de facturar'}
            options={pending.map((x) => ({ value: x.id, label: `Nº ${x.number} · ${x.title} · ${x.client?.name ?? ''} · ${money(x.totalCents)}` }))}
          />
        ) : (
          <>
            <SelectField label="Cliente" name="clientId" required placeholder="Elige un cliente" options={(clients.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
            <LinesEditor lines={lines} onChange={setLines} taxRatePct={taxRatePct} />
            <TextField label="Impuesto (%)" type="number" min={0} max={100} value={taxRatePct} onChange={(e) => setTaxRatePct(Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)))} />
          </>
        )}
        <div className="form-row">
          <TextField label="Serie" name="series" defaultValue="A" maxLength={10} pattern="[A-Za-z0-9\-]{1,10}" />
          <TextField label="Fecha de emisión" name="issueDate" type="date" defaultValue={today()} required />
        </div>
        <p className="small muted">Una vez emitida, la factura no se puede modificar ni borrar: sólo anular (si no está cobrada) o rectificar.</p>
        <FormError error={issue.error} />
        <div className="modal__footer">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={issue.isPending}>
            Emitir
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ChainBadge({ series }: { series: string }) {
  const q = useApi<ChainVerification>('/performances/invoices/verify', { series });
  if (q.isLoading || !q.data) return <Chip>Verificando cadena…</Chip>;
  const v = q.data;
  if (v.ok) return <Chip tone="success">Cadena íntegra · {v.count} {v.count === 1 ? 'factura' : 'facturas'}</Chip>;
  return (
    <div className="stack">
      <Chip tone="danger">Cadena con {v.breaks.length} incidencias</Chip>
      <ul className="small">
        {v.breaks.map((b) => (
          <li key={`${b.id}-${b.reason}`}>
            {invoiceNo({ series: v.series, number: b.number })}: {chainBreakReason[b.reason] ?? b.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

function InvoicesTab() {
  const { can } = useAuth();
  const write = can('performances:write');
  const [series, setSeries] = useState('A');
  const [status, setStatus] = useState('');
  const q = useApi<Invoice[]>('/performances/invoices', { series, status });
  const verify = useApi<ChainVerification>('/performances/invoices/verify', { series });
  const [issuing, setIssuing] = useState(false);
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [cancelling, setCancelling] = useState<Invoice | null>(null);
  const [rectifying, setRectifying] = useState<Invoice | null>(null);
  const [detail, setDetail] = useState<Invoice | null>(null);
  const pay = useApiMutation((b: { id: string; date: string }) => post(`/performances/invoices/${b.id}/pay`, { date: b.date }), {
    success: 'Cobro registrado en tesorería',
    invalidate: ['/performances', '/finance'],
    onSuccess: () => setPaying(null),
  });
  const cancel = useApiMutation((id: string) => post(`/performances/invoices/${id}/cancel`), { success: 'Factura anulada', invalidate: ['/performances'], onSuccess: () => setCancelling(null) });
  const rectify = useApiMutation((b: { id: string; reason: string; series: string }) => post(`/performances/invoices/${b.id}/rectify`, { reason: b.reason, series: b.series }), {
    success: 'Factura rectificativa emitida',
    invalidate: ['/performances'],
    onSuccess: () => setRectifying(null),
  });
  const rows = q.data ?? [];
  const sum = (s: string) => rows.filter((i) => i.status === s).reduce((t, i) => t + i.totalCents, 0);
  const seriesOptions = [...new Set(['A', 'R', ...(verify.data?.allSeries ?? [])])].map((s) => ({ value: s, label: `Serie ${s}` }));

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="grid grid--stats">
        <StatCard label="Pendiente de cobro" value={money(sum('ISSUED'))} tone="cream" />
        <StatCard label="Cobrado" value={money(sum('PAID'))} tone="cool" />
        <StatCard label="Facturas en la serie" value={rows.length} />
      </div>
      <Card>
        <div className="toolbar">
          <SelectField label="Serie" value={series} onChange={(e) => setSeries(e.target.value)} options={seriesOptions} />
          <SelectField
            label="Estado"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="Todos"
            options={Object.entries(invoiceStatus).map(([value, { label }]) => ({ value, label }))}
          />
          {write && <Button onClick={() => setIssuing(true)}>Emitir factura</Button>}
        </div>
        <div className="row between" style={{ marginTop: 12, alignItems: 'flex-start' }}>
          <p className="small muted" style={{ margin: 0 }}>
            Registro encadenado e inalterable, preparado para VeriFactu: cada factura guarda la huella SHA-256 de la anterior de su serie.
          </p>
          <ChainBadge series={series} />
        </div>
      </Card>
      {q.isLoading && <Loading />}
      {q.error && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}
      {q.data && (
        <Card>
          <DataTable
            caption="Facturas emitidas"
            rows={rows}
            rowKey={(i) => i.id}
            empty="Emite facturas desde un contrato aceptado o de forma manual."
            columns={[
              { key: 'n', header: 'Número', render: (i) => <span className="mono">{invoiceNo(i)}</span>, nowrap: true },
              { key: 'd', header: 'Fecha', render: (i) => date(i.issueDate), nowrap: true },
              { key: 'c', header: 'Cliente', render: (i) => i.clientSnapshot?.name ?? i.client?.name },
              { key: 'r', header: 'Tipo', render: (i) => (i.rectifiesId ? <Chip tone="warning">Rectificativa</Chip> : 'Ordinaria') },
              { key: 't', header: 'Total', render: (i) => money(i.totalCents), numeric: true, nowrap: true },
              { key: 's', header: 'Estado', render: (i) => <StatusChip value={i.status} map={invoiceStatus} /> },
              {
                key: 'a',
                header: 'Acciones',
                render: (i) => (
                  <Menu
                    label={`Acciones de la factura ${invoiceNo(i)}`}
                    items={[
                      { label: 'Ver detalle', onSelect: () => setDetail(i) },
                      ...(write && i.status === 'ISSUED' && i.totalCents > 0 ? [{ label: 'Registrar cobro', onSelect: () => setPaying(i) }] : []),
                      ...(write && i.status === 'ISSUED' ? [{ label: 'Anular', danger: true, onSelect: () => setCancelling(i) }] : []),
                      ...(write && i.status !== 'CANCELLED' && !i.rectifiesId ? [{ label: 'Emitir rectificativa', onSelect: () => setRectifying(i) }] : []),
                    ]}
                  />
                ),
              },
            ]}
          />
        </Card>
      )}
      {issuing && <IssueModal open onClose={() => setIssuing(false)} />}
      <Modal open={!!paying} onClose={() => setPaying(null)} title={`Cobro de ${paying ? invoiceNo(paying) : ''}`}>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            if (paying && v.date) pay.mutate({ id: paying.id, date: v.date });
          }}
        >
          <p className="small">Se registrará un ingreso de {money(paying?.totalCents)} en la categoría «Actuaciones».</p>
          <TextField label="Fecha de cobro" name="date" type="date" required defaultValue={today()} />
          <FormError error={pay.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setPaying(null)}>
              Cancelar
            </Button>
            <Button type="submit" loading={pay.isPending}>
              Registrar cobro
            </Button>
          </div>
        </form>
      </Modal>
      <ConfirmModal
        open={!!cancelling}
        title="Anular factura"
        message={`La factura ${cancelling ? invoiceNo(cancelling) : ''} quedará anulada. Se conserva en el registro y su número no se reutiliza.`}
        confirmLabel="Anular"
        loading={cancel.isPending}
        onConfirm={() => cancelling && cancel.mutate(cancelling.id)}
        onClose={() => setCancelling(null)}
      />
      <Modal open={!!rectifying} onClose={() => setRectifying(null)} title={`Rectificar ${rectifying ? invoiceNo(rectifying) : ''}`}>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            if (rectifying && v.reason) rectify.mutate({ id: rectifying.id, reason: v.reason, series: v.series || 'R' });
          }}
        >
          <p className="small">Se emite una factura rectificativa con todas las líneas en negativo ({money(rectifying ? -rectifying.totalCents : 0)}) que referencia a la original.</p>
          <TextField label="Motivo" name="reason" required minLength={3} maxLength={300} />
          <TextField label="Serie de rectificativas" name="series" defaultValue="R" maxLength={10} />
          <FormError error={rectify.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setRectifying(null)}>
              Cancelar
            </Button>
            <Button type="submit" loading={rectify.isPending}>
              Emitir rectificativa
            </Button>
          </div>
        </form>
      </Modal>
      <Modal open={!!detail} onClose={() => setDetail(null)} title={`Factura ${detail ? invoiceNo(detail) : ''}`}>
        {detail && (
          <div className="stack">
            <p>
              <strong>{detail.clientSnapshot.name}</strong>
              {detail.clientSnapshot.taxId ? ` · NIF ${detail.clientSnapshot.taxId}` : ''}
              <br />
              <span className="small muted">
                Emisor: {detail.clientSnapshot.issuer?.legalName ?? detail.clientSnapshot.issuer?.name}
                {detail.clientSnapshot.issuer?.taxId ? ` · NIF ${detail.clientSnapshot.issuer.taxId}` : ''} · {date(detail.issueDate)}
              </span>
            </p>
            <ul className="list-plain list-divided">
              {detail.lines.map((l, i) => (
                <li key={i} className="row between">
                  <span>
                    {l.description} <span className="small muted">× {String(l.quantity).replace('.', ',')}</span>
                  </span>
                  <span className="nowrap">{money(lineCents(l))}</span>
                </li>
              ))}
            </ul>
            <p className="small" style={{ textAlign: 'right' }}>
              Base {money(detail.baseCents)} · Impuesto {detail.taxRatePct} % {money(detail.taxCents)} · <strong>Total {money(detail.totalCents)}</strong>
            </p>
            <p className="small muted mono" style={{ wordBreak: 'break-all' }}>
              Huella: {detail.hash}
              <br />
              Anterior: {detail.prevHash ?? '— (primera de la serie)'}
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default function PerformancesPage() {
  return (
    <Page
      header={
        <PageHeader
          tone="warm"
          title="Contrataciones"
          description="Clientes, presupuestos, contratos y facturación de las actuaciones contratadas."
        />
      }
    >
      <Tabs
        label="Secciones de actuaciones"
        initial="quotes"
        tabs={[
          { id: 'clients', label: 'Clientes', content: <ClientsTab /> },
          { id: 'quotes', label: 'Presupuestos', content: <QuotesTab /> },
          { id: 'invoices', label: 'Facturas', content: <InvoicesTab /> },
        ]}
      />
    </Page>
  );
}
