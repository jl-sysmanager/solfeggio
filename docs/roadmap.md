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
| Plan o add-on Escuela | Plazas de alumno por plan y add-on por banda desde el panel global, con cobro automático en Stripe (cuota fija y precio por plaza) | ✅ |
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

## Fase 7 · Panel global de plataforma

Objetivo: que el panel global, hoy centrado en el mantenimiento (planes, estados, moderación e integraciones), sirva para dirigir el negocio: ingresos y bajas, salud de cada banda y estado técnico del sistema.

### Bloque 1 · Negocio y retención (6 semanas)

| Área | Alcance | Estado |
|---|---|---|
| Métricas SaaS | Evolución mensual del MRR (altas, mejoras de plan y add-ons, bajadas, bajas), ARR, ingreso medio por banda, retención neta de ingresos y estacionalidad por curso escolar | ✅ |
| Embudo de prueba | Registro → onboarding completado → prueba → pago, con la conversión de cada paso | ✅ |
| Cohortes | Porcentaje de bandas activas a los 3, 6 y 12 meses por mes de alta | ✅ |
| Salud del cliente | Puntuación por banda según su uso real (usuarios activos, ensayos, listas, recibos, mensualidades) y uso de cada módulo | ✅ |
| Listas de acción | Bandas en riesgo (inactividad, impagos, renovación con uso bajo) y bandas listas para mejorar de plan (80 % de algún límite) | ✅ |
| Ficha completa de la banda | Cronología (alta, planes, pagos, incidencias, acciones de plataforma), uso frente a límites, notas internas, etiquetas, gestor asignado y contactos | ✅ |
| «Ver como» la banda | Acceso de solo lectura limitado en el tiempo, con motivo obligatorio, sin datos sensibles (DNI, IBAN), auditado y visible en la auditoría de la banda | ✅ |

**Criterio de salida:** el equipo identifica cada semana las bandas en riesgo y las listas para mejorar de plan sin consultar la base de datos.

### Bloque 2 · Operación y facturación (6 semanas)

| Área | Alcance | Estado |
|---|---|---|
| Pagos fallidos | Cola de impagos con reintentos, aviso a la banda y paso a solo lectura con un clic | ✅ |
| Cupones y bonificaciones | Cupones, créditos, meses gratis, ampliación de la prueba y cuentas bonificadas | ✅ |
| Cobro del add-on Escuela | Cuota fija y precio por plaza de alumno en la suscripción de Stripe (`STRIPE_PRICE_SCHOOL_ADDON` y `STRIPE_PRICE_SCHOOL_SEAT`), sincronizados al cambiar add-ons o plazas y cada noche | ✅ |
| Webhooks de Stripe | Historial de eventos con opción de volver a procesarlos | ✅ |
| Soporte | Prioridad, responsable, SLA con alertas, respuestas predefinidas y conversación por email | ✅ |
| Avisos a las bandas | Banner de mantenimiento o novedades dentro de la app, por segmento (plan, comunidad, módulos) | ✅ |
| Salud técnica | Colas de trabajos (fallidos y reintentos), correo enviado, fallido y rebotado (los rebotes llegan por webhook del proveedor), almacenamiento y archivos huérfanos, tareas programadas y latido de las copias de seguridad | ✅ |
| Moderación ampliada | Bolsa de refuerzos (perfiles, necesidades, denuncias), bloqueo de usuarios y tiempo de moderación frente al objetivo de 24 h | ✅ |

**Criterio de salida:** ningún impago, incidencia ni trabajo fallido queda sin atender más allá de su SLA.

### Bloque 3 · Plataforma y sector

| Área | Alcance | Estado |
|---|---|---|
| Roles del equipo de plataforma | Soporte, finanzas, moderación y superadmin en lugar del indicador único de administrador; MFA obligatorio y lista de IPs permitidas | ⬜ |
| Activación gradual de funciones | Funciones en beta por banda o por porcentaje de bandas, separadas de los planes | ⬜ |
| Federaciones | Agrupación de bandas, facturación conjunta y estadísticas agregadas | ⬜ |
| RGPD y DPA | Cola de peticiones (exportación, supresión de cuentas) y registro de la aceptación del DPA por banda | ⬜ |
| Catálogos maestros del sector | Compositores y obras compartidos sin duplicados, instrumentos estándar, festivos por comunidad y plantillas de documentos (estatutos, actas, certificados) | ⬜ |
| Campañas y crecimiento | Emails por segmento a propietarios, encuestas NPS, novedades del producto y programa de embajadores | ⬜ |
| Exportaciones y BI | Exportación de datos de plataforma y conexión con herramientas de análisis | ⬜ |

**Criterio de salida:** una federación gestiona sus bandas desde una cuenta agrupada y el equipo de plataforma trabaja con roles separados y MFA.
