import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === 'true' || v === '1');

const isLoopbackUrl = (u: string) => /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:|\/|$)/i.test(u);

/** Origen público de la SPA (enlaces de correo, Stripe, CORS). Nunca localhost en producción. */
function resolvePublicAppUrl(raw: NodeJS.ProcessEnv): string {
  const candidates = [raw.APP_URL, raw.PUBLIC_APP_URL, raw.RAILWAY_PUBLIC_DOMAIN ? `https://${raw.RAILWAY_PUBLIC_DOMAIN}` : undefined]
    .map((v) => v?.trim())
    .filter((v): v is string => !!v);
  const production = (raw.NODE_ENV ?? 'development') === 'production';
  const picked = candidates.find((u) => {
    try {
      // RAILWAY_PUBLIC_DOMAIN llega sin esquema; ya lo prefijamos arriba.
      new URL(u.includes('://') ? u : `https://${u}`);
      return !production || !isLoopbackUrl(u);
    } catch {
      return false;
    }
  });
  if (picked) return picked.includes('://') ? picked.replace(/\/$/, '') : `https://${picked.replace(/\/$/, '')}`;
  if (production) {
    throw new Error(
      'APP_URL debe ser la URL pública de producción (p. ej. https://tu-dominio.up.railway.app). ' +
        'En Railway: Variable de api/worker → APP_URL=https://${{web.RAILWAY_PUBLIC_DOMAIN}} (o tu dominio custom). ' +
        'No uses localhost: los correos de invitación y recuperación saldrían mal.',
    );
  }
  return 'http://localhost:5173';
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  /** Dirección de escucha. `::` en redes privadas sólo IPv6 (entornos antiguos de Railway). */
  HOST: z.string().default('0.0.0.0'),
  /** Proxies de confianza delante de la API (nginx = 1; Railway + nginx = 2) para obtener la IP real. */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),
  APP_URL: z.string().url(),
  API_URL: z.string().url().default('http://localhost:3000'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1),
  SYSTEM_DATABASE_URL: z.string().optional(),
  DATABASE_MIGRATION_URL: z.string().optional(),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().default(30),
  DATA_ENCRYPTION_KEY: z.string().refine((k) => Buffer.from(k, 'base64').length === 32, {
    message: 'DATA_ENCRYPTION_KEY debe ser 32 bytes en base64',
  }),
  LOG_HASH_SALT: z.string().min(8),
  LOG_LEVEL: z.string().default('info'),

  S3_ENDPOINT: z.string().optional(),
  S3_PUBLIC_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('eu-west-1'),
  S3_BUCKET: z.string().default('solfeggio'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool.default(false),
  MAX_UPLOAD_MB: z.coerce.number().default(100),

  SMTP_URL: z.string().default('smtp://localhost:1025'),
  MAIL_FROM: z.string().default('Solfeamos <no-reply@solfeggio.local>'),

  STRIPE_SECRET_KEY: z.string().optional().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(''),
  STRIPE_TAX_ENABLED: bool.default(true),
  TRIAL_DAYS: z.coerce.number().default(14),
  GRACE_PERIOD_DAYS: z.coerce.number().default(7),

  METRICS_TOKEN: z.string().optional(),
  /** Token de las copias de seguridad y otras tareas externas (`POST /ops/heartbeat/:name`). */
  OPS_HEARTBEAT_TOKEN: z.string().min(16).optional(),
  /** Token del webhook de rebotes de correo (`POST /webhooks/email/:provider`). */
  EMAIL_WEBHOOK_TOKEN: z.string().min(16).optional(),
  PLATFORM_ADMIN_EMAIL: z.string().email().optional(),
  DATA_ENCRYPTION_KEY_PREVIOUS: z.string().optional(),

  RATE_LIMIT_TTL_MS: z.coerce.number().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().default(120),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().default(10),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const withApp = { ...process.env, APP_URL: resolvePublicAppUrl(process.env) };
    const parsed = schema.safeParse(withApp);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`Configuración inválida: ${issues}`);
    }
    if (parsed.data.NODE_ENV === 'production' && isLoopbackUrl(parsed.data.APP_URL)) {
      throw new Error('APP_URL no puede ser localhost en producción (rompe los enlaces de los correos).');
    }
    cached = parsed.data;
    // En producción, si CORS_ORIGINS sigue el default local, alinear con APP_URL.
    if (cached.NODE_ENV === 'production' && isLoopbackUrl(cached.CORS_ORIGINS)) {
      cached = { ...cached, CORS_ORIGINS: cached.APP_URL };
    }
  }
  return cached;
}

/** URL absoluta de la SPA (correos, Stripe, redirecciones). */
export function appUrl(path = '/') {
  const base = env().APP_URL.replace(/\/$/, '');
  if (!path || path === '/') return base;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Sólo para tests. */
export function resetEnvCache() {
  cached = undefined;
}
