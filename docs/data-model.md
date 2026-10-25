# Modelo de datos

La fuente de verdad del modelo es [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma), y se aplica con estas migraciones:

- `0001_init`: tablas, índices y claves foráneas, generadas por Prisma.
- `0002_tenant_isolation`: políticas RLS, triggers `same_tenant`, búsqueda de texto completo, permisos del rol `solfeggio_app` y `audit_logs` en modo *append-only*.
- `0003_integrations`: configuración de integraciones y auditoría de plataforma (sólo rol de sistema).
- `0004_school_and_sector`: escuela de música, actuaciones y facturación, bolsa de refuerzos, libretos y préstamos de partituras, gobierno de la asociación, subvenciones, lotería y donantes. Incluye su RLS, sus triggers `same_tenant`, la inmutabilidad de las facturas emitidas, los add-ons por tenant y la actualización de planes y roles de sistema existentes.
- `0005_governance_fixups`: hasta dos delegaciones de voto por asistente en las asambleas.
- `0006_platform_ops`: panel global (Fase 7): fotos diarias por banda, notas, sesiones de «ver como», conversación y SLA de incidencias, respuestas predefinidas, avisos, registro de correos, latidos de procesos, denuncias de la bolsa de refuerzos, bloqueo de usuarios y cuentas bonificadas.

Convenciones:

- Los identificadores son UUID.
- Todas las tablas de negocio tienen la columna física `tenant_id`. En Prisma se llama `tenantId` y se mapea con `@map`.
- Los importes van en céntimos (`Int`), con la moneda ISO-4217 en minúsculas (`eur`).
- Los nombres de tabla van en `snake_case` y los de columna en `camelCase`; la única excepción es `tenant_id`.

## Diagrama ER

### Plataforma, identidad y facturación

```mermaid
erDiagram
  Plan ||--o{ Tenant : "plan"
  Tenant ||--o| Subscription : ""
  Tenant ||--o{ Membership : ""
  Tenant ||--o{ Invoice : ""
  Tenant ||--o{ Incident : ""
  User ||--o{ Membership : ""
  User ||--o{ RefreshToken : ""
  Role ||--o{ Membership : "rol"
  Tenant ||--o{ Role : ""
  Tenant ||--o{ Invitation : ""
  Tenant ||--o{ AuditLog : ""
  Tenant ||--o{ Notification : ""
  Membership |o--o| Member : "socio vinculado"

  Plan { uuid id PK
    enum code "FREE|BASIC|PRO|ENTERPRISE"
    int maxUsers
    int maxMembers
    int storageMb
    text[] features }
  Tenant { uuid id PK
    text slug UK
    enum status "TRIALING|ACTIVE|PAST_DUE|READ_ONLY|SUSPENDED|CANCELLED"
    bigint storageUsedBytes }
  Subscription { uuid tenant_id UK
    text stripeCustomerId UK
    text stripeSubscriptionId UK
    timestamp graceUntil }
  Invoice { uuid tenant_id
    text stripeInvoiceId UK
    int totalCents }
  StripeEvent { text id PK
    timestamp processedAt }
  User { uuid id PK
    text email UK
    text passwordHash
    text mfaSecretEnc
    bool isPlatformAdmin }
  RefreshToken { text tokenHash UK
    uuid familyId
    timestamp revokedAt }
  Role { uuid tenant_id
    text key
    text[] permissions
    bool isSystem }
  Membership { uuid tenant_id
    uuid userId
    uuid roleId
    uuid calendarToken UK }
  Invitation { uuid tenant_id
    text tokenHash UK
    timestamp expiresAt }
  AuditLog { uuid tenant_id
    text action
    text entity
    jsonb metadata }
```

### Secretaría, archivo y ensayos

```mermaid
erDiagram
  Section ||--o{ Member : ""
  Member ||--o{ MemberSize : "tallas"
  Member ||--o{ EventCall : ""
  Member ||--o{ Attendance : ""
  Composer ||--o{ Work : ""
  Work ||--o{ WorkVersion : ""
  Work ||--o{ Asset : ""
  WorkVersion ||--o{ Asset : ""
  Event ||--o{ EventRepertoire : ""
  Work ||--o{ EventRepertoire : ""
  Event ||--o{ EventCall : "convocatoria"
  Event ||--o{ Attendance : ""

  Member { uuid tenant_id
    int memberNumber
    text nationalIdEnc "cifrado"
    enum status "ACTIVE|INACTIVE|LEFT"
    timestamp anonymizedAt }
  Communication { uuid tenant_id
    enum channel "EMAIL|IN_APP"
    jsonb audience }
  Document { uuid tenant_id
    text fileKey
    uuid memberId }
  Work { uuid tenant_id
    text title
    text[] tags
    tsvector search }
  Asset { uuid tenant_id
    enum kind "SCORE|PART|AUDIO|OTHER"
    text fileKey }
  Event { uuid tenant_id
    enum type "REHEARSAL|PERFORMANCE|MEETING|OTHER"
    timestamp startsAt
    int[] reminderMinutes }
  EventCall { enum response "PENDING|ACCEPTED|DECLINED" }
  Attendance { enum status "PRESENT|LATE|ABSENT|EXCUSED"
    enum justificationStatus "NONE|PENDING|APPROVED|REJECTED" }
```

### Tesorería, mayordomía e instrumentación

```mermaid
erDiagram
  FinanceCategory ||--o{ Transaction : ""
  Fee ||--o{ FeeCharge : "recibos"
  Member ||--o{ FeeCharge : ""
  UniformItem ||--o{ UniformLoan : ""
  Member ||--o{ UniformLoan : ""
  Instrument ||--o{ InstrumentAssignment : ""
  Member ||--o{ InstrumentAssignment : ""
  Instrument ||--o{ MaintenanceRecord : ""

  Transaction { uuid tenant_id
    enum kind "INCOME|EXPENSE"
    int amountCents
    date date }
  Fee { enum periodicity "MONTHLY|QUARTERLY|YEARLY|ONE_OFF"
    int amountCents }
  FeeCharge { text period
    enum status "PENDING|PAID|OVERDUE|WAIVED"
    uuid transactionId }
  UniformItem { text code
    text garment
    text size
    enum status "AVAILABLE|ASSIGNED|MAINTENANCE|RETIRED" }
  UniformLoan { timestamp deliveredAt
    timestamp returnedAt
    enum conditionOut
    enum conditionIn }
  Instrument { text inventoryCode
    text serialNumber
    enum condition "NEW|GOOD|WORN|DAMAGED" }
  MaintenanceRecord { enum type "MAINTENANCE|REPAIR"
    enum status "OPEN|DONE"
    int costCents }
```

### BandMarket

```mermaid
erDiagram
  Listing ||--o{ ListingInquiry : ""
  Listing ||--o{ ListingReport : ""
  Listing { uuid tenant_id "banda vendedora"
    enum status "DRAFT|PENDING_REVIEW|PUBLISHED|REJECTED|SOLD|ARCHIVED"
    int priceCents
    text[] imageKeys }
  ListingInquiry { uuid sellerTenantId
    uuid buyerTenantId
    text message }
  ListingReport { uuid reporterTenantId
    text reason }
```

### Escuela de música

Los alumnos no son socios. Se agrupan en familias (los hermanos comparten familia y tutores) y pueden pasar a la banda creando su ficha de socio (`students.memberId`).

```mermaid
erDiagram
  Family ||--o{ Student : "hermanos"
  Family ||--o{ Guardian : "tutores"
  Guardian }o--o| Member : "socio (descuento)"
  Student |o--o| Member : "paso a la banda"
  SchoolYear ||--o{ ClassGroup : ""
  Subject ||--o{ ClassGroup : ""
  Teacher ||--o{ ClassGroup : ""
  ClassGroup ||--o{ ClassSlot : "horario semanal"
  Room ||--o{ ClassSlot : ""
  ClassGroup ||--o{ Enrollment : ""
  Student ||--o{ Enrollment : ""
  Enrollment ||--o{ Grade : "por trimestre"
  ClassGroup ||--o{ ClassSession : ""
  ClassSession ||--o{ ClassAttendance : ""
  SchoolYear ||--o{ EnrollmentApplication : "matrícula online"
  Student ||--o{ TuitionCharge : "mensualidades"
  ClassGroup ||--o{ SchoolNotice : "avisos"

  Student { enum status "ACTIVE|INACTIVE|LEFT"
    enum bandStage "NONE|EDUCANDO|MUSICIAN"
    text[] pickupAuthorized
    bool imageConsent }
  Family { text name }
  ClassSlot { int weekday "1-7"
    int startMin
    int endMin }
  Enrollment { enum status "ACTIVE|WAITLIST|WITHDRAWN" }
  EnrollmentApplication { enum status "PENDING|ACCEPTED|WAITLISTED|REJECTED"
    timestamp auditionAt
    timestamp consentAt }
  Grade { int term "1-3, 4 final"
    int scoreTenths "0-100" }
  TuitionCharge { text period "YYYY-MM"
    int baseCents
    int discountCents
    json detail }
```

### Actuaciones, refuerzos y archivo

```mermaid
erDiagram
  Client ||--o{ PerformanceQuote : "presupuestos y contratos"
  Client ||--o{ ClientInvoice : ""
  PerformanceQuote |o--o{ ClientInvoice : ""
  PerformanceQuote }o--o| Event : ""
  Event ||--o{ EventRequirement : "plantilla mínima"
  Event ||--o| EventLogistics : ""
  ReinforcementRequest ||--o{ ReinforcementApplication : "candidaturas"
  ExternalMusician ||--o{ ReinforcementPayment : ""
  Booklet ||--o{ BookletItem : ""
  Work ||--o{ BookletItem : ""
  Work ||--o{ ScoreLoan : ""

  ClientInvoice { text series
    int number
    text hash "SHA-256"
    text prevHash
    enum status "ISSUED|PAID|CANCELLED" }
  MusicianProfile { uuid userId "global, sin tenant"
    text[] instruments
    text province }
  ReinforcementRequest { enum status "OPEN|FILLED|CANCELLED" }
  ReinforcementPayment { int grossCents
    int withholdingPct
    int netCents }
  ScoreLoan { enum direction "LENT|BORROWED"
    text counterparty }
```

### Gobierno y tesorería del sector

```mermaid
erDiagram
  Assembly ||--o{ AssemblyAttendance : "asistentes y delegaciones"
  Assembly ||--o{ Motion : "votaciones"
  Motion ||--o{ MotionVote : ""
  Member ||--o{ BoardPosition : "junta directiva"
  Poll ||--o{ PollVote : ""
  Grant ||--o{ Transaction : "justificación"
  LotteryDraw ||--o{ LotteryBook : "talonarios"
  Donor ||--o{ Donation : ""

  Assembly { enum type "ORDINARY|EXTRAORDINARY"
    enum status "DRAFT|CONVENED|HELD|CLOSED"
    json agenda
    int quorumPct }
  MotionVote { enum choice "YES|NO|ABSTAIN"
    bool remote }
  Grant { enum status "REQUESTED|AWARDED|JUSTIFIED|CLOSED|REJECTED"
    date justificationDue }
  LotteryDraw { int ticketPriceCents
    int stakeCents }
  Donor { text taxIdEnc "cifrado"
    text province "código 182" }
  Donation { enum kind "DONATION|SPONSORSHIP" }
```

### Panel global (plataforma)

Tablas de plataforma: las usa el cliente de sistema desde el panel global y el worker. La banda sólo ve su conversación de soporte (`incident_messages`) sin las notas internas.

```mermaid
erDiagram
  Tenant ||--o{ TenantSnapshot : "foto diaria"
  Tenant ||--o{ TenantNote : ""
  Tenant ||--o{ ImpersonationSession : "ver como"
  Incident ||--o{ IncidentMessage : "conversación"
  Announcement ||--o{ AnnouncementDismissal : ""

  TenantSnapshot { date date
    int mrrCents
    int activeUsers7d
    json usage
    int healthScore }
  ImpersonationSession { uuid adminId
    text reason
    timestamp expiresAt }
  IncidentMessage { text authorType "PLATFORM|TENANT"
    bool internal }
  Announcement { enum level "INFO|WARNING|MAINTENANCE"
    json segment }
  EmailLog { text status "SENT|FAILED|BOUNCED|COMPLAINED" }
  OpsHeartbeat { text name
    timestamp lastRunAt }
```

## Políticas RLS

`app_current_tenant()` devuelve `NULLIF(current_setting('app.tenant_id', true), '')::uuid`. Si no hay contexto, devuelve `NULL` y la política no deja pasar ninguna fila.

| Tabla(s) | Política | Lectura | Escritura |
|---|---|---|---|
| 70 tablas de negocio (`members`, `works`, `events`, `transactions`, `students`, `client_invoices`, `assemblies`…) | `tenant_isolation` | `tenant_id = app_current_tenant()` | `WITH CHECK` igual |
| `tenants` | `tenant_self` | `id = app_current_tenant()` | El rol de la app sólo puede actualizar `name`, `legalName`, `taxId`, `country`, `timezone` y `locale` (permiso por columna). Estado, plan y cuota los cambia el cliente de sistema |
| `listings` | `listings_read` | `status = 'PUBLISHED'` **o** el anuncio es del tenant | — |
| `listings` | `listings_insert` / `listings_update` / `listings_delete` | — | Sólo el tenant vendedor |
| `listing_inquiries` | `inquiries_read` / `inquiries_insert` | El tenant es el vendedor o el comprador | Inserta sólo el comprador (`buyerTenantId` = el tenant actual) |
| `reinforcement_requests` | `reinforcements_read` (+ insert/update/delete) | `status = 'OPEN'` **o** la necesidad es del tenant | Sólo el tenant que la publica |
| `reinforcement_applications` | `tenant_isolation` | La banda que publicó la necesidad | La crea el músico candidato desde otra banda: la API usa el cliente de sistema con comprobaciones explícitas |
| `incident_messages` | `incident_messages_read` / `incident_messages_insert` | La banda ve sus mensajes **no internos** | La banda sólo inserta mensajes propios (`authorType = 'TENANT'`, no internos); el equipo de plataforma escribe con el cliente de sistema |
| `tenant_snapshots`, `tenant_notes`, `impersonation_sessions`, `canned_replies`, `announcements`, `announcement_dismissals`, `email_logs`, `ops_heartbeats`, `reinforcement_reports` | Sin acceso para la app | — | Sólo el cliente de sistema (panel global y worker) |
| `musician_profiles` | Sin RLS (global por usuario) | — | El rol de la app no tiene acceso; la API filtra siempre por el usuario autenticado |
| `listing_reports` | `reports_rw` | El tenant que denuncia | El tenant que denuncia. La moderación usa el cliente de sistema |
| `plans`, `users`, `refresh_tokens`, `stripe_events` | Sin RLS (tablas globales) | Sólo los servicios de autenticación y de sistema | El rol de la app no tiene ningún acceso a `stripe_events`, `refresh_tokens` ni `_prisma_migrations`, y sólo lectura en `plans` y `users` |

Otras medidas a nivel de base de datos:

- **`same_tenant` (46 triggers):** en `INSERT`/`UPDATE`, cada columna FK listada debe apuntar a una fila del mismo `tenant_id`. Si no, se lanza `ERRCODE 23503`. Afecta a `members.sectionId`, `works.composerId`, `assets.workId` y `assets.versionId`, `event_calls.eventId` y `event_calls.memberId`, `attendance.*`, `fee_charges.*`, `uniform_loans.*`, `instrument_assignments.*`, `memberships.roleId` y `memberships.memberId`, y otras.
- **`audit_logs`:** el rol de la app no tiene `UPDATE` ni `DELETE`, sólo puede añadir filas.
- **`client_invoices`:** el rol de la app no tiene `DELETE`, y el trigger `client_invoices_immutable` impide cambiar los datos fiscales, los importes y la huella de una factura emitida; sólo pueden cambiar el estado de cobro o anulación. Cada factura encadena la huella SHA-256 de la anterior de su serie, como prevé el reglamento VeriFactu (el envío a la AEAT no está implementado).
- **Sólo lectura para la app:** `subscriptions` e `invoices` (las escribe el procesamiento de webhooks con el cliente de sistema). En `incidents` la app puede crear pero no actualizar ni borrar.
- **Búsqueda de socios:** se hace con `unaccent(...) ILIKE unaccent(...)` sobre nombre, apellidos, email e instrumento, de modo que «garcia» encuentra «García».
- **Búsqueda:** el trigger `works_search` mantiene la columna `search`, de tipo `tsvector` en español y sin tildes. Su peso es A para el título, B para compositor y arreglista, C para subtítulo, género y etiquetas, y D para las notas. Cuando cambia el nombre de un compositor, sus obras se reindexan. La columna tiene índices GIN, igual que `tags`.

## Columnas cifradas

| Columna | Contenido | Quién la ve en claro |
|---|---|---|
| `members.nationalIdEnc` | DNI/NIE | Usuarios con `members:sensitive` |
| `guardians.nationalIdEnc` | DNI/NIE del tutor | Usuarios con `members:sensitive` |
| `external_musicians.nationalIdEnc` | NIF de músicos de refuerzo (retenciones) | Usuarios con `members:sensitive` |
| `donors.taxIdEnc` | NIF de donantes (modelo 182) | Usuarios con `members:sensitive`; el resto ve sólo `taxIdHint` |
| `users.mfaSecretEnc` | Semilla TOTP | Nunca se devuelve. Sólo se usa para verificar códigos |

El formato es `v1:<iv>:<tag>:<cifrado>` (base64url), con AES-256-GCM y la clave `DATA_ENCRYPTION_KEY`. Durante una rotación se descifra probando primero la clave actual y después `DATA_ENCRYPTION_KEY_PREVIOUS` (ver [security-gdpr.md](security-gdpr.md)).

Los tokens (de refresco y de invitación) sólo se guardan como hash SHA-256 y las contraseñas con argon2id.
