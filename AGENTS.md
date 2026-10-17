# FlyNext engineering context

## Start here

- Read `docs/PROGRESS.md`, then the current stage in `docs/IMPROVEMENT_PLAN.md`.
- Reuse the recorded audit. Expand inspection only when relevant code changed or evidence is stale.
- Work on `codex/improvements`. Stage 2 began at `2b41cea9735c96c600ef0983f550ff309b28d6a3` with a clean worktree and index.
- Preserve all pre-existing changes. Do not reset, clean, force checkout, auto-commit, push, merge, or publish without authorization.
- Implement only the authorized stage. At its end update both documents, review the diff, report checks and a suggested commit message, then stop.

## Product and architecture

- Public portfolio travel demo; normal registration/login, English UI, light/dark themes, simulated payment. No real financial transaction is implemented.
- Next.js 15 App Router, React 19, strict TypeScript 5, Tailwind CSS 4, PostgreSQL and Prisma 6.
- `app/`: pages, client components/context/helpers; `app/api/`: typed Route Handlers.
- `lib/api/`: authentication, validation, error boundary, limits, uploads; `lib/reservations.ts`: shared booking lifecycle.
- `lib/afs/`: built-in flight provider and persistent ledger; `lib/afs-client.ts`: remote/built-in contract boundary.
- `types/`: transport/domain types; `prisma/`: schema, migrations, reference seed and destructive demo fixture.
- Cloudinary stores images; pdf-lib generates receipts; Chart.js renders owner charts.
- Preserve existing business scope: bookings precede itinerary assembly; an itinerary links at most one flight reservation and one hotel reservation; a user becomes a hotel owner by creating a hotel.

## Commands

- `npm ci`: restore locked dependencies (runs Prisma generation; never applies migrations).
- `npm run dev`, `npm run build`, `npm start`: development, production build and production server.
- `npm run typecheck`: application and test types; `npm run build:server`: compile framework-independent server/seed code to ignored `dist/`.
- `npm test` / `npm run test:unit`: database-free tests only.
- `npm run test:integration`: destructive integration suite; requires the dedicated local test environment described in `docs/DEVELOPMENT.md`.
- `npm run prisma:generate`: generate client only. `npm run prisma:migrate`: writes schema; inspect target and obtain authorization for that environment first.
- `npm run seed` and `seed:prod`: destructive reset fixture, local disposable `_test`/`_demo` database only, with explicit opt-in. The `:prod` name refers to compiled output, NOT production safety.
- `npm run seed:reference`: additive reference data, still a database write; never run against existing remote data as part of routine validation.

## Safety and conventions

- Never print or commit `.env` contents, connection credentials, tokens, API keys, booking backups or database files.
- Never migrate, truncate, reset or seed the existing remote databases. A `_test` suffix alone does not establish isolation.
- Integration setup must reject production/deployment environments, non-loopback hosts, unapproved database names and missing destructive-operation opt-in BEFORE connecting.
- Keep pure tests independent of env-file loading, Prisma connections, migrations and Cloudinary calls.
- Route errors use `withRoute`/`ApiError`; preserve established response envelopes and JSON numeric values. Do not suppress type/build errors or remove working features to pass checks.
- Use migrations for intentional schema changes; stage 2 must not modify business handlers, auth behavior, booking logic or UI.
- UI stages require actual desktop/mobile interaction and screenshots when possible. Clearly record unverified visual checks.
- Update progress with actual commands/results, blockers, migration impact and next entry point. B01 (public room API exposing guest data) remains the first stage-3 P0 task.
