/** Cuenta del directorio global de plataforma. */
export interface AdminUser {
  id: string;
  name: string;
  email: string;
  mfaEnabled: boolean;
  isPlatformAdmin: boolean;
  blockedAt: string | null;
  blockedReason: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  memberships: {
    tenantId: string;
    tenantName: string;
    slug: string;
    roleName: string;
    roleKey: string;
    status: string;
  }[];
}

export interface AdminUserDetail extends AdminUser {
  activeSessions: number;
}
