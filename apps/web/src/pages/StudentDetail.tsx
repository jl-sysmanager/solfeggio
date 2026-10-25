import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { post, put } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import type { Section } from '../api/types';
import type { ReportCard, SchoolYear, StudentDetail } from '../api/types-school';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/Button';
import { Card, StatCard } from '../components/Card';
import { Chip, StatusChip } from '../components/Chip';
import { DataTable } from '../components/DataTable';
import { ErrorNote, Loading } from '../components/EmptyState';
import { FormError, SelectField, TextField, formValues } from '../components/Field';
import { Modal } from '../components/Modal';
import { Page, PageHeader } from '../components/PageHeader';
import { groupLabel, slotText } from '../components/school/common';
import { StudentFormModal } from '../components/school/StudentsTab';
import { brandOf, escapeHtml, printDocument } from '../components/governance/print';
import { date, fullName, money } from '../lib/format';
import { attendanceStatus } from '../lib/labels';
import { bandStage, enrollmentStatus, score, studentStatus, termName, tuitionStatus } from '../lib/labels-school';

type Enr = StudentDetail['enrollments'][number];

function GradeModal({ target, onClose }: { target: { enrollment: Enr; term: number } | null; onClose: () => void }) {
  const save = useApiMutation((body: unknown) => put(`/school/groups/${target!.enrollment.groupId}/grades`, body), { success: 'Nota guardada', invalidate: ['/school'], onSuccess: onClose });
  const g = target?.enrollment.grades.find((x) => x.term === target.term);
  return (
    <Modal open={!!target} onClose={onClose} title={target ? `${target.enrollment.group.subject.name} · ${termName(target.term)}` : 'Nota'}>
      <form
        className="form"
        key={`${target?.enrollment.id}-${target?.term}`}
        onSubmit={(e) => {
          e.preventDefault();
          const v = formValues(e.currentTarget);
          const sc = v.score?.replace(',', '.');
          save.mutate({ term: target!.term, grades: [{ enrollmentId: target!.enrollment.id, scoreTenths: sc ? Math.round(Number(sc) * 10) : null, qualitative: v.qualitative ?? null, comment: v.comment ?? null }] });
        }}
      >
        <div className="form-row">
          <TextField label="Nota (0–10)" name="score" inputMode="decimal" pattern="^(10([.,]0)?|[0-9]([.,][0-9])?)$" defaultValue={g?.scoreTenths != null ? String(g.scoreTenths / 10).replace('.', ',') : ''} />
          <TextField label="Calificación" name="qualitative" defaultValue={g?.qualitative ?? ''} placeholder="Notable" />
        </div>
        <TextField label="Comentario" name="comment" defaultValue={g?.comment ?? ''} />
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

function PromoteModal({ student, open, onClose }: { student: StudentDetail; open: boolean; onClose: () => void }) {
  const sections = useApi<Section[]>(open && !student.memberId ? '/sections' : null);
  const promote = useApiMutation((body: unknown) => post(`/school/students/${student.id}/promote`, body), { success: 'Paso a la banda registrado', invalidate: ['/school', '/members'], onSuccess: onClose });
  return (
    <Modal open={open} onClose={onClose} title="Paso a la banda">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const v = formValues(e.currentTarget);
          promote.mutate({ stage: v.stage, sectionId: v.sectionId ?? null });
        }}
      >
        <p className="small">
          {student.memberId
            ? 'El alumno ya tiene ficha de socio: sólo se actualizará su etapa.'
            : 'Se creará su ficha de socio con nombre, fecha de nacimiento, contacto, instrumento y consentimiento de imagen.'}
        </p>
        <SelectField label="Etapa" name="stage" defaultValue={student.bandStage === 'EDUCANDO' ? 'MUSICIAN' : 'EDUCANDO'} options={[{ value: 'EDUCANDO', label: 'Educando' }, { value: 'MUSICIAN', label: 'Músico de la banda' }]} />
        {!student.memberId && <SelectField label="Sección" name="sectionId" placeholder="Sin sección" options={(sections.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />}
        <FormError error={promote.error} />
        <div className="modal__footer">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={promote.isPending}>
            Confirmar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function reportCardHtml(r: ReportCard) {
  const rows = r.subjects
    .map((s) => {
      const cells = [1, 2, 3, 4]
        .map((t) => {
          const g = s.grades.find((x) => x.term === t);
          const text = g ? [g.scoreTenths != null ? score(g.scoreTenths) : null, g.qualitative].filter(Boolean).join(' · ') || '—' : '—';
          return `<td class="num">${escapeHtml(text)}</td>`;
        })
        .join('');
      const abs = (s.attendance.ABSENT ?? 0) + (s.attendance.EXCUSED ?? 0);
      return `<tr><th>${escapeHtml(s.subject)}<div class="muted">${escapeHtml([s.groupName, s.teacher].filter(Boolean).join(' · '))}</div></th>${cells}<td class="num">${abs}</td></tr>`;
    })
    .join('');
  const notes = r.subjects.flatMap((s) => s.grades.filter((g) => g.comment).map((g) => `<li><strong>${escapeHtml(s.subject)} (${escapeHtml(termName(g.term))}):</strong> ${escapeHtml(g.comment ?? '')}</li>`)).join('');
  return `<h1>Boletín de notas</h1>
<p><strong>${escapeHtml(fullName(r.student))}</strong>${r.year ? ` · Curso ${escapeHtml(r.year.name)}` : ''}${r.student.instrument ? ` · ${escapeHtml(r.student.instrument)}` : ''}</p>
<table><thead><tr><th>Asignatura</th>${[1, 2, 3, 4].map((t) => `<th class="num">${escapeHtml(termName(t))}</th>`).join('')}<th class="num">Faltas</th></tr></thead><tbody>${rows || '<tr><td colspan="6">Sin asignaturas en este curso.</td></tr>'}</tbody></table>
${notes ? `<h2>Observaciones</h2><ul>${notes}</ul>` : ''}`;
}

/** Boletín imprimible: al imprimir sólo se muestra esta sección. */
function ReportCardSection({ studentId }: { studentId: string }) {
  const { session } = useAuth();
  const years = useApi<SchoolYear[]>('/school/years');
  const [yearId, setYearId] = useState('');
  const q = useApi<ReportCard>(`/school/students/${studentId}/report-card`, { yearId: yearId || undefined });
  const r = q.data;
  return (
    <Card
      title="Boletín de notas"
      actions={
        <>
          <SelectField label="Curso" value={yearId || r?.year?.id || ''} onChange={(e) => setYearId(e.target.value)} options={(years.data ?? []).map((y) => ({ value: y.id, label: y.name }))} />
          <Button variant="ghost" size="sm" disabled={!r} onClick={() => r && printDocument(`Boletín · ${fullName(r.student)}`, reportCardHtml(r), brandOf(session))}>
            Imprimir boletín
          </Button>
        </>
      }
    >
      {q.isLoading && <Loading rows={3} />}
      {r && (
        <div className="report-card">
          <h3>{r.tenant?.name} · Escuela de música</h3>
          <p>
            <strong>{fullName(r.student)}</strong>
            {r.year && ` · Curso ${r.year.name}`}
            {r.student.instrument && ` · ${r.student.instrument}`}
          </p>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Notas por asignatura y trimestre</caption>
              <thead>
                <tr>
                  <th scope="col">Asignatura</th>
                  {[1, 2, 3, 4].map((t) => (
                    <th key={t} scope="col" className="num">
                      {termName(t)}
                    </th>
                  ))}
                  <th scope="col" className="num">
                    Faltas
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.subjects.map((s) => (
                  <tr key={s.enrollmentId}>
                    <th scope="row">
                      {s.subject}
                      <div className="small muted">
                        {s.groupName}
                        {s.teacher && ` · ${s.teacher}`}
                      </div>
                    </th>
                    {[1, 2, 3, 4].map((t) => {
                      const g = s.grades.find((x) => x.term === t);
                      return (
                        <td key={t} className="num">
                          {g ? [g.scoreTenths != null ? score(g.scoreTenths) : null, g.qualitative].filter(Boolean).join(' · ') || '—' : '—'}
                        </td>
                      );
                    })}
                    <td className="num">{(s.attendance.ABSENT ?? 0) + (s.attendance.EXCUSED ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {r.subjects.some((s) => s.grades.some((g) => g.comment)) && (
            <ul className="list-plain">
              {r.subjects.flatMap((s) => s.grades.filter((g) => g.comment).map((g) => <li key={`${s.enrollmentId}-${g.term}`} className="small"><strong>{s.subject} ({termName(g.term)}):</strong> {g.comment}</li>))}
            </ul>
          )}
          {r.subjects.length === 0 && <p className="muted">Sin asignaturas en este curso.</p>}
        </div>
      )}
    </Card>
  );
}

export default function StudentDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const q = useApi<StudentDetail>(`/school/students/${id}`);
  const [editing, setEditing] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [grading, setGrading] = useState<{ enrollment: Enr; term: number } | null>(null);
  const s = q.data;

  if (q.isLoading) return <Loading />;
  if (q.error || !s) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />;

  const active = s.enrollments.filter((e) => e.status !== 'WITHDRAWN');
  const totalSessions = Object.values(s.attendanceSummary).reduce((a, b) => a + (b ?? 0), 0);
  return (
    <Page
      header={
        <PageHeader
          eyebrow="Escuela"
          title={fullName(s)}
          description={
            <>
              <StatusChip value={s.status} map={studentStatus} /> <StatusChip value={s.bandStage} map={bandStage} />
            </>
          }
          actions={
            <>
              {can('school:write') && (
                <Button variant="ghost" onClick={() => setEditing(true)}>
                  Editar
                </Button>
              )}
              {can('school:write') && can('members:write') && s.bandStage !== 'MUSICIAN' && <Button onClick={() => setPromoting(true)}>Paso a la banda</Button>}
            </>
          }
        />
      }
    >
      <div className="stack" style={{ gap: 24 }}>
        <div className="grid grid--stats">
          <StatCard label="Grupos" value={active.length} tone="cool" />
          <StatCard label="Asistencias" value={(s.attendanceSummary.PRESENT ?? 0) + (s.attendanceSummary.LATE ?? 0)} hint={`de ${totalSessions} clases registradas`} />
          <StatCard label="Faltas" value={(s.attendanceSummary.ABSENT ?? 0) + (s.attendanceSummary.EXCUSED ?? 0)} hint={`${s.attendanceSummary.EXCUSED ?? 0} justificadas`} tone="cream" />
        </div>
        <div className="grid grid--2">
          <Card title="Datos del alumno">
            <dl className="kv">
              <dt>Nacimiento</dt>
              <dd>{date(s.birthDate)}</dd>
              <dt>Instrumento</dt>
              <dd>{s.instrument ?? '—'}</dd>
              <dt>Contacto</dt>
              <dd>{[s.email, s.phone].filter(Boolean).join(' · ') || '—'}</dd>
              <dt>Imagen</dt>
              <dd>{s.imageConsent ? 'Autoriza' : 'No autoriza'}</dd>
              <dt>Recogida</dt>
              <dd>{s.pickupAuthorized.length ? s.pickupAuthorized.join(', ') : '—'}</dd>
              <dt>Socio</dt>
              <dd>{s.member ? <Link to={`/members/${s.member.id}`}>Nº {s.member.memberNumber}</Link> : '—'}</dd>
              {s.tuitionTariff && (
                <>
                  <dt>Tarifa</dt>
                  <dd>{s.tuitionTariff.name} · {money(s.tuitionTariff.monthlyCents)}/mes</dd>
                </>
              )}
              {s.notes && (
                <>
                  <dt>Observaciones</dt>
                  <dd>{s.notes}</dd>
                </>
              )}
            </dl>
          </Card>
          <Card title={s.family ? s.family.name : 'Familia'}>
            {!s.family && <p className="muted">Sin familia asignada.</p>}
            {s.family && (
              <ul className="list-plain list-divided">
                {s.family.guardians.map((g) => (
                  <li key={g.id}>
                    <strong>{fullName(g)}</strong>
                    {g.relationship && <span className="muted"> · {g.relationship}</span>}
                    <div className="small">{[g.email, g.phone].filter(Boolean).join(' · ') || 'Sin contacto'}</div>
                    {g.memberId && <Chip tone="info">Socio</Chip>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card title="Matrículas y notas">
          <DataTable
            caption="Matrículas del alumno"
            rows={s.enrollments}
            rowKey={(e) => e.id}
            empty="Sin matrículas."
            columns={[
              { key: 'g', header: 'Grupo', render: (e) => <span>{groupLabel(e.group)}<div className="small muted">{e.group.year.name}{e.group.slots.length ? ` · ${e.group.slots.map(slotText).join('; ')}` : ''}</div></span> },
              { key: 's', header: 'Estado', render: (e) => <StatusChip value={e.status} map={enrollmentStatus} /> },
              ...[1, 2, 3, 4].map((t) => ({
                key: `t${t}`,
                header: termName(t),
                nowrap: true,
                render: (e: Enr) => {
                  const g = e.grades.find((x) => x.term === t);
                  const text = g ? [g.scoreTenths != null ? score(g.scoreTenths) : null, g.qualitative].filter(Boolean).join(' · ') || '—' : '—';
                  return can('school:teach') && e.status === 'ACTIVE' ? (
                    <button className="link-arrow" onClick={() => setGrading({ enrollment: e, term: t })} aria-label={`Editar nota de ${e.group.subject.name}, ${termName(t)}`}>
                      {text}
                    </button>
                  ) : (
                    text
                  );
                },
              })),
            ]}
          />
        </Card>
        <ReportCardSection studentId={s.id} />
        {s.charges && (
          <Card title="Mensualidades">
            <DataTable
              caption="Mensualidades del alumno"
              rows={s.charges}
              rowKey={(c) => c.id}
              empty="Sin mensualidades emitidas."
              columns={[
                { key: 'p', header: 'Mes', render: (c) => c.period, nowrap: true },
                { key: 'a', header: 'Importe', render: (c) => money(c.amountCents), numeric: true, nowrap: true },
                { key: 's', header: 'Estado', render: (c) => <StatusChip value={c.status} map={tuitionStatus} /> },
              ]}
            />
          </Card>
        )}
        {Object.keys(s.attendanceSummary).length > 0 && (
          <Card title="Resumen de asistencia">
            <p className="chips">
              {Object.entries(s.attendanceSummary).map(([k, n]) => (
                <Chip key={k} tone={attendanceStatus[k]?.tone}>
                  {attendanceStatus[k]?.label ?? k}: {n}
                </Chip>
              ))}
            </p>
          </Card>
        )}
      </div>
      <StudentFormModal open={editing} student={s} onClose={() => setEditing(false)} />
      <PromoteModal student={s} open={promoting} onClose={() => setPromoting(false)} />
      <GradeModal target={grading} onClose={() => setGrading(null)} />
    </Page>
  );
}
