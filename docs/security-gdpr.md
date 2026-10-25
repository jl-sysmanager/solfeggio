# Seguridad, RGPD, copias de seguridad y monitorización

## 1. Autenticación

| Control | Implementación |
|---|---|
| Contraseñas | **argon2id** (`argon2`, parámetros por defecto de la librería). Entre 10 y 128 caracteres, con al menos una letra y un número. Cuando el email no existe se verifica igualmente contra un hash ficticio, para igualar tiempos. |
| Access token | JWT HS256 firmado con `JWT_ACCESS_SECRET`, que dura `JWT_ACCESS_TTL` (15 min). Claims: `sub`, `tid` y `mid` (membership); `tid` y `mid` sólo cuando hay banda activa. En el navegador vive sólo en memoria, nunca en `localStorage`. |
| Refresh token | Valor aleatorio de 384 bits que se guarda sólo como hash SHA-256 en `refresh_tokens`. Va en una cookie `sf_rt` `httpOnly; SameSite=Strict; Path=/api/v1/auth` (`Secure` con `NODE_ENV=production`) y dura `JWT_REFRESH_TTL_DAYS` (30 días). |
| Rotación | Cada uso emite un token nuevo de la misma `familyId` y revoca el anterior. Si se reutiliza un token revocado, se revoca **toda la familia** y se responde `401 REFRESH_REUSED`. Activar MFA revoca todas las sesiones del usuario. |
| MFA | TOTP (RFC 6238) con `otplib`, ventana de ±1 paso. La semilla se cifra con AES-256-GCM (`users.mfaSecretEnc`). Desactivarlo requiere un código válido. |
| Bloqueo de cuenta | Tras 5 fallos seguidos, la cuenta queda bloqueada 15 minutos (`lockedUntil`, `401 ACCOUNT_LOCKED`). Los mensajes de error son genéricos (`INVALID_CREDENTIALS`) para no revelar si una cuenta existe. |
| Tokens de un solo uso | Las invitaciones sólo guardan el hash SHA-256, caducan a los 7 días y se invalidan al usarse. La verificación de email y la recuperación de contraseña están pendientes (ver [roadmap.md](roadmap.md)). |

## 2. Protección de la API

- **Rate limiting:** `@nestjs/throttler` con almacenamiento **en memoria de cada instancia**, por IP (`trust proxy` activado). Por defecto, `RATE_LIMIT_MAX` (120) peticiones por `RATE_LIMIT_TTL_MS` (60 s). En registro, login y aceptación de invitaciones se aplica `RATE_LIMIT_AUTH_MAX` (10); en refresh, 30. Los webhooks y el health quedan excluidos. Con varias réplicas, el límite efectivo se multiplica: hasta que se implemente el almacenamiento en Redis (pendiente), aplica también un límite en el proxy inverso o el WAF.
- **Cabeceras:** `helmet` con CSP `default-src 'none'; frame-ancestors 'none'` en la API (Swagger, sólo fuera de producción, la relaja en `/api/docs`). nginx sirve la SPA con `default-src 'self'`, `img-src 'self' data: blob: <S3>`, `connect-src 'self' <S3>`, `frame-ancestors 'none'`, HSTS y `Referrer-Policy: strict-origin-when-cross-origin`.
- **CORS:** sólo se aceptan los orígenes de `CORS_ORIGINS`, con `credentials: true`.
- **CSRF:** la API no usa cookies de sesión. La única cookie es la del refresh, que es `SameSite=Strict` y tiene el path restringido; las peticiones autenticadas usan la cabecera `Authorization`.
- **Validación:** todos los cuerpos, parámetros y queries se validan con **zod** (`ZodPipe`), que descarta los campos desconocidos. Los ids de ruta deben ser UUID. Los listados limitan `pageSize` a 200 o menos.
- **Errores:** un filtro global devuelve el formato estándar sin trazas, y los detalles internos sólo van a los logs.
- **Subidas de archivos:** lista de tipos MIME permitidos por área, tamaño máximo (`MAX_UPLOAD_MB`), claves generadas en el servidor, `Content-Type` firmado en la URL prefirmada, y verificación con `HeadObject` (tamaño real) antes de registrar el archivo. El análisis antivirus está pendiente.
- **Exportación CSV:** las celdas que empiezan por `=`, `+`, `-` o `@` se prefijan con `'` para evitar inyección de fórmulas.
- **Dependencias:** Dependabot semanal y `pnpm audit` en la CI.

## 3. Cifrado

- **En tránsito:** TLS 1.2 o superior en todos los puntos de entrada (balanceador o nginx). La conexión a Postgres usa `sslmode=require` y la de Redis, `rediss://`.
- **En reposo:** discos y volúmenes cifrados en el proveedor, y bucket S3 con **cifrado por defecto** (SSE-S3 o SSE-KMS) configurado en el bucket, no en cada petición.
- **Campos de la aplicación:** `members.nationalIdEnc`, `external_musicians.nationalIdEnc`, `guardians.nationalIdEnc` y `users.mfaSecretEnc` se cifran con **AES-256-GCM** usando `DATA_ENCRYPTION_KEY` (32 bytes en base64), un IV aleatorio de 12 bytes por valor y una etiqueta de autenticación. El formato es `v1:<iv>:<tag>:<ciphertext>` (base64url). La aplicación no almacena IBAN ni otros datos de cuenta bancaria.
- **Rotación de la clave de datos:**
  1. Añadir la nueva clave como `DATA_ENCRYPTION_KEY` y mover la anterior a `DATA_ENCRYPTION_KEY_PREVIOUS`.
  2. `decrypt()` prueba primero la clave actual y luego la anterior; los valores nuevos se cifran siempre con la actual.
  3. Recifrar los valores existentes (leer y volver a guardar) con un script de mantenimiento. Ese script todavía no existe en el repositorio.
  4. Cuando todos los valores estén recifrados, se retira `DATA_ENCRYPTION_KEY_PREVIOUS`.
- **Credenciales de terceros (Stripe, proveedor de correo):** se configuran en el panel global y se guardan en `integration_settings.secretsEnc` como un único JSON cifrado con AES-256-GCM. La categoría se usa como dato autenticado (AAD `integration:<categoría>`), así que un cifrado no puede copiarse a otra fila. La API nunca devuelve los valores, sólo si existen y sus 4 últimos caracteres (12 o más caracteres). El rol de base de datos de la aplicación no tiene acceso a la tabla; la leen sólo los servicios de sistema. Cada cambio y cada prueba de conexión se registra en `platform_audit_logs` con qué campos cambiaron, nunca sus valores. Los mensajes de error de los proveedores de correo no incluyen el cuerpo de la respuesta. Rotar `DATA_ENCRYPTION_KEY` también afecta a estos secretos: tras la rotación basta con volver a guardar cada integración.
- **Secretos de infraestructura:** se guardan en un gestor de secretos (AWS Secrets Manager, GCP Secret Manager, Doppler o Vault), nunca en el repositorio ni en las imágenes. `.env.example` sólo contiene valores de ejemplo.

## 4. Logs y auditoría

- **pino** (`nestjs-pino`) escribe JSON con `redact` sobre `req.headers.authorization`, `req.headers.cookie`, `req.headers["stripe-signature"]`, `res.headers["set-cookie"]`, `*.password`, `*.token`, `*.accessToken`, `*.refreshToken`, `*.mfaCode`, `*.iban`, `*.nationalId` y `*.email` (`apps/api/src/common/logger.ts`).
- Las IP se registran como `HMAC-SHA256(ip, LOG_HASH_SALT)`, lo que permite correlacionar peticiones sin guardar la IP en claro.
- Los logs no incluyen los cuerpos de las peticiones y las URL se registran siempre sin query string. Atención: el token del feed ICS va en la ruta (`/calendar/:token.ics`) y hoy sí aparece en el log de acceso; enmascararlo está pendiente.
- **`audit_logs`** es *append-only* para el rol de la app y se escribe en la misma transacción que el cambio. Registra el actor, la acción, la entidad, el id, metadatos sin datos sensibles (las claves con `pass`, `token`, `secret`, `iban`, `dni`… se sustituyen por `[redacted]`; en socios sólo se guardan los nombres de los campos cambiados) y la IP en forma de hash. Política de conservación: 2 años (la purga automática está pendiente). Las acciones del panel global se auditan en el tenant afectado con el prefijo `platform.`.

## 5. RGPD

| Aspecto | Cómo se aborda |
|---|---|
| Roles | Cada banda es **responsable del tratamiento** de los datos de sus socios. Solfeamos actúa como **encargado** (art. 28) y firma una DPA con cada banda (la aceptación explícita en el flujo de onboarding está pendiente). Para los datos de las cuentas de usuario y de facturación, Solfeamos es responsable. |
| Base legal | Gestión de la relación asociativa (art. 6.1.b) para los datos de socio; obligación legal (6.1.c) para la contabilidad; consentimiento (6.1.a) para la imagen y las comunicaciones no esenciales. |
| Consentimientos | `members.consentDataAt` y `members.consentImages` registran fecha y alcance. La retirada del consentimiento se registra en la auditoría. |
| Minimización | Sólo son obligatorios el nombre y los apellidos. El DNI es opcional y está cifrado. Quien no tiene `members:sensitive` no ve los campos sensibles. No se guardan IBAN ni datos de domiciliación. |
| Derecho de acceso y portabilidad | `GET /members/:id/export` (requiere `members:write` y `members:sensitive`) genera un JSON con la ficha, la sección, las tallas, las asistencias, las convocatorias, los recibos, los préstamos de uniformes e instrumentos, los movimientos contables y los metadatos de sus documentos. |
| Supresión | `POST /members/:id/anonymize` sustituye nombre y apellidos («Socio anonimizado #N»), borra email, teléfono, fecha de nacimiento, DNI, dirección, notas y tallas, desvincula el usuario, marca la baja y fija `anonymizedAt`; después la ficha ya no se puede editar. Se conservan las asistencias y los importes contables durante el plazo legal (6 años, según el Código de Comercio y la normativa fiscal). |
| Rectificación, oposición y limitación | Edición de la ficha, baja de comunicaciones y cambio de estado del socio a `INACTIVE`. |
| Retención | Al darse de baja un tenant, los datos se conservan 30 días para poder recuperarlos y después se borran. Las copias de seguridad se rotan en 30 días. Los logs de aplicación se guardan 30 días y la auditoría, 2 años. |
| Registro de actividades | El documento interno `RAT` lista finalidades, categorías, destinatarios y plazos, y se revisa cada año. |
| Subencargados | Stripe (pagos; Irlanda y EE. UU. con SCC), el proveedor cloud y de S3 (región de la UE), el proveedor de email transaccional (región de la UE) y el de error tracking (opcional, UE). La lista se publica y se avisa con 30 días de antelación de cualquier cambio. |
| Ubicación de los datos | Base de datos, almacenamiento y copias se alojan en regiones de la UE (por ejemplo, `eu-west-1`/`eu-south-2` o `europe-west1`). |
| Brechas | El procedimiento consiste en detectar, contener, evaluar y notificar a la AEPD en un plazo de **72 horas** si hay riesgo. Si el riesgo es alto, se avisa también a las bandas y estas a sus socios. Todo se registra en el registro interno de brechas. |
| Menores | Las bandas tienen educandos menores. Para menores de 14 años, el consentimiento lo da el tutor (LOPDGDD, art. 7) y se registra igual. |
| Privacidad desde el diseño | RLS, cifrado de campos, logs sin datos personales y permisos mínimos por rol. |

## 6. Copias de seguridad

- **Base de datos gestionada (recomendado):** copia automática diaria y PITR mediante WAL, con un RPO de unos 5 minutos y retención de 30 días, más una copia semanal en otra región de la UE.
- **Autogestionado o adicional:** [`infra/backup/pg-backup.sh`](../infra/backup/pg-backup.sh) ejecuta `pg_dump -Fc` cada día, cifra el resultado con `age` o GPG, lo sube a un bucket con versionado y Object Lock, y borra las copias de más de 30 días.
- **Archivos:** el bucket S3 tiene **versionado** activado, una regla de ciclo de vida que elimina las versiones antiguas a los 30 días y, opcionalmente, replicación entre regiones de la UE.
- **Pruebas de restauración:** cada mes se restaura la copia en una base de datos temporal, siguiendo [`infra/backup/RESTORE.md`](../infra/backup/RESTORE.md), se ejecuta `prisma migrate status` y se comprueba el recuento de filas por tabla. El resultado se registra en el registro de operaciones.
- **Objetivos:** RPO de 24 horas o menos (5 minutos con PITR) y RTO de 4 horas o menos.

## 7. Monitorización y alertas

| Señal | Fuente | Alerta |
|---|---|---|
| Disponibilidad | `GET /health` (liveness) y `GET /health/ready` (Postgres y Redis) | Fallo en 2 comprobaciones seguidas |
| Métricas | `GET /api/v1/metrics` en formato Prometheus (`prom-client`): métricas por defecto de Node y `http_request_duration_seconds` por método, ruta parametrizada y estado. Si se define `METRICS_TOKEN`, exige `Authorization: Bearer <token>`; además, no lo expongas fuera de la red interna | p95 > 500 ms durante 10 min; 5xx > 1 % |
| Colas | Claves de BullMQ en Redis (`bull:solfeggio:failed`, `…:wait`) y logs del worker; las métricas de colas en Prometheus están pendientes | Más de 100 trabajos fallidos en 1 hora |
| Webhooks de Stripe | `stripe_events.error` no nulo y alertas del panel de Stripe | Cualquier error que dure más de 1 hora |
| Errores | Logs de nivel `error` (los 5xx registran la traza en el servidor). La integración con Sentry/GlitchTip mediante `SENTRY_DSN` está prevista, no implementada | Errores nuevos |
| Seguridad | Picos de `429`, de `ACCOUNT_LOCKED` y de reutilización de refresh tokens | Umbral por hora |
| Negocio | Tenants que pasan a `PAST_DUE` o `READ_ONLY` | Resumen diario |

Los logs se envían en JSON por la salida estándar al agregador (Loki, CloudWatch o Datadog) y se conservan 30 días.

## 8. Acceso del equipo de plataforma

- **«Ver como»:** el equipo de plataforma sólo puede entrar en una banda en modo lectura, con un motivo de al menos 10 caracteres y durante un máximo de 60 minutos. El token no permite escrituras ni ver DNI, no se renueva y deja de valer en cuanto la sesión termina, caduca o se bloquea o degrada al administrador.
- **Transparencia:** el inicio y el fin de cada acceso se escriben en la auditoría de la propia banda (`platform.impersonation.started` y `platform.impersonation.ended`), y todas las acciones del equipo de plataforma sobre una banda llevan el prefijo `platform.`.
- **Mínima exposición:** las tablas del panel global (fotos, notas, avisos, registros de correo, latidos, denuncias) no son accesibles para el rol de la aplicación. Las notas internas de soporte no llegan nunca a la banda, ni siquiera con una consulta directa (RLS).
- **Bloqueo de cuentas:** un usuario bloqueado por moderación pierde el acceso y sus tokens de refresco se revocan. Las acciones de bloqueo quedan en el registro de plataforma.
- **Webhooks y latidos:** los endpoints públicos `/webhooks/email/:provider` y `/ops/heartbeat/:name` exigen un token propio (`EMAIL_WEBHOOK_TOKEN` y `OPS_HEARTBEAT_TOKEN`, de al menos 16 caracteres) y responden 401 si no está configurado.

## 9. Control de accesos dentro de la banda

- **Techo de permisos:** nadie puede conceder permisos que no tiene. Al crear o editar un rol, al asignar un rol a un usuario y al invitar, el API comprueba que los permisos del rol no superan los de quien actúa (403 `PERMISSION_CEILING`). Así un administrador no puede darse `billing:manage` editando su rol, ni invitar a un rol con más poder que el suyo.
- **Propietarios:** sólo un propietario asigna el rol de propietario o cambia, suspende o retira a otro propietario (403 `OWNER_ONLY`). Siempre debe quedar al menos uno (`LAST_OWNER`).
- **Sin cambios sobre uno mismo:** nadie cambia su propio rol ni suspende su acceso (400 `SELF_CHANGE`); lo hace otra persona con permiso.
- **Mínimo necesario:** el panel de inicio devuelve cada indicador sólo si el rol tiene acceso al módulo que lo origina, y el profesorado no accede a los datos de contacto de las familias.
- **Rol Archivero:** cuida el archivo musical (`archive:read` y `archive:write`) sin acceso a socios, tesorería ni escuela.
- Todos los cambios de roles, usuarios e invitaciones quedan en la auditoría de la banda.

