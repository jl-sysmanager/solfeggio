import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Db } from '../db/db.service';
import { Audit } from '../audit/audit.service';
import { SYSTEM_ROLES } from '../iam/permissions';
import { AuthService } from '../auth/auth.service';
import type { RequestContext } from '../auth/context';
import { buildSetupGuide } from './setup-guide';

const RESERVED_SLUGS = new Set(['admin', 'api', 'app', 'www', 'solfeggio', 'solfeamos', 'market', 'billing', 'help', 'status']);

export const DEFAULT_SECTIONS = ['Flautas', 'Oboes', 'Clarinetes', 'Saxofones', 'Fagotes', 'Trompas', 'Trompetas', 'Trombones', 'Bombardinos', 'Tubas', 'Percusión'];
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
  constructor(
    private readonly db: Db,
    private readonly audit: Audit,
    private readonly auth: AuthService,
  ) {}

  async createBand(userId: string, input: { bandName: string; slug: string; country?: string; timezone?: string }) {
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

    await this.db.tenant(tenant.id, async (tx) => {
      await tx.role.createMany({
        data: SYSTEM_ROLES.map((r) => ({ tenantId: tenant.id, key: r.key, name: r.name, permissions: r.permissions, isSystem: true })),
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
}
