import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { verifyDatabase } from './database.mjs';
const db = new PrismaClient();
const mode = process.argv[2] ?? 'run';
const date = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
async function api(path, method = 'GET', body, key = process.env.AFS_LOCAL_API_KEY, expected = 200) {
  const response = await fetch('http://127.0.0.1:3000' + path, {
    method, headers: { ...(key ? { 'x-api-key': key } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, expected, method + ' ' + path);
  return response.json();
}
async function digest() {
  const result = await db.$queryRaw`SELECT json_build_object(
    'airports',(SELECT json_agg(t ORDER BY id) FROM airports t),
    'airlines',(SELECT json_agg(t ORDER BY id) FROM airlines t),
    'flights',(SELECT json_agg(t ORDER BY id) FROM flights t),
    'bookings',(SELECT json_agg(t ORDER BY id) FROM bookings t),
    'agency',(SELECT json_agg(t ORDER BY id) FROM agencies t),
    'links',(SELECT json_agg(t ORDER BY "A","B") FROM "_BookingFlights" t))::text AS state`;
  return createHash('sha256').update(result[0].state).digest('hex');
}
async function retrieve(reference) {
  return api('/api/bookings/retrieve?' + new URLSearchParams({ lastName: 'Synthetic', bookingReference: reference }));
}
try {
  await verifyDatabase(db);
  if (mode === 'snapshot') {
    const value = await digest();
    writeFileSync('/tmp/afs-snapshot', value);
    console.log(JSON.stringify({ afsSnapshot: value }));
  } else if (mode === 'compare') {
    assert.equal(await digest(), readFileSync('/tmp/afs-snapshot', 'utf8'));
    const saved = JSON.parse(readFileSync('/tmp/afs-persistence-booking', 'utf8'));
    assert.equal((await retrieve(saved.bookingReference)).status, 'CONFIRMED');
    console.log('PASS AFS complete database digest and active ticket retrieval after stop/start');
  } else {
    assert.equal(mode, 'run');
    await api('/api/airports', 'GET', undefined, '', 401);
    await api('/api/airports', 'GET', undefined, 'synthetic-invalid-key', 403);
    for (const name of ['airports', 'cities', 'airlines']) {
      const rows = await api('/api/' + name);
      assert.ok(rows.length > 0);
      console.log(JSON.stringify({ catalogue: name, count: rows.length }));
    }
    const migration = await db.$queryRaw`SELECT COUNT(*)::int AS total FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
    assert.equal(migration[0].total, 8);
    const search = await api('/api/flights?' + new URLSearchParams({ origin: 'YYZ', destination: 'LHR', date: date(3) }));
    const direct = search.results.find(g => g.legs === 1).flights[0];
    const seats = await db.flight.findUniqueOrThrow({ where: { id: direct.id } });
    const payload = { email: 'direct@example.invalid', firstName: 'AFS', lastName: 'Synthetic',
      passportNumber: 'DEMO-PASSENGER', flightIds: [direct.id] };
    await api('/api/bookings', 'POST', { ...payload, flightIds: ['does-not-exist'] }, undefined, 404);
    const booking = await api('/api/bookings', 'POST', payload);
    assert.equal(booking.status, 'CONFIRMED');
    assert.equal((await retrieve(booking.bookingReference)).status, 'CONFIRMED');
    assert.equal((await db.flight.findUniqueOrThrow({ where: { id: direct.id } })).availableSeats, seats.availableSeats - 1);
    const cancelled = await api('/api/bookings/cancel', 'POST', { bookingReference: booking.bookingReference, lastName: 'Synthetic' });
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal((await retrieve(booking.bookingReference)).status, 'CANCELLED');
    assert.equal((await api('/api/bookings/cancel', 'POST', { bookingReference: booking.bookingReference, lastName: 'Synthetic' })).status, 'CANCELLED');
    assert.equal((await db.flight.findUniqueOrThrow({ where: { id: direct.id } })).availableSeats, seats.availableSeats);
    const saved = await api('/api/bookings', 'POST', payload);
    writeFileSync('/tmp/afs-persistence-booking', JSON.stringify({ bookingReference: saved.bookingReference }));
    const before = await digest();
    const seed = spawnSync('node', ['afs/seed-flights.mjs'], { stdio: 'inherit' });
    assert.equal(seed.status, 0);
    assert.equal(await digest(), before);
    assert.equal((await retrieve(saved.bookingReference)).status, 'CONFIRMED');
    console.log(JSON.stringify({ afs: 'PASS', migrations: 8, auth: '401/403 enforced', directBooking: 'confirmed/cancelled',
      seatsRestored: true, repeatedCancel: '200 CANCELLED, inventory unchanged', additiveReseed: 'identical database digest',
      persistenceTicket: saved.bookingReference }));
  }
} catch (error) {
  console.error('AFS acceptance failed: ' + (error instanceof assert.AssertionError ? error.message : 'details redacted'));
  process.exitCode = 1;
} finally { await db.$disconnect(); }
