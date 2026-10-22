import { useState, type FormEvent } from 'react';
import { del, post } from '../../api/client';
import { useApi, useApiMutation } from '../../api/hooks';
import type { Poll, PollResults } from '../../api/types-governance';
import { useAuth } from '../../auth/AuthProvider';
import { Button } from '../Button';
import { Card } from '../Card';
import { Chip } from '../Chip';
import { EmptyState, ErrorNote, Loading } from '../EmptyState';
import { Checkbox, FormError, TextAreaField, TextField, formValues } from '../Field';
import { Menu } from '../Menu';
import { ConfirmModal, Modal } from '../Modal';
import { dateTime, percent } from '../../lib/format';

function Results({ poll }: { poll: Poll }) {
  const q = useApi<PollResults>(`/governance/polls/${poll.id}/results`);
  if (q.isLoading) return <Loading rows={2} />;
  if (q.error) return <ErrorNote error={q.error} />;
  const r = q.data!;
  return (
    <div className="stack">
      <ul className="list-plain stack" aria-label={`Resultados de ${poll.question}`}>
        {r.options.map((o, i) => {
          const share = r.totalVoters ? r.counts[i] / r.totalVoters : 0;
          return (
            <li key={o}>
              <div className="row between small">
                <span>
                  {o}
                  {r.myChoices?.includes(i) && <span className="muted"> · tu respuesta</span>}
                </span>
                <span>
                  {r.counts[i]} ({percent(share)})
                </span>
              </div>
              <div className="meter" aria-hidden="true">
                <div className="meter__fill" style={{ width: `${share * 100}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="small muted">{r.totalVoters} participantes</p>
      {r.voters && r.voters.length > 0 && (
        <details>
          <summary className="small">Ver quién ha votado</summary>
          <ul className="list-plain list-divided small">
            {r.voters.map((v) => (
              <li key={v.name}>
                {v.name}: {v.choices.map((c) => r.options[c]).join(', ')}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function PollCard({ poll }: { poll: Poll }) {
  const { can } = useAuth();
  const [selected, setSelected] = useState<number[]>(poll.myChoices ?? []);
  const [showResults, setShowResults] = useState(!poll.open || !!poll.myChoices);
  const [removing, setRemoving] = useState(false);
  const vote = useApiMutation(() => post(`/governance/polls/${poll.id}/vote`, { choices: selected }), {
    success: 'Respuesta registrada',
    invalidate: ['/governance/polls'],
    onSuccess: () => setShowResults(true),
  });
  const close = useApiMutation(() => post(`/governance/polls/${poll.id}/close`), { success: 'Encuesta cerrada', invalidate: ['/governance/polls'] });
  const remove = useApiMutation(() => del(`/governance/polls/${poll.id}`), { success: 'Encuesta eliminada', invalidate: ['/governance/polls'] });
  const canVote = poll.open && can('governance:vote');
  const toggle = (i: number) => setSelected((s) => (poll.multiple ? (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]) : [i]));

  return (
    <Card
      as="article"
      headingLevel={3}
      title={poll.question}
      actions={
        <>
          <Chip tone={poll.open ? 'success' : 'neutral'}>{poll.open ? 'Abierta' : 'Cerrada'}</Chip>
          {can('governance:write') && (
            <Menu
              label={`Acciones de la encuesta ${poll.question}`}
              items={[
                ...(poll.open ? [{ label: 'Cerrar encuesta', onSelect: () => close.mutate(undefined) }] : []),
                { label: 'Eliminar', danger: true, onSelect: () => setRemoving(true) },
              ]}
            />
          )}
        </>
      }
    >
      <p className="small muted">
        {poll.multiple ? 'Varias respuestas' : 'Una respuesta'} · {poll.anonymous ? 'Anónima' : 'Nominal'}
        {poll.closesAt && ` · Cierra ${dateTime(poll.closesAt)}`} · {poll.voteCount} votos
      </p>
      {canVote && !showResults && (
        <form
          className="stack"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            vote.mutate(undefined);
          }}
        >
          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="sr-only">{poll.question}</legend>
            {poll.options.map((o, i) => (
              <label key={o} className="checkbox">
                <input type={poll.multiple ? 'checkbox' : 'radio'} name={`poll-${poll.id}`} checked={selected.includes(i)} onChange={() => toggle(i)} />
                <span>{o}</span>
              </label>
            ))}
          </fieldset>
          <FormError error={vote.error} />
          <div className="row">
            <Button type="submit" size="sm" disabled={selected.length === 0} loading={vote.isPending}>
              {poll.myChoices ? 'Cambiar respuesta' : 'Votar'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowResults(true)}>
              Ver resultados
            </Button>
          </div>
        </form>
      )}
      {showResults && (
        <>
          <Results poll={poll} />
          {canVote && (
            <Button size="sm" variant="ghost" onClick={() => setShowResults(false)}>
              {poll.myChoices ? 'Cambiar mi respuesta' : 'Votar'}
            </Button>
          )}
        </>
      )}
      <ConfirmModal
        open={removing}
        title="Eliminar encuesta"
        message={`¿Eliminar «${poll.question}» y sus respuestas?`}
        confirmLabel="Eliminar"
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
        onClose={() => setRemoving(false)}
      />
    </Card>
  );
}

export function PollsTab() {
  const { can } = useAuth();
  const q = useApi<Poll[]>('/governance/polls');
  const [creating, setCreating] = useState(false);
  const create = useApiMutation((body: unknown) => post('/governance/polls', body), {
    success: 'Encuesta creada',
    invalidate: ['/governance/polls'],
    onSuccess: () => setCreating(false),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const v = formValues(form);
    const options = (v.options ?? '').split('\n').map((o) => o.trim()).filter(Boolean);
    const checked = (n: string) => (form.elements.namedItem(n) as HTMLInputElement).checked;
    create.mutate({
      question: v.question,
      options,
      multiple: checked('multiple'),
      anonymous: checked('anonymous'),
      notify: checked('notify'),
      closesAt: v.closesAt ? new Date(v.closesAt).toISOString() : null,
    });
  }
  return (
    <div className="stack" style={{ gap: 24 }}>
      {can('governance:write') && (
        <div className="row">
          <Button onClick={() => setCreating(true)}>Nueva encuesta</Button>
        </div>
      )}
      {q.isLoading && <Loading />}
      {q.error && <ErrorNote error={q.error} />}
      {q.data?.length === 0 && <EmptyState title="Sin encuestas">Las encuestas sirven para consultar a los socios sin convocar una asamblea.</EmptyState>}
      <div className="grid grid--2">
        {q.data?.map((p) => <PollCard key={p.id} poll={p} />)}
      </div>
      <Modal open={creating} onClose={() => setCreating(false)} title="Nueva encuesta">
        <form className="form" onSubmit={submit}>
          <TextField label="Pregunta" name="question" required />
          <TextAreaField label="Opciones" name="options" required rows={4} hint="Una por línea (mínimo dos)" />
          <TextField label="Cierre" name="closesAt" type="datetime-local" hint="Opcional; también puedes cerrarla a mano" />
          <Checkbox label="Permitir varias respuestas" name="multiple" />
          <Checkbox label="Anónima (no se muestra quién vota qué)" name="anonymous" />
          <Checkbox label="Avisar a los socios" name="notify" defaultChecked />
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
