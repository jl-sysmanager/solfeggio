-- CreateTable
CREATE TABLE "integration_settings" (
    "id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secretsEnc" TEXT,
    "secretHints" JSONB NOT NULL DEFAULT '{}',
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_audit_logs" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_settings_category_key" ON "integration_settings"("category");

-- CreateIndex
CREATE INDEX "platform_audit_logs_entity_createdAt_idx" ON "platform_audit_logs"("entity", "createdAt");


-- Configuración e historial de plataforma: sólo el rol de sistema (propietario) accede.
-- El rol de la API de tenants no puede leer ni los secretos cifrados.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'solfeggio_app') THEN
    REVOKE ALL ON integration_settings, platform_audit_logs FROM solfeggio_app;
  END IF;
END $$;
