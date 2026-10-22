import { addUser, auth, Band, createTestApp, resetDb, signupBand, TestCtx } from './helpers';

describe('RBAC, planes y estado del tenant', () => {
  let ctx: TestCtx;
  let band: Band;
  let musician: string;
  let director: string;
  let memberId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDb(ctx.db);
    band = await signupBand(ctx, 'rbac-band');
    memberId = (await ctx.http().post('/api/v1/members').set(auth(band.token)).send({ firstName: 'Músico', lastName: 'Uno', iban: 'ES9121000418450200051332' }).expect(201)).body.id;
    musician = await addUser(ctx, band, 'musician', 'musico@rbac.local', memberId);
    director = await addUser(ctx, band, 'director', 'director@rbac.local');
  });
  afterAll(() => ctx.app.close());

  it('se crean los 11 roles de sistema', async () => {
    const roles = await ctx.http().get('/api/v1/roles').set(auth(band.token)).expect(200);
    expect(roles.body.map((r: { key: string }) => r.key).sort()).toEqual(
      ['admin', 'archivist', 'collaborator', 'director', 'family', 'material_manager', 'musician', 'owner', 'secretary', 'teacher', 'treasurer'],
    );
  });

  it('un músico no puede gestionar socios ni tesorería', async () => {
    const res = await ctx.http().post('/api/v1/members').set(auth(musician)).send({ firstName: 'X', lastName: 'Y' }).expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
    await ctx.http().get('/api/v1/members').set(auth(musician)).expect(403);
    await ctx.http().get('/api/v1/finance/transactions').set(auth(musician)).expect(403);
    await ctx.http().get('/api/v1/works').set(auth(musician)).expect(200);
  });

  it('el director ve socios pero no sus datos bancarios', async () => {
    const res = await ctx.http().get(`/api/v1/members/${memberId}`).set(auth(director)).expect(200);
    expect(res.body.iban).toBeUndefined();
    expect(res.body.ibanEnc).toBeUndefined();
    expect(res.body.ibanMasked).toMatch(/1332$/);
    const owner = await ctx.http().get(`/api/v1/members/${memberId}`).set(auth(band.token)).expect(200);
    expect(owner.body.iban).toBe('ES9121000418450200051332');
  });

  it('el músico responde a su convocatoria y justifica su ausencia', async () => {
    const ev = (await ctx.http().post('/api/v1/events').set(auth(band.token)).send({ type: 'REHEARSAL', title: 'Ensayo', startsAt: '2030-02-01T18:00:00Z', endsAt: '2030-02-01T20:00:00Z' }).expect(201)).body;
    await ctx.http().post(`/api/v1/events/${ev.id}/calls`).set(auth(director)).send({ all: true }).expect(201);
    await ctx.http().post(`/api/v1/events/${ev.id}/respond`).set(auth(musician)).send({ response: 'DECLINED', note: 'Viaje' }).expect(200);
    const rec = await ctx.http().put(`/api/v1/events/${ev.id}/attendance`).set(auth(director)).send([{ memberId, status: 'ABSENT' }]).expect(200);
    await ctx.http().post(`/api/v1/attendance/${rec.body[0].id}/justification`).set(auth(musician)).send({ text: 'Viaje de trabajo' }).expect(200);
    const reviewed = await ctx.http().post(`/api/v1/attendance/${rec.body[0].id}/review`).set(auth(director)).send({ approved: true }).expect(200);
    expect(reviewed.body).toMatchObject({ status: 'EXCUSED', justificationStatus: 'APPROVED' });
    // Un músico ve sólo su propia convocatoria en el detalle del evento.
    const detail = await ctx.http().get(`/api/v1/events/${ev.id}`).set(auth(musician)).expect(200);
    expect(detail.body.calls.every((c: { memberId: string }) => c.memberId === memberId)).toBe(true);
  });

  it('los roles son configurables y el cambio se aplica al instante', async () => {
    const roles = await ctx.http().get('/api/v1/roles').set(auth(band.token)).expect(200);
    const m = roles.body.find((r: { key: string }) => r.key === 'musician');
    await ctx.http().patch(`/api/v1/roles/${m.id}`).set(auth(band.token)).send({ permissions: [...m.permissions, 'members:read'] }).expect(200);
    await ctx.http().get('/api/v1/members').set(auth(musician)).expect(200);
    await ctx.http().patch(`/api/v1/roles/${m.id}`).set(auth(band.token)).send({ permissions: m.permissions }).expect(200);
    await ctx.http().get('/api/v1/members').set(auth(musician)).expect(403);
  });

  it('no se admiten permisos inexistentes ni borrar roles de sistema', async () => {
    await ctx.http().post('/api/v1/roles').set(auth(band.token)).send({ key: 'archivero', name: 'Archivero', permissions: ['archive:write', 'root:all'] }).expect(400);
    const created = await ctx.http().post('/api/v1/roles').set(auth(band.token)).send({ key: 'archivero', name: 'Archivero', permissions: ['archive:read', 'archive:write'] }).expect(201);
    await ctx.http().delete(`/api/v1/roles/${created.body.id}`).set(auth(band.token)).expect(204);
    const owner = (await ctx.http().get('/api/v1/roles').set(auth(band.token))).body.find((r: { key: string }) => r.key === 'owner');
    await ctx.http().delete(`/api/v1/roles/${owner.id}`).set(auth(band.token)).expect(400);
  });

  it('la banda no puede quedarse sin propietario', async () => {
    const users = await ctx.http().get('/api/v1/users').set(auth(band.token)).expect(200);
    const me = users.body.find((u: { role: { key: string } }) => u.role.key === 'owner');
    const res = await ctx.http().delete(`/api/v1/users/${me.id}`).set(auth(band.token)).expect(400);
    expect(res.body.code).toBe('LAST_OWNER');
  });

  it('las acciones quedan en la auditoría sin datos sensibles', async () => {
    const res = await ctx.http().get('/api/v1/audit-logs?entity=member').set(auth(band.token)).expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).not.toContain('ES9121000418450200051332');
  });

  describe('planes', () => {
    it('el plan Free no incluye tesorería', async () => {
      const free = await signupBand(ctx, 'free-band', 'FREE');
      const res = await ctx.http().get('/api/v1/finance/transactions').set(auth(free.token)).expect(403);
      expect(res.body).toMatchObject({ code: 'FEATURE_NOT_IN_PLAN', details: { feature: 'treasury' } });
      await ctx.http().get('/api/v1/market/listings').set(auth(free.token)).expect(403);
      await ctx.http().get('/api/v1/members').set(auth(free.token)).expect(200);
    });

    it('se respeta el límite de socios del plan', async () => {
      const small = await signupBand(ctx, 'small-band', 'FREE');
      await ctx.db.system.plan.update({ where: { code: 'FREE' }, data: { maxMembers: 2 } });
      await ctx.http().post('/api/v1/members').set(auth(small.token)).send({ firstName: 'A', lastName: 'A' }).expect(201);
      await ctx.http().post('/api/v1/members').set(auth(small.token)).send({ firstName: 'B', lastName: 'B' }).expect(201);
      const res = await ctx.http().post('/api/v1/members').set(auth(small.token)).send({ firstName: 'C', lastName: 'C' }).expect(403);
      expect(res.body.code).toBe('PLAN_LIMIT');
      await ctx.db.system.plan.update({ where: { code: 'FREE' }, data: { maxMembers: 40 } });
    });

    it('se respeta el límite de usuarios contando invitaciones pendientes', async () => {
      const small = await signupBand(ctx, 'users-band', 'FREE');
      await ctx.db.system.plan.update({ where: { code: 'FREE' }, data: { maxUsers: 2 } });
      const roles = (await ctx.http().get('/api/v1/roles').set(auth(small.token))).body;
      const roleId = roles.find((r: { key: string }) => r.key === 'musician').id;
      await ctx.http().post('/api/v1/invitations').set(auth(small.token)).send({ email: 'u1@test.local', roleId }).expect(201);
      const res = await ctx.http().post('/api/v1/invitations').set(auth(small.token)).send({ email: 'u2@test.local', roleId }).expect(403);
      expect(res.body.code).toBe('PLAN_LIMIT');
      await ctx.db.system.plan.update({ where: { code: 'FREE' }, data: { maxUsers: 5 } });
    });

    it('la cuota de almacenamiento se reserva al confirmar la subida', async () => {
      const b = await signupBand(ctx, 'storage-band', 'FREE');
      await ctx.db.system.plan.update({ where: { code: 'FREE' }, data: { storageMb: 1 } });
      const work = (await ctx.http().post('/api/v1/works').set(auth(b.token)).send({ title: 'Obra' }).expect(201)).body;
      const up = await ctx.http().post(`/api/v1/works/${work.id}/assets/upload-url`).set(auth(b.token)).send({ fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 900_000 }).expect(201);
      expect(up.body.fileKey).toMatch(new RegExp(`^tenants/${b.tenantId}/archive/`));
      ctx.storage.objects.set(up.body.fileKey, 900_000);
      await ctx.http().post(`/api/v1/works/${work.id}/assets`).set(auth(b.token)).send({ ...up.body, kind: 'SCORE', fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 900_000 }).expect(201);
      const up2 = await ctx.http().post(`/api/v1/works/${work.id}/assets/upload-url`).set(auth(b.token)).send({ fileName: 'b.pdf', mimeType: 'application/pdf', sizeBytes: 900_000 }).expect(201);
      ctx.storage.objects.set(up2.body.fileKey, 900_000);
      const res = await ctx.http().post(`/api/v1/works/${work.id}/assets`).set(auth(b.token)).send({ ...up2.body, kind: 'PART', fileName: 'b.pdf', mimeType: 'application/pdf', sizeBytes: 900_000 }).expect(403);
      expect(res.body.code).toBe('PLAN_LIMIT');
      await ctx.http().post(`/api/v1/works/${work.id}/assets/upload-url`).set(auth(b.token)).send({ fileName: 'x.exe', mimeType: 'application/x-msdownload', sizeBytes: 10 }).expect(400);
      await ctx.db.system.plan.update({ where: { code: 'FREE' }, data: { storageMb: 500 } });
    });
  });

  describe('modo sólo lectura por impago', () => {
    it('bloquea escrituras, permite lecturas y la gestión de facturación', async () => {
      const b = await signupBand(ctx, 'readonly-band');
      await ctx.db.system.tenant.update({ where: { id: b.tenantId }, data: { status: 'READ_ONLY' } });
      const res = await ctx.http().post('/api/v1/members').set(auth(b.token)).send({ firstName: 'X', lastName: 'Y' }).expect(403);
      expect(res.body.code).toBe('TENANT_READ_ONLY');
      await ctx.http().get('/api/v1/members').set(auth(b.token)).expect(200);
      await ctx.http().post('/api/v1/billing/portal').set(auth(b.token)).expect(200);
    });

    it('una banda suspendida no tiene acceso', async () => {
      const b = await signupBand(ctx, 'suspended-band');
      await ctx.db.system.tenant.update({ where: { id: b.tenantId }, data: { status: 'SUSPENDED' } });
      const res = await ctx.http().get('/api/v1/members').set(auth(b.token)).expect(401);
      expect(res.body.code).toBe('TENANT_ACCESS_REVOKED');
    });
  });

  it('el panel global sólo es accesible a administradores de plataforma', async () => {
    await ctx.http().get('/api/v1/admin/tenants').set(auth(band.token)).expect(403);
    await ctx.db.system.user.update({ where: { email: band.email }, data: { isPlatformAdmin: true } });
    const res = await ctx.http().get('/api/v1/admin/tenants').set(auth(band.token)).expect(200);
    expect(res.body.total).toBeGreaterThan(0);
    const metrics = await ctx.http().get('/api/v1/admin/metrics').set(auth(band.token)).expect(200);
    expect(metrics.body.tenants.total).toBeGreaterThan(0);
  });
});
