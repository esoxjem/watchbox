# Watchbox

Inbox Zero for YouTube. A Firefox extension that turns your subscriptions into a finite inbox: save what you want to watch to YouTube’s Watch Later, dismiss the rest, and reach **All caught up**.

Choose an inbox window of 1–30 days (14 by default), hide distractions like Shorts and recommendations, and keep YouTube’s native interface.

Preferences and inbox decisions stay in your browser. Watch Later saves use your YouTube account. No analytics or developer-operated backend.

## Try it

1. In Firefox, open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on…** and select `manifest.json` from this repository.
3. Open YouTube and select **Inbox** in the sidebar. Click the Watchbox toolbar button for settings.

Temporary installations must be loaded again after Firefox restarts. See [Help](help.html) for usage details.

## Development

```sh
npm ci
npm test
npm run lint
npm run build
```

The extension package is written to `artifacts/`.

Report bugs through [GitHub issues](https://github.com/esoxjem/watchbox/issues). For contributions, follow [AGENTS.md](AGENTS.md) and use the [pull request template](.github/PULL_REQUEST_TEMPLATE.md).

## License

[MIT](LICENSE).
