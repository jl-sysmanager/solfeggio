import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  APP_URL: z.string().url().default('http://localhost:5173'),
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
  MAIL_FROM: z.string().default('Solfeggio <no-reply@solfeggio.local>'),

  STRIPE_SECRET_KEY: z.string().optional().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(''),
  STRIPE_TAX_ENABLED: bool.default(true),
  TRIAL_DAYS: z.coerce.number().default(14),
  GRACE_PERIOD_DAYS: z.coerce.number().default(7),

  METRICS_TOKEN: z.string().optional(),
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
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`Configuración inválida: ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** Sólo para tests. */
export function resetEnvCache() {
  cached = undefined;
}
