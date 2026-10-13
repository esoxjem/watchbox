/* Shared, browser-independent library rules. */
globalThis.WatchboxCore = {
  isPastInboxLimit(publishedAt,days,now=Date.now()) {
    return Number.isFinite(publishedAt) && now-publishedAt>=days*86400000;
  },
  videoId(value) {
    try {
      const url = new URL(value);
      if (!['https:', 'http:'].includes(url.protocol)) return null;
      let id;
      if (url.hostname === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
      else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
        id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|live|embed)\/([^/]+)/.exec(url.pathname)?.[1];
      }
      return /^[\w-]{11}$/.test(id || '') ? id : null;
    } catch { return null; }
  }
};
Object.assign(WatchboxCore, {
  collect(items, candidates, now = Date.now()) {
    const next = items.map(item => ({...item}));
    let added = 0;
    for (const candidate of candidates.slice(0, 60)) {
      const id = this.videoId(candidate.url);
      if (!id) continue;
      const old = next.find(item => item.id === id);
      const title = String(candidate.title || old?.title || 'YouTube video').slice(0, 300);
      const channel = String(candidate.channel || old?.channel || 'YouTube').slice(0, 120);
      const progress = Number.isFinite(candidate.progress) && candidate.progress >= 0 ? candidate.progress : 0;
      const upload=Number.isFinite(candidate.publishedAt) && candidate.publishedAt>0?{
        publishedAt:!candidate.publishedAtExact && old?.publishedAt && (old.publishedAtExact || old.publishedLabel===candidate.publishedLabel)?old.publishedAt:candidate.publishedAt,
        publishedLabel:String(candidate.publishedLabel||''),
        ...((candidate.publishedAtExact || old?.publishedAtExact)?{publishedAtExact:true}:{})
      }:{};
      const metadata={};
      for(const key of ['thumbnailUrl','channelAvatar','channelUrl','duration','views']) {
        if(typeof candidate[key]!=='string' || !candidate[key])continue;
        if(['thumbnailUrl','channelAvatar','channelUrl'].includes(key)) {
          try {const url=new URL(candidate[key]);if(url.protocol!=='https:' || !['www.youtube.com','youtube.com','i.ytimg.com','yt3.ggpht.com','yt3.googleusercontent.com'].includes(url.hostname))continue;}catch{continue;}
        }
        metadata[key]=candidate[key].slice(0,1000);
      }
      if (old) Object.assign(old, {title, channel, progress: Math.max(old.progress || 0, progress),...upload,...metadata});
      else { next.push({id, title, channel, progress, status:'inbox', watched:false, addedAt:now,...upload,...metadata}); added++; }
    }
    return {items:next, added};
  }
});
Object.assign(WatchboxCore, {
  change(state, id, action) {
    const item = state.items.find(item => item.id === id);
    if (!item || !['inbox','queue','archive','watched'].includes(action)) throw Error('Unknown video or action');
    return {
      items: state.items.map(value => value.id !== id ? value : {...value, status:action === 'watched' ? 'archive' : action, watched:action === 'watched' ? true : value.watched, returnedToInbox:action==='inbox'}),
      history: [...state.history, {id, status:item.status, watched:item.watched, returnedToInbox:item.returnedToInbox}].slice(-20)
    };
  },
  undo(state) {
    const last = state.history.at(-1);
    if (!last) return state;
    return {items:state.items.map(item => item.id === last.id ? {...item, status:last.status, watched:last.watched, returnedToInbox:last.returnedToInbox} : item), history:state.history.slice(0,-1)};
  }
});
