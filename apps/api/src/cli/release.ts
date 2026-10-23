/**
 * Paso de release para despliegues sin acceso a ts-node (p. ej. Railway). Es idempotente y se ejecuta
 * al arrancar la API con `RUN_MIGRATIONS=true`:
 *  1. crea o actualiza el rol de aplicación (sin privilegios de propietario) que indica DATABASE_URL;
 *  2. aplica las migraciones con el rol propietario (DATABASE_MIGRATION_URL);
 *  3. carga los planes y, si se indican, crea el administrador de plataforma.
 */
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { seedPlans } from '../billing/plans';

const log = (msg: string) => console.log(`[release] ${msg}`);
const APP_ROLE = 'solfeggio_app';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable ${name}`);
  return value;
}

/** Rol y contraseña de la aplicación, tomados de DATABASE_URL. */
function appCredentials() {
  const url = new URL(required('DATABASE_URL'));
  return { role: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.replace(/^\//, '') };
}

async function prepareAppRole(owner: PrismaClient) {
  const { role, password, database } = appCredentials();
  if (!role || !password) throw new Error('DATABASE_URL debe incluir usuario y contraseña del rol de aplicación');
  // Las migraciones conceden permisos a este rol por su nombre (0002_tenant_isolation y siguientes).
  if (role !== APP_ROLE) throw new Error(`El usuario de DATABASE_URL debe llamarse «${APP_ROLE}» (es «${role}»): las migraciones conceden permisos a ese rol`);
  const ownerRole = new URL(required('DATABASE_MIGRATION_URL')).username;
  if (role === decodeURIComponent(ownerRole)) {
    throw new Error('DATABASE_URL usa el rol propietario: la aplicación debe conectar con un rol sin privilegios para que RLS se aplique');
  }
  const [{ exists }] = await owner.$queryRaw<{ exists: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${role}) AS exists`;
  // `format` con %I y %L cita el identificador y el literal; la contraseña nunca se concatena a mano.
  const [{ stmt }] = await owner.$queryRaw<{ stmt: string }[]>`
    SELECT format(${exists ? 'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS' : 'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS'}, ${role}::text, ${password}::text) AS stmt`;
  await owner.$executeRawUnsafe(stmt);
  const [{ grants }] = await owner.$queryRaw<{ grants: string }[]>`
    SELECT format('GRANT CONNECT ON DATABASE %I TO %I; GRANT USAGE ON SCHEMA public TO %I', ${database}::text, ${role}::text, ${role}::text) AS grants`;
  for (const stmtGrant of grants.split(';')) await owner.$executeRawUnsafe(stmtGrant.trim());
  log(`rol de aplicación «${role}» ${exists ? 'actualizado' : 'creado'}`);
}

function migrate() {
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: required('DATABASE_MIGRATION_URL') },
  });
}

async function platformAdmin(owner: PrismaClient) {
  const email = process.env.PLATFORM_ADMIN_EMAIL?.toLowerCase();
  if (!email) return;
  const existing = await owner.user.findUnique({ where: { email } });
  if (existing) {
    if (!existing.isPlatformAdmin) await owner.user.update({ where: { email }, data: { isPlatformAdmin: true } });
    log(`administrador de plataforma ${email} ya existe`);
    return;
  }
  const password = process.env.PLATFORM_ADMIN_PASSWORD;
  if (!password || password.length < 12) {
    log('PLATFORM_ADMIN_EMAIL definido, pero falta PLATFORM_ADMIN_PASSWORD (mínimo 12 caracteres): no se crea el administrador');
    return;
  }
  await owner.user.create({
    data: { email, name: 'Administración Solfeamos', isPlatformAdmin: true, passwordHash: await argon2.hash(password, { type: argon2.argon2id }), emailVerifiedAt: new Date() },
  });
  log(`administrador de plataforma ${email} creado; cambia la contraseña tras el primer acceso`);
}

async function main() {
  const owner = new PrismaClient({ datasourceUrl: required('DATABASE_MIGRATION_URL') });
  try {
    await prepareAppRole(owner);
    migrate();
    await seedPlans(owner);
    log('planes cargados');
    await platformAdmin(owner);
  } finally {
    await owner.$disconnect();
  }
  log('listo');
}

main().catch((e) => {
  console.error('[release] falló:', e instanceof Error ? e.message : e);
  process.exit(1);
});
