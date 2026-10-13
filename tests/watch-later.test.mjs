import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {webcrypto, createHash} from 'node:crypto';

function page(t) {
  const dom=new JSDOM('<ytd-rich-item-renderer><a id="video-title-link" href="/watch?v=f6CivhX4tXM">What is Virtual Memory?</a><button aria-label="More actions">More</button></ytd-rich-item-renderer>',{url:'https://www.youtube.com/feed/subscriptions',runScripts:'outside-only'});
  t.after(()=>dom.window.close());
  dom.window.eval(readFileSync('capture.js','utf8'));
  if(existsSync('watch-later.js'))dom.window.eval(readFileSync('watch-later.js','utf8'));
  return {window:dom.window,doc:dom.window.document,card:dom.window.document.querySelector('ytd-rich-item-renderer')};
}

function continuationItem(token) {
  return {continuationItemRenderer:{continuationEndpoint:{commandMetadata:{webCommandMetadata:{apiUrl:'/youtubei/v1/browse'}},continuationCommand:{token,request:'CONTINUATION_REQUEST_TYPE_BROWSE'}}}};
}
function playlistHTML(ids,playlistId='WL',{continuation,config}={}) {
  const contents=ids.map(videoId=>({playlistVideoRenderer:{videoId}}));
  if(continuation)contents.push(continuationItem(continuation));
  const data={contents:{twoColumnBrowseResultsRenderer:{tabs:[{tabRenderer:{content:{sectionListRenderer:{contents:[{itemSectionRenderer:{contents:[{playlistVideoListRenderer:{playlistId,targetId:playlistId,contents}}]}}]}}}}]}}};
  return `<script>var ytInitialData = ${JSON.stringify(data)};</script>${config?`<script>ytcfg.set(${JSON.stringify(config)});</script>`:''}`;
}

test('production saving no longer exposes the temporary trial button binding',t=>{
  const p=page(t);
  assert.equal(p.window.WatchboxWatchLater.bind,undefined,'The trial binding duplicates production save orchestration');
  assert.equal(typeof p.window.WatchboxWatchLater.save,'function');
});

test('confirmation reads fresh authenticated Watch Later membership for the exact video',async t=>{
  const p=page(t),requests=[];
  p.window.fetch=async(url,options)=>{requests.push({url,options});return {ok:true,url:'https://www.youtube.com/playlist?list=WL',text:async()=>playlistHTML(['f6CivhX4tXM'])};};
  assert.equal(typeof p.window.WatchboxWatchLater.confirm,'function','Watch Later membership confirmation is missing');
  assert.equal(await p.window.WatchboxWatchLater.confirm('f6CivhX4tXM'),'confirmed');
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,'https://www.youtube.com/playlist?list=WL');
  assert.equal(requests[0].options.cache,'no-store');
  assert.equal(requests[0].options.credentials,'same-origin');
});

test('confirmation finds an exact Watch Later entry beyond multiple playlist pages',async t=>{
  const p=page(t),requests=[],context={client:{clientName:'WEB',clientVersion:'test-version'},user:{}};
  Object.defineProperty(p.window.crypto,'subtle',{value:webcrypto.subtle});p.window.TextEncoder=TextEncoder;
  p.doc.cookie='SAPISID=test-session';
  p.window.fetch=async(url,options)=>{
    requests.push({url,options});
    if(requests.length===1)return {ok:true,url,text:async()=>playlistHTML(['aircAruvnKk'],'WL',{continuation:'page-2',config:{INNERTUBE_CONTEXT:context,SESSION_INDEX:'2',DELEGATED_SESSION_ID:'test-brand'}})};
    assert.equal(url,'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false');
    assert.equal(options.method,'POST');assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');
    const [,timestamp,hash]=/^SAPISIDHASH (\d+)_([a-f0-9]+)$/.exec(options.headers.Authorization)||[];
    assert.ok(timestamp,'Private playlist reads need YouTube session authentication');
    assert.equal(hash,createHash('sha1').update(`${timestamp} test-session https://www.youtube.com`).digest('hex'));
    assert.equal(options.headers['X-Goog-AuthUser'],'2');assert.equal(options.headers['X-Goog-PageId'],'test-brand');
    assert.equal(options.signal,requests[0].options.signal,'Every page shares the confirmation deadline');
    const body=JSON.parse(options.body);assert.deepEqual(body.context,context);
    assert.equal(body.continuation,requests.length===2?'page-2':'page-3');
    return {ok:true,url,json:async()=>({onResponseReceivedActions:[{appendContinuationItemsAction:{targetId:'WL',continuationItems:requests.length===2?[{playlistVideoRenderer:{videoId:'h6fcK_fRYaI'}},continuationItem('page-3')]:[{playlistVideoRenderer:{videoId:'f6CivhX4tXM'}}]}}]})};
  };
  assert.equal(await p.window.WatchboxWatchLater.confirm('f6CivhX4tXM',{retryDelayMs:1,timeoutMs:100}),'confirmed');
  assert.equal(requests.length,3);
});

test('confirmation follows YouTube command-executor playlist continuations',async t=>{
  const p=page(t);let pages=0;
  Object.defineProperty(p.window.crypto,'subtle',{value:webcrypto.subtle});p.window.TextEncoder=TextEncoder;p.doc.cookie='SAPISID=test-session';
  const html=playlistHTML([],'WL',{continuation:'wrapped-page',config:{INNERTUBE_CONTEXT:{client:{clientName:'WEB',clientVersion:'test'}}}});
  const command=continuationItem('wrapped-page').continuationItemRenderer.continuationEndpoint;
  const wrapped={clickTrackingParams:'tracking',commandExecutorCommand:{commands:[{clickTrackingParams:'other',feedbackEndpoint:{feedbackToken:'unrelated'}},command]}};
  p.window.fetch=async(url,options)=>{
    if(url.includes('/playlist?'))return {ok:true,url,text:async()=>html.replace(JSON.stringify(command),JSON.stringify(wrapped))};
    pages++;assert.equal(JSON.parse(options.body).continuation,'wrapped-page');
    return {ok:true,url,json:async()=>({onResponseReceivedActions:[{appendContinuationItemsAction:{targetId:'WL',continuationItems:[{playlistVideoRenderer:{videoId:'f6CivhX4tXM'}}]}}]})};
  };
  assert.equal(await p.window.WatchboxWatchLater.confirm('f6CivhX4tXM',{retryDelayMs:1,timeoutMs:100}),'confirmed');
  assert.equal(pages,1);
});

test('confirmation ignores unrelated continuation items and retries after a repeated playlist token',async t=>{
  const p=page(t);let reads=0,pages=0;
  Object.defineProperty(p.window.crypto,'subtle',{value:webcrypto.subtle});p.window.TextEncoder=TextEncoder;p.doc.cookie='SAPISID=test-session';
  p.window.fetch=async(url)=>{
    if(url.includes('/playlist?'))return {ok:true,url,text:async()=>++reads===1?playlistHTML([],'WL',{continuation:'repeated',config:{INNERTUBE_CONTEXT:{client:{clientName:'WEB',clientVersion:'test'}}}}):playlistHTML(['f6CivhX4tXM'])};
    pages++;
    return {ok:true,url,json:async()=>({
      recommendation:{playlistVideoRenderer:{videoId:'f6CivhX4tXM'}},
      onResponseReceivedEndpoints:[
        {appendContinuationItemsAction:{targetId:'recommendations',continuationItems:[{playlistVideoRenderer:{videoId:'f6CivhX4tXM'}}]}},
        {appendContinuationItemsAction:{targetId:'WL',continuationItems:[continuationItem('repeated')]}}
      ]
    })};
  };
  assert.equal(await p.window.WatchboxWatchLater.confirm('f6CivhX4tXM',{retryDelayMs:1,timeoutMs:100}),'confirmed');
  assert.equal(reads,2,'A recommendation must not confirm playlist membership');
  assert.equal(pages,1,'Repeated tokens must stop a pagination cycle');
});

test('confirmation rejects failed or redirected continuation responses',async t=>{
  for(const response of [{ok:false,url:'https://www.youtube.com/youtubei/v1/browse'}, {ok:true,url:'https://accounts.google.com/ServiceLogin'}, {ok:true,url:'https://www.youtube.com/playlist?list=LL'}]) {
    const p=page(t);let pages=0;
    Object.defineProperty(p.window.crypto,'subtle',{value:webcrypto.subtle});p.window.TextEncoder=TextEncoder;p.doc.cookie='SAPISID=test-session';
    p.window.fetch=async url=>url.includes('/playlist?')?{ok:true,url,text:async()=>playlistHTML([],'WL',{continuation:'page-2',config:{INNERTUBE_CONTEXT:{client:{clientName:'WEB',clientVersion:'test'}}}})}:{...response,json:async()=>{pages++;return {onResponseReceivedActions:[{appendContinuationItemsAction:{targetId:'WL',continuationItems:[{playlistVideoRenderer:{videoId:'f6CivhX4tXM'}}]}}]};}};
    await assert.rejects(p.window.WatchboxWatchLater.confirm('f6CivhX4tXM',{timeoutMs:20,retryDelayMs:1}),/could not confirm/i);
    assert.equal(pages,0,'Rejected responses must not be used as membership evidence');
  }
});

test('the confirmation deadline aborts a stalled continuation request',async t=>{
  const p=page(t);let aborted=false,deadline;
  Object.defineProperty(p.window.crypto,'subtle',{value:webcrypto.subtle});p.window.TextEncoder=TextEncoder;p.doc.cookie='SAPISID=test-session';
  p.window.fetch=async(url,options)=>{
    if(url.includes('/playlist?'))return {ok:true,url,text:async()=>playlistHTML([],'WL',{continuation:'page-2',config:{INNERTUBE_CONTEXT:{client:{clientName:'WEB',clientVersion:'test'}}}})};
    return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>{aborted=true;reject(Error('Aborted'));},{once:true}));
  };
  try {
    await assert.rejects(Promise.race([
      p.window.WatchboxWatchLater.confirm('f6CivhX4tXM',{timeoutMs:30}),
      new Promise((resolve,reject)=>{deadline=setTimeout(()=>reject(Error('Continuation exceeded the confirmation deadline')),150);})
    ]),/could not confirm/i);
    assert.equal(aborted,true);
  } finally {clearTimeout(deadline);}
});

test('native Watch Later control opens the selected video menu and submits its save action',async t=>{
  const p=page(t),saves=[];
  p.card.querySelector('button').onclick=()=>p.window.setTimeout(()=>{
    const menu=p.doc.createElement('yt-list-view-model');menu.setAttribute('role','menu');
    menu.innerHTML='<button role="menuitem">Add to queue</button><button role="menuitem">Save to Watch later</button>';
    menu.children[0].onclick=()=>assert.fail('The unrelated queue action must not run');
    menu.children[1].onclick=()=>{saves.push('f6CivhX4tXM');menu.remove();};
    p.doc.body.append(menu);
  },5);
  assert.equal(typeof p.window.WatchboxWatchLater?.submit,'function','The native Watch Later control is missing');
  const result=await p.window.WatchboxWatchLater.submit(p.card,'f6CivhX4tXM');
  assert.deepEqual(saves,['f6CivhX4tXM']);
  assert.equal(result,'submitted','A click submits the action; it must not claim account confirmation');
});

test('native Watch Later control refuses a recycled card for a different video',async t=>{
  const p=page(t);let opened=false;
  p.card.querySelector('button').onclick=()=>{opened=true;};
  await assert.rejects(p.window.WatchboxWatchLater.submit(p.card,'aircAruvnKk',{timeoutMs:10}),/video changed/i);
  assert.equal(opened,false);
});

test('native Watch Later control refuses an already open menu for another video',async t=>{
  const p=page(t);let clicked=false,opened=false;
  const menu=p.doc.createElement('yt-list-view-model');menu.setAttribute('role','menu');menu.innerHTML='<button role="menuitem">Save to Watch later</button>';p.doc.body.append(menu);
  menu.firstChild.onclick=()=>{clicked=true;};p.card.querySelector('button').onclick=()=>{opened=true;};
  await assert.rejects(p.window.WatchboxWatchLater.submit(p.card,'f6CivhX4tXM'),/close.*menu/i);
  assert.equal(clicked,false);assert.equal(opened,false);
});

test('opening another video menu cancels a pending native feed save',async t=>{
  const p=page(t),saves=[];
  const other=p.card.cloneNode(true);other.querySelector('a').href='/watch?v=aircAruvnKk';p.doc.body.append(other);
  const opener=other.querySelector('button');opener.innerHTML='<span>More</span>';
  opener.onclick=()=>{
    const menu=p.doc.createElement('yt-list-view-model');menu.setAttribute('role','menu');menu.innerHTML='<button role="menuitem">Save to Watch later</button>';
    menu.firstChild.onclick=()=>saves.push('aircAruvnKk');p.doc.body.append(menu);
  };
  const pending=p.window.WatchboxWatchLater.submit(p.card,'f6CivhX4tXM',{timeoutMs:40});
  const rejected=assert.rejects(pending,/another.*menu.*try again/i);
  opener.firstChild.click();await rejected;
  assert.deepEqual(saves,[],'An unrelated menu must not save a different video');
});

test('native Watch Later control waits for a reused hidden menu to become visible',async t=>{
  const p=page(t);let clicked=0;
  const popup=p.doc.createElement('div');popup.style.display='none';
  popup.innerHTML='<yt-list-view-model role="menu"><button role="menuitem">Save to Watch later</button></yt-list-view-model>';p.doc.body.append(popup);
  popup.querySelector('button').onclick=()=>{clicked++;};
  p.card.querySelector('button').onclick=()=>p.window.setTimeout(()=>{popup.style.display='block';},5);
  assert.equal(await p.window.WatchboxWatchLater.submit(p.card,'f6CivhX4tXM',{timeoutMs:40}),'submitted');
  assert.equal(clicked,1);
});

test('native Watch Later control stops if navigation changes before the menu appears',async t=>{
  const p=page(t);let clicked=false;
  p.card.querySelector('button').onclick=()=>{
    p.window.history.pushState({},'','/watch?v=aircAruvnKk');
    const menu=p.doc.createElement('yt-list-view-model');menu.setAttribute('role','menu');menu.innerHTML='<button role="menuitem">Save to Watch later</button>';p.doc.body.append(menu);
    menu.firstChild.onclick=()=>{clicked=true;};
  };
  await assert.rejects(p.window.WatchboxWatchLater.submit(p.card,'f6CivhX4tXM'),/video changed/i);
  assert.equal(clicked,false);
});

test('native Watch Later control stops if the title anchor is replaced while the menu loads',async t=>{
  const p=page(t);let clicked=false;
  p.card.querySelector('button').onclick=()=>p.window.setTimeout(()=>{
    const replacement=p.doc.createElement('a');replacement.id='video-title-link';replacement.href='/watch?v=aircAruvnKk';
    p.card.querySelector('a').replaceWith(replacement);
    const menu=p.doc.createElement('yt-list-view-model');menu.setAttribute('role','menu');menu.innerHTML='<button role="menuitem">Save to Watch later</button>';
    menu.firstChild.onclick=()=>{clicked=true;};p.doc.body.append(menu);
  },5);
  await assert.rejects(p.window.WatchboxWatchLater.submit(p.card,'f6CivhX4tXM'),/video changed/i);
  assert.equal(clicked,false,'The replacement video must not be saved');
});

test('native Watch Later control reports a missing native control without waiting',async t=>{
  const p=page(t);p.card.querySelector('button').remove();
  await assert.rejects(p.window.WatchboxWatchLater.submit(p.card,'f6CivhX4tXM',{timeoutMs:10}),/control.*unavailable/i);
});

test('confirmation rejects unsuccessful or redirected playlist responses',async t=>{
  for(const response of [{ok:false,url:'https://www.youtube.com/playlist?list=WL'},{ok:true,url:'https://accounts.google.com/ServiceLogin'},{ok:true,url:'https://www.youtube.com/playlist?list=LL'}]) {
    const p=page(t);
    p.window.fetch=async()=>({...response,text:async()=>playlistHTML(['f6CivhX4tXM'])});
    await assert.rejects(p.window.WatchboxWatchLater.confirm('f6CivhX4tXM'),/could not confirm/i);
  }
});

test('confirmation retries a temporarily absent entry instead of accepting a recommendation',async t=>{
  const p=page(t);let reads=0;
  const absent=playlistHTML(['aircAruvnKk']).replace('</script>', '</script><script>globalThis.unexpected=true;</script>');
  p.window.fetch=async()=>({ok:true,url:'https://www.youtube.com/playlist?list=WL',text:async()=>++reads===1?absent.replace('"contents":{','"recommendation":{"playlistVideoRenderer":{"videoId":"f6CivhX4tXM"}},"contents":{'):playlistHTML(['f6CivhX4tXM'])});
  assert.equal(await p.window.WatchboxWatchLater.confirm('f6CivhX4tXM',{retryDelayMs:1}),'confirmed');
  assert.equal(reads,2);assert.equal(p.window.unexpected,undefined,'Fetched page scripts must not execute');
});

test('confirmation keeps polling when YouTube publishes the save after the first three reads',async t=>{
  const p=page(t);let reads=0;
  p.window.fetch=async()=>({ok:true,url:'https://www.youtube.com/playlist?list=WL',text:async()=>playlistHTML(++reads>=4?['f6CivhX4tXM']:[])});
  assert.equal(await p.window.WatchboxWatchLater.confirm('f6CivhX4tXM',{retryDelayMs:1,timeoutMs:100}),'confirmed');
  assert.equal(reads,4);
});

test('confirmation aborts a stalled authenticated read within its timeout',async t=>{
  const p=page(t);let aborted=false,deadline;
  p.window.fetch=async(url,options)=>new Promise((resolve,reject)=>{
    options.signal?.addEventListener('abort',()=>{aborted=true;reject(Error('Aborted'));},{once:true});
  });
  try {
    await assert.rejects(Promise.race([
      p.window.WatchboxWatchLater.confirm('f6CivhX4tXM',{timeoutMs:15}),
      new Promise((resolve,reject)=>{deadline=setTimeout(()=>reject(Error('Confirmation hung past its deadline')),100);})
    ]),/could not confirm/i);
    assert.equal(aborted,true);
  } finally {clearTimeout(deadline);}
});

test('confirmation rejects invalid video IDs before reading the account playlist',async t=>{
  const p=page(t);let reads=0;
  p.window.fetch=async()=>{reads++;return {ok:true,url:'https://www.youtube.com/playlist?list=WL',text:async()=>playlistHTML([undefined,'bad'])};};
  for(const id of [undefined,'bad'])await assert.rejects(p.window.WatchboxWatchLater.confirm(id),/could not confirm/i);
  assert.equal(reads,0);
});

test('the confirmation deadline also cancels a pending retry delay',async t=>{
  const p=page(t);let reads=0,deadline;
  p.window.fetch=async()=>{reads++;return {ok:true,url:'https://www.youtube.com/playlist?list=WL',text:async()=>playlistHTML([])};};
  try {
    await assert.rejects(Promise.race([
      p.window.WatchboxWatchLater.confirm('f6CivhX4tXM',{timeoutMs:10,retryDelayMs:150}),
      new Promise((resolve,reject)=>{deadline=setTimeout(()=>reject(Error('Retry delay exceeded the confirmation deadline')),75);})
    ]),/could not confirm/i);
    assert.equal(reads,1);
  } finally {clearTimeout(deadline);}
});

test('watch-page saves select an unchecked native Watch Later entry',async t=>{
  const p=page(t);p.window.history.replaceState({},'','/watch?v=f6CivhX4tXM');let selected=0;
  p.doc.body.innerHTML='<ytd-watch-flexy video-id="f6CivhX4tXM"><ytd-watch-metadata><button aria-label="Save to playlist">Save</button></ytd-watch-metadata></ytd-watch-flexy>';
  p.doc.querySelector('button').onclick=()=>{
    const menu=p.doc.createElement('yt-list-view-model');menu.setAttribute('role','menu');
    menu.innerHTML='<yt-list-item-view-model><button role="menuitem" aria-label="Watch later, Private, Not selected" aria-pressed="false">Watch later</button></yt-list-item-view-model><button role="menuitem">Other playlist</button>';p.doc.body.append(menu);
    menu.querySelector('button').onclick=()=>{selected++;menu.remove();};
  };
  assert.equal(typeof p.window.WatchboxWatchLater.submitWatch,'function','Native watch-page saving is missing');
  assert.equal(await p.window.WatchboxWatchLater.submitWatch('f6CivhX4tXM'),'submitted');
  assert.equal(selected,1);
});

test('watch-page saving leaves an already selected Watch Later entry checked',async t=>{
  const p=page(t);p.window.history.replaceState({},'','/watch?v=f6CivhX4tXM');let toggled=0;
  p.doc.body.innerHTML='<ytd-watch-metadata><button aria-label="Save to playlist">Save</button></ytd-watch-metadata>';
  p.doc.querySelector('button').onclick=()=>{
    const menu=p.doc.createElement('yt-list-view-model');menu.setAttribute('role','menu');menu.innerHTML='<yt-list-item-view-model><button role="menuitem" aria-label="Watch later, Private, Selected" aria-pressed="true">Watch later</button></yt-list-item-view-model>';p.doc.body.append(menu);
    menu.querySelector('button').onclick=()=>{toggled++;};
    p.doc.body.onclick=event=>{if(event.target===p.doc.body)menu.remove();};
  };
  assert.equal(await p.window.WatchboxWatchLater.submitWatch('f6CivhX4tXM'),'submitted');
  assert.equal(toggled,0,'A retry must not remove the video from Watch Later');
  assert.equal(p.doc.querySelector('[role="menu"]'),null,'Dismiss the selector after an idempotent save');
});

test('watch-page saving can open Save through the native overflow menu',async t=>{
  const p=page(t);p.window.history.replaceState({},'','/watch?v=f6CivhX4tXM');let saved=0;
  p.doc.body.innerHTML='<ytd-watch-metadata><button aria-label="More actions">More</button></ytd-watch-metadata>';
  p.doc.querySelector('button').onclick=()=>{
    const menu=p.doc.createElement('yt-list-view-model');menu.setAttribute('role','menu');menu.innerHTML='<button role="menuitem">Save</button>';p.doc.body.append(menu);
    menu.querySelector('button').onclick=()=>{
      menu.innerHTML='<yt-list-item-view-model><button role="menuitem" aria-label="Watch later, Private, Not selected" aria-pressed="false">Watch later</button></yt-list-item-view-model>';
      menu.querySelector('button').onclick=()=>{saved++;menu.remove();};
    };
  };
  assert.equal(await p.window.WatchboxWatchLater.submitWatch('f6CivhX4tXM',{timeoutMs:50}),'submitted');
  assert.equal(saved,1);
});

test('watch-page saving handles the legacy native overflow menu',async t=>{
  const p=page(t);p.window.history.replaceState({},'','/watch?v=f6CivhX4tXM');let saved=0;
  p.doc.body.innerHTML='<ytd-watch-metadata><button aria-label="More actions">More</button></ytd-watch-metadata>';
  p.doc.querySelector('button').onclick=()=>{
    const menu=p.doc.createElement('ytd-menu-popup-renderer');menu.setAttribute('role','menu');menu.innerHTML='<ytd-menu-service-item-renderer role="menuitem"><tp-yt-paper-item role="menuitem">Save</tp-yt-paper-item></ytd-menu-service-item-renderer>';p.doc.body.append(menu);
    menu.querySelector('ytd-menu-service-item-renderer').onclick=()=>{
      menu.remove();const list=p.doc.createElement('yt-list-view-model');list.setAttribute('role','menu');list.innerHTML='<yt-list-item-view-model><button role="menuitem" aria-label="Watch later, Private, Not selected" aria-pressed="false">Watch later</button></yt-list-item-view-model>';p.doc.body.append(list);
      list.querySelector('button').onclick=()=>{saved++;list.remove();};
    };
  };
  assert.equal(await p.window.WatchboxWatchLater.submitWatch('f6CivhX4tXM',{timeoutMs:30}),'submitted');
  assert.equal(saved,1);
});

test('saving submits the native control and then verifies account membership',async t=>{
  const p=page(t),calls=[];
  p.window.WatchboxWatchLater.submit=async(card,id)=>{calls.push(['submit',card===p.card,id]);return 'submitted';};
  p.window.WatchboxWatchLater.confirm=async id=>{calls.push(['confirm',id]);return 'confirmed';};
  assert.equal(typeof p.window.WatchboxWatchLater.save,'function','The production save operation is missing');
  assert.equal(await p.window.WatchboxWatchLater.save('f6CivhX4tXM',{card:p.card}),'confirmed');
  assert.deepEqual(calls,[['submit',true,'f6CivhX4tXM'],['confirm','f6CivhX4tXM']]);
});

test('concurrent saves cannot operate another video menu before submission finishes',async t=>{
  const p=page(t);let finish,submissions=0;
  p.window.WatchboxWatchLater.submit=async()=>{submissions++;await new Promise(resolve=>{finish=resolve;});};
  p.window.WatchboxWatchLater.confirm=async()=> 'confirmed';
  const first=p.window.WatchboxWatchLater.save('f6CivhX4tXM',{card:p.card});await new Promise(resolve=>setTimeout(resolve,0));
  await assert.rejects(p.window.WatchboxWatchLater.save('aircAruvnKk',{card:p.card}),/another save/i);
  assert.equal(submissions,1);finish('confirmed');await first;
  p.window.WatchboxWatchLater.submit=async()=>{submissions++;};
  assert.equal(await p.window.WatchboxWatchLater.save('aircAruvnKk',{card:p.card}),'confirmed');
});

test('the next native save can finish while an earlier confirmation is pending',async t=>{
  const p=page(t);let finish;
  p.window.WatchboxWatchLater.submit=async()=> 'submitted';
  p.window.WatchboxWatchLater.confirm=id=>id==='f6CivhX4tXM'?new Promise(resolve=>{finish=resolve;}):Promise.resolve('confirmed');
  const first=p.window.WatchboxWatchLater.save('f6CivhX4tXM',{card:p.card});await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(await p.window.WatchboxWatchLater.save('aircAruvnKk',{card:p.card}),'confirmed');
  finish('confirmed');assert.equal(await first,'confirmed');
});
