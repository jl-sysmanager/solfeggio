import { useState } from 'react';
import { useApi } from '../../api/hooks';
import type { Paginated, Work } from '../../api/types';
import { SelectField, TextField } from '../Field';

/** Buscador de obras: texto libre + desplegable con los resultados. */
export function WorkPicker({
  name = 'workId',
  label = 'Obra',
  value,
  onChange,
  exclude = [],
  required,
}: {
  name?: string;
  label?: string;
  value?: string;
  onChange?: (id: string, work?: Work) => void;
  exclude?: string[];
  required?: boolean;
}) {
  const [q, setQ] = useState('');
  const works = useApi<Paginated<Work>>('/works', { q: q.trim() || undefined, pageSize: 50 });
  const options = (works.data?.data ?? [])
    .filter((w) => !exclude.includes(w.id))
    .map((w) => ({ value: w.id, label: w.composer?.name ? `${w.title} — ${w.composer.name}` : w.title }));
  return (
    <div className="form-row">
      <TextField label={`Buscar ${label.toLowerCase()}`} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Título o compositor" />
      <SelectField
        label={label}
        name={name}
        required={required}
        placeholder={works.isLoading ? 'Cargando…' : options.length ? 'Elige una obra' : 'Sin resultados'}
        options={options}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value, works.data?.data.find((w) => w.id === e.target.value)) : undefined}
      />
    </div>
  );
}
