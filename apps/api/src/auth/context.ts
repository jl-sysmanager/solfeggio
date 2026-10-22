import type { Request } from 'express';

export interface RequestContext {
  userId: string;
  email: string;
  isPlatformAdmin: boolean;
  /** Presentes sólo cuando el token tiene tenant activo. */
  tenantId: string;
  membershipId: string;
  roleKey: string;
  memberId: string | null;
  tenantStatus: string;
  permissions: Set<string>;
  features: Set<string>;
  ip?: string;
}

export interface AccessTokenPayload {
  sub: string;
  tid?: string;
  /** Versión: el token sólo es válido mientras la membresía siga existiendo. */
  mid?: string;
}

export type AuthedRequest = Request & { ctx: RequestContext };

export const can = (ctx: RequestContext, perm: string) => ctx.permissions.has(perm);
