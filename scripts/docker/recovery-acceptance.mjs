import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { prisma } = require('../../dist/lib/prisma.js');
const { assertDockerDatabaseIdentity } = require('../../dist/lib/docker-database-safety.js');
const { idempotentExternal } = require('../../dist/lib/api/idempotency.js');
const { createFlightReservation, cancelFlightReservation } = require('../../dist/lib/reservations.js');
const { createBooking, cancelFlight, retrieveBooking, searchFlights } = require('../../dist/lib/afs-client.js');
const mode = process.argv[2];
const stateFile = '/tmp/recovery-' + mode.replace('check-', '') + '.json';
const surname = 'Recovery';
await assertDockerDatabaseIdentity(prisma, process.env);
assert.equal(process.env.AFS_MOCK, 'false');
assert.equal(process.env.AFS_BASE_URL, 'http://afs:3000');
try {
  if (mode.startsWith('check-')) {
    const saved = JSON.parse(readFileSync(stateFile));
    for (let attempt = 0; attempt < 55; attempt++) {
      const row = await prisma.bookingRequest.findUnique({ where: { id: saved.id } });
      if (row?.state === 'COMPLETE') break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    const request = await prisma.bookingRequest.findUniqueOrThrow({ where: { id: saved.id } });
    assert.equal(request.state, 'COMPLETE');
    const expected = mode.includes('compensation') ? 502 : 201;
    assert.equal(request.statusCode, expected);
    const remote = await fetch('http://afs:3000/api/bookings/retrieve?operationKey=' + saved.id, { headers: { 'x-api-key': process.env.AFS_API_KEY } });
    assert.equal(remote.status, 200);
    const issued = await remote.json();
    assert.equal(issued.status, expected === 201 ? 'CONFIRMED' : 'CANCELLED');
    assert.equal(await prisma.flightReservation.count({ where: { afsBookingId: issued.bookingReference } }), expected === 201 ? 1 : 0);
    if (expected === 201) {
      const row = await prisma.flightReservation.findUniqueOrThrow({ where: { afsBookingId: issued.bookingReference } });
      await cancelFlightReservation(row.id);
      assert.equal((await retrieveBooking(surname, issued.bookingReference)).status, 'CANCELLED');
    }
    console.log(JSON.stringify({ recovery: mode, state: request.state, statusCode: request.statusCode, duplicateTickets: false, result: 'PASS' }));
  } else {
    assert.ok(['before', 'after', 'timeout', 'disconnect', 'compensation'].includes(mode));
    const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const groups = await searchFlights({ origin: 'YYZ', destination: 'LHR', date });
    const payload = { firstName: 'Synthetic', lastName: surname, email: 'recovery@example.invalid', passportNumber: 'DEMO-PASSENGER', flightIds: [groups.find(g => g.legs === 1).flights[0].id] };
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'user1@example.com' } });
    let proxy;
    if (mode === 'timeout' || mode === 'disconnect') {
      proxy = createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const upstream = await fetch('http://afs:3000' + req.url, { method: req.method, headers: { 'x-api-key': process.env.AFS_API_KEY, 'Idempotency-Key': req.headers['idempotency-key'], 'Content-Type': 'application/json' }, body: Buffer.concat(chunks) });
        assert.equal(upstream.status, 200);
        await upstream.arrayBuffer();
        if (mode === 'disconnect') res.destroy();
        else setTimeout(() => res.destroy(), 20000);
      });
      await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
      process.env.AFS_BASE_URL = 'http://127.0.0.1:' + proxy.address().port;
    }
    const key = randomUUID();
    const request = new Request('http://localhost/api/flights/book', { headers: { 'Idempotency-Key': key } });
    try {
      await idempotentExternal(request, user.id, 'flight-book', payload, async id => {
        writeFileSync(stateFile, JSON.stringify({ id }), { mode: 0o600 });
        if (mode === 'before') process.kill(process.pid, 'SIGKILL');
        const result = await createFlightReservation(payload, mode === 'compensation' ? -999999 : user.id, { operationId: id,
          createBooking: async body => {
            const issued = await createBooking(body, id);
            if (mode === 'after') process.kill(process.pid, 'SIGKILL');
            return issued;
          },
          ...(mode === 'compensation' ? { cancelFlight: async () => { throw new Error('Injected cancellation outage'); } } : {}),
        });
        return { status: 201, body: result };
      }, undefined, { payload, returnLegCount: 0 });
      throw new Error('Expected injected failure');
    } catch (error) {
      assert.equal(error.status, 502);
      const saved = JSON.parse(readFileSync(stateFile));
      const row = await prisma.bookingRequest.findUniqueOrThrow({ where: { id: saved.id } });
      assert.equal(row.state, mode === 'compensation' ? 'COMPENSATING' : 'PENDING');
      console.log(JSON.stringify({ injected: mode, durableState: row.state, result: 'PASS' }));
    } finally { proxy?.closeAllConnections(); proxy?.close(); }
  }
} finally { await prisma.$disconnect(); }
