import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Query } from '@nestjs/common';
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
import { BillingOpsService } from '../billing/billing-ops.service';
import { PlanSync } from '../billing/plan-sync';
import { resetEntitlementsCache } from '../billing/entitlements';
import { FEATURE_MODULES, withDependencies } from '../billing/feature-catalog';
import { Db } from '../db/db.service';
import { FEATURES } from '../iam/permissions';
import { OnboardingService } from '../tenancy/onboarding.service';

const tenantsQuery = pageQuery.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['TRIALING', 'ACTIVE', 'PAST_DUE', 'READ_ONLY', 'SUSPENDED', 'CANCELLED']).optional(),
});
const tenantPatch = z.object({
  status: z.enum(['ACTIVE', 'READ_ONLY', 'SUSPENDED', 'CANCELLED']).optional(),
  planCode: z.enum(['FREE', 'BASIC', 'PRO', 'ENTERPRISE']).optional(),
  addons: z.array(z.enum(FEATURES)).max(FEATURES.length).optional(),
  studentSeats: z.number().int().min(0).max(100_000).optional(),
  /** Cupos personalizados. null borra el override (vuelve al plan). −1 = ilimitado (usuarios/socios). */
  maxUsersOverride: z.number().int().min(-1).nullable().optional(),
  maxMembersOverride: z.number().int().min(-1).nullable().optional(),
  storageMbOverride: z.number().int().min(1).nullable().optional(),
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
    private readonly billingOps: BillingOpsService,
    private readonly planSync: PlanSync,
    private readonly onboarding: OnboardingService,
  ) {}

  private auditFor(tenantId: string, ctx: RequestContext, action: string, entity: string, entityId: string, metadata?: object) {
    return this.db.system.auditLog.create({
      data: {
        tenantId, actorId: ctx.userId, action: `platform.${action}`, entity, entityId,
        metadata: metadata as Prisma.InputJsonValue, ipHash: pseudonymize(ctx.ip),
      },
    });
  }

  /** Contadores ligeros para los avisos del menú lateral del panel (se consultan al cambiar de pantalla). */
  @Get('summary')
  async summary() {
    const now = new Date();
    const [openIncidents, overdueIncidents, pendingListings, listingReports, reinforcementReports] = await Promise.all([
      this.db.system.incident.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      this.db.system.incident.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] }, firstResponseAt: null, slaDueAt: { lt: now } } }),
      this.db.system.listing.count({ where: { status: 'PENDING_REVIEW' } }),
      this.db.system.listingReport.count({ where: { resolvedAt: null } }),
      this.db.system.reinforcementReport.count({ where: { resolvedAt: null } }),
    ]);
    return {
      support: { open: openIncidents, overdue: overdueIncidents },
      moderation: { pending: pendingListings + listingReports + reinforcementReports },
    };
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
    const t = await this.db.system.tenant.update({
      where: { id },
      data: {
        status: body.status,
        planId: plan?.id,
        addons: body.addons,
        studentSeats: body.studentSeats,
        maxUsersOverride: body.maxUsersOverride,
        maxMembersOverride: body.maxMembersOverride,
        storageMbOverride: body.storageMbOverride,
      },
    });
    await this.auditFor(id, ctx, 'tenant.updated', 'tenant', id, body);
    // Retira ítems legacy de escuela en Stripe si aún quedan; nunca falla la petición.
    if (body.addons !== undefined || body.studentSeats !== undefined) await this.billingOps.syncAddons(id, { userId: ctx.userId, ip: ctx.ip });
    return { ...t, storageUsedBytes: Number(t.storageUsedBytes) };
  }

  /** Baja de una banda: libera el slug, cancela Stripe y borra ficheros y cuentas exclusivas. */
  @HttpCode(200)
  @Delete('tenants/:id')
  async deleteTenant(
    @Ctx() ctx: RequestContext,
    @Param('id', zod(idParam)) id: string,
    @Body(zod(z.object({ confirm: z.literal('ELIMINAR') }))) _body: { confirm: 'ELIMINAR' },
  ) {
    await this.onboarding.softDeleteTenant(id, ctx.userId, { via: 'platform' });
    return { ok: true };
  }

  /** Catálogo de funcionalidades implementadas, agrupadas por módulo (configuración de planes). */
  @Get('feature-catalog')
  featureCatalog() {
    return FEATURE_MODULES;
  }

  @Get('plans')
  plans() {
    return this.db.system.plan.findMany({ orderBy: { priceMonthlyCents: 'asc' }, include: { _count: { select: { tenants: true } } } });
  }

  @Patch('plans/:id')
  async updatePlan(@Param('id', zod(idParam)) id: string, @Body(zod(planPatch)) body: z.infer<typeof planPatch>) {
    const current = found(await this.db.system.plan.findUnique({ where: { id } }), 'Plan');
    this.assertPrices(current.code, body);
    const { stripePriceMonthly, stripePriceYearly, features, ...rest } = body;
    void stripePriceMonthly;
    void stripePriceYearly;
    const data = features ? { ...rest, features: withDependencies(features) } : rest;
    const synced = await this.planSync.publish(current, {
      code: current.code,
      name: data.name ?? current.name,
      priceMonthlyCents: data.priceMonthlyCents ?? current.priceMonthlyCents,
      priceYearlyCents: data.priceYearlyCents ?? current.priceYearlyCents,
      stripePriceMonthly: current.stripePriceMonthly,
      stripePriceYearly: current.stripePriceYearly,
    });
    const plan = await this.db.system.plan.update({ where: { id }, data: { ...data, ...synced } });
    if (plan.code === 'FREE' && body.features) resetEntitlementsCache();
    return plan;
  }

  /** Free no se cobra. Un plan de pago necesita los dos importes: Stripe no admite un precio a cero. */
  private assertPrices(code: string, body: z.infer<typeof planPatch>) {
    if (code === 'FREE') {
      if ((body.priceMonthlyCents ?? 0) > 0 || (body.priceYearlyCents ?? 0) > 0) {
        throw new BadRequestException({ message: 'El plan Free no se cobra', code: 'INVALID_PRICE' });
      }
      return;
    }
    if ((body.priceMonthlyCents !== undefined && body.priceMonthlyCents <= 0) || (body.priceYearlyCents !== undefined && body.priceYearlyCents <= 0)) {
      throw new BadRequestException({ message: 'Un plan de pago necesita precio mensual y anual', code: 'INVALID_PRICE' });
    }
  }
}
