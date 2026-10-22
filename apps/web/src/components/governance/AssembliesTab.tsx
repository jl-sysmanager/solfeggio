import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { patch, post } from '../../api/client';
import { useApi, useApiMutation } from '../../api/hooks';
import type { Assembly, AssemblySummary } from '../../api/types-governance';
import { useAuth } from '../../auth/AuthProvider';
import { ArrowLink, Button } from '../Button';
import { Card } from '../Card';
import { StatusChip } from '../Chip';
import { DataTable } from '../DataTable';
import { ErrorNote, Loading } from '../EmptyState';
import { FormError, SelectField, TextField, formValues } from '../Field';
import { Modal } from '../Modal';
import { dateTime, toLocalInput } from '../../lib/format';
import { assemblyStatus, assemblyType } from '../../lib/labels-governance';

const toIso = (local?: string) => (local ? new Date(local).toISOString() : null);

/** Alta y edición de los datos de la convocatoria (el orden del día se edita en la ficha). */
export function AssemblyFormModal({ open, onClose, assembly }: { open: boolean; onClose: () => void; assembly?: Assembly }) {
  const navigate = useNavigate();
  const save = useApiMutation(
    (body: Record<string, unknown>) => (assembly ? patch<Assembly>(`/governance/assemblies/${assembly.id}`, body) : post<Assembly>('/governance/assemblies', body)),
    {
      success: assembly ? 'Asamblea actualizada' : 'Asamblea creada',
      invalidate: ['/governance/assemblies'],
      onSuccess: (a) => {
        onClose();
        if (!assembly) navigate(`/governance/assemblies/${a.id}`);
      },
    },
  );
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    save.mutate({
      type: v.type,
      title: v.title,
      firstCallAt: toIso(v.firstCallAt),
      secondCallAt: toIso(v.secondCallAt),
      location: v.location ?? null,
      quorumPct: Number(v.quorumPct ?? 50),
    });
  }
  return (
    <Modal open={open} onClose={onClose} title={assembly ? 'Editar asamblea' : 'Nueva asamblea'}>
      <form className="form" onSubmit={submit}>
        <div className="form-row">
          <SelectField label="Tipo" name="type" defaultValue={assembly?.type ?? 'ORDINARY'} options={Object.entries(assemblyType).map(([value, label]) => ({ value, label }))} />
          <TextField label="Quórum en 1.ª convocatoria (%)" name="quorumPct" type="number" min={0} max={100} defaultValue={assembly?.quorumPct ?? 50} />
        </div>
        <TextField label="Título" name="title" required defaultValue={assembly?.title} placeholder="Asamblea General Ordinaria 2026" />
        <div className="form-row">
          <TextField label="Primera convocatoria" name="firstCallAt" type="datetime-local" required defaultValue={toLocalInput(assembly?.firstCallAt)} />
          <TextField label="Segunda convocatoria" name="secondCallAt" type="datetime-local" defaultValue={toLocalInput(assembly?.secondCallAt)} hint="Sin quórum mínimo" />
        </div>
        <TextField label="Lugar" name="location" defaultValue={assembly?.location ?? ''} />
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

export function AssembliesTab() {
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  const q = useApi<AssemblySummary[]>('/governance/assemblies');
  return (
    <Card title="Asambleas" actions={can('governance:write') && <Button size="sm" onClick={() => setCreating(true)}>Nueva asamblea</Button>}>
      {q.isLoading && <Loading />}
      {q.error && <ErrorNote error={q.error} />}
      {q.data && (
        <DataTable
          caption="Asambleas"
          rows={q.data}
          rowKey={(a) => a.id}
          empty="Crea la primera asamblea para convocar a los socios."
          columns={[
            { key: 'd', header: 'Fecha', render: (a) => dateTime(a.firstCallAt), nowrap: true },
            { key: 't', header: 'Asamblea', render: (a) => <ArrowLink to={`/governance/assemblies/${a.id}`}>{a.title}</ArrowLink> },
            { key: 'y', header: 'Tipo', render: (a) => assemblyType[a.type] },
            { key: 'm', header: 'Votaciones', render: (a) => a._count.motions, numeric: true },
            { key: 's', header: 'Estado', render: (a) => <StatusChip value={a.status} map={assemblyStatus} /> },
            { key: 'a', header: 'Acta', render: (a) => (a.minutesApprovedAt ? 'Aprobada' : a.hasMinutes ? 'Borrador' : '—') },
          ]}
        />
      )}
      <AssemblyFormModal open={creating} onClose={() => setCreating(false)} />
    </Card>
  );
}
