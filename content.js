// Extend YouTube's own surfaces; never replace its page with an application.
(async function () {
  const data=await browser.storage.local.get(['watchbox','watchboxPreferences']);
  let preferences=data.watchboxPreferences||{};
  let state=data.watchbox||{items:[],history:[]}, busy=false, resync=false, timer, view=routeView(), savedSignature, focus=false;
  let loadingMetadata=false;const metadataRequests=new Set();
  let pendingWrites=Promise.resolve();
  const pendingSaves=new Map();
  const navigation=document.createElement('nav');navigation.id='watchbox-sidebar';navigation.setAttribute('aria-label','Watchbox');
  const inbox=document.createElement('a');inbox.id='watchbox-inbox';inbox.href='/feed/subscriptions#watchbox-inbox';navigation.append(inbox);
  const saved=document.createElement('a');saved.id='watchbox-saved';saved.href='/playlist?list=WL';navigation.append(saved);
  const toast=document.createElement('div');toast.id='watchbox-toast';toast.hidden=true;toast.setAttribute('role','status');toast.setAttribute('aria-live','polite');
  const notice=document.createElement('span');notice.id='watchbox-toast-message';toast.append(notice);
  const undo=document.createElement('button');undo.id='watchbox-undo';undo.textContent='UNDO';undo.hidden=true;toast.append(undo);document.body.append(toast);
  let toastTimer,toastHovered=false,toastFocused=false;
  function dismissLater() {
    clearTimeout(toastTimer);
    if(!toastHovered && !toastFocused && !toast.hidden)toastTimer=setTimeout(()=>{toast.hidden=true;},8000);
  }
  toast.addEventListener('mouseenter',()=>{toastHovered=true;dismissLater();});
  toast.addEventListener('mouseleave',()=>{toastHovered=false;dismissLater();});
  toast.addEventListener('focusin',()=>{toastFocused=true;dismissLater();});
  toast.addEventListener('focusout',event=>{toastFocused=toast.contains(event.relatedTarget);dismissLater();});
  const shelf=document.createElement('section');shelf.id='watchbox-saved-shelf';shelf.hidden=true;
  const inboxEmpty=document.createElement('section');inboxEmpty.id='watchbox-inbox-empty';inboxEmpty.hidden=true;inboxEmpty.setAttribute('role','status');
  const player=document.createElement('div');player.id='watchbox-player-tools';player.hidden=true;
  const autoplay=document.createElement('button');autoplay.id='watchbox-watch-later-autoplay';autoplay.className='ytp-button ytp-autonav-toggle delhi-fast-follow-autonav-toggle';autoplay.type='button';autoplay.setAttribute('role','switch');
  autoplay.dataset.priority='3';autoplay.dataset.tooltipTargetId='ytp-autonav-toggle-button';
  // Let YouTube render its own track, thumb, icons and responsive size variants.
  autoplay.innerHTML='<div class="ytp-autonav-toggle-button-container"><div class="ytp-autonav-toggle-button"></div></div>';
  const autoplayTooltip=document.createElement('div');autoplayTooltip.id='watchbox-autoplay-tooltip';autoplayTooltip.className='ytp-tooltip ytp-bottom';autoplayTooltip.setAttribute('aria-hidden','true');
  autoplayTooltip.innerHTML='<div class="ytp-tooltip-text-wrapper"><div class="ytp-tooltip-bottom-text"><span class="ytp-tooltip-text"></span></div></div>';
  function showAutoplayTooltip() {
    const host=autoplay.closest('#movie_player');if(!host)return;
    const label=autoplayTooltip.querySelector('.ytp-tooltip-text');
    if(label.textContent!==autoplay.dataset.tooltipTitle)label.textContent=autoplay.dataset.tooltipTitle;
    autoplayTooltip.setAttribute('aria-hidden','false');
    if(autoplayTooltip.parentElement!==host)host.append(autoplayTooltip);
    const bounds=host.getBoundingClientRect(),button=autoplay.getBoundingClientRect(),tip=autoplayTooltip.getBoundingClientRect();
    const chrome=host.querySelector('.ytp-chrome-bottom')?.getBoundingClientRect();
    autoplayTooltip.style.left=`${Math.max(0,Math.min(bounds.width-tip.width,button.left-bounds.left+(button.width-tip.width)/2))}px`;
    autoplayTooltip.style.top=`${(chrome?.top??button.top)-bounds.top-tip.height-11}px`;
  }
  autoplay.onmouseenter=autoplay.onfocus=showAutoplayTooltip;
  autoplay.onmouseleave=autoplay.onblur=()=>autoplayTooltip.remove();
  function watchLaterPlayback() {
    return WatchboxPreferences.resolve(preferences).enabled && location.pathname==='/watch' && new URL(location.href).searchParams.get('list')==='WL';
  }
  function syncAutoplay() {
    const controls=watchLaterPlayback() && document.querySelector('#movie_player .ytp-right-controls');
    if(!controls) {autoplay.remove();autoplayTooltip.remove();return;}
    if(autoplay.parentElement!==controls)controls.prepend(autoplay);
    const enabled=preferences.watchLaterAutoplay!==false;
    autoplay.setAttribute('aria-checked',String(enabled));
    autoplay.firstElementChild.firstElementChild.setAttribute('aria-checked',String(enabled));
    autoplay.dataset.tooltipTitle=`Autoplay is ${enabled?'on':'off'}`;
    autoplay.setAttribute('aria-label',autoplay.dataset.tooltipTitle);
    if(autoplayTooltip.isConnected)showAutoplayTooltip();
  }
  autoplay.onclick=async()=>{
    autoplay.disabled=true;
    try {
      const data=await browser.storage.local.get('watchboxPreferences');
      const next={...data.watchboxPreferences,watchLaterAutoplay:preferences.watchLaterAutoplay===false};
      await browser.storage.local.set({watchboxPreferences:next});preferences=next;
    } catch {notify('Could not save autoplay. Try again.');}
    finally {autoplay.disabled=false;syncAutoplay();}
  };
  // Capture completion before YouTube's video listeners can advance the playlist.
  document.addEventListener('ended',event=>{
    if(watchLaterPlayback() && preferences.watchLaterAutoplay===false && event.target.matches('#movie_player:not(.ad-showing) video'))event.stopImmediatePropagation();
  },true);
  // YouTube also polls for completion; stop just before it reaches that state.
  document.addEventListener('timeupdate',event=>{
    const video=event.target;
    if(watchLaterPlayback() && preferences.watchLaterAutoplay===false && video.matches('#movie_player:not(.ad-showing) video') && !video.paused && Number.isFinite(video.duration) && video.duration-video.currentTime<=0.5) {
      const pause=document.querySelector('#movie_player .ytp-play-button');
      if(pause)pause.click();else video.pause();
    }
  },true);
  for(const [action,label] of [['queue','Save to Watch later'],['position','Save position'],['watched','Watched'],['focus','Focus']]) {
    const button=document.createElement('button');button.id=action==='position'?'watchbox-save-position':'watchbox-'+action;button.textContent=label;
    button.onclick=async()=>{
      if(action==='focus') {focus=!focus;update();return;}
      button.disabled=true;
      try {
        const captured=captureYouTubePage();
        if(captured.kind!=='video') return;
        const id=WatchboxCore.videoId(location.href);
        if(action==='queue')return await saveToYouTube(captured.videos[0],button);
        await persist(current=>{
          const next={...current,items:WatchboxCore.collect(current.items,captured.videos).items};
          return action==='position'?next:WatchboxCore.change(next,id,action);
        },action==='position'?'Position saved.':'Watched and dismissed.',action!=='position');
      } finally {button.disabled=false;}
    };
    player.append(button);
  }
  const titleLinks='a#video-title-link, a#video-title, a.ytLockupMetadataViewModelTitle, a.yt-lockup-metadata-view-model__title';
  const actionIcons={
    queue:[['circle',{cx:'10',cy:'10',r:'7'}],['path',{d:'M10 6v4l3 2'}]],
    archive:[['path',{d:'M3 4h14v4H3zM4 8v9h12V8M8 11h4'}]],
    inbox:[['path',{d:'M3 4h14v12H3z'}],['path',{d:'M3 11h4l2 2h2l2-2h4'}]]
  };
  const emptyHeading=document.createElement('h2');emptyHeading.textContent='All caught up';
  inboxEmpty.append(actionIcon('inbox'),emptyHeading);
  function actionIcon(action) {
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    for(const [name,value] of Object.entries({'aria-hidden':'true',viewBox:'0 0 20 20',fill:'none',stroke:'currentColor','stroke-width':'1.55','stroke-linecap':'round','stroke-linejoin':'round'})) svg.setAttribute(name,value);
    for(const [tag,attributes] of actionIcons[action]) {
      const shape=document.createElementNS('http://www.w3.org/2000/svg',tag);
      for(const [name,value] of Object.entries(attributes)) shape.setAttribute(name,value);
      svg.append(shape);
    }
    return svg;
  }
  for(const [link,action,label] of [[inbox,'inbox','Inbox'],[saved,'queue','Watch later']]) {
    const text=document.createElement('span');text.className='watchbox-nav-label';text.textContent=label;
    link.dataset.watchboxNav=action;link.append(actionIcon(action),text);
  }
  const miniNavigation=navigation.cloneNode(true);miniNavigation.id='watchbox-mini-sidebar';
  for(const link of miniNavigation.querySelectorAll('a'))link.removeAttribute('id');
  const expandedSections=new Set();
  function syncSidebar() {
    for(const [nav,selector] of [[navigation,'ytd-guide-renderer #sections'],[miniNavigation,'ytd-mini-guide-renderer #items']]) {
      const host=document.querySelector(selector);
      if(host && nav.parentElement!==host)host.prepend(nav);
    }
    for(const group of document.querySelectorAll('ytd-guide-renderer ytd-guide-collapsible-section-entry-renderer')) {
      const header=group.querySelector('#header'),link=header?.querySelector('a');
      const key=link && {'/feed/subscriptions':'subscriptions','/feed/you':'you'}[new URL(link.href).pathname];
      if(!key)continue;
      if(key==='subscriptions')link.dataset.watchboxNativeNav=key;
      if(group.querySelector('.watchbox-section-toggle'))continue;
      group.dataset.watchboxSection=key;group.toggleAttribute('data-watchbox-collapsed',!expandedSections.has(key));
      const button=document.createElement('button');button.type='button';button.className='watchbox-section-toggle';button.setAttribute('aria-expanded',String(expandedSections.has(key)));
      const label=link.textContent.trim();button.setAttribute('aria-label',`${expandedSections.has(key)?'Collapse':'Expand'} ${label}`);
      const arrow=document.createElement('span');arrow.className='watchbox-section-arrow';arrow.textContent='›';arrow.setAttribute('aria-hidden','true');
      button.append(arrow);
      button.onclick=event=>{
        event.preventDefault();event.stopPropagation();
        const expanded=button.getAttribute('aria-expanded')!=='true';
        if(expanded)expandedSections.add(key);else expandedSections.delete(key);
        button.setAttribute('aria-expanded',String(expanded));button.setAttribute('aria-label',`${expanded?'Collapse':'Expand'} ${label}`);group.toggleAttribute('data-watchbox-collapsed',!expanded);
      };
      header.append(button);
    }
    if(WatchboxPreferences.resolve(preferences).enabled) {
      for(const nav of [navigation,miniNavigation]) {
        const host=nav.parentElement;if(!host)continue;
        if(host.firstElementChild!==nav)host.prepend(nav);
        let previous=nav;
        for(const key of ['subscriptions','you']) {
          const entry=nav===navigation
            ?host.querySelector(`[data-watchbox-section="${key}"]`)?.closest('ytd-guide-section-renderer')
            :host.querySelector(`a[href="/feed/${key}"]`)?.closest('ytd-mini-guide-entry-renderer');
          if(!entry || entry.parentElement!==host || entry===previous)continue;
          if(previous.nextElementSibling!==entry)previous.after(entry);
          previous=entry;
        }
      }
    }
    for(const link of document.querySelectorAll('ytd-mini-guide-renderer a[href="/feed/subscriptions"]')) {
      link.dataset.watchboxNativeNav='subscriptions';
    }
    for(const link of document.querySelectorAll('[data-watchbox-native-nav=subscriptions]')) {
      if(WatchboxPreferences.resolve(preferences).enabled && location.pathname==='/feed/subscriptions' && view==='all')link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
    }
    for(const section of document.querySelectorAll('ytd-guide-renderer ytd-guide-section-renderer')) {
      const entries=[...section.querySelectorAll('a,button')];
      section.toggleAttribute('data-watchbox-empty-section',entries.length>0 && !entries.some(entry=>elementVisible(entry,section)));
    }
  }
  function thumbnailButton(action,title,url) {
    const button=document.createElement(url?'a':'button');button.dataset.watchboxAction=action;
    if(url)button.href=url;
    button.title=action==='queue'?'Save to Watch later':action==='archive'?'Dismiss':'Move to inbox';
    button.setAttribute('aria-label',`${button.title}: ${title}`);
    button.append(actionIcon(action));
    return button;
  }
  function positionThumbnailControls(card) {
    const thumbnail=card.querySelector('yt-thumbnail-view-model')||card.querySelector('a#thumbnail, a.ytLockupViewModelContentImage, a.yt-lockup-view-model__content-image, .watchbox-saved-card img');
    if(!thumbnail) return;
    const rect=thumbnail.getBoundingClientRect(),base=card.getBoundingClientRect();
    if(!rect.width || !rect.height) return;
    const left=rect.left-base.left,top=rect.top-base.top;
    const actions=card.querySelector('.watchbox-card-actions');
    actions.style.left=`${left+rect.width/2}px`;actions.style.top=`${top+rect.height/2}px`;
    const shade=card.querySelector('.watchbox-thumbnail-shade');
    Object.assign(shade.style,{left:`${left}px`,top:`${top}px`,width:`${rect.width}px`,height:`${rect.height}px`});
  }
  function thumbnailShade(card) {
    const shade=document.createElement('div');shade.className='watchbox-thumbnail-shade';shade.setAttribute('aria-hidden','true');card.append(shade);
  }
  const cardResize=typeof ResizeObserver==='function'?new ResizeObserver(entries=>entries.forEach(entry=>positionThumbnailControls(entry.target))):null;
  const setText=(element,value)=>{if(element.textContent!==value) element.textContent=value;};
  function routeView() {
    if(location.pathname!=='/feed/subscriptions')return 'all';
    return location.hash==='#watchbox-inbox'?'inbox':'all';
  }
  function navigate(event) {
    const link=event.target.closest?.('a[data-watchbox-nav=inbox],a[data-watchbox-native-nav=subscriptions]');
    if(!link)return;
    if(event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !WatchboxPreferences.resolve(preferences).enabled)return;
    if(location.pathname!=='/feed/subscriptions')return;
    event.stopPropagation();
    event.preventDefault();
    const url=link.href;
    if(location.href!==url)history.pushState(null,'',url);
    view=routeView();update();refreshLibraryMetadata();schedule();
  }
  document.addEventListener('click',navigate,true);
  function nativeElement(tag,className,parent,text) {
    const element=document.createElement(tag);element.className=className;
    if(text!==undefined)element.textContent=text;
    parent.append(element);return element;
  }
  function nativeImage(className,parent,src) {
    const image=nativeElement('img',className,parent);image.alt='';image.loading='lazy';
    image.onload=()=>image.classList.add('ytCoreImageLoaded');image.src=src;return image;
  }
  function renderLibrary(returned=[]) {
    const grid=[...document.querySelectorAll('ytd-browse')].find(element=>!element.hidden)?.querySelector('ytd-rich-grid-renderer, ytd-grid-renderer');
    if(!WatchboxPreferences.resolve(preferences).enabled) {shelf.hidden=true;return;}
    shelf.hidden=view==='all' || (view==='inbox' && !returned.length);
    for(const link of document.querySelectorAll('[data-watchbox-nav]')) {
      const selected=link.dataset.watchboxNav==='queue'?location.pathname==='/playlist' && new URL(location.href).searchParams.get('list')==='WL':location.pathname==='/feed/subscriptions' && view==='inbox';
      if(selected)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
    }
    const columns=grid && Number.parseInt(getComputedStyle(grid).getPropertyValue('--ytd-rich-grid-items-per-row'),10);
    const signature=JSON.stringify([view,state.items,returned.map(item=>item.id),columns]);
    if(signature===savedSignature) return;
    savedSignature=signature;
    for(const card of shelf.querySelectorAll('.watchbox-saved-card')) cardResize?.unobserve(card);
    shelf.replaceChildren();
    if(view==='all' || (view==='inbox' && !returned.length)) return;
    const list=document.createElement('div');list.className='watchbox-saved-grid';shelf.append(list);
    if(columns>=1 && columns<=6) list.style.gridTemplateColumns=`repeat(${columns}, minmax(0, 1fr))`;
    for(const item of returned.sort((a,b)=>(b.publishedAt||0)-(a.publishedAt||0))) {
      const card=document.createElement('article');card.className='watchbox-saved-card';
      const lockup=nativeElement('yt-lockup-view-model','ytLockupViewModelWrapper',card);
      const host=nativeElement('div','ytLockupViewModelHost ytLockupViewModelVertical ytLockupViewModelFlexNone',lockup);
      const url=`https://www.youtube.com/watch?v=${item.id}${item.progress>3?'&t='+Math.floor(item.progress)+'s':''}`;
      const link=nativeElement('a','ytLockupViewModelContentImage',host);link.href=url;link.target='_self';link.setAttribute('aria-label',item.title);
      const thumbnail=nativeElement('yt-thumbnail-view-model','ytThumbnailViewModelHost ytThumbnailViewModelAspectRatio16By9 ytThumbnailViewModelLarge',link);
      const thumbnailImage=nativeElement('div','ytThumbnailViewModelImage',thumbnail);
      nativeImage('ytCoreImageHost ytCoreImageFillParentHeight ytCoreImageFillParentWidth ytCoreImageContentModeScaleAspectFill',thumbnailImage,item.thumbnailUrl||`https://i.ytimg.com/vi/${item.id}/hq720.jpg`);
      if(item.duration) {
        const overlay=nativeElement('yt-thumbnail-bottom-overlay-view-model','ytThumbnailBottomOverlayViewModelHost',thumbnail);
        const badges=nativeElement('div','ytThumbnailBottomOverlayViewModelBadgeContainer ytThumbnailBottomOverlayViewModelBadgeContainerLarge',overlay);
        const badge=nativeElement('yt-thumbnail-badge-view-model','ytThumbnailBadgeViewModelHost ytThumbnailBottomOverlayViewModelBadge',badges);
        const shape=nativeElement('badge-shape','ytBadgeShapeHost ytBadgeShapeThumbnailDefault ytBadgeShapeThumbnailBadge ytBadgeShapeModern ytBadgeShapeTypography',badge);
        nativeElement('div','ytBadgeShapeText',shape,item.duration);
      }
      const details=nativeElement('yt-lockup-metadata-view-model',grid?.querySelector('yt-lockup-metadata-view-model')?.getAttribute('class')||'ytLockupMetadataViewModelHost ytLockupMetadataViewModelVertical ytLockupMetadataViewModelStandard ytLockupMetadataViewModelRichGridLegacyTypography',host);
      if(item.channelAvatar) {
        const avatar=nativeElement('a','ytLockupMetadataViewModelAvatar',details);avatar.href=item.channelUrl||url;avatar.setAttribute('aria-label',item.channel);
        const avatarShape=nativeElement('yt-avatar-shape','',avatar);
        const avatarHost=nativeElement('div','ytSpecAvatarShapeHost ytSpecAvatarShapeButton ytSpecAvatarShapeButtonMedium',avatarShape);
        const avatarWrapper=nativeElement('div','',avatarHost);
        const size=nativeElement('div','ytSpecAvatarShapeAvatarSizeMedium',avatarWrapper);
        nativeImage('ytCoreImageHost ytSpecAvatarShapeImage ytCoreImageFillParentHeight ytCoreImageFillParentWidth ytCoreImageContentModeScaleToFill',size,item.channelAvatar);
      }
      const text=nativeElement('div','ytLockupMetadataViewModelTextContainer',details);
      const title=nativeElement('h3','ytLockupMetadataViewModelHeadingReset',text);
      const titleLink=nativeElement('a','ytLockupMetadataViewModelTitle',title,item.title);titleLink.href=url;titleLink.target='_self';
      const metadata=nativeElement('div','ytLockupMetadataViewModelMetadata',text);
      const content=nativeElement('yt-content-metadata-view-model','ytContentMetadataViewModelHost ytContentMetadataViewModelMediumText',metadata);
      const channelRow=nativeElement('div','ytContentMetadataViewModelMetadataRow',content);
      const channelText=nativeElement('span','ytAttributedStringHost ytContentMetadataViewModelMetadataText ytAttributedStringWhiteSpacePreWrap ytAttributedStringLinkInheritColor',channelRow);
      if(item.channelUrl){const channel=nativeElement('a','ytAttributedStringLink ytAttributedStringLinkCallToActionColor ytAttributedStringLinkInheritColor',channelText,item.channel);channel.href=item.channelUrl;}
      else channelText.textContent=item.channel;
      const uploadRow=nativeElement('div','ytContentMetadataViewModelMetadataRow',content);
      for(const value of [item.views,item.publishedLabel].filter(Boolean)) {
        if(uploadRow.children.length)nativeElement('span','ytContentMetadataViewModelDelimiter',uploadRow,' • ');
        nativeElement('span','ytContentMetadataViewModelMetadataText',uploadRow,value);
      }
      if(item.progress>3)nativeElement('div','watchbox-resume ytContentMetadataViewModelMetadataText',text,`Resume at ${Math.floor(item.progress/60)}:${String(Math.floor(item.progress)%60).padStart(2,'0')}`);
      const actions=document.createElement('div');actions.className='watchbox-card-actions';actions.setAttribute('role','group');actions.setAttribute('aria-label','Video actions');
      for(const action of ['queue','archive']) {
        const button=thumbnailButton(action,item.title,action==='queue'?url:undefined);
        if(action!=='queue')button.onclick=()=>persist(current=>WatchboxCore.change(current,item.id,action),action==='archive'?'Dismissed.':'Moved to inbox.',true);
        else {button.title='Open video to save to Watch later';button.setAttribute('aria-label',`${button.title}: ${item.title}`);}
        actions.append(button);
      }
      thumbnailShade(card);card.append(actions);list.append(card);positionThumbnailControls(card);cardResize?.observe(card);
    }
  }
  function videoFor(link,card) {
    return {url:link.href,title:(link.getAttribute('title')||link.textContent).trim(),channel:(card.querySelector('ytd-channel-name a, #channel-name a, a[href^="/@"]')||card.querySelector('ytd-channel-name, #channel-name'))?.textContent.trim()||'YouTube',...readYouTubeCardMetadata(card)};
  }
  function elementVisible(element,stop=null) {
    if(element.closest('[data-watchbox-age-limit] ytd-continuation-item-renderer'))return false;
    for(let parent=element;parent && parent!==stop;parent=parent.parentElement) {
      if(parent.hidden || getComputedStyle(parent).display==='none')return false;
    }
    return true;
  }
  function syncTitle() {
    if(location.pathname==='/feed/subscriptions') {
      const title=WatchboxPreferences.resolve(preferences).enabled && routeView()==='inbox'?'Inbox - YouTube':'Subscriptions - YouTube';
      if(document.title!==title)document.title=title;
    }
  }
  function update() {
    const options=WatchboxPageSettings.apply(preferences);
    syncAutoplay();
    syncTitle();
    const savingIds=new Set([...pendingSaves].filter(([id,before])=>saveDecision(state,id)===before).map(([id])=>id));
    syncSidebar();
    if(!options.enabled) {toast.hidden=true;clearTimeout(toastTimer);}
    document.documentElement.toggleAttribute('data-watchbox-quiet',options.enabled && options.hideShorts);
    const watching=options.enabled && location.pathname==='/watch';
    player.hidden=!watching;
    document.documentElement.toggleAttribute('data-watchbox-focus',watching && focus);
    player.querySelector('#watchbox-focus').setAttribute('aria-pressed',String(focus));
    undo.disabled=!state.history.length;
    for(const card of document.querySelectorAll('[data-watchbox-id]')) {
      const item=state.items.find(value=>value.id===card.dataset.watchboxId);
      card.toggleAttribute('data-watchbox-hidden',options.enabled && location.pathname==='/feed/subscriptions' && view==='inbox' && (savingIds.has(card.dataset.watchboxId) || ['queue','archive'].includes(item?.status) || isYouTubeVideoPastInboxLimit(card,options.inboxDays)));
      card.querySelector('[data-watchbox-action="queue"]')?.setAttribute('aria-pressed',String(item?.status==='queue'));
      const decision=card.querySelector('[data-watchbox-action="archive"], [data-watchbox-action="inbox"]');
      const action=view==='all' && ['queue','archive'].includes(item?.status)?'inbox':'archive';
      if(decision && decision.dataset.watchboxAction!==action) {
        decision.dataset.watchboxAction=action;decision.title=action==='inbox'?'Move to inbox':'Dismiss';
        decision.setAttribute('aria-label',`${decision.title}: ${card.querySelector(titleLinks)?.textContent.trim()}`);decision.replaceChildren(actionIcon(action));
      }
    }
    for(const grid of document.querySelectorAll('ytd-rich-grid-renderer, ytd-grid-renderer')) {
      const reachedLimit=options.enabled && location.pathname==='/feed/subscriptions' && view==='inbox' && [...grid.querySelectorAll('[data-watchbox-id]')].some(card=>isYouTubeVideoPastInboxLimit(card,options.inboxDays));
      grid.toggleAttribute('data-watchbox-age-limit',reachedLimit);
    }
    const browse=[...document.querySelectorAll('ytd-browse')].find(element=>!element.hidden);
    const grid=browse?.querySelector('ytd-rich-grid-renderer, ytd-grid-renderer');
    const remaining=grid?[...grid.querySelectorAll('[data-watchbox-id]')].filter(card=>!savingIds.has(card.dataset.watchboxId) && !['queue','archive'].includes(state.items.find(item=>item.id===card.dataset.watchboxId)?.status) && !isYouTubeVideoPastInboxLimit(card,options.inboxDays) && elementVisible(card,grid)):[];
    const remainingIds=new Set(remaining.map(card=>card.dataset.watchboxId));
    const returned=location.pathname==='/feed/subscriptions'?state.items.filter(item=>item.status==='inbox' && item.returnedToInbox && !savingIds.has(item.id) && !remainingIds.has(item.id)):[];
    renderLibrary(returned);
    const inboxCount=options.enabled && location.pathname==='/feed/subscriptions' && grid?remainingIds.size+returned.length:state.items.filter(item=>item.status==='inbox').length;
    const loadingMore=[...browse?.querySelectorAll('ytd-ghost-grid-renderer, #subscriptions-page-skeleton, ytd-continuation-item-renderer')||[]].some(element=>elementVisible(element));
    inboxEmpty.hidden=!(options.enabled && location.pathname==='/feed/subscriptions' && view==='inbox' && grid && !loadingMore && !inboxCount);
  }
  function notify(message,undoable=false) {
    if(!message)return;
    setText(notice,message);undo.hidden=!undoable;toast.hidden=false;dismissLater();
  }
  function saveDecision(current,id) {
    return JSON.stringify([current.items.find(item=>item.id===id)?.status||'inbox',current.history.filter(action=>action.id===id)]);
  }
  async function saveToYouTube(video,button,card) {
    const id=WatchboxCore.videoId(video.url);
    if(pendingSaves.has(id))return false;
    const before=saveDecision(state,id);let newerDecision=false;
    button.disabled=true;
    try {
      const saving=WatchboxWatchLater.save(id,{card});
      pendingSaves.set(id,before);update();notify('Saving to Watch later…');
      await saving;
      const committed=await persist(current=>{
        newerDecision=saveDecision(current,id)!==before;
        const collected={...current,items:WatchboxCore.collect(current.items,[video]).items};
        const next=newerDecision?collected:WatchboxCore.change(collected,id,'queue');
        next.items=next.items.map(item=>item.id===id?{...item,watchLater:true}:item);
        return next;
      },'',false);
      if(!committed){notify('Saved to Watch later, but could not update the inbox. Try again.');return false;}
      notify(newerDecision?'Saved to Watch later. Your newer inbox decision was kept.':'Saved to Watch later.');
      return true;
    } catch(error) {notify(error.message||'Could not confirm the save to YouTube. Try again.');}
    finally {pendingSaves.delete(id);update();button.disabled=false;}
  }
  function persist(change,message,undoable=false) {
    // Evaluate each change after the previous write commits, so background metadata
    // and user actions always build on the latest library and Undo history.
    pendingWrites=pendingWrites.then(async()=>{
      try {const next=change(state);await browser.storage.local.set({watchbox:next});state=next;update();notify(message,undoable);return true;}
      catch {notify('Could not save. Try again.');return false;}
    });
    return pendingWrites;
  }
  async function refreshLibraryMetadata() {
    if(view!=='inbox' || loadingMetadata || typeof fetch!=='function' || !WatchboxPreferences.resolve(preferences).enabled)return;
    loadingMetadata=true;const requestedView=view;
    try {
      while(view===requestedView && WatchboxPreferences.resolve(preferences).enabled) {
        const candidates=state.items.filter(item=>item.status==='inbox' && item.returnedToInbox && (!item.publishedAt || !item.channelAvatar) && !metadataRequests.has(item.id)).slice(0,3);
        if(!candidates.length)break;
        const results=await Promise.allSettled(candidates.map(async item=>{
          metadataRequests.add(item.id);
          const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
          try {
            const url=`https://www.youtube.com/watch?v=${item.id}`;
            const response=await fetch(url,{signal:controller.signal});
            if(!response.ok)return null;
            const metadata=readYouTubeWatchMetadata(await response.text());
            return metadata.publishedAt?{url,...metadata}:null;
          } finally {clearTimeout(timeout);}
        }));
        if(!WatchboxPreferences.resolve(preferences).enabled)break;
        const videos=results.filter(result=>result.status==='fulfilled' && result.value && state.items.some(item=>item.id===WatchboxCore.videoId(result.value.url))).map(result=>result.value);
        if(videos.length)await persist(current=>({...current,items:WatchboxCore.collect(current.items,videos.filter(video=>current.items.some(item=>item.id===WatchboxCore.videoId(video.url)))).items}), '');
      }
    } finally {loadingMetadata=false;if(view!==requestedView)refreshLibraryMetadata();}
  }
  undo.onclick=async()=>{
    undo.disabled=true;
    if(!await persist(current=>WatchboxCore.undo(current),'Undone.'))undo.hidden=false;
    undo.disabled=!state.history.length;
  };
  async function sync() {
    if(busy) {resync=true;return;}
    resync=false;busy=true;
    try {
      if(!WatchboxPreferences.resolve(preferences).enabled) {document.documentElement.removeAttribute('data-watchbox-feed');update();return;}
      view=routeView();
      const metadata=document.querySelector('ytd-watch-metadata');
      if(metadata && player.parentElement!==metadata) metadata.append(player);
      const browse=[...document.querySelectorAll('ytd-browse')].find(element=>!element.hidden);
      const grid=browse?.querySelector('ytd-rich-grid-renderer, ytd-grid-renderer');
      document.documentElement.toggleAttribute('data-watchbox-feed',Boolean(grid) && location.pathname!=='/watch');
      if(grid && shelf.parentElement!==grid.parentElement) {grid.before(shelf);grid.after(inboxEmpty);}
      const metadataUpdates=[],knownIds=new Set(state.items.map(item=>item.id));
      for(const link of browse?.querySelectorAll(titleLinks)||[]) {
        if(link.closest('#watchbox-saved-shelf'))continue;
        const id=WatchboxCore.videoId(link.href);
        const card=link.closest('ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer')||link.closest('yt-lockup-view-model');
        if(!id || !card) continue;
        if(knownIds.has(id))metadataUpdates.push(videoFor(link,card));
        card.dataset.watchboxId=id;
        const existing=card.querySelector('.watchbox-card-actions');
        if(existing) {
          for(const button of existing.querySelectorAll('button')) button.setAttribute('aria-label',`${button.title}: ${link.textContent.trim()}`);
          positionThumbnailControls(card);
          continue;
        }
        const actions=document.createElement('div');actions.className='watchbox-card-actions';actions.setAttribute('role','group');actions.setAttribute('aria-label','Video actions');
        for(const action of ['queue','archive']) {
          const button=thumbnailButton(action,link.textContent.trim());
          button.onclick=event=>{
            event.preventDefault();event.stopPropagation();
            const currentLink=card.querySelector(titleLinks);
            const currentId=currentLink && WatchboxCore.videoId(currentLink.href);
            if(!currentId) return;
            const video=videoFor(currentLink,card);
            if(action==='queue')return saveToYouTube(video,button,card);
            const decision=button.dataset.watchboxAction;
            return persist(current=>WatchboxCore.change({...current,items:WatchboxCore.collect(current.items,[video]).items},currentId,decision),decision==='inbox'?'Moved to inbox.':'Dismissed.',true);
          };
          actions.append(button);
        }
        thumbnailShade(card);card.append(actions);positionThumbnailControls(card);cardResize?.observe(card);
      }
      if(location.pathname==='/feed/subscriptions') {
        const refreshMetadata=current=>{
          let items=current.items;
          for(let start=0;start<metadataUpdates.length;start+=60)items=WatchboxCore.collect(items,metadataUpdates.slice(start,start+60)).items;
          return {...current,items};
        };
        if(JSON.stringify(refreshMetadata(state).items)!==JSON.stringify(state.items))await persist(refreshMetadata,'');
        const recoverInbox=current=>{
          const lastActions=new Map(current.history.map(action=>[action.id,action]));
          return {...current,items:current.items.map(item=>item.status==='inbox' && item.returnedToInbox===undefined && ['queue','archive'].includes(lastActions.get(item.id)?.status)?{...item,returnedToInbox:true}:item)};
        };
        if(recoverInbox(state).items.some((item,index)=>item!==state.items[index]))await persist(recoverInbox,'');
        const candidates=captureYouTubePage(state.items.map(item=>item.id),WatchboxPreferences.resolve(preferences).inboxDays).videos;
        if(candidates.length && await persist(current=>({...current,items:WatchboxCore.collect(current.items,candidates).items}),'') && candidates.length===60) schedule();
      }
      update();
      refreshLibraryMetadata();
    } finally {busy=false;if(resync)schedule();}
  }
  function schedule() {clearTimeout(timer);timer=setTimeout(sync,80);}
  document.addEventListener('yt-navigate-finish',schedule);window.addEventListener('popstate',schedule);
  window.addEventListener('hashchange',schedule);
  window.addEventListener('resize',schedule);
  browser.storage.onChanged.addListener((changes,area)=>{
    if(area!=='local')return;
    if(changes.watchbox?.newValue)state=changes.watchbox.newValue;
    if(changes.watchboxPreferences){preferences=changes.watchboxPreferences.newValue||{};schedule();}
    update();
  });
  const observer=new MutationObserver(schedule);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['href']});
  const titleObserver=new MutationObserver(syncTitle);titleObserver.observe(document.head,{childList:true,subtree:true,characterData:true});
  await sync();
})();
