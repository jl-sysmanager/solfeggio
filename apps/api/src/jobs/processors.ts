import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import type IORedis from 'ioredis';
import { BillingOpsService } from '../billing/billing-ops.service';
import { BillingService } from '../billing/billing.service';
import { appUrl } from '../config/env';
import { Db } from '../db/db.service';
import { TYPE_LABEL } from '../events/events.controller';
import { Mailer } from '../integrations/mailer.service';
import { InsightsService } from '../platform/insights.service';
import { OpsService } from '../platform/ops.service';
import { TenantBackupService } from '../platform/tenant-backup.service';
import { SupportService } from '../platform/support.service';
import { JobMap, Jobs } from './jobs.service';

const REMINDER_TICK_MIN = 15;
/** Tareas periódicas (coinciden con SCHEDULES del worker). */
export const CRONS = new Set<string>(['events.reminders', 'billing.grace-sweep', 'finance.overdue', 'storage.recount', 'platform.snapshot', 'support.sla-sweep', 'billing.reconcile-addons', 'ops.orphan-scan', 'backups.export-tenants']);

@Injectable()
export class Processors {
  private readonly logger = new Logger(Processors.name);

  constructor(
    private readonly db: Db,
    private readonly jobs: Jobs,
    private readonly billing: BillingService,
    private readonly mailer: Mailer,
    private readonly insights: InsightsService,
    private readonly support: SupportService,
    private readonly ops: OpsService,
    private readonly billingOps: BillingOpsService,
    private readonly backups: TenantBackupService,
  ) {}

  /** Cada tarea periódica deja su latido (`cron.<nombre>`) para el panel de salud técnica. */
  async handle(job: Job, redis: IORedis) {
    const name = job.name as keyof JobMap;
    if (!CRONS.has(name)) return this.run(job, redis);
    const started = new Date();
    try {
      const result = await this.run(job, redis);
      await this.beat(name, 'ok', started, { durationMs: Date.now() - started.getTime() });
      return result;
    } catch (e) {
      await this.beat(name, 'error', started, { error: (e as Error).message.slice(0, 300) });
      throw e;
    }
  }

  private async beat(name: string, status: string, at: Date, detail: object) {
    await this.db.system.opsHeartbeat
      .upsert({
        where: { name: `cron.${name}` },
        create: { name: `cron.${name}`, status, detail, lastRunAt: at },
        update: { status, detail, lastRunAt: at },
      })
      .catch((e) => this.logger.warn(`No se pudo registrar el latido de ${name}: ${e.message}`));
  }

  private async run(job: Job, redis: IORedis) {
    switch (job.name as keyof JobMap) {
      case 'email.send':
        return this.email(job.data);
      case 'notify.fanout':
        return this.fanout(job.data);
      case 'events.reminders':
        return this.reminders(redis);
      case 'billing.grace-sweep':
        return this.billing.sweepGracePeriods();
      case 'finance.overdue':
        return this.overdue();
      case 'storage.recount':
        return this.recount();
      case 'platform.snapshot':
        return this.insights.snapshot();
      case 'support.sla-sweep':
        return this.support.slaSweep();
      case 'ops.orphan-scan':
        return this.ops.scanOrphans();
      case 'billing.reconcile-addons':
        return this.billingOps.reconcileAddons();
      case 'backups.export-tenants':
        return this.backups.exportAll();
      default:
        this.logger.warn(`Trabajo desconocido: ${job.name}`);
    }
  }

  private async email(data: JobMap['email.send']) {
    // Con el correo deshabilitado el trabajo termina sin reintentos; los fallos del proveedor sí reintentan.
    const log = (status: 'SENT' | 'FAILED', error?: string) =>
      this.db.system.emailLog
        .create({ data: { tenantId: data.tenantId ?? null, to: data.to, subject: data.subject.slice(0, 300), status, error: error?.slice(0, 500) } })
        .catch((e) => this.logger.warn(`No se pudo registrar el correo: ${e.message}`));
    try {
      const result = await this.mailer.send(data);
      if (result.sent) await log('SENT');
      return result;
    } catch (e) {
      await log('FAILED', (e as Error).message);
      throw e;
    }
  }

  /** Crea notificaciones in-app para los usuarios afectados y, opcionalmente, encola emails. */
  async fanout(data: JobMap['notify.fanout']) {
    const userIds = new Set(data.userIds ?? []);
    const emails = new Set<string>();
    if (data.memberIds?.length) {
      const [memberships, members] = await Promise.all([
        this.db.system.membership.findMany({ where: { tenantId: data.tenantId, memberId: { in: data.memberIds }, status: 'ACTIVE' }, select: { userId: true } }),
        this.db.system.member.findMany({ where: { tenantId: data.tenantId, id: { in: data.memberIds }, email: { not: null } }, select: { email: true } }),
      ]);
      memberships.forEach((m) => userIds.add(m.userId));
      members.forEach((m) => emails.add(m.email!.toLowerCase()));
    }
    if (userIds.size) {
      await this.db.system.notification.createMany({
        data: [...userIds].map((userId) => ({ tenantId: data.tenantId, userId, type: data.type, title: data.title, body: data.body, link: data.link })),
      });
    }
    if (data.email) {
      const users = await this.db.system.user.findMany({ where: { id: { in: [...userIds] } }, select: { email: true } });
      users.forEach((u) => emails.add(u.email));
      const link = data.link ? `\n\n${appUrl(data.link)}` : '';
      for (const to of emails) await this.jobs.add('email.send', { to, subject: data.title, text: `${data.body}${link}`, tenantId: data.tenantId });
    }
    return { users: userIds.size, emails: data.email ? emails.size : 0 };
  }

  /**
   * Recordatorios: cada 15 min busca eventos cuyo instante de aviso (inicio - N minutos) cayó en
   * la última ventana. La clave en Redis garantiza un único envío por evento y aviso.
   */
  async reminders(redis: IORedis, now = new Date()) {
    const horizon = new Date(now.getTime() + 14 * 86_400_000 + REMINDER_TICK_MIN * 60_000);
    const events = await this.db.system.event.findMany({
      where: { status: 'SCHEDULED', startsAt: { gt: now, lte: horizon } },
      include: { calls: { where: { response: { not: 'DECLINED' } }, select: { memberId: true } } },
    });
    let sent = 0;
    for (const ev of events) {
      for (const minutes of ev.reminderMinutes) {
        const at = ev.startsAt.getTime() - minutes * 60_000;
        if (at > now.getTime() || at <= now.getTime() - REMINDER_TICK_MIN * 60_000) continue;
        const fresh = await redis.set(`reminder:${ev.id}:${minutes}`, '1', 'EX', 30 * 86_400, 'NX');
        if (!fresh || !ev.calls.length) continue;
        await this.fanout({
          tenantId: ev.tenantId, memberIds: ev.calls.map((c) => c.memberId), type: 'event.reminder', email: true,
          title: `Recordatorio: ${TYPE_LABEL[ev.type]} «${ev.title}»`,
          body: `Empieza el ${ev.startsAt.toISOString().slice(0, 16).replace('T', ' ')} UTC${ev.location ? ` en ${ev.location}` : ''}.`,
          link: `/events/${ev.id}`,
        });
        sent++;
      }
    }
    return { sent };
  }

  async overdue(today = new Date()) {
    const { count } = await this.db.system.feeCharge.updateMany({
      where: { status: 'PENDING', dueDate: { lt: new Date(today.toISOString().slice(0, 10)) } },
      data: { status: 'OVERDUE' },
    });
    return { overdue: count };
  }

  /** Recalcula el almacenamiento real por tenant para corregir derivas. */
  async recount() {
    await this.db.system.$executeRaw`
      UPDATE tenants t SET "storageUsedBytes" = COALESCE(a.bytes, 0) + COALESCE(d.bytes, 0)
      FROM tenants t2
      LEFT JOIN (SELECT tenant_id, SUM("sizeBytes")::bigint AS bytes FROM assets GROUP BY tenant_id) a ON a.tenant_id = t2.id
      LEFT JOIN (SELECT tenant_id, SUM("sizeBytes")::bigint AS bytes FROM documents GROUP BY tenant_id) d ON d.tenant_id = t2.id
      WHERE t.id = t2.id`;
  }
}
