import { Body, Controller, Delete, Get, HttpCode, Param, Post, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { RequestContext } from '../auth/context';
import { Ctx, PlatformAdmin, Public } from '../auth/decorators';
import { notFound } from '../common/errors';
import { zod } from '../common/zod.pipe';
import { Db } from '../db/db.service';
import { uploadRequest } from '../storage/upload';
import { Storage } from '../storage/storage.service';
import { acceptLogo, assertLogoRequest } from './logo';
import { z } from 'zod';

const BRAND_ID = 'platform';
const confirmSchema = z.object({ fileKey: z.string().max(300) });

@ApiTags('brand')
@Controller()
export class BrandController {
  constructor(
    private readonly db: Db,
    private readonly storage: Storage,
  ) {}

  @Public()
  @Get('brand')
  async brand() {
    const row = await this.db.system.platformBrand.findUnique({ where: { id: BRAND_ID } });
    return { hasLogo: !!row?.logoKey, version: row?.updatedAt.toISOString() ?? null };
  }

  @Public()
  @Get('brand/logo')
  async logo(@Res({ passthrough: true }) res: Response) {
    const row = await this.db.system.platformBrand.findUnique({ where: { id: BRAND_ID } });
    if (!row?.logoKey || !row.logoMime) throw notFound('Logotipo');
    return this.stream(res, row.logoKey, row.logoMime);
  }

  /** Logotipo público de una banda. El mismo 404 si no existe la banda o no tiene imagen. */
  @Public()
  @Get('bands/:slug/logo')
  bandLogo(@Param('slug') slug: string, @Res({ passthrough: true }) res: Response) {
    return this.bandLogoBySlug(res, slug);
  }

  @ApiBearerAuth()
  @PlatformAdmin()
  @Post('admin/brand/logo/upload-url')
  async uploadUrl(@Body(zod(uploadRequest)) body: z.infer<typeof uploadRequest>) {
    assertLogoRequest(body.mimeType, body.sizeBytes);
    const fileKey = this.storage.platformLogoKey(body.fileName);
    this.storage.assertPlatformLogo(fileKey);
    return { fileKey, uploadUrl: await this.storage.uploadUrl(fileKey, body.mimeType, body.sizeBytes) };
  }

  @ApiBearerAuth()
  @PlatformAdmin()
  @Post('admin/brand/logo')
  async save(@Ctx() ctx: RequestContext, @Body(zod(confirmSchema)) body: z.infer<typeof confirmSchema>) {
    this.storage.assertPlatformLogo(body.fileKey);
    const { mime } = await acceptLogo(this.storage, body.fileKey);
    const prev = await this.db.system.platformBrand.findUnique({ where: { id: BRAND_ID } });
    const row = await this.db.system.platformBrand.upsert({
      where: { id: BRAND_ID },
      create: { id: BRAND_ID, logoKey: body.fileKey, logoMime: mime },
      update: { logoKey: body.fileKey, logoMime: mime },
    });
    if (prev?.logoKey && prev.logoKey !== body.fileKey) await this.storage.remove(prev.logoKey);
    await this.db.system.platformAuditLog.create({
      data: { actorId: ctx.userId, action: 'brand.logo', entity: 'platform_brand', entityId: BRAND_ID },
    });
    return { hasLogo: true, version: row.updatedAt.toISOString() };
  }

  @ApiBearerAuth()
  @PlatformAdmin()
  @Delete('admin/brand/logo')
  @HttpCode(200)
  async remove() {
    const prev = await this.db.system.platformBrand.findUnique({ where: { id: BRAND_ID } });
    if (prev?.logoKey) await this.storage.remove(prev.logoKey);
    await this.db.system.platformBrand.update({ where: { id: BRAND_ID }, data: { logoKey: null, logoMime: null } }).catch(() => undefined);
    return { hasLogo: false, version: null };
  }

  private async bandLogoBySlug(res: Response, slug: string) {
    if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug)) throw notFound('Logotipo');
    const tenant = await this.db.system.tenant.findUnique({ where: { slug }, select: { logoKey: true, logoMime: true, deletedAt: true } });
    if (!tenant || tenant.deletedAt || !tenant.logoKey || !tenant.logoMime) throw notFound('Logotipo');
    return this.stream(res, tenant.logoKey, tenant.logoMime);
  }

  private async stream(res: Response, key: string, mime: string) {
    let body: Buffer;
    try {
      body = await this.storage.getObject(key);
    } catch {
      throw notFound('Logotipo');
    }
    res.set({ 'Content-Type': mime, 'Cache-Control': 'public, max-age=30', 'X-Content-Type-Options': 'nosniff' });
    return new StreamableFile(body);
  }
}
