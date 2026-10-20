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

Confirm both Client and Server with `docker version` before starting. If the host uses a proxy, preserve its working Docker configuration. If `docker compose` is unavailable but Docker Desktop is installed, use its `resources/cli-plugins/docker-compose.exe` executable with the same arguments.

## First build and startup

```sh
docker compose --env-file .env.docker.local config --quiet
docker compose --env-file .env.docker.local up -d --build --wait nextjs
docker compose --env-file .env.docker.local ps
```

Open [FlyNext](http://localhost:3300). Use `localhost` for browser access so browsers can use the production Secure refresh cookie on the trusted local origin. Do not expose this HTTP demo on a LAN address. The full demo contains the existing synthetic users (`user1@example.com` / `password1` is one example), owners, cities, airports, hotels, room types and a UTC nightly inventory calendar. It also creates one built-in AFS flight reservation, one hotel reservation and one draft itinerary for that demo user. New accounts can register normally. Do not enter real card, passport or personal details.

Compose waits for PostgreSQL health. The non-root application startup then retries the connection for up to 60 seconds, verifies the database identity, applies the repository's Prisma migrations and performs the full demo seed once. Initialization failure prevents the server from starting. An interrupted seed is recorded and requires an explicit reset after inspecting logs; startup does not silently repeat destructive initialization.

`DATABASE_URL` is constructed with the fixed `postgres:5432`, `flynext_docker_demo` database and non-superuser `flynext_docker` role. An inherited `DATABASE_URL`, Neon credentials, ordinary `.env`, `.env.test`, AFS URL or Cloudinary settings are not injected. The image excludes local environment files and uploads. PostgreSQL bootstrap creates a protected instance marker and records its physical cluster ID. Maintenance verifies both against the live server, database, role and container DNS address before migrations or seed operations. Existing local/CI database safety runners are unchanged.

Normal startup applies pending migrations and preserves all existing demo accounts, reservations, orders and inventory. FlyNext currently has eight migrations through `20261020091000_external_recovery`; see the [migration inventory](DEPLOYMENT.md#migration-inventory). Migrations still need review when updating the code. The reference seed is non-destructive and is not a substitute for the full initial demo seed.

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

## Optional standalone AFS

The default remains the built-in provider, including ordinary production deployments. Plain Compose starts only `nextjs` and `postgres`, with `AFS_MOCK=true`. It neither builds nor starts the optional provider.

Use a separate configuration and project for remote acceptance. Never repoint an existing database between providers: stored tickets belong to the provider that issued them. The generator refuses to overwrite files and uses a new project, new instance IDs, independent database credentials, a random AFS API key and port 3301.

PowerShell:

```powershell
docker run --rm --mount "type=bind,source=$($PWD.Path),target=/workspace" -w /workspace node:24-alpine node scripts/docker/config.mjs --afs
```

On a POSIX shell, replace `source=$($PWD.Path)` with `source=$PWD`. With host Node.js, the equivalent is `node scripts/docker/config.mjs --afs`. Optional `--output .env.docker.other.local --port 3302` creates another isolated acceptance project without changing an existing configuration.

```sh
docker compose --env-file .env.docker.afs.local -f docker-compose.yml -f docker-compose.afs.yml --profile afs config --quiet
docker compose --env-file .env.docker.afs.local -f docker-compose.yml -f docker-compose.afs.yml --profile afs up -d --build --wait nextjs
docker compose --env-file .env.docker.afs.local -f docker-compose.yml -f docker-compose.afs.yml --profile afs ps
```

Open [the remote demo](http://localhost:3301). Both the `afs` profile and `docker-compose.afs.yml` are intentional: the profile enables the provider services, and the override switches FlyNext to `AFS_MOCK=false`, `AFS_BASE_URL=http://afs:3000` and the generated key. A profile alone does not change FlyNext's provider. Keep the same files and flags for subsequent remote commands. Clear inherited AFS variables as well as Compose/FlyNext variables before running; do not print expanded configuration or container environments.

The image uses a detached checkout of the pinned upstream revision, verifies its original SHA-256 source hashes, and applies the versioned hardening overlay and lockfile. Node 24 installs, generates Prisma Client, builds and prunes dependencies during the image build. See [AFS hardening](../afs/README.md) for the source pin, dependency versions, protocol and maintenance rules.

After building the AFS image, run the read-only topology check for the selected local project. It validates service composition, loopback-only app binding, isolated database volumes and credentials, and the AFS image revision label without printing expanded configuration:

```sh
node scripts/docker/topology-acceptance.mjs
node scripts/docker/topology-acceptance.mjs --afs
```

The AFS mode requires the existing `.env.docker.afs.local` configuration and a locally built image. If Docker Compose is installed as a standalone CLI, set `DOCKER_COMPOSE_CLI` to its executable path; `DOCKER_CLI` may be set when Docker is not on `PATH`.

### Initialization and persistence

AFS waits for its own PostgreSQL health, verifies the fixed `afs-postgres:5432 / afs_docker_demo / afs_docker` target, DNS address, nonprivileged role, protected instance marker and physical cluster ID, then applies the seven upstream migrations and one additive hardening migration. The additional migration adds nullable operation/hash fields, a unique agency/operation index and a nonnegative-seat constraint; it preserves existing ticket IDs and links and fails if existing inventory violates the constraint. These migrations include historical table replacements and must only initialize the newly created AFS database, never an unrelated populated database. Initialization failures stop startup.

The additive seed initializes 84 airports, 49 airlines and one agency, then guarantees 14 days of synthetic flights including YYZ–LHR in both directions. `AFS_SEED_DAYS` accepts 7–90. Identifiers are deterministic and inserts skip duplicates; startup never deletes scheduled flights, resets seats or removes booking links. A repeat seed with active tickets was verified to leave the database digest identical. Extending the horizon adds days; shortening it does not delete older data. Data grows over time; retention is a separate operation.

AFS uses its own `afs_postgres_data` volume and credentials. FlyNext retains its independent `postgres_data` and upload volume. Neither AFS nor either database publishes a host port. AFS runs as UID 1001 and its authenticated health probe checks the real catalogue and database. FlyNext waits for AFS health before startup. Health failures are visible but do not themselves restart a running process.

The generated key is injected privately into the agency, health probe and FlyNext HTTP client. It is never printed. An existing agency with mismatched credentials stops initialization instead of silently rotating the key. Keep the matching generated configuration with the volumes.

### Business checks and restart

These guarded scripts write synthetic data only after verifying the dedicated Docker target. Run direct AFS acceptance first, then FlyNext's full business smoke and remote-specific round-trip, connection, replay and compensation checks.

```sh
docker compose --env-file .env.docker.afs.local -f docker-compose.yml -f docker-compose.afs.yml --profile afs exec -T afs node afs/acceptance.mjs
docker compose --env-file .env.docker.afs.local -f docker-compose.yml -f docker-compose.afs.yml --profile afs exec -T nextjs node scripts/docker/smoke.mjs
docker compose --env-file .env.docker.afs.local -f docker-compose.yml -f docker-compose.afs.yml --profile afs exec -T nextjs node scripts/docker/remote-smoke.mjs
docker compose --env-file .env.docker.afs.local -f docker-compose.yml -f docker-compose.afs.yml --profile afs exec -T nextjs node scripts/docker/smoke.mjs snapshot
docker compose --env-file .env.docker.afs.local -f docker-compose.yml -f docker-compose.afs.yml --profile afs exec -T afs node afs/acceptance.mjs snapshot
docker compose --env-file .env.docker.afs.local -f docker-compose.yml -f docker-compose.afs.yml --profile afs stop nextjs afs postgres afs-postgres
docker compose --env-file .env.docker.afs.local -f docker-compose.yml -f docker-compose.afs.yml --profile afs up -d --wait nextjs
docker compose --env-file .env.docker.afs.local -f docker-compose.yml -f docker-compose.afs.yml --profile afs exec -T nextjs node scripts/docker/smoke.mjs compare
docker compose --env-file .env.docker.afs.local -f docker-compose.yml -f docker-compose.afs.yml --profile afs exec -T afs node afs/acceptance.mjs compare
docker compose --env-file .env.docker.afs.local -f docker-compose.yml -f docker-compose.afs.yml --profile afs exec -T nextjs node scripts/docker/remote-smoke.mjs compare
```

Snapshot files live in container `/tmp`; compare them across stop/start of the same containers. Active synthetic bookings remain after acceptance. Run these checks on a fresh remote project before ever using a different provider there; the extended check asserts the built-in ledger is empty. Normal restarts retain reservations in both databases and insert no duplicate flights.

### Return to the built-in provider

Stop the remote project without removing its containers or volumes, then use the original built-in project's configuration. Its own port remains 3300. Resume the remote project with the same override/profile to manage its existing tickets.

```sh
docker compose --env-file .env.docker.afs.local -f docker-compose.yml -f docker-compose.afs.yml --profile afs stop
docker compose --env-file .env.docker.local up -d --wait nextjs
```

Do not reuse the remote database in built-in mode to manage remote tickets. A local-only reset cannot cancel upstream bookings, so `start.mjs reset` is refused in remote mode. Reconcile/cancel remote tickets first and generate a new isolated project if fresh data is needed. The built-in explicit reset described above remains available.

### Troubleshooting and accepted scope

Use `logs --tail 100 afs afs-postgres nextjs` with the same remote flags. Check PostgreSQL readiness and identity, migration phase, seed validation and the authenticated AFS health probe. A malformed or missing required remote URL, authentication refusal, disconnected provider, timeout or invalid response fails explicitly; it never falls back to synthetic offline results. AFS errors map to 502 without expiring the user's login. Requests time out after 15 seconds. FlyNext stores the request and recovery payload together before calling AFS, and sends its durable operation UUID as `Idempotency-Key`. AFS serializes that agency/key and commits all seat decrements, flight links and the ticket in one transaction. Different keys contend on ordered row locks and conditional seat updates. Cancellation locks the ticket and commits its status and seat restoration together; repeat cancellation returns the same cancelled ticket. New references use the full UUID. Legacy six-character references work only when unambiguous within the agency and passenger surname; ambiguity returns the same generic 404 as an absent ticket.

Docker startup supervises a recovery worker. Every 15 seconds it scans up to 100 requests older than 30 seconds and resumes pending flight, standalone cancellation and whole-itinerary cancellation work. It queries tickets by agency-scoped operation key, verifies the provider's safe-recovery protocol marker and replays only the same durable key. A lost HTTP response or process crash can therefore recover the original ticket without issuing another. Mirror and saved success response commit together. Local write failure enters COMPENSATING; retries cancel the same remote ticket until the request has a terminal failure response. A provider lacking the protocol marker is never blindly replayed. Definitive provider rejection has a terminal replayable 502; an uncertain result remains pending and may return 409 while recovery runs. Keep the same browser request key.

Run an immediate guarded recovery scan or runtime audit with the same Compose flags:

```sh
docker compose --env-file .env.docker.afs.local -f docker-compose.yml -f docker-compose.afs.yml --profile afs exec -T nextjs node scripts/docker/reconcile.mjs --once
docker compose --env-file .env.docker.afs.local -f docker-compose.yml -f docker-compose.afs.yml --profile afs exec -T afs npm audit --omit=dev --registry=https://registry.npmjs.org
```

### Reproducible fault and concurrency checks

Use a fresh generated acceptance project for these fixtures. They verify the Docker database identity before writes and retain synthetic tickets. The concurrency script exercises 32 same-key requests, 32 different-key last-seat contenders, 32 simultaneous cancellations, multi-leg rollback, duplicate IDs, inventory constraints, agency isolation and legacy reference collisions. For independent database connections, start a temporary second AFS process with Compose run, name it PROJECT-afs-peer, and pass AFS_TEST_PEER=http://PROJECT-afs-peer:3000 to the script; replace PROJECT with this generated project's exact name. The peer needs no host ports and must use this project's database and credentials.

```sh
docker compose --env-file .env.docker.afs.local -f docker-compose.yml -f docker-compose.afs.yml --profile afs exec -T afs node afs/hardening-acceptance.mjs
docker compose --env-file .env.docker.afs.local -f docker-compose.yml -f docker-compose.afs.yml --profile afs exec -T afs node afs/date-extension-acceptance.mjs
```

The date-extension check adds a 16-day horizon and checks all existing flights and booking links before repeating and shortening the seed. Run it on a fresh 14-day acceptance schedule. The recovery fixture accepts before, after, timeout, disconnect and compensation modes, followed by check-MODE. The before/after modes intentionally SIGKILL only their disposable exec process; the worker then recovers the saved request. Timeout/disconnect use a local fault proxy after a real AFS commit. Compensation injects a local foreign-key failure and an unavailable cancellation, then verifies automatic cancellation retry. Logs contain synthetic identifiers, never keys or connection URLs.

The AFS crash fixture, afs/crash-acceptance.mjs prepare, installs a uniquely named test trigger for one generated operation and pauses a real HTTP transaction after seat decrement. After its READY message, kill only that fresh acceptance project's AFS service, restart it, and run the fixture with check. The check removes only its own trigger/function and verifies atomic rollback, same-key retry and inventory restoration. Never run process-crash fixtures on a project whose activity must remain uninterrupted.

### Browser receipt downloads and scope

Use real Chrome after DEMO confirmation. scripts/docker/browser-receipt.mjs accepts a localhost base URL, a synthetic user1 itinerary ID and an output path. It uses an isolated Chrome profile, validates HTTP 200, application/pdf, attachment filename, saved bytes, two-page PDF parsing and the absence of browser errors. The normal Chrome profile may show a download confirmation that the user must accept. Download-manager extensions can intercept an authenticated PDF fetch and replace it with HTTP 204 even while the desktop manager is closed. Disable the extension yourself for normal browser downloads, or use the isolated profile for comparison; no global browser settings need changing.

This is a private local synthetic integration. Real airline ticketing, real payments/refunds and formal production release are outside its scope. Cloudinary remains an optional image backend and is independent of the local AFS checks.
