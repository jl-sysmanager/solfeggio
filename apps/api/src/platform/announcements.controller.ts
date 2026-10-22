import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Announcement } from '@prisma/client';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, NoTenant, PlatformAdmin } from '../auth/decorators';
import { computeFeatures, freeFeatures } from '../billing/entitlements';
import { found } from '../common/errors';
import { idParam } from '../common/schemas';
import { zod } from '../common/zod.pipe';
import { Db } from '../db/db.service';
import { Segment, matchesSegment, segmentSchema } from './announcements.util';
import { platformAudit } from './support.util';

const link = z.string().trim().max(300).refine((v) => v.startsWith('/') || /^https:\/\//.test(v), 'Enlace relativo (/ruta) o https');
const fields = z.object({
  title: z.string().trim().min(3).max(140),
  body: z.string().trim().min(3).max(1000),
  level: z.enum(['INFO', 'WARNING', 'MAINTENANCE']).default('INFO'),
  link: link.nullable().optional(),
  startsAt: z.string().datetime({ offset: true }).optional(),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  segment: segmentSchema,
  dismissible: z.boolean().default(true),
});
const checkDates = (v: { startsAt?: string; endsAt?: string | null }) => !v.startsAt || !v.endsAt || new Date(v.endsAt) > new Date(v.startsAt);
const create = fields.refine(checkDates, { message: 'El fin debe ser posterior al inicio', path: ['endsAt'] });
const update = fields.partial().refine(checkDates, { message: 'El fin debe ser posterior al inicio', path: ['endsAt'] });
const previewSchema = z.object({ segment: segmentSchema });

const state = (a: Announcement, now: Date) => (a.startsAt > now ? 'scheduled' : a.endsAt && a.endsAt <= now ? 'ended' : 'active');

/**
 * Avisos de plataforma a las bandas. Administración en `/admin/announcements`; la app consulta
 * `/announcements/active` (sin exigir banda: el mantenimiento llega también al panel global).
 */
@ApiTags('announcements')
@ApiBearerAuth()
@Controller()
export class AnnouncementsController {
  constructor(private readonly db: Db) {}

  private async tenantFacts() {
    const free = await freeFeatures(this.db);
    const tenants = await this.db.system.tenant.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        region: true,
        addons: true,
        complimentaryUntil: true,
        plan: { select: { code: true, features: true, priceMonthlyCents: true, priceYearlyCents: true } },
        subscription: { select: { stripeSubscriptionId: true, stripeStatus: true } },
        _count: { select: { memberships: { where: { status: 'ACTIVE' } } } },
      },
    });
    return tenants.map((t) => ({
      id: t.id,
      planCode: t.plan.code as string,
      region: t.region,
      features: computeFeatures(t, free),
      users: t._count.memberships,
    }));
  }

  /** Cuántas bandas y usuarios (membresías activas) alcanza un segmento. */
  private async reach(segment: Segment) {
    const hit = (await this.tenantFacts()).filter((t) => matchesSegment(segment, t));
    return { tenants: hit.length, users: hit.reduce((s, t) => s + t.users, 0) };
  }

  @PlatformAdmin()
  @Get('admin/announcements')
  async list() {
    const now = new Date();
    const rows = await this.db.system.announcement.findMany({ orderBy: { startsAt: 'desc' }, take: 200, include: { _count: { select: { dismissals: true } } } });
    const facts = await this.tenantFacts();
    return rows.map(({ _count, ...a }) => {
      const hit = facts.filter((t) => matchesSegment(a.segment as Segment, t));
      return { ...a, state: state(a, now), dismissals: _count.dismissals, reach: { tenants: hit.length, users: hit.reduce((s, t) => s + t.users, 0) } };
    });
  }

  @PlatformAdmin()
  @HttpCode(200)
  @Post('admin/announcements/preview')
  preview(@Body(zod(previewSchema)) body: z.infer<typeof previewSchema>) {
    return this.reach(body.segment);
  }

  @PlatformAdmin()
  @Post('admin/announcements')
  async create(@Ctx() ctx: RequestContext, @Body(zod(create)) body: z.infer<typeof create>) {
    const a = await this.db.system.announcement.create({
      data: { ...body, startsAt: body.startsAt ? new Date(body.startsAt) : new Date(), endsAt: body.endsAt ? new Date(body.endsAt) : null, link: body.link ?? null, createdById: ctx.userId },
    });
    await platformAudit(this.db.system, ctx, 'announcement.created', 'announcement', a.id, { title: a.title, level: a.level, segment: body.segment });
    return a;
  }

  @PlatformAdmin()
  @Patch('admin/announcements/:id')
  async update(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(update)) body: z.infer<typeof update>) {
    const cur = found(await this.db.system.announcement.findUnique({ where: { id } }), 'Aviso');
    const startsAt = body.startsAt ? new Date(body.startsAt) : undefined;
    const endsAt = body.endsAt === undefined ? undefined : body.endsAt ? new Date(body.endsAt) : null;
    if ((endsAt ?? cur.endsAt) && (startsAt ?? cur.startsAt) >= (endsAt ?? cur.endsAt)!) {
      throw new BadRequestException({ message: 'El fin debe ser posterior al inicio', code: 'VALIDATION_ERROR' });
    }
    const a = await this.db.system.announcement.update({ where: { id }, data: { ...body, startsAt, endsAt, link: body.link } });
    await platformAudit(this.db.system, ctx, 'announcement.updated', 'announcement', id, { fields: Object.keys(body) });
    return a;
  }

  /** Finaliza un aviso ahora mismo. */
  @PlatformAdmin()
  @HttpCode(200)
  @Post('admin/announcements/:id/end')
  async end(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    found(await this.db.system.announcement.findUnique({ where: { id } }), 'Aviso');
    const a = await this.db.system.announcement.update({ where: { id }, data: { endsAt: new Date() } });
    await platformAudit(this.db.system, ctx, 'announcement.ended', 'announcement', id);
    return a;
  }

  @PlatformAdmin()
  @HttpCode(204)
  @Delete('admin/announcements/:id')
  async remove(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    const { count } = await this.db.system.announcement.deleteMany({ where: { id } });
    if (count) await platformAudit(this.db.system, ctx, 'announcement.deleted', 'announcement', id);
  }

  // ── Lado app ─────────────────────────────────────────────────────────────

  /** Avisos vigentes para el usuario: por segmento de su banda y sin los que ya descartó. El mantenimiento llega a todos. */
  @NoTenant()
  @Get('announcements/active')
  async active(@Ctx() ctx: RequestContext) {
    const now = new Date();
    const rows = await this.db.system.announcement.findMany({
      where: { startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }], dismissals: { none: { userId: ctx.userId } } },
      orderBy: [{ startsAt: 'desc' }],
      take: 20,
    });
    if (!rows.length) return [];
    let facts: Awaited<ReturnType<AnnouncementsController['tenantFacts']>>[number] | undefined;
    if (ctx.tenantId && rows.some((a) => a.level !== 'MAINTENANCE')) {
      const t = await this.db.system.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: {
          id: true,
          region: true,
          addons: true,
          complimentaryUntil: true,
          plan: { select: { code: true, features: true, priceMonthlyCents: true, priceYearlyCents: true } },
          subscription: { select: { stripeSubscriptionId: true, stripeStatus: true } },
        },
      });
      if (t) facts = { id: t.id, planCode: t.plan.code, region: t.region, features: computeFeatures(t, await freeFeatures(this.db)), users: 0 };
    }
    return rows
      .filter((a) => a.level === 'MAINTENANCE' || (facts && matchesSegment(a.segment as Segment, facts)))
      .map((a) => ({ id: a.id, title: a.title, body: a.body, level: a.level, link: a.link, startsAt: a.startsAt, endsAt: a.endsAt, dismissible: a.dismissible }));
  }

  @NoTenant()
  @HttpCode(204)
  @Post('announcements/:id/dismiss')
  async dismiss(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    const a = found(await this.db.system.announcement.findUnique({ where: { id } }), 'Aviso');
    if (!a.dismissible) throw new BadRequestException({ message: 'Este aviso no se puede descartar', code: 'NOT_DISMISSIBLE' });
    await this.db.system.announcementDismissal.upsert({
      where: { announcementId_userId: { announcementId: id, userId: ctx.userId } },
      create: { announcementId: id, userId: ctx.userId },
      update: {},
    });
  }
}
