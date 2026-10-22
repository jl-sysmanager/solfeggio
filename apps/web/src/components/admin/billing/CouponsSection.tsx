import { useState } from 'react';
import { del, post } from '../../../api/client';
import { useApi, useApiMutation } from '../../../api/hooks';
import type { AdminCoupon, BillingTenantSummary } from '../../../api/types-admin-billing';
import type { Paginated } from '../../../api/types';
import { Button } from '../../Button';
import { Card } from '../../Card';
import { Chip } from '../../Chip';
import { DataTable } from '../../DataTable';
import { ErrorNote, Loading } from '../../EmptyState';
import { FormError, SelectField, TextAreaField, TextField, formValues } from '../../Field';
import { ConfirmModal, Modal } from '../../Modal';
import { date } from '../../../lib/format';
import { parseMoney } from '../../../lib/format';
import { couponLabel } from './helpers';

type TenantAction = 'coupon' | 'credit' | 'free-months' | 'extend-trial' | 'complimentary';

const ACTIONS: { id: TenantAction; label: string }[] = [
  { id: 'coupon', label: 'Aplicar cupón' },
  { id: 'credit', label: 'Crédito en cuenta' },
  { id: 'free-months', label: 'Meses gratis' },
  { id: 'extend-trial', label: 'Ampliar prueba' },
  { id: 'complimentary', label: 'Cuenta bonificada' },
];

function CouponForm({ onDone }: { onDone: () => void }) {
  const [kind, setKind] = useState('percent');
  const [duration, setDuration] = useState('once');
  const create = useApiMutation((body: unknown) => post('/admin/billing/coupons', body), { success: 'Cupón creado', invalidate: ['/admin/billing/coupons'], onSuccess: onDone });
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        const v = formValues(e.currentTarget);
        create.mutate({
          name: v.name,
          ...(kind === 'percent' ? { percentOff: Number(v.amount) } : { amountOffCents: parseMoney(v.amount ?? '0') }),
          duration,
          durationInMonths: duration === 'repeating' ? Number(v.months) : undefined,
          maxRedemptions: v.max ? Number(v.max) : undefined,
          promotionCode: v.code,
        });
      }}
    >
      <TextField label="Nombre" name="name" required maxLength={40} />
      <div className="form-row">
        <SelectField label="Tipo de descuento" value={kind} onChange={(e) => setKind(e.target.value)} options={[{ value: 'percent', label: 'Porcentaje' }, { value: 'amount', label: 'Importe fijo (€)' }]} />
        <TextField label={kind === 'percent' ? 'Porcentaje' : 'Importe (€)'} name="amount" required inputMode="decimal" />
      </div>
      <div className="form-row">
        <SelectField label="Duración" value={duration} onChange={(e) => setDuration(e.target.value)} options={[{ value: 'once', label: 'Una vez' }, { value: 'repeating', label: 'Varios meses' }, { value: 'forever', label: 'Siempre' }]} />
        {duration === 'repeating' && <TextField label="Meses" name="months" type="number" min={1} max={36} required />}
      </div>
      <div className="form-row">
        <TextField label="Usos máximos" name="max" type="number" min={1} hint="Vacío = sin límite." />
        <TextField label="Código promocional" name="code" hint="Opcional. Las bandas lo introducen en el pago." pattern="[A-Za-z0-9_\-]{3,40}" />
      </div>
      <FormError error={create.error} />
      <div className="modal__footer">
        <Button variant="ghost" onClick={onDone}>Cancelar</Button>
        <Button type="submit" loading={create.isPending}>Crear cupón</Button>
      </div>
    </form>
  );
}

/** Acciones de bonificación sobre una banda concreta. */
function TenantActions({ coupons }: { coupons: AdminCoupon[] }) {
  const [search, setSearch] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [action, setAction] = useState<TenantAction | null>(null);
  const list = useApi<Paginated<{ id: string; name: string; slug: string }>>('/admin/tenants', { q: search, pageSize: 20 });
  const summary = useApi<BillingTenantSummary>(tenantId ? `/admin/billing/tenants/${tenantId}` : null);
  const run = useApiMutation((v: { path: string; body?: unknown; method?: 'post' | 'delete' }) =>
    v.method === 'delete' ? del(`/admin/billing/tenants/${tenantId}/${v.path}`) : post(`/admin/billing/tenants/${tenantId}/${v.path}`, v.body),
    { success: 'Hecho', invalidate: ['/admin/billing', '/admin/tenants'], onSuccess: () => setAction(null) },
  );
  const s = summary.data;
  return (
    <Card title="Bonificaciones por banda">
      <div className="toolbar">
        <TextField label="Buscar banda" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre o identificador" />
        <SelectField label="Banda" value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="Elige una banda" options={(list.data?.data ?? []).map((t) => ({ value: t.id, label: `${t.name} (${t.slug})` }))} />
      </div>
      {tenantId && summary.isLoading && <Loading rows={2} />}
      {summary.error && <ErrorNote error={summary.error} />}
      {s && (
        <div className="stack" style={{ gap: 12, marginTop: 16 }}>
          <p className="small">
            Plan <strong>{s.plan.name}</strong> · Stripe: {s.subscription?.status ?? 'sin suscripción'}
            {s.subscription?.trialEndsAt && ` · prueba hasta ${date(s.subscription.trialEndsAt)}`}
          </p>
          {s.complimentaryUntil && (
            <div className="row" style={{ gap: 8 }}>
              <Chip tone="info">Bonificada hasta {date(s.complimentaryUntil)}</Chip>
              <span className="small muted">{s.complimentaryReason}</span>
            </div>
          )}
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {ACTIONS.map((a) => (
              <Button key={a.id} size="sm" variant="ghost" onClick={() => setAction(a.id)}>{a.label}</Button>
            ))}
            {s.complimentaryUntil && <Button size="sm" variant="danger" onClick={() => run.mutate({ path: 'complimentary', method: 'delete' })}>Quitar bonificación</Button>}
          </div>
        </div>
      )}
      <Modal open={!!action} onClose={() => setAction(null)} title={`${ACTIONS.find((a) => a.id === action)?.label ?? ''} · ${s?.tenant.name ?? ''}`}>
        <form
          className="form"
          key={action}
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            if (action === 'coupon') run.mutate({ path: 'coupon', body: { couponId: v.couponId } });
            if (action === 'credit') run.mutate({ path: 'credit', body: { amountCents: parseMoney(v.amount ?? '0'), description: v.description } });
            if (action === 'free-months') run.mutate({ path: 'free-months', body: { months: Number(v.months) } });
            if (action === 'extend-trial') run.mutate({ path: 'extend-trial', body: { days: Number(v.days) } });
            if (action === 'complimentary') run.mutate({ path: 'complimentary', body: { until: v.until, reason: v.reason, planCode: v.planCode } });
          }}
        >
          {action === 'coupon' && <SelectField label="Cupón" name="couponId" required placeholder="Elige un cupón" options={coupons.filter((c) => c.valid).map((c) => ({ value: c.id, label: `${c.name ?? c.id} · ${couponLabel(c)}` }))} />}
          {action === 'credit' && (
            <>
              <TextField label="Importe (€)" name="amount" required inputMode="decimal" hint="Se descontará de las próximas facturas." />
              <TextField label="Motivo" name="description" required maxLength={200} />
            </>
          )}
          {action === 'free-months' && <TextField label="Meses gratis" name="months" type="number" min={1} max={24} defaultValue={1} required hint="Crea un cupón del 100 % de un solo uso y lo aplica a la suscripción." />}
          {action === 'extend-trial' && <TextField label="Días adicionales" name="days" type="number" min={1} max={90} defaultValue={7} required hint="Sólo si la banda está en periodo de prueba." />}
          {action === 'complimentary' && (
            <>
              <SelectField label="Plan" name="planCode" defaultValue="PRO" options={['BASIC', 'PRO', 'ENTERPRISE'].map((c) => ({ value: c, label: c }))} />
              <TextField label="Hasta" name="until" type="date" required hint="Sin cobro en Stripe hasta esa fecha; después pasa a Free. Se avisa a los propietarios 7 días antes." />
              <TextAreaField label="Motivo" name="reason" required maxLength={300} rows={2} />
            </>
          )}
          <FormError error={run.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setAction(null)}>Cancelar</Button>
            <Button type="submit" loading={run.isPending}>Aplicar</Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}

/** Cupones de Stripe y bonificaciones. */
export function CouponsSection() {
  const q = useApi<AdminCoupon[]>('/admin/billing/coupons');
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<AdminCoupon | null>(null);
  const remove = useApiMutation((id: string) => del(`/admin/billing/coupons/${id}`), { success: 'Cupón eliminado', invalidate: ['/admin/billing/coupons'], onSuccess: () => setDeleting(null) });
  return (
    <div className="stack" style={{ gap: 24 }}>
      <Card title="Cupones" actions={<Button size="sm" onClick={() => setCreating(true)}>Nuevo cupón</Button>}>
        {q.isLoading && <Loading />}
        {q.error && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}
        {q.data && (
          <DataTable
            caption="Cupones de Stripe"
            rows={q.data}
            rowKey={(c) => c.id}
            empty="Todavía no hay cupones."
            columns={[
              { key: 'n', header: 'Cupón', render: (c) => <><strong>{c.name ?? c.id}</strong><br /><span className="small mono muted">{c.id}</span></> },
              { key: 'd', header: 'Descuento', render: (c) => couponLabel(c) },
              { key: 'c', header: 'Códigos', render: (c) => (c.promotionCodes.length ? c.promotionCodes.map((p) => p.code).join(', ') : '—') },
              { key: 'u', header: 'Usos', render: (c) => `${c.timesRedeemed}${c.maxRedemptions ? ` / ${c.maxRedemptions}` : ''}`, numeric: true },
              { key: 's', header: 'Estado', render: (c) => <Chip tone={c.valid ? 'success' : 'neutral'}>{c.valid ? 'Vigente' : 'Agotado'}</Chip> },
              { key: 'a', header: 'Acciones', render: (c) => <Button size="sm" variant="danger" onClick={() => setDeleting(c)} aria-label={`Eliminar cupón ${c.name ?? c.id}`}>Eliminar</Button> },
            ]}
          />
        )}
      </Card>
      <TenantActions coupons={q.data ?? []} />
      <Modal open={creating} onClose={() => setCreating(false)} title="Nuevo cupón">
        <CouponForm onDone={() => setCreating(false)} />
      </Modal>
      <ConfirmModal
        open={!!deleting}
        title="Eliminar cupón"
        message={`Se eliminará el cupón ${deleting?.name ?? deleting?.id ?? ''}. Las suscripciones que ya lo usan conservan el descuento.`}
        confirmLabel="Eliminar"
        loading={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}
