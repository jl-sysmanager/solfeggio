-- Gestión de la escuela sin fricciones: emisión programada, forma de pago y rol de coordinación.
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'TRANSFER', 'DIRECT_DEBIT', 'BIZUM', 'OTHER');
ALTER TABLE "tuition_charges" ADD COLUMN "paymentMethod" "PaymentMethod";

ALTER TABLE "school_settings" ADD COLUMN "autoIssueDay" INTEGER;
ALTER TABLE "school_settings" ADD COLUMN "autoIssueDueDay" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "school_settings" ADD COLUMN "notifyFamilies" BOOLEAN NOT NULL DEFAULT true;

-- Las mensualidades tienen permiso propio: quien veía la tesorería conserva el acceso.
CREATE OR REPLACE FUNCTION pg_temp.add_items(arr text[], extra text[]) RETURNS text[]
  LANGUAGE sql IMMUTABLE AS
$$ SELECT ARRAY(SELECT DISTINCT x FROM unnest(arr || extra) x ORDER BY x) $$;

UPDATE roles SET permissions = pg_temp.add_items(permissions, ARRAY['school:tuition'])
WHERE 'finance:read' = ANY(permissions) OR ("isSystem" AND key IN ('owner', 'admin'));

INSERT INTO roles (id, tenant_id, key, name, permissions, "isSystem", "updatedAt")
SELECT gen_random_uuid(), t.id, 'school_coordinator', 'Coordinador de escuela',
       ARRAY['events:read','school:read','school:teach','school:tuition','school:write'], true, now()
FROM tenants t
ON CONFLICT (tenant_id, key) DO NOTHING;
