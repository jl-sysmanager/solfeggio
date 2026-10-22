import { buildIcs } from './ics';

describe('buildIcs', () => {
  const base = { id: 'e1', startsAt: new Date('2026-03-01T19:00:00Z'), endsAt: new Date('2026-03-01T21:00:00Z'), updatedAt: new Date('2026-02-01T10:00:00Z'), status: 'SCHEDULED' };

  it('genera un VEVENT válido con CRLF y escapes', () => {
    const ics = buildIcs('Banda', [{ ...base, title: 'Concierto; gala, 2026', location: 'Auditorio\nSala 1' }]);
    expect(ics).toContain('BEGIN:VCALENDAR\r\n');
    expect(ics).toContain('DTSTART:20260301T190000Z');
    expect(ics).toContain('SUMMARY:Concierto\; gala\\, 2026');
    expect(ics).toContain('LOCATION:Auditorio\\nSala 1');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('marca cancelados y pliega líneas largas a 75 octetos', () => {
    const ics = buildIcs('Banda', [{ ...base, title: 'Ñ'.repeat(100), status: 'CANCELLED' }]);
    expect(ics).toContain('STATUS:CANCELLED');
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  });
});
