const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');

// Electron mock (same pattern as coding-phase.test.js), extended with the
// session methods setupPermissionsForSession / setupDownloadListener need.
function installElectronMock(tmpRoot) {
  const userDataDir = path.join(tmpRoot, 'userData');
  fs.mkdirSync(userDataDir, { recursive: true });
  const sessionsByPartition = new Map();
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
      clearCache: async () => {}
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
      fromPartition: (partition) => {
        if (!sessionsByPartition.has(partition)) {
          sessionsByPartition.set(partition, makeSession(partition));
        }
        return sessionsByPartition.get(partition);
      }
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

test('UX-1: sidebar panel range is 260–1600px (up to 75% window width) in every copy of the clamp', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-ux1-'));
  const restore = installElectronMock(tmpRoot);
  try {
    freshModules();
    const { StorageManager } = require('../src/storage');
    const storage = new StorageManager({ dataDir: path.join(tmpRoot, 'data') });
    assert.equal(storage._clampSidebarPanelWidth(100), 260, 'below min clamps to 260');
    assert.equal(storage._clampSidebarPanelWidth(380), 380, 'default survives');
    assert.equal(storage._clampSidebarPanelWidth(1800), 1600, 'above max clamps to 1600');
    assert.equal(storage._clampSidebarPanelWidth(1344), 1344, '70% of 1920px screen is allowed');

    const core = require('../src/main/core');
    assert.equal(core.SIDEBAR_PANEL_MIN_WIDTH, 260);
    assert.equal(core.SIDEBAR_PANEL_MAX_WIDTH, 1600);
    assert.equal(core.SIDEBAR_PANEL_RESIZER_WIDTH, 12, 'resizer hit-area widened from 7px');

    const layout = require('../src/main/layout');
    assert.equal(layout.clampSidebarPanelWidthForWindow(1800, 2400), 1600);
    assert.equal(layout.clampSidebarPanelWidthForWindow(1400, 1000), 750, '75%-of-window cap binds on a 1000px window');
    assert.equal(layout.clampSidebarPanelWidthForWindow(300, 1000), 300);
    assert.equal(layout.clampSidebarPanelWidthForWindow(100, 2000), 260);

    const renderer = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'renderer.js'), 'utf8');
    assert.match(renderer, /SIDEBAR_PANEL_MIN_WIDTH = 260/);
    assert.match(renderer, /SIDEBAR_PANEL_MAX_WIDTH = 1600/);
    const chrome = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'sidebar-panel-chrome.html'), 'utf8');
    assert.match(chrome, /SIDEBAR_PANEL_MIN_WIDTH = 260/);
    assert.match(chrome, /SIDEBAR_PANEL_MAX_WIDTH = 1600/);
    const css = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'styles.css'), 'utf8');
    assert.match(css, /min-width: 260px/);
    assert.match(css, /max-width: 1600px/);
  } finally {
    restore();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('UX-2: profile switch focuses an existing window instead of opening a new one', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-ux2-'));
  const restore = installElectronMock(tmpRoot);
  try {
    freshModules();
    const core = require('../src/main/core');
    const { StorageManager } = require('../src/storage');
    const storage = new StorageManager({ dataDir: path.join(tmpRoot, 'data') });
    core.state.storage = storage;
    const profiles = require('../src/main/profiles');

    const created = storage.createProfile({ name: 'Work', color: 'cyan' });
    assert.ok(created.ok, 'profile creates');
    const pid = created.profile.id;

    let focused = false;
    let restored = false;
    const fakeWin = {
      id: 7,
      isDestroyed: () => false,
      isMinimized: () => true,
      isVisible: () => false,
      webContents: { send: () => {}, isDestroyed: () => false },
      restore: () => { restored = true; },
      show: () => {},
      focus: () => { focused = true; },
      moveTop: () => {}
    };
    core.windowContexts.set(7, { win: fakeWin, profileId: pid, incognito: false, tabs: new Map() });
    // Incognito windows must never count as the profile's window.
    core.windowContexts.set(8, {
      win: { id: 8, isDestroyed: () => false, isMinimized: () => false, isVisible: () => true, focus: () => {}, webContents: { send: () => {}, isDestroyed: () => false } },
      profileId: pid,
      incognito: true,
      tabs: new Map()
    });

    assert.equal(profiles.findExistingProfileWindow(pid).win.id, 7);
    assert.equal(profiles.findExistingProfileWindow('no-such-profile'), null);
    assert.deepEqual(profiles.listOpenProfileIds(), [pid]);

    const res = profiles.switchProfileAndOpenWindow(pid);
    assert.equal(res.ok, true);
    assert.equal(res.focusedExisting, true, 'must report that it focused, not created');
    assert.equal(res.focusedWindowId, 7);
    assert.equal(res.createdWindowId, null, 'must NOT create a new window');
    assert.equal(focused, true, 'existing window was focused');
    assert.equal(restored, true, 'minimised window was restored');

    // listProfilesData advertises the open window so the UI can say "Focus".
    const data = profiles.listProfilesData({ profileId: pid });
    assert.deepEqual(data.openProfileIds, [pid]);
  } finally {
    restore();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('UX-3: restore picks the first saved window with tabs, and nothing when empty', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-ux3-'));
  const restore = installElectronMock(tmpRoot);
  try {
    freshModules();
    const profiles = require('../src/main/profiles');
    const withTabs = { windows: [{ tabs: [{ url: 'https://example.com' }], activeTabIndex: 0 }] };
    assert.deepEqual(profiles.pickRestoreWindow(withTabs), withTabs.windows[0]);
    assert.equal(profiles.pickRestoreWindow({ windows: [{ tabs: [] }] }), null);
    assert.equal(profiles.pickRestoreWindow({ windows: [] }), null);
    assert.equal(profiles.pickRestoreWindow(null), null);
    assert.equal(profiles.pickRestoreWindow(undefined), null);
    // An empty first window must not shadow a later window that has tabs.
    const mixed = { windows: [{ tabs: [] }, { tabs: [{ url: 'https://example.com' }] }] };
    assert.deepEqual(profiles.pickRestoreWindow(mixed), mixed.windows[1]);
  } finally {
    restore();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('UX-4: Speed Dial edit round-trips title and URL', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-ux4-'));
  const restore = installElectronMock(tmpRoot);
  try {
    freshModules();
    const { StorageManager } = require('../src/storage');
    const storage = new StorageManager({ dataDir: path.join(tmpRoot, 'data') });
    const added = storage.addSpeedDial({ title: 'Old', url: 'example.com' });
    const id = added[added.length - 1].id;
    const updated = storage.updateSpeedDial(id, { title: 'New', url: 'https://twitch.tv' });
    const item = updated.find((s) => s.id === id);
    assert.equal(item.title, 'New');
    assert.equal(item.url, 'https://twitch.tv');
    assert.equal(item.domain, 'twitch.tv');
    assert.equal(storage.updateSpeedDial('no-such-id', { title: 'X', url: 'https://x.com' }).length, updated.length);
  } finally {
    restore();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('UX-5: the shared New Profile modal exists in the shell and both entry points open it', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'index.html'), 'utf8');
  assert.match(indexHtml, /id="profileModalBackdrop"/);
  assert.match(indexHtml, /id="profileModalForm"/);
  assert.match(indexHtml, /id="profileModalName"/);
  assert.match(indexHtml, /id="profileModalSwatches"/);
  assert.match(indexHtml, /id="profileModalAvatars"/);
  assert.match(indexHtml, /id="profileModalSwitchAfter"/);
  assert.match(indexHtml, /Create &amp; Switch/);
  // Modal markup must come BEFORE the script tags, or the renderer sees nulls.
  assert.ok(
    indexHtml.indexOf('profileModalBackdrop') < indexHtml.indexOf('renderer.js'),
    'modal markup must precede renderer.js'
  );
  // Rail expand toggle + labels.
  assert.match(indexHtml, /id="btnRailExpand"/);
  assert.match(indexHtml, /data-label="GX Control"/);

  const renderer = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'renderer.js'), 'utf8');
  assert.match(renderer, /function openProfileModal\(\)/);
  assert.match(renderer, /function closeProfileModal\(\)/);
  assert.match(renderer, /onOpenCreateProfileModal/);
  assert.match(renderer, /reopenLastClosedTab/);
  assert.match(renderer, /tab-loading-spinner/);
  assert.match(renderer, /sidebarResizeBadge/);
  assert.match(renderer, /dblclick/);

  const webui = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'chrome-webui.js'), 'utf8');
  assert.match(webui, /openCreateProfileModal/);
  assert.match(webui, /Focus Window/);
  assert.match(webui, /showWebuiConfirmModal/);
  assert.match(webui, /nx-empty-state/);
  assert.match(webui, /Keyboard shortcuts/);

  const popover = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'popover.html'), 'utf8');
  assert.match(popover, /openCreateProfileModal/);
  assert.match(popover, /Open — click to focus/);
  assert.match(popover, /os-favicon/);

  // Rail labels: the SERVICE_LOGOS injection must re-add the label span it
  // replaces, or expanded-rail labels vanish for service buttons.
  assert.match(renderer, /sidebar-label/);
  assert.match(renderer, /btn\.querySelector\('\.sidebar-label'\)\.textContent = labelText/);

  const preload = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');
  assert.match(preload, /openCreateProfileModal/);
  assert.match(preload, /onOpenCreateProfileModal/);
  assert.match(preload, /reopenLastClosedTab/);

  const profilesJs = fs.readFileSync(path.join(ROOT, 'src', 'main', 'profiles.js'), 'utf8');
  assert.match(profilesJs, /findExistingProfileWindow/);
  assert.match(profilesJs, /focusedExisting/);
  assert.match(profilesJs, /pickRestoreWindow/);
});

test('UX-6: earlier fixes are untouched — adblock scriptlet, GX loader, cert proceed, split view', () => {
  const preload = fs.readFileSync(path.join(ROOT, 'src', 'tab-preload.js'), 'utf8');
  assert.match(preload, /initYouTubeAdStrip/);
  assert.match(preload, /adPlacements/);
  const main = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
  assert.match(main, /loadBundledGxExtension|gx-extension/);
  const errorHtml = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'error.html'), 'utf8');
  assert.match(errorHtml, /Proceed anyway/);
  const split = fs.readFileSync(path.join(ROOT, 'src', 'main', 'splitview.js'), 'utf8');
  assert.match(split, /function toggleSplit|toggleSplit/);
  assert.match(split, /computeSplitPaneBounds/);
});
