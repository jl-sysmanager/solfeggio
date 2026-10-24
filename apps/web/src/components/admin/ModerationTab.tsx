import { useState } from 'react';
import { post } from '../../api/client';
import { useApi, useApiMutation } from '../../api/hooks';
import type { Listing } from '../../api/types';
import type { MarketPending, ModerationKpis } from '../../api/types-admin-support';
import { date, money } from '../../lib/format';
import { condition } from '../../lib/labels';
import { Button, IconButton } from '../Button';
import { StatCard } from '../Card';
import { Chip } from '../Chip';
import { EmptyState, ErrorNote, Loading } from '../EmptyState';
import { FormError, TextAreaField, formValues } from '../Field';
import { Drawer } from '../Modal';
import { UrlTabs } from '../Tabs';
import { ReinforcementReports } from './support/ReinforcementReports';
import { UserBlocking } from './support/UserBlocking';
import { KpiRow, hoursLabel } from './support/shared';

type Pending = MarketPending & Partial<Listing>;

function MarketQueue() {
  const q = useApi<{ pending: Pending[]; reported: Pending[] }>('/admin/market/pending');
  const [rejecting, setRejecting] = useState<Pending | null>(null);
  const moderate = useApiMutation((v: { id: string; approve: boolean; note?: string }) => post(`/admin/market/listings/${v.id}/moderate`, { approve: v.approve, note: v.note }), {
    success: 'Anuncio moderado',
    invalidate: ['/admin'],
    onSuccess: () => setRejecting(null),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  // La API devuelve { pending, reported }; se admite también una lista plana.
  const data = q.data as unknown;
  const list: Pending[] = Array.isArray(data) ? (data as Pending[]) : [...((data as { pending?: Pending[] })?.pending ?? []), ...((data as { reported?: Pending[] })?.reported ?? [])];
  if (list.length === 0) return <EmptyState title="Nada pendiente">No hay anuncios esperando revisión.</EmptyState>;
  return (
    <>
      <ul className="grid grid--2 list-plain">
        {list.map((l) => (
          <li key={l.id} className="card stack">
            <div className="row between">
              <h3 className="card__title">{l.title}</h3>
              <strong>{money(l.priceCents, l.currency)}</strong>
            </div>
            <p className="small muted">
              {l.seller?.name ?? 'Banda'} · {l.category} · {condition[l.condition as keyof typeof condition]} · {date(l.createdAt)}
            </p>
            {l.waitingHours !== undefined && (
              <p>
                <Chip tone={l.slaBreached ? 'danger' : 'info'}>{l.slaBreached ? 'Fuera del objetivo de 24 h' : 'En plazo'}</Chip> <span className="small">Esperando {hoursLabel(l.waitingHours)}</span>
              </p>
            )}
            {l.reports && l.reports.length > 0 && (
              <p className="small">
                <Chip tone="warning">Denunciado</Chip> {l.reports.map((r) => `«${r.reason}»`).join(' · ')}
              </p>
            )}
            {l.imageUrls?.[0] && <img className="thumb" src={l.imageUrls[0]} alt={`Foto de ${l.title}`} loading="lazy" />}
            <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{l.description}</p>
            <div className="row">
              <IconButton icon="check" label={`Publicar ${l.title}`} onClick={() => moderate.mutate({ id: l.id, approve: true })} disabled={moderate.isPending} />
              <IconButton icon="close" label={`Rechazar ${l.title}`} onClick={() => setRejecting(l)} />
            </div>
          </li>
        ))}
      </ul>
      <Drawer open={!!rejecting} onClose={() => setRejecting(null)} title="Rechazar anuncio">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            if (rejecting) moderate.mutate({ id: rejecting.id, approve: false, note: v.note });
          }}
        >
          <TextAreaField label="Motivo (lo verá la banda)" name="note" required />
          <FormError error={moderate.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setRejecting(null)}>Cancelar</Button>
            <Button type="submit" loading={moderate.isPending}>Rechazar</Button>
          </div>
        </form>
      </Drawer>
    </>
  );
}

/** Moderación: BandMarket (con tiempo de espera frente a 24 h), bolsa de refuerzos y bloqueo de usuarios. */
export function ModerationTab() {
  const kpis = useApi<ModerationKpis>('/admin/moderation/kpis');
  const k = kpis.data;
  return (
    <div className="stack" style={{ gap: 32 }}>
      {k && (
        <KpiRow>
          <StatCard label="Anuncios en cola" value={k.market.pending} tone={k.market.overdue ? 'warm' : 'paper'} hint={`${k.market.overdue} fuera de las ${k.targetHours} h`} />
          <StatCard label="Moderación (mediana, 30 d)" value={hoursLabel(k.market.last30d.medianHours)} hint={`${k.market.last30d.moderated} moderados`} />
          <StatCard label={`Dentro de ${k.targetHours} h (30 d)`} value={k.market.last30d.within24hPct === null ? '—' : `${k.market.last30d.within24hPct} %`} />
          <StatCard label="Denuncias abiertas" value={k.reports.listings + k.reports.reinforcements} hint={`${k.reports.listings} BandMarket · ${k.reports.reinforcements} refuerzos`} />
        </KpiRow>
      )}
      <UrlTabs
        label="Moderación"
        tabs={[
          { id: 'market', label: 'BandMarket', content: <MarketQueue /> },
          { id: 'reinforcements', label: 'Refuerzos', content: <ReinforcementReports /> },
          { id: 'users', label: 'Usuarios', content: <UserBlocking /> },
        ]}
      />
    </div>
  );
}
