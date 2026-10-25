-- Catálogo de instrumentos por banda (selectores de ficha / formularios).
CREATE TABLE "instrument_catalog" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "instrument_catalog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "instrument_catalog_tenant_id_name_key" ON "instrument_catalog"("tenant_id", "name");

ALTER TABLE "instrument_catalog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "instrument_catalog"
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- Rellenar catálogo por defecto en bandas existentes.
INSERT INTO "instrument_catalog" ("id", "tenant_id", "name", "position")
SELECT gen_random_uuid(), t.id, v.name, v.ord - 1
FROM "tenants" t
CROSS JOIN (VALUES
  (1, 'Flautín'),
  (2, 'Flauta'),
  (3, 'Oboe'),
  (4, 'Corno inglés'),
  (5, 'Fagot'),
  (6, 'Clarinete en Mi♭'),
  (7, 'Clarinete en Si♭'),
  (8, 'Clarinete alto'),
  (9, 'Clarinete bajo'),
  (10, 'Saxofón soprano'),
  (11, 'Saxofón alto'),
  (12, 'Saxofón tenor'),
  (13, 'Saxofón barítono'),
  (14, 'Trompa'),
  (15, 'Fliscorno'),
  (16, 'Corneta'),
  (17, 'Trompeta'),
  (18, 'Trombón'),
  (19, 'Bombardino'),
  (20, 'Tuba'),
  (21, 'Contrabajo'),
  (22, 'Caja'),
  (23, 'Bombo'),
  (24, 'Platos'),
  (25, 'Timbal'),
  (26, 'Xilófono'),
  (27, 'Lira'),
  (28, 'Percusión'),
  (29, 'Piano'),
  (30, 'Canto')
) AS v(ord, name)
WHERE t."deletedAt" IS NULL;
