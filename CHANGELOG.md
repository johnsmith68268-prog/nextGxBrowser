# Changelog

All notable changes on the `muse/browser-upgrade` branch (building on baseline v2.5.0, commit `e91cbf2`).

---

## Bug-check — Final Phase (fixes and verification)

### Changed
- **BUG-1 — Themed Error Page for Failed Navigations (`src/ui/error.html`, `src/main.js`, `src/tab-preload.js`, `fbe6f1f`)**: Replaced blank failed-navigation pages (which previously kept the previous tab title) with a themed error page (`src/ui/error.html`) showing the failed URL, a human-readable reason mapped from the Chromium net error, tips, and working Retry / Go Back / Start Page actions. Sets the tab title to `<host> — Failed to load`, keeps the failed URL in the address bar, excludes error pages from history and recently-closed tabs, makes reload retry the failed URL, and ignores aborts (`ERR_ABORTED`, e.g. downloads), subframe failures, and internal pages.
- **BUG-2 — Tab Drag-and-Drop Reordering (`src/main.js`, `src/preload.js`, `src/ui/renderer.js`, `src/ui/styles.css`, `a2fca6b`)**: Added missing tab reordering via HTML5 drag-and-drop with neon drop indicators, persisted in the main process through a `tabs:reorder` IPC while keeping pinned tabs grouped at the front.
- **BUG-3 — Tab Context Menu & Duplicate Tab (`src/main.js`, `src/preload.js`, `src/ui/popover.html`, `src/ui/renderer.js`, `src/ui/styles.css`, `a2fca6b`)**: Added a themed right-click tab context menu with Duplicate Tab (opens next to the original), Reload, Pin/Unpin Tab, Hibernate Tab, Close Tab, and Close Other Tabs.
- **BUG-4 — `Ctrl+Shift+T` Reopen Closed Tab (`src/main.js`, `e9ea026`)**: Added a `Ctrl+Shift+T` handler in `attachKeyboardShortcuts` reusing the closed-tabs store so closed tabs can be reopened via keyboard shortcut.
- **BUG-5 — WebUI Live Refresh (`src/main.js`, `src/tab-preload.js`, `src/ui/chrome-webui.js`, `662dde0`)**: Fixed stale WebUI views (History Recently Closed, Settings cookies) by adding history, cookies, downloads, and adblock update broadcasts plus `webui:shown` and focus/visibility refresh hooks.
- **BUG-6 — Popover Escape Focus Restore (`src/main.js`, `e9ea026`)**: Attached keyboard shortcuts to the popover view and restored focus in `closePopover` so closing a popover with `Escape` no longer leaves keyboard focus trapped in the hidden view or breaks shortcuts.
- **BUG-7 — Download Pause Guard (`src/main.js`, `e9ea026`)**: Fixed Download Pause doing nothing by simplifying the pause guard to require only `!isPaused()` (removing the `canResume()` requirement, which is `false` for an actively-progressing item).
- **BUG-8 — Bookmarks Bar, Manager Edit/Add, and Folders (`src/storage.js`, `src/main.js`, `src/preload.js`, `src/tab-preload.js`, `src/ui/index.html`, `src/ui/renderer.js`, `src/ui/styles.css`, `src/ui/popover.html`, `src/ui/chrome-webui.html`, `src/ui/chrome-webui.js`, `aa95fb0`)**: Added a slim themed bookmarks bar under the toolbar (click navigates, middle-click opens a background tab, live updates, toggleable in Settings and Control Center, default ON), manager Edit (name, URL, folder) and `+ Add Bookmark`, and backwards-compatible folder support via an optional `folder` field in `bookmarks.json` with manager grouping, Rename Folder, and a bar folder dropdown popover.
- **BUG-9 — Session Restore & Homepage Setting (`src/storage.js`, `src/main.js`, `src/ui/renderer.js`, `src/ui/chrome-webui.html`, `src/ui/chrome-webui.js`, `6433d38`)**: Persisted tabs to `session.json` (debounced and on quit) and restored them on launch with pinned state and active tab (private windows/tabs are never persisted), controlled by a Settings toggle (`Restore previous session on startup`, default ON); added a homepage setting with URL input, validation, and Reset wired to the Home button.
- **BUG-11 — Site Popover Height (`src/main.js`, `src/preload.js`, `src/ui/popover.html`, `src/ui/renderer.js`, `662dde0`)**: Increased the site popover height from `275` to `410` with resize-to-content up to `540px` so `COOKIES & SITE DATA` is no longer cut off below the fold.
- **BUG-12 — Tab-Strip Overflow Handling (`src/ui/index.html`, `src/ui/renderer.js`, `src/ui/styles.css`, `a2fca6b`)**: Fixed tab-strip overflow (where 11 tabs pushed the active tab off-screen and unreachable) by shrinking tabs to fit (`min-width: 68px`), scrolling the active tab into view after every render/switch, and displaying scroll buttons on overflow.
- **BUG-13 — Focus Restore After `Ctrl+W` (`src/main.js`, `662dde0`)**: Updated `closeTab` to restore keyboard focus to the new active tab's view so an immediate `Ctrl+Shift+T` works right after closing a tab with `Ctrl+W`.

### Tested
- Verified all fixes (`BUG-1`–`BUG-9`, `BUG-11`–`BUG-13`; commits on branch `muse/browser-upgrade`) live in the running app during the bug-check phase.
- `BUG-1` live verification: `ERR_UNSAFE_PORT` and `ERR_CONNECTION_REFUSED` pages render themed; Retry recovers fully after the server returns; download navigation shows no error page.
- `BUG-10` was investigated and retracted: per-site cookie Clear works; the first failure was a test-harness artifact.

### Known limitations
- **ChatGPT and Claude sidebar services**: Blocked by those sites' own bot protection (ChatGPT returns a server-side `403` with `ERR_INCOMPLETE_CHUNKED_ENCODING`; Claude shows a Cloudflare challenge page) — tab mechanics and history still work; this is server-side, not an app bug.
- **Manual-only tab hibernation**: Sleeping/hibernation of background tabs is manual only (per-tab Hibernate button and `Sleep background tabs` in the Memory panel); there is no automatic idle timer.
- **Small cosmetic gaps**: The find bar has no match-count display; zoom has no reset button and no `Ctrl+0`/`Ctrl+=`/`Ctrl+-` shortcuts; the menu labels say `Bookmarks Manager Ctrl+D` (`Ctrl+D` toggles the bookmark) and `New Private Tab` (it opens a window); the private window's OS title shows `nextGx Browser`.
- **Minor drag-and-drop edge cases**: A ~5px strip immediately left of a tab's close button does not accept drops, and dropping a tab onto the `+` new-tab button does nothing.
- **Sandboxed VM egress proxy**: External sites in the sandboxed VM require the egress proxy to be passed as launch flags; this is a test-environment constraint, not a product behaviour.

---

## Step 5 — Unpacked Extension Loading Fix & Managed Extensions

### Root Cause
- The previous loader in `src/main.js` called `session.extensions.loadExtension()` inside a `try/catch` that only logged to the console and returned the unchanged extension list, so any failure (wrong folder, missing or invalid manifest) surfaced as a silent no-op / unexplained error with no message to the user.
- There was no path or `manifest.json` validation before calling Electron's API, no persistence across restarts (loaded extensions vanished on restart), and no enable/disable, reload, or remove management.
- Live testing confirmed Electron 45's underlying `session.extensions.loadExtension()` API works for the repo's `gx-extension` (MV3 service worker starts and DNR rules index) — the failures were in the app's loader, not in Chromium/Electron.

### Changed
- **Managed Extension Lifecycle (`src/main.js`)**: Implemented a managed-extension system — `listManagedExtensions`, `loadUnpackedExtensionFromPath` (with path/manifest validation and `ExtensionLoadWarning` capture), `setExtensionEnabled`, `reloadManagedExtension`, `removeManagedExtension`, and `restorePersistedExtensions` on startup.
- **Persisted Extension Registry (`src/storage.js`)**: Added `extensions.json` persistence with upsert, update, and remove helpers so loaded extensions and their enabled state survive restarts.
- **Preload Bridges (`src/tab-preload.js`)**: Exposed `toggleExtension` and `reloadExtension` on `gxChromePagesAPI`.
- **Extensions Manager UI (`src/ui/chrome-webui.html`, `src/ui/chrome-webui.js`)**: Upgraded `nextgx://extensions` with extension cards displaying `Active`/`Disabled` and manifest-version badges, surfaced Chromium warnings, last-error notes, enable/disable toggles, reload and remove buttons, status banners, and a Developer Mode toggle (which gates `+ Load Unpacked`).
- **Ad Blocker Exemption (`src/adblocker.js`)**: Excluded `chrome-extension://` URLs from ad blocking.
- **Stale Generated Metadata Cleanup (`.gitignore`)**: Removed stale Chromium-generated `gx-extension/_metadata/generated_indexed_rulesets/_ruleset1` (Chromium manages indexed DNR rulesets itself — the stale file is removed on load — so it must not be committed) and ignored `gx-extension/_metadata/`.

### Tested
- `gx-extension` (MV3 with service worker, DNR rules, side panel, and new-tab override) loads via startup restore and via the `+ Load Unpacked` folder-picker dialog, showing in `nextgx://extensions` as `Active` / `MV3` / `Unpacked` with ID, source path, and two non-fatal Chromium warnings (`Permission 'sidePanel' is unknown.`, `Permission 'browsingData' is unknown.`).
- Enable/disable toggle, reload, and remove all work from the UI.
- Loading is idempotent (re-loading an already-loaded folder does not create duplicate entries).
- Loaded extensions persist across app restarts with the same extension ID and a running service worker.
- Choosing a folder without `manifest.json` displays a clear error banner naming the missing manifest, with no crash and other extensions untouched.
- A persisted registry entry pointing at a missing or manifest-less folder on startup is handled gracefully (the app starts normally and the card shows `Disabled` with the specific error).
- Unknown extension IDs return clean error responses with no unhandled rejections.

---

## Step 4 — Unified Color System & Gaming (GX-Style) Look

### Changed
- **Single Design-Token Source (`src/ui/theme.css`)**: Consolidated all 4 theme palettes (`gx-violet`, `crimson`, `cyan`, `emerald`), Private/Incognito overrides (`html[data-incognito="true"]`), semantic status tokens (`--danger`, `--success`, `--warning`), glow scale (`--nx-glow-sm/md/lg`), chamfer clip-paths (`--nx-chamfer*`), radius scale, display typography (`.nx-heading`, `--nx-font-display`), neutral glass/shadow/overlay tokens, contrast-safe `--nx-on-accent`, theme swatch tokens (`--nx-swatch-*`), and sub-page token aliases.
- **Linked `theme.css` Across Every UI Page**: Linked `src/ui/theme.css` before inline styles in `src/ui/index.html`, `src/ui/chrome-webui.html`, `src/ui/popover.html`, `src/ui/newtab.html`, and `src/ui/screenshot.html`, removing each sub-page's duplicate hardcoded violet `:root` block.
- **Live Theme & Incognito Synchronization**:
  - Main process (`src/main.js`) passes initial `theme` and `incognito=1` query params to all internal UI pages and broadcasts `settings:update` to open windows, popovers, screenshot overlays, and internal tabs (`newtab.html`, `chrome-webui.html`).
  - Exposed `onSettingsUpdate` in `src/preload.js` and `src/tab-preload.js` (plus `getSettings` on `gxNewTabAPI`).
  - Every UI page reads persisted settings on load and updates `data-theme` live when switching themes from either Control Center or `nextgx://settings`.
- **Replaced Remaining Hardcoded UI Colors**: Converted hardcoded hex/rgba palette colors across `src/ui/styles.css`, `src/ui/index.html`, `src/ui/renderer.js`, `src/ui/chrome-webui.html`, `src/ui/chrome-webui.js`, `src/ui/popover.html`, `src/ui/newtab.html`, and `src/ui/screenshot.html` to `var()` references.
- **Consistent GX Gaming Presentation**: Applied chamfer clip-paths, neon glow hover/active/focus states, subtle grid/radial depth backgrounds on internal pages, active theme chip highlights, and `.nx-heading` display typography across tabs, toolbar, sidebar, drawers, History, Downloads, Bookmarks, Passwords, Extensions, Settings, Speed Dial, popovers, and the area-screenshot overlay.

---

## Step 3 (`0110ac1`) — Per-Site Ad-Block Controls, Split Ad/Tracker Blocking & Live Cosmetic Filters

### Added
- **Per-Site Allowlist (`adblock_sites.json`)**: Pause or re-enable blocking per origin from the address-bar Shield popover or `nextgx://settings` ("Paused Sites (Allowlist)"), persisted across restarts.
- **Split Ad & Tracker Lists**: Separated blocking rules in `src/adblocker.js` into `AD_DOMAINS` (53 domains) and `TRACKER_DOMAINS` (30 domains) with an independent "Block Analytics & Trackers" toggle (`trackerBlockEnabled`) governed by the global ad-blocker master switch.
- **Per-Origin Blocked Counts & Shield Popover**: Added `getStats().perSite` counts displayed in the new Shield popover (`src/ui/popover.html`) alongside session counts, per-site & global toggles, a reload-site button, and a paused visual state on the address-bar shield button.
- **Live Cosmetic Filter Sync**: Dynamically injects or removes cosmetic filter CSS (`removeInsertedCSS`) across open tabs when toggling global or per-site blocking without requiring a page reload.

### Fixed
- Fixed Electron 45 `webRequest` initiator lookup to read `details.initiatorOrigin` instead of `details.initiator`.
- Fixed `'DOM-ready'` -> `'dom-ready'` WebContents event listener casing in `src/main.js`.
- Fixed stray-space analytics URL regex in `src/adblocker.js`.

---

## Step 2 (`41d1fe3`) — History & Cookies Polish

### Added
- **History Deduplication & Visit Counts**: Deduplicated repeated visits by URL in `src/storage.js` with `visitCount` tracking (separating real navigations from title/favicon updates via `isVisit: false`) and visit-count badges in `nextgx://history`.
- **Recently Closed Tabs**: Persisted up to 25 recently closed non-internal tabs in `closed_tabs.json` with one-click reopen and Clear All in `nextgx://history`.
- **Full Cookie Manager (`defaultSession`)**: Added `cookies:get`, `cookies:remove`, `cookies:clear-site`, and `cookies:clear-all` IPC handlers (with cookie store flushing) plus domain-grouped cookie filtering, per-site clear, and confirmed Clear All in `nextgx://settings`.
- **Per-Site Cookie Controls in Popover**: Added per-site cookie count and one-click "Clear cookies for this site" in the Site Security & Permissions popover (`src/ui/popover.html`).

### Fixed
- **History Range-Clear Bug**: Fixed `src/tab-preload.js` dropping the `range` argument in `clearHistory`, which previously caused 1h/24h/7d range clears to clear all history.

---

## Step 1 (`2c8bd83`) — Sidebar Services Open New Tabs

### Changed
- Removed the floating left overlay dock panel (`src/ui/left-dock-header.html`, `src/ui/left-dock-resizer.html`, and dock overlay views/IPC in `src/main.js`, `src/preload.js`, `src/ui/renderer.js`, `src/ui/styles.css`).
- Wired all sidebar service buttons to always open in a new active browser tab.
- Added 14 sidebar service shortcuts with custom SVG logos: 5 visible by default (YouTube, YouTube Music, Spotify, Twitch, ChatGPT) and 9 toggleable via Customize Dock (Apple Music, SoundCloud, Deezer, Tidal, Claude, Gemini, Perplexity, WhatsApp, Discord).

---

## Step 0 (`a6dab60`) — Security Hardening

### Changed / Fixed
- **Privileged Bridge Gating**: Restricted `gxNewTabAPI` and `gxChromePagesAPI` exposure in `src/tab-preload.js` to verified top-frame internal `file://` UI pages via synchronous `internal:get-page-kind` validation, and gated internal IPC handlers in `src/main.js` with `handleInternal` (`isInternalUiSender`).
- **Exact-Host Autofill Matching**: Implemented strict host/subdomain matching (`normalizeHost`, `isAutofillHostMatch`) rejecting IP cross-matches and TLD-less sites, deriving origin from `event.senderFrame.url` in `src/main.js`.
- **Encrypted Password Storage**: Encrypted saved passwords at rest with Electron `safeStorage` (`encryptedPassword` base64 field in `passwords.json`) and added automatic migration of existing plaintext records in `src/storage.js`.
- **XSS Escaping**: Added `escapeHtml` escaping for dynamic Speed Dial titles in `src/ui/newtab.html` and download metadata in `src/ui/popover.html`.
- **Download Path Restriction**: Restricted `downloads:open` and `downloads:show-folder` to validated realpaths inside the user's Downloads directory (`resolveSafeDownloadPath`).
- **Root-Only `--no-sandbox`**: Added `scripts/launch.js` and updated `package.json` `start`/`dev` scripts and `src/main.js` so `--no-sandbox` is only passed when running as root (`euid === 0`).

---

## Known Limitations

- **Electron Chrome Extension API Subset**: Electron supports only a subset of Chrome extension APIs — unsupported manifest permissions (such as `sidePanel` and `browsingData`) produce non-fatal Chromium warnings (surfaced in `nextgx://extensions`), theme extensions load but do not restyle nextGx's custom UI, and extensions load into the default session only (not Private windows).
- **OS Keyring Fallback for Passwords**: On systems where Electron `safeStorage.isEncryptionAvailable()` returns `false` (for example headless Linux without a secret-service keyring), stored passwords fall back to plaintext with a console warning.
- **Private Window Cookies**: Private windows run in ephemeral in-memory partitions whose cookies vanish on window close; the Settings Cookie Manager inspects and clears persistent `defaultSession` cookies only.
- **Intentional Fixed Brand / Tile Colors**: Third-party sidebar service logos (`SERVICE_LOGOS` in `src/ui/renderer.js`) and Speed Dial site tile gradients (`GRADIENTS` in `src/ui/newtab.html`) retain fixed site/brand colors rather than adapting to the UI accent theme.
