import { useEffect, useMemo, useState } from 'react';
import { put } from '../../api/client';
import { useApi, useApiMutation } from '../../api/hooks';
import type { Member, Paginated } from '../../api/types';
import type { AssemblyDetail, Quorum } from '../../api/types-governance';
import { useAuth } from '../../auth/AuthProvider';
import { Button } from '../Button';
import { StatCard } from '../Card';
import { Loading } from '../EmptyState';
import { FormError } from '../Field';
import { fullName } from '../../lib/format';

/** Asistente → socios que le delegan (máx. 2). */
type Sheet = Record<string, string[]>;

export function computeQuorum(base: Pick<Quorum, 'activeMembers' | 'quorumPct'>, sheet: Sheet): Quorum {
  const present = Object.keys(sheet).length;
  const represented = Object.values(sheet).reduce((s, p) => s + p.length, 0);
  const requiredFirstCall = Math.ceil((base.activeMembers * base.quorumPct) / 100);
  return { ...base, present, represented, total: present + represented, requiredFirstCall, metFirstCall: present + represented >= requiredFirstCall };
}

export function QuorumStats({ q }: { q: Quorum }) {
  return (
    <div className="grid grid--stats" aria-live="polite">
      <StatCard label="Presentes" value={q.present} />
      <StatCard label="Representados" value={q.represented} />
      <StatCard label="Total" value={`${q.total} / ${q.activeMembers}`} meter={q.activeMembers ? q.total / q.activeMembers : 0} />
      <StatCard
        label="Quórum 1.ª convocatoria"
        value={q.metFirstCall ? 'Alcanzado' : 'No alcanzado'}
        tone={q.metFirstCall ? 'cool' : 'warm'}
        hint={`Necesarios ${q.requiredFirstCall} (${q.quorumPct} %). En 2.ª convocatoria no hay mínimo.`}
      />
    </div>
  );
}

export function AttendancePanel({ assembly }: { assembly: AssemblyDetail }) {
  const { can } = useAuth();
  const editable = can('governance:write') && (assembly.status === 'CONVENED' || assembly.status === 'HELD');
  const members = useApi<Paginated<Member>>(editable ? '/members' : null, { status: 'ACTIVE', pageSize: 500 });
  const [sheet, setSheet] = useState<Sheet>({});
  useEffect(() => {
    const s: Sheet = {};
    for (const r of assembly.attendance) s[r.memberId] = [...(s[r.memberId] ?? []), ...(r.proxyForId ? [r.proxyForId] : [])];
    setSheet(s);
  }, [assembly.attendance]);
  const save = useApiMutation(
    () => put(`/governance/assemblies/${assembly.id}/attendance`, Object.entries(sheet).flatMap(([memberId, proxies]) => (proxies.length ? proxies.map((proxyForId) => ({ memberId, proxyForId })) : [{ memberId }]))),
    { success: 'Asistencia guardada', invalidate: [`/governance/assemblies/${assembly.id}`] },
  );
  const live = useMemo(() => computeQuorum(assembly.quorum, sheet), [assembly.quorum, sheet]);
  const delegated = new Set(Object.values(sheet).flat());

  if (!editable) {
    return (
      <div className="stack">
        <QuorumStats q={assembly.quorum} />
        {assembly.attendance.length > 0 && (
          <ul className="list-plain list-divided">
            {[...new Set(assembly.attendance.map((r) => r.memberId))].map((id) => {
              const rows = assembly.attendance.filter((r) => r.memberId === id);
              const proxies = rows.filter((r) => r.proxyFor).map((r) => fullName(r.proxyFor));
              return (
                <li key={id}>
                  {fullName(rows[0].member)}
                  {proxies.length > 0 && <span className="small muted"> · representa a {proxies.join(' y ')}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }
  if (members.isLoading) return <Loading />;
  const roster = members.data?.data ?? [];
  const setPresent = (id: string, on: boolean) =>
    setSheet((s) => {
      const next = { ...s };
      if (on) next[id] = [];
      else delete next[id];
      return next;
    });
  const setProxy = (holder: string, slot: number, value: string) =>
    setSheet((s) => {
      const list = [...(s[holder] ?? [])];
      if (value) list[slot] = value;
      else list.splice(slot, 1);
      return { ...s, [holder]: list.filter(Boolean) };
    });

  return (
    <div className="stack">
      <QuorumStats q={live} />
      <p className="small muted">Marca a los presentes. Cada asistente puede representar como máximo a dos socios ausentes.</p>
      <div className="table-wrap">
        <table className="table table--responsive">
          <caption className="sr-only">Lista de asistencia</caption>
          <thead>
            <tr>
              <th scope="col">Socio</th>
              <th scope="col">Presente</th>
              <th scope="col">Representa a</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((m) => {
              const present = m.id in sheet;
              const proxies = sheet[m.id] ?? [];
              const candidates = (current?: string) => roster.filter((c) => c.id !== m.id && !(c.id in sheet) && (!delegated.has(c.id) || c.id === current));
              return (
                <tr key={m.id}>
                  <td data-label="Socio">
                    {fullName(m)}
                    {delegated.has(m.id) && <span className="small muted"> · delega su voto</span>}
                  </td>
                  <td data-label="Presente">
                    <input type="checkbox" checked={present} disabled={delegated.has(m.id)} onChange={(e) => setPresent(m.id, e.target.checked)} aria-label={`${fullName(m)} presente`} />
                  </td>
                  <td data-label="Representa a">
                    {present && (
                      <div className="row">
                        {[0, 1].map((slot) =>
                          slot <= proxies.length ? (
                            <select
                              key={slot}
                              className="select"
                              value={proxies[slot] ?? ''}
                              onChange={(e) => setProxy(m.id, slot, e.target.value)}
                              aria-label={`Delegación ${slot + 1} de ${fullName(m)}`}
                            >
                              <option value="">—</option>
                              {candidates(proxies[slot]).map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.lastName}, {c.firstName}
                                </option>
                              ))}
                            </select>
                          ) : null,
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <FormError error={save.error} />
      <div className="row">
        <Button onClick={() => save.mutate(undefined)} loading={save.isPending}>
          Guardar asistencia
        </Button>
      </div>
    </div>
  );
}
