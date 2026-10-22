import { ApiError, api, getAccessToken, setAccessToken, setSessionExpiredHandler } from '../api/client';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('cliente API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setAccessToken(null);
    setSessionExpiredHandler(null);
  });

  it('envía el bearer token y renueva una vez tras un 401', async () => {
    setAccessToken('old');
    const calls: { url: string; auth?: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
        calls.push({ url, auth });
        if (url.endsWith('/auth/refresh')) return json({ accessToken: 'new' });
        if (auth === 'Bearer old') return json({ statusCode: 401, message: 'expired' }, 401);
        return json({ ok: true });
      }),
    );
    const res = await api<{ ok: boolean }>('/members');
    expect(res).toEqual({ ok: true });
    expect(getAccessToken()).toBe('new');
    expect(calls.map((c) => c.url)).toEqual(['/api/v1/members', '/api/v1/auth/refresh', '/api/v1/members']);
    expect(calls[2].auth).toBe('Bearer new');
  });

  it('peticiones concurrentes comparten un único refresh', async () => {
    setAccessToken('old');
    let refreshes = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
        if (url.endsWith('/auth/refresh')) {
          refreshes++;
          return json({ accessToken: 'new' });
        }
        return auth === 'Bearer new' ? json({ ok: true }) : json({}, 401);
      }),
    );
    await Promise.all([api('/a'), api('/b'), api('/c')]);
    expect(refreshes).toBe(1);
  });

  it('si el refresh falla, notifica sesión caducada y lanza ApiError', async () => {
    setAccessToken('old');
    const expired = vi.fn();
    setSessionExpiredHandler(expired);
    vi.stubGlobal('fetch', vi.fn(async () => json({ statusCode: 401, message: 'no' }, 401)));
    await expect(api('/members')).rejects.toBeInstanceOf(ApiError);
    expect(expired).toHaveBeenCalledOnce();
  });

  it('no intenta refresh con MFA_REQUIRED y expone el código', async () => {
    const fetchMock = vi.fn(async () => json({ statusCode: 401, message: 'MFA', code: 'MFA_REQUIRED' }, 401));
    vi.stubGlobal('fetch', fetchMock);
    const err = (await api('/auth/login', { method: 'POST', body: {} }).catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('MFA_REQUIRED');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('propaga códigos de negocio como FEATURE_NOT_IN_PLAN', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ statusCode: 403, message: 'No incluido', code: 'FEATURE_NOT_IN_PLAN' }, 403)));
    const err = await api('/market/listings').catch((e) => e);
    expect(err).toMatchObject({ status: 403, code: 'FEATURE_NOT_IN_PLAN' });
  });
});
