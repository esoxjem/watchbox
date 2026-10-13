// Reconcile Watchbox preferences with the current YouTube document.
globalThis.WatchboxPageSettings = (() => {
  const inbox = 'https://www.youtube.com/feed/subscriptions#watchbox-inbox';
  const originalLinks = new Map();
  let settings = {}, waitingForNavigation = false;

  function restoreLink(link, href) {
    if (href === null) link.removeAttribute('href');
    else link.setAttribute('href', href);
    originalLinks.delete(link);
  }

  function reconcileLinks() {
    const enabled = WatchboxPreferences.redirectsHome(settings);
    const current = new Set(enabled ? document.querySelectorAll('a#logo') : []);
    for (const [link, href] of originalLinks) {
      if (!current.has(link)) restoreLink(link, href);
    }
    for (const link of current) {
      if (!originalLinks.has(link)) originalLinks.set(link, link.getAttribute('href'));
      if (link.href !== inbox) link.href = inbox;
    }
  }

  // Stop YouTube's delegated Home handler while retaining the link's browser action.
  for (const type of ['click', 'touchend']) {
    document.documentElement.addEventListener(type, event => {
      const link = event.target.closest?.('a');
      if (originalLinks.has(link)) event.stopPropagation();
    }, true);
  }
  const pageObserver = typeof MutationObserver === 'function'
    ? new MutationObserver(() => { reconcileLinks(); reconcileAnnotations(); }) : null;

  function reconcileAnnotations() {
    if (!settings.enabled || !settings.disableAnnotations) return;
    const player = document.querySelector('#movie_player');
    for (const option of player?.querySelectorAll('[role="menuitemcheckbox"]') || []) {
      const label = option.querySelector('.ytp-menuitem-label')?.textContent.trim().toLowerCase();
      if (option.dataset.setting !== 'annotations' && label !== 'annotations') continue;
      if (option.getAttribute('aria-checked') === 'true' || option.getAttribute('aria-pressed') === 'true') option.click();
    }
  }

  function apply(stored) {
    settings = WatchboxPreferences.resolve(stored);
    const root = document.documentElement;
    root.toggleAttribute('data-watchbox-disabled', !settings.enabled);
    for (const key of Object.keys(settings)) {
      if (!/^(hide|disable)/.test(key)) continue;
      const attribute = 'data-watchbox-' + key.replace(/[A-Z]/g, character => '-' + character.toLowerCase());
      root.toggleAttribute(attribute, settings.enabled && settings[key]);
    }
    root.toggleAttribute('data-watchbox-hide-related', settings.enabled && WatchboxPreferences.related.every(key => settings[key]));

    const routeHome = WatchboxPreferences.redirectsHome(settings);
    root.toggleAttribute('data-watchbox-redirect-home', routeHome);
    pageObserver?.disconnect();
    reconcileLinks();
    if (routeHome || (settings.enabled && settings.disableAnnotations)) {
      pageObserver?.observe(root, {
        subtree: true, childList: true, attributes: true,
        attributeFilter: ['href', 'aria-checked', 'aria-pressed']
      });
    }

    const isHome = ['/', '/index'].includes(location.pathname);
    if (!routeHome || !isHome) waitingForNavigation = false;
    else if (!waitingForNavigation) {
      waitingForNavigation = true;
      location.replace('/feed/subscriptions#watchbox-inbox');
    }
    reconcileAnnotations();
    return settings;
  }

  return {apply};
})();
