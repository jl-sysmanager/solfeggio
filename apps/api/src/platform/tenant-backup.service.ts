import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { Db } from '../db/db.service';
import { Storage } from '../storage/storage.service';

/** Datos de plataforma que no forman parte de la banda y no deben sustituirse. */
const EXCLUDED_TABLES = new Set(['subscriptions', 'invoices', 'email_logs', 'tenant_snapshots', 'impersonation_sessions', 'tenant_backups']);
const CONFIG_ID = 'default';
const DEFAULT_RETENTION = 30;
const PROFILE_FIELDS = ['name', 'legalName', 'taxId', 'country', 'timezone', 'locale', 'logoKey', 'logoMime'] as const;

type Row = Record<string, unknown>;
interface Manifest {
  version: 1;
  tenantId: string;
  slug: string;
  profile: Row;
  tables: Record<string, Row[]>;
}

/** Copia y restauración de una banda. Restaurar sustituye sus datos y conserva plan, suscripción y cuentas. */
@Injectable()
export class TenantBackupService {
  constructor(
    private readonly db: Db,
    private readonly storage: Storage,
  ) {}

  async settings() {
    const row = await this.db.system.platformConfig.findUnique({ where: { id: CONFIG_ID } });
    return { retention: row?.backupRetention ?? DEFAULT_RETENTION };
  }

  /** Guarda cuántas copias conserva cada banda y borra ya las que sobran. */
  async setRetention(retention: number) {
    const row = await this.db.system.platformConfig.upsert({
      where: { id: CONFIG_ID },
      create: { id: CONFIG_ID, backupRetention: retention },
      update: { backupRetention: retention },
    });
    const tenants = await this.db.system.tenantBackup.findMany({ distinct: ['tenantId'], select: { tenantId: true } });
    for (const tenant of tenants) await this.prune(tenant.tenantId, retention);
    return { retention: row.backupRetention };
  }

  async list(tenantId: string) {
    const { retention } = await this.settings();
    return this.db.system.tenantBackup.findMany({
      where: { tenantId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: retention,
    });
  }

  async exportTenant(tenantId: string, createdBy?: string) {
    const tenant = await this.db.system.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant || tenant.deletedAt) throw new BadRequestException({ message: 'La banda no existe', code: 'TENANT_NOT_FOUND' });
    const tables = await this.tenantTables();
    const data: Record<string, Row[]> = {};
    for (const table of tables) {
      const columns = await this.exportColumns(table);
      if (!columns.length) continue;
      const rows = await this.db.system.$queryRawUnsafe<Row[]>(
        `SELECT ${columns.map((column) => `"${column}"`).join(', ')} FROM "${table}" WHERE tenant_id = $1::uuid`,
        tenantId,
      );
      data[table] = rows.map(encodeRow);
    }
    const manifest: Manifest = {
      version: 1,
      tenantId,
      slug: tenant.slug,
      profile: Object.fromEntries(PROFILE_FIELDS.map((field) => [field, tenant[field]])),
      tables: data,
    };
    const payload = Buffer.from(JSON.stringify(manifest));
    const checksum = createHash('sha256').update(payload).digest('hex');
    const fileKey = `platform/backups/tenants/${tenantId}/${checksum}.json`;
    await this.storage.putObject(fileKey, payload, 'application/json');
    const created = await this.db.system.tenantBackup.create({
      data: { tenantId, fileKey, checksum, bytes: payload.byteLength, createdBy },
    });
    await this.prune(tenantId, (await this.settings()).retention);
    return created;
  }

  async exportAll() {
    const tenants = await this.db.system.tenant.findMany({ where: { deletedAt: null }, select: { id: true } });
    for (const tenant of tenants) await this.exportTenant(tenant.id);
    return { exported: tenants.length };
  }

  /** Sustituye los datos de la banda original. No cambia el plan, la suscripción ni las contraseñas. */
  async restore(tenantId: string, backupId: string, confirm: string) {
    const backup = await this.db.system.tenantBackup.findFirst({ where: { id: backupId, tenantId } });
    if (!backup) throw new BadRequestException({ message: 'La copia no existe', code: 'BACKUP_NOT_FOUND' });
    const payload = await this.storage.getObject(backup.fileKey);
    const checksum = createHash('sha256').update(payload).digest('hex');
    if (checksum !== backup.checksum) throw new BadRequestException({ message: 'La copia ha sido modificada', code: 'BACKUP_TAMPERED' });
    const manifest = JSON.parse(payload.toString()) as Manifest;
    if (manifest.version !== 1 || manifest.tenantId !== tenantId) {
      throw new BadRequestException({ message: 'La copia no corresponde a esta banda', code: 'BACKUP_MISMATCH' });
    }
    const tenant = await this.db.system.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant || tenant.slug !== confirm || tenant.slug !== manifest.slug) {
      throw new BadRequestException({ message: 'Escribe el identificador de la banda para sustituirla', code: 'CONFIRMATION_REQUIRED' });
    }

    const tables = Object.keys(manifest.tables);
    const order = await this.order(tables);
    const userLinks = await this.userLinks(tables);
    const users = new Set((await this.db.system.user.findMany({ select: { id: true } })).map((user) => user.id));
    let skipped = 0;
    await this.db.system.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}))`;
      for (const table of [...order].reverse()) {
        await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE tenant_id = $1::uuid`, tenantId);
      }
      for (const table of order) {
        const links = userLinks.get(table) ?? [];
        const casts = await columnCasts(tx, table);
        for (const encoded of manifest.tables[table] ?? []) {
          const row = decodeRow(encoded);
          if (links.some((link) => row[link.column] && !users.has(String(row[link.column])) && !link.nullable)) {
            skipped += 1;
            continue;
          }
          for (const link of links) if (row[link.column] && !users.has(String(row[link.column]))) row[link.column] = null;
          await insertRow(tx, table, row, casts);
        }
      }
      await tx.tenant.update({ where: { id: tenantId }, data: manifest.profile as Prisma.TenantUpdateInput });
      await tx.tenantBackup.update({ where: { id: backup.id }, data: { restoredAt: new Date() } });
    }, { timeout: 120_000 });
    return { restored: true, skipped };
  }

  /** Borra las copias de la banda que superan el cupo, de la más antigua a la más reciente. */
  private async prune(tenantId: string, keep: number) {
    const extra = await this.db.system.tenantBackup.findMany({
      where: { tenantId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: keep,
      select: { id: true, fileKey: true },
    });
    for (const row of extra) await this.storage.remove(row.fileKey);
    if (extra.length) await this.db.system.tenantBackup.deleteMany({ where: { id: { in: extra.map((row) => row.id) } } });
  }

  /** Omite tsvector: Prisma no lo deserializa y el trigger de obras lo regenera al insertar. */
  private async exportColumns(table: string) {
    const columns = await this.db.system.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table} AND udt_name <> 'tsvector'
      ORDER BY ordinal_position`;
    return columns.map((column) => column.column_name).filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name));
  }

  private async tenantTables() {
    const rows = await this.db.system.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'tenant_id' ORDER BY table_name`;
    return rows.map((row) => row.table_name).filter((table) => /^[a-z0-9_]+$/.test(table) && !EXCLUDED_TABLES.has(table));
  }

  private async order(tables: string[]) {
    const present = new Set(tables);
    const edges = await this.db.system.$queryRaw<{ child: string; parent: string }[]>`
      SELECT tc.table_name AS child, ccu.table_name AS parent
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public' AND tc.table_name <> ccu.table_name`;
    const incoming = new Map(tables.map((table) => [table, 0]));
    const next = new Map<string, string[]>();
    for (const edge of edges) {
      if (!present.has(edge.child) || !present.has(edge.parent)) continue;
      incoming.set(edge.child, (incoming.get(edge.child) ?? 0) + 1);
      next.set(edge.parent, [...(next.get(edge.parent) ?? []), edge.child]);
    }
    const ready = tables.filter((table) => incoming.get(table) === 0);
    const sorted: string[] = [];
    while (ready.length) {
      const table = ready.shift()!;
      sorted.push(table);
      for (const child of next.get(table) ?? []) {
        incoming.set(child, (incoming.get(child) ?? 1) - 1);
        if (incoming.get(child) === 0) ready.push(child);
      }
    }
    if (sorted.length !== tables.length) throw new BadRequestException({ message: 'No se puede ordenar la copia', code: 'BACKUP_ORDER' });
    return sorted;
  }

  private async userLinks(tables: string[]) {
    const rows = await this.db.system.$queryRaw<{ table_name: string; column_name: string; is_nullable: string }[]>`
      SELECT kcu.table_name, kcu.column_name, cols.is_nullable
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      JOIN information_schema.columns cols
        ON cols.table_schema = kcu.table_schema AND cols.table_name = kcu.table_name AND cols.column_name = kcu.column_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public' AND ccu.table_name = 'users'`;
    const links = new Map<string, { column: string; nullable: boolean }[]>();
    for (const row of rows) {
      if (!tables.includes(row.table_name)) continue;
      links.set(row.table_name, [...(links.get(row.table_name) ?? []), { column: row.column_name, nullable: row.is_nullable === 'YES' }]);
    }
    return links;
  }
}

function encodeRow(row: Row): Row {
  return Object.fromEntries(Object.keys(row).sort().map((key) => [key, encodeValue(row[key])]));
}

function encodeValue(value: unknown): unknown {
  if (typeof value === 'bigint') return { __t: 'bigint', v: value.toString() };
  if (value instanceof Date) return { __t: 'date', v: value.toISOString() };
  if (Array.isArray(value)) return value.map(encodeValue);
  return value;
}

function decodeRow(row: Row): Row {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, decodeValue(value)]));
}

function decodeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeValue);
  if (value && typeof value === 'object' && '__t' in value) {
    const tagged = value as { __t: string; v: string };
    if (tagged.__t === 'bigint') return BigInt(tagged.v);
    if (tagged.__t === 'date') return new Date(tagged.v);
  }
  return value;
}

async function columnCasts(tx: Prisma.TransactionClient, table: string) {
  const columns = await tx.$queryRaw<{ column_name: string; data_type: string; udt_name: string }[]>`
    SELECT column_name, data_type, udt_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}`;
  return new Map(columns.map((column) => [column.column_name, sqlCast(column.data_type, column.udt_name)]));
}

function sqlCast(dataType: string, udtName: string) {
  if (dataType === 'uuid') return 'uuid';
  if (dataType === 'jsonb' || dataType === 'json') return dataType;
  if (dataType === 'date') return 'date';
  if (dataType === 'timestamp with time zone') return 'timestamptz';
  if (dataType === 'timestamp without time zone') return 'timestamp';
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(udtName) && dataType === 'ARRAY') return `"${udtName.replace(/^_/, '')}"[]`;
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(udtName) && dataType === 'USER-DEFINED') return `"${udtName}"`;
  return null;
}

async function insertRow(tx: Prisma.TransactionClient, table: string, row: Row, casts: Map<string, string | null>) {
  const keys = Object.keys(row);
  const columns = keys.map((key) => `"${key.replace(/"/g, '')}"`).join(', ');
  const values = keys.map((key, index) => {
    const cast = casts.get(key);
    if ((cast === 'json' || cast === 'jsonb') && row[key] !== null && typeof row[key] === 'object') row[key] = JSON.stringify(row[key]);
    return cast ? `$${index + 1}::${cast}` : `$${index + 1}`;
  }).join(', ');
  await tx.$executeRawUnsafe(`INSERT INTO "${table}" (${columns}) VALUES (${values})`, ...keys.map((key) => row[key]));
}
