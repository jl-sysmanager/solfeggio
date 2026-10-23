-- Logotipo de cada banda y de la plataforma.
ALTER TABLE "tenants" ADD COLUMN "logoKey" TEXT,
ADD COLUMN "logoMime" TEXT;

CREATE TABLE "platform_brand" (
    "id" TEXT NOT NULL,
    "logoKey" TEXT,
    "logoMime" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_brand_pkey" PRIMARY KEY ("id")
);

INSERT INTO "platform_brand" ("id") VALUES ('platform');

GRANT UPDATE ("logoKey", "logoMime") ON "tenants" TO solfeggio_app;
