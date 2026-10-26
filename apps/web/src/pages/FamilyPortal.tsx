import { useState } from 'react';
import { useApi, useApiMutation } from '../api/hooks';
import { ApiError, patch, post } from '../api/client';
import type { FamilyPortalData } from '../api/types-school';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Chip, StatusChip } from '../components/Chip';
import { DataTable } from '../components/DataTable';
import { EmptyState, ErrorNote, Loading } from '../components/EmptyState';
import { FormError, TextAreaField, TextField, formValues } from '../components/Field';
import { Modal } from '../components/Modal';
import { Page, PageHeader } from '../components/PageHeader';
import { slotText } from '../components/school/common';
import { date, dateTime, fullName, money } from '../lib/format';
import { attendanceStatus } from '../lib/labels';
import { enrollmentStatus, hhmm, justificationStatus, paymentMethod, score, termName, tuitionStatus } from '../lib/labels-school';

type Absence = FamilyPortalData['absences'][number];

const dayLabel = (d: string) => date(d, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/** La familia explica una falta o un retraso; el profesorado lo revisa. */
function JustifyModal({ absence, who, onClose }: { absence: Absence | null; who: string; onClose: () => void }) {
  const save = useApiMutation((text: string) => post(`/school/family/absences/${absence!.id}/justify`, { text }), {
    success: 'Justificación enviada. La escuela la revisará.',
    invalidate: ['/school/family'],
    onSuccess: onClose,
  });
  return (
    <Modal open={!!absence} onClose={onClose} title="Justificar la falta">
      <form
        className="form"
        key={absence?.id}
        onSubmit={(e) => {
          e.preventDefault();
          const v = formValues(e.currentTarget);
          if (v.text) save.mutate(v.text);
        }}
      >
        {absence && (
          <p>
            {who} · {absence.session.group.name} · {date(absence.session.date)}
          </p>
        )}
        <TextAreaField label="Motivo" name="text" required minLength={3} maxLength={1000} rows={4} defaultValue={absence?.justification ?? ''} placeholder="Estaba con fiebre, cita médica…" />
        <FormError error={save.error} />
        <div className="modal__footer">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            Enviar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ContactModal({ open, guardian, onClose }: { open: boolean; guardian: FamilyPortalData['guardian']; onClose: () => void }) {
  const save = useApiMutation((body: unknown) => patch('/school/family/contact', body), { success: 'Datos de contacto actualizados', invalidate: ['/school/family'], onSuccess: onClose });
  return (
    <Modal open={open} onClose={onClose} title="Mis datos de contacto">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const v = formValues(e.currentTarget);
          save.mutate({ email: v.email ?? '', phone: v.phone ?? '' });
        }}
      >
        <div className="form-row">
          <TextField label="Email de contacto" name="email" type="email" defaultValue={guardian.email ?? ''} />
          <TextField label="Teléfono" name="phone" type="tel" defaultValue={guardian.phone ?? ''} />
        </div>
        <p className="small muted">Es donde la escuela os escribe y os llama. El email con el que entras en Solfeamos no cambia.</p>
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

function UpcomingCard({ d, studentName }: { d: FamilyPortalData; studentName: (id: string) => string }) {
  const byDay = new Map<string, FamilyPortalData['upcoming']>();
  for (const u of d.upcoming) byDay.set(u.date.slice(0, 10), [...(byDay.get(u.date.slice(0, 10)) ?? []), u]);
  const cancelled = d.upcoming.filter((u) => u.status === 'CANCELLED').length;
  return (
    <Card title="Próximas clases" actions={cancelled > 0 && <Chip tone="danger">{cancelled} cancelada(s)</Chip>}>
      {d.upcoming.length === 0 ? (
        <p className="muted">No hay clases en las próximas tres semanas.</p>
      ) : (
        <ul className="list-plain stack" style={{ gap: 12 }}>
          {[...byDay.entries()].map(([day, list]) => (
            <li key={day}>
              <p className="label-caps">{dayLabel(day)}</p>
              <ul className="list-plain list-divided">
                {list.map((u) => (
                  <li key={u.id} className="row between" style={{ gap: 12, flexWrap: 'wrap' }}>
                    <span style={u.status === 'CANCELLED' ? { textDecoration: 'line-through' } : undefined}>
                      <strong className="mono small">
                        {hhmm(u.startMin)}–{hhmm(u.endMin)}
                      </strong>{' '}
                      {u.group.subject.name} · {u.group.name}
                      <span className="small muted"> · {u.studentIds.map(studentName).join(', ')}</span>
                    </span>
                    <span>
                      {u.status === 'CANCELLED' && <Chip tone="danger">Cancelada</Chip>}
                      {u.makeUpForId && <Chip tone="info">Recuperación</Chip>}
                      {u.notes && <span className="small muted"> {u.notes}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function FamilyPortalPage() {
  const q = useApi<FamilyPortalData>('/school/family');
  const [justifying, setJustifying] = useState<Absence | null>(null);
  const [editingContact, setEditingContact] = useState(false);
  const header = <PageHeader title="Portal de familias" description="Próximas clases, horarios, faltas, notas, mensualidades y avisos de la escuela de música." />;
  if (q.isLoading) return <Page header={header}><Loading /></Page>;
  if (q.error instanceof ApiError && q.error.status === 404) {
    return (
      <Page header={header}>
        <EmptyState title="Sin familia vinculada" icon="users">Tu usuario no está vinculado a ningún tutor de la escuela. Pide a la secretaría que te envíe la invitación al portal.</EmptyState>
      </Page>
    );
  }
  if (q.error || !q.data) return <Page header={header}><ErrorNote error={q.error} onRetry={() => q.refetch()} /></Page>;
  const d = q.data;
  const studentName = (id: string) => d.students.find((s) => s.id === id)?.firstName ?? '';
  const open = d.charges.filter((c) => c.status === 'PENDING' || c.status === 'OVERDUE');
  const openCents = open.reduce((s, c) => s + c.amountCents, 0);
  const toJustify = d.absences.filter((a) => a.status !== 'EXCUSED' && (a.justificationStatus === 'NONE' || a.justificationStatus === 'REJECTED')).length;

  return (
    <Page header={header}>
      <div className="stack" style={{ gap: 24 }}>
        <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
          <p>
            Hola, <strong>{d.guardian.firstName}</strong>. {d.family.name}
          </p>
          <Button variant="ghost" onClick={() => setEditingContact(true)}>
            Mis datos de contacto
          </Button>
        </div>
        {(openCents > 0 || toJustify > 0) && (
          <div className="callout" role="status">
            <ul className="list-plain stack" style={{ gap: 4 }}>
              {openCents > 0 && (
                <li>
                  Tenéis <strong>{money(openCents)}</strong> pendiente de pago ({open.length} recibo(s)).
                </li>
              )}
              {toJustify > 0 && <li>{toJustify} falta(s) sin justificar. Podéis justificarlas abajo.</li>}
            </ul>
          </div>
        )}
        {d.notices.length > 0 && (
          <Card title="Avisos" tone="cream">
            <ul className="list-plain list-divided">
              {d.notices.map((n) => (
                <li key={n.id}>
                  <div className="row between">
                    <strong>{n.title}</strong>
                    <span className="small muted">{dateTime(n.createdAt)}</span>
                  </div>
                  {n.group && <Chip tone="info">{n.group.name}</Chip>}
                  <p className="small" style={{ whiteSpace: 'pre-line' }}>{n.body}</p>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {d.students.length > 0 && <UpcomingCard d={d} studentName={studentName} />}
        {d.students.length === 0 && <EmptyState title="Sin alumnos" icon="school">No hay alumnos activos en tu familia.</EmptyState>}
        {d.students.map((s) => (
          <Card key={s.id} title={fullName(s)}>
            <DataTable
              caption={`Clases de ${s.firstName}`}
              rows={s.enrollments}
              rowKey={(e) => e.id}
              empty="Sin matrículas."
              columns={[
                { key: 'g', header: 'Asignatura', render: (e) => <span><strong>{e.group.subject.name}</strong><div className="small muted">{e.group.name}{e.group.teacher ? ` · ${fullName(e.group.teacher)}` : ''}</div></span> },
                { key: 'h', header: 'Horario', render: (e) => (e.group.slots.length ? e.group.slots.map((sl, i) => <div key={i} className="small">{slotText(sl)}</div>) : '—') },
                { key: 's', header: 'Estado', render: (e) => <StatusChip value={e.status} map={enrollmentStatus} /> },
                {
                  key: 'n',
                  header: 'Notas',
                  render: (e) =>
                    e.grades.length
                      ? e.grades.map((g) => (
                          <div key={g.term} className="small">
                            {termName(g.term)}: {[g.scoreTenths != null ? score(g.scoreTenths) : null, g.qualitative].filter(Boolean).join(' · ') || '—'}
                            {g.comment && <span className="muted"> — {g.comment}</span>}
                          </div>
                        ))
                      : '—',
                },
              ]}
            />
          </Card>
        ))}
        <div className="grid grid--2">
          <Card title="Faltas y retrasos">
            <DataTable
              caption="Faltas y retrasos"
              rows={d.absences}
              rowKey={(a) => a.id}
              empty="Sin faltas registradas."
              columns={[
                { key: 'd', header: 'Fecha', render: (a) => date(a.session.date), nowrap: true },
                { key: 's', header: 'Alumno', render: (a) => studentName(a.studentId) },
                { key: 'g', header: 'Clase', render: (a) => a.session.group.name },
                {
                  key: 'st',
                  header: 'Tipo',
                  render: (a) => (
                    <span>
                      <StatusChip value={a.status} map={attendanceStatus} />
                      {a.justificationStatus !== 'NONE' && a.status !== 'EXCUSED' && <StatusChip value={a.justificationStatus} map={justificationStatus} />}
                    </span>
                  ),
                },
                {
                  key: 'a',
                  header: 'Acciones',
                  render: (a) =>
                    a.status !== 'EXCUSED' && a.justificationStatus !== 'APPROVED' ? (
                      <Button size="sm" variant="ghost" onClick={() => setJustifying(a)} aria-label={`Justificar la falta de ${studentName(a.studentId)} del ${date(a.session.date)}`}>
                        {a.justificationStatus === 'PENDING' ? 'Editar' : 'Justificar'}
                      </Button>
                    ) : null,
                },
              ]}
            />
          </Card>
          <Card title="Mensualidades">
            <DataTable
              caption="Mensualidades"
              rows={d.charges}
              rowKey={(c) => c.id}
              empty="Sin mensualidades emitidas."
              columns={[
                { key: 'p', header: 'Mes', render: (c) => c.period, nowrap: true },
                { key: 's', header: 'Alumno', render: (c) => studentName(c.studentId) },
                { key: 'a', header: 'Importe', render: (c) => money(c.amountCents), numeric: true, nowrap: true },
                {
                  key: 'st',
                  header: 'Estado',
                  render: (c) => (
                    <span>
                      <StatusChip value={c.status} map={tuitionStatus} />
                      <span className="small muted">
                        {' '}
                        {c.status === 'PAID'
                          ? `${date(c.paidAt)}${c.paymentMethod ? ` · ${paymentMethod[c.paymentMethod]}` : ''}`
                          : c.status === 'PENDING' || c.status === 'OVERDUE'
                            ? `vence el ${date(c.dueDate)}`
                            : ''}
                      </span>
                    </span>
                  ),
                },
              ]}
            />
          </Card>
        </div>
      </div>
      <JustifyModal absence={justifying} who={justifying ? studentName(justifying.studentId) : ''} onClose={() => setJustifying(null)} />
      <ContactModal open={editingContact} guardian={d.guardian} onClose={() => setEditingContact(false)} />
    </Page>
  );
}
