-- CreateEnum
CREATE TYPE "AnnouncementLevel" AS ENUM ('INFO', 'WARNING', 'MAINTENANCE');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "accountManagerId" UUID,
ADD COLUMN     "complimentaryReason" TEXT,
ADD COLUMN     "complimentaryUntil" TIMESTAMP(3),
ADD COLUMN     "region" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "incidents" ADD COLUMN     "assigneeId" UUID,
ADD COLUMN     "firstResponseAt" TIMESTAMP(3),
ADD COLUMN     "slaAlertedAt" TIMESTAMP(3),
ADD COLUMN     "slaDueAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "blockedAt" TIMESTAMP(3),
ADD COLUMN     "blockedReason" TEXT;

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "lastSeenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "submittedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "tenant_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "planCode" "PlanCode" NOT NULL,
    "status" "TenantStatus" NOT NULL,
    "mrrCents" INTEGER NOT NULL,
    "activeUsers7d" INTEGER NOT NULL,
    "activeUsers30d" INTEGER NOT NULL,
    "members" INTEGER NOT NULL,
    "students" INTEGER NOT NULL,
    "storageBytes" BIGINT NOT NULL,
    "usage" JSONB NOT NULL,
    "healthScore" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_notes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "impersonation_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "impersonation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_messages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "authorType" TEXT NOT NULL,
    "authorId" UUID,
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canned_replies" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canned_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "level" "AnnouncementLevel" NOT NULL DEFAULT 'INFO',
    "link" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "segment" JSONB NOT NULL DEFAULT '{}',
    "dismissible" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_dismissals" (
    "id" UUID NOT NULL,
    "announcementId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_heartbeats" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" JSONB,
    "lastRunAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_heartbeats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reinforcement_reports" (
    "id" UUID NOT NULL,
    "requestId" UUID,
    "profileId" UUID,
    "reporterTenantId" UUID NOT NULL,
    "reporterUserId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reinforcement_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_snapshots_date_idx" ON "tenant_snapshots"("date");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_snapshots_tenant_id_date_key" ON "tenant_snapshots"("tenant_id", "date");

-- CreateIndex
CREATE INDEX "tenant_notes_tenant_id_createdAt_idx" ON "tenant_notes"("tenant_id", "createdAt");

-- CreateIndex
CREATE INDEX "impersonation_sessions_tenant_id_createdAt_idx" ON "impersonation_sessions"("tenant_id", "createdAt");

-- CreateIndex
CREATE INDEX "incident_messages_incidentId_createdAt_idx" ON "incident_messages"("incidentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "canned_replies_title_key" ON "canned_replies"("title");

-- CreateIndex
CREATE INDEX "announcements_startsAt_idx" ON "announcements"("startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "announcement_dismissals_announcementId_userId_key" ON "announcement_dismissals"("announcementId", "userId");

-- CreateIndex
CREATE INDEX "email_logs_tenant_id_createdAt_idx" ON "email_logs"("tenant_id", "createdAt");

-- CreateIndex
CREATE INDEX "email_logs_status_createdAt_idx" ON "email_logs"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ops_heartbeats_name_key" ON "ops_heartbeats"("name");

-- CreateIndex
CREATE INDEX "reinforcement_reports_resolvedAt_idx" ON "reinforcement_reports"("resolvedAt");

-- AddForeignKey
ALTER TABLE "incident_messages" ADD CONSTRAINT "incident_messages_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_dismissals" ADD CONSTRAINT "announcement_dismissals_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ════════════════════════════════════════════════════════════════════════════
-- Panel global. Todas las tablas nuevas son de plataforma (cliente de sistema), salvo
-- incident_messages, que la banda lee y escribe sin ver las notas internas.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE incident_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY incident_messages_read ON incident_messages FOR SELECT
  USING (tenant_id = app_current_tenant() AND NOT internal);
CREATE POLICY incident_messages_insert ON incident_messages FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant() AND NOT internal AND "authorType" = 'TENANT');

CREATE TRIGGER same_tenant BEFORE INSERT OR UPDATE ON incident_messages
  FOR EACH ROW EXECUTE FUNCTION app_enforce_same_tenant('incidentId', 'incidents');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'solfeggio_app') THEN
    REVOKE ALL ON tenant_snapshots, tenant_notes, impersonation_sessions, canned_replies, announcements,
      announcement_dismissals, email_logs, ops_heartbeats, reinforcement_reports FROM solfeggio_app;
    GRANT SELECT, INSERT ON incident_messages TO solfeggio_app;
    -- La banda indica su comunidad autónoma en Ajustes (segmentación de avisos).
    GRANT UPDATE (region) ON tenants TO solfeggio_app;
  END IF;
END $$;

-- Datos existentes: anuncios en revisión y SLA de las incidencias abiertas (horas por prioridad 1–5).
UPDATE listings SET "submittedAt" = "updatedAt" WHERE status = 'PENDING_REVIEW' AND "submittedAt" IS NULL;
UPDATE incidents SET "slaDueAt" = "createdAt" + (CASE priority WHEN 1 THEN 4 WHEN 2 THEN 8 WHEN 3 THEN 24 WHEN 4 THEN 48 ELSE 72 END) * interval '1 hour'
  WHERE "slaDueAt" IS NULL AND status IN ('OPEN', 'IN_PROGRESS');
