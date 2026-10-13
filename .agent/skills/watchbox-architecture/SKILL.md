---
name: watchbox-architecture
description: "Design, review, or refactor Watchbox's modular browser-extension architecture. Use for Watchbox module boundaries, state ownership, and portability across Firefox, Chromium, and Safari while preserving its native YouTube experience."
---

# Watchbox Architecture

The user selected option 1: a modular extension inside YouTube, with shared functionality and a small browser-platform boundary. Use this as the default architecture for Watchbox; revise it when the user's requirements change.

Resolve the active Watchbox checkout and read its `AGENTS.md`, manifest, relevant code, and tests before applying this guidance. The boundaries below describe the target design, not a claim that the extraction is complete.

## Product direction

Keep the finite subscriptions Inbox, native YouTube Watch Later, local decisions and resume positions, and reversible distraction controls. Enhance YouTube's own surfaces and playback. An independent dashboard, backend, account system, automatic subscription sync, or background-owned library would be a separate product or architecture change.

Browser portability is a design goal. Implement only the browser targets requested in the current task; choosing this architecture does not itself request Chromium or Safari releases.

## Ownership boundaries

Use cohesive modules with small public interfaces. These are responsibilities, not a requirement for five files, classes, or a framework.

| Boundary | Owns | Keeps outside its interface |
| --- | --- | --- |
| Library | Inbox decisions, watched status, progress, Undo, explicit returns, eligibility rules, and metadata merges | DOM nodes, selectors, extension APIs, network calls, and presentation |
| YouTube adapter | Native page discovery, metadata parsing, navigation signals, controls, account-save submission and confirmation, and YouTube markup used by native UI enhancements | Persisted library decisions and Undo rules |
| Store | Loading state, ordering page-owned writes, evaluating transformations against current committed state, and observing external storage changes | Selectors, native YouTube actions, and toast rendering |
| Page controller | Routes, view updates, user actions, pending visual state, toasts, Focus, and coordination of the other modules | Raw extension APIs, scattered YouTube selectors, and duplicated library rules |
| Platform adapter and browser entry points | Extension storage access and events, opening settings, tab navigation, API compatibility, and browser-specific initialization | Library policy and YouTube page structure |

Keep dependency direction explicit: the Library has no dependency on the other boundaries; the Store uses the Library and Platform; the YouTube adapter uses page APIs; the Page controller coordinates their public contracts. Browser entry points wire dependencies and host browser-specific background behavior.

Pass normalized video facts and decisions across boundaries. Keep reading age labels in the YouTube adapter and applying Inbox age policy in the Library. Native rendering may need YouTube-specific DOM handles; keep those within page integration and out of Library, Store, and Platform contracts.

Prefer direct functions and explicit dependencies. Add a bus, dependency-injection container, build framework, or another abstraction only when a concrete requirement warrants it. Extract one meaningful responsibility at a time rather than reorganizing the entire repository upfront.

## State and interaction invariants

- Evaluate queued write transformations after earlier writes finish, against the latest committed state. Metadata updates preserve decisions, progress, precise dates, and Undo history. Failed persistence leaves committed state intact and allows a retry.
- Keep pending visual state separate from persisted decisions. Save gives immediate feedback; confirmation and storage finish asynchronously. Failure restores the correct current view without undoing a newer action.
- Track saves by video identity. Prevent duplicate pending saves and overlapping native menu submissions, while allowing independent confirmations after submission. Late confirmation preserves newer Inbox or dismissal decisions and commits the original video's result after in-page navigation.
- Treat account-save confirmation and local persistence as separate outcomes. Use bounded confirmation and report partial success when YouTube succeeds but the local write fails. Undo for local decisions does not imply undoing a YouTube account save.
- Re-read identity when YouTube recycles cards. A replacement card must not inherit another video's controls or hidden state.
- Preserve bounded capture across continuation pages, loading-aware caught-up state, the age cutoff, and explicit returned videos. An unimported recent card remains visible after a failed write. Full Subscriptions remains separate from Inbox filtering.
- Preserve early preferences, hiding, and Home routing at `document_start`, with Inbox work at `document_idle`. Keep filters and injected controls reversible through the master switch, without erasing stored data.
- Preserve the existing storage schema during extraction unless a migration is requested. Legacy `queue` and `archive` values are persisted compatibility data even where UI terminology has changed.

Option 1 retains write coordination in each page. A per-tab promise queue and storage-change notifications are not a global lock or atomic transaction across tabs. Do not claim that module extraction fixes concurrent cross-tab writes. Assess a demonstrated cross-tab issue separately; central background ownership is option 2.

## Browser portability

Share Library, controller, and YouTube behavior where possible. Centralize extension-API compatibility in Platform rather than scattering browser detection through product logic. Use capability checks or a proven polyfill when required by the supported versions; avoid wrappers for unrelated APIs.

Keep target-specific manifests, background entry points, and packaging small. Firefox currently uses background scripts; Chromium Manifest V3 uses a service worker. Background initialization must tolerate restarts and reload persisted preferences instead of depending on long-lived globals. Safari needs its own Safari Web Extension packaging and API assessment; WebKit alone is not an extension target.

Keep native control submission and DOM interaction in the page. When adding a browser target, verify official documentation for its supported API versions, permissions, content-script behavior, authenticated fetches, and background lifecycle. Test Watch Later submission and confirmation in that browser; do not infer support from a successful build or another browser's package.

Derive implementations from Watchbox requirements, official browser API documentation, and independently observed YouTube DOM fixtures. Do not use proprietary extension source as an implementation template. Keep any comparison packages outside the repository; independently verify browser support through Watchbox's own tests and runtime checks.

## Applying the architecture

For design or review requests, inspect the relevant flow and explain ownership, contracts, failure semantics, and the smallest useful change in chat. Create architecture documents only when requested.

For implementation, follow the project's required [test-driven-development skill](../test-driven-development/SKILL.md): write a failing behavioral or boundary test, verify the expected failure, implement the smallest change, then refactor with tests passing. For an extraction, exercise preserved behavior through the proposed public boundary and observe failure before creating that boundary. Tests should verify outcomes rather than filenames or source layout. Exceptions require explicit user permission under the project's instructions.

Preserve relevant regressions for delayed metadata/action writes, late account confirmations, retries, recycled cards, Undo, routing initialization, and pagination. Run the full suite (`npm test`) after implementation, then the repository's lint and build checks (`npm run lint`, `npm run build`). Live verification is appropriate when page integration or a browser target changes; distinguish tested behavior from static inspection and unverified browser support.
