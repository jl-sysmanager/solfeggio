import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, Perm, RequireFeature } from '../auth/decorators';
import { found } from '../common/errors';
import { idParam } from '../common/schemas';
import { zod } from '../common/zod.pipe';
import { Db } from '../db/db.service';
import { Audit } from '../audit/audit.service';
import { Jobs } from '../jobs/jobs.service';
import { MIME_GROUPS, Storage } from '../storage/storage.service';
import { uploadConfirm, uploadRequest, Uploads } from '../storage/upload';

export const audienceSchema = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ sectionIds: z.array(z.string().uuid()).min(1).max(50) }),
  z.object({ memberIds: z.array(z.string().uuid()).min(1).max(1000) }),
]);
export type Audience = z.infer<typeof audienceSchema>;

export async function resolveAudience(tx: Prisma.TransactionClient, audience: Audience) {
  const where: Prisma.MemberWhereInput = { status: 'ACTIVE' };
  if ('sectionIds' in audience) where.sectionId = { in: audience.sectionIds };
  if ('memberIds' in audience) where.id = { in: audience.memberIds };
  return tx.member.findMany({ where, select: { id: true, email: true } });
}

const communicationSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20_000),
  channel: z.enum(['EMAIL', 'IN_APP']).default('IN_APP'),
  audience: audienceSchema,
});
const documentSchema = uploadConfirm.extend({
  title: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(60),
  memberId: z.string().uuid().optional(),
});

@ApiTags('secretary')
@ApiBearerAuth()
@Controller()
export class SecretaryController {
  constructor(
    private readonly db: Db,
    private readonly audit: Audit,
    private readonly jobs: Jobs,
    private readonly uploads: Uploads,
    private readonly storage: Storage,
  ) {}

  @RequireFeature('communications')
  @Perm('communications:send')
  @Get('communications')
  communications(@Ctx() ctx: RequestContext) {
    return this.db.tenant(ctx.tenantId, (tx) => tx.communication.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }));
  }

  @RequireFeature('communications')
  @Perm('communications:send')
  @Post('communications')
  async send(@Ctx() ctx: RequestContext, @Body(zod(communicationSchema)) body: z.infer<typeof communicationSchema>) {
    const { comm, recipients } = await this.db.tenant(ctx.tenantId, async (tx) => {
      const recipients = await resolveAudience(tx, body.audience);
      const comm = await tx.communication.create({
        data: { ...body, audience: body.audience, tenantId: ctx.tenantId, createdById: ctx.userId, recipients: recipients.length, sentAt: new Date() },
      });
      await this.audit.log(tx, ctx, 'communication.sent', 'communication', comm.id, { recipients: recipients.length, channel: body.channel });
      return { comm, recipients };
    });
    await this.jobs.add('notify.fanout', {
      tenantId: ctx.tenantId,
      memberIds: recipients.map((r) => r.id),
      type: 'communication',
      title: body.subject,
      body: body.body,
      link: `/communications`,
      email: body.channel === 'EMAIL',
    });
    return comm;
  }

  @Perm('documents:read')
  @Get('documents')
  documents(@Ctx() ctx: RequestContext, @Query('category') category?: string) {
    return this.db.tenant(ctx.tenantId, (tx) =>
      tx.document.findMany({ where: { category: category?.slice(0, 60) || undefined }, orderBy: { createdAt: 'desc' } }),
    );
  }

  @Perm('documents:write')
  @Post('documents/upload-url')
  uploadUrl(@Ctx() ctx: RequestContext, @Body(zod(uploadRequest)) body: z.infer<typeof uploadRequest>) {
    return this.uploads.request(ctx.tenantId, 'documents', body, MIME_GROUPS.document);
  }

  @Perm('documents:write')
  @Post('documents')
  async createDocument(@Ctx() ctx: RequestContext, @Body(zod(documentSchema)) body: z.infer<typeof documentSchema>) {
    const size = await this.uploads.confirm(ctx.tenantId, 'documents', body, MIME_GROUPS.document);
    try {
      return await this.db.tenant(ctx.tenantId, async (tx) => {
        if (body.memberId) found(await tx.member.findUnique({ where: { id: body.memberId } }), 'Socio');
        const doc = await tx.document.create({ data: { ...body, sizeBytes: size, tenantId: ctx.tenantId, uploadedById: ctx.userId } });
        await this.audit.log(tx, ctx, 'document.created', 'document', doc.id, { title: body.title });
        return doc;
      });
    } catch (e) {
      await this.uploads.discard(ctx.tenantId, body.fileKey, size);
      throw e;
    }
  }

  @Perm('documents:read')
  @Get('documents/:id/download')
  download(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const doc = found(await tx.document.findUnique({ where: { id } }), 'Documento');
      return { url: await this.storage.downloadUrl(doc.fileKey, doc.fileName) };
    });
  }

  @Perm('documents:write')
  @HttpCode(204)
  @Delete('documents/:id')
  async deleteDocument(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    const doc = await this.db.tenant(ctx.tenantId, async (tx) => {
      const doc = found(await tx.document.findUnique({ where: { id } }), 'Documento');
      await tx.document.delete({ where: { id } });
      await this.audit.log(tx, ctx, 'document.deleted', 'document', id, { title: doc.title });
      return doc;
    });
    await this.uploads.discard(ctx.tenantId, doc.fileKey, doc.sizeBytes);
  }
}
