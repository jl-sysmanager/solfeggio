import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Incident, Prisma } from '@prisma/client';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, PlatformAdmin } from '../auth/decorators';
import { found } from '../common/errors';
import { page, pageQuery, skipTake } from '../common/pagination';
import { idParam } from '../common/schemas';
import { zod } from '../common/zod.pipe';
import { env } from '../config/env';
import { Db } from '../db/db.service';
import { Jobs } from '../jobs/jobs.service';
import { blockUser, moderationKpis, unblockUser } from './moderation.util';
import { SupportService } from './support.service';
import { MODERATION_SLA_HOURS, platformAudit, SLA_AT_RISK_MS, slaDueAt, slaState, tenantAudit } from './support.util';

const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
const listQuery = pageQuery.extend({
  status: z.enum([...STATUSES, 'ACTIVE']).optional(),
  priority: z.coerce.number().int().min(1).max(5).optional(),
  assignee: z.union([z.enum(['none', 'me']), z.string().uuid()]).optional(),
  sla: z.enum(['overdue', 'at_risk']).optional(),
  tenantId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
});
const incidentPatch = z
  .object({
    status: z.enum(STATUSES).optional(),
    priority: z.number().int().min(1).max(5).optional(),
    assigneeId: z.string().uuid().nullable().optional(),
    resolution: z.string().trim().max(5000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nada que actualizar');
const replySchema = z.object({ body: z.string().trim().min(1).max(10_000), internal: z.boolean().default(false) });
const cannedSchema = z.object({ title: z.string().trim().min(2).max(120), body: z.string().trim().min(1).max(10_000) });
const moderateSchema = z.object({ approve: z.boolean(), note: z.string().trim().max(1000).optional() });
const resolveSchema = z
  .object({ action: z.enum(['dismiss', 'hide_request', 'hide_profile', 'block_user']), note: z.string().trim().max(1000).optional() })
  .refine((v) => v.action !== 'block_user' || (v.note && v.note.length >= 3), { message: 'Indica el motivo del bloqueo', path: ['note'] });
const blockSchema = z.object({ reason: z.string().trim().min(3).max(1000) });
const usersQuery = z.object({ q: z.string().trim().max(100).optional(), blocked: z.enum(['true', 'false']).optional() });

const HOUR = 3_600_000;

/**
 * Soporte y moderación del panel global: incidencias con SLA, respuestas predefinidas, cola de
 * BandMarket, denuncias de la bolsa de refuerzos y bloqueo de usuarios.
 */
@ApiTags('admin')
@ApiBearerAuth()
@PlatformAdmin()
@Controller('admin')
export class AdminSupportController {
  constructor(
    private readonly db: Db,
    private readonly jobs: Jobs,
    private readonly support: SupportService,
  ) {}

  private async users(ids: (string | null | undefined)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    const rows = unique.length ? await this.db.system.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, email: true, blockedAt: true } }) : [];
    return new Map(rows.map((u) => [u.id, u]));
  }

  private async tenantNames(ids: string[]) {
    const rows = await this.db.system.tenant.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true, slug: true } });
    return new Map(rows.map((t) => [t.id, t]));
  }

  private async present(rows: Incident[]) {
    const now = new Date();
    const [tenants, users] = await Promise.all([this.tenantNames(rows.map((r) => r.tenantId)), this.users(rows.flatMap((r) => [r.assigneeId, r.openedById]))]);
    const person = (id: string | null) => (id && users.get(id) ? { id, name: users.get(id)!.name, email: users.get(id)!.email } : null);
    return rows.map((r) => ({
      ...r,
      tenant: tenants.get(r.tenantId) ?? null,
      assignee: person(r.assigneeId),
      openedBy: person(r.openedById),
      sla: slaState(r, now),
    }));
  }

  // ── Incidencias ──────────────────────────────────────────────────────────

  @Get('support/kpis')
  kpis() {
    return this.support.kpis();
  }

  @Get('support/agents')
  agents() {
    return this.db.system.user.findMany({ where: { isPlatformAdmin: true }, select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } });
  }

  @Get('support/incidents')
  async list(@Ctx() ctx: RequestContext, @Query(zod(listQuery)) q: z.infer<typeof listQuery>) {
    const now = new Date();
    const where: Prisma.IncidentWhereInput = {
      status: q.status === 'ACTIVE' || q.sla ? { in: ['OPEN', 'IN_PROGRESS'] } : q.status,
      priority: q.priority,
      tenantId: q.tenantId,
      assigneeId: q.assignee === 'none' ? null : q.assignee === 'me' ? ctx.userId : q.assignee,
    };
    if (q.status && q.status !== 'ACTIVE' && q.sla) where.status = q.status;
    if (q.sla) {
      where.firstResponseAt = null;
      where.slaDueAt = q.sla === 'overdue' ? { lt: now } : { gte: now, lte: new Date(now.getTime() + SLA_AT_RISK_MS) };
    }
    if (q.q) {
      const tenants = await this.db.system.tenant.findMany({ where: { name: { contains: q.q, mode: 'insensitive' } }, select: { id: true }, take: 50 });
      where.OR = [
        { subject: { contains: q.q, mode: 'insensitive' } },
        { body: { contains: q.q, mode: 'insensitive' } },
        ...(tenants.length ? [{ tenantId: { in: tenants.map((t) => t.id) } }] : []),
      ];
    }
    const [rows, total] = await Promise.all([
      this.db.system.incident.findMany({
        where,
        orderBy: [{ status: 'asc' }, { slaDueAt: { sort: 'asc', nulls: 'last' } }, { priority: 'asc' }, { createdAt: 'desc' }],
        ...skipTake(q),
      }),
      this.db.system.incident.count({ where }),
    ]);
    return page(await this.present(rows), total, q);
  }

  @Get('support/incidents/:id')
  async detail(@Param('id', zod(idParam)) id: string) {
    const inc = found(await this.db.system.incident.findUnique({ where: { id }, include: { messages: { orderBy: { createdAt: 'asc' } } } }), 'Incidencia');
    const { messages, ...rest } = inc;
    const [[presented], users, tenant] = await Promise.all([
      this.present([rest as Incident]),
      this.users(messages.map((m) => m.authorId)),
      this.db.system.tenant.findUnique({ where: { id: inc.tenantId }, select: { id: true, name: true, slug: true, status: true, plan: { select: { code: true, name: true } } } }),
    ]);
    return {
      ...presented,
      tenant,
      messages: messages.map((m) => ({ ...m, author: m.authorId && users.get(m.authorId) ? { id: m.authorId, name: users.get(m.authorId)!.name } : null })),
    };
  }

  @Patch('support/incidents/:id')
  async update(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(incidentPatch)) body: z.infer<typeof incidentPatch>) {
    const inc = found(await this.db.system.incident.findUnique({ where: { id } }), 'Incidencia');
    if (body.assigneeId) {
      const agent = await this.db.system.user.findUnique({ where: { id: body.assigneeId } });
      if (!agent?.isPlatformAdmin) throw new BadRequestException({ message: 'El responsable debe ser del equipo de plataforma', code: 'INVALID_ASSIGNEE' });
    }
    const data: Prisma.IncidentUncheckedUpdateInput = { status: body.status, priority: body.priority, assigneeId: body.assigneeId, resolution: body.resolution };
    // Al cambiar la prioridad se recalcula el plazo mientras no haya primera respuesta.
    if (body.priority && body.priority !== inc.priority && !inc.firstResponseAt) {
      data.slaDueAt = slaDueAt(inc.createdAt, body.priority);
      data.slaAlertedAt = null;
    }
    const updated = await this.db.system.incident.update({ where: { id }, data });
    await tenantAudit(this.db.system, inc.tenantId, ctx, 'incident.updated', 'incident', id, {
      ...(body.status && { status: body.status }), ...(body.priority && { priority: body.priority }), ...(body.assigneeId !== undefined && { assigneeId: body.assigneeId }),
    });
    if (body.assigneeId && body.assigneeId !== inc.assigneeId && body.assigneeId !== ctx.userId) {
      const agent = await this.db.system.user.findUniqueOrThrow({ where: { id: body.assigneeId }, select: { email: true } });
      await this.jobs.add('email.send', {
        to: agent.email, subject: `[Asignada] P${updated.priority} ${inc.subject}`,
        text: `Se te ha asignado la incidencia «${inc.subject}».\n\n${env().APP_URL}/admin`,
      });
    }
    if (inc.openedById && body.status && body.status !== inc.status && (body.status === 'RESOLVED' || body.status === 'CLOSED')) {
      await this.jobs.add('notify.fanout', {
        tenantId: inc.tenantId, userIds: [inc.openedById], type: 'incident', email: true,
        title: `Incidencia ${body.status === 'RESOLVED' ? 'resuelta' : 'cerrada'}: ${inc.subject}`,
        body: body.resolution ?? 'El equipo de soporte ha cerrado la incidencia.', link: `/incidents?id=${id}`,
      });
    }
    return (await this.present([updated]))[0];
  }

  /** Respuesta pública (llega a la banda por email y notificación) o nota interna (sólo plataforma). */
  @Post('support/incidents/:id/messages')
  async reply(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(replySchema)) body: z.infer<typeof replySchema>) {
    const inc = found(await this.db.system.incident.findUnique({ where: { id } }), 'Incidencia');
    const now = new Date();
    const message = await this.db.system.$transaction(async (sys) => {
      const m = await sys.incidentMessage.create({
        data: { tenantId: inc.tenantId, incidentId: id, authorType: 'PLATFORM', authorId: ctx.userId, body: body.body, internal: body.internal },
      });
      if (!body.internal) {
        await sys.incident.update({
          where: { id },
          data: { firstResponseAt: inc.firstResponseAt ?? now, status: inc.status === 'OPEN' ? 'IN_PROGRESS' : undefined },
        });
      }
      return m;
    });
    await tenantAudit(this.db.system, inc.tenantId, ctx, body.internal ? 'incident.note' : 'incident.replied', 'incident', id, { messageId: message.id });
    if (!body.internal && inc.openedById) {
      await this.jobs.add('notify.fanout', {
        tenantId: inc.tenantId, userIds: [inc.openedById], type: 'incident.reply', email: true,
        title: `Respuesta de soporte: ${inc.subject}`,
        body: body.body.length > 1500 ? `${body.body.slice(0, 1500)}…` : body.body,
        link: `/incidents?id=${id}`,
      });
    }
    return { ...message, author: { id: ctx.userId, name: (await this.users([ctx.userId])).get(ctx.userId)?.name ?? '' } };
  }

  // ── Respuestas predefinidas ──────────────────────────────────────────────

  @Get('support/canned-replies')
  canned() {
    return this.db.system.cannedReply.findMany({ orderBy: { title: 'asc' } });
  }

  private async saveCanned(fn: () => Promise<unknown>) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({ message: 'Ya existe una respuesta con ese título', code: 'DUPLICATE_TITLE' });
      }
      throw e;
    }
  }

  @Post('support/canned-replies')
  createCanned(@Body(zod(cannedSchema)) body: z.infer<typeof cannedSchema>) {
    return this.saveCanned(() => this.db.system.cannedReply.create({ data: body }));
  }

  @Patch('support/canned-replies/:id')
  async updateCanned(@Param('id', zod(idParam)) id: string, @Body(zod(cannedSchema.partial())) body: Partial<z.infer<typeof cannedSchema>>) {
    found(await this.db.system.cannedReply.findUnique({ where: { id } }), 'Respuesta');
    return this.saveCanned(() => this.db.system.cannedReply.update({ where: { id }, data: body }));
  }

  @HttpCode(204)
  @Delete('support/canned-replies/:id')
  async deleteCanned(@Param('id', zod(idParam)) id: string) {
    await this.db.system.cannedReply.deleteMany({ where: { id } });
  }

  // ── BandMarket ───────────────────────────────────────────────────────────

  @Get('market/pending')
  async pending() {
    const now = Date.now();
    const listings = await this.db.system.listing.findMany({
      where: { status: 'PENDING_REVIEW' },
      include: { reports: { where: { resolvedAt: null } } },
      orderBy: [{ submittedAt: { sort: 'asc', nulls: 'first' } }, { updatedAt: 'asc' }],
    });
    const reported = await this.db.system.listing.findMany({
      where: { status: 'PUBLISHED', reports: { some: { resolvedAt: null } } },
      include: { reports: { where: { resolvedAt: null } } },
    });
    const tenants = await this.tenantNames([...listings, ...reported].map((l) => l.tenantId));
    const name = (id: string) => tenants.get(id)?.name;
    return {
      pending: listings.map((l) => {
        const waitingHours = Math.round(((now - (l.submittedAt ?? l.updatedAt).getTime()) / HOUR) * 10) / 10;
        return { ...l, seller: { name: name(l.tenantId) }, waitingHours, slaBreached: waitingHours > MODERATION_SLA_HOURS };
      }),
      reported: reported.map((l) => ({ ...l, seller: { name: name(l.tenantId) } })),
    };
  }

  @HttpCode(200)
  @Post('market/listings/:id/moderate')
  async moderate(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(moderateSchema)) body: z.infer<typeof moderateSchema>) {
    const listing = found(await this.db.system.listing.findUnique({ where: { id } }), 'Anuncio');
    const updated = await this.db.system.$transaction(async (tx) => {
      const l = await tx.listing.update({
        where: { id },
        data: {
          status: body.approve ? 'PUBLISHED' : 'REJECTED',
          moderationNote: body.note ?? null,
          moderatedAt: new Date(),
          publishedAt: body.approve ? (listing.publishedAt ?? new Date()) : null,
        },
      });
      await tx.listingReport.updateMany({ where: { listingId: id, resolvedAt: null }, data: { resolvedAt: new Date() } });
      return l;
    });
    await tenantAudit(this.db.system, listing.tenantId, ctx, body.approve ? 'listing.approved' : 'listing.rejected', 'listing', id, { note: body.note });
    await platformAudit(this.db.system, ctx, body.approve ? 'listing.approved' : 'listing.rejected', 'listing', id, { tenantId: listing.tenantId });
    await this.jobs.add('notify.fanout', {
      tenantId: listing.tenantId, userIds: [listing.createdById], type: 'market.moderation', email: true,
      title: body.approve ? `Anuncio publicado: ${listing.title}` : `Anuncio rechazado: ${listing.title}`,
      body: body.note ?? (body.approve ? 'Tu anuncio ya es visible en BandMarket.' : 'Revisa el anuncio y vuelve a enviarlo.'),
      link: '/market',
    });
    return updated;
  }

  // ── Moderación ampliada ──────────────────────────────────────────────────

  @Get('moderation/kpis')
  moderationKpis() {
    return moderationKpis(this.db);
  }

  /** Denuncias pendientes de la bolsa de refuerzos, agrupadas por necesidad o perfil denunciado. */
  @Get('moderation/reinforcements')
  async reinforcementReports() {
    const reports = await this.db.system.reinforcementReport.findMany({ where: { resolvedAt: null }, orderBy: { createdAt: 'asc' }, take: 500 });
    const [requests, profiles] = await Promise.all([
      this.db.system.reinforcementRequest.findMany({ where: { id: { in: reports.map((r) => r.requestId).filter((x): x is string => !!x) } } }),
      this.db.system.musicianProfile.findMany({ where: { id: { in: reports.map((r) => r.profileId).filter((x): x is string => !!x) } } }),
    ]);
    const [tenants, users] = await Promise.all([
      this.tenantNames([...reports.map((r) => r.reporterTenantId), ...requests.map((r) => r.tenantId)]),
      this.users([...requests.map((r) => r.createdById), ...profiles.map((p) => p.userId)]),
    ]);
    const person = (id: string) => {
      const u = users.get(id);
      return u ? { id, name: u.name, email: u.email, blockedAt: u.blockedAt } : { id, name: '—', email: '', blockedAt: null };
    };
    const groups = new Map<string, { key: string; kind: 'request' | 'profile'; request?: unknown; profile?: unknown; reports: unknown[]; firstReportedAt: Date }>();
    for (const r of reports) {
      const key = r.requestId ? `request:${r.requestId}` : `profile:${r.profileId}`;
      if (!groups.has(key)) {
        const req = r.requestId ? requests.find((x) => x.id === r.requestId) : undefined;
        const prof = r.profileId ? profiles.find((x) => x.id === r.profileId) : undefined;
        groups.set(key, {
          key,
          kind: r.requestId ? 'request' : 'profile',
          request: req && {
            id: req.id, title: req.title, instrument: req.instrument, date: req.date, province: req.province, description: req.description,
            status: req.status, band: tenants.get(req.tenantId) ?? null, createdBy: person(req.createdById),
          },
          profile: prof && {
            id: prof.id, displayName: prof.displayName, instruments: prof.instruments, province: prof.province, city: prof.city, bio: prof.bio,
            available: prof.available, user: person(prof.userId),
          },
          reports: [],
          firstReportedAt: r.createdAt,
        });
      }
      groups.get(key)!.reports.push({ id: r.id, reason: r.reason, createdAt: r.createdAt, reporterBand: tenants.get(r.reporterTenantId)?.name ?? 'Banda' });
    }
    return [...groups.values()];
  }

  @HttpCode(200)
  @Post('moderation/reinforcements/reports/:id/resolve')
  async resolveReport(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(resolveSchema)) body: z.infer<typeof resolveSchema>) {
    const report = found(await this.db.system.reinforcementReport.findUnique({ where: { id } }), 'Denuncia');
    if (report.resolvedAt) throw new BadRequestException({ message: 'La denuncia ya está resuelta', code: 'ALREADY_RESOLVED' });
    const request = report.requestId ? await this.db.system.reinforcementRequest.findUnique({ where: { id: report.requestId } }) : null;
    const profile = report.profileId ? await this.db.system.musicianProfile.findUnique({ where: { id: report.profileId } }) : null;
    if (body.action === 'hide_request' && !request) throw new BadRequestException({ message: 'La denuncia no es de una necesidad', code: 'INVALID_ACTION' });
    if (body.action === 'hide_profile' && !profile) throw new BadRequestException({ message: 'La denuncia no es de un perfil', code: 'INVALID_ACTION' });

    if (body.action === 'block_user') {
      const userId = request?.createdById ?? profile?.userId;
      if (!userId) throw found(null, 'Usuario');
      await blockUser(this.db, ctx, userId, body.note!);
    }
    if ((body.action === 'hide_request' || body.action === 'block_user') && request && request.status === 'OPEN') {
      await this.db.system.reinforcementRequest.update({ where: { id: request.id }, data: { status: 'CANCELLED' } });
      const managers = await this.db.system.membership.findMany({
        where: { tenantId: request.tenantId, status: 'ACTIVE', OR: [{ userId: request.createdById }, { role: { permissions: { has: 'reinforcements:manage' } } }] },
        select: { userId: true },
      });
      await this.jobs.add('notify.fanout', {
        tenantId: request.tenantId, userIds: managers.map((m) => m.userId), type: 'reinforcement.moderation', email: true,
        title: `Necesidad retirada por moderación: ${request.title}`,
        body: body.note ?? 'La necesidad incumple las normas de la bolsa de refuerzos y ya no es visible.', link: '/reinforcements',
      });
    }
    if ((body.action === 'hide_profile' || body.action === 'block_user') && profile) {
      await this.db.system.musicianProfile.update({ where: { id: profile.id }, data: { available: false } });
      if (body.action === 'hide_profile') {
        const user = await this.db.system.user.findUnique({ where: { id: profile.userId }, select: { email: true } });
        if (user) {
          await this.jobs.add('email.send', {
            to: user.email, subject: 'Tu perfil de músico se ha ocultado',
            text: `El equipo de Solfeamos ha ocultado tu perfil de la bolsa de refuerzos.${body.note ? `\n\nMotivo: ${body.note}` : ''}`,
          });
        }
      }
    }
    const resolution = body.note ? `${body.action}: ${body.note}` : body.action;
    const { count } = await this.db.system.reinforcementReport.updateMany({
      where: { resolvedAt: null, ...(report.requestId ? { requestId: report.requestId } : { profileId: report.profileId }) },
      data: { resolvedAt: new Date(), resolution },
    });
    await platformAudit(this.db.system, ctx, 'reinforcement.report.resolved', report.requestId ? 'reinforcement_request' : 'musician_profile', report.requestId ?? report.profileId, {
      action: body.action, reports: count, note: body.note,
    });
    if (request) await tenantAudit(this.db.system, request.tenantId, ctx, `reinforcement.moderated`, 'reinforcement_request', request.id, { action: body.action });
    return { resolved: count, action: body.action };
  }

  @Get('moderation/users')
  async searchUsers(@Query(zod(usersQuery)) q: z.infer<typeof usersQuery>) {
    if (!q.q && q.blocked !== 'true') return [];
    return this.db.system.user.findMany({
      where: {
        blockedAt: q.blocked === 'true' ? { not: null } : undefined,
        ...(q.q && { OR: [{ email: { contains: q.q, mode: 'insensitive' } }, { name: { contains: q.q, mode: 'insensitive' } }] }),
      },
      select: { id: true, name: true, email: true, isPlatformAdmin: true, blockedAt: true, blockedReason: true, lastLoginAt: true },
      orderBy: { email: 'asc' },
      take: 50,
    });
  }

  @HttpCode(200)
  @Post('moderation/users/:id/block')
  block(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(blockSchema)) body: z.infer<typeof blockSchema>) {
    return blockUser(this.db, ctx, id, body.reason);
  }

  @HttpCode(200)
  @Post('moderation/users/:id/unblock')
  unblock(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return unblockUser(this.db, ctx, id);
  }
}
