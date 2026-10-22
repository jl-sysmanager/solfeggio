import { useEffect, useState } from 'react';
import { del, post, put } from '../../api/client';
import { useApiMutation } from '../../api/hooks';
import type { AssemblyDetail, MemberRef, Motion, VoteChoice, VoteCounts } from '../../api/types-governance';
import { useAuth } from '../../auth/AuthProvider';
import { Button } from '../Button';
import { Card } from '../Card';
import { StatusChip } from '../Chip';
import { Checkbox, FormError, TextAreaField, TextField, formValues } from '../Field';
import { Menu } from '../Menu';
import { Modal } from '../Modal';
import { fullName } from '../../lib/format';
import { motionStatus, voteChoice } from '../../lib/labels-governance';

const CHOICES: VoteChoice[] = ['YES', 'NO', 'ABSTAIN'];

export function ResultsLine({ r }: { r: VoteCounts }) {
  return (
    <p className="small">
      <strong>{r.YES}</strong> a favor · <strong>{r.NO}</strong> en contra · <strong>{r.ABSTAIN}</strong> abstenciones · {r.total} votos ({r.remote} a distancia)
    </p>
  );
}

function VoteButtons({ label, value, onVote, disabled }: { label: string; value?: VoteChoice | null; onVote: (c: VoteChoice) => void; disabled?: boolean }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {CHOICES.map((c) => (
        <button key={c} type="button" aria-pressed={value === c} disabled={disabled} onClick={() => onVote(c)}>
          {voteChoice[c]}
        </button>
      ))}
    </div>
  );
}

/** El secretario anota los votos emitidos en la sala (presentes y representados). */
function RoomVotesModal({ assembly, motion, open, onClose }: { assembly: AssemblyDetail; motion: Motion; open: boolean; onClose: () => void }) {
  const voters: MemberRef[] = [];
  for (const r of assembly.attendance) {
    if (!voters.some((v) => v.id === r.member.id)) voters.push(r.member);
    if (r.proxyFor) voters.push(r.proxyFor);
  }
  const [values, setValues] = useState<Record<string, VoteChoice>>({});
  useEffect(() => {
    if (open) setValues(Object.fromEntries((motion.votes ?? []).filter((v) => !v.remote).map((v) => [v.memberId, v.choice])));
  }, [open, motion.votes]);
  const save = useApiMutation(() => put(`/governance/motions/${motion.id}/votes`, Object.entries(values).map(([memberId, choice]) => ({ memberId, choice }))), {
    success: 'Votos registrados',
    invalidate: [`/governance/assemblies/${assembly.id}`],
    onSuccess: onClose,
  });
  return (
    <Modal open={open} onClose={onClose} title={`Votos en sala: ${motion.title}`}>
      <div className="stack">
        {voters.length === 0 && <p className="muted">Registra primero la asistencia.</p>}
        <ul className="list-plain list-divided">
          {voters.map((m) => (
            <li key={m.id} className="row between">
              <span>{fullName(m)}</span>
              <VoteButtons label={`Voto de ${fullName(m)}`} value={values[m.id]} onVote={(c) => setValues((v) => ({ ...v, [m.id]: c }))} />
            </li>
          ))}
        </ul>
        <FormError error={save.error} />
        <div className="modal__footer">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={Object.keys(values).length === 0}>
            Guardar votos
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function MotionCard({ assembly, motion }: { assembly: AssemblyDetail; motion: Motion }) {
  const { can } = useAuth();
  const write = can('governance:write');
  const [room, setRoom] = useState(false);
  const inv = { invalidate: [`/governance/assemblies/${assembly.id}`] };
  const vote = useApiMutation((body: { choice: VoteChoice; onBehalfOf?: string }) => post(`/governance/motions/${motion.id}/vote`, body), { success: 'Voto registrado', ...inv });
  const open = useApiMutation(() => post(`/governance/motions/${motion.id}/open`), { success: 'Votación abierta', ...inv });
  const close = useApiMutation(() => post(`/governance/motions/${motion.id}/close`), { success: 'Votación cerrada', ...inv });
  const remove = useApiMutation(() => del(`/governance/motions/${motion.id}`), { success: 'Votación eliminada', ...inv });
  const me = assembly.me;
  const canVote = motion.status === 'OPEN' && can('governance:vote') && !!me.memberId;
  const blocked = me.delegated && !me.present ? 'Has delegado tu voto.' : !me.present && !motion.allowRemote ? 'Esta votación sólo admite voto presencial.' : null;

  const actions = write
    ? [
        ...(motion.status === 'DRAFT' && (assembly.status === 'CONVENED' || assembly.status === 'HELD') ? [{ label: 'Abrir votación', onSelect: () => open.mutate(undefined) }] : []),
        ...(motion.status === 'OPEN' ? [{ label: 'Anotar votos en sala', onSelect: () => setRoom(true) }, { label: 'Cerrar votación', onSelect: () => close.mutate(undefined) }] : []),
        ...(motion.status === 'DRAFT' ? [{ label: 'Eliminar', danger: true, onSelect: () => remove.mutate(undefined) }] : []),
      ]
    : [];

  return (
    <Card
      as="article"
      headingLevel={3}
      title={motion.title}
      actions={
        <>
          <StatusChip value={motion.status} map={motionStatus} />
          {actions.length > 0 && <Menu label={`Acciones de ${motion.title}`} items={actions} />}
        </>
      }
    >
      <div className="stack">
        {motion.description && <p>{motion.description}</p>}
        <p className="small muted">{motion.allowRemote ? 'Admite voto a distancia' : 'Sólo voto presencial'}</p>
        {motion.status !== 'DRAFT' && <ResultsLine r={motion.results} />}
        {canVote &&
          (blocked ? (
            <p className="small">{blocked}</p>
          ) : (
            <div className="stack">
              <span className="small">
                Tu voto{!me.present && ' (a distancia)'}
                {motion.myVote && `: ${voteChoice[motion.myVote.choice]}`}
              </span>
              <VoteButtons label="Tu voto" value={motion.myVote?.choice} disabled={vote.isPending} onVote={(choice) => vote.mutate({ choice })} />
            </div>
          ))}
        {canVote &&
          me.proxies.map((p) => (
            <div key={p.id} className="stack">
              <span className="small">En representación de {fullName(p)}</span>
              <VoteButtons label={`Voto de ${fullName(p)}`} value={motion.proxyVotes?.[p.id]} disabled={vote.isPending} onVote={(choice) => vote.mutate({ choice, onBehalfOf: p.id })} />
            </div>
          ))}
        {!canVote && motion.myVote && <p className="small">Tu voto: {voteChoice[motion.myVote.choice]}</p>}
        {write && motion.votes && motion.votes.length > 0 && (
          <details>
            <summary className="small">Votos individuales ({motion.votes.length})</summary>
            <ul className="list-plain list-divided small">
              {motion.votes.map((v) => (
                <li key={v.memberId}>
                  {fullName(v.member)}: {voteChoice[v.choice]}
                  {v.remote && ' (a distancia)'}
                </li>
              ))}
            </ul>
          </details>
        )}
        <FormError error={vote.error ?? open.error ?? close.error} />
      </div>
      {write && <RoomVotesModal assembly={assembly} motion={motion} open={room} onClose={() => setRoom(false)} />}
    </Card>
  );
}

export function MotionsPanel({ assembly }: { assembly: AssemblyDetail }) {
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  const create = useApiMutation((body: unknown) => post(`/governance/assemblies/${assembly.id}/motions`, body), {
    success: 'Votación creada',
    invalidate: [`/governance/assemblies/${assembly.id}`],
    onSuccess: () => setCreating(false),
  });
  return (
    <div className="stack" style={{ gap: 16 }}>
      {can('governance:write') && assembly.status !== 'CLOSED' && (
        <div className="row">
          <Button size="sm" onClick={() => setCreating(true)}>
            Nueva votación
          </Button>
        </div>
      )}
      {assembly.motions.length === 0 && <p className="muted">No hay votaciones en esta asamblea.</p>}
      {assembly.motions.map((m) => (
        <MotionCard key={m.id} assembly={assembly} motion={m} />
      ))}
      <Modal open={creating} onClose={() => setCreating(false)} title="Nueva votación">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            create.mutate({ title: v.title, description: v.description ?? null, allowRemote: (e.currentTarget.elements.namedItem('allowRemote') as HTMLInputElement).checked });
          }}
        >
          <TextField label="Propuesta" name="title" required placeholder="Aprobación de las cuentas de 2025" />
          <TextAreaField label="Descripción" name="description" rows={3} />
          <Checkbox label="Admitir voto a distancia de los socios ausentes" name="allowRemote" defaultChecked />
          <FormError error={create.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={create.isPending}>
              Crear
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
