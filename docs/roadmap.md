# Roadmap

Leyenda: ✅ entregado en el repositorio · 🟡 entregado parcialmente o en versión básica · ⬜ pendiente.

El código ya incluye una primera versión de **todos** los módulos a nivel de API (con tests e2e) y sus pantallas en la web, para que la arquitectura y el modelo de datos queden validados de extremo a extremo. Las fases indican el orden de **endurecimiento, validación con bandas reales y puesta en producción**, no sólo de escritura de código.

## Fase 0 · Fundaciones (2 semanas)

| Entregable | Estado |
|---|---|
| Monorepo pnpm (`apps/api`, `apps/web`), TypeScript estricto, ESLint | ✅ |
| Docker Compose de desarrollo (Postgres, Redis, SeaweedFS como S3, Mailpit) y stack completo con `--profile app` | ✅ |
| Modelo de datos completo y migraciones Prisma | ✅ |
| RLS, rol de aplicación sin privilegios y triggers `same_tenant` | ✅ |
| CI: lint, typecheck, tests con Postgres real y build de imágenes | ✅ |
| Logs estructurados con redacción, endpoints de salud y métricas Prometheus (`/api/v1/metrics`) | ✅ |
| Métricas de colas en Prometheus e integración con Sentry/GlitchTip | ⬜ |
| Enmascarar el token ICS de la ruta en los logs de acceso | ✅ |
| Entornos de staging y producción provisionados | ⬜ |

**Criterio de salida:** la CI pasa en verde y una consulta con `solfeggio_app` sin contexto devuelve 0 filas en todas las tablas de negocio.

## Fase 1 · MVP (8–10 semanas)

Objetivo: que entre 5 y 10 bandas piloto trabajen con su día a día de ensayos y archivo.

| Área | Alcance | Estado |
|---|---|---|
| Autenticación | Registro, login, refresh con rotación y detección de reutilización, MFA TOTP, bloqueo de cuenta, rate limiting en memoria | ✅ |
| Rate limiting compartido entre réplicas (almacenamiento en Redis) | | ⬜ |
| Verificación de email y recuperación de contraseña | Flujo completo con plantillas | ⬜ |
| Tenancy | Onboarding, cambio de tenant, ajustes | ✅ |
| Asistente de onboarding en la interfaz | Pasos guiados | 🟡 |
| RBAC | 8 roles de sistema, roles personalizados, invitaciones, auditoría | ✅ |
| Secretaría | Socios (búsqueda sin tildes), altas y bajas, secciones, documentos, consentimientos, exportación y anonimización RGPD | ✅ |
| Aceptación de la DPA en el onboarding y script de recifrado para rotar la clave de datos | | ⬜ |
| Análisis antivirus de los archivos subidos | | ⬜ |
| Importar socios desde CSV o Excel | | ⬜ |
| Archivo musical | Obras, compositores, versiones, archivos, etiquetas, búsqueda de texto completo | ✅ |
| Visor de PDF y reproductor de audio integrados | | 🟡 |
| Ensayos | Eventos, repertorio, convocatorias, respuestas | ✅ |
| Asistencia | Pasar lista, justificaciones, estadísticas | ✅ |
| Agenda básica | Calendario unificado (eventos, vencimientos de cuotas y devoluciones de uniformes) | ✅ |
| Facturación | Planes, Checkout, Portal, webhooks idempotentes, facturas, periodo de gracia, límites | ✅ |
| Panel global | Tenants, planes, incidencias | ✅ |
| Integraciones configurables | Stripe y correo (SMTP, SendGrid, Mailgun, Resend, Postmark) desde el panel global: secretos cifrados, habilitar/deshabilitar, prueba de conexión, auditoría | ✅ |
| Invalidación inmediata de la caché de integraciones entre procesos (Redis pub/sub) | Hoy: hasta 30 s | ⬜ |
| Tests | 208 tests de API: aislamiento, autenticación, RBAC y planes, webhooks de Stripe, flujos de módulos (incluidas las Fases 5 y 6) y unitarios; 41 tests de la web | ✅ |
| Tests e2e de navegador (Playwright) y pruebas de carga | | ⬜ |
| Pruebas de accesibilidad automatizadas (axe) en la CI | | ⬜ |
| Pentest externo antes de abrir el registro público | | ⬜ |

**Criterios de salida:**
- Los tests de aislamiento cubren todos los endpoints.
- El flujo de Stripe está probado en modo test, con prueba gratuita, cupón, impago y recuperación.
- Las bandas piloto usan la plataforma durante 4 semanas sin incidencias críticas.
- La DPA y la política de privacidad están publicadas.

## Fase 2 · Gestión completa (6 semanas)

| Área | Alcance | Estado |
|---|---|---|
| Tesorería | Categorías, movimientos, cuotas, emisión idempotente, cobros, informe anual, CSV | ✅ |
| Tesorería avanzada | Presupuestos, conciliación bancaria (importación de Norma 43), remesas SEPA (pain.008) | ⬜ |
| Mayordomía | Prendas, tallas, entregas y devoluciones | ✅ |
| Instrumentación | Inventario, asignaciones, mantenimiento y reparaciones | ✅ |
| Comunicaciones por email | Envío masivo vía worker, con reintentos | ✅ |
| Plantillas de email y estadísticas de apertura | | ⬜ |
| Recordatorios | Cron de recordatorios de eventos | ✅ |
| Notificaciones push (Web Push) | | ⬜ |
| Sincronización ICS | Feed personal por membership (suscripción de sólo lectura, plan Pro) | ✅ |
| Métricas del panel global (MRR, estados) | | ✅ |

**Criterio de salida:** al menos 3 bandas cierran un trimestre contable completo con Solfeggio y obtienen su informe para la asamblea.

## Fase 3 · BandMarket e informes (6 semanas)

| Área | Alcance | Estado |
|---|---|---|
| BandMarket | Anuncios, moderación, consultas, denuncias, RLS de lectura cruzada | ✅ |
| Fotos de anuncios | El API admite imágenes (`POST /market/images/upload-url`, `imageKeys`); la web aún muestra una miniatura geométrica y no permite subirlas | 🟡 |
| Valoraciones de vendedores y filtros por distancia | | ⬜ |
| Informes avanzados | Asistencia por sección y temporada, coste por instrumento, rotación de uniformes | 🟡 |
| Exportación a PDF de informes | | ⬜ |

**Criterios de salida:** el SLA de moderación es inferior a 24 horas y hay al menos 50 anuncios publicados con cero incidencias de aislamiento.

## Fase 4 · Enterprise y movilidad

| Área | Estado |
|---|---|
| SSO SAML/OIDC para federaciones y escuelas de música | ⬜ |
| API pública con claves por tenant y webhooks salientes | ⬜ |
| Stripe Connect para cobrar dentro de BandMarket, con comisión de la plataforma (hoy la venta se cierra fuera) | ⬜ |
| Sincronización bidireccional con Google Calendar y Microsoft 365 (hoy sólo hay suscripción ICS) | ⬜ |
| Multi-región, con residencia de datos en la UE garantizada por tenant | ⬜ |
| App nativa (React Native) si la PWA no basta | ⬜ |

**Criterio de salida:** el primer cliente Enterprise (una federación con más de 20 bandas) está en producción con SSO.

## Fase 5 · Escuela de música, cobros y app del músico (10–12 semanas)

Objetivo: aumentar el ingreso por banda con la escuela y los cobros, y que el músico use Solfeggio cada semana. Esta fase incluye el pago de cuotas por los socios y la PWA, que antes estaban en la Fase 4.

| Área | Alcance | Estado |
|---|---|---|
| Escuela · Alumnos y tutores | Alumnos menores con varios tutores, autorizaciones de imagen y de recogida, hermanos vinculados | ⬜ |
| Escuela · Matrícula online | Formulario público con precios por curso, lista de espera, renovación con un clic, pruebas de acceso | ⬜ |
| Escuela · Oferta educativa | Asignaturas (instrumento, lenguaje musical, conjunto), niveles, grupos y profesores | ⬜ |
| Escuela · Horarios y aulas | Detección de conflictos de aula, profesor y alumno; recuperación de clases; calendario escolar con festivos | ⬜ |
| Escuela · Asistencia y evaluación | Asistencia a clase (reutilizando `Attendance`), notas por trimestre y boletines en PDF | ⬜ |
| Escuela · Mensualidades | Descuentos por hermanos, por ser socio de la banda y por varias asignaturas; cobro domiciliado | ⬜ |
| Escuela · Paso a la banda | Alumno → educando → músico de la banda sin volver a introducir datos | ⬜ |
| Escuela · Portal de familias | Horario, faltas, notas, recibos y avisos del profesor | ⬜ |
| Plan o add-on Escuela | Precio por número de alumnos y límites en el control de planes | ⬜ |
| Cobros integrados | Cuotas de socios y mensualidades con SEPA Direct Debit, tarjeta y Bizum; conciliación automática con los recibos; comisión por transacción | ⬜ |
| App del músico (PWA) · Mi semana | Próximos ensayos, confirmación de asistencia con un toque y repertorio del ensayo | ⬜ |
| App del músico (PWA) · Mis particellas | Asignación automática por instrumento y atril, disponibles sin conexión | ⬜ |
| App del músico (PWA) · Pasar lista con QR | Registro de asistencia al llegar al ensayo | ⬜ |
| App del músico (PWA) · Avisos y cuotas | Notificaciones push y consulta y pago de cuotas propias | ⬜ |

**Criterios de salida:**
- Al menos 3 bandas gestionan un curso escolar completo de su escuela con Solfeggio (matrícula, horarios, cobros y boletines).
- Más del 50 % de las cuotas de las bandas piloto se cobran por la plataforma.
- Más del 60 % de los músicos activos confirman su asistencia desde la PWA.

## Fase 6 · Funciones propias del sector (10 semanas)

Objetivo: cubrir las tareas específicas de las bandas que un software genérico no resuelve.

| Área | Alcance | Estado |
|---|---|---|
| Actuaciones · Presupuestos y contratos | Clientes (ayuntamientos, cofradías, comisiones de fiestas), presupuestos, contratos y facturación, preparada para VeriFactu y la factura electrónica | ⬜ |
| Actuaciones · Plantilla mínima | Plantilla requerida por evento y avisos de vacantes por instrumento | ⬜ |
| Actuaciones · Logística | Transporte, horarios de salida, recorrido y uniforme del día (enlazado con Mayordomía) | ⬜ |
| Bolsa de refuerzos | Ofertas de músicos por instrumento y zona, necesidades de las bandas, liquidación de pagos por actuación y datos para retenciones y certificados | ⬜ |
| Archivo · Informe SGAE | Repertorio interpretado generado a partir de los eventos | ⬜ |
| Archivo · Particellas con IA | División de PDFs escaneados en particellas con OCR y asignación por instrumento | ⬜ |
| Archivo · Libretos y préstamos | Libretos de marchas y pasacalles; préstamo de partituras entre bandas | ⬜ |
| Gobierno · Asambleas | Convocatoria, orden del día, quórum, votación telemática y libro de actas con borrador por IA | ⬜ |
| Gobierno · Junta y encuestas | Junta directiva y mandatos; encuestas internas | ⬜ |
| Tesorería · Subvenciones | Seguimiento y justificación de subvenciones, con gastos vinculados | ⬜ |
| Tesorería · Lotería | Talonarios, participaciones por socio y liquidación | ⬜ |
| Tesorería · Socios protectores y patrocinadores | Certificados de donación y modelo 182 para entidades acogidas a la Ley 49/2002 | ⬜ |

**Criterios de salida:**
- Al menos 5 bandas generan su informe SGAE y la justificación de una subvención desde Solfeggio.
- La bolsa de refuerzos cubre al menos 50 vacantes con músicos de otras bandas.
