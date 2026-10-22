import { Prisma, TxKind } from '@prisma/client';
import { z } from 'zod';
import { sha256 } from '../common/crypto';
import type { Tx } from '../db/db.service';

export const lineSchema = z.object({
  description: z.string().trim().min(1).max(300),
  quantity: z.number().positive().max(10_000).refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'Máximo dos decimales'),
  unitCents: z.number().int().min(-100_000_000).max(100_000_000),
});
export type Line = z.infer<typeof lineSchema>;

/** Redondeo simétrico (mitad lejos de cero): una rectificativa total anula exactamente la original. */
export const roundCents = (x: number) => Math.sign(x) * Math.round(Math.abs(x)) || 0;

export function totals(lines: Line[], taxRatePct: number) {
  const baseCents = lines.reduce((s, l) => s + roundCents(l.quantity * l.unitCents), 0);
  const taxCents = roundCents((baseCents * taxRatePct) / 100);
  return { baseCents, taxCents, totalCents: baseCents + taxCents };
}

/** Comparación de instrumentos sin tildes ni mayúsculas («Trompeta» = «trompéta»). */
export const norm = (s: string | null | undefined) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

export const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Evita inyección de fórmulas en hojas de cálculo.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Reintenta la operación completa si otra petición se adelantó con el mismo número correlativo. */
export async function retryUnique<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i < attempts - 1 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
      throw e;
    }
  }
}

export async function ensureCategory(tx: Tx, tenantId: string, name: string, kind: TxKind) {
  return (
    (await tx.financeCategory.findFirst({ where: { name, kind } })) ??
    (await tx.financeCategory.create({ data: { tenantId, name, kind } }))
  );
}

export interface InvoiceHashInput {
  issuerTaxId: string | null;
  series: string;
  number: number;
  issueDate: string;
  clientTaxId: string | null;
  clientName: string;
  taxRatePct: number;
  baseCents: number;
  taxCents: number;
  totalCents: number;
  prevHash: string | null;
}

/** Huella SHA-256 sobre un JSON canónico (claves en orden fijo). */
export function invoiceHash(i: InvoiceHashInput) {
  const canonical = JSON.stringify([
    ['issuerTaxId', i.issuerTaxId ?? null],
    ['series', i.series],
    ['number', i.number],
    ['issueDate', i.issueDate],
    ['clientTaxId', i.clientTaxId ?? null],
    ['clientName', i.clientName],
    ['taxRatePct', i.taxRatePct],
    ['baseCents', i.baseCents],
    ['taxCents', i.taxCents],
    ['totalCents', i.totalCents],
    ['prevHash', i.prevHash ?? null],
  ]);
  return sha256(canonical);
}

export interface ClientSnapshot {
  name: string;
  taxId: string | null;
  address: string | null;
  email: string | null;
  kind: string;
  issuer: { name: string; legalName: string | null; taxId: string | null };
}
