import { PDFDocument, StandardFonts } from 'pdf-lib';
import { auth, Band, createTestApp, resetDb, signupBand, TestCtx } from './helpers';

/** PDF de prueba: una página por texto (cabecera de la particella). */
async function makePdf(pages: string[]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const t of pages) {
    const p = doc.addPage([300, 400]);
    if (t) p.drawText(t, { x: 20, y: 370, size: 14, font });
    if (t) p.drawText('Marcha de prueba', { x: 20, y: 340, size: 10, font });
  }
  return doc.save();
}

const binary = (res: unknown, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  const stream = res as NodeJS.ReadableStream;
  stream.on('data', (c: Buffer) => chunks.push(c));
  stream.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('Archivo avanzado', () => {
  let ctx: TestCtx;
  let a: Band;
  let b: Band;
  let basic: Band;
  const works: Record<string, string> = {};

  const api = (band: Band) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(auth(band.token)),
    post: (url: string, body?: object) => ctx.http().post(`/api/v1${url}`).set(auth(band.token)).send(body),
    put: (url: string, body?: object) => ctx.http().put(`/api/v1${url}`).set(auth(band.token)).send(body),
    patch: (url: string, body?: object) => ctx.http().patch(`/api/v1${url}`).set(auth(band.token)).send(body),
    del: (url: string) => ctx.http().delete(`/api/v1${url}`).set(auth(band.token)),
  });

  async function uploadAsset(band: Band, workId: string, bytes: Uint8Array, kind: string, instrument?: string, mimeType = 'application/pdf') {
    const fileName = instrument ? `${instrument}.pdf` : 'guion.pdf';
    const up = await api(band).post(`/works/${workId}/assets/upload-url`, { fileName, mimeType, sizeBytes: bytes.byteLength }).expect(201);
    ctx.storage.put(up.body.fileKey, bytes);
    return (await api(band).post(`/works/${workId}/assets`, { ...up.body, fileName, mimeType, sizeBytes: bytes.byteLength, kind, instrument }).expect(201)).body;
  }
  const storageUsed = async (band: Band) => Number((await ctx.db.system.tenant.findUniqueOrThrow({ where: { id: band.tenantId } })).storageUsedBytes);

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.db);
    a = await signupBand(ctx, 'arch-a', 'PRO');
    b = await signupBand(ctx, 'arch-b', 'PRO');
    basic = await signupBand(ctx, 'arch-basic', 'BASIC');
    const composer = (await api(a).post('/composers', { name: 'Pérez Choví' }).expect(201)).body;
    for (const [key, title, durationSec] of [['amparito', 'Amparito Roca', 185], ['paquito', 'Paquito el Chocolatero', 200], ['nerja', '=Nerja', null]] as const) {
      works[key] = (await api(a).post('/works', { title, composerId: composer.id, durationSec, publisher: 'Piles', catalogCode: `M-${key}` }).expect(201)).body.id;
    }
  });
  afterAll(() => ctx.app.close());

  describe('informe SGAE', () => {
    beforeAll(async () => {
      const ev = async (type: string, title: string, day: string, repertoire: string[]) => {
        const e = (await api(a).post('/events', { type, title, location: 'Plaza Mayor', startsAt: `${day}T18:00:00.000Z`, endsAt: `${day}T20:00:00.000Z` }).expect(201)).body;
        await api(a).put(`/events/${e.id}/repertoire`, repertoire.map((workId) => ({ workId }))).expect(200);
        return e;
      };
      await ev('PERFORMANCE', 'Concierto de primavera', '2026-04-10', [works.amparito, works.paquito]);
      await ev('PERFORMANCE', 'Procesión', '2026-04-12', [works.nerja]);
      await ev('REHEARSAL', 'Ensayo general', '2026-04-09', [works.amparito]);
      const cancelled = await ev('PERFORMANCE', 'Pasacalle suspendido', '2026-04-11', [works.paquito]);
      await api(a).post(`/events/${cancelled.id}/cancel`).expect(200);
      await ev('PERFORMANCE', 'Fuera de rango', '2026-06-01', [works.paquito]);
    });

    it('agrupa actuaciones no canceladas con su repertorio y totales', async () => {
      const r = await api(a).get('/archive/reports/sgae?from=2026-04-01&to=2026-04-30').expect(200);
      expect(r.body.events.map((e: { title: string }) => e.title)).toEqual(['Concierto de primavera', 'Procesión']);
      expect(r.body.events[0].works.map((w: { title: string }) => w.title)).toEqual(['Amparito Roca', 'Paquito el Chocolatero']);
      expect(r.body.events[0].works[0]).toMatchObject({ composer: 'Pérez Choví', duration: '3:05', publisher: 'Piles', catalogCode: 'M-amparito' });
      expect(r.body.totals).toMatchObject({ performances: 2, works: 3, durationSec: 385, duration: '6:25', missingDuration: 1 });
    });

    it('exporta CSV con BOM, punto y coma y fórmulas neutralizadas', async () => {
      const r = await api(a).get('/archive/reports/sgae?from=2026-04-01&to=2026-04-30&format=csv').expect(200);
      expect(r.headers['content-type']).toContain('text/csv');
      expect(r.headers['content-disposition']).toContain('repertorio-sgae-2026-04-01-2026-04-30.csv');
      expect(r.text.charCodeAt(0)).toBe(0xfeff);
      const lines = r.text.slice(1).trim().split('\n');
      expect(lines[0]).toBe('fecha;acto;lugar;obra;compositor;arreglista;duracion;editorial;signatura');
      expect(lines).toHaveLength(4);
      expect(lines[3]).toContain(";'=Nerja;");
    });

    it('valida el rango de fechas', async () => {
      await api(a).get('/archive/reports/sgae?from=2026-05-01&to=2026-04-01').expect(400);
    });
  });

  describe('particellas', () => {
    let score: { id: string; sizeBytes: number };

    beforeAll(async () => {
      const pdf = await makePdf(['Clarinete 1º en Sib', '', 'Clarinete 2º en Sib', 'Trompeta 1', 'Trompeta 1', 'Tuba']);
      score = await uploadAsset(a, works.amparito, pdf, 'SCORE');
    });

    it('detecta instrumentos y agrupa páginas consecutivas', async () => {
      const r = await api(a).post(`/works/${works.amparito}/assets/${score.id}/detect-parts`).expect(200);
      expect(r.body).toMatchObject({ pages: 6, ocrRequired: false });
      expect(r.body.suggestions.map((s: { instrument: string; fromPage: number; toPage: number }) => [s.instrument, s.fromPage, s.toPage])).toEqual([
        ['Clarinete 1º', 1, 2],
        ['Clarinete 2º', 3, 3],
        ['Trompeta 1º', 4, 5],
        ['Tuba', 6, 6],
      ]);
      expect(r.body.suggestions[0].confidence).toBeLessThan(r.body.suggestions[1].confidence);
    });

    it('marca los PDF escaneados (sin texto) como pendientes de OCR', async () => {
      const scan = await uploadAsset(a, works.paquito, await makePdf(['', '']), 'SCORE');
      const r = await api(a).post(`/works/${works.paquito}/assets/${scan.id}/detect-parts`).expect(200);
      expect(r.body).toEqual({ pages: 2, ocrRequired: true, suggestions: [] });
    });

    it('divide el PDF en particellas, sube los ficheros y consume cuota', async () => {
      const before = await storageUsed(a);
      await api(a).post(`/works/${works.amparito}/assets/${score.id}/split`, { parts: [{ instrument: 'Clarinete 1º', fromPage: 1, toPage: 7 }] }).expect(400);
      await api(a).post(`/works/${works.amparito}/assets/${score.id}/split`, { parts: [{ instrument: 'Clarinete 1º', fromPage: 3, toPage: 2 }] }).expect(400);
      const r = await api(a).post(`/works/${works.amparito}/assets/${score.id}/split`, {
        parts: [
          { instrument: 'Clarinete 1º', fromPage: 1, toPage: 2 },
          { instrument: 'Trompeta 1º', fromPage: 4, toPage: 5 },
        ],
      }).expect(201);
      expect(r.body).toHaveLength(2);
      expect(r.body[0]).toMatchObject({ kind: 'PART', instrument: 'Clarinete 1º', mimeType: 'application/pdf' });
      expect(r.body[0].fileKey).toMatch(new RegExp(`^tenants/${a.tenantId}/archive/`));
      const part = await PDFDocument.load(await ctx.storage.getObject(r.body[0].fileKey));
      expect(part.getPageCount()).toBe(2);
      const added = r.body.reduce((s: number, x: { sizeBytes: number }) => s + x.sizeBytes, 0);
      expect(await storageUsed(a)).toBe(before + added);
      const log = await ctx.db.system.auditLog.findFirst({ where: { tenantId: a.tenantId, action: 'asset.split' } });
      expect(log?.entityId).toBe(score.id);
    });

    it('rechaza dividir particellas o ficheros que no son PDF', async () => {
      const assets = (await api(a).get(`/works/${works.amparito}`).expect(200)).body.assets;
      const part = assets.find((x: { kind: string }) => x.kind === 'PART');
      const r = await api(a).post(`/works/${works.amparito}/assets/${part.id}/detect-parts`).expect(400);
      expect(r.body.code).toBe('INVALID_ASSET_KIND');
    });

    it('sólo está disponible en planes con archive_ai', async () => {
      const w = (await api(basic).post('/works', { title: 'Obra básica' }).expect(201)).body;
      const s = await uploadAsset(basic, w.id, await makePdf(['Flauta']), 'SCORE');
      const r = await api(basic).post(`/works/${w.id}/assets/${s.id}/detect-parts`).expect(403);
      expect(r.body.code).toBe('FEATURE_NOT_IN_PLAN');
      await api(basic).post(`/works/${w.id}/assets/${s.id}/split`, { parts: [{ instrument: 'Flauta', fromPage: 1, toPage: 1 }] }).expect(403);
      await api(basic).get('/booklets').expect(200);
    });
  });

  describe('libretos de marchas', () => {
    let bookletId: string;

    beforeAll(async () => {
      await uploadAsset(a, works.paquito, await makePdf(['Clarinete 1', 'Clarinete 1']), 'PART', 'Clarinete 1º');
      await uploadAsset(a, works.nerja, await makePdf(['Flauta']), 'PART', 'Flauta');
      await uploadAsset(a, works.nerja, new Uint8Array(500), 'PART', 'Clarinete 1º', 'image/png');
    });

    it('crea, renombra y ordena marchas', async () => {
      const bk = (await api(a).post('/booklets', { name: 'Semana Santa' }).expect(201)).body;
      bookletId = bk.id;
      await api(a).post('/booklets', { name: 'semana santa' }).expect(400);
      await api(a).patch(`/booklets/${bookletId}`, { description: 'Procesiones' }).expect(200);
      await api(a).put(`/booklets/${bookletId}/items`, [{ workId: works.paquito }, { workId: works.paquito }]).expect(400);
      const r = await api(a).put(`/booklets/${bookletId}/items`, [
        { workId: works.nerja, label: '1' },
        { workId: works.amparito, label: '2' },
        { workId: works.paquito, label: '3' },
      ]).expect(200);
      expect(r.body.items.map((i: { work: { title: string } }) => i.work.title)).toEqual(['=Nerja', 'Amparito Roca', 'Paquito el Chocolatero']);
      const list = await api(a).get('/booklets').expect(200);
      expect(list.body[0]._count.items).toBe(3);
    });

    it('lista instrumentos con particella PDF y su cobertura', async () => {
      const r = await api(a).get(`/booklets/${bookletId}/instruments`).expect(200);
      expect(r.body).toEqual([
        { instrument: 'Clarinete 1º', works: 2, total: 3 },
        { instrument: 'Flauta', works: 1, total: 3 },
        { instrument: 'Trompeta 1º', works: 1, total: 3 },
      ]);
    });

    it('genera el PDF combinado con índice, en orden y sin importar tildes ni mayúsculas', async () => {
      const r = await api(a).get(`/booklets/${bookletId}/pdf?instrument=${encodeURIComponent('CLARINETE 1')}`).buffer(true).parse(binary).expect(200);
      expect(r.headers['content-type']).toBe('application/pdf');
      expect(r.headers['content-disposition']).toMatch(/^attachment;/);
      const pdf = await PDFDocument.load(r.body);
      // Índice + Amparito (2 páginas de clarinete) + Paquito (2); Nerja sólo tiene PNG: falta.
      expect(pdf.getPageCount()).toBe(5);
      const { extractPages } = await import('../src/archive/parts');
      const text = await extractPages(r.body);
      expect(text[0]).toContain('Semana Santa');
      expect(text[0]).toMatch(/=Nerja[\s\S]*falta/);
      expect(text[1]).toContain('Clarinete 1º en Sib');
      expect(text[3]).toContain('Clarinete 1');
      await api(a).get(`/booklets/${bookletId}/pdf?instrument=Oboe`).expect(404);
    });

    it('borra el libreto', async () => {
      const bk = (await api(a).post('/booklets', { name: 'Temporal' }).expect(201)).body;
      await api(a).del(`/booklets/${bk.id}`).expect(204);
      await api(a).get(`/booklets/${bk.id}`).expect(404);
    });
  });

  describe('préstamos de partituras', () => {
    let lent: { id: string };

    it('registra préstamos, detecta retrasos y marca devoluciones', async () => {
      lent = (await api(a).post('/score-loans', { workId: works.amparito, direction: 'LENT', counterparty: 'Banda de Llíria', loanedAt: '2026-01-10', dueAt: '2026-02-10' }).expect(201)).body;
      expect(lent).toMatchObject({ overdue: true, returnedAt: null });
      await api(a).post('/score-loans', { workId: works.paquito, direction: 'BORROWED', counterparty: 'Unión Musical', loanedAt: '2026-01-10', dueAt: '2099-01-01' }).expect(201);
      await api(a).post('/score-loans', { workId: works.paquito, direction: 'BORROWED', counterparty: 'X', loanedAt: '2026-02-10', dueAt: '2026-01-01' }).expect(400);
      expect((await api(a).get('/score-loans?status=overdue').expect(200)).body).toHaveLength(1);
      expect((await api(a).get('/score-loans?status=open').expect(200)).body).toHaveLength(2);
      expect((await api(a).get(`/works/${works.amparito}/loans`).expect(200)).body).toHaveLength(1);
      await api(a).patch(`/score-loans/${lent.id}`, { contact: 'archivo@lliria.test' }).expect(200);
      const ret = await api(a).post(`/score-loans/${lent.id}/return`, { date: '2026-02-20' }).expect(200);
      expect(ret.body).toMatchObject({ overdue: false });
      expect(ret.body.returnedAt).toMatch(/^2026-02-20/);
      await api(a).post(`/score-loans/${lent.id}/return`, {}).expect(400);
      expect((await api(a).get('/score-loans?status=overdue').expect(200)).body).toHaveLength(0);
      expect((await api(a).get('/score-loans?status=returned').expect(200)).body).toHaveLength(1);
    });
  });

  describe('aislamiento entre bandas', () => {
    it('B no ve ni modifica libretos, préstamos ni ficheros de A', async () => {
      const bkA = (await api(a).get('/booklets').expect(200)).body[0];
      await api(b).get(`/booklets/${bkA.id}`).expect(404);
      await api(b).get(`/booklets/${bkA.id}/instruments`).expect(404);
      await api(b).get(`/booklets/${bkA.id}/pdf?instrument=Flauta`).expect(404);
      await api(b).put(`/booklets/${bkA.id}/items`, []).expect(404);
      await api(b).del(`/booklets/${bkA.id}`).expect(404);
      const loanA = (await api(a).get('/score-loans').expect(200)).body[0];
      await api(b).post(`/score-loans/${loanA.id}/return`, {}).expect(404);
      await api(b).patch(`/score-loans/${loanA.id}`, { notes: 'x' }).expect(404);
      expect((await api(b).get('/score-loans').expect(200)).body).toHaveLength(0);
      await api(b).get(`/works/${works.amparito}/loans`).expect(404);
      await api(b).post('/score-loans', { workId: works.amparito, direction: 'LENT', counterparty: 'X', loanedAt: '2026-01-01' }).expect(404);
      const scoreA = (await api(a).get(`/works/${works.amparito}`).expect(200)).body.assets.find((x: { kind: string }) => x.kind === 'SCORE');
      await api(b).post(`/works/${works.amparito}/assets/${scoreA.id}/detect-parts`).expect(404);
      const wB = (await api(b).post('/works', { title: 'Obra B' }).expect(201)).body;
      await api(b).post(`/works/${wB.id}/assets/${scoreA.id}/split`, { parts: [{ instrument: 'Flauta', fromPage: 1, toPage: 1 }] }).expect(404);
    });

    it('B no puede añadir obras de A a su libreto y su informe no incluye datos de A', async () => {
      const bkB = (await api(b).post('/booklets', { name: 'Semana Santa' }).expect(201)).body;
      await api(b).put(`/booklets/${bkB.id}/items`, [{ workId: works.amparito }]).expect(404);
      const r = await api(b).get('/archive/reports/sgae?from=2026-01-01&to=2026-12-31').expect(200);
      expect(r.body.totals.performances).toBe(0);
    });
  });
});
