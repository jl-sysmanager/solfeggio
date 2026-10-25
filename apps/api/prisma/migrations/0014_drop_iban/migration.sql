-- Elimina IBAN y titular de cuenta (datos financieros bancarios). El DNI/NIF se conserva.
ALTER TABLE "members" DROP COLUMN IF EXISTS "ibanEnc";
ALTER TABLE "families" DROP COLUMN IF EXISTS "ibanEnc";
ALTER TABLE "families" DROP COLUMN IF EXISTS "ibanHolder";
ALTER TABLE "external_musicians" DROP COLUMN IF EXISTS "ibanEnc";
