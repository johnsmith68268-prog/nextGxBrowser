const test = require('node:test');
const { beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { EventEmitter } = require('node:events');

// ---------------------------------------------------------------------------
// Electron mock (installed before any app module is required). Same pattern as
// tests/audit-fixes.test.js, extended with Menu/dialog/clipboard/nativeImage
// so the context-menu, clipboard and screenshot modules can run hermetically.
// ---------------------------------------------------------------------------

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nextgx-new-modules-test-'));
const downloadsDir = path.join(tmpRoot, 'downloads');
const userDataDir = path.join(tmpRoot, 'userData');
fs.mkdirSync(downloadsDir, { recursive: true });
fs.mkdirSync(userDataDir, { recursive: true });

// Captured Menu templates, in build order.
const capturedMenus = [];
const popupCalls = [];

class FakeClipboardItem {
  constructor(map) {
    this.map = map;
  }
}

function makeClipboardMock() {
  return {
    text: '',
    writtenItems: [],
    writtenImages: [],
    createdImages: [],
    readText: async function () {
      return this.text;
    },
    writeText: async function (t) {
      this.text = String(t);
    },
    write: async function (items) {
      this.writtenItems.push(...items);
    },
    writeImage: function (image) {
      this.writtenImages.push(image);
    }
  };
}

const mockElectron = {
  app: {
    getPath: (name) => (name === 'downloads' ? downloadsDir : userDataDir),
    getVersion: () => '3.0.0'
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
  dialog: {
    showSaveDialog: async () => ({ canceled: true })
  },
  Menu: {
    buildFromTemplate(template) {
      capturedMenus.push(template);
      return {
        popup: (opts) => {
          popupCalls.push(opts || {});
        }
      };
    }
  },
  clipboard: makeClipboardMock(),
  ClipboardItem: FakeClipboardItem,
  // S-2: permissions.js now registers a display-media handler backed by
  // desktopCapturer; the mock returns one primary screen.
  desktopCapturer: {
    getSources: async () => [{ id: 'screen:0:0', name: 'Primary display' }]
  },
  nativeImage: {
    createFromBuffer: (buf) => ({ __fakeNativeImage: true, bytes: buf.length })
  }
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return mockElectron;
  return origLoad.apply(this, arguments);
};

// App modules under test (required after the Electron mock is installed).
const { state, windowContexts, webContentsToWinId, ERROR_PAGE_FILE_URL, NEW_TAB_FILE_URL } = require('../src/main/core');
const { attachWebContentsContextMenu, attachChromeContextMenu } = require('../src/main/context-menu');
const {
  setupPermissionsForSession,
  resolvePermissionPrompt,
  onPermissionPopoverClosed,
  cancelPendingPermissionsForWindow
} = require('../src/main/permissions');
const { readClipboardText, writeClipboardText, writeClipboardPng } = require('../src/main/clipboard-utils');
const {
  captureFullPagePng,
  copyScreenshotPng,
  saveScreenshotPng,
  saveScreenshotWithDialog,
  savePageAsPdf
} = require('../src/main/screenshots');
const {
  SIDEBAR_SERVICES,
  clampSidebarWidth,
  ensureSidebarPanelState,
  resolveSidebarService,
  suspendSidebarServiceView,
  suspendIdleSidebarViews
} = require('../src/main/sidebar');

test.after(() => {
  Module._load = origLoad;
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (_) {}
});

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function makeStorage() {
  return {
    settings: {},
    sitePerms: {},
    setPermCalls: [],
    downloads: [],
    getSettings() {
      return this.settings;
    },
    getActiveProfileId: () => 'default',
    getSitePermissions(origin) {
      return (
        this.sitePerms[origin] || {
          camera: 'ask',
          microphone: 'ask',
          geolocation: 'ask',
          notifications: 'ask'
        }
      );
    },
    setSitePermission(origin, key, value) {
      this.setPermCalls.push({ origin, key, value });
      if (!this.sitePerms[origin]) this.sitePerms[origin] = {};
      this.sitePerms[origin][key] = value;
    },
    getWorkspaces: () => [{ id: 'default', name: 'Default', icon: '', color: '', createdAt: 0 }],
    getTabGroups: () => [],
    getDownloads() {
      return this.downloads;
    },
    upsertDownload(dl) {
      this.downloads.push(dl);
    },
    addSpeedDial() {},
    toggleBookmark: () => ({ bookmarks: [], added: true }),
    updateSettings(patch) {
      Object.assign(this.settings, patch);
      return this.settings;
    }
  };
}

class FakeWebContents extends EventEmitter {
  constructor({ id = 1, url = 'https://example.com', title = 'Example' } = {}) {
    super();
    this.id = id;
    this._url = url;
    this._title = title;
    this.destroyed = false;
    this.loading = false;
    this.focused = false;
    this.audible = false;
    this.sent = [];
    this.calls = [];
    this.canGoBackValue = false;
    this.canGoForwardValue = false;
    this.pdfBuffer = Buffer.from('%PDF-fake');
    this.debugger = {
      attached: false,
      sendCommandResult: { data: '' },
      sendCommandError: null,
      isAttached: function () {
        return this.attached;
      },
      attach: function () {
        this.attached = true;
      },
      detach: function () {
        this.attached = false;
      },
      sendCommand: async function () {
        if (this.sendCommandError) throw this.sendCommandError;
        return this.sendCommandResult;
      }
    };
  }

  isDestroyed() {
    return this.destroyed;
  }
  getURL() {
    return this._url;
  }
  getTitle() {
    return this._title;
  }
  send(channel, ...args) {
    this.sent.push({ channel, args });
  }
  isLoading() {
    return this.loading;
  }
  isFocused() {
    return this.focused;
  }
  focus() {
    this.calls.push('focus');
  }
  canGoBack() {
    return this.canGoBackValue;
  }
  canGoForward() {
    return this.canGoForwardValue;
  }
  reload() {
    this.calls.push('reload');
  }
  goBack() {
    this.calls.push('goBack');
  }
  goForward() {
    this.calls.push('goForward');
  }
  undo() {
    this.calls.push('undo');
  }
  redo() {
    this.calls.push('redo');
  }
  cut() {
    this.calls.push('cut');
  }
  copy() {
    this.calls.push('copy');
  }
  paste() {
    this.calls.push('paste');
  }
  pasteAndMatchStyle() {
    this.calls.push('pasteAndMatchStyle');
  }
  delete() {
    this.calls.push('delete');
  }
  selectAll() {
    this.calls.push('selectAll');
  }
  inspectElement(x, y) {
    this.calls.push(`inspectElement:${x},${y}`);
  }
  copyImageAt(x, y) {
    this.calls.push(`copyImageAt:${x},${y}`);
  }
  downloadURL(url) {
    this.calls.push(`downloadURL:${url}`);
  }
  replaceMisspelling(word) {
    this.calls.push(`replaceMisspelling:${word}`);
  }
  print() {
    this.calls.push('print');
  }
  close() {
    this.destroyed = true;
    this.calls.push('close');
  }
  isCurrentlyAudible() {
    return this.audible;
  }
  async printToPDF() {
    this.calls.push('printToPDF');
    return this.pdfBuffer;
  }
}

function makeWin({ id = 1 } = {}) {
  const win = {
    id,
    webContents: new FakeWebContents({ id: id * 1000, url: 'file:///src/ui/index.html', title: 'nextGx' }),
    destroyed: false,
    fullScreen: false,
    children: [],
    removedViews: [],
    isDestroyed() {
      return this.destroyed;
    },
    isFullScreen() {
      return this.fullScreen;
    },
    setFullScreen(v) {
      this.fullScreen = v;
    },
    getContentSize() {
      return [1280, 800];
    },
    focus() {},
    on() {},
    removeListener() {},
    contentView: {
      addChildView(view) {
        win.children.push(view);
      },
      removeChildView(view) {
        win.children = win.children.filter((c) => c !== view);
        win.removedViews.push(view);
      }
    }
  };
  return win;
}

function makeCtx({ win, profileId = 'default', incognito = false } = {}) {
  return {
    win: win || makeWin(),
    profileId,
    incognito,
    tabs: new Map(),
    tabOrder: [],
    activeTabId: null,
    activeWorkspaceId: 'default',
    layoutState: { left: 50, top: 84 },
    popoverView: null,
    popoverOpenKind: null,
    popoverPayload: null,
    popoverAnchor: null,
    popoverLastSize: null,
    sidebarPanel: null
  };
}

function makePopoverView() {
  const wc = new FakeWebContents({ id: 777, url: 'file:///src/ui/popover.html', title: 'Popover' });
  return {
    webContents: wc,
    bounds: null,
    visible: false,
    setVisible(v) {
      this.visible = v;
    },
    setBounds(b) {
      this.bounds = b;
    },
    setBackgroundColor() {}
  };
}

function makeSession() {
  return {
    checkHandler: null,
    requestHandler: null,
    displayMediaHandler: null,
    setPermissionCheckHandler(fn) {
      this.checkHandler = fn;
    },
    setPermissionRequestHandler(fn) {
      this.requestHandler = fn;
    },
    setDisplayMediaRequestHandler(fn) {
      this.displayMediaHandler = fn;
    }
  };
}

function labelsOf(template) {
  return template.filter((item) => item.label).map((item) => item.label);
}

function itemByLabel(template, label) {
  return template.find((item) => item.label === label);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  state.storage = makeStorage();
});

afterEach(() => {
  // Deny any prompt still active so no test leaks a pending callback/timer.
  for (const ctx of windowContexts.values()) {
    try {
      cancelPendingPermissionsForWindow(ctx);
    } catch (_) {}
  }
  windowContexts.clear();
  webContentsToWinId.clear();
  capturedMenus.length = 0;
  popupCalls.length = 0;
  mockElectron.clipboard = makeClipboardMock();
  mockElectron.ClipboardItem = FakeClipboardItem;
  mockElectron.dialog.showSaveDialog = async () => ({ canceled: true });
  state.storage = makeStorage();
});

// ---------------------------------------------------------------------------
// s-14: context menu
// ---------------------------------------------------------------------------

test('s-14 / context menu: plain page menu has navigation, bookmark and inspect items with correct enabled state', () => {
  const ctx = makeCtx();
  const wc = new FakeWebContents({ url: 'https://example.com/article', title: 'Article' });
  wc.canGoBackValue = false;
  wc.canGoForwardValue = true;
  attachWebContentsContextMenu(ctx, wc);

  wc.emit('context-menu', {}, {
    pageURL: 'https://example.com/article',
    selectionText: '',
    isEditable: false,
    mediaType: 'none',
    x: 10,
    y: 10
  });

  assert.equal(capturedMenus.length, 1, 'one menu should be built');
  assert.equal(popupCalls.length, 1, 'menu should be popped up');
  const labels = labelsOf(capturedMenus[0]);
  for (const expected of [
    'Back',
    'Forward',
    'Reload',
    'Add to Speed Dial',
    'Add to bookmarks...',
    'Enter full screen',
    'Copy address',
    'Save as...',
    'Save as PDF...',
    'Force dark page',
    'Print...',
    'View page source',
    'Inspect element'
  ]) {
    assert.ok(labels.includes(expected), `menu should include "${expected}"`);
  }
  assert.equal(itemByLabel(capturedMenus[0], 'Back').enabled, false);
  assert.equal(itemByLabel(capturedMenus[0], 'Forward').enabled, true);
  assert.equal(itemByLabel(capturedMenus[0], 'Add to bookmarks...').enabled, true);
  assert.equal(itemByLabel(capturedMenus[0], 'View page source').enabled, true);

  // Clicking Reload acts on the webContents.
  itemByLabel(capturedMenus[0], 'Reload').click();
  assert.ok(wc.calls.includes('reload'));
});

test('s-14 / context menu: link actions appear only for http(s) links', () => {
  const ctx = makeCtx();
  const wc = new FakeWebContents({ url: 'https://example.com' });
  attachWebContentsContextMenu(ctx, wc);

  wc.emit('context-menu', {}, {
    pageURL: 'https://example.com',
    linkURL: 'https://example.com/doc',
    isEditable: false,
    mediaType: 'none',
    x: 5,
    y: 5
  });
  const httpLabels = labelsOf(capturedMenus[0]);
  for (const expected of ['Open link in new tab', 'Open link in new window', 'Open link in Private window', 'Copy link address']) {
    assert.ok(httpLabels.includes(expected), `menu should include "${expected}" for an https link`);
  }

  wc.emit('context-menu', {}, {
    pageURL: 'https://example.com',
    linkURL: 'javascript:alert(1)',
    isEditable: false,
    mediaType: 'none',
    x: 5,
    y: 5
  });
  const jsLabels = labelsOf(capturedMenus[1]);
  assert.ok(!jsLabels.includes('Open link in new tab'), 'javascript: links must not get link actions');
  assert.ok(!jsLabels.includes('Copy link address'));
});

test('s-14 / context menu: image actions offer save/copy and Copy image targets the click point', () => {
  const ctx = makeCtx();
  const wc = new FakeWebContents({ url: 'https://example.com/gallery' });
  attachWebContentsContextMenu(ctx, wc);

  wc.emit('context-menu', {}, {
    pageURL: 'https://example.com/gallery',
    srcURL: 'https://example.com/pic.png',
    mediaType: 'image',
    isEditable: false,
    x: 42,
    y: 77
  });

  const labels = labelsOf(capturedMenus[0]);
  for (const expected of ['Open image in new tab', 'Save image as...', 'Copy image', 'Copy image address']) {
    assert.ok(labels.includes(expected), `menu should include "${expected}" for an image`);
  }
  itemByLabel(capturedMenus[0], 'Copy image').click();
  assert.ok(wc.calls.includes('copyImageAt:42,77'));
});

test('s-14 / context menu: editable fields get edit actions and at most 5 spellcheck suggestions', () => {
  const ctx = makeCtx();
  const wc = new FakeWebContents({ url: 'https://example.com/form' });
  attachWebContentsContextMenu(ctx, wc);

  wc.emit('context-menu', {}, {
    pageURL: 'https://example.com/form',
    isEditable: true,
    misspelledWord: 'teh',
    dictionarySuggestions: ['the', 'tea', 'ten', 'tech', 'team', 'tear', 'tell'],
    editFlags: { canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: true, canDelete: false, canSelectAll: true },
    selectionText: 'hello',
    x: 1,
    y: 1
  });

  const template = capturedMenus[0];
  const labels = labelsOf(template);
  // Only the first 5 suggestions are shown.
  for (const word of ['the', 'tea', 'ten', 'tech', 'team']) {
    assert.ok(labels.includes(word), `suggestion "${word}" should be shown`);
  }
  assert.ok(!labels.includes('tear'), '6th suggestion must be dropped');
  assert.ok(!labels.includes('tell'), '7th suggestion must be dropped');

  assert.equal(itemByLabel(template, 'Undo').enabled, true);
  assert.equal(itemByLabel(template, 'Redo').enabled, false);
  assert.equal(itemByLabel(template, 'Delete').enabled, false);
  assert.ok(labels.includes('Paste as plain text'));
  assert.ok(labels.includes('Search Google for "hello"'));

  itemByLabel(template, 'the').click();
  assert.ok(wc.calls.includes('replaceMisspelling:the'));
  itemByLabel(template, 'Undo').click();
  assert.ok(wc.calls.includes('undo'));
});

test('s-14 / context menu: error/internal pages disable bookmark, speed-dial and view-source; sidebar disables Save as', () => {
  const ctx = makeCtx();
  const wc = new FakeWebContents({ url: ERROR_PAGE_FILE_URL });
  attachWebContentsContextMenu(ctx, wc);

  wc.emit('context-menu', {}, {
    pageURL: ERROR_PAGE_FILE_URL,
    isEditable: false,
    mediaType: 'none',
    x: 1,
    y: 1
  });
  let template = capturedMenus[0];
  assert.equal(itemByLabel(template, 'Add to bookmarks...').enabled, false, 'error page must not be bookmarkable');
  assert.equal(itemByLabel(template, 'Add to Speed Dial').enabled, false);
  assert.equal(itemByLabel(template, 'View page source').enabled, false);

  wc.emit('context-menu', {}, {
    pageURL: NEW_TAB_FILE_URL,
    isEditable: false,
    mediaType: 'none',
    x: 1,
    y: 1
  });
  template = capturedMenus[1];
  assert.equal(itemByLabel(template, 'Add to bookmarks...').enabled, false, 'internal new-tab page must not be bookmarkable');

  // Sidebar views must not offer Save as / Save as PDF.
  const sidebarCtx = makeCtx();
  const sidebarWc = new FakeWebContents({ url: 'https://www.youtube.com' });
  attachWebContentsContextMenu(sidebarCtx, sidebarWc, { isSidebar: true });
  sidebarWc.emit('context-menu', {}, {
    pageURL: 'https://www.youtube.com',
    isEditable: false,
    mediaType: 'none',
    x: 1,
    y: 1
  });
  template = capturedMenus[2];
  assert.equal(itemByLabel(template, 'Save as...').enabled, false);
  assert.equal(itemByLabel(template, 'Save as PDF...').enabled, false);
});

test('s-14 / chrome context menu: address bar offers Paste and go for a URL clipboard, Paste and search otherwise', async () => {
  const ctx = makeCtx();
  ctx._lastChromeContextTarget = 'address-bar';
  mockElectron.clipboard.text = 'https://example.com/search?q=x';
  attachChromeContextMenu(ctx);

  ctx.win.webContents.emit('context-menu', {}, {
    isEditable: true,
    editFlags: { canUndo: false, canCut: false, canCopy: false, canPaste: true, canSelectAll: true },
    x: 100,
    y: 50
  });
  await sleep(20);
  assert.equal(capturedMenus.length, 1);
  let labels = labelsOf(capturedMenus[0]);
  assert.ok(labels.includes('Paste and go'), 'URL clipboard should offer Paste and go');
  assert.ok(labels.includes('Edit search engines...'));

  ctx._lastChromeContextTarget = 'address-bar';
  mockElectron.clipboard.text = 'some search words';
  ctx.win.webContents.emit('context-menu', {}, {
    isEditable: true,
    editFlags: { canUndo: false, canCut: false, canCopy: false, canPaste: true, canSelectAll: true },
    x: 100,
    y: 50
  });
  await sleep(20);
  assert.equal(capturedMenus.length, 2);
  labels = labelsOf(capturedMenus[1]);
  assert.ok(labels.includes('Paste and search'), 'non-URL clipboard should offer Paste and search');
  assert.ok(!labels.includes('Paste and go'));

  // Non-editable chrome areas get no menu at all.
  ctx.win.webContents.emit('context-menu', {}, { isEditable: false, x: 100, y: 50 });
  await sleep(20);
  assert.equal(capturedMenus.length, 2, 'no menu for non-editable chrome areas');
});

test('s-14 / chrome context menu: non-address-bar editable fields get Delete instead of Paste and go', async () => {
  const ctx = makeCtx();
  ctx._lastChromeContextTarget = 'search-box';
  mockElectron.clipboard.text = 'https://example.com';
  attachChromeContextMenu(ctx);

  ctx.win.webContents.emit('context-menu', {}, {
    isEditable: true,
    editFlags: { canUndo: true, canCut: true, canCopy: true, canPaste: true, canDelete: true, canSelectAll: true },
    x: 100,
    y: 200
  });
  await sleep(20);
  assert.equal(capturedMenus.length, 1);
  const labels = labelsOf(capturedMenus[0]);
  assert.ok(labels.includes('Delete'));
  assert.ok(!labels.includes('Paste and go'));
  assert.ok(!labels.includes('Paste and search'));
  assert.ok(!labels.includes('Edit search engines...'));
});

// ---------------------------------------------------------------------------
// s-14: permission prompt queue
// ---------------------------------------------------------------------------

function setupPromptWindow() {
  const ctx = makeCtx();
  ctx.popoverView = makePopoverView();
  windowContexts.set(ctx.win.id, ctx);
  const wc = new FakeWebContents({ id: 99, url: 'https://example.com/page' });
  webContentsToWinId.set(wc.id, ctx.win.id);
  const session = makeSession();
  setupPermissionsForSession(session, 'default', {});
  return { ctx, wc, session };
}

test('s-14 / permission queue: ask permissions prompt one at a time in FIFO order', () => {
  const { ctx, wc, session } = setupPromptWindow();
  const results = [];
  session.requestHandler(wc, 'videoCapture', (v) => results.push(['camera', v]), {
    requestingUrl: 'https://example.com/'
  });
  session.requestHandler(wc, 'geolocation', (v) => results.push(['geolocation', v]), {
    requestingUrl: 'https://example.com/'
  });

  // First request is active, second waits in the queue; nothing resolved yet.
  assert.deepEqual(results, []);
  assert.ok(ctx._activePermissionPrompt, 'first prompt should be active');
  assert.deepEqual(ctx._activePermissionPrompt.keys, ['camera']);
  assert.equal(ctx._permissionPromptQueue.length, 1);
  assert.equal(ctx.popoverOpenKind, 'permission-prompt');
  assert.deepEqual(ctx.popoverPayload.payload.keys, ['camera']);
  assert.equal(ctx.popoverPayload.payload.origin, 'https://example.com');

  // A wrong requestId must not resolve anything.
  assert.deepEqual(resolvePermissionPrompt(ctx, { requestId: 'bogus', decision: 'allow-once' }), { ok: false });
  assert.deepEqual(results, []);

  // Allow the camera once: callback fires, geolocation prompt takes over.
  const firstId = ctx._activePermissionPrompt.requestId;
  assert.deepEqual(resolvePermissionPrompt(ctx, { requestId: firstId, decision: 'allow-once' }), {
    ok: true,
    allowed: true,
    decision: 'allow-once'
  });
  assert.deepEqual(results, [['camera', true]]);
  assert.deepEqual(ctx._activePermissionPrompt.keys, ['geolocation']);
  assert.equal(ctx._permissionPromptQueue.length, 0);
  assert.equal(ctx.popoverOpenKind, 'permission-prompt');

  // Block geolocation: callback fires with false and the block is persisted.
  const secondId = ctx._activePermissionPrompt.requestId;
  assert.deepEqual(resolvePermissionPrompt(ctx, { requestId: secondId, decision: 'block' }), {
    ok: true,
    allowed: false,
    decision: 'block'
  });
  assert.deepEqual(results, [
    ['camera', true],
    ['geolocation', false]
  ]);
  assert.equal(ctx._activePermissionPrompt, null);
  assert.deepEqual(state.storage.setPermCalls, [
    { origin: 'https://example.com', key: 'geolocation', value: 'block' }
  ]);
});

test('s-14 / permission queue: stored allow/block, safe and unmapped permissions resolve without prompting', () => {
  const { ctx, wc, session } = setupPromptWindow();
  state.storage.sitePerms['https://example.com'] = {
    camera: 'allow',
    microphone: 'block',
    geolocation: 'ask',
    notifications: 'ask'
  };
  const results = [];
  const ask = (permission, details) =>
    session.requestHandler(wc, permission, (v) => results.push([permission, v]), details);

  ask('videoCapture', { requestingUrl: 'https://example.com/' }); // stored allow
  ask('audioCapture', { requestingUrl: 'https://example.com/' }); // stored block
  ask('usb', { requestingUrl: 'https://example.com/' }); // unmapped: default-deny
  ask('fullscreen', { requestingUrl: 'https://example.com/' }); // safe auto-allow

  assert.deepEqual(results, [
    ['videoCapture', true],
    ['audioCapture', false],
    ['usb', false],
    ['fullscreen', true]
  ]);
  assert.equal(ctx._activePermissionPrompt, undefined, 'no prompt should open for fast-path decisions');

  // 'ask' still prompts, and the S-2 permissions (screen sharing, clipboard
  // read) prompt instead of silently denying.
  ask('geolocation', { requestingUrl: 'https://example.com/' });
  assert.ok(ctx._activePermissionPrompt);
  assert.deepEqual(ctx._activePermissionPrompt.keys, ['geolocation']);
  ask('display-capture', { requestingUrl: 'https://example.com/' });
  ask('clipboard-read', { requestingUrl: 'https://example.com/' });
  assert.equal(ctx._permissionPromptQueue.length, 2, 'screen-share and clipboard prompts queue behind geolocation');

  const geoId = ctx._activePermissionPrompt.requestId;
  resolvePermissionPrompt(ctx, { requestId: geoId, decision: 'allow-once' });
  assert.deepEqual(ctx._activePermissionPrompt.keys, ['screen-share'], 'display-capture prompts as screen-share');
  assert.equal(ctx._permissionPromptQueue.length, 1);

  cancelPendingPermissionsForWindow(ctx);
  assert.deepEqual(results, [
    ['videoCapture', true],
    ['audioCapture', false],
    ['usb', false],
    ['fullscreen', true],
    ['geolocation', true],
    ['display-capture', false],
    ['clipboard-read', false]
  ]);
});

test('s-14 / permission queue: closing the popover denies the active prompt; cancel denies active and queued', () => {
  const { ctx, wc, session } = setupPromptWindow();
  const results = [];
  session.requestHandler(wc, 'videoCapture', (v) => results.push(['camera', v]), {
    requestingUrl: 'https://example.com/'
  });
  session.requestHandler(wc, 'notifications', (v) => results.push(['notifications', v]), {
    requestingUrl: 'https://example.com/'
  });

  // Dismissing the popover denies the active prompt and pumps the next one.
  onPermissionPopoverClosed(ctx);
  assert.deepEqual(results, [['camera', false]]);
  assert.deepEqual(ctx._activePermissionPrompt.keys, ['notifications']);

  // Cancelling (e.g. window closing) denies everything still pending.
  cancelPendingPermissionsForWindow(ctx);
  assert.deepEqual(results, [
    ['camera', false],
    ['notifications', false]
  ]);
  assert.equal(ctx._activePermissionPrompt, null);
  assert.equal(ctx._permissionPromptQueue.length, 0);

  // Resolving with no active prompt is a safe no-op.
  assert.deepEqual(resolvePermissionPrompt(ctx, { decision: 'allow-once' }), { ok: false });
  cancelPendingPermissionsForWindow(null);
  onPermissionPopoverClosed(null);
});

// ---------------------------------------------------------------------------
// s-14: clipboard PNG
// ---------------------------------------------------------------------------

const FAKE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03]);

test('s-14 / clipboard PNG: writes via ClipboardItem when available', async () => {
  const ok = await writeClipboardPng(FAKE_PNG);
  assert.equal(ok, true);
  assert.equal(mockElectron.clipboard.writtenItems.length, 1);
  const item = mockElectron.clipboard.writtenItems[0];
  assert.ok(item instanceof FakeClipboardItem);
  const blob = item.map['image/png'];
  assert.ok(blob instanceof Blob, 'ClipboardItem should carry a Blob');
  assert.equal(blob.type, 'image/png');
  assert.equal(blob.size, FAKE_PNG.length);
  assert.equal(mockElectron.clipboard.writtenImages.length, 0, 'writeImage fallback must not run');
});

test('s-14 / clipboard PNG: falls back to writeImage/nativeImage when the ClipboardItem path is unavailable', async () => {
  // Remove the async ClipboardItem path entirely so the sync fallback is used.
  mockElectron.clipboard.write = undefined;
  mockElectron.ClipboardItem = undefined;
  const created = [];
  mockElectron.nativeImage.createFromBuffer = (buf) => {
    const img = { __fakeNativeImage: true, bytes: buf.length };
    created.push(img);
    return img;
  };

  const ok = await writeClipboardPng(FAKE_PNG);
  assert.equal(ok, true);
  assert.equal(created.length, 1);
  assert.equal(created[0].bytes, FAKE_PNG.length);
  assert.deepEqual(mockElectron.clipboard.writtenImages, created);
});

test('s-14 / clipboard PNG: returns false for a missing clipboard or null buffer; a throwing modern write falls back to writeImage', async () => {
  assert.equal(await writeClipboardPng(null), false);
  assert.equal(await writeClipboardPng(undefined), false);

  mockElectron.clipboard = null;
  assert.equal(await writeClipboardPng(FAKE_PNG), false);

  // s-8: a throwing ClipboardItem write falls through to the legacy
  // writeImage fallback instead of failing outright.
  mockElectron.clipboard = makeClipboardMock();
  mockElectron.clipboard.write = async () => {
    throw new Error('clipboard busy');
  };
  assert.equal(await writeClipboardPng(FAKE_PNG), true);
  assert.equal(mockElectron.clipboard.writtenImages.length, 1, 'fallback writeImage should run');

  // False only when both paths fail.
  mockElectron.clipboard = makeClipboardMock();
  mockElectron.clipboard.write = async () => {
    throw new Error('clipboard busy');
  };
  mockElectron.clipboard.writeImage = () => {
    throw new Error('no image support');
  };
  assert.equal(await writeClipboardPng(FAKE_PNG), false);
});

test('s-14 / clipboard text: read/write round-trips through the mock and fails closed', async () => {
  assert.equal(await writeClipboardText('hello'), true);
  assert.equal(await readClipboardText(), 'hello');
  assert.equal(await writeClipboardText(123), true);
  assert.equal(await readClipboardText(), '123');

  mockElectron.clipboard = null;
  assert.equal(await readClipboardText(), '');
  assert.equal(await writeClipboardText('x'), false);
});

// ---------------------------------------------------------------------------
// s-14: screenshots
// ---------------------------------------------------------------------------

function setupScreenshotWindow({ url = 'https://example.com/article', title = 'Article' } = {}) {
  const ctx = makeCtx();
  const wc = new FakeWebContents({ id: 42, url, title });
  ctx.tabs.set('t1', { id: 't1', title, url, view: { webContents: wc } });
  ctx.tabOrder = ['t1'];
  ctx.activeTabId = 't1';
  return { ctx, wc };
}

test('s-14 / screenshots: full-page CDP capture returns the PNG and detaches the debugger', async () => {
  const { ctx, wc } = setupScreenshotWindow();
  const fallback = Buffer.from('fallback');
  wc.debugger.sendCommandResult = { data: Buffer.from('fullpage-png').toString('base64') };

  const result = await captureFullPagePng(ctx, fallback);
  assert.ok(Buffer.isBuffer(result));
  assert.equal(result.toString(), 'fullpage-png');
  assert.equal(wc.debugger.attached, false, 'debugger must be detached after capture');

  // A CDP failure falls back to the visible-viewport buffer and still detaches.
  wc.debugger.sendCommandError = new Error('debugger busy');
  assert.equal(await captureFullPagePng(ctx, fallback), fallback);
  assert.equal(wc.debugger.attached, false);
  wc.debugger.sendCommandError = null;

  // Non-web pages and destroyed webContents never attempt a CDP capture.
  wc._url = 'file:///src/ui/newtab.html';
  assert.equal(await captureFullPagePng(ctx, fallback), fallback);
  wc._url = 'https://example.com/article';
  wc.destroyed = true;
  assert.equal(await captureFullPagePng(ctx, fallback), fallback);
});

test('s-14 / screenshots: saveScreenshotPng writes a timestamped file, records the download and toasts', async () => {
  const { ctx } = setupScreenshotWindow();
  const png = Buffer.from('png-bytes');

  const res = await saveScreenshotPng(ctx, png, 'Full');
  assert.equal(res.ok, true);
  assert.match(res.filename, /^nextGx-Full-.*\.png$/);
  assert.equal(res.savePath, path.join(downloadsDir, res.filename));
  assert.ok(fs.existsSync(res.savePath), 'screenshot file should exist in downloads');
  assert.deepEqual(fs.readFileSync(res.savePath), png);

  // The save is recorded as a completed download and the user is toasted.
  assert.equal(state.storage.downloads.length, 1);
  assert.equal(state.storage.downloads[0].filename, res.filename);
  assert.equal(state.storage.downloads[0].state, 'completed');
  const toast = ctx.win.webContents.sent.find((s) => s.channel === 'ui:toast');
  assert.ok(toast, 'a toast should be sent');
  assert.match(toast.args[0], /Screenshot saved & copied/);

  // The screenshot is also copied to the clipboard.
  assert.equal(mockElectron.clipboard.writtenItems.length, 1);
});

test('s-14 / screenshots: save with dialog honours cancel and writes the chosen path', async () => {
  const { ctx } = setupScreenshotWindow();
  const png = Buffer.from('png-bytes');

  mockElectron.dialog.showSaveDialog = async () => ({ canceled: true });
  assert.deepEqual(await saveScreenshotWithDialog(ctx, png, 'Snap'), { ok: false, canceled: true });

  const chosen = path.join(downloadsDir, 'my-shot.png');
  mockElectron.dialog.showSaveDialog = async () => ({ canceled: false, filePath: chosen });
  const res = await saveScreenshotWithDialog(ctx, png, 'Snap');
  assert.equal(res.ok, true);
  assert.equal(res.savePath, chosen);
  assert.equal(res.filename, 'my-shot.png');
  assert.deepEqual(fs.readFileSync(chosen), png);
});

test('s-14 / screenshots: copyScreenshotPng reports success and clipboard failure', async () => {
  const { ctx } = setupScreenshotWindow();

  assert.deepEqual(await copyScreenshotPng(ctx, FAKE_PNG), { ok: true, copied: true });
  assert.ok(ctx.win.webContents.sent.some((s) => s.args[0] === 'Screenshot copied to clipboard'));

  mockElectron.clipboard = null;
  assert.deepEqual(await copyScreenshotPng(ctx, FAKE_PNG), {
    ok: false,
    error: 'Clipboard image write failed'
  });
  assert.ok(ctx.win.webContents.sent.some((s) => /Failed to copy/.test(s.args[0])));
});

test('s-14 / screenshots: savePageAsPdf exports via printToPDF and rejects with no active page', async () => {
  const { ctx, wc } = setupScreenshotWindow();
  const pdfPath = path.join(downloadsDir, 'article.pdf');
  mockElectron.dialog.showSaveDialog = async () => ({ canceled: false, filePath: pdfPath });

  const res = await savePageAsPdf(ctx);
  assert.equal(res.ok, true);
  assert.equal(res.savePath, pdfPath);
  assert.equal(res.filename, 'article.pdf');
  assert.deepEqual(fs.readFileSync(pdfPath), wc.pdfBuffer);
  assert.ok(wc.calls.includes('printToPDF'));
  assert.equal(state.storage.downloads[0].category, 'documents');

  // Dialog cancel aborts the export.
  mockElectron.dialog.showSaveDialog = async () => ({ canceled: true });
  assert.deepEqual(await savePageAsPdf(ctx), { ok: false, canceled: true });

  // No active tab means no page to export.
  const emptyCtx = makeCtx();
  assert.deepEqual(await savePageAsPdf(emptyCtx), { ok: false, error: 'No active page to export' });
});

// ---------------------------------------------------------------------------
// s-14: sidebar suspend
// ---------------------------------------------------------------------------

function addSidebarView(ctx, serviceKey, { url, lastActiveAt, audible = false, rawAudible = false } = {}) {
  const panel = ensureSidebarPanelState(ctx);
  const wc = new FakeWebContents({ id: 100 + panel.views.size, url: url || SIDEBAR_SERVICES[serviceKey].url });
  const view = { webContents: wc };
  panel.views.set(serviceKey, view);
  panel.meta.set(serviceKey, {
    key: serviceKey,
    url: url || SIDEBAR_SERVICES[serviceKey].url,
    lastActiveAt: lastActiveAt ?? Date.now(),
    suspended: false,
    audible,
    rawAudible,
    isLoading: false
  });
  ctx.win.children.push(view);
  webContentsToWinId.set(wc.id, ctx.win.id);
  return { view, wc };
}

test('s-14 / sidebar suspend: suspending a service view preserves its URL and closes the view', () => {
  const ctx = makeCtx();
  windowContexts.set(ctx.win.id, ctx);
  const { view, wc } = addSidebarView(ctx, 'youtube', {
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  });
  const panel = ensureSidebarPanelState(ctx);

  assert.equal(suspendSidebarServiceView(ctx, 'youtube'), true);
  assert.ok(!panel.views.has('youtube'), 'suspended view is removed from the panel');
  assert.equal(
    panel.savedUrls.get('youtube'),
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'resume URL is preserved for reopening'
  );
  const meta = panel.meta.get('youtube');
  assert.equal(meta.suspended, true);
  assert.equal(meta.isLoading, false);
  assert.equal(meta.audible, false);
  assert.ok(wc.calls.includes('close'), 'webContents is closed');
  assert.ok(ctx.win.removedViews.includes(view), 'view is removed from the window');
  assert.ok(!webContentsToWinId.has(wc.id), 'webContents mapping is cleaned up');
  assert.ok(
    ctx.win.webContents.sent.some((s) => s.channel === 'sidebar:update'),
    'sidebar state is broadcast after suspend'
  );
});

test('s-14 / sidebar suspend: suspend refuses internal services, unknown keys and missing views', () => {
  const ctx = makeCtx();
  ensureSidebarPanelState(ctx);
  assert.equal(suspendSidebarServiceView(ctx, 'player'), false, 'internal Player service is never suspended');
  assert.equal(suspendSidebarServiceView(ctx, 'not-a-service'), false);
  assert.equal(suspendSidebarServiceView(ctx, 'spotify'), false, 'no view exists to suspend');
  assert.equal(suspendSidebarServiceView(null, 'youtube'), false);

  const destroyedCtx = makeCtx();
  destroyedCtx.win.destroyed = true;
  assert.equal(suspendSidebarServiceView(destroyedCtx, 'youtube'), false);
});

test('s-14 / sidebar suspend: idle sweep suspends only stale, silent, hidden services', () => {
  const ctx = makeCtx();
  windowContexts.set(ctx.win.id, ctx);
  const panel = ensureSidebarPanelState(ctx);
  const now = Date.now();
  const stale = now - 20 * 60 * 1000;
  const recent = now - 60 * 1000;

  // Stale + silent + hidden: must be suspended.
  addSidebarView(ctx, 'youtube', { lastActiveAt: stale });
  // Stale but audible: must be kept, idle timer reset.
  const audibleMeta = addSidebarView(ctx, 'spotify', { lastActiveAt: stale, rawAudible: true });
  // Recent: must be kept.
  addSidebarView(ctx, 'twitch', { lastActiveAt: recent });
  // Stale but currently visible (open panel, active key): must be kept.
  panel.open = true;
  panel.activeKey = 'discord';
  addSidebarView(ctx, 'discord', { lastActiveAt: stale });

  const suspended = suspendIdleSidebarViews(10 * 60 * 1000);
  assert.equal(suspended, 1);
  assert.ok(!panel.views.has('youtube'));
  assert.ok(panel.views.has('spotify'), 'audible service must not be suspended');
  assert.ok(panel.views.has('twitch'), 'recently used service must not be suspended');
  assert.ok(panel.views.has('discord'), 'visible service must not be suspended');
  assert.ok(panel.meta.get('spotify').lastActiveAt >= now - 1000, 'audible service idle timer resets');
  assert.ok(panel.meta.get('discord').lastActiveAt >= now - 1000, 'visible service idle timer resets');
  assert.equal(audibleMeta.wc.calls.includes('close'), false, 'audible view must not be closed');

  // An invalid timeout falls back to the 10-minute default.
  addSidebarView(ctx, 'deezer', { lastActiveAt: stale });
  assert.equal(suspendIdleSidebarViews('not-a-number'), 1);
  assert.ok(!panel.views.has('deezer'));
});

test('s-14 / sidebar helpers: service resolution and width clamping', () => {
  assert.equal(Object.keys(SIDEBAR_SERVICES).length, 15, '14 external services + internal Player');
  assert.equal(resolveSidebarService('youtube').url, 'https://www.youtube.com');
  assert.equal(resolveSidebarService('https://music.youtube.com').key, 'youtubeMusic');
  assert.equal(resolveSidebarService('not-a-service'), null);
  assert.equal(resolveSidebarService(null), null);

  assert.equal(clampSidebarWidth(100), 260, 'below minimum clamps to 260 (UX phase: min 320 -> 260)');
  assert.equal(clampSidebarWidth(9999), 800, 'above maximum clamps to 800 (UX phase: max 640 -> 800)');
  assert.equal(clampSidebarWidth(400), 400);
  assert.equal(clampSidebarWidth('junk'), 380, 'non-numeric width falls back to default 380');
  assert.equal(clampSidebarWidth(undefined), 380);
});
