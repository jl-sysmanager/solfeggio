import { useState } from 'react';
import { post } from '../../api/client';
import { useApiMutation } from '../../api/hooks';
import type { Asset, Work } from '../../api/types';
import type { DetectPartsResult, PartRange } from '../../api/types-archive';
import { Button } from '../Button';
import { FormError, SelectField, TextField } from '../Field';
import { InstrumentField } from '../InstrumentField';
import { Modal } from '../Modal';

interface Row extends PartRange {
  key: number;
  confidence?: number;
}

let seq = 0;

/** Valida los rangos en cliente con los mismos criterios que el API. */
export function rangeError(rows: PartRange[], pages?: number) {
  if (rows.length === 0) return 'Añade al menos una particella.';
  if (rows.length > 60) return 'Máximo 60 particellas por división.';
  for (const [i, r] of rows.entries()) {
    if (!r.instrument.trim()) return `Falta el instrumento de la particella ${i + 1}.`;
    if (!Number.isInteger(r.fromPage) || !Number.isInteger(r.toPage) || r.fromPage < 1 || r.toPage < r.fromPage) return `Rango de páginas no válido en la particella ${i + 1}.`;
    if (pages && r.toPage > pages) return `La particella ${i + 1} supera las ${pages} páginas del PDF.`;
  }
  return null;
}

/** Divide un PDF (guion o fichero «Otro») en particellas por instrumento. */
export function PartSplitModal({ work, asset, open, onClose }: { work: Work; asset: Asset | null; open: boolean; onClose: () => void }) {
  const [result, setResult] = useState<DetectPartsResult | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [versionId, setVersionId] = useState(asset?.versionId ?? '');
  const [touched, setTouched] = useState(false);

  const close = () => {
    setResult(null);
    setRows([]);
    setTouched(false);
    onClose();
  };
  const detect = useApiMutation(() => post<DetectPartsResult>(`/works/${work.id}/assets/${asset!.id}/detect-parts`), {
    onSuccess: (r) => {
      setResult(r);
      setRows(r.suggestions.map((s) => ({ ...s, key: ++seq })));
    },
  });
  const split = useApiMutation(
    () => post<Asset[]>(`/works/${work.id}/assets/${asset!.id}/split`, { versionId: versionId || null, parts: rows.map(({ instrument, fromPage, toPage }) => ({ instrument: instrument.trim(), fromPage, toPage })) }),
    { success: 'Particellas creadas', invalidate: [`/works/${work.id}`, '/dashboard'], onSuccess: close },
  );

  const edit = (key: number, patch: Partial<Row>) => setRows((xs) => xs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const error = rangeError(rows, result?.pages);

  return (
    <Modal open={open} onClose={close} title={`Dividir en particellas: ${asset?.fileName ?? ''}`}>
      <div className="form">
        <p className="small muted">
          Se lee el texto de cada página del PDF y se proponen rangos según el instrumento de la cabecera. Revisa las sugerencias antes de crear las particellas: se guardan como ficheros
          nuevos y ocupan almacenamiento.
        </p>
        {!result && (
          <div>
            <Button onClick={() => detect.mutate(undefined)} loading={detect.isPending}>
              Detectar instrumentos
            </Button>
          </div>
        )}
        {result?.ocrRequired && (
          <p className="field__error" role="status">
            Este PDF no tiene capa de texto (parece escaneado), así que no se pueden reconocer los instrumentos. El reconocimiento óptico (OCR) de escaneos no está disponible: indica los
            rangos a mano.
          </p>
        )}
        {result && (
          <>
            <p className="small" aria-live="polite">
              {result.pages} páginas · {rows.length} particellas
            </p>
            {rows.map((r, i) => (
              <fieldset key={r.key} className="form-row" style={{ border: 0, padding: 0, margin: 0, alignItems: 'flex-end' }}>
                <legend className="sr-only">Particella {i + 1}</legend>
                <InstrumentField label="Instrumento" value={r.instrument} required onChange={(e) => edit(r.key, { instrument: e.target.value })} />
                <TextField label="Desde pág." type="number" min={1} max={result.pages} value={r.fromPage} onChange={(e) => edit(r.key, { fromPage: Number(e.target.value) })} />
                <TextField label="Hasta pág." type="number" min={1} max={result.pages} value={r.toPage} onChange={(e) => edit(r.key, { toPage: Number(e.target.value) })} />
                {r.confidence !== undefined && r.confidence < 0.6 && <span className="small muted">Revisar</span>}
                <Button size="sm" variant="ghost" onClick={() => setRows((xs) => xs.filter((x) => x.key !== r.key))} aria-label={`Quitar particella ${i + 1}`}>
                  Quitar
                </Button>
              </fieldset>
            ))}
            <div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const last = rows[rows.length - 1]?.toPage ?? 0;
                  const from = Math.min(last + 1, result.pages);
                  setRows((xs) => [...xs, { key: ++seq, instrument: '', fromPage: from, toPage: from }]);
                }}
              >
                Añadir particella
              </Button>
            </div>
            {work.versions && work.versions.length > 0 && (
              <SelectField
                label="Versión"
                value={versionId}
                onChange={(e) => setVersionId(e.target.value)}
                placeholder="Original"
                options={work.versions.map((v) => ({ value: v.id, label: v.name }))}
              />
            )}
            {touched && error && <p className="field__error" role="alert">{error}</p>}
          </>
        )}
        <FormError error={detect.error ?? split.error} />
        <div className="modal__footer">
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          {result && (
            <Button
              loading={split.isPending}
              onClick={() => {
                setTouched(true);
                if (!error) split.mutate(undefined);
              }}
            >
              Crear particellas
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
