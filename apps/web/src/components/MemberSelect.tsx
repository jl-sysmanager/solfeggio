import { useApi } from '../api/hooks';
import type { Member, Paginated } from '../api/types';
import { SelectField } from './Field';

/** Selector de socio activo (para entregas, asignaciones…). */
export function MemberSelect({ name = 'memberId', label = 'Socio', required = true }: { name?: string; label?: string; required?: boolean }) {
  const q = useApi<Paginated<Member>>('/members', { status: 'ACTIVE', pageSize: 500 });
  return (
    <SelectField
      label={label}
      name={name}
      required={required}
      placeholder={q.isLoading ? 'Cargando…' : 'Elige un socio'}
      options={(q.data?.data ?? []).map((m) => ({ value: m.id, label: `${m.lastName}, ${m.firstName}${m.instrument ? ` (${m.instrument})` : ''}` }))}
    />
  );
}
