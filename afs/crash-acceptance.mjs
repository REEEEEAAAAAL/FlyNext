import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { verifyDatabase } from './database.mjs';
const db = new PrismaClient();
await verifyDatabase(db);
const stateFile = '/tmp/afs-transaction-crash.json';
const api = async (path, body, key) => {
  const r = await fetch('http://127.0.0.1:3000' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.AFS_LOCAL_API_KEY, ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body) });
  assert.equal(r.status, 200);
  return r.json();
};
try {
  if (process.argv[2] === 'prepare') {
    const original = await db.flight.findFirstOrThrow({ where: { departureTime: { gt: new Date(Date.now() + 86400000) } } });
    const { id: _id, createdAt: _created, updatedAt: _updated, ...data } = original;
    const key = randomUUID(), name = 'afs_test_pause_' + key.replaceAll('-', '');
    const flight = await db.flight.create({ data: { ...data, id: randomUUID(), flightNumber: 'CRASH-' + key, availableSeats: 1 } });
    writeFileSync(stateFile, JSON.stringify({ flightId: flight.id, key, name }));
    await db.$executeRawUnsafe(`CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."operationKey" = '${key}' THEN PERFORM pg_sleep(60); END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER ${name} BEFORE INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.${name}()`);
    const pending = api('/api/bookings', { firstName: 'Crash', lastName: 'Synthetic', email: 'crash@example.invalid', passportNumber: 'DEMO-PASSENGER', flightIds: [flight.id] }, key).catch(() => null);
    for (let n = 0; n < 100; n++) {
      const rows = await db.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE wait_event = 'PgSleep' AND query LIKE '%bookings%'`;
      if (rows[0].count > 0) { console.log('READY: real HTTP transaction paused after seat decrement before ticket insert; kill only this test AFS container now.'); break; }
      if (n === 99) throw new Error('Transaction barrier was not reached');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await pending;
  } else {
    assert.equal(process.argv[2], 'check');
    let state;
    try { state = JSON.parse(readFileSync(stateFile)); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const triggers = await db.$queryRaw`SELECT tgname AS name FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'afs_test_pause_%'`;
      assert.equal(triggers.length, 1);
      const name = triggers[0].name;
      const hex = name.slice('afs_test_pause_'.length);
      const key = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
      let flights = await db.flight.findMany({ where: { flightNumber: 'CRASH-' + key } });
      if (!flights.length) flights = await db.flight.findMany({ where: { flightNumber: { startsWith: 'CRASH-' } } });
      assert.equal(flights.length, 1);
      state = { key, name, flightId: flights[0].id };
    }
    assert.match(state.name, /^afs_test_pause_[a-f0-9]{32}$/);
    await db.$executeRawUnsafe(`DROP TRIGGER ${state.name} ON public.bookings`);
    await db.$executeRawUnsafe(`DROP FUNCTION public.${state.name}()`);
    assert.equal(await db.booking.count({ where: { operationKey: state.key } }), 0);
    assert.equal((await db.flight.findUniqueOrThrow({ where: { id: state.flightId } })).availableSeats, 1);
    const booking = await api('/api/bookings', { firstName: 'Crash', lastName: 'Synthetic', email: 'crash@example.invalid', passportNumber: 'DEMO-PASSENGER', flightIds: [state.flightId] }, state.key);
    assert.equal(await db.booking.count({ where: { operationKey: state.key } }), 1);
    await api('/api/bookings/cancel', { bookingReference: booking.bookingReference, lastName: 'Synthetic' });
    assert.equal((await db.flight.findUniqueOrThrow({ where: { id: state.flightId } })).availableSeats, 1);
    console.log('PASS actual AFS SIGKILL rolls back seat decrement and ticket insert together; same key retry and cancellation restore exactly one seat');
  }
} finally { await db.$disconnect(); }
