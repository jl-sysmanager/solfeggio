import { addUser, auth, Band, createTestApp, resetDb, signupBand, TestCtx } from './helpers';

describe('Bolsa de refuerzos', () => {
  let ctx: TestCtx;
  let a: Band;
  let b: Band;
  let c: Band;
  let free: Band;
  let bMusician: string;
  let aDirector: string;
  const ids: Record<string, string> = {};
  const http = () => ctx.http();
  const profile = (displayName: string, instruments = ['Trompeta']) => ({ displayName, instruments, province: 'Valencia', city: 'Xàtiva', bio: 'Titulada superior.' });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.db);
    a = await signupBand(ctx, 'reinf-a');
    b = await signupBand(ctx, 'reinf-b');
    c = await signupBand(ctx, 'reinf-c');
    free = await signupBand(ctx, 'reinf-free', 'FREE');
    bMusician = await addUser(ctx, b, 'musician', 'musico-b@test.local');
    aDirector = await addUser(ctx, a, 'director', 'director-a@test.local');
    ids.aEvent = (await http().post('/api/v1/events').set(auth(a.token)).send({ type: 'PERFORMANCE', title: 'Semana Santa', startsAt: '2030-04-10T18:00:00Z', endsAt: '2030-04-10T23:00:00Z' }).expect(201)).body.id;
    ids.bEvent = (await http().post('/api/v1/events').set(auth(b.token)).send({ type: 'PERFORMANCE', title: 'Evento B', startsAt: '2030-04-10T18:00:00Z', endsAt: '2030-04-10T23:00:00Z' }).expect(201)).body.id;
  });
  afterAll(() => ctx.app.close());

  it('el plan FREE no incluye la bolsa', async () => {
    const r = await http().get('/api/v1/reinforcements/requests').set(auth(free.token)).expect(403);
    expect(r.body.code).toBe('FEATURE_NOT_IN_PLAN');
  });

  it('cada usuario gestiona su perfil de músico global', async () => {
    expect((await http().get('/api/v1/reinforcements/profile').set(auth(b.token)).expect(200)).body).toEqual({ profile: null });
    await http().put('/api/v1/reinforcements/profile').set(auth(b.token)).send({ ...profile('Bea Trompeta'), instruments: [] }).expect(400);
    const p = await http().put('/api/v1/reinforcements/profile').set(auth(b.token)).send(profile('Bea Trompeta', ['Trompeta', 'Fliscorno', 'Trompeta'])).expect(200);
    expect(p.body.profile).toMatchObject({ displayName: 'Bea Trompeta', instruments: ['Trompeta', 'Fliscorno'], available: true, userId: b.userId });
    await http().put('/api/v1/reinforcements/profile').set(auth(c.token)).send(profile('Carlos Trompéta', ['trompeta'])).expect(200);
    await http().put('/api/v1/reinforcements/profile').set(auth(a.token)).send(profile('Ana de A')).expect(200);
  });

  it('la banda publica necesidades (con sugerencias desde la plantilla del evento)', async () => {
    await http().put(`/api/v1/events/${ids.aEvent}/requirements`).set(auth(a.token)).send([{ instrument: 'Trompeta', required: 4 }]).expect(200);
    const pre = await http().get(`/api/v1/reinforcements/requests/prefill?eventId=${ids.aEvent}`).set(auth(a.token)).expect(200);
    expect(pre.body.vacancies).toEqual([{ instrument: 'Trompeta', quantity: 4 }]);
    await http().get(`/api/v1/reinforcements/requests/prefill?eventId=${ids.bEvent}`).set(auth(a.token)).expect(404);
    const base = { title: 'Trompetas para Semana Santa', instrument: 'Trompeta', quantity: 2, date: '2030-04-10T18:00:00Z', province: 'Valencia', location: 'Xàtiva', feeCents: 8000 };
    await http().post('/api/v1/reinforcements/requests').set(auth(a.token)).send({ ...base, date: '2020-01-01T00:00:00Z' }).expect(400);
    await http().post('/api/v1/reinforcements/requests').set(auth(a.token)).send({ ...base, eventId: ids.bEvent }).expect(404);
    await http().post('/api/v1/reinforcements/requests').set(auth(bMusician)).send(base).expect(403);
    ids.request = (await http().post('/api/v1/reinforcements/requests').set(auth(a.token)).send({ ...base, eventId: ids.aEvent }).expect(201)).body.id;
    ids.cancelled = (await http().post('/api/v1/reinforcements/requests').set(auth(a.token)).send({ ...base, title: 'Cancelada', instrument: 'Tuba' }).expect(201)).body.id;
    await http().patch(`/api/v1/reinforcements/requests/${ids.cancelled}`).set(auth(a.token)).send({ status: 'CANCELLED' }).expect(200);
  });

  it('otras bandas ven las necesidades abiertas con el nombre de la banda', async () => {
    const r = await http().get('/api/v1/reinforcements/requests?instrument=trompeta&province=valencia').set(auth(bMusician)).expect(200);
    expect(r.body.total).toBe(1);
    expect(r.body.data[0]).toMatchObject({ id: ids.request, band: { name: 'Banda reinf-a' }, isMine: false, myApplication: null, feeCents: 8000 });
    expect(r.body.data[0].tenantId).toBeUndefined();
    expect(r.body.data[0].createdById).toBeUndefined();
    const none = await http().get('/api/v1/reinforcements/requests?province=Madrid').set(auth(b.token)).expect(200);
    expect(none.body.total).toBe(0);
    // La cancelada no es visible para otras bandas.
    await http().get('/api/v1/reinforcements/requests?instrument=tuba').set(auth(b.token)).expect(200).expect((res) => expect(res.body.total).toBe(0));
    const own = await http().get('/api/v1/reinforcements/requests').set(auth(a.token)).expect(200);
    expect(own.body.data[0].isMine).toBe(true);
  });

  it('los músicos de otras bandas se presentan; la banda publicadora recibe aviso', async () => {
    const noProfile = await http().post(`/api/v1/reinforcements/requests/${ids.request}/apply`).set(auth(bMusician)).send({ message: 'Hola' }).expect(400);
    expect(noProfile.body.code).toBe('PROFILE_REQUIRED');
    await http().put('/api/v1/reinforcements/profile').set(auth(bMusician)).send(profile('Marcos Músico')).expect(200);
    ctx.jobs.added.length = 0;
    const app = await http().post(`/api/v1/reinforcements/requests/${ids.request}/apply`).set(auth(b.token)).send({ message: 'Disponible toda la semana' }).expect(201);
    expect(app.body).toMatchObject({ status: 'PENDING', requestId: ids.request });
    ids.appB = app.body.id;
    const dup = await http().post(`/api/v1/reinforcements/requests/${ids.request}/apply`).set(auth(b.token)).send({}).expect(400);
    expect(dup.body.code).toBe('ALREADY_APPLIED');
    ids.appMusician = (await http().post(`/api/v1/reinforcements/requests/${ids.request}/apply`).set(auth(bMusician)).send({}).expect(201)).body.id;
    ids.appC = (await http().post(`/api/v1/reinforcements/requests/${ids.request}/apply`).set(auth(c.token)).send({}).expect(201)).body.id;
    expect((await http().post(`/api/v1/reinforcements/requests/${ids.request}/apply`).set(auth(a.token)).send({}).expect(400)).body.code).toBe('OWN_REQUEST');
    await http().post(`/api/v1/reinforcements/requests/${ids.cancelled}/apply`).set(auth(b.token)).send({}).expect(404);

    const job = ctx.jobs.of('notify.fanout').find((j) => j.data.type === 'reinforcement.application')!;
    expect(job.data.tenantId).toBe(a.tenantId);
    expect(job.data.userIds).toContain(a.userId);

    const browse = await http().get('/api/v1/reinforcements/requests').set(auth(b.token)).expect(200);
    expect(browse.body.data[0].myApplication).toBe('PENDING');
    const mine = await http().get('/api/v1/reinforcements/my-applications').set(auth(b.token)).expect(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0]).toMatchObject({ status: 'PENDING', request: { title: 'Trompetas para Semana Santa', band: { name: 'Banda reinf-a' } } });

    // Retirar y volver a presentarse.
    await http().post(`/api/v1/reinforcements/my-applications/${ids.appMusician}/withdraw`).set(auth(bMusician)).expect(200);
    await http().post(`/api/v1/reinforcements/my-applications/${ids.appMusician}/withdraw`).set(auth(b.token)).expect(404);
    await http().post(`/api/v1/reinforcements/requests/${ids.request}/apply`).set(auth(bMusician)).send({ message: 'Vuelvo' }).expect(201);
  });

  it('la banda ve las candidaturas con el perfil público, nunca el email', async () => {
    const r = await http().get(`/api/v1/reinforcements/requests/${ids.request}/applications`).set(auth(aDirector)).expect(200);
    expect(r.body).toHaveLength(3);
    expect(r.body.find((x: { id: string }) => x.id === ids.appB).musician).toMatchObject({ displayName: 'Bea Trompeta', province: 'Valencia' });
    const raw = JSON.stringify(r.body);
    expect(raw).not.toContain('@test.local');
    expect(raw).not.toContain(b.userId);
    const mine = await http().get('/api/v1/reinforcements/requests/mine').set(auth(a.token)).expect(200);
    expect(mine.body.find((x: { id: string }) => x.id === ids.request).applications).toEqual({ pending: 3, accepted: 0, rejected: 0 });
  });

  it('busca músicos disponibles y les envía propuestas sin revelar su email', async () => {
    const m = await http().get('/api/v1/reinforcements/musicians?instrument=TROMPETA&province=valencia').set(auth(aDirector)).expect(200);
    expect(m.body.map((p: { displayName: string }) => p.displayName).sort()).toEqual(['Ana de A', 'Bea Trompeta', 'Carlos Trompéta', 'Marcos Músico']);
    expect(JSON.stringify(m.body)).not.toMatch(/@|userId/);
    await http().get('/api/v1/reinforcements/musicians').set(auth(bMusician)).expect(403);
    const carlos = m.body.find((p: { displayName: string }) => p.displayName === 'Carlos Trompéta');
    ctx.jobs.added.length = 0;
    const sent = await http().post(`/api/v1/reinforcements/musicians/${carlos.id}/contact`).set(auth(aDirector)).send({ requestId: ids.request, message: 'Te esperamos en Xàtiva' }).expect(202);
    expect(sent.body).toEqual({ sent: true });
    const mail = ctx.jobs.of('email.send')[0];
    expect(mail.data.to).toBe(c.email);
    expect(mail.data.text).toContain('Te esperamos en Xàtiva');
    // B no puede usar una necesidad de A para contactar.
    await http().post(`/api/v1/reinforcements/musicians/${carlos.id}/contact`).set(auth(b.token)).send({ requestId: ids.request, message: 'Suplantación' }).expect(404);
    // Un perfil no disponible no se puede contactar.
    await http().put('/api/v1/reinforcements/profile').set(auth(c.token)).send({ ...profile('Carlos Trompéta'), available: false }).expect(200);
    await http().post(`/api/v1/reinforcements/musicians/${carlos.id}/contact`).set(auth(aDirector)).send({ requestId: ids.request, message: 'Otra vez' }).expect(404);
  });

  it('acepta y rechaza candidaturas; al cubrir las plazas la necesidad queda cubierta', async () => {
    ctx.jobs.added.length = 0;
    const acc = await http().post(`/api/v1/reinforcements/applications/${ids.appB}/accept`).set(auth(a.token)).expect(200);
    expect(acc.body).toMatchObject({ status: 'ACCEPTED', requestStatus: 'OPEN' });
    const ext = await ctx.db.system.externalMusician.findUniqueOrThrow({ where: { id: acc.body.musicianId } });
    expect(ext).toMatchObject({ tenantId: a.tenantId, userId: b.userId, firstName: 'Bea', lastName: 'Trompeta', email: b.email, instrument: 'Trompeta' });
    expect(ctx.jobs.of('email.send')[0].data).toMatchObject({ to: b.email });
    await http().post(`/api/v1/reinforcements/applications/${ids.appB}/accept`).set(auth(a.token)).expect(400);
    await http().post(`/api/v1/reinforcements/applications/${ids.appC}/reject`).set(auth(a.token)).expect(200);
    const filled = await http().post(`/api/v1/reinforcements/applications/${ids.appMusician}/accept`).set(auth(a.token)).expect(200);
    expect(filled.body.requestStatus).toBe('FILLED');
    const cApps = await http().get('/api/v1/reinforcements/my-applications').set(auth(c.token)).expect(200);
    expect(cApps.body[0].status).toBe('REJECTED');
    expect((await http().get('/api/v1/reinforcements/requests').set(auth(b.token)).expect(200)).body.total).toBe(0);
    await http().post(`/api/v1/reinforcements/requests/${ids.request}/apply`).set(auth(c.token)).send({}).expect(404);
    ids.musician = acc.body.musicianId;
  });

  it('músicos externos con NIF cifrado, visible sólo con members:sensitive', async () => {
    const m = await http()
      .post('/api/v1/reinforcements/external-musicians')
      .set(auth(a.token))
      .send({ firstName: 'Pedro', lastName: '=HYPERLINK("http://x")', instrument: 'Tuba', nationalId: '12345678z' })
      .expect(201);
    expect(m.body).toMatchObject({ nationalId: '12345678Z', hasNationalId: true });
    ids.pedro = m.body.id;
    const raw = await ctx.db.system.externalMusician.findUniqueOrThrow({ where: { id: ids.pedro } });
    expect(raw.nationalIdEnc).toMatch(/^v1:/);
    expect(raw.nationalIdEnc).not.toContain('12345678');
    const asDirector = await http().get('/api/v1/reinforcements/external-musicians').set(auth(aDirector)).expect(200);
    const pedro = asDirector.body.find((x: { id: string }) => x.id === ids.pedro);
    expect(pedro.nationalId).toBeUndefined();
    expect(pedro.hasNationalId).toBe(true);
    await http().patch(`/api/v1/reinforcements/external-musicians/${ids.pedro}`).set(auth(aDirector)).send({ nationalId: '00000000T' }).expect(400);
    await http().patch(`/api/v1/reinforcements/external-musicians/${ids.musician}`).set(auth(a.token)).send({ nationalId: '87654321X' }).expect(200);
  });

  it('pagos con retención, registro en tesorería y resumen anual para los modelos 111/190', async () => {
    const p1 = await http().post('/api/v1/reinforcements/payments').set(auth(aDirector)).send({ musicianId: ids.musician, eventId: ids.aEvent, concept: 'Semana Santa', date: '2030-04-11', grossCents: 20000 }).expect(201);
    expect(p1.body).toMatchObject({ withholdingPct: 15, withholdingCents: 3000, netCents: 17000 });
    const p2 = await http().post('/api/v1/reinforcements/payments').set(auth(a.token)).send({ musicianId: ids.pedro, concept: 'Corpus', date: '2030-06-01', grossCents: 10050, withholdingPct: 7 }).expect(201);
    expect(p2.body).toMatchObject({ withholdingCents: 704, netCents: 9346 });
    const p3 = await http().post('/api/v1/reinforcements/payments').set(auth(a.token)).send({ musicianId: ids.pedro, concept: 'Pendiente', date: '2030-07-01', grossCents: 5000 }).expect(201);
    ids.payment = p1.body.id;
    ids.pendingPayment = p3.body.id;

    const paid = await http().post(`/api/v1/reinforcements/payments/${p1.body.id}/pay`).set(auth(a.token)).send({ date: '2030-04-12' }).expect(200);
    const t = await ctx.db.system.transaction.findUniqueOrThrow({ where: { id: paid.body.transactionId }, include: { category: true } });
    expect(t).toMatchObject({ kind: 'EXPENSE', amountCents: 17000 });
    expect(t.category?.name).toBe('Refuerzos');
    await http().post(`/api/v1/reinforcements/payments/${p1.body.id}/pay`).set(auth(a.token)).send({ date: '2030-04-12' }).expect(400);
    await http().patch(`/api/v1/reinforcements/payments/${p1.body.id}`).set(auth(a.token)).send({ grossCents: 1 }).expect(400);
    await http().post(`/api/v1/reinforcements/payments/${p2.body.id}/pay`).set(auth(a.token)).send({ date: '2030-06-02' }).expect(200);
    await http().delete(`/api/v1/reinforcements/external-musicians/${ids.pedro}`).set(auth(a.token)).expect(400);

    const s = await http().get('/api/v1/reinforcements/payments/summary?year=2030').set(auth(a.token)).expect(200);
    expect(s.body.totals).toEqual({ grossCents: 30050, withholdingCents: 3704, netCents: 26346, perceptors: 2 });
    expect(s.body.rows.find((r: { musician: { id: string } }) => r.musician.id === ids.musician).musician.nationalId).toBe('87654321X');
    const sd = await http().get('/api/v1/reinforcements/payments/summary?year=2030').set(auth(aDirector)).expect(200);
    expect(JSON.stringify(sd.body)).not.toContain('87654321X');

    const csv = await http().get('/api/v1/reinforcements/payments/summary.csv?year=2030').set(auth(a.token)).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('2030;87654321X;Trompeta;Bea;Trompeta;1;200.00;30.00;170.00');
    expect(csv.text).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv.text).not.toContain('Pendiente');
    await http().get('/api/v1/reinforcements/payments/summary.csv?year=2030').set(auth(aDirector)).expect(403);
  });

  it('aislamiento: B no gestiona ni ve necesidades, candidaturas, músicos ni pagos de A', async () => {
    const B = auth(b.token);
    await http().get(`/api/v1/reinforcements/requests/${ids.request}/applications`).set(B).expect(404);
    await http().patch(`/api/v1/reinforcements/requests/${ids.request}`).set(B).send({ status: 'CANCELLED' }).expect(404);
    await http().delete(`/api/v1/reinforcements/requests/${ids.cancelled}`).set(B).expect(404);
    await http().post(`/api/v1/reinforcements/applications/${ids.appC}/accept`).set(B).expect(404);
    await http().post(`/api/v1/reinforcements/applications/${ids.appC}/reject`).set(B).expect(404);
    expect((await http().get('/api/v1/reinforcements/requests/mine').set(B).expect(200)).body).toEqual([]);
    expect((await http().get('/api/v1/reinforcements/external-musicians').set(B).expect(200)).body).toEqual([]);
    expect((await http().get('/api/v1/reinforcements/payments?year=2030').set(B).expect(200)).body).toEqual([]);
    expect((await http().get('/api/v1/reinforcements/payments/summary?year=2030').set(B).expect(200)).body.rows).toEqual([]);
    await http().patch(`/api/v1/reinforcements/external-musicians/${ids.pedro}`).set(B).send({ firstName: 'X' }).expect(404);
    await http().delete(`/api/v1/reinforcements/external-musicians/${ids.pedro}`).set(B).expect(404);
    await http().post(`/api/v1/reinforcements/payments/${ids.pendingPayment}/pay`).set(B).send({ date: '2030-07-02' }).expect(404);
    await http().delete(`/api/v1/reinforcements/payments/${ids.pendingPayment}`).set(B).expect(404);
    await http().post('/api/v1/reinforcements/payments').set(B).send({ musicianId: ids.pedro, concept: 'X', date: '2030-01-01', grossCents: 100 }).expect(404);
    await http().post('/api/v1/reinforcements/requests').set(B).send({ title: 'Robo', instrument: 'Tuba', date: '2030-05-01T10:00:00Z', province: 'Madrid', eventId: ids.aEvent }).expect(404);
    // Con el rol de la aplicación, B no puede leer candidaturas de A ni escribir necesidades de A.
    const rows = await ctx.db.tenant(b.tenantId, (tx) => tx.reinforcementApplication.findMany());
    expect(rows).toEqual([]);
    await expect(ctx.db.tenant(b.tenantId, (tx) => tx.reinforcementRequest.update({ where: { id: ids.cancelled }, data: { status: 'OPEN' } }))).rejects.toThrow();
    await expect(ctx.db.tenant(b.tenantId, (tx) => tx.$queryRaw`SELECT * FROM musician_profiles`)).rejects.toThrow();
    const pending = await ctx.db.system.reinforcementPayment.findUniqueOrThrow({ where: { id: ids.pendingPayment } });
    expect(pending.paidAt).toBeNull();
  });
});
