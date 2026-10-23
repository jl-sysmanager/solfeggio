import { describe, expect, it } from 'vitest';
import { computeQuorum } from '../components/governance/AttendancePanel';
import { documentHtml } from '../components/governance/print';
import { minutesHtml } from '../components/governance/MinutesBookTab';
import { certificateHtml } from '../components/treasury/DonorsTab';

describe('quórum en directo', () => {
  it('cuenta presentes y delegaciones frente al porcentaje exigido', () => {
    const q = computeQuorum({ activeMembers: 7, quorumPct: 50 }, { a: ['x', 'y'], b: [] });
    expect(q).toMatchObject({ present: 2, represented: 2, total: 4, requiredFirstCall: 4, metFirstCall: true });
    expect(computeQuorum({ activeMembers: 7, quorumPct: 50 }, { a: [] }).metFirstCall).toBe(false);
  });
});

describe('vistas imprimibles', () => {
  it('escapa el HTML del acta', () => {
    const html = minutesHtml({ type: 'ORDINARY', title: '<b>Asamblea</b>', firstCallAt: '2026-11-10T18:00:00Z', minutes: 'Texto <script>x</script>', minutesApprovedAt: '' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;b&gt;Asamblea');
    expect(html).toContain('BORRADOR');
  });

  it('certificado con total y NIF del donante', () => {
    const html = certificateHtml({
      year: 2026,
      issuedAt: '2026-12-31T10:00:00Z',
      entity: { name: 'Banda', legalName: 'Asociación Musical', taxId: 'G12345678' },
      donor: { id: 'd', kind: 'PERSON', name: 'Ana', taxId: '12345678Z', taxIdHint: '78Z', hasTaxId: true, address: null, postalCode: null, province: '46', email: null, memberId: null, sponsor: false },
      donations: [{ id: '1', date: '2026-05-01', amountCents: 10_000, inKind: false, description: null }],
      totalCents: 10_000,
    });
    expect(html).toContain('Ley 49/2002');
    expect(html).toContain('12345678Z');
    expect(html).toMatch(/100,00/);
  });

  it('la cabecera del documento lleva la banda y escapa el nombre', () => {
    const html = documentHtml('Acta', '<p>Cuerpo</p>', { org: 'Banda <script>', logoUrl: 'https://ejemplo.test/logo.png' });
    expect(html).toContain('Banda &lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('https://ejemplo.test/logo.png');
    expect(html).toContain('Solfeamos');
    expect(html).toContain('<p>Cuerpo</p>');
  });
});
