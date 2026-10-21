# Development, testing and CI

Start with [README](../README.md) for architecture, installation and environment variables. Use Node.js 24 and `npm ci`; dependencies come from the lockfile. Copy `.env.example` to `.env` only if no configuration exists, then configure a dedicated development database. For complete local containers, use [Docker](DOCKER.md); for hosted migrations, use [Deployment](DEPLOYMENT.md).

## Daily checks

Start the app with `npm run dev`. Run checks appropriate to the change, stopping the development server before building:

```sh
npm run typecheck
npm run lint
npm test
npm run build:server
npm run build
```

`npm test` is database-independent and does not read local environment files. Type checking, Next.js builds and E2E builds must run sequentially when sharing `.next`. `npm audit --audit-level=high` checks current advisories without upgrading dependencies. Never disable safety, runtime-error, type or lint checks to hide a failure.

The hotel calendar regression uses simulated dates across 2026–2028, leap day and DST in several time zones. Run the focused database cases through the guarded runner:

```sh
npm run test:db:verify
npm run test:integration -- tests/hotel-inventory-rolling.test.ts tests/booking.oversell.test.ts tests/booking.stage4.test.ts tests/hotels.room-availability.test.ts
```

These cases exercise missing-night reads, concurrent materialization and booking, repeated cancellation, and reference backfill with active reservations. Reference backfill preserves stored nights and uses the same room lock and occupancy calculation as booking. Historical non-UTC dates still require explicit review; schema equality does not establish data equivalence.

## Development data

Review and apply the eight application migrations with `npm run prisma:migrate` only after confirming the development target. `npm run seed:reference` adds cities, airports, reference hotels, room types and nightly availability, and can create or update the configured demo owner. Review `SEED_OWNER_EMAIL` and `SEED_OWNER_PASSWORD` before running it. It writes data and is not a routine check.

`npm run seed` and `npm run seed:prod` delete data and rebuild demo fixtures. The `:prod` suffix means compiled output, not permission to run against production. Do not run either against data that must be preserved.

## Database and browser tests

Integration and E2E runners migrate and clear synthetic records. They require a dedicated disposable database, confirm its identity before writes, and exclude configured business databases. Do not bypass the runners, reuse a running app server for E2E, or redirect these tests to a Docker application database.

### Local PostgreSQL

Install PostgreSQL CLI tools on PATH, or set `FLYNEXT_PG_BIN` to their bin directory. In PowerShell:

```powershell
$env:FLYNEXT_TEST_ENV = 'local'
npm run test:db:start
npm run test:db:verify
npm run test:integration
npm run build
npm run test:e2e
npm run test:db:stop
```

The helper owns `.local-test-db/` and `.env.test.local`, creates a marked `flynext_test` database on loopback port 55432, and preserves existing configuration. Keep the cluster, identity metadata and matching environment file together. Other databases and services are outside the helper's scope.

### Neon test target

Use a separate disposable Neon database named `flynext_test`, with its own login and no valuable data. Copy [`.env.test.example`](../.env.test.example) without overwriting an existing `.env.test`, then configure only test credentials. Do not copy business credentials into it.

On a new, reviewed target, explicitly authorize enrollment and future fixture cleanup before running:

```sh
npm run test:db:enroll -- --confirm-reset=flynext_test
npm run test:db:verify
npm run test:integration
npm run build
npm run test:e2e
```

Enrollment verifies database ownership and identity, writes a database COMMENT marker, and creates ignored `.neon-test-approval.json`; it does not migrate or clear tables. Existing enrollment is preserved. A test filename, `_test` suffix or shell flag alone is not authorization. Subsequent runners recheck the marker, OID, role and target fingerprint. Migration setup derives a direct connection from the same pooled Neon endpoint for DDL.

Use `.env.test` for Neon; set `FLYNEXT_TEST_ENV=local` only for the generated loopback alternative. E2E starts its own single-worker production server on port 3210 and requires a current build. Test configuration forces built-in AFS and disables real Cloudinary credentials.

## GitHub Actions

[Engineering regression](../.github/workflows/ci.yml) runs on push, pull request and manual dispatch: Node 24, locked installation, Prisma generation, type checking, lint, unit tests, server and Next.js builds, and high-severity dependency audit. Its database URL is a nonconnecting build placeholder.

[Isolated database and browser regression](../.github/workflows/database-regression.yml) runs only on manual dispatch using the `flynext-ci` GitHub Environment. It writes and clears test data, uses one global concurrency group, and must run only reviewed code against an independently enrolled CI target.

For a new CI setup:

1. Create a separate Neon project and empty `flynext_test` database owned by a dedicated `flynext_ci_runner` login. Give it `USAGE, CREATE` on `public`; it must own the disposable database and objects it migrates, without superuser, role/database creation, replication, bypass-RLS or `neon_superuser` membership. Do not share it with local tests or other repositories.
2. In a clean checkout, configure a CI-only `.env.test` and set `CI=true`, `CI_TEST_DATABASE_HOST` to that endpoint's direct hostname, and `CI_BUSINESS_DATABASE_TARGETS` to the exclusion list below. Review the target and authorize enrollment, then run `npm run test:db:enroll -- --confirm-reset=flynext_test` followed by `node node_modules/tsx/dist/cli.mjs scripts/verify-ci-target.ts`. Do not replace an existing local enrollment.
3. Configure the following GitHub Environment entries. Restrict permitted branches and require review where supported. Keep credentials at Environment scope; do not expose them to unreviewed PR code or `pull_request_target`.

| Type | Name | Content |
| --- | --- | --- |
| Secret | `CI_TEST_ENV` | Complete CI-only `.env.test`. |
| Secret | `CI_TEST_APPROVAL` | Enrollment-generated `.neon-test-approval.json` for that exact target. |
| Variable | `CI_TEST_DATABASE_HOST` | Direct hostname, without protocol, port, path or `-pooler`. |
| Variable | `CI_BUSINESS_DATABASE_TARGETS` | Nonempty JSON array of every development, developer-test, preview and production host/database pair to exclude. |

Exclusion entries contain only `host` and `database`, never credentials. Example shape with an invalid placeholder hostname:

```json
[{"host":"ep-business-example.us-east-2.aws.neon.tech","database":"business_database"}]
```

The workflow writes temporary test configuration, verifies isolation and restricted privileges, runs integration tests, builds, installs Chrome, and runs E2E. Missing or mismatched identity stops execution; there is no fallback database. Failure reports are retained for three days; temporary credential files are removed in the final cleanup step. No Vercel, Cloudinary or Neon API key is needed by this workflow. Dispatching it is a separate data-writing operation, not part of documentation validation.

## Local generated files

Keep active `.env*`, test enrollment, local PostgreSQL identity/data, CLI project links and Compose configuration with their services. Ignore rules protect these files; an ignored extension does not imply disposable content. Build outputs, reports, caches and completed diagnostics can be removed after checking live references. No development or build step requires historical planning or acceptance reports.
