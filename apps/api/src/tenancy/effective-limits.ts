/** Límites efectivos: override de la banda si está definido; si no, los del plan. −1 = ilimitado. */
export type LimitSource = {
  maxUsersOverride: number | null;
  maxMembersOverride: number | null;
  storageMbOverride: number | null;
  plan: { maxUsers: number; maxMembers: number; storageMb: number };
};

export function effectiveLimits(t: LimitSource) {
  return {
    maxUsers: t.maxUsersOverride ?? t.plan.maxUsers,
    maxMembers: t.maxMembersOverride ?? t.plan.maxMembers,
    storageMb: t.storageMbOverride ?? t.plan.storageMb,
  };
}
