import { useEffect, useState, type FormEvent } from 'react';
import { del, get, post } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import type { DocumentItem, Paginated } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Tag } from '../components/Chip';
import { DataTable } from '../components/DataTable';
import { ErrorNote, Loading } from '../components/EmptyState';
import { FormError, SelectField, TextField, formValues } from '../components/Field';
import { Menu } from '../components/Menu';
import { ConfirmModal, Modal } from '../components/Modal';
import { Page, PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toasts';
import { bytes, date } from '../lib/format';
import { uploadFile } from '../lib/upload';

const CATEGORIES = ['Actas', 'Estatutos', 'Contratos', 'Subvenciones', 'Seguros', 'Socios', 'Otros'];

const PREVIEWABLE = /^(application\/pdf|image\/(png|jpeg|jpg|webp|gif))$/i;

export async function openDownload(path: string) {
  const { url } = await get<{ url: string }>(path);
  window.open(url, '_blank', 'noopener');
}

function DocumentPreviewModal({ doc, onClose }: { doc: DocumentItem | null; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const canPreview = !!doc && PREVIEWABLE.test(doc.mimeType);

  useEffect(() => {
    if (!doc) {
      setUrl(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setUrl(null);
    setError(null);
    get<{ url: string }>(`/documents/${doc.id}/download`, { inline: canPreview ? '1' : undefined })
      .then((r) => {
        if (!cancelled) setUrl(r.url);
      })
      .catch((e) => {
        if (!cancelled) setError(e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [doc, canPreview]);

  const isImage = !!doc && /^image\//i.test(doc.mimeType);

  return (
    <Modal open={!!doc} onClose={onClose} title={doc?.title ?? 'Documento'} size="lg">
      {loading && <Loading />}
      {error ? <ErrorNote error={error} /> : null}
      {!loading && url && canPreview && (
        <div className="doc-preview">
          {isImage ? <img src={url} alt={doc?.title ?? ''} /> : <iframe title={doc?.title ?? 'Vista previa'} src={url} />}
        </div>
      )}
      {!loading && url && !canPreview && (
        <div className="doc-preview__fallback">
          <p className="muted">Este tipo de fichero no se puede previsualizar en el navegador.</p>
          <Button onClick={() => window.open(url, '_blank', 'noopener')}>Descargar {doc?.fileName}</Button>
        </div>
      )}
      <div className="modal__footer">
        <Button variant="ghost" onClick={onClose}>
          Cerrar
        </Button>
        {url && (
          <Button variant="ghost" onClick={() => window.open(url, '_blank', 'noopener')}>
            Abrir / descargar
          </Button>
        )}
      </div>
    </Modal>
  );
}

export default function DocumentsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [category, setCategory] = useState('');
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<DocumentItem | null>(null);
  const [removing, setRemoving] = useState<DocumentItem | null>(null);
  const list = useApi<DocumentItem[] | Paginated<DocumentItem>>('/documents', { category });
  const rows = Array.isArray(list.data) ? list.data : list.data?.data ?? [];

  const create = useApiMutation(
    async ({ file, title, category }: { file: File; title: string; category: string }) => {
      const up = await uploadFile('/documents/upload-url', file);
      return post('/documents', { title, category, ...up });
    },
    { success: 'Documento subido', invalidate: ['/documents', '/dashboard'], onSuccess: () => setOpen(false) },
  );
  const remove = useApiMutation((id: string) => del(`/documents/${id}`), {
    success: 'Documento eliminado',
    invalidate: ['/documents'],
    onSuccess: () => setRemoving(null),
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const v = formValues(e.currentTarget);
    const file = fd.get('file') as File | null;
    if (!file || file.size === 0) return;
    create.mutate({ file, title: v.title ?? file.name, category: v.category ?? 'Otros' });
  }

  return (
    <Page
      header={
        <PageHeader
          eyebrow="Gestión"
          title="Documentos"
          description="Actas, estatutos, contratos y documentación de la banda. Almacenamiento privado y cifrado."
          actions={can('documents:write') && <Button onClick={() => setOpen(true)}>Subir documento</Button>}
        />
      }
    >
      <div className="chips" role="group" aria-label="Filtrar por categoría">
        <button className="chip chip--plain chip--outline" aria-pressed={category === ''} onClick={() => setCategory('')}>
          Todas
        </button>
        {CATEGORIES.map((c) => (
          <button key={c} className="chip chip--plain chip--outline" aria-pressed={category === c} onClick={() => setCategory(c)}>
            {c}
          </button>
        ))}
      </div>
      {list.isLoading && <Loading />}
      {list.error && <ErrorNote error={list.error} />}
      {list.data && (
        <Card>
          <DataTable
            caption="Documentos"
            rows={rows}
            rowKey={(d) => d.id}
            onRowClick={(d) => setPreview(d)}
            columns={[
              { key: 't', header: 'Título', render: (d) => d.title },
              { key: 'c', header: 'Categoría', render: (d) => <Tag>{d.category}</Tag> },
              { key: 's', header: 'Tamaño', render: (d) => bytes(d.sizeBytes), numeric: true, nowrap: true },
              { key: 'd', header: 'Fecha', render: (d) => date(d.createdAt), nowrap: true },
              {
                key: 'a',
                header: 'Acciones',
                render: (d) => (
                  <Menu
                    label={`Acciones de ${d.title}`}
                    items={[
                      { label: 'Ver', onSelect: () => setPreview(d) },
                      { label: 'Descargar', onSelect: () => openDownload(`/documents/${d.id}/download`).catch(toast.error) },
                      ...(can('documents:write') ? [{ label: 'Eliminar documento', onSelect: () => setRemoving(d), danger: true }] : []),
                    ]}
                  />
                ),
              },
            ]}
          />
        </Card>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Subir documento">
        <form className="form" onSubmit={submit}>
          <TextField label="Título" name="title" required />
          <SelectField label="Categoría" name="category" options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
          <TextField label="Fichero" name="file" type="file" required hint="PDF, imágenes u ofimática. Cuenta para el límite de almacenamiento del plan." />
          <FormError error={create.error} />
          <div className="modal__footer">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={create.isPending}>
              Subir
            </Button>
          </div>
        </form>
      </Modal>
      <DocumentPreviewModal doc={preview} onClose={() => setPreview(null)} />
      <ConfirmModal
        open={!!removing}
        title="Eliminar documento"
        message={`¿Eliminar «${removing?.title}»? El fichero se borrará del almacenamiento.`}
        confirmLabel="Eliminar"
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
        onClose={() => setRemoving(null)}
      />
    </Page>
  );
}
