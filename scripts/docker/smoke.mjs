import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { PDFDocument } from 'pdf-lib';
import { assertDockerDatabaseIdentity } from '../../dist/lib/docker-database-safety.js';

const db = new PrismaClient();
const mode = process.argv[2] ?? 'run';
const base = 'http://127.0.0.1:3000';
let token;
let cookie;
let phase = 'identity';
async function api(path, expected = 200, method = 'GET', body, key) {
  const response = await fetch(base + path, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, expected, `${phase}: ${method} ${path}`);
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return response;
}
const json = async (...args) => (await api(...args)).json();
const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
async function snapshot() {
  const rows = await db.$queryRaw`SELECT json_build_object(
    'users', (SELECT json_agg(t ORDER BY id) FROM "User" t),
    'hotels', (SELECT json_agg(t ORDER BY id) FROM "Hotel" t),
    'rooms', (SELECT json_agg(t ORDER BY id) FROM "RoomType" t),
    'inventory', (SELECT json_agg(t ORDER BY id) FROM "RoomAvailabilityRecord" t),
    'flights', (SELECT json_agg(t ORDER BY id) FROM "FlightReservation" t),
    'stays', (SELECT json_agg(t ORDER BY id) FROM "HotelReservation" t),
    'trips', (SELECT json_agg(t ORDER BY id) FROM "Itinerary" t),
    'ledger', (SELECT json_agg(t ORDER BY id) FROM "AfsOfflineBooking" t),
    'sessions', (SELECT json_agg(t ORDER BY "tokenHash") FROM "RefreshSession" t)
  )::text AS state`;
  return createHash('sha256').update(rows[0].state).digest('hex');
}
try {
  await assertDockerDatabaseIdentity(db, process.env);
  assert.equal(process.env.AFS_MOCK, 'true');
  assert.equal(process.env.AFS_BASE_URL, '');
  if (mode === 'snapshot') {
    const digest = await snapshot();
    writeFileSync('/tmp/flynext-docker-snapshot', digest);
    writeFileSync('/app/public/uploads/.docker-volume-check', digest);
    console.log(JSON.stringify({ persistenceSnapshot: digest }));
  } else if (mode === 'compare') {
    const digest = await snapshot();
    assert.equal(digest, readFileSync('/tmp/flynext-docker-snapshot', 'utf8'));
    assert.equal(digest, readFileSync('/app/public/uploads/.docker-volume-check', 'utf8'));
    console.log(JSON.stringify({ persistence: 'PASS', digest }));
  } else if (mode === 'reset-check') {
    assert.equal(await db.user.count(), 50);
    assert.equal(await db.user.count({ where: { email: { endsWith: '@example.invalid' } } }), 0);
    assert.equal(await db.afsOfflineBooking.count(), 1);
    assert.equal(await db.flightReservation.count(), 1);
    assert.equal(await db.hotelReservation.count(), 1);
    assert.equal(await db.itinerary.count(), 1);
    assert.equal(await db.bookingRequest.count(), 0);
    const inventory = await db.roomAvailabilityRecord.count();
    assert.ok(inventory > 0);
    assert.equal(await db.roomAvailabilityRecord.count({ where: { availability: { lt: 1 } } }), 0);
    console.log(JSON.stringify({ reset: 'PASS', users: 50, inventoryNights: inventory }));
  } else {
    assert.equal(mode, 'run');
    phase = 'pages';
    for (const path of ['/', '/flights', '/hotels', '/auth/login', '/auth/register']) {
      const response = await api(path);
      assert.match(await response.text(), /<html/);
    }
    await api('/api/itineraries', 401);
    console.log('PASS public pages and unauthenticated access protection');
    phase = 'registration and session';
    const email = `docker-${randomUUID()}@example.invalid`;
    const password = `Synthetic-${randomUUID()}`;
    await json('/api/auth/register', 201, 'POST', { email, password, firstName: 'Synthetic', lastName: 'Traveller' });
    token = (await json('/api/auth/login', 200, 'POST', { email, password })).accessToken;
    assert.ok(token && cookie);
    token = (await json('/api/auth/refresh', 200, 'POST')).accessToken;
    assert.ok(token);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    assert.notEqual(user.password, password);
    console.log('PASS registration, hashed database user, login and refresh rotation');
    phase = 'catalogue';
    const checkIn = day(3), checkOut = day(5);
    const hotels = await json(`/api/hotels?city=Toronto&checkIn=${checkIn}&checkOut=${checkOut}`);
    assert.ok(hotels.hotels.length > 0);
    const room = await db.roomType.findFirstOrThrow({ where: { hotel: { location: { contains: 'Toronto' } } }, orderBy: { id: 'asc' } });
    await api(`/api/hotels/${room.hotelId}/room-types`);
    const detailPath = `/api/hotels/${room.hotelId}/room-types/${room.id}?checkIn=${checkIn}&checkOut=${checkOut}`;
    const inventory = () => db.roomAvailabilityRecord.findMany({ where: { roomTypeId: room.id, date: { gte: new Date(checkIn), lt: new Date(checkOut) } }, orderBy: { date: 'asc' }, select: { availability: true } });
    const baseline = await inventory();
    assert.equal(baseline.length, 2);
    const detail = await json(detailPath);
    assert.ok(!JSON.stringify(detail).includes('reservations'));
    console.log('PASS hotel/room catalogue, privacy projection and nightly inventory');
    phase = 'built-in AFS';
    const groups = await json(`/api/flights/search?origin=YYZ&destination=LHR&date=${checkIn}`);
    assert.ok(groups.length > 0 && groups[0].flights.length > 0);
    const flightKey = randomUUID();
    const flightBody = { email, firstName: 'Synthetic', lastName: 'Traveller', flightIds: groups[0].flights.map(row => row.id), returnLegCount: 0 };
    const flight = await json('/api/flights/book', 201, 'POST', flightBody, flightKey);
    const replayFlight = await json('/api/flights/book', 201, 'POST', flightBody, flightKey);
    assert.equal(replayFlight.reservationId, flight.reservationId);
    assert.ok(await db.afsOfflineBooking.count() > 0);
    phase = 'hotel reservation';
    const stayBody = { hotelId: room.hotelId, roomTypeId: room.id, checkIn, checkOut };
    const stayKey = randomUUID();
    const stay = (await json('/api/hotels/book', 201, 'POST', stayBody, stayKey)).reservation;
    assert.equal((await json('/api/hotels/book', 201, 'POST', stayBody, stayKey)).reservation.id, stay.id);
    assert.deepEqual(await inventory(), baseline.map(row => ({ availability: row.availability - 1 })));
    console.log('PASS built-in AFS search/booking, durable ledger, hotel booking and idempotent inventory decrement');
    phase = 'itinerary and checkout';
    const trip = (await json('/api/itineraries', 201, 'POST', { flightReservationId: flight.reservationId, hotelReservationId: stay.id }, randomUUID())).reservations;
    await json('/api/checkout', 200, 'POST', { itineraryId: String(trip.id), paymentMethod: 'DEMO' }, randomUUID());
    const confirmed = await db.itinerary.findUniqueOrThrow({ where: { id: trip.id } });
    assert.equal(confirmed.status, 'CONFIRMED');
    assert.equal(confirmed.paymentMethod, 'DEMO');
    const receipt = await api(`/api/invoice?itineraryId=${trip.id}`);
    const bytes = new Uint8Array(await receipt.arrayBuffer());
    assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), '%PDF-');
    const pages = (await PDFDocument.load(bytes)).getPageCount();
    assert.ok(pages > 0);
    console.log(JSON.stringify({ checkout: 'PASS', pdfBytes: bytes.length, pdfPages: pages }));
    phase = 'cancellation';
    await json(`/api/itineraries/${trip.id}`, 200, 'DELETE');
    assert.deepEqual(await inventory(), baseline);
    assert.equal((await db.flightReservation.findUniqueOrThrow({ where: { id: flight.reservationId } })).status, 'CANCELLED');
    assert.equal((await db.hotelReservation.findUniqueOrThrow({ where: { id: stay.id } })).status, 'CANCELLED');
    await json(`/api/itineraries/${trip.id}`, 200, 'DELETE');
    assert.deepEqual(await inventory(), baseline);
    const standalone = (await json('/api/hotels/book', 201, 'POST', stayBody, randomUUID())).reservation;
    await json(`/api/hotels/book?reservationId=${standalone.id}`, 200, 'DELETE');
    assert.deepEqual(await inventory(), baseline);
    console.log('PASS itinerary and standalone hotel cancellation, flight cancellation and exact inventory restoration');
    phase = 'logout';
    const revoked = cookie;
    await json('/api/auth/logout', 200, 'POST');
    cookie = revoked;
    token = undefined;
    await api('/api/auth/refresh', 403, 'POST');
    console.log(JSON.stringify({ smoke: 'PASS', userId: user.id, itineraryId: trip.id, flightReservationId: flight.reservationId, hotelReservationId: stay.id, sessionRevoked: true }));
  }
} catch (error) {
  console.error(`Docker smoke failed in phase: ${phase}; ${error instanceof assert.AssertionError ? error.message : 'details redacted'}`);
  process.exitCode = 1;
} finally { await db.$disconnect(); }
