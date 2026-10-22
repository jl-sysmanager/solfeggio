/**
 * Aislamiento multi-tenant. La banda B intenta leer, modificar y referenciar datos de la banda A
 * por todas las vías: ids directos, listados, búsqueda, referencias cruzadas en cuerpos, cambio
 * de tenant en el token y acceso directo a la base de datos con el rol de la aplicación.
 */
import { Prisma } from '@prisma/client';
import { auth, Band, createTestApp, resetDb, signupBand, TestCtx } from './helpers';

describe('Aislamiento entre tenants', () => {
  let ctx: TestCtx;
  let a: Band;
  let b: Band;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.db);
    a = await signupBand(ctx, 'banda-a');
    b = await signupBand(ctx, 'banda-b');
    const http = () => ctx.http();

    ids.member = (await http().post('/api/v1/members').set(auth(a.token)).send({ firstName: 'Ana', lastName: 'Secreta', iban: 'ES9121000418450200051332', nationalId: '12345678Z' }).expect(201)).body.id;
    ids.composer = (await http().post('/api/v1/composers').set(auth(a.token)).send({ name: 'Compositor A' }).expect(201)).body.id;
    ids.work = (await http().post('/api/v1/works').set(auth(a.token)).send({ title: 'Marcha Exclusiva', composerId: ids.composer, tags: ['privada'] }).expect(201)).body.id;
    ids.event = (await http().post('/api/v1/events').set(auth(a.token)).send({ type: 'REHEARSAL', title: 'Ensayo A', startsAt: '2030-01-10T18:00:00Z', endsAt: '2030-01-10T20:00:00Z' }).expect(201)).body.id;
    ids.instrument = (await http().post('/api/v1/instruments').set(auth(a.token)).send({ inventoryCode: 'A-1', type: 'Tuba' }).expect(201)).body.id;
    ids.item = (await http().post('/api/v1/wardrobe/items').set(auth(a.token)).send({ code: 'U-1', garment: 'Chaqueta', size: 'M' }).expect(201)).body.id;
    ids.fee = (await http().post('/api/v1/finance/fees').set(auth(a.token)).send({ name: 'Cuota', amountCents: 5000, periodicity: 'YEARLY' }).expect(201)).body.id;
    await http().post(`/api/v1/finance/fees/${ids.fee}/issue`).set(auth(a.token)).send({ period: '2030', dueDate: '2030-12-31' }).expect(201);
    ids.charge = (await http().get('/api/v1/finance/charges').set(auth(a.token)).expect(200)).body.data[0].id;
    ids.listing = (await http().post('/api/v1/market/listings').set(auth(a.token)).send({ title: 'Tuba Yamaha', description: 'Tuba en buen estado, poco uso', category: 'Viento metal', condition: 'GOOD', priceCents: 150000 }).expect(201)).body.id;
    ids.role = (await http().get('/api/v1/roles').set(auth(a.token)).expect(200)).body[0].id;

    ids.bEvent = (await http().post('/api/v1/events').set(auth(b.token)).send({ type: 'REHEARSAL', title: 'Ensayo B', startsAt: '2030-01-11T18:00:00Z', endsAt: '2030-01-11T20:00:00Z' }).expect(201)).body.id;
    ids.bMember = (await http().post('/api/v1/members').set(auth(b.token)).send({ firstName: 'Bea', lastName: 'B' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('lectura por id devuelve 404 (sin revelar existencia)', () => {
    const cases: [string, () => string][] = [
      ['socio', () => `/api/v1/members/${ids.member}`],
      ['exportación RGPD', () => `/api/v1/members/${ids.member}/export`],
      ['obra', () => `/api/v1/works/${ids.work}`],
      ['evento', () => `/api/v1/events/${ids.event}`],
      ['instrumento', () => `/api/v1/instruments/${ids.instrument}`],
    ];
    it.each(cases)('%s', async (_, url) => {
      const res = await ctx.http().get(url()).set(auth(b.token));
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('Secreta');
    });
  });

  describe('escritura sobre recursos ajenos devuelve 404 y no modifica nada', () => {
    const cases: [string, 'patch' | 'post' | 'delete' | 'put', () => string, () => object][] = [
      ['editar socio', 'patch', () => `/api/v1/members/${ids.member}`, () => ({ firstName: 'Hackeado' })],
      ['dar de baja socio', 'post', () => `/api/v1/members/${ids.member}/leave`, () => ({ date: '2030-01-01' })],
      ['anonimizar socio', 'post', () => `/api/v1/members/${ids.member}/anonymize`, () => ({})],
      ['editar obra', 'patch', () => `/api/v1/works/${ids.work}`, () => ({ title: 'Hackeada' })],
      ['borrar obra', 'delete', () => `/api/v1/works/${ids.work}`, () => ({})],
      ['cancelar evento', 'post', () => `/api/v1/events/${ids.event}/cancel`, () => ({})],
      ['pasar lista en evento ajeno', 'put', () => `/api/v1/events/${ids.event}/attendance`, () => ([{ memberId: ids.member, status: 'ABSENT' }])],
      ['cobrar cuota ajena', 'post', () => `/api/v1/finance/charges/${ids.charge}/pay`, () => ({ date: '2030-01-01' })],
      ['asignar instrumento ajeno', 'post', () => `/api/v1/instruments/${ids.instrument}/assign`, () => ({ memberId: ids.bMember })],
      ['entregar uniforme ajeno', 'post', () => `/api/v1/wardrobe/items/${ids.item}/deliver`, () => ({ memberId: ids.bMember, conditionOut: 'GOOD' })],
      ['editar rol ajeno', 'patch', () => `/api/v1/roles/${ids.role}`, () => ({ name: 'Pirata' })],
      ['editar anuncio ajeno', 'patch', () => `/api/v1/market/listings/${ids.listing}`, () => ({ title: 'Robado' })],
      ['enviar a moderación anuncio ajeno', 'post', () => `/api/v1/market/listings/${ids.listing}/submit`, () => ({})],
    ];
    it.each(cases)('%s', async (_, method, url, body) => {
      const res = await ctx.http()[method](url()).set(auth(b.token)).send(body());
      expect(res.status).toBe(404);
    });

    it('los datos de A siguen intactos', async () => {
      const m = await ctx.http().get(`/api/v1/members/${ids.member}`).set(auth(a.token)).expect(200);
      expect(m.body.firstName).toBe('Ana');
      expect(m.body.status).toBe('ACTIVE');
      const w = await ctx.http().get(`/api/v1/works/${ids.work}`).set(auth(a.token)).expect(200);
      expect(w.body.title).toBe('Marcha Exclusiva');
      const charges = await ctx.http().get('/api/v1/finance/charges').set(auth(a.token)).expect(200);
      expect(charges.body.data[0].status).toBe('PENDING');
    });
  });

  describe('referencias cruzadas en el cuerpo de la petición', () => {
    it('no se puede pasar lista en un evento propio con un socio ajeno', async () => {
      await ctx.http().put(`/api/v1/events/${ids.bEvent}/attendance`).set(auth(b.token)).send([{ memberId: ids.member, status: 'PRESENT' }]).expect(404);
    });

    it('no se puede añadir al repertorio una obra ajena', async () => {
      await ctx.http().put(`/api/v1/events/${ids.bEvent}/repertoire`).set(auth(b.token)).send([{ workId: ids.work }]).expect(404);
    });

    it('convocar socios ajenos no crea convocatorias', async () => {
      const res = await ctx.http().post(`/api/v1/events/${ids.bEvent}/calls`).set(auth(b.token)).send({ memberIds: [ids.member] }).expect(201);
      expect(res.body.added).toBe(0);
    });

    it('no se puede crear una obra con un compositor ajeno', async () => {
      await ctx.http().post('/api/v1/works').set(auth(b.token)).send({ title: 'X', composerId: ids.composer }).expect(404);
    });

    it('no se puede registrar un movimiento vinculado a un socio ajeno', async () => {
      await ctx.http().post('/api/v1/finance/transactions').set(auth(b.token)).send({ kind: 'INCOME', amountCents: 100, date: '2030-01-01', description: 'x', memberId: ids.member }).expect(404);
    });

    it('no se puede invitar con un rol ajeno', async () => {
      await ctx.http().post('/api/v1/invitations').set(auth(b.token)).send({ email: 'x@test.local', roleId: ids.role }).expect(404);
    });

    it('no se puede confirmar un archivo con una clave de otro tenant', async () => {
      const key = `tenants/${a.tenantId}/documents/robado.pdf`;
      ctx.storage.objects.set(key, 100);
      const res = await ctx.http().post('/api/v1/documents').set(auth(b.token))
        .send({ title: 'x', category: 'actas', fileKey: key, fileName: 'x.pdf', mimeType: 'application/pdf', sizeBytes: 100 });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_FILE_KEY');
    });
  });

  describe('listados y búsqueda', () => {
    it('los listados sólo contienen datos propios', async () => {
      const members = await ctx.http().get('/api/v1/members').set(auth(b.token)).expect(200);
      expect(members.body.data.map((m: { id: string }) => m.id)).toEqual([ids.bMember]);
      const events = await ctx.http().get('/api/v1/events').set(auth(b.token)).expect(200);
      expect(events.body.map((e: { id: string }) => e.id)).toEqual([ids.bEvent]);
      for (const url of ['/api/v1/works', '/api/v1/composers', '/api/v1/instruments', '/api/v1/wardrobe/items', '/api/v1/finance/fees']) {
        const res = await ctx.http().get(url).set(auth(b.token)).expect(200);
        const rows = Array.isArray(res.body) ? res.body : res.body.data;
        expect(rows).toHaveLength(0);
      }
    });

    it('la búsqueda de texto completo no encuentra obras ajenas', async () => {
      const res = await ctx.http().get('/api/v1/works?q=exclusiva').set(auth(b.token)).expect(200);
      expect(res.body.total).toBe(0);
      const tags = await ctx.http().get('/api/v1/tags').set(auth(b.token)).expect(200);
      expect(tags.body).toHaveLength(0);
    });

    it('la auditoría sólo muestra eventos propios', async () => {
      const res = await ctx.http().get('/api/v1/audit-logs?pageSize=200').set(auth(b.token)).expect(200);
      const entityIds = res.body.data.map((l: { entityId: string }) => l.entityId);
      expect(entityIds).not.toContain(ids.member);
      expect(entityIds).not.toContain(ids.work);
    });

    it('el dashboard sólo cuenta datos propios', async () => {
      const res = await ctx.http().get('/api/v1/dashboard').set(auth(b.token)).expect(200);
      expect(res.body.members.total).toBe(1);
      expect(res.body.pendingCharges.count).toBe(0);
    });
  });

  describe('token y cambio de tenant', () => {
    it('no se puede cambiar a un tenant sin membresía', async () => {
      const res = await ctx.http().post('/api/v1/auth/switch-tenant').set(auth(b.token)).send({ tenantId: a.tenantId });
      expect(res.status).toBe(401);
    });

    it('la membresía revocada invalida el token al instante', async () => {
      const c = await signupBand(ctx, 'banda-c');
      await ctx.db.system.membership.deleteMany({ where: { tenantId: c.tenantId } });
      await ctx.http().get('/api/v1/members').set(auth(c.token)).expect(401);
    });

    it('un token firmado con otro secreto se rechaza', async () => {
      const forged = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4IiwidGlkIjoieSJ9.c2lnbmF0dXJh';
      await ctx.http().get('/api/v1/members').set(auth(forged)).expect(401);
    });
  });

  describe('BandMarket: visibilidad cruzada controlada', () => {
    it('un borrador no es visible para otras bandas', async () => {
      await ctx.http().get(`/api/v1/market/listings/${ids.listing}`).set(auth(b.token)).expect(404);
      const res = await ctx.http().get('/api/v1/market/listings').set(auth(b.token)).expect(200);
      expect(res.body.total).toBe(0);
    });

    it('un anuncio publicado es visible pero no editable por otras bandas', async () => {
      await ctx.http().post(`/api/v1/market/listings/${ids.listing}/submit`).set(auth(a.token)).expect(200);
      await ctx.db.system.listing.update({ where: { id: ids.listing }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
      const res = await ctx.http().get('/api/v1/market/listings').set(auth(b.token)).expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({ isMine: false, seller: { name: 'Banda banda-a' } });
      expect(res.body.data[0]).not.toHaveProperty('tenantId');
      expect(res.body.data[0]).not.toHaveProperty('createdById');
      await ctx.http().post(`/api/v1/market/listings/${ids.listing}/sold`).set(auth(b.token)).expect(404);
      await ctx.http().post(`/api/v1/market/listings/${ids.listing}/archive`).set(auth(b.token)).expect(404);
    });

    it('los mensajes sólo los ven comprador y vendedor', async () => {
      await ctx.http().post(`/api/v1/market/listings/${ids.listing}/inquiries`).set(auth(b.token)).send({ message: 'Nos interesa la tuba' }).expect(201);
      const c = await signupBand(ctx, 'banda-d');
      const seller = await ctx.http().get('/api/v1/market/inquiries').set(auth(a.token)).expect(200);
      const buyer = await ctx.http().get('/api/v1/market/inquiries').set(auth(b.token)).expect(200);
      const other = await ctx.http().get('/api/v1/market/inquiries').set(auth(c.token)).expect(200);
      expect(seller.body[0].direction).toBe('received');
      expect(buyer.body[0].direction).toBe('sent');
      expect(other.body).toHaveLength(0);
    });
  });

  describe('defensa en profundidad en PostgreSQL (rol de aplicación)', () => {
    const appQuery = <T>(tenantId: string | null, sql: Prisma.Sql) =>
      ctx.db.app.$transaction(async (tx) => {
        if (tenantId) await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        return tx.$queryRaw<T>(sql);
      });

    it('sin contexto de tenant no se ve ninguna fila (fail-closed)', async () => {
      const rows = await appQuery<unknown[]>(null, Prisma.sql`SELECT id FROM members`);
      expect(rows).toHaveLength(0);
    });

    it('con el tenant B no se ven filas de A aunque se consulte sin WHERE', async () => {
      const rows = await appQuery<{ id: string }[]>(b.tenantId, Prisma.sql`SELECT id FROM members`);
      expect(rows.map((r) => r.id)).toEqual([ids.bMember]);
      const tenants = await appQuery<{ id: string }[]>(b.tenantId, Prisma.sql`SELECT id FROM tenants`);
      expect(tenants.map((t) => t.id)).toEqual([b.tenantId]);
    });

    it('no se puede insertar una fila con tenant_id de otro tenant', async () => {
      await expect(
        appQuery(b.tenantId, Prisma.sql`INSERT INTO sections (id, tenant_id, name) VALUES (gen_random_uuid(), ${a.tenantId}::uuid, 'intrusa') RETURNING id`),
      ).rejects.toThrow(/row-level security/);
    });

    it('UPDATE/DELETE sobre filas ajenas no afecta a ninguna', async () => {
      const updated = await ctx.db.tenant(b.tenantId, (tx) => tx.member.updateMany({ where: { id: ids.member }, data: { firstName: 'X' } }));
      const deleted = await ctx.db.tenant(b.tenantId, (tx) => tx.member.deleteMany({ where: { id: ids.member } }));
      expect(updated.count).toBe(0);
      expect(deleted.count).toBe(0);
    });

    it('el trigger impide referencias a filas de otro tenant aunque la FK exista', async () => {
      await expect(
        appQuery(b.tenantId, Prisma.sql`
          INSERT INTO attendance (id, tenant_id, "eventId", "memberId", status, "recordedById")
          VALUES (gen_random_uuid(), ${b.tenantId}::uuid, ${ids.bEvent}::uuid, ${ids.member}::uuid, 'PRESENT', ${b.userId}::uuid)`),
      ).rejects.toThrow(/cross-tenant reference attendance.memberId -> members/);
      // Vía Prisma el mismo error llega como violación de FK y la API responde 404.
      await expect(
        ctx.db.tenant(b.tenantId, (tx) => tx.attendance.create({ data: { tenantId: b.tenantId, eventId: ids.bEvent, memberId: ids.member, status: 'PRESENT', recordedById: b.userId } })),
      ).rejects.toMatchObject({ code: 'P2003' });
    });

    it('el rol de aplicación no puede alterar plan, estado ni auditoría', async () => {
      await expect(appQuery(b.tenantId, Prisma.sql`UPDATE tenants SET status = 'ACTIVE' WHERE id = ${b.tenantId}::uuid`)).rejects.toThrow(/permission denied/);
      await expect(appQuery(b.tenantId, Prisma.sql`UPDATE subscriptions SET "stripeStatus" = 'active'`)).rejects.toThrow(/permission denied/);
      await expect(appQuery(b.tenantId, Prisma.sql`DELETE FROM audit_logs`)).rejects.toThrow(/permission denied/);
    });
  });

  describe('feed ICS', () => {
    it('cada token sólo expone eventos de su banda', async () => {
      const urlA = (await ctx.http().get('/api/v1/agenda/ics-url').set(auth(a.token)).expect(200)).body.url as string;
      const path = new URL(urlA).pathname;
      const ics = await ctx.http().get(path).expect(200);
      expect(ics.text).toContain('Ensayo A');
      expect(ics.text).not.toContain('Ensayo B');
      await ctx.http().get('/api/v1/calendar/00000000-0000-0000-0000-000000000000.ics').expect(404);
    });
  });

  it('los datos sensibles se guardan cifrados en la base de datos', async () => {
    const raw = await ctx.db.system.$queryRaw<{ ibanEnc: string; nationalIdEnc: string }[]>`SELECT "ibanEnc", "nationalIdEnc" FROM members WHERE id = ${ids.member}::uuid`;
    expect(raw[0].ibanEnc).toMatch(/^v1:/);
    expect(raw[0].ibanEnc).not.toContain('ES91');
    expect(raw[0].nationalIdEnc).not.toContain('12345678Z');
  });
});
