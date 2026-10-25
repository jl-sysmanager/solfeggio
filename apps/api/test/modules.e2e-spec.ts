import { addUser, auth, Band, createTestApp, resetDb, signupBand, TestCtx } from './helpers';

describe('Flujos de los módulos', () => {
  let ctx: TestCtx;
  let band: Band;
  let members: { id: string }[];

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.db);
    band = await signupBand(ctx, 'flow-band');
    members = [];
    for (const [i, [firstName, lastName, instrument]] of [['Lucía', 'García', 'Clarinete'], ['Javier', 'Martín', 'Trompeta'], ['Marta', 'López', 'Flauta']].entries()) {
      members.push((await ctx.http().post('/api/v1/members').set(auth(band.token)).send({ firstName, lastName, instrument, email: `socio${i}@flow.local` }).expect(201)).body);
    }
  });
  afterAll(() => ctx.app.close());

  describe('Secretaría', () => {
    it('numera socios, gestiona bajas y altas', async () => {
      // Los selectores de socios piden la plantilla entera (pageSize 500).
      await ctx.http().get('/api/v1/members?status=ACTIVE&pageSize=500').set(auth(band.token)).expect(200);
      const list = await ctx.http().get('/api/v1/members?q=garcia').set(auth(band.token)).expect(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].memberNumber).toBe(1);
      await ctx.http().post(`/api/v1/members/${members[2].id}/leave`).set(auth(band.token)).send({ date: '2026-06-30', reason: 'Traslado' }).expect(201);
      const active = await ctx.http().get('/api/v1/members?status=ACTIVE').set(auth(band.token)).expect(200);
      expect(active.body.total).toBe(2);
      await ctx.http().post(`/api/v1/members/${members[2].id}/rejoin`).set(auth(band.token)).expect(201);
    });

    it('RGPD: exporta y anonimiza conservando registros contables', async () => {
      const m = (await ctx.http().post('/api/v1/members').set(auth(band.token)).send({ firstName: 'Borrar', lastName: 'Me', email: 'borrar@flow.local', nationalId: '12345678Z' }).expect(201)).body;
      await ctx.http().post('/api/v1/finance/transactions').set(auth(band.token)).send({ kind: 'INCOME', amountCents: 1000, date: '2026-01-01', description: 'Donativo', memberId: m.id }).expect(201);
      const exp = await ctx.http().get(`/api/v1/members/${m.id}/export`).set(auth(band.token)).expect(200);
      expect(exp.body.member.email).toBe('borrar@flow.local');
      expect(exp.body.transactions).toHaveLength(1);
      const anon = await ctx.http().post(`/api/v1/members/${m.id}/anonymize`).set(auth(band.token)).expect(200);
      expect(anon.body).toMatchObject({ firstName: 'Socio', email: null, status: 'LEFT', nationalId: null });
      expect(anon.body.anonymizedAt).toBeTruthy();
      const tx = await ctx.http().get('/api/v1/finance/transactions').set(auth(band.token)).expect(200);
      expect(tx.body.data.some((t: { memberId: string }) => t.memberId === m.id)).toBe(true);
      await ctx.http().patch(`/api/v1/members/${m.id}`).set(auth(band.token)).send({ firstName: 'Vuelve' }).expect(400);
    });

    it('envía comunicaciones a una audiencia y encola la notificación', async () => {
      const res = await ctx.http().post('/api/v1/communications').set(auth(band.token)).send({ subject: 'Asamblea', body: 'Asamblea general el viernes', channel: 'EMAIL', audience: { all: true } }).expect(201);
      expect(res.body.recipients).toBe(3);
      const job = ctx.jobs.of('notify.fanout').find((j) => j.data.title === 'Asamblea')!;
      expect(job.data).toMatchObject({ email: true, tenantId: band.tenantId });
      expect(job.data.memberIds).toHaveLength(3);
    });

    it('gestiona documentos con subida prefirmada', async () => {
      const up = await ctx.http().post('/api/v1/documents/upload-url').set(auth(band.token)).send({ fileName: 'acta.pdf', mimeType: 'application/pdf', sizeBytes: 1000 }).expect(201);
      await ctx.http().post('/api/v1/documents').set(auth(band.token)).send({ ...up.body, title: 'Acta', category: 'actas', fileName: 'acta.pdf', mimeType: 'application/pdf', sizeBytes: 1000 }).expect(400);
      ctx.storage.objects.set(up.body.fileKey, 1000);
      const doc = await ctx.http().post('/api/v1/documents').set(auth(band.token)).send({ ...up.body, title: 'Acta', category: 'actas', fileName: 'acta.pdf', mimeType: 'application/pdf', sizeBytes: 1000 }).expect(201);
      const dl = await ctx.http().get(`/api/v1/documents/${doc.body.id}/download`).set(auth(band.token)).expect(200);
      expect(dl.body.url).toContain(up.body.fileKey);
      const t = await ctx.db.system.tenant.findUniqueOrThrow({ where: { id: band.tenantId } });
      expect(Number(t.storageUsedBytes)).toBe(1000);
      await ctx.http().delete(`/api/v1/documents/${doc.body.id}`).set(auth(band.token)).expect(204);
      expect(Number((await ctx.db.system.tenant.findUniqueOrThrow({ where: { id: band.tenantId } })).storageUsedBytes)).toBe(0);
    });
  });

  describe('Archivo musical', () => {
    it('busca ignorando tildes, por compositor y por etiqueta', async () => {
      const composer = (await ctx.http().post('/api/v1/composers').set(auth(band.token)).send({ name: 'Óscar Navarro' }).expect(201)).body;
      await ctx.http().post('/api/v1/works').set(auth(band.token)).send({ title: 'El Gato Montés', genre: 'Pasodoble', tags: ['pasodoble', 'zarzuela'] }).expect(201);
      await ctx.http().post('/api/v1/works').set(auth(band.token)).send({ title: 'Libertadores', composerId: composer.id, tags: ['certamen'] }).expect(201);
      await ctx.http().post('/api/v1/works').set(auth(band.token)).send({ title: 'Marcha Procesional', tags: ['marcha'] }).expect(201);

      const accent = await ctx.http().get('/api/v1/works?q=montes').set(auth(band.token)).expect(200);
      expect(accent.body.data.map((w: { title: string }) => w.title)).toEqual(['El Gato Montés']);
      const byComposer = await ctx.http().get('/api/v1/works?q=navarro').set(auth(band.token)).expect(200);
      expect(byComposer.body.data[0].title).toBe('Libertadores');
      const prefix = await ctx.http().get('/api/v1/works?q=Liber').set(auth(band.token)).expect(200);
      expect(prefix.body.total).toBe(1);
      const tag = await ctx.http().get('/api/v1/works?tag=marcha').set(auth(band.token)).expect(200);
      expect(tag.body.data[0].title).toBe('Marcha Procesional');
      const tags = await ctx.http().get('/api/v1/tags').set(auth(band.token)).expect(200);
      expect(tags.body).toEqual(expect.arrayContaining([{ tag: 'pasodoble', count: 1 }]));
    });

    it('versiones y archivos por instrumento', async () => {
      const work = (await ctx.http().post('/api/v1/works').set(auth(band.token)).send({ title: 'Paconchita' }).expect(201)).body;
      const version = (await ctx.http().post(`/api/v1/works/${work.id}/versions`).set(auth(band.token)).send({ name: 'Arreglo 2024' }).expect(201)).body;
      const up = await ctx.http().post(`/api/v1/works/${work.id}/assets/upload-url`).set(auth(band.token)).send({ fileName: 'clarinete.pdf', mimeType: 'application/pdf', sizeBytes: 500 }).expect(201);
      ctx.storage.objects.set(up.body.fileKey, 500);
      await ctx.http().post(`/api/v1/works/${work.id}/assets`).set(auth(band.token)).send({ ...up.body, kind: 'PART', instrument: 'Clarinete 1', versionId: version.id, fileName: 'clarinete.pdf', mimeType: 'application/pdf', sizeBytes: 500 }).expect(201);
      const detail = await ctx.http().get(`/api/v1/works/${work.id}`).set(auth(band.token)).expect(200);
      expect(detail.body.versions).toHaveLength(1);
      expect(detail.body.assets[0]).toMatchObject({ kind: 'PART', instrument: 'Clarinete 1', versionId: version.id });
    });

    it('un músico sólo ve las partituras de su instrumento y del secundario', async () => {
      const roles = (await ctx.http().get('/api/v1/roles').set(auth(band.token)).expect(200)).body as { key: string; permissions: string[] }[];
      const perms = (key: string) => roles.find((r) => r.key === key)!.permissions;
      expect(perms('director')).toContain('archive:all');
      expect(perms('archivist')).toContain('archive:all');
      expect(perms('material_manager')).toContain('archive:all');
      expect(perms('musician')).not.toContain('archive:all');
      expect(perms('secretary')).not.toContain('archive:all');
      expect(perms('teacher')).not.toContain('archive:all');

      const work = (await ctx.http().post('/api/v1/works').set(auth(band.token)).send({ title: 'Visibilidad' }).expect(201)).body;
      const file = async (kind: 'SCORE' | 'PART' | 'AUDIO', instrument: string | null, fileName: string) => {
        const mimeType = kind === 'AUDIO' ? 'audio/mpeg' : 'application/pdf';
        const up = await ctx.http().post(`/api/v1/works/${work.id}/assets/upload-url`).set(auth(band.token)).send({ fileName, mimeType, sizeBytes: 400 }).expect(201);
        ctx.storage.objects.set(up.body.fileKey, 400);
        return (await ctx.http().post(`/api/v1/works/${work.id}/assets`).set(auth(band.token)).send({ ...up.body, kind, instrument, fileName, mimeType, sizeBytes: 400 }).expect(201)).body as { id: string };
      };
      const score = await file('SCORE', null, 'guion.pdf');
      const clarinet = await file('PART', 'Clarinete 1º', 'cl.pdf');
      const trumpet = await file('PART', 'Trompeta', 'tp.pdf');
      const flute = await file('PART', 'Flauta', 'fl.pdf');
      const audio = await file('AUDIO', null, 'toma.mp3');

      const token = await addUser(ctx, band, 'musician', 'lucia-musico@flow.local', members[0].id);
      expect((await ctx.http().patch('/api/v1/auth/profile').set(auth(token)).send({ secondaryInstrument: 'Clarinete' }).expect(400)).body.code).toBe('SAME_INSTRUMENT');
      await ctx.http().patch('/api/v1/auth/profile').set(auth(token)).send({ secondaryInstrument: 'Flauta' }).expect(200);

      const seen = await ctx.http().get(`/api/v1/works/${work.id}`).set(auth(token)).expect(200);
      expect(seen.body.scoresLimited).toBe(true);
      expect(seen.body.assets.map((a: { id: string }) => a.id).sort()).toEqual([clarinet.id, flute.id, audio.id].sort());
      expect((await ctx.http().get(`/api/v1/assets/${trumpet.id}/download`).set(auth(token)).expect(403)).body.code).toBe('SCORE_FORBIDDEN');
      expect((await ctx.http().get(`/api/v1/assets/${score.id}/download`).set(auth(token)).expect(403)).body.code).toBe('SCORE_FORBIDDEN');
      await ctx.http().get(`/api/v1/assets/${clarinet.id}/download`).set(auth(token)).expect(200);

      const owner = await ctx.http().get(`/api/v1/works/${work.id}`).set(auth(band.token)).expect(200);
      expect(owner.body.scoresLimited).toBe(false);
      expect(owner.body.assets).toHaveLength(5);
    });
  });

  describe('Ensayos, asistencia y agenda', () => {
    let eventId: string;

    it('planifica, fija repertorio y convoca', async () => {
      const ev = await ctx.http().post('/api/v1/events').set(auth(band.token)).send({ type: 'PERFORMANCE', title: 'Concierto', location: 'Auditorio', startsAt: '2026-03-01T19:00:00Z', endsAt: '2026-03-01T21:00:00Z' }).expect(201);
      eventId = ev.body.id;
      await ctx.http().post('/api/v1/events').set(auth(band.token)).send({ type: 'REHEARSAL', title: 'Mal', startsAt: '2026-03-01T19:00:00Z', endsAt: '2026-03-01T18:00:00Z' }).expect(400);
      const works = (await ctx.http().get('/api/v1/works').set(auth(band.token))).body.data;
      const rep = await ctx.http().put(`/api/v1/events/${eventId}/repertoire`).set(auth(band.token)).send([{ workId: works[0].id }, { workId: works[1].id }]).expect(200);
      expect(rep.body.map((r: { position: number }) => r.position)).toEqual([0, 1]);
      const calls = await ctx.http().post(`/api/v1/events/${eventId}/calls`).set(auth(band.token)).send({ all: true }).expect(201);
      expect(calls.body.added).toBe(3);
      const again = await ctx.http().post(`/api/v1/events/${eventId}/calls`).set(auth(band.token)).send({ all: true }).expect(201);
      expect(again.body.added).toBe(0);
      expect(ctx.jobs.of('notify.fanout').some((j) => j.data.type === 'event.call')).toBe(true);
    });

    it('pasa lista y calcula estadísticas', async () => {
      await ctx.http().put(`/api/v1/events/${eventId}/attendance`).set(auth(band.token)).send([
        { memberId: members[0].id, status: 'PRESENT' },
        { memberId: members[1].id, status: 'LATE' },
        { memberId: members[2].id, status: 'ABSENT' },
      ]).expect(200);
      const stats = await ctx.http().get('/api/v1/attendance/stats').set(auth(band.token)).expect(200);
      expect(stats.body.overallRate).toBeCloseTo(0.667, 3);
      expect(stats.body.byMember[0].rate).toBe(0);
      expect(stats.body.byEvent[0]).toMatchObject({ present: 2, total: 3 });
      // Corregir la lista actualiza el registro, no lo duplica.
      await ctx.http().put(`/api/v1/events/${eventId}/attendance`).set(auth(band.token)).send([{ memberId: members[2].id, status: 'PRESENT' }]).expect(200);
      expect((await ctx.http().get('/api/v1/attendance/stats').set(auth(band.token))).body.overallRate).toBe(1);
    });

    it('la agenda unifica eventos y vencimientos', async () => {
      const fee = (await ctx.http().post('/api/v1/finance/fees').set(auth(band.token)).send({ name: 'Trimestral', amountCents: 1500, periodicity: 'QUARTERLY' }).expect(201)).body;
      await ctx.http().post(`/api/v1/finance/fees/${fee.id}/issue`).set(auth(band.token)).send({ period: '2026-Q1', dueDate: '2026-03-15' }).expect(201);
      const res = await ctx.http().get('/api/v1/agenda?from=2026-03-01T00:00:00Z&to=2026-03-31T23:59:59Z').set(auth(band.token)).expect(200);
      expect(res.body.map((i: { kind: string }) => i.kind)).toEqual(['event', 'fee_due']);
    });

    it('cancelar avisa a los convocados', async () => {
      await ctx.http().post(`/api/v1/events/${eventId}/cancel`).set(auth(band.token)).expect(200);
      expect(ctx.jobs.of('notify.fanout').some((j) => j.data.type === 'event.cancelled' && j.data.memberIds.length === 3)).toBe(true);
    });
  });

  describe('Tesorería', () => {
    it('emisión idempotente de cuotas, cobro e informe anual', async () => {
      const fee = (await ctx.http().post('/api/v1/finance/fees').set(auth(band.token)).send({ name: 'Anual', amountCents: 6000, periodicity: 'YEARLY' }).expect(201)).body;
      const first = await ctx.http().post(`/api/v1/finance/fees/${fee.id}/issue`).set(auth(band.token)).send({ period: '2026', dueDate: '2026-12-31' }).expect(201);
      expect(first.body.created).toBe(3);
      const second = await ctx.http().post(`/api/v1/finance/fees/${fee.id}/issue`).set(auth(band.token)).send({ period: '2026', dueDate: '2026-12-31' }).expect(201);
      expect(second.body).toEqual({ created: 0, skipped: 3 });

      const charges = await ctx.http().get('/api/v1/finance/charges?period=2026').set(auth(band.token)).expect(200);
      const charge = charges.body.data[0];
      await ctx.http().post(`/api/v1/finance/charges/${charge.id}/pay`).set(auth(band.token)).send({ date: '2026-05-10' }).expect(200);
      await ctx.http().post(`/api/v1/finance/charges/${charge.id}/pay`).set(auth(band.token)).send({ date: '2026-05-10' }).expect(400);

      const expense = (await ctx.http().get('/api/v1/finance/categories').set(auth(band.token))).body.find((c: { name: string }) => c.name === 'Partituras');
      await ctx.http().post('/api/v1/finance/transactions').set(auth(band.token)).send({ kind: 'EXPENSE', amountCents: 2500, date: '2026-05-12', description: 'Compra de partituras', categoryId: expense.id }).expect(201);
      await ctx.http().post('/api/v1/finance/transactions').set(auth(band.token)).send({ kind: 'INCOME', amountCents: 2500, date: '2026-05-12', description: 'Mal', categoryId: expense.id }).expect(400);

      const summary = await ctx.http().get('/api/v1/finance/reports/summary?year=2026').set(auth(band.token)).expect(200);
      expect(summary.body.monthly[4]).toEqual({ month: 5, incomeCents: 6000, expenseCents: 2500 });
      expect(summary.body.byCategory).toEqual(expect.arrayContaining([{ category: 'Cuotas de socios', kind: 'INCOME', totalCents: 6000 }]));

      const csv = await ctx.http().get('/api/v1/finance/reports/transactions.csv?year=2026').set(auth(band.token)).expect(200);
      expect(csv.text).toContain('fecha;tipo;categoria;descripcion;importe_eur');
      expect(csv.text).toContain('-25.00');
    });

    it('el CSV neutraliza fórmulas', async () => {
      await ctx.http().post('/api/v1/finance/transactions').set(auth(band.token)).send({ kind: 'INCOME', amountCents: 100, date: '2026-06-01', description: '=HYPERLINK("http://x")' }).expect(201);
      const csv = await ctx.http().get('/api/v1/finance/reports/transactions.csv?year=2026').set(auth(band.token)).expect(200);
      expect(csv.text).toContain(`"'=HYPERLINK(""http://x"")"`);
    });
  });

  describe('Mayordomía e instrumentación', () => {
    it('entrega y devuelve uniformes sin dobles entregas', async () => {
      const item = (await ctx.http().post('/api/v1/wardrobe/items').set(auth(band.token)).send({ code: 'CH-1', garment: 'Chaqueta', size: 'M' }).expect(201)).body;
      const loan = await ctx.http().post(`/api/v1/wardrobe/items/${item.id}/deliver`).set(auth(band.token)).send({ memberId: members[0].id, conditionOut: 'GOOD' }).expect(201);
      const twice = await ctx.http().post(`/api/v1/wardrobe/items/${item.id}/deliver`).set(auth(band.token)).send({ memberId: members[1].id, conditionOut: 'GOOD' }).expect(400);
      expect(twice.body.code).toBe('ITEM_NOT_AVAILABLE');
      await ctx.http().post(`/api/v1/wardrobe/loans/${loan.body.id}/return`).set(auth(band.token)).send({ conditionIn: 'DAMAGED' }).expect(200);
      const items = await ctx.http().get('/api/v1/wardrobe/items').set(auth(band.token)).expect(200);
      expect(items.body[0]).toMatchObject({ status: 'MAINTENANCE', condition: 'DAMAGED' });
      await ctx.http().put(`/api/v1/members/${members[0].id}/sizes`).set(auth(band.token)).send([{ garment: 'Chaqueta', size: 'M' }]).expect(200);
      const sizes = await ctx.http().get('/api/v1/wardrobe/sizes?garment=chaqueta').set(auth(band.token)).expect(200);
      expect(sizes.body).toHaveLength(1);
    });

    it('asigna instrumentos y registra reparaciones', async () => {
      const ins = (await ctx.http().post('/api/v1/instruments').set(auth(band.token)).send({ inventoryCode: 'T-1', type: 'Trompeta', brand: 'Bach' }).expect(201)).body;
      const a = await ctx.http().post(`/api/v1/instruments/${ins.id}/assign`).set(auth(band.token)).send({ memberId: members[1].id }).expect(201);
      await ctx.http().post(`/api/v1/instruments/${ins.id}/assign`).set(auth(band.token)).send({ memberId: members[0].id }).expect(400);
      await ctx.http().post(`/api/v1/instrument-assignments/${a.body.id}/end`).set(auth(band.token)).expect(200);
      const rep = await ctx.http().post(`/api/v1/instruments/${ins.id}/maintenance`).set(auth(band.token)).send({ type: 'REPAIR', description: 'Pistón atascado', costCents: 4000 }).expect(201);
      expect((await ctx.http().get(`/api/v1/instruments/${ins.id}`).set(auth(band.token))).body.status).toBe('MAINTENANCE');
      await ctx.http().post(`/api/v1/maintenance/${rep.body.id}/complete`).set(auth(band.token)).send({ costCents: 4500 }).expect(200);
      const detail = await ctx.http().get(`/api/v1/instruments/${ins.id}`).set(auth(band.token)).expect(200);
      expect(detail.body.status).toBe('AVAILABLE');
      expect(detail.body.maintenance[0].costCents).toBe(4500);
      expect(detail.body.assignments).toHaveLength(1);
    });
  });

  describe('BandMarket con moderación', () => {
    it('borrador → revisión → publicado por la plataforma → vendido', async () => {
      const manager = await addUser(ctx, band, 'material_manager', 'material@flow.local');
      const listing = (await ctx.http().post('/api/v1/market/listings').set(auth(manager)).send({ title: 'Bombardino', description: 'Bombardino en buen estado', category: 'Viento metal', condition: 'GOOD', priceCents: 90000 }).expect(201)).body;
      await ctx.http().post(`/api/v1/market/listings/${listing.id}/submit`).set(auth(manager)).expect(200);
      await ctx.http().patch(`/api/v1/market/listings/${listing.id}`).set(auth(manager)).send({ priceCents: 1 }).expect(400);

      await ctx.db.system.user.update({ where: { email: band.email }, data: { isPlatformAdmin: true } });
      const pending = await ctx.http().get('/api/v1/admin/market/pending').set(auth(band.token)).expect(200);
      expect(pending.body.pending).toHaveLength(1);
      await ctx.http().post(`/api/v1/admin/market/listings/${listing.id}/moderate`).set(auth(band.token)).send({ approve: true }).expect(200);

      const buyer = await signupBand(ctx, 'buyer-band');
      const browse = await ctx.http().get('/api/v1/market/listings?q=bombardino').set(auth(buyer.token)).expect(200);
      expect(browse.body.data[0]).toMatchObject({ title: 'Bombardino', seller: { name: 'Banda flow-band' } });
      await ctx.http().post(`/api/v1/market/listings/${listing.id}/report`).set(auth(buyer.token)).send({ reason: 'Precio sospechoso' }).expect(201);
      await ctx.http().post(`/api/v1/market/listings/${listing.id}/sold`).set(auth(manager)).expect(200);
      expect((await ctx.http().get('/api/v1/market/listings').set(auth(buyer.token))).body.total).toBe(0);
    });
  });

  it('notificaciones del usuario', async () => {
    await ctx.db.system.notification.create({ data: { tenantId: band.tenantId, userId: band.userId, type: 'test', title: 'Hola', body: 'Mundo' } });
    const list = await ctx.http().get('/api/v1/notifications?unread=true').set(auth(band.token)).expect(200);
    expect(list.body).toHaveLength(1);
    await ctx.http().post('/api/v1/notifications/read-all').set(auth(band.token)).expect(204);
    expect((await ctx.http().get('/api/v1/notifications?unread=true').set(auth(band.token))).body).toHaveLength(0);
  });

  it('health y métricas', async () => {
    await ctx.http().get('/api/v1/health').expect(200);
    await ctx.http().get('/api/v1/health/ready').expect(200);
    const metrics = await ctx.http().get('/api/v1/metrics').expect(200);
    expect(metrics.text).toContain('http_request_duration_seconds');
  });
});
