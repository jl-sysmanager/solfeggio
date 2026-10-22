-- ════════════════════════════════════════════════════════════════════════════
-- Aislamiento multi-tenant (defensa en profundidad)
--
-- 1. Row Level Security en todas las tablas con tenant_id. La política compara con
--    `app.tenant_id`, que la API fija con set_config(..., true) al inicio de cada
--    transacción (ver TenantDb). Sin contexto ⇒ 0 filas (fail-closed).
-- 2. La API conecta con el rol `solfeggio_app` (no propietario) ⇒ RLS siempre aplica.
--    Las tareas de sistema (webhooks, worker, panel global) usan el rol propietario,
--    que por definición no está sujeto a RLS (no usamos FORCE).
-- 3. Triggers `app_enforce_same_tenant` impiden referencias a filas de otro tenant
--    (las FK de PostgreSQL ignoran RLS).
-- 4. audit_logs es append-only para el rol de la app.
-- ════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- ── RLS estándar: tenant_id = tenant actual ─────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'subscriptions','invoices','incidents','roles','memberships','invitations',
    'audit_logs','notifications','sections','members','communications','documents',
    'composers','works','work_versions','assets','events','event_repertoire',
    'event_calls','attendance','finance_categories','transactions','fees',
    'fee_charges','member_sizes','uniform_items','uniform_loans','instruments',
    'instrument_assignments','maintenance_records'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) '
      'WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- El tenant sólo se ve a sí mismo.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON tenants USING (id = app_current_tenant());

-- ── BandMarket: lectura cruzada sólo de anuncios publicados ─────────────────
ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY listings_read ON listings FOR SELECT
  USING (status = 'PUBLISHED' OR tenant_id = app_current_tenant());
CREATE POLICY listings_insert ON listings FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY listings_update ON listings FOR UPDATE
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY listings_delete ON listings FOR DELETE
  USING (tenant_id = app_current_tenant());

ALTER TABLE listing_inquiries ENABLE ROW LEVEL SECURITY;
CREATE POLICY inquiries_read ON listing_inquiries FOR SELECT
  USING ("sellerTenantId" = app_current_tenant() OR "buyerTenantId" = app_current_tenant());
CREATE POLICY inquiries_insert ON listing_inquiries FOR INSERT
  WITH CHECK ("buyerTenantId" = app_current_tenant());

ALTER TABLE listing_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY reports_rw ON listing_reports
  USING ("reporterTenantId" = app_current_tenant())
  WITH CHECK ("reporterTenantId" = app_current_tenant());

-- ── Referencias dentro del mismo tenant ─────────────────────────────────────
-- Argumentos: pares (columna, tabla_referenciada).
CREATE OR REPLACE FUNCTION app_enforce_same_tenant() RETURNS trigger
  LANGUAGE plpgsql AS
$$
DECLARE
  i int;
  ref_col text;
  ref_table text;
  ref_id uuid;
  ok boolean;
BEGIN
  FOR i IN 0 .. (TG_NARGS / 2 - 1) LOOP
    ref_col := TG_ARGV[i * 2];
    ref_table := TG_ARGV[i * 2 + 1];
    EXECUTE format('SELECT ($1).%I::uuid', ref_col) INTO ref_id USING NEW;
    IF ref_id IS NOT NULL THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id = $1 AND tenant_id = $2)', ref_table)
        INTO ok USING ref_id, NEW.tenant_id;
      IF NOT ok THEN
        RAISE EXCEPTION 'cross-tenant reference %.% -> %', TG_TABLE_NAME, ref_col, ref_table
          USING ERRCODE = '23503';
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END
$$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('members',                ARRAY['sectionId','sections']),
    ('works',                  ARRAY['composerId','composers']),
    ('work_versions',          ARRAY['workId','works']),
    ('assets',                 ARRAY['workId','works','versionId','work_versions']),
    ('event_repertoire',       ARRAY['eventId','events','workId','works']),
    ('event_calls',            ARRAY['eventId','events','memberId','members']),
    ('attendance',             ARRAY['eventId','events','memberId','members']),
    ('transactions',           ARRAY['categoryId','finance_categories','memberId','members']),
    ('fee_charges',            ARRAY['feeId','fees','memberId','members']),
    ('member_sizes',           ARRAY['memberId','members']),
    ('uniform_loans',          ARRAY['itemId','uniform_items','memberId','members']),
    ('instrument_assignments', ARRAY['instrumentId','instruments','memberId','members']),
    ('maintenance_records',    ARRAY['instrumentId','instruments']),
    ('memberships',            ARRAY['roleId','roles','memberId','members']),
    ('invitations',            ARRAY['roleId','roles','memberId','members']),
    ('documents',              ARRAY['memberId','members'])
  ) AS v(tbl, args) LOOP
    EXECUTE format(
      'CREATE TRIGGER same_tenant BEFORE INSERT OR UPDATE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION app_enforce_same_tenant(%s)',
      r.tbl, (SELECT string_agg(quote_literal(a), ',') FROM unnest(r.args) a));
  END LOOP;
END $$;

-- ── Búsqueda de texto completo en el archivo musical ────────────────────────
CREATE OR REPLACE FUNCTION works_search_update() RETURNS trigger
  LANGUAGE plpgsql AS
$$
DECLARE composer_name text;
BEGIN
  SELECT name INTO composer_name FROM composers WHERE id = NEW."composerId";
  NEW.search :=
    setweight(to_tsvector('spanish', unaccent(coalesce(NEW.title, ''))), 'A') ||
    setweight(to_tsvector('spanish', unaccent(coalesce(composer_name, '') || ' ' || coalesce(NEW.arranger, ''))), 'B') ||
    setweight(to_tsvector('spanish', unaccent(coalesce(NEW.subtitle, '') || ' ' || coalesce(NEW.genre, '') || ' ' ||
      array_to_string(NEW.tags, ' '))), 'C') ||
    setweight(to_tsvector('spanish', unaccent(coalesce(NEW.notes, ''))), 'D');
  RETURN NEW;
END
$$;

CREATE TRIGGER works_search BEFORE INSERT OR UPDATE ON works
  FOR EACH ROW EXECUTE FUNCTION works_search_update();

-- Reindexa las obras cuando cambia el nombre del compositor.
CREATE OR REPLACE FUNCTION composers_touch_works() RETURNS trigger
  LANGUAGE plpgsql AS
$$
BEGIN
  UPDATE works SET "updatedAt" = now() WHERE "composerId" = NEW.id;
  RETURN NEW;
END
$$;

CREATE TRIGGER composers_touch AFTER UPDATE OF name ON composers
  FOR EACH ROW EXECUTE FUNCTION composers_touch_works();

CREATE INDEX works_search_idx ON works USING gin (search);
CREATE INDEX works_tags_idx ON works USING gin (tags);

-- ── Permisos del rol de aplicación ──────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'solfeggio_app') THEN
    GRANT USAGE ON SCHEMA public TO solfeggio_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO solfeggio_app;
    REVOKE UPDATE, DELETE ON audit_logs FROM solfeggio_app;
    -- Tablas sólo de sistema: la app no las necesita.
    REVOKE ALL ON stripe_events, refresh_tokens FROM solfeggio_app;
    -- `_prisma_migrations` no existe en la base «shadow» de Prisma.
    IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
      REVOKE ALL ON _prisma_migrations FROM solfeggio_app;
    END IF;
    -- Lectura únicamente: las gestiona el sistema (auth, Stripe, panel global).
    REVOKE INSERT, UPDATE, DELETE ON plans, users, subscriptions, invoices FROM solfeggio_app;
    REVOKE UPDATE, DELETE ON incidents FROM solfeggio_app;
    -- El tenant sólo puede editar sus datos descriptivos, nunca estado, plan o cuota.
    REVOKE INSERT, UPDATE, DELETE ON tenants FROM solfeggio_app;
    GRANT UPDATE (name, "legalName", "taxId", country, timezone, locale, "updatedAt") ON tenants TO solfeggio_app;
  END IF;
END $$;
