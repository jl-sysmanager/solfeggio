# Despliegue en Railway

Guía para publicar Solfeamos en [Railway](https://railway.com) con el código del repositorio, sin tocar nada más que variables de entorno.

## 1. Arquitectura

```
Internet ──► web (nginx: SPA + proxy de /api) ──► api (NestJS) ──► Postgres
                                                   │              ► Redis
                                                   │              ► Bucket S3
                                                   └─ worker (misma imagen, SERVICE_ROLE=worker)
```

| Servicio | Origen | Público | Notas |
|---|---|---|---|
| `postgres` | Base de datos de Railway (PostgreSQL) | No | Usuario propietario `postgres` |
| `redis` | Base de datos de Railway (Redis) | No | Colas BullMQ |
| `bucket` | Storage Bucket de Railway (u otro S3, p. ej. Cloudflare R2) | No | Privado. El navegador sube y descarga con URLs prefirmadas |
| `api` | `apps/api/Dockerfile` | No | Aplica migraciones al arrancar (`RUN_MIGRATIONS=true`) |
| `worker` | `apps/api/Dockerfile` | No | Recordatorios, correo, tareas programadas |
| `web` | `apps/web/Dockerfile` | **Sí** | Sirve la web y reenvía `/api` al API por la red privada |

Sólo `web` tiene dominio. El navegador habla siempre con el mismo origen (`https://<dominio>/api/v1/...`), por lo que la cookie de refresco es de primera parte y no hace falta CORS entre dominios.

Lo que el repositorio ya trae preparado:

- **Un solo comando de arranque por servicio, guiado por variables.** La imagen del API arranca según `SERVICE_ROLE` (`api` por defecto o `worker`) y aplica el paso de release si `RUN_MIGRATIONS=true`. No hay que configurar comandos de inicio ni de *pre-deploy* en Railway.
- **Paso de release idempotente** (`apps/api/src/cli/release.ts`): crea el rol de aplicación sin privilegios (`solfeggio_app`, necesario para que RLS se aplique), ejecuta `prisma migrate deploy`, carga los planes y crea el administrador de plataforma. Se puede repetir sin riesgo, y Prisma usa un bloqueo para que varias réplicas no migren a la vez.
- **Puerto y red:** el API y nginx escuchan en `PORT` (Railway lo inyecta), y nginx resuelve el API en tiempo de ejecución, de modo que sobrevive a los redespliegues.
- **Sin archivo `railway.json`:** Railway ha anunciado el fin de la configuración como código (`railway.json` o `railway.toml`) para el 1 de diciembre de 2026, así que el repositorio no depende de él. Todo se configura con variables.

## 2. Crear el proyecto

1. En Railway: **New Project → Empty Project**.
2. Añade las bases de datos: **+ New → Database → PostgreSQL** y **+ New → Database → Redis**. Renombra los servicios a `postgres` y `redis` (las variables de referencia de abajo usan esos nombres).
3. Añade el almacenamiento: **+ New → Bucket** (o usa un S3 externo, ver el apartado 5).
4. Crea los tres servicios de código con **+ New → GitHub Repo → `jl-sysmanager/solfeggio`**: `api`, `worker` y `web`. **No cambies el directorio raíz**: los Dockerfiles se construyen con la raíz del repositorio como contexto.
5. Elige la rama de despliegue en cada servicio (**Settings → Source → Branch**, normalmente `main`).

## 3. Variables de entorno

Railway permite pegar bloques con **Variables → Raw Editor**. Las referencias `${{servicio.VARIABLE}}` se resuelven al desplegar. Antes de empezar, genera los secretos:

```bash
openssl rand -hex 24      # APP_DB_PASSWORD (sólo caracteres seguros para una URL)
openssl rand -base64 48   # JWT_ACCESS_SECRET y JWT_REFRESH_SECRET (distintos entre sí)
openssl rand -base64 32   # DATA_ENCRYPTION_KEY
openssl rand -hex 16      # LOG_HASH_SALT
```

> **`DATA_ENCRYPTION_KEY` cifra DNI, IBAN y semillas MFA.** Guárdala en un gestor de contraseñas: si se pierde, esos datos no se pueden recuperar. Para rotarla, mira [security-gdpr.md](security-gdpr.md).

Crea las variables comunes una sola vez en **Project Settings → Shared Variables** (`APP_DB_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `DATA_ENCRYPTION_KEY`, `LOG_HASH_SALT`) y compártelas con `api` y `worker`, o cópialas en ambos. Las referencias a ellas se escriben `${{shared.NOMBRE}}`.

### `api`

```dotenv
RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile
PORT=3000
NODE_ENV=production
SERVICE_ROLE=api
RUN_MIGRATIONS=true

APP_URL=https://${{web.RAILWAY_PUBLIC_DOMAIN}}
API_URL=${{APP_URL}}
CORS_ORIGINS=${{APP_URL}}
# Railway + nginx: dos proxies delante del API (para la IP real en límites de peticiones y auditoría)
TRUST_PROXY=2

# Rol propietario: migraciones y tareas de sistema (se construye con las variables PG* para usar siempre la red privada)
DATABASE_MIGRATION_URL=postgresql://${{postgres.PGUSER}}:${{postgres.PGPASSWORD}}@${{postgres.PGHOST}}:${{postgres.PGPORT}}/${{postgres.PGDATABASE}}
SYSTEM_DATABASE_URL=${{DATABASE_MIGRATION_URL}}
# Rol de aplicación (sin privilegios): el release lo crea con esta contraseña. El usuario debe llamarse solfeggio_app.
DATABASE_URL=postgresql://solfeggio_app:${{shared.APP_DB_PASSWORD}}@${{postgres.PGHOST}}:${{postgres.PGPORT}}/${{postgres.PGDATABASE}}
REDIS_URL=${{redis.REDIS_URL}}

JWT_ACCESS_SECRET=${{shared.JWT_ACCESS_SECRET}}
JWT_REFRESH_SECRET=${{shared.JWT_REFRESH_SECRET}}
DATA_ENCRYPTION_KEY=${{shared.DATA_ENCRYPTION_KEY}}
LOG_HASH_SALT=${{shared.LOG_HASH_SALT}}

S3_ENDPOINT=https://storage.railway.app
S3_PUBLIC_ENDPOINT=https://storage.railway.app
S3_REGION=auto
S3_BUCKET=<nombre del bucket en la pestaña Credentials>
S3_ACCESS_KEY_ID=<de la pestaña Credentials>
S3_SECRET_ACCESS_KEY=<de la pestaña Credentials>
S3_FORCE_PATH_STYLE=false

# Primer administrador de plataforma (sólo se crea si el usuario no existe; la contraseña mínima es de 12 caracteres)
PLATFORM_ADMIN_EMAIL=tu-correo@dominio.com
PLATFORM_ADMIN_PASSWORD=<contraseña larga y única>

# Opcionales
METRICS_TOKEN=<openssl rand -hex 24>
OPS_HEARTBEAT_TOKEN=<openssl rand -hex 24>
EMAIL_WEBHOOK_TOKEN=<openssl rand -hex 24>
# Precios de Stripe (se vuelcan a los planes al desplegar; también se editan en el panel global)
STRIPE_PRICE_BASIC_MONTHLY=
STRIPE_PRICE_BASIC_YEARLY=
STRIPE_PRICE_PRO_MONTHLY=
STRIPE_PRICE_PRO_YEARLY=
STRIPE_PRICE_ENTERPRISE_MONTHLY=
STRIPE_PRICE_ENTERPRISE_YEARLY=
STRIPE_PRICE_SCHOOL_ADDON=
STRIPE_PRICE_SCHOOL_SEAT=
```

En **Settings → Networking** del API no generes dominio público. En **Settings → Deploy → Healthcheck Path** pon `/api/v1/health`.

### `worker`

Las mismas variables que `api`, con estas diferencias:

```dotenv
RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile
SERVICE_ROLE=worker
RUN_MIGRATIONS=false
```

No necesita dominio, `PORT` ni ruta de healthcheck. Si las comparte mediante variables compartidas, basta con repetir `DATABASE_URL`, `REDIS_URL` y las de S3, que son de servicio.

### `web`

```dotenv
RAILWAY_DOCKERFILE_PATH=apps/web/Dockerfile
PORT=8080
# Red privada: nombre del servicio api y su puerto
API_UPSTREAM=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:3000
# Origen de las URLs prefirmadas del bucket (política CSP); admite comodines
S3_ORIGIN=https://*.storage.railway.app
```

En **Settings → Networking → Generate Domain** crea el dominio público con el puerto `8080`. Pon `/healthz` como ruta de healthcheck.

> **Si el API no responde desde `web` (502).** Los entornos de Railway creados antes del 16 de octubre de 2025 tienen red privada sólo IPv6. En ese caso añade `HOST=::` a `api` para que escuche también en IPv6. Si aun así falla, usa la URL pública del API como alternativa: genera un dominio en `api` y define en `web` `API_UPSTREAM=https://<dominio-del-api>` y `API_HOST=<dominio-del-api>`.

## 4. Primer despliegue

1. Despliega `api`. En los registros verás el paso de release: `[release] rol de aplicación «solfeggio_app» creado`, la aplicación de las migraciones, `planes cargados` y la creación del administrador. Después arranca la API y Railway comprueba `/api/v1/health`.
2. Despliega `worker` (`Worker en marcha`) y `web`.
3. Abre `https://<dominio>/login` e inicia sesión con `PLATFORM_ADMIN_EMAIL` y `PLATFORM_ADMIN_PASSWORD`. Activa la autenticación en dos pasos en **Seguridad de la cuenta**, cambia la contraseña y **elimina `PLATFORM_ADMIN_PASSWORD`** de las variables.
4. Entra en **Panel global → Integraciones** y configura el correo (SMTP, Resend, SendGrid, Mailgun o Postmark) y los pagos (Stripe). Usa «Probar conexión».
5. Prueba el flujo completo: registra una banda de prueba, crea un socio y sube un archivo al archivo musical (comprueba el bucket).

Cada despliegue posterior repite el paso de release al arrancar la API: es idempotente y no toca los datos.

## 5. Almacenamiento (bucket)

Los archivos (partituras, documentos, fotos) suben y bajan directamente entre el navegador y el bucket con URLs prefirmadas, así que el bucket debe aceptar CORS desde tu dominio.

**Bucket de Railway.** Copia el nombre, la clave de acceso y el secreto de la pestaña **Credentials** a las variables `S3_*` de `api` y `worker`. Los buckets usan URLs virtuales (`<bucket>.storage.railway.app`), por eso `S3_FORCE_PATH_STYLE=false` y `S3_ORIGIN=https://*.storage.railway.app`. Si la pestaña indica estilo de ruta para un bucket antiguo, pon `S3_FORCE_PATH_STYLE=true`. Aplica el CORS con la CLI de AWS y las credenciales del bucket:

```bash
AWS_ACCESS_KEY_ID=<clave> AWS_SECRET_ACCESS_KEY=<secreto> aws s3api put-bucket-cors \
  --endpoint-url https://storage.railway.app \
  --bucket <nombre-del-bucket> \
  --cors-configuration '{"CORSRules":[{"AllowedOrigins":["https://<tu-dominio>"],"AllowedMethods":["GET","PUT","HEAD"],"AllowedHeaders":["Content-Type"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":3600}]}'
```

**S3 externo (AWS S3, Cloudflare R2).** Pon su endpoint en `S3_ENDPOINT` y `S3_PUBLIC_ENDPOINT`, la región en `S3_REGION` y su origen en `S3_ORIGIN` de `web`. Para R2 usa `S3_REGION=auto` y `S3_FORCE_PATH_STYLE=true`. En la UE, elige una región europea para cumplir con el RGPD.

## 6. Dominio propio

1. En `web` → **Settings → Networking → Custom Domain**, añade tu dominio y crea el registro DNS que indica Railway.
2. Cambia `APP_URL` en `api` y `worker` por `https://<tu-dominio>` (también arrastra `API_URL` y `CORS_ORIGINS`) y actualiza el CORS del bucket.
3. Actualiza en Stripe el endpoint del webhook: `https://<tu-dominio>/api/v1/webhooks/stripe` (eventos en [deployment.md](deployment.md#configuración-de-stripe)).

## 7. Operación

- **Registros y métricas:** pestaña *Logs* de cada servicio. Los registros son JSON con datos sensibles redactados. Las métricas de Prometheus (`/api/v1/metrics`, con `METRICS_TOKEN`) no se exponen por la web: el nginx devuelve 404, y sólo se consultan desde la red privada (`http://api.railway.internal:3000/api/v1/metrics`).
- **Copias de seguridad:** activa las copias de seguridad del volumen de PostgreSQL en Railway (según el plan) y, además, programa `infra/backup/pg-backup.sh` fuera de Railway o en un servicio con cron. Ese script avisa al panel global con `BACKUP_HEARTBEAT_URL=https://<dominio>/api/v1/ops/heartbeat/backup` y `BACKUP_HEARTBEAT_TOKEN` (el valor de `OPS_HEARTBEAT_TOKEN`). Restauración en [`infra/backup/RESTORE.md`](../infra/backup/RESTORE.md).
- **No publiques PostgreSQL ni Redis:** no actives el *TCP Proxy* de las bases de datos. La API los alcanza por la red privada.
- **Réplicas:** puedes subir `api` a 2 o más réplicas. El límite de peticiones se cuenta por instancia (ver [roadmap](roadmap.md)). El `worker` también admite varias réplicas: las tareas programadas tienen identificador fijo y los recordatorios se deduplican en Redis.
- **Migraciones:** deben ser compatibles hacia atrás (patrón *expand/contract*, ver [deployment.md](deployment.md#despliegue-sin-caída)) porque la versión anterior sigue sirviendo hasta que la nueva esté sana.
- **Rollback:** en el servicio, pestaña *Deployments*, vuelve a desplegar la versión anterior. Si una migración corrompió datos, restaura la copia anterior.
- **Estado del sistema:** el panel global (**Sistema**) muestra colas, correo, almacenamiento, tareas programadas y el latido de la copia de seguridad.

## 8. Problemas frecuentes

| Síntoma | Causa y solución |
|---|---|
| El despliegue de `api` falla con «El usuario de DATABASE_URL debe llamarse solfeggio_app» | Las migraciones conceden permisos a ese rol por su nombre. Usa exactamente `solfeggio_app` en `DATABASE_URL` |
| «DATABASE_URL usa el rol propietario» | `DATABASE_URL` debe usar el rol sin privilegios; el propietario va en `DATABASE_MIGRATION_URL` y `SYSTEM_DATABASE_URL` |
| `Configuración inválida: …` al arrancar | Falta o es incorrecta una variable obligatoria (secretos de 32 caracteres como mínimo, `DATA_ENCRYPTION_KEY` de 32 bytes en base64) |
| `permission denied for table …` | El release no pudo conceder permisos: revisa los registros del primer arranque de `api` y que `DATABASE_MIGRATION_URL` use el usuario propietario |
| `web` responde 502 en `/api` | El API no es alcanzable: comprueba `API_UPSTREAM`, que `api` tenga `PORT=3000` y mira la nota de IPv6 del apartado 3 |
| Railway marca el servicio como no saludable | `PORT` no coincide con el que escucha el servicio (`api`: 3000, `web`: 8080) o la ruta de healthcheck está mal |
| Las subidas de archivos fallan en el navegador | CORS del bucket sin tu dominio, o `S3_ORIGIN` de `web` no incluye el origen del bucket (política CSP) |
| Todos los usuarios comparten IP en los registros o el límite de peticiones salta pronto | Falta `TRUST_PROXY=2` en `api` |
| Los correos no salen | Configura el proveedor en **Panel global → Integraciones**; hasta entonces el envío se descarta con un aviso en el registro del `worker` |

## 9. Lista de comprobación antes de abrir el registro

- [ ] `PLATFORM_ADMIN_PASSWORD` eliminada y MFA activada en el administrador.
- [ ] Postgres y Redis sin acceso público.
- [ ] Bucket privado con CORS limitado a tu dominio.
- [ ] Stripe en modo producción con el webhook apuntando al dominio final.
- [ ] Correo configurado y probado.
- [ ] Copias de seguridad activas y una restauración de prueba hecha.
- [ ] Pendientes del [roadmap](roadmap.md) previos al registro público: verificación de email, recuperación de contraseña y pentest.
