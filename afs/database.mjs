import { existsSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { PrismaClient } from '@prisma/client';

export async function verifyDatabase(db, env = process.env) {
  const url = new URL(env.DATABASE_URL ?? 'invalid:');
  if (!existsSync('/.dockerenv') || !/^flynext-local-[a-f0-9]{12}$/.test(env.COMPOSE_PROJECT_NAME ?? '') ||
      !/^[a-f0-9-]{36}$/.test(env.AFS_DOCKER_INSTANCE_ID ?? '') ||
      url.protocol !== 'postgresql:' || url.hostname !== 'afs-postgres' || url.port !== '5432' ||
      url.username !== 'afs_docker' || !url.password || url.pathname !== '/afs_docker_demo' ||
      url.hash || url.search !== '?connection_limit=1&connect_timeout=5') {
    throw new Error('AFS local database target refused.');
  }
  const addresses = await lookup('afs-postgres', { all: true, family: 4 });
  const rows = await db.$queryRaw`SELECT current_database()::text AS name, session_user::text AS role,
    host(inet_server_addr()) AS address, inet_server_port() AS port, i.*,
    r.rolsuper OR r.rolcreatedb OR r.rolcreaterole AS privileged
    FROM afs_local.identity() i JOIN pg_roles r ON r.rolname = session_user`;
  const row = rows[0];
  if (rows.length !== 1 || row.name !== 'afs_docker_demo' || row.role !== 'afs_docker' || row.privileged ||
      row.port !== 5432 || !addresses.some(item => item.address === row.address) ||
      row.id !== env.AFS_DOCKER_INSTANCE_ID || !/^\d+$/.test(row.system_id) || row.system_id !== row.actual_system_id) {
    throw new Error('AFS local database identity mismatch.');
  }
}

if (process.argv[2] === 'verify') {
  const db = new PrismaClient();
  try {
    await verifyDatabase(db);
    console.log('[afs] verified isolated afs-postgres database and physical cluster');
  } catch {
    console.error('[afs] database identity verification failed; details redacted');
    process.exitCode = 1;
  } finally { await db.$disconnect(); }
}
