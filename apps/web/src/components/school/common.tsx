import { useEffect, useMemo, useState } from 'react';
import { useApi } from '../../api/hooks';
import type { Paginated } from '../../api/types';
import type { ClassGroup, ClassSlot, SchoolYear, Student } from '../../api/types-school';
import { hhmm, weekdayName } from '../../lib/labels-school';
import { SelectField } from '../Field';

export const rows = <T,>(d: T[] | Paginated<T> | undefined) => (Array.isArray(d) ? d : d?.data ?? []);

/** Cursos escolares y el curso seleccionado (por defecto, el actual o el más reciente). */
export function useSchoolYears() {
  const q = useApi<SchoolYear[]>('/school/years');
  const years = useMemo(() => q.data ?? [], [q.data]);
  const [yearId, setYearId] = useState('');
  useEffect(() => {
    if (!yearId && years.length) setYearId((years.find((y) => y.isCurrent) ?? years[0]).id);
  }, [years, yearId]);
  return { years, yearId, setYearId, year: years.find((y) => y.id === yearId), isLoading: q.isLoading, error: q.error };
}

export function YearSelect({ years, value, onChange, label = 'Curso' }: { years: SchoolYear[]; value: string; onChange: (id: string) => void; label?: string }) {
  return (
    <SelectField
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={years.length ? undefined : 'Sin cursos'}
      options={years.map((y) => ({ value: y.id, label: `${y.name}${y.isCurrent ? ' (actual)' : ''}` }))}
    />
  );
}

export const slotText = (s: Pick<ClassSlot, 'weekday' | 'startMin' | 'endMin'> & { room?: { name: string } | null }) =>
  `${weekdayName(s.weekday)} ${hhmm(s.startMin)}–${hhmm(s.endMin)}${s.room ? ` · ${s.room.name}` : ''}`;

export const groupLabel = (g: Pick<ClassGroup, 'name' | 'level'> & { subject: { name: string } }) => `${g.subject.name} · ${g.name}${g.level ? ` (${g.level})` : ''}`;

/** Selector de alumno activo. */
export function StudentSelect({ name = 'studentId', label = 'Alumno', required = true }: { name?: string; label?: string; required?: boolean }) {
  const q = useApi<Paginated<Student>>('/school/students', { status: 'ACTIVE', pageSize: 200 });
  return (
    <SelectField
      label={label}
      name={name}
      required={required}
      placeholder={q.isLoading ? 'Cargando…' : 'Elige un alumno'}
      options={(q.data?.data ?? []).map((s) => ({ value: s.id, label: `${s.lastName}, ${s.firstName}${s.instrument ? ` (${s.instrument})` : ''}` }))}
    />
  );
}

/** Euros escritos por el usuario («45,50») → céntimos; vacío → null. */
export function centsOrNull(v: string | undefined) {
  if (!v) return null;
  const n = Number(v.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export const euros = (cents: number | null | undefined) => (cents === null || cents === undefined ? '' : (cents / 100).toFixed(2).replace('.', ','));

/**
 * Curso que propone el asistente: el siguiente al más reciente o, en una escuela sin cursos, el que
 * está en marcha (septiembre a junio).
 */
export function suggestedYear(years: Pick<SchoolYear, 'startsOn'>[], now = new Date()) {
  const latest = years.map((y) => Number(y.startsOn.slice(0, 4))).sort((a, b) => b - a)[0];
  const start = latest !== undefined ? latest + 1 : now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return { name: `${start}-${String((start + 1) % 100).padStart(2, '0')}`, startsOn: `${start}-09-01`, endsOn: `${start + 1}-06-30` };
}

/** CSV de una hoja de cálculo (separador «;» o «,», comillas dobles) → filas de texto. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}
