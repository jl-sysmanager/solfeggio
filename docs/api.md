# API Solfeamos v1

Base: `/api/v1` · JSON · OpenAPI generado en `/api/docs` (Swagger UI) y `/api/docs-json`.

## Convenciones

- **Autenticación:** `Authorization: Bearer <accessToken>` (JWT, 15 min). El refresh token va en cookie
  `httpOnly; Secure; SameSite=Strict` llamada `sf_rt`, con path `/api/v1/auth`, y rota en cada uso.
  Si se reutiliza un token ya rotado, se revoca toda la familia de tokens.
- **Tenant:** el access token lleva el claim `tid` del tenant activo, que se elige con
  `POST /auth/switch-tenant`. **Ninguna ruta acepta el tenant por parámetro**, así que no se puede
  manipular desde la URL ni desde el cuerpo de la petición.
- **Paginación:** `?page=1&pageSize=25` → `{ data: T[], total, page, pageSize }`.
- **Errores:** `{ statusCode, error, message, code?, details? }`. Un recurso de otro tenant devuelve
  **404** (nunca 403), para no revelar que existe.
- **Códigos de negocio y estado HTTP:**

  | Estado | Códigos |
  |---|---|
  | 400 | `VALIDATION_ERROR`, `MIME_NOT_ALLOWED`, `FILE_TOO_LARGE`, `INVALID_FILE_KEY`, `UPLOAD_MISSING`, `INVITATION_INVALID`, `SYSTEM_ROLE`, `ROLE_IN_USE`, `LAST_OWNER`, transiciones no permitidas (`ITEM_NOT_AVAILABLE`, `CHARGE_CLOSED`, `INVALID_TRANSITION`…) |
  | 401 | `UNAUTHENTICATED`, `TOKEN_INVALID`, `INVALID_CREDENTIALS`, `MFA_REQUIRED`, `MFA_INVALID`, `ACCOUNT_LOCKED`, `REFRESH_INVALID`, `REFRESH_REUSED`, `TENANT_ACCESS_REVOKED` (membresía revocada o banda suspendida) |
  | 403 | `FORBIDDEN`, `TENANT_REQUIRED`, `FEATURE_NOT_IN_PLAN`, `PLAN_LIMIT`, `TENANT_READ_ONLY` |
  | 404 | `NOT_FOUND`: id inexistente **o de otro tenant**, incluidas las referencias en el cuerpo |
  | 409 | `DUPLICATE`, `EMAIL_TAKEN`, `SLUG_TAKEN` |
  | 429 | Rate limiting |
  | 503 | `BILLING_NOT_CONFIGURED` (sin `STRIPE_SECRET_KEY`) |

- **Validación:** zod; los campos desconocidos se descartan y los ids de ruta deben ser UUID.
- **Importes:** en céntimos (`amountCents`). **Fechas:** ISO-8601 en UTC; las de tipo `date`, como `YYYY-MM-DD`.
- **Rate limiting:** 120 peticiones/min por IP (en memoria de cada instancia); en registro, login y
  aceptación de invitaciones, 10 por minuto, y en refresh, 30. Al superarlo se responde `429` con la
  cabecera `Retry-After`. Webhooks y health están excluidos.

## Autenticación y onboarding

| Método | Ruta | Cuerpo / query | Respuesta |
|---|---|---|---|
| POST | `/auth/register` | `{ email, password, name }` | `{ user }` |
| POST | `/auth/login` | `{ email, password, mfaCode? }` | `{ accessToken, user, memberships[] }` · 401 `MFA_REQUIRED` |
| POST | `/auth/refresh` | cookie | `{ accessToken }` |
| POST | `/auth/logout` | — | 204 |
| POST | `/auth/switch-tenant` | `{ tenantId }` | `{ accessToken, session }` |
| GET | `/auth/me` | — | `session` |
| GET | `/auth/profile` | — | `{ user, member? }` (ficha vinculada de la banda activa) |
| PATCH | `/auth/profile` | `{ name }` | `{ user }` |
| PATCH | `/auth/profile/member` | `{ firstName?, lastName?, phone?, address?, instrument?, consentImages? }` | `{ member }` · requiere banda activa y vínculo |
| POST | `/auth/leave-tenant` | `{ password, tenantId? }` | `{ accessToken, session }` · 400 `LAST_OWNER` |
| POST | `/auth/close-account` | `{ password, confirm: "ELIMINAR" }` | 204 · anonimiza usuario |
| POST | `/auth/mfa/setup` | — | `{ otpauthUrl, qrDataUrl }` |
| POST | `/auth/mfa/enable` · `/auth/mfa/disable` | `{ code }` | 204 |
| POST | `/auth/password/change` | `{ currentPassword, newPassword }` | 204 |
| POST | `/auth/invitations/accept` | `{ token, name?, password? }` | `{ accessToken, session }` |
| GET | `/plans` | público | `Plan[]` |
| POST | `/onboarding` | `{ bandName, slug, country?, timezone? }` | `{ accessToken, session }` · crea al propietario como socio nº 1 + usuario |

```ts
type Membership = { tenantId; tenantName; slug; roleKey; roleName };
type Session = {
  user: { id; email; name; mfaEnabled; isPlatformAdmin };
  tenant: { id; name; slug; status; timezone } | null;
  role: { id; key; name } | null;
  permissions: string[];
  plan: { code; name; features: string[]; maxUsers; maxMembers; storageMb } | null;
  memberId: string | null;
  memberships: Membership[];
};
```

## Rutas con tenant (requieren `tid`)

Cada ruta exige un permiso, indicado entre corchetes; algunas exigen además una funcionalidad del plan, indicada entre llaves.

### Tenant, usuarios, roles y auditoría
- `GET /tenant` · `PATCH /tenant` [tenant:manage]
- `GET /dashboard` → `{ members: { active, total }, nextEvents: Event[], pendingCharges: { count, amountCents }, attendanceRate30d (fracción 0–1), storage: { usedBytes, limitBytes }, users: { used, limit } }`
- `GET /permissions` → catálogo `{ key, group, label }[]`
- `GET|POST /roles`, `PATCH|DELETE /roles/:id` [roles:manage] (los roles de sistema no se pueden borrar)
- `GET /users`, `PATCH /users/:membershipId { roleId?, status? }`, `DELETE /users/:membershipId` [users:manage]
- `GET|POST /invitations { email, roleId, memberId?, createMember?: { firstName, lastName } }` · `DELETE /invitations/:id` [users:manage] (`createMember` exige también `members:write`). El email lleva el enlace `${APP_URL}/invite/<token>`, válido 7 días; las invitaciones pendientes cuentan para el límite de usuarios.
- `GET /audit-logs?entity&actorId&page` [audit:read]

### Secretaría {members}
- `GET /members?q&status&sectionId&page` [members:read] → `Member[]`. Sin el permiso `members:sensitive`, la respuesta omite `nationalId`.
- `POST /members`, `GET|PATCH /members/:id` [members:write]
- `POST /members/:id/leave { date, reason }` (baja) · `POST /members/:id/rejoin` (alta)
- `PUT /members/:id/sizes [{ garment, size }]`
- `GET /members/:id/export` (RGPD: acceso y portabilidad) · `POST /members/:id/anonymize` (RGPD: supresión) [members:write + members:sensitive]
- La búsqueda `q` ignora tildes y mayúsculas (nombre, apellidos, email, instrumento o número de socio). Los campos de texto vacíos (`''`) se tratan como `null`; el consentimiento se puede enviar como `consentData: boolean` o `consentDataAt: ISO`.
- `GET|POST /sections`, `PATCH|DELETE /sections/:id`
- `GET /communications` · `POST /communications { subject, body, channel: EMAIL|IN_APP, audience: { all } | { sectionIds } | { memberIds } }` [communications:send] {communications}
- `GET /documents?category` [documents:read] · `POST /documents/upload-url { fileName, mimeType, sizeBytes }` → `{ uploadUrl, fileKey }` · `POST /documents { title, category, fileKey, fileName, mimeType, sizeBytes, memberId? }` · `GET /documents/:id/download` → `{ url }` · `DELETE /documents/:id` [documents:write]

### Archivo musical {archive}
- `GET|POST /composers`, `PATCH /composers/:id`
- `GET /works?q&tag&genre&composerId&page` [archive:read]. Búsqueda de texto completo en español que ignora tildes.
- `POST /works`, `GET|PATCH|DELETE /works/:id` → la obra incluye `{ composer, versions[], assets[] }`
- `POST /works/:id/versions { name, arranger?, notes? }`
- `POST /works/:id/assets/upload-url { fileName, mimeType, sizeBytes }` → `{ uploadUrl, fileKey }`
- `POST /works/:id/assets { kind: SCORE|PART|AUDIO|OTHER, instrument?, versionId?, fileKey, fileName, mimeType, sizeBytes }`
- `GET /assets/:id/download?inline=1` → `{ url, mimeType, fileName }` (URL prefirmada, válida 5 min; `inline` para previsualizar) · `DELETE /assets/:id`
- `GET /tags` → `{ tag, count }[]`

### Ensayos, actuaciones y agenda {events}
- `GET /events?from&to&type` [events:read] · `POST /events` · `GET|PATCH /events/:id` · `POST /events/:id/cancel` [events:write]
- `Event = { id, type: REHEARSAL|PERFORMANCE|MEETING|OTHER, title, description, location, startsAt, endsAt, status, reminderMinutes[], counts?: { called, accepted, declined } }`
- `GET /events/:id` → `Event & { repertoire: { work, position, notes }[], calls: { member, response, note }[], attendance: Attendance[] }`
- `PUT /events/:id/repertoire [{ workId, notes? }]` [events:write]
- `POST /events/:id/calls { all? | sectionIds? | memberIds? }` [calls:manage]. Crea convocatorias y notifica a los convocados.
- `POST /events/:id/respond { response: ACCEPTED|DECLINED, note? }`. Responde el propio músico.
- `GET /agenda?from&to` → `AgendaItem[] { id, kind: event|fee_due|loan_due, title, startsAt, endsAt?, link }`
- `GET /agenda/ics-url` → `{ url }` {calendar_sync} · público: `GET /calendar/:token.ics`

### Asistencia {attendance}
- `PUT /events/:id/attendance [{ memberId, status: PRESENT|LATE|ABSENT|EXCUSED }]` [attendance:write]
- `POST /attendance/:id/justification { text }`. La envía el propio músico [attendance:self].
- `POST /attendance/:id/review { approved: boolean }` [attendance:write]
- `GET /attendance/me` → asistencias del socio vinculado al usuario [attendance:self o attendance:read]
- `GET /attendance/stats?from&to&sectionId` [attendance:read]. Las tasas (`overallRate`, `rate`) son fracciones de 0 a 1 (presente + retraso entre registros) → `{ overallRate, byMember: { member, present, late, absent, excused, rate }[], byEvent: { event, present, total }[] }`

### Tesorería {treasury}
- `GET|POST /finance/categories`
- `GET /finance/transactions?from&to&kind&categoryId&page` [finance:read] · `POST` · `DELETE /finance/transactions/:id` [finance:write]
- `GET|POST /finance/fees`, `PATCH /finance/fees/:id`
- `POST /finance/fees/:id/issue { period, dueDate }`. Emite cuotas a todos los socios activos y es idempotente por `(cuota, socio, periodo)`.
- `GET /finance/charges?status&period&memberId&page` · `POST /finance/charges/:id/pay { date }` (genera el ingreso) · `POST /finance/charges/:id/waive`
- `GET /finance/reports/summary?year` → `{ year, incomeCents, expenseCents, balanceCents, monthly: { month, incomeCents, expenseCents }[], byCategory: { category, kind, totalCents }[], pendingCharges: { count, amountCents } }`
- `GET /finance/reports/transactions.csv?year`

### Mayordomía {wardrobe}
- `GET /wardrobe/items?status&garment` · `POST` · `PATCH /wardrobe/items/:id`
- `POST /wardrobe/items/:id/deliver { memberId, dueAt?, conditionOut }` (entrega)
- `GET /wardrobe/loans?open=true` · `POST /wardrobe/loans/:id/return { conditionIn, notes? }` (devolución)
- `GET /wardrobe/sizes?garment` → tallas de los socios activos, para planificar pedidos

### Instrumentación {instruments}
- `GET /instruments?status&type&q` · `POST` · `GET|PATCH /instruments/:id` (incluye asignaciones y mantenimientos)
- `POST /instruments/:id/assign { memberId, notes? }` · `POST /instrument-assignments/:id/end`
- `POST /instruments/:id/maintenance { type: MAINTENANCE|REPAIR, description, provider?, costCents? }`
- `POST /maintenance/:id/complete { costCents? }`

### Notificaciones e incidencias
- `GET /notifications?unread=true` · `POST /notifications/:id/read` · `POST /notifications/read-all`
- `GET|POST /incidents { subject, body, priority? }`

### BandMarket {market}
- `GET /market/listings?q&category&page` → anuncios publicados de **todas** las bandas, con `{ seller: { name } }`
- `GET /market/listings/:id` (publicado o propio) · `GET /market/listings/mine` [market:read]
- `POST /market/images/upload-url { fileName, mimeType, sizeBytes }` → `{ uploadUrl, fileKey }` (PNG, JPEG o WebP; las claves se pasan en `imageKeys`, máx. 8)
- `POST /market/listings` · `PATCH /market/listings/:id` (sólo en DRAFT o REJECTED; vuelve a DRAFT) [market:write]
- `POST /market/listings/:id/submit` → PENDING_REVIEW · `POST /market/listings/:id/sold` · `POST /market/listings/:id/archive`
- `POST /market/listings/:id/inquiries { message }` · `GET /market/inquiries` (enviadas y recibidas)
- `POST /market/listings/:id/report { reason }`

### Archivo: SGAE, libretos, préstamos y particellas {archive}
- `GET /archive/reports/sgae?from&to&format=json|csv` [archive:read + events:read] → actuaciones no canceladas del periodo (en la zona horaria de la banda, máx. 2 años) con su repertorio: fecha, evento, lugar, obra, compositor, arreglista, duración, editorial y catálogo. Son los datos para la declaración a la SGAE, no un envío. CSV con `;`, BOM y fórmulas neutralizadas.
- `POST /works/:id/assets/:assetId/detect-parts` {archive_ai} [archive:write] → `{ pages, ocrRequired, suggestions: [{ instrument, fromPage, toPage, confidence }] }`. Lee la capa de texto del PDF; con un escaneo sin texto devuelve `ocrRequired: true` (el OCR no está implementado).
- `POST /works/:id/assets/:assetId/split { versionId?, parts: [{ instrument, fromPage, toPage }] }` {archive_ai} [archive:write] → crea una particella (PART) por rango y reserva cuota. Errores `NOT_A_PDF`, `INVALID_ASSET_KIND`, `PAGE_OUT_OF_RANGE`.
- `GET|POST /booklets` · `GET|PATCH|DELETE /booklets/:id` · `PUT /booklets/:id/items [{ workId, label? }]` (400 `DUPLICATE_WORK`)
- `GET /booklets/:id/instruments` · `GET /booklets/:id/pdf?instrument=` → PDF combinado con índice (las obras sin esa particella figuran como «falta»)
- `GET /score-loans?status=all|open|overdue|returned&direction&workId` · `POST /score-loans` · `PATCH|DELETE /score-loans/:id` · `POST /score-loans/:id/return { date? }` · `GET /works/:id/loans`

### Plantilla mínima y logística {performances}
- `GET /events/:id/staffing` [events:read] → por instrumento: requeridos, confirmados, pendientes, rechazados y vacantes (el instrumento del socio se compara sin tildes ni mayúsculas)
- `PUT /events/:id/requirements [{ instrument, required }]` [events:write]
- `POST /events/:id/staffing/alert { call? }` [events:write; `call: true` exige además calls:manage] → avisa a los socios activos de los instrumentos con vacantes que no están convocados y, opcionalmente, los convoca
- `GET|PUT /events/:id/logistics` [events:read / events:write] (transporte, salida, regreso, recorrido, uniforme, notas; el PUT sustituye el registro)

### Contrataciones y facturación {performances}
Lectura [performances:read], escritura [performances:write].
- `GET|POST /performances/clients` · `GET|PATCH|DELETE /performances/clients/:id` (no se borra con presupuestos o facturas)
- `GET /performances/quotes?status&clientId` · `POST /performances/quotes` · `GET|PATCH|DELETE /performances/quotes/:id` (editable sólo en DRAFT). Numeración correlativa por banda y totales calculados en el servidor.
- `POST /performances/quotes/:id/send` · `…/reject` · `…/sign { signedBy, contractTerms? }` (contrato aceptado) · `…/event { startsAt?, endsAt? }` [+ events:write] crea la actuación
- `GET /performances/invoices?series&status&clientId` · `GET /performances/invoices/:id` · `POST /performances/invoices` (`{ quoteId }` o `{ clientId, lines, taxRatePct }`, con `series` e `issueDate`)
- `POST /performances/invoices/:id/pay { date }` → ingreso en «Actuaciones» · `…/cancel` · `…/rectify { reason, series = "R", lines? }` (rectificativa, no supera el original)
- `GET /performances/invoices/verify?series=` → recalcula la cadena de huellas y señala roturas (`HASH_MISMATCH`)
- Las facturas son inalterables (trigger en la base de datos) y encadenan la huella SHA-256 de la anterior de su serie, como prevé VeriFactu. El envío a la AEAT no está implementado.

### Bolsa de refuerzos {reinforcements}
- Cualquier usuario de la banda: `GET|PUT|DELETE /reinforcements/profile` (perfil de músico global) · `GET /reinforcements/requests?instrument&province&from&to&page` (necesidades abiertas de todas las bandas, con el nombre de la banda) · `POST /reinforcements/requests/:id/apply { message }` · `GET /reinforcements/my-applications` · `POST /reinforcements/my-applications/:id/withdraw`
- [reinforcements:manage]: `GET /reinforcements/requests/mine` · `GET /reinforcements/requests/prefill?eventId` (vacantes de la plantilla) · `POST /reinforcements/requests` · `PATCH|DELETE /reinforcements/requests/:id` · `GET /reinforcements/requests/:id/applications` · `POST /reinforcements/applications/:id/accept|reject`
- [reinforcements:manage]: `GET /reinforcements/musicians?instrument&province` (sin email ni teléfono) · `POST /reinforcements/musicians/:profileId/contact { requestId, message }` (la plataforma envía el email; la banda no lo ve)
- [reinforcements:manage]: `GET|POST /reinforcements/external-musicians` · `PATCH|DELETE /reinforcements/external-musicians/:id` (NIF cifrado; en claro sólo con members:sensitive)
- [reinforcements:manage]: `GET /reinforcements/payments?year` · `POST /reinforcements/payments` · `PATCH|DELETE /reinforcements/payments/:id` (sin pagar) · `POST /reinforcements/payments/:id/pay { date }` → gasto neto en «Refuerzos» · `GET /reinforcements/payments/summary?year` · `GET /reinforcements/payments/summary.csv?year` [+ members:sensitive] (datos para los modelos 111 y 190)

### Escuela de música {school}
Lectura [school:read], escritura [school:write], docencia [school:teach]. Un profesor vinculado a un usuario sin school:write sólo actúa sobre sus grupos (403 `NOT_YOUR_GROUP`).
- `GET|PUT /school/settings` (descuentos por hermanos, por socio y por varias asignaturas; texto público)
- Familias y tutores: `GET|POST /school/families?q` · `GET|PATCH|DELETE /school/families/:id` · `POST /school/families/:id/guardians` · `PATCH|DELETE /school/guardians/:id` · `POST /school/guardians/:id/invite` (invitación al portal con el rol Familia; 409 `ALREADY_LINKED`). NIF del tutor cifrado; en claro y editable sólo con members:sensitive.
- Alumnos: `GET /school/students?q&status&familyId&groupId&page` · `POST /school/students` (403 `PLAN_LIMIT` según plazas) · `GET|PATCH /school/students/:id` · `GET /school/students/:id/report-card?yearId` (boletín) · `POST /school/students/:id/promote { stage: EDUCANDO|MUSICIAN, sectionId? }` [+ members:write] crea la ficha de socio
- Cursos: `GET|POST /school/years` · `PATCH /school/years/:id` (festivos, matrícula abierta, curso actual) · `POST /school/years/:id/copy-from { sourceYearId, renewEnrollments }` (renovación) · `GET /school/years/:id/conflicts`
- `GET|POST /school/subjects` · `PATCH /school/subjects/:id` · `GET|POST /school/teachers` · `PATCH /school/teachers/:id` · `GET /school/staff-users` · `GET|POST /school/rooms` · `PATCH|DELETE /school/rooms/:id`
- Grupos y horario: `GET /school/groups?yearId&mine=true` · `POST /school/groups` · `GET|PATCH|DELETE /school/groups/:id` · `POST /school/groups/:id/slots { weekday, startMin, endMin, roomId?, force? }` · `PATCH|DELETE /school/slots/:id`. Un solapamiento de aula, profesor o alumno devuelve 409 `SCHEDULE_CONFLICT` salvo con `force`.
- Matrículas: `POST /school/enrollments { studentId, groupId }` (lista de espera si el grupo está lleno) · `POST /school/enrollments/:id/withdraw` (promociona al primero en espera) · `GET /school/applications?yearId&status` · `PATCH /school/applications/:id` (prueba de acceso) · `POST /school/applications/:id/accept { familyId?, studentId?, groupIds }` · `…/waitlist` · `…/reject`
- Clases: `GET /school/groups/:id/sessions?from&to` · `POST /school/groups/:id/sessions/generate { from, to }` (idempotente, salta festivos) · `GET /school/sessions/:id` [school:teach] · `POST /school/sessions/:id/cancel` · `POST /school/sessions/:id/make-up { date, startMin, endMin }` · `PUT /school/sessions/:id/attendance`
- Notas: `GET /school/groups/:id/grades?term` · `PUT /school/groups/:id/grades { term, grades }` [school:teach]
- Avisos: `GET /school/notices?groupId` · `POST /school/notices { groupId?, title, body }` · `DELETE /school/notices/:id` [school:teach]
- Mensualidades [finance:read / finance:write]: `POST /school/tuition/issue { yearId, period, dueDate }` (idempotente) · `GET /school/tuition/charges?yearId&period&status&familyId&studentId` · `POST /school/tuition/charges/:id/pay { date }` → ingreso en «Escuela de música» · `…/waive` · `GET /school/tuition/export.csv?period&status` (una fila por familia con importes; no incluye IBAN)
- Portal de familias [school:family]: `GET /school/family` → alumnos de la familia, horarios, faltas, notas, recibos y avisos
- Públicas (sin autenticación, con limitación de peticiones): `GET /public/schools/:slug/offer` · `POST /public/schools/:slug/applications` (consentimiento obligatorio). 404 si la banda no tiene la escuela o no hay matrícula abierta.

### Gobierno {governance}
Lectura [governance:read], escritura [governance:write], voto [governance:vote].
- Asambleas: `GET|POST /governance/assemblies` · `GET /governance/assemblies/:id` · `PATCH` (DRAFT o CONVENED) · `DELETE` (DRAFT) · `POST …/:id/convene` (avisa por email a los socios activos) · `…/hold` · `…/close`
- `PUT /governance/assemblies/:id/attendance [{ memberId, proxyForId? }]` (máx. 2 delegaciones por asistente) · `GET …/:id/quorum` → `{ activeMembers, present, represented, total, requiredFirstCall, metFirstCall }`
- Votaciones: `POST /governance/assemblies/:id/motions` · `GET|PATCH|DELETE /governance/motions/:id` · `POST …/:id/open|close` · `POST /governance/motions/:id/vote { choice, onBehalfOf? }` [governance:vote] (voto telemático si `allowRemote`; un voto por socio) · `PUT /governance/motions/:id/votes` (voto en sala)
- Actas: `POST /governance/assemblies/:id/minutes/draft { overwrite? }` (borrador por plantilla) · `PUT …/minutes` · `POST …/minutes/approve` (después, 409 `MINUTES_APPROVED`) · `GET /governance/minutes` (libro de actas)
- Junta: `GET /governance/board?current=true` · `POST /governance/board` · `PATCH|DELETE /governance/board/:id`
- Encuestas: `GET|POST /governance/polls` · `PATCH|DELETE /governance/polls/:id` · `POST …/:id/close` · `POST …/:id/vote { choices }` [governance:vote] · `GET …/:id/results`

### Tesorería: subvenciones, lotería y donantes {treasury}
Lectura [finance:read], escritura [finance:write].
- Subvenciones: `GET /finance/grants?year&status` · `POST /finance/grants` · `GET|PATCH|DELETE /finance/grants/:id` · `POST /finance/grants/:id/transactions { transactionIds, linked }` · `GET /finance/grants/:id/justification` (y `.csv`)
- Lotería: `GET|POST /finance/lottery/draws` · `GET|PATCH|DELETE /finance/lottery/draws/:id` · `GET /finance/lottery/draws/:id/summary` · `POST /finance/lottery/draws/:id/books` · `PATCH|DELETE /finance/lottery/books/:id` · `POST /finance/lottery/books/:id/settle { returnedTickets, paidCents, date }` → ingreso en «Lotería»
- Donantes: `GET|POST /finance/donors` · `GET|PATCH|DELETE /finance/donors/:id` (NIF cifrado; en claro sólo con members:sensitive) · `GET /finance/donations?year&donorId` · `POST /finance/donors/:id/donations { …, createTransaction? }` · `PATCH|DELETE /finance/donations/:id` · `GET /finance/donors/:id/certificate?year`
- `GET /finance/reports/modelo182.csv?year` [+ members:sensitive] → datos para el gestor (entidades acogidas a la Ley 49/2002), no el fichero oficial de la AEAT
- `DELETE /finance/transactions/:id` devuelve 400 `LINKED_TO_CHARGE` si el movimiento procede de una cuota, mensualidad, factura, pago a refuerzo, liquidación de lotería o donativo.

### Facturación [billing:manage]
- `GET /billing` → `{ billingEnabled, plan, subscription: { status, interval, currentPeriodEnd, trialEndsAt, cancelAtPeriodEnd, graceUntil }, usage: { users, members, storageBytes }, invoices: Invoice[] }`
- `POST /billing/checkout { planCode, interval: MONTH|YEAR }` → `{ url }`. Stripe Checkout con prueba gratuita, códigos promocionales e impuesto automático.
- `POST /billing/portal` → `{ url }` (Stripe Customer Portal)
- `POST /webhooks/stripe`: público, con firma verificada (400 si falta o no es válida) e idempotente por `event.id`. Responde `{ received: true, result: "processed" | "duplicate" | "ignored" }`, o 500 si falla el procesamiento para que Stripe reintente.
- Checkout vuelve a `${APP_URL}/billing?checkout=success|cancel`; el portal, a `${APP_URL}/billing`.

## Panel global (`isPlatformAdmin`, sin tenant)
- `GET /admin/summary` → `{ support: { open, overdue }, moderation: { pending } }`: pendientes para los avisos del menú lateral (incidencias abiertas y fuera de plazo; anuncios por revisar y denuncias sin resolver)
- `GET /admin/metrics` → `{ tenants: { total, byStatus }, mrrCents, openIncidents, pendingListings }`
- `GET /admin/tenants?q&status&page` · `GET /admin/tenants/:id` · `PATCH /admin/tenants/:id { status?, planCode?, addons?, studentSeats? }` (add-ons y plazas de alumno del add-on Escuela)
- `GET /admin/plans` · `PATCH /admin/plans/:id`
- `GET /admin/market/pending` (con `waitingHours` y `slaBreached` frente a las 24 h) · `POST /admin/market/listings/:id/moderate { approve, note? }`
- `GET /admin/integrations` → categorías (`payments`, `email`) con sus proveedores, la definición de sus campos y el estado actual `{ source: database|env|none, provider, enabled, config, secrets: { clave: { set, hint } }, updatedAt, updatedBy }`. Los secretos nunca se devuelven: sólo si existen y sus 4 últimos caracteres (si miden 12 o más).
- `PUT /admin/integrations/:category { provider, enabled, config?, secrets? }`. En `config` y `secrets`, una clave ausente conserva el valor guardado, `null` lo borra y un valor nuevo lo sustituye. Para habilitar, los campos obligatorios deben estar completos (400 `VALIDATION_ERROR` con `details[].path` = `config.x` o `secrets.x`). Cambiar de proveedor descarta los secretos del anterior.
- `DELETE /admin/integrations/:category` → borra la configuración guardada y vuelve a las variables de entorno.
- `POST /admin/integrations/:category/test { to? }` → `{ ok, message }`. Prueba la configuración guardada aunque esté deshabilitada: correo envía un mensaje de prueba; pagos consulta el saldo de Stripe. Limitado a 5/min.
- `GET /admin/audit-logs?entity&page` → auditoría de plataforma (cambios y pruebas de integraciones, sin valores secretos).

### Negocio y salud de las bandas (Fase 7, bloque 1)
Todas las rutas de `/admin/insights` son sólo de plataforma y rechazan los tokens de «ver como» (403 `IMPERSONATION_FORBIDDEN`).
- `POST /admin/insights/snapshot { date? }` → foto de cada banda para esa fecha (el worker la hace cada noche a las 02:30). Cada foto guarda MRR (incluido el add-on Escuela), usuarios activos, socios, alumnos, uso por módulo y puntuación de salud. Una fecha pasada sólo incluye las bandas que ya existían.
- `GET /admin/insights/metrics?months=12` → `current` (MRR, ARR, ingreso medio por banda, retención neta), `months[]` (altas, reactivaciones, mejoras, bajadas, bajas, retención neta), bandas por estado y estacionalidad. Con pocos datos, cada mes hereda la última foto anterior.
- `GET /admin/insights/funnel?from&to` → registro → banda creada → onboarding → prueba → pago, con la conversión de cada paso
- `GET /admin/insights/cohorts` → % de bandas activas a los 3, 6 y 12 meses por mes de alta
- `GET /admin/insights/health?sort&risk&q&status&plan&page` · `GET /admin/insights/at-risk` · `GET /admin/insights/upsell` → puntuación y uso por banda; listas de bandas en riesgo y listas para mejorar de plan, con `reasons[]`
- `GET /admin/insights/tenants/:id` (ficha con límites, tendencia a 90 días, contactos y cronología) · `GET …/:id/timeline` · `PATCH …/:id { tags?, accountManagerId? }` · `GET /admin/insights/managers` · `POST …/:id/notes` · `DELETE …/:id/notes/:noteId`
- **«Ver como»:** `POST /admin/impersonation { tenantId, reason (mín. 10 caracteres), minutes (5–60) }` → `{ accessToken, expiresAt, session }` · `GET /admin/impersonation?tenantId` (historial) · `POST /admin/impersonation/:id/end` · `POST /impersonation/end` (con el propio token). Acceso de sólo lectura: permisos `*:read` sin `members:sensitive`, 403 `IMPERSONATION_READ_ONLY` en cualquier escritura, 401 `IMPERSONATION_ENDED` al terminar o caducar. Inicio y fin quedan en la auditoría de la banda (`platform.impersonation.*`).

**Puntuación de salud (0–100):** amplitud de uso (7 puntos por cada módulo con actividad en 30 días, máx. 35) + usuarios activos (máx. 30) + recencia de la última actividad (máx. 35), menos 15 con pago pendiente y 30 en sólo lectura; 0 si está cancelada o suspendida.

### Facturación (Fase 7, bloque 2)
- `GET /admin/billing/dunning` · `GET /admin/billing/tenants/:id`
- `POST /admin/billing/tenants/:id/` `retry` (reintenta el cobro) · `remind` · `read-only` · `grace { days }` · `coupon { couponId }` · `credit { amountCents, description }` · `free-months { months }` · `extend-trial { days }` · `complimentary { until, reason, planCode }` · `sync-addons`; `DELETE …/:id/complimentary`
- `GET|POST /admin/billing/coupons` · `DELETE /admin/billing/coupons/:id` · `GET /admin/billing/addons`
- `GET /admin/billing/webhooks?type&status&page` · `GET …/:id` · `POST …/:id/replay` (vuelve a procesar el evento aunque ya estuviera procesado)
- Cuenta bonificada: sin cobro en Stripe hasta la fecha indicada; ni los webhooks, ni el periodo de gracia ni la sincronización la degradan, y al vencer pasa a Free (a no ser que tenga una suscripción de Stripe activa). Se avisa a los propietarios 7 días antes.
- Add-on Escuela: cuota fija mensual (`schoolAddonPrice`) y precio por plaza adicional (`schoolSeatPrice`, cantidad = `studentSeats`) en la suscripción mensual. Los precios salen de la integración de pagos o de `STRIPE_PRICE_SCHOOL_ADDON` y `STRIPE_PRICE_SCHOOL_SEAT`. `PATCH /admin/tenants/:id` sincroniza al cambiar add-ons o plazas, y `billing.reconcile-addons` lo repite cada noche. `GET /billing` de la banda incluye `addons[]`, `studentSeats` y `complimentaryUntil`.

### Soporte y avisos (Fase 7, bloque 2)
- Soporte [plataforma]: `GET /admin/support/kpis` · `GET /admin/support/agents` · `GET /admin/support/incidents?status&priority&assignee=none|me|<id>&sla=overdue|at_risk&tenantId&q` · `GET|PATCH /admin/support/incidents/:id { status?, priority?, assigneeId?, resolution? }` · `POST …/:id/messages { body, internal }` (la primera respuesta pública fija la primera respuesta y avisa a quien abrió la incidencia) · `GET|POST /admin/support/canned-replies` · `PATCH|DELETE …/:id`
- Soporte [banda, `incidents:write`]: `GET|POST /incidents` · `GET /incidents/:id` (sólo mensajes públicos) · `POST /incidents/:id/messages` (reabre una incidencia resuelta)
- SLA de primera respuesta por prioridad 1–5: 4, 8, 24, 48 y 72 horas. `support.sla-sweep` (cada 15 minutos) avisa una sola vez a los administradores y al responsable.
- Avisos [plataforma]: `GET|POST /admin/announcements` · `PATCH|DELETE …/:id` · `POST …/:id/end` · `POST /admin/announcements/preview { segment }` → `{ tenants, users }`
- Avisos [cualquier usuario autenticado]: `GET /announcements/active` · `POST /announcements/:id/dismiss`. El segmento combina plan, comunidad autónoma (`tenants.region`), funcionalidades y bandas concretas: se exigen todos los criterios y basta cualquier valor dentro de cada lista. El nivel `MAINTENANCE` llega a todos.

### Sistema y moderación (Fase 7, bloque 2)
- `GET /admin/ops/queues` · `POST /admin/ops/queues/failed/retry` · `POST|DELETE /admin/ops/queues/failed/:id/retry|…` · `GET /admin/ops/email` · `GET /admin/ops/storage` · `POST /admin/ops/storage/orphans/scan` · `POST /admin/ops/storage/orphans/delete { confirm: "ELIMINAR" }` · `GET /admin/ops/schedules` · `GET /admin/ops/heartbeats`
- `POST /ops/heartbeat/:name` (público, cabecera `x-ops-token` = `OPS_HEARTBEAT_TOKEN`; cuerpo `{ status: ok|error, detail? }`): lo usa `infra/backup/pg-backup.sh` con `BACKUP_HEARTBEAT_URL` y `BACKUP_HEARTBEAT_TOKEN`. El panel marca en rojo si pasan más de 26 horas. Los nombres `cron.*` y `storage.*` están reservados.
- `POST /webhooks/email/:provider` (público, cabecera `x-webhook-token` = `EMAIL_WEBHOOK_TOKEN`): `{ email, type: bounce|complaint, reason? }` o una lista de hasta 100. Se guarda en el registro de correo.
- Moderación: `GET /admin/moderation/kpis` · `GET /admin/moderation/reinforcements` · `POST /admin/moderation/reinforcements/reports/:id/resolve { action: dismiss|hide_request|hide_profile|block_user, note? }` · `GET /admin/moderation/users?q&blocked` · `POST /admin/moderation/users/:id/block { reason }` · `POST …/:id/unblock`. Un usuario bloqueado no inicia sesión (403 `ACCOUNT_BLOCKED`), no refresca tokens y deja de aparecer como músico disponible; no se puede bloquear a un administrador ni a uno mismo.
- Bolsa de refuerzos [banda]: `POST /reinforcements/requests/:id/report { reason }` · `POST /reinforcements/musicians/:profileId/report { reason }`

## Salud
- `GET /health` (liveness) · `GET /health/ready` (comprueba la base de datos y Redis) · `GET /metrics` (Prometheus; exige `Authorization: Bearer <METRICS_TOKEN>` si está definido; no exponer fuera de la red interna)

## Catálogo de permisos

`tenant:manage billing:manage users:manage roles:manage audit:read members:read members:write
members:sensitive communications:send documents:read documents:write archive:read archive:write
events:read events:write calls:manage attendance:read attendance:write attendance:self finance:read
finance:write wardrobe:read wardrobe:write instruments:read instruments:write market:read market:write
school:read school:write school:teach school:family performances:read performances:write
reinforcements:manage governance:read governance:write governance:vote incidents:write`

Roles de sistema: owner (Propietario), admin (Administrador), director, secretary (Secretario), treasurer (Tesorero), material_manager (Responsable de material), musician (Músico), collaborator (Colaborador), archivist (Archivero), teacher (Profesor) y family (Familia).

### Menú visible por rol

Cada entrada del menú aparece sólo si el rol tiene el permiso del módulo y el plan incluye la funcionalidad. Un rol personalizado se comporta igual según los permisos que se le marquen en Ajustes.

| Entrada del menú | Propietario | Administrador | Director | Secretario | Tesorero | Responsable de material | Músico | Colaborador | Archivero | Profesor | Familia |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Inicio | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Agenda | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · |
| Notificaciones | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Archivo musical | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · |
| Ensayos y actuaciones | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · |
| Asistencia | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| Contrataciones | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · |
| Escuela de música | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | · | ✓ | · |
| Portal de familias | ✓ | ✓ | · | · | · | · | · | · | · | · | ✓ |
| Socios | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · |
| Comunicaciones | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| Documentos | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · |
| Tesorería | ✓ | ✓ | · | · | ✓ | · | · | · | · | · | · |
| Mayordomía | ✓ | ✓ | ✓ | · | · | ✓ | · | · | · | · | · |
| Instrumentación | ✓ | ✓ | ✓ | · | · | ✓ | · | · | · | · | · |
| Gobierno | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | · | · |
| BandMarket | ✓ | ✓ | ✓ | · | · | ✓ | ✓ | · | ✓ | · | · |
| Bolsa de refuerzos | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · |
| Ajustes | ✓ | ✓ | · | ✓ | · | · | · | · | · | · | · |
| Plan y facturación | ✓ | · | · | · | · | · | · | · | · | · | · |
| Soporte | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | · | · |
| Mi cuenta | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

- **Inicio** muestra únicamente los indicadores de los módulos a los que el rol tiene acceso: socios (`members:read`), asistencia (`attendance:read`), cuotas pendientes (`finance:read` con tesorería en el plan) y almacenamiento y usuarios (`tenant:manage`, `billing:manage` o `users:manage`). Las familias de la escuela entran directamente en su portal.
- **Escuela:** el profesorado (`school:teach`) ve alumnos, grupos y clases, pero no el listado de familias, las solicitudes de matrícula ni el email de los tutores; eso queda para quien tiene `school:write`.
- `GET /roles/assignable` [users:manage] → roles que quien lo pide puede asignar o invitar (dentro de sus propios permisos, y el de propietario sólo si lo es).

## Funcionalidades por plan

| Plan | Usuarios | Socios | Almacenamiento | Funcionalidades |
|---|---|---|---|---|
| Free | 5 | 40 | 500 MB | members, archive, events, attendance |
| Basic (15 €/mes · 150 €/año) | 20 | 150 | 10 GB | + treasury, wardrobe, instruments, communications, performances, governance |
| Pro (35 €/mes · 350 €/año) | 80 | 400 | 100 GB | + market, calendar_sync, school, reinforcements, archive_ai |
| Enterprise (79 €/mes · 790 €/año) | ilimitado | ilimitado | 500 GB | mismas que Pro |

**Add-ons:** el panel global puede activar funcionalidades sueltas por banda (`tenants.addons`, p. ej. `school` en Basic) y sumar plazas de alumno (`tenants.studentSeats`). El cobro del add-on en Stripe no está automatizado.

Prueba gratuita de 14 días en los planes de pago, sólo para bandas que nunca han tenido suscripción. IVA calculado por Stripe Tax (`STRIPE_TAX_ENABLED`). Los valores viven en `apps/api/prisma/plans.ts` y se pueden editar desde el panel global.
