import { z } from 'zod';
import { FEATURES } from '../iam/permissions';
import { REGIONS } from '../tenancy/tenancy.controller';

export const segmentSchema = z
  .object({
    plans: z.array(z.enum(['FREE', 'BASIC', 'PRO', 'ENTERPRISE'])).max(4).optional(),
    regions: z.array(z.enum(REGIONS)).max(REGIONS.length).optional(),
    features: z.array(z.enum(FEATURES)).max(FEATURES.length).optional(),
    tenantIds: z.array(z.string().uuid()).max(200).optional(),
  })
  .default({});
export type Segment = z.infer<typeof segmentSchema>;

export interface TenantFacts {
  id: string;
  planCode: string;
  region: string | null;
  features: ReadonlySet<string>;
}

/** Entre criterios se exige todo (Y); dentro de cada lista basta cualquiera (O). Vacío = todas las bandas. */
export function matchesSegment(segment: Segment, t: TenantFacts): boolean {
  if (segment.plans?.length && !segment.plans.includes(t.planCode as never)) return false;
  if (segment.regions?.length && !(t.region && segment.regions.includes(t.region as never))) return false;
  if (segment.features?.length && !segment.features.some((f) => t.features.has(f))) return false;
  if (segment.tenantIds?.length && !segment.tenantIds.includes(t.id)) return false;
  return true;
}
