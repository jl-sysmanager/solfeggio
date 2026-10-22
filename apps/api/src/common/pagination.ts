import { z } from 'zod';

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export type PageQuery = z.infer<typeof pageQuery>;

export interface Page<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function skipTake(q: PageQuery) {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}

export function page<T>(data: T[], total: number, q: PageQuery): Page<T> {
  return { data, total, page: q.page, pageSize: q.pageSize };
}
