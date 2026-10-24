import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Worker } from 'bullmq';
import { env } from './config/env';
import { AuditModule } from './audit/audit.service';
import { BillingOpsService } from './billing/billing-ops.service';
import { BillingService } from './billing/billing.service';
import { PlanSync } from './billing/plan-sync';
import { StripeClient } from './billing/stripe.provider';
import { Db, DbModule } from './db/db.service';
import { IntegrationsModule } from './integrations/integrations.module';
import { Jobs, JobsModule, QUEUE, redisConnection } from './jobs/jobs.service';
import { Processors } from './jobs/processors';
import { SCHEDULE_CATALOG } from './jobs/schedules';
import { InsightsService } from './platform/insights.service';
import { OpsService } from './platform/ops.service';
import { TenantBackupService } from './platform/tenant-backup.service';
import { SupportService } from './platform/support.service';
import { StorageModule } from './storage/storage.service';

@Module({
  imports: [DbModule, JobsModule, IntegrationsModule, StorageModule, AuditModule],
  providers: [Processors, BillingService, PlanSync, StripeClient, BillingOpsService, InsightsService, SupportService, OpsService, TenantBackupService],
})
class WorkerModule {}

async function main() {
  const systemUrl = env().SYSTEM_DATABASE_URL ?? env().DATABASE_MIGRATION_URL;
  if (!systemUrl || new URL(systemUrl).username === new URL(env().DATABASE_URL).username) {
    throw new Error('El worker requiere SYSTEM_DATABASE_URL con el rol propietario; no puede usar el rol de aplicación.');
  }
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const logger = new Logger('Worker');
  const processors = app.get(Processors);
  const jobs = app.get(Jobs);
  const db = app.get(Db);
  const connection = redisConnection();

  for (const s of SCHEDULE_CATALOG) {
    await db.system.scheduledTask.upsert({
      where: { key: s.key },
      create: { key: s.key, pattern: s.pattern },
      update: {},
    });
  }
  const schedules = await db.system.scheduledTask.findMany({ where: { key: { in: SCHEDULE_CATALOG.map((s) => s.key) } } });
  for (const schedule of schedules) await jobs.setSchedule(schedule.key as keyof import('./jobs/jobs.service').JobMap, schedule.pattern, schedule.timezone, schedule.enabled);

  const worker = new Worker(QUEUE, (job) => processors.handle(job, connection), { connection: redisConnection(), concurrency: 5 });
  worker.on('failed', (job, err) => logger.error(`${job?.name} (${job?.id}) falló: ${err.message}`));
  worker.on('completed', (job) => logger.log(`${job.name} (${job.id}) completado`));
  logger.log('Worker en marcha');

  const shutdown = async () => {
    await worker.close();
    await connection.quit();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

void main();
