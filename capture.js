function readYouTubeUploadTime(card,now=Date.now()) {
  for(const metadata of card.querySelectorAll('#metadata-line span, .ytContentMetadataViewModelMetadataText, .yt-content-metadata-view-model__metadata-text')) {
    const age=/(\d+)\s*(seconds?|secs?|s|minutes?|mins?|min|hours?|hrs?|h|days?|d|weeks?|w|months?|mos?|mo|years?|yrs?|y)\s+ago\b/i.exec(metadata.getAttribute('aria-label')||metadata.textContent);
    if(!age)continue;
    const unit=age[2].toLowerCase();
    const seconds=unit.startsWith('mo')?2592000:unit.startsWith('y')?31536000:unit.startsWith('w')?604800:unit.startsWith('d')?86400:unit.startsWith('h')?3600:unit.startsWith('m')?60:1;
    const precision=Math.min(seconds,86400)*1000;
    return {publishedAt:Math.floor(now/precision)*precision-Number(age[1])*seconds*1000,publishedLabel:metadata.textContent.trim()};
  }
  return {};
}

function readYouTubeCardMetadata(card) {
  // Hidden cards have unloaded images; the native renderer still carries their public URLs.
  let model;
  try {model=(card.wrappedJSObject||card).data?.content?.lockupViewModel;}catch{}
  const channelLink=card.querySelector('ytd-channel-name a, #channel-name a, a[href^="/@"]');
  const thumbnail=card.querySelector('yt-thumbnail-view-model img, a#thumbnail img');
  const avatar=card.querySelector('yt-avatar-shape img, #avatar img, ytd-channel-thumbnail img');
  const duration=card.querySelector('yt-thumbnail-badge-view-model .ytBadgeShapeText, ytd-thumbnail-overlay-time-status-renderer #text');
  const views=[...card.querySelectorAll('#metadata-line span, .ytContentMetadataViewModelMetadataText, .yt-content-metadata-view-model__metadata-text')].find(e=>/views?/i.test(e.getAttribute('aria-label')||e.textContent));
  return {...readYouTubeUploadTime(card),thumbnailUrl:thumbnail?.getAttribute('src')||model?.contentImage?.thumbnailViewModel?.image?.sources?.at(-1)?.url||'',channelAvatar:avatar?.getAttribute('src')||model?.metadata?.lockupMetadataViewModel?.image?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image?.sources?.at(-1)?.url||'',channelUrl:channelLink?.href||'',duration:duration?.textContent.trim()||'',views:views?.textContent.trim()||''};
}

function readYouTubeInitialData(html,name) {
  const match=(name==='ytcfg'?/ytcfg\.set\s*\(\s*\{/:new RegExp(`(?:var\\s+)?${name}\\s*=\\s*\\{`)).exec(html);
  if(!match)return {};
  const start=match.index+match[0].length-1;
  let depth=0,quoted=false,escaped=false;
  for(let i=start;i<html.length;i++) {
    const char=html[i];
    if(quoted) {if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}
    if(char==='"')quoted=true;
    else if(char==='{')depth++;
    else if(char==='}' && --depth===0) {try{return JSON.parse(html.slice(start,i+1));}catch{return {};}}
  }
  return {};
}

function readYouTubeWatchMetadata(html) {
  const meta=new Map();
  for(const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs=Object.fromEntries([...tag[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(match=>[match[1].toLowerCase(),match[2]??match[3]]));
    meta.set(attrs.itemprop||attrs.property||attrs.name,attrs.content);
  }
  const publishedAt=Date.parse(meta.get('datePublished')||meta.get('uploadDate')||'');
  if(!Number.isFinite(publishedAt))return {};
  const duration=/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(meta.get('duration')||'');
  const seconds=duration?Number(duration[1]||0)*3600+Number(duration[2]||0)*60+Number(duration[3]||0):0;
  const findOwner=value=>{
    if(!value || typeof value!=='object')return null;
    if(value.videoOwnerRenderer)return value.videoOwnerRenderer;
    for(const child of Object.values(value)){const owner=findOwner(child);if(owner)return owner;}
    return null;
  };
  const owner=findOwner(readYouTubeInitialData(html,'ytInitialData'));
  const channelPath=owner?.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl;
  const views=readYouTubeInitialData(html,'ytInitialPlayerResponse').videoDetails?.viewCount||meta.get('interactionCount');
  return {
    publishedAt,publishedAtExact:true,publishedLabel:new Date(publishedAt).toLocaleDateString('en',{year:'numeric',month:'short',day:'numeric'}),
    thumbnailUrl:meta.get('og:image')||'',channelAvatar:owner?.thumbnail?.thumbnails?.at(-1)?.url||owner?.avatarStack?.avatarStackViewModel?.avatars?.[0]?.avatarViewModel?.image?.sources?.at(-1)?.url||'',
    channelUrl:channelPath?.startsWith('/')?`https://www.youtube.com${channelPath}`:'',
    duration:seconds>=3600?`${Math.floor(seconds/3600)}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`:seconds?`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`:'',
    views:/^\d+$/.test(views||'')?`${Number(views).toLocaleString('en')} views`:''
  };
}

function isYouTubeVideoPastInboxLimit(card,days=14) {
  return WatchboxCore.isPastInboxLimit(readYouTubeUploadTime(card).publishedAt,days);
}

function captureYouTubePage(knownIds = [],inboxDays=14) {
  if (!['youtube.com','www.youtube.com','m.youtube.com'].includes(location.hostname)) throw Error('Open a YouTube video or your subscriptions first.');
  const current = new URL(location.href);
  const id = current.pathname === '/watch' ? current.searchParams.get('v') : /^\/(?:shorts|live)\/([^/]+)/.exec(current.pathname)?.[1];
  if (/^[\w-]{11}$/.test(id || '')) {
    return {kind:'video', videos:[{
      url:`https://www.youtube.com/watch?v=${id}`,
      title:document.querySelector('ytd-watch-metadata h1')?.textContent.trim() || document.querySelector('meta[property="og:title"]')?.content || document.title.replace(/ - YouTube$/, ''),
      channel:(document.querySelector('ytd-video-owner-renderer ytd-channel-name a') || document.querySelector('ytd-video-owner-renderer ytd-channel-name'))?.textContent.trim() || 'YouTube',
      progress:document.querySelector('video')?.currentTime || 0
    }]};
  }
  const videos = [], seen = new Set(knownIds);
  for (const link of document.querySelectorAll('ytd-rich-item-renderer a#video-title-link, ytd-rich-item-renderer a#video-title, ytd-grid-video-renderer a#video-title, ytd-video-renderer a#video-title, yt-lockup-view-model a.yt-lockup-metadata-view-model__title, yt-lockup-view-model a.ytLockupMetadataViewModelTitle')) {
    const url = new URL(link.href, location.href), id = url.searchParams.get('v');
    if (url.hostname !== location.hostname || url.pathname !== '/watch' || !/^[\w-]{11}$/.test(id || '') || seen.has(id)) continue;
    const card = link.closest('ytd-rich-item-renderer,ytd-grid-video-renderer,ytd-video-renderer,yt-lockup-view-model');
    if(card.closest('#watchbox-saved-shelf'))continue;
    if(current.pathname === '/feed/subscriptions' && isYouTubeVideoPastInboxLimit(card,inboxDays)) continue;
    const title = (link.getAttribute('title') || link.textContent).trim();
    if (!title) continue;
    seen.add(id);
    videos.push({url:url.href, title, channel:card.querySelector('ytd-channel-name, #channel-name, a[href^="/@"]')?.textContent.trim() || 'YouTube',...readYouTubeCardMetadata(card)});
    if (videos.length === 60) break;
  }
  return {videos, kind:'feed'};
}
