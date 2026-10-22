// Entorno de tests: base de datos dedicada `solfeggio_test`. Los valores son sólo de prueba.
const host = process.env.TEST_DB_HOST ?? 'localhost:5432';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= `postgresql://solfeggio_app:solfeggio_app@${host}/solfeggio_test`;
process.env.SYSTEM_DATABASE_URL ??= `postgresql://solfeggio:solfeggio@${host}/solfeggio_test`;
process.env.DATABASE_MIGRATION_URL ??= process.env.SYSTEM_DATABASE_URL;
process.env.REDIS_URL ??= 'redis://localhost:6379/15';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-0000000000000000000000';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-000000000000000000000';
process.env.DATA_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
process.env.LOG_HASH_SALT ??= 'test-salt';
process.env.LOG_LEVEL ??= 'silent';
process.env.S3_BUCKET ??= 'solfeggio-test';
process.env.RATE_LIMIT_AUTH_MAX ??= '1000';
process.env.RATE_LIMIT_MAX ??= '10000';
