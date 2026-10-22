import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Feature, Permission } from '../iam/permissions';
import type { RequestContext } from './context';

export const IS_PUBLIC = 'sf:public';
export const PERMS = 'sf:perms';
export const FEATURE = 'sf:feature';
export const PLATFORM_ADMIN = 'sf:platform-admin';
export const NO_TENANT = 'sf:no-tenant';
export const ALLOW_READ_ONLY = 'sf:allow-read-only';

/** Ruta sin autenticación. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Requiere todos los permisos indicados en el tenant activo. */
export const Perm = (...perms: Permission[]) => SetMetadata(PERMS, perms);
/** Requiere que el plan del tenant incluya la funcionalidad. */
export const RequireFeature = (feature: Feature) => SetMetadata(FEATURE, feature);
/** Sólo administradores de plataforma; no requiere tenant. */
export const PlatformAdmin = () => SetMetadata(PLATFORM_ADMIN, true);
/** Autenticado pero sin tenant activo (onboarding, selección de banda, MFA). */
export const NoTenant = () => SetMetadata(NO_TENANT, true);
/** Permite escrituras aunque el tenant esté en modo sólo lectura (p. ej. facturación). */
export const AllowReadOnly = () => SetMetadata(ALLOW_READ_ONLY, true);

export const Ctx = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestContext => {
  return ctx.switchToHttp().getRequest().ctx;
});
