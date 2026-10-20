import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const secret = () => randomBytes(32).toString('hex');
const config = [
  `COMPOSE_PROJECT_NAME=flynext-local-${randomBytes(6).toString('hex')}`,
  'FLYNEXT_DOCKER_PORT=3300',
  `FLYNEXT_DOCKER_INSTANCE_ID=${randomUUID()}`,
  `FLYNEXT_DOCKER_PASSWORD=${secret()}`,
  `FLYNEXT_DOCKER_ADMIN_PASSWORD=${secret()}`,
  `FLYNEXT_DOCKER_ACCESS_SECRET=${secret()}`,
  `FLYNEXT_DOCKER_REFRESH_SECRET=${secret()}`,
  '',
].join('\n');
writeFileSync('.env.docker.local', config, { flag: 'wx', mode: 0o600 });
console.log('Created .env.docker.local with a unique project and local credentials. Existing files are never overwritten.');
