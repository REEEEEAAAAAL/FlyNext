# Deployment guidance (review before any release)

This replaces the obsolete ignored `dev_docs/VERCEL_DEPLOYMENT_CHECKLIST.md`.
Preparing configuration is not authorization to push, merge, migrate, seed or publish.
B01 is fixed in stage 3; public release still requires the remaining booking/UI/delivery gates in IMPROVEMENT_PLAN.

## Environment separation

- Production, Preview and Development must have separate database targets/credentials; do not point all three at production.
- Integration prefers the explicitly enrolled Neon test database from .env.test in DEVELOPMENT.md; business and unknown remote databases remain prohibited. Docker/native local PostgreSQL are optional.
- Store JWT signing secrets and Cloudinary credentials in the deployment secret store, never source/build arguments.
- JWT durations accept positive seconds or unit-bearing values such as `1h` and `7d`; B06 now normalizes both token and cookie lifetimes.
- The public demo defaults to built-in AFS (`AFS_MOCK=true`); remote AFS needs a reachable service and its key.
- Cloudinary accepts either CLOUDINARY_URL or the separate cloud/key/secret values. Current code gives a usable CLOUDINARY_URL precedence. Use only one form to avoid ambiguity.
- Do not set NODE_ENV=test on a deployment or enable destructive reset flags.

## Build and data

`npm ci` generates Prisma Client; `npm run build` / `npm run vercel-build` compile without applying migrations or seeding.
Use the existing Vercel/Next.js configuration after local/CI verification. Explicitly review the chosen deployment settings;
do not assume an arbitrary npm script name is automatically selected by every platform.

Schema rollout is a separate, authorized operation: verify the intended target and rollback/backup strategy, then apply
`prisma migrate deploy` and inspect migration status. Do not run `migrate dev` or reset against production.

If initial reference data is needed, review `npm run seed:reference` for the approved environment. It adds records and can
create/update a designated owner account; it is not a read-only check. Handle any generated owner password privately.

**Never run `npm run seed`, `seed:prod`, `prisma db seed`, `import-data.sh`, or `prisma/generate_data.sql` against production.**
The demo fixture deletes data; it is not an upsert-only seed. Its new local/non-production guard is intentional.

## Post-release acceptance (later stage)

Verify registration/login/refresh/logout, tenant boundaries, image uploads, one-way/round-trip searches, hotel inventory,
itinerary assembly, simulated checkout, PDF, cancellation and owner management. Verify both themes and mobile/desktop views.
Check logs without exposing tokens/credentials. A failed API/502 does not by itself prove a provider key rejection;
inspect private diagnostic logs and the configured service/storage independently.

No automatic push, merge, migration or publish is authorized for a business deployment. The stage-3 session migration adds two tables and invalidates legacy refresh cookies, requiring sign-in again. It has been applied only to the enrolled Neon test database. Roll back application code without dropping tables; old access JWTs expire normally. Complete the remaining stage gates before sharing a public deployment.
