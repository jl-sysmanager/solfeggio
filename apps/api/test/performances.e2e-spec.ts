import { addUser, auth, Band, createTestApp, resetDb, signupBand, TestCtx } from './helpers';

describe('Actuaciones: clientes, contratos, facturas, plantilla y logística', () => {
  let ctx: TestCtx;
  let a: Band;
  let b: Band;
  let free: Band;
  const ids: Record<string, string> = {};
  const http = () => ctx.http();

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.db);
    a = await signupBand(ctx, 'perf-a');
    b = await signupBand(ctx, 'perf-b');
    free = await signupBand(ctx, 'perf-free', 'FREE');
    await ctx.db.system.tenant.update({ where: { id: a.tenantId }, data: { taxId: 'G12345678', legalName: 'Asociación Musical A' } });
  });
  afterAll(() => ctx.app.close());

  describe('clientes y presupuestos', () => {
    it('crea clientes y presupuestos numerados con totales calculados en el servidor', async () => {
      const c = await http().post('/api/v1/performances/clients').set(auth(a.token)).send({ name: 'Ayuntamiento de Villa', kind: 'CITY_COUNCIL', taxId: 'p1234567a', email: '' }).expect(201);
      expect(c.body).toMatchObject({ taxId: 'P1234567A', email: null });
      ids.client = c.body.id;
      const q1 = await http()
        .post('/api/v1/performances/quotes')
        .set(auth(a.token))
        .send({
          clientId: ids.client, title: 'Procesión del Corpus', performanceAt: '2030-06-01T18:00:00Z', location: 'Plaza Mayor', taxRatePct: 21,
          lines: [{ description: 'Actuación banda completa', quantity: 1, unitCents: 150000 }, { description: 'Desplazamiento', quantity: 1.1, unitCents: 455 }],
          contractTerms: 'Plantilla mínima de 40 músicos.',
          // El cliente no puede fijar los totales.
          totalCents: 1,
        })
        .expect(201);
      expect(q1.body).toMatchObject({ number: 1, status: 'DRAFT', baseCents: 150501, taxCents: 31605, totalCents: 182106 });
      ids.quote = q1.body.id;
      const q2 = await http().post('/api/v1/performances/quotes').set(auth(a.token)).send({ clientId: ids.client, title: 'Fiestas', lines: [{ description: 'Pasacalles', quantity: 2, unitCents: 50000 }] }).expect(201);
      expect(q2.body.number).toBe(2);
      ids.quote2 = q2.body.id;
      const edited = await http().patch(`/api/v1/performances/quotes/${ids.quote2}`).set(auth(a.token)).send({ taxRatePct: 10 }).expect(200);
      expect(edited.body).toMatchObject({ baseCents: 100000, taxCents: 10000, totalCents: 110000 });
    });

    it('sólo se edita en borrador; firma como contrato y crea la actuación', async () => {
      await http().post(`/api/v1/performances/quotes/${ids.quote}/send`).set(auth(a.token)).expect(200);
      const locked = await http().patch(`/api/v1/performances/quotes/${ids.quote}`).set(auth(a.token)).send({ title: 'Otro' }).expect(400);
      expect(locked.body.code).toBe('QUOTE_LOCKED');
      await http().post(`/api/v1/performances/invoices`).set(auth(a.token)).send({ quoteId: ids.quote }).expect(400);
      const signed = await http().post(`/api/v1/performances/quotes/${ids.quote}/sign`).set(auth(a.token)).send({ signedBy: 'Alcaldesa' }).expect(200);
      expect(signed.body).toMatchObject({ status: 'ACCEPTED', signedBy: 'Alcaldesa', contractTerms: 'Plantilla mínima de 40 músicos.' });
      expect(signed.body.signedAt).toBeTruthy();
      await http().post(`/api/v1/performances/quotes/${ids.quote}/sign`).set(auth(a.token)).send({ signedBy: 'Otra' }).expect(400);
      const ev = await http().post(`/api/v1/performances/quotes/${ids.quote}/event`).set(auth(a.token)).send({}).expect(201);
      expect(ev.body).toMatchObject({ type: 'PERFORMANCE', title: 'Procesión del Corpus', location: 'Plaza Mayor', startsAt: '2030-06-01T18:00:00.000Z', endsAt: '2030-06-01T20:00:00.000Z' });
      ids.event = ev.body.id;
      const detail = await http().get(`/api/v1/performances/quotes/${ids.quote}`).set(auth(a.token)).expect(200);
      expect(detail.body.eventId).toBe(ids.event);
      await http().post(`/api/v1/performances/quotes/${ids.quote}/event`).set(auth(a.token)).send({}).expect(400);
    });

    it('un músico no puede gestionar actuaciones', async () => {
      const token = await addUser(ctx, a, 'musician', 'perf-musico@test.local');
      await http().get('/api/v1/performances/clients').set(auth(token)).expect(403);
      await http().post('/api/v1/performances/clients').set(auth(token)).send({ name: 'X' }).expect(403);
    });
  });

  describe('facturación encadenada (preparada para VeriFactu)', () => {
    it('emite desde un contrato y manualmente encadenando huellas', async () => {
      const i1 = await http().post('/api/v1/performances/invoices').set(auth(a.token)).send({ quoteId: ids.quote, issueDate: '2030-06-02' }).expect(201);
      expect(i1.body).toMatchObject({ series: 'A', number: 1, prevHash: null, totalCents: 182106, status: 'ISSUED', quoteId: ids.quote });
      expect(i1.body.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(i1.body.clientSnapshot).toMatchObject({ name: 'Ayuntamiento de Villa', taxId: 'P1234567A', issuer: { taxId: 'G12345678' } });
      ids.invoice = i1.body.id;
      const dup = await http().post('/api/v1/performances/invoices').set(auth(a.token)).send({ quoteId: ids.quote }).expect(400);
      expect(dup.body.code).toBe('QUOTE_ALREADY_INVOICED');
      const earlier = await http().post('/api/v1/performances/invoices').set(auth(a.token)).send({ clientId: ids.client, issueDate: '2030-01-01', lines: [{ description: 'X', quantity: 1, unitCents: 100 }] }).expect(400);
      expect(earlier.body.code).toBe('INVOICE_DATE_ORDER');
      const i2 = await http()
        .post('/api/v1/performances/invoices')
        .set(auth(a.token))
        .send({ clientId: ids.client, issueDate: '2030-06-03', taxRatePct: 21, lines: [{ description: 'Concierto de verano', quantity: 1, unitCents: 80000 }] })
        .expect(201);
      expect(i2.body).toMatchObject({ number: 2, prevHash: i1.body.hash, totalCents: 96800 });
      ids.invoice2 = i2.body.id;
      // El cliente cambia después: la factura conserva sus datos.
      await http().patch(`/api/v1/performances/clients/${ids.client}`).set(auth(a.token)).send({ name: 'Excmo. Ayuntamiento' }).expect(200);
      const got = await http().get(`/api/v1/performances/invoices/${ids.invoice2}`).set(auth(a.token)).expect(200);
      expect(got.body.clientSnapshot.name).toBe('Ayuntamiento de Villa');
      const v = await http().get('/api/v1/performances/invoices/verify?series=A').set(auth(a.token)).expect(200);
      expect(v.body).toMatchObject({ ok: true, count: 2, lastHash: i2.body.hash, breaks: [] });
    });

    it('cobra registrando el ingreso en «Actuaciones», anula y rectifica', async () => {
      const paid = await http().post(`/api/v1/performances/invoices/${ids.invoice}/pay`).set(auth(a.token)).send({ date: '2030-06-10' }).expect(200);
      expect(paid.body.status).toBe('PAID');
      const t = await ctx.db.system.transaction.findUniqueOrThrow({ where: { id: paid.body.transactionId }, include: { category: true } });
      expect(t).toMatchObject({ kind: 'INCOME', amountCents: 182106, tenantId: a.tenantId });
      expect(t.category?.name).toBe('Actuaciones');
      await http().post(`/api/v1/performances/invoices/${ids.invoice}/pay`).set(auth(a.token)).send({ date: '2030-06-10' }).expect(400);
      await http().post(`/api/v1/performances/invoices/${ids.invoice}/cancel`).set(auth(a.token)).expect(400);
      await http().post(`/api/v1/performances/invoices/${ids.invoice2}/cancel`).set(auth(a.token)).expect(200);

      const r = await http().post(`/api/v1/performances/invoices/${ids.invoice}/rectify`).set(auth(a.token)).send({ reason: 'Actuación reducida', issueDate: '2030-06-15' }).expect(201);
      expect(r.body).toMatchObject({ series: 'R', number: 1, rectifiesId: ids.invoice, totalCents: -182106, prevHash: null });
      await http().post(`/api/v1/performances/invoices/${ids.invoice}/rectify`).set(auth(a.token)).send({ reason: 'Otra vez' }).expect(400);
      await http().post(`/api/v1/performances/invoices/${r.body.id}/pay`).set(auth(a.token)).send({ date: '2030-06-20' }).expect(400);
      const detail = await http().get(`/api/v1/performances/invoices/${ids.invoice}`).set(auth(a.token)).expect(200);
      expect(detail.body.rectifiedBy).toHaveLength(1);
      const v = await http().get('/api/v1/performances/invoices/verify?series=R').set(auth(a.token)).expect(200);
      expect(v.body).toMatchObject({ ok: true, count: 1, allSeries: ['A', 'R'] });
    });

    it('las facturas emitidas son inalterables y no se pueden borrar con el rol de la aplicación', async () => {
      await expect(ctx.db.tenant(a.tenantId, (tx) => tx.clientInvoice.update({ where: { id: ids.invoice2 }, data: { totalCents: 1 } }))).rejects.toThrow(/immutable/);
      await expect(ctx.db.tenant(a.tenantId, (tx) => tx.$executeRaw`UPDATE client_invoices SET hash = 'x' WHERE id = ${ids.invoice2}::uuid`)).rejects.toThrow();
      await expect(ctx.db.tenant(a.tenantId, (tx) => tx.clientInvoice.delete({ where: { id: ids.invoice2 } }))).rejects.toThrow();
      const inv = await ctx.db.system.clientInvoice.findUniqueOrThrow({ where: { id: ids.invoice2 } });
      expect(inv.totalCents).toBe(96800);
    });

    it('la verificación detecta una manipulación hecha saltándose el trigger', async () => {
      await ctx.db.system.$transaction([
        ctx.db.system.$executeRawUnsafe('ALTER TABLE client_invoices DISABLE TRIGGER client_invoices_immutable'),
        ctx.db.system.$executeRaw`UPDATE client_invoices SET "totalCents" = 1 WHERE id = ${ids.invoice2}::uuid`,
        ctx.db.system.$executeRawUnsafe('ALTER TABLE client_invoices ENABLE TRIGGER client_invoices_immutable'),
      ]);
      const v = await http().get('/api/v1/performances/invoices/verify?series=A').set(auth(a.token)).expect(200);
      expect(v.body.ok).toBe(false);
      expect(v.body.breaks).toEqual([{ id: ids.invoice2, number: 2, reason: 'HASH_MISMATCH' }]);
    });
  });

  describe('plantilla mínima y logística', () => {
    const members: string[] = [];
    beforeAll(async () => {
      for (const [firstName, instrument] of [['Ana', 'Trompeta'], ['Luis', 'trompéta '], ['Eva', 'TROMPETA'], ['Pau', 'Clarinete'], ['Sol', 'Tuba']]) {
        members.push((await http().post('/api/v1/members').set(auth(a.token)).send({ firstName, lastName: 'Test', instrument }).expect(201)).body.id);
      }
      await http().post(`/api/v1/events/${ids.event}/calls`).set(auth(a.token)).send({ memberIds: [members[0], members[3], members[4]] }).expect(201);
      const call = await ctx.db.system.eventCall.findFirstOrThrow({ where: { eventId: ids.event, memberId: members[0] } });
      await ctx.db.system.eventCall.update({ where: { id: call.id }, data: { response: 'ACCEPTED' } });
      const decl = await ctx.db.system.eventCall.findFirstOrThrow({ where: { eventId: ids.event, memberId: members[3] } });
      await ctx.db.system.eventCall.update({ where: { id: decl.id }, data: { response: 'DECLINED' } });
    });

    it('calcula la cobertura por instrumento sin distinguir tildes ni mayúsculas', async () => {
      await http().put(`/api/v1/events/${ids.event}/requirements`).set(auth(a.token)).send([{ instrument: 'Trompeta', required: 3 }, { instrument: 'Trompeta', required: 1 }]).expect(400);
      await http().put(`/api/v1/events/${ids.event}/requirements`).set(auth(a.token)).send([{ instrument: 'Trompeta', required: 3 }, { instrument: 'Clarinete', required: 2 }, { instrument: 'Flauta', required: 1 }]).expect(200);
      const s = await http().get(`/api/v1/events/${ids.event}/staffing`).set(auth(a.token)).expect(200);
      const row = (i: string) => s.body.rows.find((r: { instrument: string }) => r.instrument === i);
      expect(row('Trompeta')).toMatchObject({ required: 3, accepted: 1, pending: 0, missing: 2 });
      expect(row('Clarinete')).toMatchObject({ required: 2, declined: 1, missing: 2 });
      expect(row('Flauta')).toMatchObject({ required: 1, missing: 1 });
      expect(row('Tuba')).toMatchObject({ required: 0, pending: 1, missing: 0 });
      expect(s.body.totals).toEqual({ required: 6, accepted: 1, missing: 5 });
    });

    it('avisa a los socios sin convocar de los instrumentos con vacantes y opcionalmente los convoca', async () => {
      ctx.jobs.added.length = 0;
      const r = await http().post(`/api/v1/events/${ids.event}/staffing/alert`).set(auth(a.token)).send({}).expect(200);
      expect(r.body.notified).toBe(2);
      expect(r.body.vacancies).toEqual(
        expect.arrayContaining([{ instrument: 'Trompeta', missing: 2, notified: 2 }, { instrument: 'Clarinete', missing: 2, notified: 0 }, { instrument: 'Flauta', missing: 1, notified: 0 }]),
      );
      const job = ctx.jobs.of('notify.fanout')[0];
      expect(job.data).toMatchObject({ tenantId: a.tenantId, type: 'event.vacancy' });
      expect(job.data.memberIds.sort()).toEqual([members[1], members[2]].sort());

      const called = await http().post(`/api/v1/events/${ids.event}/staffing/alert`).set(auth(a.token)).send({ call: true }).expect(200);
      expect(called.body.called).toBe(2);
      const s = await http().get(`/api/v1/events/${ids.event}/staffing`).set(auth(a.token)).expect(200);
      expect(s.body.rows.find((x: { instrument: string }) => x.instrument === 'Trompeta')).toMatchObject({ accepted: 1, pending: 2, missing: 0 });
    });

    it('guarda y lee la logística', async () => {
      const empty = await http().get(`/api/v1/events/${ids.event}/logistics`).set(auth(a.token)).expect(200);
      expect(empty.body).toMatchObject({ eventId: ids.event, transport: null });
      await http().put(`/api/v1/events/${ids.event}/logistics`).set(auth(a.token)).send({ departureAt: '2030-06-01T16:00:00Z', returnAt: '2030-06-01T15:00:00Z' }).expect(400);
      await http()
        .put(`/api/v1/events/${ids.event}/logistics`)
        .set(auth(a.token))
        .send({ transport: 'Autobús', departurePlace: 'Local social', departureAt: '2030-06-01T16:00:00Z', returnAt: '2030-06-01T22:00:00Z', uniform: 'Gala' })
        .expect(200);
      const got = await http().get(`/api/v1/events/${ids.event}/logistics`).set(auth(a.token)).expect(200);
      expect(got.body).toMatchObject({ transport: 'Autobús', uniform: 'Gala', departureAt: '2030-06-01T16:00:00.000Z' });
    });
  });

  describe('plan y aislamiento', () => {
    it('el plan FREE no incluye actuaciones', async () => {
      const r = await http().get('/api/v1/performances/clients').set(auth(free.token)).expect(403);
      expect(r.body.code).toBe('FEATURE_NOT_IN_PLAN');
      const ev = await http().post('/api/v1/events').set(auth(free.token)).send({ type: 'PERFORMANCE', title: 'X', startsAt: '2030-01-01T10:00:00Z', endsAt: '2030-01-01T11:00:00Z' }).expect(201);
      expect((await http().get(`/api/v1/events/${ev.body.id}/staffing`).set(auth(free.token)).expect(403)).body.code).toBe('FEATURE_NOT_IN_PLAN');
      await http().get(`/api/v1/events/${ev.body.id}/logistics`).set(auth(free.token)).expect(403);
    });

    it('la banda B no ve ni modifica clientes, presupuestos, facturas ni eventos de A', async () => {
      const B = auth(b.token);
      for (const url of [
        `/api/v1/performances/clients/${ids.client}`,
        `/api/v1/performances/quotes/${ids.quote}`,
        `/api/v1/performances/invoices/${ids.invoice}`,
        `/api/v1/events/${ids.event}/staffing`,
        `/api/v1/events/${ids.event}/logistics`,
      ]) {
        await http().get(url).set(B).expect(404);
      }
      expect((await http().get('/api/v1/performances/clients').set(B).expect(200)).body).toEqual([]);
      expect((await http().get('/api/v1/performances/invoices').set(B).expect(200)).body).toEqual([]);
      expect((await http().get('/api/v1/performances/invoices/verify?series=A').set(B).expect(200)).body).toMatchObject({ count: 0, ok: true });
      await http().patch(`/api/v1/performances/clients/${ids.client}`).set(B).send({ name: 'Hackeado' }).expect(404);
      await http().delete(`/api/v1/performances/clients/${ids.client}`).set(B).expect(404);
      await http().post(`/api/v1/performances/quotes/${ids.quote2}/sign`).set(B).send({ signedBy: 'Intruso' }).expect(404);
      await http().post(`/api/v1/performances/invoices/${ids.invoice}/pay`).set(B).send({ date: '2030-01-01' }).expect(404);
      await http().post(`/api/v1/performances/invoices/${ids.invoice}/rectify`).set(B).send({ reason: 'Intruso' }).expect(404);
      await http().put(`/api/v1/events/${ids.event}/requirements`).set(B).send([{ instrument: 'Tuba', required: 9 }]).expect(404);
      await http().put(`/api/v1/events/${ids.event}/logistics`).set(B).send({ transport: 'Hack' }).expect(404);
      await http().post(`/api/v1/events/${ids.event}/staffing/alert`).set(B).send({}).expect(404);
      // Referencias cruzadas en el cuerpo.
      await http().post('/api/v1/performances/quotes').set(B).send({ clientId: ids.client, title: 'X', lines: [{ description: 'X', quantity: 1, unitCents: 1 }] }).expect(404);
      await http().post('/api/v1/performances/invoices').set(B).send({ quoteId: ids.quote }).expect(404);
      await http().post('/api/v1/performances/invoices').set(B).send({ clientId: ids.client, lines: [{ description: 'X', quantity: 1, unitCents: 100 }] }).expect(404);
      const c = await ctx.db.system.client.findUniqueOrThrow({ where: { id: ids.client } });
      expect(c.name).toBe('Excmo. Ayuntamiento');
      const logistics = await ctx.db.system.eventLogistics.findUniqueOrThrow({ where: { eventId: ids.event } });
      expect(logistics.transport).toBe('Autobús');
    });
  });
});
