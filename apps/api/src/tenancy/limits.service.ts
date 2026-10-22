import { Injectable } from '@nestjs/common';
import { PlanLimitException } from '../common/errors';
import { Db, Tx } from '../db/db.service';
import { effectiveLimits } from './effective-limits';

/** Límites efectivos (plan + overrides). -1 significa ilimitado. */
@Injectable()
export class LimitsService {
  constructor(private readonly db: Db) {}

  private async tenant(tenantId: string) {
    return this.db.system.tenant.findUniqueOrThrow({ where: { id: tenantId }, include: { plan: true } });
  }

  /** Cupo de accesos a la plataforma (junta, músicos, profesores, familias del portal, etc.). */
  async assertCanAddUser(tx: Tx, tenantId: string) {
    const { maxUsers } = effectiveLimits(await this.tenant(tenantId));
    if (maxUsers < 0) return;
    const [users, pending] = await Promise.all([
      tx.membership.count({ where: { status: 'ACTIVE' } }),
      tx.invitation.count({ where: { acceptedAt: null, expiresAt: { gt: new Date() } } }),
    ]);
    if (users + pending >= maxUsers) {
      throw new PlanLimitException(`Tu plan permite ${maxUsers} usuarios (incluye familias y profesores con acceso). Mejora el plan para invitar a más.`);
    }
  }

  async assertCanAddMember(tx: Tx, tenantId: string) {
    const { maxMembers } = effectiveLimits(await this.tenant(tenantId));
    if (maxMembers < 0) return;
    const count = await tx.member.count({ where: { status: { not: 'LEFT' } } });
    if (count >= maxMembers) {
      throw new PlanLimitException(`Tu plan permite ${maxMembers} socios activos.`);
    }
  }

  /**
   * Los alumnos como ficha no consumen cupo. Quien accede a la plataforma (familia, profesor,
   * músico…) es un usuario y se limita con `assertCanAddUser`.
   */
  async assertCanAddStudent(_tx: Tx, _tenantId: string) {
    return;
  }

  /** Reserva almacenamiento de forma atómica; falla si supera la cuota. */
  async reserveStorage(tenantId: string, bytes: number) {
    const tenant = await this.tenant(tenantId);
    const { storageMb } = effectiveLimits(tenant);
    const limit = BigInt(storageMb) * 1024n * 1024n;
    const { count } = await this.db.system.tenant.updateMany({
      where: { id: tenantId, storageUsedBytes: { lte: limit - BigInt(bytes) } },
      data: { storageUsedBytes: { increment: BigInt(bytes) } },
    });
    if (count === 0) throw new PlanLimitException(`Has alcanzado el almacenamiento de tu plan (${storageMb} MB).`);
  }

  async releaseStorage(tenantId: string, bytes: number) {
    await this.db.system.$executeRaw`
      UPDATE tenants SET "storageUsedBytes" = GREATEST(0, "storageUsedBytes" - ${BigInt(bytes)}) WHERE id = ${tenantId}::uuid`;
  }
}
