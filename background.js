// Browser entry points use only local preferences and documented Firefox APIs.
(() => {
  browser.action.onClicked.addListener(() => browser.runtime.openOptionsPage());

  let changedPolicy;
  const initialPolicy = browser.storage.local.get('watchboxPreferences')
    .then(data => WatchboxPreferences.redirectsHome(data.watchboxPreferences))
    .catch(() => false);

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.watchboxPreferences) {
      changedPolicy = WatchboxPreferences.redirectsHome(changes.watchboxPreferences.newValue);
    }
  });

  async function visitInbox(request) {
    if (!Number.isInteger(request.tabId) || request.tabId < 0) return;
    let destination;
    try { destination = new URL(request.url); } catch { return; }
    if (!['https://youtube.com', 'https://www.youtube.com'].includes(destination.origin)
      || destination.pathname !== '/') return;

    const storedPolicy = await initialPolicy;
    if (changedPolicy ?? storedPolicy) {
      await browser.tabs.update(request.tabId, {
        url: 'https://www.youtube.com/feed/subscriptions#watchbox-inbox'
      });
    }
  }

  browser.webRequest.onBeforeRequest.addListener(visitInbox, {
    urls: ['https://youtube.com/', 'https://youtube.com/?*', 'https://www.youtube.com/', 'https://www.youtube.com/?*'],
    types: ['main_frame', 'sub_frame', 'xmlhttprequest']
  });
})();
