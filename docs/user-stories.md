# Historias de usuario y criterios de aceptación

Cada historia sigue el formato *Como `<rol>` quiero `<objetivo>` para `<beneficio>`* y sus criterios de aceptación usan el formato **Dado / Cuando / Entonces**. La columna **Fase** remite al [roadmap](roadmap.md).

Roles: propietario, administrador, director, secretario, tesorero, responsable de material (RM), músico, colaborador y equipo de plataforma.

---

## SaaS: registro, onboarding y facturación (SAAS)

**SAAS-01 · Registro de banda** (Fase 1)
Como responsable de una banda quiero registrarme y crear mi banda para empezar a usar Solfeamos.
- Dado un email no registrado, cuando envío nombre, email y una contraseña de al menos 10 caracteres con letras y números, entonces se crea el usuario (el email de verificación está pendiente, ver roadmap).
- Dado un usuario autenticado sin banda, cuando completo `bandName` y un `slug` libre, entonces se crea el tenant en estado `TRIALING` con el plan Free y los 8 roles de sistema, y yo quedo como propietario.
- Dado un `slug` ya usado, cuando lo envío, entonces recibo `409` y el tenant no se crea.

**SAAS-02 · Asistente de onboarding** (Fase 1)
Como propietario quiero un asistente inicial para dejar la banda lista en minutos.
- Dado un tenant recién creado, cuando entro, entonces veo los pasos "datos de la banda → secciones → importar socios → invitar a la junta → elegir plan".
- Cuando completo el último paso, entonces se registra `onboardedAt` y el asistente deja de mostrarse.

**SAAS-03 · Contratar plan** (Fase 1)
Como propietario quiero contratar el plan Basic o Pro, mensual o anual, para desbloquear funcionalidades.
- Dado el permiso `billing:manage`, cuando pulso "Contratar Pro anual", entonces se me redirige a Stripe Checkout con una prueba de 14 días, campo para cupón, IVA automático y campo para el CIF.
- Cuando Stripe envía `checkout.session.completed` y `customer.subscription.created`, entonces el tenant queda con el plan Pro y `trialEndsAt` informado.
- Dado que ya tuve una prueba anteriormente, cuando contrato de nuevo, entonces no se aplica otra prueba.

**SAAS-04 · Gestionar suscripción** (Fase 1)
Como propietario quiero cambiar de plan, actualizar la tarjeta, cancelar y descargar facturas sin hablar con soporte.
- Cuando pulso "Gestionar suscripción", entonces se abre el Customer Portal de Stripe.
- Cuando cancelo, entonces `cancelAtPeriodEnd = true` y mantengo el plan hasta `currentPeriodEnd`.
- Cuando Stripe envía `invoice.paid`, entonces la factura aparece en `/billing` con sus enlaces al PDF y a la versión online.

**SAAS-05 · Impago y periodo de gracia** (Fase 1)
Como plataforma quiero dar margen ante un impago para no cortar el servicio por un fallo puntual de la tarjeta.
- Dado `invoice.payment_failed`, entonces el tenant pasa a `PAST_DUE` con `graceUntil = ahora + 7 días` y el propietario recibe un email y un aviso en la app.
- Dado un `invoice.paid` posterior, entonces el tenant vuelve a `ACTIVE` y se borra `graceUntil`.
- Dado `graceUntil` vencido, cuando se ejecuta el barrido horario, entonces el tenant pasa a `READ_ONLY`, las escrituras responden `403 TENANT_READ_ONLY` y el checkout y el portal de facturación siguen operativos.

**SAAS-06 · Webhooks idempotentes** (Fase 1)
Como plataforma quiero procesar cada evento de Stripe una sola vez para no duplicar estados ni facturas.
- Dada una firma inválida, entonces la API responde `400` y no procesa nada.
- Dado un `event.id` ya registrado en `stripe_events`, cuando Stripe lo reenvía, entonces la API responde `200` sin volver a procesarlo.
- Dado un error al procesar, entonces se guarda `error`, se responde `500` y el reintento de Stripe lo procesa correctamente.

**SAAS-07 · Límites del plan** (Fase 1)
Como plataforma quiero aplicar los límites de cada plan para que el modelo de precios sea coherente.
- Dado el plan Free con 40 socios, cuando intento dar de alta el socio 41, entonces recibo `403 PLAN_LIMIT` y la interfaz me ofrece mejorar el plan en `/billing`.
- Dado el plan Free, cuando llamo a `/finance/*`, entonces recibo `403 FEATURE_NOT_IN_PLAN`.
- Dada una subida que superaría el almacenamiento contratado, entonces su confirmación (con el tamaño real del objeto) responde `403 PLAN_LIMIT` y no se registra el archivo.

---

## Usuarios, permisos y seguridad (IAM)

**IAM-01 · Invitar a la junta** (Fase 1)
Como administrador quiero invitar a una persona con un rol concreto para delegar tareas.
- Cuando invito un email con el rol "tesorero", entonces se envía un enlace válido durante 7 días y la invitación queda pendiente.
- Cuando la persona acepta, entonces se crea su membership con ese rol. Si no tenía cuenta, la crea en ese momento.
- Dado un enlace caducado o ya usado, entonces la aceptación falla con `400 INVITATION_INVALID`.

**IAM-02 · Roles configurables** (Fase 1)
Como propietario quiero crear roles personalizados (por ejemplo, "archivero") con permisos concretos.
- Cuando creo un rol con `archive:read` y `archive:write`, entonces puedo asignarlo y el usuario sólo ve el archivo.
- Dado un rol de sistema, cuando intento borrarlo, entonces recibo `409`.
- Cuando cambio los permisos de un rol, entonces se aplican en la siguiente petición de sus usuarios y el cambio queda en la auditoría.

**IAM-03 · Varias bandas por persona** (Fase 1)
Como músico que toca en dos bandas quiero cambiar de una a otra sin salir de la sesión.
- Dado que pertenezco a dos tenants, cuando elijo otra banda, entonces recibo un token con el nuevo `tid` y sólo veo los datos de esa banda.
- Dado un `tenantId` en el que no tengo membership activa, entonces `switch-tenant` responde `404`.

**IAM-04 · MFA opcional** (Fase 1)
Como tesorero quiero activar la verificación en dos pasos para proteger los datos económicos.
- Cuando escaneo el QR y confirmo un código TOTP válido, entonces `mfaEnabled = true`.
- Dado MFA activo, cuando inicio sesión sin código, entonces recibo `401 MFA_REQUIRED`. Con un código válido, inicio sesión.
- Dado un código incorrecto, entonces se rechaza y se cuenta como intento fallido.

**IAM-05 · Bloqueo por fuerza bruta** (Fase 1)
Como plataforma quiero frenar los ataques de contraseña.
- Dados 5 intentos fallidos seguidos, entonces la cuenta se bloquea 15 minutos (`ACCOUNT_LOCKED`).
- Dadas más de 10 peticiones por minuto a `/auth/*` desde una IP, entonces la API responde `429` con `Retry-After`.

**IAM-06 · Sesiones seguras** (Fase 1)
Como usuario quiero que mi sesión no pueda reutilizarse si me roban un token.
- Cuando refresco la sesión, entonces el refresh token anterior queda revocado y recibo uno nuevo.
- Dado un refresh token ya rotado, cuando alguien lo reutiliza, entonces se revoca toda la familia y hay que volver a iniciar sesión.

**IAM-07 · Auditoría** (Fase 1)
Como secretario quiero consultar quién cambió qué para rendir cuentas ante la junta.
- Cuando alguien crea, modifica o borra socios, movimientos, roles o memberships, entonces se registra el actor, la acción, la entidad, la fecha y la IP en forma de hash.
- La auditoría no contiene datos sensibles en claro (DNI, IBAN, contraseñas).
- El rol de base de datos de la app no puede modificar ni borrar entradas de la auditoría.

**IAM-08 · Aislamiento entre bandas** (Fase 1, crítica)
Como banda quiero tener la garantía de que ninguna otra banda puede ver ni tocar mis datos.
- Dado un usuario de la banda A, cuando pide `GET /members/{id de un socio de B}`, entonces recibe `404`.
- Cuando intenta un `PATCH` o `DELETE` sobre un recurso de B, entonces recibe `404` y el recurso de B no cambia.
- Cuando intenta crear una convocatoria de A con el `memberId` de un socio de B, entonces la operación falla y no se crea nada.
- Dada una consulta directa con el rol `solfeggio_app` sin `app.tenant_id`, entonces no se devuelve ninguna fila.
- Los listados, la búsqueda, las estadísticas, las descargas y los exports sólo contienen datos de A.

---

## 1. Archivo musical (ARC)

**ARC-01 · Catalogar obras** (Fase 1)
Como director quiero dar de alta obras con compositor, arreglista, género, duración, dificultad y etiquetas.
- Cuando creo "Amparito Roca" de Jaime Texidor con las etiquetas "pasodoble" y "desfile", entonces aparece en el listado y en la búsqueda.
- Si escribo un compositor que no existe, entonces se crea en el catálogo de compositores de mi banda.

**ARC-02 · Versiones y arreglos** (Fase 1)
Como director quiero guardar varias versiones de una obra (original o arreglo de 2019) para tocar la adecuada.
- Cuando añado la versión "Arreglo J. Pérez", entonces puedo asociarle partituras y particellas.

**ARC-03 · Subir partituras y audios** (Fase 1)
Como director quiero subir el guion, las particellas por instrumento y las grabaciones.
- Dado un PDF de 20 MB, cuando lo subo como `PART` de "Clarinete 1º", entonces queda asociado y su tamaño cuenta para la cuota.
- Dado un archivo con un tipo no permitido (por ejemplo, `.exe`), entonces se rechaza con `400 MIME_NOT_ALLOWED`.
- Dado un archivo mayor que `MAX_UPLOAD_MB`, entonces se rechaza con `400 FILE_TOO_LARGE`.

**ARC-04 · Búsqueda** (Fase 1)
Como músico quiero buscar obras por título, compositor o etiqueta, sin preocuparme por las tildes.
- Cuando busco "marcha procesion", entonces aparecen las obras con "Marcha procesional" en el título o en las etiquetas, ordenadas por relevancia.
- Puedo filtrar por género, etiqueta y compositor.

**ARC-05 · Descarga controlada** (Fase 1)
Como músico quiero descargar mi particella del repertorio del próximo ensayo.
- Dado `archive:read`, cuando pulso descargar, entonces obtengo una URL temporal válida durante 5 minutos.
- Dada una URL caducada, entonces S3 la rechaza.

## 2. Gestión de ensayos (ENS)

**ENS-01 · Planificar ensayos** (Fase 1)
Como director quiero programar ensayos con fecha, lugar y descripción.
- Cuando creo un ensayo el jueves a las 20:30 en el local, entonces aparece en la agenda de todos los usuarios con `events:read`.
- Dado `endsAt < startsAt`, entonces la API responde `400`.

**ENS-02 · Repertorio del ensayo** (Fase 1)
Como director quiero fijar el orden de las obras para que los músicos se preparen.
- Cuando envío la lista ordenada, entonces el ensayo muestra el repertorio con enlaces a las obras del archivo.

**ENS-03 · Convocatorias** (Fase 1)
Como director quiero convocar a toda la banda, a ciertas secciones o a socios concretos.
- Cuando convoco a "Trompetas" y "Trombones", entonces se crea una convocatoria `PENDING` por cada socio activo de esas secciones y cada uno recibe una notificación.
- Volver a convocar no duplica convocatorias.

**ENS-04 · Responder a la convocatoria** (Fase 1)
Como músico quiero confirmar o declinar mi asistencia, con una nota.
- Cuando declino con la nota "viaje", entonces el director ve la respuesta y los contadores (convocados, aceptan, declinan) se actualizan.

**ENS-05 · Recordatorios** (Fase 2)
Como músico quiero un recordatorio antes del ensayo.
- Dado `reminderMinutes = [1440]`, entonces 24 horas antes se envía una única notificación (y un email) a los convocados que no han declinado.
- Si el evento se cancela, entonces se notifica la cancelación y no se envían recordatorios.

## 3. Control de asistencia (ASI)

**ASI-01 · Pasar lista** (Fase 1)
Como director quiero marcar la asistencia de cada convocado desde el móvil durante el ensayo.
- Cuando marco presente, retraso, ausente o justificado para cada socio, entonces se guarda en una sola operación, y repetirla corrige los datos en lugar de duplicarlos.

**ASI-02 · Justificar una ausencia** (Fase 1)
Como músico quiero justificar mi falta.
- Dado mi registro `ABSENT`, cuando envío la justificación "enfermedad", entonces queda `PENDING`.
- Cuando el director la aprueba, entonces el estado pasa a `EXCUSED` y la justificación a `APPROVED`. Si la rechaza, el estado sigue `ABSENT`.

**ASI-03 · Estadísticas** (Fase 1)
Como director quiero ver el porcentaje de asistencia por socio, por sección y por evento en un periodo.
- Cuando filtro el trimestre, entonces veo el porcentaje global, una tabla por socio (presente, retraso, ausente, justificado y porcentaje) y la asistencia de cada evento.
- Los retrasos cuentan como asistencia y las ausencias justificadas no penalizan.

## 4. Tesorería (TES)

**TES-01 · Movimientos** (Fase 2)
Como tesorero quiero registrar ingresos y gastos por categoría, con su justificante.
- Cuando registro un gasto de 120,50 € en "Transporte", entonces aparece en el listado y en los informes (adjuntar el justificante en PDF está pendiente).

**TES-02 · Cuotas** (Fase 2)
Como tesorero quiero definir cuotas (mensuales, trimestrales, anuales o puntuales) y emitirlas a los socios activos.
- Cuando emito "Cuota trimestral" para el periodo `2026-Q4`, entonces se genera un recibo `PENDING` por cada socio activo.
- Emitirla otra vez para el mismo periodo no duplica recibos.

**TES-03 · Cobros** (Fase 2)
Como tesorero quiero marcar recibos como cobrados o condonados.
- Cuando marco un recibo como pagado, entonces se crea el ingreso correspondiente y el recibo pasa a `PAID` con `paidAt`.
- Pasada la fecha de vencimiento, los recibos pendientes pasan a `OVERDUE` en el proceso diario.

**TES-04 · Informes** (Fase 2)
Como tesorero quiero un informe anual para la asamblea.
- Cuando pido el año 2026, entonces obtengo ingresos, gastos y saldo; un gráfico mensual; el desglose por categoría y los recibos pendientes.
- Puedo exportar los movimientos en CSV (UTF-8, con separador `;` para Excel en español).

## 5. Mayordomía (MAY)

**MAY-01 · Inventario de uniformes** (Fase 2)
Como responsable de material quiero inventariar las prendas con código, talla y estado.
- Cuando doy de alta "Chaqueta gala T-48" con el código CH-012, entonces queda `AVAILABLE`.
- Un código no puede repetirse dentro de la banda.

**MAY-02 · Tallas de socios** (Fase 2)
Como responsable de material quiero conocer las tallas de cada socio para hacer los pedidos.
- Cuando consulto las tallas de "chaqueta", entonces veo el recuento por talla de los socios activos.

**MAY-03 · Entregas y devoluciones** (Fase 2)
Como responsable de material quiero registrar a quién entrego cada prenda y cómo me la devuelve.
- Cuando entrego CH-012 a Ana en estado "bueno", entonces la prenda pasa a `ASSIGNED` y el préstamo queda abierto.
- Cuando la devuelve "dañada", entonces el préstamo se cierra y la prenda queda con estado `DAMAGED`.
- Una prenda `ASSIGNED` no puede entregarse a otra persona (`409`).

## 6. Secretaría (SEC)

**SEC-01 · Fichas de socios** (Fase 1)
Como secretario quiero mantener las fichas de los socios con datos de contacto, instrumento y sección.
- Cuando creo un socio, entonces se le asigna el siguiente número de socio libre.
- El DNI se guarda cifrado y sólo lo ven quienes tienen `members:sensitive`. No se almacenan IBAN.

**SEC-02 · Altas y bajas** (Fase 1)
Como secretario quiero registrar las bajas con su fecha y motivo, y readmitir a antiguos socios.
- Cuando doy de baja a un socio, entonces su estado pasa a `LEFT`, deja de aparecer en convocatorias y cuotas, y se conserva su histórico.

**SEC-03 · Consentimientos RGPD** (Fase 1)
Como secretario quiero registrar los consentimientos de tratamiento de datos y de uso de imagen.
- Cuando marco el consentimiento, entonces queda la fecha (`consentDataAt`) y el estado de `consentImages`.

**SEC-04 · Derechos RGPD** (Fase 1)
Como secretario quiero atender las solicitudes de acceso y supresión de los socios.
- Cuando exporto a un socio, entonces descargo un JSON con sus datos personales, asistencias, recibos y préstamos.
- Cuando lo anonimizo, entonces su nombre, contacto, DNI, dirección y fecha de nacimiento se borran o sustituyen, se registra `anonymizedAt` y se conservan los agregados contables obligatorios.

**SEC-05 · Comunicaciones** (Fase 2)
Como secretario quiero enviar avisos a toda la banda o a secciones concretas.
- Cuando envío una comunicación a "Toda la banda" por email, entonces cada socio activo con email recibe el mensaje y una notificación en la app, y queda registrado el número de destinatarios.

**SEC-06 · Documentos** (Fase 1)
Como secretario quiero guardar actas, estatutos y documentos de cada socio.
- Cuando subo un acta en la categoría "Actas", entonces queda disponible para quien tenga `documents:read`.

## 7. Instrumentación (INS)

**INS-01 · Inventario** (Fase 2)
Como responsable de material quiero inventariar los instrumentos de la banda.
- Cuando doy de alta una tuba con número de serie, fecha y precio de compra, entonces aparece en el inventario con el estado `AVAILABLE`.

**INS-02 · Asignaciones** (Fase 2)
Como responsable de material quiero prestar instrumentos a los socios y saber quién tiene cada uno.
- Cuando asigno la tuba a Luis, entonces su estado pasa a `ASSIGNED` y la ficha muestra el historial de asignaciones.
- Cuando finalizo la asignación, entonces el instrumento vuelve a `AVAILABLE`.

**INS-03 · Mantenimiento y reparaciones** (Fase 2)
Como responsable de material quiero registrar las revisiones y reparaciones, con el taller y el coste.
- Cuando abro una reparación, entonces el instrumento pasa a `MAINTENANCE`.
- Cuando la cierro con un coste de 85 €, entonces el instrumento vuelve a `AVAILABLE` y el coste queda en su historial.

## 8. Agenda (AGE)

**AGE-01 · Calendario unificado** (Fase 1)
Como miembro quiero ver en un calendario los ensayos, las actuaciones, los vencimientos de cuotas y las devoluciones de material.
- Cuando abro la agenda del mes, entonces veo los elementos de los módulos que mi rol puede ver.

**AGE-02 · Sincronizar con mi calendario** (Fase 2)
Como músico quiero suscribirme a la agenda desde Google Calendar o desde el iPhone.
- Dado el plan Pro, cuando copio mi URL ICS personal, entonces el calendario externo muestra los eventos y se actualiza solo.
- Si regenero la URL, entonces la anterior deja de funcionar.

## 9. BandMarket (MKT)

**MKT-01 · Publicar un anuncio** (Fase 3)
Como responsable de material quiero vender un instrumento que la banda ya no usa.
- Cuando creo un anuncio con fotos y lo envío a revisión, entonces queda `PENDING_REVIEW` y no lo ve ninguna otra banda.

**MKT-02 · Moderación** (Fase 3)
Como equipo de plataforma quiero revisar los anuncios antes de publicarlos.
- Cuando apruebo un anuncio, entonces pasa a `PUBLISHED` y lo ven todas las bandas con `market:read`.
- Cuando lo rechazo con una nota, entonces pasa a `REJECTED` y la banda vendedora puede editarlo y reenviarlo.

**MKT-03 · Contactar con la banda vendedora** (Fase 3)
Como banda compradora quiero preguntar por un anuncio.
- Cuando envío una consulta, entonces sólo la ven mi banda y la vendedora, y la vendedora recibe una notificación.

**MKT-04 · Denunciar un anuncio** (Fase 3)
Como usuario quiero denunciar un anuncio fraudulento.
- Cuando lo denuncio, entonces aparece en la cola de moderación de la plataforma.

**MKT-05 · Aislamiento del marketplace** (Fase 3)
Como banda vendedora quiero que nadie más pueda modificar mis anuncios ni leer mis borradores.
- Dada otra banda, cuando intenta un `PATCH` o pide un anuncio `DRAFT` mío, entonces recibe `404`.

---

## Panel global de plataforma (ADM)

**ADM-01 · Gestionar tenants** (Fase 1)
Como equipo de plataforma quiero buscar bandas y ver su plan, estado y uso.
- Dado `isPlatformAdmin`, cuando busco por nombre o slug, entonces veo el estado, el plan, el número de usuarios y socios, el almacenamiento y la suscripción.
- Cuando suspendo un tenant, entonces sus usuarios pierden el acceso (`401 TENANT_ACCESS_REVOKED`) y el cambio queda en la auditoría del tenant (`platform.tenant.updated`).

**ADM-02 · Gestionar planes** (Fase 1)
Como equipo de plataforma quiero ajustar los límites y los price IDs de cada plan.
- Cuando cambio `maxMembers` del plan Basic, entonces se aplica a todos sus tenants en la siguiente comprobación de límites.

**ADM-03 · Incidencias** (Fase 1)
Como propietario quiero abrir una incidencia de soporte, y como plataforma quiero atenderla.
- Cuando abro una incidencia, entonces aparece en el panel global en estado `OPEN`.
- Cuando la plataforma la resuelve, entonces la banda ve el estado y la resolución.

**ADM-04 · Métricas** (Fase 2)
Como equipo de plataforma quiero ver el MRR, los tenants por estado y la cola de moderación.
- Cuando abro el panel, entonces veo estos indicadores calculados con los datos actuales.

## Requisitos no funcionales (NFR)

**NFR-01 · Accesibilidad.** Se cumple WCAG 2.2 AA en las pantallas principales: navegación completa con teclado, foco visible, contraste de 4,5:1 o más y formularios con etiquetas y errores asociados.
**NFR-02 · Responsive.** Todas las pantallas se pueden usar a 360px de ancho, sin scroll horizontal.
**NFR-03 · Rendimiento.** El percentil 95 de la API es inferior a 300 ms en listados paginados con 10.000 registros por tenant.
**NFR-04 · Logs.** Ningún log contiene contraseñas, tokens, DNI, IBAN ni emails en claro. Lo comprueba un test.
**NFR-05 · Copias de seguridad.** RPO de 24 horas o menos (5 minutos con PITR gestionado) y RTO de 4 horas o menos. Se hace una prueba de restauración cada mes.
