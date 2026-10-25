import { BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ExternalMusician, MusicianProfile, Prisma, ReinforcementRequest } from '@prisma/client';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, Perm, RequireFeature } from '../auth/decorators';
import { decrypt, encrypt } from '../common/crypto';
import { found } from '../common/errors';
import { page, pageQuery, skipTake } from '../common/pagination';
import { cents, idParam, isoDate, isoDateTime, optionalText, toDate } from '../common/schemas';
import { zod } from '../common/zod.pipe';
import { env } from '../config/env';
import { Db, Tx } from '../db/db.service';
import { Audit } from '../audit/audit.service';
import { Jobs } from '../jobs/jobs.service';
import { computeStaffing } from '../performances/staffing';
import { csvCell, ensureCategory, norm } from '../performances/util';

const blankToNull = (v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, typeof x === 'string' && x.trim() === '' ? null : x]))
    : v;

const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  instruments: z.array(z.string().trim().min(1).max(60)).min(1).max(10),
  province: z.string().trim().min(2).max(60),
  city: optionalText(80),
  bio: optionalText(1000),
  available: z.boolean().default(true),
});
const browseQuery = pageQuery.extend({
  instrument: z.string().trim().max(60).optional(),
  province: z.string().trim().max(60).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
const applySchema = z.object({ message: optionalText(2000) });
const requestFields = z.object({
  title: z.string().trim().min(3).max(160),
  instrument: z.string().trim().min(1).max(60),
  quantity: z.number().int().min(1).max(50).default(1),
  date: isoDateTime,
  province: z.string().trim().min(2).max(60),
  location: optionalText(200),
  feeCents: cents.nullable().optional(),
  description: optionalText(4000),
  eventId: z.string().uuid().nullable().optional(),
});
const requestCreate = requestFields.refine((r) => new Date(r.date) > new Date(), { message: 'La fecha debe ser futura', path: ['date'] });
const requestPatch = requestFields.partial().extend({ status: z.enum(['OPEN', 'FILLED', 'CANCELLED']).optional() });
const prefillQuery = z.object({ eventId: z.string().uuid() });
const musiciansQuery = z.object({ instrument: z.string().trim().max(60).optional(), province: z.string().trim().max(60).optional() });
const reportSchema = z.object({ reason: z.string().trim().min(5).max(1000) });
const contactSchema = z.object({ requestId: z.string().uuid(), message: z.string().trim().min(5).max(2000) });
const externalFields = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(120).default(''),
  instrument: z.string().trim().max(60).nullable().optional(),
  email: z.string().email().max(254).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  nationalId: z.string().trim().toUpperCase().max(20).nullable().optional(),
});
const externalCreate = z.preprocess(blankToNull, externalFields);
const externalPatch = z.preprocess(blankToNull, externalFields.partial());
const paymentFields = z.object({
  musicianId: z.string().uuid(),
  eventId: z.string().uuid().nullable().optional(),
  concept: z.string().trim().min(1).max(200),
  date: isoDate,
  grossCents: cents.refine((v) => v > 0, 'El importe debe ser mayor que 0'),
  withholdingPct: z.number().int().min(0).max(50).default(15),
});
const paymentPatch = paymentFields.partial().extend({ withholdingPct: z.number().int().min(0).max(50).optional() });
const yearQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100).default(new Date().getUTCFullYear()) });
const paySchema = z.object({ date: isoDate });

const PROFILE_PUBLIC = { id: true, displayName: true, instruments: true, province: true, city: true, bio: true, available: true } as const;
const day = (d: Date) => d.toISOString().slice(0, 10);
const eur = (c: number) => (c / 100).toFixed(2);

function withholding(grossCents: number, pct: number) {
  const withholdingCents = Math.round((grossCents * pct) / 100);
  return { withholdingCents, netCents: grossCents - withholdingCents };
}

/** NIF cifrado: sólo se descifra con `members:sensitive`. */
function serializeExternal(m: ExternalMusician, ctx: RequestContext) {
  const { nationalIdEnc, ...rest } = m;
  const sensitive = ctx.permissions.has('members:sensitive');
  return {
    ...rest,
    nationalId: sensitive ? decrypt(nationalIdEnc) : undefined,
    hasNationalId: !!nationalIdEnc,
  };
}

/**
 * Bolsa de refuerzos. Las necesidades abiertas se leen bajo RLS (visibles para todas las bandas);
 * perfiles y candidaturas propias se gestionan con `db.system` filtrando siempre por el usuario.
 */
@ApiTags('reinforcements')
@ApiBearerAuth()
@RequireFeature('reinforcements')
@Controller('reinforcements')
export class ReinforcementsController {
  constructor(
    private readonly db: Db,
    private readonly audit: Audit,
    private readonly jobs: Jobs,
  ) {}

  private async bandNames(tenantIds: string[]) {
    const tenants = await this.db.system.tenant.findMany({ where: { id: { in: [...new Set(tenantIds)] } }, select: { id: true, name: true } });
    return new Map(tenants.map((t) => [t.id, t.name]));
  }

  private async own(tx: Tx, id: string, ctx: RequestContext) {
    const r = found(await tx.reinforcementRequest.findUnique({ where: { id } }), 'Necesidad');
    if (r.tenantId !== ctx.tenantId) throw found(null, 'Necesidad');
    return r;
  }

  private publicRequest(r: ReinforcementRequest, names: Map<string, string>, ctx: RequestContext) {
    return {
      id: r.id, title: r.title, instrument: r.instrument, quantity: r.quantity, date: r.date, province: r.province,
      location: r.location, feeCents: r.feeCents, description: r.description, status: r.status, createdAt: r.createdAt,
      isMine: r.tenantId === ctx.tenantId, band: { name: names.get(r.tenantId) ?? 'Banda' },
    };
  }

  // ── Perfil de músico (global, por usuario) ───────────────────────────────

  @Get('profile')
  async profile(@Ctx() ctx: RequestContext) {
    return { profile: await this.db.system.musicianProfile.findUnique({ where: { userId: ctx.userId } }) };
  }

  @Put('profile')
  async saveProfile(@Ctx() ctx: RequestContext, @Body(zod(profileSchema)) body: z.infer<typeof profileSchema>) {
    const data = { ...body, instruments: [...new Set(body.instruments)] };
    const profile = await this.db.system.musicianProfile.upsert({ where: { userId: ctx.userId }, create: { ...data, userId: ctx.userId }, update: data });
    return { profile };
  }

  @HttpCode(204)
  @Delete('profile')
  async deleteProfile(@Ctx() ctx: RequestContext) {
    await this.db.system.musicianProfile.deleteMany({ where: { userId: ctx.userId } });
  }

  // ── Necesidades abiertas y candidaturas propias ──────────────────────────

  @Get('requests')
  browse(@Ctx() ctx: RequestContext, @Query(zod(browseQuery)) q: z.infer<typeof browseQuery>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const now = new Date();
      const from = q.from && toDate(q.from) > now ? toDate(q.from) : now;
      const where: Prisma.ReinforcementRequestWhereInput = {
        status: 'OPEN',
        date: { gte: from, lt: q.to ? new Date(toDate(q.to).getTime() + 86_400_000) : undefined },
        instrument: q.instrument ? { contains: q.instrument, mode: 'insensitive' } : undefined,
        province: q.province ? { equals: q.province, mode: 'insensitive' } : undefined,
      };
      const [rows, total] = await Promise.all([
        tx.reinforcementRequest.findMany({ where, orderBy: { date: 'asc' }, ...skipTake(q) }),
        tx.reinforcementRequest.count({ where }),
      ]);
      const [names, mine] = await Promise.all([
        this.bandNames(rows.map((r) => r.tenantId)),
        this.db.system.reinforcementApplication.findMany({ where: { userId: ctx.userId, requestId: { in: rows.map((r) => r.id) } }, select: { requestId: true, status: true } }),
      ]);
      return page(
        rows.map((r) => ({ ...this.publicRequest(r, names, ctx), myApplication: mine.find((a) => a.requestId === r.id)?.status ?? null })),
        total,
        q,
      );
    });
  }

  @Post('requests/:id/apply')
  async apply(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(applySchema)) body: z.infer<typeof applySchema>) {
    const profile = await this.db.system.musicianProfile.findUnique({ where: { userId: ctx.userId } });
    if (!profile) throw new BadRequestException({ message: 'Completa tu perfil de músico antes de presentarte', code: 'PROFILE_REQUIRED' });
    const app = await this.db.system.$transaction(async (sys) => {
      const r = await sys.reinforcementRequest.findUnique({ where: { id } });
      if (!r || r.status !== 'OPEN' || r.date <= new Date()) throw found(null, 'Necesidad');
      if (r.tenantId === ctx.tenantId) throw new BadRequestException({ message: 'Es una necesidad de tu banda', code: 'OWN_REQUEST' });
      const existing = await sys.reinforcementApplication.findUnique({ where: { requestId_userId: { requestId: id, userId: ctx.userId } } });
      if (existing && existing.status !== 'WITHDRAWN') throw new BadRequestException({ message: 'Ya te has presentado a esta necesidad', code: 'ALREADY_APPLIED' });
      const app = existing
        ? await sys.reinforcementApplication.update({ where: { id: existing.id }, data: { status: 'PENDING', message: body.message ?? null, createdAt: new Date() } })
        : await sys.reinforcementApplication.create({ data: { tenantId: r.tenantId, requestId: id, userId: ctx.userId, message: body.message ?? null } });
      // Se audita en la banda que publicó la necesidad.
      await this.audit.log(sys, { ...ctx, tenantId: r.tenantId }, 'reinforcement.applied', 'reinforcement_request', id, { applicationId: app.id });
      return { app, r };
    });
    const managers = await this.db.system.membership.findMany({
      where: { tenantId: app.r.tenantId, status: 'ACTIVE', role: { permissions: { has: 'reinforcements:manage' } } },
      select: { userId: true },
    });
    await this.jobs.add('notify.fanout', {
      tenantId: app.r.tenantId, userIds: managers.map((m) => m.userId), type: 'reinforcement.application', email: true,
      title: `Nueva candidatura: ${app.r.title}`, body: `${profile.displayName} se ha presentado como refuerzo (${app.r.instrument}).`, link: '/reinforcements',
    });
    return { id: app.app.id, requestId: id, status: app.app.status, message: app.app.message, createdAt: app.app.createdAt };
  }

  @Get('my-applications')
  async myApplications(@Ctx() ctx: RequestContext) {
    const rows = await this.db.system.reinforcementApplication.findMany({ where: { userId: ctx.userId }, include: { request: true }, orderBy: { createdAt: 'desc' }, take: 200 });
    const names = await this.bandNames(rows.map((r) => r.request.tenantId));
    return rows.map((a) => ({
      id: a.id, status: a.status, message: a.message, createdAt: a.createdAt,
      request: this.publicRequest(a.request, names, ctx),
    }));
  }

  @HttpCode(200)
  @Post('my-applications/:id/withdraw')
  async withdraw(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    const { count } = await this.db.system.reinforcementApplication.updateMany({ where: { id, userId: ctx.userId, status: 'PENDING' }, data: { status: 'WITHDRAWN' } });
    if (!count) {
      found(await this.db.system.reinforcementApplication.findFirst({ where: { id, userId: ctx.userId } }), 'Candidatura');
      throw new BadRequestException({ message: 'Sólo se pueden retirar candidaturas pendientes', code: 'INVALID_TRANSITION' });
    }
    return { id, status: 'WITHDRAWN' };
  }

  // ── Gestión de las necesidades de la banda ───────────────────────────────

  @Perm('reinforcements:manage')
  @Get('requests/mine')
  mine(@Ctx() ctx: RequestContext) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const rows = await tx.reinforcementRequest.findMany({
        where: { tenantId: ctx.tenantId },
        include: { event: { select: { id: true, title: true, startsAt: true } } },
        orderBy: { date: 'desc' },
        take: 500,
      });
      const counts = await tx.reinforcementApplication.groupBy({ by: ['requestId', 'status'], where: { requestId: { in: rows.map((r) => r.id) } }, _count: true });
      return rows.map((r) => {
        const n = (s: string) => counts.find((c) => c.requestId === r.id && c.status === s)?._count ?? 0;
        return { ...r, applications: { pending: n('PENDING'), accepted: n('ACCEPTED'), rejected: n('REJECTED') } };
      });
    });
  }

  /** Sugerencias para publicar una necesidad a partir de las vacantes de la plantilla del evento. */
  @Perm('reinforcements:manage')
  @Get('requests/prefill')
  prefill(@Ctx() ctx: RequestContext, @Query(zod(prefillQuery)) q: z.infer<typeof prefillQuery>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const ev = found(await tx.event.findUnique({ where: { id: q.eventId }, select: { id: true, title: true, startsAt: true, location: true } }), 'Evento');
      const vacancies = (await computeStaffing(tx, ev.id)).filter((r) => r.missing > 0).map((r) => ({ instrument: r.instrument, quantity: r.missing }));
      return { event: ev, vacancies };
    });
  }

  @Perm('reinforcements:manage')
  @Post('requests')
  createRequest(@Ctx() ctx: RequestContext, @Body(zod(requestCreate)) body: z.infer<typeof requestCreate>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      if (body.eventId) found(await tx.event.findUnique({ where: { id: body.eventId } }), 'Evento');
      const r = await tx.reinforcementRequest.create({ data: { ...body, date: new Date(body.date), tenantId: ctx.tenantId, createdById: ctx.userId } });
      await this.audit.log(tx, ctx, 'reinforcement.created', 'reinforcement_request', r.id, { title: r.title, instrument: r.instrument });
      return r;
    });
  }

  @Perm('reinforcements:manage')
  @Patch('requests/:id')
  updateRequest(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(requestPatch)) body: z.infer<typeof requestPatch>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      await this.own(tx, id, ctx);
      if (body.eventId) found(await tx.event.findUnique({ where: { id: body.eventId } }), 'Evento');
      const r = await tx.reinforcementRequest.update({ where: { id }, data: { ...body, date: body.date ? new Date(body.date) : undefined } });
      await this.audit.log(tx, ctx, 'reinforcement.updated', 'reinforcement_request', id, { fields: Object.keys(body) });
      return r;
    });
  }

  @Perm('reinforcements:manage')
  @HttpCode(204)
  @Delete('requests/:id')
  async deleteRequest(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    await this.db.tenant(ctx.tenantId, async (tx) => {
      const r = await this.own(tx, id, ctx);
      await tx.reinforcementRequest.delete({ where: { id } });
      await this.audit.log(tx, ctx, 'reinforcement.deleted', 'reinforcement_request', id, { title: r.title });
    });
  }

  /** Candidaturas a una necesidad propia: perfil público del músico, nunca su email ni teléfono. */
  @Perm('reinforcements:manage')
  @Get('requests/:id/applications')
  applications(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      await this.own(tx, id, ctx);
      const rows = await tx.reinforcementApplication.findMany({ where: { requestId: id }, orderBy: { createdAt: 'asc' } });
      const profiles = await this.db.system.musicianProfile.findMany({ where: { userId: { in: rows.map((r) => r.userId) } }, select: { ...PROFILE_PUBLIC, userId: true } });
      return rows.map((a) => {
        const p = profiles.find((x) => x.userId === a.userId);
        return {
          id: a.id, status: a.status, message: a.message, createdAt: a.createdAt,
          musician: p ? { id: p.id, displayName: p.displayName, instruments: p.instruments, province: p.province, city: p.city, bio: p.bio } : null,
        };
      });
    });
  }

  @Perm('reinforcements:manage')
  @HttpCode(200)
  @Post('applications/:id/accept')
  async accept(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    const { result, email, request, band } = await this.db.tenant(ctx.tenantId, async (tx) => {
      const app = found(await tx.reinforcementApplication.findUnique({ where: { id }, include: { request: true } }), 'Candidatura');
      if (app.request.status !== 'OPEN') throw new BadRequestException({ message: 'La necesidad no está abierta', code: 'REQUEST_CLOSED' });
      const { count } = await tx.reinforcementApplication.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'ACCEPTED' } });
      if (!count) throw new BadRequestException({ message: 'La candidatura no está pendiente', code: 'INVALID_TRANSITION' });
      const [profile, user, tenant] = await Promise.all([
        this.db.system.musicianProfile.findUnique({ where: { userId: app.userId } }),
        this.db.system.user.findUnique({ where: { id: app.userId }, select: { email: true, name: true } }),
        this.db.system.tenant.findUnique({ where: { id: ctx.tenantId }, select: { name: true } }),
      ]);
      const musician = await this.findOrCreateMusician(tx, ctx, app.userId, profile, user, app.request.instrument);
      const accepted = await tx.reinforcementApplication.count({ where: { requestId: app.requestId, status: 'ACCEPTED' } });
      const filled = accepted >= app.request.quantity;
      if (filled) await tx.reinforcementRequest.update({ where: { id: app.requestId }, data: { status: 'FILLED' } });
      await this.audit.log(tx, ctx, 'reinforcement.accepted', 'reinforcement_request', app.requestId, { applicationId: id, musicianId: musician.id, filled });
      return { result: { id, status: 'ACCEPTED', musicianId: musician.id, requestStatus: filled ? 'FILLED' : 'OPEN' }, email: user?.email, request: app.request, band: tenant?.name ?? 'La banda' };
    });
    if (email) {
      await this.jobs.add('email.send', {
        to: email,
        subject: `Candidatura aceptada: ${request.title}`,
        text: `${band} ha aceptado tu candidatura como refuerzo (${request.instrument}) para «${request.title}» el ${day(request.date)}${request.location ? ` en ${request.location}` : ''}. La banda se pondrá en contacto contigo para concretar los detalles.\n\n${env().APP_URL}/reinforcements`,
      });
    }
    return result;
  }

  private async findOrCreateMusician(
    tx: Tx,
    ctx: RequestContext,
    userId: string,
    profile: MusicianProfile | null,
    user: { email: string; name: string } | null,
    instrument: string,
  ) {
    const existing = await tx.externalMusician.findFirst({ where: { userId } });
    if (existing) return existing;
    const [firstName, ...rest] = (profile?.displayName ?? user?.name ?? 'Músico').trim().split(/\s+/);
    return tx.externalMusician.create({
      data: { tenantId: ctx.tenantId, userId, firstName, lastName: rest.join(' '), instrument, email: user?.email ?? null },
    });
  }

  @Perm('reinforcements:manage')
  @HttpCode(200)
  @Post('applications/:id/reject')
  async rejectApplication(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    const { email, request } = await this.db.tenant(ctx.tenantId, async (tx) => {
      const app = found(await tx.reinforcementApplication.findUnique({ where: { id }, include: { request: true } }), 'Candidatura');
      const { count } = await tx.reinforcementApplication.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'REJECTED' } });
      if (!count) throw new BadRequestException({ message: 'La candidatura no está pendiente', code: 'INVALID_TRANSITION' });
      await this.audit.log(tx, ctx, 'reinforcement.rejected', 'reinforcement_request', app.requestId, { applicationId: id });
      const user = await this.db.system.user.findUnique({ where: { id: app.userId }, select: { email: true } });
      return { email: user?.email, request: app.request };
    });
    if (email) {
      await this.jobs.add('email.send', {
        to: email,
        subject: `Candidatura no seleccionada: ${request.title}`,
        text: `Gracias por presentarte como refuerzo para «${request.title}». En esta ocasión la banda ha seleccionado a otros músicos.\n\n${env().APP_URL}/reinforcements`,
      });
    }
    return { id, status: 'REJECTED' };
  }

  // ── Denuncias (las resuelve el equipo de plataforma en Moderación) ─────────

  private async report(ctx: RequestContext, target: { requestId?: string; profileId?: string }, reason: string) {
    const existing = await this.db.system.reinforcementReport.findFirst({ where: { ...target, reporterUserId: ctx.userId, resolvedAt: null } });
    if (existing) return { id: existing.id, reported: true };
    const r = await this.db.system.reinforcementReport.create({ data: { ...target, reporterTenantId: ctx.tenantId, reporterUserId: ctx.userId, reason } });
    return { id: r.id, reported: true };
  }

  @HttpCode(201)
  @Post('requests/:id/report')
  async reportRequest(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(reportSchema)) body: z.infer<typeof reportSchema>) {
    await this.db.tenant(ctx.tenantId, async (tx) => {
      const r = found(await tx.reinforcementRequest.findUnique({ where: { id } }), 'Necesidad');
      if (r.tenantId === ctx.tenantId) throw new BadRequestException({ message: 'Es una necesidad de tu banda', code: 'OWN_REQUEST' });
    });
    return this.report(ctx, { requestId: id }, body.reason);
  }

  @HttpCode(201)
  @Post('musicians/:profileId/report')
  async reportMusician(@Ctx() ctx: RequestContext, @Param('profileId', zod(idParam)) profileId: string, @Body(zod(reportSchema)) body: z.infer<typeof reportSchema>) {
    const profile = found(await this.db.system.musicianProfile.findUnique({ where: { id: profileId } }), 'Músico');
    if (profile.userId === ctx.userId) throw new BadRequestException({ message: 'Es tu propio perfil', code: 'OWN_PROFILE' });
    return this.report(ctx, { profileId }, body.reason);
  }

  // ── Búsqueda y contacto de músicos ────────────────────────────────────────

  @Perm('reinforcements:manage')
  @Get('musicians')
  async musicians(@Query(zod(musiciansQuery)) q: z.infer<typeof musiciansQuery>) {
    const rows = await this.db.system.musicianProfile.findMany({
      where: { available: true, province: q.province ? { equals: q.province, mode: 'insensitive' } : undefined },
      select: PROFILE_PUBLIC,
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
    const wanted = norm(q.instrument);
    return (wanted ? rows.filter((p) => p.instruments.some((i) => norm(i).includes(wanted))) : rows).slice(0, 200);
  }

  /** Propuesta a un músico: se le envía por email sin revelar su dirección a la banda. */
  @Perm('reinforcements:manage')
  @HttpCode(202)
  @Post('musicians/:profileId/contact')
  async contact(@Ctx() ctx: RequestContext, @Param('profileId', zod(idParam)) profileId: string, @Body(zod(contactSchema)) body: z.infer<typeof contactSchema>) {
    const { request, band } = await this.db.tenant(ctx.tenantId, async (tx) => {
      const request = await this.own(tx, body.requestId, ctx);
      if (request.status !== 'OPEN') throw new BadRequestException({ message: 'La necesidad no está abierta', code: 'REQUEST_CLOSED' });
      await this.audit.log(tx, ctx, 'reinforcement.contacted', 'reinforcement_request', request.id, { profileId });
      const band = await this.db.system.tenant.findUnique({ where: { id: ctx.tenantId }, select: { name: true } });
      return { request, band: band?.name ?? 'Una banda' };
    });
    const profile = await this.db.system.musicianProfile.findFirst({ where: { id: profileId, available: true } });
    const user = profile && (await this.db.system.user.findUnique({ where: { id: profile.userId }, select: { email: true } }));
    if (!profile || !user) throw found(null, 'Músico');
    await this.jobs.add('email.send', {
      to: user.email,
      subject: `${band} te propone un refuerzo: ${request.title}`,
      text:
        `Hola, ${profile.displayName}:\n\n${band} busca ${request.instrument.toLowerCase()} para «${request.title}» el ${day(request.date)} ` +
        `(${[request.location, request.province].filter(Boolean).join(', ')}).${request.feeCents ? ` Caché: ${eur(request.feeCents)} €.` : ''}\n\n` +
        `Mensaje de la banda:\n${body.message}\n\nSi te interesa, preséntate desde la bolsa de refuerzos: ${env().APP_URL}/reinforcements\n\n` +
        `Recibes este mensaje porque tu perfil de músico figura como disponible. Puedes desactivarlo en cualquier momento.`,
    });
    return { sent: true };
  }

  // ── Músicos externos ──────────────────────────────────────────────────────

  @Perm('reinforcements:manage')
  @Get('external-musicians')
  externals(@Ctx() ctx: RequestContext) {
    return this.db.tenant(ctx.tenantId, async (tx) =>
      (await tx.externalMusician.findMany({ orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], take: 1000 })).map((m) => serializeExternal(m, ctx)),
    );
  }

  private externalData(body: z.infer<typeof externalPatch>, ctx: RequestContext): Prisma.ExternalMusicianUncheckedUpdateInput {
    const { nationalId, ...rest } = body;
    if (nationalId !== undefined && !ctx.permissions.has('members:sensitive')) {
      throw new BadRequestException({ message: 'No puedes modificar datos sensibles', code: 'FORBIDDEN' });
    }
    return {
      ...rest,
      ...(nationalId !== undefined && { nationalIdEnc: encrypt(nationalId) }),
    };
  }

  @Perm('reinforcements:manage')
  @Post('external-musicians')
  createExternal(@Ctx() ctx: RequestContext, @Body(zod(externalCreate)) body: z.infer<typeof externalCreate>) {
    const data = this.externalData(body, ctx);
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const m = await tx.externalMusician.create({ data: { ...(data as Prisma.ExternalMusicianUncheckedCreateInput), tenantId: ctx.tenantId } });
      await this.audit.log(tx, ctx, 'external_musician.created', 'external_musician', m.id, { fields: Object.keys(body) });
      return serializeExternal(m, ctx);
    });
  }

  @Perm('reinforcements:manage')
  @Patch('external-musicians/:id')
  updateExternal(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(externalPatch)) body: z.infer<typeof externalPatch>) {
    const data = this.externalData(body, ctx);
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.externalMusician.findUnique({ where: { id } }), 'Músico');
      const m = await tx.externalMusician.update({ where: { id }, data });
      await this.audit.log(tx, ctx, 'external_musician.updated', 'external_musician', id, { fields: Object.keys(body) });
      return serializeExternal(m, ctx);
    });
  }

  @Perm('reinforcements:manage')
  @HttpCode(204)
  @Delete('external-musicians/:id')
  async deleteExternal(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    await this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.externalMusician.findUnique({ where: { id } }), 'Músico');
      if (await tx.reinforcementPayment.count({ where: { musicianId: id } })) {
        throw new BadRequestException({ message: 'El músico tiene pagos registrados', code: 'MUSICIAN_IN_USE' });
      }
      await tx.externalMusician.delete({ where: { id } });
      await this.audit.log(tx, ctx, 'external_musician.deleted', 'external_musician', id);
    });
  }

  // ── Pagos y retenciones ───────────────────────────────────────────────────

  @Perm('reinforcements:manage')
  @Get('payments')
  payments(@Ctx() ctx: RequestContext, @Query(zod(yearQuery)) q: z.infer<typeof yearQuery>) {
    return this.db.tenant(ctx.tenantId, (tx) =>
      tx.reinforcementPayment.findMany({
        where: { date: { gte: new Date(Date.UTC(q.year, 0, 1)), lt: new Date(Date.UTC(q.year + 1, 0, 1)) } },
        include: { musician: { select: { id: true, firstName: true, lastName: true, instrument: true } } },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      }),
    );
  }

  @Perm('reinforcements:manage')
  @Post('payments')
  createPayment(@Ctx() ctx: RequestContext, @Body(zod(paymentFields)) body: z.infer<typeof paymentFields>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.externalMusician.findUnique({ where: { id: body.musicianId } }), 'Músico');
      if (body.eventId) found(await tx.event.findUnique({ where: { id: body.eventId } }), 'Evento');
      const p = await tx.reinforcementPayment.create({
        data: { ...body, date: toDate(body.date), ...withholding(body.grossCents, body.withholdingPct), tenantId: ctx.tenantId },
        include: { musician: { select: { id: true, firstName: true, lastName: true, instrument: true } } },
      });
      await this.audit.log(tx, ctx, 'reinforcement_payment.created', 'reinforcement_payment', p.id, { grossCents: p.grossCents, withholdingPct: p.withholdingPct });
      return p;
    });
  }

  @Perm('reinforcements:manage')
  @Patch('payments/:id')
  updatePayment(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(paymentPatch)) body: z.infer<typeof paymentPatch>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const p = found(await tx.reinforcementPayment.findUnique({ where: { id } }), 'Pago');
      if (p.paidAt) throw new BadRequestException({ message: 'El pago ya está realizado', code: 'PAYMENT_CLOSED' });
      if (body.musicianId) found(await tx.externalMusician.findUnique({ where: { id: body.musicianId } }), 'Músico');
      if (body.eventId) found(await tx.event.findUnique({ where: { id: body.eventId } }), 'Evento');
      const grossCents = body.grossCents ?? p.grossCents;
      const withholdingPct = body.withholdingPct ?? p.withholdingPct;
      const updated = await tx.reinforcementPayment.update({
        where: { id },
        data: { ...body, date: body.date ? toDate(body.date) : undefined, grossCents, withholdingPct, ...withholding(grossCents, withholdingPct) },
        include: { musician: { select: { id: true, firstName: true, lastName: true, instrument: true } } },
      });
      await this.audit.log(tx, ctx, 'reinforcement_payment.updated', 'reinforcement_payment', id, { fields: Object.keys(body) });
      return updated;
    });
  }

  @Perm('reinforcements:manage')
  @HttpCode(204)
  @Delete('payments/:id')
  async deletePayment(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    await this.db.tenant(ctx.tenantId, async (tx) => {
      const p = found(await tx.reinforcementPayment.findUnique({ where: { id } }), 'Pago');
      if (p.paidAt) throw new BadRequestException({ message: 'El pago ya está realizado', code: 'PAYMENT_CLOSED' });
      await tx.reinforcementPayment.delete({ where: { id } });
      await this.audit.log(tx, ctx, 'reinforcement_payment.deleted', 'reinforcement_payment', id, { grossCents: p.grossCents });
    });
  }

  /**
   * Pago al músico: gasto por el neto en la categoría «Refuerzos». La retención queda pendiente de
   * ingresar en Hacienda (modelo 111) y se registra aparte al liquidarla.
   */
  @Perm('reinforcements:manage')
  @HttpCode(200)
  @Post('payments/:id/pay')
  pay(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(paySchema)) body: z.infer<typeof paySchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const p = found(await tx.reinforcementPayment.findUnique({ where: { id }, include: { musician: true } }), 'Pago');
      if (p.paidAt) throw new BadRequestException({ message: 'El pago ya está realizado', code: 'PAYMENT_CLOSED' });
      const category = await ensureCategory(tx, ctx.tenantId, 'Refuerzos', 'EXPENSE');
      const name = `${p.musician.firstName} ${p.musician.lastName}`.trim();
      const t = await tx.transaction.create({
        data: {
          tenantId: ctx.tenantId, kind: 'EXPENSE', amountCents: p.netCents, date: toDate(body.date), categoryId: category.id, createdById: ctx.userId,
          description: `Refuerzo ${name} · ${p.concept} (bruto ${eur(p.grossCents)} €, retención ${p.withholdingPct}% ${eur(p.withholdingCents)} €)`.slice(0, 300),
        },
      });
      const { count } = await tx.reinforcementPayment.updateMany({ where: { id, paidAt: null }, data: { paidAt: new Date(), transactionId: t.id } });
      if (!count) throw new BadRequestException({ message: 'El pago ya está realizado', code: 'PAYMENT_CLOSED' });
      await this.audit.log(tx, ctx, 'reinforcement_payment.paid', 'reinforcement_payment', id, { netCents: p.netCents, transactionId: t.id });
      return tx.reinforcementPayment.findUniqueOrThrow({ where: { id }, include: { musician: { select: { id: true, firstName: true, lastName: true, instrument: true } } } });
    });
  }

  private async yearly(tx: Tx, year: number) {
    const rows = await tx.reinforcementPayment.findMany({
      where: { paidAt: { not: null }, date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
      include: { musician: true },
    });
    const by = new Map<string, { musician: ExternalMusician; payments: number; grossCents: number; withholdingCents: number; netCents: number }>();
    for (const p of rows) {
      const r = by.get(p.musicianId) ?? { musician: p.musician, payments: 0, grossCents: 0, withholdingCents: 0, netCents: 0 };
      r.payments++;
      r.grossCents += p.grossCents;
      r.withholdingCents += p.withholdingCents;
      r.netCents += p.netCents;
      by.set(p.musicianId, r);
    }
    return [...by.values()].sort((a, b) => a.musician.lastName.localeCompare(b.musician.lastName, 'es') || a.musician.firstName.localeCompare(b.musician.firstName, 'es'));
  }

  /** Resumen anual de pagos realizados por perceptor: base para los modelos 111 y 190. */
  @Perm('reinforcements:manage')
  @Get('payments/summary')
  summary(@Ctx() ctx: RequestContext, @Query(zod(yearQuery)) q: z.infer<typeof yearQuery>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const rows = (await this.yearly(tx, q.year)).map((r) => {
        const m = serializeExternal(r.musician, ctx);
        return {
          musician: { id: m.id, firstName: m.firstName, lastName: m.lastName, instrument: m.instrument, hasNationalId: m.hasNationalId, nationalId: m.nationalId },
          payments: r.payments, grossCents: r.grossCents, withholdingCents: r.withholdingCents, netCents: r.netCents,
        };
      });
      const sum = (k: 'grossCents' | 'withholdingCents' | 'netCents') => rows.reduce((s, r) => s + r[k], 0);
      return { year: q.year, rows, totals: { grossCents: sum('grossCents'), withholdingCents: sum('withholdingCents'), netCents: sum('netCents'), perceptors: rows.length } };
    });
  }

  @Perm('reinforcements:manage', 'members:sensitive')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Get('payments/summary.csv')
  async summaryCsv(@Ctx() ctx: RequestContext, @Query(zod(yearQuery)) q: z.infer<typeof yearQuery>) {
    const rows = await this.db.tenant(ctx.tenantId, async (tx) => {
      const rows = await this.yearly(tx, q.year);
      await this.audit.log(tx, ctx, 'reinforcement_payment.exported', 'reinforcement_payment', null, { year: q.year, perceptors: rows.length });
      return rows;
    });
    const header = ['ejercicio', 'nif', 'apellidos', 'nombre', 'instrumento', 'pagos', 'bruto_eur', 'retencion_eur', 'neto_eur'];
    const lines = rows.map((r) =>
      [q.year, decrypt(r.musician.nationalIdEnc), r.musician.lastName, r.musician.firstName, r.musician.instrument, r.payments, eur(r.grossCents), eur(r.withholdingCents), eur(r.netCents)]
        .map(csvCell)
        .join(';'),
    );
    return '﻿' + [header.join(';'), ...lines].join('\n') + '\n';
  }
}
