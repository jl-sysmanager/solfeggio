import { useState } from 'react';
import { post } from '../../api/client';
import { useApiMutation } from '../../api/hooks';
import type { ImportResult } from '../../api/types-school';
import { Button } from '../Button';
import { Card } from '../Card';
import { FormError } from '../Field';
import { Modal } from '../Modal';
import { useToast } from '../Toasts';
import { parseCsv } from './common';

/** Columnas de la plantilla (cabecera de la hoja) → campo de la API. */
const COLUMNS: [string, string][] = [
  ['Nombre del alumno', 'studentFirstName'],
  ['Apellidos del alumno', 'studentLastName'],
  ['Fecha de nacimiento', 'birthDate'],
  ['Instrumento', 'instrument'],
  ['Email del alumno', 'studentEmail'],
  ['Teléfono del alumno', 'studentPhone'],
  ['Familia', 'familyName'],
  ['Nombre del tutor', 'guardianFirstName'],
  ['Apellidos del tutor', 'guardianLastName'],
  ['Email del tutor', 'guardianEmail'],
  ['Teléfono del tutor', 'guardianPhone'],
  ['Observaciones', 'notes'],
];
const EXAMPLE = ['Lucía', 'Pérez García', '15/05/2016', 'Clarinete', '', '', 'Familia Pérez García', 'Marta', 'García', 'marta@ejemplo.es', '600111222', ''];

const norm = (v: string) => v.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
const byHeader = new Map(COLUMNS.map(([h, k]) => [norm(h), k]));

/** «15/05/2016» o «2016-05-15» → «2016-05-15»; lo demás se deja para que la API lo rechace. */
function isoDate(v: string) {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v.trim());
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : v.trim();
}

function toRows(table: string[][]) {
  const [header, ...body] = table;
  const keys = header.map((h) => byHeader.get(norm(h)));
  return body.map((cells) => {
    const row: Record<string, string> = {};
    keys.forEach((k, i) => {
      if (!k) return;
      const v = (cells[i] ?? '').trim();
      row[k] = k === 'birthDate' ? isoDate(v) : v;
    });
    return row;
  });
}

function downloadTemplate() {
  const csv = '﻿' + [COLUMNS.map(([h]) => h), EXAMPLE].map((r) => r.join(';')).join('\n') + '\n';
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'plantilla-alumnos.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Importación de alumnos y familias desde una hoja de cálculo guardada como CSV. Primero se
 * comprueba (sin guardar nada) y se muestran los errores fila a fila; después se importa.
 */
export function ImportModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const check = useApiMutation((r: Record<string, string>[]) => post<ImportResult>('/school/students/import', { rows: r, dryRun: true }));
  const run = useApiMutation((r: Record<string, string>[]) => post<ImportResult>('/school/students/import', { rows: r, dryRun: false }), {
    invalidate: ['/school'],
    onSuccess: (r) => {
      toast.notify(`${r.created} alumnos importados${r.newFamilies ? ` y ${r.newFamilies} familias nuevas` : ''}`);
      onClose();
    },
  });

  async function onFile(file: File | undefined) {
    setFileError(null);
    setRows(null);
    check.reset();
    if (!file) return;
    const table = parseCsv(await file.text());
    if (table.length < 2) return setFileError('El archivo no tiene filas de alumnos.');
    const parsed = toRows(table);
    if (!table[0].some((h) => byHeader.has(norm(h)))) return setFileError('No se reconocen las columnas. Usa la plantilla.');
    if (parsed.length > 1000) return setFileError('Como mucho 1000 alumnos por archivo.');
    setRows(parsed);
    check.mutate(parsed);
  }

  const r = check.data;
  return (
    <Modal open onClose={onClose} title="Importar alumnos" size="lg">
      <div className="stack" style={{ gap: 16 }}>
        <p className="small">
          Rellena la plantilla en Excel, LibreOffice o Google Sheets y guárdala como CSV. Los hermanos se agrupan en la misma familia si comparten el nombre de familia o el email del tutor.
        </p>
        <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
          <Button variant="ghost" onClick={downloadTemplate}>
            Descargar plantilla
          </Button>
          <label className="btn">
            Elegir archivo CSV
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
        </div>
        {fileError && (
          <p className="field__error" role="alert">
            {fileError}
          </p>
        )}
        {check.isPending && <p className="muted">Comprobando…</p>}
        <FormError error={check.error ?? run.error} />
        {r && (
          <Card tone={r.errors.some((e) => !e.message.startsWith('El alumno ya existe')) ? 'warm' : 'cool'} title="Comprobación">
            <p>
              Se importarán <strong>{r.created}</strong> de {r.total} alumnos
              {r.newFamilies ? <>, con <strong>{r.newFamilies}</strong> familias nuevas</> : null}.
              {r.duplicates ? ` ${r.duplicates} ya existían y se omiten.` : ''}
            </p>
            {r.errors.length > 0 && (
              <ul className="list-plain list-divided small" style={{ maxHeight: 220, overflow: 'auto' }}>
                {r.errors.map((e) => (
                  <li key={`${e.row}-${e.message}`}>
                    Fila {e.row + 1}: {e.message}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        <div className="modal__footer">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!rows || !r || r.created === 0} loading={run.isPending} onClick={() => rows && run.mutate(rows)}>
            {r ? `Importar ${r.created} alumnos` : 'Importar'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
