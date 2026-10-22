import { Global, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { JobsOptions, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';

export const QUEUE = 'solfeggio';

export type JobMap = {
  'email.send': { to: string; subject: string; text: string; html?: string };
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
};

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
