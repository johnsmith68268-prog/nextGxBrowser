# Changelog

All notable changes on the `muse/browser-upgrade` branch (building on baseline v2.5.0, commit `e91cbf2`).

---

## v3.0.0 (2026-11-22)

Phase 2 complete — Opera GX-like enterprise redesign (profiles with isolated data, privacy dashboard + password manager polish, split view, GX Control limiters, workspaces + tab islands, video pop-out + Player, GX Corner live gaming news, sidebar overlay panel, extension popups, fullscreen fixes). Version bumped from `2.5.0` to `3.0.0`.

### Fixed in final verification (P2-9)
- **T-6 (MAJOR) — Non-active profile storage writes clobbering bookmarks/history**: Routed writes from a non-active profile window previously re-resolved reads to the active profile, risking data clobbering; fixed by reading through the routed profile instance.
- **T-7 — Empty site validation on password add**: Password entries with an empty site were previously accepted on creation; now validated consistently with updates.
- **T-8 — Per-workspace split view persistence**: Starting a split in another workspace silently lost the first workspace's split pairing; splits are now tracked per workspace and survive restart.
- **T-9 (MAJOR) — Fullscreen from non-focused split pane**: Entering fullscreen from the non-focused split pane left the video stuck at pane size with `Esc` unable to exit; fixed by exempting visible split panes from the background-tab guard and focusing the pane first.

### Verified in P2-9
- **Scripted test suite**: Full suite green — Phase III (`p2-6` 33/33, `p2-7` 28/28, `p2-8` 35/35 + 4/4 restored) plus Phase II and Phase I regression suites green.
- **Manual visual verification**: Click-through of every page across all 8 themes, real YouTube PiP + fullscreen, and real YouTube Music playback in the sidebar panel with Player artwork.

### Known limitations
- **Third-party bot protection**: Some sites (ChatGPT, Claude, occasionally YouTube) may display server-side bot-protection walls on some networks — this is not an app issue.
- **Extension popup sizing**: Extension popups size-settle ~50 ms after first paint (measure-after-load design).
- **Per-profile settings scope**: Per-profile settings cover theme and sidebar layout only; other preferences remain global.
- **Ad-block aggregate counters**: Aggregate ad-block counts are tracked browser-wide rather than per profile.
- **Extension session scope**: Unpacked extensions load into the default session only, not Private windows.
- **GX Control limiter semantics**: The network limiter applies per-tab, and the CPU limiter never throttles the active tab by design.

---

## Phase 2 — P2-8: Split view (2026-11-22)

Adds **Split View** (two tabs displayed side by side in one window) with a resizable themed DOM divider in the layout gap, independent per-pane focus & omnibox navigation, tab-strip & toolbar entry points, workspace-aware suspension/restoration, hibernation protection for visible panes, and non-destructive session restore.

### Changed
- **Split View Engine & Layout (new `src/main/splitview.js`, `src/main/layout.js`, `src/main/tabs.js`, `src/main/broadcast.js`, `src/main/ipc.js`)**:
  - Added per-window split state `ctx.split = null | { leftTabId, rightTabId, ratio, focusedPane }` (initialized on window context in `src/main/windows.js`, default `ratio: 0.5`, clamped `0.2–0.8`, divider gap `6px`).
  - Implemented `src/main/splitview.js` with split lifecycle operations (`startSplit`, `exitSplit`, `toggleSplit`, `setSplitRatio`, `focusSplitPane`, `restoreSplitState`), bounds computation (`computeSplitPaneBounds`), and workspace visibility checks reading `isTabVisibleInWorkspace` from `src/main/workspaces.js` (read-only).
  - Updated `updateActiveViewBounds` in `src/main/layout.js`: preserves fullscreen precedence (`ctx.fullscreen.active`) untouched; when a split is active, both split tabs exist/are awake, both are visible in the active workspace, and `activeTabId` is one of the split tabs, positions the two `WebContentsView`s side by side inside the content area (respecting top chrome, bookmarks bar, find bar, pinned sidebar panel, and right/bottom offsets) with a `6px` divider gap while parking all other tabs at `(-5000, -5000)`. Falls back cleanly to single-tab layout when inactive or suspended.
  - Wired focus & tab lifecycle hooks in `src/main/tabs.js`:
    - `wc.on('focus')` updates `ctx.split.focusedPane` and `ctx.activeTabId` (before closing any open popover so focus is never pulled back to the prior pane) and broadcasts state so the omnibox, back/forward/reload/home, shield, bookmarks, and zoom act on the focused pane.
    - Clicking a split tab in the tab strip (`switchTab`) focuses that pane (including native `webContents.focus()` for keyboard input) without unsplitting.
    - Sleeping split candidates are woken via `wakeTab` before splitting or resuming; visible split panes are protected from hibernation in `sleepTab` and `sleepBackgroundTabs`.
    - Closing a split tab (`closeTab` / `closeOtherTabs`) automatically clears `ctx.split` (never leaving a dangling reference) and promotes the surviving split partner to a normal active tab.
    - Unsplitting restores both tabs as normal tabs with no tab closed and no navigation lost, keeping the focused pane active.
  - Broadcasts `split: { leftTabId, rightTabId, ratio, focusedPane, visible } | null` in `serializeTabs` (`src/main/broadcast.js`).
  - Added Step-0 gated IPC channels in `src/main/ipc.js` (`split:toggle`, `split:start`, `split:exit`, `split:set-ratio`, `split:focus-pane`) and reconciled split layout bounds after `workspaces:move-tab` and `workspaces:delete` (without touching `src/main/workspaces.js`).
- **Session Restore (`src/main/session.js`, `src/storage.js`, `src/main/windows.js`)**:
  - Persists optional `split: { leftIndex, rightIndex, ratio, focusedPane }` metadata alongside normal tab entries in `serializeWindowForSession` (`src/main/session.js`) and schedules saves on split state changes.
  - Updated `_sanitizeSession` in `src/storage.js` to validate and remap `split` indices through `oldToNewIndex`, dropping invalid/out-of-range split metadata without ever dropping any tab.
  - Restores `split` in `src/main/windows.js` after tabs are recreated only when both indices resolve to distinct restored tabs; otherwise restores all tabs normally unsplit. Legacy sessions without `split` restore unchanged.
- **Preload Bridge & Chrome UI (`src/preload.js`, `src/ui/index.html`, `src/ui/styles.css`, `src/ui/renderer.js`, `src/ui/popover.html`)**:
  - Exposed minimal `window.gxAPI` split helpers (`toggleSplit`, `startSplit`, `exitSplit`, `setSplitRatio`, `focusSplitPane`) in `src/preload.js`.
  - Added `#btnSplitView` toolbar toggle button next to `#btnPopOutVideo` (`src/ui/index.html`) with active/pressed styling while split.
  - Added the Tab Context Menu split item (`#btnTabCtxSplit` in `src/ui/popover.html`): shows `"Split with this tab"` / `"Open in split view"` when not in split, replaces the non-focused pane when invoked on a non-split tab during an active split, and switches to `"Exit split view"` for tabs already in a split (also disables `"Hibernate Tab"` for visible split panes).
  - Rendered the draggable DOM divider `#splitDivider` inside `#viewportPlaceholder` in the `6px` gap between panes, with focused-pane accent edge (`data-focused-pane="left"|"right"`), hover/drag accent glow, pointer/mouse drag resize (live `setSplitRatio(..., { persist: false })` + commit on release), double-click 50/50 reset, and keyboard arrow nudging.
  - Marked split tabs in the tab strip with a themed split glyph badge and top accent edge (`.in-split`, `.split-left`, `.split-right`, `.tab-split-badge`) and collapsed group pills containing a split tab (`.has-split`), and tightened omnibox URL sync (`!document.hasFocus() || activeChanged`) so switching focus between panes always reflects the focused pane's URL.
  - All new UI styling uses `theme.css` `var()` tokens exclusively (zero hardcoded palette hex/`rgb()`/`rgba()` literals); zero edits to protected core modules (`fullscreen.js`, `gxcontrol.js`, `workspaces.js`, `player.js`, `gxcorner.js`, `extension-popup.js`, `popovers.js`, `sidebar.js`, `profiles.js`, `import-export.js`, `privacy.js`).

### Tested
- **Syntax checks (`node --check`)**: Passed on all 10 created/modified JS files (`src/main/splitview.js`, `src/main/layout.js`, `src/main/broadcast.js`, `src/main/session.js`, `src/main/tabs.js`, `src/main/windows.js`, `src/main/ipc.js`, `src/storage.js`, `src/preload.js`, `src/ui/renderer.js`) plus inline `<script>` validation on `src/ui/popover.html`.
- **Token hygiene**: Verified zero hardcoded hex, `rgb()`, or `rgba()` literals across all 412 added UI lines in `src/ui/*`.
- **Plain-Node unit tests** (isolated temp `userData` + mocked Electron, 18 test groups): Verified ratio clamping and divider/pane geometry, pinned sidebar + right drawer offset math, waking sleeping split candidates, hibernation protection for visible split panes, `wc.on('focus')` pane focus tracking, tab-strip switching without unsplitting, replacing the non-focused pane on a 3rd tab, workspace switch suspension & return restoration, `moveTabToWorkspace` / `deleteWorkspace` split reconciliation, fullscreen precedence & restoration, `serializeTabs` split payload, session serialization + `StorageManager` index remapping + invalid-index safety (never drops tabs) + legacy session compatibility, unsplit preservation, toolbar toggle, closing focused/non-focused split tabs & `closeOtherTabs`, `restoreSplitState`, and IPC channel registration. Live/visual browser verification deferred to P2-9 per workflow.

### Known limitations
- **One split pair per window (side-by-side horizontal only)**: Each window supports a single two-pane left/right split (`ctx.split`); nested splits, 3+ panes, and vertical top/bottom splits are out of scope.
- **Suspension on non-split tab or workspace switch**: Switching to another workspace where one or both split tabs are hidden (or switching to a third non-split tab in the same workspace) suspends the split layout to show the active tab at full width while retaining `ctx.split`; returning to the workspace or clicking either split tab restores the split automatically.
- **Unfocused pane background classification in GX Control**: Because `gxcontrol.js` is untouched, GX Control's per-tab CPU limiter still identifies the active tab by `ctx.activeTabId` (the focused split pane); the non-focused visible pane is still protected from RAM/auto-sleep hibernation via `sleepTab` in `src/main/tabs.js`.
- **DOM divider drag across native child views**: Dragging `#splitDivider` uses DOM `setPointerCapture` plus `window` pointer/mouse listeners (matching the existing sidebar resizer pattern); real cursor behavior over live side-by-side `WebContentsView`s will be verified interactively in P2-9.

---

## Phase 2 — P2-7: Privacy dashboard + password manager polish (2026-11-22)

Adds the **Privacy & Security Dashboard** (`nextgx://privacy`) displaying real ad/tracker blocking telemetry, per-site allowlist controls, per-profile site permissions overview with reset, an honest security posture checklist (no fake scores), and Clear Browsing Data shortcuts — plus **Password Manager polish** on `nextgx://passwords` with a main-process CSPRNG password generator (`crypto.randomBytes`), masked-by-default Show/Hide, main-process clipboard copy, and inline password editing while preserving P2-6 CSV import/export.

### Changed
- **Privacy & Security Dashboard Engine + Main-Process Password Helpers (new `src/main/privacy.js`, `src/storage.js`, `src/main/navigation.js`, `src/main/session.js`, `src/main/broadcast.js`, `src/main/ipc.js`)**:
  - Registered `nextgx://privacy` (plus `gx://privacy`, `chrome://privacy`, and `privacy-dashboard` alias) in the `chrome-webui` system (`chrome-webui.html#privacy`) across `src/main/navigation.js`, `src/main/session.js` (`RESTORABLE_INTERNAL_PAGES`), and `src/storage.js` (`_normalizeSessionUrl`), inheriting theme broadcast, session restore, and webui preload gating.
  - Added gated `privacy:get-dashboard` and `privacy:clear-site-permission` IPC handlers scoped to the sender window's profile via `getSenderProfileId`:
    - **Blocked ads/trackers**: reads directly from `state.adBlocker.getStats()` (`totalBlocked`, `sessionBlocked`, `recentBlocked`, `perSite`, `enabled`, `trackerBlockEnabled`) and merges per-profile allowlist state from `state.storage.getAdblockSites(pid)`.
    - **Permissions overview**: added `getAllSitePermissions(profileId)` and `clearSitePermissions(origin, profileId, permKey)` in `src/storage.js` backed by per-profile `site_permissions.json`, exposing only the 4 permission types actually tracked and enforced by the browser (`camera`, `microphone`, `geolocation`, `notifications`) and pruning entries that return to all-`ask` defaults. Added `broadcastPermissionsUpdate` so lock-icon popover changes sync live to open dashboard tabs.
    - **Security posture checklist**: reports honest on/off/available state for real settings and platform capabilities (`adblockEnabled`, `trackerBlockEnabled`, `safeStorage.isEncryptionAvailable()`, Private windows availability, `restoreSession`, and `autoSleepEnabled` / `autoSleepMinutes`) — zero synthetic scores or grades.
  - Added main-process password utilities and gated IPC handlers (`passwords:generate`, `passwords:update`, `passwords:copy`):
    - **`passwords:generate`**: uses Node `crypto.randomBytes` with unbiased rejection sampling and Fisher-Yates shuffle (length clamped to 8–64, default 16; rejects empty charset selection; guarantees at least one character from every selected charset: lowercase, uppercase, digits, symbols).
    - **`passwords:update`**: added `updatePassword(id, partial, profileId)` in `src/storage.js` reusing existing `safeStorage` encryption helpers (`_encodePasswordRecord`), preserving entry `id` and rejecting cross-entry `(site, username)` duplicates.
    - **`passwords:copy`**: added `getPasswordById(id, profileId)` in `src/storage.js` and main-process `electron.clipboard.writeText` copy by entry ID (hardening choice so plaintext password values are never placed in DOM `data-*` attributes; note that `passwords:get` still sends decrypted entries to the internal `webui` renderer for Show/Edit).
    - Added `broadcastPasswordsUpdate` notifications on `passwords:add`, `passwords:update`, `passwords:remove`, and `autofill:save`.
- **Preload Bridges & UI Surfaces (`src/preload.js`, `src/tab-preload.js`, `src/ui/popover.html`, `src/ui/chrome-webui.html`, `src/ui/chrome-webui.js`)**:
  - Exposed minimal gated bridges on `window.gxChromePagesAPI` (`src/tab-preload.js`, strictly gated to `internalPageKind === 'webui'`) and matching chrome helpers on `window.gxAPI` (`src/preload.js`).
  - Added **Privacy & Security** entry points in the 3-dot menu (`src/ui/popover.html`, `menu:action` `'privacy'`), the `chrome-webui` left sidebar (`src/ui/chrome-webui.html`), and the **Privacy Shield & Security** card in `nextgx://settings` (`Open Dashboard`).
  - Built the **Privacy & Security Dashboard** UI (`renderPrivacyPage` in `src/ui/chrome-webui.js`) with an active window profile header banner, live KPI cards, per-site blocked breakdown with allowlist Pause/Re-enable buttons, real site permissions list with per-permission dropdowns and per-site Reset button, honest Security Posture Checklist with direct toggles/links, Clear Browsing Data shortcut linking directly into Settings' existing `#settingsClearDataRow` / `#cookiesSettingsCard`, and Recent Blocked Requests log.
  - Polished **Passwords & Autofill** (`renderPasswordsPage` in `src/ui/chrome-webui.js`) with an interactive Password Generator card (synced length slider + numeric input, 4 charset toggles, Generate, and "Use this password" filling the open Edit form or Add form), masked-by-default Show/Hide (no plaintext password in DOM until revealed), main-process Copy button, and inline Edit form — preserving P2-6 CSV import/export buttons and plaintext export warning banner untouched.
  - All new UI styles use `theme.css` `var()` tokens exclusively (zero hardcoded palette hex/`rgb()`/`rgba()` literals); zero edits to protected core modules (`fullscreen.js`, `gxcontrol.js`, `workspaces.js`, `player.js`, `gxcorner.js`, `extension-popup.js`, `popovers.js`, `sidebar.js`, `profiles.js`, `import-export.js`).

### Tested
- **Syntax checks (`node --check`)**: Passed on all 9 new/modified JS files (`src/main/privacy.js`, `src/storage.js`, `src/main/navigation.js`, `src/main/session.js`, `src/main/broadcast.js`, `src/main/ipc.js`, `src/preload.js`, `src/tab-preload.js`, `src/ui/chrome-webui.js`) plus inline `<script>` validation on `src/ui/popover.html`.
- **Token hygiene**: Verified zero hardcoded hex, `rgb()`, or `rgba()` literals in all added lines across `src/ui/*`.
- **Plain-Node unit tests** (isolated temp `userData` + mocked Electron): Verified `nextgx://privacy` routing/display/session-restore, per-profile site permissions listing & per-key/per-site clear/reset, CSPRNG password generator (clamping, empty-charset rejection, 200-iteration multi-charset guarantee, `crypto.randomBytes`-only implementation), `updatePassword` in-place `id` preservation + `safeStorage` re-encryption + duplicate guard, `passwords:copy` main-process clipboard copy & cross-profile isolation, and `privacy:get-dashboard` exact parity with `state.adBlocker.getStats()` and real `safeStorage.isEncryptionAvailable()` state.
- **Smoke test**: Verified app launch without startup errors (`xvfb-run`). Full interactive/visual verification deferred to Phase III end per workflow rules.

### Known limitations
- **Aggregate ad-block counters are browser-wide, not per-profile**: `state.adBlocker` tracks `sessionBlocked`, `perSite`, `recentBlocked`, and root `settings.totalAdsBlocked` globally across the browser process, whereas `adblock_sites.json` (allowlist), `site_permissions.json`, cookies, history, and passwords are isolated per profile. The dashboard header explicitly notes this scope difference.
- **Per-site blocked counts are session-scoped**: `state.adBlocker.perSite` and `recentBlocked` live in memory for the current session (up to 100 origins / 25 recent entries) and reset on browser restart; lifetime `totalBlocked` persists across restarts.
- **Renderer password visibility during Show/Edit**: Although `passwords:copy` hardens clipboard copying via the main process and removes plaintext `data-pw` attributes from DOM buttons, `passwords:get` still delivers decrypted entries to the strictly gated internal `webui` page so inline Show and Edit work seamlessly.
- **OS keyring availability varies by environment**: On Linux environments without a running keyring daemon (`libsecret` / `gnome-keyring` / `kwallet`), `safeStorage.isEncryptionAvailable()` returns `false`; the Security Posture Checklist reports `Unavailable` honestly rather than masking it.

---

## Phase 2 — P2-6: Profiles + import/export (2026-11-22)

Adds local-only browser **Profiles** with isolated storage directories, per-profile Electron session partitions, per-profile appearance/sidebar settings, a toolbar avatar menu, and a Settings management section — plus **Import/Export** for Bookmarks (Netscape HTML), Settings (JSON), and Passwords (CSV with explicit plaintext warning).

### Changed
- **Local Profiles Store & Per-Profile Isolated Storage (`src/storage.js`, new `src/main/profiles.js`)**:
  - Added `profiles.json` under `userData/nextgx-data/` (`{ version: 1, activeId: 'default', profiles: [{ id, name, avatar, color, createdAt }] }`), using emoji-free uppercase initials for `avatar` and `theme.css` palette token names (`gx-violet`, `crimson`, `cyan`, `emerald`, `magenta`, `amber`, `lime`, `ice`) for `color`.
  - **Default profile preserved untouched**: `'default'` continues reading/writing the existing `userData/nextgx-data/*.json` files and `session.defaultSession` with zero data migration, rename, or deletion.
  - **Non-default profile isolation**: Each created profile gets its own storage subdirectory `userData/nextgx-data/profiles/<id>/` (parameterized `StorageManager` holding isolated `bookmarks.json`, `history.json`, `closed_tabs.json`, `downloads.json`, `passwords.json`, `speed_dial.json`, `notes.json`, `site_permissions.json`, `adblock_sites.json`, `session.json`, and per-profile `settings.json`) and its own persistent Electron session partition `persist:profile-<id>` (attached idempotently to `adBlocker`, site permissions, download listeners, corner preload, and cookie-change listeners).
  - **Per-profile vs global settings**:
    - **Per-profile settings**: `theme`, `sidebarItems`, `sidebarPanelWidth`, and `sidebarPanelPinned` are stored per profile (`nextgx-data/profiles/<id>/settings.json` for non-default profiles; root `settings.json` for `default`) and resolved through the profile-aware `getSettings(profileId)` / `updateSettings(partial, profileId)` accessor.
    - **Global settings**: Remaining preferences (`searchEngine`, `restoreSession`, `homepageUrl`, `showBookmarksBar`, `adblockEnabled`, `trackerBlockEnabled`, `forceDarkWeb`, `autoSleepEnabled`, `autoSleepMinutes`, `closeWindowOnLastTab`, `uiSoundsEnabled`, `uiSoundsVolume`, `wallpaper`, `gxRamLimiter*`, `gxCpuLimiter*`, `gxNetLimiter*`, `totalAdsBlocked`, `extensionsDevMode`, `pinnedExtensions`, `browserName`, `ramLimitMB`) remain global in root `nextgx-data/settings.json`.
  - **Profile lifecycle & switching**: Added gated `profiles:list`, `profiles:get-active`, `profiles:create`, `profiles:rename`, `profiles:delete`, and `profiles:switch` IPC handlers (`src/main/ipc.js`, `src/main/profiles.js`). `profiles:switch` updates `activeId`, initializes the profile's session partition, opens a new normal window in that profile's session, and broadcasts `profiles:update` + `settings:update`. `profiles:delete` refuses deleting `'default'`, keeps a `'default'` window alive if deleting the last open window, closes windows belonging to the deleted profile without writing back `session.json`, clears its Electron partition storage & cache (`clearStorageData` / `clearCache`), deletes `nextgx-data/profiles/<id>/`, and falls back `activeId` to `'default'` if active.
- **Window, Session, Cookies, Downloads & Broadcast Profile Wiring (`src/main.js`, `src/main/windows.js`, `src/main/session.js`, `src/main/tabs.js`, `src/main/broadcast.js`, `src/main/cookies.js`, `src/main/downloads.js`, `src/main/utils.js`, `src/main/navigation.js`, `src/main/ipc.js`)**:
  - Bound `ctx.profileId` onto every `BrowserWindow` context, opening startup windows and new normal windows (`Ctrl+N` / menu / `window:new`) in the active profile.
  - Scoped tab history, bookmarks, closed tabs, autofill passwords, downloads, cookies (`cookies:*`), site permissions, cleaner (`cleaner:run`), and session restore (`session.json`) to each window's `profileId` / session partition so open windows across profiles never bleed data into each other.
  - Updated `broadcastSettingsUpdate`, `broadcastBookmarksUpdate`, `broadcastHistoryUpdate`, and `broadcastDownloadsUpdate` to respect per-window profiles and added `broadcastProfilesUpdate` and `broadcastPasswordsUpdate`.
- **Import / Export Engine (new `src/main/import-export.js`, `src/storage.js`, `src/main/ipc.js`)**:
  - **Bookmarks HTML (Netscape format)** (`import-export:bookmarks-export`, `import-export:bookmarks-import`): Exports active profile bookmarks in standard `NETSCAPE-Bookmark-file-1` format preserving folders; imports Netscape HTML preserving folders/titles/URLs, decoding HTML entities safely, rejecting non-`http(s):` schemes (`javascript:`, `data:`, `file:`), and merging while skipping exact-URL duplicates.
  - **Settings JSON** (`import-export:settings-export`, `import-export:settings-import`): Exports active-profile merged settings as JSON; imports JSON with strict key/type validation against `StorageManager` defaults (ignoring unknown keys, prototype-pollution keys, and mismatched types), applies immediately (including adblock, GX Control, theme, and sidebar panel updates), and persists.
  - **Passwords CSV** (`import-export:passwords-export`, `import-export:passwords-import`): Exports active profile's decrypted logins as RFC 4180 CSV (`url,username,password` header, `0o600` permissions on POSIX) after an explicit plaintext warning confirmation in the UI; imports RFC 4180 CSV (tolerant of quoted fields, commas, quotes, embedded newlines, and UTF-8 BOM), skips duplicates matching `(url, username)`, and encrypts via the existing `safeStorage` helpers in `src/storage.js` (reusing the single `passwords.json` store).
- **Preload Bridges & UI Surfaces (`src/preload.js`, `src/tab-preload.js`, `src/ui/index.html`, `src/ui/styles.css`, `src/ui/renderer.js`, `src/ui/popover.html`, `src/ui/chrome-webui.html`, `src/ui/chrome-webui.js`)**:
  - Exposed minimal gated profile methods on `window.gxAPI` (`src/preload.js`) and profile + import/export methods on `window.gxChromePagesAPI` (`src/tab-preload.js`, strictly gated to `internalPageKind === 'webui'`).
  - Added `#btnProfileMenu` circular avatar button (initial letter + profile color token) to the right of the toolbar (`src/ui/index.html`, `src/ui/styles.css`, `src/ui/renderer.js`), opening a themed `#view-profiles` popover (`src/ui/popover.html`) with active checkmark, window-vs-active notice, inline Add Profile form with 8 color swatches, inline Rename, inline Confirm-Delete, and link to Settings.
  - Added **Profiles (Local)** management card and **Backup & Restore Settings** (Export/Import JSON) card in `nextgx://settings`, **Import HTML / Export HTML** controls in `nextgx://bookmarks`, and **Import CSV / Export CSV** with a prominent plaintext security warning confirmation banner in `nextgx://passwords`.
  - All new UI styles use `theme.css` `var()` tokens exclusively (zero hardcoded palette hex/`rgb()`/`rgba()` literals); zero edits to protected core modules (`fullscreen.js`, `gxcontrol.js`, `workspaces.js`, `player.js`, `gxcorner.js`, `extension-popup.js`, `popovers.js`, `sidebar.js`).

### Tested
- **Syntax checks (`node --check`)**: Passed on all 17 new/modified JS files (`src/storage.js`, `src/main.js`, `src/preload.js`, `src/tab-preload.js`, `src/main/profiles.js`, `src/main/import-export.js`, `src/main/windows.js`, `src/main/session.js`, `src/main/utils.js`, `src/main/navigation.js`, `src/main/tabs.js`, `src/main/broadcast.js`, `src/main/cookies.js`, `src/main/downloads.js`, `src/main/ipc.js`, `src/ui/renderer.js`, `src/ui/chrome-webui.js`) plus inline `<script>` validation on `src/ui/popover.html`.
- **Token hygiene**: Verified zero hardcoded hex, `rgb()`, or `rgba()` literals in all added lines across `src/ui/*`.
- **Plain-Node unit tests** (isolated temp `userData` + mocked Electron): Verified default profile preservation, `profiles.json` shape & emoji-free avatars, profile CRUD & non-deletable default, active-profile delete fallback + directory/partition cleanup, per-profile isolation of bookmarks/history/passwords/settings (`theme`, `sidebarItems`, `sidebarPanelWidth`, `sidebarPanelPinned`), Bookmarks Netscape HTML round-trip + folder preservation + duplicate skip + unsafe-scheme rejection, Settings JSON round-trip + unknown-key/type rejection, and Passwords CSV RFC 4180 round-trip + duplicate skip + `safeStorage` encryption.
- **Smoke test**: Verified app launch without startup errors (`xvfb-run`). Full interactive/visual verification deferred to Phase III end per workflow rules.

### Known limitations
- **Local-only profiles (no sync/accounts by design)**: Profiles are strictly local to the machine (`nextgx-data/profiles/<id>/` + `persist:profile-<id>`); there is no cloud account or sync backend.
- **Profile switching applies to new windows/tabs going forward**: Switching the active profile sets `activeId` and opens a new normal window in the target profile's session; already-open windows and tabs remain in their original profile session rather than being retroactively migrated.
- **Extensions and Workspaces/Tab Islands remain global**: Unpacked Chrome extensions remain attached to `session.defaultSession` (shared/default-profile Electron behavior), and Workspaces (`workspaces.json`) / Tab Groups (`tabgroups.json`) / GX Corner RSS cache (`gxcorner_cache.json`) remain shared globally to keep `workspaces.js` and `gxcorner.js` untouched.
- **Custom wallpapers on settings import**: Importing a settings JSON referencing a `custom` wallpaper image file that does not exist in the local `userData/wallpapers/` directory gracefully falls back to `preset` mode rather than referencing a missing file.
- **Plaintext CSV password export**: Exported CSV files are unencrypted plaintext by design (standard browser CSV format); the UI requires acknowledging a security warning before saving, and POSIX writes restrict file permissions to `0o600`.

---

## Phase 2 — Phase II fix pass (2026-11-22)

Addresses all actionable findings from the Phase II code review (`phase2-review-findings.md`) and live-test verification pass (`phase2-test-findings.md`).

### Changed
- **T-5 — CPU telemetry double-normalization (`src/main/gxcontrol.js`)**: Removed the redundant `/ cores` division in `aggregateProcessMetrics` for both per-process `cpuPercent` and total `browserCpuPercent` (Electron's `app.getAppMetrics()` `cpu.percentCPUUsage` is already normalized to 0–100% of total logical CPU capacity), preserving the 0–100 clamp and 1-decimal rounding so CPU readouts and the 25–100% CPU limiter engage accurately.
- **R-1 — Paused PiP exit controls & Shadow-DOM PiP toggle (`src/ui/renderer.js`, `src/ui/popover.html`, `src/ui/player.html`, `src/tab-preload.js`, `src/main/player.js`)**: Gated browser PiP controls on `(hasPlayingVideo || pipActive)` across the toolbar button (`#btnPopOutVideo`), tab context menu (`#btnTabCtxPopOutVideo` / `"Exit Pop-out Video"`), and Sidebar Player header (`#btnPlayerPip`, plus `isPlayerEligible`) so a video paused while popped out keeps all exit controls available. Unwrapped `document.pictureInPictureElement` through open shadow roots (`while (el?.shadowRoot?.pictureInPictureElement) el = el.shadowRoot.pictureInPictureElement`) in `getActivePipInfo`, `handlePipCommand`, and `PIP_FALLBACK_MAIN_WORLD_SCRIPT` (and traversed open shadow roots when scanning media elements) so shadow-DOM videos in PiP exit cleanly via `exitPictureInPicture()`.
- **R-2 — Orphaned 0-tab group pruning (`src/main/workspaces.js`, `src/main/windows.js`, `src/ui/renderer.js`, `src/ui/popover.html`)**: Added `pruneAllEmptyGroups(ctx, { broadcast })` in `src/main/workspaces.js` (preserving Private-window in-memory group isolation) and invoked it on `win.on('closed')` (when normal windows remain open) and after startup/session restore completes (`src/main/windows.js`); added defence-in-depth filtering in `src/ui/renderer.js` (`activeWsGroupsList`) and `src/ui/popover.html` (`Add to Group` / `Move to Group`) to exclude 0-tab groups.
- **R-3 — Edge-drop onto a grouped tab reorders instead of joining the group (`src/main/tabs.js`, `src/ui/renderer.js`)**: Updated the edge-drop (`before`/`after`) branch of `reorderTab` to preserve the dragged tab's existing `groupId` (reordering within its own group if grouped, or placing before/after the target group while staying ungrouped) and reserved group-joining strictly for `center` drops and group-pill drops while keeping `forceUngroup` for explicit drag-out; updated the tab-strip container-gap drop in `src/ui/renderer.js` to pass `ungroup: !sourceTab?.groupId` so gap drops never join a target tab's group.
- **R-4 — `onTabViewCreated` CDP hook order (`src/main/tabs.js`)**: Assigned `tab.view = view` inside `buildWebContentsViewForTab` before invoking `gxControl.onTabViewCreated(ctx, tab)` so newly created and woken tabs attach CDP network/CPU limiters before their first navigation starts.
- **R-5 — Protect active PiP tabs from background hibernation (`src/main/gxcontrol.js`, `src/main/stats.js`, `src/main/tabs.js`)**: Skipped tabs where `player.getTabVideoState(tab).pipActive` is true (using a lazy `require('./player')` guard) across all three hibernation paths: GX Control's `selectRamHibernationCandidate`, the `stats.js` auto-sleep timer, and manual `sleepBackgroundTabs`.
- **R-6 / Adjudication #10 — Preserve pinned tabs' origin `workspaceId` on workspace delete (`src/main/workspaces.js`)**: Skipped pinned tabs (`if (!tab.pinned && tab.workspaceId === workspaceId)`) in `deleteWorkspace`'s tab-migration loop so unpinning a tab whose origin workspace was deleted falls back to the window's active workspace as designed in `togglePinTab`.
- **R-7 — Spawn Start Page immediately when closing the last unpinned tab in a workspace (`src/main/tabs.js`)**: Updated `closeTab` and `closeOtherTabs` to check remaining *unpinned* tabs in the active workspace when unpinned tabs are closed and spawn a fresh `nextgx://newtab` tab immediately if none remain (matching `ensureWorkspaceHasActiveTab` even when global pinned tabs are present).
- **R-9 — `player.onWindowClosed` cleanup via `removeSourceByWcId` (`src/main/player.js`, `src/main/sidebar.js`)**: Updated `onWindowClosed` to remove window media sources via `removeSourceByWcId(wcId, { notifyCtx: ctx })` (immediately resolving in-flight commands and clearing stale manual selections) and dropped the duplicate `onWindowClosed` call from `cleanupSidebarPanelViews` in `src/main/sidebar.js`.
- **R-13 — Exclude pinned tabs from `workspaceLastActiveTab` (`src/main/tabs.js`, `src/main/workspaces.js`, `src/main/windows.js`)**: Skipped pinned tabs when recording or restoring `workspaceLastActiveTab` in `switchTab`, `closeTab`, `closeOtherTabs`, `switchWorkspace`, `ensureWorkspaceHasActiveTab`, and session restore.
- **R-14 — Preserve active tab on `deleteWorkspace` (`src/main/workspaces.js`)**: When deleting a window's active workspace, kept the current active tab (now migrated to `'default'`) unless it is not visible in `'default'` or `'default'` has no unpinned tabs.
- **R-16 — Splice moved tab within global `ctx.tabOrder` on reorder (`src/main/tabs.js`, `src/main/workspaces.js`)**: Spliced the moved tab directly at its destination index in global `ctx.tabOrder` coordinates in `reorderTab` (and preserved cross-workspace ordering in `normalizeGroupContiguity`) instead of rebuilding `ctx.tabOrder` from `[...pinnedIds, ...wsIds, ...otherWsIds]`.
- **R-17 — Bounded visibility/frame wait in `triggerPopOutVideo` (`src/main/player.js`)**: Replaced the fixed 60 ms `setTimeout` after switching to a background tab with `waitForTabViewVisible` (polling view bounds and awaiting `document.visibilityState === 'visible'` + `requestAnimationFrame` up to a 900 ms cap).
- **R-19 — Preserve audible state across navigation in `handleMediaReport` (`src/main/player.js`)**: Initialized `entry.audible` with `Boolean(prev?.audible || tab?.audible || senderWc.isCurrentlyAudible?.())`.
- **R-20 — Skip `cdpStates` allocation when all limiters are off (`src/main/gxcontrol.js`)**: Returned early from `syncTabCdpState` before `runCdpOp` when no limiter is active and no `cdpStates` entry exists for the tab, and updated `onActiveTabChanged` to check for entries with `attachedByUs === true`.
- **R-21 — Expire long-idle paused media sources from Player switcher (`src/main/player.js`)**: Updated `pruneStaleSources` to drop non-playing, non-audible, non-PiP sources whose media element is gone or that have remained paused/idle past `PAUSED_SOURCE_IDLE_TTL_MS` (30 minutes) and capped `collectScopedSources` to `MAX_SWITCHER_SOURCES` (12) while keeping active and recently-played sources.
- **Adjudication #1 polish — Per-tab network cap label (`src/ui/renderer.js`)**: Updated the active Network Limiter status line from `Cap: ${limit} Mbps down` to `Cap: ${limit} Mbps/tab down`.
- **R-8 — Cold-start GX Corner loading state (`src/main/gxcorner.js`)**: Set `runtimeStatus.isRefreshing = true` in `getCornerData()` before returning `buildCornerPayload()` whenever a deferred `setImmediate` feed refresh is scheduled, so the initial cold-start payload reaches the dedicated `isRefreshing` branch (`isRefreshing: true`, `statusMessage: 'Loading live gaming feeds — showing curated picks'`) and suppresses the false initial offline banner flash.
- **R-10 — Stream-bounded 2 MB RSS response cap in `fetchTextDefault` (`src/main/gxcorner.js`)**: Added `readResponseBodyBounded(res, MAX_FEED_BYTES)` to stream `res.body` via `getReader()` (or async iteration), slicing at `MAX_FEED_BYTES` (2 MB) and cancelling the stream immediately when the cap is exceeded rather than buffering the entire response in memory via `res.text()` first.
- **R-11 — Shared deadline across redirect hops & `AbortSignal` support in `fetchTextViaNodeHttp` (`src/main/gxcorner.js`)**: Threaded `signal` from `fetchTextDefault` into `fetchTextViaNodeHttp` (destroying active requests/responses immediately when the 15 s overall refresh `AbortController` aborts) and passed a shared `deadlineAt` timestamp across redirect hops so redirects share a single per-feed timeout budget instead of restarting `timeoutMs` on each hop.
- **R-12 — Anchor internal UI URL substring fallbacks to `file:` (`src/main/utils.js`)**: Required `urlStr.startsWith('file:')` on the `/src/ui/*.html` substring fallback checks in `isCornerUrl`, `isPlayerPanelUrl`, `isNewTabUrl`, `isWebUiUrl`, and `isErrorPageUrl` (keeping `resolveInternalUiFile` intact) so external `http(s):` URLs such as `https://example.com/src/ui/corner.html` are never misclassified as internal browser pages.
- **R-15 — Earliest-possible main-world `MediaSession` hook dispatch & residual race documentation (`src/tab-preload.js`)**: Moved `webFrame.executeJavaScript(buildMainWorldMediaSessionHook(...))` to the earliest safe point at the top of `initMediaObserver`, awaited the in-flight hook promise in `pullMediaSessionState` and `invokeMediaSessionAction`, emitted an initial notification if `navigator.mediaSession.metadata` or `playbackState` is already present at hook load, and documented the residual parse-time race limitation (DOM `<script>` injection is CSP-blocked, and Chromium/Blink's `MediaSession` provides no non-destructive getter to enumerate action handlers registered before `executeJavaScript` lands; metadata is still recovered via `readDirectMediaSessionFallback`).
- **R-18 — Handle `saveGxCornerCache` errors without dropping fresh feed items (`src/main/gxcorner.js`)**: Wrapped `state.storage.saveGxCornerCache(cacheRecord)` in `try/catch` inside `refreshFeeds()`, keeping the freshly parsed items via `cacheOverride` in the returned and broadcast payload while logging the error and setting `runtimeStatus.lastRefreshFailed = true` and `runtimeStatus.lastError` so storage write failures surface honestly without rejecting `refreshFeeds()`.
- **Stretch (Test Note #4) — Serializable `window:new` IPC return value (`src/main/ipc.js`, `src/preload.js`)**: Updated the `window:new` IPC handler to return a structured-cloneable `{ ok, windowId, incognito }` object instead of the non-cloneable window context / `BrowserWindow` instance (and forwarded optional `options` from `gxAPI.newWindow(options)`), eliminating the `An object could not be cloned` rejection on `gxAPI.newWindow()`.

---

## Phase 2 — P2-5: GX Corner Gaming Hub (2026-11-21)

Adds the **GX Corner** internal gaming hub (`nextgx://corner`) with three themed sections (Gaming News, New & Upcoming Releases, and Deals & Free Games), dependency-free live RSS/Atom fetching and caching in the main process, graceful non-empty curated offline fallback with honest status notice and retry, a sidebar rail quick-launch entry, a New Tab hub card, and a Settings / Customize Dock visibility toggle.

### Changed
- **GX Corner Engine, Dependency-Free RSS/Atom Parser & Cache (new `src/main/gxcorner.js`, new `src/data/gxcorner-curated.json`, `src/storage.js`)**:
  - Fetches 5 public gaming RSS feeds in the main process only via Electron's `net.fetch` (respecting browser/egress proxy configuration, with a Node `http`/`https` fallback), enforcing a 10s per-feed timeout, 15s overall cap, 2 MB response size cap, and single-flight request coalescing:
    1. **PC Gamer** (`https://www.pcgamer.com/rss/`)
    2. **IGN** (`https://feeds.feedburner.com/ign/all`)
    3. **Eurogamer** (`https://www.eurogamer.net/feed`)
    4. **GamesRadar+** (`https://www.gamesradar.com/rss/`)
    5. **Rock Paper Shotgun** (`https://www.rockpapershotgun.com/feed`)
  - Implemented a dependency-free RSS 2.0 + Atom 1.0 XML parser in `src/main/gxcorner.js` (zero new npm dependencies): extracts titles, URLs, plain-text summaries, publication timestamps, categories, and thumbnails (`media:content`, `media:thumbnail`, `enclosure`, Atom enclosure links, or first content `<img>` while filtering out known tracking pixels), deduplicates across feeds, classifies items across `news`, `releases`, and `deals`, and strictly sanitizes every field (single-pass entity decoding, strips `<script>`/`<style>`/HTML tags, and enforces `http:`/`https:` URL allowlisting on both article links and thumbnails).
  - **New JSON cache store**: added `gxCornerCache` (`gxcorner_cache.json` under `userData/nextgx-data`) in `src/storage.js` with full entry sanitization, 1-hour cache TTL (`CACHE_TTL_MS`), and 30-minute background refresh cadence (`BACKGROUND_REFRESH_MS`). Opening `nextgx://corner` renders cached (or curated) items immediately without blocking on network, triggers a background refresh when empty or stale, and broadcasts fresh results to all open Corner tabs via `corner:update`.
  - **Editable curated fallback (`src/data/gxcorner-curated.json`)**: bundles 5 major PC gaming storefronts (Steam, Epic Games Store, GOG, Humble Bundle, itch.io), curated evergreen news outlet hubs, an editable curated release calendar, and evergreen deals/free-games picks — all explicitly marked `curated: true` (never fabricated as breaking live news). When all feeds are unreachable or empty, the hub displays the curated picks with an honest `"Offline — showing curated picks"` banner and Retry button so the page never renders blank.
- **Strictly Gated Corner Preload & Internal Page Registration (new `src/corner-preload.js`, `src/main/core.js`, `src/main/utils.js`, `src/main/navigation.js`, `src/main/session.js`, `src/main/tabs.js`, `src/main/broadcast.js`, `src/main/ipc.js`, `src/main/windows.js`, `src/main.js`)**:
  - Registered `nextgx://corner` (along with `gx://corner` / `chrome://corner` aliases) in `navigation.js`, `utils.js` (`isCornerUrl` + theme/incognito query params), `session.js` + `storage.js` (session restore support), `tabs.js` (clean `"GX Corner"` title, skipped from browsing history & recently closed tabs), and `broadcast.js` (live theme/settings sync + `sendToCornerTabs`).
  - Added dedicated `src/corner-preload.js` registered per session via Electron 45's `session.registerPreloadScript` (leaving `src/tab-preload.js` untouched), strictly scoped to `file://*corner.html*` and double-gated on top-frame `internal:get-page-kind === 'corner'`, exposing `window.gxCornerAPI` (`getData`, `refresh`, `openLink`, `getSettings`, `onUpdate`, `onSettingsUpdate`). Registered on both `session.defaultSession` (`src/main.js`) and Private window sessions (`src/main/windows.js`).
  - Registered gated IPC handlers `corner:get-data`, `corner:refresh`, and `corner:open-link` (validates `http(s):` URLs and opens article/deal/storefront links in a new normal tab via `createTab`, keeping the Corner tab intact).
- **GX Corner UI Page & Entry Points (new `src/ui/corner.html`, `src/ui/index.html`, `src/ui/renderer.js`, `src/ui/newtab.html`, `src/ui/chrome-webui.js`)**:
  - Built `src/ui/corner.html` using `theme.css` `var()` tokens exclusively (zero hardcoded hex/`rgb()`/`rgba()` literals): sticky GX topbar with section filter tabs (`All` / `News` / `Releases` / `Deals`), live client-side search filter (in-scope polish), feed status indicator, manual Refresh/Retry button, honest offline banner, 3 full card sections with 16:9 thumbnails + clean themed fallbacks, 5 storefront quick-launch cards, and live theme/sound sync.
  - **Sidebar rail entry**: added `#btnSidebarCorner` (`data-sidebar-tab="nextgx://corner"`, `data-sidebar-item="gxCorner"`) to the left rail in `src/ui/index.html` and wired it in `src/ui/renderer.js` to open `nextgx://corner` in a **new tab** (not the overlay panel) with active-tab rail highlighting.
  - **New Tab entry**: added a themed GX Corner hub card (`#btnNewTabCorner`) on `src/ui/newtab.html` navigating to `nextgx://corner` via existing `window.gxNewTabAPI.navigate`.
  - **New settings sub-key & Settings toggle**: added `settings.sidebarItems.gxCorner: true` default in `src/storage.js`, a `"GX Corner"` toggle in Customize Dock (`src/ui/index.html`), and a synced `"Show GX Corner in Sidebar Rail"` switch (`#setGxCornerRailChk`) in `nextgx://settings` (`src/ui/chrome-webui.js`).

### Tested
- **Syntax checks (`node --check`)**: Passed on all 14 created/modified JS files (`src/main.js`, `src/storage.js`, `src/corner-preload.js`, `src/main/core.js`, `src/main/utils.js`, `src/main/navigation.js`, `src/main/session.js`, `src/main/broadcast.js`, `src/main/tabs.js`, `src/main/ipc.js`, `src/main/windows.js`, `src/main/gxcorner.js`, `src/ui/renderer.js`, `src/ui/chrome-webui.js`) plus prepared `/home/hatch/workspace/nextgxbrowser-upgrade/p2-5-verify.js`, inline `<script>` blocks in `src/ui/corner.html` and `src/ui/newtab.html`, and JSON validation of `src/data/gxcorner-curated.json`.
- **Token hygiene**: Verified zero hardcoded hex, `rgb()`, or `rgba()` literals in `src/ui/corner.html` and newly added CSS in `src/ui/newtab.html`.
- **Plain-Node unit tests** (8/8 PASS, isolated temp `userData` + mocked Electron — no live Electron/CDP launch): Verified `nextgx://corner` URL resolution/display/session-restore, `StorageManager` cache persistence/sanitization & `sidebarItems.gxCorner`, RSS 2.0 & Atom 1.0 XML parsing + thumbnail extraction + tracking-pixel filtering + section classification + strict XSS sanitization (including `<script>` body stripping, single-pass entity decoding, and `javascript:`/`file:`/`data:` URL rejection), curated fallback completeness (3 sections + 5 storefronts), offline fallback mode with honest message, cache-first immediate paint + live refresh cache update & `corner:update` broadcast, and single-flight refresh coalescing + idempotent `registerPreloadScript` registration.
- **No live/visual/CDP verification in this step**: Per P2-5 gate rules, live browser/RSS/visual verification is deferred to Phase II end (prepared `/home/hatch/workspace/nextgxbrowser-upgrade/p2-5-verify.js`, not run).

### Known limitations
- **Live feed availability depends on external outlets**: RSS/Atom reachability, item volume, and thumbnail inclusion depend on the 5 third-party gaming outlets' public endpoints (PC Gamer, IGN, Eurogamer, GamesRadar+, Rock Paper Shotgun) and network/proxy access. If an outlet changes its RSS URL or blocks automated requests in a given environment, remaining feeds continue serving and full outage degrades cleanly to the curated fallback.
- **Curated fallback & release calendar are static JSON**: `src/data/gxcorner-curated.json` is bundled in the app (editable on disk) and does not query proprietary game-store pricing APIs. When offline (or when RSS feeds contain few dedicated deal/release headlines), curated storefront links and release calendar entries fill those sections honestly badged as `Curated`.
- **Keyword-based section classification**: Live RSS items from general gaming feeds are sorted into `deals` and `releases` via keyword/category heuristics; items not matching deal or release terms appear under `Gaming News`.
- **Cached-offline vs empty-offline distinction**: If valid cached live items (< 1 hour old) already exist and a manual refresh fails offline, GX Corner preserves the cached headlines with an honest `"Offline — couldn't reach live feeds; showing cached gaming news"` banner + Retry button; when the cache is empty or expired (> 1 hour) and feeds fail, it switches to the curated fallback (`"Offline — showing curated picks"`).

---

## Phase 2 — P2-4: Video Pop-Out (Native PiP) + Sidebar Player (2026-11-21)

Adds native Chromium Picture-in-Picture video pop-out from the browser toolbar and tab context menu, plus a unified GX-styled **Player** view inside the left sidebar overlay panel that tracks and controls real media across tabs (all workspaces) and sidebar services.

### Changed
- **Media Tracking & Native PiP Engine (new `src/main/player.js`)**:
  - Tracks per-`WebContents` playing-video state (`hasPlayingVideo`, `pipActive`, `videoTitle`, `videoSrc`) and unified media state (playing/paused, `currentTime`, `duration`, `isLive`, `playbackRate`, `navigator.mediaSession` metadata + supported action handlers, and Electron `audio-state-changed`) across all browser tabs and non-internal sidebar panel services.
  - Strictly enforces privacy isolation: Private windows track only their own window's tabs/sidebar services and never share media state with normal windows (and vice-versa). The Player panel itself is never tracked as a media source.
  - Automatic active-source selection prioritizes actively playing sources over paused ones, then most-recently-playing (`lastPlayedAt`), following newly playing tabs/services automatically, falling back to the next-most-recent source (or empty state) when a source closes, navigates away, or hibernates (`sleepTab`), and retaining paused media so Resume works cleanly.
  - Triggers native Chromium `video.requestPictureInPicture()` (and toggles `document.exitPictureInPicture()` when already popped out) via main → `tab-preload.js` IPC with transient user activation (`webContents.executeJavaScript('0', true)`), plus an automatic main-world `WebScopedUserGesture` fallback if Chromium rejects the isolated-world callback with `NotAllowedError`. Handles ineligible/disabled videos gracefully with a chrome toast and never crashes.
  - Validates and sanitizes all incoming preload reports (main-frame managed views only; strict artwork URL allowlist limited to `https:`, `http:`, and capped `data:image/(png|jpeg|jpg|webp|gif);base64,`).
- **Tab & Sidebar Preload Media Observer + Player Bridge (`src/tab-preload.js`, `src/preload.js`)**:
  - On non-internal `http:`, `https:`, and `file:` pages, observes `<video>` and `<audio>` elements via capture-phase DOM media listeners (covering open Shadow DOM and same-origin iframes) plus a coalesced `MutationObserver` (300ms) for dynamically inserted/removed media elements, with debounced state reports (120ms), 1s throttled `timeupdate` progress reporting, and payload deduplication so video-heavy pages never spam IPC.
  - Installs a CSP-safe main-world `MediaSession` hook via `webFrame.executeJavaScript` (keyed by a per-document random 96-bit `Symbol` + plain `Event`, zero `window.postMessage` noise and zero privileged APIs exposed to page scripts) to observe `navigator.mediaSession.metadata` and track which action handlers (`play`, `pause`, `nexttrack`, `previoustrack`, `seekto`) the page actually registered, enabling honest Next/Previous support where pages expose it.
  - Handles private `player:command` messages from main to run PiP on the best playing `<video>` (preferring `!disablePictureInPicture`, most-recently-playing, largest area) and execute play/pause/next/prev/seek controls.
  - Added gated `window.gxPlayerAPI` (exposed ONLY for `internalPageKind === 'player'`) and added `popOutVideo`, `getPlayerState`, `playerControl`, and `onPlayerUpdate` to `window.gxAPI` (`src/preload.js`).
- **Sidebar Player Panel & Minimal Sidebar Integration (`src/ui/player.html`, `src/main/sidebar.js`, `src/ui/sidebar-panel-chrome.html`, `src/main/core.js`, `src/main/utils.js`, `src/storage.js`)**:
  - Added minimal `player` internal entry (`internal: true`) to `SIDEBAR_SERVICES` in `src/main/sidebar.js` so Player opens inside the existing left sidebar overlay panel (supporting Pin/Unpin, drag-to-resize, collapse-on-reclick, and Esc) without opening a new tab; hides the external "Open in new tab" button for the internal Player panel and hooks sidebar service `audio-state-changed` / `did-navigate` / `destroyed` / window cleanup into `player.js`.
  - Built `src/ui/player.html` using `theme.css` `var()` tokens exclusively (zero hardcoded hex/`rgb()` colors): designed GX empty state (`"Nothing playing — play something in a tab"` with quick links to YouTube Music / Spotify sidebar panels), artwork frame with themed placeholder fallback, track title/artist/album, live seek bar with `mm:ss` / `LIVE` readout, Play/Pause, honestly disabled Next/Previous buttons when unsupported by the page, PiP quick-button when video is playing, "Open ↗" jump-to-source button (switches workspace/tab or opens sidebar service), and a multi-source switcher list when >1 media source is tracked.
  - **New settings sub-key**: added `settings.sidebarItems.player: true` default in `src/storage.js` (and corresponding "Media Player" toggle in Customize Dock).
- **Browser Chrome UI, Tab Context Menu & Lifecycle Wiring (`src/ui/index.html`, `src/ui/renderer.js`, `src/ui/styles.css`, `src/ui/popover.html`, `src/main/broadcast.js`, `src/main/tabs.js`, `src/main/ipc.js`, `src/main/stats.js`, `src/main/windows.js`)**:
  - Added `#btnPopOutVideo` in the right toolbar (`src/ui/index.html`) — enabled only when the active tab has a playing video (across any workspace), disabled with an explanatory tooltip otherwise, highlighted while PiP is active, and updated immediately via `state:update` on play/pause/tab switch/workspace switch.
  - Added `#btnTabCtxPopOutVideo` (`"Pop out video"` / `"Exit Pop-out Video"`) to the tab context menu (`src/ui/popover.html`), disabled with tooltip when no video is playing in that tab (matching `#btnTabCtxHibernate` / `#btnTabCtxCloseOthers`); invoking it on a background tab with a playing video activates the tab first so native PiP opens cleanly.
  - Added `#btnSidebarPlayer` to the left rail (`src/ui/index.html`) with live `.audible` playing dot and tooltip synced via `player:update`.
  - Extended `serializeTabs(ctx)` (`src/main/broadcast.js`) with per-tab `hasPlayingVideo`, `pipActive`, `videoTitle`, forwarded `settings:update` to `player.html` for live theme/sound sync, wired tab lifecycle hooks in `src/main/tabs.js` (audio, navigation, title/favicon, hibernate, close, destroy), pruned stale sources on the existing 2.5s `stats.js` tick, and registered `'player'` page kind + gated IPC handlers in `src/main/ipc.js`.
  - **In-scope polish**: Added multi-source switching inside the Player panel when multiple tabs/services have active media, jump-to-source ("Open ↗") across workspaces/sidebar panels, and a PiP quick-button directly inside the Player header bar when the active source has a playing video.

### Tested
- **Syntax checks (`node --check`)**: Passed on all 13 changed/new JS files (`src/main/player.js`, `src/main/core.js`, `src/main/utils.js`, `src/main/sidebar.js`, `src/main/tabs.js`, `src/main/broadcast.js`, `src/main/stats.js`, `src/main/windows.js`, `src/main/ipc.js`, `src/storage.js`, `src/preload.js`, `src/tab-preload.js`, `src/ui/renderer.js`), prepared `/home/hatch/workspace/nextgxbrowser-upgrade/p2-4-verify.js`, inline `<script>` blocks in `src/ui/player.html`, `src/ui/popover.html`, and `src/ui/sidebar-panel-chrome.html`, and embedded main-world JS templates in `src/tab-preload.js` and `src/main/player.js`.
- **Plain-Node unit tests** (9/9 PASS, mocked Electron — no live Electron/CDP run): Verified artwork URL sanitization (blocks `javascript:`, `file:`, `data:image/svg+xml`), idle state, playing-video state + immediate disable on pause with Player resume retention, source switching across tabs (multiple workspaces) & sidebar services, hibernation & tab-close fallback to next source / empty state, Private window media isolation, PiP preload IPC with `userGesture` + `NotAllowedError` main-world fallback, graceful error toast on `disablePictureInPicture`, honest rejection of unsupported Next/Previous, seek clamping, focus-source switching, and Player self-exclusion.
- **Token hygiene**: Verified zero hardcoded hex or `rgb()`/`rgba()` color literals in `src/ui/player.html` and all newly added UI CSS/HTML.
- **No live/visual/CDP verification in this step**: Per P2-4 gate rules, live browser/PiP/visual verification is deferred to Phase II end (prepared `/home/hatch/workspace/nextgxbrowser-upgrade/p2-4-verify.js`, not run).

### Known limitations
- **PiP eligibility depends on the page & video**: Chromium's native `requestPictureInPicture()` requires a playing `<video>` with loaded video frames (`videoWidth > 0`) and without `disablePictureInPicture` (or DRM/platform blocks). Audio-only `<video>` elements or videos inside cross-origin `<iframe>`s cannot be popped out from the main-frame preload; attempting PiP on an ineligible video shows a toast rather than crashing.
- **Cross-origin iframe media**: Because `tab-preload.js` runs in the main frame (`nodeIntegrationInSubFrames` remains off for security), `<video>`/`<audio>` elements embedded inside cross-origin `<iframe>`s are not directly controllable via DOM; if they emit sound, Electron's `audio-state-changed` still surfaces them in Player as an audible source with honest disabled playback controls and a working "Open ↗" link to the tab.
- **Next / Previous controls**: Enabled strictly when the page registers real `navigator.mediaSession.setActionHandler('nexttrack' | 'previoustrack', fn)` handlers; pages without Media Session track handlers honestly keep Next/Previous disabled.
- **Artwork & live streams**: Artwork is shown only where the page exposes valid `http(s):` or base64 image artwork via `navigator.mediaSession.metadata.artwork` (otherwise a GX themed placeholder renders). Live streams (`duration === Infinity`) display a `LIVE` badge and honestly disable seeking.
- **Pause vs idle retention**: Pausing a video immediately disables the toolbar Video Pop-out button, while the Sidebar Player retains the paused media source so users can click Play to resume; navigating away, hibernating, or closing the tab clears it back to the next source or empty state.

---

## Phase 2 — P2-3: Workspaces + Tab Islands (Groups) (2026-11-21)

Replaces the cosmetic `Personal`/`Work`/`Gaming` titlebar pills with real Opera GX-style **Workspaces** and **Tab Islands (Groups)**, backed by persistent `workspaces.json` and `tabgroups.json` stores, per-window active workspace tracking, global pinned tabs, and full session-restore / hibernation compatibility.

### Changed
- **Workspaces Engine & Persistence (new `src/main/workspaces.js`, `src/storage.js`)**:
  - Added global `workspaces.json` and `tabgroups.json` JSON stores in `StorageManager` (`userData/nextgx-data`), with sanitization and automatic initialization of the built-in `'default'` (`"Default"`) workspace.
  - **Migration & Legacy `settings.workspace` Compatibility**: On first load without `workspaces.json`, creates the built-in `"Default"` workspace (`id: 'default'`, non-deletable, cannot be renamed to empty) and assigns all existing/migrated tabs to it untouched. Legacy `settings.workspace: 'Personal'` is retained in `StorageManager` defaults for backward compatibility and left inert (the old cosmetic pills never separated tabs, so they do not map to distinct migrated tab sets).
  - **Workspace Lifecycle**: Supports create, switch, rename, and delete via gated `workspaces:*` IPC channels (`src/main/ipc.js`) and `window.gxAPI` (`src/preload.js`). Switching workspaces swaps the visible tab strip and activates the target workspace's remembered last-active tab (`ctx.workspaceLastActiveTab`), falling back to its first unpinned tab or spawning a fresh Start Page tab if empty (never a blank strip). Inactive workspaces' tab views stay loaded (parked offscreen) for instant switching.
  - **Per-Window Active Workspace**: `ctx.activeWorkspaceId` is tracked independently per window (global workspace/group definitions are synced across all normal windows on mutation). New windows start in the `'default'` workspace; session-restored windows restore their saved `activeWorkspaceId`.
  - **Non-Destructive Delete**: Deleting a workspace never closes tabs — all its tabs move to `'default'` (ungrouped), its groups are removed from `tabgroups.json`, and any window currently viewing the deleted workspace switches to `'default'` first.
  - **Private Windows Rule**: Workspaces apply to normal windows only. Private windows remain on a single `'default'` workspace with `#workspacePills` hidden (`windowIncognito: true`), refuse workspace mutations, and keep any private tab islands strictly in-memory (`ctx.privateGroups`, never written to `tabgroups.json`).
- **Tab Islands / Groups (`src/main/workspaces.js`, `src/main/tabs.js`, `src/ui/theme.css`)**:
  - Added 8 GX-harmonized group colour tokens (`--nx-group-1` through `--nx-group-8`) in `src/ui/theme.css`; all new UI styles in `src/ui/styles.css` and `src/ui/popover.html` use `var()` tokens exclusively (zero hardcoded palette hex outside `theme.css`).
  - Each group (`id`, `workspaceId`, `name`, `color`, `collapsed`, `createdAt`) belongs to one workspace and auto-names (`"Group 1"`, `"Group 2"`, …) with the next colour token.
  - **Creation & Editing**: Create via tab context menu (`Add to New Group`), add to an existing group (`Add to Group`), or middle-50% centre-drop of one unpinned tab onto another. Right-clicking a group pill opens a compact GX editor popover to rename, recolour via 8 swatches, collapse/expand, open a new tab in the group, or **Ungroup** (primary label used on both group pills and grouped tabs; removes the group while keeping all tabs in the workspace).
  - **Collapse / Expand & Auto-Cleanup**: Left-clicking a group pill toggles collapsed state (persisted in `tabgroups.json`). Collapsed islands render as a single chamfered pill showing colour dot + name + tab count (with active-glow highlight when containing the active tab) while hiding member tabs from the strip and keeping their views loaded. Removing, closing, pinning, or dragging out a group's last tab automatically deletes the now-empty group.
  - **Contiguity & DnD**: `normalizeGroupContiguity` keeps grouped tabs adjacent in `ctx.tabOrder`. Tab-strip DnD distinguishes middle-50% centre-drop (create/join group) from outer-25% edge-drop (before/after reorder within/across groups), supports dropping onto/before/after group pills, and ungroups tabs dragged outside a group (onto ungrouped tabs, strip background, or `+`), while preserving existing pinned-tab reorder and empty-spacer cancel behavior.
- **Global Pinned Tabs (`src/main/tabs.js`, `src/ui/renderer.js`)**:
  - Pinned tabs remain window-global at the left of the strip in every workspace and never hold group membership. Pinning a tab strips its `groupId` (auto-pruning any emptied group) while preserving its origin `workspaceId` so unpinning returns it to its remembered workspace (falling back to the active workspace if deleted, and aligning `activeWorkspaceId` if the active tab returns to another workspace).
- **Unified State Broadcast, Session Restore, Hibernate & Tab Ops (`src/main/broadcast.js`, `src/main/session.js`, `src/main/windows.js`, `src/main/tabs.js`, `src/main/popovers.js`, `src/ui/index.html`, `src/ui/popover.html`, `src/ui/renderer.js`, `src/ui/styles.css`)**:
  - Extended `serializeTabs(ctx)` (`state:update`) with per-tab `workspaceId` + `groupId` plus top-level `activeWorkspaceId`, `workspaces`, and `groups` (single state payload — no second channel).
  - Extended `session.json` serialization/sanitization/restore to carry `activeWorkspaceId`, `workspaceActiveTabIndices`, and per-tab `workspaceId` + `groupId`; missing workspaces/groups fall back to `'default'` / ungrouped so tabs are never dropped.
  - Verified `sleepTab`/`wakeTab`, auto-hibernate (`stats.js`), and GX Control RAM limiter operate across all workspaces without clearing `workspaceId` or `groupId`.
  - Scoped `closeOtherTabs` to the current workspace's unpinned visible tabs (never closing pinned tabs or tabs in other workspaces); updated `closeTab` to pick the next visible tab in the active workspace and spawn a Start Page rather than closing the window while other workspaces still hold tabs; `duplicateTab` preserves source `workspaceId` and `groupId` for unpinned tabs (pinned duplicates open unpinned & ungrouped in the active workspace); `reopenLastClosedTab` (`Ctrl+Shift+T`) restores into the active workspace.
  - Minimal `src/main/popovers.js` touch (6 lines): raised `tab-context` `maxH` to `540` and bypassed static size caching for `tab-context` so dynamic group/workspace menus auto-size cleanly.
  - **In-scope extras**: Added `Move to Workspace` in the tab context menu + drag-tab-onto-workspace-pill support, `New Tab in Group` in the group pill menu, and a subtle workspace badge in GX Control's per-tab resource monitor when multiple workspaces exist.

### Tested
- **Syntax checks (`node --check`)**: Passed on all 10 changed/new JS files (`src/storage.js`, `src/preload.js`, `src/main/workspaces.js`, `src/main/tabs.js`, `src/main/broadcast.js`, `src/main/session.js`, `src/main/windows.js`, `src/main/ipc.js`, `src/main/popovers.js`, `src/ui/renderer.js`) plus inline `<script>` syntax validation on `src/ui/popover.html`.
- **Plain-Node unit tests** (13/13 PASS, isolated temp `userData` + mocked Electron): Verified first-load Default migration + legacy `settings.workspace` retention, legacy `session.json` migration, create/rename/switch/delete workspaces + per-window isolation + live offscreen views, Private window workspace suppression + in-memory-only private groups, group create/add/rename/recolour/collapse/expand/ungroup + empty-group auto-deletion, DnD centre-drop grouping + pill drop + intra-group reorder + drag-out ungrouping, global pinned tabs + pin-strips-group + remembered origin workspace on unpin, sleep/wake field retention + cross-workspace `sleepBackgroundTabs`, workspace-scoped `closeOtherTabs`, `duplicateTab` workspace+group preservation, `closeTab` non-closing last-tab-in-workspace behavior, `reopenLastClosedTab` into active workspace, and session save/reload + missing workspace/group fallback with zero tab loss.
- **Token hygiene**: Verified zero hardcoded hex/`rgb()` colour literals added in `src/ui/styles.css` or `src/ui/popover.html`.
- **Smoke test**: `timeout 25 xvfb-run -a npm start` stayed up cleanly for 25s with exit code `124` (only benign D-Bus/NSS VM noise; zero JS errors).
- **No live/visual/CDP verification in this step**: Per P2-3 gate rules, interactive UI and visual/DnD verification are deferred.

### Known limitations
- **RAM tradeoff across workspaces**: Following Opera behavior, tabs in inactive workspaces (and inside collapsed groups) remain loaded in memory with their `WebContentsView`s kept alive so switching is instant. Users with many tabs across workspaces rely on Auto-Memory Saver and the GX Control RAM Limiter (both of which operate across all workspaces) to hibernate idle background tabs.
- **Unpinning destination behavior**: Pinning remembers the tab's origin `workspaceId` (including across session restore) and unpinning returns it there (falling back to the active workspace if its origin workspace was deleted). If an inactive pinned tab is unpinned while viewing a different workspace, it returns silently to its origin workspace; if the active pinned tab is unpinned, the window switches to its origin workspace so the active tab remains visible.
- **New window starting workspace**: New windows (`Ctrl+N` / menu) always start in the built-in `'default'` workspace rather than inheriting the last-focused window's active workspace.
- **Group & workspace editor UX**: Creating/renaming workspaces and renaming/recolouring groups use a compact titlebar-anchored popover rather than inline titlebar text inputs (required so the editor renders above `WebContentsView` content); keyboard shortcuts for switching workspaces (e.g. `Ctrl+Alt+1..9`) are not added in this step.
- **Legacy `settings.workspace` key**: Kept in `settings.json` defaults for backward compatibility, but left inert since the real workspace store (`workspaces.json`) supersedes it.

---

## Phase 2 — P2-2: GX Control (RAM / CPU / Network limiters + live stats) (2026-11-21)

Implements Opera GX-style resource limiters and live per-tab resource telemetry inside the existing left-rail `gxControl` drawer, backed exclusively by real Electron/Chromium APIs (`app.getAppMetrics()`, `webContents.getOSProcessId()`, `sleepTab`, and Chrome DevTools Protocol via `webContents.debugger`).

### Changed
- **GX Control Engine (new `src/main/gxcontrol.js`)**:
  - **Process & Browser Telemetry**: Samples `app.getAppMetrics()` (with a 500ms cache guard against rapid IPC polling corrupting Chromium's per-process CPU delta window, primed at startup via `primeMetrics()`). Sums `memory.workingSetSize` (KB → MB) for `browserRamMB` and sums `cpu.percentCPUUsage` across all app processes normalized by `os.cpus().length` (0–100% of total logical CPU cores) for `browserCpuPercent`.
  - **Per-Tab Resource Matching**: Matches each awake tab via `webContents.id` → `webContents.getOSProcessId()` → `app.getAppMetrics()` OS `pid`. Hibernated tabs report `0 MB` / `0% CPU` honestly; newly spawning tabs without a PID match yet report `null` ("Measuring..."). Tabs sharing a Chromium renderer OS PID are flagged `sharedProcess: true` with `sharedProcessCount` and report the shared process's real total rather than fabricating a split.
  - **RAM Limiter**: Re-checked on the existing 2.5s stats cadence. When `gxRamLimiterEnabled` is on and `browserRamMB > gxRamLimitMB`, hibernates the least-recently-used (`lastActiveAt` ascending) eligible background tab via existing `sleepTab(ctx, id)` — skipping active, pinned, audible, and already-sleeping tabs (matching auto-hibernate rules). Enforces at most 1 tab hibernation per 5-second cooldown (`RAM_HIBERNATE_COOLDOWN_MS = 5000`) so Chromium's renderer process has time to exit and free memory before deciding whether another tab needs hibernation. Tracks limiter-triggered hibernations in an in-memory session counter (`hibernatedCount`, separate from auto-hibernate and manual actions).
  - **CPU Limiter**: Uses browser-only CPU (`browserCpuPercent` from `app.getAppMetrics()`, keeping system-wide `cpuPercent` via `os.cpus()` intact). When `gxCpuLimiterEnabled` is on and `browserCpuPercent > gxCpuLimitPercent`, engages real CDP CPU throttling via `webContents.debugger.sendCommand('Emulation.setCPUThrottlingRate', { rate })` (2x–8x slowdown scaled by cap and excess) on **background non-internal tabs only** — the active tab and internal UI pages (`src/ui/*`) are never throttled. Releases (`rate: 1` and detaches when unused) automatically when browser CPU drops back to/below cap, when a tab becomes active (`onActiveTabChanged`), or when disabled.
  - **Network Limiter**: When `gxNetLimiterEnabled` is on, applies real CDP bandwidth capping via `Network.enable({ maxTotalBufferSize: 0, maxResourceBufferSize: 0 })` and `Network.emulateNetworkConditions({ offline: false, latency: 0, downloadThroughput, uploadThroughput: -1 })` (with `downloadThroughput = Math.round((mbps * 1_000_000) / 8)` bytes/sec) to awake non-internal browser tabs. Resets (`downloadThroughput: -1`, `Network.disable`, detach) immediately when disabled. Live Mbps throughput is NOT fabricated (`throughputMeasured: false`); the UI reports honest cap/active state and limited-tab count.
  - **Coordinated Debugger Ownership**: Shares a single per-`webContents` serialized async CDP command queue (`cdpStates` keyed by `webContents.id`, 2.5s per-command timeout) between CPU and Network limiters. Tracks `attachedByUs` ownership, hooks `debugger.on('detach')` and `wc.once('destroyed')`, skips tabs where another tool (e.g. DevTools) already owns the debugger without stealing or crashing, detaches when neither limiter needs a tab, and detaches cleanly on `before-quit` (`gxControl.shutdown()`).
- **Unified Stats Cadence & Payload (`src/main/stats.js`)**:
  - Extended `collectSystemStats()` and the existing 2.5s `'system:stats-update'` broadcast (no second broadcast timer added) with `browserCpuPercent`, `cpuCoreCount`, `tabStats`, and `gxControl` while preserving all Phase I keys (`totalSysMB`, `usedSysMB`, `freeSysMB`, `sysRamPercent`, `browserRamMB`, `cpuPercent`, `activeTabsCount`, `sleepingTabsCount`, `settings`).
  - Added overlap guard (`statsTickInFlight`), immediate `broadcastSystemStatsNow()` helper for settings updates, and `stopBackgroundTimers()` cleanup on quit (`src/main.js`).
- **Tab & Settings Lifecycle Wiring (`src/main/tabs.js`, `src/main/ipc.js`, `src/main.js`, `src/preload.js`)**:
  - Hooked `gxControl.onTabViewCreated`, `onTabNavigated` (`did-start-loading` + `did-navigate`), `onActiveTabChanged` (`switchTab` / active close), and `onTabDetached` (`sleepTab` / `closeTab` / `closeOtherTabs`) so persisted limiters re-apply automatically across restarts, new tabs, wakes, and cross-origin navigations.
  - Hooked `settings:update` in `src/main/ipc.js` to invoke `gxControl.onSettingsChanged(s, { sleepTab })` and push an immediate `system:stats-update` when any limiter setting changes; added gated `gxcontrol:get-state` IPC handler and `window.gxAPI.getGxControlState()` preload bridge method.
- **Settings Persistence & Sanitization (`src/storage.js`)**:
  - Added new persisted settings keys (all OFF by default, leaving existing `ramLimitMB` and `autoSleep*` keys intact): `gxRamLimiterEnabled` (`false`), `gxRamLimitMB` (`4096`, clamped `512`–`16384` MB / 0.5–16 GB), `gxCpuLimiterEnabled` (`false`), `gxCpuLimitPercent` (`50`, clamped `25`–`100`%), `gxNetLimiterEnabled` (`false`), `gxNetLimitMbps` (`10`, clamped `1`–`100` Mbps), sanitized in both `getSettings()` and `updateSettings()`.
- **GX Control Drawer UI (`src/ui/index.html`, `src/ui/styles.css`, `src/ui/renderer.js`)**:
  - Extended the existing `#left-tool-gxControl` left drawer (titled `GX Control`, keeping all existing telemetry IDs, Auto-Memory Saver controls, and per-tab Hibernate buttons intact).
  - Added Browser CPU readout alongside System CPU, RAM cap progress/warning coloring, three unified Resource Limiter blocks (RAM 0.5–16 GB slider + Off, CPU 25–100% slider + Off, Network 1–100 Mbps slider + quick preset tiers 1/5/10/50/100M + Off) with live status pills and honest telemetry lines, and upgraded `#perfTabsList` with live per-tab MB/CPU, `Throttled`, `Net`, `Shared`, `Pinned`, `Audio` badges, and in-place row patching so 2.5s refreshes never interrupt clicks or jump scroll position.
  - Styled exclusively with `theme.css` `var()` tokens (zero hardcoded colors) and narrow-width-safe flex layouts.

### Tested
- **Syntax checks (`node --check`)**: Passed on all 8 changed/new JS files (`src/main.js`, `src/main/gxcontrol.js`, `src/main/stats.js`, `src/main/tabs.js`, `src/main/ipc.js`, `src/storage.js`, `src/preload.js`, `src/ui/renderer.js`).
- **Plain-Node unit tests** (isolated temp `userData` + mocked Electron `app`/`webContents.debugger`): Verified default-off settings, range clamping and NaN/negative sanitization, persistence across `StorageManager` reload, `mbpsToBytesPerSec` conversion, multi-core browser CPU normalization, LRU RAM hibernation ordering + skip rules (active/pinned/audible/sleeping) + 5s cooldown, CDP CPU throttling on background tabs only + active-tab protection + instant unthrottle on tab switch + release/detach below cap, CDP network cap application + reset/detach, external debugger non-interference, and shared-PID / hibernated tab resource reporting.
- **Smoke test**: `timeout 25 xvfb-run -a npm start` stayed up cleanly for 25s with exit code `124` (dbus/NSS messages in Xvfb log are benign VM noise; zero uncaught JS errors).
- **No live/visual/CDP browser verification in this step**: Per P2-2 gate rules, interactive UI and live CDP tests are deferred.

### Known limitations
- **Live network throughput is not directly metered**: Electron does not expose a lightweight per-tab byte-rate API without permanently attaching CDP debuggers to all tabs. Rather than fabricating a live Mbps figure, GX Control reports `throughputMeasured: false` and displays honest limiter state (Off/Active, configured Mbps cap, and count of capped tabs).
- **Network limiter scope is per-tab, not a global shared bucket**: CDP `Network.emulateNetworkConditions` applies independently to each awake non-internal browser tab (skipping internal `nextgx://` UI pages and any tab whose debugger is externally attached). Two simultaneously downloading tabs each get up to the configured Mbps cap, and requests outside browser tabs (sidebar service panel views, main-process/extension background traffic) are not throttled by tab CDP.
- **Shared Chromium renderer processes**: `app.getAppMetrics()` reports memory (`workingSetSize`) and CPU (`percentCPUUsage`) at OS process (`pid`) granularity. When Chromium places multiple tabs in one shared renderer PID, each of those tabs displays the process's real total with a `Shared (N)` badge rather than inventing a per-tab split; browser totals sum unique PIDs so memory/CPU are never double-counted.
- **External debugger / DevTools precedence**: If DevTools or an external CDP client is already attached to a tab's `webContents`, GX Control respects ownership and skips attaching/throttling that tab until the external debugger detaches.
- **RAM limiter granularity & session counter**: Checks run on the 2.5s telemetry cadence with a 5s cooldown between individual LRU tab hibernations to allow OS process teardown to reflect in `app.getAppMetrics()`. If only active, pinned, or audible tabs remain while over cap, no tabs are forcibly hibernated. The "Hibernated by limiter" counter is in-memory and resets each session.

---

## Phase I review fixes (2026-11-21)

Addresses all actionable findings from the Phase I code review (`phase1-review-findings.md`) and live-test pass (`phase1-test-findings.md`) across Groups A–D.

### Changed

#### Group A — Blockers & Majors (live-verified)
- **B1 (`src/main/fullscreen.js`, `src/main/ipc.js`, `src/main/shortcuts.js`)**: Removed the `win.setFullScreen` / `win.isFullScreen` instance monkey-patch (option (b)) that prevented HTML `requestFullscreen()` from entering OS fullscreen; exported `toggleWindowFullscreen(ctx)` for F11 / `window:fullscreen` while keeping native `enter-full-screen` / `leave-full-screen` listeners.
- **M1 (`src/main/tabs.js`)**: Re-applied `tab.zoomFactor` in `wakeTab` on view build, `dom-ready`, and `did-finish-load` so zoomed tabs retain their zoom level across hibernation wake.
- **M2 (`src/ui/popover.html`)**: Eliminated the +4px width-creep feedback loop on non-menu popovers (`permissions`, `shield`, `downloads`) by omitting target width unless child content actually overflows instead of feeding `getBoundingClientRect().width + padX + 4` back on each measurement pass.
- **M3 / T-3 (`src/main/core.js`, `src/main/sidebar.js`, `src/main/layout.js`, `src/main/broadcast.js`, `src/main/fullscreen.js`, `src/ui/sidebar-panel-chrome.html`)**: Added a dedicated native `WebContentsView` (`ctx.sidebarPanelFrameView`, loading `src/ui/sidebar-panel-chrome.html`) for the sidebar panel header and right-edge resize handle, stacked `activeTabView < sidebarPanelFrameView < activeSidebarServiceView`, and reserved `SIDEBAR_PANEL_RESIZER_WIDTH` (7px) so header buttons and full-height drag-to-resize work via real mouse input in both unpinned and pinned modes.
- **M4 (`src/main/extension-popup.js`)**: Added `setWindowOpenHandler` on extension popup `WebContentsView`s so `http(s)://` and `chrome-extension://` pop-out links open in managed browser tabs and dismiss the popup instead of spawning raw Electron windows.
- **M5 (`src/main/sidebar.js`, `src/ui/renderer.js`)**: Stopped per-pixel `broadcastSidebarState` / `state:update` tab-strip rebuilds during drag-resize (`persist === false`), removed redundant `syncLayoutOffsets()` calls mid-drag, and ignored incoming `sidebar:update` / `settings:update` width overwrites while `isResizingSidebarPanel` is true so final drag width persists accurately.
- **T-1 (`src/main/shortcuts.js`, `src/main/ipc.js`)**: Focused `ctx.win.webContents` before dispatching `focus-address-bar` (`Ctrl+L`) and `open-find` (`Ctrl+F`) so OS keyboard focus transfers from the active tab view into the chrome input.

#### Group B — Minors & Test Minors
- **m1 (`src/main/fullscreen.js`, `src/main/layout.js`, `src/main/extension-popup.js`)**: Closed any open extension popup on fullscreen enter (`ctx.popoverOpenKind || ctx.extensionPopupView`), excluded `ctx.extensionPopupView` from `savedViewBounds` and content fullscreen targets, raised `ctx.extensionPopupView` in `bringOverlaysToFront` above the sidebar panel frame and service views, and re-clamped popup bounds on window resize.
- **m2 (`src/main/sidebar.js`, `src/main/ipc.js`)**: Synced `setSidebarPinned` and persisted `setSidebarWidth` across every window in `windowContexts` (updating `ctx.sidebarPanel`, `syncSidebarLayoutLeft`, `updateActiveViewBounds`, and `broadcastSidebarState` including each window's panel frame view); added the missing `syncSidebarLayoutLeft` call in the `settings:update` handler.
- **m3 (`src/main/popovers.js`, `src/ui/popover.html`)**: Forwarded `{ closed: true }` to `ctx.popoverView.webContents` on `closePopover`, resetting popover state (`showOnly(null)`, clearing `activePopoverKind`/`activeViewId`/settle timer, disconnecting `MutationObserver`) so closed views stop reacting to broadcasts (preventing bookmark deletion in a previously opened folder from dismissing active popovers); added a monotonic `popoverOpenSeq` guard across all post-`await` continuations in `permissions`, `downloads`, and `shield` handlers.
- **m4 (`src/main/core.js`, `src/main/windows.js`, `src/main/tabs.js`, `src/main/sidebar.js`, `src/main/popovers.js`, `src/main/ipc.js`, `src/main/extension-popup.js`)**: Added `registerWebContents(wc, winId)` in `src/main/core.js` hooking `wc.once('destroyed', ...)` to remove entries from `webContentsToWinId`, and adopted it at every `webContentsToWinId` registration site (keeping existing explicit sidebar deletes).
- **m5 (`src/main/layout.js`, `src/main/sidebar.js`, `src/main/ipc.js`, `src/main/windows.js`, `src/ui/renderer.js`, `src/ui/sidebar-panel-chrome.html`, `src/ui/styles.css`)**: Capped effective sidebar panel width to `min(panelWidth, max(240, contentWidth - 50 - rightOffset - 160))` in `layout.js` (and `syncSidebarLayoutLeft`) so a pinned panel and open right drawer never overlap on narrow windows, and applied the same effective cap during drag-resize in both the renderer and frame view without altering the persisted `sidebarPanelWidth` setting.
- **m6 (`src/main/extension-popup.js`, `src/main/shortcuts.js`)**: Registered extension popup `webContents` in `webContentsToWinId` via `registerWebContents` on open (and deleted on close), attached `attachKeyboardShortcuts` so shortcuts (`Ctrl+R`, `Ctrl+F`, etc.) work while a popup is focused, and gave `ctx.extensionPopupView` Escape precedence over collapsing an unpinned sidebar panel.
- **m7 (`src/main/ipc.js`)**: Added the `findSidebarServiceByWebContents` branch to `tabs:forward`, mirroring `tabs:back`.
- **m8 (`src/main/extensions.js`, `src/ui/popover.html`)**: Pruned disabled extensions from `settings.pinnedExtensions` on disable (remembering `restorePinnedOnEnable` to restore the toolbar pin on re-enable) and disabled pinning of disabled extensions in the dropdown.
- **m9 (`src/main/sidebar.js`)**: Best-effort `removeChildView` of crashed/destroyed sidebar panel views (and frame view) before creating replacements in `getOrCreateSidebarView` / `ensureSidebarPanelFrameView`.
- **m10 (`src/main/tabs.js`)**: Skipped pinned tabs in manual `sleepBackgroundTabs`, matching the auto-hibernate timer in `src/main/stats.js`.
- **m11 (`src/main/extension-popup.js`)**: Enabled `sandbox: true` on extension popup `WebContentsView`s (matching tab and sidebar views); verified against `p2-1d-test-extension` (renders 320×240, `P2-1D-POPUP-READY` marker, `chrome.runtime.id` bindings intact).
- **m12 (`src/ui/popover.html`)**: Extended ArrowUp/ArrowDown keyboard navigation to `#view-extensions-dropdown` matching `.ext-dd-main:not(:disabled)` alongside `.menu-item:not(:disabled)`, with `:focus-visible` styling.
- **m13 (`src/main/extension-popup.js`, `src/main/ipc.js`)**: Recorded `{ id, closedAt }` when blur closes a popup and treated a repeat `openExtensionPopup` for the same extension within 250ms (or while already open) as a toggle-close so clicking a pinned toolbar icon dismisses its popup instead of immediately re-opening it.
- **T-2 (`src/main/stats.js`, `src/tab-preload.js`, `src/ui/newtab.html`)**: Pushed `system:stats-update` to non-sleeping Start Page tabs on the existing 2.5s telemetry timer, exposed `onSystemStats` on `gxNewTabAPI`, and subscribed `#sdRamReport` in `newtab.html` to live updates while preserving `getInitialData()` as the initial paint.
- **T-4 (`src/main/session.js`, `src/main/windows.js`)**: Added a conservative `isDirectDownloadRestoreUrl` heuristic (skips http(s) URLs whose pathname ends in a known downloadable file extension AND which already appear as `completed` in the downloads store) so session restore does not re-download duplicate files on restart.

#### Group C — Adjudication Polish
- **#2 (`src/main/fullscreen.js`)**: Restricted the deferred `Escape` fullscreen exit fallback to HTML fullscreen (`fs.html`) only so F11 window fullscreen exits via F11 only (matching Chrome and leaving `Escape` free for page UI/modals).
- **#3 (`src/ui/renderer.js`, `src/main/core.js`, `src/ui/styles.css`, `src/ui/sidebar-panel-chrome.html`)**: Deleted the dead `SIDEBAR_PANEL_HEADER_HEIGHT` constant in `renderer.js` and cross-referenced the active 44px sources in `core.js`, `styles.css`, and `sidebar-panel-chrome.html`.
- **#6 (`src/ui/chrome-webui.html`, `src/ui/chrome-webui.js`, `src/ui/styles.css`, `src/ui/renderer.js`)**: Disabled and dimmed the auto-sleep minutes-segment buttons (`2m` / `5m` / `10m` / `20m`) whenever Auto-Memory Saver is off in both `nextgx://settings` and the GX Control drawer, synced live across toggles.
- **#8 (`src/ui/styles.css`, `src/ui/sidebar-panel-chrome.html`)**: Added `#sidebarPanel.resizing { animation: none; transition: none; }` for smooth drag-resizing without transition lag.
- **#10 (`src/main/fullscreen.js`)**: Saved `prevSource = fs.source` prior to clearing fullscreen state in `exitFullscreen` and skipped `restoreFocusToActiveTab` when exiting sidebar-panel fullscreen restored the panel (preserving focus on the panel view).

#### Group D — Nits
- **n1**: Moot — the B1 option (b) fix removed the `win.setFullScreen` / `win.isFullScreen` monkey-patch wrapper entirely; no double-attach wrapper risk remains.
- **n2 (`src/ui/sidebar-panel-chrome.html`)**: Wired the unused `window.gxAPI.toggleSidebarPin()` and `window.gxAPI.openSidebarPanelInNewTab()` preload APIs to the sidebar panel frame view's Pin and Open-in-new-tab buttons.
- **n3 (`src/main/fullscreen.js`)**: Resolved `resolveWindowFullscreenTarget(ctx)` before entering native fullscreen in `toggleWindowFullscreen(ctx)` so a window with no non-sleeping tab or open panel does not enter OS fullscreen with chrome visible.
- **n4 (`src/ui/newtab.html`)**: Captured `requestedFile` and a monotonic `wallpaperSyncSeq` before `await getWallpaperImage()` in `syncWallpaperFromSettings` so an in-flight fetch cannot cache an older data URL under a newer wallpaper filename.
- **n5 (`src/main/stats.js`, `src/storage.js`)**: Guarded `autoSleepMinutes` with `Number.isFinite` in `stats.js` and sanitized it in `StorageManager.getSettings()` / `updateSettings()`.

### Tested
- **Group A live verification (prior pass, all PASS)**: B1 OS fullscreen (local + YouTube + F11 + small-window decisive test), M1 150% zoom survives sleep/wake on a fresh origin, M2 popover widths stable across repeated opens, M3/T-3 real mouse header buttons + full-height drag-resize in unpinned and pinned modes, M4 popup links open in managed tabs, M5 drag width persists as final position, T-1 real `Ctrl+F` counter `1 / 5` + `Ctrl+L` typing.
- **Syntax checks (`node --check`)**: Passed on all 17 modified JS files (`src/main/core.js`, `src/main/fullscreen.js`, `src/main/layout.js`, `src/main/extension-popup.js`, `src/main/shortcuts.js`, `src/main/popovers.js`, `src/main/sidebar.js`, `src/main/ipc.js`, `src/main/tabs.js`, `src/main/windows.js`, `src/main/session.js`, `src/main/extensions.js`, `src/main/stats.js`, `src/storage.js`, `src/tab-preload.js`, `src/ui/renderer.js`, `src/ui/chrome-webui.js`) and all inline `<script>` blocks in `src/ui/popover.html`, `src/ui/newtab.html`, and `src/ui/sidebar-panel-chrome.html`.
- **Headless Electron verification (`xvfb-run`, isolated temp `userData`)**: Verified m11 (`sandbox: true` popup renders 320×240, `P2-1D-POPUP-READY` marker, `chrome.runtime.id` present), m1 (popup closed on fullscreen enter, stacked above panel frame + service views, re-clamped on resize), m2 (multi-window pinned/width/layout sync), m3 (popover close hides all views and clears state), m4/m6 (`webContentsToWinId` registration and destruction/close cleanup), m5 (960px + 360px drawer caps 640px panel to 390px), m8 (disable drops pin, re-enable restores pin), m10 (manual hibernate skips pinned tabs), m12 (ArrowDown focuses `.ext-dd-main` in extensions dropdown), m13 (250ms blur-close toggle debounce), T-2 (Start Page `#sdRamReport` refreshes live via `system:stats-update`), T-4 (completed `.bin` URL skipped on restore, uncompleted/HTML kept), #6 (auto-sleep segment disabled and dimmed when off), n3 (empty-target F11 returns `false` without invoking `setFullScreen`), and n5 (`autoSleepMinutes` NaN sanitization).

### Known limitations & accepted non-changes
- **Adjudications intentionally kept as-is**: `#4` (extension popup measured once after load; re-verify with SPA extensions like Bitwarden in live testing), `#5` (measured-size cache may briefly show a stale size before correcting in ~45ms), `#7` (20s idle-hibernate poll granularity), `#9` (HTML fullscreen from background tabs ignored by design).
- **n6 (accepted pre-existing, not fixed)**: Top-level `data:` URL navigation from the omnibox (`src/main/navigation.js`) is pre-existing Phase 1 behavior, not a Phase I regression; left unchanged.
- **T-4 heuristic scope**: Only skips restore for `http(s)` URLs matching BOTH a known downloadable file extension AND a `completed` entry in `downloads.json`; direct downloads without a file extension or cleared from download history will still restore normally.

---

## Phase 2 — P2-1e: Popover auto-sizing + themed scrollbars (2026-11-21)

Implements Margaret's requirement item 3 (Windows 3-dot menu popover showed
bright white native scrollbars and clipped its bottom item, Settings / Exit).
Every popover now sizes itself to its content, scrollbars are themed dark
everywhere in chrome UI, and popover chrome is a single clean border + one
soft shadow. The fix is structural (CSS overflow + themed scrollbar rules +
content-measured view bounds) because native Windows scrollbars cannot be
reproduced under Linux Xvfb — Margaret confirms visually on Windows.

### Changed
- **Unified popover sizing (`src/main/popovers.js`)**: `openPopover` and
  `resizePopover` now share one bounds path (`computePopoverBounds`) backed
  by per-kind sizing specs (`POPOVER_KIND_SPECS`) and a measured-size cache
  (so repeat opens start at the measured size, no visible jump). `resizePopover`
  accepts and clamps BOTH width and height (still backward-compatible with
  height-only calls); the kind-mismatch guard and the extensions-dropdown
  row-based clamps are preserved. The artificial 540px height cap on the
  3-dot menu is gone (menu maxH 760, clamped to the window), which was what
  clipped "Settings" / "Exit nextGx" and forced a scrollbar. Right-aligned
  toolbar popovers stay pinned to their trigger button's right edge when the
  width adjusts (anchor preserved via `ctx.popoverAnchor`); left-aligned
  popovers stay pinned to their left anchor. The popover view gets a
  transparent compositor background (`setBackgroundColor('#00000000')`) so
  rounded corners render cleanly, and a window `resize` listener re-clamps
  an open popover when the browser window is resized.
- **Content measurement (`src/ui/popover.html`)**: `fitPopoverToView` /
  `measureAndResizePopover` now measure BOTH width and height (temporarily
  un-constraining maxHeight/overflowY, measuring `max-content` width for
  menu-style popovers, adding body padding/border + 4px safety margin) and
  report `{ kind, width, height }`, re-measuring across `requestAnimationFrame`,
  `document.fonts.ready`, a 45ms settle timer, and a `MutationObserver` on
  the active view — wired across all 8 popover kinds and async updates
  (shield stats, permissions/cookie counts, downloads list). Body is a
  non-scrolling outer frame (`overflow: hidden`, 6px padding, 1px accent
  border, radius + soft shadow) so nothing clips against rounded corners;
  `#view-*` containers and inner lists (`#popDlList`, `#bmFolderPopList`,
  `#extDropdownList`) are `.pop-scroll-list` (`overflow-x: hidden`,
  `overflow-y: auto`) so headers/footers stay pinned if a long list scrolls.
  `flex-shrink: 0` on menu items/rows/dividers stops flexbox squishing rows
  or collapsing 1px dividers; `white-space: nowrap` on menu labels/shortcuts.
  Removed `clip-path` chamfers from bordered popover controls (`.zbtn`,
  `.mini-btn`, `.ext-dd-icon`, `.ext-dd-pin-btn`) so their 1px borders and
  rounded corners render crisply.
- **Per-kind sizing (all 8 kinds audited)**: menu 260–360 × 200–760
  (right-anchored, fits all items, no scrollbar); tab-context 200–320 ×
  140–420 (cursor-anchored, shifts up near the window bottom); bookmark-folder
  210–360 × 84–560 (cached per folder:itemCount; long folders scroll the
  inner list with the themed scrollbar, header pinned); extensions-dropdown
  300–380 × 140–480 (initial height from row count, refined by measurement,
  cached per row count; header + "Manage Extensions" footer pinned while
  the list scrolls); screenshot 200–300 × 76–220; permissions 290–380 ×
  240–560 (re-measured after async data); shield 290–380 × 240–520
  (re-measured after async stats + toggles); downloads 290–380 × 92–460
  (fits 0–5 items directly, longer lists scroll the inner list).
- **Extension popup untouched by design (`src/main/extension-popup.js`)**:
  P2-1d's one-shot post-load measurement clamped to 280–420 × 200–600 is
  kept as the popup's ONLY sizing path — no second resizer is applied to it.
  Its internals are extension-owned `chrome-extension://` HTML, so no CSS
  was injected into it (would risk breaking extension layouts).
- **Global themed scrollbars hardened (`src/ui/theme.css`)**: `color-scheme:
  dark` on `:root, html, body`; `::-webkit-scrollbar` rules expanded across
  `html`, `body`, and `*` (track, track-piece, thumb, thumb:hover/active,
  corner) plus `::-webkit-scrollbar-button { display: none }` so no arrow
  buttons appear; all values from theme.css tokens only. `overflow-x: hidden`
  + explicit themed scrollbar properties added to drawer/menu scroll surfaces
  in `src/ui/styles.css` (`.tool-body`, `.nx-menu-panel`, `.scroll-list`),
  `overflow-x: hidden` on `chrome-webui.html` body and the new-tab wallpaper
  panel, and a default `data-theme="gx-violet"` on `popover.html` and
  `chrome-webui.html`.
- **Initial dimensions aligned (`src/ui/renderer.js`)**: `openPopover` calls
  now pass the per-kind defaults (menu 280×542, permissions 316×388,
  screenshot 224×86, downloads 316×220, shield 312×318, tab-context 224×214)
  so the first paint matches the measured layout.
- **In-scope extras**: live window-resize re-clamping for open popovers
  (popovers.js); ArrowUp/ArrowDown keyboard navigation extended from
  tab-context/bookmark-folder to the 3-dot menu and screenshot popover
  (popover.html).
- **Not popovers (deliberately unchanged)**: the Find bar (in-page 38px bar,
  not a floating view), the Downloads page (full internal tab page, inherits
  the hardened global scrollbars), and the left/right chrome drawers (docked
  in-page panels; only their scroll CSS was hardened).

### Tested
- **Syntax checks (`node --check`)**: passed on `src/main/popovers.js`,
  `src/ui/renderer.js`, and the inline script extracted from
  `src/ui/popover.html`; also passed on the prepared `p2-1e-verify.js`.
- **Smoke test**: `timeout 25 xvfb-run -a npm start` stayed up for 25s,
  exit code 124 (log: `p2-1e-smoke.log`; dbus/SSL lines are benign VM noise).
- **No live/visual/CDP feature testing in this step** (Margaret's rule):
  all popover fit/scrollbar/border checks are deferred to the Phase I end
  pass — a prepared driver `p2-1e-verify.js` (12 checks: fit + no-scrollbar
  + no-clipped-last-item per popover kind, themed-scrollbar rules, long-list
  scrolling, window-resize re-clamp, extension-popup size stability, console
  errors) plus screenshots is ready in the upgrade dir.

### Known limitations
- **Windows native-scrollbar elimination is verified structurally here, not
  visually**: native Windows scrollbars cannot be reproduced under Linux
  Xvfb. The themed-scrollbar rules, `overflow-x: hidden`, and
  content-measured bounds are in place; Margaret confirms on Windows that no
  white native scrollbar appears in any popover or chrome surface.
- **Extension popup internals are extension-owned**: if an extension's own
  popup HTML forces its own scrollbars, the browser cannot theme them
  without injecting CSS (deliberately not done — it could break extension
  layouts). The popup's outer sizing is correct; inner scrollbars depend on
  the extension.
- **Measured-size cache is per-session and keyed by kind** (bookmark-folder
  also by folder + item count, extensions-dropdown by row count, downloads
  never cached): a popover whose content changes size without a kind/payload
  change re-measures on open via the MutationObserver path, but the first
  paint may briefly show the cached size before correcting.

## Phase 2 — P2-1f (Fullscreen Video & Window Fullscreen Fix)

### Changed
- **Fullscreen Main-Process Engine (`src/main/fullscreen.js`)**:
  - Added per-window fullscreen state (`ctx.fullscreen = { active, html, view, webContents, source, tabId, serviceKey, savedPanel, savedViewBounds, savedChildOrder, entering, exiting }`) via `createFullscreenState()` and `ensureFullscreenState(ctx)`.
  - Registered a one-time `app.on('web-contents-created')` listener (`initFullscreenListeners()`) that attaches `enter-html-full-screen`, `leave-html-full-screen`, `before-input-event` (deferred `Escape` exit fallback), and `destroyed` listeners to every created `webContents`, lazily resolving the owning window `ctx` at event time via `webContentsToWinId` + `windowContexts` and ignoring unmapped `webContents` (e.g. DevTools) as well as non-content views (`win.webContents`, `popoverView`, `screenshotView`).
  - Supported HTML fullscreen requests (`requestFullscreen`) originating from both active tab `WebContentsView`s (`source: 'tab'`) and sidebar overlay panel service `WebContentsView`s (`source: 'sidebar'`, resolved via `findSidebarServiceByWebContents(ctx, wc)`), plus generic child views in `win.contentView.children`.
  - Supported F11 / OS window fullscreen (`handleWindowEnterFullScreen` / `handleWindowLeaveFullScreen`), converging with HTML fullscreen on the same `enterFullscreen` / `exitFullscreen` state machine and wrapping `win.setFullScreen` / `win.isFullScreen` alongside `win.on('enter-full-screen')` / `win.on('leave-full-screen')` so fullscreen toggling remains consistent both under window managers and in headless/WM-less X11 sessions.
  - Handled the `Escape` shortcut trap without modifying `src/main/shortcuts.js`: on fullscreen enter, records exact prior sidebar panel state (`savedPanel = { open, pinned, activeKey }`), closes any open popover via `closePopover(ctx)`, and closes any open sidebar panel via `closeSidebarPanel(ctx, { restoreFocus: false })` so `shortcuts.js` never intercepts `Escape` with `event.preventDefault()`. When the fullscreen target is a sidebar panel view, `ctx.fullscreen.active` is set beforehand so `updateActiveViewBounds(ctx)` keeps that panel view expanded at full window bounds rather than parking it.
  - Handled F11-during-HTML-fullscreen (and HTML-fullscreen-during-F11) idempotently: exiting window fullscreen while HTML fullscreen is active executes `document.exitFullscreen()` (with `webkitExitFullscreen` fallback, wrapped in `try/catch`) on the fullscreen `webContents`, and exiting HTML fullscreen calls `win.setFullScreen(false)`, restoring prior child view bounds/order, restoring `savedPanel` (`setSidebarPinned` + `openSidebarPanel`), updating view bounds, and restoring focus via `restoreFocusToActiveTab(ctx)`.
- **Generic Fullscreen View Layout & Tab-Switch Guard (`src/main/layout.js`)**:
  - Updated `updateActiveViewBounds(ctx)` to branch first on `ctx.fullscreen && ctx.fullscreen.active`.
  - Added a tab-switch / invalid-view guard (`shouldExitFullscreenOnLayout(ctx)`): if the active tab changed mid-fullscreen (e.g. `Ctrl+T`, `switchTab`, or tab close) or the fullscreen view was destroyed/slept, `updateActiveViewBounds(ctx)` exits fullscreen cleanly first (`exitFullscreen(ctx, { skipLayout: true })`) and then falls through to normal layout.
  - Implemented `applyFullscreenBounds(ctx)` generically by enumerating `win.contentView.children` (plus managed tab, sidebar panel, popover, and screenshot views), parking all non-fullscreen child views offscreen at `{ x: -5000, y: -5000, width: 1, height: 1 }`, expanding the fullscreen view to `{ x: 0, y: 0, width: contentWidth, height: contentHeight }`, and bringing the fullscreen view to the front last (`win.contentView.addChildView(fsView)`) so it completely covers the window's chrome `webContents`.
  - Guarded `bringOverlaysToFront(ctx)` while fullscreen is active so overlays are never stacked above the fullscreen content view.
- **Window Fullscreen Wiring (`src/main/windows.js`)**:
  - Initialized `ctx.fullscreen = createFullscreenState()`, called `initFullscreenListeners()` and `attachWindowFullscreenHandlers(ctx)` during `createBrowserWindow`, and wired `cleanupWindowFullscreen(ctx)` on window `closed`.

### Tested
- **Syntax checks (`node --check`)**: Passed on `src/main/fullscreen.js`, `src/main/layout.js`, and `src/main/windows.js`.
- **Smoke test**: `HOME=/tmp/nextgx-smoke-p2-1f timeout 25 xvfb-run -a npm start` stayed up cleanly for 25s with exit code `124`.

### Known limitations
- **No live/visual/CDP feature testing in this step**: Per P2-1f instructions, only `node --check` on changed/new JS files and the 25s `xvfb-run` startup smoke test were executed here; all live and interactive feature verification is deferred to the worker verification pass and Phase I end pass.

## Phase 2 — P2-1d: Extensions toolbar dropdown + popup support (2026-11-21)

Implements Margaret's requirement item 2 (extensions dropdown & popup support,
e.g. Bitwarden). The puzzle toolbar icon now opens a themed Extensions dropdown
instead of jumping straight to `nextgx://extensions`, and extension action
popups open in a floating view attached to the default session.

### Changed
- **Extensions dropdown popover** (`extensions-dropdown` kind): clicking the
  puzzle toolbar icon opens a themed dropdown listing installed extensions
  (icon + name + version, `Disabled` pill for disabled ones). Rows with a
  popup open it on click; rows without one show a "This extension has no
  popup" toast. Each row has a pin-to-toolbar toggle; a "Manage Extensions"
  footer button opens `nextgx://extensions`. Empty state when nothing is
  installed. Dropdown data is built main-side in `popovers.js` via
  `getExtensionsDropdownData()` (no new preload bridges); height auto-sizes
  from the row count (140–480px) with the existing `fitPopoverToView` pattern.
- **Extension popup view** (new `src/main/extension-popup.js`): opens an
  extension's `action.default_popup` / `browser_action.default_popup` at
  `chrome-extension://<id>/<popup>` in a floating `WebContentsView` on the
  default session. Default size 360×520, anchored top-right under the toolbar
  (right-aligned with the dropdown when opened from it); after load the popup
  document is measured and the view resized within 280–420 × 200–600 clamps
  (and window bounds). Closes on outside-click (view blur, 200ms open guard),
  Esc (`before-input-event`), window blur, any regular popover open/close,
  and when its extension is disabled/reloaded/removed. Refuses to open in
  Private windows with a toast ("Extensions do not run in Private windows").
- **Pin to toolbar**: pinned extension icons render next to the puzzle icon
  (`#pinnedExtensions` in the toolbar). Left-click opens the popup;
  right-click unpins. Pinned state persists in
  `settings.pinnedExtensions` (`[{id, name, iconDataUrl, hasPopup}]`), read
  by the renderer via the existing settings bridge at startup and on
  `settings:update`; entries are pruned when an extension is removed and
  refreshed opportunistically when dropdown data is built.
- **Manifest helpers** (new `src/main/extension-manifest.js`, no Electron
  dependency, unit-testable from plain node): resolves `default_popup` (MV3
  `action` / MV2 `browser_action`, path-traversal-safe) and extension icons
  (largest icon ≤48px, else smallest available; `default_icon` fallback;
  ≤200KB, base64 data URL). Popup file existence on disk is verified before
  `hasPopup` is reported.
- **Extensions page note**: `#extCompatibilityNotice` banner on
  `nextgx://extensions` documents what works (unpacked MV2/MV3, toolbar
  action popups, content scripts, background service workers, storage) vs
  Electron's native limits (`contextMenus`, `sidePanel`, `webNavigation`,
  `notifications`, `privacy` unavailable; theme extensions don't restyle the
  custom UI; extensions don't load in Private windows).
- Warnings for unsupported Chrome extension permissions remain non-fatal
  (`captureExtensionLoadWarnings` untouched).
- Dropdown actions reuse the existing `menu:action` channel
  (`extension-pin:<id>`, `extension-unpin:<id>`, `extension-popup:<id>`);
  pin/unpin refresh the open dropdown in place without closing it.

### Files
- Modified: `src/main/extensions.js` (+167/−5), `src/main/ipc.js` (+52/−1),
  `src/main/popovers.js` (+36/−9), `src/ui/popover.html` (+353/−2),
  `src/ui/renderer.js` (+59/−1), `src/ui/chrome-webui.js` (+11),
  `src/ui/index.html` (+3/−1), `src/ui/styles.css` (+14/−4).
- New: `src/main/extension-manifest.js` (+154), `src/main/extension-popup.js`
  (+252).
- Test fixture (NOT shipped in the repo):
  `nextgxbrowser-upgrade/p2-1d-test-extension/` — minimal MV3 extension with
  a 320×240 `default_popup` (`popup.html`, `#p2-1d-popup-marker` =
  `P2-1D-POPUP-READY`) + `p2-1d-popup-check.js` pure-node check.

### Tested (per-step gate only — syntax + smoke; NO live/visual testing per
Margaret's ~19:12 rule; all feature verification deferred to the Phase I end
pass via `p2-1d-verify.js`)
- `node --check` clean on all 7 changed/new JS files + the inline script in
  `src/ui/popover.html` (extracted and checked).
- Pure-node check `p2-1d-popup-check.js`: 7/7 PASS (popup resolution MV3/MV2,
  icon data-URL resolution + fallbacks, missing-file handling).
- Smoke test (isolated profile `HOME=/tmp/nextgx-smoke-p2-1d`,
  `timeout 25 xvfb-run -a npm start`): exit 124 (app stayed up 25s), no JS
  errors in the log; only known benign VM noise (D-Bus, safeStorage, SSL
  egress-proxy handshake errors).

### Known limitations
- The popup view measures its size once after `did-finish-load`; a popup that
  dynamically resizes its DOM long after load is not re-measured.
- Electron-unsupported extension APIs (`chrome.contextMenus`,
  `chrome.sidePanel`, `chrome.webNavigation`, `chrome.notifications`,
  `chrome.privacy`) remain unavailable — documented, not faked.
- Pinned-extension metadata (name/icon) refreshes opportunistically when the
  dropdown list is built; a changed icon may show stale until the dropdown is
  next opened.
- No live verification yet: dropdown open/toggle, popup open/close, pin/unpin
  + restart persistence, Manage Extensions link, and the Private-window guard
  all await the Phase I end pass (`p2-1d-verify.js` + manual steps for a real
  extension such as Bitwarden).

## Phase 2 — P2-1c (Sidebar Overlay Panel & GX Left Rail)

### Changed
- **Sidebar Overlay Panel Main-Process Engine (`src/main/sidebar.js`, `src/main/core.js`, `src/main/windows.js`)**:
  - Replaced the Phase 1 "every sidebar click opens a new tab" behavior with an Opera GX-style slide-out left overlay panel backed by per-window `ctx.sidebarPanel` state (`views: Map(serviceKey -> WebContentsView)`, `meta: Map`, `activeKey`, `open`, `pinned`, `width`).
  - Added shared panel layout constants (`SIDEBAR_PANEL_HEADER_HEIGHT = 44`, `SIDEBAR_PANEL_DEFAULT_WIDTH = 380`, `SIDEBAR_PANEL_MIN_WIDTH = 320`, `SIDEBAR_PANEL_MAX_WIDTH = 640`) in `src/main/core.js`.
  - Implemented lazy per-service `WebContentsView` creation bound to `ctx.session` (so normal windows use `defaultSession` and Private windows use their isolated ephemeral `incognito-*` partition — never mixing sessions across windows), reusing the tab `webPreferences` pattern (`TAB_PRELOAD_FILE`, `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `plugins: true`, Electron UA token strip, ad-blocker attach + cosmetic filter injection, `forceDarkWeb` CSS injection, `setWindowOpenHandler` opening external `http(s)` links in a new browser tab, and `did-fail-load` rendering the themed `error.html` page via `navigation.js` helpers).
  - Kept created service views alive across panel collapse and service switching (parking inactive/hidden views offscreen at `x: -5000, y: -5000, width: 1, height: 1` without destroying or re-navigating them) so background media playback (e.g. YouTube Music), scroll position, and login state persist when switching services or collapsing the panel.
  - Added focus management: opening or switching a sidebar service focuses the active panel `WebContentsView`; collapsing the panel restores focus to the active tab via `restoreFocusToActiveTab(ctx)`.
  - Cleaned up `webContentsToWinId` entries for panel views on window close (`cleanupSidebarPanelViews(ctx)`), without persisting panel views into `session.json`.
- **Panel View Bounds & Overlay Z-Order (`src/main/layout.js`, `src/main/broadcast.js`)**:
  - Extended `updateActiveViewBounds(ctx)` in `src/main/layout.js` to position the active sidebar panel view at `x = SIDEBAR_ICON_WIDTH` (`50`), `y = top + SIDEBAR_PANEL_HEADER_HEIGHT` (`top + 44`), `width = panelWidth` (clamped `320`–`640`), `height = contentHeight - (top + 44) - bottomOffset`, while parking all inactive/collapsed panel views offscreen (`-5000, -5000, 1, 1`).
  - When the open sidebar panel is **pinned**, `effectiveTabLeft` shifts to `SIDEBAR_ICON_WIDTH + panelWidth` so the active tab shrinks beside the docked panel; when **unpinned**, `effectiveTabLeft` stays at `SIDEBAR_ICON_WIDTH` so the panel floats over the active tab.
  - Registered the active panel view in `bringOverlaysToFront(ctx)` after tab views and before `popoverView` and `screenshotView` (`tabs < panel < popover < screenshot`), providing forward-compatible view/layout management for P2-1f.
  - Included sidebar panel `webContents` in `getAllTabWebContents()` (for live ad-block cosmetic filter sync) and `broadcastSettingsUpdate()` (for live theme updates on error pages rendered inside the panel).
- **Panel Header DOM, Drag-to-Resize & GX Left Rail (`src/ui/index.html`, `src/ui/renderer.js`, `src/ui/styles.css`)**:
  - Added `#sidebarPanel` (`<section class="nx-sidebar-panel hidden">`) in `src/ui/index.html` with a 44px header (`#sidebarPanelHeader`: service icon `#sidebarPanelIcon`, title `#sidebarPanelTitle`, Pin/Unpin toggle `#btnSidebarPin`, Reload `#btnSidebarReload`, "Open in new tab" `#btnSidebarOpenTab`, Close `#btnSidebarClose`) and a right-edge drag handle (`#sidebarPanelResizer`).
  - Wired all 14 `[data-service-url]` rail buttons in `src/ui/renderer.js` to toggle the sidebar overlay panel instead of opening new tabs, applying the `.active` indicator (theme-token accent bar + `nxActiveRailGlow`) to the open service button and a subtle `.audible` theme-token dot when a panel service is playing audio, while preserving Customize Dock (`applySidebarVisibility` / `sidebarItems`) and auto-collapsing the panel if the currently open service is toggled off.
  - Made `#sidebarPanel` and `#leftToolDrawer` (`gxControl`, `gxCleaner`, `sidebarSetup`) mutually exclusive so opening one closes the other, and updated `syncLayoutOffsets()` to add the clamped panel width to `left` only when the panel is open and pinned.
  - Wired horizontal drag-to-resize on `#sidebarPanelResizer` (pointer and mouse events, live width clamping `320px`–`640px`, persisted to settings on release).
  - Styled `.nx-sidebar-panel` (floating overlay vs `.pinned` docked layout), header controls, spinning reload indicator, audio dot, and resize handle in `src/ui/styles.css` using only `src/ui/theme.css` CSS tokens (`var(--...)`) with zero hardcoded palette hex values.
- **IPC Channels, Preload Bridge, Settings & Escape Shortcut (`src/main/ipc.js`, `src/preload.js`, `src/storage.js`, `src/main/shortcuts.js`, `src/main.js`)**:
  - Registered 8 internal IPC channels in `src/main/ipc.js` (`sidebar:toggle`, `sidebar:open`, `sidebar:close`, `sidebar:set-pinned`, `sidebar:reload`, `sidebar:open-in-new-tab`, `sidebar:set-width`, `sidebar:get-state`) plus `sidebar:update` state pushes to the renderer, and routed `error.html` retry/back/home actions (`tabs:retry-failed`, `tabs:back`, `tabs:home`) to the originating sidebar panel view when triggered from inside a panel error page.
  - Exposed `toggleSidebarPanel`, `openSidebarPanel`, `closeSidebarPanel`, `setSidebarPinned`, `toggleSidebarPin`, `reloadSidebarPanel`, `openSidebarInNewTab`, `openSidebarPanelInNewTab`, `setSidebarWidth`, `getSidebarState`, and `onSidebarUpdate` on `window.gxAPI` in `src/preload.js`.
  - Added persisted `sidebarPanelWidth` (default `380`, clamped `320`–`640` on load and update) and `sidebarPanelPinned` (default `false`) in `src/storage.js`; panel always starts closed on launch.
  - Extended the `Escape` handler in `src/main/shortcuts.js` (wired via `configureShortcuts` in `src/main.js`) and the renderer keydown fallback in `src/ui/renderer.js` to collapse an open **unpinned** sidebar panel when no popover is open (popover close retains precedence; a **pinned** panel is unaffected by `Escape`).

### Tested
- **Syntax checks (`node --check`)**: Passed on `src/main.js`, `src/main/core.js`, `src/main/sidebar.js`, `src/main/layout.js`, `src/main/windows.js`, `src/main/shortcuts.js`, `src/main/broadcast.js`, `src/main/ipc.js`, `src/preload.js`, `src/storage.js`, and `src/ui/renderer.js`.
- **Smoke test**: `timeout 25 xvfb-run -a npm start` stayed up cleanly for 25s with exit code `124` and zero JS errors.

### Known limitations
- **Panel starts closed on launch**: `sidebarPanelWidth` (`320`–`640`, default `380`) and `sidebarPanelPinned` (default `false`) persist across restarts, while the panel itself intentionally starts closed on launch and views are created lazily on first service click.
- **No live/visual/CDP feature testing in this step**: Per P2-1c rules, only `node --check` on changed/new JS files and the 25s `xvfb-run` startup smoke test were executed; live interactive feature verification is deferred to the Phase I end pass.

---

## Phase 2 — P2-1b (Main-Process Modularization & Polish Bundle)

### Changed
- **Part A — Main-Process Refactor (`src/main.js` → `src/main/*.js`)**:
  - Split the monolithic `src/main.js` into a 77-line entry point (`src/main.js`) plus 17 focused modules under `src/main/` with zero IPC channel renames, zero settings-key changes, and zero storage format changes:
    - `src/main.js` (77 lines): root-only `--no-sandbox` and autoplay flags, `configureShortcuts` wiring, `app.whenReady()` startup sequence (`initCore`, ad blocker, permissions, downloads, cookies listener, orphan wallpaper sweep, extension restore, IPC registration, startup windows, `startBackgroundTimers`), and `before-quit` / `window-all-closed` hooks.
    - `src/main/core.js` (70 lines): shared chrome layout constants (`TOP_CHROME_HEIGHT`, `BOOKMARKS_BAR_HEIGHT`, `SIDEBAR_ICON_WIDTH`), `PRIVATE_WINDOW_TITLE`, internal UI/preload file paths and URLs, shared maps (`activeDownloadItems`, `windowContexts`, `webContentsToWinId`), mutable `state`, and `initCore`.
    - `src/main/utils.js` (189 lines): path safety/comparison helpers, internal UI URL/sender verification (`resolveInternalUiFile`, `isInternalUiSender`), download path confinement (`resolveSafeDownloadPath`), autofill host matching, internal/error URL classifiers, internal UI query param helpers, origin extraction, and file category detection.
    - `src/main/navigation.js` (109 lines): error-page URL/title helpers, address-bar display URL formatting (`formatDisplayUrl`), omnibox/search resolution (`resolveNavigateInput`), and configured homepage lookup (`getConfiguredHomepageUrl`).
    - `src/main/broadcast.js` (213 lines): sender-to-context resolution (`getCtxFromSender`), tab serialization (`serializeTabs`), state/adblock/history/downloads/settings/bookmarks broadcasts across windows, popovers, overlays, and internal tabs, plus `syncAdblockCosmeticFilters`.
    - `src/main/layout.js` (56 lines): overlay z-ordering (`bringOverlaysToFront`) and active tab / screenshot overlay bounds calculation (`updateActiveViewBounds`).
    - `src/main/wallpapers.js` (236 lines): custom wallpaper extension/magic-byte/size validation, safe path resolution, data-URL serving, save/remove handlers, best-effort deletion, and startup orphan sweep (`cleanupOrphanedWallpapers`).
    - `src/main/shortcuts.js` (103 lines): `configureShortcuts`, shared `applyZoomAction`, and `attachKeyboardShortcuts` (`before-input-event` keyboard shortcut dispatcher).
    - `src/main/popovers.js` (168 lines): popover `WebContentsView` creation (`ensurePopoverView`), focus restoration, and `openPopover` / `resizePopover` / `closePopover`.
    - `src/main/session.js` (219 lines): normal-window session URL sanitization, serialization, and debounced/immediate session persistence (`scheduleSessionSave`, `saveSessionNow`, `cancelScheduledSessionSave`).
    - `src/main/tabs.js` (721 lines): tab `WebContentsView` construction and event listeners (`buildWebContentsViewForTab`), create/wake/switch/sleep/close/close-others/duplicate/reorder/pin/reopen-closed, navigation, reload, and DevTools toggle.
    - `src/main/windows.js` (254 lines): per-session permission handlers (`setupPermissionsForSession`), `BrowserWindow` creation (`createBrowserWindow`, including private-window title enforcement and session restore), and `openStartupWindows`.
    - `src/main/downloads.js` (125 lines): `will-download` tracking with speed/ETA (`setupDownloadListener`) and download IPC handlers (`registerDownloadIpcHandlers`).
    - `src/main/cookies.js` (149 lines): debounced/immediate cookie update broadcasts, cookie domain/origin matching, and cookie IPC handlers (`registerCookieIpcHandlers`).
    - `src/main/extensions.js` (481 lines): unpacked extension path/manifest validation, `ExtensionLoadWarning` capture, managed extension CRUD/toggle/reload, startup restore (`restorePersistedExtensions`), and extension IPC handlers (`registerExtensionIpcHandlers`).
    - `src/main/screenshots.js` (39 lines): screenshot PNG save to Downloads, clipboard copy, download-history upsert, and toast notification (`saveScreenshotPng`).
    - `src/main/stats.js` (109 lines): CPU/RAM/tab-count telemetry (`collectSystemStats`) and background timers (`startBackgroundTimers`: 2.5s telemetry push and 20s idle tab hibernation sweep).
    - `src/main/ipc.js` (630 lines): `registerIpcHandlers` with `handleInternal` gating, `internal:get-page-kind`, `autofill:*`, and registration of all 92 main-process IPC channels.
- **Part B — Polish Bundle (`src/ui/renderer.js`, `src/main/core.js`, `src/ui/popover.html`, `src/ui/index.html`, `src/ui/chrome-webui.js`)**:
  - **Find-in-Page Match Counter (`src/ui/renderer.js`)**: Changed match counter format in `updateFindMatchCount` from `${active} of ${matches}` to `${active} / ${matches}` (e.g. `1 / 5`), preserving the `No results` and empty states.
  - **Zoom `Ctrl++` Verification & Tooltip (`src/main/shortcuts.js`, `src/ui/popover.html`, `src/ui/index.html`)**: Verified `attachKeyboardShortcuts` already handles real `Ctrl+Shift+=` (`Ctrl++`, matching `key === '+'` and `code === 'Equal'`) alongside `Ctrl+=`, `Ctrl+Numpad+`, `Ctrl+-`, `Ctrl+Numpad-`, and `Ctrl+0`, and verified `applyZoomAction` → `broadcastState` keeps `#zoomPct`, `popoverPayload`, and `#btnZoomReset` in sync (no handler change needed). Updated the Zoom In button tooltip to `Zoom In (Ctrl+= / Ctrl++)` in `src/ui/popover.html` (and kept dormant `#chromeMenuPanel` in `src/ui/index.html` in sync).
  - **Private Window OS Title (`src/main/core.js`, `src/ui/renderer.js`)**: Updated `PRIVATE_WINDOW_TITLE` in `src/main/core.js` and the incognito chrome `document.title` in `src/ui/renderer.js` from `nextGx Browser — Private` to `nextGx Private` without altering `Private Start` tab titles or other UI labels.
  - **3-Dot Menu & Chrome Shortcut Label Audit (`src/ui/popover.html`, `src/ui/index.html`, `src/ui/renderer.js`)**: Audited all 9 `<kbd>` labels and 4 zoom-row tooltips in `#view-menu` (`src/ui/popover.html`), the dormant `#chromeMenuPanel` (`src/ui/index.html`), and chrome toolbar/tab tooltips (`src/ui/index.html`, `src/ui/renderer.js`) against `attachKeyboardShortcuts` in `src/main/shortcuts.js`. Confirmed every `<kbd>` matches an actual handler, items without shortcuts show no `<kbd>`, and aligned the Zoom In button tooltip (`Ctrl+= / Ctrl++`).
  - **Automatic Idle Tab Hibernation (`src/ui/chrome-webui.js`, verified across `src/main.js`, `src/main/stats.js`, `src/main/tabs.js`, `src/ui/renderer.js`, `src/storage.js`)**: Verified `startBackgroundTimers` is invoked from `src/main.js` on startup, runs every 20s using `autoSleepEnabled` (default `true`) and `autoSleepMinutes` (default `10`), and skips active, pinned, and audible tabs while keeping manual Hibernate unchanged. Added the missing idle-delay segmented control (`2m` / `5m` / `10m` / `20m`, `#setAutoSleepMinsSeg`) to `nextgx://settings` in `src/ui/chrome-webui.js`, persisted via `settings:update` and kept in live two-way sync with the GX Control drawer (`#autoSleepSegments`) via `onSettingsUpdate`.

### Tested
- **Syntax checks (`node --check`)**: Passed on `src/main.js`, all 17 modules under `src/main/*.js`, `src/ui/renderer.js`, `src/ui/chrome-webui.js`, `src/storage.js`, `src/preload.js`, `src/tab-preload.js`, plus inline `<script>` syntax validation on `src/ui/popover.html`.
- **IPC channel audit**: Verified 92/92 main-process IPC channels match `HEAD:src/main.js` exactly (0 missing, 0 extra) and all 92 channels invoked by `src/preload.js` + `src/tab-preload.js` are registered.
- **Grep verification**: Confirmed ` of ${matches}` and `nextGx Browser — Private` are removed from `src/`, `nextGx Private` is set for the private window title, and all `#view-menu` `<kbd>` labels and zoom-row titles match `src/main/shortcuts.js`.
- **Headless Electron functional script (`xvfb-run`, temp `userData`)**: Verified real `sendInputEvent` for `Ctrl++` (`Ctrl+Shift+=`), `Ctrl+=`, `Ctrl+-`, and `Ctrl+0` updates tab zoom and syncs popover state; verified private window `win.getTitle()` and `document.title` stay `nextGx Private`; verified `startBackgroundTimers` auto-sleep timer skips active/pinned/audible/fresh tabs, respects `autoSleepEnabled: false`, and hibernates idle background tabs; verified two-way `autoSleepMinutes` persistence/sync between `nextgx://settings` (`#setAutoSleepMinsSeg`) and GX Control (`#autoSleepSegments`); verified `updateFindMatchCount` outputs `1 / 5` and preserves `No results`.
- **Smoke test**: `timeout 25 xvfb-run -a npm start` stayed up cleanly for 25s with exit code `124` and zero JS errors (only benign headless VM D-Bus / `safeStorage` / NSS log noise).

### Known limitations
- **No live visual / interactive verification in this run**: Visual layout, native OS taskbar title rendering, and interactive end-to-end visual checks remain to be verified live separately.
- **Idle hibernation polling granularity**: Automatic idle hibernation checks run on a 20-second interval in `src/main/stats.js`, so an idle background tab hibernates within up to ~20s after reaching the configured `autoSleepMinutes` threshold.

---

## Phase 2 — P2-1 (GX Design System v2)

### Changed
- **Four New Accent Themes — 8 Total (`src/ui/theme.css`, `src/ui/index.html`, `src/ui/styles.css`, `src/ui/chrome-webui.html`, `src/ui/chrome-webui.js`, `src/storage.js`)**:
  - Added `magenta`, `amber`, `lime`, and `ice` themes in `src/ui/theme.css` with full token parity (`--nx-accent`, `--nx-accent-bright`, `--nx-accent-soft`, `--nx-grid-line`, `--nx-on-accent`, `--bg-deep`, `--bg-chrome`, `--bg-surface`, `--bg-elevated`, `--nx-wallpaper`) plus matching `:root` swatch tokens (`--nx-swatch-magenta`, `--nx-swatch-amber`, `--nx-swatch-lime`, `--nx-swatch-ice`).
  - Added all four themes to the Control Center theme grid (`src/ui/index.html`, `src/ui/styles.css`), the Settings theme selector (`src/ui/chrome-webui.js`, `src/ui/chrome-webui.html` with wrapped segmented layout and `.theme-dot` classes), and updated the `settings.theme` comment in `src/storage.js` (confirmed no theme allowlist exists in `main.js`/`storage.js`).
- **New Tab Wallpaper System (`src/ui/theme.css`, `src/ui/newtab.html`, `src/main.js`, `src/tab-preload.js`, `src/storage.js`)**:
  - Defined 8 CSS gradient preset tokens (`--nx-wallpaper-*`), `--nx-wallpaper-overlay` readability scrim, and `--nx-wallpaper-blur` in `src/ui/theme.css`, with `--nx-wallpaper` following the active accent theme by default.
  - Added a "Wallpaper" customize button and slide-in panel on `src/ui/newtab.html` (hidden in Private mode) with 8 accent gradient presets + "Match theme" auto mode, custom image upload (`png`/`jpg`/`jpeg`/`webp`/`gif`, max 5 MB), and "None / Default Grid".
  - Added main-process validation (extension + image magic-byte inspection + 5 MB cap), safe storage under `<userData>/wallpapers/`, data-URL serving without exposing arbitrary filesystem access (`newtab:save-wallpaper`, `newtab:remove-wallpaper`, `newtab:get-wallpaper-image` via `handleInternal`), `gxNewTabAPI` bridge methods in `src/tab-preload.js`, and persisted `settings.wallpaper` defaults/sanitization in `src/storage.js`.
  - Added a designed empty state (`error.html` pattern) in the custom wallpaper area when no custom image is set ("No custom wallpaper yet — choose an image to personalize your start page" + "Choose image" action).
  - Added orphaned custom wallpaper file cleanup in `src/main.js`: `settings:update` deletes the previously referenced file best-effort (via `resolveSafeWallpaperPath()`) whenever `settings.wallpaper.file` is cleared or changed, and a startup sweep deletes unreferenced `wallpaper-*` image files from `<userData>/wallpapers/` without touching the active wallpaper or non-managed files.
- **Typography & Motion Tokens (`src/ui/theme.css`, `src/ui/styles.css`, `src/ui/newtab.html`, `src/ui/chrome-webui.html`, `src/ui/popover.html`, `src/ui/error.html`)**:
  - Added `--nx-font-mono` (`'JetBrains Mono', 'Cascadia Code', ui-monospace, 'SF Mono', Menlo, Consolas, monospace`) and `.nx-mono`, wired to stat/telemetry numerals (`.bento-val`, `.shield-capsule span`, `.nx-find-count`, `.shield-stat-val`, `.zoom-pct`, `.stat-num`, `#setSoundsVolumeVal`, `.error-code-pill`, `.error-url-value`) while keeping `.nx-heading` / `--nx-font-display` consistent on panel and section headings.
  - Added `--nx-motion-fast` (`150ms`), `--nx-motion-base` (`180ms`), and `--nx-motion-ease` (`cubic-bezier(0.22, 1, 0.36, 1)`), converting straightforward UI transitions and adding subtle drawer/panel slide-in motion.
  - Added a gentle `nxActiveRailGlow` keyframe applied exclusively to `.sidebar-btn.active`, and added a global `@media (prefers-reduced-motion: reduce)` rule in `src/ui/theme.css` disabling animations and transitions.
- **GX Sounds Wiring & Sounds-Off Empty State (`src/ui/sounds.js`, `src/ui/renderer.js`, `src/ui/chrome-webui.html`, `src/ui/chrome-webui.js`, `src/storage.js`)**:
  - Added `GXSoundEngine.playNotification()` in `src/ui/sounds.js` and hooked it into the chrome toast/notification flow (`showToast` / `ui:toast` in `src/ui/renderer.js`, keeping screenshot toasts on `playShutter()` without double-playing).
  - Replaced the bare sounds checkbox in `nextgx://settings` with a `GX default` / `Off` segmented control, a 0–100% volume slider wired to `settings.uiSoundsVolume` that live-updates `window.gxSounds` via `setConfig` across both Settings and the chrome window, and a designed sounds-off empty state ("Sounds are off — turn them on to hear GX sounds" + "Turn on GX sounds" action with the slider disabled).
  - Applied saved sound config at startup in `chrome-webui.js` (alongside existing startup sync in `renderer.js`) with zero autoplay on launch.
- **Global Themed Scrollbars (`src/ui/theme.css`, `src/ui/popover.html`)**:
  - Added global themed scrollbar tokens (`--nx-scrollbar-thumb`, `--nx-scrollbar-thumb-hover`, `--nx-scrollbar-track`), `color-scheme: dark`, standard `scrollbar-width: thin; scrollbar-color: ...`, and `::-webkit-scrollbar*` rules in `src/ui/theme.css` and locally in `src/ui/popover.html` without altering overflow behavior or popover sizing.

### Tested
- Syntax checks: `node --check src/main.js src/storage.js src/tab-preload.js src/ui/sounds.js src/ui/renderer.js src/ui/chrome-webui.js` and inline `<script>` parsing on `src/ui/newtab.html`, `src/ui/popover.html`, and `src/ui/error.html` passed.
- Diff hex audit: verified zero hardcoded palette hex literals in new code outside `src/ui/theme.css` token definitions.
- Smoke test: `timeout 25 xvfb-run -a npm start` stayed up cleanly for 25s (exit 124, no crashes or JS errors).
- Live headless Electron verification (`xvfb-run` + CDP against an isolated temp `userData` directory, across two launches to verify restart persistence) passed 46 assertions covering:
  - All 8 themes in Control Center and `nextgx://settings`, full token propagation, and persistence across restart.
  - Default theme-following gradient wallpaper, explicit preset selection, "None / Default Grid", custom PNG upload into `<userData>/wallpapers/`, magic-byte / extension / >5 MB validation rejections, data-URL rendering across restart, and custom wallpaper removal restoring the empty state and deleting the file.
  - Typography/motion tokens, mono stat numerals, `nxActiveRailGlow` isolated to `.sidebar-btn.active`, and `prefers-reduced-motion` rule presence.
  - Zero autoplay (`AudioContext` remains `null` on launch and restart), `playNotification()` on toast, Settings `GX default`/`Off` + volume slider live sync to chrome (`renderer.js`), and sounds-off empty state + disabled slider.
  - Global `scrollbar-width: thin` and `::-webkit-scrollbar` coverage across chrome UI and `popover.html` while preserving `scrollbar-width: none` on the tab strip.

### Known limitations
- **Windows native scrollbars under Linux Xvfb**: Native Windows scrollbar rendering cannot be reproduced directly under Linux Xvfb; scrollbar theming was verified via CSS rule coverage, computed `scrollbar-width` / `scrollbar-color` / `::-webkit-scrollbar` styles, and headless Chromium checks.
- **Audio playback in headless Xvfb**: Web Audio synthesis (`playNotification`, `playClick`, volume scaling) was verified structurally and via `GXSoundEngine` state/spies in headless Electron, without physical audio hardware listening.
- **System display/mono fonts**: `--nx-font-display` (`Rajdhani`, `Orbitron`) and `--nx-font-mono` (`JetBrains Mono`, `Cascadia Code`) use system-installed fonts with clean system fallbacks (`Segoe UI`/`Inter`/`sans-serif` and `ui-monospace`/`Menlo`/`Consolas`/`monospace`) — no external font fetches are performed.

---

## Phase 2 — P2-0 (Cosmetic Gap Fixes)

### Changed
- **Find Bar Match Count (`src/main.js`, `src/preload.js`, `src/ui/index.html`, `src/ui/styles.css`, `src/ui/renderer.js`)**:
  - Wired `webContents` `found-in-page` events in `src/main.js` through `find:result` IPC (`window.gxAPI.onFindResult` in `src/preload.js`) with active-tab and `requestId` filtering.
  - Fixed `tabs:find` in `src/main.js` to pass `findNext: false` (Electron 45 suppresses `found-in-page` when `findNext: true` is sent on a new query) and cleared `lastFindRequestId` / active find highlights on `tabs:stop-find` and tab switches.
  - Added `#findMatchCount` (`<span class="nx-find-count">`) next to `#findInput` in `src/ui/index.html`, styled with `theme.css` tokens (`--text-muted`, `--text-main`, `--danger`), displaying live `"X of Y"` counts while typing and navigating (`Enter` / `Shift+Enter` / Prev / Next), `"No results"` when there are zero matches, and empty when cleared or closed.
- **Zoom Reset Button & Keyboard Shortcuts (`src/main.js`, `src/ui/popover.html`, `src/ui/index.html`, `src/ui/styles.css`, `src/ui/renderer.js`)**:
  - Extracted shared `applyZoomAction(ctx, action, { notifyToast })` in `src/main.js` preserving the `0.1` step size (`30%`–`300%`, reset to `100%`) and keeping the open menu popover synced via `state:update`.
  - Added a `Reset` button (`#btnZoomReset`) to the zoom control row in `src/ui/popover.html` (and kept the dormant `#chromeMenuPanel` in `src/ui/index.html` in sync).
  - Added `Ctrl+0` (reset to `100%`), `Ctrl+=` / `Ctrl++` / `Ctrl+Numpad+` (zoom in), and `Ctrl+-` / `Ctrl+Numpad-` (zoom out) in `attachKeyboardShortcuts` (`before-input-event`) so they work with page focus, chrome focus, or popover focus and reflect immediately in the zoom UI display.
- **Menu Labels (`src/ui/popover.html`, `src/ui/index.html`, `src/main.js`, `src/ui/renderer.js`)**:
  - Split the mislabeled `Bookmarks Manager Ctrl+D` entry into `Bookmark this page` (`Ctrl+D`, wired to `bookmark-current` with toast confirmation) and `Bookmarks Manager` (no misleading shortcut hint).
  - Relabeled `New Private Tab` to `New Private Window` (keeping `Ctrl+Shift+N`) in both `src/ui/popover.html` and `src/ui/index.html`, and adjusted menu popover dimensions (`278×548`) so all items and the zoom Reset control fit cleanly.
- **Private Window OS Title (`src/main.js`, `src/ui/renderer.js`)**:
  - Set private windows' OS title to `"nextGx Browser — Private"` at creation, updated `document.title` when `incognito=1`, and prevented/re-asserted on `page-title-updated` and `did-finish-load` so the private window title stays `"nextGx Browser — Private"` regardless of page or tab titles. Normal window title behavior (`"nextGx Browser"`) is unchanged.
- **Tab Drag-and-Drop Edge Cases (`src/ui/renderer.js`, `src/ui/styles.css`)**:
  - Fixed the drop dead zone immediately left of a tab's close button (and across the close button / right edge): added `dragenter` cancellation alongside `dragover` on `.nx-tab`, `tabsContainer`, and `tabsStrip`, disabled child pointer events (`.nx-titlebar.is-tab-dragging .nx-tab *`) during active tab drags so crossing child boundaries (`.tab-title` → 6px gap → `.tab-close-btn` → `<svg>`) no longer fires uncanceled `dragenter` / spurious `dragleave`, and ignored internal child transitions in `dragleave`.
  - Added `dragenter` / `dragover` / `dragleave` / `drop` handlers (plus `.drop-target` highlight using `theme.css` tokens) on `#btnNewTab` (`+` button) so dropping a tab onto `+` appends it to the end of the tab strip.

### Tested
- Syntax checks: `node --check src/main.js src/preload.js src/ui/renderer.js` passed.
- Live headless end-to-end Electron verification (`xvfb-run`) against an isolated temp `userData` directory verified all 5 fixes:
  - Find bar: `Ctrl+F` from focused page, live `"1 of 4"` count on typing, `Enter` / `Shift+Enter` / Next / Prev navigation, `"No results"` state, and clear-on-empty.
  - Zoom: `Ctrl+=`, `Ctrl++`, `Ctrl+Numpad+`, `Ctrl+-`, `Ctrl+Numpad-`, `Ctrl+0` from focused views, live `#zoomPct` sync in the menu popover, and `#btnZoomReset` button click resetting `120%` → `100%`.
  - Menu labels: verified `New Private Window` (`Ctrl+Shift+N`), `Bookmark this page` (`Ctrl+D`), and `Bookmarks Manager` (no shortcut) in both `popover.html` and `index.html`.
  - Private window OS title: opened via `Ctrl+Shift+N`, verified `win.getTitle()` and `document.title` stay `"nextGx Browser — Private"` after tab navigation and attempted `document.title` override, while normal window remains `"nextGx Browser"`.
  - Tab DnD via CDP mouse drags: drop 3px left of close button (`[A,B,C] → [B,A,C]`), drop on close button (`[B,A,C] → [A,B,C]`), drop on `+` button (`[A,B,C] → [B,C,A]`), reverse drag (`[B,C,A] → [A,B,C]`), cleanup of `is-tab-dragging`, and post-drag close-button click.
- Smoke test: `timeout 25 xvfb-run -a npm start` stayed up cleanly for 25s (exit 124, no crash).

### Known limitations
- **Frameless OS title display**: Because `BrowserWindow` uses `frame: false` with a custom titlebar, the OS window title (`"nextGx Browser — Private"`) is surfaced in the OS taskbar, window switcher (Alt+Tab), and window manager metadata rather than a native OS title bar; actual native window-manager rendering was verified via Electron's `win.getTitle()` under Xvfb rather than a full desktop compositor.
- **Tab DnD on titlebar drag spacer**: Dropping a tab onto the empty `.nx-window-drag-spacer` past the `+` button still cancels the drag (only the tab strip and `+` button act as drop targets).
- **Zoom persistence**: Per-tab zoom applies to the active session's tab `webContents` (not persisted across app restarts or hibernated tab wakes).

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
