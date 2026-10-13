import { createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

try {
  const args = process.argv.slice(2);
  const [command, file] = args;
  if (!(command === 'get' ? args.length === 1 : ['update', 'icon'].includes(command) && args.length === 2)) {
    throw new Error('Usage: npm run amo -- get | update <listing.json> | icon <icon.png>');
  }
  if (!process.env.WEB_EXT_API_KEY || !process.env.WEB_EXT_API_SECRET) {
    throw new Error('Set WEB_EXT_API_KEY and WEB_EXT_API_SECRET in .env (see .env.example).');
  }
  let body;
  if (command === 'update') {
    const contents = await readFile(file, 'utf8');
    const fields = new Set(['categories', 'contributions_url', 'default_locale', 'description', 'developer_comments', 'homepage', 'is_experimental', 'name', 'requires_payment', 'slug', 'summary', 'support_email', 'support_url', 'tags']);
    let listing;
    try { listing = JSON.parse(contents); } catch { /* Report a safe validation error below. */ }
    if (!listing || Array.isArray(listing) || typeof listing !== 'object' || !Object.keys(listing).length || Object.keys(listing).some(key => !fields.has(key))) {
      throw new Error('Listing must be a non-empty JSON object containing editable add-on fields (no version or upload).');
    }
    body = JSON.stringify(listing);
  }
  if (command === 'icon') {
    body = new FormData();
    body.set('icon', new Blob([await readFile(file)], { type: 'image/png' }), basename(file));
  }
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  const iat = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: process.env.WEB_EXT_API_KEY, jti: randomUUID(), iat, exp: iat + 60
  })).toString('base64url');
  const signature = createHmac('sha256', process.env.WEB_EXT_API_SECRET).update(`${header}.${payload}`).digest('base64url');
  const base = process.env.WEB_EXT_AMO_BASE_URL || 'https://addons.mozilla.org/api/v5/';
  const id = encodeURIComponent(manifest.browser_specific_settings.gecko.id);
  const response = await fetch(new URL(`addons/addon/${id}/`, base), {
    method: command === 'get' ? 'GET' : 'PATCH',
    body,
    headers: {
      Authorization: `JWT ${header}.${payload}.${signature}`,
      ...(command === 'update' ? { 'Content-Type': 'application/json' } : {})
    },
    redirect: 'error',
    signal: AbortSignal.timeout(30000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`AMO ${response.status}: ${JSON.stringify(data)}`);
  console.log(JSON.stringify(data, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
