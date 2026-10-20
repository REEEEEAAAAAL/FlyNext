import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { assertDockerDatabaseIdentity } from '../../dist/lib/docker-database-safety.js';
import { createFlightReservation } from '../../dist/lib/reservations.js';
import { createBooking, retrieveBooking } from '../../dist/lib/afs-client.js';
const db = new PrismaClient();
const mode = process.argv[2] ?? 'run';
let token;
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
async function api(path, expected = 200, method = 'GET', body, key) {
  const response = await fetch('http://127.0.0.1:3000' + path, {
    method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25000),
  });
  assert.equal(response.status, expected, method + ' ' + path);
  const result = await response.json();
  assert.ok(!JSON.stringify(result).includes(process.env.AFS_API_KEY));
  return result;
}
async function login(email, password) {
  token = (await api('/api/auth/login', 200, 'POST', { email, password })).accessToken;
  assert.ok(token);
}
const searchPath = '/api/flights/search?' + new URLSearchParams({ origin: 'YYZ', destination: 'LHR', date: day(3) });
try {
  await assertDockerDatabaseIdentity(db, process.env);
  assert.equal(process.env.AFS_MOCK, 'false');
  assert.equal(process.env.AFS_BASE_URL, 'http://afs:3000');
  if (mode === 'compare') {
    const saved = JSON.parse(readFileSync('/tmp/remote-persistence-booking', 'utf8'));
    await login(saved.email, saved.password);
    assert.equal((await api('/api/user/flight-bookings/' + saved.id)).booking.status, 'CONFIRMED');
    await api('/api/user/flight-bookings/' + saved.id, 200, 'POST');
    assert.equal((await retrieveBooking('Traveller', saved.reference)).status, 'CONFIRMED');
    console.log('PASS persisted FlyNext booking, local status, remote ticket and live schedule verification');
  } else if (mode === 'failure' || mode === 'timeout') {
    await login('user1@example.com', 'password1');
    const before = await db.afsOfflineBooking.count();
    const start = Date.now();
    await api(searchPath, 502);
    const elapsed = Date.now() - start;
    if (mode === 'timeout') assert.ok(elapsed >= 14000 && elapsed < 22000);
    await api('/api/user/flight-bookings', 200);
    assert.equal(await db.afsOfflineBooking.count(), before);
    console.log(JSON.stringify({ providerFailure: 'PASS', mode, response: 502, elapsedMs: elapsed,
      sessionStillValid: true, offlineFallback: false }));
  } else {
    assert.equal(mode, 'run');
    assert.equal(await db.afsOfflineBooking.count(), 0);
    const email = 'remote-' + randomUUID() + '@example.invalid';
    const password = 'Synthetic-' + randomUUID();
    await api('/api/auth/register', 201, 'POST', { email, password, firstName: 'Remote', lastName: 'Traveller' });
    await login(email, password);
    const outbound = await api(searchPath);
    const direct = outbound.find(g => g.legs === 1);
    const indirect = outbound.find(g => g.legs === 2);
    assert.ok(direct && indirect);
    for (const g of outbound) {
      assert.equal(g.totalPrice, Math.round(g.flights.reduce((sum, f) => sum + f.price, 0) * 100) / 100);
      assert.ok(g.flights.every(f => Number.isFinite(f.durationMinutes)));
    }
    const returns = await api('/api/flights/search?' + new URLSearchParams({ origin: 'LHR', destination: 'YYZ', date: day(5) }));
    const returnFlight = returns.find(g => g.legs === 1);
    assert.ok(returnFlight);
    const body = { email, firstName: 'Remote', lastName: 'Traveller',
      flightIds: [...direct.flights, ...returnFlight.flights].map(f => f.id), returnLegCount: returnFlight.flights.length };
    const key = randomUUID();
    const [one, two] = await Promise.all([api('/api/flights/book', 201, 'POST', body, key), api('/api/flights/book', 201, 'POST', body, key)]);
    assert.equal(one.reservationId, two.reservationId);
    assert.equal((await retrieveBooking('Traveller', one.bookingReference)).flights.length, 2);
    const path = '/api/user/flight-bookings/' + one.reservationId;
    await api(path, 200, 'POST');
    const local = await db.flightReservation.findUniqueOrThrow({ where: { id: one.reservationId } });
    assert.equal(local.price, Math.round(one.flights.reduce((sum, f) => sum + f.price, 0) * 100) / 100);
    assert.equal(local.afsBookingId, one.bookingReference);
    await api(path, 200, 'DELETE');
    await api(path, 200, 'DELETE');
    assert.equal((await retrieveBooking('Traveller', one.bookingReference)).status, 'CANCELLED');
    assert.equal((await api(path)).booking.status, 'CANCELLED');
    console.log('PASS round trip, concurrent same-key replay, verify, local price, repeated cancellation and remote status');
    const connection = await api('/api/flights/book', 201, 'POST', { ...body,
      flightIds: indirect.flights.map(f => f.id), returnLegCount: 0 }, randomUUID());
    assert.equal((await retrieveBooking('Traveller', connection.bookingReference)).flights.length, 2);
    await api('/api/user/flight-bookings/' + connection.reservationId, 200, 'DELETE');
    console.log('PASS connecting one-way itinerary through real HTTP provider');
    const badKey = randomUUID();
    const invalid = { ...body, flightIds: ['synthetic-missing-flight'], returnLegCount: 0 };
    const before = await db.flightReservation.count();
    await api('/api/flights/book', 502, 'POST', invalid, badKey);
    await api('/api/flights/book', 502, 'POST', invalid, badKey);
    assert.equal(await db.flightReservation.count(), before);
    console.log('PASS upstream rejection replays its terminal 502 and creates no duplicate');
    let issued;
    await assert.rejects(createFlightReservation({ email, firstName: 'Compensation', lastName: 'Traveller',
      passportNumber: 'DEMO-PASSENGER', flightIds: direct.flights.map(f => f.id) }, -999999, {
      returnLegCount: 0, createBooking: async payload => { issued = await createBooking(payload); return issued; },
    }), error => error.status === 502 && error.message.includes('ticket has been released'));
    assert.ok(issued);
    assert.equal((await retrieveBooking('Traveller', issued.bookingReference)).status, 'CANCELLED');
    assert.equal(await db.flightReservation.count({ where: { afsBookingId: issued.bookingReference } }), 0);
    console.log('PASS actual remote cancellation compensation after intentional local foreign-key failure');
    const active = await api('/api/flights/book', 201, 'POST', { ...body,
      flightIds: direct.flights.map(f => f.id), returnLegCount: 0 }, randomUUID());
    writeFileSync('/tmp/remote-persistence-booking', JSON.stringify({ email, password, id: active.reservationId, reference: active.bookingReference }), { mode: 0o600 });
    console.log(JSON.stringify({ remoteAcceptance: 'PASS', persistenceReservationId: active.reservationId, offlineLedgerRows: 0 }));
  }
} catch (error) {
  console.error('Remote acceptance failed: ' + (error instanceof assert.AssertionError ? error.message : 'details redacted'));
  process.exitCode = 1;
} finally { await db.$disconnect(); }
