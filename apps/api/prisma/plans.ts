import { PlanCode, PrismaClient } from '@prisma/client';

const BASE = ['members', 'archive', 'events', 'attendance'];
const BASIC = [...BASE, 'treasury', 'wardrobe', 'instruments', 'communications', 'performances', 'governance'];
const PRO = [...BASIC, 'market', 'calendar_sync', 'advanced_reports', 'school', 'reinforcements', 'archive_ai'];
const ENTERPRISE = [...PRO, 'sso', 'priority_support', 'api_access'];

export const PLANS: { code: PlanCode; name: string; m: number; y: number; users: number; members: number; storageMb: number; students: number; features: string[]; trialDays: number }[] = [
  { code: 'FREE', name: 'Free', m: 0, y: 0, users: 5, members: 40, storageMb: 500, students: 0, features: BASE, trialDays: 0 },
  { code: 'BASIC', name: 'Basic', m: 900, y: 9000, users: 15, members: 100, storageMb: 5 * 1024, students: 0, features: BASIC, trialDays: 14 },
  { code: 'PRO', name: 'Pro', m: 2400, y: 24000, users: 50, members: 300, storageMb: 50 * 1024, students: 150, features: PRO, trialDays: 14 },
  { code: 'ENTERPRISE', name: 'Enterprise', m: 7900, y: 79000, users: -1, members: -1, storageMb: 500 * 1024, students: -1, features: ENTERPRISE, trialDays: 14 },
];

export async function seedPlans(db: PrismaClient) {
  for (const p of PLANS) {
    const prices = {
      stripePriceMonthly: process.env[`STRIPE_PRICE_${p.code}_MONTHLY`] || null,
      stripePriceYearly: process.env[`STRIPE_PRICE_${p.code}_YEARLY`] || null,
    };
    await db.plan.upsert({
      where: { code: p.code },
      create: { code: p.code, name: p.name, priceMonthlyCents: p.m, priceYearlyCents: p.y, maxUsers: p.users, maxMembers: p.members, storageMb: p.storageMb, maxStudents: p.students, features: p.features, trialDays: p.trialDays, ...prices },
      update: { features: p.features, maxStudents: p.students, ...Object.fromEntries(Object.entries(prices).filter(([, v]) => v)) },
    });
  }
}

