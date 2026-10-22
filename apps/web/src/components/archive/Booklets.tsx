import { useEffect, useState } from 'react';
import { del, downloadFile, patch, post, put, withQuery } from '../../api/client';
import { useApi, useApiMutation } from '../../api/hooks';
import type { Booklet, BookletDetail, BookletInstrument } from '../../api/types-archive';
import { useAuth } from '../../auth/AuthProvider';
import { Button } from '../Button';
import { Card } from '../Card';
import { EmptyState, ErrorNote, Loading } from '../EmptyState';
import { FormError, SelectField, TextAreaField, TextField, formValues } from '../Field';
import { ConfirmModal, Modal } from '../Modal';
import { useToast } from '../Toasts';
import { WorkPicker } from './WorkPicker';

interface DraftItem {
  workId: string;
  title: string;
  composer?: string | null;
  label: string;
}

function BookletFormModal({ open, onClose, booklet, onSaved }: { open: boolean; onClose: () => void; booklet?: Booklet | null; onSaved?: (b: Booklet) => void }) {
  const save = useApiMutation(
    (v: Record<string, string | undefined>) => {
      const body = { name: v.name, description: v.description ?? null };
      return booklet ? patch<Booklet>(`/booklets/${booklet.id}`, body) : post<Booklet>('/booklets', body);
    },
    {
      success: booklet ? 'Libreto actualizado' : 'Libreto creado',
      invalidate: ['/booklets'],
      onSuccess: (b) => {
        onClose();
        onSaved?.(b);
      },
    },
  );
  return (
    <Modal open={open} onClose={onClose} title={booklet ? 'Editar libreto' : 'Nuevo libreto'}>
      <form
        className="form"
        key={booklet?.id ?? 'new'}
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(formValues(e.currentTarget));
        }}
      >
        <TextField label="Nombre" name="name" required maxLength={120} defaultValue={booklet?.name} placeholder="Libreto de Semana Santa" />
        <TextAreaField label="Descripción" name="description" defaultValue={booklet?.description ?? ''} />
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

function BookletEditor({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const write = can('archive:write');
  const booklet = useApi<BookletDetail>(`/booklets/${id}`);
  const instruments = useApi<BookletInstrument[]>(`/booklets/${id}/instruments`);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [dirty, setDirty] = useState(false);
  const [adding, setAdding] = useState('');
  const [instrument, setInstrument] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!booklet.data) return;
    setItems(booklet.data.items.map((i) => ({ workId: i.workId, title: i.work.title, composer: i.work.composer?.name, label: i.label ?? '' })));
    setDirty(false);
  }, [booklet.data]);

  const save = useApiMutation(() => put<BookletDetail>(`/booklets/${id}/items`, items.map((i) => ({ workId: i.workId, label: i.label.trim() || null }))), {
    success: 'Libreto guardado',
    invalidate: ['/booklets'],
  });
  const remove = useApiMutation(() => del(`/booklets/${id}`), { success: 'Libreto eliminado', invalidate: ['/booklets'], onSuccess: onDeleted });

  const update = (fn: (xs: DraftItem[]) => DraftItem[]) => {
    setItems(fn);
    setDirty(true);
  };
  const move = (i: number, d: number) =>
    update((xs) => {
      const next = [...xs];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      return next;
    });

  async function download() {
    if (!instrument || !booklet.data) return;
    setDownloading(true);
    try {
      await downloadFile(withQuery(`/booklets/${id}/pdf`, { instrument }), `${booklet.data.name} - ${instrument}.pdf`);
    } catch (e) {
      toast.error(e);
    } finally {
      setDownloading(false);
    }
  }

  if (booklet.isLoading) return <Loading />;
  if (booklet.error || !booklet.data) return <ErrorNote error={booklet.error} />;
  const b = booklet.data;

  return (
    <Card
      title={b.name}
      actions={
        write && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Renombrar
            </Button>
            <Button size="sm" variant="danger" onClick={() => setDeleting(true)}>
              Eliminar
            </Button>
          </>
        )
      }
    >
      <div className="stack">
        {b.description && <p className="small muted">{b.description}</p>}
        {items.length === 0 ? (
          <p className="muted">El libreto está vacío. Añade marchas en el orden en que deben aparecer.</p>
        ) : (
          <ol className="list-plain list-divided" aria-label="Marchas del libreto">
            {items.map((it, i) => (
              <li key={it.workId} className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 8 }}>
                {write ? (
                  <TextField
                    label={`Número de «${it.title}»`}
                    value={it.label}
                    maxLength={20}
                    style={{ width: 80 }}
                    onChange={(e) => update((xs) => xs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                  />
                ) : (
                  <strong>{it.label || i + 1}</strong>
                )}
                <span style={{ flex: 1, minWidth: 160 }}>
                  {it.title}
                  {it.composer && <span className="small muted"> · {it.composer}</span>}
                </span>
                {write && (
                  <span className="row" style={{ gap: 4 }}>
                    <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Subir «${it.title}»`}>
                      ↑
                    </Button>
                    <Button size="sm" variant="ghost" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label={`Bajar «${it.title}»`}>
                      ↓
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => update((xs) => xs.filter((_, j) => j !== i))} aria-label={`Quitar «${it.title}»`}>
                      Quitar
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
        {write && (
          <form
            className="stack"
            aria-label="Añadir marcha al libreto"
            onSubmit={(e) => e.preventDefault()}
          >
            <WorkPicker
              label="Marcha"
              value={adding}
              exclude={items.map((i) => i.workId)}
              onChange={(workId, work) => {
                setAdding('');
                if (!workId || !work) return;
                update((xs) => [...xs, { workId, title: work.title, composer: work.composer?.name, label: String(xs.length + 1) }]);
              }}
            />
            <div className="row">
              <Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!dirty}>
                Guardar libreto
              </Button>
              {dirty && <span className="small muted">Hay cambios sin guardar.</span>}
            </div>
            <FormError error={save.error} />
          </form>
        )}

        <div className="stack">
          <h3 className="card__title">Descargar por instrumento</h3>
          {instruments.data && instruments.data.length === 0 ? (
            <p className="small muted">Ninguna obra del libreto tiene particellas en PDF todavía.</p>
          ) : (
            <div className="toolbar">
              <SelectField
                label="Instrumento"
                value={instrument}
                onChange={(e) => setInstrument(e.target.value)}
                placeholder="Elige instrumento"
                options={(instruments.data ?? []).map((x) => ({ value: x.instrument, label: `${x.instrument} (${x.works}/${x.total} obras)` }))}
              />
              <Button onClick={download} loading={downloading} disabled={!instrument || dirty}>
                Descargar PDF
              </Button>
            </div>
          )}
          <p className="small muted">El PDF incluye un índice; las obras sin particella de ese instrumento aparecen como «falta».{dirty && ' Guarda los cambios antes de descargar.'}</p>
        </div>
      </div>
      <BookletFormModal open={editing} booklet={b} onClose={() => setEditing(false)} />
      <ConfirmModal
        open={deleting}
        title="Eliminar libreto"
        message={`¿Eliminar «${b.name}»? Las obras y sus particellas no se borran.`}
        confirmLabel="Eliminar"
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
        onClose={() => setDeleting(false)}
      />
    </Card>
  );
}

/** Libretos de marchas: selección ordenada de obras para imprimir por instrumento. */
export function BookletsTab() {
  const { can } = useAuth();
  const list = useApi<Booklet[]>('/booklets');
  const [selected, setSelected] = useState('');
  const [creating, setCreating] = useState(false);
  const current = selected || list.data?.[0]?.id || '';

  return (
    <div className="stack">
      <div className="toolbar">
        {list.data && list.data.length > 0 && (
          <SelectField
            label="Libreto"
            value={current}
            onChange={(e) => setSelected(e.target.value)}
            options={list.data.map((b) => ({ value: b.id, label: `${b.name} (${b._count?.items ?? 0})` }))}
          />
        )}
        {can('archive:write') && <Button onClick={() => setCreating(true)}>Nuevo libreto</Button>}
      </div>
      {list.isLoading && <Loading />}
      {list.error && <ErrorNote error={list.error} />}
      {list.data && list.data.length === 0 && (
        <EmptyState title="No hay libretos">Crea un libreto (Semana Santa, pasacalles, fiestas…) y añade las marchas en orden para imprimirlo por instrumento.</EmptyState>
      )}
      {current && <BookletEditor key={current} id={current} onDeleted={() => setSelected('')} />}
      <BookletFormModal open={creating} onClose={() => setCreating(false)} onSaved={(b) => setSelected(b.id)} />
    </div>
  );
}
