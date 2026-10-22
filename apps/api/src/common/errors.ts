import { ForbiddenException, NotFoundException } from '@nestjs/common';

export const notFound = (what = 'Recurso') => new NotFoundException({ message: `${what} no encontrado`, code: 'NOT_FOUND' });

export class PlanLimitException extends ForbiddenException {
  constructor(message: string) {
    super({ message, code: 'PLAN_LIMIT' });
  }
}

export class FeatureNotInPlanException extends ForbiddenException {
  constructor(feature: string) {
    super({ message: `Tu plan no incluye «${feature}»`, code: 'FEATURE_NOT_IN_PLAN', details: { feature } });
  }
}

/** Devuelve el valor o lanza 404. Usado tras lecturas bajo RLS. */
export function found<T>(value: T | null | undefined, what?: string): T {
  if (value === null || value === undefined) throw notFound(what);
  return value;
}
