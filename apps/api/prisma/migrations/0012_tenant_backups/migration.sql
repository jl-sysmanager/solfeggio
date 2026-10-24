-- Copias lógicas por banda. Sólo las usa el rol de sistema.
CREATE TABLE "tenant_backups" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "fileKey" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,
    "restoredAt" TIMESTAMP(3),

    CONSTRAINT "tenant_backups_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tenant_backups_tenantId_createdAt_idx" ON "tenant_backups"("tenantId", "createdAt");
