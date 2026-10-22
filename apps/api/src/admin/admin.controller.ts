import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, PlatformAdmin } from '../auth/decorators';
import { pseudonymize } from '../common/crypto';
import { found } from '../common/errors';
import { page, pageQuery, skipTake } from '../common/pagination';
import { cents, idParam } from '../common/schemas';
import { zod } from '../common/zod.pipe';
import { Db } from '../db/db.service';
import { Jobs } from '../jobs/jobs.service';
import { FEATURES } from '../iam/permissions';

const tenantsQuery = pageQuery.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['TRIALING', 'ACTIVE', 'PAST_DUE', 'READ_ONLY', 'SUSPENDED', 'CANCELLED']).optional(),
});
const tenantPatch = z.object({
  status: z.enum(['ACTIVE', 'READ_ONLY', 'SUSPENDED', 'CANCELLED']).optional(),
  planCode: z.enum(['FREE', 'BASIC', 'PRO', 'ENTERPRISE']).optional(),
  addons: z.array(z.enum(FEATURES)).max(FEATURES.length).optional(),
  studentSeats: z.number().int().min(0).max(100_000).optional(),
});
const planPatch = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  priceMonthlyCents: cents.optional(),
  priceYearlyCents: cents.optional(),
  stripePriceMonthly: z.string().max(100).nullable().optional(),
  stripePriceYearly: z.string().max(100).nullable().optional(),
  maxUsers: z.number().int().min(-1).optional(),
  maxMembers: z.number().int().min(-1).optional(),
  maxStudents: z.number().int().min(-1).optional(),
  storageMb: z.number().int().min(0).optional(),
  features: z.array(z.enum(FEATURES)).optional(),
  trialDays: z.number().int().min(0).max(90).optional(),
  active: z.boolean().optional(),
});
const incidentPatch = z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']), resolution: z.string().trim().max(5000).optional() });
const moderateSchema = z.object({ approve: z.boolean(), note: z.string().trim().max(1000).optional() });

/**
 * Panel global de plataforma. Usa el cliente de sistema (sin RLS) y sólo expone metadatos de
 * tenants, nunca datos personales de sus socios. Cada acción queda auditada en el tenant afectado.
 */
@ApiTags('admin')
@ApiBearerAuth()
@PlatformAdmin()
@Controller('admin')
export class AdminController {
  constructor(
    private readonly db: Db,
    private readonly jobs: Jobs,
  ) {}

  private auditFor(tenantId: string, ctx: RequestContext, action: string, entity: string, entityId: string, metadata?: object) {
    return this.db.system.auditLog.create({
      data: {
        tenantId, actorId: ctx.userId, action: `platform.${action}`, entity, entityId,
        metadata: metadata as Prisma.InputJsonValue, ipHash: pseudonymize(ctx.ip),
      },
    });
  }

  @Get('metrics')
  async metrics() {
    const [byStatus, byPlan, openIncidents, pendingListings] = await Promise.all([
      this.db.system.tenant.groupBy({ by: ['status'], where: { deletedAt: null }, _count: true }),
      this.db.system.$queryRaw<{ code: string; monthly: bigint; yearly: bigint }[]>`
        SELECT p.code,
          COUNT(*) FILTER (WHERE s.interval = 'MONTH' OR s.interval IS NULL)::bigint AS monthly,
          COUNT(*) FILTER (WHERE s.interval = 'YEAR')::bigint AS yearly
        FROM tenants t JOIN plans p ON p.id = t."planId" LEFT JOIN subscriptions s ON s.tenant_id = t.id
        WHERE t."deletedAt" IS NULL AND t.status IN ('ACTIVE', 'PAST_DUE') AND p.code <> 'FREE'
        GROUP BY p.code`,
      this.db.system.incident.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      this.db.system.listing.count({ where: { status: 'PENDING_REVIEW' } }),
    ]);
    const plans = await this.db.system.plan.findMany();
    const mrrCents = byPlan.reduce((sum, r) => {
      const p = plans.find((x) => x.code === r.code)!;
      return sum + Number(r.monthly) * p.priceMonthlyCents + Math.round((Number(r.yearly) * p.priceYearlyCents) / 12);
    }, 0);
    return {
      tenants: { total: byStatus.reduce((s, x) => s + x._count, 0), byStatus: Object.fromEntries(byStatus.map((x) => [x.status, x._count])) },
      mrrCents,
      openIncidents,
      pendingListings,
    };
  }

  @Get('tenants')
  async tenants(@Query(zod(tenantsQuery)) q: z.infer<typeof tenantsQuery>) {
    const where: Prisma.TenantWhereInput = {
      deletedAt: null,
      status: q.status,
      ...(q.q && { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { slug: { contains: q.q, mode: 'insensitive' } }] }),
    };
    const [data, total] = await Promise.all([
      this.db.system.tenant.findMany({
        where,
        include: { plan: { select: { code: true, name: true } }, subscription: { select: { stripeStatus: true, interval: true, graceUntil: true } }, _count: { select: { memberships: true } } },
        orderBy: { createdAt: 'desc' },
        ...skipTake(q),
      }),
      this.db.system.tenant.count({ where }),
    ]);
    return page(data.map((t) => ({ ...t, storageUsedBytes: Number(t.storageUsedBytes) })), total, q);
  }

  @Get('tenants/:id')
  async tenant(@Param('id', zod(idParam)) id: string) {
    const t = found(
      await this.db.system.tenant.findUnique({
        where: { id },
        include: { plan: true, subscription: true, memberships: { include: { user: { select: { email: true, name: true } }, role: { select: { key: true } } } } },
      }),
      'Banda',
    );
    const [members, students, invoices, incidents] = await Promise.all([
      this.db.system.member.count({ where: { tenantId: id, status: 'ACTIVE' } }),
      this.db.system.student.count({ where: { tenantId: id, status: { not: 'LEFT' } } }),
      this.db.system.invoice.findMany({ where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: 12 }),
      this.db.system.incident.findMany({ where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    return {
      ...t,
      storageUsedBytes: Number(t.storageUsedBytes),
      // Sólo propietarios y administradores: el soporte no necesita ver al resto de usuarios.
      memberships: t.memberships.filter((m) => ['owner', 'admin'].includes(m.role.key)),
      activeMembers: members,
      activeStudents: students,
      invoices,
      incidents,
    };
  }

  @Patch('tenants/:id')
  async updateTenant(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(tenantPatch)) body: z.infer<typeof tenantPatch>) {
    found(await this.db.system.tenant.findUnique({ where: { id } }), 'Banda');
    const plan = body.planCode ? await this.db.system.plan.findUniqueOrThrow({ where: { code: body.planCode } }) : undefined;
    const t = await this.db.system.tenant.update({ where: { id }, data: { status: body.status, planId: plan?.id, addons: body.addons, studentSeats: body.studentSeats } });
    await this.auditFor(id, ctx, 'tenant.updated', 'tenant', id, body);
    return t;
  }

  @Get('plans')
  plans() {
    return this.db.system.plan.findMany({ orderBy: { priceMonthlyCents: 'asc' }, include: { _count: { select: { tenants: true } } } });
  }

  @Patch('plans/:id')
  updatePlan(@Param('id', zod(idParam)) id: string, @Body(zod(planPatch)) body: z.infer<typeof planPatch>) {
    return this.db.system.plan.update({ where: { id }, data: body });
  }

  @Get('incidents')
  incidents(@Query('status') status?: string) {
    const parsed = z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional().safeParse(status || undefined);
    return this.db.system.incident.findMany({
      where: { status: parsed.success ? parsed.data : undefined },
      orderBy: [{ status: 'asc' }, { priority: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }

  @Patch('incidents/:id')
  async updateIncident(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(incidentPatch)) body: z.infer<typeof incidentPatch>) {
    const inc = await this.db.system.incident.update({ where: { id }, data: body });
    await this.auditFor(inc.tenantId, ctx, 'incident.updated', 'incident', id, { status: body.status });
    if (inc.openedById && (body.status === 'RESOLVED' || body.status === 'CLOSED')) {
      await this.jobs.add('notify.fanout', {
        tenantId: inc.tenantId, userIds: [inc.openedById], type: 'incident', title: `Incidencia resuelta: ${inc.subject}`,
        body: body.resolution ?? 'El equipo de soporte ha cerrado la incidencia.', link: '/incidents', email: true,
      });
    }
    return inc;
  }

  @Get('market/pending')
  async pending() {
    const listings = await this.db.system.listing.findMany({
      where: { status: 'PENDING_REVIEW' },
      include: { reports: { where: { resolvedAt: null } } },
      orderBy: { updatedAt: 'asc' },
    });
    const reported = await this.db.system.listing.findMany({
      where: { status: 'PUBLISHED', reports: { some: { resolvedAt: null } } },
      include: { reports: { where: { resolvedAt: null } } },
    });
    const tenants = await this.db.system.tenant.findMany({ where: { id: { in: [...listings, ...reported].map((l) => l.tenantId) } }, select: { id: true, name: true } });
    const name = (id: string) => tenants.find((t) => t.id === id)?.name;
    return {
      pending: listings.map((l) => ({ ...l, seller: { name: name(l.tenantId) } })),
      reported: reported.map((l) => ({ ...l, seller: { name: name(l.tenantId) } })),
    };
  }

  @HttpCode(200)
  @Post('market/listings/:id/moderate')
  async moderate(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(moderateSchema)) body: z.infer<typeof moderateSchema>) {
    const listing = found(await this.db.system.listing.findUnique({ where: { id } }), 'Anuncio');
    const updated = await this.db.system.$transaction(async (tx) => {
      const l = await tx.listing.update({
        where: { id },
        data: {
          status: body.approve ? 'PUBLISHED' : 'REJECTED',
          moderationNote: body.note ?? null,
          moderatedAt: new Date(),
          publishedAt: body.approve ? (listing.publishedAt ?? new Date()) : null,
        },
      });
      await tx.listingReport.updateMany({ where: { listingId: id, resolvedAt: null }, data: { resolvedAt: new Date() } });
      return l;
    });
    await this.auditFor(listing.tenantId, ctx, body.approve ? 'listing.approved' : 'listing.rejected', 'listing', id, { note: body.note });
    await this.jobs.add('notify.fanout', {
      tenantId: listing.tenantId, userIds: [listing.createdById], type: 'market.moderation', email: true,
      title: body.approve ? `Anuncio publicado: ${listing.title}` : `Anuncio rechazado: ${listing.title}`,
      body: body.note ?? (body.approve ? 'Tu anuncio ya es visible en BandMarket.' : 'Revisa el anuncio y vuelve a enviarlo.'),
      link: '/market',
    });
    return updated;
  }
}
