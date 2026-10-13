// Shared preference names and defaults for the settings page and YouTube.
globalThis.WatchboxPreferences = (() => {
  const groups = [
    ['General', [['enabled','Watchbox enabled'],['darkMode','Dark mode']]],
    ['Inbox', []],
    ['Home', [['hideHomeFeed','Hide Home feed'],['redirectToSubscriptions','Redirect to Inbox']]],
    ['Video sidebar', [['hideVideoSidebar','Hide video sidebar'],['hideRecommended','Hide recommendations'],['hideLiveChat','Hide live chat'],['hidePlaylist','Hide playlist panel'],['hideFundraiser','Hide fundraisers']]],
    ['End screens', [['hideEndScreenFeed','Hide end-screen suggestions'],['hideEndScreenCards','Hide creator end-screen cards']]],
    ['Content', [['hideShorts','Hide Shorts'],['hideMixes','Hide Mixes'],['hideMerch','Hide shopping and ticket offers']]],
    ['Comments', [['hideComments','Hide comments'],['hideProfilePhotos','Hide commenter photos']]],
    ['Video information', [['hideVideoInfo','Hide video details'],['hideButtonsBar','Hide video action buttons'],['hideChannel','Hide channel info'],['hideDescription','Hide description']]],
    ['Header', [['hideTopHeader','Hide YouTube header'],['hideNotifications','Hide notification bell']]],
    ['Discovery and navigation', [['hideInaptSearchResults','Hide search suggestions'],['hideExploreTrending','Hide Explore and Trending'],['hideMoreFromYouTube','Hide More from YouTube'],['hideSubscriptions','Hide Subscriptions']]],
    ['Playback', [['disableAnnotations','Disable annotations']]]
  ];
  const related = ['hideRecommended','hideEndScreenFeed','hideEndScreenCards'];
  function resolve(stored = {}) {
    const values = Object.fromEntries(groups.flatMap(([,options]) => options.map(([key]) => [key,stored[key] === true])));
    values.enabled = stored.enabled !== false;
    values.inboxDays = Number.isInteger(stored.inboxDays) ? Math.min(30,Math.max(1,stored.inboxDays)) : 14;
    values.hideShorts = typeof stored.hideShorts === 'boolean' ? stored.hideShorts : stored.quiet !== false;
    for (const key of related) values[key] = typeof stored[key] === 'boolean' ? stored[key] : stored.hideRelated !== false;
    return values;
  }
  function redirectsHome(stored) {
    const values=resolve(stored);
    return values.enabled && values.hideHomeFeed && values.redirectToSubscriptions && !values.hideSubscriptions;
  }
  return {groups,related,resolve,redirectsHome};
})();
