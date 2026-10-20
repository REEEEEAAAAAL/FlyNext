import "../tests/setup/load-env";
import { PrismaClient } from "@prisma/client";
import { verifyTestDatabase } from "../tests/support/safety";

export default async function verifyBrowserTarget() {
  const prisma=new PrismaClient();
  try { await verifyTestDatabase(prisma); }
  finally { await prisma.$disconnect(); }
}
