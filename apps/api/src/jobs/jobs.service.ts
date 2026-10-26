import { Global, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { JobsOptions, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';

export const QUEUE = 'solfeggio';

export type JobMap = {
  'email.send': { to: string; subject: string; text: string; html?: string; tenantId?: string };
  'notify.fanout': {
    tenantId: string;
    userIds?: string[];
    memberIds?: string[];
    type: string;
    title: string;
    body: string;
    link?: string;
    email?: boolean;
  };
  'events.reminders': Record<string, never>;
  'billing.grace-sweep': Record<string, never>;
  'finance.overdue': Record<string, never>;
  'storage.recount': Record<string, never>;
  'platform.snapshot': { date?: string };
  'support.sla-sweep': Record<string, never>;
  'ops.orphan-scan': Record<string, never>;
  'billing.reconcile-addons': Record<string, never>;
  'backups.export-tenants': Record<string, never>;
  'school.tuition-issue': Record<string, never>;
};

/** Datos del trabajo sin cuerpos de mensajes: sólo claves cortas y escalares. */
function summarize(data: unknown) {
  if (!data || typeof data !== 'object') return {};
  return Object.fromEntries(
    Object.entries(data as Record<string, unknown>)
      .filter(([k, v]) => !['text', 'html', 'body'].includes(k) && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'))
      .map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 120) : v]),
  );
}

export const redisConnection = () => new IORedis(env().REDIS_URL, { maxRetriesPerRequest: null });

@Injectable()
export class Jobs implements OnModuleDestroy {
  private readonly logger = new Logger(Jobs.name);
  private queue?: Queue;

  private get q(): Queue {
    this.queue ??= new Queue(QUEUE, {
      connection: redisConnection(),
      defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: 1000, removeOnFail: 5000 },
    });
    return this.queue;
  }

  async add<K extends keyof JobMap>(name: K, data: JobMap[K], opts?: JobsOptions) {
    try {
      await this.q.add(name, data, opts);
    } catch (e) {
      // La cola no debe tumbar la petición: la notificación se reintenta en el siguiente barrido.
      this.logger.error(`No se pudo encolar ${name}: ${(e as Error).message}`);
    }
  }

  /** Sustituye una tarea periódica por nombre, evitando que quede activa su programación anterior. */
  async setSchedule(name: keyof JobMap, pattern: string, timezone = 'Europe/Madrid', enabled = true) {
    const repeatables = await this.q.getRepeatableJobs();
    for (const repeatable of repeatables.filter((row) => row.name === name)) {
      await this.q.removeRepeatableByKey(repeatable.key);
    }
    if (enabled) await this.q.add(name, {} as JobMap[keyof JobMap], { repeat: { pattern, tz: timezone }, jobId: `cron:${name}` });
  }

  /** Recuento de trabajos por estado (panel de salud técnica). */
  async counts() {
    return this.q.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed', 'paused');
  }

  /** Tareas periódicas registradas con su próxima ejecución. */
  async repeatables() {
    const rows = await this.q.getRepeatableJobs(0, 100);
    return rows.map((r) => ({ name: r.name, pattern: r.pattern ?? null, tz: r.tz ?? null, next: r.next ? new Date(r.next) : null }));
  }

  async failedJobs(limit = 50) {
    const jobs = await this.q.getFailed(0, limit - 1);
    return jobs.map((j) => ({
      id: String(j.id), name: j.name, attempts: j.attemptsMade, error: j.failedReason ?? '',
      failedAt: j.finishedOn ? new Date(j.finishedOn) : null, data: summarize(j.data),
    }));
  }

  async retryFailed(id?: string): Promise<number> {
    if (id) {
      const job = await this.q.getJob(id);
      if (!job || !(await job.isFailed())) return 0;
      await job.retry();
      return 1;
    }
    const jobs = await this.q.getFailed(0, 999);
    let n = 0;
    for (const j of jobs) {
      await j.retry().then(() => n++).catch(() => undefined);
    }
    return n;
  }

  async removeFailed(id: string): Promise<boolean> {
    const job = await this.q.getJob(id);
    if (!job || !(await job.isFailed())) return false;
    await job.remove();
    return true;
  }

  async ping(): Promise<boolean> {
    const client = (await this.q.client) as unknown as IORedis;
    return (await client.ping()) === 'PONG';
  }

  async onModuleDestroy() {
    await this.queue?.close();
  }
}

@Global()
@Module({ providers: [Jobs], exports: [Jobs] })
export class JobsModule {}
