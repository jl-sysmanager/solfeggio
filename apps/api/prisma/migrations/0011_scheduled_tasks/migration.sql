CREATE TABLE "scheduled_tasks" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Madrid',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" UUID,

    CONSTRAINT "scheduled_tasks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "scheduled_tasks_key_key" ON "scheduled_tasks"("key");
