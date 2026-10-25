import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Db } from '../db/db.service';
import { Audit } from '../audit/audit.service';
import { SYSTEM_ROLES } from '../iam/permissions';
import { AuthService } from '../auth/auth.service';
import type { RequestContext } from '../auth/context';
import { StripeClient } from '../billing/stripe.provider';
import { Storage } from '../storage/storage.service';
import { DEFAULT_INSTRUMENTS } from './instrument-catalog';
import { buildSetupGuide } from './setup-guide';

const RESERVED_SLUGS = new Set(['admin', 'api', 'app', 'www', 'solfeggio', 'solfeamos', 'market', 'billing', 'help', 'status']);

export const DEFAULT_SECTIONS = ['Flautas', 'Oboes', 'Clarinetes', 'Saxofones', 'Fagotes', 'Trompas', 'Trompetas', 'Trombones', 'Bombardinos', 'Tubas', 'Percusión'];
export { DEFAULT_INSTRUMENTS };
const DEFAULT_CATEGORIES: { name: string; kind: 'INCOME' | 'EXPENSE' }[] = [
  { name: 'Cuotas de socios', kind: 'INCOME' },
  { name: 'Actuaciones', kind: 'INCOME' },
  { name: 'Subvenciones', kind: 'INCOME' },
  { name: 'Partituras', kind: 'EXPENSE' },
  { name: 'Instrumentos y reparaciones', kind: 'EXPENSE' },
  { name: 'Uniformes', kind: 'EXPENSE' },
  { name: 'Desplazamientos', kind: 'EXPENSE' },
];

@Injectable()
export class OnboardingService {
  private readonly log = new Logger(OnboardingService.name);

  constructor(
    private readonly db: Db,
    private readonly audit: Audit,
    private readonly auth: AuthService,
    private readonly stripe: StripeClient,
    private readonly storage: Storage,
  ) {}

  async createBand(userId: string, input: { bandName: string; slug: string; country?: string; timezone?: string }) {
    const owner = await this.db.system.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true } });
    if (!owner?.emailVerifiedAt) {
      throw new ForbiddenException({ message: 'Confirma tu email antes de crear la banda', code: 'EMAIL_NOT_VERIFIED' });
    }
    if (RESERVED_SLUGS.has(input.slug)) throw new ConflictException({ message: 'Ese identificador no está disponible', code: 'SLUG_TAKEN' });
    const taken = await this.db.system.tenant.findUnique({ where: { slug: input.slug } });
    if (taken) throw new ConflictException({ message: 'Ese identificador ya está en uso', code: 'SLUG_TAKEN' });

    const free = await this.db.system.plan.findUniqueOrThrow({ where: { code: 'FREE' } });
    // El tenant se crea con el cliente de sistema; todo lo demás bajo RLS del nuevo tenant.
    const tenant = await this.db.system.tenant.create({
      data: {
        name: input.bandName,
        slug: input.slug,
        country: input.country ?? 'ES',
        timezone: input.timezone ?? 'Europe/Madrid',
        planId: free.id,
        status: 'ACTIVE',
        onboardedAt: new Date(),
        subscription: { create: {} },
      },
    });

    const user = await this.db.system.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true } });
    const nameParts = user.name.trim().split(/\s+/);
    const firstName = nameParts[0] || 'Propietario';
    const lastName = nameParts.slice(1).join(' ') || '-';

    const catalog = await this.roleCatalog(tenant.id);
    await this.db.tenant(tenant.id, async (tx) => {
      await tx.role.createMany({
        data: catalog.map((r) => ({ tenantId: tenant.id, key: r.key, name: r.name, permissions: r.permissions, isSystem: r.isSystem })),
      });
      const owner = await tx.role.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: 'owner' } } });
      // El propietario es socio nº 1 y usuario: así tiene ficha, foto, convocatorias y autogestión de perfil.
      const member = await tx.member.create({
        data: {
          tenantId: tenant.id,
          memberNumber: 1,
          firstName,
          lastName,
          email: user.email,
          status: 'ACTIVE',
          consentDataAt: new Date(),
        },
      });
      await tx.membership.create({ data: { tenantId: tenant.id, userId, roleId: owner.id, memberId: member.id } });
      await tx.section.createMany({ data: DEFAULT_SECTIONS.map((name, position) => ({ tenantId: tenant.id, name, position })) });
      await tx.instrumentCatalogItem.createMany({
        data: DEFAULT_INSTRUMENTS.map((name, position) => ({ tenantId: tenant.id, name, position })),
      });
      await tx.financeCategory.createMany({ data: DEFAULT_CATEGORIES.map((c) => ({ tenantId: tenant.id, ...c })) });
      await this.audit.log(tx, { tenantId: tenant.id, userId }, 'tenant.created', 'tenant', tenant.id, { slug: tenant.slug, memberId: member.id });
    });

    return this.auth.issue(userId, tenant.id);
  }

  /** Guía del propietario. El avance sale de los datos de la banda. */
  async guide(ctx: RequestContext) {
    this.ownerOnly(ctx);
    return this.db.tenant(ctx.tenantId, async (tx) => {
      const [tenant, memberCount, userCount, invites, eventCount, membership, user] = await Promise.all([
        tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { legalName: true, taxId: true, logoKey: true, region: true } }),
        tx.member.count({ where: { tenantId: ctx.tenantId, status: { not: 'LEFT' } } }),
        tx.membership.count({ where: { tenantId: ctx.tenantId, status: 'ACTIVE' } }),
        tx.invitation.count({ where: { tenantId: ctx.tenantId, acceptedAt: null, expiresAt: { gt: new Date() } } }),
        tx.event.count({ where: { tenantId: ctx.tenantId } }),
        tx.membership.findUniqueOrThrow({ where: { id: ctx.membershipId }, select: { setupGuideDismissedAt: true } }),
        tx.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { mfaEnabled: true } }),
      ]);
      return buildSetupGuide({
        features: ctx.features,
        bandReady: !!(tenant.legalName || tenant.taxId || tenant.logoKey || tenant.region),
        memberCount,
        extraAccess: userCount > 1 || invites > 0,
        eventCount,
        mfaEnabled: user.mfaEnabled,
        dismissed: !!membership.setupGuideDismissedAt,
      });
    });
  }

  /** Copia el catálogo vivo de otra banda. La primera banda usa los roles de sistema. */
  private async roleCatalog(exceptTenantId: string) {
    const source = await this.db.system.tenant.findFirst({
      where: { deletedAt: null, id: { not: exceptTenantId } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!source) return SYSTEM_ROLES.map((r) => ({ ...r, isSystem: true }));
    const roles = await this.db.system.role.findMany({
      where: { tenantId: source.id },
      select: { key: true, name: true, permissions: true, isSystem: true },
    });
    return roles.length ? roles : SYSTEM_ROLES.map((r) => ({ ...r, isSystem: true }));
  }

  async setDismissed(ctx: RequestContext, dismissed: boolean) {
    this.ownerOnly(ctx);
    await this.db.tenant(ctx.tenantId, (tx) =>
      tx.membership.update({ where: { id: ctx.membershipId }, data: { setupGuideDismissedAt: dismissed ? new Date() : null } }),
    );
    return this.guide(ctx);
  }

  private ownerOnly(ctx: RequestContext) {
    if (ctx.roleKey !== 'owner') {
      throw new ForbiddenException({ message: 'La guía de puesta en marcha es del propietario', code: 'OWNER_ONLY' });
    }
  }

  /**
   * Baja de la banda: deja de ser accesible, libera el slug y cancela Stripe si hay suscripción.
   * Borra sus ficheros y las cuentas que no pertenecen a ninguna otra banda. Un administrador
   * de plataforma conserva la cuenta. Sólo el propietario (con contraseña) o el panel global.
   */
  async softDeleteTenant(tenantId: string, actorUserId: string, meta?: { via?: string }) {
    const tenant = await this.db.system.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      include: { subscription: true },
    });
    if (!tenant) throw new BadRequestException({ message: 'La banda no existe o ya está eliminada', code: 'TENANT_NOT_FOUND' });

    const subId = tenant.subscription?.stripeSubscriptionId;
    if (subId) {
      try {
        const stripe = await this.stripe.api();
        await stripe.subscriptions.cancel(subId);
      } catch (err) {
        this.log.warn(`No se pudo cancelar la suscripción Stripe de ${tenantId}: ${(err as Error).message}`);
      }
    }

    // Liberar el identificador para poder crear otra banda con el mismo slug.
    const freeSlug = `${tenant.slug.slice(0, 28)}-x-${tenant.id.replace(/-/g, '').slice(0, 8)}`.slice(0, 40);
    await this.db.system.tenant.update({
      where: { id: tenantId },
      data: { deletedAt: new Date(), status: 'CANCELLED', slug: freeSlug, logoKey: null, logoMime: null, storageUsedBytes: 0 },
    });
    const filesDeleted = await this.purgeFiles(tenantId, tenant.logoKey);
    const { deletedUsers, actorDeleted } = await this.purgeAccounts(tenantId, actorUserId);
    await this.db.tenant(tenantId, async (tx) => {
      await this.audit.log(tx, { tenantId, userId: actorDeleted ? '' : actorUserId }, 'tenant.deleted', 'tenant', tenantId, {
        previousSlug: tenant.slug,
        via: meta?.via ?? 'owner',
        deletedUsers,
        filesDeleted,
      });
    });
    return { actorDeleted, deletedUsers, filesDeleted };
  }

  /** Propietario elimina la banda activa tras confirmar con contraseña. Si su cuenta desaparece, no hay sesión nueva. */
  async deleteBandAsOwner(userId: string, tenantId: string, password: string) {
    await this.auth.verifyPassword(userId, password);
    const membership = await this.db.system.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      include: { role: true },
    });
    if (!membership) throw new BadRequestException({ message: 'No perteneces a esa banda', code: 'NOT_A_MEMBER' });
    if (membership.role.key !== 'owner') {
      throw new ForbiddenException({ message: 'Sólo el propietario puede eliminar la banda', code: 'OWNER_ONLY' });
    }
    const { actorDeleted } = await this.softDeleteTenant(tenantId, userId, { via: 'owner' });
    if (actorDeleted) return null;
    return this.auth.reissueWithoutTenant(userId);
  }

  /** Cuentas exclusivas de la banda. Quien sigue en otra banda, o es administrador de plataforma, se conserva. */
  private async purgeAccounts(tenantId: string, actorUserId: string) {
    const memberships = await this.db.system.membership.findMany({ where: { tenantId }, select: { userId: true } });
    const userIds = [...new Set(memberships.map((m) => m.userId))];
    const [users, elsewhere] = await Promise.all([
      this.db.system.user.findMany({ where: { id: { in: userIds } }, select: { id: true, isPlatformAdmin: true } }),
      this.db.system.membership.findMany({
        where: { userId: { in: userIds }, tenantId: { not: tenantId }, tenant: { deletedAt: null } },
        select: { userId: true },
      }),
    ]);
    const stays = new Set(elsewhere.map((m) => m.userId));
    const drop = users.filter((u) => !u.isPlatformAdmin && !stays.has(u.id)).map((u) => u.id);
    if (drop.length) {
      await this.db.system.musicianProfile.deleteMany({ where: { userId: { in: drop } } });
      await this.db.system.user.deleteMany({ where: { id: { in: drop } } });
    }
    await this.db.system.membership.deleteMany({ where: { tenantId } });
    await this.db.system.invitation.deleteMany({ where: { tenantId } });
    await this.db.system.refreshToken.updateMany({ where: { tenantId, revokedAt: null }, data: { revokedAt: new Date() } });
    return { deletedUsers: drop.length, actorDeleted: drop.includes(actorUserId) };
  }

  /** Objetos de la banda en el almacén, incluido el logotipo y las copias de seguridad. */
  private async purgeFiles(tenantId: string, logoKey: string | null) {
    const keys = new Set<string>();
    if (logoKey?.startsWith(`tenants/${tenantId}/`)) keys.add(logoKey);
    try {
      for (const object of await this.storage.list(`tenants/${tenantId}/`)) keys.add(object.key);
    } catch (err) {
      this.log.warn(`No se pudo listar el almacén de ${tenantId}: ${(err as Error).message}`);
    }
    const [assets, docs, listings, receipts, photos, backups] = await Promise.all([
      this.db.system.asset.findMany({ where: { tenantId }, select: { fileKey: true } }),
      this.db.system.document.findMany({ where: { tenantId }, select: { fileKey: true } }),
      this.db.system.listing.findMany({ where: { tenantId }, select: { imageKeys: true } }),
      this.db.system.transaction.findMany({ where: { tenantId, receiptKey: { not: null } }, select: { receiptKey: true } }),
      this.db.system.member.findMany({ where: { tenantId, photoKey: { not: null } }, select: { photoKey: true } }),
      this.db.system.tenantBackup.findMany({ where: { tenantId }, select: { fileKey: true } }),
    ]);
    for (const row of assets) keys.add(row.fileKey);
    for (const row of docs) keys.add(row.fileKey);
    for (const row of listings) row.imageKeys.forEach((key) => keys.add(key));
    for (const row of receipts) if (row.receiptKey) keys.add(row.receiptKey);
    for (const row of photos) if (row.photoKey) keys.add(row.photoKey);
    for (const row of backups) keys.add(row.fileKey);
    let removed = 0;
    for (const key of keys) {
      if (!key.startsWith(`tenants/${tenantId}/`) && !key.startsWith(`platform/backups/tenants/${tenantId}/`)) continue;
      await this.storage.remove(key);
      removed += 1;
    }
    await this.db.system.tenantBackup.deleteMany({ where: { tenantId } });
    return removed;
  }
}
