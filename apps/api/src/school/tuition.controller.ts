import { BadRequestException, Body, Controller, ForbiddenException, Get, Header, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, Perm, RequireFeature } from '../auth/decorators';
import { found } from '../common/errors';
import { page, pageQuery, skipTake } from '../common/pagination';
import { cents, idParam, isoDate, toDate } from '../common/schemas';
import { zod } from '../common/zod.pipe';
import { Db, Tx } from '../db/db.service';
import { Audit } from '../audit/audit.service';
import { Jobs } from '../jobs/jobs.service';
import { csvCell } from './school.helpers';
import { issueTuition, PAYMENT_METHODS, payCharge, previewTuition, tuitionEmails } from './tuition';

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
const method = z.enum(PAYMENT_METHODS);
const paySchema = z.object({ date: isoDate, method: method.default('CASH') });
const payManySchema = paySchema.extend({ chargeIds: z.array(z.string().uuid()).min(1).max(500) });
const pct = z.number().int().min(0).max(100);
const previewSchema = z.object({
  yearId: z.string().uuid(),
  familyId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  /** Configuración sin guardar (simulador). */
  settings: z
    .object({ feeMode: z.enum(['PERCENT', 'FIXED']), siblingDiscountPct: pct, memberDiscountPct: pct, multiSubjectDiscountPct: pct, familyDiscountCents: cents })
    .partial()
    .optional(),
});
const exportQuery = z.object({ period, status: chargeStatus.optional() });
const OPEN = ['PENDING', 'OVERDUE'] as const;

@ApiTags('school')
@ApiBearerAuth()
@RequireFeature('school')
@Controller('school/tuition')
export class TuitionController {
  constructor(
    private readonly db: Db,
    private readonly audit: Audit,
    private readonly jobs: Jobs,
  ) {}

  /** Emite las mensualidades del periodo a los alumnos con matrículas activas. Idempotente por (alumno, periodo). */
  @Perm('school:tuition')
  @Post('issue')
  async issue(@Ctx() ctx: RequestContext, @Body(zod(issueSchema)) body: z.infer<typeof issueSchema>) {
    const { result, emails } = await this.db.tenant(ctx.tenantId, async (tx) => {
      const result = await issueTuition(tx, ctx.tenantId, { yearId: body.yearId, period: body.period, dueDate: toDate(body.dueDate) });
      await this.audit.log(tx, ctx, 'tuition.issued', 'school_year', body.yearId, { period: body.period, created: result.created });
      const [settings, tenant] = await Promise.all([
        tx.schoolSettings.findUnique({ where: { tenantId: ctx.tenantId } }),
        tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { name: true } }),
      ]);
      const emails = settings?.notifyFamilies === false ? [] : await tuitionEmails(tx, tenant.name, body.period, result.studentIds);
      return { result, emails };
    });
    for (const e of emails) await this.jobs.add('email.send', { ...e, tenantId: ctx.tenantId });
    return { created: result.created, skipped: result.skipped, emailed: emails.length };
  }

  /**
   * Cuánto pagaría cada alumno (o una familia) con la configuración guardada o con otra sin guardar.
   * Lo usan el simulador de Configuración y la confirmación de «Emitir».
   */
  @HttpCode(200)
  @Post('preview')
  preview(@Ctx() ctx: RequestContext, @Body(zod(previewSchema)) body: z.infer<typeof previewSchema>) {
    if (!ctx.permissions.has('school:write') && !ctx.permissions.has('school:tuition')) {
      throw new ForbiddenException({ message: 'No tienes permiso para esta acción', code: 'FORBIDDEN' });
    }
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.schoolYear.findUnique({ where: { id: body.yearId } }), 'Curso');
      const rows = (await previewTuition(tx, ctx.tenantId, body.yearId, body.settings)).filter(
        (r) => (!body.familyId || r.familyId === body.familyId) && (!body.studentId || r.studentId === body.studentId),
      );
      return {
        rows,
        students: rows.length,
        totalBaseCents: rows.reduce((s, r) => s + r.baseCents, 0),
        totalDiscountCents: rows.reduce((s, r) => s + r.discountCents, 0),
        totalAmountCents: rows.reduce((s, r) => s + r.amountCents, 0),
      };
    });
  }

  @Perm('school:tuition')
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

  /** Cobro: marca pagada con su forma de pago y registra el ingreso en la categoría «Escuela de música». */
  @Perm('school:tuition')
  @HttpCode(200)
  @Post('charges/:id/pay')
  pay(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(paySchema)) body: z.infer<typeof paySchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const updated = await payCharge(tx, ctx.tenantId, ctx.userId, id, toDate(body.date), body.method);
      await this.audit.log(tx, ctx, 'tuition.paid', 'tuition_charge', id, { amountCents: updated.amountCents, method: body.method });
      return updated;
    });
  }

  /** Cobro de varias mensualidades a la vez (selección en la tabla). */
  @Perm('school:tuition')
  @HttpCode(200)
  @Post('charges/pay')
  payMany(@Ctx() ctx: RequestContext, @Body(zod(payManySchema)) body: z.infer<typeof payManySchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const ids = [...new Set(body.chargeIds)];
      const open = await tx.tuitionCharge.findMany({ where: { id: { in: ids }, status: { in: [...OPEN] } }, select: { id: true } });
      return this.payAll(tx, ctx, open.map((c) => c.id), body, ids.length - open.length);
    });
  }

  /** Cobra de una vez todo lo pendiente de una familia. */
  @Perm('school:tuition')
  @HttpCode(200)
  @Post('families/:id/pay')
  payFamily(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) familyId: string, @Body(zod(paySchema)) body: z.infer<typeof paySchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.family.findUnique({ where: { id: familyId } }), 'Familia');
      const open = await tx.tuitionCharge.findMany({ where: { familyId, status: { in: [...OPEN] } }, select: { id: true }, orderBy: { period: 'asc' } });
      if (!open.length) throw new BadRequestException({ message: 'La familia no tiene mensualidades pendientes', code: 'NOTHING_TO_PAY' });
      return this.payAll(tx, ctx, open.map((c) => c.id), body, 0);
    });
  }

  private async payAll(tx: Tx, ctx: RequestContext, ids: string[], body: z.infer<typeof paySchema>, skipped: number) {
    let amountCents = 0;
    for (const id of ids) amountCents += (await payCharge(tx, ctx.tenantId, ctx.userId, id, toDate(body.date), body.method)).amountCents;
    await this.audit.log(tx, ctx, 'tuition.paid_many', 'tuition_charge', null, { count: ids.length, amountCents, method: body.method });
    return { paid: ids.length, skipped, amountCents };
  }

  @Perm('school:tuition')
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

  /** Exportación CSV de cargos (una línea por familia). */
  @Perm('school:tuition')
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
    const header = ['familia', 'importe_eur', 'concepto', 'alumnos', 'referencias'];
    const lines = [...byFamily.values()].map((list) => {
      const f = list[0].family;
      const amount = list.reduce((s, c) => s + c.amountCents, 0);
      return [
        f?.name ?? `${list[0].student.firstName} ${list[0].student.lastName}`,
        (amount / 100).toFixed(2),
        `Mensualidad escuela ${q.period}`,
        list.map((c) => `${c.student.firstName} ${c.student.lastName}`).join(', '),
        list.map((c) => c.id).join(' '),
      ]
        .map(csvCell)
        .join(';');
    });
    return '﻿' + [header.join(';'), ...lines].join('\n') + '\n';
  }
}
