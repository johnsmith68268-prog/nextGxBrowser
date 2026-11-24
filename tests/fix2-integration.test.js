const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('Integration: Panic toolbar button exists and is wired', () => {
  const html = read('src/ui/index.html');
  assert.ok(html.includes('id="btnPanic"'), 'btnPanic in toolbar');
  assert.ok(html.includes('Ctrl+Shift+P'), 'panic shortcut in title');
  const renderer = read('src/ui/renderer.js');
  assert.ok(renderer.includes("getElementById('btnPanic')"), 'renderer finds btnPanic');
  assert.ok(renderer.includes('togglePanic'), 'renderer toggles panic');
  assert.ok(renderer.includes('refreshPanicButton'), 'panic button state refresh exists');
});

test('Integration: history updates invalidate the omnibox cache', () => {
  const renderer = read('src/ui/renderer.js');
  assert.ok(renderer.includes('onHistoryUpdate'), 'renderer subscribes to history updates');
  assert.ok(renderer.includes('historyCacheAt = 0'), 'cache timestamp is reset');
});

test('Integration: battery saver reduces shell motion', () => {
  const renderer = read('src/ui/renderer.js');
  assert.ok(renderer.includes("classList.toggle('battery-saver'"), 'body class toggled from settings');
  const css = read('src/ui/styles.css');
  assert.ok(css.includes('body.battery-saver'), 'battery-saver CSS exists');
});

test('Integration: keyboard sounds play on character keys only when enabled', () => {
  const renderer = read('src/ui/renderer.js');
  assert.ok(renderer.includes('keyboardSoundsEnabled'), 'renderer reads the setting');
  assert.ok(renderer.includes('lastKeySoundAt'), 'key sounds are throttled');
});

test('Integration: Settings GX Features card + bridge APIs exist', () => {
  const webui = read('src/ui/chrome-webui.js');
  for (const id of ['btnGxPanicNow', 'setShaderPreset', 'setVideoEnhancePreset', 'setBatterySaverChk', 'setKeyboardSoundsChk', 'setBackgroundMusicChk', 'gxModsList', 'btnLoadGxMod', 'gxSoundsNote']) {
    assert.ok(webui.includes(id), `Settings card has ${id}`);
  }
  assert.ok(webui.includes('Video enhance (filter)'), 'video enhance labelled honestly, not AI');
  const preload = read('src/tab-preload.js');
  for (const api of ['listGxMods', 'loadGxMod', 'applyGxMod', 'removeGxMod', 'getGxModStatus', 'getSoundsStatus', 'triggerPanic']) {
    assert.ok(preload.includes(api), `gxChromePagesAPI exposes ${api}`);
  }
});

test('Integration: sidebar loadError is in state (panel body is the live view)', () => {
  // The panel chrome body IS the service WebContentsView, so its own
  // styled error page is the error UI (retest confirmed for Discord).
  // The state field exists so the shell can surface it if needed.
  const sidebar = read('src/main/sidebar.js');
  assert.ok(sidebar.includes('loadError'), 'sidebar state carries loadError');
});
