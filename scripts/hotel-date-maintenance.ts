import { PrismaClient, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { parseEnvFile } from "../tests/setup/env-file";
import { migrationDatabaseUrl } from "../tests/setup/test-target";
import { repairSnapshot, type DateSnapshot } from "../lib/hotel-date-repair";

const args = process.argv.slice(2);
const option = (name: string) => {const i=args.indexOf(`--${name}`);return i<0 ? undefined : args[i+1];};
const required = (name: string) => {const value=option(name);if (!value || value.startsWith("--")) throw new Error(`缺少 --${name}`);return value;};
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fileHash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
type Db = Pick<Prisma.TransactionClient,"$queryRawUnsafe"|"roomType"|"roomAvailabilityRecord"|"hotelReservation">;
async function snapshot(db: Db): Promise<DateSnapshot> {
 const rooms=await db.roomType.findMany({select:{id:true,hotelId:true,currentAvailability:true,pricePerNight:true},orderBy:{id:"asc"}});
 const inventory=await db.roomAvailabilityRecord.findMany({orderBy:{id:"asc"}});
 const stays=await db.hotelReservation.findMany({select:{id:true,roomTypeId:true,hotelId:true,userId:true,itineraryId:true,checkIn:true,checkOut:true,price:true,status:true},orderBy:{id:"asc"}});
 return JSON.parse(JSON.stringify({rooms,inventory,stays}));
}
async function identity(db: Db, url: URL) {
 const rows=await db.$queryRawUnsafe<Array<{database:string;role:string;oid:string;marker:string|null}>>(`SELECT current_database() AS database,current_user AS role,oid::text,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()`);
 const row=rows[0];
 if(rows.length!==1 || row.database!==decodeURIComponent(url.pathname.slice(1)) || row.role!==decodeURIComponent(url.username)) throw new Error("实际数据库身份不匹配。");
 if(row.database==="flynext_test" || row.marker?.startsWith("flynext-disposable-test:")) throw new Error("维护脚本禁止操作集成测试库。");
 return {endpoint:url.hostname,port:url.port||"5432",...row};
}
async function main() {
 const envPath=required("env-file");
 const url=new URL(migrationDatabaseUrl(parseEnvFile(envPath).DATABASE_URL));
 if(url.searchParams.get("sslmode")!=="require" || !url.hostname.endsWith(".neon.tech")) throw new Error("仅允许显式 TLS Neon 目标。");
 if(existsSync(".env.test")) {
  const test=new URL(migrationDatabaseUrl(parseEnvFile(".env.test").DATABASE_URL));
  if(url.hostname===test.hostname && url.pathname===test.pathname) throw new Error("目标是集成测试库，拒绝。");
 }
 const db=new PrismaClient({datasourceUrl:url.href});
 try {
  const actual=await identity(db,url);
  if(args[0]==="backup") {
   const out=resolve(required("out"));mkdirSync(out,{recursive:true});
   const dump=join(out,"database.dump");
   if(existsSync(dump)) throw new Error("备份文件已存在，禁止覆盖。");
   const pgEnv={...process.env,PGHOST:url.hostname,PGPORT:url.port||"5432",PGDATABASE:actual.database,PGUSER:actual.role,PGPASSWORD:decodeURIComponent(url.password),PGSSLMODE:"require"};
   const binary=(name:string)=>option("pg-bin") ? join(required("pg-bin"),process.platform==="win32"?`${name}.exe`:name):name;
   const run=spawnSync(binary("pg_dump"),["--format=custom","--no-owner","--no-acl","--file",dump],{env:pgEnv,encoding:"utf8"});
   if(run.status!==0) throw new Error("pg_dump 失败，禁止后续写入；诊断隐藏。");
   if(spawnSync(binary("pg_restore"),["--list",dump],{encoding:"utf8"}).status!==0) throw new Error("备份目录校验失败。");
   const before=await db.$transaction(tx=>snapshot(tx),{isolationLevel:"RepeatableRead"});
   writeFileSync(join(out,"receipt.json"),JSON.stringify({version:1,createdAt:new Date().toISOString(),identity:actual,dump,sha256:fileHash(dump),snapshotHash:hash(before),snapshot:before},null,2),{flag:"wx",mode:0o600});
   console.log("完整备份已生成，归档目录可读；恢复演练仍需独立分支。",JSON.stringify({identity:actual,rooms:before.rooms.length,inventory:before.inventory.length,stays:before.stays.length}));
  } else if(args[0]==="plan") {
   const zone=required("source-zone"), evidence=required("evidence");
   const before=await db.$transaction(tx=>snapshot(tx),{isolationLevel:"RepeatableRead"});
   const reconcileInventory=args.includes("--reconcile-inventory");
   const after=repairSnapshot(before,zone,reconcileInventory);
   const plan={version:1,identity:actual,zone,evidence,reconcileInventory,before,after,beforeHash:hash(before),afterHash:hash(after)};
   writeFileSync(required("out"),JSON.stringify(plan,null,2),{flag:"wx",mode:0o600});
   console.log("只读计划已生成。",JSON.stringify({inventoryChanges:before.inventory.filter((r,i)=>r.date!==after.inventory[i].date||r.availability!==after.inventory[i].availability).length,stayChanges:before.stays.filter((r,i)=>r.checkIn!==after.stays[i].checkIn||r.checkOut!==after.stays[i].checkOut).length}));
  } else if(args[0]==="apply") {
   const plan=JSON.parse(readFileSync(required("plan"),"utf8")) as {identity:typeof actual;zone:string;evidence:string;reconcileInventory?:boolean;before:DateSnapshot;after:DateSnapshot;beforeHash:string;afterHash:string};
   const receipt=JSON.parse(readFileSync(required("backup"),"utf8"));
   if(required("confirm-database")!==actual.database || hash(plan.identity)!==hash(actual) || hash(receipt.identity)!==hash(actual)) throw new Error("确认目标、计划或备份身份不匹配。");
   if(fileHash(receipt.dump)!==receipt.sha256 || hash(receipt.snapshot)!==receipt.snapshotHash || receipt.snapshotHash!==plan.beforeHash) throw new Error("备份校验失败或数据状态已变化。");
   if(!plan.evidence || hash(plan.before)!==plan.beforeHash || hash(plan.after)!==plan.afterHash || hash(repairSnapshot(plan.before,plan.zone,plan.reconcileInventory))!==plan.afterHash) throw new Error("计划校验失败。");
   const report=required("report");
   if(existsSync(report)) throw new Error("报告已存在，禁止覆盖。");
   const result=await db.$transaction(async tx=>{
    await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '10s'`);
    await tx.$executeRawUnsafe(`LOCK TABLE "RoomType", "RoomAvailabilityRecord", "HotelReservation" IN SHARE ROW EXCLUSIVE MODE`);
    if(hash(await identity(tx,url))!==hash(actual)) throw new Error("事务身份变化。");
    const live=await snapshot(tx);
    if(hash(live)===plan.afterHash) return {inventory:0,stays:0,replayed:true};
    if(hash(live)!==plan.beforeHash) throw new Error("计划生成后业务数据已变化，必须重新备份和审查。");
    const inventory = await tx.$executeRaw`UPDATE "RoomAvailabilityRecord" target SET date=source.date::timestamptz AT TIME ZONE 'UTC',availability=source.availability
     FROM jsonb_to_recordset(${JSON.stringify(plan.after.inventory)}::jsonb) AS source(id int,date text,availability int)
     WHERE target.id=source.id AND (target.date IS DISTINCT FROM (source.date::timestamptz AT TIME ZONE 'UTC') OR target.availability IS DISTINCT FROM source.availability)`;
    const stays = await tx.$executeRaw`UPDATE "HotelReservation" target SET "checkIn"=source."checkIn"::timestamptz AT TIME ZONE 'UTC',"checkOut"=source."checkOut"::timestamptz AT TIME ZONE 'UTC'
     FROM jsonb_to_recordset(${JSON.stringify(plan.after.stays)}::jsonb) AS source(id int,"checkIn" text,"checkOut" text)
     WHERE target.id=source.id AND (target."checkIn" IS DISTINCT FROM (source."checkIn"::timestamptz AT TIME ZONE 'UTC') OR target."checkOut" IS DISTINCT FROM (source."checkOut"::timestamptz AT TIME ZONE 'UTC'))`;
    if(hash(await snapshot(tx))!==plan.afterHash) throw new Error("修复后全量快照校验失败，事务回滚。");
    return {inventory,stays,replayed:false};
   },{timeout:180000,maxWait:10000,isolationLevel:"Serializable"});
   writeFileSync(report,JSON.stringify({identity:actual,...result,beforeHash:plan.beforeHash,afterHash:plan.afterHash,backup:resolve(required("backup")),completedAt:new Date().toISOString()},null,2),{flag:"wx",mode:0o600});
   console.log("事务执行成功。",JSON.stringify(result));
  } else throw new Error("命令必须为 backup、plan 或 apply；请参见中文生产迁移指南。");
 } finally {await db.$disconnect();}
}
main().catch(error=>{console.error(error?.constructor===Error?error.message:"数据库维护失败；凭据和底层诊断已隐藏，未提交事务会回滚。");process.exitCode=1;});
