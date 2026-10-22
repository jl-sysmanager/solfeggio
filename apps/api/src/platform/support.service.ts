import { Injectable } from '@nestjs/common';
import { env } from '../config/env';
import { Db } from '../db/db.service';
import { Jobs } from '../jobs/jobs.service';
import { median, pct, SLA_AT_RISK_MS } from './support.util';

const OPEN = ['OPEN', 'IN_PROGRESS'] as const;

@Injectable()
export class SupportService {
  constructor(
    private readonly db: Db,
    private readonly jobs: Jobs,
  ) {}

  /**
   * Incidencias sin primera respuesta vencidas o a menos de una hora de vencer: se avisa una sola
   * vez (slaAlertedAt) a todo el equipo de plataforma y al responsable asignado.
   */
  async slaSweep(now = new Date()) {
    const incidents = await this.db.system.incident.findMany({
      where: { status: { in: [...OPEN] }, firstResponseAt: null, slaAlertedAt: null, slaDueAt: { lte: new Date(now.getTime() + SLA_AT_RISK_MS) } },
      orderBy: { slaDueAt: 'asc' },
      take: 200,
    });
    if (!incidents.length) return { alerted: 0 };
    const admins = await this.db.system.user.findMany({ where: { isPlatformAdmin: true, blockedAt: null }, select: { id: true, email: true } });
    const tenants = await this.db.system.tenant.findMany({ where: { id: { in: incidents.map((i) => i.tenantId) } }, select: { id: true, name: true } });
    for (const inc of incidents) {
      // Marca primero: si el envío falla no se repite el aviso en cada barrido.
      const { count } = await this.db.system.incident.updateMany({ where: { id: inc.id, slaAlertedAt: null }, data: { slaAlertedAt: now } });
      if (!count) continue;
      const overdue = inc.slaDueAt! <= now;
      const band = tenants.find((t) => t.id === inc.tenantId)?.name ?? 'Banda';
      const to = new Set(admins.map((a) => a.email));
      if (inc.assigneeId) {
        const assignee = admins.find((a) => a.id === inc.assigneeId);
        if (assignee) to.add(assignee.email);
      }
      for (const email of to) {
        await this.jobs.add('email.send', {
          to: email,
          subject: `[SLA ${overdue ? 'vencido' : 'en riesgo'}] P${inc.priority} ${inc.subject}`,
          text:
            `La incidencia de ${band} «${inc.subject}» ${overdue ? 'ha superado' : 'está a punto de superar'} el plazo de primera respuesta ` +
            `(${inc.slaDueAt!.toISOString().slice(0, 16).replace('T', ' ')} UTC).\n\n${env().APP_URL}/admin (Soporte)`,
        });
      }
    }
    return { alerted: incidents.length };
  }

  /** Indicadores de soporte: abiertas, vencidas y tiempos de primera respuesta de los últimos 30 días. */
  async kpis(now = new Date()) {
    const since = new Date(now.getTime() - 30 * 86_400_000);
    const [open, overdue, atRisk, unassigned, recent] = await Promise.all([
      this.db.system.incident.count({ where: { status: { in: [...OPEN] } } }),
      this.db.system.incident.count({ where: { status: { in: [...OPEN] }, firstResponseAt: null, slaDueAt: { lt: now } } }),
      this.db.system.incident.count({
        where: { status: { in: [...OPEN] }, firstResponseAt: null, slaDueAt: { gte: now, lte: new Date(now.getTime() + SLA_AT_RISK_MS) } },
      }),
      this.db.system.incident.count({ where: { status: { in: [...OPEN] }, assigneeId: null } }),
      this.db.system.incident.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true, slaDueAt: true, firstResponseAt: true } }),
    ]);
    const responded = recent.filter((i) => i.firstResponseAt);
    // Cuentan las respondidas y las que ya vencieron sin respuesta; las pendientes en plazo no.
    const measurable = recent.filter((i) => i.slaDueAt && (i.firstResponseAt || i.slaDueAt < now));
    const within = measurable.filter((i) => i.firstResponseAt && i.firstResponseAt <= i.slaDueAt!).length;
    const med = median(responded.map((i) => (i.firstResponseAt!.getTime() - i.createdAt.getTime()) / 60_000));
    return {
      open,
      overdue,
      atRisk,
      unassigned,
      last30d: {
        created: recent.length,
        responded: responded.length,
        medianFirstResponseMinutes: med === null ? null : Math.round(med),
        withinSlaPct: pct(within, measurable.length),
      },
    };
  }
}
