import { useEffect, useState } from 'react';
import { get } from '../api/client';
import { Button } from './Button';
import { ErrorNote, Loading } from './EmptyState';
import { Modal } from './Modal';

const PREVIEWABLE_VISUAL = /^(application\/pdf|image\/(png|jpeg|jpg|webp|gif))$/i;
const PREVIEWABLE_AUDIO = /^audio\//i;

export function canPreviewFile(mimeType: string) {
  return PREVIEWABLE_VISUAL.test(mimeType) || PREVIEWABLE_AUDIO.test(mimeType);
}

export function previewActionLabel(mimeType: string) {
  if (PREVIEWABLE_AUDIO.test(mimeType)) return 'Escuchar';
  if (canPreviewFile(mimeType)) return 'Ver';
  return 'Abrir';
}

/** Vista previa de PDF, imagen o audio a partir de una URL de descarga del API. */
export function FilePreviewModal({
  file,
  downloadPath,
  onClose,
}: {
  file: { id: string; title: string; fileName: string; mimeType: string } | null;
  /** Ruta del API, p. ej. `/documents/${id}/download` o `/assets/${id}/download`. */
  downloadPath: (id: string) => string;
  onClose: () => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const isAudio = !!file && PREVIEWABLE_AUDIO.test(file.mimeType);
  const isImage = !!file && /^image\//i.test(file.mimeType);
  const canPreview = !!file && canPreviewFile(file.mimeType);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      setDownloadUrl(null);
      setError(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setLoading(true);
    setPreviewUrl(null);
    setDownloadUrl(null);
    setError(null);
    get<{ url: string; mimeType?: string }>(downloadPath(file.id), { inline: canPreview ? '1' : undefined })
      .then(async (r) => {
        if (cancelled) return;
        setDownloadUrl(r.url);
        if (!canPreview) {
          setPreviewUrl(r.url);
          return;
        }
        // * blob: evita iframe/audio cross-origin a S3 (CSP y visor PDF en blanco).
        const res = await fetch(r.url);
        if (!res.ok) throw new Error('No se pudo cargar el fichero');
        const raw = await res.blob();
        const mime = file.mimeType || r.mimeType || raw.type || 'application/octet-stream';
        const typed = raw.type === mime ? raw : new Blob([raw], { type: mime });
        objectUrl = URL.createObjectURL(typed);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setPreviewUrl(objectUrl);
      })
      .catch((e) => {
        if (!cancelled) setError(e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file, canPreview, downloadPath]);

  return (
    <Modal open={!!file} onClose={onClose} title={file?.title ?? 'Fichero'} size="lg">
      {loading && <Loading />}
      {error ? <ErrorNote error={error} /> : null}
      {!loading && previewUrl && canPreview && isAudio && (
        <div className="doc-preview doc-preview--audio">
          {/* Grabaciones de ensayo/referencia: no hay pista de subtítulos. */}
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls src={previewUrl} autoPlay style={{ width: '100%' }}>
            Tu navegador no reproduce audio.
          </audio>
          <p className="small muted" style={{ marginTop: 12 }}>
            {file?.fileName}
          </p>
        </div>
      )}
      {!loading && previewUrl && canPreview && !isAudio && (
        <div className="doc-preview">
          {isImage ? <img src={previewUrl} alt={file?.title ?? ''} /> : <iframe title={file?.title ?? 'Vista previa'} src={previewUrl} />}
        </div>
      )}
      {!loading && downloadUrl && !canPreview && (
        <div className="doc-preview__fallback">
          <p className="muted">Este tipo de fichero no se puede previsualizar en el navegador.</p>
          <Button onClick={() => window.open(downloadUrl, '_blank', 'noopener')}>Descargar {file?.fileName}</Button>
        </div>
      )}
      <div className="modal__footer">
        <Button variant="ghost" onClick={onClose}>
          Cerrar
        </Button>
        {downloadUrl && (
          <Button variant="ghost" onClick={() => window.open(downloadUrl, '_blank', 'noopener')}>
            Abrir / descargar
          </Button>
        )}
      </div>
    </Modal>
  );
}
