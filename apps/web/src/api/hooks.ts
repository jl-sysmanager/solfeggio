import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { get } from './client';
import { useToast } from '../components/Toasts';

type Q = Record<string, string | number | boolean | undefined | null>;

export function useApi<T>(path: string | null, query?: Q, opts?: { enabled?: boolean }) {
  return useQuery<T>({
    queryKey: [path, query ?? {}],
    queryFn: () => get<T>(path!, query),
    enabled: !!path && (opts?.enabled ?? true),
  });
}

/** Mutación con toast de éxito/error e invalidación de claves por prefijo de ruta. */
export function useApiMutation<TVars, TRes = unknown>(
  fn: (vars: TVars) => Promise<TRes>,
  opts: { success?: string; invalidate?: string[]; onSuccess?: (res: TRes, vars: TVars) => void } = {},
) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<TRes, Error, TVars>({
    mutationFn: fn,
    onSuccess: (res, vars) => {
      if (opts.success) toast.notify(opts.success);
      for (const prefix of opts.invalidate ?? []) {
        qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith(prefix) });
      }
      opts.onSuccess?.(res, vars);
    },
    onError: (e) => toast.error(e),
  });
}

export type { QueryKey };
