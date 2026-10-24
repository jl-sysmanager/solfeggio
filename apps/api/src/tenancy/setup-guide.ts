/** Pasos de puesta en marcha de una banda. El avance se deduce de los datos, no de una lista marcada a mano. */

export interface SetupStep {
  id: string;
  title: string;
  detail: string;
  to: string;
  done: boolean;
}

export interface SetupSignals {
  features: Iterable<string>;
  /** Razón social, CIF, logotipo o comunidad autónoma. */
  bandReady: boolean;
  memberCount: number;
  /** Otro usuario activo o una invitación sin aceptar. */
  extraAccess: boolean;
  eventCount: number;
  mfaEnabled: boolean;
  dismissed: boolean;
}

const STEPS: Array<{ id: string; title: string; detail: string; to: string; feature?: string; done: (s: SetupSignals) => boolean }> = [
  {
    id: 'band',
    title: 'Completa la ficha de la banda',
    detail: 'Añade la razón social, el CIF o el logotipo. Salen en los documentos.',
    to: '/settings',
    done: (s) => s.bandReady,
  },
  {
    id: 'roster',
    title: 'Da de alta el primer socio',
    detail: 'La ficha de quien forma parte de la banda.',
    to: '/members',
    feature: 'members',
    done: (s) => s.memberCount > 0,
  },
  {
    id: 'access',
    title: 'Invita a quien comparte la gestión',
    detail: 'Secretaría, tesorería o dirección entran con su propio acceso.',
    to: '/access',
    done: (s) => s.extraAccess,
  },
  {
    id: 'rehearsal',
    title: 'Convoca el primer ensayo',
    detail: 'La convocatoria es lo primero que ve la banda.',
    to: '/events',
    feature: 'events',
    done: (s) => s.eventCount > 0,
  },
  {
    id: 'security',
    title: 'Activa la verificación en dos pasos',
    detail: 'Protege la cuenta con la que se administra la banda.',
    to: '/security',
    done: (s) => s.mfaEnabled,
  },
];

export function buildSetupGuide(signals: SetupSignals): { dismissed: boolean; steps: SetupStep[] } {
  const features = new Set(signals.features);
  const steps = STEPS.filter((step) => !step.feature || features.has(step.feature)).map((step) => ({
    id: step.id,
    title: step.title,
    detail: step.detail,
    to: step.to,
    done: step.done(signals),
  }));
  return { dismissed: signals.dismissed, steps };
}
