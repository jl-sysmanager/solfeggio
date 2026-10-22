import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { patch, post } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import type { Instrument, Paginated } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { Person } from '../components/Avatar';
import { ArrowLink, Button } from '../components/Button';
import { Card } from '../components/Card';
import { StatusChip } from '../components/Chip';
import { DataTable } from '../components/DataTable';
import { ErrorNote, Loading } from '../components/EmptyState';
import { FormError, SelectField, TextAreaField, TextField, formValues } from '../components/Field';
import { Modal } from '../components/Modal';
import { Page, PageHeader } from '../components/PageHeader';
import { fullName, money, parseMoney } from '../lib/format';
import { condition, stockStatus } from '../lib/labels';

export function InstrumentModal({ open, onClose, instrument }: { open: boolean; onClose: () => void; instrument?: Instrument | null }) {
  const navigate = useNavigate();
  const save = useApiMutation(
    (body: unknown) => (instrument ? patch<Instrument>(`/instruments/${instrument.id}`, body) : post<Instrument>('/instruments', body)),
    {
      success: instrument ? 'Instrumento actualizado' : 'Instrumento añadido',
      invalidate: ['/instruments'],
      onSuccess: (i) => {
        onClose();
        if (!instrument) navigate(`/instruments/${i.id}`);
      },
    },
  );
  return (
    <Modal open={open} onClose={onClose} title={instrument ? 'Editar instrumento' : 'Nuevo instrumento'}>
      <form
        className="form"
        key={instrument?.id ?? 'new'}
        onSubmit={(e) => {
          e.preventDefault();
          const v = formValues(e.currentTarget);
          save.mutate({
            inventoryCode: v.inventoryCode,
            type: v.type,
            brand: v.brand ?? null,
            model: v.model ?? null,
            serialNumber: v.serialNumber ?? null,
            purchaseDate: v.purchaseDate ?? null,
            purchasePriceCents: v.price ? parseMoney(v.price) : null,
            condition: v.condition,
            notes: v.notes ?? null,
          });
        }}
      >
        <div className="form-row">
          <TextField label="Código de inventario" name="inventoryCode" required defaultValue={instrument?.inventoryCode} placeholder="TUB-003" />
          <TextField label="Tipo" name="type" required defaultValue={instrument?.type} placeholder="Tuba en Si♭" />
        </div>
        <div className="form-row">
          <TextField label="Marca" name="brand" defaultValue={instrument?.brand ?? ''} />
          <TextField label="Modelo" name="model" defaultValue={instrument?.model ?? ''} />
          <TextField label="Nº de serie" name="serialNumber" defaultValue={instrument?.serialNumber ?? ''} />
        </div>
        <div className="form-row">
          <TextField label="Fecha de compra" name="purchaseDate" type="date" defaultValue={instrument?.purchaseDate?.slice(0, 10) ?? ''} />
          <TextField
            label="Precio de compra (€)"
            name="price"
            inputMode="decimal"
            pattern="\d+([.,]\d{1,2})?"
            defaultValue={instrument?.purchasePriceCents ? String(instrument.purchasePriceCents / 100).replace('.', ',') : ''}
          />
          <SelectField label="Estado" name="condition" defaultValue={instrument?.condition ?? 'GOOD'} options={Object.entries(condition).map(([value, label]) => ({ value, label }))} />
        </div>
        <TextAreaField label="Notas" name="notes" defaultValue={instrument?.notes ?? ''} />
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

export default function InstrumentsPage() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const list = useApi<Instrument[] | Paginated<Instrument>>('/instruments', { q, status });
  const rows = Array.isArray(list.data) ? list.data : list.data?.data ?? [];
  const totalValue = rows.reduce((s, i) => s + (i.purchasePriceCents ?? 0), 0);

  return (
    <Page
      header={
        <PageHeader
          eyebrow="Instrumentación"
          title="Inventario de instrumentos"
          description="Instrumentos de la banda, préstamos a músicos, mantenimiento y reparaciones."
          actions={can('instruments:write') && <Button onClick={() => setCreating(true)}>Nuevo instrumento</Button>}
        />
      }
    >
      <Card>
        <div className="toolbar">
          <TextField label="Buscar" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código, tipo, marca, nº de serie…" />
          <SelectField
            label="Situación"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="Todas"
            options={Object.entries(stockStatus).map(([value, { label }]) => ({ value, label }))}
          />
        </div>
      </Card>
      {list.isLoading && <Loading />}
      {list.error && <ErrorNote error={list.error} />}
      {list.data && (
        <Card title={`${rows.length} instrumentos`} actions={<span className="small muted">Valor de compra: {money(totalValue)}</span>}>
          <DataTable
            caption="Inventario de instrumentos"
            rows={rows}
            rowKey={(i) => i.id}
            columns={[
              { key: 'c', header: 'Código', render: (i) => <ArrowLink to={`/instruments/${i.id}`}>{i.inventoryCode}</ArrowLink>, nowrap: true },
              { key: 't', header: 'Tipo', render: (i) => i.type },
              { key: 'b', header: 'Marca / modelo', render: (i) => [i.brand, i.model].filter(Boolean).join(' ') || '—' },
              { key: 'sn', header: 'Nº serie', render: (i) => i.serialNumber ?? '—', nowrap: true },
              { key: 'co', header: 'Estado', render: (i) => condition[i.condition] },
              { key: 's', header: 'Situación', render: (i) => <StatusChip value={i.status} map={stockStatus} /> },
              {
                key: 'm',
                header: 'Asignado a',
                render: (i) => {
                  const current = i.assignments?.find((a) => !a.endAt)?.member;
                  return current ? <Person name={fullName(current)} /> : '—';
                },
              },
            ]}
          />
        </Card>
      )}
      <InstrumentModal open={creating} onClose={() => setCreating(false)} />
    </Page>
  );
}
