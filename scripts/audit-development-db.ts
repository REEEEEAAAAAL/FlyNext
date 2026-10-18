import { PrismaClient } from "@prisma/client";
import { parseEnvFile } from "../tests/setup/env-file";
import { migrationDatabaseUrl } from "../tests/setup/test-target";

async function main() {
 const source = parseEnvFile(".env");
 const url = new URL(source.DATABASE_URL);
 const endpointArg = process.argv.indexOf("--endpoint");
 if(endpointArg >= 0) url.hostname=process.argv[endpointArg+1];
 const test = new URL(parseEnvFile(".env.test").DATABASE_URL);
 const endpoint = (u: URL) => u.hostname.replace("-pooler.", ".");
 if (endpoint(url) === endpoint(test) && url.pathname === test.pathname) throw new Error("开发与测试目标重合，停止。");
 console.log(JSON.stringify({endpoint: endpoint(url), database: decodeURIComponent(url.pathname.slice(1)), role: decodeURIComponent(url.username), testEndpoint: endpoint(test), testDatabase: test.pathname.slice(1), configuredNeonKeys: Object.keys(source).filter(k => /NEON/.test(k))}));
 const db = new PrismaClient({datasourceUrl: migrationDatabaseUrl(url.href)});
 try {
  for (const [label, sql] of Object.entries({
   identity: `SELECT current_database() AS database, current_user AS role, oid::text, shobj_description(oid,'pg_database') AS marker, current_setting('TimeZone') AS timezone FROM pg_database WHERE datname=current_database()`,
   migrations: `SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name`,
   counts: `SELECT 'User' AS table_name,count(*)::int FROM "User" UNION ALL SELECT 'Hotel',count(*)::int FROM "Hotel" UNION ALL SELECT 'RoomType',count(*)::int FROM "RoomType" UNION ALL SELECT 'RoomAvailabilityRecord',count(*)::int FROM "RoomAvailabilityRecord" UNION ALL SELECT 'HotelReservation',count(*)::int FROM "HotelReservation"`,
   inventory: `SELECT date::time::text AS time, min(date)::text, max(date)::text,count(*)::int FROM "RoomAvailabilityRecord" GROUP BY date::time ORDER BY time`,
   stays: `SELECT "checkIn"::time::text AS start_time,"checkOut"::time::text AS end_time,status,count(*)::int,min("checkIn")::text,max("checkOut")::text FROM "HotelReservation" GROUP BY 1,2,3`,
   invalid: `SELECT count(*)::int FROM "HotelReservation" WHERE "checkOut" <= "checkIn" OR price<0`,
   hotels: `SELECT h.id,h.name,h.location,count(r.id)::int AS rooms FROM "Hotel" h LEFT JOIN "RoomType" r ON r."hotelId"=h.id WHERE h.location ILIKE '%Atlanta%' GROUP BY h.id`,
  })) console.log(label, JSON.stringify(await db.$queryRawUnsafe(sql)));
 } finally {await db.$disconnect();}
}
main().catch(() => {console.error("只读审查失败；连接诊断已隐藏。");process.exitCode=1;});
