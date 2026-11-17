const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  session,
  dialog,
  shell,
  nativeImage,
  clipboard
} = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const { StorageManager } = require('./storage');
const { AdBlocker } = require('./adblocker');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const TOP_CHROME_HEIGHT = 82;
const SIDEBAR_ICON_WIDTH = 50;
const LEFT_PANEL_HEADER_HEIGHT = 44;
const NEW_TAB_FILE = path.join(__dirname, 'ui', 'newtab.html');
const NEW_TAB_FILE_URL = pathToFileURL(NEW_TAB_FILE).toString();
const WEBUI_FILE = path.join(__dirname, 'ui', 'chrome-webui.html');
const WEBUI_FILE_URL = pathToFileURL(WEBUI_FILE).toString();
const POPOVER_FILE = path.join(__dirname, 'ui', 'popover.html');
const LEFT_DOCK_HEADER_FILE = path.join(__dirname, 'ui', 'left-dock-header.html');
const LEFT_DOCK_RESIZER_FILE = path.join(__dirname, 'ui', 'left-dock-resizer.html');
const SCREENSHOT_FILE = path.join(__dirname, 'ui', 'screenshot.html');

let storage = null;
let adBlocker = null;
const activeDownloadItems = new Map();
const windowContexts = new Map(); // BrowserWindow.id -> ctx
const webContentsToWinId = new Map(); // webContents.id -> BrowserWindow.id

let prevCpuInfo = os.cpus();

function getSystemCpuPercent() {
  const cpus = os.cpus();
  let idleDiff = 0;
  let totalDiff = 0;
  for (let i = 0; i < cpus.length; i++) {
    const prev = prevCpuInfo[i] || cpus[i];
    const curr = cpus[i];
    let prevTotal = 0;
    let currTotal = 0;
    for (const type of Object.keys(curr.times)) {
      prevTotal += prev.times[type] || 0;
      currTotal += curr.times[type] || 0;
    }
    idleDiff += curr.times.idle - prev.times.idle;
    totalDiff += currTotal - prevTotal;
  }
  prevCpuInfo = cpus;
  if (totalDiff <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(((totalDiff - idleDiff) / totalDiff) * 100)));
}

function getBrowserRamMB() {
  try {
    const metrics = app.getAppMetrics();
    let totalKB = 0;
    for (const m of metrics) {
      if (m.memory && typeof m.memory.workingSetSize === 'number') {
        totalKB += m.memory.workingSetSize;
      }
    }
    return Math.round(totalKB / 1024);
  } catch (_) {
    return Math.round(process.memoryUsage().rss / (1024 * 1024));
  }
}

function isNewTabUrl(urlStr) {
  if (!urlStr) return true;
  return (
    urlStr === 'nextgx://newtab' ||
    urlStr === 'gx://newtab' ||
    urlStr === 'chrome://newtab' ||
    urlStr.startsWith(NEW_TAB_FILE_URL) ||
    urlStr.endsWith('/src/ui/newtab.html')
  );
}

function isWebUiUrl(urlStr) {
  if (!urlStr) return false;
  return urlStr.startsWith(WEBUI_FILE_URL) || urlStr.includes('/src/ui/chrome-webui.html');
}

function formatDisplayUrl(rawUrl) {
  if (isNewTabUrl(rawUrl)) return 'nextgx://newtab';
  if (isWebUiUrl(rawUrl)) {
    const hash = (rawUrl.split('#')[1] || 'history').toLowerCase();
    if (hash === 'passwords') return 'nextgx://passwords';
    return `nextgx://${hash}`;
  }
  return rawUrl || '';
}

function getOriginForUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.origin;
  } catch (_) {}
  return '';
}

function resolveNavigateInput(input) {
  const trimmed = (input || '').trim();
  if (
    !trimmed ||
    trimmed === 'nextgx://newtab' ||
    trimmed === 'gx://newtab' ||
    trimmed === 'chrome://newtab' ||
    trimmed === 'about:newtab'
  ) {
    return NEW_TAB_FILE_URL;
  }
  const internalMatch = trimmed.match(/^(?:nextgx|chrome|gx):\/\/([a-z0-9-]+)$/i);
  if (internalMatch) {
    let page = internalMatch[1].toLowerCase();
    if (page === 'password-manager') page = 'passwords';
    if (['history', 'downloads', 'bookmarks', 'passwords', 'extensions', 'settings'].includes(page)) {
      return `${WEBUI_FILE_URL}#${page}`;
    }
  }
  if (/^(https?:\/\/|file:\/\/|view-source:|data:)/i.test(trimmed)) return trimmed;
  const isDomainOrIp =
    /^(localhost(:\d+)?|(\d{1,3}\.){3}\d{1,3}(:\d+)?|([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,})(\/.*)?$/i.test(
      trimmed
    ) && !trimmed.includes(' ');
  if (isDomainOrIp) return `https://${trimmed}`;

  const settings = storage.getSettings();
  const q = encodeURIComponent(trimmed);
  if (settings.searchEngine === 'duckduckgo') return `https://duckduckgo.com/?q=${q}`;
  if (settings.searchEngine === 'bing') return `https://www.bing.com/search?q=${q}`;
  return `https://www.google.com/search?q=${q}`;
}

function getCtxFromSender(sender) {
  if (sender && webContentsToWinId.has(sender.id)) {
    const winId = webContentsToWinId.get(sender.id);
    if (windowContexts.has(winId)) return windowContexts.get(winId);
  }
  const bw = sender ? BrowserWindow.fromWebContents(sender) : null;
  if (bw && windowContexts.has(bw.id)) return windowContexts.get(bw.id);
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && windowContexts.has(focused.id)) return windowContexts.get(focused.id);
  return Array.from(windowContexts.values())[0] || null;
}

function serializeTabs(ctx) {
  const ordered = ctx.tabOrder
    .map((id) => ctx.tabs.get(id))
    .filter(Boolean)
    .map((t) => {
      const displayUrl = formatDisplayUrl(t.url);
      const origin = getOriginForUrl(t.url);
      return {
        id: t.id,
        title: t.title || (ctx.incognito ? 'Private Start' : 'Start Page'),
        url: displayUrl,
        origin,
        isSecure: t.url.startsWith('https://') || displayUrl.startsWith('nextgx://'),
        isHttpInsecure: t.url.startsWith('http://'),
        favicon: t.favicon || '',
        isLoading: Boolean(t.isLoading),
        canGoBack: Boolean(t.canGoBack),
        canGoForward: Boolean(t.canGoForward),
        pinned: Boolean(t.pinned),
        incognito: Boolean(t.incognito || ctx.incognito),
        sleeping: Boolean(t.sleeping),
        audible: Boolean(t.audible),
        readerMode: Boolean(t.readerMode),
        zoomPercent: Math.round((t.zoomFactor || 1) * 100),
        isBookmarked: storage.isBookmarked(displayUrl)
      };
    });

  return {
    windowIncognito: ctx.incognito,
    tabs: ordered,
    activeTabId: ctx.activeTabId,
    activeTab: ordered.find((t) => t.id === ctx.activeTabId) || null,
    leftWebAudioPlaying: ctx.leftWebAudioPlaying
  };
}

function broadcastState(ctx) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return;
  ctx.win.webContents.send('state:update', serializeTabs(ctx));
}

function bringOverlaysToFront(ctx) {
  if (!ctx.win || ctx.win.isDestroyed()) return;
  if (ctx.leftDockHeaderView && ctx.layoutState.leftWebVisible) {
    ctx.win.contentView.addChildView(ctx.leftDockHeaderView);
  }
  if (ctx.leftWebView && ctx.layoutState.leftWebVisible) {
    ctx.win.contentView.addChildView(ctx.leftWebView);
  }
  if (ctx.leftDockResizerView && ctx.layoutState.leftWebVisible) {
    ctx.win.contentView.addChildView(ctx.leftDockResizerView);
  }
  if (ctx.popoverView && ctx.popoverOpenKind) {
    ctx.win.contentView.addChildView(ctx.popoverView);
  }
  if (ctx.screenshotView && ctx.pendingScreenshotDataUrl) {
    ctx.win.contentView.addChildView(ctx.screenshotView);
  }
}

function updateActiveViewBounds(ctx) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return;
  const [contentWidth, contentHeight] = ctx.win.getContentSize();
  const top = Math.max(TOP_CHROME_HEIGHT, ctx.layoutState.top || TOP_CHROME_HEIGHT);

  const panelW = Math.max(280, Math.min(880, ctx.layoutState.leftWebWidth || 420));
  const effectiveTabLeft =
    ctx.layoutState.leftWebVisible && ctx.layoutState.leftWebPinned
      ? SIDEBAR_ICON_WIDTH + panelW
      : Math.max(SIDEBAR_ICON_WIDTH, ctx.layoutState.left || SIDEBAR_ICON_WIDTH);

  const rightOffset = Math.max(0, ctx.layoutState.right || 0);
  const bottomOffset = Math.max(0, ctx.layoutState.bottom || 0);

  for (const [id, tab] of ctx.tabs.entries()) {
    if (!tab.view) continue;
    if (id === ctx.activeTabId && !tab.sleeping) {
      tab.view.setBounds({
        x: effectiveTabLeft,
        y: top,
        width: Math.max(120, contentWidth - effectiveTabLeft - rightOffset),
        height: Math.max(120, contentHeight - top - bottomOffset)
      });
    } else {
      tab.view.setBounds({ x: -5000, y: -5000, width: 1, height: 1 });
    }
  }

  if (ctx.leftDockHeaderView) {
    if (ctx.layoutState.leftWebVisible) {
      ctx.leftDockHeaderView.setBounds({
        x: SIDEBAR_ICON_WIDTH,
        y: TOP_CHROME_HEIGHT,
        width: panelW - 5,
        height: LEFT_PANEL_HEADER_HEIGHT
      });
    } else {
      ctx.leftDockHeaderView.setBounds({ x: -5000, y: -5000, width: 1, height: 1 });
    }
  }

  if (ctx.leftWebView) {
    if (ctx.layoutState.leftWebVisible) {
      ctx.leftWebView.setBounds({
        x: SIDEBAR_ICON_WIDTH,
        y: TOP_CHROME_HEIGHT + LEFT_PANEL_HEADER_HEIGHT,
        width: panelW - 5,
        height: Math.max(120, contentHeight - TOP_CHROME_HEIGHT - LEFT_PANEL_HEADER_HEIGHT)
      });
    } else {
      ctx.leftWebView.setBounds({ x: -5000, y: -5000, width: 1, height: 1 });
    }
  }

  if (ctx.leftDockResizerView) {
    if (ctx.layoutState.leftWebVisible) {
      ctx.leftDockResizerView.setBounds({
        x: SIDEBAR_ICON_WIDTH + panelW - 5,
        y: TOP_CHROME_HEIGHT,
        width: 6,
        height: Math.max(120, contentHeight - TOP_CHROME_HEIGHT)
      });
    } else {
      ctx.leftDockResizerView.setBounds({ x: -5000, y: -5000, width: 1, height: 1 });
    }
  }

  if (ctx.screenshotView) {
    if (ctx.pendingScreenshotDataUrl) {
      ctx.screenshotView.setBounds({
        x: effectiveTabLeft,
        y: top,
        width: Math.max(120, contentWidth - effectiveTabLeft - rightOffset),
        height: Math.max(120, contentHeight - top - bottomOffset)
      });
    } else {
      ctx.screenshotView.setBounds({ x: -5000, y: -5000, width: 1, height: 1 });
    }
  }

  bringOverlaysToFront(ctx);
}

function attachKeyboardShortcuts(ctx, webContents) {
  webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    const shift = input.shift;
    const key = (input.key || '').toLowerCase();

    if (ctrl && !shift && key === 't') {
      event.preventDefault();
      createTab(ctx, { url: 'nextgx://newtab', active: true });
    } else if (ctrl && !shift && key === 'n') {
      event.preventDefault();
      createBrowserWindow({ incognito: false });
    } else if (ctrl && shift && key === 'n') {
      event.preventDefault();
      createBrowserWindow({ incognito: true });
    } else if (ctrl && !shift && key === 'w') {
      event.preventDefault();
      if (ctx.activeTabId) closeTab(ctx, ctx.activeTabId);
    } else if ((ctrl && key === 'r') || input.key === 'F5') {
      event.preventDefault();
      reloadActiveTab(ctx);
    } else if (ctrl && !shift && key === 'l') {
      event.preventDefault();
      ctx.win?.webContents.send('shortcut:action', 'focus-address-bar');
    } else if (ctrl && !shift && key === 'd') {
      event.preventDefault();
      ctx.win?.webContents.send('shortcut:action', 'toggle-bookmark');
    } else if (ctrl && !shift && key === 'h') {
      event.preventDefault();
      createTab(ctx, { url: 'nextgx://history', active: true });
    } else if (ctrl && !shift && key === 'j') {
      event.preventDefault();
      createTab(ctx, { url: 'nextgx://downloads', active: true });
    } else if (ctrl && !shift && key === 'f') {
      event.preventDefault();
      ctx.win?.webContents.send('shortcut:action', 'open-find');
    } else if (ctrl && !shift && key === 'p') {
      event.preventDefault();
      const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
      if (tab?.view) tab.view.webContents.print();
    } else if (input.key === 'F11') {
      event.preventDefault();
      ctx.win?.setFullScreen(!ctx.win.isFullScreen());
    } else if (input.key === 'F12') {
      event.preventDefault();
      toggleActiveTabDevTools(ctx);
    } else if (input.key === 'Escape') {
      closePopover(ctx);
    }
  });
}

function setupPermissionsForSession(ses) {
  const mapPerm = (p) => {
    if (p === 'media' || p === 'videoCapture') return 'camera';
    if (p === 'audioCapture') return 'microphone';
    if (p === 'geolocation') return 'geolocation';
    if (p === 'notifications') return 'notifications';
    return null;
  };

  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    const key = mapPerm(permission);
    if (!key) return true;
    return storage.getSitePermissions(requestingOrigin)[key] !== 'block';
  });

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const origin = getOriginForUrl(details?.requestingUrl || webContents.getURL());
    const key = mapPerm(permission);
    if (!key || !origin) return callback(true);
    return callback(storage.getSitePermissions(origin)[key] !== 'block');
  });
}

function ensureLeftDockViews(ctx) {
  if (!ctx.leftDockHeaderView) {
    ctx.leftDockHeaderView = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });
    webContentsToWinId.set(ctx.leftDockHeaderView.webContents.id, ctx.win.id);
    ctx.leftDockHeaderView.webContents.loadFile(LEFT_DOCK_HEADER_FILE);
    ctx.win.contentView.addChildView(ctx.leftDockHeaderView);
  }

  if (!ctx.leftWebView) {
    ctx.leftWebView = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        plugins: true,
        session: ctx.session
      }
    });
    const wc = ctx.leftWebView.webContents;
    webContentsToWinId.set(wc.id, ctx.win.id);
    wc.setUserAgent(wc.getUserAgent().replace(/Electron\/[^\s]+\s?/g, ''));
    adBlocker.attachToSession(wc.session);

    wc.on('DOM-ready', () => adBlocker.injectCosmeticFilters(wc));
    wc.on('audio-state-changed', (event) => {
      ctx.leftWebAudioPlaying = Boolean(event.audible);
      broadcastState(ctx);
    });
    wc.setWindowOpenHandler(({ url }) => {
      if (url && /^https?:\/\//i.test(url)) createTab(ctx, { url, active: true });
      return { action: 'deny' };
    });

    ctx.win.contentView.addChildView(ctx.leftWebView);
  }

  if (!ctx.leftDockResizerView) {
    ctx.leftDockResizerView = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });
    webContentsToWinId.set(ctx.leftDockResizerView.webContents.id, ctx.win.id);
    ctx.leftDockResizerView.webContents.loadFile(LEFT_DOCK_RESIZER_FILE);
    ctx.win.contentView.addChildView(ctx.leftDockResizerView);
  }
}

function ensurePopoverView(ctx) {
  if (ctx.popoverView) return ctx.popoverView;
  ctx.popoverView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  webContentsToWinId.set(ctx.popoverView.webContents.id, ctx.win.id);
  ctx.popoverView.webContents.loadFile(POPOVER_FILE);
  ctx.win.contentView.addChildView(ctx.popoverView);
  ctx.popoverView.setBounds({ x: -5000, y: -5000, width: 1, height: 1 });
  return ctx.popoverView;
}

function closePopover(ctx) {
  if (!ctx) return;
  ctx.popoverOpenKind = null;
  if (ctx.popoverView) {
    ctx.popoverView.setBounds({ x: -5000, y: -5000, width: 1, height: 1 });
  }
  ctx.win?.webContents.send('popover:data', { closed: true });
}

function openPopover(ctx, { kind, x, y, width, height, payload }) {
  if (ctx.popoverOpenKind === kind) {
    closePopover(ctx);
    return false;
  }
  const view = ensurePopoverView(ctx);
  ctx.popoverOpenKind = kind;
  const [cw, ch] = ctx.win.getContentSize();
  const safeW = Math.min(width || 300, cw - 16);
  const safeH = Math.min(height || 420, ch - TOP_CHROME_HEIGHT - 12);
  const safeX = Math.max(8, Math.min(x || 100, cw - safeW - 8));
  const safeY = Math.max(TOP_CHROME_HEIGHT - 2, y || TOP_CHROME_HEIGHT);

  ctx.win.contentView.addChildView(view);
  view.setBounds({ x: Math.round(safeX), y: Math.round(safeY), width: Math.round(safeW), height: Math.round(safeH) });
  view.webContents.send('popover:data', { kind, payload: payload || {} });
  return true;
}

function buildWebContentsViewForTab(ctx, tab) {
  adBlocker.attachToSession(ctx.session);

  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'tab-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      session: ctx.session,
      plugins: true
    }
  });

  const wc = view.webContents;
  webContentsToWinId.set(wc.id, ctx.win.id);
  wc.setUserAgent(wc.getUserAgent().replace(/Electron\/[^\s]+\s?/g, ''));
  attachKeyboardShortcuts(ctx, wc);

  wc.on('focus', () => {
    if (ctx.popoverOpenKind) closePopover(ctx);
    if (ctx.layoutState.leftWebVisible && !ctx.layoutState.leftWebPinned) {
      ctx.layoutState.leftWebVisible = false;
      updateActiveViewBounds(ctx);
      ctx.win?.webContents.send('leftdock:update', { visible: false, kind: null });
    }
  });

  wc.setWindowOpenHandler(({ url }) => {
    if (url && /^https?:\/\//i.test(url)) {
      createTab(ctx, { url, incognito: ctx.incognito, active: true });
    }
    return { action: 'deny' };
  });

  wc.on('did-start-loading', () => {
    tab.isLoading = true;
    broadcastState(ctx);
  });

  wc.on('did-stop-loading', () => {
    tab.isLoading = false;
    tab.canGoBack = wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack();
    tab.canGoForward = wc.navigationHistory ? wc.navigationHistory.canGoForward() : wc.canGoForward();
    adBlocker.injectCosmeticFilters(wc);
    const s = storage.getSettings();
    if (s.forceDarkWeb && /^https?:/i.test(tab.url)) {
      wc.insertCSS(`html { filter: invert(0.92) hue-rotate(180deg) !important; background: #0d0e12 !important; } img, video, iframe, canvas { filter: invert(1) hue-rotate(180deg) !important; }`).catch(() => {});
    }
    broadcastState(ctx);
  });

  wc.on('page-title-updated', (_e, title) => {
    tab.title = isNewTabUrl(tab.url) ? (ctx.incognito ? 'Private Start' : 'Start Page') : title;
    if (!ctx.incognito && !isNewTabUrl(tab.url) && !isWebUiUrl(tab.url)) {
      storage.addHistory({ title: tab.title, url: tab.url, favicon: tab.favicon });
    }
    broadcastState(ctx);
  });

  wc.on('page-favicon-updated', (_e, favicons) => {
    if (Array.isArray(favicons) && favicons.length > 0) {
      tab.favicon = favicons[0];
      if (!ctx.incognito && !isNewTabUrl(tab.url) && !isWebUiUrl(tab.url)) {
        storage.addHistory({ title: tab.title, url: tab.url, favicon: tab.favicon });
      }
      broadcastState(ctx);
    }
  });

  const handleUrlChange = (url) => {
    tab.url = url;
    if (isNewTabUrl(url)) {
      tab.title = ctx.incognito ? 'Private Start' : 'Start Page';
      tab.favicon = '';
    }
    tab.canGoBack = wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack();
    tab.canGoForward = wc.navigationHistory ? wc.navigationHistory.canGoForward() : wc.canGoForward();
    if (!ctx.incognito && !isNewTabUrl(url) && !isWebUiUrl(url)) {
      storage.addHistory({ title: tab.title, url, favicon: tab.favicon });
    }
    broadcastState(ctx);
  };

  wc.on('did-navigate', (_e, url) => handleUrlChange(url));
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    if (isMainFrame) handleUrlChange(url);
  });
  wc.on('DOM-ready', () => adBlocker.injectCosmeticFilters(wc));
  wc.on('audio-state-changed', (event) => {
    tab.audible = Boolean(event.audible);
    broadcastState(ctx);
  });

  ctx.win.contentView.addChildView(view);
  return view;
}

function createTab(ctx, { url = 'nextgx://newtab', pinned = false, active = true } = {}) {
  const id = 'tab-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  let resolvedUrl = resolveNavigateInput(url);
  if (ctx.incognito && isNewTabUrl(resolvedUrl) && !resolvedUrl.includes('incognito=1')) {
    resolvedUrl += '?incognito=1';
  }

  const tab = {
    id,
    title: isNewTabUrl(resolvedUrl) ? (ctx.incognito ? 'Private Start' : 'Start Page') : 'Loading...',
    url: resolvedUrl,
    favicon: '',
    isLoading: true,
    canGoBack: false,
    canGoForward: false,
    pinned: Boolean(pinned),
    incognito: Boolean(ctx.incognito),
    sleeping: false,
    audible: false,
    readerMode: false,
    zoomFactor: 1.0,
    lastActiveAt: Date.now(),
    view: null
  };

  tab.view = buildWebContentsViewForTab(ctx, tab);
  ctx.tabs.set(id, tab);

  if (tab.pinned) {
    const lastPinnedIdx = ctx.tabOrder.findLastIndex((tid) => ctx.tabs.get(tid)?.pinned);
    ctx.tabOrder.splice(lastPinnedIdx + 1, 0, id);
  } else {
    ctx.tabOrder.push(id);
  }

  tab.view.webContents.loadURL(resolvedUrl).catch(() => {});

  if (active || !ctx.activeTabId) {
    switchTab(ctx, id);
  } else {
    updateActiveViewBounds(ctx);
    broadcastState(ctx);
  }

  return serializeTabs(ctx);
}

function wakeTab(ctx, tab) {
  if (!tab || !tab.sleeping) return;
  tab.sleeping = false;
  tab.lastActiveAt = Date.now();
  tab.view = buildWebContentsViewForTab(ctx, tab);
  tab.view.webContents.loadURL(tab.url || NEW_TAB_FILE_URL).catch(() => {});
}

function switchTab(ctx, tabId) {
  const tab = ctx.tabs.get(tabId);
  if (!tab) return serializeTabs(ctx);
  if (ctx.activeTabId && ctx.tabs.has(ctx.activeTabId)) {
    ctx.tabs.get(ctx.activeTabId).lastActiveAt = Date.now();
  }
  ctx.activeTabId = tabId;
  tab.lastActiveAt = Date.now();
  if (tab.sleeping) wakeTab(ctx, tab);
  updateActiveViewBounds(ctx);
  broadcastState(ctx);
  return serializeTabs(ctx);
}

function sleepTab(ctx, tabId) {
  const tab = ctx.tabs.get(tabId);
  if (!tab || tab.sleeping || tabId === ctx.activeTabId) return serializeTabs(ctx);
  if (tab.view) {
    try {
      ctx.win.contentView.removeChildView(tab.view);
      tab.view.webContents.close();
    } catch (_) {}
    tab.view = null;
  }
  tab.sleeping = true;
  tab.isLoading = false;
  tab.audible = false;
  updateActiveViewBounds(ctx);
  broadcastState(ctx);
  return serializeTabs(ctx);
}

function sleepBackgroundTabs(ctx) {
  let sleptCount = 0;
  for (const [id, tab] of ctx.tabs.entries()) {
    if (id !== ctx.activeTabId && !tab.sleeping && !tab.audible) {
      sleepTab(ctx, id);
      sleptCount += 1;
    }
  }
  return { sleptCount, state: serializeTabs(ctx) };
}

function closeTab(ctx, tabId) {
  const tab = ctx.tabs.get(tabId);
  if (!tab) return serializeTabs(ctx);

  const idx = ctx.tabOrder.indexOf(tabId);
  if (idx !== -1) ctx.tabOrder.splice(idx, 1);

  if (tab.view) {
    try {
      ctx.win.contentView.removeChildView(tab.view);
      tab.view.webContents.close();
    } catch (_) {}
    tab.view = null;
  }
  ctx.tabs.delete(tabId);

  if (ctx.tabOrder.length === 0) {
    const s = storage.getSettings();
    if (s.closeWindowOnLastTab) {
      ctx.win?.close();
      return serializeTabs(ctx);
    }
    return createTab(ctx, { url: 'nextgx://newtab', active: true });
  }

  if (ctx.activeTabId === tabId) {
    const nextIdx = Math.min(idx, ctx.tabOrder.length - 1);
    ctx.activeTabId = ctx.tabOrder[nextIdx];
    const nextTab = ctx.tabs.get(ctx.activeTabId);
    if (nextTab && nextTab.sleeping) wakeTab(ctx, nextTab);
  }

  updateActiveViewBounds(ctx);
  broadcastState(ctx);
  return serializeTabs(ctx);
}

function togglePinTab(ctx, tabId) {
  const tab = ctx.tabs.get(tabId);
  if (!tab) return serializeTabs(ctx);
  tab.pinned = !tab.pinned;
  const pinnedIds = ctx.tabOrder.filter((id) => ctx.tabs.get(id)?.pinned);
  const normalIds = ctx.tabOrder.filter((id) => !ctx.tabs.get(id)?.pinned);
  ctx.tabOrder = [...pinnedIds, ...normalIds];
  broadcastState(ctx);
  return serializeTabs(ctx);
}

function navigateActiveTab(ctx, input) {
  const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
  if (!tab) return;
  if (tab.sleeping) wakeTab(ctx, tab);
  let resolvedUrl = resolveNavigateInput(input);
  if (ctx.incognito && isNewTabUrl(resolvedUrl) && !resolvedUrl.includes('incognito=1')) {
    resolvedUrl += '?incognito=1';
  }
  tab.url = resolvedUrl;
  tab.view.webContents.loadURL(resolvedUrl).catch(() => {});
  broadcastState(ctx);
}

function reloadActiveTab(ctx) {
  const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
  if (!tab || !tab.view) return;
  tab.view.webContents.reload();
}

function toggleActiveTabDevTools(ctx) {
  const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
  if (!tab || !tab.view) return;
  if (tab.view.webContents.isDevToolsOpened()) {
    tab.view.webContents.closeDevTools();
  } else {
    tab.view.webContents.openDevTools({ mode: 'right' });
  }
}

function detectFileCategory(filename) {
  const ext = path.extname(filename || '').toLowerCase().replace('.', '');
  if (['mp4', 'mkv', 'webm', 'mp3', 'wav', 'flac', 'ogg', 'png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'media';
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv'].includes(ext)) return 'documents';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(ext)) return 'archives';
  if (['exe', 'msi', 'msix', 'deb', 'rpm', 'appimage', 'dmg', 'apk'].includes(ext)) return 'apps';
  return 'other';
}

function setupDownloadListener(ses) {
  ses.on('will-download', (_event, item) => {
    const id = 'dl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const fileName = item.getFilename();
    const downloadsDir = app.getPath('downloads');
    const savePath = path.join(downloadsDir, fileName);
    item.setSavePath(savePath);

    activeDownloadItems.set(id, item);

    let lastBytes = 0;
    let lastTime = Date.now();

    const record = {
      id,
      filename: fileName,
      category: detectFileCategory(fileName),
      url: item.getURL(),
      savePath,
      totalBytes: item.getTotalBytes(),
      receivedBytes: 0,
      speedBytesPerSec: 0,
      etaSeconds: 0,
      isPaused: false,
      state: 'progressing',
      startedAt: Date.now()
    };

    storage.upsertDownload(record);
    for (const ctx of windowContexts.values()) {
      ctx.win?.webContents.send('downloads:update', storage.getDownloads());
    }

    item.on('updated', (_e, state) => {
      const now = Date.now();
      const dt = Math.max(0.1, (now - lastTime) / 1000);
      const currBytes = item.getReceivedBytes();
      const totalBytes = item.getTotalBytes();

      if (dt >= 0.35) {
        const diff = Math.max(0, currBytes - lastBytes);
        record.speedBytesPerSec = Math.round(diff / dt);
        lastBytes = currBytes;
        lastTime = now;
      }

      record.receivedBytes = currBytes;
      record.totalBytes = totalBytes;
      record.isPaused = item.isPaused();
      record.state = record.isPaused ? 'paused' : state;
      record.etaSeconds =
        record.speedBytesPerSec > 0 && totalBytes > currBytes
          ? Math.ceil((totalBytes - currBytes) / record.speedBytesPerSec)
          : 0;

      storage.upsertDownload(record);
      for (const ctx of windowContexts.values()) {
        ctx.win?.webContents.send('downloads:update', storage.getDownloads());
      }
    });

    item.once('done', (_e, state) => {
      activeDownloadItems.delete(id);
      record.receivedBytes = item.getReceivedBytes();
      record.totalBytes = item.getTotalBytes();
      record.speedBytesPerSec = 0;
      record.etaSeconds = 0;
      record.isPaused = false;
      record.state = state;
      record.completedAt = Date.now();
      storage.upsertDownload(record);
      for (const ctx of windowContexts.values()) {
        ctx.win?.webContents.send('downloads:update', storage.getDownloads());
      }
    });
  });
}

async function saveScreenshotPng(ctx, pngBuffer, label = 'Full') {
  const filename = `nextGx-${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
  const savePath = path.join(app.getPath('downloads'), filename);
  fs.writeFileSync(savePath, pngBuffer);

  try {
    clipboard.writeImage(nativeImage.createFromBuffer(pngBuffer));
  } catch (_) {}

  storage.upsertDownload({
    id: 'dl-shot-' + Date.now(),
    filename,
    category: 'media',
    url: 'nextgx://screenshot',
    savePath,
    totalBytes: pngBuffer.length,
    receivedBytes: pngBuffer.length,
    speedBytesPerSec: 0,
    etaSeconds: 0,
    isPaused: false,
    state: 'completed',
    startedAt: Date.now(),
    completedAt: Date.now()
  });

  for (const c of windowContexts.values()) {
    c.win?.webContents.send('downloads:update', storage.getDownloads());
  }
  ctx.win?.webContents.send('ui:toast', `Screenshot saved & copied: ${filename}`);
  return { ok: true, savePath, filename };
}

function createBrowserWindow({ incognito = false } = {}) {
  const s = storage.getSettings();
  const winSession = incognito
    ? session.fromPartition('incognito-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), { cache: false })
    : session.defaultSession;

  if (incognito) {
    adBlocker.attachToSession(winSession);
    setupPermissionsForSession(winSession);
    setupDownloadListener(winSession);
  }

  const win = new BrowserWindow({
    width: 1420,
    height: 890,
    minWidth: 960,
    minHeight: 620,
    frame: false,
    backgroundColor: incognito ? '#09090d' : '#12101b',
    title: incognito ? 'nextGx Private' : 'nextGx Browser',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const ctx = {
    win,
    incognito: Boolean(incognito),
    session: winSession,
    tabs: new Map(),
    tabOrder: [],
    activeTabId: null,
    layoutState: {
      left: SIDEBAR_ICON_WIDTH,
      top: TOP_CHROME_HEIGHT,
      right: 0,
      bottom: 0,
      leftWebVisible: false,
      leftWebPinned: Boolean(s.leftPanelPinned),
      leftWebWidth: s.leftPanelWidth || 420
    },
    leftDockHeaderView: null,
    leftWebView: null,
    leftDockResizerView: null,
    currentLeftWebUrl: '',
    currentLeftWebKind: null,
    leftWebAudioPlaying: false,
    popoverView: null,
    popoverOpenKind: null,
    screenshotView: null,
    pendingScreenshotDataUrl: ''
  };

  windowContexts.set(win.id, ctx);
  webContentsToWinId.set(win.webContents.id, win.id);

  attachKeyboardShortcuts(ctx, win.webContents);

  win.loadFile(path.join(__dirname, 'ui', 'index.html'), {
    query: incognito ? { incognito: '1' } : {}
  });

  win.on('resize', () => updateActiveViewBounds(ctx));
  win.on('maximize', () => updateActiveViewBounds(ctx));
  win.on('unmaximize', () => updateActiveViewBounds(ctx));
  win.on('closed', () => {
    windowContexts.delete(win.id);
  });

  win.webContents.once('did-finish-load', () => {
    createTab(ctx, { url: 'nextgx://newtab', active: true });
    win.webContents.send('adblock:update', adBlocker.getStats());
    win.webContents.send('system:stats-update', collectSystemStats());
  });

  return ctx;
}

function registerIpcHandlers() {
  ipcMain.handle('tabs:create', (e, opts) => {
    const ctx = getCtxFromSender(e.sender);
    if (opts?.incognito) {
      createBrowserWindow({ incognito: true });
      return serializeTabs(ctx);
    }
    return createTab(ctx, opts || {});
  });
  ipcMain.handle('tabs:switch', (e, tabId) => switchTab(getCtxFromSender(e.sender), tabId));
  ipcMain.handle('tabs:close', (e, tabId) => closeTab(getCtxFromSender(e.sender), tabId));
  ipcMain.handle('tabs:pin', (e, tabId) => togglePinTab(getCtxFromSender(e.sender), tabId));
  ipcMain.handle('tabs:sleep', (e, tabId) => sleepTab(getCtxFromSender(e.sender), tabId));
  ipcMain.handle('tabs:sleep-background', (e) => sleepBackgroundTabs(getCtxFromSender(e.sender)));
  ipcMain.handle('tabs:get-state', (e) => serializeTabs(getCtxFromSender(e.sender)));
  ipcMain.handle('tabs:navigate', (e, input) => {
    const ctx = getCtxFromSender(e.sender);
    navigateActiveTab(ctx, input);
    return serializeTabs(ctx);
  });
  ipcMain.handle('tabs:back', (e) => {
    const ctx = getCtxFromSender(e.sender);
    const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    if (tab?.view?.webContents.canGoBack()) tab.view.webContents.goBack();
    return serializeTabs(ctx);
  });
  ipcMain.handle('tabs:forward', (e) => {
    const ctx = getCtxFromSender(e.sender);
    const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    if (tab?.view?.webContents.canGoForward()) tab.view.webContents.goForward();
    return serializeTabs(ctx);
  });
  ipcMain.handle('tabs:reload', (e) => {
    const ctx = getCtxFromSender(e.sender);
    reloadActiveTab(ctx);
    return serializeTabs(ctx);
  });
  ipcMain.handle('tabs:stop', (e) => {
    const ctx = getCtxFromSender(e.sender);
    const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    if (tab?.view) tab.view.webContents.stop();
    return serializeTabs(ctx);
  });
  ipcMain.handle('tabs:home', (e) => {
    const ctx = getCtxFromSender(e.sender);
    navigateActiveTab(ctx, 'nextgx://newtab');
    return serializeTabs(ctx);
  });
  ipcMain.handle('tabs:devtools', (e) => toggleActiveTabDevTools(getCtxFromSender(e.sender)));

  ipcMain.handle('tabs:zoom', (e, action) => {
    const ctx = getCtxFromSender(e.sender);
    const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    if (!tab || !tab.view) return 100;
    let factor = tab.zoomFactor || 1.0;
    if (action === 'in') factor = Math.min(3.0, +(factor + 0.1).toFixed(2));
    else if (action === 'out') factor = Math.max(0.3, +(factor - 0.1).toFixed(2));
    else if (action === 'reset') factor = 1.0;
    tab.zoomFactor = factor;
    tab.view.webContents.setZoomFactor(factor);
    broadcastState(ctx);
    return Math.round(factor * 100);
  });

  ipcMain.handle('tabs:print', (e) => {
    const ctx = getCtxFromSender(e.sender);
    const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    if (tab?.view) tab.view.webContents.print();
  });

  ipcMain.handle('tabs:screenshot', async (e) => {
    const ctx = getCtxFromSender(e.sender);
    closePopover(ctx);
    const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    if (!tab || !tab.view) return { ok: false };
    try {
      const image = await tab.view.webContents.capturePage();
      return await saveScreenshotPng(ctx, image.toPNG(), 'Full');
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('tabs:screenshot-area-start', async (e) => {
    const ctx = getCtxFromSender(e.sender);
    closePopover(ctx);
    const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    if (!tab || !tab.view) return { ok: false };
    const image = await tab.view.webContents.capturePage();
    ctx.pendingScreenshotDataUrl = image.toDataURL();

    if (!ctx.screenshotView) {
      ctx.screenshotView = new WebContentsView({
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false
        }
      });
      webContentsToWinId.set(ctx.screenshotView.webContents.id, ctx.win.id);
      ctx.screenshotView.webContents.loadFile(SCREENSHOT_FILE);
      ctx.win.contentView.addChildView(ctx.screenshotView);
    }

    updateActiveViewBounds(ctx);
    ctx.screenshotView.webContents.send('screenshot:captured', { dataUrl: ctx.pendingScreenshotDataUrl });
    setTimeout(() => {
      ctx.screenshotView?.webContents.send('screenshot:captured', { dataUrl: ctx.pendingScreenshotDataUrl });
    }, 180);
    return { ok: true };
  });

  ipcMain.handle('tabs:screenshot-area-finish', async (e, rect) => {
    const ctx = getCtxFromSender(e.sender);
    const dataUrl = ctx.pendingScreenshotDataUrl;
    ctx.pendingScreenshotDataUrl = '';
    updateActiveViewBounds(ctx);
    if (!dataUrl || !rect || rect.width < 4 || rect.height < 4) return { ok: false };
    const img = nativeImage.createFromDataURL(dataUrl);
    const size = img.getSize();
    const cropRect = {
      x: Math.max(0, Math.min(size.width - 1, Math.round(rect.x))),
      y: Math.max(0, Math.min(size.height - 1, Math.round(rect.y))),
      width: Math.max(1, Math.min(size.width - Math.round(rect.x), Math.round(rect.width))),
      height: Math.max(1, Math.min(size.height - Math.round(rect.y), Math.round(rect.height)))
    };
    const cropped = img.crop(cropRect);
    return await saveScreenshotPng(ctx, cropped.toPNG(), 'Area');
  });

  ipcMain.handle('tabs:screenshot-area-cancel', (e) => {
    const ctx = getCtxFromSender(e.sender);
    ctx.pendingScreenshotDataUrl = '';
    updateActiveViewBounds(ctx);
    return { ok: true };
  });

  ipcMain.handle('tabs:reader-mode', async (e) => {
    const ctx = getCtxFromSender(e.sender);
    const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    if (!tab || !tab.view) return false;
    tab.readerMode = !tab.readerMode;
    if (tab.readerMode) {
      await tab.view.webContents.insertCSS(`
        body {
          max-width: 740px !important;
          margin: 40px auto !important;
          padding: 32px !important;
          background: #14161f !important;
          color: #e2e8f0 !important;
          font-family: Georgia, 'Charter', serif !important;
          font-size: 19px !important;
          line-height: 1.75 !important;
        }
        header, nav, footer, aside, [class*="sidebar"], [class*="banner"] { display: none !important; }
      `).catch(() => {});
    } else {
      tab.view.webContents.reload();
    }
    broadcastState(ctx);
    return tab.readerMode;
  });

  ipcMain.handle('tabs:find', (e, { text, forward = true } = {}) => {
    const ctx = getCtxFromSender(e.sender);
    const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    if (!tab || !tab.view || !text) return;
    tab.view.webContents.findInPage(text, { forward, findNext: true });
  });

  ipcMain.handle('tabs:stop-find', (e) => {
    const ctx = getCtxFromSender(e.sender);
    const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    if (tab?.view) tab.view.webContents.stopFindInPage('clearSelection');
  });

  ipcMain.handle('window:new', () => createBrowserWindow({ incognito: false }));
  ipcMain.handle('window:fullscreen', (e) => {
    const ctx = getCtxFromSender(e.sender);
    if (!ctx?.win) return false;
    const next = !ctx.win.isFullScreen();
    ctx.win.setFullScreen(next);
    return next;
  });

  ipcMain.handle('cleaner:run', async (_e, { cache = true, cookies = false, history = false } = {}) => {
    if (cache) await session.defaultSession.clearCache();
    if (cookies) await session.defaultSession.clearStorageData({ storages: ['cookies', 'localstorage'] });
    if (history) storage.clearHistory('all');
    return { cleanedAt: Date.now() };
  });

  ipcMain.handle('popover:open', (e, opts) => openPopover(getCtxFromSender(e.sender), opts || {}));
  ipcMain.handle('popover:close', (e) => closePopover(getCtxFromSender(e.sender)));

  ipcMain.handle('menu:action', (e, action) => {
    const ctx = getCtxFromSender(e.sender);
    closePopover(ctx);
    if (action === 'new-tab') createTab(ctx, { url: 'nextgx://newtab', active: true });
    else if (action === 'new-window') createBrowserWindow({ incognito: false });
    else if (action === 'new-incognito') createBrowserWindow({ incognito: true });
    else if (action === 'passwords') createTab(ctx, { url: 'nextgx://passwords', active: true });
    else if (action === 'history') createTab(ctx, { url: 'nextgx://history', active: true });
    else if (action === 'downloads') createTab(ctx, { url: 'nextgx://downloads', active: true });
    else if (action === 'bookmarks') createTab(ctx, { url: 'nextgx://bookmarks', active: true });
    else if (action === 'bookmark-current') {
      const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
      if (tab) {
        storage.toggleBookmark({ title: tab.title, url: formatDisplayUrl(tab.url) });
        broadcastState(ctx);
      }
    } else if (action === 'extensions') createTab(ctx, { url: 'nextgx://extensions', active: true });
    else if (action === 'print') {
      const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
      if (tab?.view) tab.view.webContents.print();
    } else if (action === 'find') ctx.win?.webContents.send('shortcut:action', 'open-find');
    else if (action === 'devtools') toggleActiveTabDevTools(ctx);
    else if (action === 'settings') createTab(ctx, { url: 'nextgx://settings', active: true });
    else if (action === 'exit') ctx.win?.close();
  });

  ipcMain.handle('permissions:get', (_e, origin) => storage.getSitePermissions(origin));
  ipcMain.handle('permissions:set', (_e, { origin, key, value }) => storage.setSitePermission(origin, key, value));

  ipcMain.handle('layout:set-offsets', (e, partial) => {
    const ctx = getCtxFromSender(e.sender);
    ctx.layoutState = { ...ctx.layoutState, ...(partial || {}) };
    updateActiveViewBounds(ctx);
    return ctx.layoutState;
  });

  // Left Overlay Dock
  ipcMain.handle('sidebar:set-web-panel', (e, { visible, kind, url, width } = {}) => {
    const ctx = getCtxFromSender(e.sender);
    if (typeof width === 'number') {
      ctx.layoutState.leftWebWidth = Math.max(280, Math.min(880, width));
    }
    ctx.layoutState.leftWebVisible = Boolean(visible);
    if (kind) ctx.currentLeftWebKind = kind;

    if (ctx.layoutState.leftWebVisible) {
      ensureLeftDockViews(ctx);
      const targetUrl = url || ctx.currentLeftWebUrl;
      if (targetUrl && targetUrl !== ctx.currentLeftWebUrl) {
        ctx.currentLeftWebUrl = targetUrl;
        ctx.leftWebView.webContents.loadURL(targetUrl).catch(() => {});
      }
      const dockInfo = {
        visible: true,
        kind: ctx.currentLeftWebKind,
        url: ctx.currentLeftWebUrl,
        pinned: ctx.layoutState.leftWebPinned
      };
      ctx.leftDockHeaderView?.webContents.send('leftdock:update', dockInfo);
      ctx.win?.webContents.send('leftdock:update', dockInfo);
    } else {
      ctx.win?.webContents.send('leftdock:update', { visible: false, kind: null, url: ctx.currentLeftWebUrl });
    }
    updateActiveViewBounds(ctx);
    return {
      visible: ctx.layoutState.leftWebVisible,
      kind: ctx.currentLeftWebKind,
      url: ctx.currentLeftWebUrl,
      pinned: ctx.layoutState.leftWebPinned,
      width: ctx.layoutState.leftWebWidth
    };
  });

  ipcMain.handle('sidebar:reload-web-panel', (e) => {
    const ctx = getCtxFromSender(e.sender);
    if (ctx?.leftWebView) ctx.leftWebView.webContents.reload();
  });

  ipcMain.handle('sidebar:toggle-pin', (e) => {
    const ctx = getCtxFromSender(e.sender);
    ctx.layoutState.leftWebPinned = !ctx.layoutState.leftWebPinned;
    storage.updateSettings({ leftPanelPinned: ctx.layoutState.leftWebPinned });
    const dockInfo = {
      visible: ctx.layoutState.leftWebVisible,
      kind: ctx.currentLeftWebKind,
      url: ctx.currentLeftWebUrl,
      pinned: ctx.layoutState.leftWebPinned
    };
    ctx.leftDockHeaderView?.webContents.send('leftdock:update', dockInfo);
    ctx.win?.webContents.send('leftdock:update', dockInfo);
    updateActiveViewBounds(ctx);
    return ctx.layoutState.leftWebPinned;
  });

  ipcMain.handle('sidebar:resize', (e, width) => {
    const ctx = getCtxFromSender(e.sender);
    ctx.layoutState.leftWebWidth = Math.max(280, Math.min(880, Number(width || 420)));
    storage.updateSettings({ leftPanelWidth: ctx.layoutState.leftWebWidth });
    updateActiveViewBounds(ctx);
    return ctx.layoutState.leftWebWidth;
  });

  // Bookmarks, History, Downloads, Passwords, Notes, Extensions, Settings
  ipcMain.handle('bookmarks:get', () => storage.getBookmarks());
  ipcMain.handle('bookmarks:toggle', (e) => {
    const ctx = getCtxFromSender(e.sender);
    const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    if (!tab) return { added: false, bookmarks: storage.getBookmarks() };
    const result = storage.toggleBookmark({ title: tab.title, url: formatDisplayUrl(tab.url) });
    broadcastState(ctx);
    return result;
  });
  ipcMain.handle('bookmarks:remove', (e, id) => {
    const list = storage.removeBookmark(id);
    for (const ctx of windowContexts.values()) broadcastState(ctx);
    return list;
  });

  ipcMain.handle('history:get', () => storage.getHistory());
  ipcMain.handle('history:clear', (_e, range) => storage.clearHistory(range || 'all'));
  ipcMain.handle('history:remove', (_e, id) => storage.removeHistoryItem(id));

  ipcMain.handle('downloads:get', () => storage.getDownloads());
  ipcMain.handle('downloads:pause', (_e, id) => {
    const item = activeDownloadItems.get(id);
    if (item && item.canResume() && !item.isPaused()) item.pause();
    return storage.getDownloads();
  });
  ipcMain.handle('downloads:resume', (_e, id) => {
    const item = activeDownloadItems.get(id);
    if (item && item.isPaused()) item.resume();
    return storage.getDownloads();
  });
  ipcMain.handle('downloads:cancel', (_e, id) => {
    const item = activeDownloadItems.get(id);
    if (item) {
      item.cancel();
      activeDownloadItems.delete(id);
    }
    return storage.getDownloads();
  });
  ipcMain.handle('downloads:remove', (_e, id) => {
    const list = storage.removeDownload(id);
    for (const ctx of windowContexts.values()) ctx.win?.webContents.send('downloads:update', list);
    return list;
  });
  ipcMain.handle('downloads:clear', () => {
    const list = storage.clearDownloads();
    for (const ctx of windowContexts.values()) ctx.win?.webContents.send('downloads:update', list);
    return list;
  });
  ipcMain.handle('downloads:open', (_e, savePath) => { if (savePath) shell.openPath(savePath); });
  ipcMain.handle('downloads:show-folder', (_e, savePath) => { if (savePath) shell.showItemInFolder(savePath); });

  ipcMain.handle('passwords:get', () => storage.getPasswords());
  ipcMain.handle('passwords:add', (_e, entry) => storage.addPassword(entry));
  ipcMain.handle('passwords:remove', (_e, id) => storage.removePassword(id));
  ipcMain.handle('notes:get', () => storage.getNotes());
  ipcMain.handle('notes:save', (_e, text) => storage.saveNote(text));

  ipcMain.handle('extensions:list', () => {
    try {
      const extApi = session.defaultSession.extensions || session.defaultSession;
      const all = extApi.getAllExtensions ? extApi.getAllExtensions() : [];
      return all.map((e) => ({ id: e.id, name: e.name, version: e.version }));
    } catch (_) {
      return [];
    }
  });

  ipcMain.handle('extensions:load-unpacked', async (e) => {
    const ctx = getCtxFromSender(e.sender);
    const res = await dialog.showOpenDialog(ctx.win, {
      title: 'Select Unpacked Chrome Extension Folder (containing manifest.json)',
      properties: ['openDirectory']
    });
    if (res.canceled || !res.filePaths.length) return [];
    try {
      const extApi = session.defaultSession.extensions || session.defaultSession;
      await extApi.loadExtension(res.filePaths[0], { allowFileAccess: true });
    } catch (err) {
      console.error('Failed to load extension:', err.message);
    }
    const extApi = session.defaultSession.extensions || session.defaultSession;
    const all = extApi.getAllExtensions ? extApi.getAllExtensions() : [];
    return all.map((e) => ({ id: e.id, name: e.name, version: e.version }));
  });

  ipcMain.handle('extensions:remove', (_e, id) => {
    try {
      const extApi = session.defaultSession.extensions || session.defaultSession;
      if (extApi.removeExtension) extApi.removeExtension(id);
    } catch (_) {}
    return true;
  });

  ipcMain.handle('adblock:stats', () => adBlocker.getStats());
  ipcMain.handle('adblock:toggle', (_e, enabled) => {
    storage.updateSettings({ adblockEnabled: Boolean(enabled) });
    return adBlocker.getStats();
  });
  ipcMain.handle('settings:get', () => storage.getSettings());
  ipcMain.handle('settings:update', (_e, partial) => {
    const s = storage.updateSettings(partial || {});
    for (const ctx of windowContexts.values()) {
      broadcastState(ctx);
      if (partial?.musicServiceUrl) {
        ctx.win?.webContents.send('leftdock:update', {
          visible: ctx.layoutState.leftWebVisible,
          kind: ctx.currentLeftWebKind,
          url: partial.musicServiceUrl
        });
      }
    }
    return s;
  });

  ipcMain.handle('newtab:get-data', () => ({
    speedDial: storage.getSpeedDial(),
    settings: storage.getSettings(),
    adblock: adBlocker.getStats(),
    system: collectSystemStats(),
    notes: storage.getNotes()
  }));
  ipcMain.handle('newtab:add-dial', (_e, item) => storage.addSpeedDial(item));
  ipcMain.handle('newtab:remove-dial', (_e, id) => storage.removeSpeedDial(id));
  ipcMain.handle('system:stats', () => collectSystemStats());

  ipcMain.handle('window:minimize', (e) => getCtxFromSender(e.sender)?.win?.minimize());
  ipcMain.handle('window:maximize', (e) => {
    const win = getCtxFromSender(e.sender)?.win;
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle('window:close', (e) => getCtxFromSender(e.sender)?.win?.close());
}

function collectSystemStats() {
  const totalSysMB = Math.round(os.totalmem() / (1024 * 1024));
  const freeSysMB = Math.round(os.freemem() / (1024 * 1024));
  const usedSysMB = totalSysMB - freeSysMB;
  const browserRamMB = getBrowserRamMB();
  const cpuPercent = getSystemCpuPercent();

  let activeTabsCount = 0;
  let sleepingTabsCount = 0;
  for (const ctx of windowContexts.values()) {
    for (const t of ctx.tabs.values()) {
      if (t.sleeping) sleepingTabsCount += 1;
      else activeTabsCount += 1;
    }
  }

  return {
    totalSysMB,
    usedSysMB,
    freeSysMB,
    sysRamPercent: Math.round((usedSysMB / totalSysMB) * 100),
    browserRamMB,
    cpuPercent,
    activeTabsCount,
    sleepingTabsCount,
    settings: storage.getSettings()
  };
}

function startBackgroundTimers() {
  setInterval(() => {
    const stats = collectSystemStats();
    for (const ctx of windowContexts.values()) {
      if (ctx.win && !ctx.win.isDestroyed()) {
        ctx.win.webContents.send('system:stats-update', stats);
      }
    }
  }, 2500);

  setInterval(() => {
    const s = storage.getSettings();
    if (!s.autoSleepEnabled) return;
    const timeoutMs = Math.max(1, Number(s.autoSleepMinutes || 10)) * 60 * 1000;
    const now = Date.now();
    for (const ctx of windowContexts.values()) {
      for (const [id, tab] of ctx.tabs.entries()) {
        if (
          id !== ctx.activeTabId &&
          !tab.sleeping &&
          !tab.pinned &&
          !tab.audible &&
          now - tab.lastActiveAt >= timeoutMs
        ) {
          sleepTab(ctx, id);
        }
      }
    }
  }, 20000);
}

app.whenReady().then(() => {
  storage = new StorageManager();
  adBlocker = new AdBlocker(storage, (stats) => {
    for (const ctx of windowContexts.values()) {
      if (ctx.win && !ctx.win.isDestroyed()) {
        ctx.win.webContents.send('adblock:update', stats);
      }
    }
  });

  adBlocker.attachToSession(session.defaultSession);
  setupPermissionsForSession(session.defaultSession);
  setupDownloadListener(session.defaultSession);
  registerIpcHandlers();

  createBrowserWindow({ incognito: false });
  startBackgroundTimers();
});

app.on('before-quit', () => {
  if (storage) storage.flushSettings();
});

app.on('window-all-closed', () => {
  app.quit();
});
