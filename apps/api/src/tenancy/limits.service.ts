import { Injectable } from '@nestjs/common';
import { PlanLimitException } from '../common/errors';
import { Db, Tx } from '../db/db.service';

/** Límites del plan. -1 significa ilimitado. */
@Injectable()
export class LimitsService {
  constructor(private readonly db: Db) {}

  private plan(tenantId: string) {
    return this.db.system.tenant.findUniqueOrThrow({ where: { id: tenantId }, include: { plan: true } });
  }

  async assertCanAddUser(tx: Tx, tenantId: string) {
    const { plan } = await this.plan(tenantId);
    if (plan.maxUsers < 0) return;
    const [users, pending] = await Promise.all([
      tx.membership.count({ where: { status: 'ACTIVE' } }),
      tx.invitation.count({ where: { acceptedAt: null, expiresAt: { gt: new Date() } } }),
    ]);
    if (users + pending >= plan.maxUsers) {
      throw new PlanLimitException(`Tu plan permite ${plan.maxUsers} usuarios. Mejora el plan para invitar a más.`);
    }
  }

  async assertCanAddMember(tx: Tx, tenantId: string) {
    const { plan } = await this.plan(tenantId);
    if (plan.maxMembers < 0) return;
    const count = await tx.member.count({ where: { status: { not: 'LEFT' } } });
    if (count >= plan.maxMembers) {
      throw new PlanLimitException(`Tu plan permite ${plan.maxMembers} socios activos.`);
    }
  }

  /** Alumnos activos: plazas del plan más las del add-on Escuela. */
  async assertCanAddStudent(tx: Tx, tenantId: string) {
    const tenant = await this.plan(tenantId);
    if (tenant.plan.maxStudents < 0) return;
    const limit = tenant.plan.maxStudents + tenant.studentSeats;
    const count = await tx.student.count({ where: { status: { not: 'LEFT' } } });
    if (count >= limit) {
      throw new PlanLimitException(`Tu plan permite ${limit} alumnos. Amplía las plazas del add-on Escuela para matricular a más.`);
    }
  }

  /** Reserva almacenamiento de forma atómica; falla si supera la cuota. */
  async reserveStorage(tenantId: string, bytes: number) {
    const tenant = await this.plan(tenantId);
    const limit = BigInt(tenant.plan.storageMb) * 1024n * 1024n;
    const { count } = await this.db.system.tenant.updateMany({
      where: { id: tenantId, storageUsedBytes: { lte: limit - BigInt(bytes) } },
      data: { storageUsedBytes: { increment: BigInt(bytes) } },
    });
    if (count === 0) throw new PlanLimitException(`Has alcanzado el almacenamiento de tu plan (${tenant.plan.storageMb} MB).`);
  }

  async releaseStorage(tenantId: string, bytes: number) {
    await this.db.system.$executeRaw`
      UPDATE tenants SET "storageUsedBytes" = GREATEST(0, "storageUsedBytes" - ${BigInt(bytes)}) WHERE id = ${tenantId}::uuid`;
  }
}
