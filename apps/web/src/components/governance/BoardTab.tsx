import { useState } from 'react';
import { del, post } from '../../api/client';
import { useApi, useApiMutation } from '../../api/hooks';
import type { BoardPosition } from '../../api/types-governance';
import { useAuth } from '../../auth/AuthProvider';
import { Person } from '../Avatar';
import { Button } from '../Button';
import { Card } from '../Card';
import { Chip } from '../Chip';
import { DataTable } from '../DataTable';
import { ErrorNote, Loading } from '../EmptyState';
import { FormError, TextAreaField, TextField, formValues } from '../Field';
import { MemberSelect } from '../MemberSelect';
import { Menu } from '../Menu';
import { ConfirmModal, Modal } from '../Modal';
import { date, fullName, today } from '../../lib/format';
import { boardPositions } from '../../lib/labels-governance';

export function BoardTab() {
  const { can } = useAuth();
  const write = can('governance:write');
  const q = useApi<BoardPosition[]>('/governance/board');
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<BoardPosition | null>(null);
  const create = useApiMutation((body: unknown) => post('/governance/board', body), {
    success: 'Cargo añadido',
    invalidate: ['/governance/board'],
    onSuccess: () => setCreating(false),
  });
  const remove = useApiMutation((id: string) => del(`/governance/board/${id}`), {
    success: 'Cargo eliminado',
    invalidate: ['/governance/board'],
    onSuccess: () => setRemoving(null),
  });
  const current = (q.data ?? []).filter((p) => p.current);
  const history = (q.data ?? []).filter((p) => !p.current);
  const expiring = current.filter((p) => p.expiringSoon);

  return (
    <div className="stack" style={{ gap: 24 }}>
      {q.isLoading && <Loading />}
      {q.error && <ErrorNote error={q.error} />}
      {expiring.length > 0 && (
        <div className="card card--warm" role="status">
          <strong>Mandatos que vencen en los próximos 60 días:</strong>{' '}
          {expiring.map((p) => `${p.position} (${fullName(p.member)}, ${date(p.endsOn)})`).join('; ')}
        </div>
      )}
      <Card title="Junta directiva actual" actions={write && <Button size="sm" onClick={() => setCreating(true)}>Añadir cargo</Button>}>
        {q.data && current.length === 0 && <p className="muted">No hay cargos vigentes registrados.</p>}
        <ul className="grid list-plain">
          {current.map((p) => (
            <li key={p.id} className="card card--cream stack">
              <p className="stat__label">{p.position}</p>
              <Person name={fullName(p.member)} detail={`Desde ${date(p.startsOn)}${p.endsOn ? ` hasta ${date(p.endsOn)}` : ''}`} />
              <div className="row">
                {p.expiringSoon && <Chip tone="warning">Vence pronto</Chip>}
                {write && (
                  <Button size="sm" variant="ghost" onClick={() => setRemoving(p)} aria-label={`Eliminar cargo ${p.position} de ${fullName(p.member)}`}>
                    Eliminar
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      {history.length > 0 && (
        <Card title="Histórico de cargos">
          <DataTable
            caption="Histórico de cargos"
            rows={history}
            rowKey={(p) => p.id}
            columns={[
              { key: 'p', header: 'Cargo', render: (p) => p.position },
              { key: 'm', header: 'Socio', render: (p) => fullName(p.member) },
              { key: 's', header: 'Inicio', render: (p) => date(p.startsOn), nowrap: true },
              { key: 'e', header: 'Fin', render: (p) => date(p.endsOn), nowrap: true },
              ...(write
                ? [{ key: 'x', header: 'Acciones', render: (p: BoardPosition) => <Menu label={`Acciones de ${p.position}`} items={[{ label: 'Eliminar', danger: true, onSelect: () => setRemoving(p) }]} /> }]
                : []),
            ]}
          />
        </Card>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="Nuevo cargo de la junta">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            create.mutate({ memberId: v.memberId, position: v.position, startsOn: v.startsOn, endsOn: v.endsOn ?? null, notes: v.notes ?? null });
          }}
        >
          <MemberSelect />
          <TextField label="Cargo" name="position" required list="board-positions" placeholder="Presidente" />
          <datalist id="board-positions">
            {boardPositions.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <div className="form-row">
            <TextField label="Inicio del mandato" name="startsOn" type="date" required defaultValue={today()} />
            <TextField label="Fin del mandato" name="endsOn" type="date" />
          </div>
          <TextAreaField label="Notas" name="notes" rows={2} />
          <FormError error={create.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={create.isPending}>
              Guardar
            </Button>
          </div>
        </form>
      </Modal>
      <ConfirmModal
        open={!!removing}
        title="Eliminar cargo"
        message={`¿Eliminar el cargo de ${removing?.position} de ${fullName(removing?.member)}? Para cerrar un mandato, es preferible indicar su fecha de fin.`}
        confirmLabel="Eliminar"
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}
