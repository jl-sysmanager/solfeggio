import { BadRequestException, Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, Perm, RequireFeature } from '../auth/decorators';
import { found } from '../common/errors';
import { idParam, isoDateTime, optionalText } from '../common/schemas';
import { zod } from '../common/zod.pipe';
import { Db } from '../db/db.service';
import { Audit } from '../audit/audit.service';
import { Jobs } from '../jobs/jobs.service';
import { audienceSchema, resolveAudience } from '../members/secretary.controller';

const eventBase = z.object({
  type: z.enum(['REHEARSAL', 'PERFORMANCE', 'MEETING', 'OTHER']),
  title: z.string().trim().min(1).max(160),
  description: optionalText(5000),
  location: optionalText(200),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  reminderMinutes: z.array(z.number().int().min(5).max(20_160)).max(5).optional(),
});
const eventCreate = eventBase.refine((e) => new Date(e.endsAt) > new Date(e.startsAt), { message: 'La hora de fin debe ser posterior al inicio', path: ['endsAt'] });
const eventPatch = eventBase.partial();
const listQuery = z.object({
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  type: z.enum(['REHEARSAL', 'PERFORMANCE', 'MEETING', 'OTHER']).optional(),
});
const repertoireSchema = z.array(z.object({ workId: z.string().uuid(), notes: optionalText(500) })).max(100);
const respondSchema = z.object({ response: z.enum(['ACCEPTED', 'DECLINED']), note: optionalText(500) });

const TYPE_LABEL: Record<string, string> = { REHEARSAL: 'Ensayo', PERFORMANCE: 'Actuación', MEETING: 'Reunión', OTHER: 'Evento' };

@ApiTags('events')
@ApiBearerAuth()
@RequireFeature('events')
@Controller()
export class EventsController {
  constructor(
    private readonly db: Db,
    private readonly audit: Audit,
    private readonly jobs: Jobs,
  ) {}

  @Perm('events:read')
  @Get('events')
  list(@Ctx() ctx: RequestContext, @Query(zod(listQuery)) q: z.infer<typeof listQuery>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const events = await tx.event.findMany({
        where: {
          type: q.type,
          startsAt: { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined },
        },
        orderBy: { startsAt: 'asc' },
        take: 500,
      });
      const counts = await tx.eventCall.groupBy({ by: ['eventId', 'response'], where: { eventId: { in: events.map((e) => e.id) } }, _count: true });
      return events.map((e) => {
        const c = counts.filter((x) => x.eventId === e.id);
        const n = (r: string) => c.find((x) => x.response === r)?._count ?? 0;
        return { ...e, counts: { called: c.reduce((s, x) => s + x._count, 0), accepted: n('ACCEPTED'), declined: n('DECLINED') } };
      });
    });
  }

  @Perm('events:write')
  @Post('events')
  create(@Ctx() ctx: RequestContext, @Body(zod(eventCreate)) body: z.infer<typeof eventCreate>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const ev = await tx.event.create({ data: { ...body, tenantId: ctx.tenantId, createdById: ctx.userId } });
      await this.audit.log(tx, ctx, 'event.created', 'event', ev.id, { title: ev.title, type: ev.type });
      return ev;
    });
  }

  @Perm('events:read')
  @Get('events/:id')
  get(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const ev = found(
        await tx.event.findUnique({
          where: { id },
          include: {
            repertoire: { orderBy: { position: 'asc' }, include: { work: { include: { composer: { select: { name: true } } } } } },
            calls: { include: { member: { select: { id: true, firstName: true, lastName: true, instrument: true, sectionId: true } } } },
            attendance: { include: { member: { select: { id: true, firstName: true, lastName: true } } } },
          },
        }),
        'Evento',
      );
      // Un músico sin permisos de gestión sólo ve su propia convocatoria y asistencia.
      if (!ctx.permissions.has('calls:manage') && !ctx.permissions.has('attendance:read')) {
        ev.calls = ev.calls.filter((c) => c.memberId === ctx.memberId);
        ev.attendance = ev.attendance.filter((a) => a.memberId === ctx.memberId);
      }
      return ev;
    });
  }

  @Perm('events:write')
  @Patch('events/:id')
  update(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(eventPatch)) body: z.infer<typeof eventPatch>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const ev = found(await tx.event.findUnique({ where: { id } }), 'Evento');
      const startsAt = body.startsAt ? new Date(body.startsAt) : ev.startsAt;
      const endsAt = body.endsAt ? new Date(body.endsAt) : ev.endsAt;
      if (endsAt <= startsAt) throw new BadRequestException({ message: 'La hora de fin debe ser posterior al inicio', code: 'VALIDATION_ERROR' });
      const updated = await tx.event.update({ where: { id }, data: body });
      await this.audit.log(tx, ctx, 'event.updated', 'event', id, { fields: Object.keys(body) });
      return updated;
    });
  }

  @Perm('events:write')
  @HttpCode(200)
  @Post('events/:id/cancel')
  async cancel(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    const { ev, memberIds } = await this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.event.findUnique({ where: { id } }), 'Evento');
      const ev = await tx.event.update({ where: { id }, data: { status: 'CANCELLED' } });
      const calls = await tx.eventCall.findMany({ where: { eventId: id }, select: { memberId: true } });
      await this.audit.log(tx, ctx, 'event.cancelled', 'event', id);
      return { ev, memberIds: calls.map((c) => c.memberId) };
    });
    if (memberIds.length) {
      await this.jobs.add('notify.fanout', {
        tenantId: ctx.tenantId, memberIds, type: 'event.cancelled', email: true,
        title: `${TYPE_LABEL[ev.type]} cancelado: ${ev.title}`,
        body: `Se ha cancelado «${ev.title}» previsto para el ${ev.startsAt.toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
        link: `/events/${ev.id}`,
      });
    }
    return ev;
  }

  @Perm('events:write')
  @Put('events/:id/repertoire')
  repertoire(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(repertoireSchema)) body: z.infer<typeof repertoireSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.event.findUnique({ where: { id } }), 'Evento');
      const ids = [...new Set(body.map((r) => r.workId))];
      const works = await tx.work.count({ where: { id: { in: ids } } });
      if (works !== ids.length) throw found(null, 'Obra');
      await tx.eventRepertoire.deleteMany({ where: { eventId: id } });
      await tx.eventRepertoire.createMany({
        data: body.map((r, position) => ({ tenantId: ctx.tenantId, eventId: id, workId: r.workId, notes: r.notes, position })),
        skipDuplicates: true,
      });
      return tx.eventRepertoire.findMany({ where: { eventId: id }, orderBy: { position: 'asc' }, include: { work: true } });
    });
  }

  /** Convoca a socios (todos, por secciones o individualmente) y les notifica. */
  @Perm('calls:manage')
  @Post('events/:id/calls')
  async call(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(audienceSchema)) body: z.infer<typeof audienceSchema>) {
    const { ev, created } = await this.db.tenant(ctx.tenantId, async (tx) => {
      const ev = found(await tx.event.findUnique({ where: { id } }), 'Evento');
      if (ev.status !== 'SCHEDULED') throw new BadRequestException({ message: 'El evento no está programado', code: 'EVENT_NOT_SCHEDULED' });
      const members = await resolveAudience(tx, body);
      const existing = new Set((await tx.eventCall.findMany({ where: { eventId: id }, select: { memberId: true } })).map((c) => c.memberId));
      const created = members.filter((m) => !existing.has(m.id)).map((m) => m.id);
      await tx.eventCall.createMany({ data: created.map((memberId) => ({ tenantId: ctx.tenantId, eventId: id, memberId })) });
      await this.audit.log(tx, ctx, 'event.called', 'event', id, { added: created.length });
      return { ev, created };
    });
    if (created.length) {
      await this.jobs.add('notify.fanout', {
        tenantId: ctx.tenantId, memberIds: created, type: 'event.call', email: true,
        title: `Convocatoria: ${ev.title}`,
        body: `Has sido convocado a «${ev.title}» (${TYPE_LABEL[ev.type].toLowerCase()}) el ${ev.startsAt.toISOString().slice(0, 16).replace('T', ' ')} UTC${ev.location ? ` en ${ev.location}` : ''}. Confirma tu asistencia en Solfeggio.`,
        link: `/events/${ev.id}`,
      });
    }
    return { added: created.length };
  }

  /** El propio músico responde a su convocatoria. */
  @Perm('events:read')
  @HttpCode(200)
  @Post('events/:id/respond')
  respond(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(respondSchema)) body: z.infer<typeof respondSchema>) {
    if (!ctx.memberId) throw new BadRequestException({ message: 'Tu usuario no está vinculado a un socio', code: 'NO_MEMBER_LINK' });
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const call = found(await tx.eventCall.findUnique({ where: { eventId_memberId: { eventId: id, memberId: ctx.memberId! } } }), 'Convocatoria');
      return tx.eventCall.update({ where: { id: call.id }, data: { response: body.response, note: body.note, respondedAt: new Date() } });
    });
  }
}

export { TYPE_LABEL };
export type EventWhere = Prisma.EventWhereInput;
