import { Injectable } from '@nestjs/common';
import { Db } from '../db/db.service';

export interface Session {
  user: { id: string; email: string; name: string; mfaEnabled: boolean; isPlatformAdmin: boolean };
  tenant: { id: string; name: string; slug: string; status: string; timezone: string } | null;
  role: { id: string; key: string; name: string } | null;
  permissions: string[];
  plan: { code: string; name: string; features: string[]; maxUsers: number; maxMembers: number; storageMb: number } | null;
  memberId: string | null;
  memberships: { tenantId: string; tenantName: string; slug: string; roleKey: string; roleName: string }[];
}

@Injectable()
export class SessionService {
  constructor(private readonly db: Db) {}

  async build(userId: string, tenantId?: string | null): Promise<Session> {
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
}
