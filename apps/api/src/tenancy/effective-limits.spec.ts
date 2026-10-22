import { effectiveLimits } from './effective-limits';

describe('effectiveLimits', () => {
  const plan = { maxUsers: 20, maxMembers: 150, storageMb: 10240 };

  it('usa el plan si no hay overrides', () => {
    expect(effectiveLimits({ maxUsersOverride: null, maxMembersOverride: null, storageMbOverride: null, plan })).toEqual(plan);
  });

  it('aplica overrides parciales', () => {
    expect(effectiveLimits({ maxUsersOverride: 100, maxMembersOverride: null, storageMbOverride: 50_000, plan })).toEqual({
      maxUsers: 100,
      maxMembers: 150,
      storageMb: 50_000,
    });
  });

  it('permite ilimitado (−1) en usuarios y socios', () => {
    expect(effectiveLimits({ maxUsersOverride: -1, maxMembersOverride: -1, storageMbOverride: null, plan }).maxUsers).toBe(-1);
  });
});
