import { addUser, auth, Band, createTestApp, PASSWORD, resetDb, signupBand, TestCtx } from './helpers';

describe('Escuela de música', () => {
  let ctx: TestCtx;
  let A: Band;
  let B: Band;
  const api = (path: string) => `/api/v1${path}`;
  const get = (path: string, token = A.token) => ctx.http().get(api(path)).set(auth(token));
  const post = (path: string, body: object = {}, token = A.token) => ctx.http().post(api(path)).set(auth(token)).send(body);
  const patch = (path: string, body: object, token = A.token) => ctx.http().patch(api(path)).set(auth(token)).send(body);
  const put = (path: string, body: object, token = A.token) => ctx.http().put(api(path)).set(auth(token)).send(body);

  // Estado compartido entre los pasos del flujo.
  let prevYear: { id: string };
  let year: { id: string };
  let theory: { id: string };
  let clarinet: { id: string };
  let choir: { id: string };
  let room1: { id: string };
  let teacher: { id: string };
  let teacherToken: string;
  let gTheory: { id: string };
  let gClarinet: { id: string };
  let gChoir: { id: string };
  let family: { id: string };
  let guardian: { id: string };
  let alvaro: { id: string };
  let lucia: { id: string };
  let member: { id: string };

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.db);
    A = await signupBand(ctx, 'escuela-a', 'PRO');
    B = await signupBand(ctx, 'escuela-b', 'PRO');
  });
  afterAll(() => ctx.app.close());

  describe('plan', () => {
    it('FREE no incluye la escuela; BASIC con la feature en el plan sí, sin cupo de fichas', async () => {
      const free = await signupBand(ctx, 'escuela-free', 'FREE');
      const denied = await get('/school/students', free.token).expect(403);
      expect(denied.body.code).toBe('FEATURE_NOT_IN_PLAN');
      await ctx.http().get(api('/public/schools/escuela-free/offer')).expect(404);

      const basic = await signupBand(ctx, 'escuela-basic', 'BASIC');
      await get('/school/students', basic.token).expect(403);
      const plan = await ctx.db.system.plan.findUniqueOrThrow({ where: { code: 'BASIC' } });
      await ctx.db.system.plan.update({ where: { code: 'BASIC' }, data: { features: [...new Set([...plan.features, 'school'])] } });
      await get('/school/students', basic.token).expect(200);
      await post('/school/students', { firstName: 'Uno', lastName: 'Solo' }, basic.token).expect(201);
      await post('/school/students', { firstName: 'Dos', lastName: 'Más' }, basic.token).expect(201);
    });
  });

  describe('configuración y oferta', () => {
    it('crea cursos, asignaturas, aulas, profesores y grupos', async () => {
      await put('/school/settings', { siblingDiscountPct: 10, memberDiscountPct: 5, multiSubjectDiscountPct: 20, publicIntro: 'Bienvenidos' }).expect(200);
      prevYear = (await post('/school/years', { name: '2025-26', startsOn: '2025-09-01', endsOn: '2026-06-30' }).expect(201)).body;
      year = (await post('/school/years', { name: '2026-27', startsOn: '2026-09-01', endsOn: '2027-06-30', holidays: ['2026-10-12'], isCurrent: true }).expect(201)).body;
      await post('/school/years', { name: 'Malo', startsOn: '2026-09-01', endsOn: '2026-01-01' }).expect(400);
      theory = (await post('/school/subjects', { name: 'Lenguaje musical', kind: 'THEORY', monthlyFeeCents: 3000 }).expect(201)).body;
      clarinet = (await post('/school/subjects', { name: 'Clarinete', kind: 'INSTRUMENT', monthlyFeeCents: 4000 }).expect(201)).body;
      choir = (await post('/school/subjects', { name: 'Coro', kind: 'ENSEMBLE', monthlyFeeCents: 1000 }).expect(201)).body;
      room1 = (await post('/school/rooms', { name: 'Aula 1', capacity: 20 }).expect(201)).body;

      teacherToken = await addUser(ctx, A, 'teacher', 'profe@escuela.local');
      const teacherUser = await ctx.db.system.user.findUniqueOrThrow({ where: { email: 'profe@escuela.local' } });
      teacher = (await post('/school/teachers', { firstName: 'Ana', lastName: 'Profe', userId: teacherUser.id }).expect(201)).body;
      // Un usuario de otra banda no se puede vincular.
      const bUser = await ctx.db.system.user.findUniqueOrThrow({ where: { email: B.email } });
      await post('/school/teachers', { firstName: 'X', lastName: 'Y', userId: bUser.id }).expect(404);

      gTheory = (await post('/school/groups', { yearId: year.id, subjectId: theory.id, name: 'Lenguaje 1º', level: '1º', teacherId: teacher.id }).expect(201)).body;
      gClarinet = (await post('/school/groups', { yearId: year.id, subjectId: clarinet.id, name: 'Clarinete A', monthlyFeeCents: 4500 }).expect(201)).body;
      gChoir = (await post('/school/groups', { yearId: year.id, subjectId: choir.id, name: 'Coro infantil', capacity: 1 }).expect(201)).body;

      const mine = await get(`/school/groups?yearId=${year.id}&mine=true`, teacherToken).expect(200);
      expect(mine.body.map((g: { id: string }) => g.id)).toEqual([gTheory.id]);
    });
  });

  describe('familias y alumnos', () => {
    it('cifra el IBAN de la familia y sólo lo muestra con members:sensitive', async () => {
      family = (await post('/school/families', { name: 'Familia Pérez', iban: 'ES91 2100 0418 4502 0005 1332', ibanHolder: 'Marta Pérez' }).expect(201)).body;
      expect(family).toMatchObject({ iban: 'ES9121000418450200051332' });
      expect(JSON.stringify(family)).not.toContain('ibanEnc');
      const raw = await ctx.db.system.family.findUniqueOrThrow({ where: { id: family.id } });
      expect(raw.ibanEnc).not.toContain('ES91');

      member = (await post('/members', { firstName: 'Marta', lastName: 'Pérez' }).expect(201)).body;
      guardian = (await post(`/school/families/${family.id}/guardians`, { firstName: 'Marta', lastName: 'Pérez', relationship: 'Madre', email: 'marta@familia.local', nationalId: '12345678Z', memberId: member.id }).expect(201)).body;

      // El profesorado no consulta el listado de familias ni las solicitudes de matrícula (datos de contacto).
      await get('/school/families', teacherToken).expect(403);
      await get(`/school/families/${family.id}`, teacherToken).expect(403);
      await get('/school/applications', teacherToken).expect(403);
      await post('/school/families', { name: 'X' }, teacherToken).expect(403);
    });

    it('crea alumnos y busca sin tildes', async () => {
      alvaro = (await post('/school/students', { familyId: family.id, firstName: 'Álvaro', lastName: 'Pérez', birthDate: '2015-03-01', instrument: 'Clarinete', imageConsent: true, pickupAuthorized: ['Abuela Carmen'] }).expect(201)).body;
      lucia = (await post('/school/students', { familyId: family.id, firstName: 'Lucía', lastName: 'Pérez', birthDate: '2017-05-01', email: '' }).expect(201)).body;
      const found = await get('/school/students?q=alvaro').expect(200);
      expect(found.body.data.map((s: { id: string }) => s.id)).toEqual([alvaro.id]);
      const detail = await get(`/school/students/${alvaro.id}`).expect(200);
      expect(detail.body.family.guardians[0].nationalId).toBe('12345678Z');
    });
  });

  describe('matrículas y horarios', () => {
    it('lista de espera y promoción al dar de baja', async () => {
      await post('/school/enrollments', { studentId: alvaro.id, groupId: gTheory.id }).expect(201);
      await post('/school/enrollments', { studentId: alvaro.id, groupId: gClarinet.id }).expect(201);
      await post('/school/enrollments', { studentId: lucia.id, groupId: gTheory.id }).expect(201);
      await post('/school/enrollments', { studentId: lucia.id, groupId: gTheory.id }).expect(409);

      const c1 = (await post('/school/enrollments', { studentId: alvaro.id, groupId: gChoir.id }).expect(201)).body;
      const c2 = (await post('/school/enrollments', { studentId: lucia.id, groupId: gChoir.id }).expect(201)).body;
      expect(c1.status).toBe('ACTIVE');
      expect(c2.status).toBe('WAITLIST');
      const w = await post(`/school/enrollments/${c1.id}/withdraw`).expect(200);
      expect(w.body.promoted.id).toBe(c2.id);
      // Lucía queda en Coro: se retira para que las mensualidades sean previsibles.
      await post(`/school/enrollments/${c2.id}/withdraw`).expect(200);
    });

    it('detecta solapes de aula, profesor y alumnos', async () => {
      await post(`/school/groups/${gTheory.id}/slots`, { weekday: 1, startMin: 17 * 60, endMin: 18 * 60, roomId: room1.id }).expect(201);
      await post(`/school/groups/${gTheory.id}/slots`, { weekday: 1, startMin: 18 * 60, endMin: 17 * 60 }).expect(400);
      const clash = await post(`/school/groups/${gClarinet.id}/slots`, { weekday: 1, startMin: 17 * 60 + 30, endMin: 18 * 60 + 30, roomId: room1.id }).expect(409);
      expect(clash.body.code).toBe('SCHEDULE_CONFLICT');
      expect(clash.body.details[0].reasons).toEqual(['ROOM', 'STUDENT']);
      const forced = await post(`/school/groups/${gClarinet.id}/slots`, { weekday: 1, startMin: 17 * 60 + 30, endMin: 18 * 60 + 30, roomId: room1.id, force: true }).expect(201);
      const conflicts = await get(`/school/years/${year.id}/conflicts`).expect(200);
      expect(conflicts.body).toHaveLength(1);
      // Moverlo al martes resuelve el conflicto.
      await patch(`/school/slots/${forced.body.id}`, { weekday: 2 }).expect(200);
      expect((await get(`/school/years/${year.id}/conflicts`).expect(200)).body).toHaveLength(0);
    });
  });

  describe('clases, asistencia y notas', () => {
    let sessions: { id: string; date: string; status: string }[];

    it('genera sesiones (idempotente, sin festivos) y gestiona cancelaciones y recuperaciones', async () => {
      const gen = await post(`/school/groups/${gTheory.id}/sessions/generate`, { from: '2026-10-01', to: '2026-10-25' }).expect(201);
      // Lunes 5, 12 (festivo) y 19 de octubre.
      expect(gen.body).toEqual({ created: 2, skipped: 0 });
      const again = await post(`/school/groups/${gTheory.id}/sessions/generate`, { from: '2026-10-01', to: '2026-10-25' }).expect(201);
      expect(again.body.created).toBe(0);
      sessions = (await get(`/school/groups/${gTheory.id}/sessions`).expect(200)).body;
      expect(sessions.map((s) => s.date.slice(0, 10))).toEqual(['2026-10-05', '2026-10-19']);

      await post(`/school/sessions/${sessions[1].id}/make-up`, { date: '2026-10-21', startMin: 1020, endMin: 1080 }).expect(400);
      await post(`/school/sessions/${sessions[1].id}/cancel`, { notes: 'Enfermedad' }, teacherToken).expect(200);
      const mk = await post(`/school/sessions/${sessions[1].id}/make-up`, { date: '2026-10-21', startMin: 1020, endMin: 1080 }).expect(201);
      expect(mk.body.makeUpForId).toBe(sessions[1].id);
    });

    it('el profesor pasa lista en su grupo pero no en otros', async () => {
      const res = await put(`/school/sessions/${sessions[0].id}/attendance`, [
        { studentId: alvaro.id, status: 'PRESENT' },
        { studentId: lucia.id, status: 'ABSENT', note: 'Avisó' },
      ], teacherToken).expect(200);
      expect(res.body).toHaveLength(2);
      const other = (await post(`/school/groups/${gClarinet.id}/sessions/generate`, { from: '2026-10-05', to: '2026-10-11' }).expect(201)).body;
      expect(other.created).toBe(1);
      const clarSession = (await get(`/school/groups/${gClarinet.id}/sessions`).expect(200)).body[0];
      const denied = await put(`/school/sessions/${clarSession.id}/attendance`, [{ studentId: alvaro.id, status: 'PRESENT' }], teacherToken).expect(403);
      expect(denied.body.code).toBe('NOT_YOUR_GROUP');
      // Un alumno que no está en el grupo no puede figurar.
      await put(`/school/sessions/${clarSession.id}/attendance`, [{ studentId: lucia.id, status: 'PRESENT' }]).expect(400);
    });

    it('notas por trimestre y boletín', async () => {
      const roster = (await get(`/school/groups/${gTheory.id}/grades`).expect(200)).body as { id: string; student: { id: string } }[];
      const enr = roster.find((r) => r.student.id === alvaro.id)!;
      await put(`/school/groups/${gTheory.id}/grades`, { term: 1, grades: [{ enrollmentId: enr.id, scoreTenths: 85, qualitative: 'Notable', comment: 'Buen trabajo' }] }, teacherToken).expect(200);
      await put(`/school/groups/${gTheory.id}/grades`, { term: 1, grades: [{ enrollmentId: enr.id, scoreTenths: 101 }] }).expect(400);
      await put(`/school/groups/${gClarinet.id}/grades`, { term: 1, grades: [] }, teacherToken).expect(403);
      const card = await get(`/school/students/${alvaro.id}/report-card?yearId=${year.id}`).expect(200);
      const lenguaje = card.body.subjects.find((s: { subject: string }) => s.subject === 'Lenguaje musical');
      expect(lenguaje.grades[0]).toMatchObject({ term: 1, scoreTenths: 85, qualitative: 'Notable' });
      expect(lenguaje.attendance).toEqual({ PRESENT: 1 });
      expect(card.body.tenant.name).toBe('Banda escuela-a');
    });
  });

  describe('mensualidades', () => {
    it('emite con descuentos, es idempotente, cobra y exporta la remesa', async () => {
      const issued = await post('/school/tuition/issue', { yearId: year.id, period: '2026-10', dueDate: '2026-10-05' }).expect(201);
      expect(issued.body).toEqual({ created: 2, skipped: 0 });
      const again = await post('/school/tuition/issue', { yearId: year.id, period: '2026-10', dueDate: '2026-10-05' }).expect(201);
      expect(again.body).toEqual({ created: 0, skipped: 2 });

      const list = await get('/school/tuition/charges?period=2026-10').expect(200);
      const byStudent = (id: string) => list.body.data.find((c: { studentId: string }) => c.studentId === id);
      // Álvaro: 3000 + 4500 = 7500; varias asignaturas 20 % + socio 5 % = 25 %.
      expect(byStudent(alvaro.id)).toMatchObject({ baseCents: 7500, discountCents: 1875, amountCents: 5625 });
      // Lucía: 3000; hermana (2ª por edad) 10 % + socio 5 % = 15 %.
      expect(byStudent(lucia.id)).toMatchObject({ baseCents: 3000, discountCents: 450, amountCents: 2550 });
      expect(byStudent(lucia.id).detail.discounts.map((d: { kind: string }) => d.kind)).toEqual(['SIBLING', 'MEMBER']);

      await patch(`/school/families/${family.id}`, { name: '=HYPERLINK("x")' }).expect(200);
      const csv = await get('/school/tuition/export.csv?period=2026-10').expect(200);
      expect(csv.text).toContain('ES9121000418450200051332');
      expect(csv.text).toContain('81.75');
      expect(csv.text).toContain(`"'=HYPERLINK(""x"")"`);

      const charge = byStudent(alvaro.id);
      await post(`/school/tuition/charges/${charge.id}/pay`, { date: '2026-10-06' }).expect(200);
      await post(`/school/tuition/charges/${charge.id}/pay`, { date: '2026-10-06' }).expect(400);
      const txs = await get('/finance/transactions').expect(200);
      const t = txs.body.data.find((x: { amountCents: number }) => x.amountCents === 5625);
      expect(t.category.name).toBe('Escuela de música');
      // El ingreso de una mensualidad cobrada no se borra desde tesorería.
      const del = await ctx.http().delete(api(`/finance/transactions/${t.id}`)).set(auth(A.token)).expect(400);
      expect(del.body.code).toBe('LINKED_TO_CHARGE');
      await post(`/school/tuition/charges/${byStudent(lucia.id).id}/waive`).expect(200);

      // El profesor no ve la tesorería de la escuela.
      await get('/school/tuition/charges', teacherToken).expect(403);
    });
  });

  describe('matrícula online', () => {
    it('sólo con matrícula abierta; valida consentimiento y asignaturas', async () => {
      await ctx.http().get(api('/public/schools/escuela-a/offer')).expect(404);
      await patch(`/school/years/${year.id}`, { enrollmentOpen: true }).expect(200);
      const offer = await ctx.http().get(api('/public/schools/escuela-a/offer')).expect(200);
      expect(offer.body).toMatchObject({ band: { name: 'Banda escuela-a' }, year: { name: '2026-27' }, publicIntro: 'Bienvenidos' });
      expect(offer.body.subjects).toHaveLength(3);

      const form = {
        studentFirstName: 'Hugo', studentLastName: 'Sanz', studentBirthDate: '2018-01-10', guardianName: 'Elena Sanz Ruiz',
        guardianEmail: 'Elena@Sanz.local', subjectIds: [theory.id],
      };
      await ctx.http().post(api('/public/schools/escuela-a/applications')).send(form).expect(400);
      const bSubject = (await post('/school/subjects', { name: 'Ajena', kind: 'OTHER' }, B.token).expect(201)).body;
      await ctx.http().post(api('/public/schools/escuela-a/applications')).send({ ...form, consent: true, subjectIds: [bSubject.id] }).expect(400);
      const ok = await ctx.http().post(api('/public/schools/escuela-a/applications')).send({ ...form, consent: true }).expect(201);
      expect(ok.body.status).toBe('PENDING');
      // La banda B no tiene matrícula abierta.
      await ctx.http().post(api('/public/schools/escuela-b/applications')).send({ ...form, consent: true, subjectIds: [bSubject.id] }).expect(404);
    });

    it('prueba de acceso y aceptación con alta de familia, tutor y alumno', async () => {
      const apps = await get('/school/applications?status=PENDING').expect(200);
      expect(apps.body).toHaveLength(1);
      const app = apps.body[0];
      await patch(`/school/applications/${app.id}`, { auditionAt: '2026-10-25T10:00:00.000Z', auditionResult: 'Apto' }).expect(200);
      await post(`/school/applications/${app.id}/accept`, { groupIds: [(await post('/school/groups', { yearId: prevYear.id, subjectId: theory.id, name: 'Viejo' }).expect(201)).body.id] }).expect(400);
      const acc = await post(`/school/applications/${app.id}/accept`, { groupIds: [gTheory.id, gChoir.id] }).expect(200);
      expect(acc.body.application.status).toBe('ACCEPTED');
      expect(acc.body.enrollments.map((e: { status: string }) => e.status)).toEqual(['ACTIVE', 'ACTIVE']);
      const fam = await get(`/school/students/${acc.body.student.id}`).expect(200);
      expect(fam.body.family.guardians[0]).toMatchObject({ firstName: 'Elena', lastName: 'Sanz Ruiz', email: 'elena@sanz.local' });
      await post(`/school/applications/${app.id}/reject`).expect(400);
    });
  });

  describe('paso a la banda', () => {
    it('crea la ficha de socio y sólo actualiza la etapa la segunda vez', async () => {
      const r = await post(`/school/students/${alvaro.id}/promote`, { stage: 'EDUCANDO' }).expect(201);
      expect(r.body.bandStage).toBe('EDUCANDO');
      const m = await get(`/members/${r.body.memberId}`).expect(200);
      expect(m.body).toMatchObject({ firstName: 'Álvaro', instrument: 'Clarinete', consentImages: true });
      const r2 = await post(`/school/students/${alvaro.id}/promote`, { stage: 'MUSICIAN' }).expect(201);
      expect(r2.body.memberId).toBe(r.body.memberId);
      expect(r2.body.bandStage).toBe('MUSICIAN');
      await post(`/school/students/${alvaro.id}/promote`, { stage: 'MUSICIAN' }, teacherToken).expect(403);
    });
  });

  describe('portal de familias', () => {
    let familyToken: string;

    it('invita al tutor, acepta y ve sólo a su familia', async () => {
      const inv = await post(`/school/guardians/${guardian.id}/invite`).expect(201);
      expect(inv.body.guardianId).toBe(guardian.id);
      const mail = ctx.jobs.of('email.send').find((j) => j.data.to === 'marta@familia.local')!;
      const token = /invite\/([\w-]+)/.exec(mail.data.text)![1];
      const acc = await ctx.http().post(api('/auth/invitations/accept')).send({ token, name: 'Marta Pérez', password: PASSWORD }).expect(200);
      expect(acc.body.session.role.key).toBe('family');
      familyToken = acc.body.accessToken;
      await post(`/school/guardians/${guardian.id}/invite`).expect(409);

      const portal = await get('/school/family', familyToken).expect(200);
      expect(portal.body.students.map((s: { firstName: string }) => s.firstName).sort()).toEqual(['Lucía', 'Álvaro']);
      expect(portal.body.absences).toHaveLength(1);
      expect(portal.body.charges).toHaveLength(2);
      expect(portal.body.family.ibanMasked).toMatch(/1332$/);
      // La familia no accede al back-office.
      await get('/school/students', familyToken).expect(403);
      await get('/school/family').expect(404);
    });

    it('los avisos llegan a las familias del grupo', async () => {
      const n = await post('/school/notices', { groupId: gTheory.id, title: 'Audición', body: 'El viernes hay audición' }, teacherToken).expect(201);
      const job = ctx.jobs.of('notify.fanout').find((j) => j.data.title === 'Audición')!;
      const famUser = await ctx.db.system.user.findUniqueOrThrow({ where: { email: 'marta@familia.local' } });
      expect(job.data.userIds).toContain(famUser.id);
      await post('/school/notices', { groupId: gClarinet.id, title: 'No', body: 'No' }, teacherToken).expect(403);
      await post('/school/notices', { title: 'General', body: 'Aviso a toda la escuela' }).expect(201);
      const portal = await get('/school/family', familyToken).expect(200);
      expect(portal.body.notices.map((x: { id: string }) => x.id)).toContain(n.body.id);
      expect(portal.body.notices).toHaveLength(2);
    });
  });

  describe('renovación de curso', () => {
    it('copia grupos y franjas y rematricula a los alumnos activos', async () => {
      const next = (await post('/school/years', { name: '2027-28', startsOn: '2027-09-01', endsOn: '2028-06-30' }).expect(201)).body;
      const r = await post(`/school/years/${next.id}/copy-from`, { sourceYearId: year.id, renewEnrollments: true }).expect(201);
      expect(r.body.groups).toBe(3);
      // Lenguaje: Álvaro, Lucía y Hugo; Clarinete: Álvaro; Coro (cupo 1): Hugo.
      expect(r.body).toMatchObject({ enrollments: 5, waitlisted: 0 });
      const again = await post(`/school/years/${next.id}/copy-from`, { sourceYearId: year.id, renewEnrollments: true }).expect(201);
      expect(again.body.groups).toBe(0);
      const groups = await get(`/school/groups?yearId=${next.id}`).expect(200);
      expect(groups.body.find((g: { name: string }) => g.name === 'Lenguaje 1º').slots).toHaveLength(1);
    });
  });

  describe('aislamiento entre bandas', () => {
    it('B no ve ni modifica datos de A', async () => {
      await get(`/school/students/${alvaro.id}`, B.token).expect(404);
      await get(`/school/groups/${gTheory.id}`, B.token).expect(404);
      await get(`/school/families/${family.id}`, B.token).expect(404);
      await patch(`/school/students/${alvaro.id}`, { firstName: 'Hack' }, B.token).expect(404);
      const charges = (await get('/school/tuition/charges', A.token).expect(200)).body.data;
      await post(`/school/tuition/charges/${charges[0].id}/waive`, {}, B.token).expect(404);
      expect((await get('/school/tuition/charges', B.token).expect(200)).body.total).toBe(0);
      expect((await get('/school/students', B.token).expect(200)).body.total).toBe(0);
      await get(`/school/students/${alvaro.id}/report-card`, B.token).expect(404);
    });

    it('B no puede referenciar ids de A en el cuerpo', async () => {
      const bStudent = (await post('/school/students', { firstName: 'Bea', lastName: 'B' }, B.token).expect(201)).body;
      const bYear = (await post('/school/years', { name: '2026-27', startsOn: '2026-09-01', endsOn: '2027-06-30' }, B.token).expect(201)).body;
      await post('/school/enrollments', { studentId: alvaro.id, groupId: gTheory.id }, B.token).expect(404);
      await post('/school/enrollments', { studentId: bStudent.id, groupId: gTheory.id }, B.token).expect(404);
      await post('/school/groups', { yearId: bYear.id, subjectId: theory.id, name: 'X' }, B.token).expect(404);
      await post('/school/groups', { yearId: year.id, subjectId: theory.id, name: 'X' }, B.token).expect(404);
      await post('/school/students', { firstName: 'C', lastName: 'C', familyId: family.id }, B.token).expect(404);
      await post(`/school/years/${bYear.id}/copy-from`, { sourceYearId: year.id }, B.token).expect(404);
      await post(`/school/guardians/${guardian.id}/invite`, {}, B.token).expect(404);
      await post('/school/tuition/issue', { yearId: year.id, period: '2026-11', dueDate: '2026-11-05' }, B.token).expect(404);
      expect(await ctx.db.system.enrollment.count({ where: { tenantId: B.tenantId } })).toBe(0);
    });
  });
});
