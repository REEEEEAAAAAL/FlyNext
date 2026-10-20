import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { verifyDatabase } from './database.mjs';
const db = new PrismaClient();
try {
  await verifyDatabase(db);
  const before = await db.flight.findMany({ orderBy: { id: 'asc' } });
  const bookings = await db.booking.findMany({ orderBy: { id: 'asc' }, include: { flights: { select: { id: true }, orderBy: { id: 'asc' } } } });
  const seed = days => {
    const result = spawnSync('node', ['afs/seed-flights.mjs'], { encoding: 'utf8', env: { ...process.env, AFS_SEED_DAYS: String(days) } });
    assert.equal(result.status, 0);
    return JSON.parse(result.stdout.trim().split('\n').at(-1));
  };
  const extended = seed(16);
  assert.ok(extended.inserted > 0);
  const after = new Map((await db.flight.findMany()).map(flight => [flight.id, flight]));
  for (const flight of before) assert.deepEqual(after.get(flight.id), flight);
  assert.deepEqual(await db.booking.findMany({ orderBy: { id: 'asc' }, include: { flights: { select: { id: true }, orderBy: { id: 'asc' } } } }), bookings);
  assert.equal(seed(16).inserted, 0);
  assert.equal(seed(7).inserted, 0);
  assert.equal(await db.flight.count(), after.size);
  console.log(JSON.stringify({ horizonDays: 16, added: extended.inserted, oldFlightsPreserved: before.length, bookingsPreserved: bookings.length, repeatAndShortenDoNotReset: true, result: 'PASS' }));
} finally { await db.$disconnect(); }
