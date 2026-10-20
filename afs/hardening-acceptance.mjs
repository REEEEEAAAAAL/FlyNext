import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { verifyDatabase } from './database.mjs';

const db = new PrismaClient();
const key = process.env.AFS_LOCAL_API_KEY;
const peer = process.env.AFS_TEST_PEER;
if (peer) assert.equal(peer, `http://${process.env.COMPOSE_PROJECT_NAME}-afs-peer:3000`);
let requestNumber = 0;
const payload = flightIds => ({ firstName: 'Concurrency', lastName: 'Synthetic', email: 'acceptance@example.invalid', passportNumber: 'DEMO-PASSENGER', flightIds });
async function api(path, method = 'GET', body, operation, apiKey = key) {
  const base = peer && requestNumber++ % 2 ? peer : 'http://127.0.0.1:3000';
  const response = await fetch(base + path, { method, headers: {
    'x-api-key': apiKey, 'Content-Type': 'application/json', ...(operation ? { 'Idempotency-Key': operation } : {}),
  }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45000) });
  return { status: response.status, body: await response.json() };
}
async function flight(seats = 1) {
  const original = await db.flight.findFirstOrThrow({ where: { departureTime: { gt: new Date(Date.now() + 86400000) } } });
  const { id: _id, createdAt: _created, updatedAt: _updated, ...data } = original;
  return db.flight.create({ data: { ...data, id: randomUUID(), flightNumber: 'TEST-' + randomUUID(), availableSeats: seats } });
}
async function seats(id) { return (await db.flight.findUniqueOrThrow({ where: { id } })).availableSeats; }
const cancel = reference => api('/api/bookings/cancel', 'POST', { lastName: 'Synthetic', bookingReference: reference });
const retrieve = (reference, apiKey) => api('/api/bookings/retrieve?' + new URLSearchParams({ lastName: 'Synthetic', bookingReference: reference }), 'GET', undefined, undefined, apiKey);
try {
  await verifyDatabase(db);
  if (peer) {
    for (let attempt = 0; ; attempt++) {
      try {
        const ready = await fetch(peer + '/api/airports', { headers: { 'x-api-key': key }, signal: AbortSignal.timeout(2000) });
        assert.equal(ready.status, 200);
        break;
      } catch {
        if (attempt === 59) throw new Error('The isolated peer did not become ready');
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }
  console.log(JSON.stringify({ providerInstances: peer ? 2 : 1 }));
  const one = await flight();
  let started = Date.now();
  const operation = randomUUID();
  const same = await Promise.all(Array.from({ length: 32 }, () => api('/api/bookings', 'POST', payload([one.id]), operation)));
  assert.ok(same.every(r => r.status === 200));
  assert.equal(new Set(same.map(r => r.body.bookingReference)).size, 1);
  assert.equal(await seats(one.id), 0);
  assert.equal(await db.booking.count({ where: { operationKey: operation } }), 1);
  assert.equal((await api('/api/bookings', 'POST', { ...payload([one.id]), firstName: 'Changed' }, operation)).status, 409);
  const reference = same[0].body.bookingReference;
  assert.equal(reference.length, 36);
  const cancellations = await Promise.all(Array.from({ length: 32 }, () => cancel(reference)));
  assert.ok(cancellations.every(r => r.status === 200 && r.body.status === 'CANCELLED'));
  assert.equal(await seats(one.id), 1);
  assert.equal((await api('/api/bookings', 'POST', payload([one.id]), operation)).body.status, 'CANCELLED');
  assert.equal(await seats(one.id), 1);
  console.log(JSON.stringify({ sameKey32: 'PASS', concurrentCancellation32: 'PASS', elapsedMs: Date.now() - started }));

  const single = await flight();
  started = Date.now();
  const race = await Promise.all(Array.from({ length: 32 }, () => api('/api/bookings', 'POST', payload([single.id]), randomUUID())));
  assert.equal(race.filter(r => r.status === 200).length, 1);
  assert.equal(race.filter(r => r.status === 400).length, 31);
  assert.equal(await seats(single.id), 0);
  await cancel(race.find(r => r.status === 200).body.bookingReference);
  assert.equal(await seats(single.id), 1);
  console.log(JSON.stringify({ differentKeys32LastSeat: 'PASS', elapsedMs: Date.now() - started }));

  const first = await flight(), sold = await flight(0);
  await db.flight.update({ where: { id: sold.id }, data: { departureTime: new Date(first.arrivalTime.getTime() + 86400000), arrivalTime: new Date(first.arrivalTime.getTime() + 90000000) } });
  assert.equal((await api('/api/bookings', 'POST', payload([first.id, sold.id]), randomUUID())).status, 400);
  assert.equal(await seats(first.id), 1);
  assert.equal((await api('/api/bookings', 'POST', payload([first.id, first.id]), randomUUID())).status, 400);
  await assert.rejects(db.flight.update({ where: { id: first.id }, data: { availableSeats: -1 } }));
  console.log('PASS multi-leg rollback, duplicate flight validation and database inventory constraint');

  const other = await db.agency.create({ data: { name: 'test-' + randomUUID(), apiKey: randomBytes(32).toString('hex') } });
  const foreign = await api('/api/bookings', 'POST', payload([first.id]), randomUUID());
  assert.equal(foreign.status, 200);
  const denied = await retrieve(foreign.body.bookingReference, other.apiKey);
  const missing = await retrieve(randomUUID(), other.apiKey);
  assert.deepEqual(denied, missing);
  assert.equal((await api('/api/bookings/cancel', 'POST', { lastName: 'Synthetic', bookingReference: foreign.body.bookingReference }, undefined, other.apiKey)).status, 404);
  assert.equal((await api('/api/bookings/retrieve?operationKey=' + operation, 'GET', undefined, undefined, other.apiKey)).status, 404);
  await db.agency.update({ where: { id: other.id }, data: { isActive: false } });
  assert.equal((await retrieve(foreign.body.bookingReference, other.apiKey)).status, 403);
  await cancel(foreign.body.bookingReference);
  assert.equal(await seats(first.id), 1);
  console.log('PASS cross-agency retrieval, operation lookup, cancellation, generic errors and inactive key rejection');

  const agency = await db.agency.findUniqueOrThrow({ where: { apiKey: key } });
  const prefix = randomBytes(3).toString('hex');
  const ids = [prefix + '01-' + randomUUID().slice(9), prefix + '02-' + randomUUID().slice(9)];
  for (const id of ids) await db.booking.create({ data: { ...payload(undefined), flightIds: undefined, id, agencyId: agency.id, status: 'CANCELLED' } });
  assert.equal((await retrieve(prefix)).status, 404);
  assert.equal((await cancel(prefix)).status, 404);
  for (const id of ids) assert.equal((await retrieve(id)).status, 200);
  const legacy = await db.booking.create({ data: { firstName: 'Legacy', lastName: 'Synthetic', email: 'legacy@example.invalid', passportNumber: 'DEMO-PASSENGER', agencyId: agency.id, status: 'CANCELLED' } });
  assert.equal((await retrieve(legacy.id.slice(0, 6))).status, 200);
  console.log('PASS full reference collision safety and unambiguous legacy prefix compatibility');

  const load = await flight(8);
  started = Date.now();
  let requests = 0;
  for (let wave = 0; wave < 4; wave++) {
    const results = await Promise.all(Array.from({ length: 32 }, () => api('/api/bookings', 'POST', payload([load.id]), randomUUID())));
    const winners = results.filter(result => result.status === 200);
    assert.equal(winners.length, 8);
    assert.equal(results.filter(result => result.status === 400).length, 24);
    assert.equal(await seats(load.id), 0);
    const cancelled = await Promise.all(winners.flatMap(result => [cancel(result.body.bookingReference), cancel(result.body.bookingReference)]));
    assert.ok(cancelled.every(result => result.status === 200 && result.body.status === 'CANCELLED'));
    assert.equal(await seats(load.id), 8);
    requests += results.length + cancelled.length;
  }
  assert.equal(await db.booking.count({ where: { status: 'CONFIRMED', flights: { some: { id: load.id } } } }), 0);
  console.log(JSON.stringify({ loadWaves: 4, loadRequests: requests, elapsedMs: Date.now() - started, overselling: false, duplicateRestoration: false, result: 'PASS' }));

  const before = await db.booking.count();
  const digest = async () => createHash('sha256').update(JSON.stringify(await db.booking.findMany({ orderBy: { id: 'asc' }, include: { flights: { select: { id: true }, orderBy: { id: 'asc' } } } }))).digest('hex');
  const baseline = await digest();
  const seed = spawnSync('node', ['afs/seed-flights.mjs'], { encoding: 'utf8' });
  assert.equal(seed.status, 0);
  assert.equal(await digest(), baseline);
  assert.equal(await db.booking.count(), before);
  console.log('PASS repeat seed preserves every ticket and flight association');
} finally { await db.$disconnect(); }
