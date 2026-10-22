import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, Perm, Public, RequireFeature } from '../auth/decorators';
import { featuresFor } from '../billing/entitlements';
import { notFound } from '../common/errors';
import { isoDateTime } from '../common/schemas';
import { zod } from '../common/zod.pipe';
import { env } from '../config/env';
import { Db } from '../db/db.service';
import { TYPE_LABEL } from '../events/events.controller';
import { buildIcs } from './ics';

const rangeQuery = z.object({ from: isoDateTime, to: isoDateTime });

@ApiTags('agenda')
@Controller()
export class AgendaController {
  constructor(private readonly db: Db) {}

  /** Calendario unificado: eventos, vencimientos de cuotas y devoluciones de uniformes. */
  @ApiBearerAuth()
  @Perm('events:read')
  @Get('agenda')
  agenda(@Ctx() ctx: RequestContext, @Query(zod(rangeQuery)) q: z.infer<typeof rangeQuery>) {
    const from = new Date(q.from);
    const to = new Date(q.to);
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const events = await tx.event.findMany({ where: { startsAt: { gte: from, lte: to } }, orderBy: { startsAt: 'asc' } });
      const items: { id: string; kind: string; type: string; status: string; title: string; startsAt: Date; endsAt: Date; location: string | null; link: string }[] = events.map((e) => ({
        id: e.id, kind: 'event', type: e.type, status: e.status, title: `${TYPE_LABEL[e.type]}: ${e.title}`,
        startsAt: e.startsAt, endsAt: e.endsAt, location: e.location, link: `/events/${e.id}`,
      }));
      if (ctx.permissions.has('finance:read') && ctx.features.has('treasury')) {
        const due = await tx.feeCharge.groupBy({ by: ['dueDate', 'feeId'], where: { dueDate: { gte: from, lte: to }, status: { in: ['PENDING', 'OVERDUE'] } }, _count: true });
        const fees = await tx.fee.findMany({ where: { id: { in: due.map((d) => d.feeId) } } });
        items.push(...due.map((d) => ({
          id: `fee-${d.feeId}-${d.dueDate.toISOString().slice(0, 10)}`, kind: 'fee_due', type: 'FEE', status: 'PENDING',
          title: `Vencen ${d._count} cuotas: ${fees.find((f) => f.id === d.feeId)?.name ?? ''}`, startsAt: d.dueDate, endsAt: d.dueDate,
          location: null, link: '/treasury',
        })));
      }
      if (ctx.permissions.has('wardrobe:read') && ctx.features.has('wardrobe')) {
        const loans = await tx.uniformLoan.findMany({ where: { returnedAt: null, dueAt: { gte: from, lte: to } }, include: { item: true, member: true } });
        items.push(...loans.map((l) => ({
          id: `loan-${l.id}`, kind: 'loan_due', type: 'LOAN', status: 'PENDING',
          title: `Devolución: ${l.item.garment} (${l.member.firstName} ${l.member.lastName})`, startsAt: l.dueAt!, endsAt: l.dueAt!,
          location: null, link: '/wardrobe',
        })));
      }
      return items.sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt));
    });
  }

  @ApiBearerAuth()
  @RequireFeature('calendar_sync')
  @Perm('events:read')
  @Get('agenda/ics-url')
  async icsUrl(@Ctx() ctx: RequestContext) {
    const m = await this.db.tenant(ctx.tenantId, (tx) => tx.membership.findUniqueOrThrow({ where: { id: ctx.membershipId } }));
    return { url: `${env().API_URL}/api/v1/calendar/${m.calendarToken}.ics` };
  }

  /**
   * Feed ICS público protegido por un token secreto por usuario y banda. Sólo incluye eventos;
   * si el socio está vinculado, sólo los eventos a los que está convocado o sin convocatoria.
   */
  @Public()
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Cache-Control', 'private, max-age=900')
  @Get('calendar/:token.ics')
  async ics(@Param('token') token: string) {
    if (!z.string().uuid().safeParse(token).success) throw notFound('Calendario');
    const m = await this.db.system.membership.findUnique({
      where: { calendarToken: token },
      include: { tenant: { include: { plan: true, subscription: { select: { stripeSubscriptionId: true, stripeStatus: true } } } } },
    });
    if (!m || m.status !== 'ACTIVE' || !(await featuresFor(this.db, m.tenant)).has('calendar_sync')) throw notFound('Calendario');
    const events = await this.db.tenant(m.tenantId, (tx) =>
      tx.event.findMany({
        where: {
          startsAt: { gte: new Date(Date.now() - 90 * 86_400_000) },
          ...(m.memberId ? { OR: [{ calls: { some: { memberId: m.memberId } } }, { calls: { none: {} } }] } : {}),
        },
        orderBy: { startsAt: 'asc' },
        take: 1000,
      }),
    );
    return buildIcs(m.tenant.name, events.map((e) => ({ ...e, title: `${TYPE_LABEL[e.type]}: ${e.title}` })));
  }
}
