import { useState } from 'react';
import { Link } from 'react-router-dom';
import { downloadFile, post } from '../../api/client';
import { useApi, useApiMutation } from '../../api/hooks';
import type { Paginated } from '../../api/types';
import type { TuitionCharge } from '../../api/types-school';
import { useAuth } from '../../auth/AuthProvider';
import { date, fullName, money, today } from '../../lib/format';
import { discountKind, tuitionStatus } from '../../lib/labels-school';
import { Button } from '../Button';
import { Card } from '../Card';
import { StatusChip } from '../Chip';
import { DataTable, Pagination } from '../DataTable';
import { EmptyState, ErrorNote, Loading } from '../EmptyState';
import { FormError, SelectField, TextField, formValues } from '../Field';
import { Menu } from '../Menu';
import { ConfirmModal } from '../Modal';
import { useToast } from '../Toasts';
import { useSchoolYears, YearSelect } from './common';

const thisMonth = () => today().slice(0, 7);

export function TuitionTab() {
  const { can } = useAuth();
  const toast = useToast();
  const write = can('finance:write');
  const { years, yearId, setYearId, isLoading } = useSchoolYears();
  const [period, setPeriod] = useState(thisMonth());
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const list = useApi<Paginated<TuitionCharge> & { totalAmountCents: number }>(yearId ? '/school/tuition/charges' : null, { yearId, period, status, page, pageSize: 50 });
  const [paying, setPaying] = useState<TuitionCharge | null>(null);
  const issue = useApiMutation((body: unknown) => post<{ created: number; skipped: number }>('/school/tuition/issue', body), {
    invalidate: ['/school/tuition'],
    onSuccess: (r) => toast.notify(`${r.created} mensualidades emitidas${r.skipped ? `, ${r.skipped} ya existían` : ''}`),
  });
  const pay = useApiMutation((c: TuitionCharge) => post(`/school/tuition/charges/${c.id}/pay`, { date: today() }), {
    success: 'Cobro registrado en tesorería',
    invalidate: ['/school/tuition', '/finance'],
    onSuccess: () => setPaying(null),
  });
  const waive = useApiMutation((c: TuitionCharge) => post(`/school/tuition/charges/${c.id}/waive`), { success: 'Mensualidad condonada', invalidate: ['/school/tuition'] });

  if (isLoading) return <Loading />;
  if (!years.length) return <EmptyState title="Sin cursos" icon="calendar">Crea el primer curso escolar en Configuración.</EmptyState>;
  return (
    <div className="stack" style={{ gap: 24 }}>
      {write && (
        <Card title="Emitir mensualidades" tone="cream">
          <form
            className="toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              const v = formValues(e.currentTarget);
              issue.mutate({ yearId, period: v.period, dueDate: v.dueDate });
            }}
          >
            <TextField label="Mes" name="period" type="month" required defaultValue={thisMonth()} />
            <TextField label="Vencimiento" name="dueDate" type="date" required defaultValue={`${thisMonth()}-05`} />
            <Button type="submit" loading={issue.isPending}>
              Emitir
            </Button>
          </form>
          <p className="small muted">Suma las matrículas activas del curso y aplica los descuentos de Configuración. Volver a emitir el mismo mes no duplica cargos.</p>
          <FormError error={issue.error} />
        </Card>
      )}
      <Card>
        <div className="toolbar">
          <YearSelect years={years} value={yearId} onChange={(id) => { setYearId(id); setPage(1); }} />
          <TextField label="Mes" type="month" value={period} onChange={(e) => { setPeriod(e.target.value); setPage(1); }} />
          <SelectField label="Estado" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} placeholder="Todos" options={Object.entries(tuitionStatus).map(([value, { label }]) => ({ value, label }))} />
          {can('finance:read') && period && (
            <Button variant="ghost" onClick={() => downloadFile(`/school/tuition/export.csv?period=${period}`, `cargos-escuela-${period}.csv`).catch(toast.error)}>
              Exportar CSV
            </Button>
          )}
        </div>
      </Card>
      {list.isLoading && <Loading />}
      {list.error && <ErrorNote error={list.error} />}
      {list.data && (
        <Card title={`Total: ${money(list.data.totalAmountCents)}`}>
          <DataTable
            caption="Mensualidades de la escuela"
            rows={list.data.data}
            rowKey={(c) => c.id}
            empty="No hay mensualidades con este filtro."
            columns={[
              { key: 's', header: 'Alumno', render: (c) => (c.student ? <Link to={`/school/students/${c.student.id}`}>{fullName(c.student)}</Link> : '—') },
              { key: 'f', header: 'Familia', render: (c) => c.family?.name ?? '—' },
              { key: 'p', header: 'Mes', render: (c) => c.period, nowrap: true },
              { key: 'b', header: 'Base', render: (c) => money(c.baseCents), numeric: true, nowrap: true },
              {
                key: 'd',
                header: 'Descuentos',
                render: (c) => {
                  const parts = [
                    c.detail.tariff?.name,
                    c.detail.tariffMissing ? 'Sin tarifa' : null,
                    ...c.detail.discounts.map((d) => (d.kind === 'FAMILY' ? `${discountKind.FAMILY} ${money(d.cents)}` : `${discountKind[d.kind]} ${d.pct} %`)),
                  ].filter(Boolean);
                  if (!parts.length) return '—';
                  return `${parts.join(', ')}${c.discountCents ? ` (−${money(c.discountCents)})` : ''}`;
                },
              },
              { key: 'a', header: 'Importe', render: (c) => <strong>{money(c.amountCents)}</strong>, numeric: true, nowrap: true },
              { key: 'v', header: 'Vence', render: (c) => date(c.dueDate), nowrap: true },
              { key: 'st', header: 'Estado', render: (c) => <StatusChip value={c.status} map={tuitionStatus} /> },
              ...(write
                ? [
                    {
                      key: 'x',
                      header: 'Acciones',
                      render: (c: TuitionCharge) =>
                        c.status === 'PENDING' || c.status === 'OVERDUE' ? (
                          <Menu
                            label={`Acciones de la mensualidad de ${c.student ? fullName(c.student) : ''}`}
                            items={[
                              { label: 'Registrar cobro', onSelect: () => setPaying(c) },
                              { label: 'Condonar', onSelect: () => waive.mutate(c), danger: true },
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
      <ConfirmModal
        open={!!paying}
        title="Registrar cobro"
        message={paying ? `Se registrará un ingreso de ${money(paying.amountCents)} con fecha de hoy en la categoría «Escuela de música».` : ''}
        confirmLabel="Registrar cobro"
        loading={pay.isPending}
        onConfirm={() => paying && pay.mutate(paying)}
        onClose={() => setPaying(null)}
      />
    </div>
  );
}
