import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, PlatformAdmin, Public } from '../auth/decorators';
import { zod } from '../common/zod.pipe';
import { env } from '../config/env';
import { Jobs } from '../jobs/jobs.service';
import { HEARTBEAT_STALE_HOURS, OpsService } from './ops.service';
import { Db } from '../db/db.service';
import { platformAudit } from './support.util';

const CRON_NAMES = ['events.reminders', 'billing.grace-sweep', 'finance.overdue', 'storage.recount', 'platform.snapshot', 'support.sla-sweep', 'billing.reconcile-addons', 'ops.orphan-scan'];
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

  /** Tareas programadas: último latido de cada cron (el worker lo registra) y próxima ejecución según BullMQ. */
  @Get('admin/ops/schedules')
  async schedules() {
    const [beats, repeatables] = await Promise.all([this.ops.heartbeats(), this.jobs.repeatables().catch(() => [])]);
    return CRON_NAMES.map((name) => {
      const beat = beats.find((b) => b.name === `cron.${name}`);
      const rep = repeatables.find((r) => r.name === name);
      return {
        name, pattern: rep?.pattern ?? null, next: rep?.next ?? null,
        lastRunAt: beat?.lastRunAt ?? null, status: beat?.status ?? 'never', detail: beat?.detail ?? null,
      };
    });
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
