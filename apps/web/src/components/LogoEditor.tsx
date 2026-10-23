import { useState, type FormEvent } from 'react';
import { del, post } from '../api/client';
import { uploadFile } from '../lib/upload';
import { Button } from './Button';
import { FormError } from './Field';

const ACCEPT = 'image/png,image/jpeg,image/webp';

export function LogoEditor({
  previewUrl,
  uploadUrlPath,
  confirmPath,
  deletePath,
  onChanged,
}: {
  previewUrl: string | null;
  uploadUrlPath: string;
  confirmPath: string;
  deletePath: string;
  onChanged: () => void;
}) {
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = (e.currentTarget.elements.namedItem('logo') as HTMLInputElement).files?.[0];
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const up = await uploadFile(uploadUrlPath, file);
      await post(confirmPath, { fileKey: up.fileKey });
      e.currentTarget.reset();
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  async function remove() {
    setLoading(true);
    setError(null);
    try {
      await del(deletePath);
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      {previewUrl && <img src={previewUrl} alt="Logotipo actual" style={{ width: 72, height: 72, objectFit: 'contain', background: 'var(--surface-alt)', borderRadius: 8 }} />}
      <div className="field">
        <label htmlFor="logo-file">Imagen</label>
        <input id="logo-file" className="input" name="logo" type="file" accept={ACCEPT} required />
        <span className="field__hint">PNG, JPEG o WebP. Máximo 1 MB. Se usa en la aplicación y en los documentos.</span>
      </div>
      <FormError error={error} />
      <div className="row">
        <Button type="submit" loading={loading}>
          Guardar logotipo
        </Button>
        {previewUrl && (
          <Button type="button" variant="ghost" disabled={loading} onClick={remove}>
            Quitar
          </Button>
        )}
      </div>
    </form>
  );
}
