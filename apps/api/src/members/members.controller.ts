import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Member, Prisma } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, Perm, RequireFeature } from '../auth/decorators';
import { decrypt, encrypt } from '../common/crypto';
import { found } from '../common/errors';
import { page, pageQuery, skipTake } from '../common/pagination';
import { idParam, isoDate, optionalText, toDate } from '../common/schemas';
import { zod } from '../common/zod.pipe';
import { Db, Tx } from '../db/db.service';
import { Audit } from '../audit/audit.service';
import { logoFileName, readLogo } from '../platform/logo';
import { Storage } from '../storage/storage.service';
import { LimitsService } from '../tenancy/limits.service';

const memberFields = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(120),
  email: z.string().email().max(254).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  birthDate: isoDate.nullable().optional(),
  nationalId: z.string().trim().max(20).nullable().optional(),
  address: optionalText(300),
  instrument: z.string().trim().max(60).nullable().optional(),
  secondaryInstrument: z.string().trim().max(60).nullable().optional(),
  sectionId: z.string().uuid().nullable().optional(),
  joinedAt: isoDate.optional(),
  consentData: z.boolean().optional(),
  consentDataAt: z.string().datetime({ offset: true }).nullable().optional(),
  consentImages: z.boolean().optional(),
  notes: optionalText(2000),
});
/** Los formularios envían '' en campos vacíos: se tratan como null. */
const blankToNull = (v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, typeof x === 'string' && x.trim() === '' ? null : x]))
    : v;
const distinctInstruments = (b: { instrument?: string | null; secondaryInstrument?: string | null }) =>
  !b.instrument || !b.secondaryInstrument || b.instrument !== b.secondaryInstrument;
const memberBase = z.preprocess(blankToNull, memberFields).refine(distinctInstruments, {
  message: 'El instrumento secundario debe ser distinto del principal',
  path: ['secondaryInstrument'],
});
const memberPatch = z.preprocess(blankToNull, memberFields.partial()).refine(distinctInstruments, {
  message: 'El instrumento secundario debe ser distinto del principal',
  path: ['secondaryInstrument'],
});
const listQuery = pageQuery.extend({
  // Los selectores de socios cargan la plantilla activa entera en una sola página.
  pageSize: z.coerce.number().int().min(1).max(1000).default(25),
  q: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'LEFT']).optional(),
  sectionId: z.string().uuid().optional(),
  /** all = todos los socios; users = con acceso a la app; members_only = ficha sin usuario. */
  access: z.enum(['all', 'users', 'members_only']).default('all'),
});
const leaveSchema = z.object({ date: isoDate, reason: z.string().trim().max(500).optional() });
const sizesSchema = z.array(z.object({ garment: z.string().trim().min(1).max(60), size: z.string().trim().min(1).max(20) })).max(30);
const sectionSchema = z.object({ name: z.string().trim().min(1).max(60), position: z.number().int().min(0).max(999).optional() });

const membershipAccessSelect = {
  id: true,
  status: true,
  role: { select: { id: true, key: true, name: true } },
  user: { select: { id: true, name: true, email: true, mfaEnabled: true } },
} as const;

type MemberWithSection = Member & {
  section?: { id: string; name: string } | null;
  membership?: {
    id: string;
    status: string;
    role: { id: string; key: string; name: string };
    user: { id: string; name: string; email: string; mfaEnabled: boolean };
  } | null;
};

/** Nunca devolvemos las columnas cifradas ni las claves S3; los datos sensibles sólo con permiso explícito. */
export function serializeMember(m: MemberWithSection, ctx: RequestContext) {
  const { nationalIdEnc, photoKey, photoMime: _mime, membership, ...rest } = m;
  const sensitive = ctx.permissions.has('members:sensitive');
  return {
    ...rest,
    nationalId: sensitive ? decrypt(nationalIdEnc) : undefined,
    hasNationalId: !!nationalIdEnc,
    hasPhoto: !!photoKey,
    access: membership
      ? { kind: 'user' as const, membershipId: membership.id, status: membership.status, role: membership.role, user: membership.user }
      : { kind: 'member_only' as const },
    _photoKey: photoKey,
  };
}

async function withPhotoUrl<T extends { _photoKey?: string | null; hasPhoto: boolean }>(row: T, storage: Storage) {
  const { _photoKey, ...rest } = row;
  return { ...rest, photoUrl: _photoKey ? await storage.viewUrl(_photoKey) : null };
}

function toData(body: z.infer<typeof memberPatch>): Prisma.MemberUncheckedUpdateInput {
  const { nationalId, birthDate, joinedAt, consentData, consentDataAt, ...rest } = body;
  return {
    ...rest,
    ...(nationalId !== undefined && { nationalIdEnc: encrypt(nationalId) }),
    ...(birthDate !== undefined && { birthDate: birthDate ? toDate(birthDate) : null }),
    ...(joinedAt !== undefined && { joinedAt: toDate(joinedAt) }),
    ...(consentData !== undefined && { consentDataAt: consentData ? new Date() : null }),
    ...(consentDataAt !== undefined && { consentDataAt: consentDataAt ? new Date(consentDataAt) : null }),
  };
}

/** Campos que se registran en auditoría sin valores (para no copiar datos personales). */
const changedFields = (body: object) => ({ fields: Object.keys(body) });

@ApiTags('members')
@ApiBearerAuth()
@RequireFeature('members')
@Controller()
export class MembersController {
  constructor(
    private readonly db: Db,
    private readonly audit: Audit,
    private readonly limits: LimitsService,
    private readonly storage: Storage,
  ) {}

  @Perm('members:read')
  @Get('members')
  list(@Ctx() ctx: RequestContext, @Query(zod(listQuery)) q: z.infer<typeof listQuery>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const where: Prisma.MemberWhereInput = { status: q.status, sectionId: q.sectionId };
      if (q.access === 'users') where.membership = { isNot: null };
      if (q.access === 'members_only') where.membership = { is: null };
      if (q.q) {
        // Búsqueda sin distinguir tildes ni mayúsculas («garcia» encuentra «García»).
        const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        const rows = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM members
          WHERE unaccent("firstName" || ' ' || "lastName" || ' ' || coalesce(email, '') || ' ' || coalesce(instrument, '')) ILIKE unaccent(${like})
             OR "memberNumber"::text = ${q.q}`;
        where.id = { in: rows.map((r) => r.id) };
      }
      const include = { section: { select: { id: true, name: true } }, membership: { select: membershipAccessSelect } };
      const [data, total] = await Promise.all([
        tx.member.findMany({ where, include, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], ...skipTake(q) }),
        tx.member.count({ where }),
      ]);
      const rows = await Promise.all(data.map((m) => withPhotoUrl(serializeMember(m, ctx), this.storage)));
      return page(rows, total, q);
    });
  }

  @Perm('members:write')
  @Post('members')
  create(@Ctx() ctx: RequestContext, @Body(zod(memberBase)) body: z.infer<typeof memberBase>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      await this.limits.assertCanAddMember(tx, ctx.tenantId);
      const last = await tx.member.aggregate({ _max: { memberNumber: true } });
      const member = await tx.member.create({
        data: { ...(toData(body) as Prisma.MemberUncheckedCreateInput), joinedAt: body.joinedAt ? toDate(body.joinedAt) : undefined, tenantId: ctx.tenantId, memberNumber: (last._max.memberNumber ?? 0) + 1 },
        include: { section: { select: { id: true, name: true } } },
      });
      await this.audit.log(tx, ctx, 'member.created', 'member', member.id, changedFields(body));
      return withPhotoUrl(serializeMember(member, ctx), this.storage);
    });
  }

  @Perm('members:read')
  @Get('members/:id')
  get(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const m = found(
        await tx.member.findUnique({
          where: { id },
          include: {
            section: { select: { id: true, name: true } },
            membership: { select: membershipAccessSelect },
            sizes: true,
            uniformLoans: { where: { returnedAt: null }, include: { item: true } },
            instrumentLoans: { where: { endAt: null }, include: { instrument: true } },
          },
        }),
        'Socio',
      );
      const attendance = await tx.attendance.groupBy({ by: ['status'], where: { memberId: id }, _count: true });
      const pendingInvite = m.membership
        ? null
        : await tx.invitation.findFirst({
            where: { memberId: id, acceptedAt: null, expiresAt: { gt: new Date() } },
            select: { id: true, email: true, roleId: true, expiresAt: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
          });
      return {
        ...(await withPhotoUrl(serializeMember(m, ctx), this.storage)),
        attendanceSummary: Object.fromEntries(attendance.map((a) => [a.status, a._count])),
        pendingInvite,
      };
    });
  }

  @Perm('members:write')
  @Patch('members/:id')
  update(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(memberPatch)) body: z.infer<typeof memberPatch>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const m = found(await tx.member.findUnique({ where: { id } }), 'Socio');
      if (m.anonymizedAt) throw new BadRequestException({ message: 'El socio está anonimizado', code: 'ANONYMIZED' });
      if (body.nationalId !== undefined && !ctx.permissions.has('members:sensitive')) {
        throw new BadRequestException({ message: 'No puedes modificar datos sensibles', code: 'FORBIDDEN' });
      }
      const instrument = body.instrument !== undefined ? body.instrument : m.instrument;
      const secondary = body.secondaryInstrument !== undefined ? body.secondaryInstrument : m.secondaryInstrument;
      if (instrument && secondary && instrument === secondary) {
        throw new BadRequestException({ message: 'El instrumento secundario debe ser distinto del principal', code: 'SAME_INSTRUMENT' });
      }
      const updated = await tx.member.update({
        where: { id },
        data: toData(body),
        include: { section: { select: { id: true, name: true } }, membership: { select: membershipAccessSelect } },
      });
      await this.audit.log(tx, ctx, 'member.updated', 'member', id, changedFields(body));
      return withPhotoUrl(serializeMember(updated, ctx), this.storage);
    });
  }

  @Perm('members:write')
  @Post('members/:id/leave')
  leave(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(leaveSchema)) body: z.infer<typeof leaveSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.member.findUnique({ where: { id } }), 'Socio');
      const m = await tx.member.update({
        where: { id },
        data: { status: 'LEFT', leftAt: toDate(body.date), leaveReason: body.reason },
        include: { membership: { select: membershipAccessSelect } },
      });
      await this.audit.log(tx, ctx, 'member.left', 'member', id, { date: body.date });
      return withPhotoUrl(serializeMember(m, ctx), this.storage);
    });
  }

  @Perm('members:write')
  @Post('members/:id/rejoin')
  rejoin(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const existing = found(await tx.member.findUnique({ where: { id } }), 'Socio');
      if (existing.anonymizedAt) throw new BadRequestException({ message: 'El socio está anonimizado', code: 'ANONYMIZED' });
      await this.limits.assertCanAddMember(tx, ctx.tenantId);
      const m = await tx.member.update({
        where: { id },
        data: { status: 'ACTIVE', leftAt: null, leaveReason: null, joinedAt: new Date() },
        include: { membership: { select: membershipAccessSelect } },
      });
      await this.audit.log(tx, ctx, 'member.rejoined', 'member', id);
      return withPhotoUrl(serializeMember(m, ctx), this.storage);
    });
  }

  /** Foto de perfil: quien gestiona socios o el propio usuario vinculado. */
  @Post('members/:id/photo')
  async photoSave(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Req() req: Request) {
    this.assertCanEditPhoto(ctx, id);
    const { buf, mime } = await readLogo(req);
    const fileKey = this.storage.newKey(ctx.tenantId, 'members/photos', logoFileName(mime));
    await this.storage.putObject(fileKey, buf, mime);
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const prev = found(await tx.member.findUnique({ where: { id }, select: { id: true, photoKey: true, anonymizedAt: true } }), 'Socio');
      if (prev.anonymizedAt) throw new BadRequestException({ message: 'El socio está anonimizado', code: 'ANONYMIZED' });
      const updated = await tx.member.update({
        where: { id },
        data: { photoKey: fileKey, photoMime: mime },
        include: { section: { select: { id: true, name: true } }, membership: { select: membershipAccessSelect } },
      });
      await this.audit.log(tx, ctx, 'member.photo', 'member', id);
      if (prev.photoKey && prev.photoKey !== fileKey) await this.storage.remove(prev.photoKey);
      return withPhotoUrl(serializeMember(updated, ctx), this.storage);
    });
  }

  @HttpCode(204)
  @Delete('members/:id/photo')
  async photoRemove(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    this.assertCanEditPhoto(ctx, id);
    await this.db.tenant(ctx.tenantId, async (tx) => {
      const prev = found(await tx.member.findUnique({ where: { id }, select: { id: true, photoKey: true } }), 'Socio');
      await tx.member.update({ where: { id }, data: { photoKey: null, photoMime: null } });
      await this.audit.log(tx, ctx, 'member.photo_removed', 'member', id);
      if (prev.photoKey) await this.storage.remove(prev.photoKey);
    });
  }

  private assertCanEditPhoto(ctx: RequestContext, memberId: string) {
    if (ctx.permissions.has('members:write') || ctx.memberId === memberId) return;
    throw new ForbiddenException({ message: 'No puedes cambiar esta foto', code: 'FORBIDDEN' });
  }

  @Perm('members:write')
  @Put('members/:id/sizes')
  sizes(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(sizesSchema)) body: z.infer<typeof sizesSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.member.findUnique({ where: { id } }), 'Socio');
      await tx.memberSize.deleteMany({ where: { memberId: id } });
      await tx.memberSize.createMany({ data: body.map((s) => ({ ...s, memberId: id, tenantId: ctx.tenantId })) });
      return tx.memberSize.findMany({ where: { memberId: id }, orderBy: { garment: 'asc' } });
    });
  }

  /** RGPD art. 15 y 20: copia de todos los datos del socio en formato estructurado. */
  @Perm('members:write', 'members:sensitive')
  @Get('members/:id/export')
  export(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const m = found(
        await tx.member.findUnique({
          where: { id },
          include: { section: true, sizes: true, calls: true, attendance: true, feeCharges: true, uniformLoans: true, instrumentLoans: true },
        }),
        'Socio',
      );
      const [transactions, documents] = await Promise.all([
        tx.transaction.findMany({ where: { memberId: id } }),
        tx.document.findMany({ where: { memberId: id }, select: { id: true, title: true, category: true, fileName: true, createdAt: true } }),
      ]);
      await this.audit.log(tx, ctx, 'member.exported', 'member', id);
      return { exportedAt: new Date().toISOString(), member: serializeMember(m, ctx), transactions, documents };
    });
  }

  /**
   * RGPD art. 17: anonimiza los datos personales. Se conservan los registros contables y de asistencia
   * vinculados (obligación legal / interés legítimo) sin datos identificativos.
   */
  @Perm('members:write', 'members:sensitive')
  @HttpCode(200)
  @Post('members/:id/anonymize')
  anonymize(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const m = found(await tx.member.findUnique({ where: { id } }), 'Socio');
      await tx.memberSize.deleteMany({ where: { memberId: id } });
      await tx.membership.updateMany({ where: { memberId: id }, data: { memberId: null } });
      const prevPhoto = m.photoKey;
      const updated = await tx.member.update({
        where: { id },
        data: {
          firstName: 'Socio', lastName: `anonimizado #${m.memberNumber}`, email: null, phone: null, birthDate: null,
          nationalIdEnc: null, address: null, notes: null, leaveReason: null, consentDataAt: null,
          consentImages: false, photoKey: null, photoMime: null, status: 'LEFT', leftAt: m.leftAt ?? new Date(), anonymizedAt: new Date(),
        },
      });
      await this.audit.log(tx, ctx, 'member.anonymized', 'member', id);
      if (prevPhoto) await this.storage.remove(prevPhoto);
      return withPhotoUrl(serializeMember(updated, ctx), this.storage);
    });
  }

  @Get('sections')
  sections(@Ctx() ctx: RequestContext) {
    return this.db.tenant(ctx.tenantId, (tx) =>
      tx.section.findMany({ orderBy: [{ position: 'asc' }, { name: 'asc' }], include: { _count: { select: { members: { where: { status: 'ACTIVE' } } } } } }),
    );
  }

  @Perm('members:write')
  @Post('sections')
  createSection(@Ctx() ctx: RequestContext, @Body(zod(sectionSchema)) body: z.infer<typeof sectionSchema>) {
    return this.db.tenant(ctx.tenantId, (tx) => tx.section.create({ data: { ...body, tenantId: ctx.tenantId } }));
  }

  @Perm('members:write')
  @Patch('sections/:id')
  updateSection(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(sectionSchema.partial())) body: Partial<z.infer<typeof sectionSchema>>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.section.findUnique({ where: { id } }), 'Sección');
      return tx.section.update({ where: { id }, data: body });
    });
  }

  @Perm('members:write')
  @HttpCode(204)
  @Delete('sections/:id')
  async deleteSection(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    await this.db.tenant(ctx.tenantId, async (tx: Tx) => {
      found(await tx.section.findUnique({ where: { id } }), 'Sección');
      await tx.section.delete({ where: { id } });
    });
  }

  @Get('instrument-catalog')
  instrumentCatalog(@Ctx() ctx: RequestContext) {
    return this.db.tenant(ctx.tenantId, (tx) =>
      tx.instrumentCatalogItem.findMany({ orderBy: [{ position: 'asc' }, { name: 'asc' }] }),
    );
  }

  @Perm('members:write')
  @Post('instrument-catalog')
  createInstrumentCatalogItem(@Ctx() ctx: RequestContext, @Body(zod(sectionSchema)) body: z.infer<typeof sectionSchema>) {
    return this.db.tenant(ctx.tenantId, (tx) => tx.instrumentCatalogItem.create({ data: { ...body, tenantId: ctx.tenantId } }));
  }

  @Perm('members:write')
  @Patch('instrument-catalog/:id')
  updateInstrumentCatalogItem(
    @Ctx() ctx: RequestContext,
    @Param('id', zod(idParam)) id: string,
    @Body(zod(sectionSchema.partial())) body: Partial<z.infer<typeof sectionSchema>>,
  ) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.instrumentCatalogItem.findUnique({ where: { id } }), 'Instrumento');
      return tx.instrumentCatalogItem.update({ where: { id }, data: body });
    });
  }

  @Perm('members:write')
  @HttpCode(204)
  @Delete('instrument-catalog/:id')
  async deleteInstrumentCatalogItem(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    await this.db.tenant(ctx.tenantId, async (tx: Tx) => {
      found(await tx.instrumentCatalogItem.findUnique({ where: { id } }), 'Instrumento');
      await tx.instrumentCatalogItem.delete({ where: { id } });
    });
  }
}
