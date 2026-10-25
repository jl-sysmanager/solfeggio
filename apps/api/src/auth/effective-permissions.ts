/** Un usuario con ficha de tutor vinculada accede al portal sin cambiar de rol de banda. */
export function withGuardianPortalAccess(permissions: readonly string[], guardianId: string | null | undefined): string[] {
  if (!guardianId || permissions.includes('school:family')) return [...permissions];
  return [...permissions, 'school:family'];
}
