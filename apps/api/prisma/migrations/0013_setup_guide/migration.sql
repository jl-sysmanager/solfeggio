-- El propietario puede ocultar la guía de puesta en marcha. El avance se calcula, no se guarda.
ALTER TABLE "memberships" ADD COLUMN "setupGuideDismissedAt" TIMESTAMP(3);
