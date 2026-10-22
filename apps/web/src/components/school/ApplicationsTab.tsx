import { useState } from 'react';
import { patch, post } from '../../api/client';
import { useApi, useApiMutation } from '../../api/hooks';
import type { Application, ClassGroup, Family, SchoolSettings, Subject } from '../../api/types-school';
import { useAuth } from '../../auth/AuthProvider';
import { date, dateTime, toLocalInput } from '../../lib/format';
import { applicationStatus } from '../../lib/labels-school';
import { Person } from '../Avatar';
import { Button } from '../Button';
import { Card } from '../Card';
import { StatusChip } from '../Chip';
import { DataTable } from '../DataTable';
import { EmptyState, ErrorNote, Loading } from '../EmptyState';
import { Checkbox, FormError, SelectField, TextField, formValues } from '../Field';
import { Menu } from '../Menu';
import { Modal } from '../Modal';
import { useToast } from '../Toasts';
import { groupLabel, useSchoolYears, YearSelect } from './common';

function PublicLink({ slug }: { slug: string }) {
  const toast = useToast();
  const url = `${window.location.origin}/enroll/${slug}`;
  return (
    <Card tone="cream" title="Formulario público de matrícula">
      <p className="small">Comparte este enlace con las familias. Sólo acepta solicitudes cuando hay un curso con la matrícula abierta.</p>
      <div className="row">
        <code className="mono">{url}</code>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            navigator.clipboard?.writeText(url).then(
              () => toast.notify('Enlace copiado'),
              () => toast.notify(url),
            )
          }
        >
          Copiar enlace
        </Button>
      </div>
    </Card>
  );
}

function AuditionModal({ app, onClose }: { app: Application | null; onClose: () => void }) {
  const save = useApiMutation((body: unknown) => patch(`/school/applications/${app!.id}`, body), { success: 'Solicitud actualizada', invalidate: ['/school/applications'], onSuccess: onClose });
  return (
    <Modal open={!!app} onClose={onClose} title="Prueba de acceso">
      <form
        className="form"
        key={app?.id}
        onSubmit={(e) => {
          e.preventDefault();
          const v = formValues(e.currentTarget);
          save.mutate({ auditionAt: v.auditionAt ? new Date(v.auditionAt).toISOString() : null, auditionResult: v.auditionResult ?? null });
        }}
      >
        <TextField label="Fecha y hora" name="auditionAt" type="datetime-local" defaultValue={toLocalInput(app?.auditionAt)} />
        <TextField label="Resultado" name="auditionResult" defaultValue={app?.auditionResult ?? ''} placeholder="Apto, nivel 2.º…" />
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

function AcceptModal({ app, groups, onClose }: { app: Application | null; groups: ClassGroup[]; onClose: () => void }) {
  const families = useApi<Family[]>(app ? '/school/families' : null);
  const accept = useApiMutation((body: unknown) => post<{ enrollments: { status: string }[] }>(`/school/applications/${app!.id}/accept`, body), {
    success: 'Solicitud aceptada: alumno matriculado',
    invalidate: ['/school'],
    onSuccess: onClose,
  });
  const yearGroups = groups.filter((g) => g.yearId === app?.yearId);
  return (
    <Modal open={!!app} onClose={onClose} title={`Aceptar a ${app?.studentFirstName ?? ''} ${app?.studentLastName ?? ''}`}>
      <form
        className="form"
        key={app?.id}
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const groupIds = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="groupIds"]:checked')).map((i) => i.value);
          const v = formValues(form);
          accept.mutate({ groupIds, ...(v.familyId ? { familyId: v.familyId } : {}) });
        }}
      >
        <SelectField
          label="Familia"
          name="familyId"
          placeholder="Crear familia nueva con el tutor"
          hint="Elige una familia existente si ya tiene hermanos en la escuela."
          options={(families.data ?? []).map((f) => ({ value: f.id, label: f.name }))}
        />
        <fieldset className="stack" style={{ gap: 8, border: 0, padding: 0 }}>
          <legend className="label-caps">Grupos</legend>
          {yearGroups.length === 0 && <p className="muted small">No hay grupos en el curso de la solicitud.</p>}
          {yearGroups.map((g) => (
            <Checkbox
              key={g.id}
              name="groupIds"
              value={g.id}
              defaultChecked={app?.subjectIds.includes(g.subjectId)}
              label={`${groupLabel(g)} — ${g.activeCount ?? 0}${g.capacity ? `/${g.capacity}` : ''} plazas${g.capacity && (g.activeCount ?? 0) >= g.capacity ? ' (lista de espera)' : ''}`}
            />
          ))}
        </fieldset>
        <FormError error={accept.error} />
        <div className="modal__footer">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={accept.isPending}>
            Aceptar y matricular
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ApplicationsTab() {
  const { can } = useAuth();
  const write = can('school:write');
  const { years, yearId, setYearId, isLoading } = useSchoolYears();
  const [status, setStatus] = useState('PENDING');
  const settings = useApi<SchoolSettings>('/school/settings');
  const subjects = useApi<Subject[]>('/school/subjects');
  const groups = useApi<ClassGroup[]>(yearId ? '/school/groups' : null, { yearId });
  const apps = useApi<Application[]>(yearId ? '/school/applications' : null, { yearId, status });
  const [audition, setAudition] = useState<Application | null>(null);
  const [accepting, setAccepting] = useState<Application | null>(null);
  const resolve = useApiMutation((v: { id: string; action: 'waitlist' | 'reject' }) => post(`/school/applications/${v.id}/${v.action}`), {
    success: 'Solicitud actualizada',
    invalidate: ['/school/applications'],
  });
  const subjectName = (id: string) => subjects.data?.find((s) => s.id === id)?.name ?? '—';

  if (isLoading) return <Loading />;
  return (
    <div className="stack" style={{ gap: 24 }}>
      {settings.data?.slug && <PublicLink slug={settings.data.slug} />}
      {!years.length ? (
        <EmptyState title="Sin cursos" icon="calendar">Crea un curso y abre la matrícula en Configuración.</EmptyState>
      ) : (
        <>
          <Card>
            <div className="toolbar">
              <YearSelect years={years} value={yearId} onChange={setYearId} />
              <SelectField label="Estado" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Todas" options={Object.entries(applicationStatus).map(([value, { label }]) => ({ value, label }))} />
            </div>
          </Card>
          {apps.isLoading && <Loading />}
          {apps.error && <ErrorNote error={apps.error} />}
          {apps.data && (
            <Card>
              <DataTable
                caption="Solicitudes de matrícula"
                rows={apps.data}
                rowKey={(a) => a.id}
                empty="No hay solicitudes con este filtro."
                columns={[
                  { key: 's', header: 'Alumno', render: (a) => <Person name={`${a.studentFirstName} ${a.studentLastName}`} detail={a.studentBirthDate ? `Nac. ${date(a.studentBirthDate)}` : undefined} /> },
                  { key: 'g', header: 'Tutor', render: (a) => <span>{a.guardianName}<br /><span className="small muted">{a.guardianEmail}{a.guardianPhone ? ` · ${a.guardianPhone}` : ''}</span></span> },
                  { key: 'sub', header: 'Asignaturas', render: (a) => a.subjectIds.map(subjectName).join(', ') },
                  { key: 'au', header: 'Prueba de acceso', render: (a) => (a.auditionAt ? `${dateTime(a.auditionAt)}${a.auditionResult ? ` · ${a.auditionResult}` : ''}` : a.auditionResult ?? '—') },
                  { key: 'r', header: 'Recibida', render: (a) => date(a.createdAt), nowrap: true },
                  { key: 'st', header: 'Estado', render: (a) => <StatusChip value={a.status} map={applicationStatus} /> },
                  ...(write
                    ? [
                        {
                          key: 'a',
                          header: 'Acciones',
                          render: (a: Application) =>
                            a.status === 'ACCEPTED' || a.status === 'REJECTED' ? null : (
                              <Menu
                                label={`Acciones de la solicitud de ${a.studentFirstName}`}
                                items={[
                                  { label: 'Aceptar y matricular', onSelect: () => setAccepting(a) },
                                  { label: 'Prueba de acceso', onSelect: () => setAudition(a) },
                                  ...(a.status !== 'WAITLISTED' ? [{ label: 'Pasar a lista de espera', onSelect: () => resolve.mutate({ id: a.id, action: 'waitlist' }) }] : []),
                                  { label: 'Rechazar', onSelect: () => resolve.mutate({ id: a.id, action: 'reject' }), danger: true },
                                ]}
                              />
                            ),
                        },
                      ]
                    : []),
                ]}
              />
            </Card>
          )}
        </>
      )}
      <AuditionModal app={audition} onClose={() => setAudition(null)} />
      <AcceptModal app={accepting} groups={groups.data ?? []} onClose={() => setAccepting(null)} />
    </div>
  );
}
