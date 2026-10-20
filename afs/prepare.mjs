import { readFileSync, writeFileSync, cpSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
const patch = resolve(import.meta.dirname, 'hardened');
const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, 'source-hashes.json')));
for (const [file, expected] of Object.entries(manifest)) {
  const actual = createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex');
  if (actual !== expected) throw new Error(`AFS upstream source mismatch: ${file}`);
}
let schema = readFileSync(resolve(root, 'prisma/schema.prisma'), 'utf8');
schema = schema.replace('model Booking {', 'model Booking {\n  operationKey String?\n  requestHash String?\n  @@unique([agencyId, operationKey])');
writeFileSync(resolve(root, 'prisma/schema.prisma'), schema);
cpSync(patch, root, { recursive: true });
console.log('Applied verified FlyNext AFS hardening overlay.');
