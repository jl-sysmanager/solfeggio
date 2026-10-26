import { BadRequestException, Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, Perm, RequireFeature } from '../auth/decorators';
import { Audit } from '../audit/audit.service';
import { notFound } from '../common/errors';
import { idParam } from '../common/schemas';
import { zod } from '../common/zod.pipe';
import { Db, Tx } from '../db/db.service';
import { blankToNull } from './school.helpers';
import { madridToday } from './tuition';

const justifySchema = z.object({ text: z.string().trim().min(3).max(1000) });
const contactSchema = z.preprocess(
  blankToNull,
  z.object({ email: z.string().trim().email().max(254).nullable().optional(), phone: z.string().trim().max(30).nullable().optional() }),
);
/** Días de próximas clases que ve la familia. */
const UPCOMING_DAYS = 21;

/** Portal de familias: el usuario ve sólo los alumnos de la familia de su tutor vinculado. */
@ApiTags('school')
@ApiBearerAuth()
@RequireFeature('school')
@Controller('school/family')
export class FamilyController {
  constructor(
    private readonly db: Db,
    private readonly audit: Audit,
  ) {}

  /** Tutor vinculado a la membresía de quien entra; 404 si no tiene. */
  private async guardianOf(tx: Tx, ctx: RequestContext) {
    const membership = await tx.membership.findUnique({ where: { id: ctx.membershipId }, select: { guardianId: true } });
    const guardian = membership?.guardianId ? await tx.guardian.findUnique({ where: { id: membership.guardianId }, include: { family: true } }) : null;
    if (!guardian) throw notFound('Tutor vinculado');
    return guardian;
  }

  /** La familia justifica una falta o un retraso de uno de sus alumnos; lo revisa el profesorado. */
  @Perm('school:family')
  @HttpCode(200)
  @Post('absences/:id/justify')
  justify(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(justifySchema)) body: z.infer<typeof justifySchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const guardian = await this.guardianOf(tx, ctx);
      const a = await tx.classAttendance.findFirst({ where: { id, student: { familyId: guardian.familyId } } });
      if (!a) throw notFound('Falta');
      if (a.status === 'PRESENT' || a.status === 'EXCUSED') throw new BadRequestException({ message: 'No hay nada que justificar', code: 'NOTHING_TO_JUSTIFY' });
      if (a.justificationStatus === 'APPROVED') throw new BadRequestException({ message: 'La falta ya está justificada', code: 'ALREADY_JUSTIFIED' });
      const updated = await tx.classAttendance.update({ where: { id }, data: { justification: body.text, justificationStatus: 'PENDING' } });
      await this.audit.log(tx, ctx, 'class_attendance.justified', 'class_attendance', id, { guardianId: guardian.id });
      return { id: updated.id, justification: updated.justification, justificationStatus: updated.justificationStatus };
    });
  }

  /** El tutor actualiza su email y su teléfono de contacto (no cambia el email con el que entra). */
  @Perm('school:family')
  @Patch('contact')
  contact(@Ctx() ctx: RequestContext, @Body(zod(contactSchema)) body: z.infer<typeof contactSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const guardian = await this.guardianOf(tx, ctx);
      const updated = await tx.guardian.update({
        where: { id: guardian.id },
        data: { ...(body.email !== undefined && { email: body.email?.toLowerCase() ?? null }), ...(body.phone !== undefined && { phone: body.phone }) },
      });
      await this.audit.log(tx, ctx, 'guardian.contact_updated', 'guardian', guardian.id, { fields: Object.keys(body), by: 'family' });
      return { id: updated.id, email: updated.email, phone: updated.phone };
    });
  }

  @Perm('school:family')
  @Get()
  portal(@Ctx() ctx: RequestContext) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const guardian = await this.guardianOf(tx, ctx);
      const familyId = guardian.familyId;
      const students = await tx.student.findMany({
        where: { familyId, status: { not: 'LEFT' } },
        select: {
          id: true, firstName: true, lastName: true, birthDate: true, instrument: true, status: true, bandStage: true,
          enrollments: {
            where: { status: { not: 'WITHDRAWN' } },
            select: {
              id: true, status: true,
              grades: { select: { term: true, scoreTenths: true, qualitative: true, comment: true }, orderBy: { term: 'asc' } },
              group: {
                select: {
                  id: true, name: true, level: true, year: { select: { id: true, name: true } },
                  subject: { select: { name: true, kind: true } },
                  teacher: { select: { firstName: true, lastName: true } },
                  slots: { select: { weekday: true, startMin: true, endMin: true, room: { select: { name: true } } }, orderBy: [{ weekday: 'asc' }, { startMin: 'asc' }] },
                },
              },
            },
          },
        },
        orderBy: { birthDate: 'asc' },
      });
      const studentIds = students.map((s) => s.id);
      const groupIds = [...new Set(students.flatMap((s) => s.enrollments.map((e) => e.group.id)))];
      const activeGroups = [...new Set(students.flatMap((s) => s.enrollments.filter((e) => e.status === 'ACTIVE').map((e) => e.group.id)))];
      const today = new Date(madridToday().iso);
      const [absences, charges, notices, upcoming, contacts] = await Promise.all([
        tx.classAttendance.findMany({
          where: { studentId: { in: studentIds }, status: { in: ['ABSENT', 'LATE', 'EXCUSED'] } },
          select: {
            id: true, studentId: true, status: true, note: true, justification: true, justificationStatus: true,
            session: { select: { date: true, startMin: true, group: { select: { name: true } } } },
          },
          orderBy: { session: { date: 'desc' } },
          take: 100,
        }),
        tx.tuitionCharge.findMany({
          where: { studentId: { in: studentIds } },
          select: { id: true, studentId: true, period: true, baseCents: true, discountCents: true, amountCents: true, detail: true, dueDate: true, status: true, paidAt: true, paymentMethod: true },
          orderBy: { period: 'desc' },
          take: 60,
        }),
        tx.schoolNotice.findMany({
          where: { OR: [{ groupId: null }, { groupId: { in: groupIds } }] },
          select: { id: true, title: true, body: true, createdAt: true, group: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 30,
        }),
        // Próximas clases (también las canceladas, para que la familia lo sepa) de los grupos con plaza.
        tx.classSession.findMany({
          where: { groupId: { in: activeGroups }, date: { gte: today, lt: new Date(today.getTime() + UPCOMING_DAYS * 86_400_000) } },
          select: {
            id: true, date: true, startMin: true, endMin: true, status: true, notes: true, makeUpForId: true,
            group: { select: { id: true, name: true, subject: { select: { name: true } } } },
          },
          orderBy: [{ date: 'asc' }, { startMin: 'asc' }],
          take: 100,
        }),
        tx.guardian.findMany({ where: { familyId }, select: { id: true, firstName: true, lastName: true, relationship: true, email: true, phone: true }, orderBy: { createdAt: 'asc' } }),
      ]);
      const studentsByGroup = new Map<string, string[]>();
      for (const s of students) for (const e of s.enrollments) if (e.status === 'ACTIVE') studentsByGroup.set(e.group.id, [...(studentsByGroup.get(e.group.id) ?? []), s.id]);
      return {
        guardian: { id: guardian.id, firstName: guardian.firstName, lastName: guardian.lastName, email: guardian.email, phone: guardian.phone },
        guardians: contacts,
        upcoming: upcoming.map((u) => ({ ...u, studentIds: studentsByGroup.get(u.group.id) ?? [] })),
        family: { id: familyId, name: guardian.family.name },
        students,
        absences,
        charges,
        notices,
      };
    });
  }
}
