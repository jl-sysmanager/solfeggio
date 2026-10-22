import { BadRequestException, Body, Controller, Get, Header, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, Perm, RequireFeature } from '../auth/decorators';
import { decrypt } from '../common/crypto';
import { found } from '../common/errors';
import { page, pageQuery, skipTake } from '../common/pagination';
import { idParam, isoDate, toDate } from '../common/schemas';
import { zod } from '../common/zod.pipe';
import { Db } from '../db/db.service';
import { Audit } from '../audit/audit.service';
import { computeTuition, csvCell } from './school.helpers';

const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Periodo: YYYY-MM');
const issueSchema = z.object({ yearId: z.string().uuid(), period, dueDate: isoDate });
const chargeStatus = z.enum(['PENDING', 'PAID', 'OVERDUE', 'WAIVED']);
const chargesQuery = pageQuery.extend({
  yearId: z.string().uuid().optional(),
  period: period.optional(),
  status: chargeStatus.optional(),
  familyId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
});
const paySchema = z.object({ date: isoDate });
const exportQuery = z.object({ period, status: chargeStatus.optional() });
const CATEGORY = 'Escuela de música';

@ApiTags('school')
@ApiBearerAuth()
@RequireFeature('school')
@Controller('school/tuition')
export class TuitionController {
  constructor(
    private readonly db: Db,
    private readonly audit: Audit,
  ) {}

  /** Emite las mensualidades del periodo a los alumnos con matrículas activas. Idempotente por (alumno, periodo). */
  @Perm('finance:write')
  @Post('issue')
  issue(@Ctx() ctx: RequestContext, @Body(zod(issueSchema)) body: z.infer<typeof issueSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.schoolYear.findUnique({ where: { id: body.yearId } }), 'Curso');
      const [settings, students] = await Promise.all([
        tx.schoolSettings.findUnique({ where: { tenantId: ctx.tenantId } }),
        tx.student.findMany({
          where: { status: 'ACTIVE' },
          include: {
            family: { include: { guardians: { select: { memberId: true } } } },
            enrollments: { where: { status: 'ACTIVE', group: { yearId: body.yearId } }, include: { group: { include: { subject: true } } } },
          },
        }),
      ]);
      const rows = computeTuition(students, settings ?? { siblingDiscountPct: 0, memberDiscountPct: 0, multiSubjectDiscountPct: 0 }).filter((r) => r.baseCents > 0);
      const { count } = rows.length
        ? await tx.tuitionCharge.createMany({
            data: rows.map((r) => ({
              tenantId: ctx.tenantId, yearId: body.yearId, studentId: r.studentId, familyId: r.familyId, period: body.period, baseCents: r.baseCents,
              discountCents: r.discountCents, amountCents: r.amountCents, detail: r.detail as unknown as Prisma.InputJsonValue, dueDate: toDate(body.dueDate),
            })),
            skipDuplicates: true,
          })
        : { count: 0 };
      await this.audit.log(tx, ctx, 'tuition.issued', 'school_year', body.yearId, { period: body.period, created: count });
      return { created: count, skipped: rows.length - count };
    });
  }

  @Perm('finance:read')
  @Get('charges')
  charges(@Ctx() ctx: RequestContext, @Query(zod(chargesQuery)) q: z.infer<typeof chargesQuery>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const where: Prisma.TuitionChargeWhereInput = { yearId: q.yearId, period: q.period, status: q.status, familyId: q.familyId, studentId: q.studentId };
      const [data, total, sum] = await Promise.all([
        tx.tuitionCharge.findMany({
          where,
          include: { student: { select: { id: true, firstName: true, lastName: true } }, family: { select: { id: true, name: true } } },
          orderBy: [{ period: 'desc' }, { student: { lastName: 'asc' } }],
          ...skipTake(q),
        }),
        tx.tuitionCharge.count({ where }),
        tx.tuitionCharge.aggregate({ where, _sum: { amountCents: true } }),
      ]);
      return { ...page(data, total, q), totalAmountCents: sum._sum.amountCents ?? 0 };
    });
  }

  /** Cobro: marca pagada y registra el ingreso en la categoría «Escuela de música». */
  @Perm('finance:write')
  @HttpCode(200)
  @Post('charges/:id/pay')
  pay(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(paySchema)) body: z.infer<typeof paySchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const charge = found(await tx.tuitionCharge.findUnique({ where: { id }, include: { student: true } }), 'Mensualidad');
      if (charge.status === 'PAID' || charge.status === 'WAIVED') throw new BadRequestException({ message: 'La mensualidad ya está cerrada', code: 'CHARGE_CLOSED' });
      const category = await tx.financeCategory.upsert({
        where: { tenantId_name_kind: { tenantId: ctx.tenantId, name: CATEGORY, kind: 'INCOME' } },
        create: { tenantId: ctx.tenantId, name: CATEGORY, kind: 'INCOME' },
        update: {},
      });
      const t = await tx.transaction.create({
        data: {
          tenantId: ctx.tenantId, kind: 'INCOME', amountCents: charge.amountCents, date: toDate(body.date), categoryId: category.id,
          description: `Mensualidad ${charge.period} · ${charge.student.firstName} ${charge.student.lastName}`, memberId: charge.student.memberId, createdById: ctx.userId,
        },
      });
      const updated = await tx.tuitionCharge.update({ where: { id }, data: { status: 'PAID', paidAt: new Date(), transactionId: t.id } });
      await this.audit.log(tx, ctx, 'tuition.paid', 'tuition_charge', id, { amountCents: charge.amountCents });
      return updated;
    });
  }

  @Perm('finance:write')
  @HttpCode(200)
  @Post('charges/:id/waive')
  waive(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const charge = found(await tx.tuitionCharge.findUnique({ where: { id } }), 'Mensualidad');
      if (charge.status === 'PAID') throw new BadRequestException({ message: 'La mensualidad ya está pagada', code: 'CHARGE_CLOSED' });
      const updated = await tx.tuitionCharge.update({ where: { id }, data: { status: 'WAIVED' } });
      await this.audit.log(tx, ctx, 'tuition.waived', 'tuition_charge', id);
      return updated;
    });
  }

  /** Remesa para domiciliación (CSV, una línea por familia). No genera SEPA pain.008. */
  @Perm('finance:read', 'members:sensitive')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Get('export.csv')
  async csv(@Ctx() ctx: RequestContext, @Query(zod(exportQuery)) q: z.infer<typeof exportQuery>) {
    const charges = await this.db.tenant(ctx.tenantId, async (tx) => {
      const rows = await tx.tuitionCharge.findMany({
        where: { period: q.period, status: q.status ?? { in: ['PENDING', 'OVERDUE'] } },
        include: { student: { select: { firstName: true, lastName: true } }, family: true },
        orderBy: [{ family: { name: 'asc' } }, { student: { lastName: 'asc' } }],
      });
      await this.audit.log(tx, ctx, 'tuition.exported', 'tuition_charge', null, { period: q.period, rows: rows.length });
      return rows;
    });
    const byFamily = new Map<string, typeof charges>();
    for (const c of charges) {
      const key = c.familyId ?? `student:${c.studentId}`;
      byFamily.set(key, [...(byFamily.get(key) ?? []), c]);
    }
    const header = ['familia', 'titular', 'iban', 'importe_eur', 'concepto', 'alumnos', 'referencias'];
    const lines = [...byFamily.values()].map((list) => {
      const f = list[0].family;
      const amount = list.reduce((s, c) => s + c.amountCents, 0);
      return [
        f?.name ?? `${list[0].student.firstName} ${list[0].student.lastName}`, f?.ibanHolder, decrypt(f?.ibanEnc), (amount / 100).toFixed(2),
        `Mensualidad escuela ${q.period}`, list.map((c) => `${c.student.firstName} ${c.student.lastName}`).join(', '), list.map((c) => c.id).join(' '),
      ]
        .map(csvCell)
        .join(';');
    });
    return '﻿' + [header.join(';'), ...lines].join('\n') + '\n';
  }
}
