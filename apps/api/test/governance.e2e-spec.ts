import { addUser, auth, Band, createTestApp, resetDb, signupBand, TestCtx } from './helpers';

describe('Gobierno de la asociación', () => {
  let ctx: TestCtx;
  let band: Band;
  let other: Band;
  const m: string[] = [];
  const voter: string[] = [];
  const api = '/api/v1/governance';
  let assemblyId: string;
  let remoteMotion: string;
  let roomMotion: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.db);
    band = await signupBand(ctx, 'gov-band');
    other = await signupBand(ctx, 'gov-other');
    for (let i = 0; i < 6; i++) {
      m.push((await ctx.http().post('/api/v1/members').set(auth(band.token)).send({ firstName: `Socio${i}`, lastName: `Apellido${i}` }).expect(201)).body.id);
    }
    for (let i = 0; i < 5; i++) voter.push(await addUser(ctx, band, 'musician', `voter${i}@gov.local`, m[i]));
  });
  afterAll(() => ctx.app.close());

  const http = () => ctx.http();

  describe('Asambleas', () => {
    it('crea, valida convocatorias y convoca notificando a los socios activos', async () => {
      await http().post(`${api}/assemblies`).set(auth(band.token)).send({ type: 'ORDINARY', title: 'X', firstCallAt: '2026-11-10T18:00:00Z', secondCallAt: '2026-11-10T17:00:00Z' }).expect(400);
      await http().post(`${api}/assemblies`).set(auth(voter[0])).send({ type: 'ORDINARY', title: 'X', firstCallAt: '2026-11-10T18:00:00Z' }).expect(403);
      const a = await http()
        .post(`${api}/assemblies`)
        .set(auth(band.token))
        .send({
          type: 'ORDINARY', title: 'Asamblea anual 2026', firstCallAt: '2026-11-10T18:00:00Z', secondCallAt: '2026-11-10T18:30:00Z', location: 'Casa de la Música',
          agenda: [{ title: 'Aprobación de cuentas' }, { title: 'Ruegos y preguntas' }], quorumPct: 50,
        })
        .expect(201);
      assemblyId = a.body.id;
      await http().patch(`${api}/assemblies/${assemblyId}`).set(auth(band.token)).send({ location: 'Auditorio municipal' }).expect(200);
      await http().put(`${api}/assemblies/${assemblyId}/attendance`).set(auth(band.token)).send([{ memberId: m[0] }]).expect(409);
      await http().post(`${api}/assemblies/${assemblyId}/convene`).set(auth(band.token)).expect(200);
      await http().post(`${api}/assemblies/${assemblyId}/convene`).set(auth(band.token)).expect(409);
      const job = ctx.jobs.of('notify.fanout').find((j) => j.data.type === 'assembly.convened')!;
      expect(job.data).toMatchObject({ email: true, tenantId: band.tenantId });
      expect(job.data.memberIds).toHaveLength(6);
      expect(job.data.body).toContain('Aprobación de cuentas');
      expect(job.data.body).toContain('Auditorio municipal');
      expect(job.data.body).toContain('Segunda convocatoria');
      const list = await http().get(`${api}/assemblies`).set(auth(voter[0])).expect(200);
      expect(list.body[0]).toMatchObject({ status: 'CONVENED', title: 'Asamblea anual 2026' });
    });

    it('valida delegaciones y calcula el quórum', async () => {
      const put = (body: object) => http().put(`${api}/assemblies/${assemblyId}/attendance`).set(auth(band.token)).send(body);
      expect((await put([{ memberId: m[0], proxyForId: m[3] }, { memberId: m[0], proxyForId: m[4] }, { memberId: m[0], proxyForId: m[5] }]).expect(400)).body.code).toBe('PROXY_LIMIT');
      expect((await put([{ memberId: m[0], proxyForId: m[1] }, { memberId: m[1] }]).expect(400)).body.code).toBe('PROXY_PRESENT');
      expect((await put([{ memberId: m[0], proxyForId: m[3] }, { memberId: m[1], proxyForId: m[3] }]).expect(400)).body.code).toBe('PROXY_DUPLICATE');
      const left = (await http().post('/api/v1/members').set(auth(band.token)).send({ firstName: 'Baja', lastName: 'Socia' }).expect(201)).body.id;
      await http().post(`/api/v1/members/${left}/leave`).set(auth(band.token)).send({ date: '2026-01-01' }).expect(201);
      expect((await put([{ memberId: m[0], proxyForId: left }]).expect(400)).body.code).toBe('MEMBER_NOT_ACTIVE');

      const q = (await put([{ memberId: m[0], proxyForId: m[3] }, { memberId: m[0], proxyForId: m[4] }, { memberId: m[1] }]).expect(200)).body;
      // 6 activos, 50 % → 3 necesarios; 2 presentes + 2 representados.
      expect(q).toMatchObject({ activeMembers: 6, present: 2, represented: 2, total: 4, requiredFirstCall: 3, metFirstCall: true });
      const q2 = await http().get(`${api}/assemblies/${assemblyId}/quorum`).set(auth(voter[2])).expect(200);
      expect(q2.body.total).toBe(4);
    });
  });

  describe('Votaciones', () => {
    it('sólo abre votaciones de asambleas convocadas', async () => {
      const draft = (await http().post(`${api}/assemblies`).set(auth(band.token)).send({ type: 'EXTRAORDINARY', title: 'Borrador', firstCallAt: '2026-12-01T18:00:00Z' }).expect(201)).body;
      const mo = (await http().post(`${api}/assemblies/${draft.id}/motions`).set(auth(band.token)).send({ title: 'Prueba' }).expect(201)).body;
      expect((await http().post(`${api}/motions/${mo.id}/open`).set(auth(band.token)).expect(409)).body.code).toBe('ASSEMBLY_STATUS');
      await http().delete(`${api}/assemblies/${draft.id}`).set(auth(band.token)).expect(204);
    });

    it('aplica las reglas de voto presencial, a distancia y delegado', async () => {
      remoteMotion = (await http().post(`${api}/assemblies/${assemblyId}/motions`).set(auth(band.token)).send({ title: 'Cuentas 2025', allowRemote: true }).expect(201)).body.id;
      roomMotion = (await http().post(`${api}/assemblies/${assemblyId}/motions`).set(auth(band.token)).send({ title: 'Nuevo uniforme', allowRemote: false }).expect(201)).body.id;
      const vote = (token: string, id: string, body: object) => http().post(`${api}/motions/${id}/vote`).set(auth(token)).send(body);

      expect((await vote(voter[1], remoteMotion, { choice: 'YES' }).expect(409)).body.code).toBe('MOTION_NOT_OPEN');
      await http().post(`${api}/motions/${remoteMotion}/open`).set(auth(band.token)).expect(200);
      await http().post(`${api}/motions/${roomMotion}/open`).set(auth(band.token)).expect(200);

      // Usuario sin socio vinculado.
      expect((await vote(band.token, remoteMotion, { choice: 'YES' }).expect(403)).body.code).toBe('NO_MEMBER');
      // m2 no está presente: a distancia sólo si la votación lo admite.
      expect((await vote(voter[2], roomMotion, { choice: 'YES' }).expect(403)).body.code).toBe('REMOTE_NOT_ALLOWED');
      expect((await vote(voter[2], remoteMotion, { choice: 'NO' }).expect(200)).body).toMatchObject({ remote: true });
      // m3 delegó en m0: no puede votar directamente.
      expect((await vote(voter[3], remoteMotion, { choice: 'YES' }).expect(409)).body.code).toBe('VOTE_DELEGATED');
      // m0 vota por sí y por sus delegaciones; no por quien no le ha delegado.
      expect((await vote(voter[0], remoteMotion, { choice: 'YES' }).expect(200)).body).toMatchObject({ remote: false });
      await vote(voter[0], remoteMotion, { choice: 'YES', onBehalfOf: m[3] }).expect(200);
      expect((await vote(voter[0], remoteMotion, { choice: 'YES', onBehalfOf: m[2] }).expect(403)).body.code).toBe('NOT_PROXY_HOLDER');
      // Un voto por socio: cambiar el voto no suma.
      await vote(voter[1], remoteMotion, { choice: 'YES' }).expect(200);
      await vote(voter[1], remoteMotion, { choice: 'ABSTAIN' }).expect(200);

      const mine = await http().get(`${api}/motions/${remoteMotion}`).set(auth(voter[1])).expect(200);
      expect(mine.body.results).toEqual({ YES: 2, NO: 1, ABSTAIN: 1, total: 4, remote: 1 });
      expect(mine.body.myVote).toEqual({ choice: 'ABSTAIN', remote: false });
      expect(mine.body.votes).toBeUndefined();
      const sec = await http().get(`${api}/motions/${remoteMotion}`).set(auth(band.token)).expect(200);
      expect(sec.body.votes).toHaveLength(4);

      const detail = await http().get(`${api}/assemblies/${assemblyId}`).set(auth(voter[0])).expect(200);
      expect(detail.body.me).toMatchObject({ present: true, delegated: false });
      expect(detail.body.me.proxies.map((p: { id: string }) => p.id).sort()).toEqual([m[3], m[4]].sort());
      expect(detail.body.motions.find((x: { id: string }) => x.id === remoteMotion).proxyVotes).toEqual({ [m[3]]: 'YES' });
    });

    it('el secretario anota votos en sala sólo de presentes o representados', async () => {
      const put = (body: object) => http().put(`${api}/motions/${roomMotion}/votes`).set(auth(band.token)).send(body);
      expect((await put([{ memberId: m[2], choice: 'YES' }]).expect(400)).body.code).toBe('NOT_IN_ATTENDANCE');
      await http().put(`${api}/motions/${roomMotion}/votes`).set(auth(voter[0])).send([{ memberId: m[0], choice: 'YES' }]).expect(403);
      const r = await put([{ memberId: m[0], choice: 'YES' }, { memberId: m[1], choice: 'YES' }, { memberId: m[4], choice: 'NO' }]).expect(200);
      expect(r.body).toMatchObject({ YES: 2, NO: 1, total: 3, remote: 0 });
      const closed = await http().post(`${api}/motions/${roomMotion}/close`).set(auth(band.token)).expect(200);
      expect(closed.body.status).toBe('CLOSED');
      expect((await http().post(`${api}/motions/${roomMotion}/vote`).set(auth(voter[1])).send({ choice: 'NO' }).expect(409)).body.code).toBe('MOTION_NOT_OPEN');
    });
  });

  describe('Libro de actas', () => {
    it('genera el borrador, lo guarda y tras aprobarlo es de sólo lectura', async () => {
      const d = await http().post(`${api}/assemblies/${assemblyId}/minutes/draft`).set(auth(band.token)).send({}).expect(200);
      expect(d.body.saved).toBe(true);
      expect(d.body.minutes).toContain('ACTA DE LA ASAMBLEA GENERAL ORDINARIA');
      expect(d.body.minutes).toContain('Aprobación de cuentas');
      expect(d.body.minutes).toContain('Auditorio municipal');
      expect(d.body.minutes).toContain('2 socios presentes y 2 representados');
      expect(d.body.minutes).toContain('«Nuevo uniforme»: 2 votos a favor, 1 en contra');
      expect(d.body.minutes).toContain('Resultado: APROBADA');
      expect(d.body.minutes).toContain('con la representación de');
      const again = await http().post(`${api}/assemblies/${assemblyId}/minutes/draft`).set(auth(band.token)).send({}).expect(200);
      expect(again.body.saved).toBe(false);
      await http().put(`${api}/assemblies/${assemblyId}/minutes`).set(auth(band.token)).send({ minutes: 'Acta revisada por el secretario.' }).expect(200);
      // Hasta su aprobación, los socios no ven el borrador.
      expect((await http().get(`${api}/assemblies/${assemblyId}`).set(auth(voter[1])).expect(200)).body.minutes).toBeNull();

      expect((await http().post(`${api}/assemblies/${assemblyId}/minutes/approve`).set(auth(band.token)).expect(409)).body.code).toBe('ASSEMBLY_STATUS');
      await http().post(`${api}/assemblies/${assemblyId}/hold`).set(auth(band.token)).expect(200);
      await http().patch(`${api}/assemblies/${assemblyId}`).set(auth(band.token)).send({ title: 'Cambio' }).expect(409);
      await http().post(`${api}/assemblies/${assemblyId}/minutes/approve`).set(auth(band.token)).expect(200);
      expect((await http().put(`${api}/assemblies/${assemblyId}/minutes`).set(auth(band.token)).send({ minutes: 'otra' }).expect(409)).body.code).toBe('MINUTES_APPROVED');
      await http().post(`${api}/assemblies/${assemblyId}/minutes/draft`).set(auth(band.token)).send({ overwrite: true }).expect(409);

      const book = await http().get(`${api}/minutes`).set(auth(voter[1])).expect(200);
      expect(book.body).toHaveLength(1);
      expect(book.body[0].minutes).toBe('Acta revisada por el secretario.');

      await http().post(`${api}/assemblies/${assemblyId}/close`).set(auth(band.token)).expect(200);
      const closed = await http().get(`${api}/motions/${remoteMotion}`).set(auth(band.token)).expect(200);
      expect(closed.body.status).toBe('CLOSED');
    });
  });

  describe('Junta directiva', () => {
    it('lista los cargos vigentes y marca los mandatos que vencen pronto', async () => {
      const in30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
      await http().post(`${api}/board`).set(auth(band.token)).send({ memberId: m[0], position: 'Presidente', startsOn: '2024-01-01', endsOn: in30 }).expect(201);
      await http().post(`${api}/board`).set(auth(band.token)).send({ memberId: m[1], position: 'Tesorero', startsOn: '2024-01-01', endsOn: '2030-01-01' }).expect(201);
      await http().post(`${api}/board`).set(auth(band.token)).send({ memberId: m[2], position: 'Secretario', startsOn: '2018-01-01', endsOn: '2020-01-01' }).expect(201);
      await http().post(`${api}/board`).set(auth(band.token)).send({ memberId: m[2], position: 'Vocal', startsOn: '2024-01-01', endsOn: '2023-01-01' }).expect(400);
      await http().post(`${api}/board`).set(auth(voter[0])).send({ memberId: m[2], position: 'Vocal', startsOn: '2024-01-01' }).expect(403);

      const current = await http().get(`${api}/board?current=true`).set(auth(voter[0])).expect(200);
      expect(current.body.map((p: { position: string }) => p.position)).toEqual(['Presidente', 'Tesorero']);
      expect(current.body[0].expiringSoon).toBe(true);
      expect(current.body[1].expiringSoon).toBe(false);
      const all = await http().get(`${api}/board`).set(auth(voter[0])).expect(200);
      expect(all.body).toHaveLength(3);
      expect(all.body[2]).toMatchObject({ position: 'Secretario', current: false });
    });
  });

  describe('Encuestas', () => {
    let pollId: string;
    it('respuesta única, un voto por usuario y resultados con nombres sólo para gestión', async () => {
      pollId = (
        await http().post(`${api}/polls`).set(auth(band.token)).send({ question: '¿Excursión de fin de curso?', options: ['Valencia', 'Madrid', 'Ninguna'], notify: true }).expect(201)
      ).body.id;
      expect(ctx.jobs.of('notify.fanout').some((j) => j.data.type === 'poll.created' && j.data.email === false)).toBe(true);
      await http().post(`${api}/polls`).set(auth(band.token)).send({ question: 'Repetidas', options: ['A', 'a'] }).expect(400);
      const vote = (token: string, choices: number[]) => http().post(`${api}/polls/${pollId}/vote`).set(auth(token)).send({ choices });
      expect((await vote(voter[0], [0, 1]).expect(400)).body.code).toBe('SINGLE_CHOICE');
      expect((await vote(voter[0], [5]).expect(400)).body.code).toBe('INVALID_CHOICE');
      await vote(voter[0], [0]).expect(200);
      await vote(voter[0], [1]).expect(200);
      await vote(voter[1], [1]).expect(200);
      await vote(band.token, [2]).expect(200);

      const r = await http().get(`${api}/polls/${pollId}/results`).set(auth(voter[0])).expect(200);
      expect(r.body).toMatchObject({ counts: [0, 2, 1], totalVoters: 3, myChoices: [1] });
      expect(r.body.voters).toBeUndefined();
      const s = await http().get(`${api}/polls/${pollId}/results`).set(auth(band.token)).expect(200);
      expect(s.body.voters.map((v: { name: string }) => v.name)).toContain('Socio0 Apellido0');
      await http().patch(`${api}/polls/${pollId}`).set(auth(band.token)).send({ question: 'Otra' }).expect(409);

      await http().post(`${api}/polls/${pollId}/close`).set(auth(band.token)).expect(200);
      expect((await vote(voter[2], [0]).expect(409)).body.code).toBe('POLL_CLOSED');
      const list = await http().get(`${api}/polls`).set(auth(voter[0])).expect(200);
      expect(list.body[0]).toMatchObject({ open: false, voteCount: 3, myChoices: [1] });
    });

    it('anónima con varias respuestas y cierre por fecha', async () => {
      const anon = (await http().post(`${api}/polls`).set(auth(band.token)).send({ question: 'Repertorio', options: ['A', 'B', 'C'], multiple: true, anonymous: true }).expect(201)).body.id;
      await http().post(`${api}/polls/${anon}/vote`).set(auth(voter[0])).send({ choices: [0, 2] }).expect(200);
      const r = await http().get(`${api}/polls/${anon}/results`).set(auth(band.token)).expect(200);
      expect(r.body.counts).toEqual([1, 0, 1]);
      expect(r.body.voters).toBeUndefined();
      const expired = (await http().post(`${api}/polls`).set(auth(band.token)).send({ question: 'Pasada', options: ['Sí', 'No'], closesAt: '2020-01-01T00:00:00Z' }).expect(201)).body.id;
      await http().post(`${api}/polls/${expired}/vote`).set(auth(voter[0])).send({ choices: [0] }).expect(409);
    });
  });

  describe('Plan y aislamiento', () => {
    it('el plan FREE no incluye gobierno', async () => {
      const free = await signupBand(ctx, 'gov-free', 'FREE');
      const res = await http().get(`${api}/assemblies`).set(auth(free.token)).expect(403);
      expect(res.body.code).toBe('FEATURE_NOT_IN_PLAN');
    });

    it('otra banda no ve ni referencia datos ajenos', async () => {
      const polls = await http().get(`${api}/polls`).set(auth(band.token)).expect(200);
      const pollId = polls.body[0].id;
      await http().get(`${api}/assemblies/${assemblyId}`).set(auth(other.token)).expect(404);
      await http().get(`${api}/assemblies/${assemblyId}/quorum`).set(auth(other.token)).expect(404);
      await http().get(`${api}/motions/${remoteMotion}`).set(auth(other.token)).expect(404);
      await http().post(`${api}/motions/${remoteMotion}/close`).set(auth(other.token)).expect(404);
      await http().get(`${api}/polls/${pollId}/results`).set(auth(other.token)).expect(404);
      await http().post(`${api}/polls/${pollId}/vote`).set(auth(other.token)).send({ choices: [0] }).expect(404);
      expect((await http().get(`${api}/assemblies`).set(auth(other.token)).expect(200)).body).toHaveLength(0);
      expect((await http().get(`${api}/minutes`).set(auth(other.token)).expect(200)).body).toHaveLength(0);
      expect((await http().get(`${api}/board`).set(auth(other.token)).expect(200)).body).toHaveLength(0);

      const own = (await http().post(`${api}/assemblies`).set(auth(other.token)).send({ type: 'ORDINARY', title: 'B', firstCallAt: '2026-12-01T18:00:00Z' }).expect(201)).body.id;
      await http().post(`${api}/assemblies/${own}/convene`).set(auth(other.token)).expect(200);
      await http().put(`${api}/assemblies/${own}/attendance`).set(auth(other.token)).send([{ memberId: m[0] }]).expect(404);
      await http().post(`${api}/board`).set(auth(other.token)).send({ memberId: m[0], position: 'Vocal', startsOn: '2026-01-01' }).expect(404);
    });
  });
});
