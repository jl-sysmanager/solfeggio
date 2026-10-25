import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, PlatformAdmin } from '../auth/decorators';
import { TokensService } from '../auth/tokens.service';
import { found } from '../common/errors';
import { page, pageQuery, skipTake } from '../common/pagination';
import { idParam } from '../common/schemas';
import { zod } from '../common/zod.pipe';
import { Db } from '../db/db.service';
import { blockUser, unblockUser } from '../platform/moderation.util';
import { platformAudit } from '../platform/support.util';

const usersQuery = pageQuery.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['all', 'active', 'blocked', 'platform']).default('all'),
});
const blockSchema = z.object({ reason: z.string().trim().min(3).max(1000) });
const userPatch = z
  .object({ isPlatformAdmin: z.boolean().optional() })
  .refine((b) => b.isPlatformAdmin !== undefined, { message: 'Sin cambios' });

const userSelect = {
  id: true,
  name: true,
  email: true,
  mfaEnabled: true,
  isPlatformAdmin: true,
  blockedAt: true,
  blockedReason: true,
  lastLoginAt: true,
  createdAt: true,
  memberships: {
    where: { tenant: { deletedAt: null } },
    select: {
      status: true,
      tenant: { select: { id: true, name: true, slug: true } },
      role: { select: { name: true, key: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.UserSelect;

function presentUser(u: {
  id: string;
  name: string;
  email: string;
  mfaEnabled: boolean;
  isPlatformAdmin: boolean;
  blockedAt: Date | null;
  blockedReason: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  memberships: {
    status: string;
    tenant: { id: string; name: string; slug: string };
    role: { name: string; key: string };
  }[];
}) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    mfaEnabled: u.mfaEnabled,
    isPlatformAdmin: u.isPlatformAdmin,
    blockedAt: u.blockedAt,
    blockedReason: u.blockedReason,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    memberships: u.memberships.map((m) => ({
      tenantId: m.tenant.id,
      tenantName: m.tenant.name,
      slug: m.tenant.slug,
      roleName: m.role.name,
      roleKey: m.role.key,
      status: m.status,
    })),
  };
}

/**
 * Directorio global de cuentas para el equipo de plataforma.
 * El bloqueo reutiliza las mismas reglas que Moderación.
 */
@ApiTags('admin')
@ApiBearerAuth()
@PlatformAdmin()
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    private readonly db: Db,
    private readonly tokens: TokensService,
  ) {}

  @Get()
  async list(@Query(zod(usersQuery)) q: z.infer<typeof usersQuery>) {
    const where: Prisma.UserWhereInput = {
      ...(q.status === 'blocked' && { blockedAt: { not: null } }),
      ...(q.status === 'active' && { blockedAt: null }),
      ...(q.status === 'platform' && { isPlatformAdmin: true }),
      ...(q.q && {
        OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }],
      }),
    };
    const [rows, total] = await Promise.all([
      this.db.system.user.findMany({ where, select: userSelect, orderBy: [{ isPlatformAdmin: 'desc' }, { createdAt: 'desc' }], ...skipTake(q) }),
      this.db.system.user.count({ where }),
    ]);
    return page(rows.map(presentUser), total, q);
  }

  @Get(':id')
  async detail(@Param('id', zod(idParam)) id: string) {
    const u = found(await this.db.system.user.findUnique({ where: { id }, select: userSelect }), 'Usuario');
    const activeSessions = await this.db.system.refreshToken.count({ where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } } });
    return { ...presentUser(u), activeSessions };
  }

  @HttpCode(200)
  @Post(':id/block')
  block(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(blockSchema)) body: z.infer<typeof blockSchema>) {
    return blockUser(this.db, ctx, id, body.reason);
  }

  @HttpCode(200)
  @Post(':id/unblock')
  unblock(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    return unblockUser(this.db, ctx, id);
  }

  @Patch(':id')
  async update(
    @Ctx() ctx: RequestContext,
    @Param('id', zod(idParam)) id: string,
    @Body(zod(userPatch)) body: z.infer<typeof userPatch>,
  ) {
    const user = found(await this.db.system.user.findUnique({ where: { id } }), 'Usuario');
    if (body.isPlatformAdmin === undefined) return presentUser(await this.db.system.user.findUniqueOrThrow({ where: { id }, select: userSelect }));

    if (body.isPlatformAdmin === false) {
      if (id === ctx.userId) throw new BadRequestException({ message: 'No puedes quitarte el acceso de plataforma a ti mismo', code: 'CANNOT_DEMOTE_SELF' });
      const admins = await this.db.system.user.count({ where: { isPlatformAdmin: true, blockedAt: null } });
      if (admins <= 1) {
        throw new BadRequestException({ message: 'Debe quedar al menos un administrador de plataforma', code: 'LAST_PLATFORM_ADMIN' });
      }
    }

    if (body.isPlatformAdmin === true) {
      if (user.blockedAt) throw new BadRequestException({ message: 'Desbloquea la cuenta antes de dar acceso de plataforma', code: 'USER_BLOCKED' });
    }

    await this.db.system.$transaction([
      this.db.system.user.update({ where: { id }, data: { isPlatformAdmin: body.isPlatformAdmin } }),
      platformAudit(this.db.system, ctx, 'user.updated', 'user', id, { isPlatformAdmin: body.isPlatformAdmin }),
    ]);
    if (body.isPlatformAdmin === false) await this.tokens.revokeAllForUser(id);
    return presentUser(await this.db.system.user.findUniqueOrThrow({ where: { id }, select: userSelect }));
  }

  @HttpCode(200)
  @Post(':id/revoke-sessions')
  async revokeSessions(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    found(await this.db.system.user.findUnique({ where: { id } }), 'Usuario');
    if (id === ctx.userId) throw new ForbiddenException({ message: 'No puedes cerrar tu propia sesión desde aquí', code: 'CANNOT_REVOKE_SELF' });
    await this.tokens.revokeAllForUser(id);
    await platformAudit(this.db.system, ctx, 'user.sessions_revoked', 'user', id);
    return { ok: true };
  }
}
