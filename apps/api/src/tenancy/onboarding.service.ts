import { ConflictException, Injectable } from '@nestjs/common';
import { Db } from '../db/db.service';
import { Audit } from '../audit/audit.service';
import { SYSTEM_ROLES } from '../iam/permissions';
import { AuthService } from '../auth/auth.service';

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

    await this.db.tenant(tenant.id, async (tx) => {
      await tx.role.createMany({
        data: SYSTEM_ROLES.map((r) => ({ tenantId: tenant.id, key: r.key, name: r.name, permissions: r.permissions, isSystem: true })),
      });
      const owner = await tx.role.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: 'owner' } } });
      await tx.membership.create({ data: { tenantId: tenant.id, userId, roleId: owner.id } });
      await tx.section.createMany({ data: DEFAULT_SECTIONS.map((name, position) => ({ tenantId: tenant.id, name, position })) });
      await tx.financeCategory.createMany({ data: DEFAULT_CATEGORIES.map((c) => ({ tenantId: tenant.id, ...c })) });
      await this.audit.log(tx, { tenantId: tenant.id, userId }, 'tenant.created', 'tenant', tenant.id, { slug: tenant.slug });
    });

    return this.auth.issue(userId, tenant.id);
  }
}
