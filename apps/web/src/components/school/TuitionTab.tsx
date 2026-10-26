import { useState } from 'react';
import { Link } from 'react-router-dom';
import { downloadFile, post } from '../../api/client';
import { useApi, useApiMutation } from '../../api/hooks';
import type { Paginated } from '../../api/types';
import type { Family, PaymentMethod, SchoolSettings, TuitionCharge, TuitionPreview } from '../../api/types-school';
import { useAuth } from '../../auth/AuthProvider';
import { date, fullName, money, today } from '../../lib/format';
import { discountKind, paymentMethod, tuitionStatus } from '../../lib/labels-school';
import { Button } from '../Button';
import { Card } from '../Card';
import { StatusChip } from '../Chip';
import { DataTable, Pagination } from '../DataTable';
import { EmptyState, ErrorNote, Loading } from '../EmptyState';
import { Checkbox, FormError, SelectField, TextField, formValues } from '../Field';
import { Menu } from '../Menu';
import { ConfirmModal } from '../Modal';
import { useToast } from '../Toasts';
import { useSchoolYears, YearSelect } from './common';
import { PayModal } from './PayModal';

const thisMonth = () => today().slice(0, 7);
const isOpen = (c: TuitionCharge) => c.status === 'PENDING' || c.status === 'OVERDUE';

type Paying = { kind: 'one'; charge: TuitionCharge } | { kind: 'many'; charges: TuitionCharge[] } | { kind: 'family'; family: Family; cents: number };

function discountText(c: TuitionCharge) {
  const parts = [
    c.detail.tariff?.name,
    c.detail.tariffMissing ? 'Sin tarifa' : null,
    ...c.detail.discounts.map((d) => (d.kind === 'FAMILY' ? `${discountKind.FAMILY} ${money(d.cents)}` : `${discountKind[d.kind]} ${d.pct} %`)),
  ].filter(Boolean);
  if (!parts.length) return '—';
  return `${parts.join(', ')}${c.discountCents ? ` (−${money(c.discountCents)})` : ''}`;
}

/** Emisión: primero calcula cuánto se va a emitir y lo confirma. */
function IssueCard({ yearId }: { yearId: string }) {
  const toast = useToast();
  const settings = useApi<SchoolSettings>('/school/settings');
  const [pending, setPending] = useState<{ period: string; dueDate: string; preview: TuitionPreview } | null>(null);
  const preview = useApiMutation((v: { period: string; dueDate: string }) => post<TuitionPreview>('/school/tuition/preview', { yearId }).then((preview) => ({ ...v, preview })), {
    onSuccess: (r) => setPending(r),
  });
  const issue = useApiMutation((body: unknown) => post<{ created: number; skipped: number; emailed: number }>('/school/tuition/issue', body), {
    invalidate: ['/school/tuition', '/school/overview'],
    onSuccess: (r) => {
      setPending(null);
      toast.notify(`${r.created} mensualidades emitidas${r.skipped ? `, ${r.skipped} ya existían` : ''}${r.emailed ? `. ${r.emailed} avisos por email a las familias` : ''}`);
    },
  });
  const auto = settings.data?.autoIssueDay;
  return (
    <Card title="Emitir mensualidades" tone="cream">
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          const v = formValues(e.currentTarget);
          preview.mutate({ period: v.period!, dueDate: v.dueDate! });
        }}
      >
        <TextField label="Mes" name="period" type="month" required defaultValue={thisMonth()} />
        <TextField label="Vencimiento" name="dueDate" type="date" required defaultValue={`${thisMonth()}-${String(settings.data?.autoIssueDueDay ?? 5).padStart(2, '0')}`} />
        <Button type="submit" loading={preview.isPending}>
          Emitir…
        </Button>
      </form>
      <p className="small muted">
        {auto ? (
          <>Emisión automática activada: el día {auto} de cada mes se emiten solas las del curso actual. </>
        ) : (
          <>
            Puedes <Link to="/school?tab=settings&section=cobro">programar la emisión</Link> para no tener que hacerlo cada mes.{' '}
          </>
        )}
        Volver a emitir el mismo mes no duplica cargos.
      </p>
      <FormError error={preview.error ?? issue.error} />
      <ConfirmModal
        open={!!pending}
        title={`Emitir ${pending?.period ?? ''}`}
        message={
          pending && (
            <div className="stack" style={{ gap: 8 }}>
              <p>
                Se emitirán hasta <strong>{pending.preview.students}</strong> mensualidades por <strong>{money(pending.preview.totalAmountCents)}</strong> (descuentos:{' '}
                {money(pending.preview.totalDiscountCents)}), con vencimiento el {date(pending.dueDate)}.
              </p>
              <p className="small muted">
                Las que ya estén emitidas ese mes no se repiten.
                {settings.data?.notifyFamilies ? ' Las familias con email recibirán un aviso.' : ''}
              </p>
            </div>
          )
        }
        confirmLabel="Emitir"
        loading={issue.isPending}
        onConfirm={() => pending && issue.mutate({ yearId, period: pending.period, dueDate: pending.dueDate })}
        onClose={() => setPending(null)}
      />
    </Card>
  );
}

export function TuitionTab() {
  const { can } = useAuth();
  const toast = useToast();
  const write = can('school:tuition');
  const { years, yearId, setYearId, isLoading } = useSchoolYears();
  const [period, setPeriod] = useState(thisMonth());
  const [status, setStatus] = useState('');
  const [familyId, setFamilyId] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const families = useApi<Family[]>(can('school:write') ? '/school/families' : null);
  const list = useApi<Paginated<TuitionCharge> & { totalAmountCents: number }>(yearId ? '/school/tuition/charges' : null, {
    yearId, period: familyId ? undefined : period, status, familyId: familyId || undefined, page, pageSize: 50,
  });
  const [paying, setPaying] = useState<Paying | null>(null);
  const [waiving, setWaiving] = useState<TuitionCharge | null>(null);
  const done = () => {
    setPaying(null);
    setSelected(new Set());
  };
  const invalidate = ['/school/tuition', '/school/overview', '/school/students', '/finance'];
  const pay = useApiMutation(
    ({ target, v }: { target: Paying; v: { date: string; method: PaymentMethod } }) => {
      if (target.kind === 'one') return post(`/school/tuition/charges/${target.charge.id}/pay`, v);
      if (target.kind === 'many') return post('/school/tuition/charges/pay', { ...v, chargeIds: target.charges.map((c) => c.id) });
      return post(`/school/tuition/families/${target.family.id}/pay`, v);
    },
    { success: 'Cobro registrado en tesorería', invalidate, onSuccess: done },
  );
  const waive = useApiMutation((c: TuitionCharge) => post(`/school/tuition/charges/${c.id}/waive`), { success: 'Mensualidad condonada', invalidate, onSuccess: () => setWaiving(null) });
  const reset = () => {
    setPage(1);
    setSelected(new Set());
  };

  if (isLoading) return <Loading />;
  if (!years.length) return <EmptyState title="Sin cursos" icon="calendar">Crea el primer curso escolar en Configuración.</EmptyState>;
  const rows = list.data?.data ?? [];
  const open = rows.filter(isOpen);
  const chosen = open.filter((c) => selected.has(c.id));
  const family = families.data?.find((f) => f.id === familyId);
  const familyOpen = familyId ? rows.filter(isOpen).reduce((s, c) => s + c.amountCents, 0) : 0;
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <div className="stack" style={{ gap: 24 }}>
      {write && <IssueCard yearId={yearId} />}
      <Card>
        <div className="toolbar">
          <YearSelect years={years} value={yearId} onChange={(id) => { setYearId(id); reset(); }} />
          <TextField label="Mes" type="month" value={period} disabled={!!familyId} onChange={(e) => { setPeriod(e.target.value); reset(); }} />
          <SelectField label="Estado" value={status} onChange={(e) => { setStatus(e.target.value); reset(); }} placeholder="Todos" options={Object.entries(tuitionStatus).map(([value, { label }]) => ({ value, label }))} />
          {families.data && (
            <SelectField label="Familia" value={familyId} onChange={(e) => { setFamilyId(e.target.value); reset(); }} placeholder="Todas" options={families.data.map((f) => ({ value: f.id, label: f.name }))} />
          )}
          {period && !familyId && (
            <Button variant="ghost" onClick={() => downloadFile(`/school/tuition/export.csv?period=${period}`, `cargos-escuela-${period}.csv`).catch(toast.error)}>
              Exportar CSV
            </Button>
          )}
        </div>
        {familyId && <p className="small muted">Todas las mensualidades de la familia, de cualquier mes.</p>}
      </Card>
      {write && (chosen.length > 0 || (family && familyOpen > 0)) && (
        <div className="callout" role="status">
          <div className="row between" style={{ flexWrap: 'wrap', gap: 12, width: '100%' }}>
            {chosen.length > 0 ? (
              <>
                <span>
                  {chosen.length} seleccionada(s) · <strong>{money(chosen.reduce((s, c) => s + c.amountCents, 0))}</strong>
                </span>
                <span className="row" style={{ gap: 8 }}>
                  <Button variant="ghost" onClick={() => setSelected(new Set())}>
                    Quitar selección
                  </Button>
                  <Button onClick={() => setPaying({ kind: 'many', charges: chosen })}>Registrar cobro</Button>
                </span>
              </>
            ) : (
              <>
                <span>
                  {family!.name} tiene <strong>{money(familyOpen)}</strong> pendiente.
                </span>
                <Button onClick={() => setPaying({ kind: 'family', family: family!, cents: familyOpen })}>Cobrar todo lo pendiente</Button>
              </>
            )}
          </div>
        </div>
      )}
      {list.isLoading && <Loading />}
      {list.error && <ErrorNote error={list.error} />}
      {list.data && (
        <Card
          title={`Total: ${money(list.data.totalAmountCents)}`}
          actions={
            write && open.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(open.map((c) => c.id)))}>
                Seleccionar pendientes ({open.length})
              </Button>
            )
          }
        >
          <DataTable
            caption="Mensualidades de la escuela"
            rows={rows}
            rowKey={(c) => c.id}
            empty="No hay mensualidades con este filtro."
            columns={[
              ...(write
                ? [{
                    key: 'sel',
                    header: 'Sel.',
                    render: (c: TuitionCharge) =>
                      isOpen(c) ? (
                        <Checkbox label={<span className="sr-only">Seleccionar la de {c.student ? fullName(c.student) : ''}</span>} checked={selected.has(c.id)} onChange={(e) => toggle(c.id, e.target.checked)} />
                      ) : null,
                  }]
                : []),
              { key: 's', header: 'Alumno', render: (c) => (c.student ? <Link to={`/school/students/${c.student.id}`}>{fullName(c.student)}</Link> : '—') },
              { key: 'f', header: 'Familia', render: (c) => c.family?.name ?? '—' },
              { key: 'p', header: 'Mes', render: (c) => c.period, nowrap: true },
              { key: 'b', header: 'Base', render: (c) => money(c.baseCents), numeric: true, nowrap: true },
              { key: 'd', header: 'Descuentos', render: discountText },
              { key: 'a', header: 'Importe', render: (c) => <strong>{money(c.amountCents)}</strong>, numeric: true, nowrap: true },
              { key: 'v', header: 'Vence', render: (c) => date(c.dueDate), nowrap: true },
              {
                key: 'st',
                header: 'Estado',
                render: (c) => (
                  <span>
                    <StatusChip value={c.status} map={tuitionStatus} />
                    {c.status === 'PAID' && (
                      <span className="small muted">
                        {' '}
                        {date(c.paidAt)}
                        {c.paymentMethod ? ` · ${paymentMethod[c.paymentMethod]}` : ''}
                      </span>
                    )}
                  </span>
                ),
              },
              ...(write
                ? [
                    {
                      key: 'x',
                      header: 'Acciones',
                      render: (c: TuitionCharge) =>
                        isOpen(c) ? (
                          <Menu
                            label={`Acciones de la mensualidad de ${c.student ? fullName(c.student) : ''}`}
                            items={[
                              { label: 'Registrar cobro', onSelect: () => setPaying({ kind: 'one', charge: c }) },
                              { label: 'Condonar', onSelect: () => setWaiving(c), danger: true },
                            ]}
                          />
                        ) : null,
                    },
                  ]
                : []),
            ]}
          />
          <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
        </Card>
      )}
      {paying && (
        <PayModal
          open
          title={paying.kind === 'family' ? `Cobrar a ${paying.family.name}` : 'Registrar cobro'}
          summary={
            paying.kind === 'one'
              ? `Mensualidad de ${paying.charge.period} de ${paying.charge.student ? fullName(paying.charge.student) : 'alumno'}:`
              : paying.kind === 'many'
                ? `${paying.charges.length} mensualidades:`
                : 'Todas las mensualidades pendientes de la familia:'
          }
          amountCents={paying.kind === 'one' ? paying.charge.amountCents : paying.kind === 'many' ? paying.charges.reduce((s, c) => s + c.amountCents, 0) : paying.cents}
          loading={pay.isPending}
          error={pay.error}
          onConfirm={(v) => pay.mutate({ target: paying, v })}
          onClose={() => setPaying(null)}
        />
      )}
      <ConfirmModal
        open={!!waiving}
        title="Condonar mensualidad"
        message={waiving ? `La mensualidad de ${waiving.period} de ${waiving.student ? fullName(waiving.student) : 'este alumno'} (${money(waiving.amountCents)}) dejará de cobrarse. No se puede deshacer.` : ''}
        confirmLabel="Condonar"
        loading={waive.isPending}
        onConfirm={() => waiving && waive.mutate(waiving)}
        onClose={() => setWaiving(null)}
      />
    </div>
  );
}
