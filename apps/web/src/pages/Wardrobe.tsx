import { useState, type FormEvent } from 'react';
import { patch, post } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import type { ItemCondition, Paginated, UniformItem, UniformLoan } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { Person } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card, StatCard } from '../components/Card';
import { StatusChip } from '../components/Chip';
import { DataTable } from '../components/DataTable';
import { ErrorNote, Loading } from '../components/EmptyState';
import { FormError, SelectField, TextAreaField, TextField, formValues } from '../components/Field';
import { MemberSelect } from '../components/MemberSelect';
import { Menu } from '../components/Menu';
import { Modal } from '../components/Modal';
import { Page, PageHeader } from '../components/PageHeader';
import { Tabs } from '../components/Tabs';
import { date, fullName } from '../lib/format';
import { condition, stockStatus } from '../lib/labels';

const conditionOptions = Object.entries(condition).map(([value, label]) => ({ value, label }));
const rows = <T,>(d: T[] | Paginated<T> | undefined) => (Array.isArray(d) ? d : d?.data ?? []);

function ItemModal({ open, onClose, item }: { open: boolean; onClose: () => void; item?: UniformItem | null }) {
  const save = useApiMutation((body: unknown) => (item ? patch(`/wardrobe/items/${item.id}`, body) : post('/wardrobe/items', body)), {
    success: item ? 'Prenda actualizada' : 'Prenda añadida',
    invalidate: ['/wardrobe'],
    onSuccess: onClose,
  });
  return (
    <Modal open={open} onClose={onClose} title={item ? 'Editar prenda' : 'Nueva prenda'}>
      <form
        className="form"
        key={item?.id ?? 'new'}
        onSubmit={(e) => {
          e.preventDefault();
          const v = formValues(e.currentTarget);
          save.mutate({ code: v.code, garment: v.garment, size: v.size, condition: v.condition, notes: v.notes ?? null, ...(item && v.status ? { status: v.status } : {}) });
        }}
      >
        <div className="form-row">
          <TextField label="Código" name="code" required defaultValue={item?.code} placeholder="CH-042" />
          <TextField label="Prenda" name="garment" required defaultValue={item?.garment} placeholder="Chaqueta de gala" />
          <TextField label="Talla" name="size" required defaultValue={item?.size} />
        </div>
        <div className="form-row">
          <SelectField label="Estado de conservación" name="condition" defaultValue={item?.condition ?? 'GOOD'} options={conditionOptions} />
          {item && (
            <SelectField
              label="Situación"
              name="status"
              defaultValue={item.status}
              options={Object.entries(stockStatus)
                .filter(([k]) => k !== 'ASSIGNED')
                .map(([value, { label }]) => ({ value, label }))}
              disabled={item.status === 'ASSIGNED'}
            />
          )}
        </div>
        <TextAreaField label="Notas" name="notes" defaultValue={item?.notes ?? ''} />
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

function InventoryTab() {
  const { can } = useAuth();
  const write = can('wardrobe:write');
  const [status, setStatus] = useState('');
  const [garment, setGarment] = useState('');
  const q = useApi<UniformItem[] | Paginated<UniformItem>>('/wardrobe/items', { status, garment });
  const items = rows(q.data);
  const [editing, setEditing] = useState<UniformItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [delivering, setDelivering] = useState<UniformItem | null>(null);
  const deliver = useApiMutation((body: { id: string; memberId: string; dueAt?: string; conditionOut: string }) => post(`/wardrobe/items/${body.id}/deliver`, body), {
    success: 'Entrega registrada',
    invalidate: ['/wardrobe'],
    onSuccess: () => setDelivering(null),
  });

  function submitDeliver(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    if (delivering) deliver.mutate({ id: delivering.id, memberId: v.memberId!, dueAt: v.dueAt, conditionOut: v.conditionOut ?? delivering.condition });
  }

  const count = (s: string) => items.filter((i) => i.status === s).length;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="grid grid--stats">
        <StatCard label="Disponibles" value={count('AVAILABLE')} tone="cool" />
        <StatCard label="Entregadas" value={count('ASSIGNED')} />
        <StatCard label="En arreglo" value={count('MAINTENANCE')} tone="cream" />
      </div>
      <Card>
        <div className="toolbar">
          <TextField label="Prenda" value={garment} onChange={(e) => setGarment(e.target.value)} placeholder="Chaqueta, gorra…" />
          <SelectField
            label="Situación"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="Todas"
            options={Object.entries(stockStatus).map(([value, { label }]) => ({ value, label }))}
          />
          {write && <Button onClick={() => setCreating(true)}>Nueva prenda</Button>}
        </div>
      </Card>
      {q.isLoading && <Loading />}
      {q.error && <ErrorNote error={q.error} />}
      {q.data && (
        <Card>
          <DataTable
            caption="Inventario de uniformes"
            rows={items}
            rowKey={(i) => i.id}
            columns={[
              { key: 'c', header: 'Código', render: (i) => <span className="mono">{i.code}</span>, nowrap: true },
              { key: 'g', header: 'Prenda', render: (i) => i.garment },
              { key: 's', header: 'Talla', render: (i) => i.size, nowrap: true },
              { key: 'co', header: 'Conservación', render: (i) => condition[i.condition] },
              { key: 'st', header: 'Situación', render: (i) => <StatusChip value={i.status} map={stockStatus} /> },
              ...(write
                ? [
                    {
                      key: 'a',
                      header: 'Acciones',
                      render: (i: UniformItem) => (
                        <Menu
                          label={`Acciones de ${i.garment} ${i.code}`}
                          items={[
                            ...(i.status === 'AVAILABLE' ? [{ label: 'Entregar a un socio', onSelect: () => setDelivering(i) }] : []),
                            { label: 'Editar', onSelect: () => setEditing(i) },
                          ]}
                        />
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </Card>
      )}
      <ItemModal open={creating || !!editing} item={editing} onClose={() => { setCreating(false); setEditing(null); }} />
      <Modal open={!!delivering} onClose={() => setDelivering(null)} title={`Entregar ${delivering?.garment ?? ''} ${delivering?.code ?? ''}`}>
        <form className="form" onSubmit={submitDeliver}>
          <MemberSelect />
          <div className="form-row">
            <SelectField label="Estado al entregar" name="conditionOut" defaultValue={delivering?.condition} options={conditionOptions} />
            <TextField label="Devolver antes de" name="dueAt" type="date" hint="Opcional" />
          </div>
          <FormError error={deliver.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setDelivering(null)}>
              Cancelar
            </Button>
            <Button type="submit" loading={deliver.isPending}>
              Registrar entrega
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function LoansTab() {
  const { can } = useAuth();
  const [open, setOpen] = useState(true);
  const q = useApi<UniformLoan[] | Paginated<UniformLoan>>('/wardrobe/loans', { open: open ? true : undefined });
  const loans = rows(q.data);
  const [returning, setReturning] = useState<UniformLoan | null>(null);
  const ret = useApiMutation((body: { id: string; conditionIn: ItemCondition; notes?: string }) => post(`/wardrobe/loans/${body.id}/return`, body), {
    success: 'Devolución registrada',
    invalidate: ['/wardrobe'],
    onSuccess: () => setReturning(null),
  });
  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="segmented" role="group" aria-label="Filtrar entregas" style={{ alignSelf: 'flex-start' }}>
        <button aria-pressed={open} onClick={() => setOpen(true)}>
          Pendientes de devolver
        </button>
        <button aria-pressed={!open} onClick={() => setOpen(false)}>
          Historial
        </button>
      </div>
      {q.isLoading && <Loading />}
      {q.error && <ErrorNote error={q.error} />}
      {q.data && (
        <Card>
          <DataTable
            caption="Entregas de uniformes"
            rows={loans}
            rowKey={(l) => l.id}
            columns={[
              { key: 'i', header: 'Prenda', render: (l) => (l.item ? `${l.item.garment} ${l.item.code} (${l.item.size})` : '—') },
              { key: 'm', header: 'Socio', render: (l) => (l.member ? <Person name={fullName(l.member)} /> : '—') },
              { key: 'd', header: 'Entregada', render: (l) => date(l.deliveredAt), nowrap: true },
              {
                key: 'due',
                header: 'Devolver antes de',
                nowrap: true,
                render: (l) =>
                  l.dueAt ? (
                    <span className={`chip chip--plain ${!l.returnedAt && new Date(l.dueAt) < new Date() ? 'chip--danger' : ''}`}>{date(l.dueAt)}</span>
                  ) : (
                    '—'
                  ),
              },
              { key: 'r', header: 'Devuelta', render: (l) => (l.returnedAt ? `${date(l.returnedAt)} · ${condition[l.conditionIn ?? 'GOOD']}` : '—'), nowrap: true },
              ...(can('wardrobe:write')
                ? [
                    {
                      key: 'a',
                      header: 'Acciones',
                      render: (l: UniformLoan) =>
                        !l.returnedAt ? (
                          <Button size="sm" variant="ghost" onClick={() => setReturning(l)} aria-label={`Registrar devolución de ${l.item ? `${l.item.garment} ${l.item.code}` : 'la prenda'}`}>
                            Registrar devolución
                          </Button>
                        ) : null,
                    },
                  ]
                : []),
            ]}
          />
        </Card>
      )}
      <Modal open={!!returning} onClose={() => setReturning(null)} title="Registrar devolución">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            if (returning) ret.mutate({ id: returning.id, conditionIn: v.conditionIn as ItemCondition, notes: v.notes });
          }}
        >
          <SelectField label="Estado al devolver" name="conditionIn" defaultValue={returning?.conditionOut} options={conditionOptions} />
          <TextAreaField label="Notas" name="notes" />
          <FormError error={ret.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setReturning(null)}>
              Cancelar
            </Button>
            <Button type="submit" loading={ret.isPending}>
              Guardar
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function SizesTab() {
  const [garment, setGarment] = useState('');
  const q = useApi<{ member: { id: string; firstName: string; lastName: string }; garment: string; size: string }[]>('/wardrobe/sizes', { garment });
  const data = q.data ?? [];
  const totals = data.reduce<Record<string, number>>((acc, r) => {
    const k = `${r.garment} · ${r.size}`;
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  return (
    <div className="stack" style={{ gap: 24 }}>
      <Card>
        <div className="toolbar">
          <TextField label="Prenda" value={garment} onChange={(e) => setGarment(e.target.value)} placeholder="Chaqueta" />
        </div>
      </Card>
      {q.isLoading && <Loading />}
      {q.error && <ErrorNote error={q.error} />}
      {q.data && (
        <div className="grid grid--2">
          <Card title="Resumen para pedidos" tone="cream">
            <ul className="list-plain list-divided">
              {Object.entries(totals)
                .sort()
                .map(([k, n]) => (
                  <li key={k} className="row between">
                    <span>{k}</span>
                    <strong>{n}</strong>
                  </li>
                ))}
            </ul>
          </Card>
          <Card title="Tallas por socio">
            <DataTable
              caption="Tallas por socio"
              rows={data}
              rowKey={(r) => `${r.member.id}-${r.garment}`}
              columns={[
                { key: 'm', header: 'Socio', render: (r) => <Person name={fullName(r.member)} /> },
                { key: 'g', header: 'Prenda', render: (r) => r.garment },
                { key: 's', header: 'Talla', render: (r) => r.size, nowrap: true },
              ]}
            />
          </Card>
        </div>
      )}
    </div>
  );
}

export default function WardrobePage() {
  return (
    <Page header={<PageHeader eyebrow="Mayordomía" title="Uniformes" description="Inventario, tallas, entregas y devoluciones." />}>
      <Tabs
        label="Secciones de mayordomía"
        tabs={[
          { id: 'inv', label: 'Inventario', content: <InventoryTab /> },
          { id: 'loans', label: 'Entregas', content: <LoansTab /> },
          { id: 'sizes', label: 'Tallas', content: <SizesTab /> },
        ]}
      />
    </Page>
  );
}
