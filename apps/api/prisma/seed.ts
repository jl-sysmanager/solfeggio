/**
 * Seed idempotente.
 * - Siempre: planes (precios de Stripe desde STRIPE_PRICE_*).
 * - Si PLATFORM_ADMIN_EMAIL: usuario administrador de plataforma.
 * - Si SEED_DEMO=true: banda de demostración con datos de ejemplo.
 *
 * Contraseña de los usuarios creados: SEED_PASSWORD (por defecto, valor de desarrollo
 * `solfeggio-dev-2026`). Sólo para entornos locales.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { SYSTEM_ROLES } from '../src/iam/permissions';
import { DEFAULT_SECTIONS } from '../src/tenancy/onboarding.service';
import { seedPlans } from './plans';

const db = new PrismaClient({ datasourceUrl: process.env.SYSTEM_DATABASE_URL ?? process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL });
const PASSWORD = process.env.SEED_PASSWORD ?? 'solfeggio-dev-2026';

async function user(email: string, name: string, isPlatformAdmin = false) {
  return db.user.upsert({
    where: { email },
    create: { email, name, isPlatformAdmin, passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }), emailVerifiedAt: new Date() },
    update: { isPlatformAdmin },
  });
}

const DEMO_COMPLIMENTARY_MS = 10 * 365 * 86_400_000;

/** Activa el plan Pro de la demo sin Stripe (si no, el entitlements deja sólo Free y el menú pierde Escuela, etc.). */
async function ensureDemoPaid() {
  const demo = await db.tenant.findUnique({ where: { slug: 'banda-demo' } });
  if (!demo) return;
  const until = new Date(Date.now() + DEMO_COMPLIMENTARY_MS);
  if (!demo.complimentaryUntil || demo.complimentaryUntil < new Date()) {
    await db.tenant.update({
      where: { id: demo.id },
      data: { complimentaryUntil: until, complimentaryReason: demo.complimentaryReason ?? 'Banda de demostración' },
    });
  }
}

async function seedDemo() {
  const existing = await db.tenant.findUnique({ where: { slug: 'banda-demo' } });
  if (existing) {
    await ensureDemoPaid();
    return;
  }
  const pro = await db.plan.findUniqueOrThrow({ where: { code: 'PRO' } });
  const complimentaryUntil = new Date(Date.now() + DEMO_COMPLIMENTARY_MS);
  const tenant = await db.tenant.create({
    data: {
      name: 'Banda Sinfónica Demo',
      slug: 'banda-demo',
      planId: pro.id,
      status: 'ACTIVE',
      onboardedAt: new Date(),
      complimentaryUntil,
      complimentaryReason: 'Banda de demostración',
      subscription: { create: {} },
    },
  });
  const t = tenant.id;
  await db.role.createMany({ data: SYSTEM_ROLES.map((r) => ({ tenantId: t, key: r.key, name: r.name, permissions: r.permissions, isSystem: true })) });
  const roles = Object.fromEntries((await db.role.findMany({ where: { tenantId: t } })).map((r) => [r.key, r.id]));
  await db.section.createMany({ data: DEFAULT_SECTIONS.map((name, position) => ({ tenantId: t, name, position })) });
  const sections = await db.section.findMany({ where: { tenantId: t } });
  const sec = (n: string) => sections.find((s) => s.name === n)!.id;

  const people = [
    ['Lucía', 'García Pérez', 'Clarinete', 'Clarinetes'],
    ['Javier', 'Martín Ruiz', 'Trompeta', 'Trompetas'],
    ['Marta', 'López Sanz', 'Flauta', 'Flautas'],
    ['Pablo', 'Navarro Gil', 'Trombón', 'Trombones'],
    ['Elena', 'Romero Díaz', 'Saxofón alto', 'Saxofones'],
    ['Diego', 'Torres Moreno', 'Percusión', 'Percusión'],
    ['Carmen', 'Vidal Ortega', 'Trompa', 'Trompas'],
    ['Andrés', 'Molina Castro', 'Tuba', 'Tubas'],
  ];
  for (const [i, [firstName, lastName, instrument, section]] of people.entries()) {
    await db.member.create({ data: { tenantId: t, memberNumber: i + 1, firstName, lastName, instrument, sectionId: sec(section), email: `socio${i + 1}@demo.solfeggio.local`, consentDataAt: new Date() } });
  }
  const members = await db.member.findMany({ where: { tenantId: t }, orderBy: { memberNumber: 'asc' } });

  const accounts: [string, string, string, number | null][] = [
    ['propietario@demo.solfeggio.local', 'Ana Propietaria', 'owner', null],
    ['director@demo.solfeggio.local', 'Ramón Director', 'director', null],
    ['tesorero@demo.solfeggio.local', 'Teresa Tesorera', 'treasurer', null],
    ['musico@demo.solfeggio.local', 'Lucía García', 'musician', 0],
  ];
  for (const [email, name, role, memberIdx] of accounts) {
    const u = await user(email, name);
    await db.membership.create({ data: { tenantId: t, userId: u.id, roleId: roles[role], memberId: memberIdx === null ? null : members[memberIdx].id } });
  }

  const composers = await Promise.all(
    ['Ferrer Ferrán', 'José Franco', 'Pascual Marquina', 'Óscar Navarro', 'Manuel Penella'].map((name) => db.composer.create({ data: { tenantId: t, name } })),
  );
  const works: [string, number, string, string[]][] = [
    ['Paconchita', 1, 'Pasodoble', ['pasodoble', 'fiestas']],
    ['Ragón Falez', 1, 'Pasodoble', ['pasodoble']],
    ['España Cañí', 2, 'Pasodoble', ['pasodoble', 'clásico']],
    ['Libertadores', 3, 'Obra sinfónica', ['concierto', 'certamen']],
    ['El Gato Montés', 4, 'Pasodoble', ['pasodoble', 'zarzuela']],
    ['Mi Barca', 0, 'Marcha', ['marcha', 'procesión']],
  ];
  for (const [title, c, genre, tags] of works) await db.work.create({ data: { tenantId: t, title, composerId: composers[c].id, genre, tags } });

  const owner = await db.user.findUniqueOrThrow({ where: { email: 'propietario@demo.solfeggio.local' } });
  const day = 86_400_000;
  for (let w = 1; w <= 4; w++) {
    const start = new Date(Date.now() + w * 7 * day);
    start.setUTCHours(18, 30, 0, 0);
    await db.event.create({ data: { tenantId: t, type: 'REHEARSAL', title: `Ensayo general ${w}`, location: 'Local social', startsAt: start, endsAt: new Date(start.getTime() + 2 * 3_600_000), createdById: owner.id } });
  }
  const concert = new Date(Date.now() + 35 * day);
  concert.setUTCHours(19, 0, 0, 0);
  const ev = await db.event.create({ data: { tenantId: t, type: 'PERFORMANCE', title: 'Concierto de Santa Cecilia', location: 'Auditorio municipal', startsAt: concert, endsAt: new Date(concert.getTime() + 2 * 3_600_000), createdById: owner.id } });
  await db.eventCall.createMany({ data: members.map((m) => ({ tenantId: t, eventId: ev.id, memberId: m.id })) });

  await db.financeCategory.createMany({ data: [{ tenantId: t, name: 'Cuotas de socios', kind: 'INCOME' }, { tenantId: t, name: 'Actuaciones', kind: 'INCOME' }, { tenantId: t, name: 'Partituras', kind: 'EXPENSE' }] });
  const fee = await db.fee.create({ data: { tenantId: t, name: 'Cuota anual', amountCents: 6000, periodicity: 'YEARLY' } });
  const year = String(new Date().getUTCFullYear());
  await db.feeCharge.createMany({ data: members.map((m) => ({ tenantId: t, feeId: fee.id, memberId: m.id, period: year, amountCents: 6000, dueDate: new Date(`${year}-12-31`) })) });
  await db.instrument.createMany({ data: [
    { tenantId: t, inventoryCode: 'INS-001', type: 'Tuba', brand: 'Yamaha', model: 'YBB-321' },
    { tenantId: t, inventoryCode: 'INS-002', type: 'Bombo', brand: 'Honsuy' },
  ] });
  await db.uniformItem.createMany({ data: [
    { tenantId: t, code: 'CHA-001', garment: 'Chaqueta', size: 'M' },
    { tenantId: t, code: 'CHA-002', garment: 'Chaqueta', size: 'L' },
    { tenantId: t, code: 'GOR-001', garment: 'Gorra', size: '57' },
  ] });
  console.log('Banda demo creada: banda-demo (usuarios *@demo.solfeggio.local)');
}

async function main() {
  await seedPlans(db);
  if (process.env.PLATFORM_ADMIN_EMAIL) await user(process.env.PLATFORM_ADMIN_EMAIL.toLowerCase(), 'Administración Solfeamos', true);
  if (process.env.SEED_DEMO === 'true') await seedDemo();
  console.log('Seed completado');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
