import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../../api/hooks';
import type { SchoolOverview, SchoolYear } from '../../api/types-school';
import { useAuth } from '../../auth/AuthProvider';
import { money } from '../../lib/format';
import { hhmm, sessionStatus } from '../../lib/labels-school';
import { Button, ButtonLink } from '../Button';
import { Card, StatCard } from '../Card';
import { StatusChip } from '../Chip';
import { EmptyState, ErrorNote, Loading } from '../EmptyState';
import { Icon } from '../Icon';
import { AttendanceModal } from './ClassesTab';
import { groupLabel, useSchoolYears, YearSelect } from './common';
import { ImportModal } from './ImportModal';
import { StudentFormModal } from './StudentsTab';
import { YearWizard } from './YearWizard';

const monthName = (period: string) => new Date(`${period}-01T00:00:00Z`).toLocaleDateString('es-ES', { month: 'long', timeZone: 'UTC' });

/** Lista de puesta en marcha: cada paso enlaza a donde se hace. */
function Checklist({ items }: { items: SchoolOverview['checklist'] }) {
  const done = items.filter((i) => i.done).length;
  return (
    <Card title="Pon la escuela en marcha" tone="cream">
      <p className="small">
        {done} de {items.length} pasos hechos. Se marcan solos cuando la escuela ya los tiene.
      </p>
      <p className="setup-progress" aria-label={`${done} de ${items.length} completados`}>
        <span style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} />
      </p>
      <ol className="setup-steps">
        {items.map((step, i) => (
          <li key={step.id} className={step.done ? 'setup-step setup-step--done' : 'setup-step'}>
            <span className="setup-step__mark" aria-hidden="true">
              {step.done ? <Icon name="check" size={14} /> : i + 1}
            </span>
            <div>
              <p className="setup-step__title">{step.title}</p>
              <p className="small muted">{step.detail}</p>
            </div>
            {step.done ? <span className="small muted">Hecho</span> : <Link to={`/school${step.to}`}>Ir</Link>}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Alerts({ o }: { o: SchoolOverview }) {
  const c = o.counts;
  const items = [
    c.conflicts > 0 && { text: `${c.conflicts} conflicto(s) de horario`, to: '/school?tab=groups' },
    c.withoutSlots > 0 && c.groups > 0 && { text: `${c.withoutSlots} grupo(s) sin horario: no tendrán clases`, to: '/school?tab=groups' },
    c.withoutTeacher > 0 && { text: `${c.withoutTeacher} grupo(s) sin profesor`, to: '/school?tab=groups' },
    o.tuition && o.tuition.overdueCount > 0 && { text: `${o.tuition.overdueCount} mensualidad(es) vencida(s) por ${money(o.tuition.overdueCents)}`, to: '/school?tab=tuition' },
    c.pendingJustifications > 0 && { text: `${c.pendingJustifications} falta(s) justificada(s) por las familias pendientes de revisar`, to: '/school?tab=classes' },
    c.guardiansWithoutPortal > 0 && { text: `${c.guardiansWithoutPortal} tutor(es) sin acceso al portal de familias`, to: '/school?tab=families' },
  ].filter((x): x is { text: string; to: string } => !!x);
  if (!items.length) return null;
  return (
    <div className="callout callout--danger" role="status">
      <ul className="list-plain stack" style={{ gap: 4 }}>
        {items.map((i) => (
          <li key={i.text}>
            <Link to={i.to}>{i.text}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TuitionCard({ t }: { t: NonNullable<SchoolOverview['tuition']> }) {
  return (
    <Card title={`Mensualidades de ${monthName(t.period)}`} actions={<ButtonLink to="/school?tab=tuition" size="sm" variant="ghost">Ver mensualidades</ButtonLink>}>
      <div className="stack" style={{ gap: 8 }}>
        {t.issuedCount > 0 ? (
          <p>
            Emitidas: <strong>{t.issuedCount}</strong> por <strong>{money(t.issuedCents)}</strong>.
          </p>
        ) : (
          <p>
            Aún no se han emitido.{' '}
            {t.autoIssueDay ? `Se emitirán solas el día ${t.autoIssueDay}.` : <Link to="/school?tab=tuition">Emitir ahora</Link>}
          </p>
        )}
        <p>
          Pendiente de cobro: <strong>{money(t.pendingCents)}</strong> ({t.pendingCount}){t.overdueCount > 0 && <>, de ello vencido {money(t.overdueCents)}</>}.
        </p>
        {!t.autoIssueDay && (
          <p className="small muted">
            <Link to="/school?tab=settings&section=cobro">Programa la emisión</Link> para no tener que hacerlo cada mes.
          </p>
        )}
      </div>
    </Card>
  );
}

function TodayCard({ sessions, teach }: { sessions: SchoolOverview['today']; teach: boolean }) {
  const [taking, setTaking] = useState<string | null>(null);
  return (
    <Card title="Clases de hoy">
      {sessions.length === 0 ? (
        <p className="muted">No hay clases hoy.</p>
      ) : (
        <ul className="list-plain list-divided">
          {sessions.map((s) => (
            <li key={s.id} className="row between" style={{ gap: 12 }}>
              <span>
                <strong className="mono small">
                  {hhmm(s.startMin)}–{hhmm(s.endMin)}
                </strong>{' '}
                {groupLabel(s.group)} <StatusChip value={s.status} map={sessionStatus} />
              </span>
              {teach && s.status !== 'CANCELLED' && (
                <Button size="sm" variant={s._count?.attendance ? 'ghost' : 'primary'} onClick={() => setTaking(s.id)}>
                  {s._count?.attendance ? 'Revisar lista' : 'Pasar lista'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <AttendanceModal sessionId={taking} onClose={() => setTaking(null)} />
    </Card>
  );
}

export function OverviewTab() {
  const { can } = useAuth();
  const write = can('school:write');
  const { years, yearId, setYearId, isLoading } = useSchoolYears();
  // Espera a saber el curso elegido para no pedir el panel dos veces (y no parpadear).
  const ready = !isLoading && (years.length === 0 || !!yearId);
  const q = useApi<SchoolOverview>(ready ? '/school/overview' : null, { yearId: yearId || undefined });
  const [wizard, setWizard] = useState(false);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  if (!ready || q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const o = q.data!;
  const c = o.counts;
  const pending = o.checklist.filter((i) => !i.done);

  if (!o.hasYears) {
    return (
      <>
        <EmptyState
          title="Empieza por el curso escolar"
          icon="school"
          action={write && <Button onClick={() => setWizard(true)}>Crear el primer curso</Button>}
        >
          {write ? 'El asistente te pide las fechas y los festivos. Después añadirás asignaturas, profesorado y grupos; aquí verás qué falta.' : 'La escuela aún no tiene cursos.'}
        </EmptyState>
        {o.checklist.length > 0 && <Checklist items={o.checklist} />}
        {wizard && <YearWizard open years={[] as SchoolYear[]} onClose={() => setWizard(false)} />}
      </>
    );
  }

  return (
    <div className="stack" style={{ gap: 24 }}>
      <Card>
        <div className="toolbar">
          <YearSelect years={years} value={yearId} onChange={setYearId} />
          {write && (
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <Button variant="ghost" onClick={() => setCreating(true)}>
                Nuevo alumno
              </Button>
              <Button variant="ghost" onClick={() => setImporting(true)}>
                Importar alumnos
              </Button>
              <Button variant="ghost" onClick={() => setWizard(true)}>
                Nuevo curso
              </Button>
            </div>
          )}
        </div>
      </Card>
      {pending.length > 0 && <Checklist items={o.checklist} />}
      <Alerts o={o} />
      <section aria-label="Indicadores de la escuela" className="grid grid--stats">
        <StatCard label="Alumnos activos" value={c.students} hint={`${c.families} familias`} icon="users" />
        <StatCard
          label="Plazas ocupadas"
          value={c.capacity ? `${c.occupied} / ${c.capacity}` : c.occupied}
          meter={c.capacity ? c.occupied / c.capacity : undefined}
          hint={c.waitlist ? `${c.waitlist} en lista de espera` : `${c.groups} grupos`}
          hintTone={c.waitlist ? 'warning' : undefined}
          icon="school"
          iconColor="green"
        />
        <StatCard
          label="Solicitudes pendientes"
          value={c.pendingApplications}
          hint={write && c.pendingApplications > 0 ? <Link to="/school?tab=applications">Revisarlas</Link> : o.year?.enrollmentOpen ? 'Matrícula abierta' : 'Matrícula cerrada'}
          icon="inbox"
          iconColor="amber"
        />
        <StatCard label="Profesorado" value={c.teachers} hint={`${c.subjects} asignaturas`} icon="user" iconColor="slate" />
      </section>
      <div className="grid grid--2">
        <TodayCard sessions={o.today} teach={can('school:teach')} />
        {o.tuition && <TuitionCard t={o.tuition} />}
      </div>
      {wizard && <YearWizard open years={years} onClose={() => setWizard(false)} />}
      <StudentFormModal open={creating} onClose={() => setCreating(false)} />
      {importing && <ImportModal onClose={() => setImporting(false)} />}
    </div>
  );
}
