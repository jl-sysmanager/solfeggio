import { BillingOpsService } from '../src/billing/billing-ops.service';
import { BillingService } from '../src/billing/billing.service';
import { Mailer } from '../src/integrations/mailer.service';
import { InsightsService } from '../src/platform/insights.service';
import { OpsService } from '../src/platform/ops.service';
import { SupportService } from '../src/platform/support.service';
import { Processors } from '../src/jobs/processors';
import { auth, Band, createTestApp, resetDb, signupBand, TestCtx } from './helpers';
import { resetEnvCache } from '../src/config/env';

describe('Salud técnica del panel global', () => {
  let ctx: TestCtx;
  let band: Band;
  let admin: Band;
  const http = () => ctx.http();
  const O = '/api/v1/admin/ops';
  const OPS_TOKEN = 'ops-token-0123456789abcdef';
  const MAIL_TOKEN = 'mail-token-0123456789abcdef';
  const failed = [{ id: '7', name: 'email.send', attempts: 5, error: 'SMTP caído', failedAt: new Date(), data: { to: 'a@b.c' } }];
  const calls: string[] = [];
  // El worker no forma parte de AppModule: se monta con los mismos servicios.
  const makeProcessors = () => {
    const g = <T>(t: new (...a: never[]) => T) => ctx.app.get(t, { strict: false });
    return new Processors(ctx.db, ctx.jobs as never, g(BillingService), g(Mailer), g(InsightsService), g(SupportService), g(OpsService), g(BillingOpsService));
  };

  beforeAll(async () => {
    process.env.OPS_HEARTBEAT_TOKEN = OPS_TOKEN;
    process.env.EMAIL_WEBHOOK_TOKEN = MAIL_TOKEN;
    resetEnvCache();
    ctx = await createTestApp();
    await resetDb(ctx.db);
    band = await signupBand(ctx, 'ops-band');
    admin = await signupBand(ctx, 'ops-admin');
    await ctx.db.system.user.update({ where: { email: admin.email }, data: { isPlatformAdmin: true } });
    // La cola real necesita Redis: se amplía el FakeJobs de helpers sin tocarlo.
    Object.assign(ctx.jobs, {
      counts: async () => ({ waiting: 1, active: 0, delayed: 2, completed: 10, failed: failed.length, paused: 0 }),
      repeatables: async () => [{ name: 'support.sla-sweep', pattern: '*/15 * * * *', tz: 'Europe/Madrid', next: new Date(Date.now() + 60_000) }],
      failedJobs: async () => failed,
      retryFailed: async (id?: string) => (calls.push(`retry:${id ?? 'all'}`), id && id !== '7' ? 0 : failed.length),
      removeFailed: async (id: string) => (calls.push(`remove:${id}`), id === '7'),
    });
  });
  afterAll(async () => {
    delete process.env.OPS_HEARTBEAT_TOKEN;
    delete process.env.EMAIL_WEBHOOK_TOKEN;
    resetEnvCache();
    await ctx.app.close();
  });

  it('todo /admin/ops exige administrador de plataforma', async () => {
    for (const path of ['queues', 'email', 'storage', 'schedules', 'heartbeats']) await http().get(`${O}/${path}`).set(auth(band.token)).expect(403);
    await http().post(`${O}/queues/failed/retry`).set(auth(band.token)).expect(403);
    await http().post(`${O}/storage/orphans/delete`).set(auth(band.token)).send({ confirm: 'ELIMINAR' }).expect(403);
  });

  it('colas: resumen, reintento y borrado de fallidos, auditado', async () => {
    const q = (await http().get(`${O}/queues`).set(auth(admin.token)).expect(200)).body;
    expect(q.counts.failed).toBe(1);
    expect(q.failed[0]).toMatchObject({ id: '7', error: 'SMTP caído', attempts: 5 });
    expect(q.repeatables[0].name).toBe('support.sla-sweep');
    expect((await http().post(`${O}/queues/failed/retry`).set(auth(admin.token)).expect(200)).body).toEqual({ retried: 1 });
    await http().post(`${O}/queues/failed/7/retry`).set(auth(admin.token)).expect(200);
    await http().post(`${O}/queues/failed/99/retry`).set(auth(admin.token)).expect(400);
    await http().delete(`${O}/queues/failed/7`).set(auth(admin.token)).expect(204);
    await http().delete(`${O}/queues/failed/99`).set(auth(admin.token)).expect(400);
    expect(calls).toEqual(['retry:all', 'retry:7', 'retry:99', 'remove:7', 'remove:99']);
    const audit = await ctx.db.system.platformAuditLog.findMany({ where: { action: { startsWith: 'ops.jobs' } } });
    expect(audit.map((a) => a.action).sort()).toEqual(['ops.jobs.remove', 'ops.jobs.retry', 'ops.jobs.retry_all']);
  });

  it('el procesador de email registra EmailLog con la banda', async () => {
    const processors = makeProcessors() as any;
    const mailer = processors.mailer;
    const send = jest.spyOn(mailer, 'send');
    send.mockResolvedValueOnce({ sent: true, provider: 'smtp' });
    await processors.handle({ name: 'email.send', data: { to: 'ok@x.es', subject: 'Hola', text: 't', tenantId: band.tenantId } }, null);
    send.mockRejectedValueOnce(new Error('SMTP caído'));
    await expect(processors.handle({ name: 'email.send', data: { to: 'ko@x.es', subject: 'Fallo', text: 't', tenantId: band.tenantId } }, null)).rejects.toThrow('SMTP caído');
    send.mockResolvedValueOnce({ sent: false, reason: 'disabled' });
    await processors.handle({ name: 'email.send', data: { to: 'off@x.es', subject: 'Off', text: 't' } }, null);
    send.mockRestore();
    const logs = await ctx.db.system.emailLog.findMany({ orderBy: { createdAt: 'asc' } });
    expect(logs.map((l) => [l.to, l.status, l.tenantId])).toEqual([['ok@x.es', 'SENT', band.tenantId], ['ko@x.es', 'FAILED', band.tenantId]]);
  });

  it('webhook de rebotes: exige token y registra BOUNCED/COMPLAINED por banda', async () => {
    const hook = '/api/v1/webhooks/email/sendgrid';
    const ev = { email: 'KO@x.es', type: 'bounce', reason: 'mailbox full' };
    await http().post(hook).send(ev).expect(401);
    await http().post(hook).set('x-webhook-token', 'incorrecto-incorrecto').send(ev).expect(401);
    await http().post(hook).set('x-webhook-token', MAIL_TOKEN).send({ email: 'no-es-email', type: 'bounce' }).expect(400);
    await http().post(hook).set('x-webhook-token', MAIL_TOKEN).send(ev).expect(204);
    await http().post(hook).set('Authorization', `Bearer ${MAIL_TOKEN}`).send([{ email: 'ko@x.es', type: 'complaint' }]).expect(204);
    const rows = await ctx.db.system.emailLog.findMany({ where: { status: { in: ['BOUNCED', 'COMPLAINED'] } }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => [r.status, r.tenantId])).toEqual([['BOUNCED', band.tenantId], ['COMPLAINED', band.tenantId]]);
    expect(rows[0].error).toBe('[sendgrid] mailbox full');

    const stats = (await http().get(`${O}/email`).set(auth(admin.token)).expect(200)).body;
    expect(stats.last7d).toEqual({ sent: 1, failed: 1, bounced: 1, complained: 1 });
    expect(stats.topTenants[0]).toMatchObject({ tenantId: band.tenantId, failures: 3 });
    expect(stats.recentFailures).toHaveLength(3);
  });

  it('el webhook queda desactivado sin token configurado', async () => {
    delete process.env.EMAIL_WEBHOOK_TOKEN;
    resetEnvCache();
    await http().post('/api/v1/webhooks/email/sendgrid').set('x-webhook-token', MAIL_TOKEN).send({ email: 'a@b.es', type: 'bounce' }).expect(401);
    process.env.EMAIL_WEBHOOK_TOKEN = MAIL_TOKEN;
    resetEnvCache();
  });

  it('latidos externos: token, nombres reservados y caducidad a las 26 h', async () => {
    const hb = '/api/v1/ops/heartbeat';
    await http().post(`${hb}/backup`).send({}).expect(401);
    await http().post(`${hb}/backup`).set('x-ops-token', 'x'.repeat(OPS_TOKEN.length)).send({}).expect(401);
    await http().post(`${hb}/cron.evil`).set('x-ops-token', OPS_TOKEN).send({}).expect(400);
    await http().post(`${hb}/backup`).set('x-ops-token', OPS_TOKEN).send({ detail: { file: 'x.dump.age' } }).expect(204);
    let r = (await http().get(`${O}/heartbeats`).set(auth(admin.token)).expect(200)).body;
    expect(r.heartbeats).toHaveLength(1);
    expect(r.heartbeats[0]).toMatchObject({ name: 'backup', status: 'ok', healthy: true, stale: false });

    await ctx.db.system.opsHeartbeat.update({ where: { name: 'backup' }, data: { lastRunAt: new Date(Date.now() - 27 * 3_600_000) } });
    r = (await http().get(`${O}/heartbeats`).set(auth(admin.token)).expect(200)).body;
    expect(r.heartbeats[0]).toMatchObject({ stale: true, healthy: false });
    expect(r.heartbeats[0].ageHours).toBeGreaterThan(26);

    await http().post(`${hb}/backup`).set('x-ops-token', OPS_TOKEN).send({ status: 'error' }).expect(204);
    r = (await http().get(`${O}/heartbeats`).set(auth(admin.token)).expect(200)).body;
    expect(r.heartbeats[0]).toMatchObject({ status: 'error', healthy: false, stale: false });
  });

  it('tareas programadas: último latido de cada cron y próxima ejecución', async () => {
    const processors = makeProcessors() as any;
    await processors.handle({ name: 'finance.overdue', data: {} }, null);
    const s = (await http().get(`${O}/schedules`).set(auth(admin.token)).expect(200)).body;
    expect(s.find((x: any) => x.name === 'finance.overdue')).toMatchObject({ status: 'ok', lastRunAt: expect.any(String) });
    expect(s.find((x: any) => x.name === 'storage.recount').status).toBe('never');
    expect(s.find((x: any) => x.name === 'support.sla-sweep').next).toEqual(expect.any(String));
  });

  it('almacenamiento: ranking y análisis de huérfanos sin borrar nada salvo confirmación', async () => {
    await ctx.db.system.tenant.update({ where: { id: band.tenantId }, data: { storageUsedBytes: 5_000 } });
    const old = new Date(Date.now() - 3 * 86_400_000);
    const keep = `tenants/${band.tenantId}/documents/keep.pdf`;
    await ctx.db.system.document.create({ data: { tenantId: band.tenantId, title: 'Doc', category: 'otros', fileKey: keep, fileName: 'keep.pdf', mimeType: 'application/pdf', sizeBytes: 10, uploadedById: band.userId } });
    const objects = [
      { key: keep, size: 10, lastModified: old },
      { key: `tenants/${band.tenantId}/documents/huerfano.pdf`, size: 700, lastModified: old },
      { key: `tenants/${band.tenantId}/documents/reciente.pdf`, size: 50, lastModified: new Date() },
    ];
    (ctx.storage as any).list = async () => objects;
    const removed: string[] = [];
    ctx.storage.remove = async (k: string) => void removed.push(k);

    const scan = await ctx.app.get(OpsService).scanOrphans();
    expect(scan).toEqual({ count: 1, bytes: 700, scanned: 3 });
    const st = (await http().get(`${O}/storage`).set(auth(admin.token)).expect(200)).body;
    expect(st.totalBytes).toBe(5000);
    expect(st.topTenants[0]).toMatchObject({ id: band.tenantId, usedBytes: 5000 });
    expect(st.orphans.detail).toMatchObject({ count: 1, bytes: 700 });
    expect(st.orphans.detail.sample[0].key).toContain('huerfano');
    expect(removed).toEqual([]);

    await http().post(`${O}/storage/orphans/delete`).set(auth(admin.token)).send({}).expect(400);
    await http().post(`${O}/storage/orphans/delete`).set(auth(admin.token)).send({ confirm: 'si' }).expect(400);
    expect(removed).toEqual([]);
    const del = (await http().post(`${O}/storage/orphans/delete`).set(auth(admin.token)).send({ confirm: 'ELIMINAR' }).expect(200)).body;
    expect(del).toEqual({ deleted: 1, bytes: 700 });
    expect(removed).toEqual([`tenants/${band.tenantId}/documents/huerfano.pdf`]);
    expect(await ctx.db.system.platformAuditLog.count({ where: { action: 'ops.orphans.deleted' } })).toBe(1);
  });
});
