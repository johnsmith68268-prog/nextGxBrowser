const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'chrome-webui.html'), 'utf8');

test('A4: internal pages reflow below 720px — nav collapses to icons, ext grid stacks', () => {
  assert.ok(html.includes('@media (max-width: 720px)'), '720px breakpoint exists');
  assert.ok(html.includes('.ext-grid {\n        grid-template-columns: 1fr;'), 'ext grid stacks to one column');
  assert.ok(html.includes('width: 56px;'), 'nav collapses to 56px icon rail');
  assert.ok(html.includes('font-size: 0;'), 'nav labels hidden at narrow width');
  // The 900px rule must come before the 720px rule so the narrower rule wins.
  const idx900 = html.indexOf('@media (max-width: 900px)');
  const idx720 = html.lastIndexOf('@media (max-width: 720px)');
  assert.ok(idx900 > -1 && idx720 > idx900, '900px rule precedes the 720px rule');
});

test('A4: newtab Speed Dial delete keeps its undo bar (confirm-by-undo, #24)', () => {
  const newtab = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'newtab.html'), 'utf8');
  assert.ok(newtab.includes('showDialUndo'), 'undo bar exists for Speed Dial delete');
  // requestSpeedDialDelete lives in chrome-webui.js (WebUI page context) and
  // is not callable from newtab.html — undo is the delete safety net there.
  const webui = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'chrome-webui.js'), 'utf8');
  assert.ok(webui.includes('requestSpeedDialDelete'), 'WebUI confirm helper exists');
});
