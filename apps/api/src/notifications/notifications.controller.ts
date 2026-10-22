import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, Perm } from '../auth/decorators';
import { idParam } from '../common/schemas';
import { zod } from '../common/zod.pipe';
import { Db } from '../db/db.service';
import { Jobs } from '../jobs/jobs.service';

const incidentSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  body: z.string().trim().min(3).max(10_000),
  priority: z.number().int().min(1).max(5).optional(),
});

@ApiTags('notifications')
@ApiBearerAuth()
@Controller()
export class NotificationsController {
  constructor(
    private readonly db: Db,
    private readonly jobs: Jobs,
  ) {}

  @Get('notifications')
  list(@Ctx() ctx: RequestContext, @Query('unread') unread?: string) {
    return this.db.tenant(ctx.tenantId, (tx) =>
      tx.notification.findMany({
        where: { userId: ctx.userId, readAt: unread === 'true' ? null : undefined },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    );
  }

  @HttpCode(204)
  @Post('notifications/:id/read')
  async read(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    await this.db.tenant(ctx.tenantId, (tx) => tx.notification.updateMany({ where: { id, userId: ctx.userId, readAt: null }, data: { readAt: new Date() } }));
  }

  @HttpCode(204)
  @Post('notifications/read-all')
  async readAll(@Ctx() ctx: RequestContext) {
    await this.db.tenant(ctx.tenantId, (tx) => tx.notification.updateMany({ where: { userId: ctx.userId, readAt: null }, data: { readAt: new Date() } }));
  }

  @Perm('incidents:write')
  @Get('incidents')
  incidents(@Ctx() ctx: RequestContext) {
    return this.db.tenant(ctx.tenantId, (tx) => tx.incident.findMany({ orderBy: { createdAt: 'desc' } }));
  }

  @Perm('incidents:write')
  @Post('incidents')
  async openIncident(@Ctx() ctx: RequestContext, @Body(zod(incidentSchema)) body: z.infer<typeof incidentSchema>) {
    const incident = await this.db.tenant(ctx.tenantId, (tx) => tx.incident.create({ data: { ...body, tenantId: ctx.tenantId, openedById: ctx.userId } }));
    const admins = await this.db.system.user.findMany({ where: { isPlatformAdmin: true }, select: { email: true } });
    await Promise.all(
      admins.map((a) => this.jobs.add('email.send', { to: a.email, subject: `[Incidencia P${incident.priority}] ${incident.subject}`, text: `Nueva incidencia ${incident.id}.` })),
    );
    return incident;
  }
}
