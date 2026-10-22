// Borrador de acta a partir de plantilla (sin IA): el secretario lo revisa y completa antes de aprobarlo.

export interface AgendaItem {
  title: string;
  description?: string | null;
}

export interface VoteCounts {
  YES: number;
  NO: number;
  ABSTAIN: number;
  total: number;
  remote: number;
}

export interface Quorum {
  activeMembers: number;
  present: number;
  represented: number;
  total: number;
  quorumPct: number;
  requiredFirstCall: number;
  metFirstCall: boolean;
}

export interface MinutesInput {
  tenantName: string;
  timezone: string;
  assembly: { type: 'ORDINARY' | 'EXTRAORDINARY'; title: string; firstCallAt: Date; secondCallAt: Date | null; location: string | null; agenda: AgendaItem[] };
  attendees: { name: string; proxies: string[] }[];
  quorum: Quorum;
  motions: { title: string; description: string | null; status: 'DRAFT' | 'OPEN' | 'CLOSED'; results: VoteCounts }[];
  president?: string | null;
  secretary?: string | null;
}

export const TYPE_LABEL = { ORDINARY: 'Ordinaria', EXTRAORDINARY: 'Extraordinaria' } as const;

export function formatDateTime(d: Date, timeZone: string) {
  return new Intl.DateTimeFormat('es-ES', { timeZone, dateStyle: 'full', timeStyle: 'short' }).format(d);
}

/** Mayoría simple de los votos emitidos (las abstenciones no cuentan). */
export function motionOutcome(m: { status: string; results: VoteCounts }) {
  if (m.status === 'DRAFT') return 'no sometida a votación';
  if (m.status === 'OPEN') return 'votación abierta';
  return m.results.YES > m.results.NO ? 'APROBADA' : 'RECHAZADA';
}

export function minutesDraft(input: MinutesInput): string {
  const { assembly: a, quorum: q, timezone: tz } = input;
  const type = TYPE_LABEL[a.type];
  const lines: string[] = [];
  lines.push(`ACTA DE LA ASAMBLEA GENERAL ${type.toUpperCase()}`, input.tenantName, '', `«${a.title}»`, '');
  lines.push(
    `En ${a.location || '[lugar]'}, el ${formatDateTime(a.firstCallAt, tz)}, ` +
      `se reúne la Asamblea General ${type} de socios de ${input.tenantName}, convocada en primera convocatoria para esa hora` +
      (a.secondCallAt ? ` y en segunda convocatoria para el ${formatDateTime(a.secondCallAt, tz)}` : '') +
      ', con el siguiente orden del día:',
    '',
  );
  a.agenda.forEach((p, i) => lines.push(`${i + 1}. ${p.title}`));
  if (a.agenda.length === 0) lines.push('[Sin puntos en el orden del día]');

  lines.push('', 'ASISTENCIA', '');
  lines.push(
    `Asisten ${q.present} socios presentes y ${q.represented} representados mediante delegación de voto, ` +
      `en total ${q.total} de ${q.activeMembers} socios activos.`,
  );
  lines.push(
    q.metFirstCall
      ? `Se alcanza el quórum exigido en primera convocatoria (${q.quorumPct} %, ${q.requiredFirstCall} socios), por lo que la asamblea queda válidamente constituida.`
      : `No se alcanza el quórum exigido en primera convocatoria (${q.quorumPct} %, ${q.requiredFirstCall} socios); la asamblea se celebra en segunda convocatoria, que no exige un mínimo de asistentes.`,
  );
  if (input.attendees.length) {
    lines.push('', 'Socios presentes:');
    for (const p of input.attendees) lines.push(`- ${p.name}${p.proxies.length ? ` (con la representación de ${p.proxies.join(' y ')})` : ''}`);
  }

  lines.push('', 'DESARROLLO DE LA SESIÓN', '');
  a.agenda.forEach((p, i) => {
    lines.push(`${i + 1}. ${p.title}`);
    if (p.description) lines.push(`   ${p.description}`);
    lines.push('   [Resumen de las intervenciones y acuerdos]', '');
  });

  if (input.motions.length) {
    lines.push('VOTACIONES', '');
    for (const m of input.motions) {
      const r = m.results;
      lines.push(`- «${m.title}»: ${r.YES} votos a favor, ${r.NO} en contra y ${r.ABSTAIN} abstenciones (${r.total} votos emitidos, ${r.remote} a distancia). Resultado: ${motionOutcome(m)}.`);
    }
    lines.push('');
  }

  lines.push('Y no habiendo más asuntos que tratar, se levanta la sesión a las [hora], de lo que como Secretario doy fe, con el visto bueno del Presidente.', '');
  lines.push(`El Secretario: ${input.secretary ?? '[nombre]'}`, `Vº Bº El Presidente: ${input.president ?? '[nombre]'}`);
  return lines.join('\n');
}
