import { PrismaClient } from "@prisma/client";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

import { parseEnvFile } from "../tests/setup/env-file";
import { readSeedJson, type SeedCity, type SeedAirport } from "../prisma/seed-fixtures";
type ProductionTarget = { project: string; projectId: string; branch: string; branchId: string; parentBranchId: string; host: string; database: string; oid: string; migrator: string; runtime: string; marker: string; migrations: Array<{ name: string; executedChecksum: string; canonicalChecksum: string }> };
const target = JSON.parse(readFileSync("docs/internal/production-database.json", "utf8")) as ProductionTarget;

async function main() {
  const mode=process.argv[2] ?? "check";
  if (!["check","initialize-reference"].includes(mode)) throw new Error("Only check and initialize-reference are supported.");
  if (process.env.CI || process.env.VERCEL || process.env.VERCEL_ENV) throw new Error("Use this operator command outside deployment/CI.");
  const env=parseEnvFile(".database-maintenance/production.env");
  const direct=new URL(env.DIRECT_URL);
  const pooled=new URL(env.DATABASE_URL);
  for(const [url,role,host] of [[direct,target.migrator,target.host],[pooled,target.runtime,target.host.replace(".us-east-2","-pooler.us-east-2")]] as const) {
    if(url.hostname!==host || decodeURIComponent(url.pathname.slice(1))!==target.database || decodeURIComponent(url.username)!==role || url.searchParams.get("sslmode")!=="require" || url.searchParams.get("sslaccept")!=="strict") throw new Error("Production connection identity or strict TLS mismatch.");
  }
  const prisma=new PrismaClient({datasourceUrl:direct.toString()});
  const runtime=new PrismaClient({datasourceUrl:pooled.toString()});
  try {
    const [actual]=await prisma.$queryRawUnsafe<{database:string;role:string;owner:string;oid:string;marker:string}[]>(`SELECT current_database() AS database,current_user AS role,pg_get_userbyid(datdba) AS owner,oid::text,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()`);
    if(actual.database!==target.database || actual.role!==target.migrator || actual.owner!==target.migrator || actual.oid!==target.oid || actual.marker!==target.marker) throw new Error("Production physical identity mismatch; no writes.");
    const names=readdirSync("prisma/migrations").filter(name=>/^\d{14}_/.test(name)).sort();
    const history=await prisma.$queryRawUnsafe<{migration_name:string;checksum:string;finished_at:Date|null;rolled_back_at:Date|null}[]>('SELECT migration_name,checksum,finished_at,rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name');
    if(history.length!==names.length || history.length!==target.migrations.length || history.some((row,index)=>{
      const recorded=target.migrations[index];
      if(row.migration_name!==names[index] || row.migration_name!==recorded.name || !row.finished_at || row.rolled_back_at) return true;
      const sql=readFileSync(`prisma/migrations/${row.migration_name}/migration.sql`,"utf8").replace(/\r\n/g,"\n");
      return row.checksum!==recorded.executedChecksum || createHash("sha256").update(sql).digest("hex")!==recorded.canonicalChecksum;
    })) throw new Error("Migration history or approved SQL checksum mismatch.");
    const diff=spawnSync(process.execPath,["node_modules/prisma/build/index.js","migrate","diff","--from-schema-datasource","prisma/schema.prisma","--to-schema-datamodel","prisma/schema.prisma","--exit-code"],{env:{...process.env,DATABASE_URL:direct.toString()},encoding:"utf8",windowsHide:true});
    if(diff.status!==0) throw new Error("Prisma schema differs or could not be verified.");
    const [runtimeIdentity]=await runtime.$queryRawUnsafe<{database:string;role:string;oid:string}[]>(`SELECT current_database() AS database,current_user AS role,oid::text FROM pg_database WHERE datname=current_database()`);
    if(runtimeIdentity.oid!==target.oid || runtimeIdentity.database!==target.database || runtimeIdentity.role!==target.runtime) throw new Error("Runtime physical identity mismatch.");
    const privileges=await prisma.$queryRawUnsafe<{unsafe:boolean}[]>(`SELECT (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR pg_has_role(oid,'neon_superuser','MEMBER')
      OR (rolname=$1 AND (has_schema_privilege(rolname,'public','CREATE') OR has_database_privilege(rolname,current_database(),'CREATE')
      OR has_table_privilege(rolname,'"_prisma_migrations"','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member=pg_roles.oid)))) AS unsafe FROM pg_roles WHERE rolname IN ($1,$2)`,target.runtime,target.migrator);
    if(privileges.length!==2 || privileges.some(role=>role.unsafe)) throw new Error("Production roles have excessive privileges.");
    const invalidGrants=await prisma.$queryRawUnsafe<{tablename:string}[]>(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations'
      AND (NOT has_table_privilege($1,format('%I.%I',schemaname,tablename),'SELECT') OR NOT has_table_privilege($1,format('%I.%I',schemaname,tablename),'INSERT')
      OR NOT has_table_privilege($1,format('%I.%I',schemaname,tablename),'UPDATE') OR NOT has_table_privilege($1,format('%I.%I',schemaname,tablename),'DELETE')
      OR has_table_privilege($1,format('%I.%I',schemaname,tablename),'TRUNCATE'))`,target.runtime);
    const invalidSequences=await prisma.$queryRawUnsafe<{sequencename:string}[]>(`SELECT sequencename FROM pg_sequences WHERE schemaname='public'
      AND NOT has_sequence_privilege($1,format('%I.%I',schemaname,sequencename),'USAGE')`,target.runtime);
    if(invalidGrants.length || invalidSequences.length) throw new Error("Runtime table or sequence permissions do not match the application boundary.");
    if(mode==="initialize-reference") {
      await prisma.$transaction(async tx=>{
        await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(6201806)");
        const cities=readSeedJson<SeedCity[]>("seed_data/cities.json");
        const known=new Set((await tx.city.findMany({select:{name:true}})).map(row=>row.name));
        const missing=cities.filter(row=>!known.has(row.city));
        if(missing.length) await tx.city.createMany({data:missing.map(row=>({name:row.city,country:row.country}))});
        const byName=new Map((await tx.city.findMany({select:{id:true,name:true}})).map(row=>[row.name,row.id]));
        const airports=readSeedJson<SeedAirport[]>("seed_data/airports.json");
        await tx.airport.createMany({data:airports.map(row=>({externalId:row.id,code:row.code,name:row.name,country:row.country,cityId:byName.get(row.city)})),skipDuplicates:true});
      },{timeout:120_000});
    }
    console.log(JSON.stringify({database:target.database,branchId:target.branchId,oid:target.oid,migrations:history.length,schemaDrift:false,runtimeRole:target.runtime,cities:await runtime.city.count(),airports:await runtime.airport.count(),users:await runtime.user.count(),itineraries:await runtime.itinerary.count(),hotelReservations:await runtime.hotelReservation.count(),flightReservations:await runtime.flightReservation.count()}));
  } finally {await prisma.$disconnect();await runtime.$disconnect();}
}
main().catch(()=>{console.error("Production verification/initialization refused or failed; credentials and driver details withheld.");process.exitCode=1;});
