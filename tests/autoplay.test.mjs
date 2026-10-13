import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

function player(html) {
  const dom=new JSDOM(`<ytd-app><ytd-watch-flexy><div id="movie_player">${html}</div></ytd-watch-flexy></ytd-app>`,{url:'https://www.youtube.com/watch?v=aircAruvnKk',runScripts:'outside-only'});
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

test('retired autoplay preferences leave native controls and playlist completion available',t=>{
  const p=player(`<video id="video"></video><div id="countdown" class="autonav-endscreen"></div>
    <button id="next" class="ytp-next-button"></button><button id="previous" class="ytp-prev-button"></button>
    <button id="toggle" data-tooltip-target-id="ytp-autonav-toggle-button" aria-checked="true"></button>`);
  t.after(()=>p.dom.window.close());
  p.dom.window.history.replaceState({},'', '/watch?v=aircAruvnKk&list=WL');
  p.apply({disableAutoplay:true,hideRelated:false});
  for(const id of ['countdown','next','previous','toggle'])assert.equal(p.hidden(id),false,`${id} must remain native`);
  assert.equal(p.doc.getElementById('toggle').getAttribute('aria-checked'),'true');
  assert.equal(p.doc.documentElement.hasAttribute('data-watchbox-disable-autoplay'),false);
  const video=p.doc.getElementById('video');let completions=0,pauses=0;
  video.pause=()=>pauses++;Object.defineProperty(video,'duration',{value:100});
  video.currentTime=99.8;video.dispatchEvent(new p.dom.window.Event('timeupdate'));
  video.addEventListener('ended',()=>completions++);video.dispatchEvent(new p.dom.window.Event('ended'));
  assert.equal(pauses,0);assert.equal(completions,1);
});
