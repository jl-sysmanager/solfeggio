import { PlanCode, PrismaClient } from '@prisma/client';
import { FEATURE_KEYS } from './feature-catalog';

const BASE = ['members', 'archive', 'events', 'attendance'];
const BASIC = [...BASE, 'treasury', 'wardrobe', 'instruments', 'communications', 'performances', 'governance'];
const PRO = [...BASIC, 'market', 'calendar_sync', 'school', 'reinforcements', 'archive_ai'];
// Enterprise = mismas features que Pro; los límites (usuarios/socios ilimitados, 500 GB) van en la fila del catálogo.
const ENTERPRISE = [...PRO];

// * `students` queda en -1 (sin cupo de fichas): familias/profesores con acceso cuentan como usuarios.
// * Precios: Basic 15 € / Pro 35 € / Enterprise 79 € (anual = 10 meses). Enterprise = Pro sin límite de usuarios/socios y 500 GB.
export const PLANS: { code: PlanCode; name: string; m: number; y: number; users: number; members: number; storageMb: number; students: number; features: string[]; trialDays: number }[] = [
  { code: 'FREE', name: 'Free', m: 0, y: 0, users: 5, members: 40, storageMb: 500, students: -1, features: BASE, trialDays: 0 },
  { code: 'BASIC', name: 'Basic', m: 1500, y: 15000, users: 20, members: 150, storageMb: 10 * 1024, students: -1, features: BASIC, trialDays: 14 },
  { code: 'PRO', name: 'Pro', m: 3500, y: 35000, users: 80, members: 400, storageMb: 100 * 1024, students: -1, features: PRO, trialDays: 14 },
  { code: 'ENTERPRISE', name: 'Enterprise', m: 7900, y: 79000, users: -1, members: -1, storageMb: 500 * 1024, students: -1, features: ENTERPRISE, trialDays: 14 },
];

const known = new Set<string>(FEATURE_KEYS);

export async function seedPlans(db: PrismaClient) {
  for (const p of PLANS) {
    const prices = {
      stripePriceMonthly: process.env[`STRIPE_PRICE_${p.code}_MONTHLY`] || null,
      stripePriceYearly: process.env[`STRIPE_PRICE_${p.code}_YEARLY`] || null,
    };
    const catalog = {
      name: p.name,
      priceMonthlyCents: p.m,
      priceYearlyCents: p.y,
      maxUsers: p.users,
      maxMembers: p.members,
      storageMb: p.storageMb,
      maxStudents: p.students,
      trialDays: p.trialDays,
    };
    await db.plan.upsert({
      where: { code: p.code },
      create: { code: p.code, features: p.features, ...catalog, ...prices },
      // * No pisa `features`: el panel global las configura por módulos.
      update: { ...catalog, ...Object.fromEntries(Object.entries(prices).filter(([, v]) => v)) },
    });
  }
  // * Quita claves que ya no están en el catálogo (p. ej. SSO anunciado y no construido).
  const plans = await db.plan.findMany({ select: { id: true, features: true } });
  for (const plan of plans) {
    const features = plan.features.filter((f) => known.has(f));
    if (features.length !== plan.features.length) await db.plan.update({ where: { id: plan.id }, data: { features } });
  }
}

