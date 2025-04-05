import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const _prisma = prisma;
export { _prisma as prisma };