import { useApi } from '../api/hooks';
import { ApiError } from '../api/client';
import type { FamilyPortalData } from '../api/types-school';
import { Card } from '../components/Card';
import { Chip, StatusChip } from '../components/Chip';
import { DataTable } from '../components/DataTable';
import { EmptyState, ErrorNote, Loading } from '../components/EmptyState';
import { Page, PageHeader } from '../components/PageHeader';
import { slotText } from '../components/school/common';
import { date, dateTime, fullName, money } from '../lib/format';
import { attendanceStatus } from '../lib/labels';
import { enrollmentStatus, score, termName, tuitionStatus } from '../lib/labels-school';

export default function FamilyPortalPage() {
  const q = useApi<FamilyPortalData>('/school/family');
  const header = <PageHeader title="Portal de familias" description="Horarios, faltas, notas, mensualidades y avisos de la escuela de música." />;
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

  return (
    <Page header={header}>
      <div className="stack" style={{ gap: 24 }}>
        <p>
          Hola, <strong>{d.guardian.firstName}</strong>. {d.family.name}
        </p>
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
                { key: 'st', header: 'Tipo', render: (a) => <StatusChip value={a.status} map={attendanceStatus} /> },
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
                { key: 'st', header: 'Estado', render: (c) => <StatusChip value={c.status} map={tuitionStatus} /> },
              ]}
            />
          </Card>
        </div>
      </div>
    </Page>
  );
}
