import { useState, type FormEvent } from 'react';
import { put } from '../../api/client';
import { useApi, useApiMutation } from '../../api/hooks';
import type { Logistics } from '../../api/types-performances';
import { useAuth } from '../../auth/AuthProvider';
import { dateTime, toLocalInput } from '../../lib/format';
import { Button } from '../Button';
import { Card } from '../Card';
import { ErrorNote, Loading } from '../EmptyState';
import { FormError, TextAreaField, TextField, formValues } from '../Field';

const FIELDS: [keyof Logistics, string][] = [
  ['transport', 'Transporte'],
  ['departurePlace', 'Lugar de salida'],
  ['departureAt', 'Salida'],
  ['returnAt', 'Regreso previsto'],
  ['uniform', 'Uniforme'],
  ['route', 'Recorrido'],
  ['notes', 'Notas'],
];

/** Logística del evento: transporte, horarios, recorrido y uniforme. */
export function LogisticsPanel({ eventId }: { eventId: string }) {
  const { can } = useAuth();
  const q = useApi<Logistics>(`/events/${eventId}/logistics`);
  const [editing, setEditing] = useState(false);
  const save = useApiMutation((body: unknown) => put(`/events/${eventId}/logistics`, body), {
    success: 'Logística guardada',
    invalidate: [`/events/${eventId}/logistics`],
    onSuccess: () => setEditing(false),
  });

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />;
  const l = q.data;
  const write = can('events:write');

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    const iso = (s?: string) => (s ? new Date(s).toISOString() : null);
    save.mutate({
      transport: v.transport ?? null,
      departurePlace: v.departurePlace ?? null,
      departureAt: iso(v.departureAt),
      returnAt: iso(v.returnAt),
      route: v.route ?? null,
      uniform: v.uniform ?? null,
      notes: v.notes ?? null,
    });
  }

  if (editing) {
    return (
      <Card title="Editar logística">
        <form className="form" onSubmit={submit}>
          <div className="form-row">
            <TextField label="Transporte" name="transport" defaultValue={l.transport ?? ''} placeholder="Autobús (2 vehículos)" maxLength={200} />
            <TextField label="Lugar de salida" name="departurePlace" defaultValue={l.departurePlace ?? ''} maxLength={200} />
          </div>
          <div className="form-row">
            <TextField label="Salida" name="departureAt" type="datetime-local" defaultValue={toLocalInput(l.departureAt)} />
            <TextField label="Regreso previsto" name="returnAt" type="datetime-local" defaultValue={toLocalInput(l.returnAt)} />
          </div>
          <TextField label="Uniforme" name="uniform" defaultValue={l.uniform ?? ''} placeholder="Gala, guantes blancos" maxLength={300} />
          <TextAreaField label="Recorrido" name="route" defaultValue={l.route ?? ''} rows={3} maxLength={2000} />
          <TextAreaField label="Notas" name="notes" defaultValue={l.notes ?? ''} rows={3} maxLength={4000} />
          <FormError error={save.error} />
          <div className="row">
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={save.isPending}>
              Guardar
            </Button>
          </div>
        </form>
      </Card>
    );
  }

  const empty = FIELDS.every(([k]) => !l[k]);
  return (
    <Card title="Logística" actions={write && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Editar</Button>}>
      {empty ? (
        <p className="muted">Sin datos de logística todavía.</p>
      ) : (
        <ul className="list-plain list-divided">
          {FIELDS.filter(([k]) => l[k]).map(([k, label]) => (
            <li key={k}>
              <span className="small muted">{label}</span>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{k === 'departureAt' || k === 'returnAt' ? dateTime(l[k]) : l[k]}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
