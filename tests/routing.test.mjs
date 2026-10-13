import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';

const manifest=()=>JSON.parse(readFileSync('manifest.json','utf8'));
const redirectPreferences={hideHomeFeed:true,redirectToSubscriptions:true};

function background(initialPreferences=redirectPreferences,getPreferences) {
  let request,change,filter,reads=0;
  const updates=[];
  const context=vm.createContext({URL,browser:{
    action:{onClicked:{addListener(){}}},
    storage:{local:{get:async()=>{reads++;return getPreferences?getPreferences():{watchboxPreferences:initialPreferences};}},onChanged:{addListener:fn=>change=fn}},
    webRequest:{onBeforeRequest:{addListener:(fn,value)=>{request=fn;filter=value;}}},
    tabs:{update:async(tabId,value)=>{updates.push({tabId,...value});}},
    runtime:{openOptionsPage:async()=>{}}
  }});
  for(const file of manifest().background.scripts)vm.runInContext(readFileSync(file,'utf8'),context);
  return {updates,reads:()=>reads,request:()=>request,filter:()=>filter,changed:()=>change,change:(value,area='local')=>change(value,area)};
}

test('Home requests redirect to Inbox in the background before a content script can run',async()=>{
  const p=background();
  assert.equal(typeof p.request(),'function','An early Home request handler is missing');
  assert.ok(manifest().permissions.includes('webRequest'),'Home requests need the webRequest permission');
  for(const url of ['https://www.youtube.com/','https://www.youtube.com/?app=desktop','https://youtube.com/']) {
    await p.request()({url,tabId:7,type:'main_frame',frameId:0});
  }
  assert.deepEqual(p.updates,Array.from({length:3},()=>({tabId:7,url:'https://www.youtube.com/feed/subscriptions#watchbox-inbox'})));
  assert.equal(p.reads(),1,'Request handling must use cached preferences');
  assert.ok(p.filter().types.includes('main_frame'));
  assert.ok(p.filter().types.includes('xmlhttprequest'));
  assert.ok(p.filter().urls.every(url=>/^https:\/\/(www\.)?youtube\.com\//.test(url)),'Only the existing YouTube hosts may be observed');
});

test('background routing validates the destination and tab before navigating',async()=>{
  const p=background();
  for(const url of [
    'https://example.com/',
    'https://www.youtube.com.evil.test/',
    'http://www.youtube.com/',
    'https://m.youtube.com/',
    'https://www.youtube.com/watch?v=aircAruvnKk',
    'https://www.youtube.com/feed/subscriptions',
    'invalid URL'
  ])await p.request()({url,tabId:7,type:'main_frame',frameId:0});
  for(const tabId of [-1,undefined,NaN])await p.request()({url:'https://www.youtube.com/',tabId,type:'main_frame',frameId:0});
  assert.deepEqual(p.updates,[],'Only an HTTPS desktop YouTube Home request from a real tab may navigate');
});

test('background routing immediately follows local preference changes',async()=>{
  const p=background();
  const home=()=>p.request()({url:'https://www.youtube.com/',tabId:4,type:'main_frame',frameId:0});
  await home();
  assert.equal(typeof p.changed(),'function','The cached routing policy must follow settings changes');
  for(const preferences of [
    {...redirectPreferences,enabled:false},
    {...redirectPreferences,hideHomeFeed:false},
    {...redirectPreferences,redirectToSubscriptions:false},
    {...redirectPreferences,hideSubscriptions:true},
    undefined
  ]) {
    p.change({watchboxPreferences:{newValue:preferences}});
    await home();assert.equal(p.updates.length,1,'An inactive routing policy must leave Home alone');
  }
  p.change({watchboxPreferences:{newValue:redirectPreferences}},'sync');
  await home();assert.equal(p.updates.length,1,'Only local settings belong to Watchbox');
  p.change({watchboxPreferences:{newValue:redirectPreferences}});
  await home();assert.equal(p.updates.length,2,'Re-enabling redirection must take effect without restarting');
  p.change({watchbox:{newValue:{items:[]}}});
  await home();assert.equal(p.updates.length,3,'Library changes must not alter the routing preference');
  assert.equal(p.reads(),1,'Preference changes should update the cache without another storage read');
});

test('a setting changed during background startup wins over an older storage snapshot',async()=>{
  let finishRead;
  const snapshot=new Promise(resolve=>finishRead=resolve);
  const p=background(redirectPreferences,()=>snapshot);
  p.change({watchboxPreferences:{newValue:{...redirectPreferences,enabled:false}}});
  finishRead({watchboxPreferences:redirectPreferences});
  await p.request()({url:'https://www.youtube.com/',tabId:5,type:'main_frame',frameId:0});
  assert.deepEqual(p.updates,[],'An older startup read must not re-enable a disabled redirect');
});

test('background storage failure preserves Home until a later preference change',async()=>{
  const p=background(undefined,async()=>{throw Error('Storage unavailable');});
  const home=()=>p.request()({url:'https://www.youtube.com/',tabId:7});
  await assert.doesNotReject(home());
  assert.deepEqual(p.updates,[]);
  p.change({watchboxPreferences:{newValue:redirectPreferences}});
  await home();
  assert.equal(p.updates.length,1,'A later settings event must recover without restarting');
});

function page(html='<a id="logo" href="/"><span>YouTube</span></a>') {
  const dom=new JSDOM(html,{url:'https://www.youtube.com/watch?v=aircAruvnKk',runScripts:'outside-only'});
  for(const file of ['preferences.js','page-settings.js'])dom.window.eval(readFileSync(file,'utf8'));
  return {dom,doc:dom.window.document,apply:dom.window.WatchboxPageSettings.apply};
}

test('the YouTube logo goes directly to Inbox without invoking its Home handler',t=>{
  const p=page();t.after(()=>p.dom.window.close());
  const logo=p.doc.querySelector('#logo');
  let homeClicks=0;
  p.doc.addEventListener('click',()=>homeClicks++);
  p.doc.addEventListener('touchend',()=>homeClicks++);
  p.apply(redirectPreferences);
  assert.equal(logo.href,'https://www.youtube.com/feed/subscriptions#watchbox-inbox','The logo must point to the final destination before it is clicked');
  for(const type of ['click','touchend']) {
    const event=new p.dom.window.Event(type,{bubbles:true,cancelable:true});
    logo.firstElementChild.dispatchEvent(event);
    assert.equal(homeClicks,0,'YouTube must not navigate Home first');
    assert.equal(event.defaultPrevented,false,'Native link navigation must remain available');
  }
});

test('each rendered YouTube logo routes directly and restores its own destination',t=>{
  const p=page('<header><a id="logo" href="/">Desktop</a></header><aside><a id="logo" href="/?compact=1">Compact</a></aside>');
  t.after(()=>p.dom.window.close());
  const logos=[...p.doc.querySelectorAll('a#logo')];
  p.apply(redirectPreferences);
  for(const logo of logos)assert.equal(logo.href,'https://www.youtube.com/feed/subscriptions#watchbox-inbox');
  p.apply({...redirectPreferences,enabled:false});
  assert.deepEqual(logos.map(logo=>logo.getAttribute('href')),['/','/?compact=1']);
});

test('annotation controls appearing after preferences load follow the current setting',async t=>{
  const p=page('<div id="movie_player"></div>');
  t.after(()=>p.dom.window.close());
  p.apply({disableAnnotations:true});
  const option=p.doc.createElement('button');
  option.setAttribute('role','menuitemcheckbox');
  option.dataset.setting='annotations';
  option.setAttribute('aria-checked','true');
  let clicks=0;
  option.onclick=()=>{clicks++;option.setAttribute('aria-checked','false');};
  p.doc.querySelector('#movie_player').append(option);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(clicks,1,'A late native Annotations control must turn off without a navigation event');
  option.setAttribute('aria-checked','true');
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(clicks,2,'Re-enabling Annotations while the preference is active must turn it off again');
  p.apply({disableAnnotations:false});
  option.setAttribute('aria-checked','true');
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(clicks,2,'Disabling the preference must release the native control');
});

test('an inactive redirect setting restores the logo destination and native click handling',t=>{
  const p=page('<a id="logo" href="/?app=desktop">YouTube</a>');t.after(()=>p.dom.window.close());
  const logo=p.doc.querySelector('#logo');let homeClicks=0;
  p.doc.addEventListener('click',()=>homeClicks++);
  for(const values of [
    {...redirectPreferences,enabled:false},
    {...redirectPreferences,hideHomeFeed:false},
    {...redirectPreferences,redirectToSubscriptions:false},
    {...redirectPreferences,hideSubscriptions:true}
  ]) {
    p.apply(redirectPreferences);p.apply(values);
    assert.equal(logo.getAttribute('href'),'/?app=desktop','The original link must return when routing becomes inactive');
    const previous=homeClicks;
    logo.dispatchEvent(new p.dom.window.Event('click',{bubbles:true,cancelable:true}));
    assert.equal(homeClicks,previous+1,'YouTube must regain control of Home clicks');
  }
});

test('YouTube rewriting the logo href cannot undo an active redirect',async t=>{
  const p=page();t.after(()=>p.dom.window.close());
  const logo=p.doc.querySelector('#logo');
  p.apply(redirectPreferences);
  logo.setAttribute('href','/');
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(logo.href,'https://www.youtube.com/feed/subscriptions#watchbox-inbox','The logo destination must be repaired without waiting for page synchronization');
  p.apply({...redirectPreferences,redirectToSubscriptions:false});
  logo.setAttribute('href','/?native=1');
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(logo.getAttribute('href'),'/?native=1','Inactive routing must stop enforcing the destination');
});

test('routing preferences apply at document start before the page body exists',async t=>{
  const script=manifest().content_scripts.find(script=>script.run_at==='document_start');
  assert.ok(script,'Early routing must not wait for document_idle');
  const p=page();t.after(()=>p.dom.window.close());
  p.doc.body.remove();
  const reads=[];
  p.dom.window.browser={storage:{local:{get:async keys=>{reads.push(keys);return {watchboxPreferences:redirectPreferences};}},onChanged:{addListener(){}}}};
  for(const file of script.js)p.dom.window.eval(readFileSync(file,'utf8'));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(p.doc.body,null);
  assert.equal(p.doc.documentElement.hasAttribute('data-watchbox-hide-home-feed'),true,'Home hiding must apply before the heavy inbox code runs');
  assert.deepEqual(reads,['watchboxPreferences'],'Early routing must not wait for the library data');
  assert.equal(p.doc.querySelector('#watchbox-feed-tools'),null,'Inbox controls must still wait for the page body');
});

test('early routing handles logos created or replaced by YouTube navigation',async t=>{
  const p=page('');t.after(()=>p.dom.window.close());
  p.dom.window.browser={storage:{local:{get:async()=>({watchboxPreferences:redirectPreferences})},onChanged:{addListener(){}}}};
  for(const file of manifest().content_scripts[0].js)p.dom.window.eval(readFileSync(file,'utf8'));
  await new Promise(resolve=>setTimeout(resolve,0));
  p.doc.body.innerHTML='<a id="logo" href="/">YouTube</a>';
  p.dom.window.dispatchEvent(new p.dom.window.Event('load'));
  assert.equal(p.doc.querySelector('#logo').href,'https://www.youtube.com/feed/subscriptions#watchbox-inbox','The logo must be routed when it first appears');
  const oldLogo=p.doc.querySelector('#logo');
  oldLogo.replaceWith(Object.assign(p.doc.createElement('a'),{id:'logo',href:'/'}));
  p.doc.dispatchEvent(new p.dom.window.Event('yt-page-data-updated',{bubbles:true}));
  assert.equal(p.doc.querySelector('#logo').href,'https://www.youtube.com/feed/subscriptions#watchbox-inbox','YouTube page-data events must route replacement logos');
  assert.equal(oldLogo.getAttribute('href'),'/','Replaced logos must release their routing hooks');
});

test('early routing uses current settings when later YouTube events fire',async t=>{
  const p=page();t.after(()=>p.dom.window.close());let change;
  p.dom.window.browser={storage:{local:{get:async()=>({watchboxPreferences:redirectPreferences})},onChanged:{addListener:fn=>change=fn}}};
  for(const file of manifest().content_scripts[0].js)p.dom.window.eval(readFileSync(file,'utf8'));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(typeof change,'function','Early routing must follow settings without waiting for inbox startup');
  change({watchboxPreferences:{newValue:{...redirectPreferences,enabled:false}}},'local');
  p.doc.dispatchEvent(new p.dom.window.Event('yt-page-data-updated',{bubbles:true}));
  assert.equal(p.doc.querySelector('#logo').getAttribute('href'),'/','Page-data events must not re-enable an old routing policy');
  assert.equal(p.doc.documentElement.hasAttribute('data-watchbox-disabled'),true);
  change({watchboxPreferences:{newValue:redirectPreferences}},'sync');
  p.dom.window.dispatchEvent(new p.dom.window.Event('load'));
  assert.equal(p.doc.querySelector('#logo').getAttribute('href'),'/','Unrelated storage areas must not alter routing');
});

test('a setting changed during early startup wins over an older storage snapshot',async t=>{
  const p=page();t.after(()=>p.dom.window.close());let change,finishRead;
  const snapshot=new Promise(resolve=>finishRead=resolve);
  p.dom.window.browser={storage:{local:{get:()=>snapshot},onChanged:{addListener:fn=>change=fn}}};
  for(const file of manifest().content_scripts[0].js)p.dom.window.eval(readFileSync(file,'utf8'));
  change({watchboxPreferences:{newValue:{...redirectPreferences,enabled:false}}},'local');
  finishRead({watchboxPreferences:redirectPreferences});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(p.doc.querySelector('#logo').getAttribute('href'),'/','An older startup read must not restore the redirect');
  assert.equal(p.doc.documentElement.hasAttribute('data-watchbox-disabled'),true);
});

test('a failed early preference read leaves native content available and accepts later settings',async t=>{
  const p=page();t.after(()=>p.dom.window.close());let changed;
  p.dom.window.browser={storage:{
    local:{get:async()=>{throw Error('Storage unavailable');}},
    onChanged:{addListener:listener=>changed=listener}
  }};
  const startup=p.dom.window.eval(readFileSync('page-start.js','utf8'));
  await assert.doesNotReject(startup,'Startup failure must leave the page usable');
  assert.equal(p.doc.documentElement.hasAttribute('data-watchbox-hide-home-feed'),false);
  changed({watchboxPreferences:{newValue:redirectPreferences}},'local');
  assert.equal(p.doc.querySelector('#logo').href,'https://www.youtube.com/feed/subscriptions#watchbox-inbox');
});

test('the Home fallback redirects once per visit while navigation is still pending',t=>{
  const p=page();t.after(()=>p.dom.window.close());
  const destinations=[];
  const location={pathname:'/',replace:url=>destinations.push(url)};
  const context=vm.createContext({document:p.doc,location});
  for(const file of ['preferences.js','page-settings.js'])vm.runInContext(readFileSync(file,'utf8'),context);
  for(let i=0;i<3;i++)context.WatchboxPageSettings.apply(redirectPreferences);
  assert.deepEqual(destinations,['/feed/subscriptions#watchbox-inbox'],'Repeated settings or DOM updates must not restart a pending navigation');
  location.pathname='/feed/subscriptions';context.WatchboxPageSettings.apply(redirectPreferences);
  location.pathname='/';context.WatchboxPageSettings.apply(redirectPreferences);
  assert.deepEqual(destinations,['/feed/subscriptions#watchbox-inbox','/feed/subscriptions#watchbox-inbox'],'A later Home visit must still redirect');
});

test('SPA and Back navigation redirect Home immediately without the inbox debounce',async t=>{
  const p=page();t.after(()=>p.dom.window.close());const destinations=[];
  const location={pathname:'/watch',replace:url=>destinations.push(url)};
  const browser={storage:{local:{get:async()=>({watchboxPreferences:redirectPreferences})},onChanged:{addListener(){}}}};
  const context=vm.createContext({document:p.doc,window:p.dom.window,location,browser,MutationObserver:p.dom.window.MutationObserver});
  for(const file of manifest().content_scripts[0].js)vm.runInContext(readFileSync(file,'utf8'),context);
  await new Promise(resolve=>setTimeout(resolve,0));
  location.pathname='/';
  p.doc.dispatchEvent(new p.dom.window.Event('yt-navigate-finish',{bubbles:true}));
  assert.deepEqual(destinations,['/feed/subscriptions#watchbox-inbox'],'Routing must happen in the navigation event, before the 80 ms inbox debounce');
  location.pathname='/watch';p.doc.dispatchEvent(new p.dom.window.Event('yt-navigate-finish',{bubbles:true}));
  location.pathname='/';p.dom.window.dispatchEvent(new p.dom.window.Event('popstate'));
  assert.equal(destinations.length,2,'Back navigation to Home must also redirect immediately');
});

test('active Home redirection hides redundant Home entries without hiding the routed logo',t=>{
  const p=page('<a id="logo" class="yt-simple-endpoint" href="/">YouTube</a><a id="home" class="yt-simple-endpoint" href="/">Home</a><a id="index" class="yt-simple-endpoint" href="/index?app=desktop">Home</a><a id="subscriptions" class="yt-simple-endpoint" href="/feed/subscriptions">Subscriptions</a>');t.after(()=>p.dom.window.close());
  const style=p.doc.createElement('style');style.textContent=readFileSync('related.css','utf8');p.doc.head.append(style);
  const display=id=>p.dom.window.getComputedStyle(p.doc.getElementById(id)).display;
  p.apply(redirectPreferences);
  assert.equal(display('home'),'none','Active Inbox routing hides the redundant native Home entry');
  assert.equal(display('index'),'none');
  assert.notEqual(display('logo'),'none','The logo points to Inbox and must remain visible');
  assert.notEqual(display('subscriptions'),'none');
  for(const values of [{...redirectPreferences,redirectToSubscriptions:false},{...redirectPreferences,hideHomeFeed:false},{...redirectPreferences,enabled:false},{...redirectPreferences,hideSubscriptions:true}]) {
    p.apply(values);
    assert.notEqual(display('home'),'none','Inactive redirection must restore Home');
    assert.notEqual(display('index'),'none');
  }
});
