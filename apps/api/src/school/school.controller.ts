import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, Perm, RequireFeature } from '../auth/decorators';
import { encrypt, randomToken, sha256 } from '../common/crypto';
import { found } from '../common/errors';
import { page, pageQuery, skipTake } from '../common/pagination';
import { cents, idParam, isoDate, isoDateTime, optionalText, text, toDate } from '../common/schemas';
import { zod } from '../common/zod.pipe';
import { env } from '../config/env';
import { Db, Tx } from '../db/db.service';
import { Audit } from '../audit/audit.service';
import { Jobs } from '../jobs/jobs.service';
import { LimitsService } from '../tenancy/limits.service';
import {
  assertCanTeachGroup, assertNoSlotConflict, blankToNull, dayKey, enroll, escapeLike, familyUserIds, isoWeekday,
  serializeFamily, serializeGuardian, withdraw, yearConflicts,
} from './school.helpers';

const pct = z.number().int().min(0).max(100);
const name80 = z.string().trim().min(1).max(80);
const email = z.string().email().max(254).nullable().optional();
const phone = z.string().trim().max(30).nullable().optional();
const minute = z.number().int().min(0).max(1440);

const settingsSchema = z.object({
  siblingDiscountPct: pct.optional(),
  memberDiscountPct: pct.optional(),
  multiSubjectDiscountPct: pct.optional(),
  publicIntro: optionalText(4000),
});
const familyFields = z.object({ name: text(120), notes: optionalText(2000) });
const familyBase = z.preprocess(blankToNull, familyFields);
const familyPatch = z.preprocess(blankToNull, familyFields.partial());
const guardianFields = z.object({
  firstName: name80,
  lastName: z.string().trim().min(1).max(120),
  relationship: z.string().trim().max(40).nullable().optional(),
  email,
  phone,
  nationalId: z.string().trim().max(20).nullable().optional(),
  memberId: z.string().uuid().nullable().optional(),
});
const guardianBase = z.preprocess(blankToNull, guardianFields);
const guardianPatch = z.preprocess(blankToNull, guardianFields.partial());
const studentStatus = z.enum(['ACTIVE', 'INACTIVE', 'LEFT']);
const studentFields = z.object({
  familyId: z.string().uuid().nullable().optional(),
  firstName: name80,
  lastName: z.string().trim().min(1).max(120),
  birthDate: isoDate.nullable().optional(),
  email,
  phone,
  instrument: z.string().trim().max(60).nullable().optional(),
  imageConsent: z.boolean().optional(),
  pickupAuthorized: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
  status: studentStatus.optional(),
  notes: optionalText(2000),
});
const studentBase = z.preprocess(blankToNull, studentFields);
const studentPatch = z.preprocess(blankToNull, studentFields.partial());
const studentsQuery = pageQuery.extend({
  q: z.string().trim().max(100).optional(),
  status: studentStatus.optional(),
  familyId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
});
const familiesQuery = z.object({ q: z.string().trim().max(100).optional() });
const yearFields = z.object({
  name: text(40),
  startsOn: isoDate,
  endsOn: isoDate,
  holidays: z.array(isoDate).max(366).optional(),
  enrollmentOpen: z.boolean().optional(),
  isCurrent: z.boolean().optional(),
});
const yearBase = yearFields.refine((y) => y.endsOn >= y.startsOn, { message: 'La fecha de fin debe ser posterior al inicio', path: ['endsOn'] });
const copyFromSchema = z.object({ sourceYearId: z.string().uuid(), renewEnrollments: z.boolean().default(true) });
const subjectFields = z.object({ name: name80, kind: z.enum(['INSTRUMENT', 'THEORY', 'ENSEMBLE', 'OTHER']), monthlyFeeCents: cents.optional(), active: z.boolean().optional() });
const teacherFields = z.object({
  firstName: name80,
  lastName: z.string().trim().min(1).max(120),
  email,
  phone,
  userId: z.string().uuid().nullable().optional(),
  memberId: z.string().uuid().nullable().optional(),
  active: z.boolean().optional(),
});
const teacherBase = z.preprocess(blankToNull, teacherFields);
const teacherPatch = z.preprocess(blankToNull, teacherFields.partial());
const roomFields = z.object({ name: z.string().trim().min(1).max(60), capacity: z.number().int().min(1).max(1000).nullable().optional() });
const groupFields = z.object({
  yearId: z.string().uuid(),
  subjectId: z.string().uuid(),
  name: name80,
  level: z.string().trim().max(40).nullable().optional(),
  teacherId: z.string().uuid().nullable().optional(),
  capacity: z.number().int().min(1).max(500).nullable().optional(),
  monthlyFeeCents: cents.nullable().optional(),
});
const groupBase = z.preprocess(blankToNull, groupFields);
const groupPatch = z.preprocess(blankToNull, groupFields.omit({ yearId: true }).partial());
const groupsQuery = z.object({ yearId: z.string().uuid().optional(), mine: z.enum(['true', 'false']).optional() });
const slotFields = z.object({ weekday: z.number().int().min(1).max(7), startMin: minute, endMin: minute, roomId: z.string().uuid().nullable().optional(), force: z.boolean().optional() });
const slotBase = slotFields.refine((s) => s.endMin > s.startMin, { message: 'La hora de fin debe ser posterior al inicio', path: ['endMin'] });
const enrollSchema = z.object({ studentId: z.string().uuid(), groupId: z.string().uuid() });
const applicationsQuery = z.object({ yearId: z.string().uuid().optional(), status: z.enum(['PENDING', 'ACCEPTED', 'WAITLISTED', 'REJECTED']).optional() });
const applicationPatch = z.preprocess(
  blankToNull,
  z.object({ auditionAt: isoDateTime.nullable().optional(), auditionResult: z.string().trim().max(500).nullable().optional(), notes: optionalText(2000) }),
);
const acceptSchema = z.object({ familyId: z.string().uuid().optional(), studentId: z.string().uuid().optional(), groupIds: z.array(z.string().uuid()).max(10).default([]) });
const rangeSchema = z.object({ from: isoDate, to: isoDate }).refine((r) => r.to >= r.from, { message: 'Rango no válido', path: ['to'] });
const sessionsQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() });
const cancelSchema = z.object({ notes: optionalText(500) });
const makeUpSchema = z
  .object({ date: isoDate, startMin: minute, endMin: minute, notes: optionalText(500) })
  .refine((s) => s.endMin > s.startMin, { message: 'La hora de fin debe ser posterior al inicio', path: ['endMin'] });
const attendanceSchema = z
  .array(z.object({ studentId: z.string().uuid(), status: z.enum(['PRESENT', 'LATE', 'ABSENT', 'EXCUSED']), note: optionalText(300) }))
  .max(200);
const gradesSchema = z.object({
  term: z.number().int().min(1).max(4),
  grades: z
    .array(
      z.object({
        enrollmentId: z.string().uuid(),
        scoreTenths: z.number().int().min(0).max(100).nullable().optional(),
        qualitative: z.string().trim().max(60).nullable().optional(),
        comment: optionalText(1000),
      }),
    )
    .max(200),
});
const gradesQuery = z.object({ term: z.coerce.number().int().min(1).max(4).optional() });
const promoteSchema = z.object({ stage: z.enum(['EDUCANDO', 'MUSICIAN']), sectionId: z.string().uuid().nullable().optional() });
const noticeSchema = z.object({ groupId: z.string().uuid().nullable().optional(), title: text(150), body: text(5000) });
const noticesQuery = z.object({ groupId: z.string().uuid().optional() });
const reportQuery = z.object({ yearId: z.string().uuid().optional() });

const changedFields = (body: object) => ({ fields: Object.keys(body) });
const groupInclude = {
  subject: true,
  teacher: { select: { id: true, firstName: true, lastName: true, userId: true } },
  slots: { include: { room: { select: { id: true, name: true } } }, orderBy: [{ weekday: 'asc' }, { startMin: 'asc' }] },
  _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
} satisfies Prisma.ClassGroupInclude;

function splitName(full: string) {
  const parts = full.trim().split(/\s+/);
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') || '-' };
}

@ApiTags('school')
@ApiBearerAuth()
@RequireFeature('school')
@Controller('school')
export class SchoolController {
  constructor(
    private readonly db: Db,
    private readonly audit: Audit,
    private readonly limits: LimitsService,
    private readonly jobs: Jobs,
  ) {}

  // ── Configuración ──────────────────────────────────────────────────────────

  @Perm('school:read')
  @Get('settings')
  settings(@Ctx() ctx: RequestContext) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const s = await tx.schoolSettings.findUnique({ where: { tenantId: ctx.tenantId } });
      const tenant = await tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { slug: true } });
      return { siblingDiscountPct: 0, memberDiscountPct: 0, multiSubjectDiscountPct: 0, publicIntro: null, ...s, slug: tenant?.slug };
    });
  }

  @Perm('school:write')
  @Put('settings')
  updateSettings(@Ctx() ctx: RequestContext, @Body(zod(settingsSchema)) body: z.infer<typeof settingsSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const s = await tx.schoolSettings.upsert({ where: { tenantId: ctx.tenantId }, create: { ...body, tenantId: ctx.tenantId }, update: body });
      await this.audit.log(tx, ctx, 'school.settings_updated', 'school_settings', s.id, changedFields(body));
      return s;
    });
  }

  // ── Familias y tutores ─────────────────────────────────────────────────────

  @Perm('school:write')
  @Get('families')
  families(@Ctx() ctx: RequestContext, @Query(zod(familiesQuery)) q: z.infer<typeof familiesQuery>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const where: Prisma.FamilyWhereInput = q.q
        ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { guardians: { some: { lastName: { contains: q.q, mode: 'insensitive' } } } }] }
        : {};
      const [families, linked] = await Promise.all([
        tx.family.findMany({
          where,
          include: { guardians: { orderBy: { createdAt: 'asc' } }, students: { select: { id: true, firstName: true, lastName: true, status: true }, orderBy: { birthDate: 'asc' } } },
          orderBy: { name: 'asc' },
          take: 500,
        }),
        tx.membership.findMany({ where: { guardianId: { not: null } }, select: { guardianId: true } }),
      ]);
      const portal = new Set(linked.map((m) => m.guardianId));
      return families.map((f) => ({
        ...serializeFamily(f, ctx),
        guardians: f.guardians.map((g) => ({ ...serializeGuardian(g, ctx), portalAccess: portal.has(g.id) })),
      }));
    });
  }

  @Perm('school:write')
  @Post('families')
  createFamily(@Ctx() ctx: RequestContext, @Body(zod(familyBase)) body: z.infer<typeof familyBase>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const f = await tx.family.create({ data: { ...body, tenantId: ctx.tenantId } });
      await this.audit.log(tx, ctx, 'family.created', 'family', f.id, changedFields(body));
      return serializeFamily(f, ctx);
    });
  }

  @Perm('school:write')
  @Get('families/:id')
  family(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const f = found(
        await tx.family.findUnique({ where: { id }, include: { guardians: { include: { member: { select: { id: true, firstName: true, lastName: true, memberNumber: true } } } }, students: true } }),
        'Familia',
      );
      return { ...serializeFamily(f, ctx), guardians: f.guardians.map((g) => serializeGuardian(g, ctx)) };
    });
  }

  @Perm('school:write')
  @Patch('families/:id')
  updateFamily(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(familyPatch)) body: z.infer<typeof familyPatch>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.family.findUnique({ where: { id } }), 'Familia');
      const f = await tx.family.update({ where: { id }, data: body });
      await this.audit.log(tx, ctx, 'family.updated', 'family', id, changedFields(body));
      return serializeFamily(f, ctx);
    });
  }

  @Perm('school:write')
  @HttpCode(204)
  @Delete('families/:id')
  async deleteFamily(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    await this.db.tenant(ctx.tenantId, async (tx) => {
      const f = found(await tx.family.findUnique({ where: { id }, include: { _count: { select: { students: true } } } }), 'Familia');
      if (f._count.students > 0) throw new BadRequestException({ message: 'La familia tiene alumnos', code: 'FAMILY_IN_USE' });
      await tx.family.delete({ where: { id } });
      await this.audit.log(tx, ctx, 'family.deleted', 'family', id);
    });
  }

  @Perm('school:write')
  @Post('families/:id/guardians')
  createGuardian(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) familyId: string, @Body(zod(guardianBase)) body: z.infer<typeof guardianBase>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.family.findUnique({ where: { id: familyId } }), 'Familia');
      if (body.nationalId && !ctx.permissions.has('members:sensitive')) throw this.sensitiveDenied();
      if (body.memberId) found(await tx.member.findUnique({ where: { id: body.memberId } }), 'Socio');
      const { nationalId, ...rest } = body;
      const g = await tx.guardian.create({ data: { ...rest, email: rest.email?.toLowerCase(), nationalIdEnc: encrypt(nationalId), familyId, tenantId: ctx.tenantId } });
      await this.audit.log(tx, ctx, 'guardian.created', 'guardian', g.id, changedFields(body));
      return serializeGuardian(g, ctx);
    });
  }

  @Perm('school:write')
  @Patch('guardians/:id')
  updateGuardian(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(guardianPatch)) body: z.infer<typeof guardianPatch>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.guardian.findUnique({ where: { id } }), 'Tutor');
      if (body.nationalId !== undefined && !ctx.permissions.has('members:sensitive')) throw this.sensitiveDenied();
      if (body.memberId) found(await tx.member.findUnique({ where: { id: body.memberId } }), 'Socio');
      const { nationalId, ...rest } = body;
      const g = await tx.guardian.update({
        where: { id },
        data: { ...rest, ...(rest.email && { email: rest.email.toLowerCase() }), ...(nationalId !== undefined && { nationalIdEnc: encrypt(nationalId) }) },
      });
      await this.audit.log(tx, ctx, 'guardian.updated', 'guardian', id, changedFields(body));
      return serializeGuardian(g, ctx);
    });
  }

  @Perm('school:write')
  @HttpCode(204)
  @Delete('guardians/:id')
  async deleteGuardian(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    await this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.guardian.findUnique({ where: { id } }), 'Tutor');
      await tx.membership.updateMany({ where: { guardianId: id }, data: { guardianId: null } });
      await tx.invitation.deleteMany({ where: { guardianId: id, acceptedAt: null } });
      await tx.guardian.delete({ where: { id } });
      await this.audit.log(tx, ctx, 'guardian.deleted', 'guardian', id);
    });
  }

  /** Invita al tutor al portal de familias con el rol «Familia». Reenviar sustituye la invitación pendiente. */
  @Perm('school:write')
  @Post('guardians/:id/invite')
  async inviteGuardian(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    const token = randomToken(32);
    const result = await this.db.tenant(ctx.tenantId, async (tx) => {
      const g = found(await tx.guardian.findUnique({ where: { id } }), 'Tutor');
      if (!g.email) throw new BadRequestException({ message: 'El tutor no tiene email', code: 'GUARDIAN_NO_EMAIL' });
      if (await tx.membership.findFirst({ where: { guardianId: id } })) {
        throw new ConflictException({ message: 'El tutor ya tiene acceso al portal', code: 'ALREADY_LINKED' });
      }
      await tx.invitation.deleteMany({ where: { guardianId: id, acceptedAt: null } });
      await this.limits.assertCanAddUser(tx, ctx.tenantId);
      const role = await tx.role.findUnique({ where: { tenantId_key: { tenantId: ctx.tenantId, key: 'family' } } });
      if (!role) throw new BadRequestException({ message: 'No existe el rol Familia', code: 'ROLE_MISSING' });
      const email = g.email.toLowerCase();
      const inv = await tx.invitation.create({
        data: {
          tenantId: ctx.tenantId, email, roleId: role.id, guardianId: id, tokenHash: sha256(token),
          invitedBy: ctx.userId, expiresAt: new Date(Date.now() + 7 * 86_400_000),
        },
      });
      await this.audit.log(tx, ctx, 'invitation.created', 'invitation', inv.id, { guardianId: id, role: role.key });
      return { id: inv.id, email, roleId: role.id, guardianId: id, expiresAt: inv.expiresAt };
    });
    const tenant = await this.db.system.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
    await this.jobs.add('email.send', {
      to: result.email,
      subject: `Invitación a ${tenant.name} en Solfeamos`,
      text: `Te han invitado a unirte a ${tenant.name}.\n\nAcepta la invitación aquí (caduca en 7 días):\n${env().APP_URL}/invite/${token}`,
    });
    return result;
  }

  // ── Alumnos ────────────────────────────────────────────────────────────────

  @Perm('school:read')
  @Get('students')
  students(@Ctx() ctx: RequestContext, @Query(zod(studentsQuery)) q: z.infer<typeof studentsQuery>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const where: Prisma.StudentWhereInput = {
        status: q.status,
        familyId: q.familyId,
        ...(q.groupId && { enrollments: { some: { groupId: q.groupId, status: { not: 'WITHDRAWN' } } } }),
      };
      if (q.q) {
        // Búsqueda sin distinguir tildes ni mayúsculas.
        const rows = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM students
          WHERE unaccent("firstName" || ' ' || "lastName" || ' ' || coalesce(email, '') || ' ' || coalesce(instrument, '')) ILIKE unaccent(${escapeLike(q.q)})`;
        where.id = { in: rows.map((r) => r.id) };
      }
      const [data, total] = await Promise.all([
        tx.student.findMany({
          where,
          include: {
            family: { select: { id: true, name: true } },
            enrollments: { where: { status: { not: 'WITHDRAWN' } }, select: { id: true, status: true, group: { select: { id: true, name: true, yearId: true, subject: { select: { name: true } } } } } },
          },
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
          ...skipTake(q),
        }),
        tx.student.count({ where }),
      ]);
      return page(data, total, q);
    });
  }

  @Perm('school:write')
  @Post('students')
  createStudent(@Ctx() ctx: RequestContext, @Body(zod(studentBase)) body: z.infer<typeof studentBase>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      if (body.status !== 'LEFT') await this.limits.assertCanAddStudent(tx, ctx.tenantId);
      if (body.familyId) found(await tx.family.findUnique({ where: { id: body.familyId } }), 'Familia');
      const { birthDate, ...rest } = body;
      const s = await tx.student.create({ data: { ...rest, birthDate: birthDate ? toDate(birthDate) : null, tenantId: ctx.tenantId } });
      await this.audit.log(tx, ctx, 'student.created', 'student', s.id, changedFields(body));
      return s;
    });
  }

  @Perm('school:read')
  @Get('students/:id')
  student(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const s = found(
        await tx.student.findUnique({
          where: { id },
          include: {
            family: { include: { guardians: true } },
            member: { select: { id: true, memberNumber: true, firstName: true, lastName: true, status: true } },
            enrollments: {
              include: { group: { include: { ...groupInclude, year: { select: { id: true, name: true } } } }, grades: { orderBy: { term: 'asc' } } },
              orderBy: { enrolledAt: 'desc' },
            },
          },
        }),
        'Alumno',
      );
      const attendance = await tx.classAttendance.groupBy({ by: ['status'], where: { studentId: id }, _count: true });
      const charges = ctx.permissions.has('finance:read')
        ? await tx.tuitionCharge.findMany({ where: { studentId: id }, orderBy: { period: 'desc' }, take: 24 })
        : undefined;
      const { family, ...rest } = s;
      return {
        ...rest,
        family: family ? { ...serializeFamily(family, ctx), guardians: family.guardians.map((g) => serializeGuardian(g, ctx)) } : null,
        attendanceSummary: Object.fromEntries(attendance.map((a) => [a.status, a._count])),
        charges,
      };
    });
  }

  @Perm('school:write')
  @Patch('students/:id')
  updateStudent(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(studentPatch)) body: z.infer<typeof studentPatch>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const current = found(await tx.student.findUnique({ where: { id } }), 'Alumno');
      if (current.status === 'LEFT' && body.status && body.status !== 'LEFT') await this.limits.assertCanAddStudent(tx, ctx.tenantId);
      if (body.familyId) found(await tx.family.findUnique({ where: { id: body.familyId } }), 'Familia');
      const { birthDate, ...rest } = body;
      const s = await tx.student.update({ where: { id }, data: { ...rest, ...(birthDate !== undefined && { birthDate: birthDate ? toDate(birthDate) : null }) } });
      if (body.status === 'LEFT' && current.status !== 'LEFT') {
        // La baja libera sus plazas (y promueve la lista de espera).
        const open = await tx.enrollment.findMany({ where: { studentId: id, status: { not: 'WITHDRAWN' } }, select: { id: true } });
        for (const e of open) await withdraw(tx, e.id);
      }
      await this.audit.log(tx, ctx, 'student.updated', 'student', id, changedFields(body));
      return s;
    });
  }

  /** Paso a la banda: crea (o reutiliza) la ficha de socio y fija la etapa. */
  @Perm('school:write', 'members:write')
  @Post('students/:id/promote')
  promote(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(promoteSchema)) body: z.infer<typeof promoteSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const s = found(await tx.student.findUnique({ where: { id } }), 'Alumno');
      let memberId = s.memberId;
      if (!memberId) {
        await this.limits.assertCanAddMember(tx, ctx.tenantId);
        if (body.sectionId) found(await tx.section.findUnique({ where: { id: body.sectionId } }), 'Sección');
        const last = await tx.member.aggregate({ _max: { memberNumber: true } });
        const m = await tx.member.create({
          data: {
            tenantId: ctx.tenantId, memberNumber: (last._max.memberNumber ?? 0) + 1, firstName: s.firstName, lastName: s.lastName,
            birthDate: s.birthDate, email: s.email, phone: s.phone, instrument: s.instrument, sectionId: body.sectionId ?? null,
            consentImages: s.imageConsent,
          },
        });
        memberId = m.id;
        await this.audit.log(tx, ctx, 'member.created', 'member', m.id, { fromStudentId: id });
      }
      const updated = await tx.student.update({ where: { id }, data: { memberId, bandStage: body.stage }, include: { member: { select: { id: true, memberNumber: true, firstName: true, lastName: true } } } });
      await this.audit.log(tx, ctx, 'student.promoted', 'student', id, { stage: body.stage, memberId });
      return updated;
    });
  }

  /** Datos del boletín de notas de un curso. */
  @Perm('school:read')
  @Get('students/:id/report-card')
  reportCard(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Query(zod(reportQuery)) q: z.infer<typeof reportQuery>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const student = found(await tx.student.findUnique({ where: { id }, select: { id: true, firstName: true, lastName: true, birthDate: true, instrument: true } }), 'Alumno');
      const year = q.yearId
        ? found(await tx.schoolYear.findUnique({ where: { id: q.yearId } }), 'Curso')
        : await tx.schoolYear.findFirst({ orderBy: [{ isCurrent: 'desc' }, { startsOn: 'desc' }] });
      const tenant = await tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { name: true } });
      if (!year) return { tenant, year: null, student, subjects: [] };
      return { tenant, year: { id: year.id, name: year.name }, student, subjects: await this.subjectsReport(tx, id, year.id) };
    });
  }

  private async subjectsReport(tx: Tx, studentId: string, yearId: string) {
    const enrollments = await tx.enrollment.findMany({
      where: { studentId, status: { not: 'WAITLIST' }, group: { yearId } },
      include: { group: { include: { subject: true, teacher: { select: { firstName: true, lastName: true } } } }, grades: { orderBy: { term: 'asc' } } },
    });
    const attendance = await tx.classAttendance.groupBy({
      by: ['sessionId', 'status'],
      where: { studentId, session: { groupId: { in: enrollments.map((e) => e.groupId) } } },
      _count: true,
    });
    const sessions = await tx.classSession.findMany({ where: { id: { in: attendance.map((a) => a.sessionId) } }, select: { id: true, groupId: true } });
    const groupOf = new Map(sessions.map((s) => [s.id, s.groupId]));
    return enrollments
      .sort((a, b) => a.group.subject.name.localeCompare(b.group.subject.name, 'es'))
      .map((e) => {
        const summary: Record<string, number> = {};
        for (const a of attendance.filter((x) => groupOf.get(x.sessionId) === e.groupId)) summary[a.status] = (summary[a.status] ?? 0) + a._count;
        return {
          enrollmentId: e.id, groupId: e.groupId, groupName: e.group.name, level: e.group.level, subject: e.group.subject.name, subjectKind: e.group.subject.kind,
          teacher: e.group.teacher ? `${e.group.teacher.firstName} ${e.group.teacher.lastName}` : null, status: e.status,
          grades: e.grades.map(({ term, scoreTenths, qualitative, comment }) => ({ term, scoreTenths, qualitative, comment })),
          attendance: summary,
        };
      });
  }

  // ── Cursos ─────────────────────────────────────────────────────────────────

  @Perm('school:read')
  @Get('years')
  years(@Ctx() ctx: RequestContext) {
    return this.db.tenant(ctx.tenantId, (tx) =>
      tx.schoolYear.findMany({ orderBy: { startsOn: 'desc' }, include: { _count: { select: { groups: true, applications: { where: { status: 'PENDING' } } } } } }),
    );
  }

  @Perm('school:write')
  @Post('years')
  createYear(@Ctx() ctx: RequestContext, @Body(zod(yearBase)) body: z.infer<typeof yearBase>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      if (body.isCurrent) await tx.schoolYear.updateMany({ data: { isCurrent: false } });
      const y = await tx.schoolYear.create({
        data: { ...body, startsOn: toDate(body.startsOn), endsOn: toDate(body.endsOn), holidays: (body.holidays ?? []).map(toDate), tenantId: ctx.tenantId },
      });
      await this.audit.log(tx, ctx, 'school_year.created', 'school_year', y.id, { name: y.name });
      return y;
    });
  }

  @Perm('school:write')
  @Patch('years/:id')
  updateYear(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(yearFields.partial())) body: Partial<z.infer<typeof yearFields>>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const current = found(await tx.schoolYear.findUnique({ where: { id } }), 'Curso');
      const startsOn = body.startsOn ? toDate(body.startsOn) : current.startsOn;
      const endsOn = body.endsOn ? toDate(body.endsOn) : current.endsOn;
      if (endsOn < startsOn) throw new BadRequestException({ message: 'La fecha de fin debe ser posterior al inicio', code: 'VALIDATION_ERROR' });
      if (body.isCurrent) await tx.schoolYear.updateMany({ where: { id: { not: id } }, data: { isCurrent: false } });
      const y = await tx.schoolYear.update({ where: { id }, data: { ...body, startsOn, endsOn, holidays: body.holidays?.map(toDate) } });
      await this.audit.log(tx, ctx, 'school_year.updated', 'school_year', id, changedFields(body));
      return y;
    });
  }

  /** Renovación con un clic: copia grupos y franjas de otro curso y, opcionalmente, rematricula a los alumnos activos. */
  @Perm('school:write')
  @Post('years/:id/copy-from')
  copyFrom(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(copyFromSchema)) body: z.infer<typeof copyFromSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.schoolYear.findUnique({ where: { id } }), 'Curso');
      found(await tx.schoolYear.findUnique({ where: { id: body.sourceYearId } }), 'Curso de origen');
      if (id === body.sourceYearId) throw new BadRequestException({ message: 'Elige otro curso de origen', code: 'SAME_YEAR' });
      const [source, existing] = await Promise.all([
        tx.classGroup.findMany({
          where: { yearId: body.sourceYearId },
          include: { slots: true, enrollments: { where: { status: 'ACTIVE', student: { status: 'ACTIVE' } }, orderBy: { enrolledAt: 'asc' } } },
        }),
        tx.classGroup.findMany({ where: { yearId: id }, select: { subjectId: true, name: true } }),
      ]);
      let groups = 0;
      let enrollments = 0;
      let waitlisted = 0;
      for (const g of source) {
        // Idempotente: no duplica grupos ya copiados (misma asignatura y nombre).
        if (existing.some((e) => e.subjectId === g.subjectId && e.name === g.name)) continue;
        const created = await tx.classGroup.create({
          data: {
            tenantId: ctx.tenantId, yearId: id, subjectId: g.subjectId, name: g.name, level: g.level, teacherId: g.teacherId,
            capacity: g.capacity, monthlyFeeCents: g.monthlyFeeCents,
            slots: { create: g.slots.map((s) => ({ tenantId: ctx.tenantId, weekday: s.weekday, startMin: s.startMin, endMin: s.endMin, roomId: s.roomId })) },
          },
        });
        groups++;
        if (!body.renewEnrollments) continue;
        for (const e of g.enrollments) {
          const n = await enroll(tx, ctx.tenantId, e.studentId, created.id);
          if (n.status === 'ACTIVE') enrollments++;
          else waitlisted++;
        }
      }
      await this.audit.log(tx, ctx, 'school_year.copied', 'school_year', id, { sourceYearId: body.sourceYearId, groups, enrollments, waitlisted });
      return { groups, enrollments, waitlisted };
    });
  }

  @Perm('school:read')
  @Get('years/:id/conflicts')
  conflicts(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.schoolYear.findUnique({ where: { id } }), 'Curso');
      return yearConflicts(tx, id);
    });
  }

  // ── Oferta educativa: asignaturas, profesores y aulas ─────────────────────

  @Perm('school:read')
  @Get('subjects')
  subjects(@Ctx() ctx: RequestContext) {
    return this.db.tenant(ctx.tenantId, (tx) => tx.subject.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] }));
  }

  @Perm('school:write')
  @Post('subjects')
  createSubject(@Ctx() ctx: RequestContext, @Body(zod(subjectFields)) body: z.infer<typeof subjectFields>) {
    return this.db.tenant(ctx.tenantId, (tx) => tx.subject.create({ data: { ...body, tenantId: ctx.tenantId } }));
  }

  @Perm('school:write')
  @Patch('subjects/:id')
  updateSubject(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(subjectFields.partial())) body: Partial<z.infer<typeof subjectFields>>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.subject.findUnique({ where: { id } }), 'Asignatura');
      return tx.subject.update({ where: { id }, data: body });
    });
  }

  @Perm('school:read')
  @Get('teachers')
  teachers(@Ctx() ctx: RequestContext) {
    return this.db.tenant(ctx.tenantId, (tx) =>
      tx.teacher.findMany({ orderBy: [{ active: 'desc' }, { lastName: 'asc' }], include: { _count: { select: { groups: true } } } }),
    );
  }

  @Perm('school:write')
  @Post('teachers')
  createTeacher(@Ctx() ctx: RequestContext, @Body(zod(teacherBase)) body: z.infer<typeof teacherBase>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      await this.checkTeacherLinks(tx, body);
      return tx.teacher.create({ data: { ...body, tenantId: ctx.tenantId } });
    });
  }

  @Perm('school:write')
  @Patch('teachers/:id')
  updateTeacher(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(teacherPatch)) body: z.infer<typeof teacherPatch>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.teacher.findUnique({ where: { id } }), 'Profesor');
      await this.checkTeacherLinks(tx, body);
      return tx.teacher.update({ where: { id }, data: body });
    });
  }

  /** El usuario vinculado debe pertenecer a la banda (users no tiene RLS: se comprueba por la membresía). */
  private async checkTeacherLinks(tx: Tx, body: { userId?: string | null; memberId?: string | null }) {
    if (body.userId) found(await tx.membership.findFirst({ where: { userId: body.userId } }), 'Usuario');
    if (body.memberId) found(await tx.member.findUnique({ where: { id: body.memberId } }), 'Socio');
  }

  /** Usuarios de la banda que se pueden vincular a un profesor. */
  @Perm('school:write')
  @Get('staff-users')
  staffUsers(@Ctx() ctx: RequestContext) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const ms = await tx.membership.findMany({ where: { status: 'ACTIVE', guardianId: null }, select: { userId: true, role: { select: { key: true, name: true } } } });
      const users = await this.db.system.user.findMany({ where: { id: { in: ms.map((m) => m.userId) } }, select: { id: true, name: true, email: true } });
      return users.map((u) => ({ ...u, role: ms.find((m) => m.userId === u.id)?.role })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
    });
  }

  @Perm('school:read')
  @Get('rooms')
  rooms(@Ctx() ctx: RequestContext) {
    return this.db.tenant(ctx.tenantId, (tx) => tx.room.findMany({ orderBy: { name: 'asc' } }));
  }

  @Perm('school:write')
  @Post('rooms')
  createRoom(@Ctx() ctx: RequestContext, @Body(zod(roomFields)) body: z.infer<typeof roomFields>) {
    return this.db.tenant(ctx.tenantId, (tx) => tx.room.create({ data: { ...body, tenantId: ctx.tenantId } }));
  }

  @Perm('school:write')
  @Patch('rooms/:id')
  updateRoom(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(roomFields.partial())) body: Partial<z.infer<typeof roomFields>>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.room.findUnique({ where: { id } }), 'Aula');
      return tx.room.update({ where: { id }, data: body });
    });
  }

  @Perm('school:write')
  @HttpCode(204)
  @Delete('rooms/:id')
  async deleteRoom(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    await this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.room.findUnique({ where: { id } }), 'Aula');
      await tx.room.delete({ where: { id } });
    });
  }

  // ── Grupos y horarios ──────────────────────────────────────────────────────

  @Perm('school:read')
  @Get('groups')
  groups(@Ctx() ctx: RequestContext, @Query(zod(groupsQuery)) q: z.infer<typeof groupsQuery>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const where: Prisma.ClassGroupWhereInput = { yearId: q.yearId };
      if (q.mine === 'true') where.teacher = { userId: ctx.userId };
      const [groups, waitlist] = await Promise.all([
        tx.classGroup.findMany({ where, include: groupInclude, orderBy: [{ subject: { name: 'asc' } }, { name: 'asc' }] }),
        tx.enrollment.groupBy({ by: ['groupId'], where: { status: 'WAITLIST' }, _count: true }),
      ]);
      return groups.map((g) => ({ ...g, activeCount: g._count.enrollments, waitlistCount: waitlist.find((w) => w.groupId === g.id)?._count ?? 0 }));
    });
  }

  @Perm('school:write')
  @Post('groups')
  createGroup(@Ctx() ctx: RequestContext, @Body(zod(groupBase)) body: z.infer<typeof groupBase>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.schoolYear.findUnique({ where: { id: body.yearId } }), 'Curso');
      found(await tx.subject.findUnique({ where: { id: body.subjectId } }), 'Asignatura');
      if (body.teacherId) found(await tx.teacher.findUnique({ where: { id: body.teacherId } }), 'Profesor');
      const g = await tx.classGroup.create({ data: { ...body, tenantId: ctx.tenantId }, include: groupInclude });
      await this.audit.log(tx, ctx, 'class_group.created', 'class_group', g.id, { name: g.name });
      return g;
    });
  }

  @Perm('school:read')
  @Get('groups/:id')
  group(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) =>
      found(
        await tx.classGroup.findUnique({
          where: { id },
          include: {
            ...groupInclude,
            year: true,
            enrollments: {
              where: { status: { not: 'WITHDRAWN' } },
              include: { student: { select: { id: true, firstName: true, lastName: true, instrument: true, status: true } } },
              orderBy: [{ status: 'asc' }, { enrolledAt: 'asc' }],
            },
          },
        }),
        'Grupo',
      ),
    );
  }

  @Perm('school:write')
  @Patch('groups/:id')
  updateGroup(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(groupPatch)) body: z.infer<typeof groupPatch>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.classGroup.findUnique({ where: { id } }), 'Grupo');
      if (body.subjectId) found(await tx.subject.findUnique({ where: { id: body.subjectId } }), 'Asignatura');
      if (body.teacherId) found(await tx.teacher.findUnique({ where: { id: body.teacherId } }), 'Profesor');
      const g = await tx.classGroup.update({ where: { id }, data: body, include: groupInclude });
      await this.audit.log(tx, ctx, 'class_group.updated', 'class_group', id, changedFields(body));
      return g;
    });
  }

  @Perm('school:write')
  @HttpCode(204)
  @Delete('groups/:id')
  async deleteGroup(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    await this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.classGroup.findUnique({ where: { id } }), 'Grupo');
      if (await tx.enrollment.count({ where: { groupId: id, status: { not: 'WITHDRAWN' } } })) {
        throw new BadRequestException({ message: 'El grupo tiene alumnos matriculados', code: 'GROUP_IN_USE' });
      }
      await tx.classGroup.delete({ where: { id } });
      await this.audit.log(tx, ctx, 'class_group.deleted', 'class_group', id);
    });
  }

  @Perm('school:write')
  @Post('groups/:id/slots')
  createSlot(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) groupId: string, @Body(zod(slotBase)) body: z.infer<typeof slotBase>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const group = found(await tx.classGroup.findUnique({ where: { id: groupId } }), 'Grupo');
      if (body.roomId) found(await tx.room.findUnique({ where: { id: body.roomId } }), 'Aula');
      const { force, ...slot } = body;
      const conflicts = await assertNoSlotConflict(tx, group, { ...slot, roomId: slot.roomId ?? null }, force);
      const created = await tx.classSlot.create({ data: { ...slot, groupId, tenantId: ctx.tenantId }, include: { room: { select: { id: true, name: true } } } });
      if (conflicts.length) await this.audit.log(tx, ctx, 'class_slot.conflict_forced', 'class_slot', created.id, { conflicts: conflicts.length });
      return created;
    });
  }

  @Perm('school:write')
  @Patch('slots/:id')
  updateSlot(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(slotFields.partial())) body: Partial<z.infer<typeof slotFields>>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const current = found(await tx.classSlot.findUnique({ where: { id }, include: { group: true } }), 'Franja');
      if (body.roomId) found(await tx.room.findUnique({ where: { id: body.roomId } }), 'Aula');
      const { force, ...patch } = body;
      const next = { id, weekday: patch.weekday ?? current.weekday, startMin: patch.startMin ?? current.startMin, endMin: patch.endMin ?? current.endMin, roomId: patch.roomId !== undefined ? patch.roomId : current.roomId };
      if (next.endMin <= next.startMin) throw new BadRequestException({ message: 'La hora de fin debe ser posterior al inicio', code: 'VALIDATION_ERROR' });
      const conflicts = await assertNoSlotConflict(tx, current.group, next, force);
      const updated = await tx.classSlot.update({ where: { id }, data: patch, include: { room: { select: { id: true, name: true } } } });
      if (conflicts.length) await this.audit.log(tx, ctx, 'class_slot.conflict_forced', 'class_slot', id, { conflicts: conflicts.length });
      return updated;
    });
  }

  @Perm('school:write')
  @HttpCode(204)
  @Delete('slots/:id')
  async deleteSlot(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    await this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.classSlot.findUnique({ where: { id } }), 'Franja');
      await tx.classSlot.delete({ where: { id } });
    });
  }

  // ── Matrículas ─────────────────────────────────────────────────────────────

  @Perm('school:write')
  @Post('enrollments')
  createEnrollment(@Ctx() ctx: RequestContext, @Body(zod(enrollSchema)) body: z.infer<typeof enrollSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const e = await enroll(tx, ctx.tenantId, body.studentId, body.groupId);
      await this.audit.log(tx, ctx, 'enrollment.created', 'enrollment', e.id, { ...body, status: e.status });
      return e;
    });
  }

  @Perm('school:write')
  @HttpCode(200)
  @Post('enrollments/:id/withdraw')
  withdrawEnrollment(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const result = await withdraw(tx, id);
      await this.audit.log(tx, ctx, 'enrollment.withdrawn', 'enrollment', id, { promoted: result.promoted?.id ?? null });
      return result;
    });
  }

  @Perm('school:write')
  @Get('applications')
  applications(@Ctx() ctx: RequestContext, @Query(zod(applicationsQuery)) q: z.infer<typeof applicationsQuery>) {
    return this.db.tenant(ctx.tenantId, (tx) =>
      tx.enrollmentApplication.findMany({ where: { yearId: q.yearId, status: q.status }, include: { year: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' }, take: 500 }),
    );
  }

  /** Revisión de la solicitud: citación y resultado de la prueba de acceso. */
  @Perm('school:write')
  @Patch('applications/:id')
  updateApplication(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(applicationPatch)) body: z.infer<typeof applicationPatch>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.enrollmentApplication.findUnique({ where: { id } }), 'Solicitud');
      const { auditionAt, ...rest } = body;
      const a = await tx.enrollmentApplication.update({ where: { id }, data: { ...rest, ...(auditionAt !== undefined && { auditionAt: auditionAt ? new Date(auditionAt) : null }) } });
      await this.audit.log(tx, ctx, 'application.updated', 'enrollment_application', id, changedFields(body));
      return a;
    });
  }

  /** Acepta: crea o vincula familia, tutor y alumno y lo matricula en los grupos elegidos (con lista de espera si están llenos). */
  @Perm('school:write')
  @HttpCode(200)
  @Post('applications/:id/accept')
  accept(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(acceptSchema)) body: z.infer<typeof acceptSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const app = found(await tx.enrollmentApplication.findUnique({ where: { id } }), 'Solicitud');
      if (app.status === 'ACCEPTED' || app.status === 'REJECTED') throw new BadRequestException({ message: 'La solicitud ya está resuelta', code: 'APPLICATION_CLOSED' });
      const groups = await tx.classGroup.findMany({ where: { id: { in: body.groupIds } } });
      if (groups.length !== new Set(body.groupIds).size || groups.some((g) => g.yearId !== app.yearId)) {
        throw new BadRequestException({ message: 'Los grupos no pertenecen al curso de la solicitud', code: 'INVALID_GROUPS' });
      }
      let student;
      if (body.studentId) {
        student = found(await tx.student.findUnique({ where: { id: body.studentId } }), 'Alumno');
      } else {
        let familyId = body.familyId;
        if (familyId) found(await tx.family.findUnique({ where: { id: familyId } }), 'Familia');
        else familyId = (await tx.family.create({ data: { tenantId: ctx.tenantId, name: `Familia ${app.studentLastName}` } })).id;
        const email = app.guardianEmail.toLowerCase();
        if (!(await tx.guardian.findFirst({ where: { familyId, email } }))) {
          await tx.guardian.create({ data: { tenantId: ctx.tenantId, familyId, ...splitName(app.guardianName), email, phone: app.guardianPhone } });
        }
        await this.limits.assertCanAddStudent(tx, ctx.tenantId);
        student = await tx.student.create({
          data: { tenantId: ctx.tenantId, familyId, firstName: app.studentFirstName, lastName: app.studentLastName, birthDate: app.studentBirthDate },
        });
      }
      const enrollments = [];
      for (const g of groups) enrollments.push(await enroll(tx, ctx.tenantId, student.id, g.id));
      const updated = await tx.enrollmentApplication.update({ where: { id }, data: { status: 'ACCEPTED', studentId: student.id, reviewedAt: new Date() } });
      await this.audit.log(tx, ctx, 'application.accepted', 'enrollment_application', id, { studentId: student.id, groups: body.groupIds.length });
      return { application: updated, student, enrollments };
    });
  }

  @Perm('school:write')
  @HttpCode(200)
  @Post('applications/:id/waitlist')
  waitlistApplication(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.resolveApplication(ctx, id, 'WAITLISTED');
  }

  @Perm('school:write')
  @HttpCode(200)
  @Post('applications/:id/reject')
  rejectApplication(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.resolveApplication(ctx, id, 'REJECTED');
  }

  private resolveApplication(ctx: RequestContext, id: string, status: 'WAITLISTED' | 'REJECTED') {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const app = found(await tx.enrollmentApplication.findUnique({ where: { id } }), 'Solicitud');
      if (app.status === 'ACCEPTED') throw new BadRequestException({ message: 'La solicitud ya está aceptada', code: 'APPLICATION_CLOSED' });
      const updated = await tx.enrollmentApplication.update({ where: { id }, data: { status, reviewedAt: new Date() } });
      await this.audit.log(tx, ctx, `application.${status.toLowerCase()}`, 'enrollment_application', id);
      return updated;
    });
  }

  // ── Clases: sesiones, asistencia y notas ──────────────────────────────────

  @Perm('school:read')
  @Get('groups/:id/sessions')
  sessions(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) groupId: string, @Query(zod(sessionsQuery)) q: z.infer<typeof sessionsQuery>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.classGroup.findUnique({ where: { id: groupId } }), 'Grupo');
      return tx.classSession.findMany({
        where: { groupId, date: { gte: q.from ? toDate(q.from) : undefined, lte: q.to ? toDate(q.to) : undefined } },
        include: { _count: { select: { attendance: true } } },
        orderBy: [{ date: 'asc' }, { startMin: 'asc' }],
        take: 400,
      });
    });
  }

  /** Genera las sesiones de las franjas semanales en un rango. Idempotente; omite festivos y días fuera del curso. */
  @Perm('school:write')
  @Post('groups/:id/sessions/generate')
  generate(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) groupId: string, @Body(zod(rangeSchema)) body: z.infer<typeof rangeSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const group = found(await tx.classGroup.findUnique({ where: { id: groupId }, include: { slots: true, year: true } }), 'Grupo');
      const from = new Date(Math.max(toDate(body.from).getTime(), group.year.startsOn.getTime()));
      const to = new Date(Math.min(toDate(body.to).getTime(), group.year.endsOn.getTime()));
      if (to.getTime() - from.getTime() > 400 * 86_400_000) throw new BadRequestException({ message: 'Rango demasiado amplio', code: 'RANGE_TOO_LARGE' });
      const holidays = new Set(group.year.holidays.map(dayKey));
      const data: Prisma.ClassSessionCreateManyInput[] = [];
      for (let d = from; d <= to; d = new Date(d.getTime() + 86_400_000)) {
        if (holidays.has(dayKey(d))) continue;
        for (const s of group.slots.filter((x) => x.weekday === isoWeekday(d))) {
          data.push({ tenantId: ctx.tenantId, groupId, date: d, startMin: s.startMin, endMin: s.endMin });
        }
      }
      const { count } = data.length ? await tx.classSession.createMany({ data, skipDuplicates: true }) : { count: 0 };
      return { created: count, skipped: data.length - count };
    });
  }

  @Perm('school:teach')
  @Get('sessions/:id')
  session(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const s = found(await tx.classSession.findUnique({ where: { id }, include: { attendance: true } }), 'Sesión');
      const roster = await tx.enrollment.findMany({
        where: { groupId: s.groupId, status: 'ACTIVE' },
        select: { student: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { student: { lastName: 'asc' } },
      });
      return { ...s, roster: roster.map((r) => r.student) };
    });
  }

  @Perm('school:teach')
  @HttpCode(200)
  @Post('sessions/:id/cancel')
  cancelSession(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(cancelSchema)) body: z.infer<typeof cancelSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const s = found(await tx.classSession.findUnique({ where: { id } }), 'Sesión');
      await assertCanTeachGroup(tx, ctx, s.groupId);
      const updated = await tx.classSession.update({ where: { id }, data: { status: 'CANCELLED', notes: body.notes ?? s.notes } });
      await this.audit.log(tx, ctx, 'class_session.cancelled', 'class_session', id);
      return updated;
    });
  }

  /** Clase de recuperación de una sesión cancelada. */
  @Perm('school:teach')
  @Post('sessions/:id/make-up')
  makeUp(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(makeUpSchema)) body: z.infer<typeof makeUpSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const s = found(await tx.classSession.findUnique({ where: { id } }), 'Sesión');
      await assertCanTeachGroup(tx, ctx, s.groupId);
      if (s.status !== 'CANCELLED') throw new BadRequestException({ message: 'Sólo se recuperan clases canceladas', code: 'SESSION_NOT_CANCELLED' });
      const created = await tx.classSession.create({
        data: { tenantId: ctx.tenantId, groupId: s.groupId, date: toDate(body.date), startMin: body.startMin, endMin: body.endMin, notes: body.notes, makeUpForId: id },
      });
      await this.audit.log(tx, ctx, 'class_session.make_up', 'class_session', created.id, { makeUpForId: id });
      return created;
    });
  }

  @Perm('school:teach')
  @Put('sessions/:id/attendance')
  attendance(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(attendanceSchema)) body: z.infer<typeof attendanceSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const s = found(await tx.classSession.findUnique({ where: { id } }), 'Sesión');
      await assertCanTeachGroup(tx, ctx, s.groupId);
      if (s.status === 'CANCELLED') throw new BadRequestException({ message: 'La clase está cancelada', code: 'SESSION_CANCELLED' });
      const enrolled = await tx.enrollment.findMany({ where: { groupId: s.groupId, studentId: { in: body.map((r) => r.studentId) } }, select: { studentId: true } });
      if (enrolled.length !== new Set(body.map((r) => r.studentId)).size) {
        throw new BadRequestException({ message: 'Algún alumno no pertenece al grupo', code: 'NOT_IN_GROUP' });
      }
      for (const r of body) {
        await tx.classAttendance.upsert({
          where: { sessionId_studentId: { sessionId: id, studentId: r.studentId } },
          create: { tenantId: ctx.tenantId, sessionId: id, studentId: r.studentId, status: r.status, note: r.note },
          update: { status: r.status, note: r.note },
        });
      }
      if (s.status === 'SCHEDULED') await tx.classSession.update({ where: { id }, data: { status: 'DONE' } });
      return tx.classAttendance.findMany({ where: { sessionId: id } });
    });
  }

  @Perm('school:read')
  @Get('groups/:id/grades')
  grades(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) groupId: string, @Query(zod(gradesQuery)) q: z.infer<typeof gradesQuery>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.classGroup.findUnique({ where: { id: groupId } }), 'Grupo');
      return tx.enrollment.findMany({
        where: { groupId, status: { not: 'WAITLIST' } },
        include: { student: { select: { id: true, firstName: true, lastName: true } }, grades: { where: { term: q.term }, orderBy: { term: 'asc' } } },
        orderBy: { student: { lastName: 'asc' } },
      });
    });
  }

  @Perm('school:teach')
  @Put('groups/:id/grades')
  saveGrades(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) groupId: string, @Body(zod(gradesSchema)) body: z.infer<typeof gradesSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      await assertCanTeachGroup(tx, ctx, groupId);
      const ids = body.grades.map((g) => g.enrollmentId);
      const valid = await tx.enrollment.count({ where: { id: { in: ids }, groupId } });
      if (valid !== new Set(ids).size) throw new BadRequestException({ message: 'Alguna matrícula no pertenece al grupo', code: 'NOT_IN_GROUP' });
      for (const g of body.grades) {
        const data = { scoreTenths: g.scoreTenths, qualitative: g.qualitative, comment: g.comment };
        await tx.grade.upsert({
          where: { enrollmentId_term: { enrollmentId: g.enrollmentId, term: body.term } },
          create: { ...data, tenantId: ctx.tenantId, enrollmentId: g.enrollmentId, term: body.term },
          update: data,
        });
      }
      await this.audit.log(tx, ctx, 'grades.saved', 'class_group', groupId, { term: body.term, count: body.grades.length });
      return tx.grade.findMany({ where: { enrollmentId: { in: ids }, term: body.term } });
    });
  }

  // ── Avisos ─────────────────────────────────────────────────────────────────

  @Perm('school:read')
  @Get('notices')
  notices(@Ctx() ctx: RequestContext, @Query(zod(noticesQuery)) q: z.infer<typeof noticesQuery>) {
    return this.db.tenant(ctx.tenantId, (tx) =>
      tx.schoolNotice.findMany({ where: { groupId: q.groupId }, include: { group: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 100 }),
    );
  }

  @Perm('school:teach')
  @Post('notices')
  async createNotice(@Ctx() ctx: RequestContext, @Body(zod(noticeSchema)) body: z.infer<typeof noticeSchema>) {
    const { notice, userIds } = await this.db.tenant(ctx.tenantId, async (tx) => {
      if (body.groupId) await assertCanTeachGroup(tx, ctx, body.groupId);
      else if (!ctx.permissions.has('school:write') && (await tx.teacher.count({ where: { userId: ctx.userId } }))) {
        throw new BadRequestException({ message: 'Elige uno de tus grupos', code: 'NOT_YOUR_GROUP' });
      }
      const notice = await tx.schoolNotice.create({ data: { ...body, tenantId: ctx.tenantId, authorId: ctx.userId } });
      await this.audit.log(tx, ctx, 'school_notice.created', 'school_notice', notice.id, { groupId: body.groupId ?? null });
      return { notice, userIds: await familyUserIds(tx, body.groupId) };
    });
    if (userIds.length) {
      await this.jobs.add('notify.fanout', { tenantId: ctx.tenantId, userIds, type: 'school.notice', title: notice.title, body: notice.body.slice(0, 500), link: '/family' });
    }
    return notice;
  }

  @Perm('school:teach')
  @HttpCode(204)
  @Delete('notices/:id')
  async deleteNotice(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    await this.db.tenant(ctx.tenantId, async (tx) => {
      const n = found(await tx.schoolNotice.findUnique({ where: { id } }), 'Aviso');
      if (n.authorId !== ctx.userId && !ctx.permissions.has('school:write')) {
        throw new BadRequestException({ message: 'Sólo el autor puede borrar el aviso', code: 'FORBIDDEN' });
      }
      await tx.schoolNotice.delete({ where: { id } });
      await this.audit.log(tx, ctx, 'school_notice.deleted', 'school_notice', id);
    });
  }

  private sensitiveDenied() {
    return new BadRequestException({ message: 'No puedes modificar datos sensibles', code: 'FORBIDDEN' });
  }
}
