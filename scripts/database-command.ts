import { PrismaClient } from "@prisma/client";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { parseEnvFile } from "../tests/setup/env-file";
import { migrationDatabaseUrl } from "../tests/setup/test-target";

async function main() {
 const args=process.argv.slice(2), split=args.indexOf("--");
 const option=(name:string)=>{const i=args.indexOf(`--${name}`);if(i<0||i>=split)throw new Error(`缺少 --${name}`);return args[i+1];};
 const url=new URL(migrationDatabaseUrl(parseEnvFile(option("env-file")).DATABASE_URL));
 const database=decodeURIComponent(url.pathname.slice(1));
 if(option("confirm-database")!==database||database==="flynext_test"||!url.hostname.endsWith(".neon.tech")||url.searchParams.get("sslmode")!=="require") throw new Error("目标确认失败；要求非测试库的 TLS Neon 直连。");
 const command=args.slice(split+1);
 const sql = command[0]==="sql" && ["docs/sql/production-preflight.sql","docs/sql/production-postflight.sql"].includes(command[1]);
 if(split<0||(!sql&&(command[0]!=="migrate"||!["status","deploy","resolve","diff"].includes(command[1])))) throw new Error("仅允许指定迁移命令或项目只读核验 SQL。");
 const db=new PrismaClient({datasourceUrl:url.href});
 try {
  const [row]=await db.$queryRawUnsafe<Array<{database:string;role:string;oid:string;marker:string|null}>>(`SELECT current_database() AS database,current_user AS role,oid::text,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()`);
  if(row.database!==database||row.role!==decodeURIComponent(url.username)||row.marker?.startsWith("flynext-disposable-test:")) throw new Error("实际身份与指定目标不符。");
  console.log("迁移目标（不含凭据）：",JSON.stringify({endpoint:url.hostname,...row}));
 } finally {await db.$disconnect();}
 const pgBin=args.indexOf("--pg-bin");
 const psql=pgBin<0?"psql":join(args[pgBin+1],process.platform==="win32"?"psql.exe":"psql");
 const result=spawnSync(sql?psql:process.execPath,sql?["-X","--set","ON_ERROR_STOP=1","--file",resolve(command[1])]:[resolve("node_modules/prisma/build/index.js"),...command],{env:{...process.env,DATABASE_URL:url.href,PGHOST:url.hostname,PGPORT:url.port||"5432",PGDATABASE:database,PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGSSLMODE:"require"},encoding:"utf8",windowsHide:true});
 // Redact driver diagnostics before forwarding CLI output.
 const redact=(text:string)=>(text||"").replace(/postgres(?:ql)?:\/\/[^\s"']+/g,"[连接字符串已隐藏]").split(decodeURIComponent(url.password)).join("[密码已隐藏]");
 if(result.stdout) process.stdout.write(redact(result.stdout));
 if(result.stderr) process.stderr.write(redact(result.stderr));
 process.exitCode=result.status??1;
}
main().catch(error=>{console.error(error?.constructor===Error?error.message:"迁移命令失败，连接诊断已隐藏。");process.exitCode=1;});
