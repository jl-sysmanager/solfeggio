import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { RequestContext } from '../auth/context';
import { Ctx, PlatformAdmin } from '../auth/decorators';
import { zod } from '../common/zod.pipe';
import { Db } from '../db/db.service';
import { ALL_PERMISSIONS } from '../iam/permissions';
import { platformAudit } from '../platform/support.util';

const permList = z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).max(ALL_PERMISSIONS.length);
const roleKeySchema = z.string().regex(/^[a-z][a-z0-9_]{1,31}$/);
const roleCreate = z.object({
  key: roleKeySchema.optional(),
  name: z.string().trim().min(2).max(60),
  permissions: permList.default([]),
});
const rolePatch = z.object({ name: z.string().trim().min(2).max(60).optional(), permissions: permList.optional() });

function roleKeyFromName(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 28);
  if (!base) return 'rol';
  return (base.match(/^[a-z]/) ? base : `r_${base}`).slice(0, 32);
}

function samePerms(a: string[], b: string[]) {
  return [...a].sort().join('\0') === [...b].sort().join('\0');
}

/**
 * Catálogo único de roles. Cada banda guarda una copia (la membresía apunta a la suya);
 * un cambio aquí se replica en todas.
 */
@ApiTags('admin')
@ApiBearerAuth()
@PlatformAdmin()
@Controller('admin/roles')
export class AdminRolesController {
  constructor(private readonly db: Db) {}

  @Get()
  async list() {
    const live = await this.db.system.tenant.findMany({ where: { deletedAt: null }, select: { id: true } });
    const rows = await this.db.system.role.findMany({
      where: { tenantId: { in: live.map((t) => t.id) } },
      select: { key: true, name: true, permissions: true, isSystem: true, _count: { select: { memberships: true } } },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    const byKey = new Map<string, { key: string; name: string; permissions: string[]; isSystem: boolean; membershipCount: number; diverged: boolean }>();
    for (const row of rows) {
      const known = row.permissions.filter((p) => (ALL_PERMISSIONS as readonly string[]).includes(p));
      const current = byKey.get(row.key);
      if (!current) {
        byKey.set(row.key, { key: row.key, name: row.name, permissions: known, isSystem: row.isSystem, membershipCount: row._count.memberships, diverged: false });
        continue;
      }
      current.membershipCount += row._count.memberships;
      if (current.name !== row.name || !samePerms(current.permissions, known) || current.isSystem !== row.isSystem) current.diverged = true;
    }
    return [...byKey.values()];
  }

  @Post()
  async create(@Ctx() ctx: RequestContext, @Body(zod(roleCreate)) body: z.infer<typeof roleCreate>) {
    const preferred = body.key ?? roleKeyFromName(body.name);
    const taken = await this.db.system.role.findFirst({ where: { key: preferred }, select: { id: true } });
    if (taken) throw new BadRequestException({ message: 'Ya existe un rol con esa clave', code: 'ROLE_KEY_TAKEN' });
    const tenants = await this.db.system.tenant.findMany({ where: { deletedAt: null }, select: { id: true } });
    if (!tenants.length) throw new BadRequestException({ message: 'No hay bandas donde crear el rol', code: 'NO_TENANTS' });
    await this.db.system.role.createMany({
      data: tenants.map((t) => ({ tenantId: t.id, key: preferred, name: body.name, permissions: body.permissions, isSystem: false })),
    });
    await platformAudit(this.db.system, ctx, 'role.created', 'role', preferred, { name: body.name, permissions: body.permissions, tenants: tenants.length });
    return { key: preferred, name: body.name, permissions: body.permissions, isSystem: false, membershipCount: 0, diverged: false };
  }

  @Patch(':key')
  async update(@Ctx() ctx: RequestContext, @Param('key', zod(roleKeySchema)) key: string, @Body(zod(rolePatch)) body: z.infer<typeof rolePatch>) {
    const existing = await this.db.system.role.findFirst({ where: { key } });
    if (!existing) throw new NotFoundException({ message: 'Rol no encontrado', code: 'NOT_FOUND' });
    if (key === 'owner' && body.permissions) {
      throw new BadRequestException({ message: 'Los permisos del propietario no se pueden modificar', code: 'OWNER_IMMUTABLE' });
    }
    const data = { ...(body.name !== undefined && { name: body.name }), ...(body.permissions !== undefined && { permissions: body.permissions }) };
    const result = await this.db.system.role.updateMany({ where: { key }, data });
    await platformAudit(this.db.system, ctx, 'role.updated', 'role', key, { ...body, copies: result.count });
    return { key, copies: result.count };
  }

  @HttpCode(204)
  @Delete(':key')
  async remove(@Ctx() ctx: RequestContext, @Param('key', zod(roleKeySchema)) key: string) {
    const roles = await this.db.system.role.findMany({ where: { key }, select: { id: true, isSystem: true } });
    if (!roles.length) throw new NotFoundException({ message: 'Rol no encontrado', code: 'NOT_FOUND' });
    if (roles.some((r) => r.isSystem)) throw new BadRequestException({ message: 'Los roles de sistema no se pueden borrar', code: 'SYSTEM_ROLE' });
    const ids = roles.map((r) => r.id);
    const [members, invites] = await Promise.all([
      this.db.system.membership.count({ where: { roleId: { in: ids } } }),
      this.db.system.invitation.count({ where: { roleId: { in: ids } } }),
    ]);
    if (members + invites > 0) throw new BadRequestException({ message: 'El rol tiene usuarios o invitaciones', code: 'ROLE_IN_USE' });
    await this.db.system.role.deleteMany({ where: { key } });
    await platformAudit(this.db.system, ctx, 'role.deleted', 'role', key, { copies: ids.length });
  }
}
