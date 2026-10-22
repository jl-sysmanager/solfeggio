-- Cupos personalizados por banda (panel global). NULL = usar los del plan.
ALTER TABLE "tenants"
  ADD COLUMN "maxUsersOverride" INTEGER,
  ADD COLUMN "maxMembersOverride" INTEGER,
  ADD COLUMN "storageMbOverride" INTEGER;
