# Local development and verification

## Install and configure

Use Node.js 24. Copy `.env.example` to `.env` and set values for a development database and the services you intend to use. Keep real credentials in ignored environment files or a secret manager; never commit them. `npm ci` restores the locked dependencies and generates the Prisma client without applying migrations.

Run the application with `npm run dev`. Useful checks are:

```sh
npm run typecheck
npm run lint
npm test
npm run build:server
npm run build
npm audit --audit-level=high
```

The default `npm test` workflow runs database-independent tests and does not connect to PostgreSQL. Do not run a development server and production build concurrently because both use `.next`.

## Initialize a development database

Configure `DATABASE_URL` for a dedicated development database. Review the Prisma migrations, then apply them with `npm run prisma:migrate`. The optional `npm run seed:reference` command writes reference cities, airports, hotels, room types, availability, and may create or update the configured demo owner account. Review the seed variables before running it and use only a disposable or dedicated development database.

The `seed` and `seed:prod` commands are reset fixtures that delete data. Never use them with a database containing real or otherwise valuable data. A `:prod` suffix describes compiled output; it does not make a command production-safe.

## Integration and browser tests

Database integration and Playwright tests can migrate and clear synthetic test data. Use only a separate test database with no valuable data. Configure and verify the test target using the repository's guarded test runner before running tests:

```sh
npm run test:db:verify
npm run test:integration
npm run test:e2e
```

Run these commands in order, with `npm run build` before `npm run test:e2e`. The Playwright runner starts its own local server from that build. Do not bypass the guarded runner or point tests at development or production data. CI requires its own isolated test database and restricted credentials.

## Troubleshooting

If installation, Prisma generation, or builds fail because of filesystem permissions, retry in an authorized environment and retain the original safety checks. Do not disable type, lint, or build checks to hide errors.

## Complete local Docker environment

For a deployment using only Docker Desktop / Compose, see the [Docker guide](DOCKER.md). Generate a separate `.env.docker.local`; do not reuse business environment files or redirect the Neon test runner to Compose. The dedicated Docker smoke verifies the isolated database identity before writes and uses the built-in AFS.
