const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// Fix2-shell: Step 2 shell-UI fixes (market-audit-2 A1/A2/A7 + prior P1/P2s).
// Mostly source assertions — the shell renderer runs inside Electron, so
// these pin the code paths instead of driving a live window.

test('A1: profile modal dismisses with Escape (capture-phase document listener) and the x button', () => {
  const renderer = read('src/ui/renderer.js');
  // Capture-phase document keydown: closes the modal even when the
  // backdrop's own keydown listener never sees the event.
  assert.match(
    renderer,
    /document\.addEventListener\('keydown', \(e\) => \{\s*if \(e\.key === 'Escape' && profileModalOpen\)/,
    'no capture-phase Escape handler for the profile modal'
  );
  // Keyup fallback for a keydown that never reached the renderer.
  assert.match(
    renderer,
    /document\.addEventListener\('keyup', \(e\) => \{\s*if \(e\.key === 'Escape' && profileModalOpen\)/,
    'no keyup Escape fallback for the profile modal'
  );
  // Delegated x-button click on the backdrop, in addition to the direct
  // btnProfileModalClose listener.
  assert.match(renderer, /closest\('#btnProfileModalClose'\)/, 'no delegated x-button close');
  assert.match(
    renderer,
    /document\.getElementById\('btnProfileModalClose'\)\?\.addEventListener\('click', closeProfileModal\)/,
    'direct x-button listener missing'
  );
  // Backdrop click still dismisses.
  assert.match(
    renderer,
    /if \(e\.target === profileModalBackdrop\) closeProfileModal\(\);/,
    'backdrop-click dismiss missing'
  );
  // Focus fallback in openProfileModal: if the name input did not take
  // focus, fall back to the modal element itself.
  const openFn = renderer.match(/function openProfileModal\(\) \{[\s\S]*?\n\}/);
  assert.ok(openFn, 'openProfileModal not found');
  assert.ok(
    openFn[0].includes("document.activeElement !== profileModalName"),
    'openProfileModal has no focus fallback'
  );
  // Modal element is focusable for that fallback.
  const index = read('src/ui/index.html');
  assert.match(index, /id="profileModal"[^>]*tabindex="-1"/, 'profile modal is not focusable');
});

test('A2: expanded rail shifts the GX Control drawer and sidebar panel to its 184px edge', () => {
  const css = read('src/ui/styles.css');
  assert.match(
    css,
    /\.nx-sidebar\.expanded ~ \.nx-left-tool-drawer \{\s*margin-left: 184px;/,
    'drawer does not shift right when the rail is expanded'
  );
  assert.match(
    css,
    /\.nx-sidebar\.expanded ~ \.nx-sidebar-panel:not\(\.pinned\) \{\s*left: 184px;/,
    'floating sidebar panel does not shift right when the rail is expanded'
  );
  assert.match(
    css,
    /\.nx-sidebar\.expanded ~ \.nx-sidebar-panel\.pinned \{\s*margin-left: 184px;/,
    'pinned sidebar panel does not shift right when the rail is expanded'
  );
  const renderer = read('src/ui/renderer.js');
  assert.match(renderer, /const RAIL_EXPANDED_WIDTH = 184;/, 'expanded rail width constant missing');
  // The native layout offset grows by the same 134px so the webview stays
  // aligned with the shifted drawer / pinned panel.
  assert.match(
    renderer,
    /const railShift = railExpandedState \? RAIL_EXPANDED_WIDTH - SIDEBAR_ICON_WIDTH : 0;/,
    'syncLayoutOffsets has no rail shift'
  );
  assert.match(renderer, /left \+= LEFT_TOOL_WIDTH \+ railShift;/, 'drawer offset ignores rail shift');
  assert.match(
    renderer,
    /left \+= getEffectiveSidebarPanelWidth\(sidebarPanelState\.width\) \+ railShift;/,
    'pinned panel offset ignores rail shift'
  );
  // Toggling the rail re-syncs offsets immediately.
  const setRail = renderer.match(/function setRailExpanded\(expanded[\s\S]*?\n\}/);
  assert.ok(setRail, 'setRailExpanded not found');
  assert.ok(setRail[0].includes('railExpandedState = Boolean(expanded)'), 'rail state is not tracked');
  assert.ok(setRail[0].includes('syncLayoutOffsets();'), 'setRailExpanded does not re-sync offsets');
  // The existing collapse-on-open mitigation is kept (MA-15/16).
  const openLeft = renderer.match(/function openLeftTool\(toolName\) \{[\s\S]*?\n\}/);
  assert.ok(openLeft[0].includes('setRailExpanded(false)'), 'drawer open no longer collapses the rail');
});

test('A7: split toggle and PiP button each have a fixed 29px slot', () => {
  const css = read('src/ui/styles.css');
  assert.match(css, /\.nx-toolbar-slot \{\s*flex: 0 0 29px;/, 'no fixed toolbar slot rule');
  assert.match(
    css,
    /\.nx-toolbar-slot > \.toolbar-icon-btn \{\s*flex: 0 0 29px;/,
    'slot buttons are not fixed-width'
  );
  const index = read('src/ui/index.html');
  assert.match(index, /<span class="nx-toolbar-slot">\s*<button class="toolbar-icon-btn" id="btnSplitView"/);
  assert.match(index, /<span class="nx-toolbar-slot">\s*<button class="toolbar-icon-btn" id="btnPopOutVideo"/);
});

test('item 4: shell/modal/toast/popover accent is red #FA1E4E; gx-violet stays a theme option', () => {
  const css = read('src/ui/styles.css');
  assert.match(css, /--nx-brand: #fa1e4e;/, 'red brand token missing');
  assert.match(css, /\.nx-modal \{\s*[\s\S]*?border: 1px solid var\(--nx-brand\);/, 'profile modal border is not brand red');
  assert.match(css, /\.nx-modal \.nx-btn-primary \{\s*background: var\(--nx-brand\);/, 'modal primary button is not brand red');
  assert.match(css, /\.nx-toast \{\s*[\s\S]*?border: 1px solid var\(--nx-brand\);/, 'toast border is not brand red');
  assert.match(css, /\.nx-toast-action \{\s*[\s\S]*?color: var\(--nx-brand-bright\);/, 'toast action is not brand red');
  const newtab = read('src/ui/newtab.html');
  assert.match(newtab, /#addModal \.modal-box \{\s*border-color: #fa1e4e;/, 'Speed Dial modal border is not brand red');
  assert.match(newtab, /#addModal \.btn\.primary \{\s*background: #fa1e4e;/, 'Speed Dial modal button is not brand red');
  const popover = read('src/ui/popover.html');
  assert.match(popover, /--nx-brand: #fa1e4e;/, 'popover has no brand token');
  assert.match(popover, /border: 1px solid var\(--nx-brand\);/, 'popover frame border is not brand red');
  // gx-violet is still offered as a theme choice, not deleted.
  const index = read('src/ui/index.html');
  assert.match(index, /data-theme-choice="gx-violet"/, 'gx-violet theme option removed');
  assert.match(read('src/ui/theme.css'), /html\[data-theme="gx-violet"\]/, 'gx-violet theme definition removed');
});

test('item 5: toasts overlay (fixed position) and never take tab-bar layout space', () => {
  const css = read('src/ui/styles.css');
  const toastRule = css.match(/\.nx-toast \{[^}]*\}/);
  assert.ok(toastRule, '.nx-toast rule missing');
  assert.match(toastRule[0], /position: fixed;/, 'toast is not a fixed overlay');
  assert.match(toastRule[0], /z-index: 9999;/, 'toast z-index missing');
});

test('item 6: hover preview has a thumbnail (large favicon) and is suppressed mid-drag', () => {
  const renderer = read('src/ui/renderer.js');
  // Thumbnail block in the hover card: large favicon, title-letter fallback.
  assert.match(renderer, /tab-hover-thumb/, 'no hover thumbnail markup');
  assert.match(renderer, /tab-hover-thumb-img/, 'no large favicon in hover card');
  assert.match(renderer, /tab-hover-thumb-letter/, 'no thumbnail fallback letter');
  const css = read('src/ui/styles.css');
  assert.match(css, /\.tab-hover-thumb \{/, 'no thumbnail CSS');
  assert.match(css, /\.tab-hover-thumb-img \{/, 'no thumbnail image CSS');
  // Suppressed while a tab drag is in progress (audit #32).
  assert.match(
    renderer,
    /if \(draggedTabId\) return;\s*\n\s*tabHoverTimer = setTimeout/,
    'hover preview is scheduled during a drag'
  );
  const dragstart = renderer.match(/el\.addEventListener\('dragstart', \(e\) => \{[\s\S]*?\n  \}\);/);
  assert.ok(dragstart, 'tab dragstart handler not found');
  assert.ok(dragstart[0].includes('hideTabHoverCard();'), 'dragstart does not hide the hover card');
});

test('item 7: split-view shortcut chip is un-cramped (two separate rows, padded kbd)', () => {
  // Already fixed in chrome-webui (out of the fix2-shell file set); verify
  // the fix is still in place rather than re-implementing it.
  const chromeWebui = read('src/ui/chrome-webui.js');
  assert.match(chromeWebui, /\['Split view divider: resize \(when focused\)', '← →'\]/);
  assert.match(chromeWebui, /\['Split view divider: centre \(when focused\)', 'Home'\]/);
  const chromeHtml = read('src/ui/chrome-webui.html');
  const kbdRule = chromeHtml.match(/\.nx-kbd \{[^}]*\}/);
  assert.ok(kbdRule, '.nx-kbd rule missing');
  assert.match(kbdRule[0], /padding: 3px 9px;/, 'shortcut chip is still cramped');
});

test('item 8: tab-search rows have a real favicon slot and no spilling tooltip', () => {
  const popover = read('src/ui/popover.html');
  // Favicon img lives inside the .rl-icon wrapper, so the 16px slot sizing
  // applies; a dead icon is replaced by the globe inside the same slot.
  assert.match(popover, /iconWrap\.appendChild\(img\);/, 'favicon is not wrapped in the .rl-icon slot');
  assert.match(popover, /img\.replaceWith\(globeEl\);/, 'dead favicon has no globe fallback');
  // No native title tooltip on internal URLs: the row already shows title
  // + URL clamped with ellipsis, and a raw "nextgx://newtab" tooltip spills
  // below the popover bounds (audit #33). External URLs keep the standard
  // hover tooltip; the visible text is clamped, so it cannot spill.
  const tsList = popover.match(/function renderTsList\(\) \{[\s\S]*?\n    \}\n/);
  assert.ok(tsList, 'renderTsList not found');
  assert.ok(tsList[0].includes('const isInternal = !t.url'), 'tab-search internal-URL check missing');
  assert.ok(tsList[0].includes('if (!isInternal) openBtn.title = t.url;'), 'tab-search tooltip guard missing');
  assert.ok(!tsList[0].includes('appendChild(iconNode)'), 'stale unwrapped iconNode still used');
  // Visible text clamps with ellipsis.
  assert.match(popover, /\.rl-title \{[^}]*text-overflow: ellipsis;/, 'tab title does not ellipsis');
  assert.match(popover, /\.rl-url \{[^}]*text-overflow: ellipsis;/, 'tab URL does not ellipsis');
});

test('item 9: rail context menu offers Open panel, Pin/Unpin, Customize Dock, Hide', () => {
  const popover = read('src/ui/popover.html');
  assert.match(popover, /data-rail-act="open"/, 'rail menu has no Open action');
  assert.match(popover, /data-rail-act="pin"/, 'rail menu has no Pin/Unpin action');
  assert.match(popover, /data-rail-act="hide"/, 'rail menu has no Hide action');
  assert.match(popover, /data-rail-act="customize"/, 'rail menu has no Customize Dock action');
  assert.match(popover, /railCtxPinLabel/, 'rail pin label element missing');
  assert.match(
    popover,
    /await window\.gxAPI\.updateSettings\(\{ sidebarPanelPinned: !currentRailCtx\.pinned \}\);/,
    'pin action does not flip sidebarPanelPinned'
  );
  const renderer = read('src/ui/renderer.js');
  // Payload carries the state the popover needs to label/hide Pin.
  assert.match(renderer, /pinned: sidebarPanelState\.pinned,/, 'rail payload has no pinned state');
  assert.match(
    renderer,
    /canPin: Boolean\(btn\.dataset\.sidebarPanel \|\| btn\.dataset\.serviceUrl\)/,
    'rail payload has no canPin flag'
  );
  assert.match(renderer, /height: 172,/, 'rail popover height not raised for the fourth item');
});

test('item 10: first-run card is one screen, dismissible, shown once via a persisted flag', () => {
  const index = read('src/ui/index.html');
  assert.match(index, /id="firstRunCard"/, 'first-run card markup missing');
  assert.match(index, /GX Control/, 'card does not introduce GX Control');
  assert.match(index, /Split view/, 'card does not introduce split view');
  assert.match(index, /Picture-in-Picture/, 'card does not introduce PiP');
  assert.match(index, /id="btnFirstRunGotIt"/, 'card has no dismiss button');
  assert.match(index, /id="btnFirstRunGx"/, 'card has no GX Control shortcut');
  const renderer = read('src/ui/renderer.js');
  assert.match(renderer, /function maybeShowFirstRunCard\(\)/, 'maybeShowFirstRunCard missing');
  assert.match(renderer, /function dismissFirstRunCard\(\)/, 'dismissFirstRunCard missing');
  assert.match(renderer, /maybeShowFirstRunCard\(\);/, 'card is never shown from startup');
  // Shown once: the flag is persisted through the existing settings
  // channel, and the card is skipped when it is set or in Private windows.
  assert.match(
    renderer,
    /window\.gxAPI\.updateSettings\(\{ firstRunSeen: true \}\)/,
    'dismiss does not persist firstRunSeen via updateSettings'
  );
  assert.match(
    renderer,
    /if \(settingsState && settingsState\.firstRunSeen === true\) return;/,
    'card is not skipped on later launches'
  );
  assert.match(
    renderer,
    /if \(document\.documentElement\.dataset\.incognito === 'true'\) return;/,
    'card is not suppressed in Private windows'
  );
  // The card is a shell overlay: content views are hidden while it is up,
  // like the profile modal, so the tab webview cannot occlude it.
  assert.match(
    renderer,
    /function maybeShowFirstRunCard\(\) \{[\s\S]*?setShellModalOpen\?\.\(true\)/,
    'card does not hide content views while shown'
  );
  const css = read('src/ui/styles.css');
  assert.match(css, /\.nx-first-run-card \{/, 'first-run card CSS missing');
  assert.match(css, /\.nx-first-run-card \{[^}]*border: 1px solid var\(--nx-brand\);/, 'card border is not brand red');
});

test('item 11: pinned tab with a missing/dead favicon shows a fallback, never a blank tab', () => {
  // Already fixed (capture-phase error listener swaps a dead favicon img
  // for the globe SVG); verify it is still in place.
  const renderer = read('src/ui/renderer.js');
  assert.match(
    renderer,
    /document\.addEventListener\(\s*'error',/,
    'no capture-phase favicon error listener'
  );
  const listener = renderer.match(/document\.addEventListener\(\s*'error',\s*\(e\) => \{[\s\S]*?\},\s*true\s*\);/);
  assert.ok(listener, 'favicon error listener not found');
  assert.ok(listener[0].includes("classList.contains('tab-favicon')"), 'listener does not target tab favicons');
  assert.ok(listener[0].includes('tab-favicon-fallback'), 'listener does not swap in a fallback icon');
});

test('item 12: collapsing a group keeps its active tab visible in the strip', () => {
  const renderer = read('src/ui/renderer.js');
  // Rebuild path: the active tab is rendered after the collapsed pill.
  assert.match(renderer, /el\.classList\.add\('active-in-collapsed-group'\);/, 'no kept-visible active tab marker');
  const rebuild = renderer.match(/if \(group\.collapsed\) \{[\s\S]*?continue;\n    \}/);
  assert.ok(rebuild, 'collapsed-group rebuild branch not found');
  assert.ok(rebuild[0].includes('buildTabElement(activeInGroup'), 'rebuild does not render the active tab');
  // Fast path: a missing element triggers a rebuild; a stale one is removed.
  assert.match(
    renderer,
    /if \(!el\) \{ allFound = false; break; \}/,
    'fast path does not rebuild when the kept-visible tab has no element'
  );
  assert.match(
    renderer,
    /const stale = existingTabsById\.get\(tab\.id\);\s*if \(stale\) stale\.remove\(\);/,
    'fast path does not remove a stale kept-visible tab'
  );
  const css = read('src/ui/styles.css');
  assert.match(css, /\.nx-tab\.active-in-collapsed-group \{/, 'kept-visible tab has no CSS hook');
});
