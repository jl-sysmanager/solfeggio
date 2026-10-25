import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { get, post, put } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import type { Member } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { ArrowLink, Button } from '../components/Button';
import { Card } from '../components/Card';
import { StatusChip } from '../components/Chip';
import { ErrorNote, Loading } from '../components/EmptyState';
import { Modal, ConfirmModal } from '../components/Modal';
import { Page, PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toasts';
import { date } from '../lib/format';
import { memberStatus } from '../lib/labels';
import { LeaveModal, MemberFormModal } from './Members';

const GARMENTS = ['Chaqueta', 'Pantalón / falda', 'Camisa', 'Gorra', 'Zapatos'];

function SizesModal({ member, open, onClose }: { member: Member; open: boolean; onClose: () => void }) {
  const save = useApiMutation((sizes: { garment: string; size: string }[]) => put(`/members/${member.id}/sizes`, sizes), {
    success: 'Tallas guardadas',
    invalidate: [`/members/${member.id}`],
    onSuccess: onClose,
  });
  const current = Object.fromEntries((member.sizes ?? []).map((s) => [s.garment, s.size]));
  const garments = Array.from(new Set([...GARMENTS, ...Object.keys(current)]));
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const sizes = garments.map((g) => ({ garment: g, size: String(fd.get(g) ?? '').trim() })).filter((s) => s.size);
    save.mutate(sizes);
  }
  return (
    <Modal open={open} onClose={onClose} title="Tallas">
      <form className="form" onSubmit={submit}>
        <div className="form-row">
          {garments.map((g) => (
            <div className="field" key={g}>
              <label htmlFor={`size-${g}`}>{g}</label>
              <input id={`size-${g}`} className="input" name={g} defaultValue={current[g] ?? ''} />
            </div>
          ))}
        </div>
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

export default function MemberDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const q = useApi<Member>(`/members/${id}`);
  const [editing, setEditing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [sizes, setSizes] = useState(false);
  const [anonymize, setAnonymize] = useState(false);

  const rejoin = useApiMutation(() => post(`/members/${id}/rejoin`), { success: 'Socio reactivado', invalidate: ['/members'] });
  const anon = useApiMutation(() => post(`/members/${id}/anonymize`), {
    success: 'Datos personales anonimizados',
    invalidate: ['/members'],
    onSuccess: () => navigate('/members'),
  });

  async function exportData() {
    try {
      const data = await get<unknown>(`/members/${id}/export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `socio-${id}-datos.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e);
    }
  }

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <div className="container page__body"><ErrorNote error={q.error} /></div>;
  const m = q.data;
  const write = can('members:write');

  return (
    <Page
      header={
        <PageHeader
          eyebrow={`Socio nº ${m.memberNumber}`}
          title={`${m.firstName} ${m.lastName}`}
          description={<StatusChip value={m.status} map={memberStatus} />}
          actions={
            write && (
              <>
                <Button onClick={() => setEditing(true)}>Editar</Button>
                {m.status === 'LEFT' ? (
                  <Button variant="ghost" onClick={() => rejoin.mutate(undefined)} loading={rejoin.isPending}>
                    Reactivar
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={() => setLeaving(true)}>
                    Dar de baja
                  </Button>
                )}
              </>
            )
          }
        />
      }
    >
      <ArrowLink to="/members">Volver a socios</ArrowLink>
      <div className="grid grid--2">
        <Card title="Datos personales">
          <dl className="kv">
            <dt>Email</dt>
            <dd>{m.email ?? '—'}</dd>
            <dt>Teléfono</dt>
            <dd>{m.phone ?? '—'}</dd>
            <dt>Nacimiento</dt>
            <dd>{date(m.birthDate)}</dd>
            <dt>Dirección</dt>
            <dd>{m.address ?? '—'}</dd>
            {can('members:sensitive') && (
              <>
                <dt>DNI / NIE</dt>
                <dd>{m.nationalId ?? '—'}</dd>
              </>
            )}
          </dl>
        </Card>
        <Card title="Banda" tone="cream">
          <dl className="kv">
            <dt>Instrumento</dt>
            <dd>{m.instrument ?? '—'}</dd>
            <dt>Sección</dt>
            <dd>{m.section?.name ?? '—'}</dd>
            <dt>Alta</dt>
            <dd>{date(m.joinedAt)}</dd>
            {m.leftAt && (
              <>
                <dt>Baja</dt>
                <dd>
                  {date(m.leftAt)}
                  {m.leaveReason ? ` · ${m.leaveReason}` : ''}
                </dd>
              </>
            )}
            <dt>Notas</dt>
            <dd>{m.notes ?? '—'}</dd>
          </dl>
        </Card>
        <Card title="Tallas" actions={write && <Button size="sm" variant="ghost" onClick={() => setSizes(true)}>Editar tallas</Button>}>
          {m.sizes && m.sizes.length > 0 ? (
            <dl className="kv">
              {m.sizes.map((s) => (
                <div key={s.garment} style={{ display: 'contents' }}>
                  <dt>{s.garment}</dt>
                  <dd>{s.size}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="muted">Sin tallas registradas.</p>
          )}
        </Card>
        <Card title="Protección de datos (RGPD)">
          <dl className="kv">
            <dt>Tratamiento</dt>
            <dd>{m.consentDataAt ? `Consentido el ${date(m.consentDataAt)}` : 'Sin consentimiento registrado'}</dd>
            <dt>Imagen</dt>
            <dd>{m.consentImages ? 'Autorizada' : 'No autorizada'}</dd>
          </dl>
          {write && (
            <div className="card__footer">
              <Button variant="ghost" size="sm" onClick={exportData}>
                Exportar datos (acceso / portabilidad)
              </Button>
              <Button variant="danger" size="sm" onClick={() => setAnonymize(true)}>
                Anonimizar (supresión)
              </Button>
            </div>
          )}
        </Card>
      </div>

      <MemberFormModal open={editing} member={m} onClose={() => setEditing(false)} />
      <LeaveModal member={leaving ? m : null} onClose={() => setLeaving(false)} />
      <SizesModal member={m} open={sizes} onClose={() => setSizes(false)} />
      <ConfirmModal
        open={anonymize}
        title="Anonimizar socio"
        message="Se eliminarán de forma irreversible nombre, contacto, DNI y dirección. Se conservarán los registros estadísticos y contables sin datos identificativos. Esta acción no se puede deshacer."
        confirmLabel="Anonimizar definitivamente"
        loading={anon.isPending}
        onConfirm={() => anon.mutate(undefined)}
        onClose={() => setAnonymize(false)}
      />
    </Page>
  );
}
