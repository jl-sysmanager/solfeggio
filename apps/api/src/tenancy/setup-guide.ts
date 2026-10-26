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
  /** Escuela de música (sólo cuenta si la banda tiene la funcionalidad). */
  school?: { years: number; groups: number; groupsWithoutSlots: number; students: number };
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
    title: 'Amplía el censo de socios',
    detail: 'Tú ya cuentas como socio; da de alta al resto de la plantilla.',
    to: '/members',
    feature: 'members',
    done: (s) => s.memberCount > 1,
  },
  {
    id: 'access',
    title: 'Invita a quien comparte la gestión',
    detail: 'Secretaría, tesorería o dirección entran con su propio acceso.',
    to: '/members?access=users',
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
    id: 'school-setup',
    title: 'Prepara el curso de la escuela',
    detail: 'Curso, asignaturas, profesorado y grupos. El panel de Inicio de la escuela te guía.',
    to: '/school',
    feature: 'school',
    done: (s) => !!s.school && s.school.years > 0 && s.school.groups > 0,
  },
  {
    id: 'school-schedule',
    title: 'Pon horario a los grupos de la escuela',
    detail: 'Con el horario, las clases del curso se crean solas.',
    to: '/school?tab=groups',
    feature: 'school',
    done: (s) => !!s.school && s.school.groups > 0 && s.school.groupsWithoutSlots === 0,
  },
  {
    id: 'school-students',
    title: 'Da de alta a los alumnos',
    detail: 'Abre la matrícula online o importa tu lista desde una hoja de cálculo.',
    to: '/school?tab=students',
    feature: 'school',
    done: (s) => !!s.school && s.school.students > 0,
  },
  {
    id: 'security',
    title: 'Activa la verificación en dos pasos',
    detail: 'Protege la cuenta con la que se administra la banda.',
    to: '/account?tab=seguridad',
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
