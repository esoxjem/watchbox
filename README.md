# Watchbox for YouTube — Firefox

A standalone extension that adds a finite subscriptions inbox, native YouTube Watch Later saves, local dismissals, and distraction controls to YouTube's native interface.

## Install and use

1. Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on…**, and select this project's `manifest.json`. For updates, choose **Reload**, then refresh existing YouTube tabs.
2. Allow access to `https://www.youtube.com/*` and `https://youtube.com/*`. If necessary, enable these sites under **about:addons → Watchbox → Permissions and data**.
3. Open **Inbox** at the top of YouTube’s sidebar. Hover or keyboard-focus a thumbnail for **Save to Watch later** and **Dismiss**. Save uses YouTube's native controls and removes the video from the inbox immediately while account confirmation runs in the background. If confirmation or the local write fails, the item returns with a retry message. Dismiss records a local decision and offers **UNDO** in the floating action message. Account saves do not offer Undo; remove them through YouTube's playlist controls.
4. **Inbox** and **Watch later** appear at the top of the expanded and compact sidebars. The left menu keeps **Inbox**, **Watch later**, **Subscriptions**, and **You** in that order, hiding other top-level sections and the footer. Expanding either native group reveals its contents. YouTube's native **Subscriptions** link opens the full feed, including saved, dismissed and older videos, with normal pagination. Its separate arrow button expands or collapses the channel list without navigating. **Watch later** opens YouTube's own playlist. Saved and dismissed cards in Subscriptions offer **Move to inbox**, with Undo. Returned Inbox cards retain resume links; saving from one opens its watch page to use native controls.
5. On a watch page, **Save to Watch later**, **Save position**, **Watched**, and **Focus** appear under the video information. Progress and watched status are recorded manually. Focus hides the whole sidebar and stays separate from persistent preferences.
6. Click the **Watchbox toolbar button** to open settings, or use **about:addons → Watchbox → Preferences**. Changes save automatically and update open YouTube pages. **Hide Shorts** is controlled only from settings. The footer shows the installed version and links to bundled **Help** and **Report an issue** on GitHub.

Temporary installations end when Firefox restarts. This unsigned development build must be loaded again; it is not a signed marketplace release.

## Settings

| Group | Options |
|---|---|
| General | Watchbox enabled; Dark mode for the settings page |
| Inbox | Show the last 1–30 days (default: 14 days) |
| Home | Hide Home feed; Redirect to Inbox |
| Video sidebar | Hide video sidebar; Hide recommendations; Hide live chat; Hide playlist panel; Hide fundraisers |
| End screens | Hide end-screen suggestions; Hide creator end-screen cards |
| Content | Hide Shorts; Hide Mixes; Hide shopping and ticket offers |
| Comments | Hide comments; Hide commenter photos |
| Video information | Hide video details; Hide video action buttons; Hide channel info; Hide description |
| Header | Hide YouTube header; Hide notification bell |
| Discovery and navigation | Hide search suggestions; Hide Explore and Trending; Hide More from YouTube; Hide Subscriptions |
| Playback | Disable annotations |

**Hide related videos** is a shortcut for recommendations, paused suggestions, the end-screen feed, and creator cards. The three component settings can also be changed independently. Existing related-video and Shorts preferences are retained. For a fresh install, these related surfaces and Shorts are hidden; other filters start off.

Turning **Watchbox enabled** off restores native content and stops new inbox imports without erasing the library or preferences. Home and the YouTube logo redirect to Inbox only when Home's feed is hidden and Subscriptions remain visible. Hide search suggestions removes supplementary suggestion shelves, while preserving normal matching video results. Watch Later playback gets an autoplay toggle using YouTube’s own player styling. It starts on and remembers your choice; turning it off pauses within the final half-second to prevent automatic playlist advancement while keeping manual Next and Previous available. Other videos and playlists keep YouTube’s native controls. Disable Annotations hides annotation overlays and switches off the native Annotations option when available (English label or explicit annotation identifier). Creator end-screen cards have their own setting.

Home routing validates HTTPS desktop YouTube Home requests before navigating the tab to Inbox. It reads preferences once and follows subsequent local settings changes. Each rendered YouTube logo links directly to Inbox while routing is enabled; replaced links release their original destinations and new links are reconciled automatically. Preferences and hiding initialize at `document_start`; inbox work stays at `document_idle`. A guarded fallback covers Home already open when settings change and in-page or Back navigation. Turning redirection off restores each original logo destination and native click handling. Failed preference reads leave native content available until a settings change arrives.

Hide Home Feed covers standard and class-based Home grids, including the layout without a page subtype identified by its filter-chip bar and absence of a channel header. It also hides Home loading placeholders, including content inserted later. These rules follow Hide Home Feed and the master switch, so turning either off restores Home; Subscriptions and channel pages retain their content.

Shorts hiding covers expanded and compact navigation even when YouTube omits the link URL. Its title fallback is limited to navigation, so an ordinary video named “Shorts” remains visible. Explore and Trending hide their individual entries; only the section containing Storefront is hidden as a whole. Other links in a mixed navigation section stay visible. Both settings cover late links and restore content when disabled.

Inbox uses `/feed/subscriptions#watchbox-inbox`; the native Subscriptions link uses `/feed/subscriptions`. Both support refresh and Back/Forward. Card link changes trigger a rescan so reused native cards cannot retain another video's hidden state. Only Inbox filters decisions and applies the age limit set in Settings (14 days by default, adjustable from 1 to 30 days). Changing the limit updates open YouTube tabs without deleting stored decisions. Videos explicitly moved to Inbox remain available regardless of age. Inbox navigation shows no count badge. Earlier returns are recovered from available Undo history; missing or older returned videos use native-styled local cards.

The native Subscriptions and You groups start collapsed. Their labels remain navigation links; separate arrow buttons toggle their contents. Manual expansion survives in-page navigation and sidebar replacement for the lifetime of the tab; refreshing starts collapsed again. The compact Subscriptions shortcut remains available. Disabling Watchbox restores native content and hides custom controls. The retired Archive URL opens the full Subscriptions feed; existing local decisions and positions remain intact.

When all subscriptions within the chosen age limit have been saved or dismissed and pagination has ended, Inbox shows **All caught up**. Loading placeholders do not show the empty state. Action messages such as **Dismissed. UNDO** float at the bottom left without shifting the grid. Messages dismiss after eight seconds; hover or keyboard focus pauses dismissal. Background collection does not replace an action message. If Undo cannot save, it remains available to retry.

## Data and limits

- Dismissal and inbox decisions, resume positions, and preferences stay in `browser.storage.local`. Save adds the video to the signed-in YouTube account's Watch Later through native page controls. Dismiss and Move to inbox actions offer Undo; remove account entries using YouTube's own playlist controls. New saves have no separate local Saved view.
- Firefox's installation consent declares authentication information, website content and website activity. Watch Later confirmation sends session-derived authentication and page-derived playlist request data only to YouTube; saving uses YouTube's native account controls. Metadata backfills also request YouTube watch pages. Watchbox has no developer-operated backend or analytics.
- Content scripts match only desktop YouTube pages on the two declared HTTPS origins. No mobile pages, other sites, or embedded frames receive content scripts. API permissions are `storage` and `webRequest`; Home request observation is restricted to the existing YouTube hosts. No backend, OAuth, cookies, history, tabs, scripting, or webRequestBlocking permission is needed.
- Host access covers reading and changing YouTube's page DOM, including video IDs, titles, creator names and the player's position.
- Subscriptions imports newly loaded videos in batches of up to 60, including later pages as you scroll, while preserving existing decisions and progress. Inbox hides videos whose upload labels reach the chosen age limit and stops native pagination at that cutoff. Labels such as weeks and months provide approximate ages. The full Subscriptions feed and Watch Later remain available regardless of age. Undated cards remain visible. Unimported recent cards remain visible if a storage write fails. This is not a complete subscription sync. Home recommendations are not imported automatically.
- Library cards cache upload dates and public card metadata from loaded YouTube cards. When a viewed collection contains older entries without dates or creator avatars, Watchbox reads their YouTube watch-page metadata in batches of three and caches it locally; it does not start playback. Entries whose dates remain unavailable sort last. Thumbnails and creator avatars load from YouTube's image hosts.
- Hiding is cosmetic and does not block YouTube's network requests. Home routing updates the tab rather than cancelling or modifying network requests. YouTube markup changes can require selector updates.

## Responsiveness

Perceived speed is a core product priority. Actions should give immediate feedback, keep confirmation work in the background, and recover visibly when an operation fails. Save removes its Inbox card in the click handler without waiting for network or storage. Pending UI changes stay separate from stored decisions, so background updates and failure recovery preserve newer actions and Undo history.

## Watch Later

Save works on the observed English desktop feed and watch-page menus. It opens YouTube's native action or playlist selector, keeps an already selected Watch Later entry selected, and then reads the authenticated Watch Later page without caching. Exact video membership is checked across the playlist, with fresh scans retried after 500 ms for up to ten seconds. Requests and retry delays have a deadline; redirects, failed reads, malformed data, unavailable controls, and navigation changes during native submission restore the item with a retry message while keeping stored decisions unchanged. Once account membership is confirmed, navigation or card replacement does not discard the result; the decision is saved for the original video ID. Opening another video's native menu cancels a pending feed save. Native menu submissions are protected from overlap; after submission, another video can be saved while earlier confirmations run independently. Duplicate clicks for a pending video are ignored. A delayed confirmation or failure preserves a newer dismissal/inbox decision.

Confirmation follows Watch Later continuation pages within the same ten-second deadline, using the signed-in YouTube session and account context. Only exact entries in that playlist count as confirmation; recommendations and unrelated continuation targets are ignored. Repeated tokens end that scan before retrying a fresh playlist read. Native markup changes and other interface languages may require selector updates. Account saves and local writes are separate: if YouTube succeeds but the local write fails, the message says so and keeps the inbox action available to retry.

## Mozilla Add-ons CLI

Mozilla's [`web-ext`](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#web-ext-sign) is pinned through the npm lockfile. To make it available outside npm scripts, run `npm install --global web-ext@10.7.0`.

Copy `.env.example` to `.env`, then fill in `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET` from [AMO API credentials](https://addons.mozilla.org/developers/addon/api/key/). Keep `.env` local; it is ignored by Git and excluded from extension packages. The npm commands below load it automatically. Existing environment variables take precedence.

```sh
npm run amo -- get
cp store/listing.example.json store/listing.json
# Review and edit store/listing.json, then apply its fields:
npm run amo -- update store/listing.json
```

The example is draft copy, not a snapshot of the live listing. `get` reads the listing identified by the manifest's Firefox ID. `update` uses Mozilla's [AMO metadata API](https://mozilla.github.io/addons-server/topics/api/addons.html#edit) to patch only the provided listing fields without uploading a version. Use locale objects such as `{"en-US":"..."}` for translated fields and `{"firefox":["category-slug"]}` for categories. This helper supports listing text, categories, tags, links and related metadata. Manage screenshots and privacy-policy text in the [AMO Developer Hub](https://addons.mozilla.org/developers/).

Upload the store icon with `npm run amo -- icon store/icons/watchbox-1024.png`. The PNGs in `store/icons` are rendered directly from `icon.svg` at 32, 64, 128, 256, 512 and 1024 pixels. AMO generates its own 32, 64 and 128 pixel derivatives asynchronously; a larger upload does not control the size selected by the storefront.

For a version submission, use the official signing command:

```sh
npm test
npm run lint
npm run sign -- --channel listed
```

`listed` submits a public AMO version; `unlisted` signs for self-distribution. Each update needs an unused manifest version. For a first listing, also pass `--amo-metadata <submission.json>` with the required summary, categories, and chosen `version.license`; the listing example above is for page edits. No submission runs automatically. Build, lint and sign share the package exclusions in `package.json`, keeping store tooling and credentials out of the extension.

## Validate

```sh
npm ci
npm test
npm run lint
npm run build
```

Use Node 22.22.2+, 24.15+ or 26+. The package is `artifacts/watchbox-0.3.0.zip`; tests and development dependencies are excluded.

Tests cover library decisions and Undo, Inbox age limits and pagination, recycled cards, native Watch Later saves and authenticated confirmation, delayed and failed writes, navigation, reversible settings, playback controls, and packaging. Most page integration tests use DOM fixtures; passing tests do not guarantee compatibility with every live YouTube layout or language. Browser restart persistence remains unverified for temporary installations.

## Contributing

Report bugs through [GitHub issues](https://github.com/esoxjem/watchbox/issues), including your browser version, steps to reproduce, and expected behavior. Remove account details and credentials from screenshots and logs.

Keep pull requests focused, follow [AGENTS.md](AGENTS.md), and use the [pull request template](.github/PULL_REQUEST_TEMPLATE.md). Development changes require a failing regression test before implementation, followed by the full validation commands above. Changes to YouTube integration should also be checked in Firefox, with any unverified behavior stated in the pull request.

## License

Watchbox is available under the [MIT license](LICENSE). The vendored development skill retains its own [upstream copyright notices](.github/skills/test-driven-development/UPSTREAM.md).
