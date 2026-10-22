import type { Tx } from '../db/db.service';
import { norm } from './util';

export interface StaffingRow {
  instrument: string;
  required: number;
  called: number;
  accepted: number;
  pending: number;
  declined: number;
  /** Plazas sin cubrir contando aceptadas y pendientes de respuesta. */
  missing: number;
}

/** Cobertura por instrumento: requisitos del evento frente a convocatorias por instrumento del socio. */
export async function computeStaffing(tx: Tx, eventId: string): Promise<StaffingRow[]> {
  const [requirements, calls] = await Promise.all([
    tx.eventRequirement.findMany({ where: { eventId }, orderBy: { instrument: 'asc' } }),
    tx.eventCall.findMany({ where: { eventId }, select: { response: true, member: { select: { instrument: true } } } }),
  ]);
  const rows = new Map<string, StaffingRow>();
  for (const r of requirements) {
    rows.set(norm(r.instrument), { instrument: r.instrument, required: r.required, called: 0, accepted: 0, pending: 0, declined: 0, missing: 0 });
  }
  for (const c of calls) {
    const label = c.member.instrument?.trim() || 'Sin instrumento';
    const key = norm(label);
    const row = rows.get(key) ?? { instrument: label, required: 0, called: 0, accepted: 0, pending: 0, declined: 0, missing: 0 };
    row.called++;
    if (c.response === 'ACCEPTED') row.accepted++;
    else if (c.response === 'DECLINED') row.declined++;
    else row.pending++;
    rows.set(key, row);
  }
  return [...rows.values()]
    .map((r) => ({ ...r, missing: Math.max(0, r.required - r.accepted - r.pending) }))
    .sort((a, b) => b.required - a.required || a.instrument.localeCompare(b.instrument, 'es'));
}
