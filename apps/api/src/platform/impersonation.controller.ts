import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, NoTenant, PlatformAdmin } from '../auth/decorators';
import { TokensService } from '../auth/tokens.service';
import { found } from '../common/errors';
import { pageQuery, skipTake } from '../common/pagination';
import { idParam } from '../common/schemas';
import { zod } from '../common/zod.pipe';
import { Db } from '../db/db.service';
import { AllowImpersonation } from './impersonation.util';
import { InsightsService } from './insights.service';

const startSchema = z.object({
  tenantId: z.string().uuid(),
  reason: z.string().trim().min(10, 'Indica el motivo (mínimo 10 caracteres)').max(500),
  minutes: z.number().int().min(5).max(60).default(30),
});
const historyQuery = pageQuery.extend({ tenantId: z.string().uuid().optional() });

/** «Ver como» una banda: acceso de sólo lectura, limitado en el tiempo, con motivo y auditado. */
@ApiTags('admin-impersonation')
@ApiBearerAuth()
@Controller()
export class ImpersonationController {
  constructor(
    private readonly db: Db,
    private readonly tokens: TokensService,
    private readonly insights: InsightsService,
  ) {}

  @PlatformAdmin()
  @Post('admin/impersonation')
  async start(@Ctx() ctx: RequestContext, @Body(zod(startSchema)) body: z.infer<typeof startSchema>) {
    const tenant = found(await this.db.system.tenant.findFirst({ where: { id: body.tenantId, deletedAt: null } }), 'Banda');
    const expiresAt = new Date(Date.now() + body.minutes * 60_000);
    const session = await this.db.system.impersonationSession.create({
      data: { tenantId: tenant.id, adminId: ctx.userId, reason: body.reason, expiresAt },
    });
    await this.insights.audit(tenant.id, ctx, 'impersonation.started', 'impersonation', session.id, { reason: body.reason, expiresAt: expiresAt.toISOString() });
    const accessToken = await this.tokens.impersonationToken(ctx.userId, tenant.id, session.id, expiresAt);
    return { accessToken, expiresAt, session };
  }

  @PlatformAdmin()
  @Get('admin/impersonation')
  history(@Query(zod(historyQuery)) q: z.infer<typeof historyQuery>) {
    const { take, skip } = skipTake(q);
    return this.insights.sessions(q.tenantId, take, skip);
  }

  @PlatformAdmin()
  @HttpCode(200)
  @Post('admin/impersonation/:id/end')
  async endByAdmin(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.end(ctx, id);
  }

  /** El propio token «ver como» cierra su sesión (única escritura que admite). */
  @AllowImpersonation()
  @NoTenant()
  @HttpCode(200)
  @Post('impersonation/end')
  endSelf(@Ctx() ctx: RequestContext) {
    return this.end(ctx, ctx.impersonationId ?? '00000000-0000-0000-0000-000000000000');
  }

  private async end(ctx: RequestContext, id: string) {
    const s = found(await this.db.system.impersonationSession.findFirst({ where: { id, adminId: ctx.userId } }), 'Sesión');
    if (s.endedAt) return s;
    const endedAt = new Date(Math.min(Date.now(), s.expiresAt.getTime()));
    const { count } = await this.db.system.impersonationSession.updateMany({ where: { id, endedAt: null }, data: { endedAt } });
    if (count) await this.insights.audit(s.tenantId, ctx, 'impersonation.ended', 'impersonation', id);
    return this.db.system.impersonationSession.findUniqueOrThrow({ where: { id } });
  }
}
