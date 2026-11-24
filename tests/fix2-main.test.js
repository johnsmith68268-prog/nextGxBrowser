const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

// ---------------------------------------------------------------------------
// Electron mock (installed before any app module is required). Same pattern
// as tests/audit-fixes.test.js / tests/new-modules.test.js.
// ---------------------------------------------------------------------------

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nextgx-fix2-main-test-'));
const userDataDir = path.join(tmpRoot, 'userData');
fs.mkdirSync(userDataDir, { recursive: true });

class FakeWebContents {
  constructor() {
    this.sent = [];
    this.listeners = new Map();
  }
  send(ch, payload) {
    this.sent.push([ch, payload]);
  }
  on(ev, fn) {
    this.listeners.set(ev, fn);
  }
  isDestroyed() {
    return false;
  }
  getURL() {
    return 'about:blank';
  }
}

const mockElectron = {
  app: {
    getPath: (name) => (name === 'userData' ? userDataDir : path.join(userDataDir, name)),
    getVersion: () => '3.0.0',
    getAppMetrics: () => []
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s) => Buffer.from(s, 'utf8'),
    decryptString: (b) => b.toString('utf8')
  },
  shell: { openPath: async () => '', showItemInFolder: () => {} },
  session: { defaultSession: {} },
  BrowserWindow: function () {},
  WebContentsView: function () {},
  ipcMain: { handle: () => {}, on: () => {} },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  Menu: { buildFromTemplate: () => ({ popup: () => {} }), setApplicationMenu: () => {} },
  clipboard: { readText: () => '', writeText: () => {} },
  nativeImage: { createFromPath: () => ({}), createFromDataURL: () => ({}) },
  screen: { getPrimaryDisplay: () => ({ workArea: { width: 1280, height: 800 } }) }
};
mockElectron.BrowserWindow.fromWebContents = () => null;
mockElectron.BrowserWindow.getFocusedWindow = () => null;

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return mockElectron;
  return origLoad.apply(this, arguments);
};

test.after(() => {
  Module._load = origLoad;
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (_) {}
});

const { StorageManager, isLocalOrPrivateHost, normalizeSavedUrl } = require('../src/storage');
const pagefx = require('../src/main/pagefx');
const gxmods = require('../src/main/gxmods');
const core = require('../src/main/core');

function makeFakeStorage(overrides = {}) {
  let settings = {
    sidebarPanelWidth: 380,
    sidebarPanelPinned: false,
    autoSleepEnabled: true,
    autoSleepMinutes: 10,
    gxRamLimiterEnabled: false,
    gxRamLimitMB: 4096,
    batterySaverEnabled: false,
    shaderPreset: 'none',
    videoEnhancePreset: 'off',
    keyboardSoundsEnabled: false,
    backgroundMusicEnabled: false,
    gxModPacks: [],
    activeGxModId: ''
  };
  let panicSnapshot = null;
  const store = {
    getSettings: () => ({ ...settings }),
    updateSettings: (partial) => {
      settings = { ...settings, ...(partial || {}) };
      store._updateCalls.push(partial);
      return { ...settings };
    },
    getWorkspaces: () => [{ id: 'default', name: 'Default' }],
    getTabGroups: () => [],
    isBookmarked: () => false,
    getPanicSnapshot: () => panicSnapshot,
    savePanicSnapshot: (snap) => {
      panicSnapshot = snap;
      return snap;
    },
    clearPanicSnapshot: () => {
      panicSnapshot = null;
    },
    _updateCalls: [],
    _getSettingsObject: () => settings,
    _setSettingsObject: (next) => {
      settings = { ...settings, ...next };
    }
  };
  return { ...store, ...overrides };
}

// ---------------------------------------------------------------------------
// Item 3 — bare-host https forcing in the save path
// ---------------------------------------------------------------------------

test('fix2-3: isLocalOrPrivateHost recognises local/private hosts only', () => {
  for (const host of ['localhost', '127.0.0.1', '127.0.1.1', '10.0.0.5', '192.168.1.1', '172.16.0.9', '172.31.255.255', '::1', 'printer.local', 'nas.localhost']) {
    assert.equal(isLocalOrPrivateHost(host), true, host);
  }
  for (const host of ['example.com', '8.8.8.8', '172.15.0.1', '172.32.0.1', '192.169.1.1', '256.1.1.1', '', 'example.local.evil.com']) {
    assert.equal(isLocalOrPrivateHost(host), false, host);
  }
});

test('fix2-3: normalizeSavedUrl preserves http for local hosts, https otherwise', () => {
  assert.equal(normalizeSavedUrl('127.0.0.1:8765'), 'http://127.0.0.1:8765');
  assert.equal(normalizeSavedUrl('127.0.0.1:8765/page2.html'), 'http://127.0.0.1:8765/page2.html');
  assert.equal(normalizeSavedUrl('localhost:3000'), 'http://localhost:3000');
  assert.equal(normalizeSavedUrl('192.168.1.5'), 'http://192.168.1.5');
  assert.equal(normalizeSavedUrl('10.0.0.1:8080/x'), 'http://10.0.0.1:8080/x');
  assert.equal(normalizeSavedUrl('myserver.local'), 'http://myserver.local');
  assert.equal(normalizeSavedUrl('example.com'), 'https://example.com');
  assert.equal(normalizeSavedUrl('www.github.com/marjan'), 'https://www.github.com/marjan');
  assert.equal(normalizeSavedUrl('https://example.com'), 'https://example.com');
  assert.equal(normalizeSavedUrl('http://example.com'), 'http://example.com');
  assert.equal(normalizeSavedUrl(''), '');
  assert.equal(normalizeSavedUrl('not a host'), '');
});

test('fix2-3: bookmark + Speed Dial saves keep http for local hosts', () => {
  const dataDir = fs.mkdtempSync(path.join(tmpRoot, 'store-'));
  const store = new StorageManager({ dataDir });
  const bm = store.addBookmark({ title: 'Local test', url: '127.0.0.1:8765' });
  assert.equal(bm.ok, true);
  assert.ok(store.getBookmarks().some((b) => b.url === 'http://127.0.0.1:8765'));
  const bm2 = store.addBookmark({ title: 'Public', url: 'example.com' });
  assert.equal(bm2.ok, true);
  assert.ok(store.getBookmarks().some((b) => b.url === 'https://example.com'));

  store.addSpeedDial({ title: 'Local dial', url: 'localhost:3000' });
  assert.ok(store.getSpeedDial().some((d) => d.url === 'http://localhost:3000'));
  store.addSpeedDial({ title: 'Public dial', url: 'github.com' });
  assert.ok(store.getSpeedDial().some((d) => d.url === 'https://github.com'));

  const dial = store.getSpeedDial().find((d) => d.title === 'Local dial');
  store.updateSpeedDial(dial.id, { title: 'Local dial', url: '192.168.0.10:8080/app' });
  assert.ok(store.getSpeedDial().some((d) => d.url === 'http://192.168.0.10:8080/app'));
});

test('fix2-3: new settings keys exist with safe defaults and bad presets are rejected', () => {
  const dataDir = fs.mkdtempSync(path.join(tmpRoot, 'store-settings-'));
  const store = new StorageManager({ dataDir });
  const s = store.getSettings();
  assert.equal(s.batterySaverEnabled, false);
  assert.equal(s.shaderPreset, 'none');
  assert.equal(s.videoEnhancePreset, 'off');
  assert.equal(s.keyboardSoundsEnabled, false);
  assert.equal(s.backgroundMusicEnabled, false);
  assert.deepEqual(s.gxModPacks, []);
  assert.equal(s.activeGxModId, '');

  const updated = store.updateSettings({ shaderPreset: 'not-a-preset', videoEnhancePreset: 'ai-8k' });
  assert.equal(updated.shaderPreset, 'none');
  assert.equal(updated.videoEnhancePreset, 'off');
  const ok = store.updateSettings({ shaderPreset: 'sepia', videoEnhancePreset: 'sharp', batterySaverEnabled: true });
  assert.equal(ok.shaderPreset, 'sepia');
  assert.equal(ok.videoEnhancePreset, 'sharp');
  assert.equal(ok.batterySaverEnabled, true);
});

// ---------------------------------------------------------------------------
// Items 7 + 8 — Shaders + RGX-like video enhance (pure CSS, honest labels)
// ---------------------------------------------------------------------------

test('fix2-7/8: pagefx presets map to CSS filters; unknown presets are inert', () => {
  assert.equal(pagefx.shaderFilterForPreset('none'), '');
  assert.equal(pagefx.shaderFilterForPreset('grayscale'), 'grayscale(1)');
  assert.ok(pagefx.shaderFilterForPreset('sepia').includes('sepia(1)'));
  assert.ok(pagefx.shaderFilterForPreset('warm').includes('sepia(0.35)'));
  assert.ok(pagefx.shaderFilterForPreset('high-contrast').includes('contrast(1.35)'));
  assert.equal(pagefx.shaderFilterForPreset('nope'), '');
  assert.equal(pagefx.shaderFilterForPreset(null), '');

  assert.equal(pagefx.videoFilterForPreset('off'), '');
  assert.ok(pagefx.videoFilterForPreset('sharp').includes('contrast(1.15)'));
  assert.ok(pagefx.videoFilterForPreset('vivid').includes('saturate(1.5)'));
  assert.equal(pagefx.videoFilterForPreset('ai-upscale'), '');
  assert.equal(pagefx.isValidVideoEnhancePreset('ai-upscale'), false);

  assert.equal(pagefx.buildPageFxCss({ shaderPreset: 'none' }), '');
  assert.ok(pagefx.buildPageFxCss({ shaderPreset: 'grayscale' }).includes('html { filter: grayscale(1)'));
  const vig = pagefx.buildPageFxCss({ shaderPreset: 'vignette' });
  assert.ok(vig.includes('radial-gradient'));
  assert.ok(vig.includes('pointer-events: none'));

  assert.deepEqual(pagefx.sanitizePageFxSettings({ shaderPreset: 'cool', videoEnhancePreset: 'cinema' }), {
    shaderPreset: 'cool',
    videoEnhancePreset: 'cinema'
  });
  assert.deepEqual(pagefx.sanitizePageFxSettings({ shaderPreset: 'bogus', videoEnhancePreset: 'bogus' }), {
    shaderPreset: 'none',
    videoEnhancePreset: 'off'
  });
});

test('fix2-7/8: tab-preload carries the page-effects code (in sync with pagefx.js)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'tab-preload.js'), 'utf8');
  assert.ok(src.includes('nextgx-pagefx-style'));
  assert.ok(src.includes('Enhance (filter)'));
  assert.ok(src.includes("ipcRenderer.on('settings:update'"));
  // Sandboxed tab-preload must have no relative requires in CODE (the
  // header comment mentions one as an example — strip comments first).
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
  assert.ok(!/require\(['"]\.\//.test(codeOnly), 'sandboxed tab-preload must have no relative requires');
  // The preset tables must agree between the two copies.
  for (const preset of ['grayscale', 'sepia', 'vignette', 'night']) {
    assert.ok(src.includes(preset), `tab-preload missing shader preset ${preset}`);
  }
  for (const preset of ['sharp', 'vivid', 'cinema']) {
    assert.ok(src.includes(preset), `tab-preload missing video preset ${preset}`);
  }
});

// ---------------------------------------------------------------------------
// Item 9 — GX Mods, local packs only
// ---------------------------------------------------------------------------

test('fix2-9: readModPack validates a local pack folder; no network involved', () => {
  const packDir = fs.mkdtempSync(path.join(tmpRoot, 'modpack-'));
  fs.writeFileSync(
    path.join(packDir, 'mod.json'),
    JSON.stringify({ name: 'Neon Nights', version: '1.0.0', theme: 'crimson', sounds: 'chimes' })
  );
  const read = gxmods.readModPack(packDir);
  assert.equal(read.ok, true);
  assert.equal(read.pack.name, 'Neon Nights');
  assert.equal(read.pack.theme, 'crimson');
  assert.equal(read.pack.sounds, 'chimes');
  // No audio files in the pack -> honestly no sound pack installed.
  assert.equal(read.pack.soundPackInstalled, false);
  assert.deepEqual(read.pack.audioFiles, []);
  assert.deepEqual(read.pack.warnings, []);

  const badThemeDir = fs.mkdtempSync(path.join(tmpRoot, 'modpack-bad-'));
  fs.writeFileSync(
    path.join(badThemeDir, 'mod.json'),
    JSON.stringify({ name: 'Bad', theme: 'not-a-theme', wallpaper: '../escape.png' })
  );
  const bad = gxmods.readModPack(badThemeDir);
  assert.equal(bad.ok, true);
  assert.equal(bad.pack.theme, '');
  assert.equal(bad.pack.wallpaper, '');
  assert.ok(bad.pack.warnings.length >= 2);

  const emptyDir = fs.mkdtempSync(path.join(tmpRoot, 'modpack-empty-'));
  assert.equal(gxmods.readModPack(emptyDir).ok, false);
  assert.equal(gxmods.readModPack(path.join(tmpRoot, 'does-not-exist')).ok, false);

  const noNameDir = fs.mkdtempSync(path.join(tmpRoot, 'modpack-noname-'));
  fs.writeFileSync(path.join(noNameDir, 'mod.json'), JSON.stringify({ version: '1' }));
  assert.equal(gxmods.readModPack(noNameDir).ok, false);
});

test('fix2-9: a pack folder with audio files reports them; registry sanitises', () => {
  const packDir = fs.mkdtempSync(path.join(tmpRoot, 'modpack-audio-'));
  fs.writeFileSync(path.join(packDir, 'mod.json'), JSON.stringify({ name: 'LoFi', theme: 'ice' }));
  fs.writeFileSync(path.join(packDir, 'theme.mp3'), 'fake-audio');
  const read = gxmods.readModPack(packDir);
  assert.equal(read.ok, true);
  assert.equal(read.pack.soundPackInstalled, true);
  assert.deepEqual(read.pack.audioFiles, ['theme.mp3']);

  const dirty = gxmods.sanitizeModRegistry([
    { id: 'x', name: 'A', path: '/tmp/a', theme: 'crimson', audioFiles: ['a.mp3'], soundPackInstalled: true },
    { id: 'x', name: 'dup', path: '/tmp/a' },
    null,
    { name: 'no-path' }
  ]);
  assert.equal(dirty.length, 1);
  assert.equal(dirty[0].name, 'A');

  const status = gxmods.getModStatus({ gxModPacks: dirty, activeGxModId: 'x', keyboardSoundsEnabled: true });
  assert.equal(status.activeId, 'x');
  assert.equal(status.soundPackInstalled, true);
  assert.equal(status.keyboardSoundsEnabled, true);

  const noPack = gxmods.getModStatus({ gxModPacks: [], activeGxModId: '' });
  assert.equal(noPack.soundPackInstalled, false);
  assert.ok(noPack.note.includes('Local packs only'));
});

test('fix2-9: buildModSettingsPatch applies theme only, never fetches', () => {
  const { patch, warnings } = gxmods.buildModSettingsPatch({
    id: 'mod-x',
    name: 'Neon',
    theme: 'crimson',
    wallpaper: '',
    sounds: 'chimes',
    warnings: []
  });
  assert.equal(patch.theme, 'crimson');
  assert.equal(patch.wallpaper, undefined);
  assert.ok(warnings.join(' ').includes('built-in synth'));
});

// ---------------------------------------------------------------------------
// Item 6 — Panic button
// ---------------------------------------------------------------------------

test('fix2-6: panic snapshots, hides, and restores the previous session', () => {
  const panic = require('../src/main/panic');
  const created = [];
  const closed = [];
  const fakeTabs = {
    createTab: (ctx, opts) => {
      const id = `tab-${created.length + 1}`;
      ctx.tabs.set(id, { id, url: opts.url, pinned: Boolean(opts.pinned), groupId: opts.groupId || null, workspaceId: opts.workspaceId || 'default' });
      ctx.tabOrder.push(id);
      created.push({ id, ...opts });
      return {};
    },
    closeTab: (ctx, id) => {
      closed.push(id);
      ctx.tabs.delete(id);
      ctx.tabOrder = ctx.tabOrder.filter((t) => t !== id);
      if (ctx.activeTabId === id) ctx.activeTabId = null;
      return {};
    },
    switchTab: (ctx, id) => {
      ctx.activeTabId = id;
      return {};
    }
  };
  const storage = makeFakeStorage();
  core.state.storage = storage;
  panic.configurePanic({
    tabs: fakeTabs,
    sidebar: { closeSidebarPanel: () => {} },
    popovers: { closePopover: () => {} },
    broadcast: { broadcastState: () => {} }
  });

  const ctx = {
    win: { isDestroyed: () => false },
    incognito: false,
    tabOrder: ['a', 'b'],
    tabs: new Map([
      ['a', { id: 'a', url: 'https://example.com', title: 'Example', pinned: false, groupId: null, workspaceId: 'default' }],
      ['b', { id: 'b', url: 'https://github.com', title: 'GitHub', pinned: true, groupId: null, workspaceId: 'default' }]
    ]),
    activeTabId: 'b',
    popoverOpenKind: null,
    sidebarPanel: null,
    panicActive: false,
    _panicSnapshot: null
  };

  const triggered = panic.triggerPanic(ctx);
  assert.equal(triggered.ok, true);
  assert.equal(ctx.panicActive, true);
  assert.deepEqual(closed, ['a', 'b']);
  assert.equal(ctx.tabOrder.length, 1);
  assert.equal(created.length, 1);
  assert.equal(created[0].url, 'nextgx://newtab');
  assert.equal(triggered.state.tabCount, 2);
  assert.equal(triggered.state.hasSnapshot, true);
  assert.ok(storage.getPanicSnapshot());
  assert.equal(storage.getPanicSnapshot().tabs[1].pinned, true);
  assert.equal(storage.getPanicSnapshot().activeIndex, 1);

  created.length = 0;
  closed.length = 0;
  const restored = panic.restorePanic(ctx);
  assert.equal(restored.ok, true);
  assert.equal(restored.restoredCount, 2);
  assert.equal(ctx.panicActive, false);
  assert.equal(ctx.tabOrder.length, 2);
  // Previously active tab (index 1, GitHub) is active again.
  assert.equal(ctx.activeTabId, ctx.tabOrder[1]);
  assert.equal(ctx.tabs.get(ctx.tabOrder[1]).url, 'https://github.com');
  assert.equal(storage.getPanicSnapshot(), null);

  // Nothing left to restore.
  assert.equal(panic.restorePanic(ctx).ok, false);
  // Toggle works both ways.
  panic.togglePanic(ctx);
  assert.equal(ctx.panicActive, true);
  panic.togglePanic(ctx);
  assert.equal(ctx.panicActive, false);
});

test('fix2-6: panic in incognito never writes the snapshot to disk', () => {
  const panic = require('../src/main/panic');
  const storage = makeFakeStorage();
  let saved = false;
  storage.savePanicSnapshot = () => {
    saved = true;
    return null;
  };
  core.state.storage = storage;
  panic.configurePanic({
    tabs: {
      createTab: (ctx) => {
        ctx.tabOrder.push('n');
        ctx.tabs.set('n', { id: 'n', url: 'nextgx://newtab' });
      },
      closeTab: (ctx, id) => {
        ctx.tabs.delete(id);
        ctx.tabOrder = ctx.tabOrder.filter((t) => t !== id);
      },
      switchTab: () => {}
    },
    sidebar: { closeSidebarPanel: () => {} },
    popovers: { closePopover: () => {} },
    broadcast: { broadcastState: () => {} }
  });
  const ctx = {
    win: { isDestroyed: () => false },
    incognito: true,
    tabOrder: ['a'],
    tabs: new Map([['a', { id: 'a', url: 'https://secret.example', pinned: false }]]),
    activeTabId: 'a',
    panicActive: false,
    _panicSnapshot: null
  };
  assert.equal(panic.triggerPanic(ctx).ok, true);
  assert.equal(saved, false);
  assert.ok(ctx._panicSnapshot);
});

test('fix2-6: panic snapshot round-trips through real storage', () => {
  const dataDir = fs.mkdtempSync(path.join(tmpRoot, 'store-panic-'));
  const store = new StorageManager({ dataDir });
  assert.equal(store.getPanicSnapshot(), null);
  store.savePanicSnapshot({
    tabs: [{ url: 'https://example.com', title: 'E', pinned: false, groupId: null, workspaceId: 'default' }],
    activeIndex: 0,
    savedAt: 123
  });
  const snap = store.getPanicSnapshot();
  assert.equal(snap.tabs.length, 1);
  assert.equal(snap.tabs[0].url, 'https://example.com');
  store.clearPanicSnapshot();
  assert.equal(store.getPanicSnapshot(), null);
});

// ---------------------------------------------------------------------------
// Items 1 + 4 — sidebar resize guard + Discord load/error state
// ---------------------------------------------------------------------------

function makeFakeCtx() {
  const win = {
    id: 1,
    isDestroyed: () => false,
    getContentSize: () => [1280, 800],
    webContents: { send: () => {}, focus: () => {} },
    contentView: { addChildView: () => {}, removeChildView: () => {} }
  };
  return {
    win,
    layoutState: {},
    tabs: new Map(),
    tabOrder: [],
    activeTabId: null,
    popoverOpenKind: null,
    sidebarPanel: null,
    sidebarPanelFrameView: null,
    incognito: false,
    profileId: 'default',
    panicActive: false
  };
}

test('fix2-1: clampSidebarWidth clamps to 260–800 and defaults on garbage', () => {
  const sidebar = require('../src/main/sidebar');
  assert.equal(sidebar.clampSidebarWidth(100), 260);
  assert.equal(sidebar.clampSidebarWidth(900), 800);
  assert.equal(sidebar.clampSidebarWidth(500), 500);
  assert.equal(sidebar.clampSidebarWidth('nope'), 380);
  assert.equal(sidebar.clampSidebarWidth(undefined), 380);
});

test('fix2-1: resize guard suppresses auto-close during a drag, lifts after', () => {
  const sidebar = require('../src/main/sidebar');
  const storage = makeFakeStorage();
  core.state.storage = storage;
  const ctx = makeFakeCtx();
  const panel = sidebar.ensureSidebarPanelState(ctx);
  panel.open = true;
  panel.activeKey = 'discord';
  panel.pinned = false;
  panel.openedAt = Date.now() - 10000; // long past the 120 ms open grace

  // No drag: auto-close fires (old behaviour preserved).
  assert.equal(sidebar.closeSidebarIfUnpinned(ctx, { ignoreGrace: true }), true);
  assert.equal(panel.open, false);

  // Reopen, then start a drag: auto-close is suppressed.
  panel.open = true;
  sidebar.setSidebarResizing(ctx, true);
  assert.equal(sidebar.isSidebarResizeGuardActive(panel), true);
  assert.equal(sidebar.closeSidebarIfUnpinned(ctx, { ignoreGrace: true }), false);
  assert.equal(panel.open, true);

  // Explicit resize-start/end IPC path also clears the flag — but the
  // guard deliberately lingers 800 ms after the last resize activity, so
  // a focus event landing right at release still cannot kill the panel.
  sidebar.setSidebarResizing(ctx, false);
  assert.equal(panel.resizing, false);
  assert.equal(sidebar.isSidebarResizeGuardActive(panel), true);
  assert.equal(sidebar.closeSidebarIfUnpinned(ctx, { ignoreGrace: true }), false);
  assert.equal(panel.open, true);
  // Once the guard window has passed, normal auto-close resumes.
  panel.lastResizeAt = Date.now() - 5000;
  assert.equal(sidebar.isSidebarResizeGuardActive(panel), false);
  assert.equal(sidebar.closeSidebarIfUnpinned(ctx, { ignoreGrace: true }), true);

  // The guard also covers the window right after a width report
  // (setSidebarWidth stamps it on every drag move).
  panel.open = true;
  sidebar.setSidebarWidth(ctx, 500, { persist: false });
  assert.equal(sidebar.isSidebarResizeGuardActive(panel), true);
  assert.equal(sidebar.closeSidebarIfUnpinned(ctx, { ignoreGrace: true }), false);
  // And it lifts once the drag flag clears and the guard window passes.
  panel.resizing = false;
  panel.lastResizeAt = Date.now() - 5000;
  assert.equal(sidebar.isSidebarResizeGuardActive(panel), false);
  assert.equal(sidebar.isSidebarResizeGuardActive(panel, Date.now() + 5000), false);
});

test('fix2-1: setSidebarWidth persists the width on release (drag end)', () => {
  const sidebar = require('../src/main/sidebar');
  const storage = makeFakeStorage();
  core.state.storage = storage;
  const ctx = makeFakeCtx();
  sidebar.ensureSidebarPanelState(ctx);

  // Mid-drag reports must NOT persist.
  sidebar.setSidebarWidth(ctx, 500, { persist: false });
  assert.equal(storage._updateCalls.length, 0);
  // Release persists, clamped.
  const state = sidebar.setSidebarWidth(ctx, 900, { persist: true });
  assert.equal(storage._updateCalls.length, 1);
  assert.equal(storage._updateCalls[0].sidebarPanelWidth, 800);
  assert.equal(state.width, 800);
  assert.equal(storage.getSettings().sidebarPanelWidth, 800);
});

test('fix2-4: sidebar service meta carries a load-error state (Discord blank panel)', () => {
  const sidebar = require('../src/main/sidebar');
  const svc = sidebar.SIDEBAR_SERVICES.discord;
  assert.equal(svc.url, 'https://discord.com/app');
  const meta = sidebar.createSidebarServiceMeta(svc, svc.url);
  assert.equal(meta.isLoading, true);
  assert.equal(meta.loadError, '');
  assert.equal(meta.loadTimedOut, false);

  sidebar.setSidebarLoadError(meta, 'ERR_PROXY_CONNECTION_FAILED');
  assert.equal(meta.loadError, 'ERR_PROXY_CONNECTION_FAILED');
  assert.equal(meta.loadTimedOut, false);
  sidebar.clearSidebarLoadError(meta);
  assert.equal(meta.loadError, '');
  assert.equal(meta.loadTimedOut, false);

  // Serialised state exposes the error so the panel chrome can show
  // loading / error / retry UI instead of a blank panel.
  const storage = makeFakeStorage();
  core.state.storage = storage;
  const ctx = makeFakeCtx();
  const panel = sidebar.ensureSidebarPanelState(ctx);
  panel.open = true;
  panel.activeKey = 'discord';
  panel.meta.set('discord', meta);
  sidebar.setSidebarLoadError(meta, 'Timed out while loading');
  meta.loadTimedOut = true;
  const serialised = sidebar.serializeSidebarState(ctx);
  assert.equal(serialised.isLoading, true);
  assert.equal(serialised.loadError, 'Timed out while loading');
  assert.equal(serialised.loadTimedOut, true);
});

// ---------------------------------------------------------------------------
// Items 2 + 10 — Memory Saver visibility + battery saver
// ---------------------------------------------------------------------------

test('fix2-2/10: stats intervals slow down under battery saver', () => {
  const stats = require('../src/main/stats');
  assert.deepEqual(stats.getStatsIntervals({ batterySaverEnabled: false }), { fast: 2500, idle: 15000 });
  assert.deepEqual(stats.getStatsIntervals({ batterySaverEnabled: true }), { fast: 5000, idle: 30000 });
  assert.deepEqual(stats.getStatsIntervals({}), { fast: 2500, idle: 15000 });
});

test('fix2-2/10: effective auto-sleep caps at 2 minutes on battery saver', () => {
  const stats = require('../src/main/stats');
  assert.equal(stats.getEffectiveAutoSleepMs({ autoSleepMinutes: 10 }), 10 * 60 * 1000);
  assert.equal(stats.getEffectiveAutoSleepMs({ autoSleepMinutes: 10, batterySaverEnabled: true }), 2 * 60 * 1000);
  assert.equal(stats.getEffectiveAutoSleepMs({ autoSleepMinutes: 1, batterySaverEnabled: true }), 1 * 60 * 1000);
  assert.equal(stats.getEffectiveAutoSleepMs({}), 10 * 60 * 1000);
});

test('fix2-2: collectSystemStats carries a real memorySaver block', () => {
  const stats = require('../src/main/stats');
  const storage = makeFakeStorage();
  core.state.storage = storage;
  core.windowContexts.clear();
  const collected = stats.collectSystemStats();
  assert.ok(collected.memorySaver);
  assert.equal(collected.memorySaver.sleepingTabsCount, 0);
  assert.equal(collected.memorySaver.hibernatedByLimiterCount, 0);
  assert.equal(typeof collected.memorySaver.lastHibernateAt, 'number');
  assert.equal(collected.memorySaver.autoSleepEnabled, true);
  assert.equal(collected.memorySaver.batterySaverEnabled, false);
  assert.equal(collected.sleepingTabsCount, 0);
  assert.equal(collected.activeTabsCount, 0);
});

test('fix2-2: hibernateNow measures real RAM before/after and sleeps nothing when idle', () => {
  const stats = require('../src/main/stats');
  const storage = makeFakeStorage();
  core.state.storage = storage;
  core.windowContexts.clear();
  const result = stats.hibernateNow();
  assert.equal(typeof result.beforeMB, 'number');
  assert.equal(typeof result.afterMB, 'number');
  assert.equal(result.savedMB, result.beforeMB - result.afterMB);
  assert.equal(result.sleptCount, 0);
  assert.equal(result.sleepingTabsCount, 0);
});

test('fix2-2: gxcontrol exposes real limiter hibernation counts', () => {
  const gxControl = require('../src/main/gxcontrol');
  const s = gxControl.getRamHibernationStats();
  assert.equal(typeof s.hibernatedCount, 'number');
  assert.equal(typeof s.lastHibernateAt, 'number');
  assert.ok(s.hibernatedCount >= 0);
});

// ---------------------------------------------------------------------------
// Items 5 + 11 — omnibox invalidation plumbing + sounds status honesty
// ---------------------------------------------------------------------------

test('fix2-5: shell preload exposes history invalidation; renderer cache fix present', () => {
  const preloadSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  assert.ok(preloadSrc.includes("onHistoryUpdate"));
  assert.ok(preloadSrc.includes("'history:update'"));
  assert.ok(preloadSrc.includes('sidebar:resize-start'));
  assert.ok(preloadSrc.includes('panic:trigger'));
  assert.ok(preloadSrc.includes('tabs:hibernate-now'));
  assert.ok(preloadSrc.includes('gxmods:load'));
  assert.ok(preloadSrc.includes('sounds:get-status'));

  // The renderer-side empty-cache fix (audit #20) is present: an empty
  // history fetch must NOT be cached for 30 s.
  const rendererSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'renderer.js'), 'utf8');
  assert.ok(rendererSrc.includes('Only cache non-empty results'));
  assert.ok(rendererSrc.includes('historyCacheAt = 0'));
});

test('fix2-11: no audio files ship in the repo, so sounds status must say so', () => {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(full);
      } else if (/\.(mp3|wav|ogg)$/i.test(entry.name)) {
        found.push(full);
      }
    }
  };
  walk(path.join(__dirname, '..', 'src'));
  walk(path.join(__dirname, '..', 'gx-extension'));
  assert.deepEqual(found, [], 'unexpected audio files — sounds status wording must be revisited');
  const ipcSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ipc.js'), 'utf8');
  assert.ok(ipcSrc.includes('No sound pack installed'));
  assert.ok(ipcSrc.includes('sounds:get-status'));
  assert.ok(ipcSrc.includes('gxmods:load'));
  assert.ok(ipcSrc.includes('panic:trigger'));
  assert.ok(ipcSrc.includes('tabs:hibernate-now'));
});
