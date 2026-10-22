import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, Perm, RequireFeature } from '../auth/decorators';
import { found } from '../common/errors';
import { idParam, isoDateTime } from '../common/schemas';
import { zod } from '../common/zod.pipe';
import { Db } from '../db/db.service';
import { Audit } from '../audit/audit.service';

const recordSchema = z
  .array(z.object({ memberId: z.string().uuid(), status: z.enum(['PRESENT', 'LATE', 'ABSENT', 'EXCUSED']) }))
  .min(1)
  .max(500);
const justificationSchema = z.object({ text: z.string().trim().min(3).max(1000) });
const reviewSchema = z.object({ approved: z.boolean() });
const statsQuery = z.object({ from: isoDateTime.optional(), to: isoDateTime.optional(), sectionId: z.string().uuid().optional() });

/** Tasa de asistencia (presente + retraso) como fracción 0–1 con tres decimales. */
const rate = (present: number, late: number, total: number) => (total ? Math.round(((present + late) / total) * 1000) / 1000 : null);

@ApiTags('attendance')
@ApiBearerAuth()
@RequireFeature('attendance')
@Controller()
export class AttendanceController {
  constructor(
    private readonly db: Db,
    private readonly audit: Audit,
  ) {}

  /** Pasar lista: upsert por (evento, socio). */
  @Perm('attendance:write')
  @Put('events/:id/attendance')
  record(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(recordSchema)) body: z.infer<typeof recordSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const ev = found(await tx.event.findUnique({ where: { id } }), 'Evento');
      if (ev.status === 'CANCELLED') throw new BadRequestException({ message: 'El evento está cancelado', code: 'EVENT_CANCELLED' });
      const ids = [...new Set(body.map((r) => r.memberId))];
      if ((await tx.member.count({ where: { id: { in: ids } } })) !== ids.length) throw found(null, 'Socio');
      for (const r of body) {
        await tx.attendance.upsert({
          where: { eventId_memberId: { eventId: id, memberId: r.memberId } },
          create: { tenantId: ctx.tenantId, eventId: id, memberId: r.memberId, status: r.status, recordedById: ctx.userId },
          update: { status: r.status, recordedById: ctx.userId, recordedAt: new Date() },
        });
      }
      if (ev.endsAt < new Date() && ev.status === 'SCHEDULED') await tx.event.update({ where: { id }, data: { status: 'DONE' } });
      await this.audit.log(tx, ctx, 'attendance.recorded', 'event', id, { count: body.length });
      return tx.attendance.findMany({ where: { eventId: id } });
    });
  }

  /** El músico justifica su propia ausencia o retraso. */
  @Perm('attendance:self')
  @HttpCode(200)
  @Post('attendance/:id/justification')
  justify(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(justificationSchema)) body: z.infer<typeof justificationSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const a = found(await tx.attendance.findUnique({ where: { id } }), 'Registro');
      if (a.memberId !== ctx.memberId && !ctx.permissions.has('attendance:write')) throw found(null, 'Registro');
      if (a.status === 'PRESENT') throw new BadRequestException({ message: 'No hay nada que justificar', code: 'NOTHING_TO_JUSTIFY' });
      return tx.attendance.update({ where: { id }, data: { justification: body.text, justificationStatus: 'PENDING' } });
    });
  }

  @Perm('attendance:write')
  @HttpCode(200)
  @Post('attendance/:id/review')
  review(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(reviewSchema)) body: z.infer<typeof reviewSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const a = found(await tx.attendance.findUnique({ where: { id } }), 'Registro');
      if (a.justificationStatus !== 'PENDING') throw new BadRequestException({ message: 'No hay justificación pendiente', code: 'NO_PENDING_JUSTIFICATION' });
      const updated = await tx.attendance.update({
        where: { id },
        data: { justificationStatus: body.approved ? 'APPROVED' : 'REJECTED', ...(body.approved && a.status === 'ABSENT' ? { status: 'EXCUSED' } : {}) },
      });
      await this.audit.log(tx, ctx, 'attendance.reviewed', 'attendance', id, { approved: body.approved });
      return updated;
    });
  }

  @Get('attendance/me')
  mine(@Ctx() ctx: RequestContext) {
    if (!ctx.permissions.has('attendance:self') && !ctx.permissions.has('attendance:read')) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Sin permiso' });
    if (!ctx.memberId) return [];
    return this.db.tenant(ctx.tenantId, (tx) =>
      tx.attendance.findMany({ where: { memberId: ctx.memberId! }, include: { event: true }, orderBy: { recordedAt: 'desc' }, take: 100 }),
    );
  }

  @Perm('attendance:read')
  @Get('attendance/stats')
  stats(@Ctx() ctx: RequestContext, @Query(zod(statsQuery)) q: z.infer<typeof statsQuery>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const eventWhere = {
        status: { not: 'CANCELLED' as const },
        startsAt: { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined },
      };
      const records = await tx.attendance.findMany({
        where: { event: eventWhere, member: q.sectionId ? { sectionId: q.sectionId } : undefined },
        select: {
          status: true,
          member: { select: { id: true, firstName: true, lastName: true, instrument: true } },
          event: { select: { id: true, title: true, startsAt: true, type: true } },
        },
      });
      type Acc = { present: number; late: number; absent: number; excused: number };
      const empty = (): Acc => ({ present: 0, late: 0, absent: 0, excused: 0 });
      const byMember = new Map<string, { member: (typeof records)[number]['member'] } & Acc>();
      const byEvent = new Map<string, { event: (typeof records)[number]['event']; present: number; total: number }>();
      const total = empty();
      for (const r of records) {
        const key = r.status.toLowerCase() as keyof Acc;
        const m = byMember.get(r.member.id) ?? { member: r.member, ...empty() };
        m[key]++;
        byMember.set(r.member.id, m);
        const e = byEvent.get(r.event.id) ?? { event: r.event, present: 0, total: 0 };
        e.total++;
        if (r.status === 'PRESENT' || r.status === 'LATE') e.present++;
        byEvent.set(r.event.id, e);
        total[key]++;
      }
      const count = (a: Acc) => a.present + a.late + a.absent + a.excused;
      return {
        overallRate: rate(total.present, total.late, count(total)),
        totals: total,
        byMember: [...byMember.values()]
          .map((m) => ({ ...m, rate: rate(m.present, m.late, count(m)) }))
          .sort((a, b) => (a.rate ?? 0) - (b.rate ?? 0)),
        byEvent: [...byEvent.values()].sort((a, b) => +a.event.startsAt - +b.event.startsAt),
      };
    });
  }
}
