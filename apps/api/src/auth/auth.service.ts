import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { decrypt, encrypt, sha256 } from '../common/crypto';
import { Db } from '../db/db.service';
import { Audit } from '../audit/audit.service';
import { SessionService } from './session.service';
import { TokensService } from './tokens.service';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
// Hash ficticio para igualar tiempos cuando el email no existe.
let dummyHash: Promise<string> | undefined;

authenticator.options = { window: 1 };

export const hashPassword = (p: string) => argon2.hash(p, { type: argon2.argon2id });

@Injectable()
export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly tokens: TokensService,
    private readonly sessions: SessionService,
    private readonly audit: Audit,
  ) {}

  async register(email: string, password: string, name: string) {
    const normalized = email.trim().toLowerCase();
    const exists = await this.db.system.user.findUnique({ where: { email: normalized } });
    if (exists) throw new ConflictException({ message: 'Ese email ya está registrado', code: 'EMAIL_TAKEN' });
    const user = await this.db.system.user.create({
      data: { email: normalized, name: name.trim(), passwordHash: await hashPassword(password) },
    });
    return { id: user.id, email: user.email, name: user.name };
  }

  async login(email: string, password: string, mfaCode?: string) {
    const user = await this.db.system.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user) {
      dummyHash ??= hashPassword('solfeggio-timing-equalizer');
      await argon2.verify(await dummyHash, password).catch(() => false);
      throw new UnauthorizedException({ message: 'Credenciales incorrectas', code: 'INVALID_CREDENTIALS' });
    }
    if (user.blockedAt) throw new ForbiddenException({ message: 'Cuenta bloqueada por el equipo de moderación', code: 'ACCOUNT_BLOCKED' });
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException({ message: 'Cuenta bloqueada temporalmente', code: 'ACCOUNT_LOCKED' });
    }
    const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!ok) {
      const failed = user.failedLogins + 1;
      await this.db.system.user.update({
        where: { id: user.id },
        data: {
          failedLogins: failed >= MAX_FAILED ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        },
      });
      throw new UnauthorizedException({ message: 'Credenciales incorrectas', code: 'INVALID_CREDENTIALS' });
    }
    if (user.mfaEnabled) {
      if (!mfaCode) throw new UnauthorizedException({ message: 'Introduce el código de verificación', code: 'MFA_REQUIRED' });
      const secret = decrypt(user.mfaSecretEnc);
      if (!secret || !authenticator.check(mfaCode, secret)) {
        throw new UnauthorizedException({ message: 'Código de verificación incorrecto', code: 'MFA_INVALID' });
      }
    }
    await this.db.system.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const session = await this.sessions.build(user.id);
    // Con una sola banda se entra directamente en ella.
    const tenantId = session.memberships.length === 1 ? session.memberships[0].tenantId : null;
    return this.issue(user.id, tenantId);
  }

  async issue(userId: string, tenantId: string | null, familyId?: string) {
    const [accessToken, refresh, session] = await Promise.all([
      this.tokens.accessToken(userId, tenantId),
      this.tokens.issueRefresh(userId, tenantId, familyId),
      this.sessions.build(userId, tenantId),
    ]);
    return { accessToken, refresh, session };
  }

  async refresh(token: string) {
    const rotated = await this.tokens.rotate(token);
    const owner = await this.db.system.user.findUnique({ where: { id: rotated.userId }, select: { blockedAt: true } });
    if (owner?.blockedAt) {
      await this.tokens.revokeAllForUser(rotated.userId);
      throw new UnauthorizedException({ message: 'Cuenta bloqueada', code: 'ACCOUNT_BLOCKED' });
    }
    const accessToken = await this.tokens.accessToken(rotated.userId, rotated.tenantId).catch(() =>
      this.tokens.accessToken(rotated.userId, null),
    );
    return { accessToken, refresh: rotated.refresh };
  }

  async switchTenant(userId: string, tenantId: string) {
    return this.issue(userId, tenantId);
  }

  async mfaSetup(userId: string) {
    const user = await this.db.system.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.mfaEnabled) throw new BadRequestException({ message: 'MFA ya está activado', code: 'MFA_ALREADY_ENABLED' });
    const secret = authenticator.generateSecret();
    await this.db.system.user.update({ where: { id: userId }, data: { mfaSecretEnc: encrypt(secret) } });
    const otpauthUrl = authenticator.keyuri(user.email, 'Solfeamos', secret);
    return { otpauthUrl, qrDataUrl: await QRCode.toDataURL(otpauthUrl) };
  }

  async mfaEnable(userId: string, code: string) {
    const user = await this.db.system.user.findUniqueOrThrow({ where: { id: userId } });
    const secret = decrypt(user.mfaSecretEnc);
    if (!secret || !authenticator.check(code, secret)) {
      throw new BadRequestException({ message: 'Código incorrecto', code: 'MFA_INVALID' });
    }
    await this.db.system.user.update({ where: { id: userId }, data: { mfaEnabled: true } });
    await this.tokens.revokeAllForUser(userId);
  }

  async mfaDisable(userId: string, code: string) {
    const user = await this.db.system.user.findUniqueOrThrow({ where: { id: userId } });
    const secret = decrypt(user.mfaSecretEnc);
    if (!user.mfaEnabled || !secret || !authenticator.check(code, secret)) {
      throw new BadRequestException({ message: 'Código incorrecto', code: 'MFA_INVALID' });
    }
    await this.db.system.user.update({ where: { id: userId }, data: { mfaEnabled: false, mfaSecretEnc: null } });
  }

  /** Acepta una invitación: crea el usuario si no existe y la membresía con el rol invitado. */
  async acceptInvitation(token: string, currentUserId: string | null, name?: string, password?: string) {
    const inv = await this.db.system.invitation.findUnique({ where: { tokenHash: sha256(token) } });
    if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) {
      throw new BadRequestException({ message: 'Invitación no válida o caducada', code: 'INVITATION_INVALID' });
    }
    let user = await this.db.system.user.findUnique({ where: { email: inv.email } });
    if (user && currentUserId && user.id !== currentUserId) {
      throw new BadRequestException({ message: 'La invitación es para otra cuenta', code: 'INVITATION_EMAIL_MISMATCH' });
    }
    if (user && !currentUserId) {
      throw new UnauthorizedException({ message: 'Inicia sesión para aceptar la invitación', code: 'LOGIN_REQUIRED' });
    }
    if (!user) {
      if (!name || !password) throw new BadRequestException({ message: 'Nombre y contraseña requeridos', code: 'VALIDATION_ERROR' });
      user = await this.db.system.user.create({
        data: { email: inv.email, name, passwordHash: await hashPassword(password), emailVerifiedAt: new Date() },
      });
    }
    const userId = user.id;
    await this.db.tenant(inv.tenantId, async (tx) => {
      const membership = await tx.membership.upsert({
        where: { tenantId_userId: { tenantId: inv.tenantId, userId } },
        create: { tenantId: inv.tenantId, userId, roleId: inv.roleId, memberId: inv.memberId, guardianId: inv.guardianId },
        // Invitación de tutor a un usuario que ya está en la banda: se vincula sin rebajar su rol.
        update: inv.guardianId ? { guardianId: inv.guardianId, status: 'ACTIVE' } : { roleId: inv.roleId, status: 'ACTIVE' },
      });
      await tx.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
      await this.audit.log(tx, { tenantId: inv.tenantId, userId }, 'invitation.accepted', 'membership', membership.id);
    });
    return this.issue(userId, inv.tenantId);
  }
}
