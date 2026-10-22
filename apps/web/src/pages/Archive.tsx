import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { patch, post } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import type { Composer, Paginated, Work } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { ArrowLink, Button } from '../components/Button';
import { BookletsTab } from '../components/archive/Booklets';
import { ScoreLoansPanel } from '../components/archive/ScoreLoans';
import { SgaeReportTab } from '../components/archive/SgaeReport';
import { Card } from '../components/Card';
import { Tag } from '../components/Chip';
import { Pagination } from '../components/DataTable';
import { EmptyState, ErrorNote, Loading } from '../components/EmptyState';
import { FormError, SelectField, TextAreaField, TextField, formValues } from '../components/Field';
import { Modal } from '../components/Modal';
import { Page, PageHeader } from '../components/PageHeader';
import { Tabs } from '../components/Tabs';
import { duration } from '../lib/format';

export const GENRES = ['Pasodoble', 'Marcha procesional', 'Marcha mora', 'Marcha cristiana', 'Concierto', 'Zarzuela', 'Bandas sonoras', 'Himno', 'Pop / arreglo', 'Otro'];

function parseDuration(v?: string) {
  if (!v) return null;
  const [m, s] = v.split(':').map((x) => Number(x));
  if (!Number.isFinite(m)) return null;
  return m * 60 + (Number.isFinite(s) ? s : 0);
}

export function WorkFormModal({ open, onClose, work }: { open: boolean; onClose: () => void; work?: Work | null }) {
  const navigate = useNavigate();
  const composers = useApi<Composer[]>('/composers');
  const [newComposer, setNewComposer] = useState(false);
  const save = useApiMutation(
    async (v: Record<string, string | undefined>) => {
      let composerId = v.composerId ?? null;
      if (newComposer && v.newComposer) {
        const c = await post<Composer>('/composers', { name: v.newComposer });
        composerId = c.id;
      }
      const body = {
        title: v.title,
        subtitle: v.subtitle ?? null,
        composerId,
        arranger: v.arranger ?? null,
        genre: v.genre ?? null,
        durationSec: parseDuration(v.duration),
        difficulty: v.difficulty ? Number(v.difficulty) : null,
        year: v.year ? Number(v.year) : null,
        publisher: v.publisher ?? null,
        catalogCode: v.catalogCode ?? null,
        tags: (v.tags ?? '')
          .split(',')
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean),
        notes: v.notes ?? null,
      };
      return work ? patch<Work>(`/works/${work.id}`, body) : post<Work>('/works', body);
    },
    {
      success: work ? 'Obra actualizada' : 'Obra creada',
      invalidate: ['/works', '/tags', '/composers'],
      onSuccess: (w) => {
        onClose();
        if (!work) navigate(`/archive/${w.id}`);
      },
    },
  );

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    save.mutate(formValues(e.currentTarget));
  }

  return (
    <Modal open={open} onClose={onClose} title={work ? 'Editar obra' : 'Nueva obra'}>
      <form className="form" onSubmit={submit} key={work?.id ?? 'new'}>
        <TextField label="Título" name="title" required defaultValue={work?.title} />
        <TextField label="Subtítulo" name="subtitle" defaultValue={work?.subtitle ?? ''} />
        <div className="form-row">
          {newComposer ? (
            <TextField label="Nuevo compositor" name="newComposer" required />
          ) : (
            <SelectField
              label="Compositor"
              name="composerId"
              defaultValue={work?.composerId ?? ''}
              placeholder="Sin especificar"
              options={(composers.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
            />
          )}
          <TextField label="Arreglista" name="arranger" defaultValue={work?.arranger ?? ''} />
        </div>
        <button type="button" className="link-arrow small" onClick={() => setNewComposer((x) => !x)}>
          {newComposer ? 'Elegir compositor existente' : 'Añadir compositor nuevo'}
        </button>
        <div className="form-row">
          <SelectField label="Género" name="genre" defaultValue={work?.genre ?? ''} placeholder="—" options={GENRES.map((g) => ({ value: g, label: g }))} />
          <TextField label="Duración (mm:ss)" name="duration" pattern="\d{1,3}(:\d{1,2})?" defaultValue={work?.durationSec ? duration(work.durationSec) : ''} />
          <SelectField
            label="Dificultad"
            name="difficulty"
            defaultValue={work?.difficulty ? String(work.difficulty) : ''}
            placeholder="—"
            options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: `Grado ${n}` }))}
          />
        </div>
        <div className="form-row">
          <TextField label="Año" name="year" type="number" min={1500} max={2100} defaultValue={work?.year ?? ''} />
          <TextField label="Editorial" name="publisher" defaultValue={work?.publisher ?? ''} />
          <TextField label="Signatura" name="catalogCode" defaultValue={work?.catalogCode ?? ''} />
        </div>
        <TextField label="Etiquetas" name="tags" defaultValue={work?.tags.join(', ') ?? ''} hint="Separadas por comas: semana santa, fiestas, concierto…" />
        <TextAreaField label="Notas" name="notes" defaultValue={work?.notes ?? ''} />
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

function WorksTab({ onCreate }: { onCreate: () => void }) {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const tag = params.get('tag') ?? '';
  const genre = params.get('genre') ?? '';
  const composerId = params.get('composerId') ?? '';
  const page = Number(params.get('page') ?? 1);
  const works = useApi<Paginated<Work>>('/works', { q: params.get('q'), tag, genre, composerId, page, pageSize: 24 });
  const tags = useApi<{ tag: string; count: number }[]>('/tags');
  const composers = useApi<Composer[]>('/composers');

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  return (
    <div className="stack">
      <Card>
        <form
          className="toolbar"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            set('q', q);
          }}
        >
          <TextField label="Buscar" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Título, compositor, etiqueta… (sin importar tildes)" />
          <SelectField label="Género" value={genre} onChange={(e) => set('genre', e.target.value)} placeholder="Todos" options={GENRES.map((g) => ({ value: g, label: g }))} />
          <SelectField
            label="Compositor"
            value={composerId}
            onChange={(e) => set('composerId', e.target.value)}
            placeholder="Todos"
            options={(composers.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
          <Button type="submit" variant="ghost">
            Buscar
          </Button>
        </form>
        {tags.data && tags.data.length > 0 && (
          <div className="chips" style={{ marginTop: 16 }} role="group" aria-label="Filtrar por etiqueta">
            {tags.data.slice(0, 24).map((t) => (
              <button key={t.tag} className="chip chip--plain chip--outline" aria-pressed={tag === t.tag} onClick={() => set('tag', tag === t.tag ? '' : t.tag)}>
                {t.tag} · {t.count}
              </button>
            ))}
          </div>
        )}
      </Card>

      {works.isLoading && <Loading />}
      {works.error && <ErrorNote error={works.error} />}
      {works.data &&
        (works.data.data.length === 0 ? (
          <EmptyState title="No hay obras" action={can('archive:write') ? <Button onClick={onCreate}>Añadir la primera</Button> : undefined}>
            Prueba con otra búsqueda o quita los filtros.
          </EmptyState>
        ) : (
          <>
            <p className="small muted" aria-live="polite">
              {works.data.total} obras
            </p>
            <ul className="grid list-plain">
              {works.data.data.map((w) => (
                <li key={w.id} className="card stack">
                  <div>
                    <h2 className="card__title">
                      <ArrowLink to={`/archive/${w.id}`}>{w.title}</ArrowLink>
                    </h2>
                    {w.subtitle && <p className="small muted">{w.subtitle}</p>}
                  </div>
                  <p className="small">
                    {w.composer?.name ?? 'Compositor desconocido'}
                    {w.arranger ? ` · arr. ${w.arranger}` : ''}
                  </p>
                  <div className="chips">
                    {w.genre && <span className="chip chip--info chip--plain">{w.genre}</span>}
                    {w.durationSec ? <span className="chip chip--plain">{duration(w.durationSec)}</span> : null}
                    {w.difficulty ? <span className="chip chip--plain">Grado {w.difficulty}</span> : null}
                    {w.tags.slice(0, 3).map((t) => (
                      <Tag key={t}>{t}</Tag>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            <Pagination page={works.data.page} pageSize={works.data.pageSize} total={works.data.total} onPage={(p) => set('page', String(p))} />
          </>
        ))}
    </div>
  );
}

export default function ArchivePage() {
  const { can } = useAuth();
  const [params] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const tabs = [
    { id: 'works', label: 'Obras', content: <WorksTab onCreate={() => setCreating(true)} /> },
    ...(can('events:read') ? [{ id: 'sgae', label: 'Informe SGAE', content: <SgaeReportTab /> }] : []),
    { id: 'booklets', label: 'Libretos', content: <BookletsTab /> },
    { id: 'loans', label: 'Préstamos', content: <ScoreLoansPanel /> },
  ];
  const initial = tabs.some((t) => t.id === params.get('tab')) ? params.get('tab')! : undefined;

  return (
    <Page
      header={
        <PageHeader
          eyebrow="Archivo musical"
          title="Obras"
          description="Partituras, particellas, audios y versiones de todo el repertorio."
          actions={can('archive:write') && <Button onClick={() => setCreating(true)}>Nueva obra</Button>}
        />
      }
    >
      <Tabs label="Secciones del archivo" tabs={tabs} initial={initial} />
      <WorkFormModal open={creating} onClose={() => setCreating(false)} />
    </Page>
  );
}
