import { Injectable } from '@nestjs/common';
import { featuresFor } from '../billing/entitlements';
import { Db } from '../db/db.service';
import { IMPERSONATION_PERMISSIONS, IMPERSONATION_ROLE } from '../platform/impersonation.util';
import { effectiveLimits } from '../tenancy/effective-limits';
import { withGuardianPortalAccess } from './effective-permissions';

export interface Session {
  user: { id: string; email: string; name: string; mfaEnabled: boolean; isPlatformAdmin: boolean };
  tenant: { id: string; name: string; slug: string; status: string; timezone: string; hasLogo: boolean; logoVersion: string | null } | null;
  role: { id: string; key: string; name: string } | null;
  permissions: string[];
  plan: { code: string; name: string; features: string[]; maxUsers: number; maxMembers: number; storageMb: number } | null;
  memberId: string | null;
  /** Tutor de la escuela vinculado: da acceso al portal de familias aunque el rol sea otro. */
  guardianId: string | null;
  memberships: { tenantId: string; tenantName: string; slug: string; roleKey: string; roleName: string }[];
  impersonation?: { sessionId: string; tenantName: string; expiresAt: string; reason: string };
}

const tenantEntitlement = {
  plan: true,
  subscription: { select: { stripeSubscriptionId: true, stripeStatus: true } },
} as const;

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
          include: { role: true, tenant: { include: tenantEntitlement } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    const active = tenantId ? user.memberships.find((m) => m.tenantId === tenantId) : undefined;
    const features = active ? [...(await featuresFor(this.db, active.tenant))] : [];
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
            hasLogo: !!active.tenant.logoKey,
            logoVersion: active.tenant.logoKey ? active.tenant.updatedAt.toISOString() : null,
          }
        : null,
      role: active ? { id: active.role.id, key: active.role.key, name: active.role.name } : null,
      permissions: active ? withGuardianPortalAccess(active.role.permissions, active.guardianId) : [],
      plan: active
        ? {
            code: active.tenant.plan.code,
            name: active.tenant.plan.name,
            features,
            ...effectiveLimits(active.tenant),
          }
        : null,
      memberId: active?.memberId ?? null,
      guardianId: active?.guardianId ?? null,
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
      this.db.system.tenant.findUniqueOrThrow({ where: { id: imp.tenantId }, include: tenantEntitlement }),
    ]);
    return {
      user: { id: user.id, email: user.email, name: user.name, mfaEnabled: user.mfaEnabled, isPlatformAdmin: user.isPlatformAdmin },
      tenant: {
        id: tenant.id, name: tenant.name, slug: tenant.slug, status: tenant.status, timezone: tenant.timezone,
        hasLogo: !!tenant.logoKey, logoVersion: tenant.logoKey ? tenant.updatedAt.toISOString() : null,
      },
      role: IMPERSONATION_ROLE,
      permissions: IMPERSONATION_PERMISSIONS,
      plan: {
        code: tenant.plan.code,
        name: tenant.plan.name,
        features: [...(await featuresFor(this.db, tenant))],
        ...effectiveLimits(tenant),
      },
      memberId: null,
      guardianId: null,
      memberships: [],
      impersonation: { sessionId: imp.id, tenantName: tenant.name, expiresAt: imp.expiresAt.toISOString(), reason: imp.reason },
    };
  }
}
