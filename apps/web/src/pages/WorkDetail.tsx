import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { del, get, post } from '../api/client';
import { useApi, useApiMutation } from '../api/hooks';
import type { Asset, Work } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { PartSplitModal } from '../components/archive/PartSplitter';
import { ScoreLoansPanel } from '../components/archive/ScoreLoans';
import { ArrowLink, Button } from '../components/Button';
import { Card } from '../components/Card';
import { Tag } from '../components/Chip';
import { DataTable } from '../components/DataTable';
import { ErrorNote, Loading } from '../components/EmptyState';
import { FormError, SelectField, TextAreaField, TextField, formValues } from '../components/Field';
import { canPreviewFile, FilePreviewModal, previewActionLabel } from '../components/FilePreviewModal';
import { Menu } from '../components/Menu';
import { ConfirmModal, Modal } from '../components/Modal';
import { Page, PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toasts';
import { bytes, date, duration } from '../lib/format';
import { assetKind } from '../lib/labels';
import { uploadFile } from '../lib/upload';
import { WorkFormModal } from './Archive';

const assetDownloadPath = (id: string) => `/assets/${id}/download`;

function AssetUploadModal({ work, open, onClose }: { work: Work; open: boolean; onClose: () => void }) {
  const upload = useApiMutation(
    async ({ file, kind, instrument, versionId }: { file: File; kind: string; instrument?: string; versionId?: string }) => {
      const up = await uploadFile(`/works/${work.id}/assets/upload-url`, file);
      return post(`/works/${work.id}/assets`, { kind, instrument: instrument ?? null, versionId: versionId ?? null, ...up });
    },
    { success: 'Fichero añadido', invalidate: [`/works/${work.id}`, '/dashboard'], onSuccess: onClose },
  );
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const v = formValues(e.currentTarget);
    const file = fd.get('file') as File | null;
    if (!file || file.size === 0) return;
    upload.mutate({ file, kind: v.kind ?? 'SCORE', instrument: v.instrument, versionId: v.versionId });
  }
  return (
    <Modal open={open} onClose={onClose} title="Añadir partitura o audio">
      <form className="form" onSubmit={submit}>
        <div className="form-row">
          <SelectField label="Tipo" name="kind" options={Object.entries(assetKind).map(([value, label]) => ({ value, label }))} />
          <TextField label="Instrumento / papel" name="instrument" placeholder="Clarinete 1º en Si♭" hint="Para particellas." />
        </div>
        {work.versions && work.versions.length > 0 && (
          <SelectField label="Versión" name="versionId" placeholder="Original" options={work.versions.map((v) => ({ value: v.id, label: v.name }))} />
        )}
        <TextField label="Fichero" name="file" type="file" accept="application/pdf,image/png,image/jpeg,.musicxml,.mxl,.xml,audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/flac,audio/aac,.mp3,.m4a,.wav,.ogg,.flac" required />
        <FormError error={upload.error} />
        <div className="modal__footer">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={upload.isPending}>
            Subir
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function VersionModal({ work, open, onClose }: { work: Work; open: boolean; onClose: () => void }) {
  const add = useApiMutation((body: unknown) => post(`/works/${work.id}/versions`, body), {
    success: 'Versión añadida',
    invalidate: [`/works/${work.id}`],
    onSuccess: onClose,
  });
  return (
    <Modal open={open} onClose={onClose} title="Nueva versión o arreglo">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const v = formValues(e.currentTarget);
          add.mutate({ name: v.name, arranger: v.arranger, notes: v.notes });
        }}
      >
        <TextField label="Nombre" name="name" required placeholder="Arreglo para banda reducida (2019)" />
        <TextField label="Arreglista" name="arranger" />
        <TextAreaField label="Notas" name="notes" />
        <FormError error={add.error} />
        <div className="modal__footer">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={add.isPending}>
            Guardar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function WorkDetailPage() {
  const { id } = useParams();
  const { can, hasFeature } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const q = useApi<Work>(`/works/${id}`);
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [versioning, setVersioning] = useState(false);
  const [removing, setRemoving] = useState<Asset | null>(null);
  const [deletingWork, setDeletingWork] = useState(false);
  const [splitting, setSplitting] = useState<Asset | null>(null);
  const [preview, setPreview] = useState<Asset | null>(null);

  const removeAsset = useApiMutation((assetId: string) => del(`/assets/${assetId}`), {
    success: 'Fichero eliminado',
    invalidate: [`/works/${id}`],
    onSuccess: () => setRemoving(null),
  });
  const removeWork = useApiMutation(() => del(`/works/${id}`), {
    success: 'Obra eliminada',
    invalidate: ['/works', '/tags'],
    onSuccess: () => navigate('/archive'),
  });

  async function download(a: Asset) {
    try {
      const { url } = await get<{ url: string }>(`/assets/${a.id}/download`);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      toast.error(e);
    }
  }

  function openAsset(a: Asset) {
    if (canPreviewFile(a.mimeType)) setPreview(a);
    else void download(a);
  }

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <div className="container page__body"><ErrorNote error={q.error} /></div>;
  const w = q.data;
  const write = can('archive:write');
  const canSplit = write && hasFeature('archive_ai');
  const splittable = (a: Asset) => a.mimeType === 'application/pdf' && (a.kind === 'SCORE' || a.kind === 'OTHER');
  const versionName = (vid?: string | null) => w.versions?.find((v) => v.id === vid)?.name ?? 'Original';

  return (
    <Page
      header={
        <PageHeader
          eyebrow={w.genre ?? 'Archivo musical'}
          title={w.title}
          description={`${w.composer?.name ?? 'Compositor desconocido'}${w.arranger ? ` · arr. ${w.arranger}` : ''}`}
          actions={
            write && (
              <>
                <Button onClick={() => setUploading(true)}>Añadir fichero</Button>
                <Button variant="ghost" onClick={() => setEditing(true)}>
                  Editar
                </Button>
              </>
            )
          }
        />
      }
    >
      <ArrowLink to="/archive">Volver al archivo</ArrowLink>
      <div className="grid grid--2">
        <Card title="Ficha">
          <dl className="kv">
            {w.subtitle && (
              <>
                <dt>Subtítulo</dt>
                <dd>{w.subtitle}</dd>
              </>
            )}
            <dt>Duración</dt>
            <dd>{duration(w.durationSec)}</dd>
            <dt>Dificultad</dt>
            <dd>{w.difficulty ? `Grado ${w.difficulty}` : '—'}</dd>
            <dt>Año</dt>
            <dd>{w.year ?? '—'}</dd>
            <dt>Editorial</dt>
            <dd>{w.publisher ?? '—'}</dd>
            <dt>Signatura</dt>
            <dd>{w.catalogCode ?? '—'}</dd>
            <dt>Notas</dt>
            <dd>{w.notes ?? '—'}</dd>
          </dl>
          {w.tags.length > 0 && (
            <div className="chips" style={{ marginTop: 16 }}>
              {w.tags.map((t) => (
                <Tag key={t}>{t}</Tag>
              ))}
            </div>
          )}
        </Card>
        <Card title="Versiones" tone="cream" actions={write && <Button size="sm" variant="ghost" onClick={() => setVersioning(true)}>Añadir versión</Button>}>
          {w.versions && w.versions.length > 0 ? (
            <ul className="list-plain list-divided">
              {w.versions.map((v) => (
                <li key={v.id}>
                  <strong>{v.name}</strong>
                  {v.arranger && <span className="small"> · {v.arranger}</span>}
                  {v.notes && <p className="small muted">{v.notes}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Sólo la versión original.</p>
          )}
        </Card>
      </div>

      <Card title="Partituras, particellas y audios">
        <DataTable
          caption="Ficheros de la obra"
          rows={w.assets ?? []}
          rowKey={(a) => a.id}
          empty="Aún no hay ficheros. Sube la partitura general y las particellas."
          onRowClick={(a) => openAsset(a)}
          columns={[
            { key: 'k', header: 'Tipo', render: (a) => assetKind[a.kind] },
            { key: 'i', header: 'Instrumento', render: (a) => a.instrument ?? '—' },
            { key: 'v', header: 'Versión', render: (a) => versionName(a.versionId) },
            { key: 'f', header: 'Fichero', render: (a) => a.fileName },
            { key: 's', header: 'Tamaño', render: (a) => bytes(a.sizeBytes), numeric: true, nowrap: true },
            { key: 'd', header: 'Subido', render: (a) => date(a.createdAt), nowrap: true },
            {
              key: 'a',
              header: 'Acciones',
              render: (a) => {
                const viewLabel = previewActionLabel(a.mimeType);
                return write ? (
                  <Menu
                    label={`Acciones de ${a.fileName}`}
                    items={[
                      { label: viewLabel, onSelect: () => openAsset(a) },
                      { label: 'Descargar', onSelect: () => void download(a) },
                      ...(canSplit && splittable(a) ? [{ label: 'Dividir en particellas', onSelect: () => setSplitting(a) }] : []),
                      { label: 'Eliminar archivo', onSelect: () => setRemoving(a), danger: true },
                    ]}
                  />
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => openAsset(a)} aria-label={`${viewLabel} ${a.fileName}`}>
                    {viewLabel}
                  </Button>
                );
              },
            },
          ]}
        />
      </Card>

      <Card title="Préstamos a otras bandas">
        <ScoreLoansPanel workId={w.id} />
      </Card>

      {write && (
        <div>
          <Button variant="danger" onClick={() => setDeletingWork(true)}>
            Eliminar obra
          </Button>
        </div>
      )}

      <WorkFormModal open={editing} work={w} onClose={() => setEditing(false)} />
      <AssetUploadModal work={w} open={uploading} onClose={() => setUploading(false)} />
      <PartSplitModal key={splitting?.id ?? 'none'} work={w} asset={splitting} open={!!splitting} onClose={() => setSplitting(null)} />
      <VersionModal work={w} open={versioning} onClose={() => setVersioning(false)} />
      <FilePreviewModal
        file={
          preview
            ? {
                id: preview.id,
                title: preview.instrument ? `${assetKind[preview.kind]} · ${preview.instrument}` : assetKind[preview.kind],
                fileName: preview.fileName,
                mimeType: preview.mimeType,
              }
            : null
        }
        downloadPath={assetDownloadPath}
        onClose={() => setPreview(null)}
      />
      <ConfirmModal
        open={!!removing}
        title="Eliminar fichero"
        message={`¿Eliminar «${removing?.fileName}»?`}
        confirmLabel="Eliminar"
        loading={removeAsset.isPending}
        onConfirm={() => removing && removeAsset.mutate(removing.id)}
        onClose={() => setRemoving(null)}
      />
      <ConfirmModal
        open={deletingWork}
        title="Eliminar obra"
        message="Se eliminarán la obra, sus versiones y todos sus ficheros. También desaparecerá del repertorio de los eventos."
        confirmLabel="Eliminar obra"
        loading={removeWork.isPending}
        onConfirm={() => removeWork.mutate(undefined)}
        onClose={() => setDeletingWork(false)}
      />
    </Page>
  );
}
