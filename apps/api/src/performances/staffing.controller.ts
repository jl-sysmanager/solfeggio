import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, Perm, RequireFeature } from '../auth/decorators';
import { found } from '../common/errors';
import { idParam, isoDateTime, optionalText } from '../common/schemas';
import { zod } from '../common/zod.pipe';
import { Db } from '../db/db.service';
import { Audit } from '../audit/audit.service';
import { Jobs } from '../jobs/jobs.service';
import { computeStaffing } from './staffing';
import { norm } from './util';

const requirementsSchema = z
  .array(z.object({ instrument: z.string().trim().min(1).max(60), required: z.number().int().min(0).max(200) }))
  .max(60)
  .refine((rows) => new Set(rows.map((r) => norm(r.instrument))).size === rows.length, 'Instrumentos repetidos');
const alertSchema = z.object({ call: z.boolean().optional() });
const logisticsSchema = z.object({
  transport: optionalText(200),
  departurePlace: optionalText(200),
  departureAt: isoDateTime.nullable().optional(),
  returnAt: isoDateTime.nullable().optional(),
  route: optionalText(2000),
  uniform: optionalText(300),
  notes: optionalText(4000),
});

const when = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');

/** Plantilla mínima por instrumento y logística de los eventos. */
@ApiTags('performances')
@ApiBearerAuth()
@RequireFeature('performances')
@Controller('events')
export class StaffingController {
  constructor(
    private readonly db: Db,
    private readonly audit: Audit,
    private readonly jobs: Jobs,
  ) {}

  @Perm('events:read')
  @Get(':id/staffing')
  staffing(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.event.findUnique({ where: { id } }), 'Evento');
      const rows = await computeStaffing(tx, id);
      return {
        rows,
        totals: {
          required: rows.reduce((s, r) => s + r.required, 0),
          accepted: rows.reduce((s, r) => s + r.accepted, 0),
          missing: rows.reduce((s, r) => s + r.missing, 0),
        },
      };
    });
  }

  @Perm('events:write')
  @Put(':id/requirements')
  requirements(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(requirementsSchema)) body: z.infer<typeof requirementsSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.event.findUnique({ where: { id } }), 'Evento');
      await tx.eventRequirement.deleteMany({ where: { eventId: id } });
      await tx.eventRequirement.createMany({
        data: body.filter((r) => r.required > 0).map((r) => ({ tenantId: ctx.tenantId, eventId: id, instrument: r.instrument, required: r.required })),
      });
      await this.audit.log(tx, ctx, 'event.requirements', 'event', id, { instruments: body.length });
      return computeStaffing(tx, id);
    });
  }

  /** Avisa a los socios activos de los instrumentos con vacantes que aún no están convocados. */
  @Perm('events:write')
  @HttpCode(200)
  @Post(':id/staffing/alert')
  async alert(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(alertSchema)) body: z.infer<typeof alertSchema>) {
    if (body.call && !ctx.permissions.has('calls:manage')) {
      throw new ForbiddenException({ message: 'No tienes permiso para convocar', code: 'FORBIDDEN' });
    }
    const { ev, vacancies, memberIds } = await this.db.tenant(ctx.tenantId, async (tx) => {
      const ev = found(await tx.event.findUnique({ where: { id } }), 'Evento');
      if (ev.status !== 'SCHEDULED') throw new BadRequestException({ message: 'El evento no está programado', code: 'EVENT_NOT_SCHEDULED' });
      const missing = (await computeStaffing(tx, id)).filter((r) => r.missing > 0);
      const called = new Set((await tx.eventCall.findMany({ where: { eventId: id }, select: { memberId: true } })).map((c) => c.memberId));
      const members = await tx.member.findMany({ where: { status: 'ACTIVE', instrument: { not: null } }, select: { id: true, instrument: true } });
      const vacancies = missing.map((r) => {
        const candidates = members.filter((m) => !called.has(m.id) && norm(m.instrument) === norm(r.instrument)).map((m) => m.id);
        return { instrument: r.instrument, missing: r.missing, notified: candidates.length, memberIds: candidates };
      });
      const memberIds = vacancies.flatMap((v) => v.memberIds);
      if (body.call && memberIds.length) {
        await tx.eventCall.createMany({ data: memberIds.map((memberId) => ({ tenantId: ctx.tenantId, eventId: id, memberId })), skipDuplicates: true });
      }
      await this.audit.log(tx, ctx, 'event.staffing_alert', 'event', id, { notified: memberIds.length, called: body.call ? memberIds.length : 0 });
      return { ev, vacancies, memberIds };
    });
    if (memberIds.length) {
      await this.jobs.add('notify.fanout', {
        tenantId: ctx.tenantId, memberIds, type: body.call ? 'event.call' : 'event.vacancy', email: true,
        title: body.call ? `Convocatoria: ${ev.title}` : `Faltan músicos: ${ev.title}`,
        body: body.call
          ? `Has sido convocado a «${ev.title}» el ${when(ev.startsAt)} UTC${ev.location ? ` en ${ev.location}` : ''}. Faltan músicos de tu instrumento: confirma tu asistencia en Solfeamos.`
          : `Faltan músicos de tu instrumento para «${ev.title}» el ${when(ev.startsAt)} UTC. Si puedes participar, avisa a la dirección.`,
        link: `/events/${ev.id}`,
      });
    }
    return {
      notified: memberIds.length,
      called: body.call ? memberIds.length : 0,
      vacancies: vacancies.map(({ memberIds: _ids, ...v }) => v),
    };
  }

  @Perm('events:read')
  @Get(':id/logistics')
  logistics(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.event.findUnique({ where: { id } }), 'Evento');
      const l = await tx.eventLogistics.findUnique({ where: { eventId: id } });
      return l ?? { eventId: id, transport: null, departurePlace: null, departureAt: null, returnAt: null, route: null, uniform: null, notes: null, updatedAt: null };
    });
  }

  @Perm('events:write')
  @Put(':id/logistics')
  saveLogistics(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(logisticsSchema)) body: z.infer<typeof logisticsSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.event.findUnique({ where: { id } }), 'Evento');
      // PUT sustituye la ficha completa: los campos ausentes quedan vacíos.
      const data = {
        transport: body.transport ?? null,
        departurePlace: body.departurePlace ?? null,
        route: body.route ?? null,
        uniform: body.uniform ?? null,
        notes: body.notes ?? null,
        departureAt: body.departureAt ? new Date(body.departureAt) : null,
        returnAt: body.returnAt ? new Date(body.returnAt) : null,
      };
      if (data.departureAt && data.returnAt && data.returnAt <= data.departureAt) {
        throw new BadRequestException({ message: 'La vuelta debe ser posterior a la salida', code: 'VALIDATION_ERROR' });
      }
      const l = await tx.eventLogistics.upsert({ where: { eventId: id }, create: { ...data, tenantId: ctx.tenantId, eventId: id }, update: data });
      await this.audit.log(tx, ctx, 'event.logistics', 'event', id, { fields: Object.keys(body) });
      return l;
    });
  }
}
