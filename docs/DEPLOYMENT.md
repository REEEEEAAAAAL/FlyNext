# Deployment and database migrations

The hosted demo is [FlyNext](https://flynext-puce.vercel.app). Production runs on Vercel with Node.js 24 and the built-in AFS (`AFS_MOCK=true`). The optional standalone AFS is a separate local Docker deployment; see [Docker](DOCKER.md). Do not change providers on a database containing issued tickets.

## Build and configuration

Use `npm ci` and `npm run build`. Vercel uses `npm run vercel-build`, which generates Prisma Client and builds Next.js without running migrations or seeds. The lockfile pins Next.js 15.5.28, React 19.0.9 and Prisma 6.3.1.

Configure the variables in [`.env.example`](../.env.example) through the host's secret manager. Use a dedicated PostgreSQL database, a least-privilege runtime role and a separate migration role. Keep development, preview, production and disposable CI targets separate. Preview must not inherit production credentials. Supply Cloudinary credentials for image uploads; keep database credentials, signing secrets and API keys out of source control and logs.

Use the pooled PostgreSQL endpoint for runtime requests and the direct endpoint for controlled migrations, both pointing to the same intended database. The schema uses `DATABASE_URL`; set it to the direct connection in the migration process rather than changing runtime configuration. Never use a test runner, reset, `db push`, `migrate dev` or demo seed to upgrade live data.

## Migration inventory

FlyNext has eight checked-in migrations in [prisma/migrations](../prisma/migrations):

| Migration | Purpose |
| --- | --- |
| `20250405024941_init_postgres` | Initial application schema. |
| `20250610120000_add_room_availability_unique` | Unique room inventory per UTC date. |
| `20250610130000_add_query_indexes` | Query indexes. |
| `20261006160704_add_afs_offline_booking` | Durable built-in AFS booking ledger. |
| `20261006161000_add_afs_offline_booking_flight_ids_index` | Flight-ledger lookup index. |
| `20261017150000_session_security` | Refresh sessions and shared rate-limit counters. |
| `20261018090000_booking_consistency` | Idempotent booking requests, cancellation state and checkout snapshots. |
| `20261020091000_external_recovery` | Nullable JSONB `BookingRequest.recovery` for external-provider reconciliation. |

These eight migrations are applied to the current development, developer-test, CI-test, preview and production targets. This describes the application schema; the standalone AFS initializes its own seven upstream migrations plus one hardening migration.

For a release, inspect the exact database identity, role, migration history and pending SQL before authorizing writes. Run with the intended direct migration connection:

```sh
npx prisma migrate status
npm run prisma:migrate
npx prisma migrate status
```

Preserve a suitable recovery source before live database changes. Existing installations can contain historical executed checksums that differ from the checked-in SQL, including newline differences. Compare normalized SQL and actual schema; a migration-name count alone does not establish parity. Investigate a mismatch before further migration work, and never edit `_prisma_migrations` merely to make a check pass. Applying migrations and checking them are separate operations.

## Release and verification

1. Review the change and intended host, environment, database and roles.
2. Run engineering checks described in [Development](DEVELOPMENT.md). Review any pending migration and apply it through the authorized migration process.
3. Merge the reviewed PR. Vercel's Git integration builds preview branches and deploys `main` to production. Confirm the production deployment is `READY`, its commit matches the merged commit, and the public domain points to it.
4. Check `/`, `/flights`, `/hotels`, `/auth/login`, `/api/locations/cities`, `/api/locations/airports` and `/api/hotels`. Check flight search with valid airport codes and a future UTC date: `/api/flights/search?origin=YYZ&destination=LHR&date=YYYY-MM-DD` after substituting a real date.
5. Verify authenticated booking, cancellation, checkout, receipts and uploads separately with approved synthetic accounts when release scope permits writes. Read-only HTTP checks do not establish these workflows.

There is no public `/api/health` endpoint. Public catalogue APIs exercise database reads. Docker's internal health probe checks `SELECT 1` and the HTTP front door; it does not run as a Vercel health endpoint. Diagnose failures before changing production. Rollback, migration repair and data operations require their own explicit scope.

The manually dispatched database workflow is separate from the automatic engineering workflow; see [CI configuration](DEVELOPMENT.md#github-actions). Do not describe a successful build as database or browser acceptance.
