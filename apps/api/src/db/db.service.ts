import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { env } from '../config/env';

export type Tx = Prisma.TransactionClient;

/**
 * Acceso a datos con aislamiento por tenant.
 *
 * - `tenant(tenantId, fn)`: abre una transacción con el rol de aplicación (sujeto a RLS) y fija
 *   `app.tenant_id` para esa transacción. Toda lectura/escritura de negocio pasa por aquí.
 * - `system`: cliente con el rol propietario (no sujeto a RLS). Sólo para autenticación,
 *   webhooks, worker y panel global. Nunca se expone a controladores de tenant.
 */
@Injectable()
export class Db implements OnModuleDestroy {
  readonly app: PrismaClient;
  readonly system: PrismaClient;

  constructor() {
    const e = env();
    this.app = new PrismaClient({ datasourceUrl: e.DATABASE_URL });
    this.system = new PrismaClient({ datasourceUrl: e.SYSTEM_DATABASE_URL ?? e.DATABASE_MIGRATION_URL ?? e.DATABASE_URL });
  }

  tenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (!tenantId) throw new Error('tenantId requerido');
    return this.app.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        return fn(tx);
      },
      { timeout: 20_000, maxWait: 5_000 },
    );
  }

  async onModuleDestroy() {
    await Promise.all([this.app.$disconnect(), this.system.$disconnect()]);
  }
}

@Global()
@Module({ providers: [Db], exports: [Db] })
export class DbModule {}
