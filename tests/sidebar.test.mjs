import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

function sidebar(html) {
  const dom=new JSDOM(`<ytd-app>${html}</ytd-app>`,{url:'https://www.youtube.com/feed/subscriptions',runScripts:'outside-only'});
  for(const file of ['preferences.js','page-settings.js'])dom.window.eval(readFileSync(file,'utf8'));
  for(const file of JSON.parse(readFileSync('manifest.json','utf8')).content_scripts.flatMap(script=>script.css||[])) {
    const style=dom.window.document.createElement('style');style.textContent=readFileSync(file,'utf8');dom.window.document.head.append(style);
  }
  const doc=dom.window.document;
  const hidden=id=>{
    for(let node=doc.getElementById(id);node;node=node.parentElement)if(dom.window.getComputedStyle(node).display==='none')return true;
    return false;
  };
  return {dom,doc,apply:dom.window.WatchboxPageSettings.apply,hidden};
}

test('Hide Shorts covers title-based sidebar links and restores them when disabled',t=>{
  const p=sidebar(`
    <ytd-guide-section-renderer id="navigation">
      <ytd-guide-entry-renderer><a id="title-shorts" class="yt-simple-endpoint" title="Shorts">Shorts</a></ytd-guide-entry-renderer>
      <ytd-guide-entry-renderer><a id="absolute-shorts" class="yt-simple-endpoint" title="Shorts" href="https://www.youtube.com/shorts/123">Shorts</a></ytd-guide-entry-renderer>
      <ytd-guide-entry-renderer><a id="relative-shorts" href="/shorts/123">Shorts</a></ytd-guide-entry-renderer>
      <ytd-guide-entry-renderer><a id="subscriptions" href="/feed/subscriptions">Subscriptions</a></ytd-guide-entry-renderer>
      <ytd-guide-entry-renderer><a id="history" href="/feed/history">History</a></ytd-guide-entry-renderer>
    </ytd-guide-section-renderer>
    <ytd-mini-guide-entry-renderer><a id="mini-shorts" class="yt-simple-endpoint" title="Shorts" href="#">Shorts</a></ytd-mini-guide-entry-renderer>
  `);t.after(()=>p.dom.window.close());
  p.apply({hideShorts:true,hideSubscriptions:false});
  for(const id of ['title-shorts','absolute-shorts','relative-shorts','mini-shorts'])assert.equal(p.hidden(id),true,`${id} must hide`);
  for(const id of ['navigation','subscriptions','history'])assert.equal(p.hidden(id),false,`${id} must remain visible`);
  const late=p.doc.createElement('a');late.id='late-shorts';late.className='yt-simple-endpoint';late.title='Shorts';late.href='#';p.doc.getElementById('navigation').append(late);
  assert.equal(p.hidden(late.id),true,'Late sidebar links must hide without a synchronization pass');
  for(const values of [{hideShorts:false},{hideShorts:true,enabled:false}]) {
    p.apply(values);
    for(const id of ['title-shorts','absolute-shorts','relative-shorts','mini-shorts','late-shorts'])assert.equal(p.hidden(id),false,'Disabling Shorts hiding or Watchbox must restore the links');
  }
});

test('the Shorts navigation fallback leaves an ordinary video named Shorts visible',t=>{
  const p=sidebar('<ytd-guide-entry-renderer><a id="shorts-navigation" class="yt-simple-endpoint" title="Shorts">Shorts</a></ytd-guide-entry-renderer><main><a id="shorts-video" class="yt-simple-endpoint" title="Shorts" href="/watch?v=aircAruvnKk">Shorts</a></main>');
  t.after(()=>p.dom.window.close());
  p.apply({hideShorts:true});
  assert.equal(p.hidden('shorts-navigation'),true);
  assert.equal(p.hidden('shorts-video'),false,'A title alone identifies Shorts only inside native navigation');
});

test('Hide Explore and Trending preserves unrelated sidebar entries while hiding the storefront section',t=>{
  const p=sidebar(`
    <ytd-guide-section-renderer id="mixed-section">
      <ytd-guide-entry-renderer><a id="explore" class="yt-simple-endpoint" href="/feed/explore">Explore</a></ytd-guide-entry-renderer>
      <ytd-mini-guide-entry-renderer><a id="trending" href="/feed/trending">Trending</a></ytd-mini-guide-entry-renderer>
      <a id="alternate-trending" class="yt-simple-endpoint" href="/feed/trending?bp=1">Trending</a>
      <ytd-guide-entry-renderer><a id="history" href="/feed/history">History</a></ytd-guide-entry-renderer>
      <ytd-guide-entry-renderer><a id="channel" href="/@creator">Creator</a></ytd-guide-entry-renderer>
    </ytd-guide-section-renderer>
    <ytd-guide-section-renderer id="storefront-section"><a id="shopping" href="/feed/storefront">Shopping</a><a id="music" href="/channel/music">Music</a></ytd-guide-section-renderer>
    <ytd-browse id="explore-page" page-subtype="explore"></ytd-browse>
    <ytd-browse id="trending-page" page-subtype="trending"></ytd-browse>
    <ytd-browse id="subscriptions-page" page-subtype="subscriptions"></ytd-browse>
  `);t.after(()=>p.dom.window.close());
  p.apply({hideExploreTrending:true,hideSubscriptions:false});
  for(const id of ['mixed-section','history','channel','subscriptions-page'])assert.equal(p.hidden(id),false,`${id} must remain visible`);
  for(const id of ['explore','trending','alternate-trending','storefront-section','shopping','music','explore-page','trending-page'])assert.equal(p.hidden(id),true,`${id} must hide`);
  const late=p.doc.createElement('a');late.id='late-explore';late.className='yt-simple-endpoint';late.href='/feed/explore';p.doc.getElementById('mixed-section').append(late);
  assert.equal(p.hidden(late.id),true);
  assert.equal(p.hidden('history'),false,'Adding Explore must not hide neighboring links');
  for(const values of [{hideExploreTrending:false},{hideExploreTrending:true,enabled:false}]) {
    p.apply(values);
    for(const id of ['mixed-section','explore','trending','alternate-trending','storefront-section','shopping','music','explore-page','trending-page','late-explore'])assert.equal(p.hidden(id),false,'Disabling Explore hiding or Watchbox must restore the content');
  }
});
