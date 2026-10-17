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

## Dedicated local integration database

Prerequisite: native PostgreSQL tools (`initdb`, `pg_ctl`, `createdb`, `psql`) on PATH.
Alternatively set `FLYNEXT_PG_BIN` to their installation directory. The helper uses existing tools only;
it does not install software, alter an existing PostgreSQL service or require Docker.

```bash
npm run test:db:start
npm run test:db:check
npm run test:integration
npm run test:db:stop
```

The first start creates a NEW cluster under ignored `.local-test-db/`, listens only on 127.0.0.1:55432,
creates the dedicated `flynext_test` database/role, and generates random credentials and a UUID in
ignored `.env.test.local`. SCRAM authentication is required. Existing `.env` and `.env.test` remain untouched.
Start/check/stop control only the cluster whose local identity metadata matches; no command drops a database or volume.
Partial initialization is preserved for diagnosis, not automatically deleted or adopted.

Integration setup checks before connecting: non-production/non-deployment context; explicit
`FLYNEXT_ALLOW_DATABASE_RESET=1` in `.env.test.local`; literal loopback host; dedicated port/name/role;
and an identity UUID. It then reads PostgreSQL's database comment and matches that identity BEFORE
migrations or TRUNCATE. The migration and reset helpers repeat that verification at the write boundary.
A name ending in `_test` by itself is insufficient.

Tests apply repository migrations and clear all application tables between cases. This is authorized
only for the newly created disposable target. Image credentials are blanked and AFS is forced in-process;
the integration suite must not upload real assets or book remote flights.
The checked-in `.env.test.example` documents the format; use the helper rather than copying a remote URL.

If PostgreSQL tools, loopback networking or process permissions are unavailable, stop and record the
blocker. Never fall back to a remote database or disable the guard to obtain a green test result.

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
It remains a database write requiring an explicitly approved target. No seed or migration should be run
against the existing remote databases during routine verification. Do not execute the SQL fixture directly.

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
No automatic commit/push/merge/deploy. Stage 3 starts with the still-open B01 guest-data exposure.
