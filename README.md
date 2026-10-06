# FlyNext

FlyNext is a full-stack travel booking application. It searches and books flights
through the Advanced Flights System (AFS), books hotels and room types, combines
both into a single itinerary, checks the itinerary out, and issues a downloadable
PDF invoice.

Flight operations run against the AFS contract, which two interchangeable
providers satisfy: a built-in implementation that answers in-process and is the
default, and a self-hosted AFS container built from the upstream project. The
built-in provider needs no service and no API key; the container serves the same
contract over HTTP. [`lib/afs/config.ts`](./lib/afs/config.ts) selects one per
call — see [The flight provider](#flight-provider).

The whole codebase — frontend and backend — is TypeScript. The HTTP API carries an
integration test suite that runs against a real PostgreSQL database, because the
behaviour under test only exists there.

---

## Table of contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Design decisions](#design-decisions)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Scripts](#scripts)
- [Testing and verification](#testing-and-verification)
- [API conventions](#api-conventions)
- [The flight provider](#flight-provider)
- [Docker](#docker)
- [Deployment](#deployment)
- [Project layout](#layout)
- [License](#license)

---

<a id="features"></a>

## Features

| Area | Capability |
| --- | --- |
| Flights | Search one-way and round-trip routes, book, retrieve and cancel tickets |
| Hotels | Search the catalogue, create and edit listings, manage room types and nightly availability |
| Itineraries | Combine flight and hotel reservations, review the running total, cancel individual items |
| Checkout | Confirm a draft itinerary into an order and download a PDF invoice |
| Accounts | Registration, JWT login with refresh rotation, profile and avatar management |
| Notifications | Per-user notification feed with an unread badge |
| Hotel owners | Owner-only listing view, plus per-room-type availability and booking charts |

---

<a id="tech-stack"></a>

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 15 (App Router) |
| Language | TypeScript 5, `strict: true` |
| Database | PostgreSQL |
| ORM | Prisma 6 |
| Auth | JWT access token + `httpOnly` refresh cookie (`jsonwebtoken`, `bcryptjs`) |
| Styling | Tailwind CSS 4 |
| Charts | `chart.js` via `react-chartjs-2` |
| PDF | `pdf-lib` |
| Image storage | Cloudinary (`cloudinary`) |
| Flight provider | AFS (`axios`) — a self-hosted container, or the built-in in-process provider in `lib/afs/` |
| Tests | Vitest |

Images are **not** stored on the server. Hotel logos, room-type galleries and
avatars are streamed to Cloudinary, and the record keeps the absolute
`https://res.cloudinary.com/...` URL that comes back. A serverless host gives a
function a read-only, per-invocation filesystem, so there is no local directory an
upload could survive in.

---

<a id="architecture"></a>

## Architecture

### Request path

Every HTTP route is a typed `route.ts` handler under `app/api/`. Each one is
wrapped in `withRoute` from [`lib/api/handler.ts`](./lib/api/handler.ts), the
single error boundary that turns a thrown `ApiError` into the JSON envelope the
browser client expects. Handlers therefore never shape a failure response
themselves.

Server-side infrastructure is grouped in `lib/api/`:

| Module | Responsibility |
| --- | --- |
| `errors.ts` | `ApiError` taxonomy and status-code constructors |
| `response.ts` | JSON envelope helpers (`{ error }`, `{ message }`, `Set-Cookie`) |
| `validation.ts` | Input parsing and validation |
| `auth.ts` | `Request` → `AuthContext` resolution |
| `handler.ts` | The error boundary (`withRoute`) |
| `rate-limit.ts` | In-process per-client request budgets |
| `events.ts` | Structured, machine-searchable event log |
| `notify.ts` | Notification writes that must not fail a request |
| `upload.ts` | Validated image uploads stored on Cloudinary |

Business logic that more than one route needs lives beside them:
`lib/reservations.ts` owns the reservation lifecycle, and `lib/afs-client.ts` owns
the flight provider client.

### Data model

[`prisma/schema.prisma`](./prisma/schema.prisma) defines the domain: `User`,
`Hotel`, `RoomType` and its per-night `RoomAvailabilityRecord`,
`HotelReservation`, `FlightReservation`, `Itinerary`, `Notification`, the
`AfsOfflineBooking` ledger the built-in flight provider writes to, and the
`City`/`Airport` reference tables used for autocomplete. Migrations under
`prisma/migrations/` are the only supported way to change it.

### Type layer

`types/` is a type-only layer that is fully erased at build time: transport
envelopes (`api.ts`), token claims and auth context (`auth.ts`), response DTOs
(`models.ts`), the external AFS contracts (`afs.ts`) and App Router parameter
types (`next.ts`), re-exported from `index.ts`.

### The three TypeScript configurations

Next.js owns the compilation of everything under `app/`, including the route
handlers. `next build` type-checks and bundles them into `.next`, so the
application config (`tsconfig.json`) is `noEmit` and excludes `tests/`.

The server code in `lib/` and `types/`, plus the seed scripts under `prisma/`, are
not framework code, so they get a conventional compiler emit through
`tsconfig.server.json` (`rootDir` → `outDir: dist`, CommonJS, `strict`).
`npm run build:server` runs it. `lib/` uses only relative imports internally,
which is what allows that output to run under plain `node` without a path-alias
resolver.

The test suite has its own `tsconfig.test.json`, which extends the application
config and adds `tests/`, `vitest.config.ts` and the `#support/*` / `#setup/*`
aliases — the application config cannot include the suite without dragging it
into the production bundle. `npm run typecheck` runs the application and test
configs; the server config is type-checked by its own compiler run,
`npm run build:server`.

---

<a id="design-decisions"></a>

## Design decisions

### One availability row per room type per night

`RoomAvailabilityRecord` has a unique index on `(roomTypeId, date)`. Every read and
every conditional decrement addresses a single night, so a second row for the same
date would split one night's availability across two records and let a booking
claim more rooms than exist. The booking flow depends on this: it claims the whole
stay with one `updateMany` and compares the affected-row count against the number
of nights. The invariant is enforced in the database rather than in application
code so that no future write path can bypass it.

### A booking is claimed, not checked

`POST /api/hotels/book` decrements with
`updateMany({ where: { …, availability: { gt: 0 } } })` inside a transaction and
treats a short row count as sold out (`409`). Cancellation is the exact inverse,
guarded by a status transition so it can only happen once. A read followed by a
write would race: two concurrent requests could both observe availability and both
proceed to book it.

### The upstream ticketing system is the system of record

`createFlightReservation` books upstream, mirrors the booking locally, and — if the
local write fails — asks AFS to cancel the ticket again. When that compensation
also fails the booking is *orphaned*: ticketed upstream, invisible locally. That
state cannot be repaired inside the request, so it is written to the log as a
structured alert:

```
[event] 12 {"event":"flight.booking.orphaned","alert":true,
            "detail":{"bookingReference":"…","cause":"…","reason":"…"}}
```

Every `alert: true` record names a booking that needs manual reconciliation with
the provider. A compensated booking is logged as `flight.booking.compensated`
instead, which needs no action.

### Writes that follow a committed change must not fail the request

`lib/api/notify.ts` records a notification without propagating a failure. The
booking or cancellation it describes has already happened, and the client reads any
error as "your booking failed" — which invites a retry that books a second time.

### Rate limits are per process and in memory

`lib/api/rate-limit.ts` protects login, registration and token refresh (credential
guessing), profile reads and writes, the polled unread badge, the notification
list, the public hotel catalogue, outbound flight search, and every write endpoint
— checkout on the tightest write budget of all. Budgets are burst limits rather
than quotas, so they reset on deploy, and a `429` always carries `Retry-After`. A
multi-instance deployment would enforce each instance's budget separately: put a
shared store behind the same interface before relying on the limit for anything
stronger. On Vercel every serverless instance is its own process, so this caveat is
not hypothetical there — treat the limit as a per-instance burst guard.

### An uploaded image is either a Cloudinary URL or a bundled placeholder

`lib/api/upload.ts` returns an absolute `https://res.cloudinary.com/...` address,
while `hotel.logo`, `user.profilePic` and the gallery defaults use root-relative
paths such as `/hotel-logo-default.svg`. Both shapes are stored in the same column,
so rendering code must check before it rewrites the string: prefixing an absolute
URL with `/` yields `/https://…`, which the browser resolves as a path on this
origin and fails to load. `toPreviewSrc()` in
[`app/profile/page.tsx`](./app/profile/page.tsx) and the `images.remotePatterns`
entry in [`next.config.ts`](./next.config.ts) are the two places that encode this.

### One Prisma client per worker, cached on `globalThis`

`lib/prisma.ts` caches the client in every environment, not only in development. A
serverless host runs many short-lived workers, and a client constructed per module
evaluation would open a connection pool per worker — which is how a traffic spike
against a pooled endpoint becomes "too many connections". The cache is what makes
the intended shape one pool per worker. There is exactly one entry, it is the same
client the module would have exported anyway, and the runtime reclaims it when the
worker is retired.

### No runtime writes to the local filesystem

Images go to Cloudinary and all state goes to PostgreSQL, so production needs no
writable disk. This is what makes a serverless deployment possible at all: a
function's filesystem is read-only and per-invocation. Under test, where no
Cloudinary credentials are configured, `lib/api/upload.ts` returns a mock path
shaped like the `/uploads/...` URL a disk-backed store would use, so the assertions
that only check "a new image URL came back" hold without a network call. The
`public/uploads/` directories in the Docker image exist for that shape and for
local development only; nothing in a deployed environment writes to them.

### The flight provider degrades instead of failing

`lib/afs-client.ts` validates every payload structurally before returning it as a
typed value, whichever back end produced it, and reports failures as `502` with the
upstream status in `details`. An upstream `401` is never relayed: the browser reads
`401` as "your session expired", so forwarding the provider's own rejection of the
application's API key would log the user out. The back end is resolved per call,
which lets the test suite pin the built-in provider without any module stubbing.

---

<a id="getting-started"></a>

## Getting started

### Prerequisites

- Node.js 20 or newer
- PostgreSQL 15 or newer, local or hosted (Neon, Supabase, RDS)
- A Cloudinary account, for image uploads

### 1. Install dependencies

```bash
npm install
```

### 2. Configure the environment

```bash
cp .env.example .env
```

Then fill in `.env`. It is git-ignored, so secrets must live there and never in
source, the Dockerfile, or `docker-compose.yml`. Every variable is documented in
[Environment variables](#environment-variables).

### 3. Prepare the database

```bash
npm run prisma:generate   # generate the Prisma client
npm run prisma:migrate    # apply migrations
npm run seed              # load cities, airports and demo data (disposable DB only)
```

### 4. Run

```bash
npm run dev               # http://localhost:3000
```

---

<a id="environment-variables"></a>

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string used by Prisma |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Only for the bundled docker-compose stack |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Token signing keys — use long random values |
| `JWT_ACCESS_TOKEN_EXPIRY_TIME` | Access token lifetime, e.g. `1h` |
| `JWT_REFRESH_TOKEN_EXPIRY_TIME` | Refresh cookie lifetime, e.g. `7d` |
| `AFS_BASE_URL` | AFS service address. Empty, non-HTTP or a documented placeholder host means "use the built-in provider" |
| `AFS_API_KEY` | API key sent to a remote AFS service; required only when one is in use |
| `AFS_MOCK` | `true` (also `1`, `yes`, `on`) forces the built-in provider; leave unset to choose by `AFS_BASE_URL` |
| `AFS_LOCAL_AGENCY` / `AFS_SEED_DAYS` | Read by the bundled AFS container: the agency it seeds, and the days of schedule it generates |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Credentials for image storage |
| `CLOUDINARY_URL` | Single-variable alternative to the three values above |
| `CLOUDINARY_FOLDER` | Root folder for uploaded assets; defaults to `flynext` |
| `SEED_OWNER_EMAIL` | Optional. Owner of the reference hotels created by `npm run seed:reference`; defaults to `hotel-owner@flynext.local` |
| `SEED_OWNER_PASSWORD` | Optional. Fixes that account's password; when unset the seed generates one and prints it once |

Generate signing keys with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

<a id="scripts"></a>

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the Next.js dev server |
| `npm run postinstall` | Generate the Prisma client; runs automatically after `npm install` |
| `npm run build` | Production build (compiles the app and the API routes into `.next`) |
| `npm run vercel-build` | What Vercel runs: `prisma generate && next build` |
| `npm start` | Serve the production build |
| `npm run build:server` | Standalone `tsc` emit of `lib/`, `types/` and `prisma/` into `dist/` as runnable CommonJS |
| `npm run typecheck` | Type-check the application and the test suite |
| `npm test` | Run the integration suite once |
| `npm run test:watch` | Run it in watch mode |
| `npm run seed` | Load the **demo/reset fixture** (`tsx prisma/seed.ts`) — clears the tables, then rebuilds 50 demo users, hotels, bookings and itineraries |
| `npm run seed:reference` | Load the **production reference data** (`tsx prisma/seed-reference.ts`) — adds cities, airports, hotels, room types and their nightly availability, deletes nothing |
| `npm run seed:prod` | Run the compiled demo fixture (`node dist/prisma/seed.js`) |
| `npm run seed:reference:prod` | Run the compiled reference seed (`node dist/prisma/seed-reference.js`) |
| `npm run prisma:generate` | Regenerate the Prisma client |
| `npm run prisma:migrate` | Apply pending migrations (`prisma migrate deploy`) |

Three scripts are run directly rather than through npm:

| Command | What it does |
| --- | --- |
| `node scripts/audit-env.mjs` | Check the deployment environment; see [Deployment](#deployment) |
| `node afs/seed-flights.mjs` | Seed the bundled AFS container's database; normally invoked by its entrypoint |
| `npx tsx scripts/repair-flight-directions.ts` | Audit every flight reservation and rebuild the directions that do not carry their flight list. Dry run by default; `--apply` saves a JSON backup and rewrites the rows, `--restore` puts the backed-up values back |

---

<a id="testing-and-verification"></a>

## Testing and verification

The integration suite talks to a **real** database, because the behaviour it covers
— conditional availability claims, unique constraints, interactive transactions —
only exists there. It uses its own scratch database rather than the development
one:

```bash
cp .env.example .env.test
# then set DATABASE_URL in .env.test to a scratch database, e.g. .../flynext_test
npm test
```

The name of that database **must** end in `_test`. The suite truncates the tables
it uses between cases and refuses to start against anything else, so pointing it at
the development database by accident is not possible. Migrations are applied
automatically on the first run.

The suite covers oversell protection under concurrency, room capacity and nightly
availability, flight booking consistency and compensation, the directions recorded
on a reservation, booking listings and their rendering, upload folder handling,
input validation, authorization boundaries, rate limiting, and the built-in flight
provider's contract.

### Verification gates

Run all three before opening a pull request or pushing:

```bash
npm run typecheck   # 0 errors
npm test            # all green
npm run build       # production build succeeds
```

---

<a id="api-conventions"></a>

## API conventions

These are load-bearing for the browser client.

- **Errors** are `{ "error": string }` with a meaningful status code
  (`400` validation, `401` unauthenticated, `403` forbidden, `404` missing,
  `409` conflict, `429` rate limited, `502` upstream failure).
- **Action successes** are `{ "message": string }`, often alongside the created
  resource.
- **Numeric fields are JSON numbers**, never strings: several pages call
  `.toFixed(2)` on them directly.
- `GET /api/itineraries/{id}` returns the itinerary as the **bare** response body.
- `GET /api/flights/search` returns a **bare array** of flight groups.
- `GET /api/user/hotel-bookings` uses a nested `period` envelope, while
  `GET /api/user/hotel-bookings/{id}` returns the stay dates flat. Both shapes are
  intentional and are consumed by different pages.
- `IsHotelOwner` keeps its capital `I`; three pages gate owner-only UI on it.
- Flight legs encode "no value" as the single-space sentinel `" "`.
- Every handler is wrapped in `withRoute` from `lib/api/handler.ts`, which is the
  only place that turns a thrown `ApiError` into a response. Per-route `try`/`catch`
  blocks that exist only to shape an error duplicate that boundary.

---

<a id="flight-provider"></a>

## The flight provider

Flights come from the Advanced Flights System — a separate Next.js service with its
own database, published as [Kianoosh76/afs](https://github.com/Kianoosh76/afs).
[`lib/afs-client.ts`](./lib/afs-client.ts) speaks the AFS contract and has two
interchangeable back ends behind it, so no route handler or page depends on which
one answers.

### How the back end is chosen

Resolved **per call** in [`lib/afs/config.ts`](./lib/afs/config.ts), highest
precedence first:

| Condition | Back end |
| --- | --- |
| `AFS_MOCK` set to `true`, `1`, `yes` or `on` | Built-in provider |
| No usable `AFS_BASE_URL` | Built-in provider |
| `AFS_MOCK=false` | Remote service, stated explicitly |
| Otherwise | Remote service |

Only `http`/`https` URLs count, and documented placeholders such as
`https://afs.invalid` count as *not configured* rather than being called. That is
what keeps CI green without a service: `.env.test` sets `AFS_MOCK=true` **and** a
placeholder URL, so the suite can never reach a real provider even if the flag is
removed.

A remote call additionally needs `AFS_API_KEY`; without it the call fails as `502`
rather than quietly answering from the built-in provider. `AFS_MOCK=false` states
the intent to use HTTP, but it cannot supply an address: when `AFS_BASE_URL` is
missing or a placeholder, the rule above it has already selected the built-in
provider.

Resolving per call rather than at import time is what lets a test or a health check
pin either provider without module stubbing.

### A. Built-in provider (default)

[`lib/afs/offline.ts`](./lib/afs/offline.ts) implements `GET /api/cities`,
`/airports`, `/airlines`, `/api/flights`, `POST /api/bookings`,
`GET /api/bookings/retrieve` and `POST /api/bookings/cancel` in-process, with the
upstream error messages and status codes.

It is a *substitute*, not a stub. A stub returns one canned search result and breaks
on the next call, so this one keeps real state:

- A search returns itineraries whose ids *state* what they are — `YYZ-LHR-20260701-0725-00`
  is the origin, the destination, the day and the departure time — and the timetable
  is a pure function of the route and the day. Any instance can therefore decode an
  id, rebuild that day and confirm the departure is one the schedule serves, without
  having seen the search that produced it. The same search always produces the same
  ids, and an id stays valid into the **next** request, which is what booking needs.
- Booking consumes a seat, decrements `availableSeats`, and returns a reference
  that `retrieve` and `cancel` can find again by surname and booking reference.
- Cancelling marks the booking `CANCELLED` and gives the seats back, exactly once.
- It enforces the upstream rules a stub would not: unknown flight ids, a passport
  shorter than 9 characters, legs that overlap or leave with less than an hour to
  connect, a request for more seats than exist. FlyNext's compensation path exists
  precisely because those rejections happen.
- **Every itinerary a search offers is one a booking will accept.** A route whose
  only same-day pairing misses the one-hour minimum layover is answered with the
  first connection of the *following* day rather than with a pair of flights that
  overlap in time. An unbookable option would only move the rejection to the last
  step of the booking, where it surfaces as `Flights are not consecutive in
  sequence`.

Search → book → retrieve → verify → cancel → refund/compensate all close on it,
including a **round trip**, which is two searches and therefore two id sets — sent
as one booking, outbound legs first, which is why the return date has to fall after
the outbound date. That request also carries `returnLegCount` (how many of the
trailing ids are the way home), because the provider's flat leg list does not say
where the outbound half ends: without it a one-way ticket with a connection and a
round trip are the same shape, and the booking history can render the legs of one
journey as an "Outbound" panel and a "Return" one. The count is ours alone — it is
consumed locally and never forwarded upstream — and a caller that omits it gets the
split derived from the legs instead (see `splitFlightDirections` in
[`lib/reservations.ts`](./lib/reservations.ts)).

A reservation records the **directions** flown rather than the individual legs:
`YYZ→HKG→CAN` is one outbound direction from Toronto to Guangzhou, stored as
leaving YYZ and landing at CAN, with the Hong Kong transfer kept in the direction's
flight list. The booking pages read that list, so a connecting ticket shows where
it changes planes ("Via HKG") and every flight it is made of — a summary of the two
endpoints alone reads as a non-stop flight.
`npx tsx scripts/repair-flight-directions.ts` audits stored directions against the
ticket and, with `--apply`, rewrites the ones whose flight list is missing.

Bookings are **durable**. They are written to the `AfsOfflineBooking` table before
the provider answers, so a booking made on one serverless instance is retrievable
and cancellable from any other, and a cancellation releases its seats once across
all of them. Seat counts are derived — a flight's availability is what it was
published with minus the live bookings that name it — rather than kept in a
per-process counter, which is what lets two instances agree on them. When the
ledger is configured but will not take a booking, the seats it claimed are given
back and the call fails with `502`: answering "confirmed" would hand out a ticket
nothing else can verify or cancel.

The provider also answers for a booking with no row in that table, falling back to
the caller's own `FlightReservation` row, so a reference stays verifiable and
cancellable when the ledger has no entry for it. `lib/afs/ledger.ts` holds the
durable half; without a `DATABASE_URL` the provider serves bookings from memory
alone, which is correct in a single process.

### B. Self-hosted AFS service

```bash
docker compose --profile afs up -d     # adds `afs` and `afs-postgres`
```

[`dockerfile.afs`](./dockerfile.afs) builds the upstream project from source
(`AFS_REF` pins the revision). Its entrypoint applies the upstream migrations and
then runs [`afs/seed-flights.mjs`](./afs/seed-flights.mjs), which upserts the
upstream airports, airlines and one agency, and generates a flight schedule for a
rolling window (`AFS_SEED_DAYS`, default 7). A day that already holds its schedule
is skipped, so restarts are cheap and the window keeps extending itself.

Then point the app at it:

```dotenv
AFS_BASE_URL="http://localhost:4000"    # from the host
AFS_BASE_URL="http://afs:3000"          # from the `nextjs` container
AFS_API_KEY="<sha256 of AFS_LOCAL_AGENCY>"
```

The seeded agency defaults to `flynext-local`, so its key is:

```bash
node -e "console.log(require('crypto').createHash('sha256').update('flynext-local').digest('hex'))"
```

The container prints the same value as `[seed] AFS_API_KEY=…` on first start.
Running the upstream project without Docker works too — `npm install`,
`npx prisma migrate deploy`, `npm run dev` — and any other deployment is equally
valid, because the client only depends on the HTTP contract.

Searches must use a **future** date inside the seeded window; a date with no
schedule legitimately returns an empty list. To add your own agency, append an id
to the upstream `prisma/data/agencies.js` and run `node prisma/data/import_agencies`.

---

<a id="docker"></a>

## Docker

```bash
./start.sh    # docker-compose up -d --build
./stop.sh     # docker-compose down
```

[`docker-compose.yml`](./docker-compose.yml) reads `DATABASE_URL`,
`POSTGRES_PASSWORD` and the JWT/AFS settings from `.env`.

To also start a real AFS service — the upstream project
([Kianoosh76/afs](https://github.com/Kianoosh76/afs)) built from source, with its
own PostgreSQL database and a generated flight schedule:

```bash
docker compose --profile afs up -d
```

That adds two containers, `afs` and `afs-postgres`, published on
<http://localhost:4000>. Point the app at it by setting, in `.env`:

```dotenv
AFS_BASE_URL="http://localhost:4000"   # from the host
AFS_API_KEY="<sha256 of AFS_LOCAL_AGENCY>"
```

Inside the compose network the app reaches the same container as
`http://afs:3000`, by its service alias. The AFS image is behind the `afs` profile,
so a plain `docker compose up` starts only the FlyNext stack. See
[The flight provider](#flight-provider) for the details.

---

<a id="deployment"></a>

## Deployment

The application targets Vercel's serverless model: the database is remote
PostgreSQL, images live in Cloudinary, and the Prisma client is cached per worker
rather than per request. Nothing is written to the local filesystem at runtime,
which is the constraint that makes a serverless deployment possible at all.

Before deploying, the repository can check the environment for you. The audit
reports which variables are present, whether each value is usable, and what to do
about the ones that are not — never the values themselves — so its output is safe
to paste into a build log:

```bash
node scripts/audit-env.mjs        # exits non-zero when something blocks a deploy
```

### 1. Import the repository

1. Push the project to GitHub.
2. Go to <https://vercel.com/new> and import the repository.
3. Vercel detects Next.js from `package.json`. Leave the framework preset, the build
   command and the output directory on their defaults — the build command resolves
   to `npm run vercel-build`, which exists for Prisma's sake.
4. Do not deploy yet. Add the environment variables first: a build started without
   them fails at the point the app is evaluated, not at the first request.

### 2. Environment variables

Add every variable below under **Settings → Environment Variables**, for all three
environments (Production, Preview, Development). Names must match exactly.

| # | Key | Value |
| --- | --- | --- |
| 1 | `DATABASE_URL` | Neon pooled connection string, `...?sslmode=require` |
| 2 | `JWT_ACCESS_SECRET` | Long random string |
| 3 | `JWT_REFRESH_SECRET` | A **different** long random string |
| 4 | `JWT_ACCESS_TOKEN_EXPIRY_TIME` | `1h` |
| 5 | `JWT_REFRESH_TOKEN_EXPIRY_TIME` | `7d` |
| 6 | `AFS_BASE_URL` | **Leave empty.** A local AFS container is not reachable from Vercel |
| 7 | `AFS_API_KEY` | Only needed if key 6 points at a publicly reachable AFS service |
| 8 | `AFS_MOCK` | `true` — pins the built-in provider on a serverless host |
| 9 | `CLOUDINARY_CLOUD_NAME` | From the Cloudinary dashboard |
| 10 | `CLOUDINARY_API_KEY` | From the Cloudinary dashboard |
| 11 | `CLOUDINARY_API_SECRET` | From the Cloudinary dashboard |
| 12 | `CLOUDINARY_FOLDER` | `flynext` |

Points that are easy to get wrong:

- `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` are not needed on Vercel.
  They configure the bundled `docker-compose.yml` stack only.
- Do not point `AFS_BASE_URL` at `localhost`. On Vercel that is the function itself,
  not a machine running AFS. Leaving it empty (or setting `AFS_MOCK=true`) selects
  the built-in provider, which answers the full contract in-process. Only set it to
  an address the deployment can actually reach — the local container is not one,
  unless it is published somewhere public.
- `CLOUDINARY_URL` is an alternative to keys 9–11, not an addition. Set either the
  three separate values or the single URL; the three win if both are present.
- Generate the JWT secrets with
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` and
  never reuse the development values in production.
- On a Neon pooler host the connection string must keep `sslmode=require`; dropping
  it is the usual cause of a build or runtime TLS failure.
- `NODE_ENV` is set by Vercel and must not be overridden.

### 3. Deploy

Push to the branch Vercel watches (`main` by default). Every push triggers a build;
every pull request gets its own Preview deployment. Watch the build log and confirm
it contains a `prisma generate` line before `next build` — that is the step that
produces the typed client the route handlers import.

### 4. Initialise the production database

The build never touches data, so the schema and the reference data have to be
applied once by hand. Run these with the **production** `DATABASE_URL` set in your
shell — either export the same value you gave Vercel, or let Prisma read it from a
local `.env` that holds the production string.

```bash
# 1. Apply every migration to the production database.
npx prisma migrate deploy

# 2. Load the reference data: cities, airports, hotels and room types.
npm run seed:reference

# 3. Confirm the schema is what the deployment expects.
npx prisma migrate status
```

`prisma migrate deploy` is the production command: it applies pending migrations
and never generates or resets anything. Do not reach for `prisma migrate dev`
against the production database — it can drop data to resolve drift.

If a migration needs to run as part of every deploy instead, add
`prisma migrate deploy` to the **Build Command** in the Vercel dashboard rather than
to `package.json`, so local `npm run build` stays offline.

#### The built-in provider needs the `AfsOfflineBooking` migration

Confirm it with `npx prisma migrate status` before considering a deploy finished.
The built-in flight provider keeps its bookings in that table so that a ticket
bought on one serverless instance can be verified and cancelled from another;
without it, bookings fall back to per-process memory, where a ticket is visible only
to the instance that sold it and a check or a cancellation from anywhere else
answers `Booking not found`. The table is additive and its migration creates nothing
else, so applying it to a database holding real data is safe.

`npm run seed:reference` does not touch it, and neither does the demo fixture — but
that fixture is a reset, not a seed, so see the warning below before running it
anywhere that matters.

`npm run seed:reference` is the only seed that belongs on a database holding real
data. It is **additive and idempotent**: it creates what is missing, deletes
nothing, and never invents a user, reservation, itinerary or notification row. Only
these tables are written: `City`, `Airport`, `Hotel`, `RoomType`,
`RoomAvailabilityRecord`, plus the single operator account below. Re-running it
reports `0 created` everywhere, so it is safe to run after every deploy.

The reference content comes from `prisma/seed_data/*.json` (81 cities, 84 airports)
plus one hotel with two room types per city and a horizon of nightly availability,
so the search and hotel pages have something to show immediately. The hotels are
attached to one operator account:

| Variable | Default | Notes |
| --- | --- | --- |
| `SEED_OWNER_EMAIL` | `hotel-owner@flynext.local` | The account the reference hotels belong to. `Hotel.ownerId` is what grants management rights, so without an owner the seeded hotels would be listed to everyone and editable by nobody. |
| `SEED_OWNER_PASSWORD` | *(random)* | The script then never prints it, and re-running keeps the stored password in sync. |

With neither variable set, the first run creates the account, prints the generated
password once, and stores only its bcrypt hash — save it at that moment, because
nothing can recover it later. Later runs leave the password alone.

#### Do not run the demo fixture against production

`npm run seed` (and its compiled twin `npm run seed:prod`) is a **demo/reset
fixture**, not a seed in the additive sense. `prisma/generate_data.sql` opens with
`TRUNCATE … RESTART IDENTITY CASCADE` over `Airport`, `City`, `Hotel`,
`RoomType`, `User`, `HotelReservation`, `FlightReservation`, `Itinerary`,
`Notification` and `RoomAvailabilityRecord`, and the demo users' passwords are the
public `password1`…`password50`. Pointed at a production database, it destroys the
real data. Use it only for local development, and for a course demo whose database
is disposable.

### 5. Verify the deployment

| Check | Expected |
| --- | --- |
| Landing page loads | `200`, no client-side console errors |
| Register → login | Account created, redirected to the profile page |
| Upload a profile picture | Redirects to a `https://res.cloudinary.com/...` URL |
| Create a hotel with a gallery | Images render on the hotel detail page |
| Search flights | Results returned from the AFS back end (a `502` means a configured remote provider rejected the key) |
| Checkout → download invoice | A PDF is produced |
| `npx prisma migrate status` | "Database schema is up to date!" |

A `502` on any image upload means Cloudinary storage is unconfigured or the
credentials were rejected; the response body carries no secret, and the function log
holds the provider's own message.

### Pushing to GitHub

`.env` and `.env.test` are git-ignored, so credentials cannot reach the repository
through them. `.env.example` is the one env file that *is* committed and must
contain placeholders only — check `git status` before the first push.

---

<a id="layout"></a>

## Project layout

```
app/
  api/                      # HTTP API — every route is a typed route.ts handler
    auth/                   #   login, logout, refresh, register
    checkout/               #   confirm a DRAFT itinerary
    flights/                #   search, book
    hotels/                 #   search, create, detail, room types, owner view, booking
    invoice/                #   PDF invoice
    itineraries/            #   create, detail, cancel
    locations/              #   city and airport autocomplete
    notifications/          #   list, unread count, mark read
    user/                   #   profile, flight bookings, hotel bookings
  components/               # shared client components (navigation, badge, theme)
  context/                  # React context providers
  lib/                      # client-side helpers (booking display, session token)
lib/
  api/                      # server-side infrastructure
    errors.ts               #   ApiError taxonomy
    response.ts             #   JSON envelope helpers
    validation.ts           #   input parsing/validation
    auth.ts                 #   request -> AuthContext
    handler.ts              #   the single error boundary (withRoute)
    rate-limit.ts           #   in-process per-client request budgets
    events.ts               #   structured, machine-searchable event log
    notify.ts               #   notification writes that must not fail a request
    upload.ts               #   validated image uploads, stored on Cloudinary
  afs-client.ts             # flight provider client (validates both back ends)
  afs/
    config.ts               #   resolves the back end, per call
    ledger.ts               #   durable booking state for the built-in provider
    offline.ts              #   in-process implementation of the AFS contract
  auth.ts                   # password hashing + JWT minting/verification
  prisma.ts                 # PrismaClient singleton
  reservations.ts           # shared reservation lifecycle logic
afs/
  seed-flights.mjs          # seeds the bundled AFS container's database
  docker-entrypoint.sh      # migrate, seed, then serve inside that container
dockerfile                  # image for the app itself (compose service `nextjs`)
dockerfile.afs              # builds the AFS container from the upstream project
scripts/
  audit-env.mjs             # deployment environment audit
  repair-flight-directions.ts  # audits stored flight directions and rebuilds them
prisma/
  schema.prisma             # data model
  migrations/               # SQL migrations
  seed.ts                   # demo/reset fixture (clears the tables first)
  seed-reference.ts         # additive production reference data
  seed-fixtures.ts          # shared fixture path resolution
  sql-script.ts             # splits a .sql file into single statements
  seed_data/                # cities.json and airports.json
  generate_data.sql         # demo/reset SQL replayed by seed.ts
tests/
  support/                  # database, factories and request helpers
  setup/                    # test environment and migration bootstrap
  *.test.ts                 # the suites
types/                      # shared type layer (type-only, erased at build time)
  api.ts                    #   transport envelopes
  auth.ts                   #   token claims and auth context
  models.ts                 #   response DTOs
  afs.ts                    #   external API contracts
  next.ts                   #   App Router param types
  index.ts                  #   barrel
```

---

<a id="license"></a>

## License

Released for educational and portfolio use. See the repository owner before
reusing it commercially.

---

## 中文文档

A Chinese translation of this README is available at
[README.zh-CN.md](./README.zh-CN.md).
