import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const withAfs = process.argv.includes('--afs');
const envFile = withAfs ? '.env.docker.afs.local' : '.env.docker.local';
const composeFiles = ['-f', 'docker-compose.yml'];
if (withAfs) composeFiles.push('-f', 'docker-compose.afs.yml', '--profile', 'afs');
const configArgs = ['--env-file', envFile, ...composeFiles];
const composeCli = process.env.DOCKER_COMPOSE_CLI;
const dockerCli = process.env.DOCKER_CLI ?? 'docker';

function runCompose(args) {
  const command = composeCli ?? dockerCli;
  const prefix = composeCli ? [] : ['compose'];
  try {
    return execFileSync(command, [...prefix, ...configArgs, ...args], { encoding: 'utf8' });
  } catch {
    throw new Error('Docker Compose topology validation failed. Check the local config and Compose CLI.');
  }
}

runCompose(['config', '--quiet']);
const config = JSON.parse(runCompose(['config', '--format', 'json']));
const services = config.services;

if (!withAfs) {
  assert.deepEqual(Object.keys(services).sort(), ['nextjs', 'postgres']);
  assert.equal(services.nextjs.environment.AFS_MOCK, 'true');
  assert.equal(services.nextjs.environment.AFS_BASE_URL, '');
  assert.ok(!services.nextjs.depends_on.afs);
  console.log(JSON.stringify({ topology: 'PASS', mode: 'built-in', services: Object.keys(services).sort() }));
} else {
  assert.deepEqual(Object.keys(services).sort(), ['afs', 'afs-postgres', 'nextjs', 'postgres']);
  assert.equal(services.nextjs.environment.AFS_MOCK, 'false');
  assert.equal(services.nextjs.environment.AFS_BASE_URL, 'http://afs:3000');
  assert.equal(services.nextjs.environment.AFS_API_KEY, services.afs.environment.AFS_LOCAL_API_KEY);
  assert.equal(services.nextjs.depends_on.afs.condition, 'service_healthy');
  for (const name of ['afs', 'afs-postgres', 'postgres']) assert.ok(!services[name].ports?.length);
  assert.ok(services.nextjs.ports.length > 0);
  assert.ok(services.nextjs.ports.every(port => port.host_ip === '127.0.0.1'));
  assert.notEqual(services.postgres.volumes[0].source, services['afs-postgres'].volumes[0].source);
  assert.notEqual(services.postgres.environment.POSTGRES_PASSWORD, services['afs-postgres'].environment.POSTGRES_PASSWORD);

  const dockerfile = readFileSync('dockerfile.afs', 'utf8');
  const expectedRevision = dockerfile.match(/^ARG AFS_REF=([a-f0-9]{40})$/m)?.[1];
  assert.ok(expectedRevision, 'AFS image must pin a full upstream commit SHA.');
  assert.match(dockerfile, /^USER afs$/m);
  const image = services.afs.image;
  assert.ok(image, 'AFS service must resolve to a local image.');
  let revision;
  try {
    revision = execFileSync(dockerCli, ['image', 'inspect', image, '--format', '{{ index .Config.Labels "org.opencontainers.image.revision" }}'], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error('AFS image inspection failed. Build the configured AFS image before topology acceptance.');
  }
  assert.equal(revision, expectedRevision);
  console.log(JSON.stringify({ topology: 'PASS', mode: 'remote', services: Object.keys(services).sort(),
    hostBindings: services.nextjs.ports.map(port => `${port.host_ip}:${port.published}`),
    databases: 'isolated volumes and credentials', revision }));
}
