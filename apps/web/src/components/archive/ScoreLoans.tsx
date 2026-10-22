import { useState } from 'react';
import { del, post } from '../../api/client';
import { useApi, useApiMutation } from '../../api/hooks';
import type { ScoreLoan } from '../../api/types-archive';
import { useAuth } from '../../auth/AuthProvider';
import { date, today } from '../../lib/format';
import { ArrowLink, Button } from '../Button';
import { Chip } from '../Chip';
import { DataTable } from '../DataTable';
import { ErrorNote, Loading } from '../EmptyState';
import { FormError, SelectField, TextAreaField, TextField, formValues } from '../Field';
import { Menu } from '../Menu';
import { ConfirmModal, Modal } from '../Modal';
import { WorkPicker } from './WorkPicker';

export const loanDirection: Record<string, string> = { LENT: 'Prestada a', BORROWED: 'Pedida a' };

const STATUS_OPTIONS = [
  { value: 'all', label: 'Todos' },
  { value: 'open', label: 'Pendientes de devolver' },
  { value: 'overdue', label: 'Con retraso' },
  { value: 'returned', label: 'Devueltos' },
];

export function LoanFormModal({ open, onClose, workId }: { open: boolean; onClose: () => void; workId?: string }) {
  const [work, setWork] = useState('');
  const create = useApiMutation((body: unknown) => post<ScoreLoan>('/score-loans', body), {
    success: 'Préstamo registrado',
    invalidate: ['/score-loans', '/works/'],
    onSuccess: onClose,
  });
  return (
    <Modal open={open} onClose={onClose} title="Nuevo préstamo de partituras">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const v = formValues(e.currentTarget);
          create.mutate({
            workId: workId ?? work,
            direction: v.direction,
            counterparty: v.counterparty,
            contact: v.contact ?? null,
            loanedAt: v.loanedAt,
            dueAt: v.dueAt ?? null,
            notes: v.notes ?? null,
          });
        }}
      >
        {!workId && <WorkPicker value={work} onChange={(id) => setWork(id)} required />}
        <div className="form-row">
          <SelectField label="Tipo" name="direction" required options={[{ value: 'LENT', label: 'La prestamos a otra banda' }, { value: 'BORROWED', label: 'Nos la presta otra banda' }]} />
          <TextField label="Banda" name="counterparty" required maxLength={160} placeholder="Unión Musical de…" />
        </div>
        <TextField label="Contacto" name="contact" maxLength={200} hint="Persona, teléfono o correo del archivero." />
        <div className="form-row">
          <TextField label="Fecha de préstamo" name="loanedAt" type="date" required defaultValue={today()} />
          <TextField label="Devolución prevista" name="dueAt" type="date" />
        </div>
        <TextAreaField label="Notas" name="notes" hint="Particellas incluidas, estado del material…" />
        <FormError error={create.error} />
        <div className="modal__footer">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={create.isPending} disabled={!workId && !work}>
            Guardar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Préstamos de partituras con otras bandas. Con `workId` muestra sólo los de esa obra. */
export function ScoreLoansPanel({ workId }: { workId?: string }) {
  const { can } = useAuth();
  const write = can('archive:write');
  const [status, setStatus] = useState('open');
  const loans = useApi<ScoreLoan[]>(workId ? `/works/${workId}/loans` : '/score-loans', workId ? undefined : { status });
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ScoreLoan | null>(null);

  const ret = useApiMutation((id: string) => post(`/score-loans/${id}/return`, {}), { success: 'Marcado como devuelto', invalidate: ['/score-loans', '/works/'] });
  const remove = useApiMutation((id: string) => del(`/score-loans/${id}`), {
    success: 'Préstamo eliminado',
    invalidate: ['/score-loans', '/works/'],
    onSuccess: () => setDeleting(null),
  });

  return (
    <div className="stack">
      <div className="toolbar">
        {!workId && <SelectField label="Estado" value={status} onChange={(e) => setStatus(e.target.value)} options={STATUS_OPTIONS} />}
        {write && (
          <Button size={workId ? 'sm' : 'md'} variant={workId ? 'ghost' : 'primary'} onClick={() => setCreating(true)}>
            Nuevo préstamo
          </Button>
        )}
      </div>
      {loans.isLoading && <Loading rows={2} />}
      {loans.error && <ErrorNote error={loans.error} />}
      {loans.data && (
        <DataTable
          caption="Préstamos de partituras"
          rows={loans.data}
          rowKey={(l) => l.id}
          empty={workId ? 'Esta obra no se ha prestado ni pedido prestada.' : 'No hay préstamos con este filtro.'}
          columns={[
            ...(workId ? [] : [{ key: 'w', header: 'Obra', render: (l: ScoreLoan) => (l.work ? <ArrowLink to={`/archive/${l.work.id}`}>{l.work.title}</ArrowLink> : '—') }]),
            { key: 'd', header: 'Tipo', render: (l) => loanDirection[l.direction] },
            {
              key: 'c',
              header: 'Banda',
              render: (l) => (
                <>
                  {l.counterparty}
                  {l.contact && <span className="small muted"> · {l.contact}</span>}
                </>
              ),
            },
            { key: 'f', header: 'Desde', render: (l) => date(l.loanedAt), nowrap: true },
            { key: 'p', header: 'Devolución prevista', render: (l) => (l.dueAt ? date(l.dueAt) : '—'), nowrap: true },
            {
              key: 's',
              header: 'Estado',
              render: (l) =>
                l.returnedAt ? (
                  <Chip tone="success">Devuelta el {date(l.returnedAt)}</Chip>
                ) : l.overdue ? (
                  <Chip tone="danger">Con retraso</Chip>
                ) : (
                  <Chip tone="warning">Pendiente</Chip>
                ),
            },
            ...(write
              ? [
                  {
                    key: 'a',
                    header: 'Acciones',
                    render: (l: ScoreLoan) => (
                      <Menu
                        label={`Acciones del préstamo con ${l.counterparty}`}
                        items={[
                          ...(l.returnedAt ? [] : [{ label: 'Marcar devuelta', onSelect: () => ret.mutate(l.id) }]),
                          { label: 'Eliminar', onSelect: () => setDeleting(l), danger: true },
                        ]}
                      />
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}
      <LoanFormModal open={creating} onClose={() => setCreating(false)} workId={workId} />
      <ConfirmModal
        open={!!deleting}
        title="Eliminar préstamo"
        message={`¿Eliminar el préstamo con «${deleting?.counterparty}»?`}
        confirmLabel="Eliminar"
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
