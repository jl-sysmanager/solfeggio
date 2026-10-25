-- Foto de perfil del socio (visible en listados y ficha).
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "photoKey" TEXT;
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "photoMime" TEXT;
