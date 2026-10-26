import { buildSetupGuide } from './setup-guide';

const empty = {
  features: ['members', 'events'],
  bandReady: false,
  memberCount: 0,
  extraAccess: false,
  eventCount: 0,
  mfaEnabled: false,
  dismissed: false,
};

describe('guía de puesta en marcha', () => {
  it('marca cada paso según los datos de la banda', () => {
    const guide = buildSetupGuide({ ...empty, bandReady: true, memberCount: 2, mfaEnabled: true });
    const done = Object.fromEntries(guide.steps.map((s) => [s.id, s.done]));
    expect(done).toEqual({ band: true, roster: true, access: false, rehearsal: false, security: true });
    expect(guide.dismissed).toBe(false);
  });

  it('omite los pasos de un módulo que el plan no incluye', () => {
    const guide = buildSetupGuide({ ...empty, features: [] });
    expect(guide.steps.map((s) => s.id)).toEqual(['band', 'access', 'security']);
  });

  it('con la escuela añade sus pasos y los marca según el curso', () => {
    const school = { years: 1, groups: 3, groupsWithoutSlots: 1, students: 0 };
    const guide = buildSetupGuide({ ...empty, features: ['school'], school });
    const done = Object.fromEntries(guide.steps.map((s) => [s.id, s.done]));
    expect(done).toMatchObject({ 'school-setup': true, 'school-schedule': false, 'school-students': false });
    const ready = buildSetupGuide({ ...empty, features: ['school'], school: { ...school, groupsWithoutSlots: 0, students: 5 } });
    expect(ready.steps.filter((s) => s.id.startsWith('school-')).every((s) => s.done)).toBe(true);
  });
});
