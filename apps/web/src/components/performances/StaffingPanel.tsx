import { useEffect, useState } from 'react';
import { post, put } from '../../api/client';
import { useApi, useApiMutation } from '../../api/hooks';
import type { Staffing, StaffingAlertResult } from '../../api/types-performances';
import { useAuth } from '../../auth/AuthProvider';
import { Button } from '../Button';
import { Card } from '../Card';
import { Chip } from '../Chip';
import { ErrorNote, Loading } from '../EmptyState';
import { Checkbox, FormError } from '../Field';
import { Modal } from '../Modal';

interface Row {
  instrument: string;
  required: string;
}

function RequirementsModal({ eventId, staffing, open, onClose }: { eventId: string; staffing: Staffing; open: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    if (open) {
      const current = staffing.rows.filter((r) => r.required > 0).map((r) => ({ instrument: r.instrument, required: String(r.required) }));
      setRows(current.length ? current : [{ instrument: '', required: '1' }]);
    }
  }, [open, staffing.rows]);
  const save = useApiMutation(
    () =>
      put(
        `/events/${eventId}/requirements`,
        rows.filter((r) => r.instrument.trim()).map((r) => ({ instrument: r.instrument.trim(), required: Math.max(0, parseInt(r.required, 10) || 0) })),
      ),
    { success: 'Plantilla mínima guardada', invalidate: [`/events/${eventId}/staffing`, '/reinforcements'], onSuccess: onClose },
  );
  const set = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <Modal open={open} onClose={onClose} title="Plantilla mínima por instrumento">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <p className="small">Indica cuántos músicos de cada instrumento necesita el evento. Se compara con el instrumento de cada socio convocado.</p>
        <ul className="list-plain stack">
          {rows.map((r, i) => (
            <li key={i} className="row">
              <input className="input" aria-label={`Instrumento ${i + 1}`} placeholder="Trompeta" value={r.instrument} maxLength={60} onChange={(e) => set(i, { instrument: e.target.value })} />
              <input
                className="input"
                style={{ maxWidth: 90 }}
                aria-label={`Músicos necesarios de ${r.instrument || `instrumento ${i + 1}`}`}
                type="number"
                min={0}
                max={200}
                value={r.required}
                onChange={(e) => set(i, { required: e.target.value })}
              />
              <Button size="sm" variant="ghost" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} aria-label={`Quitar ${r.instrument || `instrumento ${i + 1}`}`}>
                ×
              </Button>
            </li>
          ))}
        </ul>
        <div>
          <Button size="sm" variant="ghost" onClick={() => setRows((x) => [...x, { instrument: '', required: '1' }])} disabled={rows.length >= 60}>
            Añadir instrumento
          </Button>
        </div>
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

/** Plantilla mínima: cobertura por instrumento y aviso de vacantes. */
export function StaffingPanel({ eventId, active }: { eventId: string; active: boolean }) {
  const { can } = useAuth();
  const q = useApi<Staffing>(`/events/${eventId}/staffing`);
  const [editing, setEditing] = useState(false);
  const [alerting, setAlerting] = useState(false);
  const [alsoCall, setAlsoCall] = useState(false);
  const [result, setResult] = useState<StaffingAlertResult | null>(null);
  const alert = useApiMutation(() => post<StaffingAlertResult>(`/events/${eventId}/staffing/alert`, { call: alsoCall }), {
    invalidate: [`/events/${eventId}`],
    onSuccess: (res) => {
      setResult(res);
      setAlerting(false);
    },
  });

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  const write = can('events:write');

  return (
    <div className="stack" style={{ gap: 24 }}>
      <Card
        title="Plantilla mínima"
        actions={
          write && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                Editar necesidades
              </Button>
              {active && (
                <Button size="sm" onClick={() => setAlerting(true)} disabled={s.totals.missing === 0}>
                  Avisar vacantes
                </Button>
              )}
            </>
          )
        }
      >
        <div className="chips" style={{ marginBottom: 12 }}>
          <Chip tone="info">{s.totals.required} necesarios</Chip>
          <Chip tone="success">{s.totals.accepted} confirmados</Chip>
          <Chip tone={s.totals.missing ? 'danger' : 'success'}>{s.totals.missing ? `${s.totals.missing} vacantes` : 'Plantilla cubierta'}</Chip>
        </div>
        {s.rows.length === 0 ? (
          <p className="muted">Sin necesidades definidas ni músicos convocados.</p>
        ) : (
          <div className="table-wrap">
            <table className="table table--responsive">
              <caption className="sr-only">Cobertura por instrumento</caption>
              <thead>
                <tr>
                  <th scope="col">Instrumento</th>
                  <th scope="col" className="num">Necesarios</th>
                  <th scope="col" className="num">Confirmados</th>
                  <th scope="col" className="num">Pendientes</th>
                  <th scope="col" className="num">No asisten</th>
                  <th scope="col" className="num">Faltan</th>
                </tr>
              </thead>
              <tbody>
                {s.rows.map((r) => (
                  <tr key={r.instrument}>
                    <td data-label="Instrumento">{r.instrument}</td>
                    <td data-label="Necesarios" className="num">{r.required || '—'}</td>
                    <td data-label="Confirmados" className="num">{r.accepted}</td>
                    <td data-label="Pendientes" className="num">{r.pending}</td>
                    <td data-label="No asisten" className="num">{r.declined}</td>
                    <td data-label="Faltan" className="num">
                      {r.missing > 0 ? <Chip tone="danger">{r.missing}</Chip> : <span className="muted">0</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted" style={{ marginTop: 12 }}>
          «Faltan» descuenta los confirmados y los pendientes de responder. Si no hay socios suficientes, publica la necesidad en la bolsa de refuerzos.
        </p>
      </Card>

      {result && (
        <Card title="Resultado del aviso" tone="cream">
          <p>
            {result.notified === 0
              ? 'No hay socios activos sin convocar de los instrumentos con vacantes.'
              : `Se ha avisado a ${result.notified} socios${result.called ? ` y se les ha convocado` : ''}.`}
          </p>
          <ul className="list-plain list-divided">
            {result.vacancies.map((v) => (
              <li key={v.instrument} className="row between">
                <span>{v.instrument}</span>
                <span className="small">
                  {v.missing} vacantes · {v.notified} avisados
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <RequirementsModal eventId={eventId} staffing={s} open={editing} onClose={() => setEditing(false)} />
      <Modal
        open={alerting}
        onClose={() => setAlerting(false)}
        title="Avisar vacantes"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAlerting(false)}>
              Cancelar
            </Button>
            <Button onClick={() => alert.mutate(undefined)} loading={alert.isPending}>
              Enviar aviso
            </Button>
          </>
        }
      >
        <div className="stack">
          <p>Se notificará a los socios activos de los instrumentos con vacantes que todavía no están convocados.</p>
          {can('calls:manage') && <Checkbox label="Convocarlos también al evento" checked={alsoCall} onChange={(e) => setAlsoCall(e.target.checked)} />}
          <FormError error={alert.error} />
        </div>
      </Modal>
    </div>
  );
}
