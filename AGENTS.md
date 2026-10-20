# FlyNext Engineering Guidelines

FlyNext is a travel booking portfolio application built with Next.js. The interface is in English and supports light and dark themes.

## Tech stack

- Next.js 15 App Router, React 19, TypeScript 5 in strict mode, and Tailwind CSS 4.
- PostgreSQL and Prisma 6.3.1.
- Vitest for unit and integration tests; Playwright for browser end-to-end tests.
- The lockfile is authoritative for dependency versions. Do not upgrade or replace dependencies unless explicitly requested.

## Directory conventions

- `app/`: Pages, shared components, layouts, and error boundaries.
- `app/api/`: HTTP Route Handlers.
- `lib/api/`: Request validation, authentication, authorization, rate limiting, idempotency, and error handling.
- `lib/reservations.ts`: Reservation lifecycle and cross-domain coordination.
- `lib/afs/`: Built-in flight provider and its booking ledger.
- `prisma/`: Data models, migrations, and seed data.
- `types/`: Shared TypeScript contracts.
- `tests/`, `e2e/`: Unit/integration tests and browser workflows.
- `scripts/`: Development, verification, and maintenance commands.
- `docs/`: Public development/deployment guides and screenshots using synthetic data.
- `docs/internal/` provides optional local context. Public development, builds, and tests must not depend on it.

## Common commands

- `npm ci`: Install dependencies from the lockfile and generate Prisma Client without applying migrations.
- `npm run dev`: Start the local development server.
- `npm run typecheck`: Check TypeScript types in the application and tests.
- `npm run lint`: Run ESLint.
- `npm test`: Run database-independent unit tests.
- `npm run build:server`: Compile the standalone server TypeScript.
- `npm run build`: Create a Next.js production build.
- `npm run test:db:verify`, `npm run test:integration`, `npm run test:e2e`: Verify the database target, then run integration and browser tests in that order.
- `npm run prisma:migrate` and `npm run seed:reference` write to the database. Confirm the target before running them.
- `npm run seed` and `npm run seed:prod` are destructive demo seeds. Never use them on databases whose real data must be preserved.

## Implementation conventions

- Maintain strict typing; prefer existing modules, domain types, and response contracts.
- Do not hide uncertain types with `any`, type assertions, or disabled checks.
- Use `withRoute` and `ApiError` in Route Handlers.
- Preserve existing HTTP status codes, response envelopes, and JSON numeric types.
- Enforce authentication and resource ownership on the server; hiding UI controls alone is insufficient.
- Validate external input before database writes, uploads, or provider calls.
- Do not return database exceptions, connection details, or internal diagnostics to clients.
- Preserve existing error handling, rate limits, and idempotency boundaries. Do not remove safeguards to simplify implementation.
- Keep components and domain logic within the current directory structure and responsibilities where possible; do not introduce duplicate implementations.
- Keep comments concise, professional, and natural. Do not use Markdown, emojis, or decorative characters in comments.

## Safety and testing

- Do not commit or output environment files, real credentials, full connection strings, tokens, backups, or personal data.
- Use only invalid placeholders in example configuration. Do not copy local environment files as examples.
- Unit tests must not implicitly read local environment files or connect to a database.
- Integration and E2E tests must use a dedicated, isolated test database verified by the safety runner.
- Do not bypass the database safety runner or run test fixtures against development or production data.
- Before tests write to, migrate, or clear a database, confirm the target and the impact of the operations.
- Review Prisma migrations. Apply them only to explicitly authorized targets.
- Build steps must not implicitly run migrations, reset databases, or seed data.

## Core business constraints

- Use UTC calendar dates for hotel check-in and check-out. Preserve compatibility with legacy data and inventory concurrency safeguards.
- Preserve transactions and idempotency keys for reservation writes. Cancellation must restore inventory consistently, without duplicate decrements or increments.
- Public hotel and room-type responses must not include guest booking records.
- Verify the current user's identity and resource ownership when accessing hotel-owner data.
- An itinerary may contain at most one flight reservation and one hotel reservation.
- DEMO checkout must not process real money or collect real payment-card or passport details.

## Documentation and delivery

Read relevant sections of `docs/DEVELOPMENT.md` or `docs/DEPLOYMENT.md` as needed; reading all documentation is unnecessary.
Keep public documentation concise and reproducible. Do not include internal handoffs, private endpoints, or production operations records.
