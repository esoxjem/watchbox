import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
function core() {
  const context = vm.createContext({ URL });
  if (existsSync('core.js')) vm.runInContext(readFileSync('core.js', 'utf8'), context);
  return context.WatchboxCore || {};
}
test('extension accepts YouTube video links and rejects other destinations', () => {
  const c = core();
  assert.equal(typeof c.videoId, 'function', 'YouTube link parser is missing');
  for (const url of ['https://www.youtube.com/watch?v=aircAruvnKk&t=3', 'https://youtu.be/aircAruvnKk', 'https://m.youtube.com/shorts/aircAruvnKk']) assert.equal(c.videoId(url), 'aircAruvnKk');
  for (const url of ['https://evil.test/watch?v=aircAruvnKk', 'javascript:alert(1)', 'https://youtube.com.evil.test/watch?v=aircAruvnKk', 'https://youtube.com/watch?v=bad', 'https://youtube.com/feed/subscriptions']) assert.equal(c.videoId(url), null);
});
test('collecting videos is bounded and repeat capture preserves library decisions and progress', () => {
  const c = core();
  assert.equal(typeof c.collect, 'function', 'Collection is missing');
  const existing = [{id:'aircAruvnKk',title:'Old title',status:'archive',watched:true,progress:120,addedAt:1}];
  const result = c.collect(existing, [{url:'https://youtu.be/aircAruvnKk',title:'Updated title',progress:0},{url:'https://youtu.be/h6fcK_fRYaI',title:'The Egg',channel:'Kurzgesagt'}, {url:'https://evil.test',title:'Bad'}], 42);
  assert.equal(result.added, 1);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].status, 'archive');
  assert.equal(result.items[0].watched, true);
  assert.equal(result.items[0].progress, 120);
  assert.equal(result.items[0].title, 'Updated title');
  assert.equal(result.items[1].status, 'inbox');
  assert.equal(result.items[1].addedAt, 42);
  assert.equal(c.collect([], Array.from({length:80}, (_,i)=>({url:`https://youtu.be/${String(i).padStart(11,'0')}`,title:'Video'}))).items.length, 60);
});
test('moving and marking watched are reversible without losing playback progress', () => {
  const c = core();
  assert.equal(typeof c.change, 'function', 'Library actions are missing');
  const original = {items:[{id:'aircAruvnKk',title:'Neural network',status:'inbox',watched:false,progress:120}],history:[]};
  const queued = c.change(original, 'aircAruvnKk', 'queue');
  assert.equal(queued.items[0].status, 'queue');
  assert.equal(original.items[0].status, 'inbox');
  const watched = c.change(queued, 'aircAruvnKk', 'watched');
  assert.equal(watched.items[0].watched, true);
  assert.equal(watched.items[0].status, 'archive');
  const undone = c.undo(watched);
  assert.equal(undone.items[0].watched, false);
  assert.equal(undone.items[0].status, 'queue');
  assert.equal(undone.items[0].progress, 120);
  assert.throws(()=>c.change(original,'missing','queue'));
  assert.throws(()=>c.change(original,'aircAruvnKk','bad'));
  assert.equal(c.undo(original), original);
});
test('Inbox age policy applies the chosen window to upload dates while retaining undated videos',()=>{
  const c=core(),now=Date.parse('2026-10-11T12:00:00Z'),day=86400000;
  assert.equal(typeof c.isPastInboxLimit,'function','Inbox needs a configurable age policy');
  for(const days of [1,7,14,30]) {
    assert.equal(c.isPastInboxLimit(now-days*day+1,days,now),false);
    assert.equal(c.isPastInboxLimit(now-days*day,days,now),true);
    assert.equal(c.isPastInboxLimit(now-(days+1)*day,days,now),true);
  }
  for(const date of [undefined,null,NaN])assert.equal(c.isPastInboxLimit(date,14,now),false);
  assert.equal(c.isPastInboxLimit(now+day,14,now),false);
});
function capture(html, url) {
  const dom = new JSDOM(html, {url,runScripts:'outside-only'});
  dom.window.eval(readFileSync('core.js','utf8'));
  if (existsSync('capture.js')) dom.window.eval(readFileSync('capture.js','utf8'));
  assert.equal(typeof dom.window.captureYouTubePage,'function','YouTube capture is missing');
  return {dom, capture:dom.window.captureYouTubePage};
}
test('capture reads loaded subscriptions, ignores Shorts, deduplicates and excludes unrelated links', () => {
  const {dom,capture:read} = capture(`<ytd-rich-item-renderer><a id="video-title-link" href="/watch?v=aircAruvnKk">Neural network</a><ytd-channel-name>3Blue1Brown</ytd-channel-name></ytd-rich-item-renderer><ytd-rich-item-renderer><a id="video-title" href="/watch?v=aircAruvnKk">Duplicate</a></ytd-rich-item-renderer><yt-lockup-view-model><a class="yt-lockup-metadata-view-model__title" href="/watch?v=h6fcK_fRYaI">The Egg</a><a href="/@kurzgesagt">Kurzgesagt</a></yt-lockup-view-model><ytd-rich-item-renderer><a id="video-title" href="/shorts/sI8NsYIyQ2A">Short</a></ytd-rich-item-renderer><a href="/watch?v=pnv5iKB2hl4">Unrelated</a>`, 'https://www.youtube.com/feed/subscriptions');
  assert.equal(read().videos.length, 2);
  assert.equal(read().videos[0].channel, '3Blue1Brown');
  assert.equal(read().videos[1].title, 'The Egg');
  dom.window.close();
});
test('saving a current video reads title, creator and timestamp without importing recommendations', () => {
  const {dom,capture:read} = capture(`<meta property="og:title" content="Neural network"><ytd-watch-metadata><h1>Neural network</h1></ytd-watch-metadata><ytd-video-owner-renderer><ytd-channel-name>3Blue1Brown</ytd-channel-name></ytd-video-owner-renderer><video></video><ytd-video-renderer><a id="video-title" href="/watch?v=h6fcK_fRYaI">Recommendation</a></ytd-video-renderer>`, 'https://www.youtube.com/watch?v=aircAruvnKk');
  dom.window.document.querySelector('video').currentTime = 123;
  assert.equal(read().kind, 'video');
  assert.equal(read().videos.length, 1);
  assert.equal(read().videos[0].title, 'Neural network');
  assert.equal(read().videos[0].progress, 123);
  assert.equal(read().videos[0].channel, '3Blue1Brown');
  dom.window.close();
});
test('capture rejects non-YouTube pages', () => {
  const {dom,capture:read} = capture('<h1>Other site</h1>', 'https://example.com');
  assert.throws(read, /Open a YouTube/);
  dom.window.close();
});
test('current video capture uses the creator link without hidden duplicate labels', () => {
  const {dom,capture:read} = capture('<ytd-video-owner-renderer><ytd-channel-name><a href="/@bookoverflow">BOOK OVERFLOW</a><span hidden> BOOK OVERFLOW</span></ytd-channel-name></ytd-video-owner-renderer>', 'https://www.youtube.com/watch?v=6loydpx4JkM');
  assert.equal(read().videos[0].channel, 'BOOK OVERFLOW');
  dom.window.close();
});
test('the release package identifies itself as Watchbox in the browser', () => {
  const manifest=JSON.parse(readFileSync('manifest.json','utf8'));
  assert.equal(manifest.name,'Watchbox');
  assert.equal(manifest.browser_specific_settings.gecko.id,'watchbox-prototype@local.watchbox','Renaming must retain the installed extension identity');
});
test('the browser icon uses the selected centered pause mark',t=>{
  const manifest=JSON.parse(readFileSync('manifest.json','utf8'));
  const icons=new Set([...Object.values(manifest.icons),...Object.values(manifest.action.default_icon)]);
  for(const file of icons) {
    const dom=new JSDOM(readFileSync(file,'utf8'),{contentType:'image/svg+xml'});t.after(()=>dom.window.close());
    const svg=dom.window.document.documentElement;
    const [left,top,width,height]=svg.getAttribute('viewBox').split(/\s+/).map(Number);
    assert.equal(width,height,'The icon must scale as a square');
    const bars=[...svg.querySelectorAll('g rect')];assert.equal(bars.length,2,'The selected icon needs two pause bars');
    const [a,b]=bars.map(bar=>Object.fromEntries(['x','y','width','height'].map(name=>[name,Number(bar.getAttribute(name))])));
    assert.equal(a.width,b.width);assert.equal(a.height,b.height);assert.equal(a.y,b.y);
    assert.ok(a.height>a.width && a.x+a.width<b.x,'Pause bars must be upright and separated');
    assert.equal(a.x-left,left+width-b.x-b.width,'The pause mark must be horizontally centered');
    assert.equal(a.y-top,top+height-a.y-a.height,'The pause mark must be vertically centered');
    assert.equal(svg.querySelector('script,image,use'),null,'The packaged icon must be self-contained');
  }
});
test('Firefox installation discloses authenticated YouTube requests and Watch Later activity', () => {
  const gecko=JSON.parse(readFileSync('manifest.json','utf8')).browser_specific_settings.gecko;
  assert.deepEqual(gecko.data_collection_permissions.required,
    ['authenticationInfo','websiteContent','websiteActivity'],
    'Consent must cover YouTube session authentication, page-derived request data and account saves');
  assert.ok(Number.parseInt(gecko.strict_min_version,10)>=140,'Require Firefox built-in data consent');
});
test('Firefox loads Watchbox automatically only on desktop YouTube', () => {
  const manifest=JSON.parse(readFileSync('manifest.json','utf8'));
  assert.equal(manifest.manifest_version,3);
  assert.deepEqual(manifest.permissions,['storage','webRequest']);
  assert.equal(manifest.action?.default_popup,undefined,'Toolbar click should open a full settings tab');
  assert.equal(manifest.commands,undefined);
  assert.deepEqual(manifest.host_permissions,['https://www.youtube.com/*','https://youtube.com/*']);
  assert.equal(manifest.content_scripts.length,2,'Routing starts early; inbox enhancements wait for the page');
  const script=manifest.content_scripts?.[0];
  assert.deepEqual(script?.matches,['https://www.youtube.com/*','https://youtube.com/*']);
  assert.deepEqual(script?.js,['preferences.js','page-settings.js','page-start.js']);
  assert.equal(script.run_at,'document_start');
  const inbox=manifest.content_scripts[1];
  assert.deepEqual(inbox.matches,script.matches);
  assert.deepEqual(inbox.js,['core.js','capture.js','watch-later.js','content.js']);
  assert.equal(inbox.run_at,'document_idle');
  assert.notEqual(inbox.all_frames,true);
  assert.deepEqual(script?.css,['content.css','related.css']);
  assert.notEqual(script?.all_frames,true);
  assert.equal(manifest.web_accessible_resources,undefined,'No embedded app resources should be exposed');
  for(const file of [...script.js,...script.css,...inbox.js]) assert.ok(existsSync(`${file}`));
});
test('capture supports the current YouTube camel-case lockup title markup observed in Zen', () => {
  const {dom,capture:read}=capture('<ytd-rich-item-renderer><yt-lockup-view-model><div class="ytLockupViewModelHost"><a class="ytLockupViewModelContentImage" href="/watch?v=6loydpx4JkM">1:03:13</a><h3><a class="ytLockupMetadataViewModelTitle" href="/watch?v=6loydpx4JkM"><span>The best career advice: get more sleep</span></a></h3><a class="ytAttributedStringLink" href="/@BookOverflowPod">Book Overflow</a></div></yt-lockup-view-model></ytd-rich-item-renderer>', 'https://www.youtube.com/feed/subscriptions');
  assert.equal(read().videos.length,1);
  assert.equal(read().videos[0].title,'The best career advice: get more sleep');
  assert.equal(read().videos[0].channel,'Book Overflow');
  dom.window.close();
});
test('the minimum Firefox version supports the declared data-collection manifest key', () => {
  const manifest=JSON.parse(readFileSync('manifest.json','utf8'));
  assert.ok(Number.parseInt(manifest.browser_specific_settings.gecko.strict_min_version,10)>=142);
});

async function youtube(html='',url='https://www.youtube.com/feed/subscriptions#watchbox-inbox',failure=false,initialPreferences,initialLibrary,fetchPage) {
  const dom=new JSDOM(`<ytd-app><header id="masthead">YouTube search</header><ytd-guide-renderer><div id="sections"><ytd-guide-section-renderer><div id="items"><a href="/">Home</a></div></ytd-guide-section-renderer></div></ytd-guide-renderer><ytd-mini-guide-renderer><div id="items"></div></ytd-mini-guide-renderer><ytd-page-manager><ytd-browse page-subtype="${url.includes("/feed/subscriptions")?"subscriptions":"home"}"><div id="primary"><ytd-rich-grid-renderer>${html}</ytd-rich-grid-renderer></div></ytd-browse></ytd-page-manager></ytd-app>`,{url,runScripts:'outside-only'});
  let saved=initialLibrary||{items:[],history:[]},preferences=initialPreferences;const listeners=[];
  if(fetchPage)dom.window.fetch=fetchPage;
  dom.window.browser={runtime:{getURL:path=>`https://extension.test/${path}`},storage:{local:{get:async()=>({watchbox:structuredClone(saved),watchboxPreferences:preferences}),set:async value=>{if(failure)throw Error('Disk full');if(value.watchbox){const old=saved;saved=structuredClone(value.watchbox);for(const listener of listeners)listener({watchbox:{oldValue:old,newValue:saved}},'local');}if(value.watchboxPreferences){const old=preferences;preferences=value.watchboxPreferences;for(const listener of listeners)listener({watchboxPreferences:{oldValue:old,newValue:preferences}},'local');}},},onChanged:{addListener:fn=>listeners.push(fn)}}};
  for(const file of JSON.parse(readFileSync('manifest.json','utf8')).content_scripts.flatMap(script=>script.js)) {
    assert.ok(existsSync(`${file}`),`${file} is missing`);
    dom.window.eval(readFileSync(`${file}`,'utf8'));
    if(file==='watch-later.js')dom.window.WatchboxWatchLater.save=async()=> 'confirmed';
  }
  await new Promise(resolve=>setTimeout(resolve,250));
  return {dom,doc:dom.window.document,root:dom.window.document.querySelector('#watchbox-surface')?.shadowRoot,saved:()=>saved,preferences:()=>preferences,setPreferences:value=>dom.window.browser.storage.local.set({watchboxPreferences:value}),setFailure:value=>{failure=value;}};
}
const feedCard='<ytd-rich-item-renderer><a id="video-title-link" href="/watch?v=aircAruvnKk">Neural network</a><ytd-channel-name>3Blue1Brown</ytd-channel-name></ytd-rich-item-renderer>';
const tick = () => new Promise(resolve=>setTimeout(resolve,30));
test('Watch Later autoplay reuses the native YouTube switch markup and tooltip contract',async t=>{
  const p=await youtube('<div id="movie_player"><div class="ytp-right-controls"></div></div>', 'https://www.youtube.com/watch?v=aircAruvnKk&list=WL');
  t.after(()=>p.dom.window.close());
  const toggle=p.doc.querySelector('#watchbox-watch-later-autoplay');
  assert.equal(toggle.className,'ytp-button ytp-autonav-toggle delhi-fast-follow-autonav-toggle');
  assert.equal(toggle.dataset.priority,'3');
  assert.equal(toggle.dataset.tooltipTargetId,'ytp-autonav-toggle-button');
  const track=toggle.querySelector('.ytp-autonav-toggle-button-container > .ytp-autonav-toggle-button');
  assert.ok(track,'Reuse YouTube CSS for the track, icon, thumb and size variants');
  assert.equal(toggle.querySelector('svg'),null,'Do not replace the native CSS icons with a custom SVG');
  assert.equal(track.getAttribute('aria-checked'),'true');
  assert.equal(toggle.dataset.tooltipTitle,'Autoplay is on');
  assert.equal(toggle.getAttribute('aria-label'),'Autoplay is on');
  toggle.click();await tick();
  assert.equal(track.getAttribute('aria-checked'),'false');
  assert.equal(toggle.dataset.tooltipTitle,'Autoplay is off');
  assert.equal(toggle.getAttribute('aria-label'),'Autoplay is off');
  toggle.dispatchEvent(new p.dom.window.MouseEvent('mouseenter'));
  const tooltip=p.doc.querySelector('#watchbox-autoplay-tooltip');
  assert.ok(tooltip,'Show a tooltip using YouTube styling');
  assert.equal(tooltip.className,'ytp-tooltip ytp-bottom');
  assert.equal(tooltip.getAttribute('aria-hidden'),'false','YouTube hides tooltips marked aria-hidden');
  assert.equal(tooltip.querySelector('.ytp-tooltip-text-wrapper .ytp-tooltip-bottom-text .ytp-tooltip-text').textContent,'Autoplay is off');
  toggle.dispatchEvent(new p.dom.window.MouseEvent('mouseleave'));
  assert.equal(tooltip.isConnected,false);
  toggle.focus();assert.equal(tooltip.isConnected,true,'Keyboard focus also reveals the tooltip');
  toggle.click();await tick();assert.equal(tooltip.querySelector('.ytp-tooltip-text').textContent,'Autoplay is on');
  p.dom.window.history.pushState({},'','/watch?v=aircAruvnKk');p.doc.dispatchEvent(new p.dom.window.Event('yt-navigate-finish'));
  await new Promise(resolve=>setTimeout(resolve,120));assert.equal(tooltip.isConnected,false,'Navigation removes the Watch Later tooltip');
});
test('Watch Later autoplay toggle persists its choice and stops automatic playlist advancement',async t=>{
  const p=await youtube('<div id="movie_player"><video></video><div class="ytp-right-controls"></div><button class="ytp-next-button">Next</button></div>', 'https://www.youtube.com/watch?v=aircAruvnKk&list=WL',false,{hideRelated:false});
  t.after(()=>p.dom.window.close());
  const toggle=p.doc.querySelector('#watchbox-watch-later-autoplay');
  assert.ok(toggle,'Watch Later needs an autoplay toggle in the player');
  assert.equal(toggle.parentElement.className,'ytp-right-controls');
  assert.equal(toggle.getAttribute('aria-checked'),'true','Keep existing playlist playback by default');
  toggle.click();await tick();
  assert.equal(p.preferences().watchLaterAutoplay,false);
  assert.equal(toggle.getAttribute('aria-checked'),'false');
  const video=p.doc.querySelector('video');let advances=0,nextClicks=0,updates=0;
  video.addEventListener('ended',()=>advances++);
  video.addEventListener('timeupdate',()=>updates++);
  p.doc.querySelector('.ytp-next-button').onclick=()=>nextClicks++;
  video.dispatchEvent(new p.dom.window.Event('timeupdate'));
  video.dispatchEvent(new p.dom.window.Event('ended'));
  assert.equal(updates,1,'Playback and progress events remain native');
  assert.equal(advances,0,'Do not let YouTube advance after completion');
  p.doc.querySelector('.ytp-next-button').click();assert.equal(nextClicks,1,'Manual Next still works');
  toggle.click();await tick();
  video.dispatchEvent(new p.dom.window.Event('ended'));assert.equal(advances,1,'Autoplay on restores native completion');
  await p.setPreferences({hideRelated:false,watchLaterAutoplay:false});
  for(const path of ['/watch?v=aircAruvnKk','/watch?v=aircAruvnKk&list=PLother','/playlist?list=WL']) {
    p.dom.window.history.pushState({},'',path);p.doc.dispatchEvent(new p.dom.window.Event('yt-navigate-finish'));
    await new Promise(resolve=>setTimeout(resolve,120));
    assert.equal(p.doc.querySelector('#watchbox-watch-later-autoplay'),null,'Only Watch Later playback gets a custom toggle');
    const before=advances;video.dispatchEvent(new p.dom.window.Event('ended'));assert.equal(advances,before+1,'Completion elsewhere remains native');
  }
  p.dom.window.history.pushState({},'','/watch?v=aircAruvnKk&list=WL');
  await p.setPreferences({enabled:false,watchLaterAutoplay:false});
  assert.equal(p.doc.querySelector('#watchbox-watch-later-autoplay'),null);
  const before=advances;video.dispatchEvent(new p.dom.window.Event('ended'));assert.equal(advances,before+1,'The master switch restores native playback');
});
test('Watch Later autoplay off allows ads to finish normally',async t=>{
  const p=await youtube('<div id="movie_player" class="ad-showing"><video></video><div class="ytp-right-controls"></div></div>', 'https://www.youtube.com/watch?v=aircAruvnKk&list=WL',false,{watchLaterAutoplay:false});
  t.after(()=>p.dom.window.close());
  let completions=0;const video=p.doc.querySelector('video');video.addEventListener('ended',()=>completions++);
  video.dispatchEvent(new p.dom.window.Event('ended'));
  assert.equal(completions,1,'An ad must finish so YouTube can resume the main video');
});
test('Watch Later autoplay off pauses YouTube itself before its independent completion timer advances',async t=>{
  const p=await youtube('<div id="movie_player"><video></video><button class="ytp-play-button">Pause</button><div class="ytp-right-controls"></div></div>', 'https://www.youtube.com/watch?v=aircAruvnKk&list=WL',false,{watchLaterAutoplay:false});
  t.after(()=>p.dom.window.close());
  const video=p.doc.querySelector('video');let pauses=0,nativePauses=0;
  Object.defineProperty(video,'duration',{value:100});Object.defineProperty(video,'paused',{get:()=>pauses>0});video.pause=()=>pauses++;
  p.doc.querySelector('.ytp-play-button').onclick=()=>{nativePauses++;video.pause();};
  video.currentTime=98;video.dispatchEvent(new p.dom.window.Event('timeupdate'));assert.equal(pauses,0);
  video.currentTime=99.8;video.dispatchEvent(new p.dom.window.Event('timeupdate'));assert.equal(pauses,1,'Pause before the player polls its ended state');
  assert.equal(nativePauses,1,'The native Pause action also stops YouTube’s playlist timer');
  video.dispatchEvent(new p.dom.window.Event('timeupdate'));assert.equal(pauses,1,'Do not repeatedly pause a stopped video');
  for(const [path,settings,ad] of [
    ['/watch?v=aircAruvnKk&list=WL',{watchLaterAutoplay:true},false],
    ['/watch?v=aircAruvnKk&list=WL',{watchLaterAutoplay:false},true],
    ['/watch?v=aircAruvnKk&list=PLother',{watchLaterAutoplay:false},false],
    ['/watch?v=aircAruvnKk',{watchLaterAutoplay:false},false],
    ['/watch?v=aircAruvnKk&list=WL',{enabled:false,watchLaterAutoplay:false},false]
  ]) {
    pauses=0;p.dom.window.history.pushState({},'',path);p.doc.querySelector('#movie_player').classList.toggle('ad-showing',ad);await p.setPreferences(settings);
    video.dispatchEvent(new p.dom.window.Event('timeupdate'));assert.equal(pauses,0,'Leave native playback alone outside Watch Later autoplay off');
  }
});
test('Watch Later autoplay recovers replaced controls and failed preference writes',async t=>{
  const p=await youtube('<div id="movie_player"><video></video><div class="ytp-right-controls"><button class="ytp-autonav-toggle-button" aria-checked="true">Native autoplay</button></div></div>', 'https://www.youtube.com/watch?v=aircAruvnKk&list=WL',false,{watchLaterAutoplay:false,hideComments:true});
  t.after(()=>p.dom.window.close());
  const toggle=p.doc.querySelector('#watchbox-watch-later-autoplay');
  assert.equal(toggle.getAttribute('aria-checked'),'false','Restore the saved choice on page load');
  p.setFailure(true);toggle.click();await tick();
  assert.equal(toggle.getAttribute('aria-checked'),'false');assert.equal(toggle.disabled,false);
  assert.match(p.doc.querySelector('#watchbox-toast-message').textContent,/Could not save autoplay/);
  p.setFailure(false);toggle.click();await tick();
  assert.equal(p.preferences().watchLaterAutoplay,true);assert.equal(p.preferences().hideComments,true);
  const native=p.doc.querySelector('.ytp-right-controls > .ytp-autonav-toggle-button');assert.equal(native.getAttribute('aria-checked'),'true');
  const replacement=p.doc.createElement('div');replacement.className='ytp-right-controls';
  toggle.parentElement.replaceWith(replacement);await new Promise(resolve=>setTimeout(resolve,120));
  assert.equal(replacement.querySelector('#watchbox-watch-later-autoplay'),toggle);
  assert.equal(p.doc.querySelectorAll('#watchbox-watch-later-autoplay').length,1);
});
const guideGroup=(label,path)=>`<ytd-guide-section-renderer><div id="items"><ytd-guide-collapsible-section-entry-renderer><div id="header"><ytd-guide-entry-renderer id="header-entry"><a href="${path}">${label}</a></ytd-guide-entry-renderer></div><div id="section-items"><ytd-guide-entry-renderer><a href="/@creator">Creator</a></ytd-guide-entry-renderer></div></ytd-guide-collapsible-section-entry-renderer></div></ytd-guide-section-renderer>`;
async function openAll(p) {
  p.dom.window.history.pushState({},'', '/feed/subscriptions');
  p.doc.dispatchEvent(new p.dom.window.Event('yt-navigate-finish'));
  await new Promise(resolve=>setTimeout(resolve,150));
}
async function returnLoadedVideos(p) {
  await openAll(p);
  for(const button of p.doc.querySelectorAll('ytd-rich-item-renderer [data-watchbox-action="inbox"]')) {button.click();await tick();}
  for(const card of p.doc.querySelectorAll('ytd-rich-item-renderer'))card.remove();
  await new Promise(resolve=>setTimeout(resolve,150));
  p.doc.querySelector('#watchbox-inbox').click();await tick();
}
test('library navigation lives at the top of expanded and compact sidebars without feed filters',async t=>{
  const p=await youtube(feedCard);t.after(()=>p.dom.window.close());pageCSS(p);
  assert.equal(p.doc.querySelector('#watchbox-feed-tools'),null,'The custom filter row must be removed');
  assert.equal(p.doc.querySelector('#watchbox-feed-row'),null);
  for(const selector of ['ytd-guide-renderer #sections','ytd-mini-guide-renderer #items']) {
    const nav=p.doc.querySelector(selector).firstElementChild;
    assert.equal(nav.getAttribute('aria-label'),'Watchbox');
    assert.deepEqual([...nav.querySelectorAll('a')].map(a=>a.textContent),['Inbox','Watch later']);
    assert.equal(nav.querySelector('.watchbox-nav-count'),null,'Inbox must have no count badge');
    assert.deepEqual([...nav.querySelectorAll('a')].map(a=>a.getAttribute('href')),['/feed/subscriptions#watchbox-inbox','/playlist?list=WL']);
    assert.equal(nav.querySelectorAll('svg').length,2,'Each row needs a sidebar icon');
    assert.equal(nav.querySelector('a').getAttribute('aria-current'),'page');
  }
  p.doc.querySelector('[data-watchbox-action="archive"]').click();await tick();
  assert.equal(p.doc.querySelector('#watchbox-sidebar a').textContent,'Inbox');
  assert.equal(p.doc.querySelector('#watchbox-archive'),null,'Archive is no longer a navigation destination');
  assert.equal(p.doc.querySelector('#watchbox-toast').parentElement,p.doc.body);
  assert.equal(p.dom.window.getComputedStyle(p.doc.querySelector('#watchbox-toast')).position,'fixed');
});
test('sidebar controls stay readable when YouTube switches themes without inherited color variables',async t=>{
  const p=await youtube(feedCard);t.after(()=>p.dom.window.close());
  p.doc.querySelector('ytd-guide-renderer #sections').insertAdjacentHTML('beforeend',guideGroup('Subscriptions','/feed/subscriptions')+guideGroup('You','/feed/you'));
  await new Promise(resolve=>setTimeout(resolve,150));pageCSS(p);
  const controls=[...p.doc.querySelectorAll('#watchbox-sidebar a,#watchbox-mini-sidebar a,.watchbox-section-toggle')];
  assert.equal(controls.length,6,'Cover both sidebar sizes and both native group disclosures');
  const heights=controls.map(control=>p.dom.window.getComputedStyle(control).height);
  // JSDOM leaves var() unresolved; resolve its fallback before comparing colors.
  const color=element=>{
    const style=p.dom.window.getComputedStyle(element),probe=p.doc.createElement('span');
    probe.style.color=style.color.replace(/var\((--[\w-]+),\s*([^)]+)\)/g,(_,name,fallback)=>style.getPropertyValue(name).trim()||fallback);
    p.doc.body.append(probe);
    const value=p.dom.window.getComputedStyle(probe).color;probe.remove();return value;
  };
  for(const dark of [true,false,true]) {
    p.doc.documentElement.toggleAttribute('dark',dark);
    for(const control of controls) {
      assert.equal(color(control),dark?'rgb(241, 241, 241)':'rgb(15, 15, 15)',`${control.textContent} must follow YouTube's theme`);
      for(const child of control.querySelectorAll('svg,span'))assert.equal(color(child),color(control),'Labels and icons must inherit the readable foreground');
    }
    assert.deepEqual(controls.map(control=>p.dom.window.getComputedStyle(control).height),heights,'Theme changes must preserve sidebar dimensions');
  }
});
test('Inbox caught-up copy and icon stay readable across YouTube theme changes without inherited variables',async t=>{
  const p=await youtube();t.after(()=>p.dom.window.close());pageCSS(p);
  const empty=p.doc.querySelector('#watchbox-inbox-empty');
  assert.equal(empty.hidden,false);
  const color=element=>{
    const style=p.dom.window.getComputedStyle(element),probe=p.doc.createElement('span');
    probe.style.color=style.color.replace(/var\((--[\w-]+),\s*([^)]+)\)/g,(_,name,fallback)=>style.getPropertyValue(name).trim()||fallback);
    p.doc.body.append(probe);
    const value=p.dom.window.getComputedStyle(probe).color;probe.remove();return value;
  };
  const padding=p.dom.window.getComputedStyle(empty).padding;
  for(const dark of [true,false,true]) {
    p.doc.documentElement.toggleAttribute('dark',dark);
    assert.equal(color(empty.querySelector('h2')),dark?'rgb(241, 241, 241)':'rgb(15, 15, 15)','Caught-up copy must follow YouTube’s theme');
    assert.equal(color(empty.querySelector('svg')),dark?'rgb(170, 170, 170)':'rgb(96, 96, 96)','The empty-state icon must follow YouTube’s theme');
    assert.equal(p.dom.window.getComputedStyle(empty).padding,padding,'Theme changes must preserve the empty-state layout');
    assert.equal(empty.textContent,'All caught up');
  }
});
test('retired Archive URLs show native Subscriptions without losing local decisions',async t=>{
  const library={items:[{id:'aircAruvnKk',title:'Dismissed',status:'archive',progress:125}],history:[]};
  const p=await youtube(feedCard,'https://www.youtube.com/feed/subscriptions#watchbox-archive',false,undefined,library);t.after(()=>p.dom.window.close());
  assert.equal(p.doc.querySelector('#watchbox-saved-shelf').hidden,true);
  assert.equal(p.doc.querySelector('ytd-rich-item-renderer').hasAttribute('data-watchbox-hidden'),false);
  assert.equal(p.doc.querySelector('#watchbox-archive'),null);
  assert.equal(p.saved().items[0].status,'archive');assert.equal(p.saved().items[0].progress,125);
  p.doc.querySelector('#watchbox-inbox').click();await tick();
  assert.equal(p.doc.querySelector('ytd-rich-item-renderer').hasAttribute('data-watchbox-hidden'),true);
  p.dom.window.history.back();await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(p.doc.querySelector('ytd-rich-item-renderer').hasAttribute('data-watchbox-hidden'),false);
  p.dom.window.history.forward();await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(p.doc.querySelector('ytd-rich-item-renderer').hasAttribute('data-watchbox-hidden'),true);
  p.dom.window.location.hash='';await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(p.doc.querySelector('ytd-rich-item-renderer').hasAttribute('data-watchbox-hidden'),false);
});

test('the tab title follows Inbox and Subscriptions navigation',async t=>{
  const p=await youtube('<title>Subscriptions - YouTube</title>'+feedCard);t.after(()=>p.dom.window.close());
  assert.equal(p.doc.title,'Inbox - YouTube');
  await openAll(p);
  assert.equal(p.doc.title,'Subscriptions - YouTube');
  p.doc.querySelector('#watchbox-inbox').click();await tick();
  assert.equal(p.doc.title,'Inbox - YouTube');
  p.dom.window.history.back();await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(p.doc.title,'Subscriptions - YouTube');
  p.dom.window.history.forward();await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(p.doc.title,'Inbox - YouTube');
  await p.setPreferences({enabled:false});await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(p.doc.title,'Subscriptions - YouTube');
  p.dom.window.history.pushState(null,'','/watch?v=aircAruvnKk');p.doc.title='Neural network - YouTube';
  p.doc.dispatchEvent(new p.dom.window.Event('yt-navigate-finish'));await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(p.doc.title,'Neural network - YouTube');
});
test('Inbox keeps its tab title when YouTube updates the document head',async t=>{
  const p=await youtube(feedCard);t.after(()=>p.dom.window.close());
  p.doc.title='Subscriptions - YouTube';
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(p.doc.title,'Inbox - YouTube','YouTube can set its title after Inbox loads');
  p.dom.window.history.pushState(null,'','/watch?v=aircAruvnKk');p.doc.title='Neural network - YouTube';
  p.doc.dispatchEvent(new p.dom.window.Event('yt-navigate-finish'));await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(p.doc.title,'Neural network - YouTube','Video titles belong to YouTube');
});
test('native Subscriptions shows all videos while Inbox keeps its decisions and cutoff',async t=>{
  const library={items:[{id:'aircAruvnKk',title:'Dismissed',status:'archive',progress:125},{id:'h6fcK_fRYaI',title:'Saved',status:'queue'}],history:[]};
  const cards=feedCard+feedCard.replaceAll('aircAruvnKk','h6fcK_fRYaI')+feedCard.replaceAll('aircAruvnKk','pnv5iKB2hl4')+feedCard.replaceAll('aircAruvnKk','sI8NsYIyQ2A').replace('</ytd-rich-item-renderer>','<span class="ytContentMetadataViewModelMetadataText">1 month ago</span></ytd-rich-item-renderer>');
  const p=await youtube(cards+'<ytd-continuation-item-renderer>Loading</ytd-continuation-item-renderer>','https://www.youtube.com/feed/subscriptions',false,undefined,library);t.after(()=>p.dom.window.close());pageCSS(p);
  p.doc.querySelector('ytd-guide-renderer #sections').insertAdjacentHTML('beforeend',guideGroup('Subscriptions','/feed/subscriptions'));
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(p.doc.querySelector('#watchbox-inbox').getAttribute('href'),'/feed/subscriptions#watchbox-inbox');
  assert.equal(p.doc.querySelector('#watchbox-inbox').getAttribute('aria-current'),null);
  const native=p.doc.querySelector('[data-watchbox-section=subscriptions] #header').querySelector('a');
  assert.equal(native.getAttribute('aria-current'),'page');
  for(const card of p.doc.querySelectorAll('ytd-rich-item-renderer'))assert.equal(card.hasAttribute('data-watchbox-hidden'),false,'All includes saved, dismissed and old videos');
  assert.equal(shown(p,'ytd-continuation-item-renderer'),true,'All has unrestricted pagination');
  assert.equal(p.doc.querySelector('#watchbox-inbox-empty').hidden,true);
  assert.equal(p.doc.querySelector('#watchbox-inbox').textContent,'Inbox','Inbox navigation must keep its label without a count');
  p.doc.querySelector('#watchbox-inbox').click();await tick();
  assert.equal(p.dom.window.location.hash,'#watchbox-inbox');
  assert.equal(p.doc.querySelector('#watchbox-inbox').getAttribute('aria-current'),'page');
  assert.equal(native.getAttribute('aria-current'),null);
  assert.deepEqual([...p.doc.querySelectorAll('ytd-rich-item-renderer')].map(card=>card.hasAttribute('data-watchbox-hidden')),[true,true,false,true]);
  assert.equal(shown(p,'ytd-continuation-item-renderer'),false);
  p.doc.querySelector('[data-watchbox-section=subscriptions] button').click();await tick();
  assert.equal(p.dom.window.location.hash,'#watchbox-inbox','The arrow must not switch views');
  native.click();await tick();
  assert.equal(p.dom.window.location.hash,'');
  assert.equal(p.doc.querySelector('[data-watchbox-section=subscriptions] button').getAttribute('aria-expanded'),'true','Navigation must preserve channel expansion');
  for(const card of p.doc.querySelectorAll('ytd-rich-item-renderer'))assert.equal(card.hasAttribute('data-watchbox-hidden'),false);
  p.dom.window.history.back();await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(p.dom.window.location.hash,'#watchbox-inbox');
  assert.equal(shown(p,'ytd-continuation-item-renderer'),false,'Back restores Inbox filtering');
  assert.equal(p.saved().items.find(item=>item.id==='aircAruvnKk').progress,125);
});
test('switching Inbox and Subscriptions bypasses native navigation without replacing the feed',async t=>{
  const library={items:[{id:'aircAruvnKk',title:'Neural network',status:'archive',progress:125}],history:[]};
  const p=await youtube(feedCard,undefined,false,undefined,library);t.after(()=>p.dom.window.close());
  const grid=p.doc.querySelector('ytd-rich-grid-renderer'),card=grid.firstElementChild;
  const template=p.doc.createElement('template');template.innerHTML=guideGroup('Subscriptions','/feed/subscriptions');
  const section=template.content.firstElementChild;
  const expanded=section.querySelector('a');expanded.innerHTML='<span>Subscriptions</span>';
  const mini=p.doc.createElement('ytd-mini-guide-entry-renderer');mini.innerHTML='<a href="/feed/subscriptions"><span>Subscriptions</span></a>';
  const compact=mini.querySelector('a');
  let nativeNavigations=0;
  // YouTube has already registered its handlers before Watchbox finds the links.
  for(const link of [expanded,compact])link.addEventListener('click',()=>nativeNavigations++);
  p.doc.querySelector('ytd-app').addEventListener('click',event=>{
    if(event.target.closest('a'))nativeNavigations++;
  },true);
  p.doc.querySelector('ytd-guide-renderer #sections').append(section);
  p.doc.querySelector('ytd-mini-guide-renderer #items').append(mini);
  await new Promise(resolve=>setTimeout(resolve,150));
  for(const [subscriptions,inbox] of [[expanded,p.doc.querySelector('#watchbox-inbox')],[compact,p.doc.querySelector('#watchbox-mini-sidebar [data-watchbox-nav=inbox]')]]) {
    subscriptions.querySelector('span').click();
    assert.equal(nativeNavigations,0,'Native handlers must not start a feed navigation');
    assert.equal(p.dom.window.location.hash,'');
    assert.equal(card.hasAttribute('data-watchbox-hidden'),false);
    inbox.querySelector('span').click();
    assert.equal(nativeNavigations,0,'Returning to Inbox must also bypass native navigation');
    assert.equal(p.dom.window.location.hash,'#watchbox-inbox');
    assert.equal(card.hasAttribute('data-watchbox-hidden'),true);
    assert.equal(p.doc.querySelector('ytd-rich-grid-renderer'),grid,'Switches must keep the loaded grid');
    assert.equal(grid.firstElementChild,card,'Switches must keep the loaded video card');
  }
  assert.equal(p.saved().items[0].progress,125);
});
test('Subscriptions uses native navigation when opened from another YouTube page',async t=>{
  const p=await youtube('','https://www.youtube.com/watch?v=aircAruvnKk');t.after(()=>p.dom.window.close());
  p.doc.querySelector('ytd-guide-renderer #sections').insertAdjacentHTML('beforeend',guideGroup('Subscriptions','/feed/subscriptions'));
  await new Promise(resolve=>setTimeout(resolve,150));
  const link=p.doc.querySelector('[data-watchbox-native-nav=subscriptions]');let nativeNavigations=0;
  link.addEventListener('click',event=>{
    event.preventDefault();nativeNavigations++;
    p.dom.window.history.pushState(null,'',link.href);
  });
  link.click();
  assert.equal(nativeNavigations,1,'Watchbox must leave navigation from another page to YouTube');
  assert.equal(p.dom.window.location.pathname,'/feed/subscriptions');
  assert.equal(p.dom.window.location.hash,'');
});
test('All subscriptions can return a dismissed older video to Inbox with Undo',async t=>{
  const state={items:[{id:'aircAruvnKk',title:'Old video',status:'archive',progress:125}],history:[]};
  const old=feedCard.replace('</ytd-rich-item-renderer>','<span class="ytContentMetadataViewModelMetadataText">1 month ago</span></ytd-rich-item-renderer>');
  const p=await youtube(old,'https://www.youtube.com/feed/subscriptions',false,undefined,state);t.after(()=>p.dom.window.close());
  const restore=p.doc.querySelector('ytd-rich-item-renderer [data-watchbox-action="inbox"]');
  assert.ok(restore,'A dismissed card in All needs a Move to inbox action');
  restore.click();await tick();
  assert.equal(p.saved().items[0].status,'inbox');
  assert.equal(p.doc.querySelector('#watchbox-inbox').textContent,'Inbox');
  p.doc.querySelector('#watchbox-inbox').click();await tick();
  assert.equal(p.doc.querySelector('.watchbox-saved-card h3').textContent,'Neural network');
  assert.match(p.doc.querySelector('.watchbox-saved-card a').href,/t=125s/);
  p.doc.querySelector('#watchbox-undo').click();await tick();
  assert.equal(p.saved().items[0].status,'archive');
  assert.equal(p.doc.querySelector('#watchbox-inbox').textContent,'Inbox');
});
test('Inbox clears stale native section highlights and restores them outside Inbox',async t=>{
  const p=await youtube('','https://www.youtube.com/feed/subscriptions');t.after(()=>p.dom.window.close());pageCSS(p);
  const nativeStyle=p.doc.createElement('style');nativeStyle.textContent='ytd-guide-entry-renderer[active]{background-color:rgb(230,230,230)}ytd-guide-entry-renderer[active] yt-formatted-string{font-weight:500}';p.doc.head.prepend(nativeStyle);
  for(const [label,path] of [['Subscriptions','/feed/subscriptions'],['You','/feed/you']]) {
    p.doc.querySelector('ytd-guide-renderer #sections').insertAdjacentHTML('beforeend',guideGroup(label,path).replace('id="header-entry"','id="header-entry" active').replace(`>${label}</a>`,`><yt-formatted-string>${label}</yt-formatted-string></a>`));
  }
  await new Promise(resolve=>setTimeout(resolve,150));
  const headers=p.doc.querySelectorAll('[data-watchbox-section] #header-entry');
  for(const header of headers)assert.equal(p.dom.window.getComputedStyle(header).backgroundColor,'rgb(230, 230, 230)');
  p.doc.querySelector('#watchbox-inbox').click();await tick();
  assert.equal(p.doc.querySelector('#watchbox-inbox').getAttribute('aria-current'),'page');
  for(const header of headers) {
    assert.equal(p.dom.window.getComputedStyle(header).backgroundColor,'rgba(0, 0, 0, 0)','Inbox must be the only highlighted top-level link');
    assert.equal(p.dom.window.getComputedStyle(header.querySelector('yt-formatted-string')).fontWeight,'500','Clearing the selection must preserve the native section heading weight');
    assert.equal(header.hasAttribute('active'),true,'Keep YouTube’s own selection state for restoration');
  }
  p.doc.querySelector('[data-watchbox-section=subscriptions] #header a').click();await tick();
  for(const header of headers)assert.equal(p.dom.window.getComputedStyle(header).backgroundColor,'rgb(230, 230, 230)');
  p.doc.querySelector('#watchbox-inbox').click();await tick();
  await p.setPreferences({enabled:false});
  for(const header of headers)assert.equal(p.dom.window.getComputedStyle(header).backgroundColor,'rgb(230, 230, 230)');
});
test('native Subscriptions and You groups start collapsed with accessible disclosure buttons',async t=>{
  const p=await youtube();t.after(()=>p.dom.window.close());pageCSS(p);
  p.doc.querySelector('ytd-guide-renderer #sections').insertAdjacentHTML('beforeend',guideGroup('Subscriptions','/feed/subscriptions')+guideGroup('You','/feed/you'));
  await new Promise(resolve=>setTimeout(resolve,150));
  const groups=p.doc.querySelectorAll('ytd-guide-collapsible-section-entry-renderer');
  for(const [index,label] of ['Subscriptions','You'].entries()) {
    const group=groups[index],button=group.querySelector('button');
    assert.ok(button,`${label} needs a disclosure button`);
    assert.equal(button.getAttribute('aria-expanded'),'false');
    assert.equal(button.getAttribute('aria-label'),`Expand ${label}`);
    assert.equal(button.textContent,'›','Only the arrow belongs in the collapse button');
    assert.equal(button.closest('a'),null,'The arrow must be a separate keyboard target');
    assert.notEqual(p.dom.window.getComputedStyle(group.querySelector('#header')).display,'none','Keep the native navigation link visible');
    assert.equal(group.querySelector('#header').querySelector('a').getAttribute('href'),index?'/feed/you':'/feed/subscriptions');
    assert.equal(p.dom.window.getComputedStyle(button).width,'40px');
    assert.equal(p.dom.window.getComputedStyle(button).top,'50%','Center the disclosure within the native header height');
    assert.equal(p.dom.window.getComputedStyle(button).transform,'translateY(-50%)','Keep the button centered in both disclosure states');
    assert.equal(shown(p,`[data-watchbox-section="${index?'you':'subscriptions'}"] #section-items`),false);
    const url=p.dom.window.location.href;button.click();await tick();
    assert.equal(button.getAttribute('aria-expanded'),'true');assert.equal(p.dom.window.location.href,url,'Expanding must not navigate');
    assert.equal(button.getAttribute('aria-label'),`Collapse ${label}`);
    assert.notEqual(p.dom.window.getComputedStyle(group.querySelector('#section-items')).display,'none');
    button.click();await tick();assert.equal(button.getAttribute('aria-expanded'),'false');
  }
});
test('native section labels match the Watchbox sidebar font size reversibly',async t=>{
  const p=await youtube();t.after(()=>p.dom.window.close());pageCSS(p);
  const nativeStyle=p.doc.createElement('style');nativeStyle.textContent='ytd-guide-collapsible-section-entry-renderer #header yt-formatted-string{font-size:16px}';p.doc.head.prepend(nativeStyle);
  for(const [label,path] of [['Subscriptions','/feed/subscriptions'],['You','/feed/you']]) {
    p.doc.querySelector('ytd-guide-renderer #sections').insertAdjacentHTML('beforeend',guideGroup(label,path).replace(`>${label}</a>`,`><yt-formatted-string>${label}</yt-formatted-string></a>`));
  }
  await new Promise(resolve=>setTimeout(resolve,150));
  const labels=p.doc.querySelectorAll('[data-watchbox-section] #header yt-formatted-string');
  assert.equal(labels.length,2);
  const fontSize=p.dom.window.getComputedStyle(p.doc.querySelector('#watchbox-sidebar a')).fontSize;
  for(const label of labels)assert.equal(p.dom.window.getComputedStyle(label).fontSize,fontSize);
  await p.setPreferences({enabled:false});
  for(const label of labels)assert.equal(p.dom.window.getComputedStyle(label).fontSize,'16px');
});
test('a native header chevron is replaced by one reversible collapse arrow',async t=>{
  const p=await youtube();t.after(()=>p.dom.window.close());pageCSS(p);
  const markup=guideGroup('Subscriptions','/feed/subscriptions').replace('>Subscriptions</a>','>Subscriptions<yt-icon class="arrow-icon">›</yt-icon></a>');
  p.doc.querySelector('ytd-guide-renderer #sections').insertAdjacentHTML('beforeend',markup);
  await new Promise(resolve=>setTimeout(resolve,150));
  const native=p.doc.querySelector('.arrow-icon');
  assert.equal(p.dom.window.getComputedStyle(native).display,'none','Keep only the independent arrow visible');
  assert.equal(p.doc.querySelectorAll('.watchbox-section-toggle').length,1);
  await p.setPreferences({enabled:false});
  assert.notEqual(p.dom.window.getComputedStyle(native).display,'none','Turning Watchbox off restores the native chevron');
});
test('the native You label keeps YouTube navigation when clicked from Subscriptions',async t=>{
  const p=await youtube();t.after(()=>p.dom.window.close());
  p.doc.querySelector('ytd-guide-renderer #sections').insertAdjacentHTML('beforeend',guideGroup('You','/feed/you'));
  await new Promise(resolve=>setTimeout(resolve,150));
  const link=p.doc.querySelector('[data-watchbox-section=you] #header').querySelector('a');
  let intercepted;
  link.addEventListener('click',event=>{intercepted=event.defaultPrevented;event.preventDefault();});
  const before=p.dom.window.location.href;link.click();
  assert.equal(intercepted,false,'Only Subscriptions view switches should intercept native navigation');
  assert.equal(p.dom.window.location.href,before,'Watchbox must not change the route without loading the You page');
});
test('manual section expansion survives navigation and replacement of the native guide',async t=>{
  const p=await youtube();t.after(()=>p.dom.window.close());pageCSS(p);
  const markup=guideGroup('Subscriptions','/feed/subscriptions')+guideGroup('You','/feed/you');
  const host=p.doc.querySelector('ytd-guide-renderer #sections');host.insertAdjacentHTML('beforeend',markup);
  await new Promise(resolve=>setTimeout(resolve,150));
  p.doc.querySelector('[data-watchbox-section=subscriptions] button').click();
  p.doc.dispatchEvent(new p.dom.window.Event('yt-navigate-finish'));await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(p.doc.querySelector('[data-watchbox-section=subscriptions] button').getAttribute('aria-expanded'),'true');
  const replacement=host.cloneNode(false);replacement.innerHTML=markup;host.replaceWith(replacement);
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(p.doc.querySelector('[data-watchbox-section=subscriptions] button').getAttribute('aria-expanded'),'true','Replacing the guide must preserve manual expansion');
  assert.equal(p.doc.querySelector('[data-watchbox-section=you] button').getAttribute('aria-expanded'),'false');
  assert.equal(replacement.firstElementChild.id,'watchbox-sidebar');
  assert.equal(p.doc.querySelectorAll('#watchbox-sidebar').length,1,'Replacement must not duplicate navigation');
  p.doc.querySelector('[data-watchbox-section=subscriptions] button').click();
  replacement.innerHTML=markup;await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(p.doc.querySelector('[data-watchbox-section=subscriptions] button').getAttribute('aria-expanded'),'false','Manual collapse must also survive replacement');
  await p.setPreferences({enabled:false});
  for(const group of p.doc.querySelectorAll('[data-watchbox-section]')) {
    assert.equal(p.dom.window.getComputedStyle(group.querySelector('button')).display,'none');
    assert.notEqual(p.dom.window.getComputedStyle(group.querySelector('#header')).display,'none');
    assert.notEqual(p.dom.window.getComputedStyle(group.querySelector('#section-items')).display,'none');
  }
  await p.setPreferences({enabled:true});
  assert.equal(shown(p,'[data-watchbox-section=subscriptions] #section-items'),false);
});
test('Subscriptions collapse also covers native channel entries beside the header wrapper',async t=>{
  const p=await youtube();t.after(()=>p.dom.window.close());pageCSS(p);
  const markup=guideGroup('Subscriptions','/feed/subscriptions').replace('</ytd-guide-collapsible-section-entry-renderer>','</ytd-guide-collapsible-section-entry-renderer><ytd-guide-entry-renderer id="subscription-channel"><a href="/@other">Other channel</a></ytd-guide-entry-renderer><ytd-guide-collapsible-entry-renderer id="more-channels">Show more</ytd-guide-collapsible-entry-renderer>');
  p.doc.querySelector('ytd-guide-renderer #sections').insertAdjacentHTML('beforeend',markup);
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(shown(p,'#subscription-channel'),false,'Channel siblings must collapse with the group');
  assert.equal(shown(p,'#more-channels'),false);
  p.doc.querySelector('[data-watchbox-section=subscriptions] button').click();await tick();
  assert.equal(shown(p,'#subscription-channel'),true);assert.equal(shown(p,'#more-channels'),true);
  p.doc.querySelector('[data-watchbox-section=subscriptions] button').click();
  await p.setPreferences({enabled:false});
  assert.equal(shown(p,'#subscription-channel'),true);assert.equal(shown(p,'#more-channels'),true);
});
test('sidebar links keep a fixed order after reversed insertion and guide replacement',async t=>{
  const p=await youtube();t.after(()=>p.dom.window.close());pageCSS(p);
  const reversed=guideGroup('You','/feed/you')+guideGroup('Subscriptions','/feed/subscriptions');
  let host=p.doc.querySelector('ytd-guide-renderer #sections');host.insertAdjacentHTML('afterbegin',reversed);
  const mini=p.doc.querySelector('ytd-mini-guide-renderer #items');
  mini.insertAdjacentHTML('afterbegin','<ytd-mini-guide-entry-renderer><a href="/feed/you">You</a></ytd-mini-guide-entry-renderer><ytd-mini-guide-entry-renderer><a href="/feed/subscriptions">Subscriptions</a></ytd-mini-guide-entry-renderer>');
  const labels=container=>[...container.children].filter(node=>p.dom.window.getComputedStyle(node).display!=='none').flatMap(node=>node.matches('nav')?[...node.querySelectorAll('.watchbox-nav-label')].map(label=>label.textContent):[node.querySelector('#header a, a')?.textContent]);
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.deepEqual(labels(host),['Inbox','Watch later','Subscriptions','You']);
  assert.deepEqual(labels(mini),['Inbox','Watch later','Subscriptions','You']);
  const replacement=host.cloneNode(false);replacement.innerHTML=reversed;host.replaceWith(replacement);host=replacement;
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.deepEqual(labels(host),['Inbox','Watch later','Subscriptions','You']);
  host.prepend(host.querySelector('[data-watchbox-section=you]').closest('ytd-guide-section-renderer'));
  p.doc.dispatchEvent(new p.dom.window.Event('yt-navigate-finish'));
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.deepEqual(labels(host),['Inbox','Watch later','Subscriptions','You']);
});
test('the left menu keeps only Watchbox links and native disclosure groups reversibly',async t=>{
  const p=await youtube();t.after(()=>p.dom.window.close());pageCSS(p);
  const sections=p.doc.querySelector('ytd-guide-renderer #sections');
  sections.querySelector('ytd-guide-section-renderer').id='other-navigation';
  sections.insertAdjacentHTML('beforeend',guideGroup('Subscriptions','/feed/subscriptions')+guideGroup('You','/feed/you')+'<ytd-guide-section-renderer id="other-explore"><div id="items"><a href="/feed/trending">Trending</a></div></ytd-guide-section-renderer><ytd-guide-section-renderer id="other-settings"><div id="items"><a href="/reporthistory">Report history</a></div></ytd-guide-section-renderer>');
  p.doc.querySelector('ytd-guide-renderer').insertAdjacentHTML('beforeend','<div id="footer">About · Terms</div>');
  p.doc.querySelector('ytd-mini-guide-renderer #items').insertAdjacentHTML('beforeend','<ytd-mini-guide-entry-renderer id="mini-you"><a href="/feed/you">You</a></ytd-mini-guide-entry-renderer><ytd-mini-guide-entry-renderer id="mini-shorts"><a href="/shorts">Shorts</a></ytd-mini-guide-entry-renderer>');
  await p.setPreferences({hideShorts:false});await new Promise(resolve=>setTimeout(resolve,150));
  for(const selector of ['#other-navigation','#other-explore','#other-settings','#footer','#mini-shorts'])assert.equal(shown(p,selector),false,`${selector} must hide`);
  for(const selector of ['#watchbox-sidebar','#watchbox-mini-sidebar','#mini-you',...['subscriptions','you'].map(key=>`[data-watchbox-section="${key}"]`)])assert.equal(shown(p,selector),true,`${selector} must remain available`);
  sections.insertAdjacentHTML('beforeend','<ytd-guide-section-renderer id="late-other"><a href="/premium">Premium</a></ytd-guide-section-renderer>');
  assert.equal(shown(p,'#late-other'),false,'Late native sections also stay hidden');
  await p.setPreferences({enabled:false});
  for(const selector of ['#other-navigation','#other-explore','#other-settings','#footer','#mini-shorts','#late-other'])assert.equal(shown(p,selector),true,`${selector} must restore when Watchbox is disabled`);
});
test('empty space below the persistent sidebar passes pointer input to the page',async t=>{
  const p=await youtube();t.after(()=>p.dom.window.close());pageCSS(p);
  const guide=p.doc.querySelector('ytd-guide-renderer'),drawer=p.doc.createElement('tp-yt-app-drawer');
  drawer.id='guide';drawer.setAttribute('persistent','');
  drawer.innerHTML='<div id="contentContainer"><div id="guide-wrapper"><div id="guide-content"><div id="guide-inner-content"></div></div></div></div>';
  guide.replaceWith(drawer);drawer.querySelector('#guide-inner-content').append(guide);
  const nativeStyle=p.doc.createElement('style');nativeStyle.textContent='#guide #contentContainer{pointer-events:auto}';p.doc.head.prepend(nativeStyle);
  const pointer=element=>p.dom.window.getComputedStyle(element).pointerEvents;
  for(const element of [drawer,...drawer.querySelectorAll('#contentContainer,#guide-wrapper,#guide-content,#guide-inner-content')])assert.equal(pointer(element),'none','Empty drawer layers must let wheel input reach the page');
  assert.equal(pointer(guide),'auto','The populated guide must retain its own scrolling');
  assert.equal(pointer(guide.querySelector('#watchbox-inbox')),'auto','Navigation links must remain clickable');
  await p.setPreferences({enabled:false});
  for(const element of [drawer,...drawer.querySelectorAll('div')])assert.equal(pointer(element),'auto','Disabling Watchbox restores native hit testing');
  await p.setPreferences({enabled:true});drawer.removeAttribute('persistent');
  assert.equal(pointer(drawer),'auto','Temporary overlay drawers must keep their native backdrop behavior');
  assert.equal(pointer(drawer.querySelector('#contentContainer')),'auto');
});
test('compact navigation retains the native Subscriptions shortcut alongside Inbox',async t=>{
  const p=await youtube();t.after(()=>p.dom.window.close());pageCSS(p);
  p.doc.querySelector('ytd-mini-guide-renderer #items').insertAdjacentHTML('beforeend','<ytd-mini-guide-entry-renderer id="native-mini-subscriptions"><a href="/feed/subscriptions">Subscriptions</a></ytd-mini-guide-entry-renderer><ytd-mini-guide-entry-renderer id="native-mini-home"><a href="/">Home</a></ytd-mini-guide-entry-renderer>');
  assert.equal(shown(p,'#native-mini-subscriptions'),true,'The full feed remains accessible alongside Inbox');
  assert.equal(shown(p,'#native-mini-home'),false,'Only the requested compact shortcuts stay available');
  assert.equal(shown(p,'#watchbox-mini-sidebar'),true);
  await p.setPreferences({enabled:false});
  assert.equal(shown(p,'#native-mini-subscriptions'),true);assert.equal(shown(p,'#watchbox-mini-sidebar'),false);
});
test('an empty native navigation section leaves no extra divider beneath Watch later',async t=>{
  const p=await youtube();t.after(()=>p.dom.window.close());pageCSS(p);
  const section=p.doc.querySelector('ytd-guide-section-renderer');section.id='native-navigation';
  section.innerHTML='<div id="items"><ytd-guide-entry-renderer><a class="yt-simple-endpoint" href="/">Home</a></ytd-guide-entry-renderer><ytd-guide-entry-renderer><a class="yt-simple-endpoint" title="Shorts">Shorts</a></ytd-guide-entry-renderer></div>';
  await p.setPreferences({hideHomeFeed:true,redirectToSubscriptions:true,hideShorts:true});
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(shown(p,'#native-navigation'),false,'Hidden Home and Shorts must not leave an empty section and divider');
  await p.setPreferences({hideShorts:false,hideHomeFeed:true,redirectToSubscriptions:true});await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(shown(p,'#native-navigation'),false,'The simplified menu hides other shortcuts regardless of their individual settings');
  await p.setPreferences({enabled:false});
  assert.equal(shown(p,'#native-navigation'),true);
});
test('custom navigation uses the same section padding as the native disclosure sections',async t=>{
  const p=await youtube();t.after(()=>p.dom.window.close());pageCSS(p);
  const nativeStyle=p.doc.createElement('style');nativeStyle.textContent='ytd-guide-section-renderer{display:block;padding:12px;border-bottom:1px solid #ddd}';p.doc.head.prepend(nativeStyle);
  const sectionStyle=p.dom.window.getComputedStyle(p.doc.querySelector('ytd-guide-section-renderer'));
  const navStyle=p.dom.window.getComputedStyle(p.doc.querySelector('#watchbox-sidebar'));
  for(const side of ['Top','Right','Bottom','Left'])assert.equal(navStyle[`padding${side}`],sectionStyle[`padding${side}`],`The ${side} inset must match native sections`);
  assert.equal(navStyle.marginBottom,'0px','The menu must not add a second gap before the next section');
});
test('feed Save hides the inbox card immediately while native confirmation is pending',async t=>{
  const p=await youtube(feedCard);t.after(()=>p.dom.window.close());let finish,saves=0;
  p.dom.window.WatchboxWatchLater={save:async(id,{card})=>{saves++;assert.equal(id,'aircAruvnKk');assert.equal(card,p.doc.querySelector('ytd-rich-item-renderer'));await new Promise(resolve=>{finish=resolve;});return 'confirmed';}};
  const button=p.doc.querySelector('[data-watchbox-action="queue"]');button.click();
  assert.equal(p.doc.querySelector('ytd-rich-item-renderer').hasAttribute('data-watchbox-hidden'),true,'Save must remove the card in the click handler');
  assert.equal(p.doc.querySelector('#watchbox-inbox-empty').hidden,false,'Pending saves count as handled for the caught-up state');
  assert.equal(p.doc.querySelector('#watchbox-toast-message').textContent,'Saving to Watch later…');
  await tick();
  assert.equal(saves,1,'Feed Save must use the native adapter');
  assert.equal(button.disabled,true);assert.equal(p.saved().items[0].status,'inbox');
  finish();await tick();
  assert.equal(p.saved().items[0].status,'queue');assert.equal(p.saved().items[0].watchLater,true);
  assert.equal(p.doc.querySelector('ytd-rich-item-renderer').hasAttribute('data-watchbox-hidden'),true);
  assert.equal(p.doc.querySelector('#watchbox-toast-message').textContent,'Saved to Watch later.');
  assert.equal(p.doc.querySelector('#watchbox-undo').hidden,true,'Saving to Watch later must not offer Undo');
});
test('watch-page Save uses native confirmation and retains the captured resume position',async t=>{
  const p=await youtube('<ytd-watch-metadata><h1>Neural network</h1></ytd-watch-metadata><video></video>','https://www.youtube.com/watch?v=aircAruvnKk');t.after(()=>p.dom.window.close());let native=0;
  p.doc.querySelector('video').currentTime=123;
  p.dom.window.WatchboxWatchLater.save=async(id,options)=>{native++;assert.equal(id,'aircAruvnKk');assert.equal(options.card,undefined);return 'confirmed';};
  p.doc.querySelector('#watchbox-queue').click();await tick();
  assert.equal(native,1,'Watch-page Save must use YouTube');
  assert.equal(p.saved().items[0].watchLater,true);assert.equal(p.saved().items[0].progress,123);
});
test('failed confirmation restores the optimistic card and allows retry without changing stored data',async t=>{
  const p=await youtube(feedCard);t.after(()=>p.dom.window.close());let fail;
  const before=structuredClone(p.saved());
  p.dom.window.WatchboxWatchLater.save=()=>new Promise((resolve,reject)=>{fail=reject;});
  const card=p.doc.querySelector('ytd-rich-item-renderer'),button=card.querySelector('[data-watchbox-action="queue"]');
  button.click();assert.equal(card.hasAttribute('data-watchbox-hidden'),true);
  await new Promise(resolve=>setTimeout(resolve,180));
  assert.equal(card.hasAttribute('data-watchbox-hidden'),true,'Background collection must retain the pending hide');
  fail(Error('Could not confirm the save to YouTube. Try again.'));await tick();
  assert.equal(card.hasAttribute('data-watchbox-hidden'),false);
  assert.equal(p.doc.querySelector('#watchbox-inbox-empty').hidden,true);
  assert.equal(button.disabled,false);
  assert.deepEqual(p.saved(),before,'Failure must preserve metadata, decisions and Undo history');
  assert.match(p.doc.querySelector('#watchbox-toast-message').textContent,/Could not confirm/);
  p.dom.window.WatchboxWatchLater.save=async()=> 'confirmed';button.click();await tick();
  assert.equal(card.hasAttribute('data-watchbox-hidden'),true);
  assert.equal(p.saved().items[0].watchLater,true);
});
test('replacing a pending video card does not submit the same save twice',async t=>{
  const p=await youtube(feedCard);t.after(()=>p.dom.window.close());let finish,saves=0;
  p.dom.window.WatchboxWatchLater.save=()=>{saves++;return new Promise(resolve=>{finish=resolve;});};
  p.doc.querySelector('[data-watchbox-action="queue"]').click();
  p.doc.querySelector('ytd-rich-grid-renderer').innerHTML=feedCard;
  await new Promise(resolve=>setTimeout(resolve,180));
  const replacement=p.doc.querySelector('ytd-rich-item-renderer');
  replacement.querySelector('[data-watchbox-action="queue"]').click();
  assert.equal(saves,1,'A replacement card must share the pending save for its video');
  finish('confirmed');await tick();
});
test('native feed submissions complete after optimistic hiding with independent confirmation recovery',async t=>{
  const other=feedCard.replaceAll('aircAruvnKk','h6fcK_fRYaI');
  const p=await youtube(feedCard+other);t.after(()=>p.dom.window.close());
  p.dom.window.eval(readFileSync('watch-later.js','utf8'));
  const confirmations=new Map(),submitted=[];
  p.dom.window.WatchboxWatchLater.confirm=id=>new Promise((resolve,reject)=>confirmations.set(id,{resolve,reject}));
  const cards=[...p.doc.querySelectorAll('ytd-rich-item-renderer')];
  for(const card of cards) {
    const opener=p.doc.createElement('button');opener.setAttribute('aria-label','More actions');card.append(opener);
    opener.onclick=()=>p.dom.window.setTimeout(()=>{
      const menu=p.doc.createElement('yt-list-view-model');menu.setAttribute('role','menu');
      menu.innerHTML='<button role="menuitem">Save to Watch later</button>';
      menu.firstChild.onclick=()=>{submitted.push(card.dataset.watchboxId);menu.remove();};p.doc.body.append(menu);
    },0);
  }
  cards[0].querySelector('[data-watchbox-action="queue"]').click();await tick();
  cards[1].querySelector('[data-watchbox-action="queue"]').click();await tick();
  assert.deepEqual(submitted,['aircAruvnKk','h6fcK_fRYaI'],'Hidden cards must still submit through native menus');
  for(const card of cards)assert.equal(card.hasAttribute('data-watchbox-hidden'),true);
  confirmations.get('h6fcK_fRYaI').resolve('confirmed');await tick();
  confirmations.get('aircAruvnKk').reject(Error('Could not confirm the save to YouTube. Try again.'));await tick();
  assert.equal(cards[0].hasAttribute('data-watchbox-hidden'),false);
  assert.equal(cards[1].hasAttribute('data-watchbox-hidden'),true);
  assert.deepEqual(p.saved().items.map(item=>item.status),['inbox','queue']);
  assert.equal(p.saved().items[0].watchLater,undefined);
  assert.equal(p.saved().items[1].watchLater,true);
});
test('delayed native confirmation preserves a newer Archive decision',async t=>{
  const p=await youtube(feedCard);t.after(()=>p.dom.window.close());let finish;
  p.dom.window.WatchboxWatchLater.save=()=>new Promise(resolve=>{finish=resolve;});
  p.doc.querySelector('[data-watchbox-action="queue"]').click();await tick();
  p.doc.querySelector('[data-watchbox-action="archive"]').click();await tick();
  finish('confirmed');await tick();
  assert.equal(p.saved().items[0].status,'archive','Late confirmation must not overwrite a later user decision');
  assert.equal(p.saved().items[0].watchLater,true);assert.equal(p.saved().history.length,1);
});
test('a save confirmed after visiting Watch later stays saved when returning to Inbox',async t=>{
  const p=await youtube(feedCard);t.after(()=>p.dom.window.close());let finish;
  p.dom.window.WatchboxWatchLater.save=()=>new Promise(resolve=>{finish=resolve;});
  p.doc.querySelector('[data-watchbox-action="queue"]').click();
  p.dom.window.history.pushState({},'', '/playlist?list=WL');
  p.doc.dispatchEvent(new p.dom.window.Event('yt-navigate-finish'));
  await new Promise(resolve=>setTimeout(resolve,150));
  finish('confirmed');await tick();
  assert.equal(p.saved().items[0].status,'queue','Navigation must not discard exact account confirmation');
  assert.equal(p.saved().items[0].watchLater,true);
  p.dom.window.history.pushState({},'', '/feed/subscriptions#watchbox-inbox');
  p.doc.dispatchEvent(new p.dom.window.Event('yt-navigate-finish'));
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(p.doc.querySelector('ytd-rich-item-renderer').hasAttribute('data-watchbox-hidden'),true);
  const refreshed=await youtube(feedCard,undefined,false,undefined,structuredClone(p.saved()));t.after(()=>refreshed.dom.window.close());
  assert.equal(refreshed.doc.querySelector('ytd-rich-item-renderer').hasAttribute('data-watchbox-hidden'),true,'Refresh must agree with the previous Inbox');
});
test('returning from Watch later updates recycled card identities when YouTube changes their links',async t=>{
  const library={items:[{id:'aircAruvnKk',title:'Neural network',status:'queue',watchLater:true}],history:[]};
  const p=await youtube(feedCard,'https://www.youtube.com/playlist?list=WL',false,undefined,library);t.after(()=>p.dom.window.close());
  p.dom.window.history.pushState({},'', '/feed/subscriptions#watchbox-inbox');
  p.doc.dispatchEvent(new p.dom.window.Event('yt-navigate-finish'));
  await new Promise(resolve=>setTimeout(resolve,500));
  const card=p.doc.querySelector('ytd-rich-item-renderer'),link=card.querySelector('a');
  assert.equal(card.hasAttribute('data-watchbox-hidden'),true,'The old saved video should be hidden');
  link.href='/watch?v=h6fcK_fRYaI';link.firstChild.data='New inbox video';
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(card.dataset.watchboxId,'h6fcK_fRYaI','Attribute updates must refresh the native card identity');
  assert.equal(card.hasAttribute('data-watchbox-hidden'),false,'The new video must not inherit the old saved video hide');
  assert.equal(p.saved().items.find(item=>item.id==='aircAruvnKk').status,'queue');
  assert.equal(p.saved().items.find(item=>item.id==='h6fcK_fRYaI').status,'inbox');
});
test('entering Inbox rescans native cards even without a YouTube navigation or observed DOM change',async t=>{
  const p=await youtube(feedCard,'https://www.youtube.com/feed/subscriptions');t.after(()=>p.dom.window.close());
  p.doc.querySelector('ytd-rich-item-renderer a').firstChild.data='Updated subscription title';
  p.doc.querySelector('#watchbox-inbox').click();
  await new Promise(resolve=>setTimeout(resolve,200));
  assert.equal(p.saved().items[0].title,'Updated subscription title','Entering Inbox must read the current native cards');
  assert.equal(p.doc.querySelector('#watchbox-inbox').getAttribute('aria-current'),'page');
});
test('Inbox rescans a recycled card after an in-flight metadata write instead of declaring caught up',async t=>{
  const library={items:[{id:'aircAruvnKk',title:'Neural network',channel:'3Blue1Brown',status:'archive'}],history:[]};
  const p=await youtube(feedCard,'https://www.youtube.com/feed/subscriptions',false,undefined,library);t.after(()=>p.dom.window.close());
  const card=p.doc.querySelector('ytd-rich-item-renderer'),link=card.querySelector('a');
  const originalSet=p.dom.window.browser.storage.local.set;
  let release,started;
  const writing=new Promise(resolve=>started=resolve);
  p.dom.window.browser.storage.local.set=async value=>{
    if(!release)await new Promise(resolve=>{release=resolve;started();});
    return originalSet(value);
  };
  link.textContent='Updated original title';await writing;
  link.href='/watch?v=h6fcK_fRYaI';link.textContent='New subscription';
  p.doc.querySelector('#watchbox-inbox').click();
  await new Promise(resolve=>setTimeout(resolve,150));
  release();await new Promise(resolve=>setTimeout(resolve,250));
  assert.equal(card.dataset.watchboxId,'h6fcK_fRYaI','A scan requested during persistence must run after it finishes');
  assert.equal(card.hasAttribute('data-watchbox-hidden'),false,'A new video must not inherit the dismissed video’s hide');
  assert.equal(p.doc.querySelector('#watchbox-inbox-empty').hidden,true,'A visible new video must replace the caught-up state');
  assert.equal(p.saved().items.find(item=>item.id==='aircAruvnKk').status,'archive','The old dismissal must be retained');
  assert.equal(p.saved().items.find(item=>item.id==='h6fcK_fRYaI').status,'inbox');
});
test('a newer Move to inbox decision becomes visible while save confirmation is pending',async t=>{
  const library={items:[{id:'aircAruvnKk',title:'Neural network',status:'archive',progress:123}],history:[]};
  const p=await youtube(feedCard,'https://www.youtube.com/feed/subscriptions',false,undefined,library);t.after(()=>p.dom.window.close());let fail;
  p.dom.window.WatchboxWatchLater.save=()=>new Promise((resolve,reject)=>{fail=reject;});
  const card=p.doc.querySelector('ytd-rich-item-renderer');
  card.querySelector('[data-watchbox-action="queue"]').click();
  card.querySelector('[data-watchbox-action="inbox"]').click();await tick();
  p.doc.querySelector('#watchbox-inbox').click();
  assert.equal(card.hasAttribute('data-watchbox-hidden'),false,'A newer inbox decision supersedes the pending hide');
  const before=structuredClone(p.saved());
  fail(Error('Could not confirm the save to YouTube. Try again.'));await tick();
  assert.deepEqual(p.saved(),before,'Rollback must retain the newer decision and Undo history');
});
test('a confirmed YouTube save with a failed inbox write offers recovery without hiding the card',async t=>{
  const p=await youtube(feedCard);t.after(()=>p.dom.window.close());p.setFailure(true);
  p.doc.querySelector('[data-watchbox-action="queue"]').click();await tick();
  assert.equal(p.saved().items[0].status,'inbox');
  assert.equal(p.doc.querySelector('ytd-rich-item-renderer').hasAttribute('data-watchbox-hidden'),false);
  assert.equal(p.doc.querySelector('#watchbox-toast-message').textContent,'Saved to Watch later, but could not update the inbox. Try again.');
});
test('Watch Later preserves existing local data without exposing retired migration controls',async t=>{
  const legacy={items:[{id:'aircAruvnKk',title:'Legacy save',status:'queue',progress:123},{id:'h6fcK_fRYaI',title:'Confirmed save',status:'queue',watchLater:true}],history:[]};
  const p=await youtube('',undefined,false,undefined,legacy);t.after(()=>p.dom.window.close());
  const saved=p.doc.querySelector('#watchbox-saved');
  assert.equal(saved.tagName,'A','Saved must open the native playlist');assert.equal(saved.href,'https://www.youtube.com/playlist?list=WL');
  assert.equal(saved.textContent,'Watch later','Do not show a local count as the account playlist count');
  assert.equal(p.doc.querySelector('#watchbox-local-saves'),null);
  assert.equal(p.doc.querySelector('[data-watchbox-migrate]'),null);
  assert.deepEqual(p.saved(),legacy,'Retiring migration must retain local decisions and resume positions');
  const watch=await youtube('<ytd-watch-metadata><h1>Legacy save</h1></ytd-watch-metadata><video></video>','https://www.youtube.com/watch?v=aircAruvnKk&watchbox-migrate=1',false,undefined,legacy);t.after(()=>watch.dom.window.close());
  assert.equal(watch.doc.querySelector('#watchbox-migrate-next'),null,'Old migration URLs must show ordinary watch controls');
  watch.doc.querySelector('#watchbox-queue').click();await tick();
  assert.equal(watch.saved().items[0].watchLater,true);assert.equal(watch.saved().items[0].progress,123);
});
test('returned Inbox cards open the video for a native save',async t=>{
  const initial={items:[{id:'aircAruvnKk',title:'Archived',status:'inbox',returnedToInbox:true,progress:123}],history:[]};
  const p=await youtube('',undefined,false,undefined,initial);t.after(()=>p.dom.window.close());pageCSS(p);
  p.doc.querySelector('#watchbox-inbox').click();await tick();
  const save=p.doc.querySelector('.watchbox-saved-card [data-watchbox-action="queue"]');
  assert.equal(save.tagName,'A','Local cards have no native menu and must open the watch page to save');
  assert.equal(p.dom.window.getComputedStyle(save).display,'grid','The native-save link must retain the circular thumbnail control');
  assert.equal(new URL(save.href).searchParams.get('v'),'aircAruvnKk');assert.equal(new URL(save.href).searchParams.get('t'),'123s');
  assert.equal(p.saved().items[0].status,'inbox','Showing the link must not claim the account save succeeded');
});
test('returned Inbox cards sort by upload time rather than collection time',async t=>{
  const state={items:[{id:'aircAruvnKk',title:'Older upload',status:'inbox',returnedToInbox:true,publishedAt:100,addedAt:300},{id:'h6fcK_fRYaI',title:'Newest upload',status:'inbox',returnedToInbox:true,publishedAt:200,addedAt:100}],history:[]};
  const p=await youtube('',undefined,false,undefined,state);t.after(()=>p.dom.window.close());
  assert.deepEqual([...p.doc.querySelectorAll('.watchbox-saved-card h3')].map(e=>e.textContent),['Newest upload','Older upload']);
});

test('library cards use native YouTube thumbnail and metadata structure', async t => {
  const p=await youtube(feedCard.replace('</ytd-rich-item-renderer>','<a href="/@3blue1brown"><yt-avatar-shape><img src="https://yt3.ggpht.com/avatar=s88"></yt-avatar-shape></a><yt-thumbnail-view-model><img src="https://i.ytimg.com/vi/aircAruvnKk/hq720.jpg"></yt-thumbnail-view-model><yt-thumbnail-badge-view-model><span class="ytBadgeShapeText">19:13</span></yt-thumbnail-badge-view-model><span class="ytContentMetadataViewModelMetadataText">4M views</span><span class="ytContentMetadataViewModelMetadataText">3 days ago</span></ytd-rich-item-renderer>'));t.after(()=>p.dom.window.close());pageCSS(p);
  p.doc.querySelector('[data-watchbox-action="archive"]').click();await tick();
  await returnLoadedVideos(p);
  const card=p.doc.querySelector('.watchbox-saved-card');
  assert.ok(card.querySelector('yt-lockup-view-model .ytLockupViewModelHost'),'The library must use YouTube’s native lockup layout');
  assert.equal(card.querySelector('yt-thumbnail-view-model img').src,'https://i.ytimg.com/vi/aircAruvnKk/hq720.jpg');
  assert.equal(card.querySelector('yt-thumbnail-badge-view-model').textContent,'19:13');
  assert.equal(card.querySelector('yt-avatar-shape img').src,'https://yt3.ggpht.com/avatar=s88');
  assert.equal(card.querySelector('.ytLockupMetadataViewModelTitle').textContent,'Neural network');
  assert.equal(card.querySelector('.ytContentMetadataViewModelMetadataText a').getAttribute('href'),'https://www.youtube.com/@3blue1brown');
  assert.match(card.querySelector('yt-content-metadata-view-model').textContent,/4M views.*3 days ago/);
});
test('library CSS preserves native avatar proportions and heading spacing', async t => {
  const state={items:[{id:'aircAruvnKk',title:'Video',channel:'Channel',status:'inbox',returnedToInbox:true,channelAvatar:'https://yt3.ggpht.com/avatar=s88',addedAt:1}],history:[]};
  const p=await youtube('','https://www.youtube.com/feed/subscriptions#watchbox-inbox',false,undefined,state);t.after(()=>p.dom.window.close());pageCSS(p);
  const nativeCSS=p.doc.createElement('style');nativeCSS.textContent='.ytLockupMetadataViewModelHeadingReset{margin:0}.ytSpecAvatarShapeImage{aspect-ratio:1 / 1;border-radius:50%}';p.doc.head.prepend(nativeCSS);
  p.doc.querySelector('#watchbox-inbox').click();await tick();
  const avatar=p.doc.querySelector('yt-avatar-shape img'),heading=p.doc.querySelector('.watchbox-saved-card h3');
  assert.equal(p.dom.window.getComputedStyle(avatar).aspectRatio,'1 / 1','Card CSS must not stretch an avatar into a thumbnail');
  assert.equal(p.dom.window.getComputedStyle(heading).marginTop,'0px','Native metadata spacing must not receive the old custom title margin');
});
test('existing Saved and Archive entries refresh upload metadata even beyond the inbox cutoff', async t => {
  const state={items:[{id:'aircAruvnKk',title:'Old saved title',status:'queue',watched:false,progress:123,addedAt:200},{id:'h6fcK_fRYaI',title:'Archived',status:'archive',watched:true,addedAt:300}],history:[]};
  const card=(id,title,age)=>`<ytd-rich-item-renderer><a id="video-title-link" href="/watch?v=${id}">${title}</a><a href="/@creator">Creator</a><span class="ytContentMetadataViewModelMetadataText">${age}</span></ytd-rich-item-renderer>`;
  const p=await youtube(card('aircAruvnKk','Saved','2 months ago')+card('h6fcK_fRYaI','Archived','3 days ago'),'https://www.youtube.com/feed/subscriptions',false,undefined,state);t.after(()=>p.dom.window.close());
  assert.ok(p.saved().items[0].publishedAt,'Existing old saved videos need upload metadata too');
  assert.ok(p.saved().items[1].publishedAt);
  assert.equal(p.saved().items[0].progress,123);
  assert.deepEqual(p.saved().items.map(item=>item.status),['queue','archive']);
  assert.equal(p.saved().history.length,0,'Metadata refresh must not create an Undo action');

  assert.match(p.doc.querySelector('ytd-rich-grid-renderer').textContent,/3 days ago/);
  let changes=0;const observer=new p.dom.window.MutationObserver(records=>{changes+=records.length;});observer.observe(p.doc.querySelector('#watchbox-saved-shelf'),{childList:true,subtree:true});
  await new Promise(resolve=>setTimeout(resolve,250));observer.disconnect();
  assert.equal(changes,0,'Metadata backfill must settle without repeated rerenders');
});
test('native renderer data supplies lazy thumbnails and channel avatars', t => {
  const {dom,capture:read}=capture(feedCard,'https://www.youtube.com/feed/subscriptions');t.after(()=>dom.window.close());
  const lockupViewModel={
    contentImage:{thumbnailViewModel:{image:{sources:[{url:'https://i.ytimg.com/vi/aircAruvnKk/hq720.jpg'}]}}},
    metadata:{lockupMetadataViewModel:{image:{decoratedAvatarViewModel:{avatar:{avatarViewModel:{image:{sources:[{url:'https://yt3.ggpht.com/avatar=s88'}]}}}}}}}
  };
  dom.window.document.querySelector('ytd-rich-item-renderer').data={content:{lockupViewModel}};
  const video=read().videos[0];
  assert.equal(video.thumbnailUrl,'https://i.ytimg.com/vi/aircAruvnKk/hq720.jpg','Hidden native cards have no image src until scrolled into view');
  assert.equal(video.channelAvatar,'https://yt3.ggpht.com/avatar=s88');
});
test('native library images and typography activate their YouTube display styles', async t => {
  const state={items:[{id:'aircAruvnKk',title:'Video',channel:'Channel',status:'inbox',returnedToInbox:true,channelUrl:'https://www.youtube.com/@creator',channelAvatar:'https://yt3.ggpht.com/avatar=s88',addedAt:1}],history:[]};
  const p=await youtube('','https://www.youtube.com/feed/subscriptions#watchbox-inbox',false,undefined,state);t.after(()=>p.dom.window.close());
  const nativeCSS=p.doc.createElement('style');nativeCSS.textContent='.ytCoreImageHost{visibility:hidden}.ytCoreImageLoaded{visibility:inherit}.ytLockupMetadataViewModelAvatar{display:none}.ytLockupMetadataViewModelStandard .ytLockupMetadataViewModelAvatar{display:block}.ytLockupMetadataViewModelStandard .ytLockupMetadataViewModelTitle{font:500 16px/22px Roboto,Arial,sans-serif}.ytAttributedStringLinkInheritColor .ytAttributedStringLinkCallToActionColor{color:inherit}';p.doc.head.append(nativeCSS);
  p.doc.querySelector('#watchbox-inbox').click();await tick();
  const card=p.doc.querySelector('.watchbox-saved-card');
  for(const image of card.querySelectorAll('img')){image.dispatchEvent(new p.dom.window.Event('load'));assert.notEqual(p.dom.window.getComputedStyle(image).visibility,'hidden','YouTube hides images until its loaded class is added');}
  assert.equal(p.dom.window.getComputedStyle(card.querySelector('.ytLockupMetadataViewModelTitle')).fontSize,'16px');
  assert.equal(p.dom.window.getComputedStyle(card.querySelector('.ytLockupMetadataViewModelAvatar')).display,'block');
  assert.ok(card.querySelector('.ytContentMetadataViewModelMetadataText a').classList.contains('ytAttributedStringLinkCallToActionColor'));
});
test('undated existing library entries backfill their upload date before sorting', async t => {
  const state={items:[{id:'aircAruvnKk',title:'Older',channel:'Creator',status:'inbox',returnedToInbox:true,publishedAt:Date.parse('2026-09-01'),channelAvatar:'https://yt3.ggpht.com/older=s88',addedAt:200},{id:'h6fcK_fRYaI',title:'Newer',channel:'Creator',status:'inbox',returnedToInbox:true,progress:120,addedAt:100}],history:[]};
  let requests=0;
  const fetchPage=async url=>{requests++;assert.match(String(url),/watch\?v=h6fcK_fRYaI/);return {ok:true,text:async()=>'<meta itemprop="datePublished" content="2026-10-01T12:30:00Z"><meta itemprop="duration" content="PT12M34S"><meta itemprop="interactionCount" content="4321"><meta property="og:image" content="https://i.ytimg.com/vi/h6fcK_fRYaI/hq720.jpg">'};};
  const p=await youtube('','https://www.youtube.com/feed/subscriptions#watchbox-inbox',false,undefined,state,fetchPage);t.after(()=>p.dom.window.close());
  p.doc.querySelector('#watchbox-inbox').click();await new Promise(resolve=>setTimeout(resolve,200));
  assert.equal(p.saved().items[1].publishedAt,Date.parse('2026-10-01T12:30:00Z'));
  assert.equal(p.saved().items[1].duration,'12:34');
  assert.equal(p.saved().items[1].progress,120);
  assert.deepEqual([...p.doc.querySelectorAll('.watchbox-saved-card h3')].map(e=>e.textContent),['Newer','Older']);
  p.doc.querySelector('#watchbox-inbox').click();await tick();p.doc.querySelector('#watchbox-inbox').click();await tick();
  assert.equal(requests,1,'Cached metadata must prevent repeated watch-page requests');
});
test('metadata backfills preserve a pending Dismiss action and its Undo history', async t => {
  let finishFetch;
  const fetchPage=()=>new Promise(resolve=>{finishFetch=()=>resolve({ok:true,text:async()=>'<meta itemprop="datePublished" content="2026-10-01T12:30:00Z">'});});
  const state={items:[{id:'aircAruvnKk',title:'Video',status:'inbox',returnedToInbox:true,progress:123,addedAt:1}],history:[]};
  const p=await youtube('',undefined,false,undefined,state,fetchPage);t.after(()=>p.dom.window.close());
  const storage=p.dom.window.browser.storage.local,set=storage.set,pending=[];
  storage.set=async value=>{await new Promise(resolve=>pending.push(resolve));return set(value);};
  p.doc.querySelector('.watchbox-saved-card [data-watchbox-action="archive"]').click();await tick();
  finishFetch();await tick();
  pending.shift()();await tick();
  pending.shift()();await tick();
  assert.equal(p.saved().items[0].status,'archive','Metadata must not restore the status from before the Dismiss write');
  assert.equal(p.saved().history.length,1,'Metadata must retain the action’s Undo entry');
  assert.equal(p.saved().history[0].status,'inbox');
  assert.equal(p.saved().items[0].publishedAt,Date.parse('2026-10-01T12:30:00Z'));
  assert.equal(p.saved().items[0].progress,123);
  storage.set=set;p.doc.querySelector('#watchbox-undo').click();await tick();
  assert.equal(p.saved().items[0].status,'inbox');
  assert.equal(p.saved().items[0].publishedAt,Date.parse('2026-10-01T12:30:00Z'),'Undo must retain the fetched metadata');
});
test('exact upload dates survive later relative-label metadata refreshes', () => {
  const c=core(),publishedAt=Date.parse('2026-10-01T12:30:00Z');
  const items=[{id:'aircAruvnKk',title:'Video',status:'queue',addedAt:1,publishedAt,publishedLabel:'Oct 1, 2026',publishedAtExact:true}];
  const updated=c.collect(items,[{url:'https://www.youtube.com/watch?v=aircAruvnKk',publishedAt:Date.parse('2026-10-01'),publishedLabel:'6 days ago'}]).items[0];
  assert.equal(updated.publishedAt,publishedAt,'A rounded feed label must not overwrite a precise upload timestamp');
  assert.equal(updated.publishedLabel,'6 days ago');
});
test('watch metadata restores native creator and views without executing page scripts', t => {
  const {dom}=capture();t.after(()=>dom.window.close());
  const owner={videoOwnerRenderer:{thumbnail:{thumbnails:[{url:'https://yt3.ggpht.com/avatar=s88'}]},title:{runs:[{text:'Creator }; {',navigationEndpoint:{browseEndpoint:{canonicalBaseUrl:'/@creator'}}}]}}};
  const html=`<meta itemprop="datePublished" content="2026-10-01T12:30:00Z"><script>var ytInitialData = ${JSON.stringify({contents:[owner]})}; window.executed=true;</script><script>var ytInitialPlayerResponse = {"videoDetails":{"viewCount":"4321"}};</script>`;
  const result=dom.window.readYouTubeWatchMetadata(html);
  assert.equal(result.channelAvatar,'https://yt3.ggpht.com/avatar=s88');
  assert.equal(result.channelUrl,'https://www.youtube.com/@creator');
  assert.equal(result.views,'4,321 views');
  assert.equal(result.publishedAtExact,true);
  assert.equal(dom.window.executed,undefined);
});
test('native thumbnails place the image inside YouTube’s positioned wrapper', async t => {
  const p=await youtube('',undefined,false,undefined,{items:[{id:'aircAruvnKk',title:'Video',status:'inbox',returnedToInbox:true,addedAt:1}],history:[]});t.after(()=>p.dom.window.close());
  p.doc.querySelector('#watchbox-inbox').click();await tick();
  const image=p.doc.querySelector('.watchbox-saved-card yt-thumbnail-view-model img');
  assert.equal(image.parentElement.className,'ytThumbnailViewModelImage','Direct images collapse under the native thumbnail CSS');
});
test('native avatar wrappers preserve the circular image size', async t => {
  const p=await youtube('',undefined,false,undefined,{items:[{id:'aircAruvnKk',title:'Video',status:'inbox',returnedToInbox:true,channelAvatar:'https://yt3.ggpht.com/avatar=s88',addedAt:1}],history:[]});t.after(()=>p.dom.window.close());
  p.doc.querySelector('#watchbox-inbox').click();await tick();
  const size=p.doc.querySelector('.ytSpecAvatarShapeAvatarSizeMedium');
  assert.equal(size.parentElement.parentElement.classList.contains('ytSpecAvatarShapeHost'),true,'The native intermediate wrapper prevents flex shrinking the avatar width');
});
test('library columns follow native grid changes after a resize', async t => {
  const p=await youtube('',undefined,false,undefined,{items:[{id:'aircAruvnKk',title:'Video',status:'inbox',returnedToInbox:true,addedAt:1}],history:[]});t.after(()=>p.dom.window.close());
  const grid=p.doc.querySelector('ytd-rich-grid-renderer');grid.style.setProperty('--ytd-rich-grid-items-per-row','3');
  p.doc.querySelector('#watchbox-inbox').click();await tick();
  grid.style.setProperty('--ytd-rich-grid-items-per-row','2');p.dom.window.dispatchEvent(new p.dom.window.Event('resize'));
  await new Promise(resolve=>setTimeout(resolve,200));
  assert.equal(p.doc.querySelector('.watchbox-saved-grid').style.gridTemplateColumns,'repeat(2, minmax(0, 1fr))');
});
test('dated library entries also backfill missing creator avatars', async t => {
  const state={items:[{id:'aircAruvnKk',title:'Video',status:'inbox',returnedToInbox:true,publishedAt:1,addedAt:1}],history:[]};
  const owner={videoOwnerRenderer:{thumbnail:{thumbnails:[{url:'https://yt3.ggpht.com/avatar=s88'}]}}};
  const fetchPage=async()=>({ok:true,text:async()=>`<meta itemprop="datePublished" content="2026-10-01T12:30:00Z"><script>var ytInitialData = ${JSON.stringify(owner)};</script>`});
  const p=await youtube('',undefined,false,undefined,state,fetchPage);t.after(()=>p.dom.window.close());
  p.doc.querySelector('#watchbox-inbox').click();await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(p.doc.querySelector('.watchbox-saved-card yt-avatar-shape img')?.src,'https://yt3.ggpht.com/avatar=s88');
});
test('watch metadata reads collaboration avatars from the native avatar stack', t => {
  const {dom}=capture();t.after(()=>dom.window.close());
  const owner={videoOwnerRenderer:{avatarStack:{avatarStackViewModel:{avatars:[{avatarViewModel:{image:{sources:[{url:'https://yt3.ggpht.com/creator=s88'}]}}}]}}}};
  const metadata=dom.window.readYouTubeWatchMetadata(`<meta itemprop="datePublished" content="2026-10-01"><script>var ytInitialData = ${JSON.stringify(owner)};</script>`);
  assert.equal(metadata.channelAvatar,'https://yt3.ggpht.com/creator=s88');
});
test('subscriptions show a caught-up inbox after the last video is saved or archived', async t => {
  const p=await youtube(feedCard+feedCard.replaceAll('aircAruvnKk','h6fcK_fRYaI'));t.after(()=>p.dom.window.close());
  const empty=p.doc.querySelector('#watchbox-inbox-empty');
  assert.ok(empty,'The inbox needs an empty state');
  assert.equal(empty.hidden,true);
  const cards=p.doc.querySelectorAll('ytd-rich-item-renderer');
  cards[0].querySelector('[data-watchbox-action="queue"]').click();await tick();
  assert.equal(empty.hidden,true,'A remaining subscription must keep the empty state hidden');
  cards[1].querySelector('[data-watchbox-action="archive"]').click();await tick();
  assert.equal(empty.hidden,false);
  assert.equal(empty.querySelector('h2').textContent,'All caught up');
  assert.equal(empty.querySelector('svg').getAttribute('aria-hidden'),'true');
  assert.equal(empty.textContent,'All caught up');
  assert.equal(empty.querySelector('p'),null,'The caught-up state must have no detail text');
  await openAll(p);
  assert.equal(empty.hidden,true,'All has no caught-up message');
  p.doc.querySelector('#watchbox-inbox').click();await tick();
  assert.equal(empty.hidden,false);
  p.doc.querySelector('#watchbox-undo').click();await tick();
  assert.equal(empty.hidden,true,'Undo must restore the inbox instead of leaving the empty message');
});
test('subscriptions wait for pagination before declaring the inbox caught up', async t => {
  const p=await youtube(feedCard+'<ytd-continuation-item-renderer>Loading more</ytd-continuation-item-renderer>');t.after(()=>p.dom.window.close());
  const empty=p.doc.querySelector('#watchbox-inbox-empty'),grid=p.doc.querySelector('ytd-rich-grid-renderer');
  p.doc.querySelector('[data-watchbox-action="queue"]').click();await tick();
  assert.equal(empty.hidden,true,'Another page may still contain inbox videos');
  grid.insertAdjacentHTML('beforeend','<ytd-rich-item-renderer><a id="video-title-link" href="/watch?v=h6fcK_fRYaI">Older video</a><span class="ytContentMetadataViewModelMetadataText">2 weeks ago</span></ytd-rich-item-renderer>');
  await new Promise(resolve=>setTimeout(resolve,200));
  assert.equal(empty.hidden,false,'The two-week cutoff ends pagination even if a continuation remains');
  grid.replaceChildren();
  await new Promise(resolve=>setTimeout(resolve,200));
  assert.equal(empty.hidden,false,'An exhausted native feed is caught up too');
  grid.insertAdjacentHTML('beforeend',feedCard.replaceAll('aircAruvnKk','pnv5iKB2hl4'));
  await new Promise(resolve=>setTimeout(resolve,200));
  assert.equal(empty.hidden,true,'A newly loaded subscription must replace the empty state');
});
test('subscriptions do not show caught up over native loading placeholders', async t => {
  const p=await youtube('<ytd-ghost-grid-renderer>Loading subscriptions</ytd-ghost-grid-renderer>');t.after(()=>p.dom.window.close());
  const empty=p.doc.querySelector('#watchbox-inbox-empty');
  assert.equal(empty.hidden,true,'Loading an empty grid is not a cleared inbox');
  p.doc.querySelector('ytd-ghost-grid-renderer').remove();
  await new Promise(resolve=>setTimeout(resolve,200));
  assert.equal(empty.hidden,false);
  await p.setPreferences({enabled:false});await tick();
  assert.equal(empty.hidden,true,'Turning Watchbox off must hide its empty state');
  await p.setPreferences({enabled:true});await tick();
  assert.equal(empty.hidden,false);
  p.dom.window.history.pushState({},'', '/watch?v=aircAruvnKk');
  p.doc.dispatchEvent(new p.dom.window.Event('yt-navigate-finish'));
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(empty.hidden,true,'A cached subscriptions grid must not show the message on another route');
});
test('hidden continuation skeletons do not suppress the caught-up inbox at the cutoff', async t => {
  const p=await youtube(feedCard+'<ytd-rich-item-renderer><a id="video-title-link" href="/watch?v=h6fcK_fRYaI">Old video</a><span class="ytContentMetadataViewModelMetadataText">2w ago</span></ytd-rich-item-renderer><ytd-continuation-item-renderer><div id="ghost-cards"><ytd-ghost-grid-renderer>Loading</ytd-ghost-grid-renderer></div></ytd-continuation-item-renderer>');t.after(()=>p.dom.window.close());pageCSS(p);
  p.doc.querySelector('[data-watchbox-action="archive"]').click();await tick();
  assert.equal(p.doc.querySelector('#watchbox-inbox-empty').hidden,false,'A skeleton inside stopped pagination is not still loading');
});
test('older stored videos do not prevent a caught-up inbox', async t => {
  const p=await youtube(feedCard);t.after(()=>p.dom.window.close());
  p.doc.querySelector('[data-watchbox-action="archive"]').click();await tick();
  await p.dom.window.browser.storage.local.set({watchbox:{...p.saved(),items:[...p.saved().items,{id:'h6fcK_fRYaI',title:'Previously imported old video',status:'inbox',addedAt:1}]}});
  const empty=p.doc.querySelector('#watchbox-inbox-empty');
  assert.equal(empty.hidden,false,'Older library entries must not prevent the current inbox from being caught up');
  assert.equal(p.doc.querySelector('#watchbox-inbox').textContent,'Inbox');
  let mutations=0;
  const observer=new p.dom.window.MutationObserver(records=>{mutations+=records.length;});observer.observe(empty.parentElement,{childList:true,subtree:true});
  await new Promise(resolve=>setTimeout(resolve,250));
  observer.disconnect();
  assert.equal(mutations,0,'The empty state and its badge must settle without a refresh loop');
});
test('moving a dismissed video to inbox restores it when its native card is no longer loaded', async t => {
  const p=await youtube(feedCard);t.after(()=>p.dom.window.close());
  p.doc.querySelector('[data-watchbox-action="archive"]').click();await tick();
  await openAll(p);
  p.doc.querySelector('ytd-rich-item-renderer [data-watchbox-action="inbox"]').click();await tick();
  p.doc.querySelector('ytd-rich-item-renderer').remove();
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(p.saved().items[0].status,'inbox');
  assert.equal(p.doc.querySelector('#watchbox-inbox').textContent,'Inbox','Inbox navigation must keep its label without a count');
  p.doc.querySelector('#watchbox-inbox').click();await tick();
  assert.equal(p.doc.querySelector('#watchbox-inbox-empty').hidden,true);
  const returned=p.doc.querySelector('.watchbox-saved-card');
  assert.ok(returned,'The moved video must be reachable in Inbox');
  assert.equal(returned.querySelector('h3').textContent,'Neural network');
  returned.querySelector('[data-watchbox-action="archive"]').click();await tick();
  assert.equal(p.doc.querySelector('#watchbox-inbox').textContent,'Inbox');
  assert.equal(p.doc.querySelector('#watchbox-inbox-empty').hidden,false);
  p.doc.querySelector('#watchbox-undo').click();await tick();
  assert.equal(p.doc.querySelector('#watchbox-inbox').textContent,'Inbox','Inbox navigation must keep its label without a count');
});
test('existing Inbox moves are recovered from stored action history', async t => {
  const state={items:[{id:'aircAruvnKk',title:'Already moved back',status:'inbox',watched:false,addedAt:1}],history:[{id:'aircAruvnKk',status:'queue',watched:false}]};
  const p=await youtube('','https://www.youtube.com/feed/subscriptions#watchbox-inbox',false,undefined,state);t.after(()=>p.dom.window.close());
  assert.equal(p.doc.querySelector('#watchbox-inbox').textContent,'Inbox','Inbox navigation must keep its label without a count');
  assert.equal(p.doc.querySelector('.watchbox-saved-card h3').textContent,'Already moved back');
  assert.equal(p.saved().items[0].returnedToInbox,true,'Recovery must persist beyond the bounded Undo history');
  p.doc.querySelector('#watchbox-undo').click();await tick();
  assert.equal(p.saved().items[0].status,'queue','Recovery must preserve the original Undo action');
  assert.equal(p.doc.querySelector('#watchbox-inbox').textContent,'Inbox');
});
test('hidden Shorts shelves do not keep a cleared inbox occupied', async t => {
  const p=await youtube(feedCard+'<ytd-rich-section-renderer><ytd-rich-shelf-renderer is-shorts>'+feedCard.replaceAll('aircAruvnKk','h6fcK_fRYaI')+'</ytd-rich-shelf-renderer></ytd-rich-section-renderer>');t.after(()=>p.dom.window.close());pageCSS(p);
  p.doc.querySelector('[data-watchbox-action="archive"]').click();await tick();
  assert.equal(p.doc.querySelector('#watchbox-inbox').textContent,'Inbox','Inbox navigation must keep its label without a count');
  assert.equal(p.doc.querySelector('#watchbox-inbox-empty').hidden,false);
  await p.setPreferences({hideShorts:false});await tick();
  assert.equal(p.doc.querySelector('#watchbox-inbox').textContent,'Inbox','Inbox navigation must keep its label without a count');
  assert.equal(p.doc.querySelector('#watchbox-inbox-empty').hidden,true);
});
test('explicit Inbox moves bring back older videos while automatic pagination stays capped', async t => {
  const state={items:[{id:'aircAruvnKk',title:'Older saved video',status:'archive',watched:false,addedAt:1,progress:125}],history:[]};
  const p=await youtube(feedCard.replace('Neural network','Older saved video').replace('</ytd-rich-item-renderer>','<span class="ytContentMetadataViewModelMetadataText">1 month ago</span></ytd-rich-item-renderer>')+'<ytd-continuation-item-renderer>Loading</ytd-continuation-item-renderer>','https://www.youtube.com/feed/subscriptions#watchbox-inbox',false,undefined,state);t.after(()=>p.dom.window.close());pageCSS(p);
  await openAll(p);
  p.doc.querySelector('ytd-rich-item-renderer [data-watchbox-action="inbox"]').click();await tick();
  p.doc.querySelector('#watchbox-inbox').click();await tick();
  assert.equal(p.doc.querySelector('#watchbox-inbox').textContent,'Inbox');
  assert.equal(p.doc.querySelector('#watchbox-saved-shelf').hidden,false);
  assert.equal(p.doc.querySelector('.watchbox-saved-card h3').textContent,'Older saved video');
  assert.match(p.doc.querySelector('.watchbox-saved-card a').href,/t=125s/);
  assert.equal(p.dom.window.getComputedStyle(p.doc.querySelector('ytd-continuation-item-renderer')).display,'none','An explicit return must not reopen old subscription pages');
  p.doc.querySelector('#watchbox-undo').click();await tick();
  assert.equal(p.doc.querySelector('#watchbox-inbox').textContent,'Inbox');
  assert.equal(p.doc.querySelector('#watchbox-inbox-empty').hidden,false);
});
test('returned inbox videos use their native card when YouTube loads it again', async t => {
  const state={items:[{id:'aircAruvnKk',title:'Returned video',status:'inbox',returnedToInbox:true,watched:false,addedAt:1}],history:[]};
  const p=await youtube('','https://www.youtube.com/feed/subscriptions#watchbox-inbox',false,undefined,state);t.after(()=>p.dom.window.close());pageCSS(p);
  assert.equal(p.doc.querySelectorAll('.watchbox-saved-card').length,1);
  p.doc.querySelector('ytd-rich-grid-renderer').insertAdjacentHTML('beforeend',feedCard);
  await new Promise(resolve=>setTimeout(resolve,200));
  assert.equal(p.doc.querySelector('#watchbox-inbox').textContent,'Inbox');
  assert.equal(p.doc.querySelectorAll('.watchbox-saved-card').length,0,'A native card must replace the fallback without duplication');
  assert.equal(p.doc.querySelector('#watchbox-saved-shelf').hidden,true);
  await openAll(p);
  assert.equal(p.doc.querySelector('#watchbox-inbox').textContent,'Inbox','Inbox navigation must keep its label without a count');
});
test('subscriptions import new continuation pages after the first sixty videos', async t => {
  const cards=(start,count)=>Array.from({length:count},(_,i)=>`<ytd-rich-item-renderer><a id="video-title-link" href="/watch?v=${String(start+i).padStart(11,'0')}">Video ${start+i}</a></ytd-rich-item-renderer>`).join('');
  const p=await youtube(cards(0,60));t.after(()=>p.dom.window.close());
  const first=p.doc.querySelector('ytd-rich-item-renderer');
  first.querySelector('[data-watchbox-action="archive"]').click();await tick();
  const grid=p.doc.querySelector('ytd-rich-grid-renderer');
  grid.insertAdjacentHTML('beforeend',cards(60,60));
  await new Promise(resolve=>setTimeout(resolve,250));
  assert.equal(p.saved().items.length,120,'The continuation page must join the inbox');
  grid.insertAdjacentHTML('beforeend',cards(120,20));
  await new Promise(resolve=>setTimeout(resolve,250));
  assert.equal(p.saved().items.length,140,'Further continuation pages must also be imported');
  assert.equal(p.doc.querySelectorAll('[data-watchbox-id]:not([data-watchbox-hidden])').length,139);
  assert.equal(first.hasAttribute('data-watchbox-hidden'),true,'Importing another page must preserve Archive');
  const last=grid.lastElementChild;
  last.querySelector('[data-watchbox-action="queue"]').click();await tick();
  assert.equal(p.saved().items.at(-1).status,'queue');
  p.doc.querySelector('#watchbox-undo').click();await tick();
  assert.equal(last.hasAttribute('data-watchbox-hidden'),false,'Undo must restore a continuation card');
});
test('subscriptions retain YouTube cards and typography with contextual save controls', async () => {
  const p=await youtube(feedCard);
  assert.equal(p.doc.querySelector('#watchbox-surface'),null,'The embedded app must be removed');
  const card=p.doc.querySelector('ytd-rich-item-renderer');
  assert.equal(card.querySelector('#video-title-link').textContent,'Neural network');
  assert.ok(card.querySelector('[data-watchbox-action="queue"]'),'Native card save action is missing');
  assert.equal(p.doc.querySelectorAll('#watchbox-sidebar').length,1);
  assert.equal(p.saved().items[0].title,'Neural network');
  card.querySelector('[data-watchbox-action="queue"]').click();await tick();
  assert.equal(p.saved().items[0].status,'queue');
  assert.equal(card.hasAttribute('data-watchbox-hidden'),true,'Saved items should leave the subscriptions inbox');
  p.doc.querySelector('#watchbox-undo').click();await tick();
  assert.equal(card.hasAttribute('data-watchbox-hidden'),false);
  p.dom.window.close();
});
test('subscriptions keep unimported cards visible when library saving fails', async t => {
  const p=await youtube(feedCard,'https://www.youtube.com/feed/subscriptions#watchbox-inbox',true);t.after(()=>p.dom.window.close());
  const card=p.doc.querySelector('ytd-rich-item-renderer');
  assert.equal(p.saved().items.length,0);
  assert.equal(card.hasAttribute('data-watchbox-hidden'),false,'A failed import must not hide a native video');
  p.setFailure(false);
  p.doc.dispatchEvent(new p.dom.window.Event('yt-navigate-finish'));
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(p.saved().items.length,1,'A later successful scan must retry the import');
  card.querySelector('[data-watchbox-action="archive"]').click();await tick();
  assert.equal(card.hasAttribute('data-watchbox-hidden'),true,'Archived videos must still leave the inbox');
});
test('subscriptions exclude videos at least two weeks old using native upload metadata', async t => {
  const ages=['13 days ago','1 week ago','Streamed 12h ago','Premieres in 2 days','', '14 days ago','2 weeks ago','Streamed 2w ago','1 month ago','2 years ago'];
  const p=await youtube(ages.map((age,i)=>`<ytd-rich-item-renderer><a id="video-title-link" href="/watch?v=${String(i).padStart(11,'0')}">Video about 2 years ago ${i}</a><span class="ytContentMetadataViewModelMetadataText" aria-label="${age}">${age}</span></ytd-rich-item-renderer>`).join(''));t.after(()=>p.dom.window.close());
  const cards=[...p.doc.querySelectorAll('ytd-rich-item-renderer')];
  for(const card of cards.slice(0,5))assert.equal(card.hasAttribute('data-watchbox-hidden'),false,'Recent and undated videos must stay visible');
  for(const card of cards.slice(5))assert.equal(card.hasAttribute('data-watchbox-hidden'),true,'Videos at the two-week cutoff or older must hide');
  assert.equal(p.saved().items.length,5,'Old videos must not be imported into the inbox');
  await p.setPreferences({enabled:false});await tick();
  for(const card of cards)assert.equal(card.hasAttribute('data-watchbox-hidden'),false,'Disabling Watchbox must restore all videos');
});
test('Inbox imports and filters the selected window and updates open tabs without deleting decisions',async t=>{
  const ages=['6 days ago','7 days ago','13 days ago','14 days ago','3 weeks ago','29 days ago','30 days ago','1 month ago',''];
  const cardsHTML=ages.map((age,i)=>`<ytd-rich-item-renderer><a id="video-title-link" href="/watch?v=${String(i).padStart(11,'0')}">Video ${i}</a><span class="ytContentMetadataViewModelMetadataText">${age}</span></ytd-rich-item-renderer>`).join('');
  const p=await youtube(cardsHTML,undefined,false,{inboxDays:30});t.after(()=>p.dom.window.close());
  const cards=[...p.doc.querySelectorAll('ytd-rich-item-renderer')];
  const visible=()=>cards.map(card=>!card.hasAttribute('data-watchbox-hidden'));
  assert.deepEqual(visible(),[true,true,true,true,true,true,false,false,true]);
  assert.equal(p.saved().items.length,7,'Capture must import beyond the old fourteen-day limit');
  cards[0].querySelector('[data-watchbox-action="archive"]').click();await tick();
  await p.setPreferences({inboxDays:7});await new Promise(resolve=>setTimeout(resolve,150));
  assert.deepEqual(visible(),[false,false,false,false,false,false,false,false,true]);
  assert.equal(p.saved().items.length,7,'Reducing the window must keep stored videos');
  await p.setPreferences({inboxDays:30});await new Promise(resolve=>setTimeout(resolve,150));
  assert.deepEqual(visible(),[false,true,true,true,true,true,false,false,true]);
  assert.equal(p.saved().items[0].status,'archive','Widening the window must retain Dismiss');
  p.doc.querySelector('#watchbox-undo').click();await tick();
  assert.equal(cards[0].hasAttribute('data-watchbox-hidden'),false);
  await openAll(p);
  for(const card of cards)assert.equal(card.hasAttribute('data-watchbox-hidden'),false,'Full Subscriptions ignores the Inbox window');
  await p.setPreferences({inboxDays:7});await new Promise(resolve=>setTimeout(resolve,150));
  for(const card of cards)assert.equal(card.hasAttribute('data-watchbox-hidden'),false);
});
test('Inbox pagination and caught-up state follow the selected window when it changes',async t=>{
  const card=feedCard.replace('</ytd-rich-item-renderer>','<span class="ytContentMetadataViewModelMetadataText">3 weeks ago</span></ytd-rich-item-renderer>');
  const p=await youtube(card+'<ytd-continuation-item-renderer>Loading more</ytd-continuation-item-renderer>');t.after(()=>p.dom.window.close());pageCSS(p);
  const grid=p.doc.querySelector('ytd-rich-grid-renderer'),empty=p.doc.querySelector('#watchbox-inbox-empty');
  const canLoadMore=()=>p.dom.window.getComputedStyle(grid.querySelector('ytd-continuation-item-renderer')).display!=='none';
  assert.equal(canLoadMore(),false);assert.equal(empty.hidden,false);
  await p.setPreferences({inboxDays:30});await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(canLoadMore(),true,'Widening the window must resume native pagination');
  assert.equal(empty.hidden,true,'A visible three-week-old video means Inbox is not caught up');
  grid.querySelector('[data-watchbox-action="archive"]').click();await tick();
  assert.equal(empty.hidden,true,'Keep waiting while more in-window videos could load');
  grid.querySelector('ytd-continuation-item-renderer').insertAdjacentHTML('beforebegin',feedCard.replace('aircAruvnKk','h6fcK_fRYaI').replace('</ytd-rich-item-renderer>','<span class="ytContentMetadataViewModelMetadataText">30 days ago</span></ytd-rich-item-renderer>'));
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(canLoadMore(),false);assert.equal(empty.hidden,false,'Only declare caught up once the selected cutoff is reached');
  await p.setPreferences({inboxDays:7});await new Promise(resolve=>setTimeout(resolve,150));
  await openAll(p);
  grid.querySelector('[data-watchbox-action="inbox"]').click();await tick();
  p.doc.querySelector('#watchbox-inbox').click();await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(p.doc.querySelectorAll('.watchbox-saved-card').length,1,'An explicit return must remain in Inbox outside the chosen window');
  assert.equal(empty.hidden,true);
});
test('subscriptions stop loading more pages when the feed reaches the two-week cutoff', async t => {
  const p=await youtube(feedCard+'<ytd-continuation-item-renderer><div class="spinner">Loading more</div></ytd-continuation-item-renderer>');t.after(()=>p.dom.window.close());
  const css=p.doc.createElement('style');css.textContent=readFileSync('content.css','utf8');p.doc.head.append(css);
  const grid=p.doc.querySelector('ytd-rich-grid-renderer');
  const continuation=grid.querySelector('ytd-continuation-item-renderer');
  const canLoadMore=()=>p.dom.window.getComputedStyle(continuation).display!=='none';
  assert.equal(canLoadMore(),true,'Recent pages must keep native pagination');
  continuation.insertAdjacentHTML('beforebegin','<ytd-rich-item-renderer><a id="video-title-link" href="/watch?v=h6fcK_fRYaI">Old video</a><span class="ytContentMetadataViewModelMetadataText">2w ago</span></ytd-rich-item-renderer>');
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(canLoadMore(),false,'The continuation must stop becoming visible after old cards collapse');
  const late=p.doc.createElement('ytd-continuation-item-renderer');late.innerHTML='<div class="spinner">Loading more</div>';continuation.replaceWith(late);
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(p.dom.window.getComputedStyle(late).display,'none','A continuation replaced by an in-flight request must stay stopped');
  assert.equal(p.saved().items.length,1,'Older continuation pages must not enter the inbox');
  assert.equal(p.doc.querySelector('ytd-rich-item-renderer').hasAttribute('data-watchbox-hidden'),false,'The last recent video must stay visible');
  await p.setPreferences({enabled:false});await tick();
  assert.notEqual(p.dom.window.getComputedStyle(late).display,'none','Turning Watchbox off must restore native pagination');
  await p.setPreferences({enabled:true});await tick();
  assert.equal(p.dom.window.getComputedStyle(late).display,'none','Turning Watchbox back on must restore the cutoff');
  p.doc.querySelector('ytd-rich-item-renderer:last-of-type').remove();
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.notEqual(p.dom.window.getComputedStyle(late).display,'none','A replaced feed with only recent videos must paginate again');
});
test('returned Inbox cards retain same-tab resume links beside the native grid',async t=>{
  const p=await youtube('',undefined,false,undefined,{items:[{id:'aircAruvnKk',title:'Neural network',status:'inbox',returnedToInbox:true,progress:125}],history:[]});t.after(()=>p.dom.window.close());
  const card=p.doc.querySelector('.watchbox-saved-card');
  assert.equal(card.querySelector('h3').textContent,'Neural network');
  assert.equal(card.querySelector('a').target,'_self');
  assert.match(card.querySelector('a').href,/t=125s/);
  assert.equal(p.doc.querySelector('ytd-rich-grid-renderer').hasAttribute('data-watchbox-view-hidden'),false);
  assert.equal(p.doc.querySelectorAll('.watchbox-saved-card').length,1);
});

test('player actions live under native metadata and focus mode follows YouTube navigation', async () => {
  const p=await youtube('<ytd-watch-metadata><h1>Neural network</h1></ytd-watch-metadata><ytd-video-owner-renderer><ytd-channel-name>3Blue1Brown</ytd-channel-name></ytd-video-owner-renderer><video></video>','https://www.youtube.com/watch?v=aircAruvnKk');
  p.doc.querySelector('video').currentTime=123;
  assert.ok(p.doc.querySelector('ytd-watch-metadata #watchbox-player-tools'),'Player controls must join native metadata');
  p.doc.querySelector('#watchbox-save-position').click();await tick();
  assert.equal(p.saved().items[0].progress,123);
  p.doc.querySelector('#watchbox-focus').click();await tick();
  assert.equal(p.doc.documentElement.hasAttribute('data-watchbox-focus'),true);
  assert.equal(p.doc.querySelector('video').currentTime,123);
  p.dom.window.history.pushState({},'', '/feed/subscriptions');
  p.doc.dispatchEvent(new p.dom.window.Event('yt-navigate-finish'));await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(p.doc.querySelector('#watchbox-player-tools').hidden,true);
  assert.equal(p.doc.documentElement.hasAttribute('data-watchbox-focus'),false);
  p.dom.window.close();
});
test('Shorts is controlled only through settings while all loaded inbox videos remain visible', async t => {
  const cards=Array.from({length:80},(_,i)=>`<ytd-rich-item-renderer><a id="video-title-link" href="/watch?v=${String(i).padStart(11,'0')}">Video ${i}</a></ytd-rich-item-renderer>`).join('');
  const p=await youtube(cards+'<ytd-rich-section-renderer><ytd-rich-shelf-renderer is-shorts>Shorts</ytd-rich-shelf-renderer></ytd-rich-section-renderer>');
  t.after(()=>p.dom.window.close());
  const css=p.doc.createElement('style');css.textContent=readFileSync('content.css','utf8');p.doc.head.append(css);
  assert.equal(p.doc.documentElement.hasAttribute('data-watchbox-quiet'),true);
  assert.equal(p.dom.window.getComputedStyle(p.doc.querySelector('ytd-rich-section-renderer')).display,'none');
  // Imports run in batches of 60; allow the follow-up scan to finish.
  for(let attempt=0;attempt<40 && p.saved().items.length<80;attempt++)await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(p.saved().items.length,80);
  assert.equal(p.doc.querySelectorAll('[data-watchbox-id]:not([data-watchbox-hidden])').length,80);
  assert.equal(p.doc.querySelector('#watchbox-shorts'),null,'Shorts must not have a second control on the page');
  await p.setPreferences({hideShorts:false});await tick();
  assert.equal(p.doc.documentElement.hasAttribute('data-watchbox-quiet'),false);
  assert.notEqual(p.dom.window.getComputedStyle(p.doc.querySelector('ytd-rich-section-renderer')).display,'none');
  await p.setPreferences({hideShorts:true});await tick();
  assert.equal(p.doc.documentElement.hasAttribute('data-watchbox-quiet'),true);
  assert.equal(p.dom.window.getComputedStyle(p.doc.querySelector('ytd-rich-section-renderer')).display,'none');
  assert.equal(p.saved().items.length,80);
});
test('returned Inbox cards inherit YouTube grid columns and remain readable in its dark theme', async () => {
  const p=await youtube(feedCard);
  p.doc.querySelector('ytd-rich-grid-renderer').style.setProperty('--ytd-rich-grid-items-per-row','3');
  const css=p.doc.createElement('style');css.textContent=readFileSync('content.css','utf8');p.doc.head.append(css);
  p.doc.documentElement.setAttribute('dark','');
  p.doc.querySelector('[data-watchbox-action="archive"]').click();await tick();
  await returnLoadedVideos(p);
  assert.equal(p.doc.querySelector('.watchbox-saved-grid').style.gridTemplateColumns,'repeat(3, minmax(0, 1fr))');
  assert.equal(p.dom.window.getComputedStyle(p.doc.querySelector('.watchbox-saved-card')).color,'rgb(241, 241, 241)');
  p.dom.window.close();
});
test('contextual actions follow a video card reused by YouTube navigation', async () => {
  const p=await youtube(feedCard,'https://www.youtube.com/');
  assert.equal(p.saved().items.length,0,'Home recommendations must not be imported automatically');
  const card=p.doc.querySelector('ytd-rich-item-renderer');
  card.querySelector('#video-title-link').outerHTML='<a id="video-title-link" href="/watch?v=h6fcK_fRYaI">The Egg</a>';
  card.querySelector('ytd-channel-name').textContent='Kurzgesagt';
  p.doc.dispatchEvent(new p.dom.window.Event('yt-navigate-finish'));
  await new Promise(resolve=>setTimeout(resolve,150));
  const save=card.querySelector('[data-watchbox-action="queue"]');
  assert.equal(save.getAttribute('aria-label'),'Save to Watch later: The Egg');
  save.click();await tick();
  assert.equal(p.saved().items.length,1);
  assert.equal(p.saved().items[0].id,'h6fcK_fRYaI');
  assert.equal(p.saved().items[0].title,'The Egg');
  assert.equal(p.saved().items[0].status,'queue');
  p.dom.window.close();
});
test('native thumbnail actions use the web app clock and archive controls', async () => {
  const p=await youtube('<ytd-rich-item-renderer><a id="thumbnail" href="/watch?v=aircAruvnKk"><yt-thumbnail-view-model><img></yt-thumbnail-view-model></a><a id="video-title-link" href="/watch?v=aircAruvnKk">Neural network</a></ytd-rich-item-renderer>');
  const css=p.doc.createElement('style');css.textContent=readFileSync('content.css','utf8');p.doc.head.append(css);
  const save=p.doc.querySelector('[data-watchbox-action="queue"]');
  const archive=p.doc.querySelector('[data-watchbox-action="archive"]');
  assert.ok(save.querySelector('svg circle'),'Save needs the web app clock icon');
  assert.equal(save.querySelector('svg circle').getAttribute('r'),'7');
  assert.equal(archive.querySelector('svg path').getAttribute('d'),'M3 4h14v4H3zM4 8v9h12V8M8 11h4');
  assert.equal(archive.title,'Dismiss');
  assert.equal(archive.getAttribute('aria-label'),'Dismiss: Neural network');
  assert.equal(p.dom.window.getComputedStyle(save).borderRadius,'50%');
  assert.equal(save.textContent.trim(),'','Thumbnail actions should show icons, with accessible names');
  assert.equal(save.getAttribute('aria-label'),'Save to Watch later: Neural network');
  const card=p.doc.querySelector('ytd-rich-item-renderer');
  card.getBoundingClientRect=()=>({left:20,top:40});
  card.querySelector('#thumbnail').getBoundingClientRect=()=>({left:20,top:40,width:320,height:192});
  card.querySelector('yt-thumbnail-view-model').getBoundingClientRect=()=>({left:20,top:40,width:320,height:180});
  p.dom.window.dispatchEvent(new p.dom.window.Event('resize'));
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(card.querySelector('.watchbox-card-actions').style.top,'90px');
  assert.equal(card.querySelector('.watchbox-card-actions').style.left,'160px');
  assert.equal(card.querySelector('.watchbox-thumbnail-shade').style.height,'180px');
  assert.equal(save.closest('a'),null,'Controls must not be nested inside thumbnail links');
  archive.click();await tick();
  assert.equal(p.saved().items[0].status,'archive');
  p.doc.querySelector('#watchbox-undo').click();await tick();
  assert.equal(p.saved().items[0].status,'inbox');
  p.dom.window.close();
});
test('returned Inbox cards carry the same thumbnail controls as the web app', async t => {
  const p=await youtube('',undefined,false,undefined,{items:[{id:'aircAruvnKk',title:'Neural network',status:'inbox',returnedToInbox:true,addedAt:1}],history:[]});t.after(()=>p.dom.window.close());
  p.doc.querySelector('#watchbox-inbox').click();await tick();
  const card=p.doc.querySelector('.watchbox-saved-card');
  assert.equal(card.querySelector('.watchbox-saved-actions'),null,'Remove the old text controls below the card');
  assert.ok(card.querySelector('[data-watchbox-action="queue"] svg circle'),'Returned cards can be saved for later');
  assert.ok(card.querySelector('[data-watchbox-action="archive"] svg'));
  assert.equal(card.querySelector('[data-watchbox-action="queue"]').tagName,'A');
  assert.match(card.querySelector('[data-watchbox-action="queue"]').href,/watch\?v=aircAruvnKk/);
  assert.equal(p.saved().items[0].status,'inbox');
  p.dom.window.close();
});
test('autoplay previews cannot cover feed controls and the watch player stays native', async () => {
  const p=await youtube(feedCard);
  const css=p.doc.createElement('style');css.textContent=readFileSync('content.css','utf8');p.doc.head.append(css);
  const preview=p.doc.createElement('div');preview.id='video-preview';
  preview.innerHTML='<ytd-video-preview style="display:flex"><video></video></ytd-video-preview>';
  p.doc.querySelector('ytd-app').append(preview);
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(p.dom.window.getComputedStyle(preview).display,'none','The external autoplay layer must not intercept card hover');
  p.doc.querySelector('[data-watchbox-action="queue"]').click();await tick();
  assert.equal(p.saved().items[0].status,'queue');
  p.doc.querySelector('#watchbox-undo').click();await tick();
  assert.equal(p.saved().items[0].status,'inbox');
  p.dom.window.history.pushState({},'', '/watch?v=aircAruvnKk');
  p.doc.querySelector('ytd-browse').hidden=true;
  const watch=p.doc.createElement('ytd-watch-flexy');watch.innerHTML='<div id="movie_player"><video></video></div><ytd-watch-metadata><h1>Neural network</h1></ytd-watch-metadata>';
  p.doc.querySelector('ytd-page-manager').append(watch);
  p.doc.dispatchEvent(new p.dom.window.Event('yt-navigate-finish'));
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.notEqual(p.dom.window.getComputedStyle(preview).display,'none','Feed-only styling must end when opening a video');
  assert.notEqual(p.dom.window.getComputedStyle(watch.querySelector('#movie_player')).display,'none');
  assert.ok(watch.querySelector('#watchbox-player-tools'));
  p.dom.window.close();
});

test('native related videos default to hidden and react to persisted settings without changing Shorts', async t => {
  const p=await youtube('', 'https://www.youtube.com/watch?v=aircAruvnKk');t.after(()=>p.dom.window.close());
  assert.equal(p.doc.documentElement.hasAttribute('data-watchbox-hide-related'),true);
  await p.setPreferences({quiet:false,hideRelated:false});
  assert.equal(p.doc.documentElement.hasAttribute('data-watchbox-hide-related'),false);
  assert.equal(p.doc.documentElement.hasAttribute('data-watchbox-quiet'),false);
  await p.setPreferences({...p.preferences(),hideShorts:true});await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(p.preferences())),{quiet:false,hideShorts:true,hideRelated:false});
  const reopened=await youtube('', 'https://www.youtube.com/watch?v=aircAruvnKk',false,p.preferences());t.after(()=>reopened.dom.window.close());
  assert.equal(reopened.doc.documentElement.hasAttribute('data-watchbox-hide-related'),false);
  assert.equal(reopened.doc.documentElement.hasAttribute('data-watchbox-quiet'),true);
});

test('related-video CSS hides late suggestions reversibly while retaining playback and other watch content', async t => {
  const p=await youtube('', 'https://www.youtube.com/watch?v=aircAruvnKk');t.after(()=>p.dom.window.close());
  const css=p.doc.createElement('style');css.textContent=existsSync('related.css')?readFileSync('related.css','utf8'):'';p.doc.head.append(css);
  const fixture=p.doc.createElement('section');fixture.innerHTML=`<div id="secondary"><div id="items" class="ytd-watch-next-secondary-results-renderer">Related</div><ytd-playlist-panel-renderer>Playlist</ytd-playlist-panel-renderer><ytd-live-chat-frame>Chat</ytd-live-chat-frame></div><div class="ytd-watch-grid"><div id="contents">Grid</div></div><div class="ytp-pause-overlay">Paused</div><div class="html5-endscreen">Finished</div><div class="ytp-fullscreen-grid">Fullscreen suggestions</div><div class="ytp-ce-element">Creator card</div><div class="ytp-ce-hide-button-container">Hide card</div><video></video><div class="ytp-chrome-controls">Controls</div><div class="ytp-autonav-toggle-button">Autoplay</div><ytd-comments>Comments</ytd-comments><div class="html5-endscreen mweb-endscreen">Mobile</div>`;p.doc.body.append(fixture);
  const suggestions=fixture.querySelectorAll('#items,#contents,.ytp-pause-overlay,.html5-endscreen:not(.mweb-endscreen),.ytp-fullscreen-grid,.ytp-ce-element,.ytp-ce-hide-button-container');
  for(const element of suggestions)assert.equal(p.dom.window.getComputedStyle(element).display,'none',element.className);
  for(const element of fixture.querySelectorAll('video,.ytp-chrome-controls,.ytp-autonav-toggle-button,ytd-comments,ytd-playlist-panel-renderer,ytd-live-chat-frame,.mweb-endscreen,#secondary'))assert.notEqual(p.dom.window.getComputedStyle(element).display,'none',element.tagName);
  await p.setPreferences({hideRelated:false});
  for(const element of suggestions)assert.notEqual(p.dom.window.getComputedStyle(element).display,'none');
});

test('extension settings persist related-video choices without replacing existing preferences', async t => {
  const manifest=JSON.parse(readFileSync('manifest.json','utf8'));
  assert.equal(manifest.options_ui?.page,'settings.html','Firefox Preferences needs a settings page');
  assert.ok(manifest.content_scripts[0].css.includes('related.css'));
  const dom=new JSDOM(readFileSync('settings.html','utf8'),{url:'https://extension.test/settings.html',runScripts:'outside-only'});t.after(()=>dom.window.close());
  let preferences={quiet:false,hideRelated:false,futureOption:'kept'};
  dom.window.browser={runtime:{getManifest:()=>JSON.parse(readFileSync('manifest.json','utf8'))},storage:{local:{get:async()=>({watchboxPreferences:preferences}),set:async data=>preferences=JSON.parse(JSON.stringify(data.watchboxPreferences))}}};
  for(const script of dom.window.document.querySelectorAll('script[src]'))dom.window.eval(readFileSync(script.getAttribute('src'),'utf8'));await tick();
  const checkbox=dom.window.document.querySelector('#hide-related');assert.equal(checkbox.checked,false);
  assert.equal(dom.window.document.body.textContent.includes('embedded player'),false,'Settings should describe native YouTube only');
  checkbox.checked=true;checkbox.dispatchEvent(new dom.window.Event('change'));await tick();
  assert.deepEqual(preferences,{quiet:false,hideRelated:true,futureOption:'kept'});
  assert.equal(dom.window.document.querySelector('[role=status]').textContent,'Saved');
  dom.window.browser.storage.local.set=async()=>{throw Error('Disk full');};
  checkbox.checked=false;checkbox.dispatchEvent(new dom.window.Event('change'));await tick();
  assert.equal(checkbox.checked,true);assert.equal(checkbox.disabled,false);
  assert.equal(dom.window.document.querySelector('[role=status]').textContent,'Could not save. Try again.');
  assert.equal(preferences.hideRelated,true);
});

async function settingsPage(initialPreferences={},version=JSON.parse(readFileSync('manifest.json','utf8')).version) {
  const dom=new JSDOM(readFileSync('settings.html','utf8'),{url:'https://extension.test/settings.html',runScripts:'outside-only'});
  let preferences=structuredClone(initialPreferences);const listeners=[];
  dom.window.browser={runtime:{getManifest:()=>({version})},storage:{local:{get:async()=>({watchboxPreferences:structuredClone(preferences)}),set:async data=>{preferences=JSON.parse(JSON.stringify(data.watchboxPreferences));for(const listener of listeners)listener({watchboxPreferences:{newValue:preferences}},'local');}},onChanged:{addListener:fn=>listeners.push(fn)}}};
  for(const script of dom.window.document.querySelectorAll('script[src]'))dom.window.eval(readFileSync(script.getAttribute('src'),'utf8'));
  await tick();
  return {dom,doc:dom.window.document,preferences:()=>preferences};
}
test('settings show the installed version with local Help and the GitHub issue link',async t=>{
  const p=await settingsPage({},'9.8.7');t.after(()=>p.dom.window.close());
  const footer=p.doc.querySelector('footer');assert.ok(footer,'Settings need version and support links');
  assert.match(footer.textContent,/Watchbox 9\.8\.7/);
  const links=[...footer.querySelectorAll('a')];
  const help=links.find(link=>link.textContent==='Help'),issue=links.find(link=>link.textContent==='Report an issue');
  assert.ok(help);assert.equal(help.getAttribute('href'),'help.html');
  assert.ok(issue);assert.equal(issue.href,'https://github.com/esoxjem/watchbox/issues/new');
  assert.equal(issue.target,'_blank');assert.ok(issue.relList.contains('noopener'));
});
test('bundled Help explains Inbox, account saves, local decisions and restoring YouTube',t=>{
  assert.ok(existsSync('help.html'),'Help must be included in the extension');
  const dom=new JSDOM(readFileSync('help.html','utf8'),{url:'https://extension.test/help.html'});t.after(()=>dom.window.close());
  const doc=dom.window.document,text=doc.querySelector('main').textContent;
  assert.equal(doc.querySelector('h1').textContent,'Watchbox help');
  assert.match(text,/14 days/);assert.match(text,/1.*30 days/);
  assert.match(text,/signed-in YouTube account/);assert.match(text,/Dismiss/);assert.match(text,/Undo/i);
  assert.match(text,/Watchbox enabled/);assert.match(text,/without erasing/);
  assert.match(text,/search suggestions/i);assert.match(text,/matching video results/);
  assert.match(text,/English/);
  assert.ok(doc.querySelector('a[href="settings.html"]'),'Help needs a way back to settings');
  assert.ok(doc.querySelector('a[href="https://github.com/esoxjem/watchbox/issues/new"]'));
  assert.equal(doc.querySelector('script'),null,'Help should work offline without scripts');
});
const optionLabels={enabled:'Watchbox enabled',darkMode:'Dark mode',hideHomeFeed:'Hide Home feed',redirectToSubscriptions:'Redirect to Inbox',hideVideoSidebar:'Hide video sidebar',hideRecommended:'Hide recommendations',hideLiveChat:'Hide live chat',hidePlaylist:'Hide playlist panel',hideFundraiser:'Hide fundraisers',hideEndScreenFeed:'Hide end-screen suggestions',hideEndScreenCards:'Hide creator end-screen cards',hideShorts:'Hide Shorts',hideComments:'Hide comments',hideProfilePhotos:'Hide commenter photos',hideMixes:'Hide Mixes',hideMerch:'Hide shopping and ticket offers',hideVideoInfo:'Hide video details',hideButtonsBar:'Hide video action buttons',hideChannel:'Hide channel info',hideDescription:'Hide description',hideTopHeader:'Hide YouTube header',hideNotifications:'Hide notification bell',hideInaptSearchResults:'Hide search suggestions',hideExploreTrending:'Hide Explore and Trending',hideMoreFromYouTube:'Hide More from YouTube',hideSubscriptions:'Hide Subscriptions',disableAnnotations:'Disable annotations'};
test('Inbox preferences default to fourteen days and bound whole-day limits to one through thirty',()=>{
  const context=vm.createContext({});vm.runInContext(readFileSync('preferences.js','utf8'),context);
  const resolve=context.WatchboxPreferences.resolve;
  assert.equal(resolve().inboxDays,14);
  for(const days of [1,7,14,21,30])assert.equal(resolve({inboxDays:days}).inboxDays,days);
  assert.equal(resolve({inboxDays:90}).inboxDays,30);
  assert.equal(resolve({inboxDays:0}).inboxDays,1);
  for(const value of [undefined,null,'30',7.5,NaN,Infinity])assert.equal(resolve({inboxDays:value}).inboxDays,14);
});
test('settings explain the Inbox window and persist a bounded day limit without replacing preferences',async t=>{
  const p=await settingsPage({hideShorts:false,futureOption:'kept'});t.after(()=>p.dom.window.close());
  const input=p.doc.querySelector('[data-preference="inboxDays"]');
  assert.ok(input,'Inbox needs an age-limit setting');
  assert.equal(input.type,'number');assert.equal(input.min,'1');assert.equal(input.max,'30');assert.equal(input.step,'1');
  assert.equal(input.value,'14');assert.equal(input.disabled,false);
  assert.equal(input.closest('fieldset').querySelector('legend').textContent,'Inbox');
  assert.match(input.closest('label').textContent,/Show the last.*days/);
  const hint=p.doc.getElementById(input.getAttribute('aria-describedby'));
  assert.match(hint.textContent,/14 days/);assert.match(hint.textContent,/Subscriptions/);
  input.value='30';input.dispatchEvent(new p.dom.window.Event('change'));await tick();
  assert.deepEqual(p.preferences(),{hideShorts:false,futureOption:'kept',inboxDays:30});
  const reopened=await settingsPage(p.preferences());t.after(()=>reopened.dom.window.close());
  assert.equal(reopened.doc.querySelector('[data-preference="inboxDays"]').value,'30');
  for(const value of ['31','0','7.5','']) {
    input.value=value;input.dispatchEvent(new p.dom.window.Event('change'));await tick();
    assert.equal(p.preferences().inboxDays,30,'Invalid limits must not be saved');
    assert.match(p.doc.querySelector('[role=status]').textContent,/1.*30/);
  }
  p.dom.window.browser.storage.local.set=async()=>{throw Error('Disk full');};
  input.value='7';input.dispatchEvent(new p.dom.window.Event('change'));await tick();
  assert.equal(input.value,'30','Failed saves restore the committed limit');
  assert.equal(input.disabled,false);
  assert.equal(p.doc.querySelector('[role=status]').textContent,'Could not save. Try again.');
});
test('Home redirect settings describe Inbox while preserving existing saved preferences',async t=>{
  const p=await settingsPage({hideHomeFeed:true,redirectToSubscriptions:true});t.after(()=>p.dom.window.close());
  const redirect=p.doc.querySelector('[data-preference="redirectToSubscriptions"]');
  assert.equal(redirect.closest('label').textContent,'Redirect to Inbox');
  assert.equal(redirect.checked,true,'Existing redirect preferences must remain enabled');
});
test('every requested setting is accessible and saves independently without losing library preferences',async t=>{
  const p=await settingsPage({quiet:false,hideRelated:false,futureOption:'kept'});t.after(()=>p.dom.window.close());
  for(const [key,label]of Object.entries(optionLabels)) {
    const input=p.doc.querySelector(`[data-preference="${key}"]`);
    assert.ok(input,`${label} control is missing`);
    assert.equal(input.closest('label').textContent.trim(),label);
    assert.equal(input.disabled,false);
    input.click();await tick();
    assert.equal(p.preferences()[key],input.checked,`${label} must persist`);
    assert.equal(p.preferences().futureOption,'kept');
  }
  const reopened=await settingsPage(p.preferences());t.after(()=>reopened.dom.window.close());
  for(const key of Object.keys(optionLabels))assert.equal(reopened.doc.querySelector(`[data-preference="${key}"]`).checked,p.preferences()[key]);
});

function pageCSS(p) {
  for(const file of JSON.parse(readFileSync('manifest.json','utf8')).content_scripts[0].css) {
    const style=p.doc.createElement('style');style.textContent=readFileSync(file,'utf8');p.doc.head.append(style);
  }
}
const shown=(p,selector)=>p.dom.window.getComputedStyle(p.doc.querySelector(selector)).display!=='none';
test('sidebar components and end screens can be hidden independently on open YouTube pages',async t=>{
  const p=await youtube('<ytd-watch-flexy><div id="secondary" class="ytd-watch-flexy"><div id="items" class="ytd-watch-next-secondary-results-renderer">Related</div><ytd-playlist-panel-renderer id="playlist">Playlist</ytd-playlist-panel-renderer><ytd-live-chat-frame id="chat">Chat</ytd-live-chat-frame><div id="donation-shelf">Fundraiser</div></div><div class="ytp-pause-overlay">Paused</div><div class="html5-endscreen">Feed</div><div class="ytp-ce-element">Card</div><video></video><div class="ytp-chrome-controls">Controls</div></ytd-watch-flexy>','https://www.youtube.com/watch?v=aircAruvnKk',false,{hideRelated:false});t.after(()=>p.dom.window.close());pageCSS(p);
  const targets={hideVideoSidebar:'#secondary',hideRecommended:'#secondary #items',hideLiveChat:'#chat',hidePlaylist:'#playlist',hideFundraiser:'#donation-shelf',hideEndScreenFeed:'.html5-endscreen',hideEndScreenCards:'.ytp-ce-element'};
  for(const [key,target] of Object.entries(targets)) {
    await p.setPreferences({hideRelated:false,[key]:true});
    assert.equal(shown(p,target),false,`${key} must hide its surface`);
    if(key!=='hideVideoSidebar')for(const other of Object.values(targets).filter(value=>value!==target))assert.equal(shown(p,other),true,`${key} must leave ${other} visible`);
    assert.equal(shown(p,'video'),true);assert.equal(shown(p,'.ytp-chrome-controls'),true);
    await p.setPreferences({hideRelated:false});assert.equal(shown(p,target),true,`${key} must be reversible`);
  }
});
async function independentHiding(t,html,targets) {
  const p=await youtube(html,'https://www.youtube.com/watch?v=aircAruvnKk',false,{hideRelated:false,quiet:false});t.after(()=>p.dom.window.close());pageCSS(p);
  const base={hideRelated:false,quiet:false};
  for(const [key,target]of Object.entries(targets)) {
    await p.setPreferences({...base,[key]:true});
    assert.equal(shown(p,target),false,`${key} must hide ${target}`);
    for(const other of Object.values(targets).filter(value=>value!==target)) {
      const hiddenByInfo=key==='hideVideoInfo' && p.doc.querySelector(other).closest('ytd-watch-metadata');
      assert.equal(shown(p,other),!hiddenByInfo,`${key} must preserve unrelated ${other}`);
    }
    assert.equal(shown(p,'#movie_player'),true,'The player must remain visible');
    await p.setPreferences(base);assert.equal(shown(p,target),true,`${key} must restore its target`);
  }
}
test('comments and video information settings hide only the requested surface',async t=>{
  await independentHiding(t,'<div id="movie_player"><video></video></div><ytd-comments id="comments">Comments</ytd-comments><ytd-comment-view-model><a id="author-thumbnail">Avatar</a></ytd-comment-view-model><ytd-watch-metadata><div id="above-the-fold">Info</div><div id="actions" class="ytd-watch-metadata">Actions</div><div id="owner" class="ytd-watch-metadata">Channel</div><div id="description" class="ytd-watch-metadata">Description</div></ytd-watch-metadata>',{hideComments:'#comments',hideProfilePhotos:'#author-thumbnail',hideVideoInfo:'#above-the-fold',hideButtonsBar:'#actions',hideChannel:'#owner',hideDescription:'#description'});
});
test('home, discovery, header and content filters remain scoped and reversible',async t=>{
  await independentHiding(t,'<div id="movie_player"><video></video></div><ytd-browse page-subtype="home"><ytd-rich-grid-renderer id="home-feed">Home</ytd-rich-grid-renderer></ytd-browse><ytd-rich-item-renderer id="short-card"><a href="/shorts/sI8NsYIyQ2A">Short</a></ytd-rich-item-renderer><ytd-radio-renderer id="mix">Mix</ytd-radio-renderer><ytd-merch-shelf-renderer id="merch">Merch</ytd-merch-shelf-renderer><ytd-notification-topbar-button-renderer id="notifications">Notifications</ytd-notification-topbar-button-renderer><ytd-search><div id="primary"><ytd-shelf-renderer id="search-suggestions">For you</ytd-shelf-renderer><ytd-video-renderer id="search-result">Matching video</ytd-video-renderer></div></ytd-search><ytd-guide-section-renderer id="explore"><a href="/feed/storefront">Shopping</a></ytd-guide-section-renderer><ytd-guide-section-renderer id="more-youtube"><a href="https://music.youtube.com/">Music</a></ytd-guide-section-renderer><a id="subscriptions-link" href="/feed/subscriptions">Subscriptions</a>',{hideHomeFeed:'#home-feed',hideShorts:'#short-card',hideMixes:'#mix',hideMerch:'#merch',hideTopHeader:'#masthead',hideNotifications:'#notifications',hideInaptSearchResults:'#search-suggestions',hideExploreTrending:'#explore',hideMoreFromYouTube:'#more-youtube',hideSubscriptions:'#subscriptions-link'});
});
test('turning Watchbox off restores native content and stops collection without erasing decisions',async t=>{
  const p=await youtube(feedCard);t.after(()=>p.dom.window.close());pageCSS(p);
  p.doc.querySelector('[data-watchbox-action="archive"]').click();await tick();
  const retained=JSON.parse(JSON.stringify(p.saved()));
  await p.setPreferences({enabled:false,hideComments:true,hideRelated:true});
  assert.equal(shown(p,'#watchbox-sidebar'),false,'Watchbox controls should be disabled');
  assert.equal(p.doc.querySelector('#watchbox-toast').hidden,true,'Turning Watchbox off must dismiss an active toast');
  assert.equal(shown(p,'ytd-rich-item-renderer'),true,'Archived cards should return to native YouTube while off');
  const extra=p.doc.createElement('ytd-rich-item-renderer');extra.innerHTML='<a id="video-title-link" href="/watch?v=h6fcK_fRYaI">The Egg</a>';p.doc.querySelector('ytd-rich-grid-renderer').append(extra);
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.deepEqual(JSON.parse(JSON.stringify(p.saved())),retained,'Off must not collect newly loaded videos');
  assert.equal(p.doc.documentElement.hasAttribute('data-watchbox-hide-comments'),false);
  assert.equal(p.doc.documentElement.hasAttribute('data-watchbox-hide-related'),false);
  assert.equal(p.doc.documentElement.hasAttribute('data-watchbox-quiet'),false);
  await p.setPreferences({enabled:true});await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(shown(p,'#watchbox-sidebar'),true);
  assert.equal(shown(p,'ytd-rich-item-renderer'),false,'Archive decisions should return when enabled');
  assert.equal(p.saved().items.length,2);
});
test('Home redirects only when requested, with Subscriptions available, including SPA revisits',()=>{
  const dom=new JSDOM('<a id="logo" href="/">YouTube</a>');
  const destinations=[];const location={pathname:'/',href:'https://www.youtube.com/',replace:path=>destinations.push(path)};
  const context=vm.createContext({document:dom.window.document,location,URL});
  vm.runInContext(readFileSync('preferences.js','utf8'),context);vm.runInContext(readFileSync('page-settings.js','utf8'),context);
  const apply=context.WatchboxPageSettings.apply;
  apply({hideHomeFeed:true,redirectToSubscriptions:true});
  assert.deepEqual(destinations,['/feed/subscriptions#watchbox-inbox'],'The Home route must redirect to Inbox');
  for(const options of [{hideHomeFeed:false,redirectToSubscriptions:true},{hideHomeFeed:true,redirectToSubscriptions:false},{enabled:false,hideHomeFeed:true,redirectToSubscriptions:true},{hideHomeFeed:true,redirectToSubscriptions:true,hideSubscriptions:true}])apply(options);
  assert.equal(destinations.length,1,'Off or hidden subscriptions must not redirect');
  location.pathname='/watch';apply({hideHomeFeed:true,redirectToSubscriptions:true});assert.equal(destinations.length,1);
  location.pathname='/';apply({hideHomeFeed:true,redirectToSubscriptions:true});assert.equal(destinations.length,2,'Returning Home through SPA navigation must redirect');
  dom.window.close();
});
test('settings omit the retired Disable Autoplay option even when previously saved',async t=>{
  const p=await settingsPage({disableAutoplay:true});t.after(()=>p.dom.window.close());
  assert.equal(p.doc.querySelector('[data-preference="disableAutoplay"]'),null);
  assert.equal(p.doc.body.textContent.includes('Disable Autoplay'),false);
});

test('Disable Annotations removes late overlays and turns off only the Annotations player option',async t=>{
  const p=await youtube('<div id="movie_player"><video></video><div class="ytp-iv-video-content">Annotation</div><div class="ytp-ce-element">Creator card</div><div role="menuitemcheckbox" class="ytp-menuitem" aria-checked="true"><div class="ytp-menuitem-label">Annotations</div></div><div id="captions" role="menuitemcheckbox" class="ytp-menuitem" aria-checked="true"><div class="ytp-menuitem-label">Subtitles/CC</div></div></div>','https://www.youtube.com/watch?v=aircAruvnKk',false,{hideRelated:false});t.after(()=>p.dom.window.close());pageCSS(p);
  const annotation=p.doc.querySelector('.ytp-menuitem');let clicks=0;annotation.onclick=()=>{clicks++;annotation.setAttribute('aria-checked','false');};
  await p.setPreferences({hideRelated:false,disableAnnotations:true});await tick();
  assert.equal(shown(p,'.ytp-iv-video-content'),false,'Annotations must be hidden');
  assert.equal(annotation.getAttribute('aria-checked'),'false','The native Annotations option must turn off');assert.equal(clicks,1);
  assert.equal(p.doc.querySelector('#captions').getAttribute('aria-checked'),'true','Captions must not be toggled');assert.equal(shown(p,'.ytp-ce-element'),true,'Creator cards remain a separate choice');
  const late=p.doc.createElement('div');late.className='ytp-iv-video-content';p.doc.querySelector('#movie_player').append(late);assert.equal(p.dom.window.getComputedStyle(late).display,'none');
  await p.setPreferences({hideRelated:false,disableAnnotations:false});assert.equal(shown(p,'.ytp-iv-video-content'),true);
});

test('clicking Watchbox in the browser toolbar opens its settings page',async()=>{
  const manifest=JSON.parse(readFileSync('manifest.json','utf8'));
  assert.ok(manifest.action,'A clickable browser action is missing');
  let listener,opened=0;
  const context=vm.createContext({URL,browser:{action:{onClicked:{addListener:fn=>listener=fn}},runtime:{openOptionsPage:async()=>{opened++;}},storage:{local:{get:async()=>({})},onChanged:{addListener(){}}},webRequest:{onBeforeRequest:{addListener(){}}},tabs:{update:async()=>{}}}});
  for(const script of manifest.background?.scripts||[])vm.runInContext(readFileSync(script,'utf8'),context);
  assert.equal(typeof listener,'function','Toolbar action must have a click handler');
  await listener();assert.equal(opened,1);
});
test('watch pages contain oversized ambient effects without clipping vertical content or other pages',async t=>{
  const p=await youtube('<ytd-watch-flexy style="overflow-x:visible;overflow-y:visible"><div id="primary"><div id="cinematics"><canvas style="width:1500px"></canvas></div><video></video></div></ytd-watch-flexy>','https://www.youtube.com/watch?v=aircAruvnKk');t.after(()=>p.dom.window.close());pageCSS(p);
  const watch=p.doc.querySelector('ytd-watch-flexy');
  assert.equal(p.dom.window.getComputedStyle(watch).overflowX,'clip','Ambient light must not create horizontal scrolling outside the watch page');
  assert.equal(p.dom.window.getComputedStyle(watch).overflowY,'visible','Comments and metadata must remain vertically accessible');
  assert.notEqual(p.dom.window.getComputedStyle(p.doc.querySelector('ytd-browse')).overflowX,'clip','Browse pages must keep their native scrolling');
  watch.setAttribute('fullscreen','');assert.equal(p.dom.window.getComputedStyle(watch).overflowX,'visible','Fullscreen must keep native overflow behavior');watch.removeAttribute('fullscreen');
  await p.setPreferences({enabled:false});assert.equal(p.dom.window.getComputedStyle(watch).overflowX,'visible','Disabling Watchbox must restore native layout');
});

test('archiving offers Undo in a floating status message instead of the feed bar',async t=>{
  const p=await youtube(feedCard);t.after(()=>p.dom.window.close());pageCSS(p);
  assert.equal(p.doc.querySelector('#watchbox-sidebar #watchbox-undo'),null,'Undo must leave the feed bar');
  const toast=p.doc.querySelector('#watchbox-toast');
  assert.ok(toast,'An action message must be available on the page');
  assert.equal(toast.hidden,true,'Initial collection must not show a message');
  assert.equal(toast.getAttribute('role'),'status');
  assert.ok(['fixed','absolute'].includes(p.dom.window.getComputedStyle(toast).position),'The message must not shift the grid');
  p.doc.querySelector('[data-watchbox-action="archive"]').click();await tick();
  assert.equal(p.saved().items[0].status,'archive');
  assert.equal(toast.hidden,false);
  assert.equal(toast.querySelector('#watchbox-toast-message').textContent,'Dismissed.');
  const undo=toast.querySelector('#watchbox-undo');
  assert.equal(undo.textContent,'UNDO');assert.equal(undo.hidden,false);assert.equal(undo.disabled,false);
  p.doc.dispatchEvent(new p.dom.window.Event('yt-navigate-finish'));await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(toast.hidden,false,'Background synchronization must not erase the action message');
  undo.click();await tick();
  assert.equal(p.saved().items[0].status,'inbox');
  assert.equal(p.saved().history.length,0);
  assert.equal(p.doc.querySelector('ytd-rich-item-renderer').hasAttribute('data-watchbox-hidden'),false);
  assert.equal(toast.querySelector('#watchbox-toast-message').textContent,'Undone.');
  assert.equal(undo.hidden,true,'The same action must not be undone twice');
});

function toastClock(p) {
  const nativeSet=p.dom.window.setTimeout.bind(p.dom.window),nativeClear=p.dom.window.clearTimeout.bind(p.dom.window);
  const pending=new Map();let now=0,id=-1;
  p.dom.window.setTimeout=(callback,delay,...args)=>{
    if(delay<1000)return nativeSet(callback,delay,...args);
    const key=id--;pending.set(key,{at:now+delay,run:()=>callback(...args)});return key;
  };
  p.dom.window.clearTimeout=key=>{if(!pending.delete(key))nativeClear(key);};
  return {advance:elapsed=>{now+=elapsed;for(const [key,value] of pending)if(value.at<=now){pending.delete(key);value.run();}}};
}

test('action toasts expire after eight seconds but remain usable while hovered or focused',async t=>{
  const p=await youtube(feedCard);t.after(()=>p.dom.window.close());const clock=toastClock(p);
  const toast=p.doc.querySelector('#watchbox-toast');
  p.doc.querySelector('[data-watchbox-action="archive"]').click();await tick();
  clock.advance(7999);assert.equal(toast.hidden,false);
  clock.advance(1);assert.equal(toast.hidden,true,'Action messages must dismiss themselves');
  await openAll(p);
  p.doc.querySelector('ytd-rich-item-renderer [data-watchbox-action="inbox"]').click();await tick();
  toast.dispatchEvent(new p.dom.window.MouseEvent('mouseenter'));
  clock.advance(20000);assert.equal(toast.hidden,false,'Hover must pause dismissal');
  toast.dispatchEvent(new p.dom.window.MouseEvent('mouseleave'));
  clock.advance(7999);assert.equal(toast.hidden,false);
  p.doc.querySelector('#watchbox-undo').focus();
  clock.advance(20000);assert.equal(toast.hidden,false,'Keyboard focus must keep Undo available');
  p.doc.querySelector('#watchbox-undo').blur();
  clock.advance(7999);assert.equal(toast.hidden,false);
  clock.advance(1);assert.equal(toast.hidden,true,'Leaving the toast starts a fresh dismissal period');
});

test('a failed toast Undo preserves the action and offers a retry',async t=>{
  const p=await youtube(feedCard);t.after(()=>p.dom.window.close());
  p.doc.querySelector('[data-watchbox-action="archive"]').click();await tick();
  const undo=p.doc.querySelector('#watchbox-undo'),toast=p.doc.querySelector('#watchbox-toast');
  const archived=JSON.parse(JSON.stringify(p.saved()));
  p.setFailure(true);undo.click();await tick();
  assert.equal(undo.hidden,false,'A failed Undo must remain available to retry');
  assert.equal(undo.disabled,false);
  assert.equal(toast.querySelector('#watchbox-toast-message').textContent,'Could not save. Try again.');
  assert.deepEqual(JSON.parse(JSON.stringify(p.saved())),archived,'Failed writes must preserve the archived decision and history');
  p.setFailure(false);undo.click();await tick();
  assert.equal(p.saved().items[0].status,'inbox');assert.equal(p.saved().history.length,0);
  assert.equal(undo.hidden,true);
});

test('feed action toasts float outside the video layout after removing filters',async t=>{
  const p=await youtube(feedCard);t.after(()=>p.dom.window.close());pageCSS(p);
  const toast=p.doc.querySelector('#watchbox-toast'),grid=p.doc.querySelector('ytd-rich-grid-renderer');
  assert.equal(p.doc.querySelector('#watchbox-feed-row'),null);
  assert.equal(grid.previousElementSibling.id,'watchbox-saved-shelf');
  assert.equal(toast.parentElement,p.doc.body);
  const style=p.dom.window.getComputedStyle(toast);
  assert.equal(style.position,'fixed');assert.equal(style.bottom,'24px');
  p.doc.querySelector('[data-watchbox-action="archive"]').click();await tick();
  assert.equal(toast.hidden,false);assert.equal(toast.querySelector('#watchbox-toast-message').textContent,'Dismissed.');
  assert.equal(grid.previousElementSibling.id,'watchbox-saved-shelf');
  toast.querySelector('#watchbox-undo').click();await tick();
  assert.equal(p.saved().items[0].status,'inbox');
});
