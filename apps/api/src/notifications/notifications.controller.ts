import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, Perm } from '../auth/decorators';
import { found } from '../common/errors';
import { idParam } from '../common/schemas';
import { zod } from '../common/zod.pipe';
import { Db } from '../db/db.service';
import { Jobs } from '../jobs/jobs.service';
import { slaDueAt } from '../platform/support.util';

const incidentSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  body: z.string().trim().min(3).max(10_000),
  priority: z.number().int().min(1).max(5).optional(),
});

const messageSchema = z.object({ body: z.string().trim().min(1).max(10_000) });

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
    return this.db.tenant(ctx.tenantId, (tx) =>
      tx.incident.findMany({
        orderBy: { createdAt: 'desc' },
        select: { id: true, subject: true, body: true, priority: true, status: true, resolution: true, createdAt: true, updatedAt: true, firstResponseAt: true },
      }),
    );
  }

  /** Conversación con soporte: bajo RLS sólo llegan los mensajes públicos, nunca las notas internas. */
  @Perm('incidents:write')
  @Get('incidents/:id')
  incident(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const inc = found(
        await tx.incident.findUnique({
          where: { id },
          select: { id: true, subject: true, body: true, priority: true, status: true, resolution: true, createdAt: true, updatedAt: true, firstResponseAt: true, openedById: true },
        }),
        'Incidencia',
      );
      const messages = await tx.incidentMessage.findMany({ where: { incidentId: id, internal: false }, orderBy: { createdAt: 'asc' } });
      return { ...inc, messages: messages.map((m) => ({ id: m.id, authorType: m.authorType, body: m.body, createdAt: m.createdAt })) };
    });
  }

  @Perm('incidents:write')
  @Post('incidents')
  async openIncident(@Ctx() ctx: RequestContext, @Body(zod(incidentSchema)) body: z.infer<typeof incidentSchema>) {
    const priority = body.priority ?? 3;
    const created = new Date();
    const incident = await this.db.tenant(ctx.tenantId, (tx) =>
      tx.incident.create({ data: { ...body, priority, tenantId: ctx.tenantId, openedById: ctx.userId, createdAt: created, slaDueAt: slaDueAt(created, priority) } }),
    );
    const admins = await this.db.system.user.findMany({ where: { isPlatformAdmin: true, blockedAt: null }, select: { email: true } });
    await Promise.all(
      admins.map((a) => this.jobs.add('email.send', { to: a.email, subject: `[Incidencia P${incident.priority}] ${incident.subject}`, text: `Nueva incidencia ${incident.id}.` })),
    );
    return incident;
  }

  /** Respuesta de la banda. Si estaba resuelta, se reabre. */
  @Perm('incidents:write')
  @HttpCode(201)
  @Post('incidents/:id/messages')
  async replyIncident(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(messageSchema)) body: z.infer<typeof messageSchema>) {
    const { message, incident } = await this.db.tenant(ctx.tenantId, async (tx) => {
      const incident = found(await tx.incident.findUnique({ where: { id } }), 'Incidencia');
      if (incident.status === 'CLOSED') throw new BadRequestException({ message: 'La incidencia está cerrada', code: 'INCIDENT_CLOSED' });
      const message = await tx.incidentMessage.create({
        data: { tenantId: ctx.tenantId, incidentId: id, authorType: 'TENANT', authorId: ctx.userId, body: body.body, internal: false },
      });
      return { message, incident };
    });
    // La banda no tiene permiso de UPDATE sobre incidencias (la propiedad ya se comprobó bajo RLS).
    if (incident.status === 'RESOLVED') await this.db.system.incident.updateMany({ where: { id, tenantId: ctx.tenantId, status: 'RESOLVED' }, data: { status: 'IN_PROGRESS' } });
    const to = new Set<string>();
    const admins = await this.db.system.user.findMany({ where: { isPlatformAdmin: true, blockedAt: null }, select: { id: true, email: true } });
    const assignee = admins.find((a) => a.id === incident.assigneeId);
    (assignee ? [assignee] : admins).forEach((a) => to.add(a.email));
    for (const email of to) {
      await this.jobs.add('email.send', { to: email, subject: `[Respuesta de la banda] ${incident.subject}`, text: `${body.body.slice(0, 1500)}\n\nIncidencia ${incident.id}.`, tenantId: ctx.tenantId });
    }
    return { id: message.id, authorType: message.authorType, body: message.body, createdAt: message.createdAt, reopened: incident.status === 'RESOLVED' };
  }
}
