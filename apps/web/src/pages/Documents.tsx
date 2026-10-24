import { useState, type FormEvent } from 'react';
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

export async function openDownload(path: string) {
  const { url } = await get<{ url: string }>(path);
  window.open(url, '_blank', 'noopener');
}

export default function DocumentsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [category, setCategory] = useState('');
  const [open, setOpen] = useState(false);
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
