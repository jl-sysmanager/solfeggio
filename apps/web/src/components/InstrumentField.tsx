import { useMemo, type SelectHTMLAttributes } from 'react';
import { useApi } from '../api/hooks';
import type { InstrumentCatalogItem } from '../api/types';
import { SelectField } from './Field';

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> & {
  label?: string;
  hint?: string;
  /** Valor actual (p. ej. legado fuera del catálogo): se incluye en las opciones. */
  current?: string | null;
  placeholder?: string;
};

/** Selector de instrumento según el catálogo de la banda. Se puede dejar en blanco. */
export function InstrumentField({
  label = 'Instrumento',
  hint,
  current,
  placeholder = 'Sin instrumento',
  required,
  defaultValue,
  value,
  ...rest
}: Props) {
  const catalog = useApi<InstrumentCatalogItem[]>('/instrument-catalog');
  const options = useMemo(() => {
    const names = (catalog.data ?? []).map((i) => i.name);
    const cur = (current ?? (typeof value === 'string' ? value : undefined) ?? (typeof defaultValue === 'string' ? defaultValue : undefined))?.trim();
    if (cur && !names.includes(cur)) names.unshift(cur);
    return names.map((n) => ({ value: n, label: n }));
  }, [catalog.data, current, value, defaultValue]);

  return (
    <SelectField
      label={label}
      hint={hint}
      options={options}
      placeholder={required ? 'Elige instrumento' : placeholder}
      required={required}
      defaultValue={defaultValue}
      value={value}
      {...rest}
    />
  );
}
