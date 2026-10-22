import { useState, type FormEvent } from 'react';
import { del, downloadFile, get, patch, post } from '../../api/client';
import { useApi, useApiMutation } from '../../api/hooks';
import type { DonationCertificate, Donor, DonorDetail } from '../../api/types-governance';
import { useAuth } from '../../auth/AuthProvider';
import { Button } from '../Button';
import { Card } from '../Card';
import { Chip } from '../Chip';
import { DataTable } from '../DataTable';
import { ErrorNote, Loading } from '../EmptyState';
import { Checkbox, FormError, SelectField, TextField, formValues } from '../Field';
import { escapeHtml, printDocument } from '../governance/print';
import { Menu } from '../Menu';
import { ConfirmModal, Modal } from '../Modal';
import { useToast } from '../Toasts';
import { date, money, parseMoney, today } from '../../lib/format';
import { donationKind, donorKind } from '../../lib/labels-governance';

const MONEY = '\\d+([.,]\\d{1,2})?';
const nif = (d: Pick<Donor, 'taxId' | 'taxIdHint'>) => d.taxId ?? (d.taxIdHint ? `•••${d.taxIdHint}` : '—');
const checked = (form: HTMLFormElement, name: string) => (form.elements.namedItem(name) as HTMLInputElement | null)?.checked ?? false;

export function certificateHtml(c: DonationCertificate) {
  const entity = escapeHtml(c.entity.legalName || c.entity.name);
  const rows = c.donations
    .map((d) => `<tr><td>${escapeHtml(date(d.date))}</td><td>${escapeHtml(d.description ?? (d.inKind ? 'Donación en especie' : 'Donativo dinerario'))}</td><td class="num">${escapeHtml(money(d.amountCents))}</td></tr>`)
    .join('');
  return `<h1>Certificado de donativos ${c.year}</h1>
<p>${entity}${c.entity.taxId ? `, con NIF ${escapeHtml(c.entity.taxId)},` : ''} entidad acogida al régimen fiscal de la Ley 49/2002, de 23 de diciembre,</p>
<h2>CERTIFICA</h2>
<p>Que ${escapeHtml(c.donor.name)}${c.donor.taxId ? `, con NIF ${escapeHtml(c.donor.taxId)}` : ''}${c.donor.address ? `, con domicilio en ${escapeHtml(c.donor.address)}` : ''}, ha realizado durante el año ${c.year} los siguientes donativos, con carácter irrevocable, por un importe total de <strong>${escapeHtml(money(c.totalCents))}</strong>, destinados a los fines propios de la entidad:</p>
<table><thead><tr><th>Fecha</th><th>Concepto</th><th class="num">Importe</th></tr></thead><tbody>${rows}</tbody></table>
<p>Y para que conste a los efectos de las deducciones previstas en la citada ley, se expide el presente certificado el ${escapeHtml(date(c.issuedAt, { dateStyle: 'long' }))}.</p>
<p class="signature">Firma y sello</p>`;
}

function DonorModal({ donor, onClose }: { donor?: Donor; onClose: () => void }) {
  const { can } = useAuth();
  const sensitive = can('members:sensitive');
  const save = useApiMutation((body: unknown) => (donor ? patch(`/finance/donors/${donor.id}`, body) : post('/finance/donors', body)), {
    success: donor ? 'Donante actualizado' : 'Donante creado',
    invalidate: ['/finance/donors'],
    onSuccess: onClose,
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    save.mutate({
      kind: v.kind, name: v.name, address: v.address ?? null, postalCode: v.postalCode ?? null, province: v.province ?? null,
      email: v.email ?? null, sponsor: checked(e.currentTarget, 'sponsor'),
      ...(sensitive && { taxId: v.taxId ?? null }),
    });
  }
  return (
    <Modal open onClose={onClose} title={donor ? 'Editar donante' : 'Nuevo donante o patrocinador'}>
      <form className="form" onSubmit={submit}>
        <div className="form-row">
          <SelectField label="Tipo" name="kind" defaultValue={donor?.kind ?? 'PERSON'} options={Object.entries(donorKind).map(([value, label]) => ({ value, label }))} />
          <TextField label="Nombre o razón social" name="name" required defaultValue={donor?.name} />
        </div>
        {sensitive ? (
          <TextField label="NIF" name="taxId" defaultValue={donor?.taxId ?? ''} hint="Se guarda cifrado" />
        ) : (
          <p className="small muted">NIF: {donor ? nif(donor) : '—'} (sólo editable con acceso a datos sensibles)</p>
        )}
        <TextField label="Dirección" name="address" defaultValue={donor?.address ?? ''} />
        <div className="form-row">
          <TextField label="Código postal" name="postalCode" inputMode="numeric" pattern="\d{5}" defaultValue={donor?.postalCode ?? ''} />
          <TextField label="Provincia (código)" name="province" inputMode="numeric" pattern="\d{2}" defaultValue={donor?.province ?? ''} hint="Dos cifras; si se deja vacío se toma del código postal" />
        </div>
        <TextField label="Email" name="email" type="email" defaultValue={donor?.email ?? ''} />
        <Checkbox label="Patrocinador" name="sponsor" defaultChecked={donor?.sponsor} />
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

function DonationsModal({ donorId, onClose }: { donorId: string; onClose: () => void }) {
  const { can } = useAuth();
  const write = can('finance:write');
  const q = useApi<DonorDetail>(`/finance/donors/${donorId}`);
  const [inKind, setInKind] = useState(false);
  const add = useApiMutation((body: unknown) => post(`/finance/donors/${donorId}/donations`, body), { success: 'Aportación registrada', invalidate: ['/finance'] });
  const remove = useApiMutation((id: string) => del(`/finance/donations/${id}`), { success: 'Aportación eliminada', invalidate: ['/finance/donors'] });
  return (
    <Modal open onClose={onClose} title={q.data ? `Aportaciones de ${q.data.name}` : 'Aportaciones'}>
      <div className="stack">
        {q.isLoading && <Loading rows={3} />}
        {q.error && <ErrorNote error={q.error} />}
        {q.data && (
          <DataTable
            caption="Aportaciones"
            rows={q.data.donations}
            rowKey={(d) => d.id}
            empty="Sin aportaciones registradas."
            columns={[
              { key: 'd', header: 'Fecha', render: (d) => date(d.date), nowrap: true },
              { key: 'k', header: 'Tipo', render: (d) => `${donationKind[d.kind]}${d.inKind ? ' (especie)' : ''}` },
              { key: 'c', header: 'Concepto', render: (d) => d.description ?? '—' },
              { key: 'a', header: 'Importe', render: (d) => money(d.amountCents), numeric: true, nowrap: true },
              ...(write
                ? [{ key: 'x', header: 'Acciones', render: (d: DonorDetail['donations'][number]) => <Menu label={`Acciones de la aportación del ${date(d.date)}`} items={[{ label: 'Eliminar', danger: true, onSelect: () => remove.mutate(d.id) }]} /> }]
                : []),
            ]}
          />
        )}
        {write && (
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const v = formValues(form);
              add.mutate({ kind: v.kind, date: v.date, amountCents: parseMoney(v.amount ?? '0'), description: v.description ?? null, inKind, createTransaction: !inKind && checked(form, 'createTransaction') });
            }}
          >
            <h3 className="card__title">Nueva aportación</h3>
            <div className="form-row">
              <SelectField label="Tipo" name="kind" options={Object.entries(donationKind).map(([value, label]) => ({ value, label }))} />
              <TextField label="Fecha" name="date" type="date" required defaultValue={today()} />
              <TextField label="Importe (€)" name="amount" required inputMode="decimal" pattern={MONEY} hint={inKind ? 'Valoración' : undefined} />
            </div>
            <TextField label="Concepto" name="description" />
            <Checkbox label="En especie" checked={inKind} onChange={(e) => setInKind(e.target.checked)} />
            {!inKind && <Checkbox label="Registrar el ingreso en Movimientos" name="createTransaction" defaultChecked />}
            <FormError error={add.error ?? remove.error} />
            <div className="row">
              <Button type="submit" size="sm" loading={add.isPending}>
                Añadir
              </Button>
            </div>
          </form>
        )}
        <div className="modal__footer">
          <Button onClick={onClose}>Cerrar</Button>
        </div>
      </div>
    </Modal>
  );
}

export function DonorsTab() {
  const { can } = useAuth();
  const toast = useToast();
  const write = can('finance:write');
  const [year, setYear] = useState(new Date().getFullYear() - (new Date().getMonth() < 3 ? 1 : 0));
  const q = useApi<Donor[]>('/finance/donors');
  const [editing, setEditing] = useState<Donor | 'new' | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Donor | null>(null);
  const remove = useApiMutation((id: string) => del(`/finance/donors/${id}`), { success: 'Donante eliminado', invalidate: ['/finance/donors'], onSuccess: () => setRemoving(null) });

  async function printCertificate(d: Donor) {
    try {
      const c = await get<DonationCertificate>(`/finance/donors/${d.id}/certificate`, { year });
      if (c.donations.length === 0) return toast.notify(`${d.name} no tiene donativos en ${year}`);
      if (!printDocument(`Certificado ${year} · ${d.name}`, certificateHtml(c))) toast.notify('Permite las ventanas emergentes para imprimir');
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="row between">
        <div className="row">
          <Button variant="ghost" size="sm" onClick={() => setYear(year - 1)} aria-label="Año anterior">
            ←
          </Button>
          <strong aria-live="polite">Ejercicio {year}</strong>
          <Button variant="ghost" size="sm" onClick={() => setYear(year + 1)} aria-label="Año siguiente">
            →
          </Button>
        </div>
        <div className="row">
          {can('members:sensitive') && (
            <Button variant="ghost" size="sm" onClick={() => downloadFile(`/finance/reports/modelo182.csv?year=${year}`, `modelo182-datos-${year}.csv`).catch(toast.error)}>
              Datos modelo 182 (CSV)
            </Button>
          )}
          {write && <Button onClick={() => setEditing('new')}>Nuevo donante</Button>}
        </div>
      </div>
      <p className="small muted">
        El CSV del modelo 182 reúne los donativos del año por donante para tu gestor. Sólo aplica a entidades acogidas a la Ley 49/2002 y no es el fichero oficial de la AEAT; los patrocinios no se incluyen.
      </p>
      <Card title="Socios protectores, donantes y patrocinadores">
        {q.isLoading && <Loading />}
        {q.error && <ErrorNote error={q.error} />}
        {q.data && (
          <DataTable
            caption="Donantes"
            rows={q.data}
            rowKey={(d) => d.id}
            empty="Registra a los socios protectores, donantes y patrocinadores para emitir certificados."
            columns={[
              { key: 'n', header: 'Nombre', render: (d) => <span>{d.name} {d.sponsor && <Chip tone="info">Patrocinador</Chip>}</span> },
              { key: 'k', header: 'Tipo', render: (d) => donorKind[d.kind] },
              { key: 't', header: 'NIF', render: nif, nowrap: true },
              { key: 'p', header: 'Provincia', render: (d) => d.province ?? '—' },
              { key: 'y', header: `Aportado ${new Date().getFullYear()}`, render: (d) => money(d.yearTotalCents ?? 0), numeric: true, nowrap: true },
              {
                key: 'x',
                header: 'Acciones',
                render: (d) => (
                  <Menu
                    label={`Acciones de ${d.name}`}
                    items={[
                      { label: 'Aportaciones', onSelect: () => setViewing(d.id) },
                      { label: `Certificado ${year}`, onSelect: () => printCertificate(d) },
                      ...(write ? [{ label: 'Editar', onSelect: () => setEditing(d) }, { label: 'Eliminar', danger: true, onSelect: () => setRemoving(d) }] : []),
                    ]}
                  />
                ),
              },
            ]}
          />
        )}
      </Card>
      {editing && <DonorModal donor={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {viewing && <DonationsModal donorId={viewing} onClose={() => setViewing(null)} />}
      <ConfirmModal
        open={!!removing}
        title="Eliminar donante"
        message={`¿Eliminar a ${removing?.name} y su historial de aportaciones? Los movimientos de caja se conservan.`}
        confirmLabel="Eliminar"
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}
