# Despliegue

## 1. Desarrollo local

Requisitos: Node 22, pnpm 9 y Docker.

```bash
cp .env.example .env
```

```bash
docker compose up -d postgres redis s3 mailpit
```

```bash
pnpm install
```

Los scripts no cargan `.env` por sí mismos: exporta sus variables en la shell antes de migrar, sembrar o arrancar.

```bash
set -a && . ./.env && set +a
```

```bash
pnpm db:migrate
```

```bash
SEED_DEMO=true pnpm db:seed
```

```bash
pnpm dev
```

| Servicio | URL |
|---|---|
| Web (Vite, proxy de `/api` a `:3000`) | http://localhost:5173 |
| API | http://localhost:3000/api/v1 |
| Swagger (fuera de producción) | http://localhost:3000/api/docs |
| Mailpit (emails) | http://localhost:8025 |
| S3 local (SeaweedFS) | http://localhost:8333 (credenciales de [`infra/s3/s3.json`](../infra/s3/s3.json), sólo en desarrollo) |

- El almacenamiento local es **SeaweedFS** con API S3, porque las imágenes de MinIO ya no se pueden descargar de los registros públicos. Con `NODE_ENV=development`, la API crea el bucket `S3_BUCKET` al arrancar si no existe; en otros entornos el bucket lo aprovisiona la infraestructura.
- `pnpm db:migrate` aplica las migraciones con `DATABASE_MIGRATION_URL`, el rol propietario. La API usa `DATABASE_URL`, el rol `solfeggio_app`, que crea [`infra/postgres/01-app-role.sh`](../infra/postgres/01-app-role.sh) al inicializar el volumen, y `SYSTEM_DATABASE_URL` (propietario) para las tareas de sistema. Si el volumen ya existía antes de ese script, recréalo con `docker compose down -v`.
- El seed lee `PLATFORM_ADMIN_EMAIL`, `SEED_DEMO`, `SEED_PASSWORD` y `STRIPE_PRICE_*`. Con `SEED_DEMO=true` crea la banda `banda-demo` con los usuarios `propietario@`, `director@`, `tesorero@` y `musico@demo.solfeggio.local`. La contraseña por defecto, sólo para desarrollo, está documentada en [`apps/api/prisma/seed.ts`](../apps/api/prisma/seed.ts).

### Stack completo en contenedores

```bash
docker compose --profile app up -d --build
```

Levanta además `api` (aplica `prisma migrate deploy` al arrancar), `worker` y `web`. La web queda en http://localhost:8080 y su nginx reenvía `/api` al contenedor `api`; la API también escucha en http://localhost:3000. Para cargar los datos de demostración, ejecuta el seed desde el host apuntando a `localhost:5432`.

### Tests

```bash
pnpm --filter @solfeggio/api test
```

Necesitan Postgres y Redis del compose. Los tests e2e usan la base de datos `solfeggio_test`, creada por el mismo script de inicialización; el `globalSetup` de Jest le aplica las migraciones automáticamente y las suites se ejecutan en serie porque comparten la base de datos. Stripe, S3 y la cola se sustituyen por dobles en memoria.

```bash
pnpm --filter @solfeggio/web test
```

### Stripe en local

```bash
stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe
```

Copia el `whsec_…` que muestra el comando en `STRIPE_WEBHOOK_SECRET`, usa una clave `sk_test_…` y paga con la tarjeta de prueba `4242 4242 4242 4242`.

## 2. Producción con Docker Compose (un solo servidor)

Esta opción sirve para entornos de staging o instalaciones pequeñas.

```bash
docker compose --profile app up -d --build
```

- Sustituye **todas** las credenciales de desarrollo de `docker-compose.yml` por variables de un archivo `.env` fuera del repositorio o de un gestor de secretos. Genera cada clave con `openssl rand -base64 32`.
- Pon delante un proxy TLS (Caddy, Traefik o nginx con Let's Encrypt) que termine HTTPS y reenvíe `/` a `web:80` y `/api` a `api:3000`.
- No publiques los puertos de Postgres, Redis ni del S3 local. En producción, sustituye el servicio `s3` (SeaweedFS) por un S3 gestionado y crea el bucket con cifrado por defecto y versionado.
- Cambia `NODE_ENV` a `production` en `api` y `worker`: activa la cookie `Secure` y desactiva Swagger y la creación automática del bucket.
- Programa `infra/backup/pg-backup.sh` en cron (ver [operations.md](operations.md)).

## 3. Producción en un cloud gestionado (recomendado)

> **Railway:** el repositorio está preparado para desplegarse en Railway sin configuración adicional más que variables de entorno. Consulta la guía paso a paso en [railway.md](railway.md).

| Pieza | Opción gestionada (región de la UE) |
|---|---|
| Contenedores `api`, `worker`, `web` | ECS Fargate, Cloud Run, Fly.io, Render o Kubernetes |
| PostgreSQL 16 | RDS o Aurora, Cloud SQL, Neon o Crunchy. Con PITR activado |
| Redis 7 | ElastiCache o Memorystore, con TLS |
| S3 | S3, GCS en modo interoperable o Cloudflare R2. Bucket privado, con cifrado por defecto (SSE) y versionado. CORS que permita `PUT` y `GET` desde el dominio de la web con la cabecera `Content-Type` |
| Email | SES (SMTP), SendGrid, Mailgun, Resend o Postmark, configurado en el panel global |
| Secretos | Secrets Manager o Secret Manager, inyectados como variables de entorno |

### Rol de aplicación en Postgres gestionado

Ejecuta este SQL una vez, conectado con el usuario maestro (propietario):

```sql
CREATE ROLE solfeggio_app LOGIN PASSWORD '<desde el gestor de secretos>' NOSUPERUSER NOBYPASSRLS;
GRANT CONNECT ON DATABASE solfeggio TO solfeggio_app;
GRANT USAGE ON SCHEMA public TO solfeggio_app;
-- Las migraciones conceden los permisos sobre las tablas (0002_tenant_isolation).
-- Si se crean tablas nuevas, cada migración debe incluir sus GRANT.
```

Configura las tres URL de base de datos así:

- `DATABASE_URL` usa `solfeggio_app`. La utiliza la API en las peticiones de tenant y siempre aplica RLS.
- `SYSTEM_DATABASE_URL` usa el rol propietario. La utilizan los webhooks, el worker, el panel global y las búsquedas de autenticación.
- `DATABASE_MIGRATION_URL` usa el rol propietario y sólo se emplea en el paso de *release*.

Añade `?sslmode=require&connection_limit=10` a cada URL y dimensiona el pool según el número de réplicas.

### Integraciones (Stripe y correo)

Las credenciales de Stripe y del proveedor de correo se configuran en **Panel global → Integraciones** (`/admin`), no en variables de entorno. Proveedores de correo disponibles: SMTP (incluido Amazon SES), SendGrid, Mailgun (UE/EE. UU.), Resend y Postmark. Cada integración puede deshabilitarse:

- **Pagos deshabilitados:** la facturación responde 503 `BILLING_DISABLED`, la web oculta la contratación y los webhooks responden 503 para que Stripe los reintente al reactivarla. Las suscripciones existentes no se tocan.
- **Correo deshabilitado:** los envíos se descartan (con aviso en el log del worker) y las notificaciones dentro de la app siguen funcionando.

Los cambios se aplican en menos de 30 segundos en la API y el worker, sin reiniciar. «Probar conexión» valida la configuración guardada antes de habilitarla. Mientras no exista configuración en el panel, se usan como respaldo `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_TAX_ENABLED`, `SMTP_URL` y `MAIL_FROM`; «Restablecer a variables de entorno» vuelve a ese modo.

### Configuración de Stripe

1. **Productos y precios:** crea tres productos (Basic, Pro y Enterprise), cada uno con un precio mensual y otro anual en EUR, recurrentes y con `tax_behavior` exclusivo o inclusivo según la política comercial. Copia los `price_…` en `STRIPE_PRICE_BASIC_MONTHLY`, `STRIPE_PRICE_BASIC_YEARLY` y equivalentes. El seed los vuelca en `plans.stripePriceMonthly` y `plans.stripePriceYearly`, o puedes editarlos en el panel global.
2. **Stripe Tax:** activa Tax, registra la empresa en España y en la UE (OSS) y marca «Calcular impuestos con Stripe Tax» en el panel de integraciones.
3. **Cupones:** crea cupones y códigos promocionales en Stripe. Checkout los acepta gracias a `allow_promotion_codes`.
4. **Customer Portal:** activa la actualización del método de pago, la cancelación al final del periodo, el cambio de plan entre los precios anteriores y el historial de facturas. La URL de vuelta es `${APP_URL}/billing`; Checkout vuelve a `/billing?checkout=success` o `/billing?checkout=cancel`.
5. **Webhook:** crea el endpoint `https://<dominio>/api/v1/webhooks/stripe` con la versión de API `2025-02-24.acacia` (la que usa el SDK) y los eventos `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.trial_will_end`, `invoice.finalized`, `invoice.paid`, `invoice.payment_failed`, `invoice.voided` e `invoice.marked_uncollectible`, y copia el secreto `whsec_…` en el panel de integraciones. Los eventos que no se procesan se registran como `ignored`.
6. **Smart Retries:** en *Billing → Revenue recovery*, activa los reintentos y los emails de impago. El periodo de gracia de la aplicación (`GRACE_PERIOD_DAYS`) debe ser igual o mayor que la ventana de reintentos que quieras cubrir con servicio completo.

## 4. Pipeline de *release*

En [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml):

1. Al hacer push a `main` se construyen las imágenes, se publican en GHCR (`ghcr.io/<org>/solfeggio-api` y `solfeggio-web`) con las etiquetas `sha-<commit>` y `main`, y se despliegan en **staging**.
2. Al crear una etiqueta `v*`, se publica la versión, se despliega en staging y, tras la aprobación manual del *environment* `production`, en **producción**.
3. Cada despliegue:
   1. ejecuta `prisma migrate deploy` en un contenedor temporal con `DATABASE_MIGRATION_URL`;
   2. hace un *rolling update* de `api` y `worker`;
   3. sirve `web` como estático.

### Despliegue sin caída

- Las migraciones deben ser **compatibles hacia atrás** (patrón *expand/contract*):
  1. añadir columnas como opcionales;
  2. desplegar el código que escribe en las dos columnas;
  3. rellenar los datos existentes;
  4. hacer la columna obligatoria o borrar la antigua en un despliegue posterior.
- La API y el worker se cierran de forma ordenada al recibir `SIGTERM`: dejan de aceptar peticiones o trabajos y terminan los que están en curso. `GET /health/ready` indica al balanceador cuándo una instancia está lista.
- Usa `maxSurge=1` y `maxUnavailable=0`, y al menos 2 réplicas de `api`.

### Rollback

- **Código:** vuelve a desplegar la etiqueta de imagen anterior (`sha-<commit>`).
- **Base de datos:** Prisma no genera migraciones *down*. Gracias al patrón *expand/contract*, el código anterior funciona con el esquema nuevo. Si una migración corrompe datos, restaura con PITR al instante previo (ver [`infra/backup/RESTORE.md`](../infra/backup/RESTORE.md)).
- **Stripe:** los webhooks que lleguen durante el rollback quedan registrados en `stripe_events`. Si fallaron, Stripe los reintenta durante 3 días.
