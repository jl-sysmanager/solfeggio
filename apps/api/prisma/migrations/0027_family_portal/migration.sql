-- Portal de familias: justificación de faltas y acceso al aceptar la matrícula.
ALTER TABLE "class_attendance" ADD COLUMN "justification" TEXT;
ALTER TABLE "class_attendance" ADD COLUMN "justificationStatus" "JustificationStatus" NOT NULL DEFAULT 'NONE';
ALTER TABLE "school_settings" ADD COLUMN "inviteOnAccept" BOOLEAN NOT NULL DEFAULT true;
