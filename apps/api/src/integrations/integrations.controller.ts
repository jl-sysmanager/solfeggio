import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, PlatformAdmin } from '../auth/decorators';
import { StripeClient } from '../billing/stripe.provider';
import { page, pageQuery, skipTake } from '../common/pagination';
import { zod } from '../common/zod.pipe';
import { Db } from '../db/db.service';
import { IntegrationsService } from './integrations.service';
import { Mailer } from './mailer.service';
import { CategoryId } from './registry';

const categoryParam = z.enum(['payments', 'email']);
const saveSchema = z.object({
  provider: z.string().min(1).max(40),
  enabled: z.boolean(),
  config: z.record(z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).optional(),
  secrets: z.record(z.union([z.string().max(2000), z.null()])).optional(),
});
const testSchema = z.object({ to: z.string().email().optional() });
const auditQuery = pageQuery.extend({ entity: z.string().max(40).optional() });

/** Integraciones de terceros configurables por el equipo de plataforma. */
@ApiTags('admin')
@ApiBearerAuth()
@PlatformAdmin()
@Controller('admin')
export class IntegrationsController {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly mailer: Mailer,
    private readonly stripe: StripeClient,
    private readonly db: Db,
  ) {}

  @Get('integrations')
  list() {
    return this.integrations.list();
  }

  @Put('integrations/:category')
  save(@Ctx() ctx: RequestContext, @Param('category', zod(categoryParam)) id: CategoryId, @Body(zod(saveSchema)) body: z.infer<typeof saveSchema>) {
    return this.integrations.save(id, body, { userId: ctx.userId, ip: ctx.ip });
  }

  @Delete('integrations/:category')
  reset(@Ctx() ctx: RequestContext, @Param('category', zod(categoryParam)) id: CategoryId) {
    return this.integrations.reset(id, { userId: ctx.userId, ip: ctx.ip });
  }

  /**
   * Prueba la configuración guardada aunque esté deshabilitada: así se puede verificar antes de
   * activarla. Correo: envía un mensaje de prueba. Pagos: consulta el saldo de la cuenta.
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('integrations/:category/test')
  async test(@Ctx() ctx: RequestContext, @Param('category', zod(categoryParam)) id: CategoryId, @Body(zod(testSchema)) body: z.infer<typeof testSchema>) {
    const cfg = await this.integrations.get(id);
    const actor = { userId: ctx.userId, ip: ctx.ip };
    if (!cfg.provider) return { ok: false, message: 'No hay ninguna configuración guardada' };
    let result: { ok: boolean; message: string };
    try {
      if (id === 'email') {
        const to = body.to ?? ctx.email;
        await this.mailer.send(
          { to, subject: 'Prueba de correo de Solfeggio', text: `Si recibes este mensaje, el envío con ${cfg.provider} funciona correctamente.` },
          { ...cfg, enabled: true },
        );
        result = { ok: true, message: `Correo de prueba enviado a ${to} con ${cfg.provider}` };
      } else {
        if (!cfg.secrets.secretKey) return { ok: false, message: 'Falta la clave secreta' };
        const { livemode } = await this.stripe.check({ secretKey: cfg.secrets.secretKey });
        result = { ok: true, message: `Conexión con Stripe correcta (modo ${livemode ? 'producción' : 'pruebas'})` };
      }
    } catch (e) {
      result = { ok: false, message: (e as Error).message.slice(0, 300) };
    }
    await this.integrations.audit(actor, 'integration.tested', id, { provider: cfg.provider, ok: result.ok });
    return result;
  }

  @Get('audit-logs')
  async auditLogs(@Query(zod(auditQuery)) q: z.infer<typeof auditQuery>) {
    const where = { entity: q.entity };
    const [rows, total] = await Promise.all([
      this.db.system.platformAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q) }),
      this.db.system.platformAuditLog.count({ where }),
    ]);
    const users = await this.db.system.user.findMany({
      where: { id: { in: rows.map((r) => r.actorId).filter((x): x is string => !!x) } },
      select: { id: true, name: true, email: true },
    });
    return page(rows.map((r) => ({ ...r, actor: users.find((u) => u.id === r.actorId) ?? null })), total, q);
  }
}
