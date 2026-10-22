# Operación (runbook)

## Tareas programadas

| Tarea | Dónde | Frecuencia |
|---|---|---|
| Recordatorios de eventos | worker (`events.reminders`) | Cada 15 min (`*/15 * * * *`) |
| Barrido del periodo de gracia | worker (`billing.grace-sweep`) | Cada hora, en el minuto 5 |
| Recibos vencidos a `OVERDUE` | worker (`finance.overdue`) | Diaria, 03:30 Europe/Madrid |
| Recálculo del almacenamiento usado | worker (`storage.recount`) | Diaria, 04:00 Europe/Madrid |
| Copia lógica de la base de datos | `infra/backup/pg-backup.sh` (cron o tarea programada) | Diaria, 01:30 |
| Prueba de restauración | Manual, siguiendo `infra/backup/RESTORE.md` | Mensual |
| Revisión de dependencias | Dependabot | Semanal |

## Incidencias habituales

**Un webhook de Stripe falla.** Busca los eventos con error:

```sql
SELECT id, type, error, "receivedAt" FROM stripe_events WHERE error IS NOT NULL ORDER BY "receivedAt" DESC;
```

El webhook respondió 500, así que Stripe lo reintentará solo durante 3 días. Si ya corregiste la causa y no quieres esperar, reenvía el evento desde el panel de Stripe (*Developers → Events → Resend*). No hace falta borrar la fila: un evento registrado pero sin `processedAt` se vuelve a procesar, y uno ya procesado se ignora como `duplicate`.

**Un tenant está en `READ_ONLY` por error.** Desde el panel global, cambia su estado con `PATCH /admin/tenants/:id { status: "ACTIVE" }`. El cambio queda auditado en el tenant como `platform.tenant.updated`. Comprueba que la suscripción en Stripe está `active`.

**Un usuario no puede iniciar sesión (cuenta bloqueada).** El bloqueo se levanta solo a los 15 minutos. Si necesitas levantarlo antes, ejecuta con el rol propietario:

```sql
UPDATE users SET "failedLogins" = 0, "lockedUntil" = NULL WHERE email = '…';
```

**Un usuario ha perdido su dispositivo MFA.** Verifica su identidad por un canal fuera de la plataforma y ejecuta `UPDATE users SET "mfaEnabled" = false, "mfaSecretEnc" = NULL WHERE id = '…';`. Regístralo en el registro de operaciones.

**Hay trabajos fallidos en una cola.** Revisa la cola en Redis (`bull:solfeggio:failed`) y los logs del worker (`… falló: <motivo>`). Cada trabajo se reintenta 5 veces con backoff exponencial. Los recordatorios se deduplican con la clave `reminder:{eventId}:{minutes}`, así que reintentarlos no duplica avisos; un `notify.fanout` reintentado sí puede duplicar notificaciones in-app.

**Sospecha de acceso entre tenants.**
1. Revisa `audit_logs` y los logs por `tid`.
2. Ejecuta en producción, con el rol `solfeggio_app`, `SELECT count(*) FROM members;` sin contexto: debe devolver `0`.
3. Ejecuta en staging la suite de aislamiento con `pnpm --filter @solfeggio/api test -- tenant-isolation`.
4. Si se confirma, aplica el procedimiento de brechas de [security-gdpr.md](security-gdpr.md#5-rgpd).

## Antes de cada release

- [ ] La CI está en verde (lint, typecheck, tests, aislamiento, build).
- [ ] Las migraciones son compatibles hacia atrás y se han revisado.
- [ ] Las variables de entorno nuevas están dadas de alta en el gestor de secretos.
- [ ] Si se añaden tablas con `tenant_id`, la migración incluye `ENABLE ROW LEVEL SECURITY`, la política `tenant_isolation`, el trigger `same_tenant` y los `GRANT`, y los tests de aislamiento cubren la tabla.
