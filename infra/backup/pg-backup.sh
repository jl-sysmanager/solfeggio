#!/bin/sh
# Copia lógica diaria de PostgreSQL, cifrada y subida a S3 con retención.
#
# Variables requeridas:
#   BACKUP_DATABASE_URL   URL con rol propietario o de solo lectura con acceso a todo
#   BACKUP_S3_URI         p. ej. s3://solfeggio-backups/postgres
#   BACKUP_AGE_RECIPIENT  clave pública age (age1...) para cifrar
# Opcionales:
#   BACKUP_RETENTION_DAYS (30)  AWS_* / --endpoint-url vía AWS_ENDPOINT_URL
#
# Uso (cron):  30 1 * * *  /opt/solfeggio/infra/backup/pg-backup.sh >> /var/log/solfeggio-backup.log 2>&1
#
# NOTA: en Postgres gestionado se recomienda además PITR nativo (ver docs/security-gdpr.md).
set -eu

: "${BACKUP_DATABASE_URL:?}"
: "${BACKUP_S3_URI:?}"
: "${BACKUP_AGE_RECIPIENT:?}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
FILE="$WORKDIR/solfeggio-$STAMP.dump.age"

echo "[$(date -u +%FT%TZ)] backup start"
pg_dump --format=custom --no-owner --no-privileges "$BACKUP_DATABASE_URL" \
  | age --recipient "$BACKUP_AGE_RECIPIENT" --output "$FILE"

sha256sum "$FILE" | awk '{print $1}' > "$FILE.sha256"
aws s3 cp "$FILE" "$BACKUP_S3_URI/$(basename "$FILE")" --only-show-errors --sse AES256
aws s3 cp "$FILE.sha256" "$BACKUP_S3_URI/$(basename "$FILE").sha256" --only-show-errors --sse AES256
echo "[$(date -u +%FT%TZ)] uploaded $(basename "$FILE") ($(du -h "$FILE" | cut -f1))"

# Retención: borra copias más antiguas que RETENTION_DAYS.
# (Si el bucket tiene Object Lock/lifecycle, esta parte puede omitirse.)
CUTOFF="$(date -u -d "-$RETENTION_DAYS days" +%Y%m%d 2>/dev/null || date -u -v-"$RETENTION_DAYS"d +%Y%m%d)"
aws s3 ls "$BACKUP_S3_URI/" | awk '{print $4}' | while read -r key; do
  day="$(echo "$key" | sed -n 's/^solfeggio-\([0-9]\{8\}\)T.*/\1/p')"
  if [ -n "$day" ] && [ "$day" -lt "$CUTOFF" ]; then
    aws s3 rm "$BACKUP_S3_URI/$key" --only-show-errors
    echo "pruned $key"
  fi
done
echo "[$(date -u +%FT%TZ)] backup done"
