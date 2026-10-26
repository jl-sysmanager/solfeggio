-- Cuántas copias de cada banda se conservan.
CREATE TABLE "platform_config" (
    "id" TEXT NOT NULL,
    "backupRetention" INTEGER NOT NULL DEFAULT 30,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_config_pkey" PRIMARY KEY ("id")
);

INSERT INTO "platform_config" ("id", "backupRetention", "updatedAt")
VALUES ('default', 30, CURRENT_TIMESTAMP);
