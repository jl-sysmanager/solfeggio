import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Assembly, Prisma } from '@prisma/client';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, Perm, RequireFeature } from '../auth/decorators';
import { found } from '../common/errors';
import { idParam, isoDate, isoDateTime, optionalText, toDate } from '../common/schemas';
import { zod } from '../common/zod.pipe';
import { Db, Tx } from '../db/db.service';
import { Audit } from '../audit/audit.service';
import { Jobs } from '../jobs/jobs.service';
import { AgendaItem, formatDateTime, minutesDraft, Quorum, TYPE_LABEL, VoteCounts } from './minutes';

const agendaItem = z.object({ title: z.string().trim().min(1).max(200), description: optionalText(2000) });
const assemblyFields = z.object({
  type: z.enum(['ORDINARY', 'EXTRAORDINARY']),
  title: z.string().trim().min(1).max(200),
  firstCallAt: isoDateTime,
  secondCallAt: isoDateTime.nullable().optional(),
  location: optionalText(200),
  agenda: z.array(agendaItem).max(50).default([]),
  quorumPct: z.number().int().min(0).max(100).optional(),
});
const callsInOrder = (a: { firstCallAt?: string | Date; secondCallAt?: string | Date | null }) =>
  !a.firstCallAt || !a.secondCallAt || new Date(a.secondCallAt) > new Date(a.firstCallAt);
const CALLS_MSG = { message: 'La segunda convocatoria debe ser posterior a la primera', path: ['secondCallAt'] };
const assemblyCreate = assemblyFields.refine(callsInOrder, CALLS_MSG);
const assemblyPatch = assemblyFields.partial();
const attendanceSchema = z.array(z.object({ memberId: z.string().uuid(), proxyForId: z.string().uuid().nullable().optional() })).max(2000);
const motionSchema = z.object({ title: z.string().trim().min(1).max(200), description: optionalText(5000), allowRemote: z.boolean().optional() });
const choice = z.enum(['YES', 'NO', 'ABSTAIN']);
const voteSchema = z.object({ choice, onBehalfOf: z.string().uuid().optional() });
const bulkVotesSchema = z.array(z.object({ memberId: z.string().uuid(), choice })).min(1).max(2000);
const draftSchema = z.object({ overwrite: z.boolean().default(false) });
const minutesSchema = z.object({ minutes: z.string().max(200_000) });
const boardFields = z.object({
  memberId: z.string().uuid(),
  position: z.string().trim().min(1).max(60),
  startsOn: isoDate,
  endsOn: isoDate.nullable().optional(),
  notes: optionalText(500),
});
const mandateInOrder = (b: { startsOn?: string; endsOn?: string | null }) => !b.startsOn || !b.endsOn || b.endsOn >= b.startsOn;
const MANDATE_MSG = { message: 'El fin del mandato debe ser posterior al inicio', path: ['endsOn'] };
const boardQuery = z.object({ current: z.enum(['true', 'false']).optional() });
const pollFields = z.object({
  question: z.string().trim().min(1).max(300),
  options: z
    .array(z.string().trim().min(1).max(200))
    .min(2)
    .max(20)
    .refine((o) => new Set(o.map((x) => x.toLowerCase())).size === o.length, 'Las opciones no pueden repetirse'),
  multiple: z.boolean().default(false),
  anonymous: z.boolean().default(false),
  closesAt: isoDateTime.nullable().optional(),
});
const pollCreate = pollFields.extend({ notify: z.boolean().default(false) });
const pollVoteSchema = z.object({ choices: z.array(z.number().int().min(0)).min(1).max(20) });

const conflict = (message: string, code: string) => new ConflictException({ message, code });
const bad = (message: string, code: string) => new BadRequestException({ message, code });
const forbidden = (message: string, code: string) => new ForbiddenException({ message, code });

const memberSelect = { id: true, firstName: true, lastName: true, memberNumber: true } as const;
const name = (m: { firstName: string; lastName: string }) => `${m.firstName} ${m.lastName}`;
const agendaOf = (a: Pick<Assembly, 'agenda'>) => (Array.isArray(a.agenda) ? (a.agenda as unknown as AgendaItem[]) : []);
const DAY = 86_400_000;
/** Orden protocolario de los cargos de la junta. */
const POSITION_RANK = ['presiden', 'vicepresiden', 'secretari', 'tesorer', 'vocal'];
const rank = (p: string) => {
  const i = POSITION_RANK.findIndex((k) => p.toLowerCase().startsWith(k));
  return i === -1 ? POSITION_RANK.length : i;
};

export function voteCounts(votes: { choice: string; remote: boolean }[]): VoteCounts {
  const r: VoteCounts = { YES: 0, NO: 0, ABSTAIN: 0, total: votes.length, remote: 0 };
  for (const v of votes) {
    r[v.choice as 'YES' | 'NO' | 'ABSTAIN']++;
    if (v.remote) r.remote++;
  }
  return r;
}

async function quorumOf(tx: Tx, a: Pick<Assembly, 'id' | 'quorumPct'>): Promise<Quorum> {
  const [activeMembers, rows] = await Promise.all([
    tx.member.count({ where: { status: 'ACTIVE' } }),
    tx.assemblyAttendance.findMany({ where: { assemblyId: a.id }, select: { memberId: true, proxyForId: true } }),
  ]);
  const present = new Set(rows.map((r) => r.memberId)).size;
  const represented = rows.filter((r) => r.proxyForId).length;
  const requiredFirstCall = Math.ceil((activeMembers * a.quorumPct) / 100);
  return { activeMembers, present, represented, total: present + represented, quorumPct: a.quorumPct, requiredFirstCall, metFirstCall: present + represented >= requiredFirstCall };
}

const pollIsOpen = (p: { closedAt: Date | null; closesAt: Date | null }) => !p.closedAt && (!p.closesAt || p.closesAt > new Date());

@ApiTags('governance')
@ApiBearerAuth()
@RequireFeature('governance')
@Controller('governance')
export class GovernanceController {
  constructor(
    private readonly db: Db,
    private readonly audit: Audit,
    private readonly jobs: Jobs,
  ) {}

  // ───────────── Asambleas ─────────────

  @Perm('governance:read')
  @Get('assemblies')
  assemblies(@Ctx() ctx: RequestContext) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const rows = await tx.assembly.findMany({
        orderBy: { firstCallAt: 'desc' },
        take: 200,
        include: { _count: { select: { motions: true } } },
      });
      return rows.map(({ minutes, ...a }) => ({ ...a, hasMinutes: !!minutes }));
    });
  }

  @Perm('governance:write')
  @Post('assemblies')
  createAssembly(@Ctx() ctx: RequestContext, @Body(zod(assemblyCreate)) body: z.infer<typeof assemblyCreate>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const a = await tx.assembly.create({
        data: {
          ...body,
          firstCallAt: new Date(body.firstCallAt),
          secondCallAt: body.secondCallAt ? new Date(body.secondCallAt) : null,
          agenda: body.agenda as Prisma.InputJsonValue,
          tenantId: ctx.tenantId,
        },
      });
      await this.audit.log(tx, ctx, 'assembly.created', 'assembly', a.id, { type: a.type, title: a.title });
      return a;
    });
  }

  @Perm('governance:read')
  @Get('assemblies/:id')
  assembly(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const a = found(
        await tx.assembly.findUnique({
          where: { id },
          include: {
            attendance: { include: { member: { select: memberSelect } } },
            motions: { include: { votes: { include: { member: { select: memberSelect } } } }, orderBy: [{ openedAt: { sort: 'asc', nulls: 'last' } }, { title: 'asc' }] },
          },
        }),
        'Asamblea',
      );
      const write = ctx.permissions.has('governance:write');
      const proxyIds = a.attendance.map((r) => r.proxyForId).filter((x): x is string => !!x);
      const proxied = new Map((await tx.member.findMany({ where: { id: { in: proxyIds } }, select: memberSelect })).map((m) => [m.id, m]));
      const me = ctx.memberId;
      const myProxies = a.attendance.filter((r) => me && r.memberId === me && r.proxyForId).map((r) => proxied.get(r.proxyForId!)!).filter(Boolean);
      const { attendance, motions, ...rest } = a;
      return {
        ...rest,
        agenda: agendaOf(a),
        // El borrador del acta sólo lo ve quien la redacta hasta su aprobación.
        minutes: a.minutesApprovedAt || write ? a.minutes : null,
        attendance: attendance
          .map((r) => ({ id: r.id, memberId: r.memberId, member: r.member, proxyForId: r.proxyForId, proxyFor: r.proxyForId ? proxied.get(r.proxyForId) ?? null : null }))
          .sort((x, y) => x.member.lastName.localeCompare(y.member.lastName, 'es')),
        quorum: await quorumOf(tx, a),
        me: {
          memberId: me,
          present: !!me && attendance.some((r) => r.memberId === me),
          delegated: !!me && attendance.some((r) => r.proxyForId === me),
          proxies: myProxies,
        },
        motions: motions.map(({ votes, ...m }) => ({
          ...m,
          results: voteCounts(votes),
          myVote: votes.find((v) => v.memberId === me) ? { choice: votes.find((v) => v.memberId === me)!.choice, remote: votes.find((v) => v.memberId === me)!.remote } : null,
          proxyVotes: Object.fromEntries(votes.filter((v) => myProxies.some((p) => p.id === v.memberId)).map((v) => [v.memberId, v.choice])),
          votes: write ? votes.map((v) => ({ memberId: v.memberId, member: v.member, choice: v.choice, remote: v.remote, castAt: v.castAt })) : undefined,
        })),
      };
    });
  }

  @Perm('governance:write')
  @Patch('assemblies/:id')
  updateAssembly(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(assemblyPatch)) body: z.infer<typeof assemblyPatch>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const a = found(await tx.assembly.findUnique({ where: { id } }), 'Asamblea');
      if (a.status !== 'DRAFT' && a.status !== 'CONVENED') throw conflict('La asamblea ya se ha celebrado y no se puede modificar', 'ASSEMBLY_LOCKED');
      const merged = { firstCallAt: body.firstCallAt ?? a.firstCallAt, secondCallAt: body.secondCallAt !== undefined ? body.secondCallAt : a.secondCallAt };
      if (!callsInOrder(merged)) throw bad(CALLS_MSG.message, 'VALIDATION_ERROR');
      const updated = await tx.assembly.update({
        where: { id },
        data: {
          ...body,
          firstCallAt: body.firstCallAt ? new Date(body.firstCallAt) : undefined,
          secondCallAt: body.secondCallAt !== undefined ? (body.secondCallAt ? new Date(body.secondCallAt) : null) : undefined,
          agenda: body.agenda as Prisma.InputJsonValue | undefined,
        },
      });
      await this.audit.log(tx, ctx, 'assembly.updated', 'assembly', id, { fields: Object.keys(body) });
      return updated;
    });
  }

  @Perm('governance:write')
  @HttpCode(204)
  @Delete('assemblies/:id')
  async deleteAssembly(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    await this.db.tenant(ctx.tenantId, async (tx) => {
      const a = found(await tx.assembly.findUnique({ where: { id } }), 'Asamblea');
      if (a.status !== 'DRAFT') throw conflict('Sólo se pueden eliminar asambleas en borrador', 'ASSEMBLY_LOCKED');
      await tx.assembly.delete({ where: { id } });
      await this.audit.log(tx, ctx, 'assembly.deleted', 'assembly', id, { title: a.title });
    });
  }

  /** Convoca la asamblea y avisa a todos los socios activos (in-app y email). */
  @Perm('governance:write')
  @HttpCode(200)
  @Post('assemblies/:id/convene')
  async convene(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    const { a, memberIds, tz } = await this.db.tenant(ctx.tenantId, async (tx) => {
      const current = found(await tx.assembly.findUnique({ where: { id } }), 'Asamblea');
      if (current.status !== 'DRAFT') throw conflict('La asamblea ya está convocada', 'ASSEMBLY_STATUS');
      const a = await tx.assembly.update({ where: { id }, data: { status: 'CONVENED', convenedAt: new Date() } });
      const members = await tx.member.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
      const tenant = await tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { timezone: true } });
      await this.audit.log(tx, ctx, 'assembly.convened', 'assembly', id, { recipients: members.length });
      return { a, memberIds: members.map((m) => m.id), tz: tenant?.timezone ?? 'Europe/Madrid' };
    });
    if (memberIds.length) {
      const agenda = agendaOf(a);
      const body = [
        `Se convoca Asamblea General ${TYPE_LABEL[a.type]}: «${a.title}».`,
        '',
        `Primera convocatoria: ${formatDateTime(a.firstCallAt, tz)}`,
        a.secondCallAt ? `Segunda convocatoria: ${formatDateTime(a.secondCallAt, tz)}` : null,
        a.location ? `Lugar: ${a.location}` : null,
        '',
        'Orden del día:',
        ...(agenda.length ? agenda.map((p, i) => `${i + 1}. ${p.title}${p.description ? ` — ${p.description}` : ''}`) : ['(por determinar)']),
      ]
        .filter((l) => l !== null)
        .join('\n');
      await this.jobs.add('notify.fanout', {
        tenantId: ctx.tenantId, memberIds, type: 'assembly.convened', email: true,
        title: `Convocatoria de Asamblea General ${TYPE_LABEL[a.type]}: ${a.title}`,
        body,
        link: `/governance/assemblies/${a.id}`,
      });
    }
    return a;
  }

  @Perm('governance:write')
  @HttpCode(200)
  @Post('assemblies/:id/hold')
  hold(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.transition(ctx, id, 'CONVENED', 'HELD');
  }

  /** Cierra la asamblea y las votaciones que siguieran abiertas. */
  @Perm('governance:write')
  @HttpCode(200)
  @Post('assemblies/:id/close')
  close(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.transition(ctx, id, 'HELD', 'CLOSED');
  }

  private transition(ctx: RequestContext, id: string, from: 'CONVENED' | 'HELD', to: 'HELD' | 'CLOSED') {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const a = found(await tx.assembly.findUnique({ where: { id } }), 'Asamblea');
      if (a.status !== from) throw conflict('La asamblea no está en el estado adecuado', 'ASSEMBLY_STATUS');
      if (to === 'CLOSED') await tx.motion.updateMany({ where: { assemblyId: id, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: new Date() } });
      const updated = await tx.assembly.update({ where: { id }, data: { status: to } });
      await this.audit.log(tx, ctx, `assembly.${to.toLowerCase()}`, 'assembly', id);
      return updated;
    });
  }

  /**
   * Lista de asistentes. Cada fila es un socio presente y, opcionalmente, un socio ausente que le
   * delega su voto (máximo dos delegaciones por asistente).
   */
  @Perm('governance:write')
  @Put('assemblies/:id/attendance')
  attendance(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(attendanceSchema)) body: z.infer<typeof attendanceSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const a = found(await tx.assembly.findUnique({ where: { id } }), 'Asamblea');
      if (a.status !== 'CONVENED' && a.status !== 'HELD') throw conflict('Sólo se registra la asistencia de asambleas convocadas o en curso', 'ASSEMBLY_STATUS');
      const present = new Set(body.map((r) => r.memberId));
      const proxies = new Map<string, string[]>();
      const delegators = new Set<string>();
      for (const r of body) {
        if (!r.proxyForId) continue;
        if (r.proxyForId === r.memberId) throw bad('Un socio no puede representarse a sí mismo', 'PROXY_SELF');
        if (present.has(r.proxyForId)) throw bad('El socio que delega está presente en la asamblea', 'PROXY_PRESENT');
        if (delegators.has(r.proxyForId)) throw bad('Un socio sólo puede delegar su voto una vez', 'PROXY_DUPLICATE');
        delegators.add(r.proxyForId);
        const list = [...(proxies.get(r.memberId) ?? []), r.proxyForId];
        if (list.length > 2) throw bad('Cada asistente puede representar como máximo a dos socios', 'PROXY_LIMIT');
        proxies.set(r.memberId, list);
      }
      const ids = [...new Set([...present, ...delegators])];
      const members = await tx.member.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } });
      if (members.length !== ids.length) found(null, 'Socio');
      if (members.some((m) => m.status !== 'ACTIVE')) throw bad('Sólo los socios activos pueden asistir o delegar su voto', 'MEMBER_NOT_ACTIVE');

      await tx.assemblyAttendance.deleteMany({ where: { assemblyId: id } });
      await tx.assemblyAttendance.createMany({
        data: [...present].flatMap((memberId) =>
          (proxies.get(memberId) ?? [null]).map((proxyForId) => ({ tenantId: ctx.tenantId, assemblyId: id, memberId, proxyForId })),
        ),
      });
      await this.audit.log(tx, ctx, 'assembly.attendance', 'assembly', id, { present: present.size, represented: delegators.size });
      return quorumOf(tx, a);
    });
  }

  @Perm('governance:read')
  @Get('assemblies/:id/quorum')
  quorum(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => quorumOf(tx, found(await tx.assembly.findUnique({ where: { id } }), 'Asamblea')));
  }

  // ───────────── Votaciones ─────────────

  @Perm('governance:write')
  @Post('assemblies/:id/motions')
  createMotion(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(motionSchema)) body: z.infer<typeof motionSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const a = found(await tx.assembly.findUnique({ where: { id } }), 'Asamblea');
      if (a.status === 'CLOSED') throw conflict('La asamblea está cerrada', 'ASSEMBLY_STATUS');
      const m = await tx.motion.create({ data: { ...body, assemblyId: id, tenantId: ctx.tenantId } });
      await this.audit.log(tx, ctx, 'motion.created', 'motion', m.id, { title: m.title });
      return m;
    });
  }

  @Perm('governance:read')
  @Get('motions/:id')
  motion(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const { votes, ...m } = found(await tx.motion.findUnique({ where: { id }, include: { votes: { include: { member: { select: memberSelect } } } } }), 'Votación');
      const mine = votes.find((v) => v.memberId === ctx.memberId);
      return {
        ...m,
        results: voteCounts(votes),
        myVote: mine ? { choice: mine.choice, remote: mine.remote } : null,
        votes: ctx.permissions.has('governance:write') ? votes.map((v) => ({ memberId: v.memberId, member: v.member, choice: v.choice, remote: v.remote, castAt: v.castAt })) : undefined,
      };
    });
  }

  @Perm('governance:write')
  @Patch('motions/:id')
  updateMotion(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(motionSchema.partial())) body: Partial<z.infer<typeof motionSchema>>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const m = found(await tx.motion.findUnique({ where: { id } }), 'Votación');
      if (m.status !== 'DRAFT') throw conflict('Sólo se pueden editar votaciones que no se han abierto', 'MOTION_STATUS');
      return tx.motion.update({ where: { id }, data: body });
    });
  }

  @Perm('governance:write')
  @HttpCode(204)
  @Delete('motions/:id')
  async deleteMotion(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    await this.db.tenant(ctx.tenantId, async (tx) => {
      const m = found(await tx.motion.findUnique({ where: { id } }), 'Votación');
      if (m.status !== 'DRAFT') throw conflict('Sólo se pueden eliminar votaciones que no se han abierto', 'MOTION_STATUS');
      await tx.motion.delete({ where: { id } });
      await this.audit.log(tx, ctx, 'motion.deleted', 'motion', id, { title: m.title });
    });
  }

  @Perm('governance:write')
  @HttpCode(200)
  @Post('motions/:id/open')
  openMotion(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const m = found(await tx.motion.findUnique({ where: { id }, include: { assembly: true } }), 'Votación');
      if (m.status !== 'DRAFT') throw conflict('La votación ya se ha abierto', 'MOTION_STATUS');
      if (m.assembly.status !== 'CONVENED' && m.assembly.status !== 'HELD') throw conflict('La asamblea debe estar convocada o en curso', 'ASSEMBLY_STATUS');
      const updated = await tx.motion.update({ where: { id }, data: { status: 'OPEN', openedAt: new Date() } });
      await this.audit.log(tx, ctx, 'motion.opened', 'motion', id);
      return updated;
    });
  }

  @Perm('governance:write')
  @HttpCode(200)
  @Post('motions/:id/close')
  closeMotion(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const m = found(await tx.motion.findUnique({ where: { id } }), 'Votación');
      if (m.status !== 'OPEN') throw conflict('La votación no está abierta', 'MOTION_STATUS');
      const updated = await tx.motion.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date() } });
      const votes = await tx.motionVote.findMany({ where: { motionId: id }, select: { choice: true, remote: true } });
      await this.audit.log(tx, ctx, 'motion.closed', 'motion', id, { ...voteCounts(votes) });
      return { ...updated, results: voteCounts(votes) };
    });
  }

  /**
   * Voto del socio vinculado al usuario. Presente: voto presencial. Ausente: voto a distancia si la
   * votación lo permite y no ha delegado su voto. `onBehalfOf`: voto delegado que el asistente tiene registrado.
   */
  @Perm('governance:vote')
  @HttpCode(200)
  @Post('motions/:id/vote')
  vote(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(voteSchema)) body: z.infer<typeof voteSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      if (!ctx.memberId) throw forbidden('Tu usuario no está vinculado a ningún socio', 'NO_MEMBER');
      const m = found(await tx.motion.findUnique({ where: { id } }), 'Votación');
      if (m.status !== 'OPEN') throw conflict('La votación no está abierta', 'MOTION_NOT_OPEN');
      const voter = await tx.member.findUnique({ where: { id: ctx.memberId }, select: { status: true } });
      if (voter?.status !== 'ACTIVE') throw forbidden('Sólo votan los socios activos', 'NOT_ACTIVE_MEMBER');
      const rows = await tx.assemblyAttendance.findMany({ where: { assemblyId: m.assemblyId, OR: [{ memberId: ctx.memberId }, { proxyForId: ctx.memberId }] } });
      let memberId = ctx.memberId;
      let remote = false;
      if (body.onBehalfOf) {
        if (!rows.some((r) => r.memberId === ctx.memberId && r.proxyForId === body.onBehalfOf)) {
          throw forbidden('No tienes registrada la representación de ese socio', 'NOT_PROXY_HOLDER');
        }
        memberId = body.onBehalfOf;
      } else if (!rows.some((r) => r.memberId === ctx.memberId)) {
        if (rows.some((r) => r.proxyForId === ctx.memberId)) throw conflict('Has delegado tu voto en otro socio', 'VOTE_DELEGATED');
        if (!m.allowRemote) throw forbidden('Esta votación no admite voto a distancia', 'REMOTE_NOT_ALLOWED');
        remote = true;
      }
      const v = await tx.motionVote.upsert({
        where: { motionId_memberId: { motionId: id, memberId } },
        create: { tenantId: ctx.tenantId, motionId: id, memberId, choice: body.choice, remote },
        update: { choice: body.choice, remote, castAt: new Date() },
      });
      return { memberId: v.memberId, choice: v.choice, remote: v.remote };
    });
  }

  /** El secretario anota en bloque los votos emitidos en la sala (presentes o representados). */
  @Perm('governance:write')
  @Put('motions/:id/votes')
  bulkVotes(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(bulkVotesSchema)) body: z.infer<typeof bulkVotesSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const m = found(await tx.motion.findUnique({ where: { id } }), 'Votación');
      if (m.status !== 'OPEN') throw conflict('La votación no está abierta', 'MOTION_NOT_OPEN');
      const ids = [...new Set(body.map((v) => v.memberId))];
      if (ids.length !== body.length) throw bad('Un socio sólo puede votar una vez', 'DUPLICATE_VOTE');
      if ((await tx.member.count({ where: { id: { in: ids } } })) !== ids.length) found(null, 'Socio');
      const rows = await tx.assemblyAttendance.findMany({ where: { assemblyId: m.assemblyId } });
      const inRoom = new Set(rows.flatMap((r) => [r.memberId, r.proxyForId].filter((x): x is string => !!x)));
      if (ids.some((x) => !inRoom.has(x))) throw bad('Sólo se registran votos de socios presentes o representados', 'NOT_IN_ATTENDANCE');
      for (const v of body) {
        await tx.motionVote.upsert({
          where: { motionId_memberId: { motionId: id, memberId: v.memberId } },
          create: { tenantId: ctx.tenantId, motionId: id, memberId: v.memberId, choice: v.choice, remote: false },
          update: { choice: v.choice, remote: false, castAt: new Date() },
        });
      }
      const votes = await tx.motionVote.findMany({ where: { motionId: id }, select: { choice: true, remote: true } });
      await this.audit.log(tx, ctx, 'motion.votes_recorded', 'motion', id, { count: body.length });
      return voteCounts(votes);
    });
  }

  // ───────────── Libro de actas ─────────────

  @Perm('governance:write')
  @HttpCode(200)
  @Post('assemblies/:id/minutes/draft')
  draft(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(draftSchema)) body: z.infer<typeof draftSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const a = found(
        await tx.assembly.findUnique({
          where: { id },
          include: { attendance: { include: { member: { select: memberSelect } } }, motions: { include: { votes: { select: { choice: true, remote: true } } }, orderBy: [{ openedAt: { sort: 'asc', nulls: 'last' } }, { title: 'asc' }] } },
        }),
        'Asamblea',
      );
      if (a.minutesApprovedAt) throw conflict('El acta ya está aprobada', 'MINUTES_APPROVED');
      const tenant = found(await tx.tenant.findUnique({ where: { id: ctx.tenantId } }), 'Banda');
      const proxyIds = a.attendance.map((r) => r.proxyForId).filter((x): x is string => !!x);
      const proxied = new Map((await tx.member.findMany({ where: { id: { in: proxyIds } }, select: memberSelect })).map((m) => [m.id, name(m)]));
      const attendees = new Map<string, { name: string; proxies: string[] }>();
      for (const r of [...a.attendance].sort((x, y) => x.member.lastName.localeCompare(y.member.lastName, 'es'))) {
        const e = attendees.get(r.memberId) ?? { name: name(r.member), proxies: [] };
        if (r.proxyForId) e.proxies.push(proxied.get(r.proxyForId) ?? '—');
        attendees.set(r.memberId, e);
      }
      const today = new Date();
      const board = await tx.boardPosition.findMany({
        where: { startsOn: { lte: today }, OR: [{ endsOn: null }, { endsOn: { gte: toDate(today.toISOString().slice(0, 10)) } }] },
        include: { member: { select: memberSelect } },
      });
      const holder = (prefix: string) => {
        const b = board.find((p) => p.position.toLowerCase().startsWith(prefix));
        return b ? name(b.member) : null;
      };
      const text = minutesDraft({
        tenantName: tenant.legalName || tenant.name,
        timezone: tenant.timezone,
        assembly: { ...a, agenda: agendaOf(a) },
        attendees: [...attendees.values()],
        quorum: await quorumOf(tx, a),
        motions: a.motions.map((m) => ({ title: m.title, description: m.description, status: m.status, results: voteCounts(m.votes) })),
        president: holder('presiden'),
        secretary: holder('secretari'),
      });
      const saved = !a.minutes?.trim() || body.overwrite;
      if (saved) {
        await tx.assembly.update({ where: { id }, data: { minutes: text } });
        await this.audit.log(tx, ctx, 'assembly.minutes_drafted', 'assembly', id);
      }
      return { minutes: text, saved };
    });
  }

  @Perm('governance:write')
  @Put('assemblies/:id/minutes')
  saveMinutes(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(minutesSchema)) body: z.infer<typeof minutesSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const a = found(await tx.assembly.findUnique({ where: { id } }), 'Asamblea');
      if (a.minutesApprovedAt) throw conflict('El acta ya está aprobada y no se puede modificar', 'MINUTES_APPROVED');
      const updated = await tx.assembly.update({ where: { id }, data: { minutes: body.minutes } });
      await this.audit.log(tx, ctx, 'assembly.minutes_saved', 'assembly', id, { length: body.minutes.length });
      return { id: updated.id, minutes: updated.minutes, minutesApprovedAt: updated.minutesApprovedAt };
    });
  }

  @Perm('governance:write')
  @HttpCode(200)
  @Post('assemblies/:id/minutes/approve')
  approveMinutes(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const a = found(await tx.assembly.findUnique({ where: { id } }), 'Asamblea');
      if (a.minutesApprovedAt) throw conflict('El acta ya está aprobada', 'MINUTES_APPROVED');
      if (a.status !== 'HELD' && a.status !== 'CLOSED') throw conflict('Sólo se aprueba el acta de una asamblea celebrada', 'ASSEMBLY_STATUS');
      if (!a.minutes?.trim()) throw bad('El acta está vacía', 'MINUTES_EMPTY');
      const updated = await tx.assembly.update({ where: { id }, data: { minutesApprovedAt: new Date() } });
      await this.audit.log(tx, ctx, 'assembly.minutes_approved', 'assembly', id);
      return { id: updated.id, minutes: updated.minutes, minutesApprovedAt: updated.minutesApprovedAt };
    });
  }

  /** Libro de actas: actas aprobadas por orden cronológico. */
  @Perm('governance:read')
  @Get('minutes')
  minutesBook(@Ctx() ctx: RequestContext) {
    return this.db.tenant(ctx.tenantId, (tx) =>
      tx.assembly.findMany({
        where: { minutesApprovedAt: { not: null } },
        orderBy: { firstCallAt: 'asc' },
        select: { id: true, type: true, title: true, firstCallAt: true, location: true, minutes: true, minutesApprovedAt: true },
      }),
    );
  }

  // ───────────── Junta directiva ─────────────

  @Perm('governance:read')
  @Get('board')
  board(@Ctx() ctx: RequestContext, @Query(zod(boardQuery)) q: z.infer<typeof boardQuery>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const today = toDate(new Date().toISOString().slice(0, 10));
      const rows = await tx.boardPosition.findMany({
        where: q.current === 'true' ? { startsOn: { lte: today }, OR: [{ endsOn: null }, { endsOn: { gte: today } }] } : undefined,
        include: { member: { select: memberSelect } },
        orderBy: [{ startsOn: 'desc' }],
      });
      const soon = new Date(today.getTime() + 60 * DAY);
      return rows
        .map((p) => {
          const current = p.startsOn <= today && (!p.endsOn || p.endsOn >= today);
          return { ...p, current, expiringSoon: current && !!p.endsOn && p.endsOn <= soon };
        })
        .sort((x, y) => Number(y.current) - Number(x.current) || rank(x.position) - rank(y.position) || y.startsOn.getTime() - x.startsOn.getTime());
    });
  }

  @Perm('governance:write')
  @Post('board')
  createBoard(@Ctx() ctx: RequestContext, @Body(zod(boardFields.refine(mandateInOrder, MANDATE_MSG))) body: z.infer<typeof boardFields>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.member.findUnique({ where: { id: body.memberId } }), 'Socio');
      const p = await tx.boardPosition.create({
        data: { ...body, startsOn: toDate(body.startsOn), endsOn: body.endsOn ? toDate(body.endsOn) : null, tenantId: ctx.tenantId },
        include: { member: { select: memberSelect } },
      });
      await this.audit.log(tx, ctx, 'board.created', 'board_position', p.id, { position: p.position, memberId: p.memberId });
      return p;
    });
  }

  @Perm('governance:write')
  @Patch('board/:id')
  updateBoard(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(boardFields.partial())) body: Partial<z.infer<typeof boardFields>>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const p = found(await tx.boardPosition.findUnique({ where: { id } }), 'Cargo');
      if (body.memberId) found(await tx.member.findUnique({ where: { id: body.memberId } }), 'Socio');
      const merged = { startsOn: body.startsOn ?? p.startsOn.toISOString().slice(0, 10), endsOn: body.endsOn !== undefined ? body.endsOn : p.endsOn?.toISOString().slice(0, 10) };
      if (!mandateInOrder(merged)) throw bad(MANDATE_MSG.message, 'VALIDATION_ERROR');
      const updated = await tx.boardPosition.update({
        where: { id },
        data: {
          ...body,
          startsOn: body.startsOn ? toDate(body.startsOn) : undefined,
          endsOn: body.endsOn !== undefined ? (body.endsOn ? toDate(body.endsOn) : null) : undefined,
        },
        include: { member: { select: memberSelect } },
      });
      await this.audit.log(tx, ctx, 'board.updated', 'board_position', id, { fields: Object.keys(body) });
      return updated;
    });
  }

  @Perm('governance:write')
  @HttpCode(204)
  @Delete('board/:id')
  async deleteBoard(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    await this.db.tenant(ctx.tenantId, async (tx) => {
      const p = found(await tx.boardPosition.findUnique({ where: { id } }), 'Cargo');
      await tx.boardPosition.delete({ where: { id } });
      await this.audit.log(tx, ctx, 'board.deleted', 'board_position', id, { position: p.position, memberId: p.memberId });
    });
  }

  // ───────────── Encuestas ─────────────

  @Perm('governance:read')
  @Get('polls')
  polls(@Ctx() ctx: RequestContext) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const rows = await tx.poll.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { votes: { where: { membershipId: ctx.membershipId }, select: { choices: true } }, _count: { select: { votes: true } } },
      });
      return rows.map(({ votes, _count, ...p }) => ({ ...p, open: pollIsOpen(p), voteCount: _count.votes, myChoices: votes[0]?.choices ?? null }));
    });
  }

  @Perm('governance:write')
  @Post('polls')
  async createPoll(@Ctx() ctx: RequestContext, @Body(zod(pollCreate)) body: z.infer<typeof pollCreate>) {
    const { notify, ...data } = body;
    const { poll, memberIds } = await this.db.tenant(ctx.tenantId, async (tx) => {
      const poll = await tx.poll.create({ data: { ...data, closesAt: data.closesAt ? new Date(data.closesAt) : null, createdById: ctx.userId, tenantId: ctx.tenantId } });
      await this.audit.log(tx, ctx, 'poll.created', 'poll', poll.id, { question: poll.question });
      const memberIds = notify ? (await tx.member.findMany({ where: { status: 'ACTIVE' }, select: { id: true } })).map((m) => m.id) : [];
      return { poll, memberIds };
    });
    if (memberIds.length) {
      await this.jobs.add('notify.fanout', {
        tenantId: ctx.tenantId, memberIds, type: 'poll.created', email: false,
        title: `Nueva encuesta: ${poll.question}`,
        body: `Participa en la encuesta «${poll.question}»${poll.closesAt ? ` antes del ${poll.closesAt.toISOString().slice(0, 10)}` : ''}.`,
        link: '/governance',
      });
    }
    return poll;
  }

  @Perm('governance:write')
  @Patch('polls/:id')
  updatePoll(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(pollFields.partial())) body: Partial<z.infer<typeof pollFields>>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      found(await tx.poll.findUnique({ where: { id } }), 'Encuesta');
      const votes = await tx.pollVote.count({ where: { pollId: id } });
      // Con votos emitidos sólo se puede cambiar la fecha de cierre.
      if (votes && Object.keys(body).some((k) => k !== 'closesAt')) throw conflict('La encuesta ya tiene votos', 'POLL_HAS_VOTES');
      const updated = await tx.poll.update({
        where: { id },
        data: { ...body, closesAt: body.closesAt !== undefined ? (body.closesAt ? new Date(body.closesAt) : null) : undefined },
      });
      await this.audit.log(tx, ctx, 'poll.updated', 'poll', id, { fields: Object.keys(body) });
      return updated;
    });
  }

  @Perm('governance:write')
  @HttpCode(204)
  @Delete('polls/:id')
  async deletePoll(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    await this.db.tenant(ctx.tenantId, async (tx) => {
      const p = found(await tx.poll.findUnique({ where: { id } }), 'Encuesta');
      await tx.poll.delete({ where: { id } });
      await this.audit.log(tx, ctx, 'poll.deleted', 'poll', id, { question: p.question });
    });
  }

  @Perm('governance:write')
  @HttpCode(200)
  @Post('polls/:id/close')
  closePoll(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const p = found(await tx.poll.findUnique({ where: { id } }), 'Encuesta');
      if (p.closedAt) throw conflict('La encuesta ya está cerrada', 'POLL_CLOSED');
      const updated = await tx.poll.update({ where: { id }, data: { closedAt: new Date() } });
      await this.audit.log(tx, ctx, 'poll.closed', 'poll', id);
      return updated;
    });
  }

  /** Un voto por usuario (membresía); se puede cambiar mientras la encuesta siga abierta. */
  @Perm('governance:vote')
  @HttpCode(200)
  @Post('polls/:id/vote')
  votePoll(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(pollVoteSchema)) body: z.infer<typeof pollVoteSchema>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const p = found(await tx.poll.findUnique({ where: { id } }), 'Encuesta');
      if (!pollIsOpen(p)) throw conflict('La encuesta está cerrada', 'POLL_CLOSED');
      const choices = [...new Set(body.choices)].sort((a, b) => a - b);
      if (choices.length !== body.choices.length) throw bad('Opciones repetidas', 'INVALID_CHOICE');
      if (choices.some((c) => c >= p.options.length)) throw bad('Opción no válida', 'INVALID_CHOICE');
      if (!p.multiple && choices.length !== 1) throw bad('Esta encuesta admite una sola respuesta', 'SINGLE_CHOICE');
      const v = await tx.pollVote.upsert({
        where: { pollId_membershipId: { pollId: id, membershipId: ctx.membershipId } },
        create: { tenantId: ctx.tenantId, pollId: id, membershipId: ctx.membershipId, choices },
        update: { choices, castAt: new Date() },
      });
      return { choices: v.choices };
    });
  }

  @Perm('governance:read')
  @Get('polls/:id/results')
  pollResults(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const p = found(await tx.poll.findUnique({ where: { id }, include: { votes: true } }), 'Encuesta');
      const counts = p.options.map(() => 0);
      for (const v of p.votes) for (const c of v.choices) if (c < counts.length) counts[c]++;
      let voters: { name: string; choices: number[] }[] | undefined;
      if (!p.anonymous && ctx.permissions.has('governance:write')) {
        const ms = await tx.membership.findMany({
          where: { id: { in: p.votes.map((v) => v.membershipId) } },
          select: { id: true, memberId: true, user: { select: { name: true } } },
        });
        const members = new Map((await tx.member.findMany({ where: { id: { in: ms.map((m) => m.memberId).filter((x): x is string => !!x) } }, select: memberSelect })).map((m) => [m.id, name(m)]));
        const byId = new Map(ms.map((m) => [m.id, (m.memberId && members.get(m.memberId)) || m.user.name]));
        voters = p.votes.map((v) => ({ name: byId.get(v.membershipId) ?? '—', choices: v.choices })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
      }
      const mine = p.votes.find((v) => v.membershipId === ctx.membershipId);
      return {
        id: p.id, question: p.question, options: p.options, multiple: p.multiple, anonymous: p.anonymous, closesAt: p.closesAt, closedAt: p.closedAt,
        open: pollIsOpen(p), totalVoters: p.votes.length, counts, myChoices: mine?.choices ?? null, voters,
      };
    });
  }
}
