import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { decrypt, encrypt, randomToken, sha256 } from '../common/crypto';
import { appUrl } from '../config/env';
import { Db } from '../db/db.service';
import { Jobs } from '../jobs/jobs.service';
import { Audit } from '../audit/audit.service';
import { Storage } from '../storage/storage.service';
import { SessionService } from './session.service';
import { TokensService } from './tokens.service';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const RESET_TTL_MS = 60 * 60 * 1000;
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
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
    private readonly jobs: Jobs,
    private readonly storage: Storage,
  ) {}

  async register(email: string, password: string, name: string) {
    const normalized = email.trim().toLowerCase();
    const exists = await this.db.system.user.findUnique({ where: { email: normalized } });
    if (exists) throw new ConflictException({ message: 'Ese email ya está registrado', code: 'EMAIL_TAKEN' });
    const user = await this.db.system.user.create({
      data: { email: normalized, name: name.trim(), passwordHash: await hashPassword(password) },
    });
    await this.sendEmailVerification(user.id, user.email);
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

  /** Tras salir o borrar una banda: revoca refresh y elige la banda restante si sólo queda una. */
  async reissueWithoutTenant(userId: string, preferredTenantId?: string | null) {
    await this.tokens.revokeAllForUser(userId);
    const session = await this.sessions.build(userId);
    const next =
      preferredTenantId && session.memberships.some((m) => m.tenantId === preferredTenantId)
        ? preferredTenantId
        : session.memberships.length === 1
          ? session.memberships[0].tenantId
          : null;
    return this.issue(userId, next);
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

  /**
   * Envía un enlace de un solo uso. Si el email ya está confirmado no manda nada.
   * La creación de una banda exige `emailVerifiedAt`.
   */
  async sendEmailVerification(userId: string, email?: string) {
    const user = await this.db.system.user.findUnique({ where: { id: userId }, select: { id: true, email: true, emailVerifiedAt: true, blockedAt: true } });
    if (!user || user.blockedAt) return { verified: false, sent: false };
    if (user.emailVerifiedAt) return { verified: true, sent: false };
    await this.db.system.emailVerificationToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
    const token = randomToken(32);
    await this.db.system.emailVerificationToken.create({
      data: { userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + VERIFY_TTL_MS) },
    });
    await this.jobs.add('email.send', {
      to: email ?? user.email,
      subject: 'Confirma tu email de Solfeamos',
      text:
        `Para crear tu banda necesitamos comprobar que este email es tuyo.\n\n` +
        `Confírmalo aquí (el enlace caduca en 24 horas y sólo puede usarse una vez):\n${appUrl(`/verify-email/${token}`)}\n\n` +
        `Si no has creado una cuenta, ignora este mensaje.`,
    });
    return { verified: false, sent: true };
  }

  /** Marca el email como confirmado. El enlace no revela si la cuenta existe cuando es inválido. */
  async verifyEmail(token: string) {
    const row = await this.db.system.emailVerificationToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.usedAt || row.expiresAt < new Date()) {
      throw new BadRequestException({ message: 'El enlace no es válido o ha caducado', code: 'EMAIL_VERIFY_INVALID' });
    }
    const user = await this.db.system.user.findUnique({ where: { id: row.userId }, select: { blockedAt: true, emailVerifiedAt: true } });
    if (user?.blockedAt) throw new ForbiddenException({ message: 'Cuenta bloqueada', code: 'ACCOUNT_BLOCKED' });
    await this.db.system.$transaction(async (tx) => {
      const claimed = await tx.emailVerificationToken.updateMany({
        where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) throw new BadRequestException({ message: 'El enlace no es válido o ha caducado', code: 'EMAIL_VERIFY_INVALID' });
      if (!user?.emailVerifiedAt) await tx.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } });
    });
    return { verified: true };
  }

  /** Cambia la contraseña de la sesión actual y cierra el resto de sesiones. */
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.db.system.user.findUniqueOrThrow({ where: { id: userId } });
    const ok = await argon2.verify(user.passwordHash, currentPassword).catch(() => false);
    if (!ok) throw new BadRequestException({ message: 'La contraseña actual no es correcta', code: 'INVALID_CREDENTIALS' });
    await this.db.system.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(newPassword), failedLogins: 0, lockedUntil: null },
    });
    await this.invalidateResets(userId);
    await this.tokens.revokeAllForUser(userId);
  }

  /** Perfil editable: datos de cuenta y, si hay vínculo, ficha de socio de la banda activa. */
  async getProfile(userId: string, tenantId: string | null) {
    const user = await this.db.system.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, name: true, mfaEnabled: true, createdAt: true },
    });
    if (!tenantId) return { user, member: null };
    const membership = await this.db.system.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      select: { memberId: true },
    });
    if (!membership?.memberId) return { user, member: null };
    const member = await this.db.tenant(tenantId, (tx) =>
      tx.member.findUnique({
        where: { id: membership.memberId! },
        select: {
          id: true,
          memberNumber: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          address: true,
          instrument: true,
          secondaryInstrument: true,
          consentImages: true,
          photoKey: true,
          section: { select: { id: true, name: true } },
        },
      }),
    );
    if (!member) return { user, member: null };
    const { photoKey, ...rest } = member;
    return {
      user,
      member: {
        ...rest,
        hasPhoto: !!photoKey,
        photoUrl: photoKey ? await this.storage.viewUrl(photoKey) : null,
      },
    };
  }

  /**
   * Actualiza el perfil unificado: nombre de cuenta y, si hay ficha de socio en la banda activa,
   * los mismos datos personales (sin duplicar nombre/apellidos).
   */
  async updateProfile(
    userId: string,
    tenantId: string | null,
    data: {
      name?: string;
      firstName?: string;
      lastName?: string;
      phone?: string | null;
      address?: string | null;
      instrument?: string | null;
      secondaryInstrument?: string | null;
      consentImages?: boolean;
    },
  ) {
    const displayName =
      data.firstName !== undefined && data.lastName !== undefined
        ? `${data.firstName.trim()} ${data.lastName.trim()}`.trim()
        : data.name?.trim();
    if (displayName) {
      await this.db.system.user.update({ where: { id: userId }, data: { name: displayName } });
    }

    const memberFields =
      data.firstName !== undefined ||
      data.lastName !== undefined ||
      data.phone !== undefined ||
      data.address !== undefined ||
      data.instrument !== undefined ||
      data.secondaryInstrument !== undefined ||
      data.consentImages !== undefined;

    if (memberFields) {
      if (!tenantId) throw new BadRequestException({ message: 'Selecciona una banda', code: 'TENANT_REQUIRED' });
      await this.db.tenant(tenantId, async (tx) => {
        const membership = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId } } });
        if (!membership?.memberId) {
          throw new BadRequestException({ message: 'Tu cuenta no está vinculada a una ficha de socio', code: 'NO_MEMBER_LINK' });
        }
        const current = await tx.member.findUniqueOrThrow({ where: { id: membership.memberId } });
        if (current.anonymizedAt) throw new BadRequestException({ message: 'La ficha está anonimizada', code: 'ANONYMIZED' });
        const instrument = data.instrument !== undefined ? data.instrument : current.instrument;
        const secondary = data.secondaryInstrument !== undefined ? data.secondaryInstrument : current.secondaryInstrument;
        if (instrument && secondary && instrument === secondary) {
          throw new BadRequestException({ message: 'El instrumento secundario debe ser distinto del principal', code: 'SAME_INSTRUMENT' });
        }
        await tx.member.update({
          where: { id: membership.memberId },
          data: {
            ...(data.firstName !== undefined && { firstName: data.firstName.trim() }),
            ...(data.lastName !== undefined && { lastName: data.lastName.trim() }),
            ...(data.phone !== undefined && { phone: data.phone }),
            ...(data.address !== undefined && { address: data.address }),
            ...(data.instrument !== undefined && { instrument: data.instrument }),
            ...(data.secondaryInstrument !== undefined && { secondaryInstrument: data.secondaryInstrument }),
            ...(data.consentImages !== undefined && { consentImages: data.consentImages }),
          },
        });
        await this.audit.log(tx, { tenantId, userId }, 'member.self_updated', 'member', membership.memberId, data);
      });
    }

    return this.getProfile(userId, tenantId);
  }

  private async assertPassword(userId: string, password: string) {
    const user = await this.db.system.user.findUniqueOrThrow({ where: { id: userId } });
    const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!ok) throw new BadRequestException({ message: 'La contraseña no es correcta', code: 'INVALID_CREDENTIALS' });
    return user;
  }

  /** Comprueba la contraseña (p. ej. antes de borrar la banda). */
  async verifyPassword(userId: string, password: string) {
    await this.assertPassword(userId, password);
  }

  private async assertCanLeaveOwnership(tenantId: string, roleKey: string) {
    if (roleKey !== 'owner') return;
    const owners = await this.db.system.membership.count({
      where: { tenantId, status: 'ACTIVE', role: { key: 'owner' } },
    });
    if (owners <= 1) {
      throw new BadRequestException({
        message:
          'Eres el único propietario de esta banda. Transfiere la propiedad, o elimina la banda desde Configuración, antes de salir o de cerrar la cuenta.',
        code: 'LAST_OWNER',
      });
    }
  }

  /** Abandona una banda (borra la membresía). No elimina la ficha de socio. */
  async leaveTenant(userId: string, tenantId: string, password: string) {
    await this.assertPassword(userId, password);
    const membership = await this.db.system.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      include: { role: true, tenant: { select: { name: true } } },
    });
    if (!membership) throw new BadRequestException({ message: 'No perteneces a esa banda', code: 'NOT_A_MEMBER' });
    await this.assertCanLeaveOwnership(tenantId, membership.role.key);
    await this.db.tenant(tenantId, async (tx) => {
      await tx.membership.delete({ where: { id: membership.id } });
      await this.audit.log(tx, { tenantId, userId }, 'membership.self_left', 'membership', membership.id, {
        tenantName: membership.tenant.name,
      });
    });
    return this.reissueWithoutTenant(userId);
  }

  /**
   * Cierra la cuenta: sale de todas las bandas, revoca sesiones y anonimiza el usuario.
   * Falla si es el único propietario de alguna banda.
   */
  async closeAccount(userId: string, password: string) {
    await this.assertPassword(userId, password);
    const memberships = await this.db.system.membership.findMany({
      where: { userId },
      include: { role: true, tenant: { select: { id: true, name: true } } },
    });
    for (const m of memberships) {
      await this.assertCanLeaveOwnership(m.tenantId, m.role.key);
    }
    for (const m of memberships) {
      await this.db.tenant(m.tenantId, async (tx) => {
        await tx.membership.delete({ where: { id: m.id } });
        await this.audit.log(tx, { tenantId: m.tenantId, userId }, 'membership.self_left', 'membership', m.id, {
          reason: 'account_closed',
          tenantName: m.tenant.name,
        });
      });
    }
    await this.tokens.revokeAllForUser(userId);
    await this.invalidateResets(userId);
    await this.db.system.user.update({
      where: { id: userId },
      data: {
        email: `deleted-${userId}@closed.local`,
        name: 'Cuenta cerrada',
        passwordHash: await hashPassword(randomToken(32)),
        mfaEnabled: false,
        mfaSecretEnc: null,
        failedLogins: 0,
        lockedUntil: null,
      },
    });
  }

  /**
   * Pide un enlace de recuperación. La respuesta es siempre la misma: no indica si el email existe.
   * Una cuenta bloqueada por moderación no recibe enlace.
   */
  async requestPasswordReset(email: string) {
    const user = await this.db.system.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user || user.blockedAt) return;
    await this.invalidateResets(user.id);
    const token = randomToken(32);
    await this.db.system.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
    });
    await this.jobs.add('email.send', {
      to: user.email,
      subject: 'Recupera tu contraseña de Solfeamos',
      text:
        `Hemos recibido una solicitud para cambiar la contraseña de tu cuenta.\n\n` +
        `Elige una nueva aquí (el enlace caduca en 1 hora y sólo puede usarse una vez):\n${appUrl(`/reset-password/${token}`)}\n\n` +
        `Si no has sido tú, ignora este mensaje. Tu contraseña no cambia.`,
    });
  }

  /** Aplica una contraseña nueva a partir del enlace y cierra todas las sesiones. */
  async resetPassword(token: string, password: string) {
    const row = await this.db.system.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.usedAt || row.expiresAt < new Date()) {
      throw new BadRequestException({ message: 'El enlace no es válido o ha caducado', code: 'RESET_INVALID' });
    }
    const user = await this.db.system.user.findUnique({ where: { id: row.userId }, select: { blockedAt: true } });
    if (user?.blockedAt) throw new ForbiddenException({ message: 'Cuenta bloqueada', code: 'ACCOUNT_BLOCKED' });
    const hash = await hashPassword(password);
    await this.db.system.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) throw new BadRequestException({ message: 'El enlace no es válido o ha caducado', code: 'RESET_INVALID' });
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash: hash, failedLogins: 0, lockedUntil: null } });
      await tx.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    });
  }

  private invalidateResets(userId: string) {
    return this.db.system.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
  }
}
