import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ exists: vi.fn(), lookup: vi.fn() }));
vi.mock('node:fs', () => ({ existsSync: mocks.exists }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('@prisma/client', () => ({ PrismaClient: class { constructor() { throw new Error('Unit tests must not connect.'); } } }));
import { verifyDatabase } from '../afs/database.mjs';
const env = {
  DATABASE_URL: 'postgresql://afs_docker:synthetic@afs-postgres:5432/afs_docker_demo?connection_limit=1&connect_timeout=5',
  COMPOSE_PROJECT_NAME: 'flynext-local-012345abcdef',
  AFS_DOCKER_INSTANCE_ID: '00000000-0000-4000-8000-000000000001',
};
const row = { name: 'afs_docker_demo', role: 'afs_docker', address: '172.22.0.2', port: 5432,
  privileged: false, id: env.AFS_DOCKER_INSTANCE_ID, system_id: '123', actual_system_id: '123' };
const db = { $queryRaw: vi.fn() };
beforeEach(() => {
  mocks.exists.mockReturnValue(true);
  mocks.lookup.mockResolvedValue([{ address: row.address }]);
  db.$queryRaw.mockReset().mockResolvedValue([row]);
});
describe('isolated AFS database guard', () => {
  it('accepts a matching local role, DNS address, instance and physical cluster', async () => {
    await expect(verifyDatabase(db, env)).resolves.toBeUndefined();
  });
  it.each([
    ['external host', env.DATABASE_URL.replace('afs-postgres', 'outside.invalid')],
    ['FlyNext database', env.DATABASE_URL.replace('afs_docker_demo', 'flynext_docker_demo')],
    ['privileged role', env.DATABASE_URL.replace('afs_docker:', 'afs_bootstrap:')],
    ['connection override', env.DATABASE_URL + '&host=outside.invalid'],
  ])('refuses %s before any database call', async (_label, url) => {
    await expect(verifyDatabase(db, { ...env, DATABASE_URL: url })).rejects.toThrow('target refused');
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
  it('refuses execution outside a container', async () => {
    mocks.exists.mockReturnValue(false);
    await expect(verifyDatabase(db, env)).rejects.toThrow('target refused');
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
  it.each([
    { id: 'wrong-instance' }, { actual_system_id: '456' }, { privileged: true },
    { address: '172.99.0.2' }, { name: 'other_database' }, { role: 'afs_bootstrap' },
  ])('refuses mismatched live identity %j', async mismatch => {
    db.$queryRaw.mockResolvedValue([{ ...row, ...mismatch }]);
    await expect(verifyDatabase(db, env)).rejects.toThrow('identity mismatch');
  });
});
