import { useEffect, useState } from 'react';
import { post, put } from '../../api/client';
import { useApiMutation } from '../../api/hooks';
import type { AssemblyDetail } from '../../api/types-governance';
import { useAuth } from '../../auth/AuthProvider';
import { Button } from '../Button';
import { Chip } from '../Chip';
import { FormError, TextAreaField } from '../Field';
import { ConfirmModal } from '../Modal';
import { date } from '../../lib/format';
import { minutesHtml } from './MinutesBookTab';
import { brandOf, printDocument } from './print';

export function MinutesPanel({ assembly }: { assembly: AssemblyDetail }) {
  const { can, session } = useAuth();
  const approved = !!assembly.minutesApprovedAt;
  const editable = can('governance:write') && !approved;
  const [text, setText] = useState(assembly.minutes ?? '');
  const [confirm, setConfirm] = useState<'overwrite' | 'approve' | null>(null);
  useEffect(() => setText(assembly.minutes ?? ''), [assembly.minutes]);
  const inv = [`/governance/assemblies/${assembly.id}`, '/governance/minutes'];
  const draft = useApiMutation((overwrite: boolean) => post<{ minutes: string; saved: boolean }>(`/governance/assemblies/${assembly.id}/minutes/draft`, { overwrite }), {
    success: 'Borrador generado',
    invalidate: inv,
    onSuccess: (r) => {
      setText(r.minutes);
      setConfirm(null);
    },
  });
  const save = useApiMutation(() => put(`/governance/assemblies/${assembly.id}/minutes`, { minutes: text }), { success: 'Acta guardada', invalidate: inv });
  const approve = useApiMutation(() => post(`/governance/assemblies/${assembly.id}/minutes/approve`), { success: 'Acta aprobada', invalidate: inv, onSuccess: () => setConfirm(null) });
  const dirty = text !== (assembly.minutes ?? '');
  const held = assembly.status === 'HELD' || assembly.status === 'CLOSED';

  if (!assembly.minutes && !editable) return <p className="muted">El acta aún no está disponible.</p>;
  return (
    <div className="stack">
      <div className="row between">
        {approved ? <Chip tone="success">Aprobada el {date(assembly.minutesApprovedAt)}</Chip> : <Chip tone="warning">Borrador</Chip>}
        <Button
          size="sm"
          variant="ghost"
          disabled={!text}
          onClick={() => printDocument(assembly.title, minutesHtml({ ...assembly, minutes: text, minutesApprovedAt: assembly.minutesApprovedAt ?? '' }), brandOf(session))}
        >
          Imprimir
        </Button>
      </div>
      {editable ? (
        <>
          <TextAreaField label="Texto del acta" value={text} onChange={(e) => setText(e.target.value)} rows={20} hint="Genera un borrador a partir de la asistencia, el orden del día y las votaciones, y complétalo." />
          <FormError error={draft.error ?? save.error ?? approve.error} />
          <div className="row">
            <Button variant="ghost" onClick={() => (text.trim() ? setConfirm('overwrite') : draft.mutate(false))} loading={draft.isPending}>
              Generar borrador
            </Button>
            <Button variant="ghost" onClick={() => save.mutate(undefined)} disabled={!dirty} loading={save.isPending}>
              Guardar
            </Button>
            <Button onClick={() => setConfirm('approve')} disabled={!held || !text.trim() || dirty} title={!held ? 'La asamblea debe haberse celebrado' : undefined}>
              Aprobar acta
            </Button>
          </div>
          {!held && <p className="small muted">El acta se aprueba cuando la asamblea se ha celebrado.</p>}
        </>
      ) : (
        <pre className="card card--cream" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>
          {assembly.minutes}
        </pre>
      )}
      <ConfirmModal
        open={confirm === 'overwrite'}
        title="Generar borrador"
        message="El acta ya tiene texto. ¿Sustituirlo por un borrador nuevo?"
        confirmLabel="Sustituir"
        loading={draft.isPending}
        onConfirm={() => draft.mutate(true)}
        onClose={() => setConfirm(null)}
      />
      <ConfirmModal
        open={confirm === 'approve'}
        title="Aprobar acta"
        message="Una vez aprobada, el acta pasa al libro de actas y no se puede modificar."
        confirmLabel="Aprobar"
        loading={approve.isPending}
        onConfirm={() => approve.mutate(undefined)}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}
