# Source provenance audit — 13 October 2026

This repository starts from the cleaned Firefox/Zen source snapshot of 13 October 2026 with a new Git history. The predecessor's prepared tree was audited alongside 208 distinct source and asset blobs reachable from its local and remote-tracking Git branches. Comparison packages remain outside this repository.

## Comparison scope

| Package | Version | Archive SHA-256 |
| --- | --- | --- |
| Unhook Firefox | 1.6.9 | `46bbf40b781ace323771ff193c5de2785b410d5d883641f8f07c393a8f96d69c` |
| Unhook Chrome | 1.6.9 | `8622b2698dff08baae26a8c3638f524e66dfc12562e728694819fa1ef2e28023` |
| UnTrap Firefox | 12.1 | `a7f9a81719d2d54fd15c7e938e32dfbb698309c7a4a4e80ad48594f835d7b6b5` |
| UnTrap Chrome | 12.3 | `0e1234b493fa3865152251ba829dcd9895ebc7fc42e982dbc19a5cf89b9bb10f` |

The Firefox archive hashes match their recorded official package metadata. Chrome archives are pinned by the hashes above. Comparisons covered 1,304 extracted files, including scripts, styles, markup, and images. Whole-file SHA-256 comparisons found no identical vendor files or assets in the tracked working tree or historical source blobs.

JavaScript was also compared in consecutive sequences of at least 24 parser tokens, both preserving identifiers and normalizing local identifiers. Flagged matches were reviewed with the surrounding code and development history. The current-tree matches were routine time formatting, local storage event handling, and Promise cancellation fragments. The time formatter was introduced in `6f25c78` on 7 October, before the UnTrap inspection on 9 October. These fragments did not establish copying. No substantive imported UnTrap implementation was identified in the browser compatibility branches.

## Replacements

Development history explicitly used Unhook to inform visibility filters, early Home routing, logo handling, and annotation controls. Those areas were conservatively re-authored from Watchbox's behavioral requirements and tests:

- `background.js`: validates desktop YouTube Home URLs and tab identities, reads the initial routing policy, follows local preference changes, and recovers after a failed initial storage read.
- `page-settings.js`: reconciles each logo's original destination, uses delegated navigation handling, and observes late native annotation controls. Removing a preference restores ownership to the native page.
- `page-start.js`: initializes preferences before Inbox work, rejects stale startup snapshots, and leaves native content usable after storage failure.
- `related.css`: independently organized native-surface rules preserve reversible filters and constrain the Shorts title fallback to navigation.

The new implementations use documented [Firefox request events](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/onBeforeRequest), [tab navigation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/update), standard DOM APIs, and Watchbox fixtures. YouTube element names, URLs, and native control attributes remain integration identifiers. The implementation does not include comparison-package code or assets. This was a re-authoring after source inspection; it is not a claim of a formal clean-room process.

Existing library decisions, preferences, native Watch Later saving, resume positions, Inbox limits, and storage formats are preserved. Development guidance now requires original implementations grounded in Watchbox requirements and browser documentation.

## Validation and publication

New tests were observed failing before each replacement slice. The full suite passes 182 tests, including existing hiding, navigation, saving, storage, and playback regressions and the new repository's store-listing destination. Live YouTube verification of this revision remains outstanding; automated page integration checks use DOM fixtures.

This audit is limited to the named packages and available development history. Token similarity is an aid to review and cannot prove authorship or establish legal clearance.

The private predecessor, `esoxjem/watchbox-extension`, retains older Git commits, other branches, and CI artifacts containing previous implementations. None of its Git history or CI artifacts was imported into this repository. Credentials, dependencies, generated builds, and comparison packages were excluded from the initial source snapshot. MIT licensing of the prepared source does not change the terms of third-party software or authorize redistribution of old comparison material.
