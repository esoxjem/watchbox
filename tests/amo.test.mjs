import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = new URL('../scripts/amo.mjs', import.meta.url);
const exec = promisify(execFile);

test('the draft store listing directs users to the Watchbox repository', async () => {
  const listing = JSON.parse(await readFile('store/listing.example.json', 'utf8'));
  assert.equal(listing.homepage['en-US'], 'https://github.com/esoxjem/watchbox');
});

function run(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script.pathname, ...args], { env });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

async function api(t, status = 200, response = { id: 123, name: { 'en-US': 'Watchbox' } }) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks);
    requests.push({ method: req.method, url: req.url, headers: req.headers, body: rawBody.toString(), rawBody });
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('WEB_EXT_')));
  Object.assign(env, {
    WEB_EXT_API_KEY: 'user:123:4',
    WEB_EXT_API_SECRET: 'test-secret',
    WEB_EXT_AMO_BASE_URL: `http://127.0.0.1:${server.address().port}/api/v5/`
  });
  return { env, requests };
}

test('AMO get reads the manifest extension listing with a signed short-lived JWT', { timeout: 5000 }, async t => {
  const { env, requests } = await api(t);
  const result = await run(['get'], env);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).id, 123);
  assert.equal(requests.length, 1);
  const [request] = requests;
  assert.equal(request.method, 'GET');
  assert.equal(request.url, '/api/v5/addons/addon/watchbox-prototype%40local.watchbox/');
  const [header, payload, signature] = request.headers.authorization.slice('JWT '.length).split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'HS256', typ: 'JWT' });
  const claims = JSON.parse(Buffer.from(payload, 'base64url'));
  assert.equal(claims.iss, env.WEB_EXT_API_KEY);
  assert.ok(claims.jti);
  assert.ok(Math.abs(claims.iat - Date.now() / 1000) < 5);
  assert.equal(claims.exp - claims.iat, 60);
  assert.equal(signature, createHmac('sha256', env.WEB_EXT_API_SECRET).update(`${header}.${payload}`).digest('base64url'));
  assert.ok(!result.stdout.includes(env.WEB_EXT_API_SECRET));
});

test('AMO update patches listing text without submitting an extension version', { timeout: 5000 }, async t => {
  const { env, requests } = await api(t);
  const dir = await mkdtemp(join(tmpdir(), 'watchbox-amo-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'listing.json');
  const listing = { summary: { 'en-US': 'A calmer YouTube.' }, categories: { firefox: ['feeds-news-blogging'] } };
  await writeFile(file, JSON.stringify(listing));
  const result = await run(['update', file], env);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'PATCH');
  assert.equal(requests[0].headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(requests[0].body), listing);
});

test('AMO icon uploads the PNG as multipart form data without changing listing text', { timeout: 5000 }, async t => {
  const { env, requests } = await api(t);
  const dir = await mkdtemp(join(tmpdir(), 'watchbox-icon-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'icon.png');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=', 'base64');
  await writeFile(file, png);
  const result = await run(['icon', file], env);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.equal(request.method, 'PATCH');
  assert.equal(request.url, '/api/v5/addons/addon/watchbox-prototype%40local.watchbox/');
  assert.match(request.headers['content-type'], /^multipart\/form-data; boundary=/);
  const form = await new Request('http://localhost/', { method: 'PATCH', headers: request.headers, body: request.rawBody }).formData();
  assert.deepEqual([...form.keys()], ['icon']);
  assert.equal(form.get('icon').name, 'icon.png');
  assert.equal(form.get('icon').type, 'image/png');
  assert.deepEqual(Buffer.from(await form.get('icon').arrayBuffer()), png);
});

test('AMO commands explain missing credentials before making a request', { timeout: 5000 }, async t => {
  const { env, requests } = await api(t);
  for (const key of ['WEB_EXT_API_KEY', 'WEB_EXT_API_SECRET']) {
    const result = await run(['get'], { ...env, [key]: '' });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Set WEB_EXT_API_KEY and WEB_EXT_API_SECRET in .env/);
  }
  assert.equal(requests.length, 0);
});

test('AMO rejects invalid commands and listing payloads without making a request', { timeout: 5000 }, async t => {
  const { env, requests } = await api(t);
  for (const args of [[], ['delete'], ['get', 'extra'], ['update'], ['update', 'missing.json', 'extra']]) {
    const result = await run(args, env);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Usage: npm run amo -- (get|update)/);
  }
  const dir = await mkdtemp(join(tmpdir(), 'watchbox-amo-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'listing.json');
  for (const value of ['{', 'null', '[]', '{}', '{"version":{"license":"MPL-2.0"}}']) {
    await writeFile(file, value);
    const result = await run(['update', file], env);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Listing must be a non-empty JSON object containing editable add-on fields/);
  }
  assert.equal(requests.length, 0);
});

test('AMO reports server rejection as failure with the API validation details', { timeout: 5000 }, async t => {
  const { env } = await api(t, 403, { detail: 'You do not own this add-on.' });
  const result = await run(['get'], env);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /AMO 403.*You do not own this add-on/);
  assert.ok(!result.stderr.includes(env.WEB_EXT_API_SECRET));
});

test('web-ext packaging excludes store tooling and credential files', { timeout: 10000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'watchbox-package-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = join(dir, 'source'), artifacts = join(dir, 'artifacts');
  await mkdir(source);
  await writeFile(join(source, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Package test', version: '1.0' }));
  for (const file of ['scripts/amo.mjs', 'store/listing.example.json', 'tests/test.mjs', 'docs/source-provenance.md', 'artifacts/old.txt', 'README.md', 'AGENTS.md', 'package.json', '.env', '.env.example']) {
    await mkdir(join(source, file, '..'), { recursive: true });
    await writeFile(join(source, file), 'must not ship');
  }
  await exec(process.execPath, ['node_modules/web-ext/bin/web-ext.js', 'build', '--source-dir', source, '--artifacts-dir', artifacts]);
  const [archive] = await readdir(artifacts);
  const { stdout } = await exec('unzip', ['-Z1', join(artifacts, archive)]);
  assert.deepEqual(stdout.trim().split('\n'), ['manifest.json']);
});

test('local AMO credentials are ignored by Git while the setup example remains trackable', async () => {
  const result = await exec('git', ['check-ignore', '--no-index', '.env', '.env.local', '.env.example']).catch(error => error);
  assert.deepEqual(result.stdout.trim().split('\n').filter(Boolean), ['.env', '.env.local']);
});

test('npm exposes the authenticated listing and official signing commands', { timeout: 10000 }, async t => {
  const { env } = await api(t);
  const listing = await exec('npm', ['run', '--silent', 'amo', '--', 'get'], { env });
  assert.equal(JSON.parse(listing.stdout).id, 123);
  const signing = await exec('npm', ['run', '--silent', 'sign', '--', '--help'], { env });
  assert.match(signing.stdout, /--amo-metadata/);
  assert.match(signing.stdout, /--channel/);
});
