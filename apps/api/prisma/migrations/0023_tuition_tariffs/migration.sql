-- Mensualidad por descuento (%) o por tarifa fija asignada al alumno.
CREATE TYPE "SchoolFeeMode" AS ENUM ('PERCENT', 'FIXED');

ALTER TABLE "school_settings" ADD COLUMN "feeMode" "SchoolFeeMode" NOT NULL DEFAULT 'PERCENT';

CREATE TABLE "tuition_tariffs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "monthlyCents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tuition_tariffs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tuition_tariffs_tenant_id_name_key" ON "tuition_tariffs"("tenant_id", "name");
CREATE INDEX "tuition_tariffs_tenant_id_idx" ON "tuition_tariffs"("tenant_id");

ALTER TABLE "students" ADD COLUMN "tuitionTariffId" UUID;
CREATE INDEX "students_tuitionTariffId_idx" ON "students"("tuitionTariffId");

ALTER TABLE "students" ADD CONSTRAINT "students_tuitionTariffId_fkey"
  FOREIGN KEY ("tuitionTariffId") REFERENCES "tuition_tariffs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tuition_tariffs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tuition_tariffs"
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

DROP TRIGGER same_tenant ON students;
CREATE TRIGGER same_tenant BEFORE INSERT OR UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION app_enforce_same_tenant(
    'familyId', 'families', 'memberId', 'members', 'tuitionTariffId', 'tuition_tariffs'
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'solfeggio_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "tuition_tariffs" TO solfeggio_app;
  END IF;
END $$;
