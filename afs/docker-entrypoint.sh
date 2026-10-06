#!/bin/sh
#
# Entrypoint for the local AFS service container.
#
# Three steps, in the order they have to happen:
#
#   1. Apply the upstream Prisma migrations. The database may be brand new (a
#      fresh `afs-postgres` volume) or already migrated by a previous container,
#      and `migrate deploy` is idempotent either way.
#   2. Seed airports, airlines, flights and one agency — but only when the
#      database is empty. The seeder generates flights for a rolling window, so
#      running it on every restart would stack duplicate rows; skipping it when
#      data exists is what makes `docker compose restart afs` cheap.
#   3. Serve.
#
# A failure in 1 or 2 stops the container rather than serving an empty database:
# an AFS that answers every search with an empty list looks like a working
# service from the outside and would be far harder to diagnose.

set -eu

echo "[afs] applying migrations"
npx prisma migrate deploy

echo "[afs] ensuring seed data"
node /usr/local/bin/afs-seed-flights.mjs

echo "[afs] starting server"
exec npx next start -p "${PORT:-3000}" -H "${HOSTNAME:-0.0.0.0}"
