import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { AllowReadOnly, Ctx, NoTenant, Perm, Public } from '../auth/decorators';
import { zod } from '../common/zod.pipe';
import { env } from '../config/env';
import { FEATURE_MODULES } from '../billing/feature-catalog';
import { Db } from '../db/db.service';
import { Audit } from '../audit/audit.service';
import { logoFileName, readLogo } from '../platform/logo';
import { Storage } from '../storage/storage.service';
import { effectiveLimits } from './effective-limits';
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
const TENANT_SELECT = { ...TENANT_FIELDS, logoKey: true, updatedAt: true } as const;

function presentTenant<T extends { logoKey: string | null; updatedAt: Date }>(t: T) {
  const { logoKey, updatedAt, ...rest } = t;
  return { ...rest, updatedAt, hasLogo: !!logoKey, logoVersion: logoKey ? updatedAt.toISOString() : null };
}

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
    private readonly storage: Storage,
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

  /** Catálogo público de funcionalidades implementadas (etiquetas de planes y comparación). */
  @Public()
  @Get('feature-catalog')
  featureCatalog() {
    return FEATURE_MODULES;
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

  @Get('setup-guide')
  setupGuide(@Ctx() ctx: RequestContext) {
    return this.onboarding.guide(ctx);
  }

  @AllowReadOnly()
  @Patch('setup-guide')
  dismissSetupGuide(@Ctx() ctx: RequestContext, @Body(zod(z.object({ dismissed: z.boolean() }))) body: { dismissed: boolean }) {
    return this.onboarding.setDismissed(ctx, body.dismissed);
  }

  @Get('tenant')
  async tenant(@Ctx() ctx: RequestContext) {
    const t = await this.db.tenant(ctx.tenantId, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: TENANT_SELECT }));
    return presentTenant(t);
  }

  @Perm('tenant:manage')
  @Patch('tenant')
  async updateTenant(@Ctx() ctx: RequestContext, @Body(zod(tenantPatch)) body: z.infer<typeof tenantPatch>) {
    // Sólo campos de la lista blanca: estado, plan y uso de almacenamiento los gestiona el sistema.
    const t = await this.db.tenant(ctx.tenantId, async (tx) => {
      const row = await tx.tenant.update({ where: { id: ctx.tenantId }, data: body, select: TENANT_SELECT });
      await this.audit.log(tx, ctx, 'tenant.updated', 'tenant', row.id, body);
      return row;
    });
    return presentTenant(t);
  }

  @Perm('tenant:manage')
  @Post('tenant/logo')
  async logoSave(@Ctx() ctx: RequestContext, @Req() req: Request) {
    const { buf, mime } = await readLogo(req);
    const fileKey = this.storage.newKey(ctx.tenantId, 'brand', logoFileName(mime));
    await this.storage.putObject(fileKey, buf, mime);
    const t = await this.db.tenant(ctx.tenantId, async (tx) => {
      const prev = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { logoKey: true } });
      const row = await tx.tenant.update({ where: { id: ctx.tenantId }, data: { logoKey: fileKey, logoMime: mime }, select: TENANT_SELECT });
      await this.audit.log(tx, ctx, 'tenant.logo', 'tenant', row.id);
      if (prev.logoKey && prev.logoKey !== fileKey) await this.storage.remove(prev.logoKey);
      return row;
    });
    return presentTenant(t);
  }

  @Perm('tenant:manage')
  @Delete('tenant/logo')
  @HttpCode(200)
  async logoRemove(@Ctx() ctx: RequestContext) {
    const t = await this.db.tenant(ctx.tenantId, async (tx) => {
      const prev = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { logoKey: true } });
      const row = await tx.tenant.update({ where: { id: ctx.tenantId }, data: { logoKey: null, logoMime: null }, select: TENANT_SELECT });
      await this.audit.log(tx, ctx, 'tenant.logo_removed', 'tenant', row.id);
      if (prev.logoKey) await this.storage.remove(prev.logoKey);
      return row;
    });
    return presentTenant(t);
  }

  @Get('dashboard')
  async dashboard(@Ctx() ctx: RequestContext) {
    const tenant = await this.db.system.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, include: { plan: true } });
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const since = new Date(Date.now() - 30 * 86_400_000);
      // Cada indicador sólo se calcula y se devuelve a quien tiene el permiso del módulo que lo origina.
      const can = (p: string) => ctx.permissions.has(p);
      const showMembers = can('members:read');
      const showFinance = can('finance:read') && ctx.features.has('treasury');
      const showAttendance = can('attendance:read');
      const showAccount = can('tenant:manage') || can('billing:manage') || can('users:manage');
      const [active, total, nextEvents, pending, att, users] = await Promise.all([
        showMembers ? tx.member.count({ where: { status: 'ACTIVE' } }) : 0,
        showMembers ? tx.member.count() : 0,
        can('events:read') ? tx.event.findMany({ where: { startsAt: { gte: new Date() }, status: 'SCHEDULED' }, orderBy: { startsAt: 'asc' }, take: 5 }) : [],
        showFinance ? tx.feeCharge.aggregate({ where: { status: { in: ['PENDING', 'OVERDUE'] } }, _count: true, _sum: { amountCents: true } }) : null,
        showAttendance ? tx.attendance.groupBy({ by: ['status'], where: { recordedAt: { gte: since } }, _count: true }) : [],
        showAccount ? tx.membership.count({ where: { status: 'ACTIVE' } }) : 0,
      ]);
      const totalAtt = att.reduce((s, a) => s + a._count, 0);
      const present = att.filter((a) => a.status === 'PRESENT' || a.status === 'LATE').reduce((s, a) => s + a._count, 0);
      return {
        members: showMembers ? { active, total } : null,
        nextEvents,
        pendingCharges: pending ? { count: pending._count, amountCents: pending._sum.amountCents ?? 0 } : null,
        // Tasa como fracción 0–1 (la web la formatea como porcentaje).
        attendanceRate30d: totalAtt ? Math.round((present / totalAtt) * 1000) / 1000 : null,
        storage: showAccount
          ? { usedBytes: Number(tenant.storageUsedBytes), limitBytes: effectiveLimits(tenant).storageMb * 1024 * 1024 }
          : null,
        users: showAccount ? { used: users, limit: effectiveLimits(tenant).maxUsers } : null,
      };
    });
  }
}
