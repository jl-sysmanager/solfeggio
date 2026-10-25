-- La tabla se creó en 0017 sin conceder privilegios al rol de aplicación.
-- Sin esto, crear una banda falla al insertar el catálogo (permission denied → 500).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'solfeggio_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "instrument_catalog" TO solfeggio_app;
  END IF;
END $$;
