# Deployment guide

FlyNext is a Next.js application that can be deployed to a compatible Node.js hosting provider. This guide describes the general setup; it does not claim that a hosted deployment is currently available.

## Build

Use Node.js 24 and the repository lockfile. Install with `npm ci`, then build with `npm run build`. The `vercel-build` script is available for Vercel projects and runs Prisma client generation before the Next.js build.

## Configure the host

Set the environment variables described in [`.env.example`](../.env.example) in the hosting provider's secret manager. Configure PostgreSQL, long random session secrets, and Cloudinary credentials for image uploads. The built-in flight provider works without a remote AFS service.

Use a dedicated database and a least-privilege application role. Apply reviewed Prisma migrations as a controlled release step; do not run development seeds, reset fixtures, or tests against a live database. Keep database credentials and provider secrets out of source control and build logs.

## Release checklist

1. Confirm the hosting environment and database are the intended targets.
2. Configure and verify required environment variables.
3. Apply reviewed migrations through the release process.
4. Build and deploy the application.
5. Verify sign-in, search, booking, and image workflows with synthetic data.

For local installation and database test setup, see [the development guide](DEVELOPMENT.md).
