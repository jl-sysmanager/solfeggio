import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { featuresFor } from '../billing/entitlements';
import { Db } from '../db/db.service';
import { FeatureNotInPlanException } from '../common/errors';
import { env } from '../config/env';
import { AccessTokenPayload, AuthedRequest, RequestContext } from './context';
import { ALLOW_IMPERSONATION, IMPERSONATION_PERMISSIONS } from '../platform/impersonation.util';
import { ALLOW_READ_ONLY, FEATURE, IS_PUBLIC, NO_TENANT, PERMS, PLATFORM_ADMIN } from './decorators';
import { withGuardianPortalAccess } from './effective-permissions';

const tenantEntitlement = {
  plan: true,
  subscription: { select: { stripeSubscriptionId: true, stripeStatus: true } },
} as const;

const SEEN_EVERY_MS = 3_600_000;
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Guard global: valida el JWT, reconstruye el contexto desde la base de datos en cada
 * petición (los cambios de rol o suspensión son inmediatos) y aplica RBAC, funcionalidades
 * del plan y el modo sólo lectura por impago.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly db: Db,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = <T>(key: string) => this.reflector.getAllAndOverride<T>(key, [context.getHandler(), context.getClass()]);
    if (meta<boolean>(IS_PUBLIC)) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new UnauthorizedException({ message: 'No autenticado', code: 'UNAUTHENTICATED' });

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, { secret: env().JWT_ACCESS_SECRET });
    } catch {
      throw new UnauthorizedException({ message: 'Token inválido o caducado', code: 'TOKEN_INVALID' });
    }

    const user = await this.db.system.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException({ message: 'No autenticado', code: 'UNAUTHENTICATED' });
    if (user.blockedAt) throw new UnauthorizedException({ message: 'Cuenta bloqueada', code: 'ACCOUNT_BLOCKED' });

    const ctx: RequestContext = {
      userId: user.id,
      email: user.email,
      isPlatformAdmin: user.isPlatformAdmin,
      tenantId: '',
      membershipId: '',
      roleKey: '',
      memberId: null,
      tenantStatus: '',
      permissions: new Set(),
      features: new Set(),
      ip: req.ip,
    };
    req.ctx = ctx;

    if (payload.imp) return this.impersonation(payload, user, ctx, req, meta);

    if (meta<boolean>(PLATFORM_ADMIN)) {
      if (!user.isPlatformAdmin) throw new ForbiddenException({ message: 'Acceso restringido', code: 'FORBIDDEN' });
      return true;
    }

    if (payload.tid) {
      const membership = await this.db.system.membership.findFirst({
        where: { id: payload.mid, tenantId: payload.tid, userId: user.id, status: 'ACTIVE' },
        include: { role: true, tenant: { include: tenantEntitlement } },
      });
      if (!membership || membership.tenant.deletedAt || membership.tenant.status === 'SUSPENDED') {
        throw new UnauthorizedException({ message: 'Sin acceso a esta banda', code: 'TENANT_ACCESS_REVOKED' });
      }
      Object.assign(ctx, {
        tenantId: membership.tenantId,
        membershipId: membership.id,
        roleKey: membership.role.key,
        memberId: membership.memberId,
        tenantStatus: membership.tenant.status,
        permissions: new Set(withGuardianPortalAccess(membership.role.permissions, membership.guardianId)),
        features: await featuresFor(this.db, membership.tenant),
      });
      this.touch(membership.id, membership.lastSeenAt);
    }

    if (meta<boolean>(NO_TENANT)) return true;
    if (!ctx.tenantId) throw new ForbiddenException({ message: 'Selecciona una banda', code: 'TENANT_REQUIRED' });

    const feature = meta<string>(FEATURE);
    if (feature && !ctx.features.has(feature)) throw new FeatureNotInPlanException(feature);

    const perms = meta<string[]>(PERMS) ?? [];
    if (!perms.every((p) => ctx.permissions.has(p))) {
      throw new ForbiddenException({ message: 'No tienes permiso para esta acción', code: 'FORBIDDEN' });
    }

    if (ctx.tenantStatus === 'READ_ONLY' && WRITE_METHODS.has(req.method) && !meta<boolean>(ALLOW_READ_ONLY)) {
      throw new ForbiddenException({
        message: 'La banda está en modo sólo lectura por un pago pendiente',
        code: 'TENANT_READ_ONLY',
      });
    }
    return true;
  }

  /** Marca la última actividad como mucho una vez por hora; nunca hace fallar la petición. */
  private touch(membershipId: string, lastSeenAt: Date | null) {
    const now = Date.now();
    if (lastSeenAt && now - lastSeenAt.getTime() < SEEN_EVERY_MS) return;
    this.db.system.membership
      .updateMany({ where: { id: membershipId, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(now - SEEN_EVERY_MS) } }] }, data: { lastSeenAt: new Date(now) } })
      .catch(() => undefined);
  }

  /** Token «ver como»: sesión vigente, administrador vigente, sólo lectura y sin rutas de plataforma. */
  private async impersonation(
    payload: AccessTokenPayload,
    user: { id: string; isPlatformAdmin: boolean },
    ctx: RequestContext,
    req: AuthedRequest,
    meta: <T>(key: string) => T,
  ): Promise<boolean> {
    const revoked = () => new UnauthorizedException({ message: 'La sesión «ver como» ha terminado', code: 'IMPERSONATION_ENDED' });
    const imp = await this.db.system.impersonationSession.findUnique({ where: { id: payload.imp! } });
    if (!imp || imp.endedAt || imp.expiresAt <= new Date() || imp.adminId !== user.id || imp.tenantId !== payload.tid || !user.isPlatformAdmin) throw revoked();
    const tenant = await this.db.system.tenant.findUnique({ where: { id: imp.tenantId }, include: tenantEntitlement });
    if (!tenant || tenant.deletedAt) throw revoked();

    if (meta<boolean>(PLATFORM_ADMIN)) {
      throw new ForbiddenException({ message: 'No disponible durante «ver como»', code: 'IMPERSONATION_FORBIDDEN' });
    }
    Object.assign(ctx, {
      isPlatformAdmin: false,
      tenantId: tenant.id,
      roleKey: 'impersonation',
      tenantStatus: tenant.status,
      permissions: new Set(IMPERSONATION_PERMISSIONS),
      features: await featuresFor(this.db, tenant),
      impersonationId: imp.id,
    });
    if (WRITE_METHODS.has(req.method) && !meta<boolean>(ALLOW_IMPERSONATION)) {
      throw new ForbiddenException({ message: 'Estás viendo la banda en modo sólo lectura', code: 'IMPERSONATION_READ_ONLY' });
    }
    if (meta<boolean>(NO_TENANT)) return true;
    const feature = meta<string>(FEATURE);
    if (feature && !ctx.features.has(feature)) throw new FeatureNotInPlanException(feature);
    const perms = meta<string[]>(PERMS) ?? [];
    if (!perms.every((p) => ctx.permissions.has(p))) {
      throw new ForbiddenException({ message: 'No tienes permiso para esta acción', code: 'FORBIDDEN' });
    }
    return true;
  }
}
