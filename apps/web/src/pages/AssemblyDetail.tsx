import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { del, patch, post } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import type { AgendaItem, AssemblyDetail } from '../api/types-governance';
import { useAuth } from '../auth/AuthProvider';
import { ArrowLink, Button } from '../components/Button';
import { Card } from '../components/Card';
import { StatusChip } from '../components/Chip';
import { ErrorNote, Loading } from '../components/EmptyState';
import { FormError } from '../components/Field';
import { AssemblyFormModal } from '../components/governance/AssembliesTab';
import { AttendancePanel } from '../components/governance/AttendancePanel';
import { MinutesPanel } from '../components/governance/MinutesPanel';
import { MotionsPanel } from '../components/governance/MotionsPanel';
import { ConfirmModal } from '../components/Modal';
import { Page, PageHeader } from '../components/PageHeader';
import { Tabs } from '../components/Tabs';
import { dateTime } from '../lib/format';
import { assemblyStatus, assemblyType } from '../lib/labels-governance';

function AgendaEditor({ assembly, editable }: { assembly: AssemblyDetail; editable: boolean }) {
  const [items, setItems] = useState<AgendaItem[]>(assembly.agenda);
  useEffect(() => setItems(assembly.agenda), [assembly.agenda]);
  const save = useApiMutation(() => patch(`/governance/assemblies/${assembly.id}`, { agenda: items.filter((i) => i.title.trim()) }), {
    success: 'Orden del día guardado',
    invalidate: [`/governance/assemblies/${assembly.id}`],
  });
  const set = (i: number, k: keyof AgendaItem, v: string) => setItems((s) => s.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const move = (i: number, d: number) =>
    setItems((s) => {
      const j = i + d;
      if (j < 0 || j >= s.length) return s;
      const next = [...s];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  if (!editable) {
    return items.length === 0 ? (
      <p className="muted">Sin puntos en el orden del día.</p>
    ) : (
      <ol className="list-divided" style={{ paddingLeft: 20 }}>
        {items.map((p, i) => (
          <li key={i}>
            <strong>{p.title}</strong>
            {p.description && <p className="small muted">{p.description}</p>}
          </li>
        ))}
      </ol>
    );
  }
  return (
    <div className="stack">
      <ol className="stack" style={{ paddingLeft: 20 }}>
        {items.map((p, i) => (
          <li key={i}>
            <div className="stack" style={{ gap: 6 }}>
              <input className="input" value={p.title} onChange={(e) => set(i, 'title', e.target.value)} aria-label={`Punto ${i + 1}: título`} placeholder="Título del punto" />
              <textarea className="textarea" style={{ minHeight: 56 }} value={p.description ?? ''} onChange={(e) => set(i, 'description', e.target.value)} aria-label={`Punto ${i + 1}: descripción`} placeholder="Descripción (opcional)" />
              <div className="row">
                <Button size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Subir punto ${i + 1}`}>
                  ↑
                </Button>
                <Button size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label={`Bajar punto ${i + 1}`}>
                  ↓
                </Button>
                <Button size="sm" variant="danger" onClick={() => setItems((s) => s.filter((_, j) => j !== i))} aria-label={`Quitar punto ${i + 1}`}>
                  Quitar
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <FormError error={save.error} />
      <div className="row">
        <Button size="sm" variant="ghost" onClick={() => setItems((s) => [...s, { title: '', description: '' }])}>
          Añadir punto
        </Button>
        <Button size="sm" onClick={() => save.mutate(undefined)} loading={save.isPending}>
          Guardar orden del día
        </Button>
      </div>
    </div>
  );
}

export default function AssemblyDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const write = can('governance:write');
  const q = useApi<AssemblyDetail>(`/governance/assemblies/${id}`);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<'convene' | 'hold' | 'close' | 'delete' | null>(null);
  const inv = { invalidate: [`/governance/assemblies`], onSuccess: () => setConfirm(null) };
  const convene = useApiMutation(() => post(`/governance/assemblies/${id}/convene`), { success: 'Asamblea convocada y socios avisados', ...inv });
  const hold = useApiMutation(() => post(`/governance/assemblies/${id}/hold`), { success: 'Asamblea en curso', ...inv });
  const close = useApiMutation(() => post(`/governance/assemblies/${id}/close`), { success: 'Asamblea cerrada', ...inv });
  const remove = useApiMutation(() => del(`/governance/assemblies/${id}`), { success: 'Asamblea eliminada', invalidate: ['/governance/assemblies'], onSuccess: () => navigate('/governance') });

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorNote error={q.error} />;
  const a = q.data;
  const editable = write && (a.status === 'DRAFT' || a.status === 'CONVENED');
  const confirms = {
    convene: { title: 'Convocar asamblea', message: 'Se avisará por correo y en la aplicación a todos los socios activos con las fechas y el orden del día.', label: 'Convocar', m: convene },
    hold: { title: 'Iniciar asamblea', message: 'Tras iniciarla ya no se podrán cambiar la convocatoria ni el orden del día.', label: 'Iniciar', m: hold },
    close: { title: 'Cerrar asamblea', message: 'Se cerrarán las votaciones que sigan abiertas.', label: 'Cerrar', m: close },
    delete: { title: 'Eliminar asamblea', message: `¿Eliminar «${a.title}»?`, label: 'Eliminar', m: remove },
  };
  const c = confirm ? confirms[confirm] : null;

  return (
    <Page
      header={
        <PageHeader
          eyebrow="Gobierno"
          title={a.title}
          description={
            <>
              Asamblea {assemblyType[a.type].toLowerCase()} · 1.ª convocatoria {dateTime(a.firstCallAt)}
              {a.secondCallAt && ` · 2.ª convocatoria ${dateTime(a.secondCallAt)}`}
              {a.location && ` · ${a.location}`}
            </>
          }
          actions={
            write && (
              <>
                {editable && (
                  <Button variant="ghost" onClick={() => setEditing(true)}>
                    Editar
                  </Button>
                )}
                {a.status === 'DRAFT' && (
                  <Button variant="ghost" onClick={() => setConfirm('delete')}>
                    Eliminar
                  </Button>
                )}
                {a.status === 'DRAFT' && <Button onClick={() => setConfirm('convene')}>Convocar</Button>}
                {a.status === 'CONVENED' && <Button onClick={() => setConfirm('hold')}>Iniciar asamblea</Button>}
                {a.status === 'HELD' && <Button onClick={() => setConfirm('close')}>Cerrar asamblea</Button>}
              </>
            )
          }
        />
      }
    >
      <div className="stack" style={{ gap: 24 }}>
        <div className="row between">
          <ArrowLink to="/governance">Volver a gobierno</ArrowLink>
          <StatusChip value={a.status} map={assemblyStatus} />
        </div>
        <Card title="Orden del día">
          <AgendaEditor assembly={a} editable={editable} />
        </Card>
        <Tabs
          label="Secciones de la asamblea"
          tabs={[
            { id: 'attendance', label: 'Asistencia y quórum', content: <AttendancePanel assembly={a} /> },
            { id: 'motions', label: `Votaciones (${a.motions.length})`, content: <MotionsPanel assembly={a} /> },
            { id: 'minutes', label: 'Acta', content: <MinutesPanel assembly={a} /> },
          ]}
        />
      </div>
      {write && <AssemblyFormModal open={editing} onClose={() => setEditing(false)} assembly={a} />}
      <ConfirmModal
        open={!!c}
        title={c?.title ?? ''}
        message={c?.message}
        confirmLabel={c?.label}
        loading={c?.m.isPending}
        onConfirm={() => c?.m.mutate(undefined)}
        onClose={() => setConfirm(null)}
      />
    </Page>
  );
}
