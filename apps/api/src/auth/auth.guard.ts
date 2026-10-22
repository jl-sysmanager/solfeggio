import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Db } from '../db/db.service';
import { FeatureNotInPlanException } from '../common/errors';
import { env } from '../config/env';
import { AccessTokenPayload, AuthedRequest, RequestContext } from './context';
import { ALLOW_READ_ONLY, FEATURE, IS_PUBLIC, NO_TENANT, PERMS, PLATFORM_ADMIN } from './decorators';

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

    if (meta<boolean>(PLATFORM_ADMIN)) {
      if (!user.isPlatformAdmin) throw new ForbiddenException({ message: 'Acceso restringido', code: 'FORBIDDEN' });
      return true;
    }

    if (payload.tid) {
      const membership = await this.db.system.membership.findFirst({
        where: { id: payload.mid, tenantId: payload.tid, userId: user.id, status: 'ACTIVE' },
        include: { role: true, tenant: { include: { plan: true } } },
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
        permissions: new Set(membership.role.permissions),
        features: new Set([...membership.tenant.plan.features, ...membership.tenant.addons]),
      });
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
}
