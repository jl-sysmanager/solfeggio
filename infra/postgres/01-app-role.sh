#!/bin/sh
# Crea el rol de aplicación sin privilegios de propietario: RLS se aplica siempre.
# Las migraciones se ejecutan con el rol propietario (POSTGRES_USER).
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
  DO \$\$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_DB_USER:-solfeggio_app}') THEN
      CREATE ROLE ${APP_DB_USER:-solfeggio_app} LOGIN PASSWORD '${APP_DB_PASSWORD:-solfeggio_app}' NOSUPERUSER NOBYPASSRLS;
    END IF;
  END \$\$;
  GRANT CONNECT ON DATABASE "$POSTGRES_DB" TO ${APP_DB_USER:-solfeggio_app};
  GRANT USAGE ON SCHEMA public TO ${APP_DB_USER:-solfeggio_app};
  CREATE DATABASE solfeggio_test OWNER "$POSTGRES_USER";
SQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname solfeggio_test <<-SQL
  GRANT CONNECT ON DATABASE solfeggio_test TO ${APP_DB_USER:-solfeggio_app};
  GRANT USAGE ON SCHEMA public TO ${APP_DB_USER:-solfeggio_app};
SQL
