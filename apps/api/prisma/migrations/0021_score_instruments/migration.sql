-- Segundo instrumento del socio y permiso para ver todas las partituras.
ALTER TABLE "members" ADD COLUMN "secondaryInstrument" TEXT;

UPDATE "roles"
SET "permissions" = ARRAY(
  SELECT DISTINCT x FROM unnest("permissions" || ARRAY['archive:all']) AS x ORDER BY x
)
WHERE "isSystem" AND "key" IN ('owner', 'admin', 'director', 'archivist', 'material_manager');
