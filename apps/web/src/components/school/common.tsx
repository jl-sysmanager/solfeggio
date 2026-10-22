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
