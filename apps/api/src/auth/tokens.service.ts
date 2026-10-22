import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { randomToken, sha256 } from '../common/crypto';
import { env } from '../config/env';
import { Db } from '../db/db.service';

@Injectable()
export class TokensService {
  constructor(
    private readonly db: Db,
    private readonly jwt: JwtService,
  ) {}

  async accessToken(userId: string, tenantId?: string | null): Promise<string> {
    let mid: string | undefined;
    if (tenantId) {
      const m = await this.db.system.membership.findFirst({ where: { userId, tenantId, status: 'ACTIVE' } });
      if (!m) throw new UnauthorizedException({ message: 'Sin acceso a esta banda', code: 'TENANT_ACCESS_REVOKED' });
      mid = m.id;
    }
    return this.jwt.signAsync(
      { sub: userId, ...(tenantId ? { tid: tenantId, mid } : {}) },
      { secret: env().JWT_ACCESS_SECRET, expiresIn: env().JWT_ACCESS_TTL },
    );
  }

  async issueRefresh(userId: string, tenantId: string | null, familyId: string = randomUUID()): Promise<string> {
    const token = randomToken(48);
    await this.db.system.refreshToken.create({
      data: {
        userId,
        tenantId,
        familyId,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + env().JWT_REFRESH_TTL_DAYS * 86_400_000),
      },
    });
    return token;
  }

  /**
   * Rota el refresh token. Si se presenta un token ya revocado (reutilización), se revoca
   * toda la familia: indica robo del token.
   */
  async rotate(token: string): Promise<{ userId: string; tenantId: string | null; refresh: string }> {
    const existing = await this.db.system.refreshToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!existing || existing.expiresAt < new Date()) {
      throw new UnauthorizedException({ message: 'Sesión caducada', code: 'REFRESH_INVALID' });
    }
    if (existing.revokedAt) {
      await this.revokeFamily(existing.familyId);
      throw new UnauthorizedException({ message: 'Sesión revocada', code: 'REFRESH_REUSED' });
    }
    const { count } = await this.db.system.refreshToken.updateMany({
      where: { id: existing.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) {
      await this.revokeFamily(existing.familyId);
      throw new UnauthorizedException({ message: 'Sesión revocada', code: 'REFRESH_REUSED' });
    }
    const refresh = await this.issueRefresh(existing.userId, existing.tenantId, existing.familyId);
    return { userId: existing.userId, tenantId: existing.tenantId, refresh };
  }

  /** Identifica al usuario de una cabecera Authorization opcional (rutas públicas). */
  async userIdFromHeader(header?: string): Promise<string | null> {
    const token = header?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return null;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token, { secret: env().JWT_ACCESS_SECRET });
      return payload.sub;
    } catch {
      return null;
    }
  }

  async revoke(token: string) {
    await this.db.system.refreshToken.updateMany({
      where: { tokenHash: sha256(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeFamily(familyId: string) {
    await this.db.system.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAllForUser(userId: string) {
    await this.db.system.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
