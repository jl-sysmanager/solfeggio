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
});
