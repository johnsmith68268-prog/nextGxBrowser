// fix2-webui — Step 2, WebUI pages (market-audit-2.md).
// Covers: A3 history menu dismiss, history bulk bar, By-group IP label,
// Downloads live update + per-row Remove, Shield Reload gating (verified
// in popover.html), sticky chrome-pages nav, shortcuts dedup, cert page,
// Speed Dial delete confirm/undo, label truncation, red brand accent,
// GX Cleaner + wallpaper thumbnails (verified in their owning files),
// Media & AI Overlay explanation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const webuiJs = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'chrome-webui.js'), 'utf8');
const webuiHtml = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'chrome-webui.html'), 'utf8');
const errorHtml = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'error.html'), 'utf8');
const sidebarHtml = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'sidebar-panel-chrome.html'), 'utf8');
const popoverHtml = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'popover.html'), 'utf8');
const newtabHtml = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'newtab.html'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'index.html'), 'utf8');

// 1. A3 — History ⋮ menu dismisses after every action, including Remove.
test('A3: history entry menu closes after Remove (and every other action)', () => {
  assert.ok(!webuiJs.includes("if (action !== 'remove') closeHistEntryMenu()"),
    'the remove branch must not skip closing the menu');
  const menuFn = webuiJs.slice(webuiJs.indexOf('function openHistEntryMenu'));
  const handler = menuFn.slice(0, menuFn.indexOf('function syncHistorySelectionUI'));
  assert.ok(handler.includes("closeHistEntryMenu();\n        await window.gxChromePagesAPI.removeHistoryItem(entryId);"),
    'remove must close the menu before doing the async removal');
  assert.ok(handler.includes("closeHistEntryMenu();\n        await window.gxChromePagesAPI.createTab("),
    'open must close the menu');
  assert.ok(handler.includes('setTimeout(closeHistEntryMenu, 600)'),
    'copy must close the menu after showing "Copied!"');
});

// 2. History bulk bar — wired, and selection cannot go stale.
test('bulk bar: select-all / cancel / delete-selected are wired', () => {
  for (const id of ['btnHistSelectAll', 'btnHistClearSelection', 'btnHistBulkDelete']) {
    assert.ok(webuiJs.includes(`getElementById('${id}')?.addEventListener`),
      `${id} must have a click handler`);
  }
  assert.ok(webuiJs.includes("chk.addEventListener('change'"),
    'row checkboxes must update the selection');
  assert.ok(webuiJs.includes('function syncHistorySelectionUI'),
    'selection UI sync must exist');
});

test('bulk bar: selection is pruned on render and cleared on history clear', () => {
  assert.ok(webuiJs.includes('Prune selected ids that are no longer in the fetched history'),
    'renderHistoryPage must prune stale selected ids');
  assert.ok(webuiJs.includes('histSelected.clear();\n      renderHistoryPage();'),
    'clear-history actions must drop the selection');
  const bulkDelete = webuiJs.slice(webuiJs.indexOf("getElementById('btnHistBulkDelete')"));
  assert.ok(bulkDelete.slice(0, 900).includes('finally'),
    'bulk delete must clear the selection even if a remove fails');
});

// 3. By-group IP label — "127.0.0.1" must stay "127.0.0.1", never "0.1".
test('By-group: IP hosts keep their full address as the group label', () => {
  const start = webuiJs.indexOf('const HIST_TWO_LABEL_SUFFIXES');
  const end = webuiJs.indexOf('\nfunction histRowHtml');
  assert.ok(start !== -1 && end > start, 'histRegistrableDomain source must be extractable');
  const fn = new Function(`${webuiJs.slice(start, end)}; return histRegistrableDomain;`)();
  assert.equal(fn('http://127.0.0.1:8765/'), '127.0.0.1');
  assert.equal(fn('http://10.0.0.5/page'), '10.0.0.5');
  assert.equal(fn('http://192.168.1.20:3000/'), '192.168.1.20');
  assert.equal(fn('http://localhost:3000/'), 'localhost');
  assert.equal(fn('https://www.youtube.com/watch?v=x'), 'youtube.com');
  assert.equal(fn('https://sub.example.co.uk/a'), 'example.co.uk');
  assert.equal(fn('https://mail.google.com/'), 'google.com');
  assert.ok(!fn('http://127.0.0.1:8765/').includes('0.1') || fn('http://127.0.0.1:8765/') === '127.0.0.1',
    'group label must not be the shortened "0.1"');
});

// 4. Downloads — live update from the broadcast payload + robust Remove.
test('downloads: live update uses the broadcast payload', () => {
  assert.ok(webuiJs.includes("async function renderDownloadsPage({ force = true, list: listOverride = null }"),
    'renderDownloadsPage must accept a list override');
  assert.ok(webuiJs.includes('renderDownloadsPage({ force: false, list: Array.isArray(data) ? data : null })'),
    'onDownloadsUpdate must pass its payload through');
  assert.ok(webuiJs.includes('window.gxChromePagesAPI.onDownloadsUpdate'),
    'the downloads update listener must be registered');
});

test('downloads: per-row Remove uses the bound button and re-renders', () => {
  const remove = webuiJs.slice(webuiJs.indexOf("querySelectorAll('.remove-dl')"));
  const block = remove.slice(0, 1200);
  assert.ok(block.includes("btn.closest('.dl-item-row')"),
    'Remove must resolve the row from the bound button, not e.target');
  assert.ok(block.includes('await window.gxChromePagesAPI.removeDownload(id)'),
    'Remove must call removeDownload');
  assert.ok(block.includes('renderDownloadsPage()'),
    'Remove must re-render so the row actually disappears');
  for (const cls of ['pause-dl', 'resume-dl', 'cancel-dl']) {
    const seg = webuiJs.slice(webuiJs.indexOf(`querySelectorAll('.${cls}')`), webuiJs.indexOf(`querySelectorAll('.${cls}')`) + 400);
    assert.ok(seg.includes("btn.closest('.dl-item-row')"), `${cls} must use btn.closest too`);
  }
});

// 5. Shield Reload on internal pages — gated with an explanation (popover.html).
test('shield: Reload site is disabled with an explanation on internal pages', () => {
  assert.ok(popoverHtml.includes('Reload is not available on internal pages'),
    'popover must explain why Reload is unavailable on internal pages');
  assert.ok(popoverHtml.includes('reloadBtn.disabled = true'),
    'the reload button must actually be disabled there');
});

// 6. Chrome-pages left nav stays visible on scroll.
test('chrome-pages nav is sticky below the topbar', () => {
  const nav = webuiHtml.slice(webuiHtml.indexOf('.webui-nav {'));
  const block = nav.slice(0, 700);
  assert.ok(block.includes('position: sticky'), 'nav must be position: sticky');
  assert.ok(block.includes('top: 60px'), 'nav must stick below the 60px topbar, not under it');
  assert.ok(block.includes('height: 100vh'), 'nav keeps its full viewport height (internal scroll)');
});

// 7. Keyboard Shortcuts appear once (Settings), Extensions links to it.
test('extensions page does not duplicate the shortcuts list', () => {
  assert.ok(webuiJs.includes('btnExtShortcutsSettings'),
    'extensions card must link to Settings shortcuts');
  assert.ok(webuiJs.includes('See all shortcuts in Settings'),
    'extensions card must be a pointer, not a second copy');
  const headings = webuiJs.match(/<h2 class="nx-heading">Keyboard shortcuts<\/h2>/g) || [];
  assert.equal(headings.length, 2, 'exactly one shortcuts heading per page (Extensions pointer + Settings list)');
});

// 8. Cert page (error.html).
test('cert page: Proceed has a stall safety net instead of a frozen page', () => {
  assert.ok(errorHtml.includes('id="proceedStatus"'), 'a proceed status line must exist');
  assert.ok(errorHtml.includes('proceedStallTimer'), 'a stall timer must watch the Proceed reload');
  assert.ok(errorHtml.includes('}, 6000);'), 'the stall timeout must re-arm the button after 6s');
  assert.ok(errorHtml.includes('resetProceedButton()'), 'the button must be re-enabled on stall/failure');
  assert.ok(errorHtml.includes('.catch(() => {'), 'a rejected proceed IPC must restore the button');
  // Two-step flow + session-only exception logic untouched.
  assert.ok(errorHtml.includes('proceedArmed'), 'two-step Proceed must still be intact');
  assert.ok(errorHtml.includes('Advanced: Proceed anyway'), 'Advanced button must still exist');
});

test('cert page: Advanced/Proceed button is fully visible at 380px', () => {
  assert.ok(errorHtml.includes('@media (max-width: 420px)'), 'a narrow-width breakpoint must exist');
  const narrow = errorHtml.slice(errorHtml.indexOf('@media (max-width: 420px)'));
  assert.ok(narrow.includes('.error-actions .btn'), 'narrow actions must be styled');
  assert.ok(narrow.includes('width: 100%'), 'narrow buttons must go full-width');
  assert.ok(errorHtml.includes('white-space: normal;'), 'buttons must wrap long labels instead of clipping them');
});

// 9. Speed Dial delete confirm/undo.
test('speed dial: WebUI confirm-then-delete helper exists', () => {
  assert.ok(webuiJs.includes('async function requestSpeedDialDelete'),
    'requestSpeedDialDelete helper must exist in chrome-webui.js');
  const helper = webuiJs.slice(webuiJs.indexOf('async function requestSpeedDialDelete'));
  assert.ok(helper.slice(0, 1500).includes('showWebuiConfirmModal'),
    'the helper must confirm via the WebUI modal');
  assert.ok(helper.includes("confirmLabel: 'Remove'"), 'confirm must be labelled Remove');
  assert.ok(webuiJs.includes('WIRING NEEDED (newtab.html'), 'the newtab wiring note must be documented');
});

test('speed dial: new tab page already offers undo after delete', () => {
  assert.ok(newtabHtml.includes('dial-undo-bar'), 'undo bar must exist on the new tab page');
  assert.ok(newtabHtml.includes('showDialUndo'), 'delete must show the undo bar');
});

// 10. Label truncation — two-line wrap, not mid-word clipping.
test('labels: history/bookmark titles wrap to two lines with full-text tooltip', () => {
  assert.ok(webuiHtml.includes('.row-title--clamp2'), 'clamp2 class must exist in chrome-webui.html');
  const clamp = webuiHtml.slice(webuiHtml.indexOf('.row-title--clamp2'));
  assert.ok(clamp.slice(0, 400).includes('-webkit-line-clamp: 2'), 'clamp must allow two lines');
  assert.ok(webuiJs.includes('row-title row-title--clamp2 open-link'), 'history titles must use the clamp');
  assert.ok(webuiJs.includes('row-title row-title--clamp2 open-bm'), 'bookmark titles must use the clamp');
  assert.ok(newtabHtml.includes('-webkit-line-clamp: 2'), 'speed dial tiles must also clamp to two lines');
});

// 11. Red brand accent in WebUI pages.
test('brand accent: confirm modal and fallbacks use #FA1E4E, not purple', () => {
  assert.ok(webuiHtml.includes('--nx-brand: #FA1E4E'), 'brand token must be defined');
  assert.ok(webuiHtml.includes('border: 1px solid var(--nx-brand, #FA1E4E)'),
    'confirm modal border must use the red brand accent');
  assert.ok(webuiHtml.includes('.nx-webui-modal .btn.primary'),
    'modal confirm button must be styled red-brand');
  assert.ok(!/#9d4edd/i.test(webuiHtml), 'no hardcoded violet #9d4edd may remain in chrome-webui.html');
  assert.ok(!/#c77dff/i.test(webuiHtml), 'no hardcoded violet #c77dff may remain in chrome-webui.html');
  // Theme swatches themselves stay (they are the theme picker, not accents).
  assert.ok(webuiHtml.includes('--nx-swatch-violet'), 'violet theme swatch must still exist for the picker');
});

// 12. GX Cleaner — live summary (owning files: index.html / renderer.js).
test('cleaner: panel has a live cache summary instead of empty space', () => {
  assert.ok(indexHtml.includes('cleanerCacheSizeText'), 'cache usage readout must exist');
  assert.ok(indexHtml.includes('Cache Usage'), 'a Cache Usage card must exist');
  assert.ok(indexHtml.includes('What Gets Cleaned'), 'a "what gets cleaned" explainer must exist');
});

// 13. Wallpaper thumbnails — brightened (owning file: newtab.html).
test('wallpaper: thumbnails are brightened so they do not read as dark blocks', () => {
  const swatch = newtabHtml.slice(newtabHtml.indexOf('.wp-preset-swatch {'));
  assert.ok(swatch.slice(0, 500).includes('filter: brightness(1.14)'),
    'wallpaper thumbnails must be brightened');
});

// 14. Media & AI Overlay explanation present on the Extensions page.
test('extensions: Media & AI Overlay always-on explanation is present', () => {
  assert.ok(webuiJs.includes('Always on — a core part of nextGx, so it cannot be turned off.'),
    'the always-on explanation must be present exactly once');
  assert.equal(
    (webuiJs.match(/Always on — a core part of nextGx/g) || []).length, 1,
    'the explanation must not be duplicated');
});

// Sanity: my files still parse / are intact.
test('webui files are intact', () => {
  assert.ok(webuiJs.length > 100000, 'chrome-webui.js must not have been truncated');
  assert.ok(webuiHtml.includes('class="webui-nav"'), 'chrome-webui.html nav must exist');
  assert.ok(sidebarHtml.includes('nx-sidebar-panel'), 'sidebar panel must exist');
  assert.ok(errorHtml.includes('id="btnProceed"'), 'error page Proceed button must exist');
});
