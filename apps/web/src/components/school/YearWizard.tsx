import { useState } from 'react';
import { post } from '../../api/client';
import { useApi, useApiMutation } from '../../api/hooks';
import type { SchoolYear, YearSummary } from '../../api/types-school';
import { fullName } from '../../lib/format';
import { Button } from '../Button';
import { Card } from '../Card';
import { DataTable } from '../DataTable';
import { Loading } from '../EmptyState';
import { Checkbox, FormError, SelectField, TextField } from '../Field';
import { Modal } from '../Modal';
import { useToast } from '../Toasts';
import { suggestedYear } from './common';
import { HolidaysField } from './HolidaysField';

const STEPS = ['Fechas', 'Grupos', 'Publicar'] as const;

/**
 * Asistente de nuevo curso: fechas y festivos, copia de grupos y horarios del curso anterior (con
 * rematrícula) y publicación (curso actual, matrícula online). Las sesiones se crean solas.
 */
export function YearWizard({ open, years, onClose }: { open: boolean; years: SchoolYear[]; onClose: () => void }) {
  const toast = useToast();
  const suggestion = suggestedYear(years);
  const previous = years.find((y) => y.isCurrent) ?? years[0];
  const [step, setStep] = useState(0);
  const [name, setName] = useState(suggestion.name);
  const [startsOn, setStartsOn] = useState(suggestion.startsOn);
  const [endsOn, setEndsOn] = useState(suggestion.endsOn);
  const [holidays, setHolidays] = useState<string[]>([]);
  const [sourceId, setSourceId] = useState(previous?.id ?? '');
  const [renew, setRenew] = useState(true);
  const [isCurrent, setIsCurrent] = useState(true);
  const [enrollmentOpen, setEnrollmentOpen] = useState(false);
  const summary = useApi<YearSummary>(open && sourceId ? `/school/years/${sourceId}/summary` : null);
  const create = useApiMutation((body: unknown) => post<SchoolYear & { copied: { groups: number; enrollments: number; waitlisted: number } | null }>('/school/years', body), {
    invalidate: ['/school'],
    onSuccess: (y) => {
      toast.notify(
        y.copied
          ? `Curso ${y.name} creado: ${y.copied.groups} grupos con su horario${y.copied.enrollments ? ` y ${y.copied.enrollments} alumnos rematriculados` : ''}${y.copied.waitlisted ? ` (${y.copied.waitlisted} en espera)` : ''}`
          : `Curso ${y.name} creado`,
      );
      close();
    },
  });
  function close() {
    setStep(0);
    onClose();
  }
  const datesOk = !!name.trim() && !!startsOn && !!endsOn && endsOn >= startsOn;

  return (
    <Modal open={open} onClose={close} title="Nuevo curso escolar" size="lg">
      <div className="stack" style={{ gap: 16 }}>
        <ol className="segmented" aria-label="Pasos del asistente" style={{ listStyle: 'none', alignSelf: 'flex-start' }}>
          {STEPS.map((s, i) => (
            <li key={s}>
              <button type="button" aria-current={i === step ? 'step' : undefined} aria-pressed={i === step} disabled={i > step && !datesOk} onClick={() => setStep(i)}>
                {i + 1}. {s}
              </button>
            </li>
          ))}
        </ol>

        {step === 0 && (
          <div className="form">
            <div className="form-row">
              <TextField label="Nombre" required value={name} onChange={(e) => setName(e.target.value)} placeholder="2026-27" />
              <TextField label="Inicio de las clases" type="date" required value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
              <TextField label="Fin de las clases" type="date" required value={endsOn} min={startsOn} onChange={(e) => setEndsOn(e.target.value)} error={endsOn < startsOn ? 'Debe ser posterior al inicio' : null} />
            </div>
            <HolidaysField value={holidays} onChange={setHolidays} startsOn={startsOn} endsOn={endsOn} />
          </div>
        )}

        {step === 1 && (
          <div className="form">
            {years.length === 0 ? (
              <p>Es el primer curso: crearás los grupos después, en «Grupos y horarios».</p>
            ) : (
              <>
                <SelectField
                  label="Copiar grupos y horarios de"
                  value={sourceId}
                  onChange={(e) => setSourceId(e.target.value)}
                  placeholder="No copiar: empezar sin grupos"
                  options={years.map((y) => ({ value: y.id, label: y.name }))}
                />
                {sourceId && (
                  <>
                    {summary.isLoading && <Loading rows={3} />}
                    {summary.data && (
                      <Card tone="cool" title={`${summary.data.groups.length} grupos · ${summary.data.students} alumnos`}>
                        <DataTable
                          caption="Grupos que se copiarán"
                          rows={summary.data.groups}
                          rowKey={(g) => g.id}
                          empty="Ese curso no tiene grupos."
                          columns={[
                            { key: 'g', header: 'Grupo', render: (g) => `${g.subject} · ${g.name}${g.level ? ` (${g.level})` : ''}` },
                            { key: 't', header: 'Profesor', render: (g) => (g.teacher ? fullName(g.teacher) : '—') },
                            { key: 'h', header: 'Franjas', render: (g) => g.slots, numeric: true },
                            { key: 's', header: 'Alumnos', render: (g) => g.students, numeric: true },
                          ]}
                        />
                      </Card>
                    )}
                    <Checkbox label="Rematricular a los alumnos activos en los mismos grupos" checked={renew} onChange={(e) => setRenew(e.target.checked)} />
                    <p className="small muted">Si un grupo se llena, el resto queda en lista de espera. Podrás ajustar grupos y alumnos después.</p>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="form">
            <Checkbox label="Es el curso actual (el que se ve por defecto y el que se cobra)" checked={isCurrent} onChange={(e) => setIsCurrent(e.target.checked)} />
            <Checkbox label="Abrir ya la matrícula online" checked={enrollmentOpen} onChange={(e) => setEnrollmentOpen(e.target.checked)} />
            <Card tone="cream" title="Resumen">
              <ul className="list-plain stack" style={{ gap: 4 }}>
                <li>
                  <strong>{name}</strong>: del {startsOn.split('-').reverse().join('/')} al {endsOn.split('-').reverse().join('/')}, {holidays.length} días sin clase.
                </li>
                <li>{sourceId && years.length ? `Grupos y horarios copiados de ${years.find((y) => y.id === sourceId)?.name}${renew ? ', con rematrícula' : ''}.` : 'Sin grupos todavía.'}</li>
                <li>Las clases del curso se crearán solas a partir de los horarios.</li>
              </ul>
            </Card>
            <FormError error={create.error} />
          </div>
        )}

        <div className="modal__footer">
          <Button variant="ghost" onClick={step === 0 ? close : () => setStep(step - 1)}>
            {step === 0 ? 'Cancelar' : 'Atrás'}
          </Button>
          {step < STEPS.length - 1 ? (
            <Button disabled={!datesOk} onClick={() => setStep(step + 1)}>
              Siguiente
            </Button>
          ) : (
            <Button
              loading={create.isPending}
              onClick={() =>
                create.mutate({
                  name: name.trim(), startsOn, endsOn, holidays, isCurrent, enrollmentOpen,
                  ...(sourceId && years.length ? { copyFrom: { sourceYearId: sourceId, renewEnrollments: renew } } : {}),
                })
              }
            >
              Crear curso
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
