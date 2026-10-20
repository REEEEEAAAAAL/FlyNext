import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const withAfs = process.argv.includes('--afs');
const outputIndex = process.argv.indexOf('--output');
const output = outputIndex < 0 ? (withAfs ? '.env.docker.afs.local' : '.env.docker.local') : process.argv[outputIndex + 1];
if (!output || !/^\.env\.docker[\w.-]*$/.test(output)) throw new Error('Use a dedicated .env.docker filename.');
const portIndex = process.argv.indexOf('--port');
const port = portIndex < 0 ? (withAfs ? 3301 : 3300) : Number(process.argv[portIndex + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Use a local port from 1024 to 65535.');
const secret = () => randomBytes(32).toString('hex');
const config = [
  `COMPOSE_PROJECT_NAME=flynext-local-${randomBytes(6).toString('hex')}`,
  `FLYNEXT_DOCKER_PORT=${port}`,
  `FLYNEXT_DOCKER_INSTANCE_ID=${randomUUID()}`,
  `FLYNEXT_DOCKER_PASSWORD=${secret()}`,
  `FLYNEXT_DOCKER_ADMIN_PASSWORD=${secret()}`,
  `FLYNEXT_DOCKER_ACCESS_SECRET=${secret()}`,
  `FLYNEXT_DOCKER_REFRESH_SECRET=${secret()}`,
  ...(withAfs ? [
    `AFS_DOCKER_INSTANCE_ID=${randomUUID()}`,
    `AFS_DOCKER_PASSWORD=${secret()}`,
    `AFS_DOCKER_ADMIN_PASSWORD=${secret()}`,
    `AFS_LOCAL_API_KEY=${secret()}`,
    'AFS_LOCAL_AGENCY=flynext-local',
    'AFS_SEED_DAYS=14',
  ] : []),
  '',
].join('\n');
writeFileSync(output, config, { flag: 'wx', mode: 0o600 });
console.log(`Created ${output} with a unique project and local credentials. Existing files are never overwritten.`);
