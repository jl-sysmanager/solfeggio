import { useState, type FormEvent } from 'react';
import { del, downloadFile, post } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import type { ChargeStatus, Fee, FeeCharge, FinanceCategory, FinanceSummary, Paginated, Transaction, TxKind } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { Person } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card, StatCard } from '../components/Card';
import { Chip, StatusChip } from '../components/Chip';
import { DataTable, Pagination } from '../components/DataTable';
import { ErrorNote, Loading } from '../components/EmptyState';
import { FormError, SelectField, TextField, formValues } from '../components/Field';
import { Menu } from '../components/Menu';
import { ConfirmModal, Modal } from '../components/Modal';
import { Page, PageHeader } from '../components/PageHeader';
import { Tabs } from '../components/Tabs';
import { useToast } from '../components/Toasts';
import { DonorsTab } from '../components/treasury/DonorsTab';
import { GrantsTab } from '../components/treasury/GrantsTab';
import { LotteryTab } from '../components/treasury/LotteryTab';
import { date, fullName, money, parseMoney, today } from '../lib/format';
import { chargeStatus, periodicity } from '../lib/labels';

const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function MonthlyChart({ monthly }: { monthly: FinanceSummary['monthly'] }) {
  const max = Math.max(1, ...monthly.flatMap((m) => [m.incomeCents, m.expenseCents]));
  return (
    <figure style={{ margin: 0 }}>
      <div
        aria-hidden="true"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 6, alignItems: 'end', height: 160, borderBottom: '1px solid var(--border)' }}
      >
        {MONTHS.map((label, i) => {
          const m = monthly.find((x) => x.month === i + 1) ?? { incomeCents: 0, expenseCents: 0 };
          return (
            <div key={label} style={{ display: 'flex', gap: 2, alignItems: 'end', height: '100%' }}>
              <div style={{ flex: 1, height: `${(m.incomeCents / max) * 100}%`, background: 'var(--chart-bar)', borderRadius: '4px 4px 0 0' }} />
              <div style={{ flex: 1, height: `${(m.expenseCents / max) * 100}%`, background: 'var(--chart-bar-alt)', borderRadius: '4px 4px 0 0' }} />
            </div>
          );
        })}
      </div>
      <div aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 6 }} className="small muted">
        {MONTHS.map((m) => (
          <span key={m} style={{ textAlign: 'center' }}>
            {m}
          </span>
        ))}
      </div>
      <figcaption className="row small" style={{ marginTop: 8 }}>
        <span className="row" style={{ gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 9999, background: 'var(--chart-bar)', display: 'inline-block' }} /> Ingresos
        </span>
        <span className="row" style={{ gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 9999, background: 'var(--chart-bar-alt)', display: 'inline-block' }} /> Gastos
        </span>
      </figcaption>
      <table className="sr-only">
        <caption>Ingresos y gastos por mes</caption>
        <thead>
          <tr>
            <th>Mes</th>
            <th>Ingresos</th>
            <th>Gastos</th>
          </tr>
        </thead>
        <tbody>
          {monthly.map((m) => (
            <tr key={m.month}>
              <td>{MONTHS[m.month - 1]}</td>
              <td>{money(m.incomeCents)}</td>
              <td>{money(m.expenseCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function SummaryTab() {
  const toast = useToast();
  const [year, setYear] = useState(new Date().getFullYear());
  const q = useApi<FinanceSummary>('/finance/reports/summary', { year });
  const s = q.data;
  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="row between">
        <div className="row">
          <Button variant="ghost" size="sm" onClick={() => setYear(year - 1)} aria-label="Año anterior">
            ←
          </Button>
          <strong aria-live="polite">{year}</strong>
          <Button variant="ghost" size="sm" onClick={() => setYear(year + 1)} aria-label="Año siguiente">
            →
          </Button>
        </div>
        <Button variant="ghost" size="sm" onClick={() => downloadFile(`/finance/reports/transactions.csv?year=${year}`, `movimientos-${year}.csv`).catch(toast.error)}>
          Exportar CSV
        </Button>
      </div>
      {q.isLoading && <Loading />}
      {q.error && <ErrorNote error={q.error} />}
      {s && (
        <>
          <div className="grid grid--stats">
            <StatCard label="Ingresos" value={money(s.incomeCents)} tone="cool" />
            <StatCard label="Gastos" value={money(s.expenseCents)} />
            <StatCard label="Saldo del año" value={money(s.balanceCents)} tone={s.balanceCents < 0 ? 'warm' : 'cream'} />
            <StatCard label="Cuotas pendientes" value={money(s.pendingCharges.amountCents)} hint={`${s.pendingCharges.count} recibos`} />
          </div>
          <div className="grid grid--2">
            <Card title="Evolución mensual">
              <MonthlyChart monthly={s.monthly} />
            </Card>
            <Card title="Por categoría" tone="cream">
              <ul className="list-plain list-divided">
                {s.byCategory.map((c) => (
                  <li key={`${c.kind}-${c.category}`} className="row between">
                    <span>
                      <Chip tone={c.kind === 'INCOME' ? 'success' : 'danger'}>{c.kind === 'INCOME' ? 'Ingreso' : 'Gasto'}</Chip> {c.category}
                    </span>
                    <strong>{money(c.totalCents)}</strong>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function TransactionModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [kind, setKind] = useState<TxKind>('EXPENSE');
  const cats = useApi<FinanceCategory[]>('/finance/categories');
  const create = useApiMutation((body: unknown) => post('/finance/transactions', body), {
    success: 'Movimiento registrado',
    invalidate: ['/finance'],
    onSuccess: onClose,
  });
  const newCat = useApiMutation((body: unknown) => post('/finance/categories', body), { success: 'Categoría creada', invalidate: ['/finance/categories'] });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    create.mutate({ kind, amountCents: parseMoney(v.amount ?? '0'), date: v.date, categoryId: v.categoryId ?? null, description: v.description });
  }
  return (
    <Modal open={open} onClose={onClose} title="Nuevo movimiento">
      <form className="form" onSubmit={submit}>
        <div className="segmented" role="group" aria-label="Tipo de movimiento">
          <button type="button" aria-pressed={kind === 'INCOME'} onClick={() => setKind('INCOME')}>
            Ingreso
          </button>
          <button type="button" aria-pressed={kind === 'EXPENSE'} onClick={() => setKind('EXPENSE')}>
            Gasto
          </button>
        </div>
        <div className="form-row">
          <TextField label="Importe (€)" name="amount" inputMode="decimal" pattern="\d+([.,]\d{1,2})?" required placeholder="120,50" />
          <TextField label="Fecha" name="date" type="date" required defaultValue={today()} />
        </div>
        <TextField label="Concepto" name="description" required />
        <SelectField
          label="Categoría"
          name="categoryId"
          placeholder="Sin categoría"
          options={(cats.data ?? []).filter((c) => c.kind === kind).map((c) => ({ value: c.id, label: c.name }))}
        />
        <button
          type="button"
          className="link-arrow small"
          onClick={() => {
            const name = window.prompt('Nombre de la nueva categoría');
            if (name) newCat.mutate({ name, kind });
          }}
        >
          Crear categoría
        </button>
        <FormError error={create.error} />
        <div className="modal__footer">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={create.isPending}>
            Guardar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function TransactionsTab() {
  const { can } = useAuth();
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<Transaction | null>(null);
  const q = useApi<Paginated<Transaction>>('/finance/transactions', { kind, page, pageSize: 25 });
  const remove = useApiMutation((id: string) => del(`/finance/transactions/${id}`), {
    success: 'Movimiento eliminado',
    invalidate: ['/finance'],
    onSuccess: () => setRemoving(null),
  });
  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="row between">
        <div className="segmented" role="group" aria-label="Filtrar">
          {[
            ['', 'Todos'],
            ['INCOME', 'Ingresos'],
            ['EXPENSE', 'Gastos'],
          ].map(([k, l]) => (
            <button key={k} aria-pressed={kind === k} onClick={() => { setKind(k); setPage(1); }}>
              {l}
            </button>
          ))}
        </div>
        {can('finance:write') && <Button onClick={() => setOpen(true)}>Nuevo movimiento</Button>}
      </div>
      {q.isLoading && <Loading />}
      {q.error && <ErrorNote error={q.error} />}
      {q.data && (
        <Card>
          <DataTable
            caption="Movimientos"
            rows={q.data.data}
            rowKey={(t) => t.id}
            columns={[
              { key: 'd', header: 'Fecha', render: (t) => date(t.date), nowrap: true },
              { key: 'c', header: 'Concepto', render: (t) => t.description },
              { key: 'cat', header: 'Categoría', render: (t) => t.category?.name ?? '—' },
              {
                key: 'a',
                header: 'Importe',
                numeric: true,
                nowrap: true,
                render: (t) => (
                  <strong>
                    {t.kind === 'EXPENSE' ? '−' : '+'}
                    {money(t.amountCents, t.currency)}
                  </strong>
                ),
              },
              ...(can('finance:write')
                ? [
                    {
                      key: 'x',
                      header: 'Acciones',
                      render: (t: Transaction) => (
                        <Menu label={`Acciones de ${t.description}`} items={[{ label: 'Eliminar movimiento', onSelect: () => setRemoving(t), danger: true }]} />
                      ),
                    },
                  ]
                : []),
            ]}
          />
          <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />
        </Card>
      )}
      <TransactionModal open={open} onClose={() => setOpen(false)} />
      <ConfirmModal
        open={!!removing}
        title="Eliminar movimiento"
        message={`¿Eliminar «${removing?.description}»? Quedará registrado en la auditoría.`}
        confirmLabel="Eliminar"
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}

function FeesTab() {
  const { can } = useAuth();
  const write = can('finance:write');
  const fees = useApi<Fee[]>('/finance/fees');
  const [status, setStatus] = useState<ChargeStatus | ''>('PENDING');
  const [page, setPage] = useState(1);
  const charges = useApi<Paginated<FeeCharge>>('/finance/charges', { status, page, pageSize: 25 });
  const [creating, setCreating] = useState(false);
  const [issuing, setIssuing] = useState<Fee | null>(null);

  const createFee = useApiMutation((body: unknown) => post('/finance/fees', body), {
    success: 'Cuota creada',
    invalidate: ['/finance/fees'],
    onSuccess: () => setCreating(false),
  });
  const issue = useApiMutation((body: { id: string; period: string; dueDate: string }) => post<{ created?: number }>(`/finance/fees/${body.id}/issue`, { period: body.period, dueDate: body.dueDate }), {
    success: 'Recibos emitidos',
    invalidate: ['/finance', '/dashboard'],
    onSuccess: () => setIssuing(null),
  });
  const pay = useApiMutation((id: string) => post(`/finance/charges/${id}/pay`, { date: today() }), { success: 'Pago registrado', invalidate: ['/finance', '/dashboard'] });
  const waive = useApiMutation((id: string) => post(`/finance/charges/${id}/waive`), { success: 'Cuota condonada', invalidate: ['/finance', '/dashboard'] });

  const now = new Date();
  const defaultPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <Card title="Cuotas" actions={write && <Button size="sm" onClick={() => setCreating(true)}>Nueva cuota</Button>}>
        {fees.isLoading && <Loading />}
        {fees.data && (
          <ul className="grid list-plain">
            {fees.data.map((f) => (
              <li key={f.id} className="card card--cream stack">
                <h3 className="card__title">{f.name}</h3>
                <p>
                  <strong>{money(f.amountCents)}</strong> · {periodicity[f.periodicity]}
                </p>
                <div className="row">
                  <Chip tone={f.active ? 'success' : 'neutral'}>{f.active ? 'Activa' : 'Inactiva'}</Chip>
                  {write && f.active && (
                    <Button size="sm" variant="ghost" onClick={() => setIssuing(f)}>
                      Emitir recibos
                    </Button>
                  )}
                </div>
              </li>
            ))}
            {fees.data.length === 0 && <li className="muted">Define las cuotas de socio (mensual, anual…) para emitir recibos.</li>}
          </ul>
        )}
      </Card>

      <Card title="Recibos">
        <div className="segmented" role="group" aria-label="Filtrar recibos" style={{ marginBottom: 16 }}>
          {(['PENDING', 'OVERDUE', 'PAID', 'WAIVED', ''] as const).map((s) => (
            <button key={s} aria-pressed={status === s} onClick={() => { setStatus(s); setPage(1); }}>
              {s ? chargeStatus[s].label : 'Todos'}
            </button>
          ))}
        </div>
        {charges.isLoading && <Loading />}
        {charges.error && <ErrorNote error={charges.error} />}
        {charges.data && (
          <>
            <DataTable
              caption="Recibos de cuotas"
              rows={charges.data.data}
              rowKey={(c) => c.id}
              columns={[
                { key: 'm', header: 'Socio', render: (c) => <Person name={fullName(c.member)} /> },
                { key: 'f', header: 'Cuota', render: (c) => c.fee?.name ?? '—' },
                { key: 'p', header: 'Periodo', render: (c) => c.period, nowrap: true },
                { key: 'd', header: 'Vence', render: (c) => date(c.dueDate), nowrap: true },
                { key: 'a', header: 'Importe', render: (c) => money(c.amountCents), numeric: true, nowrap: true },
                { key: 's', header: 'Estado', render: (c) => <StatusChip value={c.status} map={chargeStatus} /> },
                ...(write
                  ? [
                      {
                        key: 'x',
                        header: 'Acciones',
                        render: (c: FeeCharge) =>
                          c.status === 'PENDING' || c.status === 'OVERDUE' ? (
                            <Menu
                              label={`Acciones del recibo de ${fullName(c.member)}`}
                              items={[
                                { label: 'Registrar cobro', onSelect: () => pay.mutate(c.id), disabled: pay.isPending },
                                { label: 'Condonar', onSelect: () => waive.mutate(c.id), disabled: waive.isPending, danger: true },
                              ]}
                            />
                          ) : (
                            <span className="small muted nowrap">{c.paidAt ? `Pagada ${date(c.paidAt)}` : '—'}</span>
                          ),
                      },
                    ]
                  : []),
              ]}
            />
            <Pagination page={charges.data.page} pageSize={charges.data.pageSize} total={charges.data.total} onPage={setPage} />
          </>
        )}
      </Card>

      <Modal open={creating} onClose={() => setCreating(false)} title="Nueva cuota">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            createFee.mutate({ name: v.name, amountCents: parseMoney(v.amount ?? '0'), periodicity: v.periodicity });
          }}
        >
          <TextField label="Nombre" name="name" required placeholder="Cuota de socio" />
          <div className="form-row">
            <TextField label="Importe (€)" name="amount" inputMode="decimal" required pattern="\d+([.,]\d{1,2})?" />
            <SelectField label="Periodicidad" name="periodicity" options={Object.entries(periodicity).map(([value, label]) => ({ value, label }))} />
          </div>
          <FormError error={createFee.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={createFee.isPending}>
              Crear
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!issuing} onClose={() => setIssuing(null)} title={`Emitir recibos: ${issuing?.name ?? ''}`}>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            if (issuing) issue.mutate({ id: issuing.id, period: v.period!, dueDate: v.dueDate! });
          }}
        >
          <p className="small">Se emitirá un recibo a cada socio activo. Si ya existe para el periodo, no se duplica.</p>
          <div className="form-row">
            <TextField label="Periodo" name="period" required defaultValue={defaultPeriod} hint="Ej.: 2026-10, 2026-T4 o 2026" />
            <TextField label="Vencimiento" name="dueDate" type="date" required defaultValue={today()} />
          </div>
          <FormError error={issue.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setIssuing(null)}>
              Cancelar
            </Button>
            <Button type="submit" loading={issue.isPending}>
              Emitir
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default function TreasuryPage() {
  return (
    <Page header={<PageHeader eyebrow="Tesorería" title="Cuentas de la banda" description="Ingresos, gastos, cuotas, subvenciones, lotería, donantes e informes." />}>
      <Tabs
        label="Secciones de tesorería"
        tabs={[
          { id: 'summary', label: 'Resumen', content: <SummaryTab /> },
          { id: 'tx', label: 'Movimientos', content: <TransactionsTab /> },
          { id: 'fees', label: 'Cuotas y recibos', content: <FeesTab /> },
          { id: 'grants', label: 'Subvenciones', content: <GrantsTab /> },
          { id: 'lottery', label: 'Lotería', content: <LotteryTab /> },
          { id: 'donors', label: 'Donantes', content: <DonorsTab /> },
        ]}
      />
    </Page>
  );
}
