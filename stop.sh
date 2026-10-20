#!/bin/bash
# Remove the configured demo containers and network while preserving volumes.
set -euo pipefail
docker compose --env-file .env.docker.local down
