import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

function homePage(html) {
  const dom=new JSDOM(`<ytd-app><ytd-page-manager>${html}</ytd-page-manager></ytd-app>`,{url:'https://www.youtube.com/',runScripts:'outside-only'});
  for(const file of ['preferences.js','page-settings.js'])dom.window.eval(readFileSync(file,'utf8'));
  for(const file of JSON.parse(readFileSync('manifest.json','utf8')).content_scripts.flatMap(script=>script.css||[])) {
    const style=dom.window.document.createElement('style');style.textContent=readFileSync(file,'utf8');dom.window.document.head.append(style);
  }
  return {dom,doc:dom.window.document,apply:dom.window.WatchboxPageSettings.apply,hidden:id=>dom.window.getComputedStyle(dom.window.document.getElementById(id)).display==='none'};
}

test('Hide Home Feed covers Home grids without a subtype while preserving other browse pages',t=>{
  const p=homePage(`
    <ytd-browse id="home" role="main">
      <ytd-feed-filter-chip-bar-renderer></ytd-feed-filter-chip-bar-renderer>
      <ytd-rich-grid-renderer id="home-grid"><div class="ytd-rich-grid-renderer" id="home-cards">Home</div></ytd-rich-grid-renderer>
    </ytd-browse>
    <ytd-browse role="main" page-subtype="subscriptions"><ytd-feed-filter-chip-bar-renderer></ytd-feed-filter-chip-bar-renderer><ytd-rich-grid-renderer id="subscriptions-grid">Subscriptions</ytd-rich-grid-renderer></ytd-browse>
    <ytd-browse role="main"><div id="header"><div id="page-header-container">Channel</div></div><ytd-feed-filter-chip-bar-renderer></ytd-feed-filter-chip-bar-renderer><ytd-rich-grid-renderer id="channel-grid">Channel</ytd-rich-grid-renderer></ytd-browse>
    <ytd-browse role="main" page-subtype="explore"><ytd-feed-filter-chip-bar-renderer></ytd-feed-filter-chip-bar-renderer><ytd-rich-grid-renderer id="explore-grid">Explore</ytd-rich-grid-renderer></ytd-browse>
    <ytd-browse role="main"><ytd-rich-grid-renderer id="unknown-grid">Unidentified browse page</ytd-rich-grid-renderer></ytd-browse>
    <ytd-search><ytd-rich-grid-renderer id="search-grid">Search</ytd-rich-grid-renderer></ytd-search>
  `);t.after(()=>p.dom.window.close());
  p.apply({hideHomeFeed:true});
  assert.equal(p.hidden('home-grid'),true,'The Home grid must hide even when YouTube omits page-subtype');
  assert.equal(p.hidden('home-cards'),true,'Class-based Home content must also hide');
  for(const id of ['subscriptions-grid','channel-grid','explore-grid','unknown-grid','search-grid'])assert.equal(p.hidden(id),false,`${id} must remain visible`);
  const late=p.doc.createElement('div');late.id='late-home-cards';late.className='ytd-rich-grid-renderer';p.doc.querySelector('#home').append(late);
  assert.equal(p.hidden(late.id),true,'CSS must cover Home content inserted after settings apply');
  for(const values of [{hideHomeFeed:false},{hideHomeFeed:true,enabled:false}]) {
    p.apply(values);
    for(const id of ['home-grid','home-cards','late-home-cards'])assert.equal(p.hidden(id),false,'Turning hiding or Watchbox off must restore Home');
  }
});

test('Hide Home Feed covers class-based content in an identified Home layout',t=>{
  const p=homePage('<ytd-browse page-subtype="home"><div class="ytd-rich-grid-renderer" id="home-content">Home</div></ytd-browse><ytd-browse page-subtype="subscriptions"><div class="ytd-rich-grid-renderer" id="subscriptions-content">Subscriptions</div></ytd-browse>');t.after(()=>p.dom.window.close());
  p.apply({hideHomeFeed:true});
  assert.equal(p.hidden('home-content'),true,'Home content must hide when only the renderer class is present');
  assert.equal(p.hidden('subscriptions-content'),false,'The same class on Subscriptions must stay visible');
  p.apply({hideHomeFeed:false});
  assert.equal(p.hidden('home-content'),false);
});

test('Hide Home Feed hides the Home loading skeleton reversibly',t=>{
  const p=homePage('<div id="home-page-skeleton">Home loading cards</div><div id="subscriptions-page-skeleton">Subscriptions loading cards</div><header id="masthead">Search</header>');t.after(()=>p.dom.window.close());
  p.apply({hideHomeFeed:true});
  assert.equal(p.hidden('home-page-skeleton'),true,'The Home placeholder must not flash while its feed is hidden');
  assert.equal(p.hidden('subscriptions-page-skeleton'),false,'Other loading placeholders must remain visible');
  assert.equal(p.hidden('masthead'),false,'Header hiding remains a separate setting');
  const replacement=p.doc.createElement('div');replacement.id='home-page-skeleton';replacement.textContent='Late Home placeholder';p.doc.querySelector('#home-page-skeleton').replaceWith(replacement);
  assert.equal(p.hidden(replacement.id),true,'Late loading placeholders must hide without page synchronization');
  for(const values of [{hideHomeFeed:false},{hideHomeFeed:true,enabled:false}]) {
    p.apply(values);assert.equal(p.hidden(replacement.id),false,'Turning hiding or Watchbox off must restore the placeholder');
  }
});
