import { useState } from 'react';
import { patch, post } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import type { Inquiry, Listing, Paginated } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { Person } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Chip, StatusChip } from '../components/Chip';
import { DataTable, Pagination } from '../components/DataTable';
import { EmptyState, Loading } from '../components/EmptyState';
import { FormError, SelectField, TextAreaField, TextField, formValues } from '../components/Field';
import { Menu, type MenuItem } from '../components/Menu';
import { Modal } from '../components/Modal';
import { Page, PageHeader } from '../components/PageHeader';
import { Tabs } from '../components/Tabs';
import { ApiErrorView } from '../components/Upgrade';
import { date, dateTime, money, parseMoney } from '../lib/format';
import { condition, listingStatus } from '../lib/labels';

const CATEGORIES = ['Viento madera', 'Viento metal', 'Percusión', 'Accesorios', 'Atriles y mobiliario', 'Uniformes', 'Partituras', 'Otros'];

function Thumb({ listing }: { listing: Listing }) {
  const src = listing.imageUrls?.[0];
  if (src) return <img className="thumb" src={src} alt={`Foto de ${listing.title}`} loading="lazy" />;
  return (
    <div className="thumb" aria-hidden="true">
      {/* Sin foto: silueta neutra con un único acento. */}
      <svg viewBox="0 0 120 90" width="44%">
        <rect x="26" y="22" width="5" height="48" rx="2.5" fill="var(--chart-bar-alt)" />
        <rect x="57" y="14" width="5" height="56" rx="2.5" fill="var(--chart-bar-alt)" />
        <rect x="88" y="28" width="5" height="42" rx="2.5" fill="var(--chart-bar)" />
        <ellipse cx="24" cy="72" rx="9" ry="7" fill="var(--chart-bar-alt)" />
        <ellipse cx="55" cy="72" rx="9" ry="7" fill="var(--chart-bar-alt)" />
        <ellipse cx="86" cy="72" rx="9" ry="7" fill="var(--chart-bar)" />
      </svg>
    </div>
  );
}

function InquiryModal({ listing, onClose }: { listing: Listing | null; onClose: () => void }) {
  const send = useApiMutation((body: { message: string }) => post(`/market/listings/${listing!.id}/inquiries`, body), {
    success: 'Mensaje enviado al vendedor',
    invalidate: ['/market/inquiries'],
    onSuccess: onClose,
  });
  return (
    <Modal open={!!listing} onClose={onClose} title={`Contactar: ${listing?.title ?? ''}`}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const v = formValues(e.currentTarget);
          if (v.message) send.mutate({ message: v.message });
        }}
      >
        <p className="small">El vendedor ({listing?.seller?.name}) recibirá tu mensaje junto con el nombre de tu banda. La compraventa se acuerda directamente entre las bandas.</p>
        <TextAreaField label="Mensaje" name="message" required maxLength={2000} />
        <FormError error={send.error} />
        <div className="modal__footer">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={send.isPending}>
            Enviar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ReportModal({ listing, onClose }: { listing: Listing | null; onClose: () => void }) {
  const report = useApiMutation((body: { reason: string }) => post(`/market/listings/${listing!.id}/report`, body), {
    success: 'Gracias. El equipo de moderación revisará el anuncio.',
    onSuccess: onClose,
  });
  return (
    <Modal open={!!listing} onClose={onClose} title="Denunciar anuncio">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const v = formValues(e.currentTarget);
          if (v.reason) report.mutate({ reason: v.reason });
        }}
      >
        <TextAreaField label="Motivo" name="reason" required />
        <FormError error={report.error} />
        <div className="modal__footer">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={report.isPending}>
            Enviar denuncia
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function BrowseTab() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [contact, setContact] = useState<Listing | null>(null);
  const [reporting, setReporting] = useState<Listing | null>(null);
  const list = useApi<Paginated<Listing>>('/market/listings', { q: search, category, page, pageSize: 12 });

  return (
    <div className="stack" style={{ gap: 24 }}>
      <Card>
        <form
          className="toolbar"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(q);
            setPage(1);
          }}
        >
          <TextField label="Buscar" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Bombardino, timbales, atriles…" />
          <SelectField label="Categoría" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} placeholder="Todas" options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
          <Button type="submit" variant="ghost">
            Buscar
          </Button>
        </form>
      </Card>
      {list.isLoading && <Loading />}
      {list.error && <ApiErrorView error={list.error} feature="market" />}
      {list.data &&
        (list.data.data.length === 0 ? (
          <EmptyState title="No hay anuncios">Prueba con otra búsqueda.</EmptyState>
        ) : (
          <>
            <ul className="grid list-plain">
              {list.data.data.map((l) => (
                <li key={l.id} className="card stack">
                  <Thumb listing={l} />
                  <div>
                    <h3 className="card__title">{l.title}</h3>
                    <p className="small muted">
                      {l.seller?.name ?? 'Banda'} {l.location ? `· ${l.location}` : ''}
                    </p>
                  </div>
                  <p className="stat__value" style={{ fontSize: 20, marginTop: 0 }}>{money(l.priceCents, l.currency)}</p>
                  <div className="chips">
                    <Chip tone="info" plain>
                      {l.category}
                    </Chip>
                    <Chip plain>{condition[l.condition]}</Chip>
                  </div>
                  <p className="small" style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {l.description}
                  </p>
                  <div className="row">
                    {can('market:write') && (
                      <Button size="sm" onClick={() => setContact(l)} aria-label={`Contactar por ${l.title}`}>
                        Contactar
                      </Button>
                    )}
                    <button className="link-arrow small" onClick={() => setReporting(l)} aria-label={`Denunciar ${l.title}`}>
                      Denunciar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
          </>
        ))}
      <InquiryModal listing={contact} onClose={() => setContact(null)} />
      <ReportModal listing={reporting} onClose={() => setReporting(null)} />
    </div>
  );
}

function ListingModal({ open, onClose, listing }: { open: boolean; onClose: () => void; listing?: Listing | null }) {
  const save = useApiMutation((body: unknown) => (listing ? patch(`/market/listings/${listing.id}`, body) : post('/market/listings', body)), {
    success: listing ? 'Anuncio actualizado' : 'Borrador creado. Envíalo a revisión para publicarlo.',
    invalidate: ['/market'],
    onSuccess: onClose,
  });
  return (
    <Modal open={open} onClose={onClose} title={listing ? 'Editar anuncio' : 'Nuevo anuncio'}>
      <form
        className="form"
        key={listing?.id ?? 'new'}
        onSubmit={(e) => {
          e.preventDefault();
          const v = formValues(e.currentTarget);
          save.mutate({
            title: v.title,
            description: v.description,
            category: v.category,
            condition: v.condition,
            priceCents: parseMoney(v.price ?? '0'),
            location: v.location ?? null,
          });
        }}
      >
        <TextField label="Título" name="title" required maxLength={120} defaultValue={listing?.title} />
        <div className="form-row">
          <SelectField label="Categoría" name="category" defaultValue={listing?.category} options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
          <SelectField label="Estado" name="condition" defaultValue={listing?.condition ?? 'GOOD'} options={Object.entries(condition).map(([value, label]) => ({ value, label }))} />
        </div>
        <div className="form-row">
          <TextField
            label="Precio (€)"
            name="price"
            inputMode="decimal"
            required
            pattern="\d+([.,]\d{1,2})?"
            defaultValue={listing ? String(listing.priceCents / 100).replace('.', ',') : ''}
          />
          <TextField label="Localidad" name="location" defaultValue={listing?.location ?? ''} />
        </div>
        <TextAreaField label="Descripción" name="description" required rows={6} defaultValue={listing?.description} hint="Indica marca, modelo, año, estado y accesorios incluidos." />
        <p className="small muted">Los anuncios los revisa el equipo de Solfeamos antes de publicarse. No incluyas datos personales de contacto: usa la mensajería.</p>
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

function MineTab() {
  const { can } = useAuth();
  const write = can('market:write');
  const list = useApi<Listing[] | Paginated<Listing>>('/market/listings/mine');
  const rows = Array.isArray(list.data) ? list.data : list.data?.data ?? [];
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Listing | null>(null);
  const action = useApiMutation((v: { id: string; action: 'submit' | 'sold' | 'archive' }) => post(`/market/listings/${v.id}/${v.action}`), {
    success: 'Anuncio actualizado',
    invalidate: ['/market'],
  });

  return (
    <div className="stack" style={{ gap: 24 }}>
      {write && (
        <div>
          <Button onClick={() => setCreating(true)}>Nuevo anuncio</Button>
        </div>
      )}
      {list.isLoading && <Loading />}
      {list.error && <ApiErrorView error={list.error} feature="market" />}
      {list.data && (
        <Card>
          <DataTable
            caption="Mis anuncios"
            rows={rows}
            rowKey={(l) => l.id}
            empty="Aún no has publicado nada. Vende el material que la banda ya no usa."
            columns={[
              { key: 't', header: 'Anuncio', render: (l) => l.title },
              { key: 'p', header: 'Precio', render: (l) => money(l.priceCents, l.currency), numeric: true, nowrap: true },
              {
                key: 's',
                header: 'Estado',
                render: (l) => (
                  <div className="stack" style={{ gap: 4 }}>
                    <StatusChip value={l.status} map={listingStatus} />
                    {l.status === 'REJECTED' && l.moderationNote && <span className="small">{l.moderationNote}</span>}
                  </div>
                ),
              },
              { key: 'd', header: 'Creado', render: (l) => date(l.createdAt), nowrap: true },
              ...(write
                ? [
                    {
                      key: 'a',
                      header: 'Acciones',
                      render: (l: Listing) => {
                        const editable = l.status === 'DRAFT' || l.status === 'REJECTED';
                        const items: MenuItem[] = [
                          ...(editable
                            ? [
                                { label: 'Editar anuncio', onSelect: () => setEditing(l) },
                                { label: 'Enviar a revisión', onSelect: () => action.mutate({ id: l.id, action: 'submit' }) },
                              ]
                            : []),
                          ...(l.status === 'PUBLISHED' ? [{ label: 'Marcar como vendido', onSelect: () => action.mutate({ id: l.id, action: 'sold' }) }] : []),
                          ...(l.status !== 'ARCHIVED' ? [{ label: 'Archivar anuncio', onSelect: () => action.mutate({ id: l.id, action: 'archive' }), danger: true }] : []),
                        ];
                        return <Menu label={`Acciones de ${l.title}`} items={items} />;
                      },
                    },
                  ]
                : []),
            ]}
          />
        </Card>
      )}
      <ListingModal open={creating || !!editing} listing={editing} onClose={() => { setCreating(false); setEditing(null); }} />
    </div>
  );
}

/** El API añade remitente y nombres de banda a cada mensaje. */
type InquiryRow = Inquiry & { from?: { name: string; email: string } | null; buyer?: { name?: string }; seller?: { name?: string } };

function InquiriesTab() {
  const { session } = useAuth();
  const q = useApi<InquiryRow[] | Paginated<InquiryRow>>('/market/inquiries');
  const rows = Array.isArray(q.data) ? q.data : q.data?.data ?? [];
  return (
    <div>
      {q.isLoading && <Loading />}
      {q.error && <ApiErrorView error={q.error} feature="market" />}
      {q.data && (
        <Card>
          <DataTable
            caption="Mensajes de BandMarket"
            rows={rows}
            rowKey={(i) => i.id}
            empty="Sin mensajes."
            columns={[
              {
                key: 'dir',
                header: 'Tipo',
                render: (i) => {
                  const sent = i.direction ? i.direction === 'sent' : i.buyerTenantId === session?.tenant?.id;
                  return <Chip tone={sent ? 'neutral' : 'info'}>{sent ? 'Enviado' : 'Recibido'}</Chip>;
                },
              },
              {
                key: 'f',
                header: 'De',
                render: (i) => (i.from ? <Person name={i.from.name} detail={i.buyer?.name ?? i.from.email} /> : (i.buyer?.name ?? '—')),
              },
              { key: 'l', header: 'Anuncio', render: (i) => i.listing?.title ?? '—' },
              { key: 'm', header: 'Mensaje', render: (i) => i.message },
              { key: 'd', header: 'Fecha', render: (i) => dateTime(i.createdAt), nowrap: true },
            ]}
          />
        </Card>
      )}
    </div>
  );
}

export default function MarketPage() {
  return (
    <Page
      header={
        <PageHeader
          tone="warm"
          eyebrow="BandMarket"
          title="Compraventa entre bandas"
          description="Instrumentos y material de segunda mano entre bandas de la comunidad Solfeamos. Anuncios moderados."
        />
      }
    >
      <Tabs
        label="BandMarket"
        tabs={[
          { id: 'browse', label: 'Explorar', content: <BrowseTab /> },
          { id: 'mine', label: 'Mis anuncios', content: <MineTab /> },
          { id: 'inq', label: 'Mensajes', content: <InquiriesTab /> },
        ]}
      />
    </Page>
  );
}
