# Solfeggio

Solfeggio es una plataforma SaaS **multi-tenant** para la gestión integral de bandas de música. Cada banda es un tenant aislado, con sus propios socios, archivo, ensayos, tesorería y material, y las bandas pueden comprar y vender instrumentos entre sí en **BandMarket**.

## Funcionalidades

| Módulo | Qué incluye |
|---|---|
| **Archivo musical** | Obras, compositores, versiones y arreglos, partituras, particellas y audios, etiquetas, búsqueda de texto completo en español, informe de repertorio para la SGAE, división de PDFs en particellas, libretos de marchas y préstamos entre bandas |
| **Ensayos** | Planificación, repertorio, convocatorias por sección o por socio, respuestas, recordatorios |
| **Asistencia** | Pasar lista en ensayos y actuaciones, justificaciones con revisión, estadísticas |
| **Tesorería** | Ingresos y gastos por categoría, cuotas, emisión de recibos, cobros, informe anual, CSV, subvenciones y su justificación, lotería de Navidad, donantes y patrocinadores con certificados y datos del modelo 182 |
| **Mayordomía** | Uniformes, tallas, entregas, devoluciones y estado de las prendas |
| **Secretaría** | Socios, altas y bajas, datos personales cifrados, consentimientos, comunicaciones, documentos, derechos RGPD |
| **Instrumentación** | Inventario, asignaciones, mantenimiento y reparaciones |
| **Agenda** | Calendario unificado y suscripción ICS (Google, Apple, Outlook) |
| **Escuela de música** | Alumnos, familias y tutores, matrícula online con lista de espera y pruebas de acceso, asignaturas, grupos, horarios con detección de conflictos, clases y asistencia, notas y boletines, mensualidades con descuentos, paso a la banda y portal de familias |
| **Contrataciones** | Clientes, presupuestos y contratos, facturas encadenadas e inalterables (preparadas para VeriFactu), plantilla mínima por evento y logística |
| **Bolsa de refuerzos** | Perfiles de músico, necesidades abiertas entre bandas, candidaturas, músicos externos, pagos con retención y datos para los modelos 111 y 190 |
| **Gobierno** | Asambleas con quórum, delegaciones y votación telemática, libro de actas, junta directiva y encuestas |
| **BandMarket** | Anuncios entre bandas con moderación, consultas y denuncias |
| **SaaS** | Planes Free, Basic, Pro y Enterprise; add-ons por banda (Escuela) con cobro por plaza; Stripe (Checkout, Portal, Tax, cupones, prueba gratuita); webhooks idempotentes; periodo de gracia |
| **Panel global** | Métricas SaaS (MRR, retención, embudo, cohortes), salud de cada banda y listas de acción, ficha de la banda, «ver como» de solo lectura, pagos fallidos y bonificaciones, soporte con SLA, avisos a las bandas, salud técnica y moderación |
| **Seguridad** | RBAC configurable por banda (10 roles base), auditoría, MFA TOTP, RLS en PostgreSQL, rate limiting, cifrado de campos |

## Stack

- **API:** NestJS 10, Prisma 5, PostgreSQL 16 con RLS, Redis 7 y BullMQ (worker), almacenamiento compatible con S3, Stripe y nodemailer.
- **Web:** React y Vite servidos por nginx, con el lenguaje visual de [Breeze](https://github.com/lanternops/breeze) (estilo shadcn, Plus Jakarta Sans).
- **Infraestructura:** Docker Compose, GitHub Actions y GHCR.

## Puesta en marcha

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

Una vez arrancado:

- La interfaz está en http://localhost:5173.
- La API está en http://localhost:3000/api/v1 y su documentación Swagger, en http://localhost:3000/api/docs.
- Los emails de desarrollo se pueden ver en http://localhost:8025.
- El almacenamiento S3 local (SeaweedFS) escucha en http://localhost:8333.

> **Credenciales de demostración.** Con `SEED_DEMO=true`, `pnpm db:seed` crea la banda ficticia `banda-demo` con los usuarios `propietario@`, `director@`, `tesorero@` y `musico@demo.solfeggio.local`. La contraseña (variable `SEED_PASSWORD`, con un valor por defecto de desarrollo) está documentada en [`apps/api/prisma/seed.ts`](apps/api/prisma/seed.ts). Son **sólo para desarrollo**: no ejecutes el seed de demostración en producción.

Para levantar todo el sistema en contenedores (web en http://localhost:8080, con nginx reenviando `/api` a la API):

```bash
docker compose --profile app up -d --build
```

## Tests

Tests de la API (290 tests en 23 suites: aislamiento entre tenants, autenticación, RBAC y planes, Stripe, flujos de los módulos, escuela, contrataciones, refuerzos, archivo, gobierno, tesorería, panel global y unitarios), con PostgreSQL y Redis reales del compose:

```bash
pnpm --filter @solfeggio/api test
```

Sólo los tests de aislamiento:

```bash
pnpm --filter @solfeggio/api test -- tenant-isolation
```

Tests de la web (Vitest, 55 tests):

```bash
pnpm --filter @solfeggio/web test
```

Lint y typecheck de todo el monorepo:

```bash
pnpm lint && pnpm typecheck
```

Las migraciones de la base de datos de tests (`solfeggio_test`) se aplican solas al empezar. Más detalles en [docs/deployment.md](docs/deployment.md#tests).

## Estructura del repositorio

```
apps/
  api/            API NestJS + worker
    prisma/       schema.prisma, migraciones (0001_init … 0006_platform_ops), seed
    src/          módulos: auth, tenancy, iam, audit, db, members, archive, events, attendance,
                  treasury, wardrobe, instruments, agenda, notifications, market, billing,
                  admin, storage, jobs, health, school, performances, reinforcements, governance, platform
    test/         e2e (aislamiento de tenants, auth, RBAC y planes, Stripe, módulos)
  web/            SPA React (Vite) + Dockerfile nginx
docs/             arquitectura, modelo de datos, API, historias, roadmap, seguridad, despliegue
infra/
  postgres/       creación del rol de aplicación (sin privilegios ⇒ RLS siempre activo)
  s3/             credenciales del S3 local (SeaweedFS), sólo desarrollo
  backup/         script de copias y guía de restauración
.github/          CI, despliegue, Dependabot
DESIGN.md         referencia visual de la interfaz
```

## Documentación

- [Arquitectura](docs/architecture.md): contenedores, módulos, aislamiento multi-tenant, RBAC, Stripe y ADRs.
- [Modelo de datos](docs/data-model.md): diagramas ER, políticas RLS y columnas cifradas.
- [Pautas de UX/UI](docs/ux-guidelines.md): navegación, paleta de comandos, tablas, estados y accesibilidad.
- [API v1](docs/api.md): contrato REST, permisos y planes.
- [Historias de usuario](docs/user-stories.md): criterios de aceptación.
- [Roadmap](docs/roadmap.md): fases, desde el MVP, con el estado de cada entregable.
- [Seguridad y RGPD](docs/security-gdpr.md): autenticación, cifrado, logs, RGPD, copias de seguridad y monitorización.
- [Despliegue](docs/deployment.md): entorno local, producción, Stripe y rollback.
- [Operación](docs/operations.md): tareas programadas y runbook de incidencias.
- [Despliegue en Railway](docs/railway.md): servicios, variables, primer despliegue, bucket, dominio y operación.

## Licencia

Propietaria. Todos los derechos reservados.
