# Safe development and verification

## Restore and run

Use the committed lockfile: `npm ci`, then `npm run typecheck`, `npm test`, and `npm run build`.
The install's `postinstall` generates Prisma Client; it does not migrate or seed a database.
Do not remove Analytics, disable checking, or upgrade the dependency tree to bypass an installation error.
`npm run dev` starts development; `npm start` serves an already successful production build.

On Windows, an EPERM in `.next` may be a sandbox/filesystem permission failure. Retry the same build
with an approved execution context before changing source or ACLs. Do not grant broad permissions,
delete existing user changes, or assume a failed build is a code defect.

## Unit tests (safe default)

`npm test`, `npm run test:unit`, and `npm run test:watch` use `vitest.config.ts`.
They do not load `.env`, `.env.test` or `.env.test.local`, create Prisma connections, migrate or truncate.
Current unit files cover booking display, flight direction projection, upload placement/configuration and database safety boundaries.
The direction suite mocks unrelated Prisma infrastructure so importing its functions cannot load application credentials.
Add future database-free suites to `unitTestFiles` in `vitest.shared.ts`; all other suites belong to the explicit integration command.

## Preferred integration target: enrolled Neon test database

The current integration environment is the existing Neon `flynext_test` database configured in
ignored `.env.test`. Docker Desktop is optional. The runner always takes `DATABASE_URL` from that
file, overriding shell/application values without editing the file. `.env.test.local` never overrides it.
There is no silent fallback when the selected file or target is unsafe.

```bash
npm run test:db:verify
npm run test:integration
```

Integration is destructive: repository migrations run before the suite, factories initialize synthetic
data, and application tables are TRUNCATEd between cases. Only the specifically enrolled target is
approved for these operations. Generic `seed`, `seed:prod`, raw SQL and unknown remote targets remain refused.
Do not run a second suite or use the same test database interactively while this suite is running.

Enrollment is a deliberate one-time operator action, after authorization to clear the exact target:

```bash
# Only after checking ownership and confirming this exact database is disposable:
node node_modules/tsx/dist/cli.mjs scripts/neon-test-db.ts enroll --confirm-reset=flynext_test
```

The current target has already been enrolled; do not enroll it again. Enrollment checks the exact Neon
host/port/database/role, TLS, non-deployment context, actual PostgreSQL database name/OID/owner/current role,
absence of an unrelated marker and absence of unknown project-external tables. It compares physical database
identity with all available business `.env`, `.env.local`, development and production env files, including direct
and pooled URL aliases. A test filename, `_test` suffix or reset environment flag is never enough.
The current test and business databases have different database names on the same Neon endpoint and role;
this is database-level separation, not a separate Neon project or least-privilege role. Do not treat that role
as safe for arbitrary administrative commands.

Enrollment adds a random database comment and writes ignored `.neon-test-approval.json` containing only
an identity fingerprint, database OID and matching UUID, without credentials. Every migration/TRUNCATE
rechecks the configured target, business exclusion and the independently read database marker/OID/current role.
Unknown remote databases, changed endpoints/roles/database names, missing/mismatched markers, non-public
schemas, routing overrides, missing TLS and production/deployment context are rejected. Recreated databases
fail their old OID/marker checks. Investigate rather than copying an approval to bypass a failure.
Business configurations from other deployment secret stores must also be checked by the operator at enrollment;
the local tool can only compare configurations available on this machine.

Prisma stays at **6.3.1**. Integration schema setup uses the existing transactional SQL migration runner through
the corresponding Neon **direct** endpoint, derived only by removing `-pooler` from the already verified host.
The original pooled `DATABASE_URL` is preserved for application/test queries. Both connections must report the
same database identity. No Prisma 7 configuration or driver-adapter upgrade is required.
See [Prisma's PgBouncer guidance](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/pgbouncer)
for the reason schema operations use a direct connection.

The outer integration runner rejects production/deployment context before starting Vitest; setup repeats the
checks before connecting and at write boundaries. Tests blank real Cloudinary credentials and force built-in AFS.
They never upload real images or book remote flights. Keep env files and the enrollment record out of Git,
Docker build context, logs and screenshots. Never print full URLs or errors containing connection credentials.

## Optional native local PostgreSQL

If explicitly choosing the local alternative, native PostgreSQL tools must be on PATH (or use `FLYNEXT_PG_BIN`).
The existing helper manages only its own `.local-test-db/` cluster, generated `.env.test.local`, literal loopback
port 55432, dedicated `flynext_test` role/database and independent UUID marker. It never controls Neon.

```powershell
npm run test:db:start
npm run test:db:check
$env:FLYNEXT_TEST_ENV = "local"
npm run test:integration
Remove-Item Env:FLYNEXT_TEST_ENV
npm run test:db:stop
```

Only `FLYNEXT_TEST_ENV=local` selects this alternative. A missing/invalid Neon enrollment never starts local
PostgreSQL automatically. Docker is another optional development deployment; it is not a prerequisite for tests.
The local cluster remains stopped unless explicitly started.

## Destructive demo fixture

`npm run seed`, compiled `npm run seed:prod`, `prisma db seed`, and `import-data.sh` ultimately use the guarded
`prisma/seed.ts`. The SQL fixture TRUNCATEs business tables. The guard rejects production/deployment contexts,
non-loopback hosts, unsupported routing/schema parameters and database names other than disposable
`flynext_*_test` / `flynext_*_demo` names, even if opt-in is present.

Only for a disposable local demo database, explicitly set `FLYNEXT_ALLOW_DATABASE_RESET=1` in the shell
and verify `DATABASE_URL` targets it before running seed. The `seed:prod` suffix means compiled code;
it does NOT make the destructive fixture safe for production. The compiled command first rebuilds server code,
so stale local dist output cannot bypass the new guard. The default seed command intentionally refuses without opt-in.

`npm run seed:reference` adds reference data and may create/update the designated owner account.
It remains a database write requiring an explicitly approved target. Only the guarded integration runner may migrate and initialize the enrolled Neon test target during verification; business databases remain prohibited. Do not execute the SQL fixture directly.

## Docker and deployment

Compose references the tracked lowercase `dockerfile`; Docker's dependency stage copies Prisma schema
before `npm ci` because postinstall needs it. `.dockerignore` excludes credentials, local DB files,
booking backups, Git metadata, installed dependencies and generated outputs. Compose forwards Cloudinary
configuration at runtime; credentials must never be build arguments or committed files.

Validate without printing interpolated secrets: `docker compose --env-file .env.example config --quiet`
(or `docker-compose --env-file .env.example config --quiet` when the standalone CLI is installed). This
uses placeholders only; an actual run requires real runtime configuration. Actual image build/run
requires a running Docker engine; configuration validation alone does not prove the image runs.
Current Node 20 image/runtime modernization and optional upstream AFS pinning remain follow-up items;
this stage does not change application behavior or upgrade the stack.

Use [DEPLOYMENT.md](DEPLOYMENT.md) for current release guidance. Ignored `dev_docs/` is historical,
not the source of truth. Never use the reset fixture to initialize a production database.

## Stage boundary

Every stage ends with actual command/results, diff review and updates to IMPROVEMENT_PLAN/PROGRESS.
No automatic commit/push/merge/deploy. Stage 3 started with B01; see PROGRESS for actual regression results.

## Stage-3 session and API changes

Public room details contain only room metadata and availability. Owner guest data is served by
`GET /api/hotels/[hotelId]/room-types/[roomTypeId]/reservations`, requiring the current hotel owner,
matching room/hotel IDs and `private, no-store`. The owner editor uses this separate endpoint on load and after cancellation.
The room GET inventory side effect remains B10 for stage 4.

`20261017150000_session_security` adds RefreshSession and RateLimitCounter without altering existing business columns.
Apply it to other environments only after separate target approval. Existing JWT refresh cookies are intentionally
invalid: users sign in again. Refresh credentials are random opaque values, only their hashes are stored; rotation,
replay revocation and logout share a per-family PostgreSQL transaction lock. The absolute session expiry is preserved.
Access JWTs live only in browser memory; page reload recovers via the HttpOnly cookie. Login/logout wait for in-flight refresh responses; Web Locks coordinate cookie writers between tabs where supported. GET can recover/retry once;
writes are never automatically replayed. A lost write response requires checking the booking/itinerary list.
JWT bare numeric durations now mean seconds, matching cookie lifetime.

Production auth/write rate budgets use atomic PostgreSQL counters; catalogue reads use bounded process memory.
Limits are namespaced by rule and identity. Production cannot disable limits through RATE_LIMIT_DISABLED.
For a dedicated shared-store regression, tests explicitly select FLYNEXT_RATE_LIMIT_STORE=database.
The current deployment proxy must supply trustworthy forwarding headers; do not expose a direct server while trusting arbitrary client headers.
Image writes accept bundled defaults or the configured Cloudinary delivery origin, max 12 images/25MB per request
and 5MB per file. Failed uploads/database writes compensate only new request assets, never retained images.
Cleanup failure is logged for operator follow-up; real provider upload/deletion has not been exercised in tests.
