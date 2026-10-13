import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

test('the Pages site offers working Firefox and repository links with assets under the project URL', async () => {
  const root = new URL('../docs/', import.meta.url);
  const html = await readFile(new URL('index.html', root), 'utf8');
  const dom = new JSDOM(html, { url: 'https://esoxjem.github.io/watchbox/' });
  const doc = dom.window.document;
  assert.equal(doc.documentElement.lang, 'en');
  assert.match(doc.querySelector('h1').textContent, /Inbox Zero\.\s*For YouTube\./);
  const links = [...doc.querySelectorAll('a')];
  const install = links.find(link => link.textContent.includes('Try in Firefox'));
  assert.equal(install?.href, 'https://github.com/esoxjem/watchbox#try-it');
  assert.ok(links.some(link => link.href === 'https://addons.mozilla.org/en-US/firefox/addon/watchbox/'));
  assert.ok(links.some(link => link.href === 'https://github.com/esoxjem/watchbox/issues'));
  for (const asset of doc.querySelectorAll('img, link[rel="stylesheet"], link[rel="icon"]')) {
    const value = asset.getAttribute('src') || asset.getAttribute('href');
    const url = new URL(value, dom.window.location.href);
    assert.equal(url.origin, dom.window.location.origin, 'Site assets must be self-hosted');
    assert.ok(url.pathname.startsWith('/watchbox/'), 'Assets must resolve under the Pages project path');
    await access(new URL(value, root));
    if (asset.tagName === 'IMG') assert.ok(asset.hasAttribute('alt'), 'Images need alternative text');
  }
  dom.window.close();
});
