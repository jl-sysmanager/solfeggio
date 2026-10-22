import { addUser, auth, Band, createTestApp, resetDb, signupBand, TestCtx } from './helpers';

describe('Tesorería: subvenciones, lotería y donantes', () => {
  let ctx: TestCtx;
  let band: Band;
  let other: Band;
  let memberId: string;
  let auditor: string;
  const ids: Record<string, string> = {};
  const api = '/api/v1/finance';
  const http = () => ctx.http();
  const tx = async (body: object) => (await http().post(`${api}/transactions`).set(auth(band.token)).send(body).expect(201)).body.id as string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.db);
    band = await signupBand(ctx, 'tes-band');
    other = await signupBand(ctx, 'tes-other');
    await ctx.db.system.tenant.update({ where: { id: band.tenantId }, data: { legalName: 'Asociación Musical Tes', taxId: 'G12345678' } });
    memberId = (await http().post('/api/v1/members').set(auth(band.token)).send({ firstName: 'Lucía', lastName: 'García' }).expect(201)).body.id;
    // Rol de consulta de tesorería sin acceso a datos sensibles.
    await ctx.db.system.role.create({ data: { tenantId: band.tenantId, key: 'auditor', name: 'Auditor', permissions: ['finance:read'] } });
    auditor = await addUser(ctx, band, 'auditor', 'auditor@tes.local');
  });
  afterAll(() => ctx.app.close());

  describe('Subvenciones', () => {
    it('imputa movimientos y calcula la justificación', async () => {
      const due = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
      ids.grant = (
        await http().post(`${api}/grants`).set(auth(band.token)).send({ name: 'Ayuda cultural', grantor: 'Diputación', year: 2026, awardedCents: 100_000, status: 'AWARDED', justificationDue: due }).expect(201)
      ).body.id;
      ids.grant2 = (await http().post(`${api}/grants`).set(auth(band.token)).send({ name: 'Otra', grantor: 'Ayuntamiento', year: 2026 }).expect(201)).body.id;
      const e1 = await tx({ kind: 'EXPENSE', amountCents: 30_000, date: '2026-03-01', description: '=SUM(A1:A9)' });
      const e2 = await tx({ kind: 'EXPENSE', amountCents: 25_000, date: '2026-04-01', description: 'Partituras' });
      const inc = await tx({ kind: 'INCOME', amountCents: 100_000, date: '2026-05-01', description: 'Cobro subvención' });
      ids.tx = e1;

      const linked = await http().post(`${api}/grants/${ids.grant}/transactions`).set(auth(band.token)).send({ transactionIds: [e1, e2, inc], linked: true }).expect(200);
      expect(linked.body).toMatchObject({ awardedCents: 100_000, expensesCents: 55_000, incomesCents: 100_000, pendingCents: 45_000 });
      expect(linked.body.expenses).toHaveLength(2);
      expect((await http().post(`${api}/grants/${ids.grant2}/transactions`).set(auth(band.token)).send({ transactionIds: [e1], linked: true }).expect(409)).body.code).toBe('TX_LINKED_OTHER_GRANT');

      await http().post(`${api}/grants/${ids.grant}/transactions`).set(auth(band.token)).send({ transactionIds: [e2], linked: false }).expect(200);
      const j = await http().get(`${api}/grants/${ids.grant}/justification`).set(auth(auditor)).expect(200);
      expect(j.body).toMatchObject({ expensesCents: 30_000, pendingCents: 70_000 });

      const csv = await http().get(`${api}/grants/${ids.grant}/justification.csv`).set(auth(auditor)).expect(200);
      expect(csv.text).toContain("'=SUM(A1:A9)");
      expect(csv.text).toContain('pendiente_justificar_eur;700.00');

      const list = await http().get(`${api}/grants?year=2026`).set(auth(auditor)).expect(200);
      const g = list.body.find((x: { id: string }) => x.id === ids.grant);
      expect(g).toMatchObject({ dueSoon: true, overdue: false, expensesCents: 30_000 });
      await http().post(`${api}/grants`).set(auth(auditor)).send({ name: 'X', grantor: 'Y', year: 2026 }).expect(403);
    });
  });

  describe('Lotería de Navidad', () => {
    it('valida el sorteo, liquida talonarios y resume la campaña', async () => {
      await http().post(`${api}/lottery/draws`).set(auth(band.token)).send({ name: 'Navidad 2026', drawDate: '2026-12-22', numbers: ['12345'], ticketPriceCents: 2000, stakeCents: 2500 }).expect(400);
      ids.draw = (await http().post(`${api}/lottery/draws`).set(auth(band.token)).send({ name: 'Navidad 2026', drawDate: '2026-12-22', numbers: ['12345'], ticketPriceCents: 2500, stakeCents: 2000 }).expect(201)).body.id;
      ids.book1 = (await http().post(`${api}/lottery/draws/${ids.draw}/books`).set(auth(band.token)).send({ code: 'T-01', number: '12345', memberId, tickets: 50 }).expect(201)).body.id;
      ids.book2 = (await http().post(`${api}/lottery/draws/${ids.draw}/books`).set(auth(band.token)).send({ code: 'T-02', holderName: 'Bar Pepe', tickets: 20 }).expect(201)).body.id;
      await http().post(`${api}/lottery/draws/${ids.draw}/books`).set(auth(band.token)).send({ code: 'T-03', tickets: 20 }).expect(400);
      await http().post(`${api}/lottery/draws/${ids.draw}/books`).set(auth(band.token)).send({ code: 'T-04', number: '99999', holderName: 'X', tickets: 20 }).expect(400);

      const settle = (body: object) => http().post(`${api}/lottery/books/${ids.book1}/settle`).set(auth(band.token)).send(body);
      expect((await settle({ returnedTickets: 10, paidCents: 200_000, date: '2026-12-15' }).expect(400)).body.code).toBe('OVERPAID');
      const s = await settle({ returnedTickets: 10, paidCents: 80_000, date: '2026-12-15' }).expect(200);
      expect(s.body).toMatchObject({ returnedTickets: 10, paidCents: 80_000 });
      const t = await ctx.db.system.transaction.findUniqueOrThrow({ where: { id: s.body.transactionId }, include: { category: true } });
      expect(t).toMatchObject({ kind: 'INCOME', amountCents: 80_000, memberId });
      expect(t.category?.name).toBe('Lotería');

      const sum = await http().get(`${api}/lottery/draws/${ids.draw}/summary`).set(auth(auditor)).expect(200);
      expect(sum.body).toMatchObject({
        ticketsIssued: 70, ticketsReturned: 10, ticketsSold: 60, expectedCents: 150_000, collectedCents: 80_000, pendingCents: 70_000,
        payToAdministrationCents: 120_000, surchargeCents: 30_000,
      });
      expect(sum.body.pendingByHolder).toEqual([
        { memberId: null, name: 'Bar Pepe', books: ['T-02'], pendingCents: 50_000 },
        { memberId, name: 'Lucía García', books: ['T-01'], pendingCents: 20_000 },
      ]);
      // Segunda liquidación parcial: reutiliza la categoría.
      await settle({ returnedTickets: 10, paidCents: 20_000, date: '2026-12-20' }).expect(200);
      expect(await ctx.db.system.financeCategory.count({ where: { tenantId: band.tenantId, name: 'Lotería' } })).toBe(1);
      await http().patch(`${api}/lottery/draws/${ids.draw}`).set(auth(band.token)).send({ ticketPriceCents: 3000 }).expect(409);
      await http().delete(`${api}/lottery/books/${ids.book1}`).set(auth(band.token)).expect(409);
    });
  });

  describe('Donantes y modelo 182', () => {
    it('cifra el NIF y sólo lo muestra con permiso de datos sensibles', async () => {
      const d = await http().post(`${api}/donors`).set(auth(band.token)).send({ name: 'Ana Donante', taxId: '12345678z', postalCode: '46001' }).expect(201);
      ids.donor = d.body.id;
      expect(d.body).toMatchObject({ taxId: '12345678Z', taxIdHint: '78Z', province: '46', kind: 'PERSON' });
      expect(d.body.taxIdEnc).toBeUndefined();
      const raw = await ctx.db.system.donor.findUniqueOrThrow({ where: { id: ids.donor } });
      expect(raw.taxIdEnc).not.toContain('12345678Z');
      const view = await http().get(`${api}/donors/${ids.donor}`).set(auth(auditor)).expect(200);
      expect(view.body.taxId).toBeUndefined();
      expect(view.body).toMatchObject({ taxIdHint: '78Z', hasTaxId: true });
      ids.company = (await http().post(`${api}/donors`).set(auth(band.token)).send({ kind: 'COMPANY', name: 'Hornos SL', taxId: 'B98765432', province: '03', sponsor: true }).expect(201)).body.id;
    });

    it('registra donativos y patrocinios con su ingreso', async () => {
      const add = (donor: string, body: object) => http().post(`${api}/donors/${donor}/donations`).set(auth(band.token)).send(body);
      await add(ids.donor, { date: '2024-05-01', amountCents: 5000 }).expect(201);
      await add(ids.donor, { date: '2025-05-01', amountCents: 5000 }).expect(201);
      const withTx = await add(ids.donor, { date: '2026-05-01', amountCents: 10_000, createTransaction: true }).expect(201);
      const t = await ctx.db.system.transaction.findUniqueOrThrow({ where: { id: withTx.body.transactionId }, include: { category: true } });
      expect(t.category?.name).toBe('Donativos');
      await add(ids.donor, { date: '2026-06-01', amountCents: 3000, inKind: true, description: 'Atriles' }).expect(201);
      expect((await add(ids.donor, { date: '2026-06-01', amountCents: 3000, inKind: true, createTransaction: true }).expect(400)).body.code).toBe('IN_KIND_NO_TRANSACTION');
      await add(ids.company, { date: '2026-02-01', amountCents: 20_000 }).expect(201);
      const sp = await add(ids.company, { kind: 'SPONSORSHIP', date: '2026-03-01', amountCents: 50_000, createTransaction: true }).expect(201);
      expect((await ctx.db.system.transaction.findUniqueOrThrow({ where: { id: sp.body.transactionId }, include: { category: true } })).category?.name).toBe('Patrocinios');
      await http().patch(`/api/v1/finance/donations/${withTx.body.id}`).set(auth(band.token)).send({ amountCents: 1 }).expect(409);
    });

    it('certificado anual de donativos', async () => {
      const c = await http().get(`${api}/donors/${ids.donor}/certificate?year=2026`).set(auth(band.token)).expect(200);
      expect(c.body).toMatchObject({ year: 2026, totalCents: 13_000, entity: { legalName: 'Asociación Musical Tes', taxId: 'G12345678' } });
      expect(c.body.donor.taxId).toBe('12345678Z');
      expect(c.body.donations).toHaveLength(2);
      const company = await http().get(`${api}/donors/${ids.company}/certificate?year=2026`).set(auth(band.token)).expect(200);
      expect(company.body.totalCents).toBe(20_000);
    });

    it('modelo 182: agrega donativos por donante, con recurrencia y permiso sensible', async () => {
      await http().get(`${api}/reports/modelo182.csv?year=2026`).set(auth(auditor)).expect(403);
      const res = await http().get(`${api}/reports/modelo182.csv?year=2026`).set(auth(band.token)).expect(200);
      const lines = res.text.replace(/^﻿/, '').trim().split('\n');
      expect(lines[0]).toContain('No es el fichero oficial de la AEAT');
      expect(lines[1]).toBe('nif;nombre;naturaleza;provincia;clave;importe_eur;en_especie;recurrente;avisos');
      expect(lines.slice(2).sort()).toEqual(
        ['12345678Z;Ana Donante;F;46;A;100.00;N;S;', '12345678Z;Ana Donante;F;46;A;30.00;S;S;', 'B98765432;Hornos SL;J;03;A;200.00;N;N;'].sort(),
      );
      const prev = await http().get(`${api}/reports/modelo182.csv?year=2025`).set(auth(band.token)).expect(200);
      expect(prev.text).toContain('12345678Z;Ana Donante;F;46;A;50.00;N;N;');
    });
  });

  describe('Aislamiento', () => {
    it('otra banda no ve ni referencia datos ajenos', async () => {
      const b = (path: string) => http().get(`${api}/${path}`).set(auth(other.token));
      await b(`grants/${ids.grant}`).expect(404);
      await b(`grants/${ids.grant}/justification`).expect(404);
      await b(`lottery/draws/${ids.draw}`).expect(404);
      await b(`donors/${ids.donor}`).expect(404);
      await b(`donors/${ids.donor}/certificate?year=2026`).expect(404);
      await http().post(`${api}/lottery/books/${ids.book2}/settle`).set(auth(other.token)).send({ returnedTickets: 0, paidCents: 0, date: '2026-12-01' }).expect(404);
      expect((await b('donors').expect(200)).body).toHaveLength(0);
      expect((await b('reports/modelo182.csv?year=2026').expect(200)).text).not.toContain('Ana Donante');

      const grant = (await http().post(`${api}/grants`).set(auth(other.token)).send({ name: 'B', grantor: 'B', year: 2026 }).expect(201)).body.id;
      await http().post(`${api}/grants/${grant}/transactions`).set(auth(other.token)).send({ transactionIds: [ids.tx], linked: true }).expect(404);
      const draw = (await http().post(`${api}/lottery/draws`).set(auth(other.token)).send({ name: 'B', drawDate: '2026-12-22', numbers: ['11111'], ticketPriceCents: 2500, stakeCents: 2000 }).expect(201)).body.id;
      await http().post(`${api}/lottery/draws/${draw}/books`).set(auth(other.token)).send({ code: 'X', memberId, tickets: 10 }).expect(404);
      await http().post(`${api}/donors`).set(auth(other.token)).send({ name: 'X', memberId }).expect(404);
      const t = await ctx.db.system.transaction.findUniqueOrThrow({ where: { id: ids.tx } });
      expect(t.grantId).toBe(ids.grant);
    });
  });
});
