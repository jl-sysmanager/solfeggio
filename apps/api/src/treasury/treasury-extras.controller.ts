import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Header, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Donor, TxKind } from '@prisma/client';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, Perm, RequireFeature } from '../auth/decorators';
import { decrypt, encrypt } from '../common/crypto';
import { found } from '../common/errors';
import { cents, idParam, isoDate, optionalText, toDate } from '../common/schemas';
import { zod } from '../common/zod.pipe';
import { Db, Tx } from '../db/db.service';
import { Audit } from '../audit/audit.service';
import { csvCell } from './treasury.controller';

// ── Subvenciones ──
const grantStatus = z.enum(['REQUESTED', 'AWARDED', 'JUSTIFIED', 'CLOSED', 'REJECTED']);
const grantFields = z.object({
  name: z.string().trim().min(1).max(200),
  grantor: z.string().trim().min(1).max(200),
  reference: z.string().trim().max(100).nullable().optional(),
  year: z.number().int().min(2000).max(2100),
  requestedCents: cents.nullable().optional(),
  awardedCents: cents.nullable().optional(),
  awardedAt: isoDate.nullable().optional(),
  justificationDue: isoDate.nullable().optional(),
  status: grantStatus.optional(),
  notes: optionalText(2000),
});
const grantQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional(), status: grantStatus.optional() });
const linkSchema = z.object({ transactionIds: z.array(z.string().uuid()).min(1).max(500), linked: z.boolean() });

// ── Lotería ──
const lotteryNumber = z.string().regex(/^\d{5}$/, 'Número de cinco cifras');
const drawFields = z.object({
  name: z.string().trim().min(1).max(120),
  drawDate: isoDate,
  numbers: z.array(lotteryNumber).min(1).max(20),
  ticketPriceCents: cents.refine((v) => v > 0, 'El precio debe ser mayor que 0'),
  stakeCents: cents.refine((v) => v > 0, 'La cantidad jugada debe ser mayor que 0'),
  notes: optionalText(2000),
});
const STAKE_MSG = { message: 'La cantidad jugada no puede superar el precio de la participación', path: ['stakeCents'] };
const stakeOk = (d: { ticketPriceCents?: number; stakeCents?: number }) => d.ticketPriceCents === undefined || d.stakeCents === undefined || d.stakeCents <= d.ticketPriceCents;
const bookFields = z.object({
  code: z.string().trim().min(1).max(40),
  number: lotteryNumber.nullable().optional(),
  memberId: z.string().uuid().nullable().optional(),
  holderName: z.string().trim().max(120).nullable().optional(),
  tickets: z.number().int().min(1).max(10_000),
});
const HOLDER_MSG = { message: 'Indica el socio o el nombre de quien lleva el talonario', path: ['holderName'] };
const settleSchema = z.object({ returnedTickets: z.number().int().min(0).max(10_000), paidCents: cents, date: isoDate });

// ── Donantes ──
const donorFields = z.object({
  kind: z.enum(['PERSON', 'COMPANY']).default('PERSON'),
  name: z.string().trim().min(1).max(200),
  taxId: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{8,12}$/, 'NIF no válido').nullable().optional(),
  address: optionalText(300),
  postalCode: z.string().trim().regex(/^\d{5}$/, 'Código postal de 5 cifras').nullable().optional(),
  province: z.string().regex(/^(0[1-9]|[1-4]\d|5[0-2])$/, 'Código de provincia de dos cifras (01-52)').nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  memberId: z.string().uuid().nullable().optional(),
  sponsor: z.boolean().optional(),
});
const donationFields = z.object({
  kind: z.enum(['DONATION', 'SPONSORSHIP']).default('DONATION'),
  date: isoDate,
  amountCents: cents.refine((v) => v > 0, 'El importe debe ser mayor que 0'),
  inKind: z.boolean().default(false),
  description: optionalText(300),
});
const donationCreate = donationFields.extend({ createTransaction: z.boolean().default(false) });
const donationQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional(), donorId: z.string().uuid().optional() });
const yearQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100).default(new Date().getUTCFullYear()) });

const conflict = (message: string, code: string) => new ConflictException({ message, code });
const bad = (message: string, code: string) => new BadRequestException({ message, code });
const DAY = 86_400_000;
const yearRange = (y: number) => ({ gte: new Date(Date.UTC(y, 0, 1)), lt: new Date(Date.UTC(y + 1, 0, 1)) });
const todayUtc = () => toDate(new Date().toISOString().slice(0, 10));
const eur = (c: number) => (c / 100).toFixed(2);
const optDate = (d: string | null | undefined) => (d === undefined ? undefined : d ? toDate(d) : null);
const memberSelect = { id: true, firstName: true, lastName: true, memberNumber: true } as const;

async function categoryId(tx: Tx, tenantId: string, name: string, kind: TxKind) {
  const c = await tx.financeCategory.upsert({ where: { tenantId_name_kind: { tenantId, name, kind } }, create: { tenantId, name, kind }, update: {} });
  return c.id;
}

/** El NIF nunca sale cifrado; descifrado sólo con `members:sensitive`. */
function serializeDonor(d: Donor, ctx: RequestContext) {
  const { taxIdEnc, ...rest } = d;
  return { ...rest, taxId: ctx.permissions.has('members:sensitive') ? decrypt(taxIdEnc) : undefined, hasTaxId: !!taxIdEnc };
}

function donorData(body: Partial<z.infer<typeof donorFields>>, ctx: RequestContext) {
  const { taxId, ...rest } = body;
  if (taxId !== undefined && !ctx.permissions.has('members:sensitive')) throw new ForbiddenException({ message: 'No puedes modificar el NIF', code: 'FORBIDDEN' });
  return {
    ...rest,
    // La provincia se deduce del código postal si no se indica.
    ...(rest.province === undefined && rest.postalCode && { province: rest.postalCode.slice(0, 2) }),
    ...(taxId !== undefined && { taxIdEnc: encrypt(taxId), taxIdHint: taxId ? taxId.slice(-3) : null }),
  };
}

function lotterySummary(draw: { ticketPriceCents: number; stakeCents: number }, books: { code: string; memberId: string | null; holderName: string | null; member?: { firstName: string; lastName: string } | null; tickets: number; returnedTickets: number; paidCents: number }[]) {
  let issued = 0, returned = 0, collected = 0, pending = 0;
  const holders = new Map<string, { memberId: string | null; name: string; books: string[]; pendingCents: number }>();
  for (const b of books) {
    const expected = (b.tickets - b.returnedTickets) * draw.ticketPriceCents;
    const due = Math.max(0, expected - b.paidCents);
    issued += b.tickets;
    returned += b.returnedTickets;
    collected += b.paidCents;
    pending += due;
    if (due > 0) {
      const key = b.memberId ?? `h:${b.holderName ?? ''}`;
      const name = b.member ? `${b.member.firstName} ${b.member.lastName}` : b.holderName ?? '—';
      const h = holders.get(key) ?? { memberId: b.memberId, name, books: [], pendingCents: 0 };
      h.books.push(b.code);
      h.pendingCents += due;
      holders.set(key, h);
    }
  }
  const sold = issued - returned;
  return {
    books: books.length,
    ticketsIssued: issued,
    ticketsReturned: returned,
    ticketsSold: sold,
    expectedCents: sold * draw.ticketPriceCents,
    collectedCents: collected,
    pendingCents: pending,
    // A la administración se le paga lo jugado; el recargo queda como donativo para la banda.
    payToAdministrationCents: sold * draw.stakeCents,
    surchargeCents: sold * (draw.ticketPriceCents - draw.stakeCents),
    pendingByHolder: [...holders.values()].sort((a, b) => b.pendingCents - a.pendingCents),
  };
}

@ApiTags('treasury')
@ApiBearerAuth()
@RequireFeature('treasury')
@Controller('finance')
export class TreasuryExtrasController {
  constructor(
    private readonly db: Db,
    private readonly audit: Audit,
  ) {}

  // ───────────── Subvenciones ─────────────

  @Perm('finance:read')
  @Get('grants')
  grants(@Ctx() ctx: RequestContext, @Query(zod(grantQuery)) q: z.infer<typeof grantQuery>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const grants = await tx.grant.findMany({ where: { year: q.year, status: q.status }, orderBy: [{ year: 'desc' }, { name: 'asc' }] });
      const sums = await tx.transaction.groupBy({ by: ['grantId', 'kind'], where: { grantId: { in: grants.map((g) => g.id) } }, _sum: { amountCents: true } });
      const sum = (id: string, kind: TxKind) => sums.find((s) => s.grantId === id && s.kind === kind)?._sum.amountCents ?? 0;
      const today = todayUtc();
      const soon = new Date(today.getTime() + 30 * DAY);
      return grants.map((g) => {
        const pendingStatus = g.status === 'REQUESTED' || g.status === 'AWARDED';
        return {
          ...g,
          expensesCents: sum(g.id, 'EXPENSE'),
          incomesCents: sum(g.id, 'INCOME'),
          dueSoon: pendingStatus && !!g.justificationDue && g.justificationDue >= today && g.justificationDue <= soon,
          overdue: pendingStatus && !!g.justificationDue && g.justificationDue < today,
        };
      });
    });
  }

  @Perm('finance:write')
  @Post('grants')
  createGrant(@Ctx() ctx: RequestContext, @Body(zod(grantFields)) body: z.infer<typeof grantFields>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const g = await tx.grant.create({ data: { ...body, awardedAt: optDate(body.awardedAt), justificationDue: optDate(body.justificationDue), tenantId: ctx.tenantId } });
      await this.audit.log(tx, ctx, 'grant.created', 'grant', g.id, { name: g.name, status: g.status });
      return g;
    });
  }

  @Perm('finance:read')
  @Get('grants/:id')
  grant(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) =>
      found(await tx.grant.findUnique({ where: { id }, include: { transactions: { include: { category: true }, orderBy: { date: 'asc' } } } }), 'Subvención'),
    );
  }

  @Perm('finance:write')
  @Patch('grants/:id')
  updateGrant(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(grantFields.partial())) body: Partial<z.infer<typeof grantFields>>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.grant.findUnique({ where: { id } }), 'Subvención');
      const g = await tx.grant.update({ where: { id }, data: { ...body, awardedAt: optDate(body.awardedAt), justificationDue: optDate(body.justificationDue) } });
      await this.audit.log(tx, ctx, 'grant.updated', 'grant', id, { fields: Object.keys(body), status: g.status });
      return g;
    });
  }

  @Perm('finance:write')
  @HttpCode(204)
  @Delete('grants/:id')
  async deleteGrant(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    await this.db.tenant(ctx.tenantId, async (tx) => {
      const g = found(await tx.grant.findUnique({ where: { id } }), 'Subvención');
      // Los movimientos se conservan; sólo pierden la imputación (ON DELETE SET NULL).
      await tx.grant.delete({ where: { id } });
      await this.audit.log(tx, ctx, 'grant.deleted', 'grant', id, { name: g.name });
    });
  }

  /** Imputa (o desimputa) movimientos a la subvención. */
  @Perm('finance:write')
  @HttpCode(200)
  @Post('grants/:id/transactions')
  link(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(linkSchema)) body: z.infer<typeof linkSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.grant.findUnique({ where: { id } }), 'Subvención');
      const ids = [...new Set(body.transactionIds)];
      const txs = await tx.transaction.findMany({ where: { id: { in: ids } }, select: { id: true, grantId: true } });
      if (txs.length !== ids.length) found(null, 'Movimiento');
      if (body.linked) {
        if (txs.some((t) => t.grantId && t.grantId !== id)) throw conflict('Algún movimiento ya está imputado a otra subvención', 'TX_LINKED_OTHER_GRANT');
        await tx.transaction.updateMany({ where: { id: { in: ids } }, data: { grantId: id } });
      } else {
        await tx.transaction.updateMany({ where: { id: { in: ids }, grantId: id }, data: { grantId: null } });
      }
      await this.audit.log(tx, ctx, body.linked ? 'grant.linked' : 'grant.unlinked', 'grant', id, { transactions: ids.length });
      return this.justificationOf(tx, id);
    });
  }

  @Perm('finance:read')
  @Get('grants/:id/justification')
  justification(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, (tx) => this.justificationOf(tx, id));
  }

  @Perm('finance:read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Get('grants/:id/justification.csv')
  async justificationCsv(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    const j = await this.db.tenant(ctx.tenantId, (tx) => this.justificationOf(tx, id));
    const lines = [
      ['subvencion', j.grant.name],
      ['organismo', j.grant.grantor],
      ['referencia', j.grant.reference],
      ['concedido_eur', eur(j.awardedCents)],
      ['gastos_imputados_eur', eur(j.expensesCents)],
      ['pendiente_justificar_eur', eur(j.pendingCents)],
      [],
      ['fecha', 'concepto', 'categoria', 'importe_eur'],
      ...j.expenses.map((t) => [t.date.toISOString().slice(0, 10), t.description, t.category?.name, eur(t.amountCents)]),
    ];
    return '﻿' + lines.map((l) => l.map(csvCell).join(';')).join('\n') + '\n';
  }

  private async justificationOf(tx: Tx, id: string) {
    const grant = found(await tx.grant.findUnique({ where: { id } }), 'Subvención');
    const txs = await tx.transaction.findMany({ where: { grantId: id }, include: { category: true }, orderBy: { date: 'asc' } });
    const expenses = txs.filter((t) => t.kind === 'EXPENSE');
    const expensesCents = expenses.reduce((s, t) => s + t.amountCents, 0);
    const incomesCents = txs.filter((t) => t.kind === 'INCOME').reduce((s, t) => s + t.amountCents, 0);
    const awardedCents = grant.awardedCents ?? 0;
    return { grant, awardedCents, expensesCents, incomesCents, pendingCents: Math.max(0, awardedCents - expensesCents), expenses, incomes: txs.filter((t) => t.kind === 'INCOME') };
  }

  // ───────────── Lotería de Navidad ─────────────

  @Perm('finance:read')
  @Get('lottery/draws')
  draws(@Ctx() ctx: RequestContext) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const draws = await tx.lotteryDraw.findMany({ orderBy: { drawDate: 'desc' }, include: { books: { include: { member: { select: memberSelect } } } } });
      return draws.map(({ books, ...d }) => ({ ...d, summary: lotterySummary(d, books) }));
    });
  }

  @Perm('finance:write')
  @Post('lottery/draws')
  createDraw(@Ctx() ctx: RequestContext, @Body(zod(drawFields.refine(stakeOk, STAKE_MSG))) body: z.infer<typeof drawFields>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      if (await tx.lotteryDraw.findFirst({ where: { name: body.name } })) throw conflict('Ya existe un sorteo con ese nombre', 'DUPLICATE');
      const d = await tx.lotteryDraw.create({ data: { ...body, drawDate: toDate(body.drawDate), tenantId: ctx.tenantId } });
      await this.audit.log(tx, ctx, 'lottery.draw_created', 'lottery_draw', d.id, { name: d.name });
      return d;
    });
  }

  @Perm('finance:read')
  @Get('lottery/draws/:id')
  draw(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const d = found(await tx.lotteryDraw.findUnique({ where: { id }, include: { books: { include: { member: { select: memberSelect } }, orderBy: { code: 'asc' } } } }), 'Sorteo');
      return { ...d, summary: lotterySummary(d, d.books) };
    });
  }

  @Perm('finance:read')
  @Get('lottery/draws/:id/summary')
  drawSummary(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const d = found(await tx.lotteryDraw.findUnique({ where: { id }, include: { books: { include: { member: { select: memberSelect } } } } }), 'Sorteo');
      return lotterySummary(d, d.books);
    });
  }

  @Perm('finance:write')
  @Patch('lottery/draws/:id')
  updateDraw(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(drawFields.partial())) body: Partial<z.infer<typeof drawFields>>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const d = found(await tx.lotteryDraw.findUnique({ where: { id } }), 'Sorteo');
      if (!stakeOk({ ticketPriceCents: body.ticketPriceCents ?? d.ticketPriceCents, stakeCents: body.stakeCents ?? d.stakeCents })) throw bad(STAKE_MSG.message, 'VALIDATION_ERROR');
      const priceChange = (body.ticketPriceCents ?? d.ticketPriceCents) !== d.ticketPriceCents || (body.stakeCents ?? d.stakeCents) !== d.stakeCents;
      if (priceChange && (await tx.lotteryBook.count({ where: { drawId: id, paidCents: { gt: 0 } } }))) {
        throw conflict('No se puede cambiar el precio con talonarios ya liquidados', 'DRAW_HAS_PAYMENTS');
      }
      const updated = await tx.lotteryDraw.update({ where: { id }, data: { ...body, drawDate: body.drawDate ? toDate(body.drawDate) : undefined } });
      await this.audit.log(tx, ctx, 'lottery.draw_updated', 'lottery_draw', id, { fields: Object.keys(body) });
      return updated;
    });
  }

  @Perm('finance:write')
  @HttpCode(204)
  @Delete('lottery/draws/:id')
  async deleteDraw(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    await this.db.tenant(ctx.tenantId, async (tx) => {
      const d = found(await tx.lotteryDraw.findUnique({ where: { id } }), 'Sorteo');
      if (await tx.lotteryBook.count({ where: { drawId: id, paidCents: { gt: 0 } } })) throw conflict('El sorteo tiene talonarios liquidados', 'DRAW_HAS_PAYMENTS');
      await tx.lotteryDraw.delete({ where: { id } });
      await this.audit.log(tx, ctx, 'lottery.draw_deleted', 'lottery_draw', id, { name: d.name });
    });
  }

  @Perm('finance:write')
  @Post('lottery/draws/:id/books')
  createBook(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(bookFields.refine((b) => !!b.memberId || !!b.holderName, HOLDER_MSG))) body: z.infer<typeof bookFields>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const d = found(await tx.lotteryDraw.findUnique({ where: { id } }), 'Sorteo');
      if (body.number && !d.numbers.includes(body.number)) throw bad('El número no corresponde a este sorteo', 'INVALID_NUMBER');
      if (body.memberId) found(await tx.member.findUnique({ where: { id: body.memberId } }), 'Socio');
      if (await tx.lotteryBook.findFirst({ where: { drawId: id, code: body.code } })) throw conflict('Ya existe un talonario con ese código', 'DUPLICATE');
      const b = await tx.lotteryBook.create({ data: { ...body, drawId: id, tenantId: ctx.tenantId }, include: { member: { select: memberSelect } } });
      await this.audit.log(tx, ctx, 'lottery.book_issued', 'lottery_book', b.id, { code: b.code, tickets: b.tickets });
      return b;
    });
  }

  @Perm('finance:write')
  @Patch('lottery/books/:id')
  updateBook(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(bookFields.partial())) body: Partial<z.infer<typeof bookFields>>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const b = found(await tx.lotteryBook.findUnique({ where: { id }, include: { draw: true } }), 'Talonario');
      if (body.number && !b.draw.numbers.includes(body.number)) throw bad('El número no corresponde a este sorteo', 'INVALID_NUMBER');
      if (body.memberId) found(await tx.member.findUnique({ where: { id: body.memberId } }), 'Socio');
      if (body.tickets !== undefined && body.tickets < b.returnedTickets) throw bad('Hay más participaciones devueltas que entregadas', 'INVALID_TICKETS');
      const memberId = body.memberId !== undefined ? body.memberId : b.memberId;
      const holderName = body.holderName !== undefined ? body.holderName : b.holderName;
      if (!memberId && !holderName) throw bad(HOLDER_MSG.message, 'VALIDATION_ERROR');
      return tx.lotteryBook.update({ where: { id }, data: body, include: { member: { select: memberSelect } } });
    });
  }

  @Perm('finance:write')
  @HttpCode(204)
  @Delete('lottery/books/:id')
  async deleteBook(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    await this.db.tenant(ctx.tenantId, async (tx) => {
      const b = found(await tx.lotteryBook.findUnique({ where: { id } }), 'Talonario');
      if (b.paidCents > 0) throw conflict('El talonario tiene cobros registrados', 'BOOK_HAS_PAYMENTS');
      await tx.lotteryBook.delete({ where: { id } });
      await this.audit.log(tx, ctx, 'lottery.book_deleted', 'lottery_book', id, { code: b.code });
    });
  }

  /**
   * Liquidación del talonario: fija las participaciones devueltas y registra lo cobrado como ingreso
   * en la categoría «Lotería». Admite liquidaciones parciales sucesivas.
   */
  @Perm('finance:write')
  @HttpCode(200)
  @Post('lottery/books/:id/settle')
  settle(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(settleSchema)) body: z.infer<typeof settleSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const b = found(await tx.lotteryBook.findUnique({ where: { id }, include: { draw: true, member: { select: memberSelect } } }), 'Talonario');
      if (body.returnedTickets > b.tickets) throw bad('Hay más participaciones devueltas que entregadas', 'INVALID_TICKETS');
      const expected = (b.tickets - body.returnedTickets) * b.draw.ticketPriceCents;
      if (b.paidCents + body.paidCents > expected) throw bad('El importe cobrado supera el de las participaciones vendidas', 'OVERPAID');
      let transactionId = b.transactionId;
      if (body.paidCents > 0) {
        const holder = b.member ? `${b.member.firstName} ${b.member.lastName}` : b.holderName;
        const t = await tx.transaction.create({
          data: {
            tenantId: ctx.tenantId, kind: 'INCOME', amountCents: body.paidCents, date: toDate(body.date),
            categoryId: await categoryId(tx, ctx.tenantId, 'Lotería', 'INCOME'),
            description: `Lotería ${b.draw.name} · talonario ${b.code}${holder ? ` (${holder})` : ''}`,
            memberId: b.memberId, createdById: ctx.userId,
          },
        });
        transactionId = t.id;
      }
      const updated = await tx.lotteryBook.update({
        where: { id },
        data: { returnedTickets: body.returnedTickets, paidCents: b.paidCents + body.paidCents, settledAt: new Date(), transactionId },
        include: { member: { select: memberSelect } },
      });
      await this.audit.log(tx, ctx, 'lottery.book_settled', 'lottery_book', id, { returnedTickets: body.returnedTickets, paidCents: body.paidCents });
      return updated;
    });
  }

  // ───────────── Socios protectores, donantes y patrocinadores ─────────────

  @Perm('finance:read')
  @Get('donors')
  donors(@Ctx() ctx: RequestContext) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const donors = await tx.donor.findMany({ orderBy: { name: 'asc' } });
      const year = new Date().getUTCFullYear();
      const sums = await tx.donation.groupBy({ by: ['donorId'], where: { date: yearRange(year) }, _sum: { amountCents: true } });
      return donors.map((d) => ({ ...serializeDonor(d, ctx), yearTotalCents: sums.find((s) => s.donorId === d.id)?._sum.amountCents ?? 0 }));
    });
  }

  @Perm('finance:write')
  @Post('donors')
  createDonor(@Ctx() ctx: RequestContext, @Body(zod(donorFields)) body: z.infer<typeof donorFields>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      if (body.memberId) found(await tx.member.findUnique({ where: { id: body.memberId } }), 'Socio');
      const d = await tx.donor.create({ data: { ...donorData(body, ctx), kind: body.kind, name: body.name, tenantId: ctx.tenantId } });
      await this.audit.log(tx, ctx, 'donor.created', 'donor', d.id, { fields: Object.keys(body) });
      return serializeDonor(d, ctx);
    });
  }

  @Perm('finance:read')
  @Get('donors/:id')
  donor(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const { donations, ...d } = found(await tx.donor.findUnique({ where: { id }, include: { donations: { orderBy: { date: 'desc' } } } }), 'Donante');
      return { ...serializeDonor(d, ctx), donations };
    });
  }

  @Perm('finance:write')
  @Patch('donors/:id')
  updateDonor(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(donorFields.partial())) body: Partial<z.infer<typeof donorFields>>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.donor.findUnique({ where: { id } }), 'Donante');
      if (body.memberId) found(await tx.member.findUnique({ where: { id: body.memberId } }), 'Socio');
      const d = await tx.donor.update({ where: { id }, data: donorData(body, ctx) });
      await this.audit.log(tx, ctx, 'donor.updated', 'donor', id, { fields: Object.keys(body) });
      return serializeDonor(d, ctx);
    });
  }

  @Perm('finance:write')
  @HttpCode(204)
  @Delete('donors/:id')
  async deleteDonor(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    await this.db.tenant(ctx.tenantId, async (tx) => {
      const d = found(await tx.donor.findUnique({ where: { id } }), 'Donante');
      await tx.donor.delete({ where: { id } });
      await this.audit.log(tx, ctx, 'donor.deleted', 'donor', id, { name: d.name });
    });
  }

  @Perm('finance:read')
  @Get('donations')
  donations(@Ctx() ctx: RequestContext, @Query(zod(donationQuery)) q: z.infer<typeof donationQuery>) {
    return this.db.tenant(ctx.tenantId, (tx) =>
      tx.donation.findMany({
        where: { donorId: q.donorId, date: q.year ? yearRange(q.year) : undefined },
        include: { donor: { select: { id: true, name: true, kind: true, sponsor: true } } },
        orderBy: { date: 'desc' },
        take: 1000,
      }),
    );
  }

  /** Registra un donativo o patrocinio; con `createTransaction` anota también el ingreso en caja. */
  @Perm('finance:write')
  @Post('donors/:id/donations')
  createDonation(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(donationCreate)) body: z.infer<typeof donationCreate>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const donor = found(await tx.donor.findUnique({ where: { id } }), 'Donante');
      const { createTransaction, ...data } = body;
      if (createTransaction && data.inKind) throw bad('Una donación en especie no genera ingreso en caja', 'IN_KIND_NO_TRANSACTION');
      let transactionId: string | null = null;
      if (createTransaction) {
        const t = await tx.transaction.create({
          data: {
            tenantId: ctx.tenantId, kind: 'INCOME', amountCents: data.amountCents, date: toDate(data.date),
            categoryId: await categoryId(tx, ctx.tenantId, data.kind === 'DONATION' ? 'Donativos' : 'Patrocinios', 'INCOME'),
            description: `${data.kind === 'DONATION' ? 'Donativo' : 'Patrocinio'} · ${donor.name}`,
            memberId: donor.memberId, createdById: ctx.userId,
          },
        });
        transactionId = t.id;
      }
      const d = await tx.donation.create({ data: { ...data, date: toDate(data.date), donorId: id, transactionId, tenantId: ctx.tenantId } });
      await this.audit.log(tx, ctx, 'donation.created', 'donation', d.id, { kind: d.kind, amountCents: d.amountCents, transaction: !!transactionId });
      return d;
    });
  }

  @Perm('finance:write')
  @Patch('donations/:id')
  updateDonation(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(donationFields.partial())) body: Partial<z.infer<typeof donationFields>>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const d = found(await tx.donation.findUnique({ where: { id } }), 'Donación');
      // Con ingreso en caja asociado, el importe y la fecha se corrigen desde el movimiento.
      if (d.transactionId && (body.amountCents !== undefined || body.date !== undefined || body.inKind)) {
        throw conflict('La donación tiene un movimiento de caja asociado', 'DONATION_LINKED');
      }
      const updated = await tx.donation.update({ where: { id }, data: { ...body, date: body.date ? toDate(body.date) : undefined } });
      await this.audit.log(tx, ctx, 'donation.updated', 'donation', id, { fields: Object.keys(body) });
      return updated;
    });
  }

  @Perm('finance:write')
  @HttpCode(204)
  @Delete('donations/:id')
  async deleteDonation(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    await this.db.tenant(ctx.tenantId, async (tx) => {
      const d = found(await tx.donation.findUnique({ where: { id } }), 'Donación');
      // El movimiento de caja, si lo hay, se conserva: se elimina desde Movimientos.
      await tx.donation.delete({ where: { id } });
      await this.audit.log(tx, ctx, 'donation.deleted', 'donation', id, { amountCents: d.amountCents });
    });
  }

  /** Datos del certificado de donativos del año (art. 24 Ley 49/2002) para imprimir. */
  @Perm('finance:read')
  @Get('donors/:id/certificate')
  certificate(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Query(zod(yearQuery)) q: z.infer<typeof yearQuery>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const donor = found(await tx.donor.findUnique({ where: { id } }), 'Donante');
      const tenant = found(await tx.tenant.findUnique({ where: { id: ctx.tenantId } }), 'Banda');
      const donations = await tx.donation.findMany({ where: { donorId: id, kind: 'DONATION', date: yearRange(q.year) }, orderBy: { date: 'asc' } });
      return {
        year: q.year,
        issuedAt: new Date().toISOString(),
        entity: { name: tenant.name, legalName: tenant.legalName, taxId: tenant.taxId },
        donor: serializeDonor(donor, ctx),
        donations: donations.map((d) => ({ id: d.id, date: d.date, amountCents: d.amountCents, inKind: d.inKind, description: d.description })),
        totalCents: donations.reduce((s, d) => s + d.amountCents, 0),
        irrevocable: true,
      };
    });
  }

  /**
   * Datos para que el gestor prepare el modelo 182 (declaración informativa de donativos). Sólo
   * entidades acogidas a la Ley 49/2002; no es el fichero en formato AEAT.
   * - naturaleza: F persona física, J persona jurídica.
   * - clave: «A», donativos del art. 17 Ley 49/2002 (no se distinguen actividades prioritarias de mecenazgo).
   * - recurrente: donó a esta entidad en cada uno de los dos años anteriores (el gestor debe comprobar
   *   que el importe fue igual o superior, requisito de la deducción incrementada).
   * Se excluyen los patrocinios (convenio de colaboración empresarial, no donativo).
   */
  @Perm('finance:read', 'members:sensitive')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Get('reports/modelo182.csv')
  async modelo182(@Ctx() ctx: RequestContext, @Query(zod(yearQuery)) q: z.infer<typeof yearQuery>) {
    const rows = await this.db.tenant(ctx.tenantId, async (tx) => {
      const donations = await tx.donation.findMany({
        where: { kind: 'DONATION', date: { gte: new Date(Date.UTC(q.year - 2, 0, 1)), lt: new Date(Date.UTC(q.year + 1, 0, 1)) } },
        include: { donor: true },
      });
      await this.audit.log(tx, ctx, 'report.modelo182', 'donor', null, { year: q.year });
      return donations;
    });
    const years = new Map<string, Set<number>>();
    const agg = new Map<string, { donor: Donor; inKind: boolean; cents: number }>();
    for (const d of rows) {
      const y = d.date.getUTCFullYear();
      if (!years.has(d.donorId)) years.set(d.donorId, new Set());
      years.get(d.donorId)!.add(y);
      if (y !== q.year) continue;
      const key = `${d.donorId}:${d.inKind}`;
      const a = agg.get(key) ?? { donor: d.donor, inKind: d.inKind, cents: 0 };
      a.cents += d.amountCents;
      agg.set(key, a);
    }
    const header = ['nif', 'nombre', 'naturaleza', 'provincia', 'clave', 'importe_eur', 'en_especie', 'recurrente', 'avisos'];
    const lines = [...agg.values()]
      .sort((a, b) => a.donor.name.localeCompare(b.donor.name, 'es'))
      .map(({ donor, inKind, cents: c }) => {
        const prev = years.get(donor.id)!;
        const warnings = [!donor.taxIdEnc && 'Falta NIF', !donor.province && 'Falta provincia'].filter(Boolean).join(', ');
        return [decrypt(donor.taxIdEnc), donor.name, donor.kind === 'COMPANY' ? 'J' : 'F', donor.province, 'A', eur(c), inKind ? 'S' : 'N', prev.has(q.year - 1) && prev.has(q.year - 2) ? 'S' : 'N', warnings]
          .map(csvCell)
          .join(';');
      });
    const notice = csvCell(`Datos para el gestor del modelo 182 (${q.year}). Sólo entidades acogidas a la Ley 49/2002. No es el fichero oficial de la AEAT.`);
    return '﻿' + [notice, header.join(';'), ...lines].join('\n') + '\n';
  }
}

