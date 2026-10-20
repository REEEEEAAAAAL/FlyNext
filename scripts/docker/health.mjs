import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
try {
  await db.$queryRaw`SELECT 1`;
  const response = await fetch('http://127.0.0.1:3000/', { signal: AbortSignal.timeout(5000) });
  if (!response.ok) process.exitCode = 1;
} catch { process.exitCode = 1; }
finally { await db.$disconnect(); }
