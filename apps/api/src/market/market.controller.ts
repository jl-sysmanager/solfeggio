import { BadRequestException, Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Listing, Prisma } from '@prisma/client';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, Perm, RequireFeature } from '../auth/decorators';
import { found } from '../common/errors';
import { page, pageQuery, skipTake } from '../common/pagination';
import { cents, idParam } from '../common/schemas';
import { zod } from '../common/zod.pipe';
import { Db, Tx } from '../db/db.service';
import { Audit } from '../audit/audit.service';
import { Jobs } from '../jobs/jobs.service';
import { MIME_GROUPS, Storage } from '../storage/storage.service';
import { uploadRequest, Uploads } from '../storage/upload';

const listingSchema = z.object({
  title: z.string().trim().min(3).max(140),
  description: z.string().trim().min(10).max(5000),
  category: z.string().trim().min(2).max(60),
  condition: z.enum(['NEW', 'GOOD', 'WORN', 'DAMAGED']),
  priceCents: cents,
  location: z.string().trim().max(120).nullable().optional(),
  imageKeys: z.array(z.string().max(300)).max(8).optional(),
});
const browseQuery = pageQuery.extend({ q: z.string().trim().max(100).optional(), category: z.string().max(60).optional() });
const inquirySchema = z.object({ message: z.string().trim().min(5).max(2000) });
const reportSchema = z.object({ reason: z.string().trim().min(5).max(1000) });

/**
 * BandMarket. Las políticas RLS de `listings` permiten leer anuncios publicados de cualquier banda
 * y escribir sólo los propios; aquí además se valida el estado en cada transición.
 */
@ApiTags('market')
@ApiBearerAuth()
@RequireFeature('market')
@Controller('market')
export class MarketController {
  constructor(
    private readonly db: Db,
    private readonly audit: Audit,
    private readonly jobs: Jobs,
    private readonly uploads: Uploads,
    private readonly storage: Storage,
  ) {}

  /** Nombres públicos de las bandas vendedoras (único dato que se comparte entre tenants). */
  private async sellers(tenantIds: string[]) {
    const tenants = await this.db.system.tenant.findMany({ where: { id: { in: [...new Set(tenantIds)] } }, select: { id: true, name: true } });
    return new Map(tenants.map((t) => [t.id, t.name]));
  }

  private async present(listings: Listing[], ctx: RequestContext) {
    const names = await this.sellers(listings.map((l) => l.tenantId));
    return Promise.all(
      listings.map(async (l) => ({
        id: l.id, title: l.title, description: l.description, category: l.category, condition: l.condition,
        priceCents: l.priceCents, currency: l.currency, location: l.location, status: l.status,
        publishedAt: l.publishedAt, createdAt: l.createdAt,
        isMine: l.tenantId === ctx.tenantId,
        moderationNote: l.tenantId === ctx.tenantId ? l.moderationNote : undefined,
        seller: { name: names.get(l.tenantId) ?? 'Banda' },
        imageUrls: await Promise.all(l.imageKeys.map((k) => this.storage.downloadUrl(k, k.split('/').pop()!))),
      })),
    );
  }

  private async own(tx: Tx, id: string, ctx: RequestContext) {
    const l = found(await tx.listing.findUnique({ where: { id } }), 'Anuncio');
    if (l.tenantId !== ctx.tenantId) throw found(null, 'Anuncio');
    return l;
  }

  @Perm('market:read')
  @Get('listings')
  browse(@Ctx() ctx: RequestContext, @Query(zod(browseQuery)) q: z.infer<typeof browseQuery>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const where: Prisma.ListingWhereInput = {
        status: 'PUBLISHED',
        category: q.category ? { equals: q.category, mode: 'insensitive' } : undefined,
        ...(q.q && { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { description: { contains: q.q, mode: 'insensitive' } }] }),
      };
      const [data, total] = await Promise.all([
        tx.listing.findMany({ where, orderBy: { publishedAt: 'desc' }, ...skipTake(q) }),
        tx.listing.count({ where }),
      ]);
      return page(await this.present(data, ctx), total, q);
    });
  }

  @Perm('market:read')
  @Get('listings/mine')
  mine(@Ctx() ctx: RequestContext) {
    return this.db.tenant(ctx.tenantId, async (tx) =>
      this.present(await tx.listing.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { updatedAt: 'desc' } }), ctx),
    );
  }

  @Perm('market:read')
  @Get('listings/:id')
  get(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => (await this.present([found(await tx.listing.findUnique({ where: { id } }), 'Anuncio')], ctx))[0]);
  }

  @Perm('market:write')
  @Post('images/upload-url')
  imageUploadUrl(@Ctx() ctx: RequestContext, @Body(zod(uploadRequest)) body: z.infer<typeof uploadRequest>) {
    return this.uploads.request(ctx.tenantId, 'market', body, MIME_GROUPS.image);
  }

  private checkImages(ctx: RequestContext, keys?: string[]) {
    keys?.forEach((k) => this.storage.assertOwned(ctx.tenantId, k, 'market'));
  }

  @Perm('market:write')
  @Post('listings')
  create(@Ctx() ctx: RequestContext, @Body(zod(listingSchema)) body: z.infer<typeof listingSchema>) {
    this.checkImages(ctx, body.imageKeys);
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const l = await tx.listing.create({ data: { ...body, tenantId: ctx.tenantId, createdById: ctx.userId } });
      await this.audit.log(tx, ctx, 'listing.created', 'listing', l.id, { title: l.title });
      return (await this.present([l], ctx))[0];
    });
  }

  @Perm('market:write')
  @Patch('listings/:id')
  update(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(listingSchema.partial())) body: Partial<z.infer<typeof listingSchema>>) {
    this.checkImages(ctx, body.imageKeys);
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const l = await this.own(tx, id, ctx);
      if (!['DRAFT', 'REJECTED'].includes(l.status)) {
        throw new BadRequestException({ message: 'Sólo se pueden editar borradores o anuncios rechazados', code: 'LISTING_LOCKED' });
      }
      const updated = await tx.listing.update({ where: { id }, data: { ...body, status: 'DRAFT' } });
      return (await this.present([updated], ctx))[0];
    });
  }

  private async transition(ctx: RequestContext, id: string, from: string[], to: 'PENDING_REVIEW' | 'SOLD' | 'ARCHIVED') {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const l = await this.own(tx, id, ctx);
      if (!from.includes(l.status)) throw new BadRequestException({ message: 'Transición no permitida', code: 'INVALID_TRANSITION' });
      const updated = await tx.listing.update({ where: { id }, data: { status: to } });
      await this.audit.log(tx, ctx, `listing.${to.toLowerCase()}`, 'listing', id);
      return (await this.present([updated], ctx))[0];
    });
  }

  @Perm('market:write')
  @HttpCode(200)
  @Post('listings/:id/submit')
  submit(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.transition(ctx, id, ['DRAFT', 'REJECTED'], 'PENDING_REVIEW');
  }

  @Perm('market:write')
  @HttpCode(200)
  @Post('listings/:id/sold')
  sold(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.transition(ctx, id, ['PUBLISHED'], 'SOLD');
  }

  @Perm('market:write')
  @HttpCode(200)
  @Post('listings/:id/archive')
  archive(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.transition(ctx, id, ['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'SOLD'], 'ARCHIVED');
  }

  @Perm('market:write')
  @Post('listings/:id/inquiries')
  async inquire(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(inquirySchema)) body: z.infer<typeof inquirySchema>) {
    const inquiry = await this.db.tenant(ctx.tenantId, async (tx) => {
      const l = found(await tx.listing.findUnique({ where: { id } }), 'Anuncio');
      if (l.status !== 'PUBLISHED') throw found(null, 'Anuncio');
      if (l.tenantId === ctx.tenantId) throw new BadRequestException({ message: 'Es un anuncio de tu banda', code: 'OWN_LISTING' });
      return tx.listingInquiry.create({
        data: { listingId: id, sellerTenantId: l.tenantId, buyerTenantId: ctx.tenantId, fromUserId: ctx.userId, message: body.message },
      });
    });
    // Notifica a los gestores de material de la banda vendedora.
    const managers = await this.db.system.membership.findMany({
      where: { tenantId: inquiry.sellerTenantId, status: 'ACTIVE', role: { permissions: { has: 'market:write' } } },
      select: { userId: true },
    });
    await this.jobs.add('notify.fanout', {
      tenantId: inquiry.sellerTenantId, userIds: managers.map((m) => m.userId), type: 'market.inquiry', email: true,
      title: 'Nuevo mensaje en BandMarket', body: 'Una banda está interesada en uno de vuestros anuncios.', link: '/market',
    });
    return inquiry;
  }

  /** Mensajes enviados y recibidos. Se muestra el nombre y email del remitente para poder responder. */
  @Perm('market:write')
  @Get('inquiries')
  async inquiries(@Ctx() ctx: RequestContext) {
    const rows = await this.db.tenant(ctx.tenantId, (tx) =>
      tx.listingInquiry.findMany({ include: { listing: { select: { id: true, title: true, status: true } } }, orderBy: { createdAt: 'desc' }, take: 200 }),
    );
    const [names, users] = await Promise.all([
      this.sellers(rows.flatMap((r) => [r.buyerTenantId, r.sellerTenantId])),
      this.db.system.user.findMany({ where: { id: { in: rows.map((r) => r.fromUserId) } }, select: { id: true, name: true, email: true } }),
    ]);
    return rows.map((r) => ({
      id: r.id, listing: r.listing, message: r.message, createdAt: r.createdAt,
      direction: r.buyerTenantId === ctx.tenantId ? 'sent' : 'received',
      buyer: { name: names.get(r.buyerTenantId) }, seller: { name: names.get(r.sellerTenantId) },
      from: users.find((u) => u.id === r.fromUserId) ?? null,
    }));
  }

  @Perm('market:read')
  @Post('listings/:id/report')
  report(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(reportSchema)) body: z.infer<typeof reportSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.listing.findUnique({ where: { id } }), 'Anuncio');
      return tx.listingReport.create({ data: { listingId: id, reporterTenantId: ctx.tenantId, reason: body.reason } });
    });
  }
}
