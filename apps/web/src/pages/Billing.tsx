import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { post } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import type { Billing, FeatureModule, Plan, PlanCode } from '../api/types';
import type { BillingAddons } from '../api/types-admin-billing';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/Button';
import { Card, StatCard } from '../components/Card';
import { Chip } from '../components/Chip';
import { DataTable } from '../components/DataTable';
import { ErrorNote, Loading } from '../components/EmptyState';
import { Page, PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toasts';
import { bytes, date, money } from '../lib/format';
import { featureLabels } from '../lib/labels';

const ORDER: PlanCode[] = ['FREE', 'BASIC', 'PRO', 'ENTERPRISE'];
/** Plan destacado (pricing-card-featured de DESIGN.md). */
const FEATURED = 'PRO';

const SUB_STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }> = {
  trialing: { label: 'En prueba', tone: 'info' },
  active: { label: 'Activa', tone: 'success' },
  past_due: { label: 'Pago pendiente', tone: 'warning' },
  unpaid: { label: 'Impagada', tone: 'danger' },
  canceled: { label: 'Cancelada', tone: 'neutral' },
  incomplete: { label: 'Incompleta', tone: 'warning' },
};

function limit(n: number, unit = '') {
  return n < 0 ? 'Ilimitado' : `${n.toLocaleString('es-ES')}${unit}`;
}

function featureLines(plan: Plan, catalog: FeatureModule[] | undefined) {
  const set = new Set(plan.features);
  if (!catalog?.length) return plan.features.map((f) => ({ key: f, label: featureLabels[f] ?? f }));
  const lines: { key: string; label: string }[] = [];
  for (const mod of catalog) {
    for (const f of mod.features) {
      if (set.has(f.key)) lines.push({ key: f.key, label: f.label });
    }
  }
  return lines;
}

export function PlanCard({
  plan,
  interval,
  current,
  onChoose,
  loading,
  catalog,
}: {
  plan: Plan;
  interval: 'MONTH' | 'YEAR';
  current: boolean;
  onChoose?: () => void;
  loading?: boolean;
  catalog?: FeatureModule[];
}) {
  const price = interval === 'MONTH' ? plan.priceMonthlyCents : plan.priceYearlyCents;
  const featured = plan.code === FEATURED;
  const features = useMemo(() => featureLines(plan, catalog), [plan, catalog]);
  return (
    <article className={`card pricing-card${featured ? ' pricing-card--featured' : ''}`} aria-label={`Plan ${plan.name}`}>
      <div className="row between">
        <h3 className="card__title">{plan.name}</h3>
        {current ? <span className="chip chip--info">Plan actual</span> : featured && <span className="badge-popular">Más popular</span>}
      </div>
      <p className="stat__value">
        {price === 0 ? 'Gratis' : money(price, plan.currency)}
        {price > 0 && <span className="small"> / {interval === 'MONTH' ? 'mes' : 'año'} + IVA</span>}
      </p>
      {plan.trialDays > 0 && price > 0 && <p className="small">{plan.trialDays} días de prueba gratis</p>}
      <ul className="list-plain small stack" style={{ gap: 6 }}>
        <li>{plan.maxUsers < 0 ? 'Usuarios ilimitados' : `${plan.maxUsers} usuarios`}</li>
        <li>{plan.maxMembers < 0 ? 'Socios ilimitados' : `${plan.maxMembers} socios`}</li>
        <li>{plan.storageMb < 0 ? 'Almacenamiento ilimitado' : `${bytes(plan.storageMb * 1024 * 1024)} de almacenamiento`}</li>
        {features.map((f) => (
          <li key={f.key}>✓ {f.label}</li>
        ))}
      </ul>
      {onChoose && !current && (
        <div style={{ marginTop: 'auto' }}>
          <Button onClick={onChoose} loading={loading}>
            {plan.code === 'FREE' ? 'Bajar a Free' : `Elegir ${plan.name}`}
          </Button>
        </div>
      )}
    </article>
  );
}

export default function BillingPage() {
  const toast = useToast();
  const { reload } = useAuth();
  const [params, setParams] = useSearchParams();
  const [interval, setInterval] = useState<'MONTH' | 'YEAR'>('YEAR');
  const billing = useApi<Billing & BillingAddons>('/billing');
  const plans = useApi<Plan[]>('/plans');
  const catalog = useApi<FeatureModule[]>('/feature-catalog');

  useEffect(() => {
    const result = params.get('checkout');
    if (result === 'success') {
      toast.notify('Suscripción actualizada. Puede tardar unos segundos en reflejarse.');
      reload();
      setParams({}, { replace: true });
    } else if (result === 'cancel') {
      toast.notify('Has cancelado el proceso de pago.');
      setParams({}, { replace: true });
    }
  }, [params, setParams, toast, reload]);

  const checkout = useApiMutation((planCode: PlanCode) => post<{ url: string }>('/billing/checkout', { planCode, interval }), {
    onSuccess: (r) => window.location.assign(r.url),
  });
  const portal = useApiMutation(() => post<{ url: string }>('/billing/portal'), { onSuccess: (r) => window.location.assign(r.url) });

  if (billing.isLoading || plans.isLoading) return <Loading />;
  if (billing.error) return <div className="container page__body"><ErrorNote error={billing.error} /></div>;
  const b = billing.data!;
  const sub = b.subscription;
  const st = sub?.status ? SUB_STATUS[sub.status] ?? { label: sub.status, tone: 'neutral' as const } : null;
  const sorted = [...(plans.data ?? [])].sort((a, c) => ORDER.indexOf(a.code) - ORDER.indexOf(c.code));
  const hasStripe = !!sub?.status;
  const payments = b.billingEnabled !== false;
  const modules = catalog.data;

  return (
    <Page
      header={
        <PageHeader
          eyebrow="Plan y facturación"
          title={`Plan ${b.plan.name}`}
          description={st ? <Chip tone={st.tone}>{st.label}</Chip> : 'Sin suscripción de pago'}
          actions={
            hasStripe && payments && (
              <Button onClick={() => portal.mutate(undefined)} loading={portal.isPending}>
                Gestionar pago y facturas
              </Button>
            )
          }
        />
      }
    >
      {!payments && (
        <Card tone="cream" title="Pagos en línea no disponibles">
          <p>
            La contratación y gestión de planes de pago está desactivada temporalmente. Tu plan actual sigue funcionando con normalidad; si necesitas
            cambiarlo, abre una incidencia de soporte.
          </p>
        </Card>
      )}

      {sub?.graceUntil && payments && (
        <Card tone="warm" title="Pago pendiente">
          <p>
            No hemos podido cobrar la última factura. Stripe volverá a intentarlo automáticamente. Si no se regulariza antes del{' '}
            <strong>{date(sub.graceUntil)}</strong>, la cuenta pasará a modo sólo lectura.
          </p>
          <div className="card__footer">
            <Button onClick={() => portal.mutate(undefined)}>Actualizar método de pago</Button>
          </div>
        </Card>
      )}

      {b.complimentaryUntil && (
        <Card tone="cream" title="Cuenta bonificada">
          <p>
            Tu banda disfruta del plan {b.plan.name} sin coste hasta el <strong>{date(b.complimentaryUntil)}</strong>. Después pasará al plan Free salvo que contrates un plan de pago.
          </p>
        </Card>
      )}

      <div className="grid grid--stats">
        <StatCard label="Usuarios" value={`${b.usage.users} / ${limit(b.plan.maxUsers)}`} meter={b.plan.maxUsers > 0 ? b.usage.users / b.plan.maxUsers : undefined} />
        <StatCard label="Socios" value={`${b.usage.members} / ${limit(b.plan.maxMembers)}`} meter={b.plan.maxMembers > 0 ? b.usage.members / b.plan.maxMembers : undefined} />
        <StatCard
          label="Almacenamiento"
          value={bytes(b.usage.storageBytes)}
          hint={b.plan.storageMb > 0 ? `de ${bytes(b.plan.storageMb * 1024 * 1024)}` : undefined}
          meter={b.plan.storageMb > 0 ? b.usage.storageBytes / (b.plan.storageMb * 1024 * 1024) : undefined}
        />
        {sub && (
          <StatCard
            label={sub.trialEndsAt && new Date(sub.trialEndsAt) > new Date() ? 'Fin de la prueba' : sub.cancelAtPeriodEnd ? 'Se cancela el' : 'Próxima renovación'}
            value={date(sub.trialEndsAt && new Date(sub.trialEndsAt) > new Date() ? sub.trialEndsAt : sub.currentPeriodEnd)}
            hint={sub.interval ? (sub.interval === 'MONTH' ? 'Facturación mensual' : 'Facturación anual') : undefined}
            tone="cream"
          />
        )}
      </div>

      {!!b.addons?.length && (
        <Card title="Add-on Escuela">
          <ul className="list-plain stack" style={{ gap: 6 }}>
            {b.addons.map((l) => (
              <li key={l.key} className="row between">
                <span>
                  {l.label}
                  {l.quantity > 1 && ` × ${l.quantity}`}
                </span>
                <span className="nowrap">{l.unitCents > 0 ? `${money(l.unitCents * l.quantity)} / mes + IVA` : 'Precio según tu contrato'}</span>
              </li>
            ))}
          </ul>
          <p className="small muted">Se cobran junto al plan en cada factura. Los cambios de plazas se prorratean.</p>
        </Card>
      )}

      <section aria-labelledby="plans-title" className="stack" style={{ gap: 16 }}>
        <div className="row between">
          <h2 id="plans-title">Planes</h2>
          <div className="segmented" role="group" aria-label="Periodicidad de pago">
            <button aria-pressed={interval === 'MONTH'} onClick={() => setInterval('MONTH')}>
              Mensual
            </button>
            <button aria-pressed={interval === 'YEAR'} onClick={() => setInterval('YEAR')}>
              Anual (2 meses gratis)
            </button>
          </div>
        </div>
        <div className="grid">
          {sorted.map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              interval={interval}
              current={p.code === b.plan.code}
              catalog={modules}
              loading={checkout.isPending && checkout.variables === p.code}
              onChoose={
                !payments
                  ? undefined
                  : p.code === 'FREE'
                  ? hasStripe
                    ? () => portal.mutate(undefined)
                    : undefined
                  : hasStripe
                    ? () => portal.mutate(undefined)
                    : () => checkout.mutate(p.code)
              }
            />
          ))}
        </div>
        <p className="small muted">
          Precios sin IVA; el impuesto se calcula en el pago según tu país y CIF. Puedes usar un código promocional en el formulario de pago. Los cambios de plan se prorratean.
        </p>
      </section>

      <Card title="Facturas">
        <DataTable
          caption="Facturas"
          rows={b.invoices}
          rowKey={(i) => i.id}
          empty="Todavía no hay facturas."
          columns={[
            { key: 'n', header: 'Número', render: (i) => (i.number ? <span className="mono">{i.number}</span> : '—'), nowrap: true },
            { key: 'd', header: 'Fecha', render: (i) => date(i.createdAt), nowrap: true },
            { key: 't', header: 'Total', render: (i) => money(i.totalCents, i.currency), numeric: true, nowrap: true },
            { key: 'tax', header: 'IVA', render: (i) => money(i.taxCents, i.currency), numeric: true, nowrap: true },
            {
              key: 's',
              header: 'Estado',
              render: (i) => <Chip tone={i.status === 'paid' ? 'success' : i.status === 'open' ? 'warning' : 'neutral'}>{i.status === 'paid' ? 'Pagada' : i.status === 'open' ? 'Pendiente' : i.status}</Chip>,
            },
            {
              key: 'a',
              header: 'Documento',
              render: (i) =>
                i.pdfUrl || i.hostedUrl ? (
                  <a
                    className="link-arrow"
                    href={i.pdfUrl ?? i.hostedUrl!}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Descargar factura ${i.number ?? ''} (se abre en otra pestaña)`}
                  >
                    Descargar
                  </a>
                ) : (
                  '—'
                ),
            },
          ]}
        />
      </Card>
    </Page>
  );
}
