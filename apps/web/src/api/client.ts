// Cliente HTTP del API v1. El access token vive sólo en memoria; el refresh token
// está en una cookie httpOnly que el navegador envía a /api/v1/auth/*.

export const API_BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let accessToken: string | null = null;
let refreshing: Promise<string | null> | null = null;
let onSessionExpired: (() => void) | null = null;
// «Ver como»: el token no tiene refresh; un 401 significa que la sesión terminó o caducó.
let refreshDisabled = false;
let onImpersonationLost: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function getAccessToken() {
  return accessToken;
}
export function setRefreshDisabled(disabled: boolean) {
  refreshDisabled = disabled;
}
export function setImpersonationLostHandler(fn: (() => void) | null) {
  onImpersonationLost = fn;
}
export function setSessionExpiredHandler(fn: (() => void) | null) {
  onSessionExpired = fn;
}

/** Pide un nuevo access token. Concurrencia: una sola petición en vuelo. */
export function refreshAccessToken(): Promise<string | null> {
  if (!refreshing) {
    refreshing = fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) return null;
        const body = (await res.json()) as { accessToken: string };
        accessToken = body.accessToken;
        return accessToken;
      })
      .catch(() => null)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

type Query = Record<string, string | number | boolean | undefined | null>;

export function withQuery(path: string, query?: Query) {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Query;
  /** No intentar refresh en 401 (p. ej. login). */
  noRefresh?: boolean;
  raw?: boolean;
  /** Cuerpo binario. No se serializa como JSON. */
  rawBody?: BodyInit;
  contentType?: string;
}

async function parseError(res: Response): Promise<ApiError> {
  let body: { message?: string | string[]; code?: string; details?: unknown } = {};
  try {
    body = await res.json();
  } catch {
    /* sin cuerpo JSON */
  }
  const message = Array.isArray(body.message) ? body.message.join('. ') : body.message || res.statusText;
  return new ApiError(res.status, message || 'Error inesperado', body.code, body.details);
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const doFetch = () => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    let body: BodyInit | undefined;
    if (opts.rawBody !== undefined) {
      headers['Content-Type'] = opts.contentType || 'application/octet-stream';
      body = opts.rawBody;
    } else if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return fetch(`${API_BASE}${withQuery(path, opts.query)}`, {
      method: opts.method ?? (body !== undefined ? 'POST' : 'GET'),
      headers,
      body,
      credentials: 'include',
    });
  };

  let res = await doFetch();
  if (res.status === 401 && !opts.noRefresh) {
    const err = await parseError(res.clone());
    if (refreshDisabled) {
      onImpersonationLost?.();
    } else if (err.code !== 'MFA_REQUIRED') {
      const token = await refreshAccessToken();
      if (token) {
        res = await doFetch();
      } else {
        onSessionExpired?.();
      }
    }
  }
  if (!res.ok) throw await parseError(res);
  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  return (ct.includes('application/json') ? res.json() : res.text()) as Promise<T>;
}

export const get = <T>(path: string, query?: Query) => api<T>(path, { query });
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });
export const del = <T>(path: string, body?: unknown) => api<T>(path, { method: 'DELETE', body });

/** Sube un fichero a una URL prefirmada (S3/MinIO). El Content-Type debe coincidir con el firmado. */
export async function uploadToPresigned(url: string, file: File, mimeType?: string) {
  const res = await fetch(url, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': mimeType || file.type || 'application/octet-stream' },
  });
  if (!res.ok) throw new ApiError(res.status, 'No se pudo subir el fichero');
}

/** Descarga autenticada (CSV, etc.) como Blob. */
export async function downloadFile(path: string, filename: string) {
  const res = await api<Response>(path, { raw: true });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
