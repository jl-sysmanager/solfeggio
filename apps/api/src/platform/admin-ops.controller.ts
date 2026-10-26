import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Put, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, PlatformAdmin, Public } from '../auth/decorators';
import { zod } from '../common/zod.pipe';
import { env } from '../config/env';
import { idParam } from '../common/schemas';
import { Jobs } from '../jobs/jobs.service';
import { SCHEDULE_CATALOG, scheduledTask } from '../jobs/schedules';
import { HEARTBEAT_STALE_HOURS, OpsService } from './ops.service';
import { TenantBackupService } from './tenant-backup.service';
import { Db } from '../db/db.service';
import { platformAudit } from './support.util';

const CRON_NAMES = SCHEDULE_CATALOG.map((task) => task.key);
/** Nombres reservados a los latidos internos del worker. */
const RESERVED = /^(cron|storage)\./;
const heartbeatName = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,59}$/i);
const heartbeatBody = z.object({ status: z.enum(['ok', 'error']).default('ok'), detail: z.record(z.unknown()).optional() });
const deliveryEvent = z.object({
  email: z.string().email().max(320),
  type: z.string().transform((v) => v.trim().toLowerCase()).pipe(z.enum(['bounce', 'bounced', 'complaint', 'complained', 'spam'])),
  reason: z.string().max(500).optional(),
});
const deliveryBody = z.union([deliveryEvent, z.array(deliveryEvent).min(1).max(100)]);
const providerParam = z.string().regex(/^[a-z0-9-]{2,30}$/);
const orphanDelete = z.object({ confirm: z.literal('ELIMINAR') });
const orphanAccountsDelete = z.object({ confirm: z.literal('ELIMINAR'), ids: z.array(z.string().uuid()).max(100).optional() });
const restoreBody = z.object({ confirm: z.string().trim().min(2).max(80) });
const backupSettingsBody = z.object({ retention: z.number().int().min(1).max(365) });
const scheduleParam = z.string().refine((value) => !!scheduledTask(value), 'Tarea no permitida');
const scheduleBody = z.object({
  pattern: z.string().trim().regex(/^(\S+\s+){4}\S+$/, 'La programación debe tener cinco campos cron').max(100),
  timezone: z.literal('Europe/Madrid').default('Europe/Madrid'),
  enabled: z.boolean(),
});

/** Comparación en tiempo constante del token recibido en cabecera (`x-ops-token` o Bearer). */
function checkToken(expected: string | undefined, header?: string, bearer?: string) {
  const given = header ?? bearer?.match(/^Bearer (.+)$/)?.[1];
  if (!expected || !given) throw new UnauthorizedException({ message: 'Token no válido', code: 'TOKEN_INVALID' });
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException({ message: 'Token no válido', code: 'TOKEN_INVALID' });
}

/**
 * Salud técnica del panel global (colas, correo, almacenamiento, tareas y copias) y los dos
 * endpoints públicos con token que la alimentan: latidos externos y rebotes de correo.
 */
@ApiTags('admin')
@ApiBearerAuth()
@PlatformAdmin()
@Controller()
export class AdminOpsController {
  constructor(
    private readonly ops: OpsService,
    private readonly jobs: Jobs,
    private readonly db: Db,
    private readonly backups: TenantBackupService,
  ) {}

  // ── Colas ────────────────────────────────────────────────────────────────

  @Get('admin/ops/queues')
  async queues() {
    const [counts, repeatables, failed] = await Promise.all([this.jobs.counts(), this.jobs.repeatables(), this.jobs.failedJobs(50)]);
    return { counts, repeatables, failed };
  }

  @HttpCode(200)
  @Post('admin/ops/queues/failed/retry')
  async retryAll(@Ctx() ctx: RequestContext) {
    const retried = await this.jobs.retryFailed();
    await platformAudit(this.db.system, ctx, 'ops.jobs.retry_all', 'queue', null, { retried });
    return { retried };
  }

  @HttpCode(200)
  @Post('admin/ops/queues/failed/:id/retry')
  async retryOne(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    const retried = await this.jobs.retryFailed(id);
    if (!retried) throw new BadRequestException({ message: 'El trabajo no existe o no está fallido', code: 'JOB_NOT_FAILED' });
    await platformAudit(this.db.system, ctx, 'ops.jobs.retry', 'queue', id);
    return { retried };
  }

  @HttpCode(204)
  @Delete('admin/ops/queues/failed/:id')
  async removeOne(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    if (!(await this.jobs.removeFailed(id))) throw new BadRequestException({ message: 'El trabajo no existe o no está fallido', code: 'JOB_NOT_FAILED' });
    await platformAudit(this.db.system, ctx, 'ops.jobs.remove', 'queue', id);
  }

  // ── Correo, almacenamiento, tareas y copias ──────────────────────────────

  @Get('admin/ops/email')
  email() {
    return this.ops.emailStats();
  }

  @Get('admin/ops/storage')
  storage() {
    return this.ops.storageStats();
  }

  @HttpCode(200)
  @Post('admin/ops/storage/orphans/scan')
  async scan(@Ctx() ctx: RequestContext) {
    const r = await this.ops.scanOrphans();
    await platformAudit(this.db.system, ctx, 'ops.orphans.scan', 'storage', null, r);
    return r;
  }

  /** Borra los objetos huérfanos. Exige confirmación explícita y queda auditado. */
  @HttpCode(200)
  @Post('admin/ops/storage/orphans/delete')
  async deleteOrphans(@Ctx() ctx: RequestContext, @Body(zod(orphanDelete)) _body: z.infer<typeof orphanDelete>) {
    const r = await this.ops.deleteOrphans();
    await platformAudit(this.db.system, ctx, 'ops.orphans.deleted', 'storage', null, r);
    return r;
  }

  /** Borra cuentas que no son del equipo y no pertenecen a ninguna banda. Exige confirmación. */
  @HttpCode(200)
  @Post('admin/ops/storage/orphans/accounts/delete')
  async deleteOrphanAccounts(@Ctx() ctx: RequestContext, @Body(zod(orphanAccountsDelete)) body: z.infer<typeof orphanAccountsDelete>) {
    const r = await this.ops.deleteOrphanAccounts(body.ids);
    await platformAudit(this.db.system, ctx, 'ops.orphan_accounts.deleted', 'user', null, r);
    return r;
  }

  /** Tareas programadas: último latido de cada cron (el worker lo registra) y próxima ejecución según BullMQ. */
  @Get('admin/ops/schedules')
  async schedules() {
    const [beats, repeatables, configured] = await Promise.all([this.ops.heartbeats(), this.jobs.repeatables().catch(() => []), this.db.system.scheduledTask.findMany()]);
    return SCHEDULE_CATALOG.map((task) => {
      const name = task.key;
      const beat = beats.find((b) => b.name === `cron.${name}`);
      const rep = repeatables.find((r) => r.name === name);
      const config = configured.find((row) => row.key === name);
      return {
        name, label: task.label, description: task.description, pattern: config?.pattern ?? rep?.pattern ?? task.pattern,
        timezone: config?.timezone ?? 'Europe/Madrid', enabled: config?.enabled ?? true, next: rep?.next ?? null,
        lastRunAt: beat?.lastRunAt ?? null, status: beat?.status ?? 'never', detail: beat?.detail ?? null,
      };
    });
  }

  @HttpCode(200)
  @Post('admin/ops/schedules/:key')
  async saveSchedule(@Ctx() ctx: RequestContext, @Param('key', zod(scheduleParam)) key: string, @Body(zod(scheduleBody)) body: z.infer<typeof scheduleBody>) {
    const row = await this.db.system.scheduledTask.upsert({
      where: { key },
      create: { key, ...body, updatedBy: ctx.userId },
      update: { ...body, updatedBy: ctx.userId },
    });
    await this.jobs.setSchedule(key as keyof import('../jobs/jobs.service').JobMap, row.pattern, row.timezone, row.enabled);
    await platformAudit(this.db.system, ctx, 'ops.schedule.updated', 'scheduled_task', row.id, { key, pattern: row.pattern, enabled: row.enabled });
    return row;
  }

  @HttpCode(202)
  @Post('admin/ops/schedules/:key/run')
  async runSchedule(@Ctx() ctx: RequestContext, @Param('key', zod(scheduleParam)) key: string) {
    await this.jobs.add(key as keyof import('../jobs/jobs.service').JobMap, {} as never);
    await platformAudit(this.db.system, ctx, 'ops.schedule.run', 'scheduled_task', key, { key });
    return { queued: true };
  }

  @Get('admin/ops/backups/settings')
  backupSettings() {
    return this.backups.settings();
  }

  @Put('admin/ops/backups/settings')
  async updateBackupSettings(@Ctx() ctx: RequestContext, @Body(zod(backupSettingsBody)) body: z.infer<typeof backupSettingsBody>) {
    const settings = await this.backups.setRetention(body.retention);
    await platformAudit(this.db.system, ctx, 'ops.backup.retention', 'platform_config', 'default', settings);
    return settings;
  }

  @Get('admin/ops/tenants/:id/backups')
  tenantBackups(@Param('id', zod(idParam)) id: string) {
    return this.backups.list(id);
  }

  @HttpCode(201)
  @Post('admin/ops/tenants/:id/backups')
  async createTenantBackup(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    const backup = await this.backups.exportTenant(id, ctx.userId);
    await platformAudit(this.db.system, ctx, 'ops.backup.created', 'tenant_backup', backup.id, { tenantId: id });
    return backup;
  }

  /** Sustituye los datos actuales de la banda por la copia elegida. */
  @HttpCode(200)
  @Post('admin/ops/tenants/:id/backups/:backupId/restore')
  async restoreTenantBackup(
    @Ctx() ctx: RequestContext,
    @Param('id', zod(idParam)) id: string,
    @Param('backupId', zod(idParam)) backupId: string,
    @Body(zod(restoreBody)) body: z.infer<typeof restoreBody>,
  ) {
    const result = await this.backups.restore(id, backupId, body.confirm);
    await platformAudit(this.db.system, ctx, 'ops.backup.restored', 'tenant_backup', backupId, { tenantId: id, skipped: result.skipped });
    return result;
  }

  /** Copias de seguridad y demás latidos externos; rojo si el último error o si supera 26 h. */
  @Get('admin/ops/heartbeats')
  async heartbeats() {
    const beats = (await this.ops.heartbeats()).filter((b) => !RESERVED.test(b.name));
    const rows = beats.map((b) => ({ ...b, stale: b.ageHours > HEARTBEAT_STALE_HOURS, healthy: b.status === 'ok' && b.ageHours <= HEARTBEAT_STALE_HOURS }));
    if (!rows.some((r) => r.name === 'backup')) rows.unshift({ name: 'backup', status: 'never', detail: null, lastRunAt: null, ageHours: null, stale: true, healthy: false } as never);
    return { staleAfterHours: HEARTBEAT_STALE_HOURS, heartbeats: rows };
  }

  // ── Endpoints públicos con token ─────────────────────────────────────────

  /** `POST /ops/heartbeat/:name` con cabecera `x-ops-token`. Cuerpo: `{ status?: 'ok'|'error', detail?: {} }`. */
  @Public()
  @HttpCode(204)
  @Post('ops/heartbeat/:name')
  async heartbeat(
    @Param('name', zod(heartbeatName)) name: string,
    @Body(zod(heartbeatBody)) body: z.infer<typeof heartbeatBody>,
    @Headers('x-ops-token') token?: string,
    @Headers('authorization') bearer?: string,
  ) {
    checkToken(env().OPS_HEARTBEAT_TOKEN, token, bearer);
    if (RESERVED.test(name)) throw new BadRequestException({ message: 'Nombre reservado', code: 'RESERVED_NAME' });
    await this.ops.beat(name.toLowerCase(), body.status, body.detail);
  }

  /** `POST /webhooks/email/:provider` con cabecera `x-webhook-token`. Cuerpo: `{ email, type: 'bounce'|'complaint', reason? }` (o lista). */
  @Public()
  @HttpCode(204)
  @Post('webhooks/email/:provider')
  async emailWebhook(
    @Param('provider', zod(providerParam)) provider: string,
    @Body(zod(deliveryBody)) body: z.infer<typeof deliveryBody>,
    @Headers('x-webhook-token') token?: string,
    @Headers('authorization') bearer?: string,
  ) {
    checkToken(env().EMAIL_WEBHOOK_TOKEN, token, bearer);
    for (const ev of Array.isArray(body) ? body : [body]) {
      await this.ops.recordDelivery(provider, ev.email, ev.type.startsWith('bounce') ? 'BOUNCED' : 'COMPLAINED', ev.reason);
    }
  }
}
