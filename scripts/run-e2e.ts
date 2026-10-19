import "../tests/setup/load-env";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { applyMigrations } from "../tests/support/migrate";
import { verifyTestDatabase } from "../tests/support/safety";
import { migrationDatabaseUrl } from "../tests/setup/test-target";
import { acquireTestSuiteLock } from "./test-suite-lock";
import { createHotel, createRoomType, createUser, tomorrow, addDays, toDateParam } from "../tests/support/factories";
import { resetDatabase, disconnect, prisma } from "../tests/support/db";
import { readSeedJson, type SeedCity, type SeedAirport } from "../prisma/seed-fixtures";
import { createServer } from "node:net";

async function prepare() {
  const migration = new PrismaClient({ datasourceUrl: migrationDatabaseUrl(process.env.DATABASE_URL!) });
  try { await verifyTestDatabase(migration); await applyMigrations(migration); }
  finally { await migration.$disconnect(); }
  await resetDatabase();
  const cities = readSeedJson<SeedCity[]>("seed_data/cities.json");
  await prisma.city.createMany({data:cities.map(city=>({name:city.city,country:city.country}))});
  const byName = new Map((await prisma.city.findMany()).map(city=>[city.name,city.id]));
  const airports = readSeedJson<SeedAirport[]>("seed_data/airports.json");
  await prisma.airport.createMany({data:airports.map(airport=>({externalId:airport.id,code:airport.code,name:airport.name,country:airport.country,cityId:byName.get(airport.city)}))});
  const owner = await createUser({email:"e2e-owner@example.invalid",firstName:"Demo",lastName:"Owner",IsHotelOwner:true});
  const hotel = await createHotel({ownerId:owner.id,name:"FlyNext Synthetic Stay",location:"Toronto, Canada"});
  const room = await createRoomType({hotelId:hotel.id,name:"Synthetic Suite",availability:3,pricePerNight:100,nights:30});
  mkdirSync("test-results",{recursive:true});
  writeFileSync("test-results/fixture.json",JSON.stringify({hotelId:hotel.id,roomId:room.id,checkIn:toDateParam(tomorrow()),checkOut:toDateParam(addDays(tomorrow(),2))}));
  await disconnect();
}

async function main() {
  // Keep the shared database lock until the server and all browser workers exit.
  const release = acquireTestSuiteLock();
  try {
    try {
      await new Promise<void>((resolve,reject)=>{
        const probe=createServer();
        probe.once("error",()=>reject(new Error("E2E port 3210 is already in use; no fixture writes performed.")));
        probe.listen(3210,"127.0.0.1",()=>probe.close(()=>resolve()));
      });
      if (process.argv[2] === "--serve") {
        const check=new PrismaClient({datasourceUrl:migrationDatabaseUrl(process.env.DATABASE_URL!)});
        try { await verifyTestDatabase(check); } finally { await check.$disconnect(); }
        const child=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port","3210"],{
          env:{...process.env,NODE_ENV:"production",VITEST:"true"},stdio:"inherit",windowsHide:true,
        });
        const stop=()=>child.kill();
        process.stdin.once("data",stop);
        process.stdin.resume();
        try { await new Promise<void>((resolve,reject)=>{child.once("exit",()=>resolve());child.once("error",reject);}); }
        finally {process.stdin.removeListener("data",stop);process.stdin.pause();}
        return;
      }
      await prepare();
      const result = spawnSync(process.execPath,["node_modules/@playwright/test/cli.js","test",...process.argv.slice(2)],{
        env:{...process.env,FLYNEXT_E2E_VERIFIED:"1",VITEST:"true",NODE_ENV:"development"},stdio:"inherit",windowsHide:true,
      });
      if (result.error) throw new Error("Playwright could not start.");
      process.exitCode=result.status ?? 1;
    } finally { await disconnect(); }
  } finally { release(); }
}
main().catch((error:unknown)=>{console.error(error instanceof Error && !error.name.startsWith("Prisma") ? error.message.replace(/postgres(?:ql)?:\/\/\S+/g,"[redacted]") : "E2E database setup failed; driver details withheld.");process.exitCode=1;});
