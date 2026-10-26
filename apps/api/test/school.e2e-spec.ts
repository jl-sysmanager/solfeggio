import { Processors } from '../src/jobs/processors';
import { madridToday } from '../src/school/tuition';
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
  const del = (path: string, token = A.token) => ctx.http().delete(api(path)).set(auth(token));

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
    it('crea familias y bloquea el listado al profesorado', async () => {
      family = (await post('/school/families', { name: 'Familia Pérez', notes: 'Contacto principal Marta' }).expect(201)).body;
      expect(family).toMatchObject({ name: 'Familia Pérez' });

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

    it('las sesiones se crean solas con el horario y se rehacen al cambiar festivos o franjas', async () => {
      const today = madridToday().iso;
      const future = async (groupId: string) =>
        ((await get(`/school/groups/${groupId}/sessions?from=${today}`).expect(200)).body as { id: string; date: string; startMin: number }[]);
      const theory = await future(gTheory.id);
      if (today > '2027-06-30') return; // El curso de prueba ya terminó: no hay sesiones futuras.
      expect(theory.length).toBeGreaterThan(0);
      // Lunes, a las 17:00, y nunca en festivo.
      expect(theory.every((x) => new Date(x.date).getUTCDay() === 1 && x.startMin === 17 * 60)).toBe(true);
      // Un festivo nuevo quita la sesión de ese día; quitarlo la devuelve.
      const day = theory[0].date.slice(0, 10);
      await patch(`/school/years/${year.id}`, { holidays: ['2026-10-12', day] }).expect(200);
      expect((await future(gTheory.id)).map((x) => x.date.slice(0, 10))).not.toContain(day);
      await patch(`/school/years/${year.id}`, { holidays: ['2026-10-12'] }).expect(200);
      expect((await future(gTheory.id)).map((x) => x.date.slice(0, 10))).toContain(day);
      // Mover la franja del clarinete mueve sus sesiones futuras.
      const clar = (await get(`/school/groups/${gClarinet.id}`).expect(200)).body.slots[0];
      await patch(`/school/slots/${clar.id}`, { weekday: 3 }).expect(200);
      expect((await future(gClarinet.id)).every((x) => new Date(x.date).getUTCDay() === 3)).toBe(true);
      await patch(`/school/slots/${clar.id}`, { weekday: 2 }).expect(200);
      expect((await post(`/school/years/${year.id}/sessions/sync`).expect(200)).body).toMatchObject({ groups: 3, created: 0, removed: 0 });
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
      // Las de antes de hoy salen del rango pedido; las de después las creó el horario.
      expect(sessions.map((s) => s.date.slice(0, 10)).slice(0, 2)).toEqual(['2026-10-05', '2026-10-19']);
      expect(sessions.map((s) => s.date.slice(0, 10))).not.toContain('2026-10-12');

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
      // Un email por tutor con email (Marta) con el total de la familia.
      expect(issued.body).toEqual({ created: 2, skipped: 0, emailed: 1 });
      const mail = ctx.jobs.of('email.send').find((j) => j.data.to === 'marta@familia.local' && j.data.subject.includes('2026-10'))!;
      expect(mail.data.text).toContain('Total: 81,75 €');
      const again = await post('/school/tuition/issue', { yearId: year.id, period: '2026-10', dueDate: '2026-10-05' }).expect(201);
      expect(again.body).toEqual({ created: 0, skipped: 2, emailed: 0 });

      const list = await get('/school/tuition/charges?period=2026-10').expect(200);
      const byStudent = (id: string) => list.body.data.find((c: { studentId: string }) => c.studentId === id);
      // Álvaro: 3000 + 4500 = 7500; varias asignaturas 20 % + socio 5 % = 25 %.
      expect(byStudent(alvaro.id)).toMatchObject({ baseCents: 7500, discountCents: 1875, amountCents: 5625 });
      // Lucía: 3000; hermana (2ª por edad) 10 % + socio 5 % = 15 %.
      expect(byStudent(lucia.id)).toMatchObject({ baseCents: 3000, discountCents: 450, amountCents: 2550 });
      expect(byStudent(lucia.id).detail.discounts.map((d: { kind: string }) => d.kind)).toEqual(['SIBLING', 'MEMBER']);

      await patch(`/school/families/${family.id}`, { name: '=HYPERLINK("x")' }).expect(200);
      const csv = await get('/school/tuition/export.csv?period=2026-10').expect(200);
      expect(csv.text).toContain('81.75');
      expect(csv.text).toContain(`"'=HYPERLINK(""x"")"`);
      await patch(`/school/families/${family.id}`, { name: 'Familia Pérez' }).expect(200);

      const charge = byStudent(alvaro.id);
      await post(`/school/tuition/charges/${charge.id}/pay`, { date: '2026-10-06', method: 'CHEQUE' }).expect(400);
      const paid = await post(`/school/tuition/charges/${charge.id}/pay`, { date: '2026-10-06', method: 'BIZUM' }).expect(200);
      expect(paid.body).toMatchObject({ status: 'PAID', paymentMethod: 'BIZUM' });
      expect(paid.body.paidAt.slice(0, 10)).toBe('2026-10-06');
      await post(`/school/tuition/charges/${charge.id}/pay`, { date: '2026-10-06' }).expect(400);
      const txs = await get('/finance/transactions').expect(200);
      const t = txs.body.data.find((x: { amountCents: number }) => x.amountCents === 5625);
      expect(t.category.name).toBe('Escuela de música');
      expect(t.description).toContain('bizum');
      // El ingreso de una mensualidad cobrada no se borra desde tesorería.
      const del = await ctx.http().delete(api(`/finance/transactions/${t.id}`)).set(auth(A.token)).expect(400);
      expect(del.body.code).toBe('LINKED_TO_CHARGE');
      await post(`/school/tuition/charges/${byStudent(lucia.id).id}/waive`).expect(200);

      // El profesor no ve la tesorería de la escuela.
      await get('/school/tuition/charges', teacherToken).expect(403);
    });

    it('con tarifas fijas el alumno paga la tarifa asignada', async () => {
      await put('/school/settings', { feeMode: 'FIXED' }).expect(200);
      const reduced = (await post('/school/tariffs', { name: 'Reducida', monthlyCents: 4000 }).expect(201)).body;
      await post('/school/tariffs', { name: 'Reducida', monthlyCents: 1000 }).expect(409);
      const spare = (await post('/school/tariffs', { name: 'Sin uso', monthlyCents: 1000 }).expect(201)).body;
      await patch(`/school/students/${alvaro.id}`, { tuitionTariffId: reduced.id }).expect(200);
      await patch(`/school/tariffs/${spare.id}`, { active: false }).expect(200);
      const inactive = await patch(`/school/students/${lucia.id}`, { tuitionTariffId: spare.id }).expect(400);
      expect(inactive.body.code).toBe('TARIFF_INACTIVE');
      await del(`/school/tariffs/${reduced.id}`).expect(400);
      await del(`/school/tariffs/${spare.id}`).expect(204);
      const foreign = (await post('/school/tariffs', { name: 'Ajena', monthlyCents: 500 }, B.token).expect(201)).body;
      await patch(`/school/students/${lucia.id}`, { tuitionTariffId: foreign.id }).expect(404);
      await patch(`/school/students/${lucia.id}`, { tuitionTariffId: null }).expect(200);

      const issued = await post('/school/tuition/issue', { yearId: year.id, period: '2026-11', dueDate: '2026-11-05' }).expect(201);
      expect(issued.body.created).toBe(2);
      const list = await get('/school/tuition/charges?period=2026-11').expect(200);
      const byStudent = (id: string) => list.body.data.find((c: { studentId: string }) => c.studentId === id);
      expect(byStudent(alvaro.id)).toMatchObject({ baseCents: 4000, discountCents: 0, amountCents: 4000 });
      expect(byStudent(alvaro.id).detail.tariff).toMatchObject({ name: 'Reducida', cents: 4000 });
      // Lucía no tiene tarifa: paga la asignatura (3000), sin el descuento de hermana ni de socio.
      expect(byStudent(lucia.id)).toMatchObject({ baseCents: 3000, discountCents: 0, amountCents: 3000, detail: { tariffMissing: true } });

      // El descuento fijo de familia también se resta de la tarifa. Álvaro es el mayor y no lo lleva.
      await put('/school/settings', { feeMode: 'FIXED', familyDiscountCents: 500 }).expect(200);
      await patch(`/school/students/${lucia.id}`, { tuitionTariffId: reduced.id }).expect(200);
      await post('/school/tuition/issue', { yearId: year.id, period: '2027-02', dueDate: '2027-02-05' }).expect(201);
      const fixedFamily = await get('/school/tuition/charges?period=2027-02').expect(200);
      const fixedRow = (id: string) => fixedFamily.body.data.find((c: { studentId: string }) => c.studentId === id);
      expect(fixedRow(alvaro.id)).toMatchObject({ baseCents: 4000, discountCents: 0, amountCents: 4000 });
      expect(fixedRow(lucia.id)).toMatchObject({ baseCents: 4000, discountCents: 500, amountCents: 3500 });
      expect(fixedRow(lucia.id).detail.tariff).toMatchObject({ name: 'Reducida', cents: 4000 });
      expect(fixedRow(lucia.id).detail.discounts).toContainEqual({ kind: 'FAMILY', pct: 0, cents: 500 });

      await put('/school/settings', { feeMode: 'PERCENT', familyDiscountCents: 500 }).expect(200);
      await patch(`/school/students/${alvaro.id}`, { tuitionTariffId: null }).expect(200);
      await patch(`/school/students/${lucia.id}`, { tuitionTariffId: null }).expect(200);
      await post('/school/tuition/issue', { yearId: year.id, period: '2026-12', dueDate: '2026-12-05' }).expect(201);
      const percent = await get('/school/tuition/charges?period=2026-12').expect(200);
      const row = (id: string) => percent.body.data.find((c: { studentId: string }) => c.studentId === id);
      // Álvaro es el mayor: no lleva descuento de familia. 25 % de 7500.
      expect(row(alvaro.id)).toMatchObject({ discountCents: 1875, amountCents: 5625 });
      // Lucía es la adicional: 15 % de 3000 (450) más 5 € de familia.
      expect(row(lucia.id)).toMatchObject({ baseCents: 3000, discountCents: 950, amountCents: 2050 });
      expect(row(lucia.id).detail.discounts).toContainEqual({ kind: 'FAMILY', pct: 0, cents: 500 });
      // El importe fijo no deja el cargo en negativo.
      await put('/school/settings', { familyDiscountCents: 100000 }).expect(200);
      await post('/school/tuition/issue', { yearId: year.id, period: '2027-01', dueDate: '2027-01-05' }).expect(201);
      const capped = await get('/school/tuition/charges?period=2027-01').expect(200);
      const luciaCapped = capped.body.data.find((c: { studentId: string }) => c.studentId === lucia.id);
      expect(luciaCapped).toMatchObject({ discountCents: 3000, amountCents: 0 });

      // El 2.º y el 3.º restan el mismo importe: 5 € + 5 € = 10 € en la familia.
      await put('/school/settings', { familyDiscountCents: 500 }).expect(200);
      const nerea = (await post('/school/students', { familyId: family.id, firstName: 'Nerea', lastName: 'Pérez', birthDate: '2019-01-01' }).expect(201)).body;
      await post('/school/enrollments', { studentId: nerea.id, groupId: gTheory.id }).expect(201);
      await post('/school/tuition/issue', { yearId: year.id, period: '2027-03', dueDate: '2027-03-05' }).expect(201);
      const three = await get('/school/tuition/charges?period=2027-03').expect(200);
      const byRank = (id: string) => three.body.data.find((c: { studentId: string }) => c.studentId === id);
      expect(byRank(alvaro.id).detail.discounts.some((d: { kind: string }) => d.kind === 'FAMILY')).toBe(false);
      expect(byRank(lucia.id).detail.discounts).toContainEqual({ kind: 'FAMILY', pct: 0, cents: 500 });
      expect(byRank(nerea.id)).toMatchObject({ baseCents: 3000, discountCents: 950, amountCents: 2050 });
      expect(byRank(nerea.id).detail.discounts).toContainEqual({ kind: 'FAMILY', pct: 0, cents: 500 });
      await patch(`/school/students/${nerea.id}`, { status: 'LEFT' }).expect(200);

      await put('/school/settings', { familyDiscountCents: 0 }).expect(200);
      await ctx.db.system.tuitionCharge.deleteMany({ where: { period: { in: ['2026-11', '2026-12', '2027-01', '2027-02', '2027-03'] }, studentId: { in: [alvaro.id, lucia.id, nerea.id] } } });
    });

    it('simula la cuota con una configuración sin guardar', async () => {
      const saved = await post('/school/tuition/preview', { yearId: year.id, familyId: family.id }).expect(200);
      expect(saved.body).toMatchObject({ students: 2, totalBaseCents: 10500, totalAmountCents: 8175 });
      const what = await post('/school/tuition/preview', { yearId: year.id, familyId: family.id, settings: { siblingDiscountPct: 50, memberDiscountPct: 0, multiSubjectDiscountPct: 0 } }).expect(200);
      // Sólo Lucía es hermana: la mitad de 3000.
      expect(what.body).toMatchObject({ totalDiscountCents: 1500, totalAmountCents: 9000 });
      expect(what.body.rows.find((r: { studentId: string }) => r.studentId === lucia.id).student).toMatchObject({ firstName: 'Lucía' });
      // No se ha guardado nada.
      expect((await get('/school/settings').expect(200)).body.siblingDiscountPct).toBe(10);
      await post('/school/tuition/preview', { yearId: year.id }, teacherToken).expect(403);
    });

    it('cobra varias a la vez o todo lo de una familia, con la forma de pago', async () => {
      await post('/school/tuition/issue', { yearId: year.id, period: '2026-11', dueDate: '2026-11-05' }).expect(201);
      await post('/school/tuition/issue', { yearId: year.id, period: '2026-12', dueDate: '2026-12-05' }).expect(201);
      const nov = (await get('/school/tuition/charges?period=2026-11').expect(200)).body.data as { id: string; amountCents: number }[];
      const many = await post('/school/tuition/charges/pay', { chargeIds: nov.map((c) => c.id), date: '2026-11-10', method: 'TRANSFER' }).expect(200);
      expect(many.body).toMatchObject({ paid: 2, skipped: 0, amountCents: nov.reduce((s, c) => s + c.amountCents, 0) });
      const repeat = await post('/school/tuition/charges/pay', { chargeIds: nov.map((c) => c.id), date: '2026-11-10' }).expect(200);
      expect(repeat.body).toMatchObject({ paid: 0, skipped: 2 });
      const fam = await post(`/school/tuition/families/${family.id}/pay`, { date: '2026-12-02', method: 'CASH' }).expect(200);
      expect(fam.body.paid).toBe(2);
      const dec = (await get('/school/tuition/charges?period=2026-12').expect(200)).body.data as { status: string; paymentMethod: string }[];
      expect(dec.every((c) => c.status === 'PAID' && c.paymentMethod === 'CASH')).toBe(true);
      const none = await post(`/school/tuition/families/${family.id}/pay`, { date: '2026-12-02' }).expect(400);
      expect(none.body.code).toBe('NOTHING_TO_PAY');
      await ctx.db.system.tuitionCharge.deleteMany({ where: { period: { in: ['2026-11', '2026-12'] } } });
    });

    it('la tarea nocturna marca vencidas y emite en el día programado', async () => {
      const processors = new Processors(ctx.db, ctx.jobs as never, ...(Array(7).fill(null) as [never, never, never, never, never, never, never]));
      const charge = await ctx.db.system.tuitionCharge.findFirstOrThrow({ where: { studentId: lucia.id, period: '2026-10' } });
      await ctx.db.system.tuitionCharge.update({ where: { id: charge.id }, data: { status: 'PENDING' } });
      const overdue = await processors.overdue(new Date('2026-10-20T10:00:00Z'));
      expect(overdue.tuitionOverdue).toBeGreaterThanOrEqual(1);
      expect((await ctx.db.system.tuitionCharge.findUniqueOrThrow({ where: { id: charge.id } })).status).toBe('OVERDUE');
      await ctx.db.system.tuitionCharge.update({ where: { id: charge.id }, data: { status: 'WAIVED' } });

      // Día 3 programado: emite el mes del curso actual con vencimiento el día 10.
      await put('/school/settings', { autoIssueDay: 3, autoIssueDueDay: 10 }).expect(200);
      await put('/school/settings', { autoIssueDay: 29 }).expect(400);
      const off = await processors.tuitionIssue(new Date('2027-01-04T10:00:00Z'));
      expect(off.issued).toBe(0);
      const on = await processors.tuitionIssue(new Date('2027-01-03T10:00:00Z'));
      expect(on.issued).toBe(2);
      const jan = await ctx.db.system.tuitionCharge.findMany({ where: { tenantId: A.tenantId, period: '2027-01' } });
      expect(jan.map((c) => c.dueDate.toISOString().slice(0, 10))).toEqual(['2027-01-10', '2027-01-10']);
      expect((await processors.tuitionIssue(new Date('2027-01-03T10:00:00Z'))).issued).toBe(0);
      // Fuera de las fechas del curso no emite.
      expect((await processors.tuitionIssue(new Date('2027-08-03T10:00:00Z'))).issued).toBe(0);
      await put('/school/settings', { autoIssueDay: null }).expect(200);
      await ctx.db.system.tuitionCharge.deleteMany({ where: { period: '2027-01' } });
    });

    it('el rol de coordinación gestiona la escuela y sus cobros sin acceso a tesorería', async () => {
      const coord = await addUser(ctx, A, 'school_coordinator', 'coordina@escuela.local');
      await get('/school/tuition/charges', coord).expect(200);
      await post('/school/tuition/preview', { yearId: year.id }, coord).expect(200);
      await get('/finance/transactions', coord).expect(403);
      const secretary = await addUser(ctx, A, 'secretary', 'secre@escuela.local');
      await get('/school/tuition/charges', secretary).expect(403);
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
      const mail = ctx.jobs.of('email.send').find((j) => j.data.to === 'elena@sanz.local' && j.data.subject.includes('Matrícula aceptada'))!;
      expect(mail.data.text).toContain('Lenguaje 1º: plaza confirmada');
      // Con la invitación al aceptar activada, Elena recibe además el enlace al portal.
      expect(acc.body.portal).toBe('invited');
      expect(mail.data.text).toContain('Os llegará otro email con el enlace');
      expect(ctx.jobs.of('email.send').some((j) => j.data.to === 'elena@sanz.local' && /invite\//.test(j.data.text))).toBe(true);
    });

    it('avisa al pasar a lista de espera o rechazar, salvo que la escuela no avise', async () => {
      const send = (name: string) =>
        ctx.http().post(api('/public/schools/escuela-a/applications')).send({
          studentFirstName: name, studentLastName: 'Ruiz', guardianName: 'Tutor Ruiz', guardianEmail: `${name.toLowerCase()}@ruiz.local`, subjectIds: [theory.id], consent: true,
        }).expect(201);
      const a = (await send('Iker')).body;
      await post(`/school/applications/${a.id}/waitlist`).expect(200);
      expect(ctx.jobs.of('email.send').filter((j) => j.data.to === 'iker@ruiz.local').map((j) => j.data.subject)).toEqual(['Banda escuela-a: Matrícula en lista de espera']);
      await post(`/school/applications/${a.id}/waitlist`).expect(200);
      expect(ctx.jobs.of('email.send').filter((j) => j.data.to === 'iker@ruiz.local')).toHaveLength(1);
      await put('/school/settings', { notifyFamilies: false }).expect(200);
      const b = (await send('Ona')).body;
      await post(`/school/applications/${b.id}/reject`).expect(200);
      expect(ctx.jobs.of('email.send').some((j) => j.data.to === 'ona@ruiz.local')).toBe(false);
      await put('/school/settings', { notifyFamilies: true }).expect(200);
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
      expect(inv.body.linked).toBeFalsy();
      const mail = ctx.jobs.of('email.send').find((j) => j.data.to === 'marta@familia.local' && /invite\//.test(j.data.text))!;
      const token = /invite\/([\w-]+)/.exec(mail.data.text)![1];
      const acc = await ctx.http().post(api('/auth/invitations/accept')).send({ token, name: 'Marta Pérez', password: PASSWORD }).expect(200);
      expect(acc.body.session.role.key).toBe('family');
      expect(acc.body.session.permissions).toContain('school:family');
      expect(acc.body.session.guardianId).toBe(guardian.id);
      familyToken = acc.body.accessToken;
      await post(`/school/guardians/${guardian.id}/invite`).expect(409);

      const portal = await get('/school/family', familyToken).expect(200);
      expect(portal.body.students.map((s: { firstName: string }) => s.firstName).sort()).toEqual(['Lucía', 'Álvaro']);
      expect(portal.body.absences).toHaveLength(1);
      expect(portal.body.charges).toHaveLength(2);
      expect(portal.body.family.name).toBe('Familia Pérez');
      // La familia no accede al back-office.
      await get('/school/students', familyToken).expect(403);
      await get('/school/family').expect(404);
    });

    it('un músico de la banda puede ser tutor y conservar su rol', async () => {
      const musicianToken = await addUser(ctx, A, 'musician', 'musico-tutor@test.local');
      const other = await post(`/school/families/${family.id}/guardians`, {
        firstName: 'Luis',
        lastName: 'Músico',
        email: 'musico-tutor@test.local',
        relationship: 'Padre',
      }).expect(201);
      const linked = await post(`/school/guardians/${other.body.id}/invite`).expect(201);
      expect(linked.body).toMatchObject({ linked: true, guardianId: other.body.id });
      const me = await get('/auth/me', musicianToken).expect(200);
      expect(me.body.role.key).toBe('musician');
      expect(me.body.permissions).toContain('school:family');
      expect(me.body.guardianId).toBe(other.body.id);
      const portal = await get('/school/family', musicianToken).expect(200);
      expect(portal.body.family.name).toBe('Familia Pérez');
      await get('/school/students', musicianToken).expect(403);
      await del(`/school/guardians/${other.body.id}/link`).expect(204);
      const after = await get('/auth/me', musicianToken).expect(200);
      expect(after.body.permissions).not.toContain('school:family');
      expect(after.body.guardianId).toBeNull();
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

    it('la familia ve sus próximas clases y se entera de las cancelaciones', async () => {
      const today = madridToday().iso;
      const portal = await get('/school/family', familyToken).expect(200);
      const upcoming = portal.body.upcoming as { id: string; date: string; status: string; studentIds: string[]; group: { id: string } }[];
      if (today > '2027-06-30') return;
      expect(upcoming.length).toBeGreaterThan(0);
      expect(upcoming.every((u) => u.date.slice(0, 10) >= today)).toBe(true);
      const first = upcoming.find((u) => u.group.id === gTheory.id)!;
      expect(first.studentIds).toEqual(expect.arrayContaining([alvaro.id, lucia.id]));
      await post(`/school/sessions/${first.id}/cancel`, { notes: 'Concierto' }, teacherToken).expect(200);
      const job = ctx.jobs.of('notify.fanout').find((j) => j.data.type === 'school.class_cancelled')!;
      expect(job.data).toMatchObject({ email: true, link: '/family' });
      expect(job.data.body).toContain('Concierto');
      const after = (await get('/school/family', familyToken).expect(200)).body.upcoming as { id: string; status: string }[];
      expect(after.find((u) => u.id === first.id)!.status).toBe('CANCELLED');
    });

    it('la familia justifica una falta, el profesorado la revisa y queda justificada', async () => {
      const portal = await get('/school/family', familyToken).expect(200);
      const absence = portal.body.absences.find((a: { status: string }) => a.status === 'ABSENT');
      await post(`/school/family/absences/${absence.id}/justify`, { text: 'x' }, familyToken).expect(400);
      const sent = await post(`/school/family/absences/${absence.id}/justify`, { text: 'Estaba con fiebre' }, familyToken).expect(200);
      expect(sent.body.justificationStatus).toBe('PENDING');
      // Sin tutor vinculado (o de otra banda) no hay falta que justificar.
      await post(`/school/family/absences/${absence.id}/justify`, { text: 'No es mía' }, B.token).expect(404);
      await post(`/school/family/absences/${absence.id}/justify`, { text: 'No es mía' }, teacherToken).expect(403);
      const pending = (await get('/school/justifications', teacherToken).expect(200)).body as { id: string; justification: string }[];
      expect(pending.map((p) => p.id)).toContain(absence.id);
      expect((await get(`/school/overview?yearId=${year.id}`).expect(200)).body.counts.pendingJustifications).toBeGreaterThanOrEqual(1);
      await post(`/school/attendance/${absence.id}/review`, { approved: true }, teacherToken).expect(200);
      await post(`/school/attendance/${absence.id}/review`, { approved: true }, teacherToken).expect(400);
      const again = (await get('/school/family', familyToken).expect(200)).body.absences.find((a: { id: string }) => a.id === absence.id);
      expect(again).toMatchObject({ status: 'EXCUSED', justificationStatus: 'APPROVED', justification: 'Estaba con fiebre' });
    });

    it('la familia ve cómo pagó cada recibo y actualiza su contacto', async () => {
      const portal = (await get('/school/family', familyToken).expect(200)).body;
      const paid = portal.charges.find((c: { status: string }) => c.status === 'PAID');
      expect(paid).toMatchObject({ paymentMethod: 'BIZUM' });
      expect(paid.paidAt.slice(0, 10)).toBe('2026-10-06');
      const c = await patch('/school/family/contact', { phone: '600 000 111', email: 'Marta.Nueva@familia.local' }, familyToken).expect(200);
      expect(c.body).toMatchObject({ phone: '600 000 111', email: 'marta.nueva@familia.local' });
      await patch('/school/family/contact', { email: 'no-es-email' }, familyToken).expect(400);
      const g = await get(`/school/families/${family.id}`).expect(200);
      expect(g.body.guardians.find((x: { id: string }) => x.id === guardian.id).phone).toBe('600 000 111');
      expect((await get('/school/family', familyToken).expect(200)).body.guardian.email).toBe('marta.nueva@familia.local');
      await patch('/school/family/contact', { email: 'marta@familia.local' }, familyToken).expect(200);
    });

    it('da acceso al portal a todas las familias pendientes de una vez', async () => {
      const fam = (await post('/school/families', { name: 'Familia Lote' }).expect(201)).body;
      await post(`/school/families/${fam.id}/guardians`, { firstName: 'Pilar', lastName: 'Lote', email: 'pilar@lote.local' }).expect(201);
      await post(`/school/families/${fam.id}/guardians`, { firstName: 'Sin', lastName: 'Email' }).expect(201);
      await post('/school/students', { familyId: fam.id, firstName: 'Iris', lastName: 'Lote' }).expect(201);
      const before = (await get(`/school/overview?yearId=${year.id}`).expect(200)).body.counts;
      expect(before.guardiansWithoutPortal).toBeGreaterThanOrEqual(1);
      expect(before.guardiansWithoutContact).toBeGreaterThanOrEqual(1);
      const r = await post('/school/guardians/invite-all').expect(200);
      expect(r.body.invited).toBeGreaterThanOrEqual(1);
      expect(r.body.withoutEmail).toBeGreaterThanOrEqual(1);
      expect(r.body.limitReached).toBe(false);
      expect(ctx.jobs.of('email.send').some((j) => j.data.to === 'pilar@lote.local' && /invite\//.test(j.data.text))).toBe(true);
      // Las invitaciones vigentes no se repiten.
      expect((await post('/school/guardians/invite-all').expect(200)).body).toMatchObject({ invited: 0, linked: 0 });
      expect((await get(`/school/overview?yearId=${year.id}`).expect(200)).body.counts.guardiansWithoutPortal).toBe(0);
      await post('/school/guardians/invite-all', {}, teacherToken).expect(403);
    });
  });

  describe('gestión del día a día', () => {
    it('el panel de inicio dice qué falta y resume el curso', async () => {
      const o = await get(`/school/overview?yearId=${year.id}`).expect(200);
      expect(o.body.year).toMatchObject({ id: year.id, name: '2026-27', isCurrent: true });
      expect(o.body.counts).toMatchObject({ groups: expect.any(Number), conflicts: 0 });
      const done = Object.fromEntries(o.body.checklist.map((c: { id: string; done: boolean }) => [c.id, c.done]));
      expect(done).toMatchObject({ year: true, current: true, subjects: true, teachers: true, groups: true, fees: true, enrollment: true });
      expect(o.body.tuition).toMatchObject({ autoIssueDay: null });
      // El profesor ve el resumen, pero ni la lista de configuración ni los cobros.
      const t = await get('/school/overview', teacherToken).expect(200);
      expect(t.body.checklist).toEqual([]);
      expect(t.body.tuition).toBeNull();
      // Una banda sin cursos tiene pendiente crearlo y montar los grupos.
      const empty = await get('/school/overview', B.token).expect(200);
      expect(empty.body.year).toBeNull();
      const pending = Object.fromEntries(empty.body.checklist.map((c: { id: string; done: boolean }) => [c.id, c.done]));
      expect(pending).toMatchObject({ year: false, current: false, groups: false, slots: false });
    });

    it('da de alta y matricula en el mismo paso, y actúa sobre varios alumnos', async () => {
      const pau = (await post('/school/students', { familyId: family.id, firstName: 'Pau', lastName: 'Pérez', groupIds: [gTheory.id] }).expect(201)).body;
      expect(pau.enrollments.map((e: { groupId: string; status: string }) => [e.groupId, e.status])).toEqual([[gTheory.id, 'ACTIVE']]);
      const ona = (await post('/school/students', { firstName: 'Ona', lastName: 'Mas' }).expect(201)).body;
      const enrolled = await post('/school/students/bulk', { studentIds: [pau.id, ona.id], action: { type: 'enroll', groupId: gTheory.id } }).expect(200);
      expect(enrolled.body).toEqual({ updated: 1, waitlisted: 0, skipped: 1 });
      const tariff = (await post('/school/tariffs', { name: 'Lote', monthlyCents: 2000 }).expect(201)).body;
      expect((await post('/school/students/bulk', { studentIds: [pau.id, ona.id], action: { type: 'tariff', tariffId: tariff.id } }).expect(200)).body.updated).toBe(2);
      expect((await get(`/school/students/${ona.id}`).expect(200)).body.tuitionTariff.name).toBe('Lote');
      await post('/school/students/bulk', { studentIds: [pau.id, ona.id], action: { type: 'tariff', tariffId: null } }).expect(200);
      await del(`/school/tariffs/${tariff.id}`).expect(204);
      const left = await post('/school/students/bulk', { studentIds: [pau.id, ona.id], action: { type: 'status', status: 'LEFT' } }).expect(200);
      expect(left.body.updated).toBe(2);
      const pauAfter = await get(`/school/students/${pau.id}`).expect(200);
      expect(pauAfter.body.enrollments.every((e: { status: string }) => e.status === 'WITHDRAWN')).toBe(true);
      await post('/school/students/bulk', { studentIds: [pau.id], action: { type: 'enroll', groupId: gTheory.id } }, teacherToken).expect(403);
      // Un id que no es de la banda invalida el lote entero.
      await post('/school/students/bulk', { studentIds: [pau.id, '00000000-0000-4000-8000-000000000000'], action: { type: 'status', status: 'ACTIVE' } }).expect(400);
    });

    it('importa alumnos y familias de una hoja de cálculo, primero en simulación', async () => {
      const rows = [
        { studentFirstName: 'Mar', studentLastName: 'Gil', birthDate: '2016-02-02', familyName: 'Familia Gil', guardianFirstName: 'Rosa', guardianLastName: 'Gil', guardianEmail: 'rosa@gil.local' },
        { studentFirstName: 'Leo', studentLastName: 'Gil', birthDate: '2018-03-03', guardianEmail: 'ROSA@gil.local' },
        { studentFirstName: 'Álvaro', studentLastName: 'Pérez', birthDate: '2015-03-01' },
        { studentFirstName: '', studentLastName: 'Sin nombre' },
        { studentFirstName: 'Teo', studentLastName: 'Paz', birthDate: '01/02/2015' },
      ];
      const dry = await post('/school/students/import', { rows }).expect(200);
      expect(dry.body).toMatchObject({ dryRun: true, total: 5, created: 2, newFamilies: 1, duplicates: 1 });
      expect(dry.body.errors.map((e: { row: number }) => e.row)).toEqual([3, 4, 5]);
      expect(await ctx.db.system.student.count({ where: { tenantId: A.tenantId, lastName: 'Gil' } })).toBe(0);
      const real = await post('/school/students/import', { rows, dryRun: false }).expect(200);
      expect(real.body).toMatchObject({ created: 2, newFamilies: 1 });
      const gil = await ctx.db.system.student.findMany({ where: { tenantId: A.tenantId, lastName: 'Gil' }, include: { family: { include: { guardians: true } } } });
      expect(new Set(gil.map((s) => s.familyId)).size).toBe(1);
      expect(gil[0].family!.guardians.map((g) => g.email)).toEqual(['rosa@gil.local']);
      // Volver a importar no duplica.
      expect((await post('/school/students/import', { rows, dryRun: false }).expect(200)).body).toMatchObject({ created: 0, duplicates: 3 });
      await post('/school/students/import', { rows }, teacherToken).expect(403);
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

    it('el asistente crea el curso, copia del anterior y deja listas las sesiones', async () => {
      const summary = await get(`/school/years/${year.id}/summary`).expect(200);
      expect(summary.body.groups.map((g: { name: string }) => g.name)).toEqual(expect.arrayContaining(['Lenguaje 1º', 'Clarinete A', 'Coro infantil']));
      expect(summary.body.students).toBeGreaterThan(0);
      const created = await post('/school/years', {
        name: '2028-29', startsOn: '2028-09-01', endsOn: '2029-06-30', holidays: ['2028-10-09'], isCurrent: true, enrollmentOpen: true,
        copyFrom: { sourceYearId: year.id, renewEnrollments: false },
      }).expect(201);
      expect(created.body.copied).toMatchObject({ groups: 3, enrollments: 0 });
      const groups = (await get(`/school/groups?yearId=${created.body.id}`).expect(200)).body as { id: string; name: string }[];
      const lenguaje = groups.find((g) => g.name === 'Lenguaje 1º')!;
      const sessions = (await get(`/school/groups/${lenguaje.id}/sessions`).expect(200)).body as { date: string }[];
      expect(sessions.length).toBeGreaterThan(30);
      expect(sessions[0].date.slice(0, 10)).toBe('2028-09-04');
      expect(sessions.map((x) => x.date.slice(0, 10))).not.toContain('2028-10-09');
      // Sólo un curso es el actual.
      const years = (await get('/school/years').expect(200)).body as { isCurrent: boolean }[];
      expect(years.filter((y) => y.isCurrent)).toHaveLength(1);
      await patch(`/school/years/${year.id}`, { isCurrent: true }).expect(200);
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
