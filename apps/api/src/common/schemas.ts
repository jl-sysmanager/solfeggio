import { z } from 'zod';

export const uuid = z.string().uuid();
export const idParam = z.string().uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD');
export const isoDateTime = z.string().datetime({ offset: true });
export const cents = z.number().int().min(0).max(100_000_000);
export const optionalText = (max = 2000) => z.string().trim().max(max).optional().nullable();
export const text = (max = 200) => z.string().trim().min(1).max(max);

export const toDate = (d: string) => new Date(`${d}T00:00:00.000Z`);
