import { BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, Perm, RequireFeature } from '../auth/decorators';
import { found } from '../common/errors';
import { page, pageQuery, skipTake } from '../common/pagination';
import { cents, idParam, isoDate, toDate } from '../common/schemas';
import { zod } from '../common/zod.pipe';
import { Db } from '../db/db.service';
import { Audit } from '../audit/audit.service';

const categorySchema = z.object({ name: z.string().trim().min(1).max(80), kind: z.enum(['INCOME', 'EXPENSE']) });
const txSchema = z.object({
  kind: z.enum(['INCOME', 'EXPENSE']),
  amountCents: cents.refine((v) => v > 0, 'El importe debe ser mayor que 0'),
  date: isoDate,
  categoryId: z.string().uuid().nullable().optional(),
  description: z.string().trim().min(1).max(300),
  memberId: z.string().uuid().nullable().optional(),
});
const txQuery = pageQuery.extend({
  from: isoDate.optional(),
  to: isoDate.optional(),
  kind: z.enum(['INCOME', 'EXPENSE']).optional(),
  categoryId: z.string().uuid().optional(),
});
const feeSchema = z.object({
  name: z.string().trim().min(1).max(100),
  amountCents: cents.refine((v) => v > 0),
  periodicity: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY', 'ONE_OFF']),
  active: z.boolean().optional(),
});
const issueSchema = z.object({ period: z.string().regex(/^\d{4}(-(0[1-9]|1[0-2]|Q[1-4]))?$/, 'Periodo: 2026, 2026-10 o 2026-Q4'), dueDate: isoDate });
const chargesQuery = pageQuery.extend({
  status: z.enum(['PENDING', 'PAID', 'OVERDUE', 'WAIVED']).optional(),
  period: z.string().max(10).optional(),
  memberId: z.string().uuid().optional(),
});
const paySchema = z.object({ date: isoDate });
const yearQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100).default(new Date().getUTCFullYear()) });

export const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Evita inyección de fórmulas en hojas de cálculo.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

@ApiTags('treasury')
@ApiBearerAuth()
@RequireFeature('treasury')
@Controller('finance')
export class TreasuryController {
  constructor(
    private readonly db: Db,
    private readonly audit: Audit,
  ) {}

  @Perm('finance:read')
  @Get('categories')
  categories(@Ctx() ctx: RequestContext) {
    return this.db.tenant(ctx.tenantId, (tx) => tx.financeCategory.findMany({ orderBy: [{ kind: 'asc' }, { name: 'asc' }] }));
  }

  @Perm('finance:write')
  @Post('categories')
  createCategory(@Ctx() ctx: RequestContext, @Body(zod(categorySchema)) body: z.infer<typeof categorySchema>) {
    return this.db.tenant(ctx.tenantId, (tx) => tx.financeCategory.create({ data: { ...body, tenantId: ctx.tenantId } }));
  }

  @Perm('finance:read')
  @Get('transactions')
  transactions(@Ctx() ctx: RequestContext, @Query(zod(txQuery)) q: z.infer<typeof txQuery>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const where: Prisma.TransactionWhereInput = {
        kind: q.kind,
        categoryId: q.categoryId,
        date: { gte: q.from ? toDate(q.from) : undefined, lte: q.to ? toDate(q.to) : undefined },
      };
      const [data, total] = await Promise.all([
        tx.transaction.findMany({ where, include: { category: true }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], ...skipTake(q) }),
        tx.transaction.count({ where }),
      ]);
      return page(data, total, q);
    });
  }

  @Perm('finance:write')
  @Post('transactions')
  createTransaction(@Ctx() ctx: RequestContext, @Body(zod(txSchema)) body: z.infer<typeof txSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      if (body.categoryId) {
        const cat = found(await tx.financeCategory.findUnique({ where: { id: body.categoryId } }), 'Categoría');
        if (cat.kind !== body.kind) throw new BadRequestException({ message: 'La categoría no corresponde al tipo de movimiento', code: 'CATEGORY_KIND_MISMATCH' });
      }
      if (body.memberId) found(await tx.member.findUnique({ where: { id: body.memberId } }), 'Socio');
      const t = await tx.transaction.create({ data: { ...body, date: toDate(body.date), tenantId: ctx.tenantId, createdById: ctx.userId } });
      await this.audit.log(tx, ctx, 'transaction.created', 'transaction', t.id, { kind: t.kind, amountCents: t.amountCents });
      return t;
    });
  }

  @Perm('finance:write')
  @HttpCode(204)
  @Delete('transactions/:id')
  async deleteTransaction(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    await this.db.tenant(ctx.tenantId, async (tx) => {
      const t = found(await tx.transaction.findUnique({ where: { id } }), 'Movimiento');
      // Los cobros de otros módulos (cuotas, mensualidades, facturas, refuerzos, lotería, donativos) se deshacen allí.
      const where = { transactionId: id };
      const links = await Promise.all([
        tx.feeCharge.count({ where }), tx.tuitionCharge.count({ where }), tx.clientInvoice.count({ where }),
        tx.reinforcementPayment.count({ where }), tx.lotteryBook.count({ where }), tx.donation.count({ where }),
      ]);
      if (links.some((n) => n > 0)) throw new BadRequestException({ message: 'El movimiento corresponde a un cobro o pago registrado en otro módulo', code: 'LINKED_TO_CHARGE' });
      await tx.transaction.delete({ where: { id } });
      await this.audit.log(tx, ctx, 'transaction.deleted', 'transaction', id, { kind: t.kind, amountCents: t.amountCents, description: t.description });
    });
  }

  @Perm('finance:read')
  @Get('fees')
  fees(@Ctx() ctx: RequestContext) {
    return this.db.tenant(ctx.tenantId, (tx) => tx.fee.findMany({ orderBy: { name: 'asc' } }));
  }

  @Perm('finance:write')
  @Post('fees')
  createFee(@Ctx() ctx: RequestContext, @Body(zod(feeSchema)) body: z.infer<typeof feeSchema>) {
    return this.db.tenant(ctx.tenantId, (tx) => tx.fee.create({ data: { ...body, tenantId: ctx.tenantId } }));
  }

  @Perm('finance:write')
  @Patch('fees/:id')
  updateFee(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(feeSchema.partial())) body: Partial<z.infer<typeof feeSchema>>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.fee.findUnique({ where: { id } }), 'Cuota');
      return tx.fee.update({ where: { id }, data: body });
    });
  }

  /** Emite la cuota a los socios activos. Idempotente por (cuota, socio, periodo). */
  @Perm('finance:write')
  @Post('fees/:id/issue')
  issue(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(issueSchema)) body: z.infer<typeof issueSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const fee = found(await tx.fee.findUnique({ where: { id } }), 'Cuota');
      if (!fee.active) throw new BadRequestException({ message: 'La cuota está desactivada', code: 'FEE_INACTIVE' });
      const members = await tx.member.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
      const { count } = await tx.feeCharge.createMany({
        data: members.map((m) => ({
          tenantId: ctx.tenantId, feeId: id, memberId: m.id, period: body.period, amountCents: fee.amountCents, dueDate: toDate(body.dueDate),
        })),
        skipDuplicates: true,
      });
      await this.audit.log(tx, ctx, 'fee.issued', 'fee', id, { period: body.period, created: count });
      return { created: count, skipped: members.length - count };
    });
  }

  @Perm('finance:read')
  @Get('charges')
  charges(@Ctx() ctx: RequestContext, @Query(zod(chargesQuery)) q: z.infer<typeof chargesQuery>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const where: Prisma.FeeChargeWhereInput = { status: q.status, period: q.period, memberId: q.memberId };
      const [data, total] = await Promise.all([
        tx.feeCharge.findMany({
          where,
          include: { fee: { select: { name: true } }, member: { select: { id: true, firstName: true, lastName: true, memberNumber: true } } },
          orderBy: [{ dueDate: 'desc' }, { member: { lastName: 'asc' } }],
          ...skipTake(q),
        }),
        tx.feeCharge.count({ where }),
      ]);
      return page(data, total, q);
    });
  }

  /** Cobro de cuota: marca pagada y registra el ingreso en la misma transacción. */
  @Perm('finance:write')
  @HttpCode(200)
  @Post('charges/:id/pay')
  pay(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(paySchema)) body: z.infer<typeof paySchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const charge = found(await tx.feeCharge.findUnique({ where: { id }, include: { fee: true, member: true } }), 'Cuota');
      if (charge.status === 'PAID' || charge.status === 'WAIVED') {
        throw new BadRequestException({ message: 'La cuota ya está cerrada', code: 'CHARGE_CLOSED' });
      }
      const category = await tx.financeCategory.findFirst({ where: { kind: 'INCOME', name: 'Cuotas de socios' } });
      const t = await tx.transaction.create({
        data: {
          tenantId: ctx.tenantId, kind: 'INCOME', amountCents: charge.amountCents, date: toDate(body.date), categoryId: category?.id,
          description: `${charge.fee.name} ${charge.period} · Socio nº ${charge.member.memberNumber}`, memberId: charge.memberId, createdById: ctx.userId,
        },
      });
      const updated = await tx.feeCharge.update({ where: { id }, data: { status: 'PAID', paidAt: new Date(), transactionId: t.id } });
      await this.audit.log(tx, ctx, 'charge.paid', 'fee_charge', id, { amountCents: charge.amountCents });
      return updated;
    });
  }

  @Perm('finance:write')
  @HttpCode(200)
  @Post('charges/:id/waive')
  waive(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const charge = found(await tx.feeCharge.findUnique({ where: { id } }), 'Cuota');
      if (charge.status === 'PAID') throw new BadRequestException({ message: 'La cuota ya está pagada', code: 'CHARGE_CLOSED' });
      const updated = await tx.feeCharge.update({ where: { id }, data: { status: 'WAIVED' } });
      await this.audit.log(tx, ctx, 'charge.waived', 'fee_charge', id);
      return updated;
    });
  }

  @Perm('finance:read')
  @Get('reports/summary')
  summary(@Ctx() ctx: RequestContext, @Query(zod(yearQuery)) q: z.infer<typeof yearQuery>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const from = new Date(Date.UTC(q.year, 0, 1));
      const to = new Date(Date.UTC(q.year + 1, 0, 1));
      const [monthly, byCategory, pending] = await Promise.all([
        tx.$queryRaw<{ month: number; kind: 'INCOME' | 'EXPENSE'; total: bigint }[]>`
          SELECT EXTRACT(MONTH FROM date)::int AS month, kind, SUM("amountCents")::bigint AS total
          FROM transactions WHERE date >= ${from} AND date < ${to} GROUP BY 1, 2`,
        tx.$queryRaw<{ category: string | null; kind: string; total: bigint }[]>`
          SELECT c.name AS category, t.kind::text AS kind, SUM(t."amountCents")::bigint AS total
          FROM transactions t LEFT JOIN finance_categories c ON c.id = t."categoryId"
          WHERE t.date >= ${from} AND t.date < ${to} GROUP BY 1, 2 ORDER BY 3 DESC`,
        tx.feeCharge.aggregate({ where: { status: { in: ['PENDING', 'OVERDUE'] } }, _count: true, _sum: { amountCents: true } }),
      ]);
      const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, incomeCents: 0, expenseCents: 0 }));
      for (const r of monthly) months[r.month - 1][r.kind === 'INCOME' ? 'incomeCents' : 'expenseCents'] = Number(r.total);
      const incomeCents = months.reduce((s, m) => s + m.incomeCents, 0);
      const expenseCents = months.reduce((s, m) => s + m.expenseCents, 0);
      return {
        year: q.year,
        incomeCents,
        expenseCents,
        balanceCents: incomeCents - expenseCents,
        monthly: months,
        byCategory: byCategory.map((c) => ({ category: c.category ?? 'Sin categoría', kind: c.kind, totalCents: Number(c.total) })),
        pendingCharges: { count: pending._count, amountCents: pending._sum.amountCents ?? 0 },
      };
    });
  }

  @Perm('finance:read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Get('reports/transactions.csv')
  async csv(@Ctx() ctx: RequestContext, @Query(zod(yearQuery)) q: z.infer<typeof yearQuery>) {
    const rows = await this.db.tenant(ctx.tenantId, (tx) =>
      tx.transaction.findMany({
        where: { date: { gte: new Date(Date.UTC(q.year, 0, 1)), lt: new Date(Date.UTC(q.year + 1, 0, 1)) } },
        include: { category: true },
        orderBy: { date: 'asc' },
      }),
    );
    const header = ['fecha', 'tipo', 'categoria', 'descripcion', 'importe_eur'];
    const lines = rows.map((r) =>
      [r.date.toISOString().slice(0, 10), r.kind === 'INCOME' ? 'ingreso' : 'gasto', r.category?.name, r.description, ((r.kind === 'INCOME' ? 1 : -1) * r.amountCents / 100).toFixed(2)]
        .map(csvCell)
        .join(';'),
    );
    return '﻿' + [header.join(';'), ...lines].join('\n') + '\n';
  }
}
