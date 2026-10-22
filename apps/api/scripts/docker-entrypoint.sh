#!/bin/sh
# Punto de entrada de la imagen del API. Un mismo artefacto sirve a los dos servicios:
#   SERVICE_ROLE=api (por defecto)  API HTTP; con RUN_MIGRATIONS=true aplica antes el paso de release.
#   SERVICE_ROLE=worker             trabajos en segundo plano.
# Si se pasa un comando (p. ej. docker compose `command:`), se ejecuta tal cual.
set -e

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

case "${SERVICE_ROLE:-api}" in
  worker)
    exec node dist/worker.js
    ;;
  api)
    if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
      node dist/cli/release.js
    fi
    exec node dist/main.js
    ;;
  *)
    echo "SERVICE_ROLE no válido: ${SERVICE_ROLE} (usa api o worker)" >&2
    exit 1
    ;;
esac
