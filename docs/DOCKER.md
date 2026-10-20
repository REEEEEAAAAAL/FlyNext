# Local Docker deployment

FlyNext runs with Docker Desktop's Linux engine and Docker Compose v2. No host Node.js or PostgreSQL installation is required. Run commands from the repository root. Internet access is needed for the initial image build. This is a local synthetic demo, not a production deployment.

## Create isolated configuration

Generate a new ignored configuration without reading or copying any existing application environment file. The generator refuses to overwrite an existing file.

PowerShell:

```powershell
docker run --rm --mount "type=bind,source=$($PWD.Path),target=/workspace" -w /workspace node:24-alpine node scripts/docker/config.mjs
```

POSIX shell:

```sh
docker run --rm --mount "type=bind,source=$PWD,target=/workspace" -w /workspace node:24-alpine node scripts/docker/config.mjs
```

This creates `.env.docker.local` with a unique `flynext-local-...` Compose project name, random database/JWT credentials and a random instance ID. `.env.docker.example` describes the fields with invalid placeholders; it is not runnable configuration. Keep the generated file private and retain it for subsequent starts. On shared Windows hosts, restrict its file ACL to your account. Docker administrators can inspect container environment variables; do not share Docker access with untrusted users.

The app is available only on `127.0.0.1:3300`. If occupied, change `FLYNEXT_DOCKER_PORT` in this Docker configuration before starting. PostgreSQL has no host port. Do not reuse an existing Compose project name, set external volume names, or attach existing database volumes. Shell variables take precedence over Compose env files: clear conflicting `COMPOSE_PROJECT_NAME` / `FLYNEXT_DOCKER_*` overrides before using these commands.

On Windows machines configured for Clash, use the machine's dedicated Docker Desktop (Clash) launcher and preserve TUN, system proxy and WSL autoProxy. Confirm both Client and Server with `docker version`. If `docker compose` is unavailable but Docker Desktop is installed, use its `resources/cli-plugins/docker-compose.exe` executable with the same arguments.

## First build and startup

```sh
docker compose --env-file .env.docker.local config --quiet
docker compose --env-file .env.docker.local up -d --build --wait nextjs
docker compose --env-file .env.docker.local ps
```

Open [FlyNext](http://localhost:3300). Use `localhost` for browser access so browsers can use the production Secure refresh cookie on the trusted local origin. Do not expose this HTTP demo on a LAN address. The full demo contains the existing synthetic users (`user1@example.com` / `password1` is one example), owners, cities, airports, hotels, room types and a UTC nightly inventory calendar. It also creates one built-in AFS flight reservation, one hotel reservation and one draft itinerary for that demo user. New accounts can register normally. Do not enter real card, passport or personal details.

Compose waits for PostgreSQL health. The non-root application startup then retries the connection for up to 60 seconds, verifies the database identity, applies the repository's Prisma migrations and performs the full demo seed once. Initialization failure prevents the server from starting. An interrupted seed is recorded and requires an explicit reset after inspecting logs; startup does not silently repeat destructive initialization.

`DATABASE_URL` is constructed with the fixed `postgres:5432`, `flynext_docker_demo` database and non-superuser `flynext_docker` role. An inherited `DATABASE_URL`, Neon credentials, ordinary `.env`, `.env.test`, AFS URL or Cloudinary settings are not injected. The image excludes local environment files and uploads. PostgreSQL bootstrap creates a protected instance marker and records its physical cluster ID. Maintenance verifies both against the live server, database, role and container DNS address before migrations or seed operations. Existing local/CI database safety runners are unchanged.

Normal startup applies pending migrations and preserves all existing demo accounts, reservations, orders and inventory. Migrations still need review when updating the code. The reference seed is non-destructive and is not a substitute for the full initial demo seed.

## Daily operation and diagnostics

```sh
docker compose --env-file .env.docker.local stop
docker compose --env-file .env.docker.local up -d --wait nextjs
docker compose --env-file .env.docker.local restart nextjs
docker compose --env-file .env.docker.local logs --tail 100 nextjs postgres
docker compose --env-file .env.docker.local exec -T nextjs node scripts/docker/start.mjs verify
```

The project-scoped `postgres_data` and `uploads-volume` named volumes persist PostgreSQL data and local uploads across stops and container recreation. The application runs as UID 1001; PostgreSQL drops privileges to its image's postgres account. A new upload volume inherits the image's writable upload directory. A health check verifies both a real database query and the HTTP front door. Restart policy is `unless-stopped`; a Docker health failure is observable but does not itself restart an otherwise running process.

If startup fails, inspect logs for the failing phase, database readiness, permission errors or migration/seed failures. Do not print expanded `compose config` or container environments into shared logs; these contain credentials. Identity failures after changing the instance ID or reusing a volume are intentional. Restore the matching local configuration; do not remove the marker or weaken the guard. Port conflicts require selecting a free app port, not stopping unrelated containers. Authentication over a LAN HTTP address is unsupported; use localhost.

For a reviewed migration or optional reference-data update, stop the app first. Set a dedicated synthetic `SEED_OWNER_PASSWORD` in your shell and forward only that variable with `-e SEED_OWNER_PASSWORD`; the existing reference seed then never prints a generated credential. This explicit reference operation can create or update its demo owner account; it is unnecessary after full demo initialization.

```sh
docker compose --env-file .env.docker.local stop nextjs
docker compose --env-file .env.docker.local run --rm --no-deps -e SEED_OWNER_PASSWORD nextjs node scripts/docker/start.mjs reference
docker compose --env-file .env.docker.local up -d --wait nextjs
```

The maintenance command verifies identity and deploys migrations before calling the existing `seed:reference` implementation. Reference initialization only adds reference/demo catalogue data; it does not clear business records.

## Explicit demo reset

Only run this intentionally on the disposable database created by this setup. It removes all local synthetic accounts, reservations, sessions, provider ledger entries and request/rate-limit records and recreates the demo fixtures, hashed passwords, nightly inventory and initial draft journey. It retains the PostgreSQL volume and protected instance identity. Back up any demo work you want to retain first. Keep PostgreSQL running while the app is stopped.

```sh
docker compose --env-file .env.docker.local stop nextjs
docker compose --env-file .env.docker.local run --rm --no-deps nextjs node scripts/docker/start.mjs reset
docker compose --env-file .env.docker.local up -d --wait nextjs
```

The explicit `reset` operation supplies scoped reset consent to the guarded seed process. Runtime application containers do not receive a standing reset-bypass flag. Never call the ordinary Neon integration/E2E runner against this database.

## Container business smoke and persistence verification

This Docker-only entry point verifies the dedicated target before writing synthetic data through the real container API. It checks page responses, registration/login/refresh/logout, built-in AFS search/booking, hotel availability, booking idempotency, itinerary creation, DEMO checkout, a parseable PDF, cancellation and exact nightly inventory restoration. It leaves its synthetic records for inspection. It is separate from the existing integration test runner.

```sh
docker compose --env-file .env.docker.local exec -T nextjs node scripts/docker/smoke.mjs
docker compose --env-file .env.docker.local exec -T nextjs node scripts/docker/smoke.mjs snapshot
docker compose --env-file .env.docker.local stop nextjs postgres
docker compose --env-file .env.docker.local up -d --wait nextjs
docker compose --env-file .env.docker.local exec -T nextjs node scripts/docker/smoke.mjs compare
```

The snapshot stores only a SHA-256 digest in the application container's `/tmp`; it verifies users, hotels, rooms, inventory, reservations, itineraries, AFS ledger and sessions. Use it across stop/start of the same container; recreation removes this temporary digest. Run `smoke.mjs reset-check` immediately after an explicit reset to check the initial fixture counts and bookable inventory, then run the normal smoke again. API smoke does not replace browser UI checks.

## Stop and cleanup

`stop` preserves containers and volumes. After checking the project name and backing up anything needed, `docker compose --env-file .env.docker.local down` removes only that project's containers/network and retains its named volumes. The stack can be recreated with `up` and the same configuration. Do not use `down -v`, prune, or remove existing volumes. Deleting persistent demo data/volumes is a separate deliberate action requiring the owner's approval. Do not delete `.env.docker.local` while retaining a database volume: its credentials and instance ID are needed to reopen that database.

## Provider and scope

The default app pins `AFS_MOCK=true` and an empty `AFS_BASE_URL`, so the built-in provider works without a remote flight service. Schedules are generated by the existing provider; bookings persist in PostgreSQL. The optional `afs` and `afs-postgres` profile remains in Compose but is Deferred and has not been accepted as part of this deployment. Do not enable it for this workflow. Separate-provider testing requires a later reviewed app environment override and separate acceptance. Cloudinary uploads and external production integrations are also outside this local core-business acceptance.
