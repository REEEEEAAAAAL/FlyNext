#!/bin/bash
# Legacy entry point: guarded reset fixture, never raw SQL against a container.
set -euo pipefail
echo "LOCAL disposable demo fixture: this deletes data."
echo "Requires FLYNEXT_ALLOW_DATABASE_RESET=1 and a loopback flynext_*_test/_demo database."
npm run seed
