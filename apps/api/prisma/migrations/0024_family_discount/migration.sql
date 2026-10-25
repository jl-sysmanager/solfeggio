-- Descuento fijo por cada alumno adicional de la misma familia.
ALTER TABLE "school_settings" ADD COLUMN "familyDiscountCents" INTEGER NOT NULL DEFAULT 0;
