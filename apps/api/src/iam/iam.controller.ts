import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, ForbiddenException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, Perm } from '../auth/decorators';
import { randomToken, sha256 } from '../common/crypto';
import { found } from '../common/errors';
import { page, pageQuery, skipTake } from '../common/pagination';
import { idParam } from '../common/schemas';
import { zod } from '../common/zod.pipe';
import { env } from '../config/env';
import { Db, Tx } from '../db/db.service';
import { Audit } from '../audit/audit.service';
import { Jobs } from '../jobs/jobs.service';
import { LimitsService } from '../tenancy/limits.service';
import { ALL_PERMISSIONS, PERMISSIONS } from './permissions';

const permList = z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).max(ALL_PERMISSIONS.length);
const roleCreate = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/),
  name: z.string().trim().min(2).max(60),
  permissions: permList,
});
const rolePatch = z.object({ name: z.string().trim().min(2).max(60).optional(), permissions: permList.optional() });
const userPatch = z.object({ roleId: z.string().uuid().optional(), status: z.enum(['ACTIVE', 'SUSPENDED']).optional() });
const inviteSchema = z.object({ email: z.string().email().max(254), roleId: z.string().uuid(), memberId: z.string().uuid().optional() });
const auditQuery = pageQuery.extend({ entity: z.string().max(60).optional(), actorId: z.string().uuid().optional() });

@ApiTags('iam')
@ApiBearerAuth()
@Controller()
export class IamController {
  constructor(
    private readonly db: Db,
    private readonly audit: Audit,
    private readonly limits: LimitsService,
    private readonly jobs: Jobs,
  ) {}

  @Get('permissions')
  permissions() {
    return PERMISSIONS;
  }

  /**
   * Un editor sólo puede conceder permisos que él mismo tiene (el propietario los tiene todos), de modo
   * que ni roles ni invitaciones permiten escalar privilegios, p. ej. darse `billing:manage`.
   */
  private assertCeiling(ctx: RequestContext, permissions: readonly string[]) {
    const over = permissions.filter((p) => !ctx.permissions.has(p));
    if (over.length) {
      throw new ForbiddenException({ message: 'No puedes conceder permisos que no tienes', code: 'PERMISSION_CEILING', details: { permissions: over } });
    }
  }

  private ownerOnly() {
    return new ForbiddenException({ message: 'Sólo un propietario puede gestionar a los propietarios', code: 'OWNER_ONLY' });
  }

  /** Roles que quien gestiona usuarios puede asignar o invitar: dentro de su techo de permisos. */
  @Perm('users:manage')
  @Get('roles/assignable')
  assignableRoles(@Ctx() ctx: RequestContext) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const roles = await tx.role.findMany({ orderBy: [{ isSystem: 'desc' }, { name: 'asc' }] });
      return roles
        .filter((r) => (r.key !== 'owner' || ctx.roleKey === 'owner') && r.permissions.every((p) => ctx.permissions.has(p)))
        .map((r) => ({ id: r.id, key: r.key, name: r.name, isSystem: r.isSystem }));
    });
  }

  @Perm('roles:manage')
  @Get('roles')
  roles(@Ctx() ctx: RequestContext) {
    return this.db.tenant(ctx.tenantId, (tx) =>
      tx.role.findMany({ orderBy: [{ isSystem: 'desc' }, { name: 'asc' }], include: { _count: { select: { memberships: true } } } }),
    );
  }

  @Perm('roles:manage')
  @Post('roles')
  createRole(@Ctx() ctx: RequestContext, @Body(zod(roleCreate)) body: z.infer<typeof roleCreate>) {
    this.assertCeiling(ctx, body.permissions);
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const role = await tx.role.create({ data: { ...body, tenantId: ctx.tenantId } });
      await this.audit.log(tx, ctx, 'role.created', 'role', role.id, body);
      return role;
    });
  }

  @Perm('roles:manage')
  @Patch('roles/:id')
  updateRole(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string, @Body(zod(rolePatch)) body: z.infer<typeof rolePatch>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const role = found(await tx.role.findUnique({ where: { id } }), 'Rol');
      if (role.key === 'owner' && body.permissions) {
        throw new BadRequestException({ message: 'Los permisos del propietario no se pueden modificar', code: 'OWNER_IMMUTABLE' });
      }
      if (body.permissions) this.assertCeiling(ctx, body.permissions.filter((p) => !role.permissions.includes(p)));
      const updated = await tx.role.update({ where: { id }, data: body });
      await this.audit.log(tx, ctx, 'role.updated', 'role', id, body);
      return updated;
    });
  }

  @Perm('roles:manage')
  @HttpCode(204)
  @Delete('roles/:id')
  async deleteRole(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    await this.db.tenant(ctx.tenantId, async (tx) => {
      const role = found(await tx.role.findUnique({ where: { id }, include: { _count: { select: { memberships: true } } } }), 'Rol');
      if (role.isSystem) throw new BadRequestException({ message: 'Los roles de sistema no se pueden borrar', code: 'SYSTEM_ROLE' });
      if (role._count.memberships > 0) throw new BadRequestException({ message: 'El rol tiene usuarios asignados', code: 'ROLE_IN_USE' });
      await tx.role.delete({ where: { id } });
      await this.audit.log(tx, ctx, 'role.deleted', 'role', id);
    });
  }

  @Perm('users:manage')
  @Get('users')
  users(@Ctx() ctx: RequestContext) {
    return this.db.tenant(ctx.tenantId, (tx) =>
      tx.membership.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, status: true, createdAt: true, memberId: true,
          role: { select: { id: true, key: true, name: true } },
          user: { select: { id: true, name: true, email: true, mfaEnabled: true, lastLoginAt: true } },
        },
      }),
    );
  }

  @Perm('users:manage')
  @Patch('users/:membershipId')
  updateUser(@Ctx() ctx: RequestContext, @Param('membershipId', zod(idParam)) id: string, @Body(zod(userPatch)) body: z.infer<typeof userPatch>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const m = found(await tx.membership.findUnique({ where: { id }, include: { role: true } }), 'Usuario');
      if (m.id === ctx.membershipId) {
        throw new BadRequestException({ message: 'No puedes cambiar tu propio rol ni suspender tu acceso', code: 'SELF_CHANGE' });
      }
      if (m.role.key === 'owner' && ctx.roleKey !== 'owner') throw this.ownerOnly();
      await this.assertNotLastOwner(tx, m, body);
      if (body.roleId) {
        const role = found(await tx.role.findUnique({ where: { id: body.roleId } }), 'Rol');
        if (role.key === 'owner' && ctx.roleKey !== 'owner') throw this.ownerOnly();
        this.assertCeiling(ctx, role.permissions);
      }
      const updated = await tx.membership.update({ where: { id }, data: body });
      await this.audit.log(tx, ctx, 'membership.updated', 'membership', id, body);
      return updated;
    });
  }

  @Perm('users:manage')
  @HttpCode(204)
  @Delete('users/:membershipId')
  async removeUser(@Ctx() ctx: RequestContext, @Param('membershipId', zod(idParam)) id: string) {
    await this.db.tenant(ctx.tenantId, async (tx) => {
      const m = found(await tx.membership.findUnique({ where: { id }, include: { role: true } }), 'Usuario');
      if (m.role.key === 'owner' && ctx.roleKey !== 'owner') throw this.ownerOnly();
      await this.assertNotLastOwner(tx, m, { remove: true });
      await tx.membership.delete({ where: { id } });
      await this.audit.log(tx, ctx, 'membership.removed', 'membership', id, { userId: m.userId });
    });
  }

  /** Impide dejar la banda sin propietario activo. */
  private async assertNotLastOwner(tx: Tx, m: { role: { key: string }; roleId: string }, change: { roleId?: string; status?: string; remove?: boolean }) {
    if (m.role.key !== 'owner') return;
    const losesOwner = change.remove || change.status === 'SUSPENDED' || (change.roleId !== undefined && change.roleId !== m.roleId);
    if (!losesOwner) return;
    const owners = await tx.membership.count({ where: { role: { key: 'owner' }, status: 'ACTIVE' } });
    if (owners <= 1) throw new BadRequestException({ message: 'La banda debe tener al menos un propietario', code: 'LAST_OWNER' });
  }

  @Perm('users:manage')
  @Get('invitations')
  invitations(@Ctx() ctx: RequestContext) {
    return this.db.tenant(ctx.tenantId, (tx) =>
      tx.invitation.findMany({
        where: { acceptedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true, email: true, roleId: true, memberId: true, expiresAt: true, createdAt: true },
      }),
    );
  }

  @Perm('users:manage')
  @Post('invitations')
  async invite(@Ctx() ctx: RequestContext, @Body(zod(inviteSchema)) body: z.infer<typeof inviteSchema>) {
    const token = randomToken(32);
    const email = body.email.toLowerCase();
    const result = await this.db.tenant(ctx.tenantId, async (tx) => {
      await this.limits.assertCanAddUser(tx, ctx.tenantId);
      const role = found(await tx.role.findUnique({ where: { id: body.roleId } }), 'Rol');
      if (role.key === 'owner' && ctx.roleKey !== 'owner') {
        throw new BadRequestException({ message: 'Sólo un propietario puede invitar propietarios', code: 'FORBIDDEN' });
      }
      this.assertCeiling(ctx, role.permissions);
      if (body.memberId) found(await tx.member.findUnique({ where: { id: body.memberId } }), 'Socio');
      const inv = await tx.invitation.create({
        data: {
          tenantId: ctx.tenantId, email, roleId: role.id, memberId: body.memberId, tokenHash: sha256(token),
          invitedBy: ctx.userId, expiresAt: new Date(Date.now() + 7 * 86_400_000),
        },
      });
      await this.audit.log(tx, ctx, 'invitation.created', 'invitation', inv.id, { email, role: role.key });
      return { id: inv.id, email, roleId: role.id, expiresAt: inv.expiresAt };
    });
    const tenant = await this.db.system.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
    await this.jobs.add('email.send', {
      to: email,
      subject: `Invitación a ${tenant.name} en Solfeamos`,
      text: `Te han invitado a unirte a ${tenant.name}.\n\nAcepta la invitación aquí (caduca en 7 días):\n${env().APP_URL}/invite/${token}`,
    });
    return result;
  }

  @Perm('users:manage')
  @HttpCode(204)
  @Delete('invitations/:id')
  async revokeInvitation(@Ctx() ctx: RequestContext, @Param('id', zod(idParam)) id: string) {
    await this.db.tenant(ctx.tenantId, async (tx) => {
      await tx.invitation.delete({ where: { id } });
      await this.audit.log(tx, ctx, 'invitation.revoked', 'invitation', id);
    });
  }

  @Perm('audit:read')
  @Get('audit-logs')
  auditLogs(@Ctx() ctx: RequestContext, @Query(zod(auditQuery)) q: z.infer<typeof auditQuery>) {
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const where = { entity: q.entity, actorId: q.actorId };
      const [data, total] = await Promise.all([
        tx.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q) }),
        tx.auditLog.count({ where }),
      ]);
      return page(data, total, q);
    });
  }
}
