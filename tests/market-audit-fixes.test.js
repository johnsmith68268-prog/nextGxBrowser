const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');

// Electron mock (same pattern as ux-phase.test.js).
function installElectronMock(tmpRoot) {
  const userDataDir = path.join(tmpRoot, 'userData');
  fs.mkdirSync(userDataDir, { recursive: true });
  function makeSession(partition) {
    return {
      partition,
      cookies: { on: () => {} },
      on: () => {},
      setDownloadPath: () => {},
      setPermissionCheckHandler: () => {},
      setPermissionRequestHandler: () => {},
      setDisplayMediaRequestHandler: () => {},
      setDevicePermissionHandler: () => {},
      registerPreloadScript: () => {},
      getPreloadScripts: () => [],
      clearStorageData: async () => {},
      clearCache: async () => {},
      getCacheSize: async () => 0
    };
  }
  const mockElectron = {
    app: {
      getPath: (name) => (name === 'downloads' ? path.join(tmpRoot, 'downloads') : userDataDir),
      getVersion: () => '3.0.0'
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (s) => Buffer.from(s, 'utf8'),
      decryptString: (b) => b.toString('utf8')
    },
    shell: { openPath: async () => '', showItemInFolder: () => {} },
    session: {
      defaultSession: makeSession('default'),
      fromPartition: (partition) => makeSession(partition)
    },
    BrowserWindow: function () {},
    WebContentsView: function () {},
    ipcMain: { handle: () => {}, on: () => {} }
  };
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return mockElectron;
    return origLoad.apply(this, arguments);
  };
  return () => {
    Module._load = origLoad;
  };
}

function freshModules() {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(ROOT + path.sep)) delete require.cache[key];
  }
}

function makeView() {
  const calls = { visible: [], bounds: [] };
  return {
    calls,
    setVisible: (v) => calls.visible.push(v),
    setBounds: (b) => calls.bounds.push(b)
  };
}

function makeCtx() {
  const tabView = makeView();
  const panelView = makeView();
  const popoverView = makeView();
  return {
    ctx: {
      win: {
        isDestroyed: () => false,
        getContentSize: () => [1280, 800],
        focus: () => {},
        contentView: { addChildView: () => {}, removeChildView: () => {} }
      },
      tabs: new Map([['t1', { id: 't1', view: tabView, sleeping: false }]]),
      activeTabId: 't1',
      layoutState: { top: 40, left: 50, right: 0, bottom: 0 },
      sidebarPanel: { open: false, activeKey: null, width: 380, pinned: false, views: new Map() },
      sidebarPanelFrameView: panelView,
      popoverView,
      popoverOpenKind: null,
      extensionPopupView: null,
      screenshotView: null,
      pendingScreenshotDataUrl: null,
      fullscreen: null,
      shellModalOpen: false
    },
    tabView,
    panelView,
    popoverView
  };
}

test('MA-2: opening a shell modal hides every content view; closing restores the active tab', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-ma2-'));
  const restore = installElectronMock(tmpRoot);
  try {
    freshModules();
    const layout = require('../src/main/layout');
    const { ctx, tabView, panelView, popoverView } = makeCtx();

    assert.equal(layout.setShellModalOpen(ctx, true), true);
    assert.equal(ctx.shellModalOpen, true);
    assert.deepEqual(tabView.calls.visible.at(-1), false);
    assert.deepEqual(tabView.calls.bounds.at(-1), { x: -5000, y: -5000, width: 1, height: 1 });
    assert.deepEqual(panelView.calls.visible.at(-1), false);
    assert.deepEqual(popoverView.calls.visible.at(-1), false);

    assert.equal(layout.setShellModalOpen(ctx, false), true);
    assert.equal(ctx.shellModalOpen, false);
    // Active tab view is shown again with real content bounds.
    assert.deepEqual(tabView.calls.visible.at(-1), true);
    const b = tabView.calls.bounds.at(-1);
    assert.equal(b.x, 50);
    assert.equal(b.y, 82); // TOP_CHROME_HEIGHT (tab strip + toolbar)
    assert.equal(b.width, 1230);
    assert.equal(b.height, 718);
  } finally {
    restore();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('MA-2: setShellModalOpen returns false for a destroyed/missing window', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-ma2b-'));
  const restore = installElectronMock(tmpRoot);
  try {
    freshModules();
    const layout = require('../src/main/layout');
    assert.equal(layout.setShellModalOpen(null, true), false);
    assert.equal(
      layout.setShellModalOpen({ win: { isDestroyed: () => true } }, true),
      false
    );
  } finally {
    restore();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('MA-30: rail-context popover kind is registered; shell:open-left-tool IPC + preload exposure exist', () => {
  const popovers = fs.readFileSync(path.join(ROOT, 'src', 'main', 'popovers.js'), 'utf8');
  assert.match(popovers, /'rail-context':\s*\{/, 'rail-context kind spec missing');
  assert.match(popovers, /isMenu: true/, 'rail-context must be a menu popover');

  const ipc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipc.js'), 'utf8');
  assert.match(ipc, /handleInternal\('shell:open-left-tool'/);
  assert.match(ipc, /handleInternal\('shell:set-modal-open'/);
  assert.match(ipc, /handleInternal\('cleaner:get-cache-size'/);

  const preload = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');
  assert.match(preload, /openLeftTool: \(tool\) => ipcRenderer\.invoke\('shell:open-left-tool', tool\)/);
  assert.match(preload, /onOpenLeftTool: \(cb\) => ipcRenderer\.on\('shell:open-left-tool'/);
  assert.match(preload, /setShellModalOpen: \(open\) => ipcRenderer\.invoke\('shell:set-modal-open', Boolean\(open\)\)/);
  assert.match(preload, /getCacheSize: \(\) => ipcRenderer\.invoke\('cleaner:get-cache-size'\)/);

  const popover =
    fs.readFileSync(path.join(ROOT, 'src', 'ui', 'popover.html'), 'utf8') +
    '\n' +
    fs.readFileSync(path.join(ROOT, 'src', 'ui', 'popover.js'), 'utf8');
  assert.match(popover, /id="view-rail-context"/);
  assert.match(popover, /kind === 'rail-context'/);
  // showOnly() must list the new view or it stays hidden forever (the menu
  // "opened" in main but rendered as an empty box).
  const showOnlyFn = popover.match(/function showOnly\(viewId\) \{[\s\S]*?\n    \}/);
  assert.ok(showOnlyFn, 'showOnly not found');
  assert.ok(showOnlyFn[0].includes("'view-rail-context'"), 'showOnly() does not list view-rail-context');
  assert.match(popover, /data-rail-act="open"/);
  assert.match(popover, /data-rail-act="hide"/);
  assert.match(popover, /data-rail-act="customize"/);

  const renderer = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'renderer.js'), 'utf8');
  assert.match(renderer, /nxSidebarEl\.addEventListener\('contextmenu'/);
  assert.match(renderer, /kind: 'rail-context'/);
  assert.match(renderer, /onOpenLeftTool\?\.\(\(tool\) =>/);
});

test('MA-1/MA-39: omnibox suggestion favicon no longer uses the broken inline onerror', () => {
  const popover =
    fs.readFileSync(path.join(ROOT, 'src', 'ui', 'popover.html'), 'utf8') +
    '\n' +
    fs.readFileSync(path.join(ROOT, 'src', 'ui', 'popover.js'), 'utf8');
  assert.ok(
    !popover.includes("this.outerHTML='<span"),
    'broken outerHTML inline handler still present in popover.html'
  );
  assert.ok(
    !/onerror="[^"]*outerHTML/.test(popover),
    'an outerHTML inline handler remains in popover.html'
  );
  // The DOM-based replacement is present (error listener swapping in the
  // fallback icon) in both the omnibox and tab-search renderers.
  assert.match(popover, /img\.addEventListener\('error', \(\) => \{\s*\n?\s*img\.replaceWith\(iconEl\);/);
  assert.match(popover, /img\.replaceWith\(globeEl\);/);
});

test('MA-33: tab-search rows no longer hide a dead favicon with no fallback and no longer tooltip raw nextgx:// URLs', () => {
  const popover =
    fs.readFileSync(path.join(ROOT, 'src', 'ui', 'popover.html'), 'utf8') +
    '\n' +
    fs.readFileSync(path.join(ROOT, 'src', 'ui', 'popover.js'), 'utf8');
  assert.ok(
    !popover.includes("onerror=\"this.style.display='none'\""),
    'tab-search dead-favicon hide with no fallback still present'
  );
  assert.ok(popover.includes('const isInternal = !t.url'), 'tab-search internal-URL check missing');
  assert.ok(popover.includes('if (!isInternal) openBtn.title = t.url;'), 'tab-search tooltip guard missing');
});

test('MA-9: tab context menu resolves the LIVE tab from currentState (stale closure showed Pop out video disabled while a video played)', () => {
  const renderer = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'renderer.js'), 'utf8');
  assert.match(
    renderer,
    /const liveTab = liveState\.tabs\?\.find\(\(t\) => t\.id === tab\.id\) \|\| tab;/
  );
  assert.match(renderer, /hasPlayingVideo: Boolean\(liveTab\.hasPlayingVideo\)/);
  assert.match(renderer, /pipActive: Boolean\(liveTab\.pipActive\)/);
  assert.match(renderer, /videoTitle: liveTab\.videoTitle \|\| ''/);
});

test('MA-22: History "By group" returns the full IP host instead of a shortened label', () => {
  const chromeWebui = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'chrome-webui.js'), 'utf8');
  assert.match(chromeWebui, /\/\^\\d\{1,3\}\(\\\.\\d\{1,3\}\)\{3\}\$\/\.test\(h\)/);
  assert.match(chromeWebui, /return h;/);
});

test('MA-20: omnibox history cache does not cache empty results', () => {
  const renderer = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'renderer.js'), 'utf8');
  assert.match(renderer, /if \(historyCache\.length\) historyCacheAt = now;/);
  assert.match(renderer, /else historyCacheAt = 0;/);
});

test('MA-17: sidebar resizer reset uses manual double-press detection (dblclick is swallowed by pointer capture)', () => {
  const renderer = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'renderer.js'), 'utf8');
  assert.match(renderer, /lastResizerPointerDownAt/);
  assert.match(renderer, /now - lastResizerPointerDownAt < 400/);
  assert.ok(
    !/sidebarPanelResizer\.addEventListener\('dblclick'/.test(renderer),
    'dead dblclick listener still present on the resizer'
  );
});

test('MA-12: toast is a fixed overlay, not an in-flow titlebar item', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'styles.css'), 'utf8');
  const toastRule = css.match(/\.nx-toast \{[^}]*\}/);
  assert.ok(toastRule, '.nx-toast rule missing');
  assert.match(toastRule[0], /position: fixed;/);
  assert.match(toastRule[0], /z-index: 9999;/);
});

test('MA-13/MA-14: pinned favicon fallback listener and collapsed-pill active-tab markup exist', () => {
  const renderer = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'renderer.js'), 'utf8');
  assert.match(renderer, /classList\.contains\('tab-favicon'\)/);
  assert.match(renderer, /tab-favicon-fallback/);
  assert.match(renderer, /group-active-tab/);
  assert.match(renderer, /group-active-favicon/);
  const css = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'styles.css'), 'utf8');
  assert.match(css, /\.group-active-tab \{/);
  assert.match(css, /\.nx-sidebar\.nx-panel-open\.rail-hover-expand:hover \{/);
});

test('MA-24/MA-25: Speed Dial delete shows an undo bar; tile titles allow two lines', () => {
  const newtab =
    fs.readFileSync(path.join(ROOT, 'src', 'ui', 'newtab.html'), 'utf8') +
    '\n' +
    fs.readFileSync(path.join(ROOT, 'src', 'ui', 'newtab.js'), 'utf8');
  assert.match(newtab, /id="dialUndoBar"/);
  assert.match(newtab, /function showDialUndo\(removed\)/);
  assert.match(newtab, /addSpeedDial\(\{ title: removed\.title, url: removed\.url \}\)/);
  assert.match(newtab, /-webkit-line-clamp: 2;/);
});

test('MA-10/MA-34/MA-27/MA-28: sticky chrome-pages nav, split shortcut chips, Media toggle note, no duplicated shortcuts card', () => {
  const chromeHtml = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'chrome-webui.html'), 'utf8');
  const navRule = chromeHtml.match(/\.webui-nav \{[^}]*\}/);
  assert.ok(navRule, '.webui-nav rule missing');
  assert.match(navRule[0], /position: sticky;/);
  assert.match(navRule[0], /height: 100vh;/);
  const kbdRule = chromeHtml.match(/\.nx-kbd \{[^}]*\}/);
  assert.ok(kbdRule, '.nx-kbd rule missing');
  assert.match(kbdRule[0], /padding: 3px 9px;/);

  const chromeWebui = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'chrome-webui.js'), 'utf8');
  assert.match(chromeWebui, /\['Split view divider: resize \(when focused\)', '← →'\]/);
  assert.match(chromeWebui, /\['Split view divider: centre \(when focused\)', 'Home'\]/);
  assert.match(chromeWebui, /Always on — a core part of nextGx, so it cannot be turned off\./);
  assert.match(chromeWebui, /id="btnExtShortcutsSettings"/);
  assert.ok(
    !chromeWebui.includes('const shortcutRows = ['),
    'Extensions page still defines its own full shortcuts list'
  );
});

test('MA-15/MA-16: opening a left drawer collapses the expanded rail (z-35 overlay vs z-22 drawer)', () => {
  const renderer = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'renderer.js'), 'utf8');
  const openLeft = renderer.match(/function openLeftTool\(toolName\) \{[\s\S]*?\n\}/);
  assert.ok(openLeft, 'openLeftTool not found');
  assert.ok(openLeft[0].includes("nxSidebarEl.classList.add('nx-panel-open')"), 'drawer open does not suppress rail expand');
  assert.ok(openLeft[0].includes('setRailExpanded(false)'), 'drawer open does not collapse the expanded rail');
  const closeLeft = renderer.match(/function closeLeftTool\(\) \{[\s\S]*?\n\}/);
  assert.ok(closeLeft, 'closeLeftTool not found');
  assert.ok(closeLeft[0].includes("nxSidebarEl.classList.remove('nx-panel-open')"), 'drawer close does not restore rail expand');
  // The suppression rule must also reset position: the hover-expand rule
  // sets position:absolute, which pulls the rail out of flex flow and lets
  // the drawer slide to x=0 underneath it.
  const css = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'styles.css'), 'utf8');
  const suppress = css.match(/\.nx-sidebar\.nx-panel-open\.rail-hover-expand:hover \{[\s\S]*?\n\}/);
  assert.ok(suppress, 'nx-panel-open hover rule not found');
  assert.ok(suppress[0].includes('position: static'), 'suppression rule does not reset position to static');
});

test('MA-36: Cleaner drawer shows a live cache-size readout and a what-gets-cleaned section', () => {
  const index = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'index.html'), 'utf8');
  assert.match(index, /id="cleanerCacheSizeText"/);
  assert.match(index, /What Gets Cleaned/);
  const renderer = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'renderer.js'), 'utf8');
  assert.match(renderer, /function refreshCleanerCacheSize\(\)/);
  assert.match(renderer, /refreshCleanerCacheSize\(\);/);
});
