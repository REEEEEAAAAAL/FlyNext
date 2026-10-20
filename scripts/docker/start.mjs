import { PrismaClient } from '@prisma/client';
import { spawnSync, spawn } from 'node:child_process';
import { assertDockerDatabaseIdentity, assertDockerDatabaseTarget } from '../../dist/lib/docker-database-safety.js';

const action = process.argv[2] ?? 'start';
if (!['start', 'reset', 'verify', 'reference'].includes(action)) throw new Error('Unknown Docker operation.');
if (action === 'reference' && !process.env.SEED_OWNER_PASSWORD) throw new Error('Reference initialization requires an explicit SEED_OWNER_PASSWORD; credentials must not be printed.');
assertDockerDatabaseTarget(process.env);
const db = new PrismaClient();
let phase = 'connection';
const run = (command, args, extra = {}) => {
  const result = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, ...extra } });
  if (result.status !== 0) throw new Error('Docker initialization command failed; application will not start.');
};
try {
  for (let attempt = 0; ; attempt++) {
    try { await db.$connect(); break; }
    catch { if (attempt === 29) throw new Error('Local PostgreSQL not ready after 60 seconds.'); await new Promise(resolve => setTimeout(resolve, 2000)); }
  }
  phase = 'identity';
  await assertDockerDatabaseIdentity(db, process.env);
  console.log('Verified Docker PostgreSQL: postgres:5432 / flynext_docker_demo / flynext_docker; instance and physical cluster match.');
  if (action !== 'verify') {
    phase = 'migration and initialization';
    await db.$queryRaw`SELECT 1 AS locked FROM pg_advisory_lock(74193021)`;
    run('node', ['node_modules/prisma/build/index.js', 'migrate', 'deploy']);
    await db.$executeRaw`CREATE TABLE IF NOT EXISTS public._flynext_docker_state (id integer PRIMARY KEY CHECK (id = 1), state text NOT NULL)`;
    const rows = await db.$queryRaw`SELECT state FROM public._flynext_docker_state WHERE id = 1`;
    if (action === 'reference') {
      run('node', ['dist/prisma/seed-reference.js']);
    } else if (action === 'reset' || rows.length === 0) {
      await db.$executeRaw`INSERT INTO public._flynext_docker_state VALUES (1, 'initializing') ON CONFLICT (id) DO UPDATE SET state = 'initializing'`;
      run('node', ['dist/prisma/seed.js'], { NODE_ENV: 'development', FLYNEXT_ALLOW_DATABASE_RESET: '1', FLYNEXT_DOCKER_ACTION: action === 'reset' ? 'reset' : 'initialize' });
      await db.$executeRaw`UPDATE public._flynext_docker_state SET state = 'ready' WHERE id = 1`;
      console.log('Full demo initialization completed.');
    } else if (rows[0].state !== 'ready') {
      throw new Error('Previous initialization was interrupted. Inspect logs and explicitly reset this disposable Docker database.');
    } else console.log('Existing demo database preserved; no seed/reset performed.');
    console.log(JSON.stringify({ cities: await db.city.count(), airports: await db.airport.count(), users: await db.user.count(), hotels: await db.hotel.count(), roomTypes: await db.roomType.count(), inventoryNights: await db.roomAvailabilityRecord.count(), itineraries: await db.itinerary.count() }));
  }
} catch {
  console.error(`Docker database operation failed during ${phase}. Check readiness, local identity and migration/seed logs; database details redacted.`);
  process.exitCode = 1;
} finally { await db.$disconnect(); }

if (!process.exitCode && action === 'start') {
  const server = spawn('node', ['node_modules/next/dist/bin/next', 'start', '--hostname', '0.0.0.0'], { stdio: 'inherit' });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.kill(signal));
  server.on('exit', code => { process.exitCode = code ?? 1; });
}
