#!/bin/sh
set -eu
node afs/database.mjs verify
echo "[afs] applying migrations"
node node_modules/prisma/build/index.js migrate deploy
echo "[afs] ensuring additive seed data"
node afs/seed-flights.mjs
echo "[afs] starting server"
exec node node_modules/next/dist/bin/next start -p "${PORT:-3000}" -H "${HOSTNAME:-0.0.0.0}"
