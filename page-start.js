// Apply preferences before Inbox initialization, and refresh on page navigation.
(() => {
  let current, revision = 0;
  const render = () => {
    if (current !== undefined) WatchboxPageSettings.apply(current);
  };
  for (const event of ['load', 'popstate', 'yt-navigate-finish', 'yt-page-data-updated']) {
    window.addEventListener(event, render);
  }
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !('watchboxPreferences' in changes)) return;
    revision++;
    current = changes.watchboxPreferences.newValue || {};
    render();
  });

  const requestedAt = revision;
  return browser.storage.local.get('watchboxPreferences').then(snapshot => {
    if (revision !== requestedAt) return;
    current = snapshot.watchboxPreferences || {};
    render();
  }).catch(() => { /* Keep native content available until a settings change arrives. */ });
})();
