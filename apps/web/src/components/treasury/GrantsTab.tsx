import { useState, type FormEvent } from 'react';
import { del, downloadFile, patch, post } from '../../api/client';
import { useApi, useApiMutation } from '../../api/hooks';
import type { Paginated, Transaction } from '../../api/types';
import type { Grant, GrantJustification, GrantRow } from '../../api/types-governance';
import { useAuth } from '../../auth/AuthProvider';
import { Button } from '../Button';
import { Card, StatCard } from '../Card';
import { Chip, StatusChip } from '../Chip';
import { DataTable } from '../DataTable';
import { ErrorNote, Loading } from '../EmptyState';
import { FormError, SelectField, TextAreaField, TextField, formValues } from '../Field';
import { Menu } from '../Menu';
import { ConfirmModal, Modal } from '../Modal';
import { useToast } from '../Toasts';
import { date, money, parseMoney } from '../../lib/format';
import { grantStatus } from '../../lib/labels-governance';

const centsOrNull = (v?: string) => (v ? parseMoney(v) : null);
const euros = (c: number | null | undefined) => (c === null || c === undefined ? '' : (c / 100).toFixed(2).replace('.', ','));

function GrantModal({ grant, open, onClose }: { grant?: Grant; open: boolean; onClose: () => void }) {
  const save = useApiMutation((body: unknown) => (grant ? patch(`/finance/grants/${grant.id}`, body) : post('/finance/grants', body)), {
    success: grant ? 'Subvención actualizada' : 'Subvención registrada',
    invalidate: ['/finance/grants'],
    onSuccess: onClose,
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    save.mutate({
      name: v.name, grantor: v.grantor, reference: v.reference ?? null, year: Number(v.year), status: v.status,
      requestedCents: centsOrNull(v.requested), awardedCents: centsOrNull(v.awarded),
      awardedAt: v.awardedAt ?? null, justificationDue: v.justificationDue ?? null, notes: v.notes ?? null,
    });
  }
  return (
    <Modal open={open} onClose={onClose} title={grant ? 'Editar subvención' : 'Nueva subvención'}>
      <form className="form" onSubmit={submit}>
        <TextField label="Nombre" name="name" required defaultValue={grant?.name} placeholder="Ayudas a sociedades musicales 2026" />
        <div className="form-row">
          <TextField label="Organismo" name="grantor" required defaultValue={grant?.grantor} placeholder="Diputación" />
          <TextField label="Referencia" name="reference" defaultValue={grant?.reference ?? ''} />
        </div>
        <div className="form-row">
          <TextField label="Año" name="year" type="number" required min={2000} max={2100} defaultValue={grant?.year ?? new Date().getFullYear()} />
          <SelectField label="Estado" name="status" defaultValue={grant?.status ?? 'REQUESTED'} options={Object.entries(grantStatus).map(([value, s]) => ({ value, label: s.label }))} />
        </div>
        <div className="form-row">
          <TextField label="Solicitado (€)" name="requested" inputMode="decimal" pattern="\d+([.,]\d{1,2})?" defaultValue={euros(grant?.requestedCents)} />
          <TextField label="Concedido (€)" name="awarded" inputMode="decimal" pattern="\d+([.,]\d{1,2})?" defaultValue={euros(grant?.awardedCents)} />
        </div>
        <div className="form-row">
          <TextField label="Fecha de concesión" name="awardedAt" type="date" defaultValue={grant?.awardedAt?.slice(0, 10) ?? ''} />
          <TextField label="Plazo de justificación" name="justificationDue" type="date" defaultValue={grant?.justificationDue?.slice(0, 10) ?? ''} />
        </div>
        <TextAreaField label="Notas" name="notes" rows={2} defaultValue={grant?.notes ?? ''} />
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

function JustificationModal({ grant, onClose }: { grant: GrantRow; onClose: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const write = can('finance:write');
  const j = useApi<GrantJustification>(`/finance/grants/${grant.id}/justification`);
  const candidates = useApi<Paginated<Transaction & { grantId?: string | null }>>(write ? '/finance/transactions' : null, { kind: 'EXPENSE', from: `${grant.year}-01-01`, to: `${grant.year + 1}-12-31`, pageSize: 200 });
  const [selected, setSelected] = useState<string[]>([]);
  const link = useApiMutation((body: { transactionIds: string[]; linked: boolean }) => post(`/finance/grants/${grant.id}/transactions`, body), {
    success: 'Imputación actualizada',
    invalidate: ['/finance/grants', '/finance/transactions'],
    onSuccess: () => setSelected([]),
  });
  const free = (candidates.data?.data ?? []).filter((t) => !t.grantId);
  return (
    <Modal open onClose={onClose} title={`Justificación: ${grant.name}`}>
      <div className="stack">
        {j.isLoading && <Loading rows={3} />}
        {j.error && <ErrorNote error={j.error} />}
        {j.data && (
          <>
            <div className="grid grid--stats">
              <StatCard label="Concedido" value={money(j.data.awardedCents)} />
              <StatCard label="Gastos imputados" value={money(j.data.expensesCents)} meter={j.data.awardedCents ? j.data.expensesCents / j.data.awardedCents : 0} />
              <StatCard label="Pendiente de justificar" value={money(j.data.pendingCents)} tone={j.data.pendingCents > 0 ? 'warm' : 'cool'} />
            </div>
            {j.data.incomesCents > 0 && <p className="small muted">Ingresos imputados (cobros de la subvención): {money(j.data.incomesCents)}</p>}
            <DataTable
              caption="Gastos imputados"
              rows={j.data.expenses}
              rowKey={(t) => t.id}
              empty="Aún no hay gastos imputados."
              columns={[
                { key: 'd', header: 'Fecha', render: (t) => date(t.date), nowrap: true },
                { key: 'c', header: 'Concepto', render: (t) => t.description },
                { key: 'a', header: 'Importe', render: (t) => money(t.amountCents), numeric: true, nowrap: true },
                ...(write
                  ? [
                      {
                        key: 'x',
                        header: 'Acciones',
                        render: (t: Transaction) => (
                          <Button size="sm" variant="ghost" onClick={() => link.mutate({ transactionIds: [t.id], linked: false })} aria-label={`Desimputar ${t.description}`}>
                            Quitar
                          </Button>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </>
        )}
        {write && free.length > 0 && (
          <fieldset className="stack" style={{ border: 0, padding: 0 }}>
            <legend className="card__title">Imputar gastos de {grant.year}</legend>
            <ul className="list-plain list-divided" style={{ maxHeight: 220, overflow: 'auto' }}>
              {free.map((t) => (
                <li key={t.id}>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={selected.includes(t.id)}
                      onChange={(e) => setSelected((s) => (e.target.checked ? [...s, t.id] : s.filter((x) => x !== t.id)))}
                    />
                    <span>
                      {date(t.date)} · {t.description} · {money(t.amountCents)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="row">
              <Button size="sm" disabled={selected.length === 0} loading={link.isPending} onClick={() => link.mutate({ transactionIds: selected, linked: true })}>
                Imputar {selected.length || ''} gastos
              </Button>
            </div>
          </fieldset>
        )}
        <FormError error={link.error} />
        <div className="modal__footer">
          <Button variant="ghost" onClick={() => downloadFile(`/finance/grants/${grant.id}/justification.csv`, `justificacion-${grant.year}.csv`).catch(toast.error)}>
            Exportar CSV
          </Button>
          <Button onClick={onClose}>Cerrar</Button>
        </div>
      </div>
    </Modal>
  );
}

export function GrantsTab() {
  const { can } = useAuth();
  const write = can('finance:write');
  const q = useApi<GrantRow[]>('/finance/grants');
  const [editing, setEditing] = useState<Grant | 'new' | null>(null);
  const [viewing, setViewing] = useState<GrantRow | null>(null);
  const [removing, setRemoving] = useState<GrantRow | null>(null);
  const remove = useApiMutation((id: string) => del(`/finance/grants/${id}`), { success: 'Subvención eliminada', invalidate: ['/finance'], onSuccess: () => setRemoving(null) });
  const alerts = (q.data ?? []).filter((g) => g.dueSoon || g.overdue);
  return (
    <div className="stack" style={{ gap: 24 }}>
      {alerts.length > 0 && (
        <div className="card card--warm" role="status">
          <strong>Justificaciones próximas:</strong> {alerts.map((g) => `${g.name} (${g.overdue ? 'plazo vencido' : 'vence'} ${date(g.justificationDue)})`).join('; ')}
        </div>
      )}
      <Card title="Subvenciones" actions={write && <Button size="sm" onClick={() => setEditing('new')}>Nueva subvención</Button>}>
        {q.isLoading && <Loading />}
        {q.error && <ErrorNote error={q.error} />}
        {q.data && (
          <DataTable
            caption="Subvenciones"
            rows={q.data}
            rowKey={(g) => g.id}
            empty="Registra las subvenciones solicitadas para controlar su concesión y justificación."
            columns={[
              { key: 'y', header: 'Año', render: (g) => g.year, nowrap: true },
              { key: 'n', header: 'Subvención', render: (g) => <span>{g.name} <span className="small muted">· {g.grantor}</span></span> },
              { key: 's', header: 'Estado', render: (g) => <StatusChip value={g.status} map={grantStatus} /> },
              { key: 'a', header: 'Concedido', render: (g) => money(g.awardedCents), numeric: true, nowrap: true },
              { key: 'e', header: 'Justificado', render: (g) => money(g.expensesCents), numeric: true, nowrap: true },
              {
                key: 'd',
                header: 'Plazo',
                nowrap: true,
                render: (g) => (
                  <span className="row" style={{ gap: 6 }}>
                    {date(g.justificationDue)}
                    {g.dueSoon && <Chip tone="warning">Pronto</Chip>}
                    {g.overdue && <Chip tone="danger">Vencido</Chip>}
                  </span>
                ),
              },
              {
                key: 'x',
                header: 'Acciones',
                render: (g) => (
                  <Menu
                    label={`Acciones de ${g.name}`}
                    items={[
                      { label: 'Justificación', onSelect: () => setViewing(g) },
                      ...(write ? [{ label: 'Editar', onSelect: () => setEditing(g) }, { label: 'Eliminar', danger: true, onSelect: () => setRemoving(g) }] : []),
                    ]}
                  />
                ),
              },
            ]}
          />
        )}
      </Card>
      {editing && <GrantModal open grant={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {viewing && <JustificationModal grant={viewing} onClose={() => setViewing(null)} />}
      <ConfirmModal
        open={!!removing}
        title="Eliminar subvención"
        message={`¿Eliminar «${removing?.name}»? Los movimientos imputados se conservan sin imputación.`}
        confirmLabel="Eliminar"
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}
