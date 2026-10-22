import { Body, Controller, Get, Patch, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, NoTenant, Perm, Public } from '../auth/decorators';
import { zod } from '../common/zod.pipe';
import { env } from '../config/env';
import { Db } from '../db/db.service';
import { Audit } from '../audit/audit.service';
import { OnboardingService } from './onboarding.service';

const onboardingSchema = z.object({
  bandName: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, 'Sólo minúsculas, números y guiones (3-40)'),
  country: z.string().length(2).optional(),
  timezone: z.string().max(64).optional(),
});

/** Comunidades autónomas y ciudades autónomas; se usan para segmentar los avisos de plataforma. */
export const REGIONS = [
  'Andalucía', 'Aragón', 'Asturias', 'Illes Balears', 'Canarias', 'Cantabria', 'Castilla y León', 'Castilla-La Mancha', 'Cataluña',
  'Comunitat Valenciana', 'Extremadura', 'Galicia', 'La Rioja', 'Comunidad de Madrid', 'Región de Murcia', 'Navarra', 'País Vasco', 'Ceuta', 'Melilla',
] as const;

/** Campos de la banda visibles para sus usuarios (sin contadores internos como el almacenamiento). */
const TENANT_FIELDS = { id: true, name: true, slug: true, legalName: true, taxId: true, country: true, timezone: true, locale: true, region: true, status: true, createdAt: true } as const;

const tenantPatch = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  legalName: z.string().trim().max(200).nullable().optional(),
  taxId: z.string().trim().max(32).nullable().optional(),
  country: z.string().length(2).optional(),
  timezone: z.string().max(64).optional(),
  locale: z.string().max(10).optional(),
  region: z.enum(REGIONS).nullable().optional(),
});

@ApiTags('tenancy')
@ApiBearerAuth()
@Controller()
export class TenancyController {
  constructor(
    private readonly db: Db,
    private readonly onboarding: OnboardingService,
    private readonly audit: Audit,
  ) {}

  @Public()
  @Get('plans')
  plans() {
    return this.db.system.plan.findMany({
      where: { active: true },
      orderBy: { priceMonthlyCents: 'asc' },
      select: {
        id: true, code: true, name: true, priceMonthlyCents: true, priceYearlyCents: true, currency: true,
        maxUsers: true, maxMembers: true, storageMb: true, features: true, trialDays: true,
      },
    });
  }

  @NoTenant()
  @Post('onboarding')
  async createBand(@Ctx() ctx: RequestContext, @Body(zod(onboardingSchema)) body: z.infer<typeof onboardingSchema>, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refresh, session } = await this.onboarding.createBand(ctx.userId, body);
    res.cookie('sf_rt', refresh, {
      httpOnly: true, secure: env().NODE_ENV === 'production', sameSite: 'strict', path: '/api/v1/auth',
      maxAge: env().JWT_REFRESH_TTL_DAYS * 86_400_000,
    });
    return { accessToken, session };
  }

  @Get('tenant')
  tenant(@Ctx() ctx: RequestContext) {
    return this.db.tenant(ctx.tenantId, (tx) =>
      tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: TENANT_FIELDS }),
    );
  }

  @Perm('tenant:manage')
  @Patch('tenant')
  updateTenant(@Ctx() ctx: RequestContext, @Body(zod(tenantPatch)) body: z.infer<typeof tenantPatch>) {
    // Sólo campos de la lista blanca: estado, plan y uso de almacenamiento los gestiona el sistema.
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const t = await tx.tenant.update({ where: { id: ctx.tenantId }, data: body, select: TENANT_FIELDS });
      await this.audit.log(tx, ctx, 'tenant.updated', 'tenant', t.id, body);
      return t;
    });
  }

  @Get('dashboard')
  async dashboard(@Ctx() ctx: RequestContext) {
    const tenant = await this.db.system.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, include: { plan: true } });
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const since = new Date(Date.now() - 30 * 86_400_000);
      const [active, total, nextEvents, pending, att, users] = await Promise.all([
        tx.member.count({ where: { status: 'ACTIVE' } }),
        tx.member.count(),
        tx.event.findMany({ where: { startsAt: { gte: new Date() }, status: 'SCHEDULED' }, orderBy: { startsAt: 'asc' }, take: 5 }),
        tx.feeCharge.aggregate({ where: { status: { in: ['PENDING', 'OVERDUE'] } }, _count: true, _sum: { amountCents: true } }),
        tx.attendance.groupBy({ by: ['status'], where: { recordedAt: { gte: since } }, _count: true }),
        tx.membership.count({ where: { status: 'ACTIVE' } }),
      ]);
      const totalAtt = att.reduce((s, a) => s + a._count, 0);
      const present = att.filter((a) => a.status === 'PRESENT' || a.status === 'LATE').reduce((s, a) => s + a._count, 0);
      return {
        members: { active, total },
        nextEvents,
        pendingCharges: { count: pending._count, amountCents: pending._sum.amountCents ?? 0 },
        // Tasa como fracción 0–1 (la web la formatea como porcentaje).
        attendanceRate30d: totalAtt ? Math.round((present / totalAtt) * 1000) / 1000 : null,
        storage: { usedBytes: Number(tenant.storageUsedBytes), limitBytes: tenant.plan.storageMb * 1024 * 1024 },
        users: { used: users, limit: tenant.plan.maxUsers },
      };
    });
  }
}
