import { createRequire } from 'node:module';
import { PrismaClient, FlightStatus } from '@prisma/client';
import { verifyDatabase } from './database.mjs';

const require = createRequire(import.meta.url);
const { airports } = require('../prisma/data/airports.js');
const { airlines } = require('../prisma/data/airlines.js');
const prisma = new PrismaClient();
const days = Number(process.env.AFS_SEED_DAYS ?? '14');

function randomFor(value) {
  let state = 0x811c9dc5;
  for (const char of value) state = Math.imul(state ^ char.charCodeAt(0), 0x01000193);
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}
function uuid(random) {
  const hex = n => Array.from({ length: n }, () => Math.floor(random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}

async function main() {
  await verifyDatabase(prisma);
  if (!Number.isInteger(days) || days < 7 || days > 90) throw new Error('AFS_SEED_DAYS must be an integer from 7 to 90.');
  if (!/^[a-f0-9]{64}$/.test(process.env.AFS_LOCAL_API_KEY ?? '')) throw new Error('A generated local API key is required.');
  for (const airport of airports) {
    await prisma.airport.upsert({ where: { code: airport.code }, create: airport, update: {} });
  }
  for (const airline of airlines) {
    const base = await prisma.airport.findUnique({ where: { code: airline.baseCode } });
    if (!base) throw new Error('Airline base airport is missing.');
    await prisma.airline.upsert({ where: { code: airline.code },
      create: { name: airline.name, code: airline.code, country: airline.country, baseId: base.id }, update: {} });
  }
  const name = process.env.AFS_LOCAL_AGENCY ?? 'flynext-local';
  const existing = await prisma.agency.findUnique({ where: { name } });
  if (existing && (existing.apiKey !== process.env.AFS_LOCAL_API_KEY || !existing.isActive)) {
    throw new Error('Existing agency differs from configuration; refusing implicit credential rotation.');
  }
  if (!existing) await prisma.agency.create({ data: { name, apiKey: process.env.AFS_LOCAL_API_KEY } });
  const allAirports = await prisma.airport.findMany({ orderBy: { code: 'asc' } });
  const allAirlines = await prisma.airline.findMany({ include: { base: true }, orderBy: { code: 'asc' } });
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z').getTime();
  let inserted = 0;
  for (let offset = 0; offset < days; offset++) {
    const date = new Date(today + offset * 86400000).toISOString().slice(0, 10);
    const rows = [];
    for (const airline of allAirlines) {
      const random = randomFor(`${airline.code}@${date}`);
      const others = allAirports.filter(a => a.id !== airline.baseId);
      const destinations = new Map();
      for (let i = 0; i < Math.max(1, Math.floor(others.length * 0.2)); i++) {
        const airport = others[Math.floor(random() * others.length)];
        destinations.set(airport.code, airport);
      }
      if (airline.base.code === 'YYZ') destinations.set('LHR', allAirports.find(a => a.code === 'LHR'));
      for (const destination of destinations.values()) {
        const minutes = airline.base.country === destination.country ? 120 : 420;
        for (const hour of [0, 8, 16]) {
          for (const [origin, target] of [[airline.base, destination], [destination, airline.base]]) {
            const departureTime = new Date(today + offset * 86400000 + hour * 3600000);
            rows.push({ id: uuid(random), flightNumber: `${airline.code}${100 + Math.floor(random() * 900)}`,
              departureTime, arrivalTime: new Date(departureTime.getTime() + minutes * 60000),
              duration: minutes, price: Math.round((80 + random() * 350) * 100) / 100, currency: 'USD',
              availableSeats: 100, status: FlightStatus.SCHEDULED, airlineId: airline.id,
              originId: origin.id, destinationId: target.id });
          }
        }
      }
    }
    for (let i = 0; i < rows.length; i += 500) {
      inserted += (await prisma.flight.createMany({ data: rows.slice(i, i + 500), skipDuplicates: true })).count;
    }
  }
  console.log(JSON.stringify({ airports: await prisma.airport.count(), airlines: await prisma.airline.count(),
    flights: await prisma.flight.count(), inserted, scheduleDays: days, agency: 'ready; key redacted' }));
}
main().catch(() => { console.error('[afs] seed failed; details redacted'); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
