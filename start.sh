#!/bin/bash
# Start the isolated built-in demo using its existing local configuration.
set -euo pipefail
docker compose --env-file .env.docker.local up -d --build --wait nextjs
