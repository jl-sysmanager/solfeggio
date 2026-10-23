import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, Perm, RequireFeature } from '../auth/decorators';
import { found } from '../common/errors';
import { idParam, isoDate, optionalText, text, toDate } from '../common/schemas';
import { zod } from '../common/zod.pipe';
import { Db } from '../db/db.service';
import { Audit } from '../audit/audit.service';
import { Storage } from '../storage/storage.service';
import { LimitsService } from '../tenancy/limits.service';
import { BookletEntry, buildCatalog, extractPages, extractRange, loadPdf, mergeBooklet, normalizeInstrument, suggestParts } from './parts';

const PDF = 'application/pdf';
const DAY = 86_400_000;

const sgaeQuery = z
  .object({ from: isoDate, to: isoDate, format: z.enum(['json', 'csv']).default('json') })
  .refine((q) => q.from <= q.to, { message: 'La fecha inicial debe ser anterior a la final', path: ['to'] })
  .refine((q) => toDate(q.to).getTime() - toDate(q.from).getTime() <= 366 * 2 * DAY, { message: 'Máximo dos años', path: ['to'] });
const bookletSchema = z.object({ name: text(120), description: optionalText(1000) });
const bookletItemsSchema = z.array(z.object({ workId: z.string().uuid(), label: optionalText(20) })).max(200);
const instrumentQuery = z.object({ instrument: text(60) });
const splitSchema = z.object({
  versionId: z.string().uuid().nullable().optional(),
  parts: z
    .array(z.object({ instrument: text(60), fromPage: z.number().int().min(1), toPage: z.number().int().min(1) }))
    .min(1)
    .max(60)
    .refine((ps) => ps.every((p) => p.fromPage <= p.toPage), { message: 'Rango de páginas no válido' }),
});
const loanSchema = z.object({
  workId: z.string().uuid(),
  direction: z.enum(['LENT', 'BORROWED']),
  counterparty: text(160),
  contact: optionalText(200),
  loanedAt: isoDate,
  dueAt: isoDate.nullable().optional(),
  notes: optionalText(2000),
});
const loanPatch = loanSchema.omit({ workId: true }).partial();
const loansQuery = z.object({
  status: z.enum(['all', 'open', 'overdue', 'returned']).default('all'),
  direction: z.enum(['LENT', 'BORROWED']).optional(),
  workId: z.string().uuid().optional(),
});
const returnSchema = z.object({ date: isoDate.optional() });

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Evita inyección de fórmulas en hojas de cálculo.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const mmss = (sec: number | null | undefined) => (sec ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : '');
const today = () => toDate(new Date().toISOString().slice(0, 10));
const attachment = (res: Response, fileName: string, type: string) => {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/[^\w.-]+/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
};

@ApiTags('archive')
@ApiBearerAuth()
@RequireFeature('archive')
@Controller()
export class ArchiveExtrasController {
  constructor(
    private readonly db: Db,
    private readonly audit: Audit,
    private readonly storage: Storage,
    private readonly limits: LimitsService,
  ) {}

  // ───────────── Informe de repertorio (SGAE) ─────────────

  /** Datos para cumplimentar la declaración de repertorio; no es una presentación oficial. */
  @Perm('archive:read', 'events:read')
  @Get('archive/reports/sgae')
  async sgae(@Ctx() ctx: RequestContext, @Query(zod(sgaeQuery)) q: z.infer<typeof sgaeQuery>, @Res({ passthrough: true }) res: Response) {
    const { tz, events } = await this.db.tenant(ctx.tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { timezone: true } });
      // Margen de un día a cada lado: el filtro exacto se hace con la fecha local de la banda.
      const events = await tx.event.findMany({
        where: { type: 'PERFORMANCE', status: { not: 'CANCELLED' }, startsAt: { gte: new Date(toDate(q.from).getTime() - DAY), lt: new Date(toDate(q.to).getTime() + 2 * DAY) } },
        orderBy: { startsAt: 'asc' },
        include: { repertoire: { orderBy: { position: 'asc' }, include: { work: { include: { composer: { select: { name: true } } } } } } },
      });
      return { tz: tenant?.timezone ?? 'Europe/Madrid', events };
    });
    const localDate = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    const grouped = events
      .map((e) => ({ id: e.id, date: localDate(e.startsAt), title: e.title, location: e.location, ev: e }))
      .filter((e) => e.date >= q.from && e.date <= q.to)
      .map(({ ev, ...e }) => ({
        ...e,
        works: ev.repertoire.map((r) => ({
          workId: r.workId,
          title: r.work.title,
          composer: r.work.composer?.name ?? null,
          arranger: r.work.arranger,
          durationSec: r.work.durationSec,
          duration: mmss(r.work.durationSec),
          publisher: r.work.publisher,
          catalogCode: r.work.catalogCode,
        })),
      }));
    const rows = grouped.flatMap((e) => e.works.map((w) => ({ date: e.date, event: e.title, location: e.location, ...w })));
    const totalSec = rows.reduce((s, r) => s + (r.durationSec ?? 0), 0);
    const totals = {
      performances: grouped.length,
      works: rows.length,
      distinctWorks: new Set(rows.map((r) => r.workId)).size,
      durationSec: totalSec,
      duration: mmss(totalSec) || '0:00',
      missingDuration: rows.filter((r) => !r.durationSec).length,
    };
    if (q.format === 'json') return { from: q.from, to: q.to, events: grouped, totals };

    attachment(res, `repertorio-sgae-${q.from}-${q.to}.csv`, 'text/csv; charset=utf-8');
    const header = ['fecha', 'acto', 'lugar', 'obra', 'compositor', 'arreglista', 'duracion', 'editorial', 'signatura'];
    const lines = rows.map((r) => [r.date, r.event, r.location, r.title, r.composer, r.arranger, r.duration, r.publisher, r.catalogCode].map(csvCell).join(';'));
    return '﻿' + [header.join(';'), ...lines].join('\n') + '\n';
  }

  // ───────────── Particellas: detección y división ─────────────

  private async sourcePdf(ctx: RequestContext, workId: string, assetId: string) {
    const { asset, extra } = await this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.work.findUnique({ where: { id: workId } }), 'Obra');
      const asset = found(await tx.asset.findFirst({ where: { id: assetId, workId } }), 'Archivo');
      const members = await tx.member.findMany({ where: { instrument: { not: null } }, distinct: ['instrument'], select: { instrument: true } });
      return { asset, extra: members.map((m) => m.instrument!) };
    });
    if (asset.mimeType !== PDF) throw new BadRequestException({ message: 'Sólo se pueden dividir ficheros PDF', code: 'NOT_A_PDF' });
    if (asset.kind !== 'SCORE' && asset.kind !== 'OTHER') {
      throw new BadRequestException({ message: 'Sólo se dividen partituras generales o ficheros «Otro»', code: 'INVALID_ASSET_KIND' });
    }
    return { asset, extra, bytes: await this.storage.getObject(asset.fileKey) };
  }

  /**
   * Sugiere rangos de páginas por instrumento leyendo la capa de texto del PDF.
   * Los PDF escaneados (sin texto) no se reconocen: se devuelve `ocrRequired` y se dividen a mano.
   */
  @RequireFeature('archive_ai')
  @Perm('archive:write')
  @HttpCode(200)
  @Post('works/:id/assets/:assetId/detect-parts')
  async detectParts(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Param('assetId', zod(idParam)) assetId: string) {
    const { bytes, extra } = await this.sourcePdf(ctx, id, assetId);
    const pages = await extractPages(bytes);
    const chars = pages.reduce((s, p) => s + p.replace(/\s/g, '').length, 0);
    if (chars < pages.length * 3) return { pages: pages.length, ocrRequired: true, suggestions: [] };
    return { pages: pages.length, ocrRequired: false, suggestions: suggestParts(pages, buildCatalog(extra)) };
  }

  @RequireFeature('archive_ai')
  @Perm('archive:write')
  @Post('works/:id/assets/:assetId/split')
  async split(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Param('assetId', zod(idParam)) assetId: string, @Body(zod(splitSchema)) body: z.infer<typeof splitSchema>) {
    const { asset, bytes } = await this.sourcePdf(ctx, id, assetId);
    if (body.versionId) {
      await this.db.tenant(ctx.tenantId, async (tx) => found(await tx.workVersion.findFirst({ where: { id: body.versionId!, workId: id } }), 'Versión'));
    }
    const src = await loadPdf(bytes);
    const count = src.getPageCount();
    const bad = body.parts.find((p) => p.toPage > count);
    if (bad) throw new BadRequestException({ message: `El PDF tiene ${count} páginas`, code: 'PAGE_OUT_OF_RANGE', details: { pages: count } });

    const base = asset.fileName.replace(/\.pdf$/i, '');
    const files: { instrument: string; fileName: string; fileKey: string; body: Uint8Array }[] = [];
    for (const p of body.parts) {
      const fileName = `${base} - ${p.instrument}.pdf`.slice(0, 200);
      files.push({ instrument: p.instrument, fileName, fileKey: this.storage.newKey(ctx.tenantId, 'archive', fileName), body: await extractRange(src, p.fromPage, p.toPage) });
    }
    const total = files.reduce((s, f) => s + f.body.byteLength, 0);
    await this.limits.reserveStorage(ctx.tenantId, total);
    const uploaded: string[] = [];
    try {
      for (const f of files) {
        await this.storage.putObject(f.fileKey, f.body, PDF);
        uploaded.push(f.fileKey);
      }
      return await this.db.tenant(ctx.tenantId, async (tx) => {
        const created = [];
        for (const f of files) {
          created.push(
            await tx.asset.create({
              data: {
                tenantId: ctx.tenantId, workId: id, kind: 'PART', instrument: f.instrument, versionId: body.versionId ?? asset.versionId,
                fileKey: f.fileKey, fileName: f.fileName, mimeType: PDF, sizeBytes: f.body.byteLength, uploadedById: ctx.userId,
              },
            }),
          );
        }
        await this.audit.log(tx, ctx, 'asset.split', 'asset', assetId, { workId: id, parts: files.length, bytes: total });
        return created;
      });
    } catch (e) {
      await Promise.all(uploaded.map((k) => this.storage.remove(k)));
      await this.limits.releaseStorage(ctx.tenantId, total);
      throw e;
    }
  }

  // ───────────── Libretos de marchas ─────────────

  @Perm('archive:read')
  @Get('booklets')
  booklets(@Ctx() ctx: RequestContext) {
    return this.db.tenant(ctx.tenantId, (tx) => tx.booklet.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { items: true } } } }));
  }

  @Perm('archive:write')
  @Post('booklets')
  createBooklet(@Ctx() ctx: RequestContext, @Body(zod(bookletSchema)) body: z.infer<typeof bookletSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      await this.uniqueName(tx, body.name);
      const b = await tx.booklet.create({ data: { ...body, tenantId: ctx.tenantId } });
      await this.audit.log(tx, ctx, 'booklet.created', 'booklet', b.id, { name: b.name });
      return b;
    });
  }

  @Perm('archive:read')
  @Get('booklets/:id')
  getBooklet(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, (tx) => this.loadBooklet(tx, id));
  }

  @Perm('archive:write')
  @Patch('booklets/:id')
  updateBooklet(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(bookletSchema.partial())) body: Partial<z.infer<typeof bookletSchema>>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.booklet.findUnique({ where: { id } }), 'Libreto');
      if (body.name) await this.uniqueName(tx, body.name, id);
      return tx.booklet.update({ where: { id }, data: body });
    });
  }

  @Perm('archive:write')
  @HttpCode(204)
  @Delete('booklets/:id')
  async deleteBooklet(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    await this.db.tenant(ctx.tenantId, async (tx) => {
      const b = found(await tx.booklet.findUnique({ where: { id } }), 'Libreto');
      await tx.booklet.delete({ where: { id } });
      await this.audit.log(tx, ctx, 'booklet.deleted', 'booklet', id, { name: b.name });
    });
  }

  /** Sustituye las marchas del libreto; el orden del array es el orden del libreto. */
  @Perm('archive:write')
  @Put('booklets/:id/items')
  setItems(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(bookletItemsSchema)) body: z.infer<typeof bookletItemsSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.booklet.findUnique({ where: { id } }), 'Libreto');
      const ids = [...new Set(body.map((i) => i.workId))];
      if (ids.length !== body.length) throw new BadRequestException({ message: 'Una obra aparece dos veces en el libreto', code: 'DUPLICATE_WORK' });
      if ((await tx.work.count({ where: { id: { in: ids } } })) !== ids.length) throw found(null, 'Obra');
      await tx.bookletItem.deleteMany({ where: { bookletId: id } });
      await tx.bookletItem.createMany({ data: body.map((i, position) => ({ tenantId: ctx.tenantId, bookletId: id, workId: i.workId, label: i.label || null, position })) });
      await this.audit.log(tx, ctx, 'booklet.items_updated', 'booklet', id, { items: body.length });
      return this.loadBooklet(tx, id);
    });
  }

  /** Instrumentos con particella PDF en alguna obra del libreto y cuántas obras cubren. */
  @Perm('archive:read')
  @Get('booklets/:id/instruments')
  instruments(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const b = await this.loadBooklet(tx, id);
      const parts = await tx.asset.findMany({
        where: { workId: { in: b.items.map((i) => i.workId) }, kind: 'PART', mimeType: PDF, instrument: { not: null } },
        select: { workId: true, instrument: true },
        orderBy: { createdAt: 'asc' },
      });
      const byKey = new Map<string, { instrument: string; works: Set<string> }>();
      for (const p of parts) {
        const key = normalizeInstrument(p.instrument!);
        if (!key) continue;
        if (!byKey.has(key)) byKey.set(key, { instrument: p.instrument!, works: new Set() });
        byKey.get(key)!.works.add(p.workId);
      }
      return [...byKey.values()]
        .map((v) => ({ instrument: v.instrument, works: v.works.size, total: b.items.length }))
        .sort((a, c) => a.instrument.localeCompare(c.instrument, 'es', { numeric: true }));
    });
  }

  @Perm('archive:read')
  @Get('booklets/:id/pdf')
  async bookletPdf(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Query(zod(instrumentQuery)) q: z.infer<typeof instrumentQuery>, @Res({ passthrough: true }) res: Response) {
    const key = normalizeInstrument(q.instrument);
    const { booklet, parts } = await this.db.tenant(ctx.tenantId, async (tx) => {
      const booklet = await this.loadBooklet(tx, id);
      const parts = await tx.asset.findMany({
        where: { workId: { in: booklet.items.map((i) => i.workId) }, kind: 'PART', mimeType: PDF, instrument: { not: null } },
        orderBy: { createdAt: 'desc' },
      });
      return { booklet, parts: parts.filter((p) => normalizeInstrument(p.instrument!) === key) };
    });
    if (!parts.length) throw found(null, 'Particella de ese instrumento');
    const entries: BookletEntry[] = [];
    for (const item of booklet.items) {
      // Si hay varias particellas del mismo papel se usa la más reciente.
      const part = parts.find((p) => p.workId === item.workId);
      let pdf = null;
      if (part) pdf = await loadPdf(await this.storage.getObject(part.fileKey)).catch(() => null);
      entries.push({ label: item.label, title: item.work.title, composer: item.work.composer?.name ?? null, pdf });
    }
    const tenant = await this.db.system.tenant.findUnique({ where: { id: ctx.tenantId }, select: { name: true } });
    const bytes = await mergeBooklet(booklet.name, parts[0].instrument!, entries, tenant?.name);
    attachment(res, `${booklet.name} - ${parts[0].instrument}.pdf`, PDF);
    return new StreamableFile(Buffer.from(bytes));
  }

  private async loadBooklet(tx: Prisma.TransactionClient, id: string) {
    return found(
      await tx.booklet.findUnique({
        where: { id },
        include: {
          items: {
            orderBy: { position: 'asc' },
            include: { work: { select: { id: true, title: true, genre: true, durationSec: true, composer: { select: { name: true } } } } },
          },
        },
      }),
      'Libreto',
    );
  }

  private async uniqueName(tx: Prisma.TransactionClient, name: string, exceptId?: string) {
    const dup = await tx.booklet.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, id: exceptId ? { not: exceptId } : undefined } });
    if (dup) throw new BadRequestException({ message: 'Ya existe un libreto con ese nombre', code: 'DUPLICATE_NAME' });
  }

  // ───────────── Préstamos de partituras entre bandas ─────────────

  @Perm('archive:read')
  @Get('score-loans')
  loans(@Ctx() ctx: RequestContext, @Query(zod(loansQuery)) q: z.infer<typeof loansQuery>) {
    const where: Prisma.ScoreLoanWhereInput = { direction: q.direction, workId: q.workId };
    if (q.status === 'open') where.returnedAt = null;
    if (q.status === 'returned') where.returnedAt = { not: null };
    if (q.status === 'overdue') Object.assign(where, { returnedAt: null, dueAt: { lt: today() } });
    return this.db.tenant(ctx.tenantId, async (tx) =>
      (await tx.scoreLoan.findMany({ where, orderBy: [{ returnedAt: { sort: 'desc', nulls: 'first' } }, { loanedAt: 'desc' }], include: { work: { select: { id: true, title: true } } } })).map(withOverdue),
    );
  }

  @Perm('archive:read')
  @Get('works/:id/loans')
  workLoans(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.work.findUnique({ where: { id } }), 'Obra');
      return (await tx.scoreLoan.findMany({ where: { workId: id }, orderBy: { loanedAt: 'desc' } })).map(withOverdue);
    });
  }

  @Perm('archive:write')
  @Post('score-loans')
  createLoan(@Ctx() ctx: RequestContext, @Body(zod(loanSchema)) body: z.infer<typeof loanSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.work.findUnique({ where: { id: body.workId } }), 'Obra');
      if (body.dueAt && body.dueAt < body.loanedAt) throw new BadRequestException({ message: 'La devolución prevista es anterior al préstamo', code: 'INVALID_DATES' });
      const loan = await tx.scoreLoan.create({
        data: { ...body, tenantId: ctx.tenantId, loanedAt: toDate(body.loanedAt), dueAt: body.dueAt ? toDate(body.dueAt) : null },
        include: { work: { select: { id: true, title: true } } },
      });
      await this.audit.log(tx, ctx, 'score_loan.created', 'score_loan', loan.id, { workId: body.workId, direction: body.direction, counterparty: body.counterparty });
      return withOverdue(loan);
    });
  }

  @Perm('archive:write')
  @Patch('score-loans/:id')
  updateLoan(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(loanPatch)) body: z.infer<typeof loanPatch>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const loan = found(await tx.scoreLoan.findUnique({ where: { id } }), 'Préstamo');
      const loanedAt = body.loanedAt ? toDate(body.loanedAt) : loan.loanedAt;
      const dueAt = body.dueAt === undefined ? loan.dueAt : body.dueAt ? toDate(body.dueAt) : null;
      if (dueAt && dueAt < loanedAt) throw new BadRequestException({ message: 'La devolución prevista es anterior al préstamo', code: 'INVALID_DATES' });
      const updated = await tx.scoreLoan.update({ where: { id }, data: { ...body, loanedAt, dueAt }, include: { work: { select: { id: true, title: true } } } });
      await this.audit.log(tx, ctx, 'score_loan.updated', 'score_loan', id, { fields: Object.keys(body) });
      return withOverdue(updated);
    });
  }

  @Perm('archive:write')
  @HttpCode(200)
  @Post('score-loans/:id/return')
  returnLoan(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(returnSchema)) body: z.infer<typeof returnSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const loan = found(await tx.scoreLoan.findUnique({ where: { id } }), 'Préstamo');
      if (loan.returnedAt) throw new BadRequestException({ message: 'El préstamo ya está devuelto', code: 'ALREADY_RETURNED' });
      const returnedAt = body.date ? toDate(body.date) : today();
      if (returnedAt < loan.loanedAt) throw new BadRequestException({ message: 'La devolución es anterior al préstamo', code: 'INVALID_DATES' });
      const updated = await tx.scoreLoan.update({ where: { id }, data: { returnedAt }, include: { work: { select: { id: true, title: true } } } });
      await this.audit.log(tx, ctx, 'score_loan.returned', 'score_loan', id, { workId: loan.workId });
      return withOverdue(updated);
    });
  }

  @Perm('archive:write')
  @HttpCode(204)
  @Delete('score-loans/:id')
  async deleteLoan(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    await this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.scoreLoan.findUnique({ where: { id } }), 'Préstamo');
      await tx.scoreLoan.delete({ where: { id } });
      await this.audit.log(tx, ctx, 'score_loan.deleted', 'score_loan', id);
    });
  }
}

function withOverdue<T extends { returnedAt: Date | null; dueAt: Date | null }>(loan: T) {
  return { ...loan, overdue: !loan.returnedAt && !!loan.dueAt && loan.dueAt < today() };
}
