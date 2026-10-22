import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, Perm, RequireFeature } from '../auth/decorators';
import { found } from '../common/errors';
import { page, pageQuery, skipTake } from '../common/pagination';
import { idParam, optionalText } from '../common/schemas';
import { zod } from '../common/zod.pipe';
import { Db } from '../db/db.service';
import { Audit } from '../audit/audit.service';
import { MIME_GROUPS, Storage } from '../storage/storage.service';
import { uploadConfirm, uploadRequest, Uploads } from '../storage/upload';

const ASSET_MIME = [...MIME_GROUPS.score, ...MIME_GROUPS.audio];

const composerSchema = z.object({
  name: z.string().trim().min(1).max(160),
  birthYear: z.number().int().min(1000).max(2100).nullable().optional(),
  deathYear: z.number().int().min(1000).max(2100).nullable().optional(),
  nationality: z.string().trim().max(60).nullable().optional(),
});
const workSchema = z.object({
  title: z.string().trim().min(1).max(200),
  subtitle: optionalText(200),
  composerId: z.string().uuid().nullable().optional(),
  arranger: optionalText(160),
  genre: optionalText(60),
  durationSec: z.number().int().min(0).max(36_000).nullable().optional(),
  difficulty: z.number().int().min(1).max(6).nullable().optional(),
  year: z.number().int().min(1000).max(2100).nullable().optional(),
  publisher: optionalText(160),
  catalogCode: optionalText(60),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(30).optional(),
  notes: optionalText(5000),
});
const worksQuery = pageQuery.extend({
  q: z.string().trim().max(120).optional(),
  tag: z.string().trim().toLowerCase().max(40).optional(),
  genre: z.string().trim().max(60).optional(),
  composerId: z.string().uuid().optional(),
});
const versionSchema = z.object({ name: z.string().trim().min(1).max(120), arranger: optionalText(160), notes: optionalText(2000) });
const assetSchema = uploadConfirm.extend({
  kind: z.enum(['SCORE', 'PART', 'AUDIO', 'OTHER']),
  instrument: optionalText(60),
  versionId: z.string().uuid().nullable().optional(),
});

@ApiTags('archive')
@ApiBearerAuth()
@RequireFeature('archive')
@Controller()
export class ArchiveController {
  constructor(
    private readonly db: Db,
    private readonly audit: Audit,
    private readonly uploads: Uploads,
    private readonly storage: Storage,
  ) {}

  @Perm('archive:read')
  @Get('composers')
  composers(@Ctx() ctx: RequestContext) {
    return this.db.tenant(ctx.tenantId, (tx) =>
      tx.composer.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { works: true } } } }),
    );
  }

  @Perm('archive:write')
  @Post('composers')
  createComposer(@Ctx() ctx: RequestContext, @Body(zod(composerSchema)) body: z.infer<typeof composerSchema>) {
    return this.db.tenant(ctx.tenantId, (tx) => tx.composer.create({ data: { ...body, tenantId: ctx.tenantId } }));
  }

  @Perm('archive:write')
  @Patch('composers/:id')
  updateComposer(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(composerSchema.partial())) body: Partial<z.infer<typeof composerSchema>>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.composer.findUnique({ where: { id } }), 'Compositor');
      return tx.composer.update({ where: { id }, data: body });
    });
  }

  /** Búsqueda: texto completo en español (sin tildes) con fallback por prefijo en el título. */
  @Perm('archive:read')
  @Get('works')
  works(@Ctx() ctx: RequestContext, @Query(zod(worksQuery)) q: z.infer<typeof worksQuery>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const where: Prisma.WorkWhereInput = {
        composerId: q.composerId,
        genre: q.genre ? { equals: q.genre, mode: 'insensitive' } : undefined,
        tags: q.tag ? { has: q.tag } : undefined,
      };
      let rankedIds: string[] | undefined;
      if (q.q) {
        const rows = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM works
          WHERE search @@ websearch_to_tsquery('spanish', unaccent(${q.q}))
             OR unaccent(title) ILIKE unaccent(${q.q + '%'})
             OR unaccent(title) ILIKE unaccent(${'% ' + q.q + '%'})
          ORDER BY ts_rank(search, websearch_to_tsquery('spanish', unaccent(${q.q}))) DESC, title ASC
          LIMIT 1000`;
        rankedIds = rows.map((r) => r.id);
        where.id = { in: rankedIds };
      }
      const [all, total] = await Promise.all([
        tx.work.findMany({
          where,
          include: { composer: { select: { id: true, name: true } }, _count: { select: { assets: true, versions: true } } },
          orderBy: { title: 'asc' },
          ...(rankedIds ? {} : skipTake(q)),
        }),
        tx.work.count({ where }),
      ]);
      // Con búsqueda conservamos el orden por relevancia y paginamos en memoria (máx. 1000 resultados).
      const data = rankedIds
        ? all.sort((a, b) => rankedIds!.indexOf(a.id) - rankedIds!.indexOf(b.id)).slice(skipTake(q).skip, skipTake(q).skip + q.pageSize)
        : all;
      return page(data, total, q);
    });
  }

  @Perm('archive:read')
  @Get('tags')
  tags(@Ctx() ctx: RequestContext) {
    return this.db.tenant(ctx.tenantId, (tx) =>
      tx.$queryRaw<{ tag: string; count: number }[]>`
        SELECT tag, count(*)::int AS count FROM works, unnest(tags) AS tag GROUP BY tag ORDER BY count DESC, tag ASC LIMIT 200`,
    );
  }

  @Perm('archive:write')
  @Post('works')
  createWork(@Ctx() ctx: RequestContext, @Body(zod(workSchema)) body: z.infer<typeof workSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      if (body.composerId) found(await tx.composer.findUnique({ where: { id: body.composerId } }), 'Compositor');
      const work = await tx.work.create({ data: { ...body, tenantId: ctx.tenantId }, include: { composer: true } });
      await this.audit.log(tx, ctx, 'work.created', 'work', work.id, { title: work.title });
      return work;
    });
  }

  @Perm('archive:read')
  @Get('works/:id')
  getWork(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) =>
      found(
        await tx.work.findUnique({
          where: { id },
          include: {
            composer: true,
            versions: { orderBy: { createdAt: 'asc' } },
            assets: { orderBy: [{ kind: 'asc' }, { instrument: 'asc' }] },
          },
        }),
        'Obra',
      ),
    );
  }

  @Perm('archive:write')
  @Patch('works/:id')
  updateWork(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(workSchema.partial())) body: Partial<z.infer<typeof workSchema>>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.work.findUnique({ where: { id } }), 'Obra');
      if (body.composerId) found(await tx.composer.findUnique({ where: { id: body.composerId } }), 'Compositor');
      const work = await tx.work.update({ where: { id }, data: body, include: { composer: true } });
      await this.audit.log(tx, ctx, 'work.updated', 'work', id, { fields: Object.keys(body) });
      return work;
    });
  }

  @Perm('archive:write')
  @HttpCode(204)
  @Delete('works/:id')
  async deleteWork(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    const assets = await this.db.tenant(ctx.tenantId, async (tx) => {
      const work = found(await tx.work.findUnique({ where: { id }, include: { assets: true } }), 'Obra');
      await tx.work.delete({ where: { id } });
      await this.audit.log(tx, ctx, 'work.deleted', 'work', id, { title: work.title });
      return work.assets;
    });
    await Promise.all(assets.map((a) => this.uploads.discard(ctx.tenantId, a.fileKey, a.sizeBytes)));
  }

  @Perm('archive:write')
  @Post('works/:id/versions')
  createVersion(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(versionSchema)) body: z.infer<typeof versionSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.work.findUnique({ where: { id } }), 'Obra');
      return tx.workVersion.create({ data: { ...body, workId: id, tenantId: ctx.tenantId } });
    });
  }

  @Perm('archive:write')
  @Post('works/:id/assets/upload-url')
  async assetUploadUrl(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(uploadRequest)) body: z.infer<typeof uploadRequest>) {
    await this.db.tenant(ctx.tenantId, async (tx) => found(await tx.work.findUnique({ where: { id } }), 'Obra'));
    return this.uploads.request(ctx.tenantId, 'archive', body, ASSET_MIME);
  }

  @Perm('archive:write')
  @Post('works/:id/assets')
  async createAsset(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(assetSchema)) body: z.infer<typeof assetSchema>) {
    await this.db.tenant(ctx.tenantId, async (tx) => found(await tx.work.findUnique({ where: { id } }), 'Obra'));
    const size = await this.uploads.confirm(ctx.tenantId, 'archive', body, ASSET_MIME);
    try {
      return await this.db.tenant(ctx.tenantId, async (tx) => {
        if (body.versionId) found(await tx.workVersion.findFirst({ where: { id: body.versionId, workId: id } }), 'Versión');
        const asset = await tx.asset.create({ data: { ...body, sizeBytes: size, workId: id, tenantId: ctx.tenantId, uploadedById: ctx.userId } });
        await this.audit.log(tx, ctx, 'asset.created', 'asset', asset.id, { workId: id, kind: body.kind });
        return asset;
      });
    } catch (e) {
      await this.uploads.discard(ctx.tenantId, body.fileKey, size);
      throw e;
    }
  }

  @Perm('archive:read')
  @Get('assets/:id/download')
  downloadAsset(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const asset = found(await tx.asset.findUnique({ where: { id } }), 'Archivo');
      return { url: await this.storage.downloadUrl(asset.fileKey, asset.fileName) };
    });
  }

  @Perm('archive:write')
  @HttpCode(204)
  @Delete('assets/:id')
  async deleteAsset(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    const asset = await this.db.tenant(ctx.tenantId, async (tx) => {
      const asset = found(await tx.asset.findUnique({ where: { id } }), 'Archivo');
      await tx.asset.delete({ where: { id } });
      await this.audit.log(tx, ctx, 'asset.deleted', 'asset', id);
      return asset;
    });
    await this.uploads.discard(ctx.tenantId, asset.fileKey, asset.sizeBytes);
  }
}
