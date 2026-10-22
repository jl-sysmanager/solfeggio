import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClientInvoice, Prisma } from '@prisma/client';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, Perm, RequireFeature } from '../auth/decorators';
import { found } from '../common/errors';
import { idParam, isoDate, isoDateTime, optionalText, toDate } from '../common/schemas';
import { zod } from '../common/zod.pipe';
import { Db, Tx } from '../db/db.service';
import { Audit } from '../audit/audit.service';
import { ClientSnapshot, ensureCategory, invoiceHash, Line, lineSchema, retryUnique, totals } from './util';

/** Los formularios envían '' en campos vacíos: se tratan como null. */
const blankToNull = (v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, typeof x === 'string' && x.trim() === '' ? null : x]))
    : v;

const clientFields = z.object({
  name: z.string().trim().min(1).max(160),
  kind: z.enum(['CITY_COUNCIL', 'BROTHERHOOD', 'FESTIVAL_COMMITTEE', 'PRIVATE', 'OTHER']).optional(),
  taxId: z.string().trim().toUpperCase().max(20).nullable().optional(),
  email: z.string().email().max(254).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  address: optionalText(300),
  contactName: optionalText(120),
  notes: optionalText(2000),
});
const clientCreate = z.preprocess(blankToNull, clientFields);
const clientPatch = z.preprocess(blankToNull, clientFields.partial());
const clientsQuery = z.object({ q: z.string().trim().max(100).optional() });

const taxRate = z.number().int().min(0).max(100);
const quoteFields = z.object({
  clientId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  performanceAt: isoDateTime.nullable().optional(),
  location: optionalText(200),
  lines: z.array(lineSchema.extend({ unitCents: z.number().int().min(0).max(100_000_000) })).min(1).max(50),
  taxRatePct: taxRate.default(0),
  validUntil: isoDate.nullable().optional(),
  contractTerms: optionalText(20_000),
  notes: optionalText(2000),
});
const quotePatch = quoteFields.partial().extend({ taxRatePct: taxRate.optional() });
const quotesQuery = z.object({
  status: z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED']).optional(),
  clientId: z.string().uuid().optional(),
});
const signSchema = z.object({ signedBy: z.string().trim().min(2).max(160), contractTerms: optionalText(20_000) });
const quoteEventSchema = z
  .object({ startsAt: isoDateTime.optional(), endsAt: isoDateTime.optional() })
  .refine((e) => !e.startsAt || !e.endsAt || new Date(e.endsAt) > new Date(e.startsAt), { message: 'La hora de fin debe ser posterior al inicio', path: ['endsAt'] });

const series = z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,10}$/, 'Serie: letras, números o guiones');
const invoiceSchema = z.union([
  z.object({ quoteId: z.string().uuid(), series: series.default('A'), issueDate: isoDate.optional() }),
  z.object({
    clientId: z.string().uuid(),
    lines: z.array(lineSchema).min(1).max(50),
    taxRatePct: taxRate.default(0),
    series: series.default('A'),
    issueDate: isoDate.optional(),
  }),
]);
const invoicesQuery = z.object({
  series: series.optional(),
  status: z.enum(['ISSUED', 'PAID', 'CANCELLED']).optional(),
  clientId: z.string().uuid().optional(),
});
const rectifySchema = z.object({
  reason: z.string().trim().min(3).max(300),
  series: series.default('R'),
  /** Importes positivos a rectificar; por defecto, todas las líneas de la factura original. */
  lines: z.array(lineSchema.extend({ unitCents: z.number().int().min(0).max(100_000_000) })).min(1).max(50).optional(),
  issueDate: isoDate.optional(),
});
const paySchema = z.object({ date: isoDate });
const verifyQuery = z.object({ series: series.default('A') });

const today = () => new Date().toISOString().slice(0, 10);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

@ApiTags('performances')
@ApiBearerAuth()
@RequireFeature('performances')
@Controller('performances')
export class PerformancesController {
  constructor(
    private readonly db: Db,
    private readonly audit: Audit,
  ) {}

  // ── Clientes ──────────────────────────────────────────────────────────────

  @Perm('performances:read')
  @Get('clients')
  clients(@Ctx() ctx: RequestContext, @Query(zod(clientsQuery)) q: z.infer<typeof clientsQuery>) {
    return this.db.tenant(ctx.tenantId, (tx) =>
      tx.client.findMany({
        where: q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { taxId: { contains: q.q, mode: 'insensitive' } }] } : undefined,
        include: { _count: { select: { quotes: true, invoices: true } } },
        orderBy: { name: 'asc' },
        take: 500,
      }),
    );
  }

  @Perm('performances:write')
  @Post('clients')
  createClient(@Ctx() ctx: RequestContext, @Body(zod(clientCreate)) body: z.infer<typeof clientCreate>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const c = await tx.client.create({ data: { ...body, tenantId: ctx.tenantId } });
      await this.audit.log(tx, ctx, 'client.created', 'client', c.id, { name: c.name });
      return c;
    });
  }

  @Perm('performances:read')
  @Get('clients/:id')
  client(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) =>
      found(
        await tx.client.findUnique({
          where: { id },
          include: {
            quotes: { orderBy: { number: 'desc' }, take: 100 },
            invoices: { orderBy: [{ series: 'asc' }, { number: 'desc' }], take: 100 },
          },
        }),
        'Cliente',
      ),
    );
  }

  @Perm('performances:write')
  @Patch('clients/:id')
  updateClient(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(clientPatch)) body: z.infer<typeof clientPatch>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.client.findUnique({ where: { id } }), 'Cliente');
      const c = await tx.client.update({ where: { id }, data: body });
      await this.audit.log(tx, ctx, 'client.updated', 'client', id, { fields: Object.keys(body) });
      return c;
    });
  }

  @Perm('performances:write')
  @HttpCode(204)
  @Delete('clients/:id')
  async deleteClient(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    await this.db.tenant(ctx.tenantId, async (tx) => {
      const c = found(await tx.client.findUnique({ where: { id }, include: { _count: { select: { quotes: true, invoices: true } } } }), 'Cliente');
      if (c._count.quotes || c._count.invoices) {
        throw new BadRequestException({ message: 'El cliente tiene presupuestos o facturas', code: 'CLIENT_IN_USE' });
      }
      await tx.client.delete({ where: { id } });
      await this.audit.log(tx, ctx, 'client.deleted', 'client', id, { name: c.name });
    });
  }

  // ── Presupuestos y contratos ──────────────────────────────────────────────

  @Perm('performances:read')
  @Get('quotes')
  quotes(@Ctx() ctx: RequestContext, @Query(zod(quotesQuery)) q: z.infer<typeof quotesQuery>) {
    return this.db.tenant(ctx.tenantId, (tx) =>
      tx.performanceQuote.findMany({
        where: { status: q.status, clientId: q.clientId },
        include: { client: { select: { id: true, name: true } }, event: { select: { id: true, title: true, startsAt: true } } },
        orderBy: { number: 'desc' },
        take: 500,
      }),
    );
  }

  @Perm('performances:read')
  @Get('quotes/:id')
  quote(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) =>
      found(
        await tx.performanceQuote.findUnique({
          where: { id },
          include: {
            client: true,
            event: { select: { id: true, title: true, startsAt: true, status: true } },
            invoices: { select: { id: true, series: true, number: true, status: true, totalCents: true } },
          },
        }),
        'Presupuesto',
      ),
    );
  }

  @Perm('performances:write')
  @Post('quotes')
  createQuote(@Ctx() ctx: RequestContext, @Body(zod(quoteFields)) body: z.infer<typeof quoteFields>) {
    return retryUnique(() =>
      this.db.tenant(ctx.tenantId, async (tx) => {
        found(await tx.client.findUnique({ where: { id: body.clientId } }), 'Cliente');
        const last = await tx.performanceQuote.aggregate({ _max: { number: true } });
        const q = await tx.performanceQuote.create({
          data: {
            ...body,
            ...totals(body.lines, body.taxRatePct),
            lines: body.lines as Prisma.InputJsonValue,
            performanceAt: body.performanceAt ? new Date(body.performanceAt) : null,
            validUntil: body.validUntil ? toDate(body.validUntil) : null,
            tenantId: ctx.tenantId,
            number: (last._max.number ?? 0) + 1,
          },
        });
        await this.audit.log(tx, ctx, 'quote.created', 'performance_quote', q.id, { number: q.number, totalCents: q.totalCents });
        return q;
      }),
    );
  }

  @Perm('performances:write')
  @Patch('quotes/:id')
  updateQuote(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(quotePatch)) body: z.infer<typeof quotePatch>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const q = found(await tx.performanceQuote.findUnique({ where: { id } }), 'Presupuesto');
      if (q.status !== 'DRAFT') throw new BadRequestException({ message: 'Sólo se pueden editar presupuestos en borrador', code: 'QUOTE_LOCKED' });
      if (body.clientId) found(await tx.client.findUnique({ where: { id: body.clientId } }), 'Cliente');
      const lines = body.lines ?? (q.lines as unknown as Line[]);
      const taxRatePct = body.taxRatePct ?? q.taxRatePct;
      const updated = await tx.performanceQuote.update({
        where: { id },
        data: {
          ...body,
          ...totals(lines, taxRatePct),
          lines: lines as Prisma.InputJsonValue,
          taxRatePct,
          performanceAt: body.performanceAt === undefined ? undefined : body.performanceAt ? new Date(body.performanceAt) : null,
          validUntil: body.validUntil === undefined ? undefined : body.validUntil ? toDate(body.validUntil) : null,
        },
      });
      await this.audit.log(tx, ctx, 'quote.updated', 'performance_quote', id, { fields: Object.keys(body) });
      return updated;
    });
  }

  @Perm('performances:write')
  @HttpCode(204)
  @Delete('quotes/:id')
  async deleteQuote(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    await this.db.tenant(ctx.tenantId, async (tx) => {
      const q = found(await tx.performanceQuote.findUnique({ where: { id } }), 'Presupuesto');
      if (q.status !== 'DRAFT') throw new BadRequestException({ message: 'Sólo se pueden borrar presupuestos en borrador', code: 'QUOTE_LOCKED' });
      await tx.performanceQuote.delete({ where: { id } });
      await this.audit.log(tx, ctx, 'quote.deleted', 'performance_quote', id, { number: q.number });
    });
  }

  private transition(ctx: RequestContext, id: string, from: string[], data: Prisma.PerformanceQuoteUpdateInput, action: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const q = found(await tx.performanceQuote.findUnique({ where: { id } }), 'Presupuesto');
      // Transición condicional: dos peticiones simultáneas no pueden aplicar ambas el cambio.
      const { count } = await tx.performanceQuote.updateMany({ where: { id, status: { in: from as never } }, data: data as Prisma.PerformanceQuoteUpdateManyMutationInput });
      if (!count) throw new BadRequestException({ message: 'Transición no permitida', code: 'INVALID_TRANSITION' });
      await this.audit.log(tx, ctx, action, 'performance_quote', id, { number: q.number });
      return tx.performanceQuote.findUniqueOrThrow({ where: { id }, include: { client: true } });
    });
  }

  @Perm('performances:write')
  @HttpCode(200)
  @Post('quotes/:id/send')
  send(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.transition(ctx, id, ['DRAFT'], { status: 'SENT' }, 'quote.sent');
  }

  @Perm('performances:write')
  @HttpCode(200)
  @Post('quotes/:id/reject')
  reject(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.transition(ctx, id, ['DRAFT', 'SENT'], { status: 'REJECTED' }, 'quote.rejected');
  }

  /** Aceptación firmada: el presupuesto pasa a ser el contrato, con copia de las condiciones. */
  @Perm('performances:write')
  @HttpCode(200)
  @Post('quotes/:id/sign')
  async sign(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(signSchema)) body: z.infer<typeof signSchema>) {
    const q = await this.db.tenant(ctx.tenantId, async (tx) => found(await tx.performanceQuote.findUnique({ where: { id } }), 'Presupuesto'));
    const terms = body.contractTerms ?? q.contractTerms ?? null;
    return this.transition(ctx, id, ['DRAFT', 'SENT'], { status: 'ACCEPTED', signedAt: new Date(), signedBy: body.signedBy, contractTerms: terms }, 'quote.signed');
  }

  @Perm('performances:write', 'events:write')
  @Post('quotes/:id/event')
  createEvent(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(quoteEventSchema)) body: z.infer<typeof quoteEventSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const q = found(await tx.performanceQuote.findUnique({ where: { id }, include: { client: true } }), 'Presupuesto');
      if (q.status === 'REJECTED') throw new BadRequestException({ message: 'El presupuesto está rechazado', code: 'INVALID_TRANSITION' });
      if (q.eventId) throw new BadRequestException({ message: 'El presupuesto ya tiene una actuación', code: 'EVENT_EXISTS' });
      const startsAt = body.startsAt ? new Date(body.startsAt) : q.performanceAt;
      if (!startsAt) throw new BadRequestException({ message: 'Indica la fecha de la actuación', code: 'VALIDATION_ERROR' });
      const endsAt = body.endsAt ? new Date(body.endsAt) : new Date(startsAt.getTime() + 2 * 3600_000);
      if (endsAt <= startsAt) throw new BadRequestException({ message: 'La hora de fin debe ser posterior al inicio', code: 'VALIDATION_ERROR' });
      const ev = await tx.event.create({
        data: {
          tenantId: ctx.tenantId, type: 'PERFORMANCE', title: q.title, location: q.location, startsAt, endsAt,
          description: `Contratada por ${q.client.name} (presupuesto nº ${q.number}).`, createdById: ctx.userId,
        },
      });
      await tx.performanceQuote.update({ where: { id }, data: { eventId: ev.id } });
      await this.audit.log(tx, ctx, 'event.created', 'event', ev.id, { title: ev.title, type: ev.type, quoteId: id });
      return ev;
    });
  }

  // ── Facturas (registro encadenado, preparado para VeriFactu) ─────────────

  @Perm('performances:read')
  @Get('invoices')
  invoices(@Ctx() ctx: RequestContext, @Query(zod(invoicesQuery)) q: z.infer<typeof invoicesQuery>) {
    return this.db.tenant(ctx.tenantId, (tx) =>
      tx.clientInvoice.findMany({
        where: { series: q.series, status: q.status, clientId: q.clientId },
        include: { client: { select: { id: true, name: true } }, quote: { select: { id: true, number: true, title: true } } },
        orderBy: [{ issueDate: 'desc' }, { series: 'asc' }, { number: 'desc' }],
        take: 1000,
      }),
    );
  }

  /** Recalcula la cadena de huellas de la serie y señala cualquier ruptura. */
  @Perm('performances:read')
  @Get('invoices/verify')
  verify(@Ctx() ctx: RequestContext, @Query(zod(verifyQuery)) q: z.infer<typeof verifyQuery>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const rows = await tx.clientInvoice.findMany({ where: { series: q.series }, orderBy: { number: 'asc' } });
      const breaks: { id: string; number: number; reason: 'NUMBER_GAP' | 'PREV_HASH_MISMATCH' | 'HASH_MISMATCH' }[] = [];
      let prev: ClientInvoice | null = null;
      for (const inv of rows) {
        if (inv.number !== (prev?.number ?? 0) + 1) breaks.push({ id: inv.id, number: inv.number, reason: 'NUMBER_GAP' });
        if ((inv.prevHash ?? null) !== (prev?.hash ?? null)) breaks.push({ id: inv.id, number: inv.number, reason: 'PREV_HASH_MISMATCH' });
        if (inv.hash !== this.hashOf(inv)) breaks.push({ id: inv.id, number: inv.number, reason: 'HASH_MISMATCH' });
        prev = inv;
      }
      const series = await tx.clientInvoice.findMany({ distinct: ['series'], select: { series: true }, orderBy: { series: 'asc' } });
      return { series: q.series, count: rows.length, ok: breaks.length === 0, lastHash: prev?.hash ?? null, breaks, allSeries: series.map((s) => s.series) };
    });
  }

  @Perm('performances:read')
  @Get('invoices/:id')
  invoice(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const inv = found(
        await tx.clientInvoice.findUnique({ where: { id }, include: { client: { select: { id: true, name: true } }, quote: { select: { id: true, number: true, title: true } } } }),
        'Factura',
      );
      const [rectifies, rectifiedBy] = await Promise.all([
        inv.rectifiesId ? tx.clientInvoice.findUnique({ where: { id: inv.rectifiesId }, select: { id: true, series: true, number: true } }) : null,
        tx.clientInvoice.findMany({ where: { rectifiesId: id }, select: { id: true, series: true, number: true, totalCents: true } }),
      ]);
      return { ...inv, rectifies, rectifiedBy };
    });
  }

  private hashOf(
    inv: Pick<ClientInvoice, 'series' | 'number' | 'issueDate' | 'taxRatePct' | 'baseCents' | 'taxCents' | 'totalCents' | 'prevHash'> & { clientSnapshot: unknown },
  ) {
    const snap = inv.clientSnapshot as ClientSnapshot;
    return invoiceHash({
      issuerTaxId: snap.issuer?.taxId ?? null, series: inv.series, number: inv.number, issueDate: ymd(inv.issueDate),
      clientTaxId: snap.taxId ?? null, clientName: snap.name, taxRatePct: inv.taxRatePct, baseCents: inv.baseCents,
      taxCents: inv.taxCents, totalCents: inv.totalCents, prevHash: inv.prevHash,
    });
  }

  /** Emite una factura: número correlativo de la serie y huella encadenada a la anterior. */
  private async issueInvoice(
    tx: Tx,
    ctx: RequestContext,
    d: { series: string; issueDate?: string; clientId: string; quoteId?: string | null; rectifiesId?: string | null; lines: Line[]; taxRatePct: number },
  ) {
    // Serializa las emisiones de la misma serie para que la cadena no se bifurque.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.tenantId}:invoice:${d.series}`}))`;
    const client = found(await tx.client.findUnique({ where: { id: d.clientId } }), 'Cliente');
    const issuer = found(await this.db.system.tenant.findUnique({ where: { id: ctx.tenantId }, select: { name: true, legalName: true, taxId: true } }));
    const prev = await tx.clientInvoice.findFirst({ where: { series: d.series }, orderBy: { number: 'desc' } });
    const issueDate = d.issueDate ?? today();
    if (prev && ymd(prev.issueDate) > issueDate) {
      throw new BadRequestException({ message: `La fecha no puede ser anterior a la última factura de la serie (${ymd(prev.issueDate)})`, code: 'INVOICE_DATE_ORDER' });
    }
    const snapshot: ClientSnapshot = {
      name: client.name, taxId: client.taxId, address: client.address, email: client.email, kind: client.kind,
      issuer: { name: issuer.name, legalName: issuer.legalName, taxId: issuer.taxId },
    };
    const data = {
      series: d.series, number: (prev?.number ?? 0) + 1, issueDate: toDate(issueDate), clientSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      taxRatePct: d.taxRatePct, ...totals(d.lines, d.taxRatePct), prevHash: prev?.hash ?? null,
    };
    const inv = await tx.clientInvoice.create({
      data: {
        ...data, tenantId: ctx.tenantId, clientId: client.id, quoteId: d.quoteId ?? null, rectifiesId: d.rectifiesId ?? null,
        lines: d.lines as Prisma.InputJsonValue, hash: this.hashOf(data),
      },
    });
    await this.audit.log(tx, ctx, 'invoice.issued', 'client_invoice', inv.id, { series: inv.series, number: inv.number, totalCents: inv.totalCents, hash: inv.hash });
    return inv;
  }

  @Perm('performances:write')
  @Post('invoices')
  createInvoice(@Ctx() ctx: RequestContext, @Body(zod(invoiceSchema)) body: z.infer<typeof invoiceSchema>) {
    return retryUnique(() =>
      this.db.tenant(ctx.tenantId, async (tx) => {
        if ('quoteId' in body) {
          const q = found(await tx.performanceQuote.findUnique({ where: { id: body.quoteId } }), 'Presupuesto');
          if (q.status !== 'ACCEPTED') throw new BadRequestException({ message: 'El presupuesto no está aceptado', code: 'QUOTE_NOT_ACCEPTED' });
          const dup = await tx.clientInvoice.findFirst({ where: { quoteId: q.id, rectifiesId: null, status: { not: 'CANCELLED' } } });
          if (dup) throw new BadRequestException({ message: `El presupuesto ya está facturado (${dup.series}-${dup.number})`, code: 'QUOTE_ALREADY_INVOICED' });
          return this.issueInvoice(tx, ctx, {
            series: body.series, issueDate: body.issueDate, clientId: q.clientId, quoteId: q.id, lines: q.lines as unknown as Line[], taxRatePct: q.taxRatePct,
          });
        }
        if (totals(body.lines, body.taxRatePct).totalCents <= 0) {
          throw new BadRequestException({ message: 'El importe debe ser positivo; usa una factura rectificativa', code: 'VALIDATION_ERROR' });
        }
        return this.issueInvoice(tx, ctx, { series: body.series, issueDate: body.issueDate, clientId: body.clientId, lines: body.lines, taxRatePct: body.taxRatePct });
      }),
    );
  }

  /** Cobro: registra el ingreso en tesorería (categoría «Actuaciones»). */
  @Perm('performances:write')
  @HttpCode(200)
  @Post('invoices/:id/pay')
  pay(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(paySchema)) body: z.infer<typeof paySchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const inv = found(await tx.clientInvoice.findUnique({ where: { id } }), 'Factura');
      if (inv.status !== 'ISSUED') throw new BadRequestException({ message: 'La factura no está pendiente de cobro', code: 'INVOICE_CLOSED' });
      if (inv.totalCents <= 0) throw new BadRequestException({ message: 'Una factura con importe negativo no se cobra', code: 'INVOICE_NOT_PAYABLE' });
      const category = await ensureCategory(tx, ctx.tenantId, 'Actuaciones', 'INCOME');
      const snap = inv.clientSnapshot as unknown as ClientSnapshot;
      const t = await tx.transaction.create({
        data: {
          tenantId: ctx.tenantId, kind: 'INCOME', amountCents: inv.totalCents, date: toDate(body.date), categoryId: category.id,
          description: `Factura ${inv.series}-${inv.number} · ${snap.name}`.slice(0, 300), createdById: ctx.userId,
        },
      });
      const { count } = await tx.clientInvoice.updateMany({ where: { id, status: 'ISSUED' }, data: { status: 'PAID', paidAt: new Date(), transactionId: t.id } });
      if (!count) throw new BadRequestException({ message: 'La factura no está pendiente de cobro', code: 'INVOICE_CLOSED' });
      await this.audit.log(tx, ctx, 'invoice.paid', 'client_invoice', id, { amountCents: inv.totalCents, transactionId: t.id });
      return tx.clientInvoice.findUniqueOrThrow({ where: { id } });
    });
  }

  /** Anulación: la factura se conserva en la cadena con estado CANCELLED. */
  @Perm('performances:write')
  @HttpCode(200)
  @Post('invoices/:id/cancel')
  cancel(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const inv = found(await tx.clientInvoice.findUnique({ where: { id } }), 'Factura');
      const { count } = await tx.clientInvoice.updateMany({ where: { id, status: 'ISSUED' }, data: { status: 'CANCELLED' } });
      if (!count) throw new BadRequestException({ message: 'Sólo se anulan facturas pendientes de cobro; las cobradas se rectifican', code: 'INVOICE_CLOSED' });
      await this.audit.log(tx, ctx, 'invoice.cancelled', 'client_invoice', id, { series: inv.series, number: inv.number });
      return tx.clientInvoice.findUniqueOrThrow({ where: { id } });
    });
  }

  /** Factura rectificativa: nueva factura con importes negativos que referencia a la original. */
  @Perm('performances:write')
  @Post('invoices/:id/rectify')
  rectify(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(rectifySchema)) body: z.infer<typeof rectifySchema>) {
    return retryUnique(() =>
      this.db.tenant(ctx.tenantId, async (tx) => {
        const inv = found(await tx.clientInvoice.findUnique({ where: { id } }), 'Factura');
        if (inv.status === 'CANCELLED') throw new BadRequestException({ message: 'La factura está anulada', code: 'INVOICE_CLOSED' });
        if (inv.rectifiesId || inv.totalCents <= 0) throw new BadRequestException({ message: 'No se puede rectificar una rectificativa', code: 'INVALID_TRANSITION' });
        const source = body.lines ?? (inv.lines as unknown as Line[]);
        const lines = source.map((l) => ({ ...l, description: `Rectifica ${inv.series}-${inv.number}: ${l.description}`.slice(0, 300), unitCents: -Math.abs(l.unitCents) }));
        const previous = await tx.clientInvoice.aggregate({ where: { rectifiesId: id, status: { not: 'CANCELLED' } }, _sum: { totalCents: true } });
        if (inv.totalCents + (previous._sum.totalCents ?? 0) + totals(lines, inv.taxRatePct).totalCents < 0) {
          throw new BadRequestException({ message: 'La rectificación supera el importe pendiente de la factura', code: 'RECTIFY_EXCEEDS' });
        }
        const r = await this.issueInvoice(tx, ctx, {
          series: body.series, issueDate: body.issueDate, clientId: inv.clientId, quoteId: inv.quoteId, rectifiesId: inv.id, lines, taxRatePct: inv.taxRatePct,
        });
        await this.audit.log(tx, ctx, 'invoice.rectified', 'client_invoice', id, { rectificationId: r.id, reason: body.reason });
        return r;
      }),
    );
  }
}
