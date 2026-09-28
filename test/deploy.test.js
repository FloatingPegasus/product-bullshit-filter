import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readlinkSync, symlinkSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const receiver = fileURLToPath(new URL('../deploy/receive.sh', import.meta.url));
const validator = fileURLToPath(new URL('../deploy/validate-image.py', import.meta.url));
const revision = 'a'.repeat(40);
const releaseId = `git-${revision}-1-1`;

function fixture(t, tag = `product-research:${releaseId}`) {
  const root = mkdtempSync(path.join(tmpdir(), 'product-deploy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ['bin', 'deploy', 'releases/previous', 'payload']) mkdirSync(path.join(root, directory), { recursive: true });
  writeFileSync(path.join(root, 'deploy/validate-image.py'), readFileSync(validator));
  writeFileSync(path.join(root, 'deploy/compose.yaml'), 'services: {}\n');
  writeFileSync(path.join(root, 'releases/previous/compose.yaml'), 'services: {}\n');
  symlinkSync(path.join(root, 'releases/previous'), path.join(root, 'current'));
  const scripts = {
    flock: 'exit 0',
    timeout: 'shift; exec "$@"',
    curl: 'echo health >> "$DEPLOY_CALLS"; [[ ${FAIL_HEALTH:-0} != 1 ]]',
    docker: [
      'echo "$*" >> "$DEPLOY_CALLS"',
      'if [[ "$*" == *".Architecture"* ]]; then',
      '  printf "%s %s\\n" "${IMAGE_ARCH:-arm64}" "$DEPLOY_REVISION"',
      'elif [[ "$*" == *"{{.Id}}"* ]]; then',
      '  echo sha256:test-image',
      'elif [[ $1 == compose && "$*" != *"/previous/"* && ${FAIL_ACTIVATE:-0} == 1 ]]; then',
      '  exit 7',
      'fi',
    ].join('\n'),
  };
  for (const [name, script] of Object.entries(scripts)) writeFileSync(path.join(root, 'bin', name), `#!/usr/bin/env bash\nset -eu\n${script}\n`, { mode: 0o700 });
  writeFileSync(path.join(root, 'payload/manifest.json'), JSON.stringify([{ RepoTags: [tag] }]));
  execFileSync('tar', ['-czf', path.join(root, 'payload.tar.gz'), '-C', path.join(root, 'payload'), 'manifest.json']);
  const run = (extra = {}, input = readFileSync(path.join(root, 'payload.tar.gz'))) => spawnSync('bash', [receiver], {
    input, encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, PRODUCT_DEPLOY_ROOT: root, SSH_ORIGINAL_COMMAND: `deploy ${releaseId}`, DEPLOY_CALLS: `${root}/calls`, DEPLOY_REVISION: revision, ...extra },
  });
  const calls = () => existsSync(`${root}/calls`) ? readFileSync(`${root}/calls`, 'utf8') : '';
  return { root, run, calls };
}

test('deployment key rejects arbitrary commands and extra shell syntax', t => {
  const f = fixture(t);
  for (const command of ['bash', `deploy ${releaseId}; id`, 'deploy ../../other']) {
    assert.equal(f.run({ SSH_ORIGINAL_COMMAND: command }).status, 64);
    assert.equal(f.calls(), '');
  }
});

test('deployment rejects images tagged for another service before loading', t => {
  const f = fixture(t, 'gateway:latest');
  assert.notEqual(f.run().status, 0);
  assert.equal(f.calls(), '');
  assert.equal(readlinkSync(`${f.root}/current`), `${f.root}/releases/previous`);
});

test('deployment rejects an incomplete image transfer without changing production', t => {
  const f = fixture(t);
  assert.notEqual(f.run({}, Buffer.from('incomplete')).status, 0);
  assert.equal(f.calls(), '');
  assert.equal(readlinkSync(`${f.root}/current`), `${f.root}/releases/previous`);
});

test('deployment refuses a mismatched image architecture', t => {
  const f = fixture(t);
  assert.equal(f.run({ IMAGE_ARCH: 'amd64' }).status, 65);
  assert.doesNotMatch(f.calls(), /compose/);
  assert.equal(readlinkSync(`${f.root}/current`), `${f.root}/releases/previous`);
});

test('healthy deployment records the image and advances current only after HTTPS health', t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readlinkSync(`${f.root}/current`), `${f.root}/releases/${releaseId}`);
  assert.equal(readFileSync(`${f.root}/current/release.env`, 'utf8'), `PRODUCT_IMAGE=product-research:${releaseId}\n`);
  assert.match(f.calls(), /compose[^\n]*up -d --no-build --wait --wait-timeout 90 app\nhealth/);
  assert.equal(existsSync(`${f.root}/current/image.tar.gz`), false);
});

for (const failure of ['FAIL_HEALTH', 'FAIL_ACTIVATE']) {
  test(`${failure} restores the previous image without advancing current`, t => {
    const f = fixture(t);
    const result = f.run({ [failure]: '1' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Restoring the previous app image/);
    assert.match(f.calls(), /compose --env-file \/dev\/null -f [^\n]*previous\/compose.yaml up -d --no-build --wait --wait-timeout 90 app/);
    assert.equal(readlinkSync(`${f.root}/current`), `${f.root}/releases/previous`);
  });
}
