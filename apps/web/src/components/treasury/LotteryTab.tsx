import { useState, type FormEvent } from 'react';
import { del, post } from '../../api/client';
import { useApi, useApiMutation } from '../../api/hooks';
import type { LotteryBook, LotteryDraw, LotteryDrawDetail } from '../../api/types-governance';
import { useAuth } from '../../auth/AuthProvider';
import { Button } from '../Button';
import { Card, StatCard } from '../Card';
import { Chip } from '../Chip';
import { DataTable } from '../DataTable';
import { EmptyState, ErrorNote, Loading } from '../EmptyState';
import { FormError, SelectField, TextField, formValues } from '../Field';
import { MemberSelect } from '../MemberSelect';
import { Menu } from '../Menu';
import { Modal } from '../Modal';
import { date, fullName, money, parseMoney, today } from '../../lib/format';

const MONEY = '\\d+([.,]\\d{1,2})?';
const holder = (b: LotteryBook) => (b.member ? fullName(b.member) : b.holderName ?? '—');

function DrawModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const create = useApiMutation((body: unknown) => post<LotteryDraw>('/finance/lottery/draws', body), {
    success: 'Sorteo creado',
    invalidate: ['/finance/lottery'],
    onSuccess: (d) => {
      onCreated(d.id);
      onClose();
    },
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    create.mutate({
      name: v.name,
      drawDate: v.drawDate,
      numbers: (v.numbers ?? '').split(/[\s,;]+/).filter(Boolean),
      ticketPriceCents: parseMoney(v.price ?? '0'),
      stakeCents: parseMoney(v.stake ?? '0'),
    });
  }
  const year = new Date().getFullYear();
  return (
    <Modal open={open} onClose={onClose} title="Nuevo sorteo">
      <form className="form" onSubmit={submit}>
        <div className="form-row">
          <TextField label="Nombre" name="name" required defaultValue={`Lotería de Navidad ${year}`} />
          <TextField label="Fecha del sorteo" name="drawDate" type="date" required defaultValue={`${year}-12-22`} />
        </div>
        <TextField label="Números" name="numbers" required hint="Cinco cifras, separados por comas" placeholder="12345, 67890" />
        <div className="form-row">
          <TextField label="Precio de la participación (€)" name="price" required inputMode="decimal" pattern={MONEY} placeholder="5,00" />
          <TextField label="Cantidad jugada (€)" name="stake" required inputMode="decimal" pattern={MONEY} placeholder="4,00" hint="La diferencia es el donativo para la banda" />
        </div>
        <FormError error={create.error} />
        <div className="modal__footer">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={create.isPending}>
            Crear
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function BookModal({ draw, open, onClose }: { draw: LotteryDrawDetail; open: boolean; onClose: () => void }) {
  const [toMember, setToMember] = useState(true);
  const create = useApiMutation((body: unknown) => post(`/finance/lottery/draws/${draw.id}/books`, body), {
    success: 'Talonario entregado',
    invalidate: ['/finance/lottery'],
    onSuccess: onClose,
  });
  return (
    <Modal open={open} onClose={onClose} title="Entregar talonario">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const v = formValues(e.currentTarget);
          create.mutate({ code: v.code, number: v.number ?? null, tickets: Number(v.tickets), memberId: toMember ? v.memberId : null, holderName: toMember ? null : v.holderName });
        }}
      >
        <div className="form-row">
          <TextField label="Código del talonario" name="code" required defaultValue={`T-${String(draw.books.length + 1).padStart(2, '0')}`} />
          <TextField label="Participaciones" name="tickets" type="number" required min={1} defaultValue={50} />
        </div>
        <SelectField label="Número" name="number" placeholder="—" options={draw.numbers.map((n) => ({ value: n, label: n }))} />
        <div className="segmented" role="group" aria-label="Quién lleva el talonario">
          <button type="button" aria-pressed={toMember} onClick={() => setToMember(true)}>
            Socio
          </button>
          <button type="button" aria-pressed={!toMember} onClick={() => setToMember(false)}>
            Otra persona o comercio
          </button>
        </div>
        {toMember ? <MemberSelect /> : <TextField label="Nombre" name="holderName" required />}
        <FormError error={create.error} />
        <div className="modal__footer">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={create.isPending}>
            Entregar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function SettleModal({ draw, book, onClose }: { draw: LotteryDrawDetail; book: LotteryBook; onClose: () => void }) {
  const [returned, setReturned] = useState(book.returnedTickets);
  const due = Math.max(0, (book.tickets - returned) * draw.ticketPriceCents - book.paidCents);
  const settle = useApiMutation((body: unknown) => post(`/finance/lottery/books/${book.id}/settle`, body), {
    success: 'Liquidación registrada',
    invalidate: ['/finance'],
    onSuccess: onClose,
  });
  return (
    <Modal open onClose={onClose} title={`Liquidar talonario ${book.code}`}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const v = formValues(e.currentTarget);
          settle.mutate({ returnedTickets: returned, paidCents: parseMoney(v.paid ?? '0'), date: v.date });
        }}
      >
        <p className="small">
          {holder(book)} · {book.tickets} participaciones · cobrado hasta ahora {money(book.paidCents)}
        </p>
        <TextField label="Participaciones devueltas" type="number" min={0} max={book.tickets} value={returned} onChange={(e) => setReturned(Number(e.target.value))} />
        <div className="form-row">
          <TextField label="Importe entregado (€)" name="paid" required inputMode="decimal" pattern={MONEY} defaultValue={(due / 100).toFixed(2).replace('.', ',')} hint={`Pendiente: ${money(due)}`} />
          <TextField label="Fecha" name="date" type="date" required defaultValue={today()} />
        </div>
        <p className="small muted">El importe se registra como ingreso en la categoría «Lotería».</p>
        <FormError error={settle.error} />
        <div className="modal__footer">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={settle.isPending}>
            Registrar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DrawDetail({ id }: { id: string }) {
  const { can } = useAuth();
  const write = can('finance:write');
  const q = useApi<LotteryDrawDetail>(`/finance/lottery/draws/${id}`);
  const [adding, setAdding] = useState(false);
  const [settling, setSettling] = useState<LotteryBook | null>(null);
  const remove = useApiMutation((bookId: string) => del(`/finance/lottery/books/${bookId}`), { success: 'Talonario eliminado', invalidate: ['/finance/lottery'] });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorNote error={q.error} />;
  const d = q.data;
  const s = d.summary;
  return (
    <div className="stack" style={{ gap: 24 }}>
      <p className="small muted">
        Sorteo del {date(d.drawDate)} · números {d.numbers.join(', ')} · participación {money(d.ticketPriceCents)} (juega {money(d.stakeCents)}, donativo {money(d.ticketPriceCents - d.stakeCents)})
      </p>
      <div className="grid grid--stats">
        <StatCard label="Participaciones vendidas" value={s.ticketsSold} hint={`${s.ticketsIssued} entregadas · ${s.ticketsReturned} devueltas`} />
        <StatCard label="Cobrado" value={money(s.collectedCents)} meter={s.expectedCents ? s.collectedCents / s.expectedCents : 0} hint={`Previsto ${money(s.expectedCents)}`} />
        <StatCard label="Pendiente de cobro" value={money(s.pendingCents)} tone={s.pendingCents > 0 ? 'warm' : 'paper'} />
        <StatCard label="A pagar a la administración" value={money(s.payToAdministrationCents)} hint={`Recargo (donativo): ${money(s.surchargeCents)}`} tone="cool" />
      </div>
      <Card title="Talonarios" actions={write && <Button size="sm" onClick={() => setAdding(true)}>Entregar talonario</Button>}>
        <DataTable
          caption="Talonarios"
          rows={d.books}
          rowKey={(b) => b.id}
          empty="Entrega talonarios a socios o comercios para empezar la venta."
          columns={[
            { key: 'c', header: 'Talonario', render: (b) => b.code, nowrap: true },
            { key: 'h', header: 'Lo lleva', render: holder },
            { key: 'n', header: 'Número', render: (b) => b.number ?? '—', nowrap: true },
            { key: 't', header: 'Particip.', render: (b) => `${b.tickets - b.returnedTickets}/${b.tickets}`, numeric: true },
            { key: 'p', header: 'Cobrado', render: (b) => money(b.paidCents), numeric: true, nowrap: true },
            {
              key: 's',
              header: 'Estado',
              render: (b) => {
                const due = (b.tickets - b.returnedTickets) * d.ticketPriceCents - b.paidCents;
                return b.settledAt && due <= 0 ? <Chip tone="success">Liquidado</Chip> : <Chip tone="warning">Pendiente {money(Math.max(0, due))}</Chip>;
              },
            },
            ...(write
              ? [
                  {
                    key: 'x',
                    header: 'Acciones',
                    render: (b: LotteryBook) => (
                      <Menu
                        label={`Acciones del talonario ${b.code}`}
                        items={[
                          { label: 'Liquidar', onSelect: () => setSettling(b) },
                          ...(b.paidCents === 0 ? [{ label: 'Eliminar', danger: true, onSelect: () => remove.mutate(b.id) }] : []),
                        ]}
                      />
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Card>
      {s.pendingByHolder.length > 0 && (
        <Card title="Pendiente por persona" tone="cream">
          <ul className="list-plain list-divided">
            {s.pendingByHolder.map((h) => (
              <li key={`${h.memberId ?? h.name}`} className="row between">
                <span>
                  {h.name} <span className="small muted">· {h.books.join(', ')}</span>
                </span>
                <strong>{money(h.pendingCents)}</strong>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {write && <BookModal draw={d} open={adding} onClose={() => setAdding(false)} />}
      {settling && <SettleModal draw={d} book={settling} onClose={() => setSettling(null)} />}
    </div>
  );
}

export function LotteryTab() {
  const { can } = useAuth();
  const q = useApi<LotteryDraw[]>('/finance/lottery/draws');
  const [current, setCurrent] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const selected = current ?? q.data?.[0]?.id ?? null;
  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="row between">
        {q.data && q.data.length > 0 && (
          <SelectField label="Sorteo" value={selected ?? ''} onChange={(e) => setCurrent(e.target.value)} options={q.data.map((d) => ({ value: d.id, label: d.name }))} />
        )}
        {can('finance:write') && <Button onClick={() => setCreating(true)}>Nuevo sorteo</Button>}
      </div>
      {q.isLoading && <Loading />}
      {q.error && <ErrorNote error={q.error} />}
      {q.data?.length === 0 && <EmptyState title="Sin sorteos">Crea el sorteo de Navidad para repartir talonarios y controlar su liquidación.</EmptyState>}
      {selected && <DrawDetail key={selected} id={selected} />}
      <DrawModal open={creating} onClose={() => setCreating(false)} onCreated={setCurrent} />
    </div>
  );
}
