import { execSync } from 'node:child_process';
import path from 'node:path';
import './setup-env';

/** Aplica las migraciones a la base de datos de test antes de la suite. */
export default function globalSetup() {
  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: process.env.SYSTEM_DATABASE_URL, DATABASE_MIGRATION_URL: process.env.SYSTEM_DATABASE_URL },
    stdio: 'pipe',
  });
}
