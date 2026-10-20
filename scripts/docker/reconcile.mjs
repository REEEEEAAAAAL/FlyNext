import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { reconcileFlights } = require('../../dist/lib/afs-recovery.js');
const { prisma } = require('../../dist/lib/prisma.js');
const { assertDockerDatabaseTarget, assertDockerDatabaseIdentity } = require('../../dist/lib/docker-database-safety.js');
assertDockerDatabaseTarget(process.env);
await assertDockerDatabaseIdentity(prisma, process.env);
const once = process.argv.includes('--once');
do {
  try { await reconcileFlights(); }
  catch { console.error('[afs] recovery scan failed; retrying'); }
  if (!once) await new Promise(resolve => setTimeout(resolve, 15000));
} while (!once);
await prisma.$disconnect();
