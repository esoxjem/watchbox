import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

test('the distributed extension includes its declared MIT license', { timeout: 10000 }, async t => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(pkg.license, 'MIT', 'The project must declare its open-source license');
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  assert.equal(lock.packages[''].license, pkg.license);
  const license = await readFile('LICENSE', 'utf8');
  assert.match(license, /^MIT License\n/);
  assert.match(license, /Copyright \(c\) 2026 Arun Sasidharan/);

  const artifacts = await mkdtemp(join(tmpdir(), 'watchbox-license-'));
  t.after(() => rm(artifacts, { recursive: true, force: true }));
  await exec(process.execPath, ['node_modules/web-ext/bin/web-ext.js', 'build', '--artifacts-dir', artifacts]);
  const [archive] = await readdir(artifacts);
  const { stdout } = await exec('unzip', ['-p', join(artifacts, archive), 'LICENSE']);
  assert.equal(stdout, license, 'Redistributed builds must retain the license notice');
});
