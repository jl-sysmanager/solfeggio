# Restauración de copias de seguridad

## A. PITR en Postgres gestionado (preferente)

1. En la consola del proveedor (RDS, Cloud SQL…), crea una **instancia nueva** restaurada al instante deseado, que debe ser anterior al incidente. No sobrescribas la instancia actual.
2. Crea en la instancia nueva el rol `solfeggio_app` si no se ha restaurado con ella (ver `docs/deployment.md`).
3. Valida la restauración (ver el apartado C).
4. Cambia `DATABASE_URL`, `SYSTEM_DATABASE_URL` y `DATABASE_MIGRATION_URL` en el gestor de secretos y reinicia `api` y `worker`.
5. Conserva la instancia anterior 7 días para poder analizar el incidente.

## B. Copia lógica (`pg-backup.sh`)

Descarga la copia:

```bash
aws s3 cp s3://solfeggio-backups/postgres/solfeggio-20261020T013000Z.dump.age .
```

Comprueba la integridad: compara el resultado de este comando con el archivo `.sha256` que acompaña a la copia.

```bash
sha256sum solfeggio-20261020T013000Z.dump.age
```

Descifra la copia con la clave privada, que debe estar custodiada fuera del cloud:

```bash
age --decrypt -i backup-key.txt -o restore.dump solfeggio-20261020T013000Z.dump.age
```

Crea una base de datos vacía y restaura en ella:

```bash
createdb -h <host> -U solfeggio solfeggio_restore
```

```bash
pg_restore -h <host> -U solfeggio -d solfeggio_restore --no-owner --exit-on-error restore.dump
```

Como la copia se hace con `--no-privileges`, hay que volver a conceder los permisos al rol de aplicación:

Son los mismos que concede la migración `0002_tenant_isolation`, incluidos los permisos por columna de `tenants`:

```bash
psql -h <host> -U solfeggio -d solfeggio_restore -v ON_ERROR_STOP=1 <<'SQL'
GRANT USAGE ON SCHEMA public TO solfeggio_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO solfeggio_app;
REVOKE UPDATE, DELETE ON audit_logs FROM solfeggio_app;
REVOKE ALL ON stripe_events, _prisma_migrations, refresh_tokens FROM solfeggio_app;
REVOKE INSERT, UPDATE, DELETE ON plans, users, subscriptions, invoices FROM solfeggio_app;
REVOKE UPDATE, DELETE ON incidents FROM solfeggio_app;
REVOKE INSERT, UPDATE, DELETE ON tenants FROM solfeggio_app;
GRANT UPDATE (name, "legalName", "taxId", country, timezone, locale, "updatedAt") ON tenants TO solfeggio_app;
SQL
```

## C. Validación (también en la prueba mensual)

Comprueba que el esquema coincide con las migraciones del repositorio:

```bash
DATABASE_URL=… DATABASE_MIGRATION_URL=… pnpm --filter @solfeggio/api exec prisma migrate status
```

Después, comprueba en la base de datos restaurada que:

- **RLS está activo:** `SELECT count(*) FROM pg_policies;` devuelve el mismo número que en producción (38 con la migración `0002`).
- **El aislamiento se mantiene:** conectado como `solfeggio_app`, sin contexto, `SELECT count(*) FROM members;` devuelve `0`.
- **Los datos son coherentes:** el recuento de filas de `tenants`, `members`, `works`, `events` y `transactions` coincide con el esperado para esa fecha.
- **El cifrado funciona:** la API, arrancada contra la restauración con la misma `DATA_ENCRYPTION_KEY`, descifra un IBAN de prueba.

Por último, anota en el registro de operaciones la fecha, la copia usada, el tiempo total (RTO) y las incidencias encontradas.

Los archivos de S3 no necesitan restauración aparte: el bucket tiene versionado y basta con restaurar la versión anterior del objeto.
