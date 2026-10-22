import { Injectable } from '@nestjs/common';
import { Db } from '../db/db.service';
import { IMPERSONATION_PERMISSIONS, IMPERSONATION_ROLE } from '../platform/impersonation.util';

export interface Session {
  user: { id: string; email: string; name: string; mfaEnabled: boolean; isPlatformAdmin: boolean };
  tenant: { id: string; name: string; slug: string; status: string; timezone: string } | null;
  role: { id: string; key: string; name: string } | null;
  permissions: string[];
  plan: { code: string; name: string; features: string[]; maxUsers: number; maxMembers: number; storageMb: number } | null;
  memberId: string | null;
  memberships: { tenantId: string; tenantName: string; slug: string; roleKey: string; roleName: string }[];
  impersonation?: { sessionId: string; tenantName: string; expiresAt: string; reason: string };
}

@Injectable()
export class SessionService {
  constructor(private readonly db: Db) {}

  async build(userId: string, tenantId?: string | null, impersonationId?: string | null): Promise<Session> {
    if (impersonationId) return this.buildImpersonation(userId, impersonationId);
    const user = await this.db.system.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        memberships: {
          where: { status: 'ACTIVE', tenant: { deletedAt: null } },
          include: { role: true, tenant: { include: { plan: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    const active = tenantId ? user.memberships.find((m) => m.tenantId === tenantId) : undefined;
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        mfaEnabled: user.mfaEnabled,
        isPlatformAdmin: user.isPlatformAdmin,
      },
      tenant: active
        ? {
            id: active.tenant.id,
            name: active.tenant.name,
            slug: active.tenant.slug,
            status: active.tenant.status,
            timezone: active.tenant.timezone,
          }
        : null,
      role: active ? { id: active.role.id, key: active.role.key, name: active.role.name } : null,
      permissions: active ? active.role.permissions : [],
      plan: active
        ? {
            code: active.tenant.plan.code,
            name: active.tenant.plan.name,
            features: [...new Set([...active.tenant.plan.features, ...active.tenant.addons])],
            maxUsers: active.tenant.plan.maxUsers,
            maxMembers: active.tenant.plan.maxMembers,
            storageMb: active.tenant.plan.storageMb,
          }
        : null,
      memberId: active?.memberId ?? null,
      memberships: user.memberships.map((m) => ({
        tenantId: m.tenantId,
        tenantName: m.tenant.name,
        slug: m.tenant.slug,
        roleKey: m.role.key,
        roleName: m.role.name,
      })),
    };
  }

  /** Sesión de «ver como»: el usuario es el administrador, la banda la visitada y el rol de sólo lectura. */
  private async buildImpersonation(userId: string, impersonationId: string): Promise<Session> {
    const imp = await this.db.system.impersonationSession.findUniqueOrThrow({ where: { id: impersonationId } });
    const [user, tenant] = await Promise.all([
      this.db.system.user.findUniqueOrThrow({ where: { id: userId } }),
      this.db.system.tenant.findUniqueOrThrow({ where: { id: imp.tenantId }, include: { plan: true } }),
    ]);
    return {
      user: { id: user.id, email: user.email, name: user.name, mfaEnabled: user.mfaEnabled, isPlatformAdmin: user.isPlatformAdmin },
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, status: tenant.status, timezone: tenant.timezone },
      role: IMPERSONATION_ROLE,
      permissions: IMPERSONATION_PERMISSIONS,
      plan: {
        code: tenant.plan.code,
        name: tenant.plan.name,
        features: [...new Set([...tenant.plan.features, ...tenant.addons])],
        maxUsers: tenant.plan.maxUsers,
        maxMembers: tenant.plan.maxMembers,
        storageMb: tenant.plan.storageMb,
      },
      memberId: null,
      memberships: [],
      impersonation: { sessionId: imp.id, tenantName: tenant.name, expiresAt: imp.expiresAt.toISOString(), reason: imp.reason },
    };
  }
}
