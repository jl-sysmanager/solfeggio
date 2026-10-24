import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { patch, post } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import type { Member, Paginated, Section } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { Person } from '../components/Avatar';
import { ArrowLink, Button } from '../components/Button';
import { Card } from '../components/Card';
import { StatusChip } from '../components/Chip';
import { DataTable, Pagination } from '../components/DataTable';
import { ErrorNote, Loading } from '../components/EmptyState';
import { Checkbox, FormError, SelectField, TextAreaField, TextField, formValues } from '../components/Field';
import { Menu } from '../components/Menu';
import { Modal } from '../components/Modal';
import { Page, PageHeader } from '../components/PageHeader';
import { date, today } from '../lib/format';
import { memberStatus } from '../lib/labels';

export function useSections() {
  return useApi<Section[]>('/sections');
}

export function MemberFormModal({ open, onClose, member }: { open: boolean; onClose: () => void; member?: Member | null }) {
  const { can } = useAuth();
  const sections = useSections();
  const sensitive = can('members:sensitive');
  const save = useApiMutation(
    (body: Record<string, unknown>) => (member ? patch(`/members/${member.id}`, body) : post('/members', body)),
    { success: member ? 'Socio actualizado' : 'Socio dado de alta', invalidate: ['/members', '/dashboard'], onSuccess: onClose },
  );

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    const fd = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      firstName: v.firstName,
      lastName: v.lastName,
      email: v.email ?? null,
      phone: v.phone ?? null,
      birthDate: v.birthDate ?? null,
      address: v.address ?? null,
      instrument: v.instrument ?? null,
      sectionId: v.sectionId ?? null,
      notes: v.notes ?? null,
      consentImages: fd.get('consentImages') === 'on',
    };
    if (fd.get('consentData') === 'on' && !member?.consentDataAt) body.consentDataAt = new Date().toISOString();
    if (sensitive) {
      if (v.nationalId !== undefined) body.nationalId = v.nationalId;
      if (v.iban !== undefined) body.iban = v.iban.replace(/\s+/g, '');
    }
    if (!member && v.joinedAt) body.joinedAt = v.joinedAt;
    save.mutate(body);
  }

  return (
    <Modal open={open} onClose={onClose} title={member ? 'Editar socio' : 'Alta de socio'}>
      <form className="form" onSubmit={submit} key={member?.id ?? 'new'}>
        <div className="form-row">
          <TextField label="Nombre" name="firstName" required defaultValue={member?.firstName} autoComplete="off" />
          <TextField label="Apellidos" name="lastName" required defaultValue={member?.lastName} autoComplete="off" />
        </div>
        <div className="form-row">
          <TextField label="Email" name="email" type="email" defaultValue={member?.email ?? ''} />
          <TextField label="Teléfono" name="phone" type="tel" defaultValue={member?.phone ?? ''} />
        </div>
        <div className="form-row">
          <TextField label="Instrumento" name="instrument" defaultValue={member?.instrument ?? ''} />
          <SelectField
            label="Sección"
            name="sectionId"
            defaultValue={member?.sectionId ?? ''}
            placeholder="Sin sección"
            options={(sections.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          />
        </div>
        <div className="form-row">
          <TextField label="Fecha de nacimiento" name="birthDate" type="date" defaultValue={member?.birthDate?.slice(0, 10) ?? ''} />
          {!member && <TextField label="Fecha de alta" name="joinedAt" type="date" defaultValue={today()} />}
        </div>
        <TextField label="Dirección" name="address" defaultValue={member?.address ?? ''} />
        {sensitive && (
          <div className="form-row">
            <TextField label="DNI / NIE" name="nationalId" defaultValue={member?.nationalId ?? ''} hint="Se guarda cifrado." autoComplete="off" />
            <TextField label="IBAN" name="iban" defaultValue={member?.iban ?? ''} hint="Para domiciliar cuotas. Se guarda cifrado." autoComplete="off" />
          </div>
        )}
        <TextAreaField label="Notas" name="notes" defaultValue={member?.notes ?? ''} />
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field__label" style={{ marginBottom: 8 }}>
            Consentimientos (RGPD)
          </legend>
          <Checkbox name="consentData" label="Consiente el tratamiento de sus datos para la gestión de la banda" defaultChecked={!!member?.consentDataAt} disabled={!!member?.consentDataAt} />
          <Checkbox name="consentImages" label="Consiente el uso de su imagen en publicaciones" defaultChecked={member?.consentImages} />
        </fieldset>
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

export function LeaveModal({ member, onClose }: { member: Member | null; onClose: () => void }) {
  const leave = useApiMutation((body: { date: string; reason?: string }) => post(`/members/${member!.id}/leave`, body), {
    success: 'Baja registrada',
    invalidate: ['/members', '/dashboard'],
    onSuccess: onClose,
  });
  return (
    <Modal open={!!member} onClose={onClose} title={`Baja de ${member?.firstName ?? ''} ${member?.lastName ?? ''}`}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const v = formValues(e.currentTarget);
          leave.mutate({ date: v.date ?? today(), reason: v.reason });
        }}
      >
        <TextField label="Fecha de baja" name="date" type="date" defaultValue={today()} required />
        <TextAreaField label="Motivo" name="reason" />
        <p className="small muted">El historial se conserva. Podrás reactivar al socio más adelante o anonimizar sus datos desde su ficha.</p>
        <FormError error={leave.error} />
        <div className="modal__footer">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={leave.isPending}>
            Registrar baja
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function MembersPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [q, setQ] = useState(params.get('q') ?? '');
  const status = params.get('status') ?? 'ACTIVE';
  const sectionId = params.get('sectionId') ?? '';
  const page = Number(params.get('page') ?? 1);
  const [editing, setEditing] = useState<Member | null>(null);
  const [creating, setCreating] = useState(params.get('new') === '1');
  const [leaving, setLeaving] = useState<Member | null>(null);
  const sections = useSections();
  const list = useApi<Paginated<Member>>('/members', { q: params.get('q'), status: status === 'ALL' ? undefined : status, sectionId, page, pageSize: 25 });

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    next.delete('new');
    setParams(next, { replace: true });
  };

  return (
    <Page
      header={
        <PageHeader
          eyebrow="Gestión"
          title="Socios"
          description="Altas, bajas, datos personales y consentimientos."
          actions={can('members:write') && <Button onClick={() => setCreating(true)}>Alta de socio</Button>}
        />
      }
    >
      <Card>
        <form
          className="toolbar"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            set('q', q);
          }}
        >
          <TextField label="Buscar" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, email, instrumento…" />
          <SelectField
            label="Estado"
            value={status}
            onChange={(e) => set('status', e.target.value)}
            options={[
              { value: 'ACTIVE', label: 'Activos' },
              { value: 'INACTIVE', label: 'Inactivos' },
              { value: 'LEFT', label: 'Bajas' },
              { value: 'ALL', label: 'Todos' },
            ]}
          />
          <SelectField
            label="Sección"
            value={sectionId}
            onChange={(e) => set('sectionId', e.target.value)}
            placeholder="Todas"
            options={(sections.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          />
          <Button type="submit" variant="ghost">
            Buscar
          </Button>
        </form>
      </Card>

      {list.isLoading && <Loading />}
      {list.error && <ErrorNote error={list.error} />}
      {list.data && (
        <Card title={`${list.data.total} socios`}>
          <DataTable
            caption="Listado de socios"
            rows={list.data.data}
            rowKey={(m) => m.id}
            columns={[
              { key: 'n', header: 'Nº', render: (m) => m.memberNumber, numeric: true },
              {
                key: 'name',
                header: 'Nombre',
                render: (m) => (
                  <Person name={`${m.firstName} ${m.lastName}`} detail={m.email ?? undefined}>
                    <ArrowLink to={`/members/${m.id}`}>{`${m.lastName}, ${m.firstName}`}</ArrowLink>
                  </Person>
                ),
              },
              { key: 'inst', header: 'Instrumento', render: (m) => m.instrument ?? '—' },
              { key: 'sec', header: 'Sección', render: (m) => m.section?.name ?? '—' },
              { key: 'joined', header: 'Alta', render: (m) => date(m.joinedAt), nowrap: true },
              { key: 'status', header: 'Estado', render: (m) => <StatusChip value={m.status} map={memberStatus} /> },
              ...(can('members:write')
                ? [
                    {
                      key: 'act',
                      header: 'Acciones',
                      render: (m: Member) => (
                        <Menu
                          label={`Acciones de ${m.firstName} ${m.lastName}`}
                          items={[
                            { label: 'Ver ficha', onSelect: () => navigate(`/members/${m.id}`) },
                            { label: 'Editar', onSelect: () => setEditing(m) },
                            ...(m.status !== 'LEFT' ? [{ label: 'Dar de baja', onSelect: () => setLeaving(m), danger: true }] : []),
                          ]}
                        />
                      ),
                    },
                  ]
                : []),
            ]}
          />
          <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={(p) => set('page', String(p))} />
        </Card>
      )}

      <MemberFormModal open={creating || !!editing} member={editing} onClose={() => { setCreating(false); setEditing(null); }} />
      <LeaveModal member={leaving} onClose={() => setLeaving(null)} />
    </Page>
  );
}
