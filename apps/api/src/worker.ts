import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Worker } from 'bullmq';
import { AuditModule } from './audit/audit.service';
import { BillingOpsService } from './billing/billing-ops.service';
import { BillingService } from './billing/billing.service';
import { PlanSync } from './billing/plan-sync';
import { StripeClient } from './billing/stripe.provider';
import { DbModule } from './db/db.service';
import { IntegrationsModule } from './integrations/integrations.module';
import { Jobs, JobsModule, QUEUE, redisConnection } from './jobs/jobs.service';
import { Processors } from './jobs/processors';
import { InsightsService } from './platform/insights.service';
import { OpsService } from './platform/ops.service';
import { SupportService } from './platform/support.service';
import { StorageModule } from './storage/storage.service';

@Module({
  imports: [DbModule, JobsModule, IntegrationsModule, StorageModule, AuditModule],
  providers: [Processors, BillingService, PlanSync, StripeClient, BillingOpsService, InsightsService, SupportService, OpsService],
})
class WorkerModule {}

/** Planificación de tareas periódicas. El `jobId` determinista evita duplicados entre réplicas. */
const SCHEDULES = [
  { name: 'events.reminders', pattern: '*/15 * * * *' },
  { name: 'billing.grace-sweep', pattern: '5 * * * *' },
  { name: 'finance.overdue', pattern: '30 3 * * *' },
  { name: 'storage.recount', pattern: '0 4 * * *' },
  { name: 'platform.snapshot', pattern: '30 2 * * *' },
  { name: 'support.sla-sweep', pattern: '*/15 * * * *' },
  { name: 'billing.reconcile-addons', pattern: '15 3 * * *' },
  { name: 'ops.orphan-scan', pattern: '0 5 * * 0' },
] as const;

async function main() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const logger = new Logger('Worker');
  const processors = app.get(Processors);
  const jobs = app.get(Jobs);
  const connection = redisConnection();

  for (const s of SCHEDULES) {
    await jobs.add(s.name, {}, { repeat: { pattern: s.pattern, tz: 'Europe/Madrid' }, jobId: `cron:${s.name}` });
  }

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
