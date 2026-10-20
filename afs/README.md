# Standalone AFS hardening

The optional Docker image fetches upstream `Kianoosh76/afs` at `b3eee4edd597bfc0545ff99fbbf4e2c0c065b222`. `prepare.mjs` checks the original files against `source-hashes.json`, adds the nullable booking operation fields to Prisma, and copies `hardened/` over that checkout. A mismatched source fails the build.

`hardened/package-lock.json` is authoritative. Node 24 runs `npm ci`, Prisma generation and a complete Next.js production build, then prunes development packages. Runtime versions are Next.js 15.5.28, React/React DOM 19.0.9, Prisma/Client 6.3.1, Lodash 4.18.1 and PostCSS 8.5.23. Prisma Studio is not needed by the server and is excluded.

The booking overlay preserves the existing endpoint paths and JSON fields. It adds agency-scoped `Idempotency-Key` replay and operation lookup, uses full UUID references, and keeps unambiguous legacy six-character lookup. Duplicate cancellation returns the cancelled ticket. Ambiguous or foreign references return a generic 404. Booking and cancellation each commit inventory, links and ticket state in one database transaction. The additive migration preserves existing rows and rejects negative seat counts.

Responses advertise `x-afs-booking-protocol: 1`. FlyNext requires that marker before automatically replaying an uncertain remote operation. Its separate recovery worker owns cross-service reconciliation; neither service assumes a shared database transaction.

Dependency updates must regenerate the checked-in lockfile, review the resulting tree, rerun `npm ci` and build, and repeat the Docker business, concurrency and recovery checks. Do not patch only a running container or use forced audit upgrades. See [Docker operations and fixtures](../docs/DOCKER.md).

Security references:

- [Next.js support policy](https://nextjs.org/support-policy)
- [Next.js image optimization advisory and 15.5.28 fix](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw)
- [Next.js Server Actions denial of service advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r)
- [React Server Components advisories](https://github.com/react/react/security/advisories)
