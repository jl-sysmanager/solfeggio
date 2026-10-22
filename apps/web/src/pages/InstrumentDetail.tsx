import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { post } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import type { Instrument } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { ArrowLink, Button } from '../components/Button';
import { Card } from '../components/Card';
import { Chip, StatusChip } from '../components/Chip';
import { DataTable } from '../components/DataTable';
import { ErrorNote, Loading } from '../components/EmptyState';
import { FormError, SelectField, TextAreaField, TextField, formValues } from '../components/Field';
import { MemberSelect } from '../components/MemberSelect';
import { Modal } from '../components/Modal';
import { Page, PageHeader } from '../components/PageHeader';
import { date, fullName, money, parseMoney } from '../lib/format';
import { condition, stockStatus } from '../lib/labels';
import { InstrumentModal } from './Instruments';
import { Person } from '../components/Avatar';

export default function InstrumentDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const write = can('instruments:write');
  const q = useApi<Instrument>(`/instruments/${id}`);
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [maint, setMaint] = useState(false);
  const [completing, setCompleting] = useState<string | null>(null);
  const inv = [`/instruments`];

  const assign = useApiMutation((body: unknown) => post(`/instruments/${id}/assign`, body), { success: 'Instrumento asignado', invalidate: inv, onSuccess: () => setAssigning(false) });
  const end = useApiMutation((aid: string) => post(`/instrument-assignments/${aid}/end`), { success: 'Préstamo finalizado', invalidate: inv });
  const open = useApiMutation((body: unknown) => post(`/instruments/${id}/maintenance`, body), { success: 'Mantenimiento registrado', invalidate: inv, onSuccess: () => setMaint(false) });
  const complete = useApiMutation((body: { id: string; costCents?: number }) => post(`/maintenance/${body.id}/complete`, { costCents: body.costCents }), {
    success: 'Mantenimiento completado',
    invalidate: inv,
    onSuccess: () => setCompleting(null),
  });

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <div className="container page__body"><ErrorNote error={q.error} /></div>;
  const i = q.data;
  const current = i.assignments?.find((a) => !a.endAt);

  return (
    <Page
      header={
        <PageHeader
          eyebrow={i.inventoryCode}
          title={i.type}
          description={[i.brand, i.model].filter(Boolean).join(' ') || undefined}
          actions={
            write && (
              <>
                {i.status === 'AVAILABLE' && <Button onClick={() => setAssigning(true)}>Asignar a músico</Button>}
                <Button variant="ghost" onClick={() => setMaint(true)}>
                  Enviar a taller
                </Button>
                <Button variant="ghost" onClick={() => setEditing(true)}>
                  Editar
                </Button>
              </>
            )
          }
        />
      }
    >
      <ArrowLink to="/instruments">Volver al inventario</ArrowLink>
      <div className="grid grid--2">
        <Card title="Ficha">
          <dl className="kv">
            <dt>Situación</dt>
            <dd>
              <StatusChip value={i.status} map={stockStatus} />
            </dd>
            <dt>Estado</dt>
            <dd>{condition[i.condition]}</dd>
            <dt>Nº de serie</dt>
            <dd>{i.serialNumber ?? '—'}</dd>
            <dt>Compra</dt>
            <dd>
              {date(i.purchaseDate)} · {money(i.purchasePriceCents)}
            </dd>
            <dt>Notas</dt>
            <dd>{i.notes ?? '—'}</dd>
          </dl>
        </Card>
        <Card title="Préstamo actual" tone="cream">
          {current ? (
            <div className="stack">
              <p>
                <strong>{fullName(current.member)}</strong> desde {date(current.startAt)}
              </p>
              {current.notes && <p className="small">{current.notes}</p>}
              {write && (
                <div>
                  <Button variant="ghost" onClick={() => end.mutate(current.id)} loading={end.isPending}>
                    Registrar devolución
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <p className="muted">No está prestado.</p>
          )}
        </Card>
      </div>

      <Card title="Mantenimiento y reparaciones">
        <DataTable
          caption="Historial de mantenimiento"
          rows={i.maintenance ?? []}
          rowKey={(m) => m.id}
          empty="Sin registros de mantenimiento."
          columns={[
            { key: 'd', header: 'Inicio', render: (m) => date(m.startedAt), nowrap: true },
            { key: 't', header: 'Tipo', render: (m) => <Chip tone={m.type === 'REPAIR' ? 'warning' : 'info'}>{m.type === 'REPAIR' ? 'Reparación' : 'Mantenimiento'}</Chip> },
            { key: 'desc', header: 'Descripción', render: (m) => m.description },
            { key: 'p', header: 'Taller', render: (m) => m.provider ?? '—' },
            { key: 'c', header: 'Coste', render: (m) => money(m.costCents), numeric: true, nowrap: true },
            {
              key: 's',
              header: 'Estado',
              render: (m) =>
                m.status === 'DONE' ? (
                  <Chip tone="success">Terminado {date(m.completedAt)}</Chip>
                ) : write ? (
                  <Button size="sm" onClick={() => setCompleting(m.id)}>
                    Marcar terminado
                  </Button>
                ) : (
                  <Chip tone="warning">En curso</Chip>
                ),
            },
          ]}
        />
      </Card>

      <Card title="Historial de préstamos" tone="cream">
        <DataTable
          caption="Historial de préstamos"
          rows={i.assignments ?? []}
          rowKey={(a) => a.id}
          empty="Nunca se ha prestado."
          columns={[
            { key: 'm', header: 'Músico', render: (a) => <Person name={fullName(a.member)} /> },
            { key: 's', header: 'Desde', render: (a) => date(a.startAt), nowrap: true },
            { key: 'e', header: 'Hasta', render: (a) => (a.endAt ? date(a.endAt) : 'Actual'), nowrap: true },
          ]}
        />
      </Card>

      <InstrumentModal open={editing} instrument={i} onClose={() => setEditing(false)} />
      <Modal open={assigning} onClose={() => setAssigning(false)} title="Asignar instrumento">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            assign.mutate({ memberId: v.memberId, notes: v.notes });
          }}
        >
          <MemberSelect />
          <TextAreaField label="Notas" name="notes" placeholder="Accesorios entregados, estado…" />
          <FormError error={assign.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setAssigning(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={assign.isPending}>
              Asignar
            </Button>
          </div>
        </form>
      </Modal>
      <Modal open={maint} onClose={() => setMaint(false)} title="Mantenimiento o reparación">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            open.mutate({ type: v.type, description: v.description, provider: v.provider, costCents: v.cost ? parseMoney(v.cost) : undefined });
          }}
        >
          <SelectField
            label="Tipo"
            name="type"
            options={[
              { value: 'MAINTENANCE', label: 'Mantenimiento' },
              { value: 'REPAIR', label: 'Reparación' },
            ]}
          />
          <TextAreaField label="Descripción" name="description" required />
          <div className="form-row">
            <TextField label="Taller" name="provider" />
            <TextField label="Presupuesto (€)" name="cost" inputMode="decimal" pattern="\d+([.,]\d{1,2})?" />
          </div>
          <FormError error={open.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setMaint(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={open.isPending}>
              Registrar
            </Button>
          </div>
        </form>
      </Modal>
      <Modal open={!!completing} onClose={() => setCompleting(null)} title="Completar mantenimiento">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            if (completing) complete.mutate({ id: completing, costCents: v.cost ? parseMoney(v.cost) : undefined });
          }}
        >
          <TextField label="Coste final (€)" name="cost" inputMode="decimal" pattern="\d+([.,]\d{1,2})?" />
          <FormError error={complete.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setCompleting(null)}>
              Cancelar
            </Button>
            <Button type="submit" loading={complete.isPending}>
              Completar
            </Button>
          </div>
        </form>
      </Modal>
    </Page>
  );
}
