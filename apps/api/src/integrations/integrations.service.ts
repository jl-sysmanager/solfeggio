import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { decrypt, encrypt, pseudonymize } from '../common/crypto';
import { Db } from '../db/db.service';
import { CATEGORIES, category, CategoryDef, CategoryId, FieldDef, ProviderDef, ResolvedIntegration } from './registry';

const CACHE_TTL_MS = 30_000;
/** Los secretos más cortos no muestran pista: revelar 4 caracteres de 8 es demasiado. */
const HINT_MIN_LENGTH = 12;

export interface SaveIntegrationInput {
  provider: string;
  enabled: boolean;
  config?: Record<string, unknown>;
  /** string → nuevo valor · '' o ausente → se conserva · null → se borra. */
  secrets?: Record<string, string | null | undefined>;
}

export interface Actor {
  userId: string;
  ip?: string;
}

const aad = (categoryId: string) => `integration:${categoryId}`;

function fieldIssue(field: FieldDef, value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  switch (field.type) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'Debe ser un número';
      if (field.min !== undefined && value < field.min) return `Mínimo ${field.min}`;
      if (field.max !== undefined && value > field.max) return `Máximo ${field.max}`;
      return null;
    }
    case 'boolean':
      return typeof value === 'boolean' ? null : 'Debe ser sí o no';
    case 'select':
      return field.options?.some((o) => o.value === value) ? null : 'Opción no válida';
    default: {
      if (typeof value !== 'string') return 'Debe ser texto';
      if (value.length > 500) return 'Demasiado largo';
      if (/[\r\n]/.test(value)) return 'No puede contener saltos de línea';
      if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Email no válido';
      if (field.type === 'url' && !/^https:\/\//.test(value)) return 'Debe ser una URL https://';
      if (field.pattern && !new RegExp(field.pattern).test(value)) return field.patternMessage ?? 'Formato no válido';
      return null;
    }
  }
}

/**
 * Configuración de integraciones de terceros. Prioridad: base de datos → variables de entorno →
 * deshabilitada. La API y el worker comparten la tabla; cada proceso mantiene una caché de 30 s y
 * el proceso que guarda la invalida al instante.
 */
@Injectable()
export class IntegrationsService {
  private cache = new Map<string, { at: number; value: ResolvedIntegration }>();

  constructor(private readonly db: Db) {}

  definition(id: string): CategoryDef {
    const def = category(id);
    if (!def) throw new NotFoundException({ message: 'Integración desconocida', code: 'NOT_FOUND' });
    return def;
  }

  private provider(def: CategoryDef, id: string): ProviderDef {
    const p = def.providers.find((x) => x.id === id);
    if (!p) throw new BadRequestException({ message: 'Proveedor no válido', code: 'VALIDATION_ERROR', details: [{ path: 'provider', message: 'Proveedor no válido' }] });
    return p;
  }

  invalidate(id?: string) {
    if (id) this.cache.delete(id);
    else this.cache.clear();
  }

  /** Configuración efectiva, con secretos en claro. Sólo para uso interno de los adaptadores. */
  async get(id: CategoryId): Promise<ResolvedIntegration> {
    const hit = this.cache.get(id);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
    const value = await this.resolve(id);
    this.cache.set(id, { at: Date.now(), value });
    return value;
  }

  private async resolve(id: CategoryId): Promise<ResolvedIntegration> {
    const def = this.definition(id);
    const row = await this.db.system.integrationSetting.findUnique({ where: { category: id } });
    if (row) {
      const secrets = row.secretsEnc ? (JSON.parse(decrypt(row.secretsEnc, aad(id)) ?? '{}') as Record<string, string>) : {};
      const provider = def.providers.find((p) => p.id === row.provider);
      const withDefaults = Object.fromEntries((provider?.fields ?? []).filter((f) => f.type !== 'secret' && f.default !== undefined).map((f) => [f.key, f.default]));
      return { source: 'database', provider: row.provider, enabled: row.enabled, config: { ...withDefaults, ...(row.config as Record<string, unknown>) }, secrets };
    }
    const fallback = def.envFallback();
    if (fallback) return { source: 'env', ...fallback };
    return { source: 'none', provider: null, enabled: false, config: {}, secrets: {} };
  }

  /** Vista para el panel: definiciones + estado actual sin secretos. */
  async list() {
    const rows = await this.db.system.integrationSetting.findMany();
    const users = await this.db.system.user.findMany({
      where: { id: { in: rows.map((r) => r.updatedById).filter((x): x is string => !!x) } },
      select: { id: true, name: true, email: true },
    });
    return Promise.all(
      CATEGORIES.map(async (def) => {
        const row = rows.find((r) => r.category === def.id);
        const current = await this.resolve(def.id);
        const provider = def.providers.find((p) => p.id === current.provider);
        const hints = (row?.secretHints ?? {}) as Record<string, string | null>;
        const secretFields = (provider?.fields ?? []).filter((f) => f.type === 'secret');
        return {
          id: def.id,
          label: def.label,
          description: def.description,
          disabledBehavior: def.disabledBehavior,
          providers: def.providers,
          current: {
            source: current.source,
            provider: current.provider,
            enabled: current.enabled,
            config: current.config,
            secrets: Object.fromEntries(
              secretFields.map((f) => {
                const value = current.secrets[f.key];
                const hint = row ? hints[f.key] : value && value.length >= HINT_MIN_LENGTH ? value.slice(-4) : null;
                return [f.key, { set: !!value, hint: hint ?? null }];
              }),
            ),
            updatedAt: row?.updatedAt ?? null,
            updatedBy: users.find((u) => u.id === row?.updatedById) ?? null,
          },
        };
      }),
    );
  }

  async save(id: CategoryId, input: SaveIntegrationInput, actor: Actor) {
    const def = this.definition(id);
    const provider = this.provider(def, input.provider);
    const issues: { path: string; message: string }[] = [];

    const row = await this.db.system.integrationSetting.findUnique({ where: { category: id } });
    const sameProvider = row?.provider === provider.id;

    // Config no sensible: sólo claves declaradas (se ignora cualquier otra). Igual que los secretos:
    // ausente → se conserva el valor guardado · null o '' → se borra.
    const previousConfig = sameProvider ? ((row?.config ?? {}) as Record<string, unknown>) : {};
    const config: Record<string, unknown> = {};
    for (const f of provider.fields.filter((x) => x.type !== 'secret')) {
      const raw = input.config === undefined || !(f.key in input.config) ? previousConfig[f.key] : input.config[f.key];
      const value = typeof raw === 'string' ? raw.trim() : raw;
      const issue = fieldIssue(f, value);
      if (issue) issues.push({ path: `config.${f.key}`, message: issue });
      else if (value !== undefined && value !== null && value !== '') config[f.key] = value;
    }

    // Secretos: se parte de los guardados (si el proveedor no cambia) y se aplican los cambios.
    const previous =
      sameProvider && row?.secretsEnc ? (JSON.parse(decrypt(row.secretsEnc, aad(id)) ?? '{}') as Record<string, string>) : {};
    const secrets: Record<string, string> = {};
    const changedSecrets: string[] = [];
    for (const f of provider.fields.filter((x) => x.type === 'secret')) {
      const incoming = input.secrets?.[f.key];
      if (incoming === null) {
        if (previous[f.key]) changedSecrets.push(f.key);
        continue;
      }
      if (typeof incoming === 'string' && incoming.trim() !== '') {
        const value = incoming.trim();
        const issue = fieldIssue({ ...f, type: 'text' }, value);
        if (issue) {
          issues.push({ path: `secrets.${f.key}`, message: issue });
          continue;
        }
        secrets[f.key] = value;
        if (value !== previous[f.key]) changedSecrets.push(f.key);
      } else if (previous[f.key]) {
        secrets[f.key] = previous[f.key];
      }
    }

    // Una integración habilitada debe estar completa; deshabilitada puede guardarse a medias.
    if (input.enabled) {
      for (const f of provider.fields.filter((x) => x.required)) {
        const present = f.type === 'secret' ? !!secrets[f.key] : config[f.key] !== undefined || f.default !== undefined;
        if (!present) issues.push({ path: `${f.type === 'secret' ? 'secrets' : 'config'}.${f.key}`, message: 'Obligatorio para habilitar' });
      }
    }
    if (issues.length) throw new BadRequestException({ message: 'Configuración no válida', code: 'VALIDATION_ERROR', details: issues });

    const hints = Object.fromEntries(Object.entries(secrets).map(([k, v]) => [k, v.length >= HINT_MIN_LENGTH ? v.slice(-4) : null]));
    const data = {
      provider: provider.id,
      enabled: input.enabled,
      config: config as Prisma.InputJsonValue,
      secretsEnc: Object.keys(secrets).length ? encrypt(JSON.stringify(secrets), aad(id)) : null,
      secretHints: hints as Prisma.InputJsonValue,
      updatedById: actor.userId,
    };
    await this.db.system.$transaction([
      this.db.system.integrationSetting.upsert({ where: { category: id }, create: { category: id, ...data }, update: data }),
      this.db.system.platformAuditLog.create({
        data: {
          actorId: actor.userId,
          action: 'integration.updated',
          entity: 'integration',
          entityId: id,
          // Nunca valores de secretos: sólo qué ha cambiado.
          metadata: {
            provider: provider.id,
            previousProvider: row?.provider ?? null,
            enabled: input.enabled,
            previousEnabled: row?.enabled ?? null,
            config,
            secretsChanged: changedSecrets,
          } as Prisma.InputJsonValue,
          ipHash: pseudonymize(actor.ip),
        },
      }),
    ]);
    this.invalidate(id);
    return (await this.list()).find((c) => c.id === id)!;
  }

  /** Vuelve a la configuración de variables de entorno (borra la fila). */
  async reset(id: CategoryId, actor: Actor) {
    this.definition(id);
    await this.db.system.$transaction([
      this.db.system.integrationSetting.deleteMany({ where: { category: id } }),
      this.db.system.platformAuditLog.create({
        data: { actorId: actor.userId, action: 'integration.reset', entity: 'integration', entityId: id, ipHash: pseudonymize(actor.ip) },
      }),
    ]);
    this.invalidate(id);
    return (await this.list()).find((c) => c.id === id)!;
  }

  async audit(actor: Actor, action: string, entityId: string, metadata: Record<string, unknown>) {
    await this.db.system.platformAuditLog.create({
      data: { actorId: actor.userId, action, entity: 'integration', entityId, metadata: metadata as Prisma.InputJsonValue, ipHash: pseudonymize(actor.ip) },
    });
  }
}
