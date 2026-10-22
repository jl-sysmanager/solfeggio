import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { RequestContext } from '../auth/context';
import { Ctx, Perm, RequireFeature } from '../auth/decorators';
import { mask, decrypt } from '../common/crypto';
import { notFound } from '../common/errors';
import { Db } from '../db/db.service';

/** Portal de familias: el usuario ve sólo los alumnos de la familia de su tutor vinculado. */
@ApiTags('school')
@ApiBearerAuth()
@RequireFeature('school')
@Controller('school/family')
export class FamilyController {
  constructor(private readonly db: Db) {}

  @Perm('school:family')
  @Get()
  portal(@Ctx() ctx: RequestContext) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const membership = await tx.membership.findUnique({ where: { id: ctx.membershipId }, select: { guardianId: true } });
      const guardian = membership?.guardianId ? await tx.guardian.findUnique({ where: { id: membership.guardianId }, include: { family: true } }) : null;
      if (!guardian) throw notFound('Tutor vinculado');
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
      const [absences, charges, notices] = await Promise.all([
        tx.classAttendance.findMany({
          where: { studentId: { in: studentIds }, status: { in: ['ABSENT', 'LATE', 'EXCUSED'] } },
          select: { id: true, studentId: true, status: true, note: true, session: { select: { date: true, startMin: true, group: { select: { name: true } } } } },
          orderBy: { session: { date: 'desc' } },
          take: 100,
        }),
        tx.tuitionCharge.findMany({
          where: { studentId: { in: studentIds } },
          select: { id: true, studentId: true, period: true, baseCents: true, discountCents: true, amountCents: true, detail: true, dueDate: true, status: true, paidAt: true },
          orderBy: { period: 'desc' },
          take: 60,
        }),
        tx.schoolNotice.findMany({
          where: { OR: [{ groupId: null }, { groupId: { in: groupIds } }] },
          select: { id: true, title: true, body: true, createdAt: true, group: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 30,
        }),
      ]);
      return {
        guardian: { id: guardian.id, firstName: guardian.firstName, lastName: guardian.lastName },
        family: { id: familyId, name: guardian.family.name, ibanMasked: mask(decrypt(guardian.family.ibanEnc)) },
        students,
        absences,
        charges,
        notices,
      };
    });
  }
}
