// Save through YouTube's native controls, then verify fresh account membership.
// submit() clicks the native action; confirm() verifies fresh playlist membership.
globalThis.WatchboxWatchLater = {
  async save(videoId,{card,...options}={}) {
    if(this.saving)throw Error('Another save is pending. Try again when it finishes.');
    this.saving=true;
    try {
      if(card)await this.submit(card,videoId,options);
      else await this.submitWatch(videoId,options);
    } finally {this.saving=false;}
    return await this.confirm(videoId,{timeoutMs:options.confirmationTimeoutMs,retryDelayMs:options.retryDelayMs});
  },
  submitWatch(videoId, {timeoutMs=3000}={}) {
    const doc=document,route=location.href;
    const valid=()=>location.href===route && location.pathname==='/watch' && new URL(location.href).searchParams.get('v')===videoId && (!doc.querySelector('ytd-watch-flexy[video-id]') || doc.querySelector('ytd-watch-flexy[video-id]').getAttribute('video-id')===videoId);
    if(!valid())return Promise.reject(Error('The video changed. Try again.'));
    const button=doc.querySelector('ytd-watch-metadata button[aria-label="Save to playlist"]')||doc.querySelector('ytd-watch-metadata button[aria-label="More actions"]');
    if(!button || button.disabled)return Promise.reject(Error('YouTube native control is unavailable.'));
    const visible=element=>{
      for(let parent=element;parent;parent=parent.parentElement)if(parent.hidden || getComputedStyle(parent).display==='none' || getComputedStyle(parent).visibility==='hidden')return false;
      return true;
    };
    if([...doc.querySelectorAll('yt-list-view-model[role="menu"], ytd-menu-popup-renderer[role="menu"]')].some(visible))return Promise.reject(Error('Close the open YouTube menu and try again.'));
    return new Promise((resolve,reject)=>{
      let openedSave=false;
      const finish=(error)=>{observer.disconnect();clearTimeout(timeout);error?reject(error):resolve('submitted');};
      const check=()=>{
        if(!valid()){finish(Error('The video changed. Try again.'));return;}
        const entry=[...doc.querySelectorAll('yt-list-view-model[role="menu"] yt-list-item-view-model button[role="menuitem"]')].find(element=>visible(element) && element.getAttribute('aria-label')?.startsWith('Watch later,'));
        if(!entry){
          const save=[...doc.querySelectorAll('yt-list-view-model[role="menu"] [role="menuitem"], ytd-menu-popup-renderer[role="menu"] ytd-menu-service-item-renderer[role="menuitem"]')].find(element=>visible(element) && ['Save','Save to playlist'].includes(element.textContent.trim()));
          if(save && !openedSave){openedSave=true;save.click();}
          return;
        }
        if(entry.getAttribute('aria-pressed')!=='true')entry.click();
        else doc.body.click();
        finish();
      };
      const observer=new MutationObserver(check),timeout=setTimeout(()=>finish(Error('YouTube Watch Later action did not appear.')),timeoutMs);
      observer.observe(doc.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','style','class','aria-hidden']});
      button.click();check();
    });
  },
  async confirm(videoId, {retryDelayMs=500,timeoutMs=10000}={}) {
    if(!/^[\w-]{11}$/.test(videoId||''))throw Error('Could not confirm the save to YouTube. Try again.');
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),timeoutMs);
    try {
      for(let attempt=0;!controller.signal.aborted;attempt++) {
        if(attempt)await new Promise((resolve,reject)=>{
          const abort=()=>{clearTimeout(retry);reject(Error('Aborted'));};
          const retry=setTimeout(()=>{controller.signal.removeEventListener('abort',abort);resolve();},retryDelayMs);
          controller.signal.addEventListener('abort',abort,{once:true});
          if(controller.signal.aborted)abort();
        });
        controller.signal.throwIfAborted();
        const response=await fetch(new URL('/playlist?list=WL',location.origin).href,{cache:'no-store',credentials:'same-origin',signal:controller.signal});
        const destination=new URL(response.url);
        if(!response.ok || destination.origin!==location.origin || destination.pathname!=='/playlist' || destination.searchParams.get('list')!=='WL')break;
        const html=await response.text(),pending=[readYouTubeInitialData(html,'ytInitialData').contents];
        let playlist;
        while(pending.length) {
          const value=pending.pop();
          if(!value || typeof value!=='object')continue;
          if(value.playlistVideoListRenderer?.playlistId==='WL'){playlist=value.playlistVideoListRenderer;break;}
          pending.push(...Object.values(value));
        }
        const seen=new Set();
        let items=playlist?.contents||[],headers;
        const config=readYouTubeInitialData(html,'ytcfg');
        while(!controller.signal.aborted) {
          if(items.some(item=>item.playlistVideoRenderer?.videoId===videoId))return 'confirmed';
          const endpoint=items.find(item=>item.continuationItemRenderer)?.continuationItemRenderer.continuationEndpoint;
          const command=endpoint?.continuationCommand||endpoint?.commandExecutorCommand?.commands?.find(command=>command.continuationCommand)?.continuationCommand;
          const token=command?.token;
          if(!token || seen.has(token) || !config.INNERTUBE_CONTEXT)break;
          seen.add(token);
          if(!headers) {
            const cookies=document.cookie.split(';').map(cookie=>cookie.trim());
            const cookie=cookies.find(cookie=>cookie.startsWith('SAPISID='))||cookies.find(cookie=>cookie.startsWith('__Secure-3PAPISID='));
            if(!cookie)break;
            const timestamp=Math.floor(Date.now()/1000);
            const digest=await crypto.subtle.digest('SHA-1',new TextEncoder().encode(`${timestamp} ${cookie.slice(cookie.indexOf('=')+1)} ${location.origin}`));
            const hash=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
            headers={'Content-Type':'application/json',Authorization:`SAPISIDHASH ${timestamp}_${hash}`,'X-Goog-AuthUser':String(config.SESSION_INDEX||0)};
            if(config.DELEGATED_SESSION_ID)headers['X-Goog-PageId']=config.DELEGATED_SESSION_ID;
          }
          controller.signal.throwIfAborted();
          const continuation=await fetch(new URL('/youtubei/v1/browse?prettyPrint=false',location.origin).href,{method:'POST',cache:'no-store',credentials:'same-origin',signal:controller.signal,headers,body:JSON.stringify({context:config.INNERTUBE_CONTEXT,continuation:token})});
          const destination=new URL(continuation.url);
          if(!continuation.ok || destination.origin!==location.origin || destination.pathname!=='/youtubei/v1/browse')break;
          const data=await continuation.json();
          items=[...(data.onResponseReceivedActions||[]),...(data.onResponseReceivedEndpoints||[])].flatMap(action=>{
            const append=action.appendContinuationItemsAction;
            return append?.targetId===(playlist.targetId||'WL')?append.continuationItems||[]:[];
          });
        }
      }
    } catch {} finally {clearTimeout(timeout);}
    throw Error('Could not confirm the save to YouTube. Try again.');
  },
  submit(card, videoId, {timeoutMs=3000}={}) {
    const doc=card.ownerDocument;
    const route=doc.location.href;
    const link=card.querySelector('a#video-title-link, a#video-title, a.ytLockupMetadataViewModelTitle, a.yt-lockup-metadata-view-model__title');
    if(!card.isConnected || !link || new URL(link.href).searchParams.get('v')!==videoId)return Promise.reject(Error('The video changed. Try again.'));
    const menuButton=card.querySelector('button[aria-label="More actions"]');
    if(!menuButton || menuButton.disabled || menuButton.getAttribute('aria-disabled')==='true')return Promise.reject(Error('YouTube native control is unavailable.'));
    const visible=element=>{
      for(let parent=element;parent;parent=parent.parentElement) {
        if(parent.hidden || getComputedStyle(parent).display==='none' || getComputedStyle(parent).visibility==='hidden')return false;
      }
      return true;
    };
    if([...doc.querySelectorAll('yt-list-view-model[role="menu"]')].some(visible))return Promise.reject(Error('Close the open YouTube menu and try again.'));
    return new Promise((resolve,reject)=>{
      let settled=false;
      const finish=error=>{
        if(settled)return;
        settled=true;observer.disconnect();clearTimeout(timeout);doc.removeEventListener('click',menuChanged,true);
        error?reject(error):resolve('submitted');
      };
      const menuChanged=event=>{
        const opener=event.target.closest?.('button[aria-label="More actions"], button[aria-label="Save to playlist"]');
        if(opener && opener!==menuButton)finish(Error('Another YouTube menu was opened. Try again.'));
      };
      const check=()=>{
        if(settled)return;
        const currentLink=card.querySelector('a#video-title-link, a#video-title, a.ytLockupMetadataViewModelTitle, a.yt-lockup-metadata-view-model__title');
        if(doc.location.href!==route || !card.isConnected || !currentLink || new URL(currentLink.href).searchParams.get('v')!==videoId) {
          finish(Error('The video changed. Try again.'));return;
        }
        const action=[...doc.querySelectorAll('yt-list-view-model[role="menu"] [role="menuitem"]')].find(element=>visible(element) && element.textContent.trim()==='Save to Watch later');
        if(!action)return;
        finish();
        action.click();
      };
      const observer=new MutationObserver(check);
      const timeout=setTimeout(()=>finish(Error('YouTube Watch Later action did not appear.')),timeoutMs);
      observer.observe(doc.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','style','class','aria-hidden']});
      doc.addEventListener('click',menuChanged,true);
      menuButton.click();check();
    });
  }
};
