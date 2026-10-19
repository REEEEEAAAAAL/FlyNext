import "../tests/setup/load-env";
import { PrismaClient } from "@prisma/client";
import { verifyTestDatabase } from "../tests/support/safety";
import { migrationDatabaseUrl } from "../tests/setup/test-target";

async function main() {
  if (process.env.CI !== "true") throw new Error("This verifier is for the dedicated CI environment.");
  const url=new URL(process.env.DATABASE_URL!);
  if (!url.hostname.endsWith(".neon.tech") || /ep-royal-darkness-a5ysk40g|ep-quiet-pond-a53srd2k/.test(url.hostname) || decodeURIComponent(url.username)!=="flynext_ci_runner") {
    throw new Error("CI must use an independently enrolled endpoint and dedicated flynext_ci_runner role.");
  }
  const prisma=new PrismaClient({datasourceUrl:migrationDatabaseUrl(url.toString())});
  try {
    await verifyTestDatabase(prisma);
    const roles=await prisma.$queryRawUnsafe<{unsafe:boolean}[]>(`SELECT (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls
      OR pg_has_role(current_user,'neon_superuser','MEMBER')) AS unsafe FROM pg_roles WHERE rolname=current_user`);
    if (roles.length!==1 || roles[0].unsafe) throw new Error("CI role must not have administrative privileges.");
    console.log("Dedicated CI database identity and non-administrative role verified.");
  } finally { await prisma.$disconnect(); }
}
main().catch(()=>{console.error("CI database isolation or privileges failed verification; no writes performed.");process.exitCode=1;});
