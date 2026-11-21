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
const { pathToFileURL, fileURLToPath } = require('url');
const { StorageManager } = require('./storage');
const { AdBlocker } = require('./adblocker');

const isRunningAsRoot =
  typeof process.geteuid === 'function'
    ? process.geteuid() === 0
    : typeof process.getuid === 'function' && process.getuid() === 0;
if (isRunningAsRoot) {
  app.commandLine.appendSwitch('no-sandbox');
}
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const TOP_CHROME_HEIGHT = 82;
const BOOKMARKS_BAR_HEIGHT = 30;
const SIDEBAR_ICON_WIDTH = 50;
const PRIVATE_WINDOW_TITLE = 'nextGx Browser — Private';
const UI_DIR = path.resolve(__dirname, 'ui');
const NEW_TAB_FILE = path.join(UI_DIR, 'newtab.html');
const NEW_TAB_FILE_URL = pathToFileURL(NEW_TAB_FILE).toString();
const WEBUI_FILE = path.join(UI_DIR, 'chrome-webui.html');
const WEBUI_FILE_URL = pathToFileURL(WEBUI_FILE).toString();
const ERROR_PAGE_FILE = path.join(UI_DIR, 'error.html');
const ERROR_PAGE_FILE_URL = pathToFileURL(ERROR_PAGE_FILE).toString();
const POPOVER_FILE = path.join(UI_DIR, 'popover.html');
const SCREENSHOT_FILE = path.join(UI_DIR, 'screenshot.html');

function normalizePathForCompare(p) {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

function isPathInsideDir(baseDir, candidatePath) {
  const rel = path.relative(baseDir, candidatePath);
  return Boolean(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

function resolveInternalUiFile(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'file:') return null;
    if (parsed.hostname && parsed.hostname !== 'localhost') return null;
    const resolved = path.resolve(fileURLToPath(parsed));
    if (!isPathInsideDir(UI_DIR, resolved)) return null;
    return resolved;
  } catch (_) {
    return null;
  }
}

function isInternalUiSender(event) {
  if (!event || !event.senderFrame || !event.sender) return false;
  if (event.senderFrame !== event.sender.mainFrame) return false;
  return Boolean(resolveInternalUiFile(event.senderFrame.url));
}

function resolveSafeDownloadPath(targetPath) {
  if (typeof targetPath !== 'string' || !targetPath || targetPath.includes('\0')) return null;
  if (!path.isAbsolute(targetPath)) return null;

  const downloadsDir = path.resolve(app.getPath('downloads'));
  const resolved = path.resolve(targetPath);
  if (!isPathInsideDir(downloadsDir, resolved)) return null;

  try {
    const realDownloads = fs.realpathSync(downloadsDir);
    try {
      const realTarget = fs.realpathSync(resolved);
      if (!isPathInsideDir(realDownloads, realTarget)) return null;
      return realTarget;
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        try {
          if (fs.lstatSync(resolved).isSymbolicLink()) return null;
        } catch (_) {}
        try {
          const realParent = fs.realpathSync(path.dirname(resolved));
          if (
            normalizePathForCompare(realParent) !== normalizePathForCompare(realDownloads) &&
            !isPathInsideDir(realDownloads, realParent)
          ) {
            return null;
          }
        } catch (_) {}
        return resolved;
      }
      return null;
    }
  } catch (_) {
    return resolved;
  }
}

function normalizeAutofillHost(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const input = raw.trim().toLowerCase();
  if (!input) return '';
  try {
    const u = new URL(input.includes('://') ? input : `https://${input}`);
    let host = u.hostname.toLowerCase().replace(/\.$/, '');
    if (!host || host.startsWith('.') || host.includes('..')) return '';
    if (/^www\.[^.]+\./.test(host)) {
      host = host.slice(4);
    }
    return host;
  } catch (_) {
    return '';
  }
}

function isIpAddress(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

function isAutofillHostMatch(pageHost, savedSite) {
  const current = normalizeAutofillHost(pageHost);
  const saved = normalizeAutofillHost(savedSite);
  if (!current || !saved) return false;
  if (current === saved) return true;
  if (isIpAddress(current) || isIpAddress(saved)) return false;
  if (!saved.includes('.')) return false;
  return current.endsWith(`.${saved}`);
}

let storage = null;
let adBlocker = null;
const activeDownloadItems = new Map();
const windowContexts = new Map(); // BrowserWindow.id -> ctx
const webContentsToWinId = new Map(); // webContents.id -> BrowserWindow.id
let sessionSaveTimer = null;
let cookiesUpdateTimer = null;
let isAppQuitting = false;

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

function isErrorPageUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  return urlStr.startsWith(ERROR_PAGE_FILE_URL) || urlStr.includes('/src/ui/error.html');
}

function getFailedUrlFromErrorPage(urlStr) {
  if (!isErrorPageUrl(urlStr)) return '';
  try {
    const u = new URL(urlStr);
    return u.searchParams.get('url') || '';
  } catch (_) {
    return '';
  }
}

function formatFailedTabTitle(failedUrl) {
  if (!failedUrl || typeof failedUrl !== 'string') return 'Failed to load';
  try {
    const u = new URL(failedUrl);
    if (u.host) return `${u.host} — Failed to load`;
    if (u.protocol === 'file:') {
      const base = path.basename(decodeURIComponent(u.pathname || ''));
      if (base) return `${base} — Failed to load`;
    }
  } catch (_) {}
  return 'Failed to load';
}

function buildErrorPageUrl({ failedUrl, errorCode, errorDescription }, ctx) {
  const u = new URL(ERROR_PAGE_FILE_URL);
  u.searchParams.set('url', failedUrl || '');
  u.searchParams.set('code', String(errorCode ?? ''));
  u.searchParams.set('desc', String(errorDescription || ''));
  const theme = storage?.getSettings?.().theme || 'gx-violet';
  u.searchParams.set('theme', theme);
  if (ctx?.incognito) {
    u.searchParams.set('incognito', '1');
  }
  return u.toString();
}

function getInternalUiQuery(incognito = false) {
  const s = storage?.getSettings?.() || {};
  const theme = s.theme || 'gx-violet';
  const bookmarksBar = s.showBookmarksBar === false ? '0' : '1';
  return incognito ? { theme, bookmarksBar, incognito: '1' } : { theme, bookmarksBar };
}

function appendInternalUrlParams(rawUrl, ctx) {
  if (!isNewTabUrl(rawUrl) && !isWebUiUrl(rawUrl) && !isErrorPageUrl(rawUrl)) return rawUrl;
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'file:') return rawUrl;
    const theme = storage?.getSettings?.().theme || 'gx-violet';
    u.searchParams.set('theme', theme);
    if (ctx?.incognito) {
      u.searchParams.set('incognito', '1');
    } else {
      u.searchParams.delete('incognito');
    }
    return u.toString();
  } catch (_) {
    return rawUrl;
  }
}

function formatDisplayUrl(rawUrl) {
  if (isNewTabUrl(rawUrl)) return 'nextgx://newtab';
  if (isWebUiUrl(rawUrl)) {
    const hash = (rawUrl.split('#')[1] || 'history').toLowerCase();
    if (hash === 'passwords') return 'nextgx://passwords';
    return `nextgx://${hash}`;
  }
  if (isErrorPageUrl(rawUrl)) {
    return getFailedUrlFromErrorPage(rawUrl) || '';
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
        isBookmarked: storage.isBookmarked(displayUrl),
        adblockSiteEnabled: adBlocker
          ? origin
            ? adBlocker.isSiteBlockingActive(origin)
            : adBlocker.isEnabled()
          : true
      };
    });

  return {
    windowIncognito: ctx.incognito,
    tabs: ordered,
    activeTabId: ctx.activeTabId,
    activeTab: ordered.find((t) => t.id === ctx.activeTabId) || null
  };
}

function broadcastState(ctx) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return;
  const serialized = serializeTabs(ctx);
  ctx.win.webContents.send('state:update', serialized);
  if (
    ctx.popoverOpenKind === 'menu' &&
    ctx.popoverView &&
    ctx.popoverView.webContents &&
    !ctx.popoverView.webContents.isDestroyed()
  ) {
    if (ctx.popoverPayload && ctx.popoverPayload.payload && serialized.activeTab) {
      ctx.popoverPayload.payload.zoomPercent = serialized.activeTab.zoomPercent;
    }
    ctx.popoverView.webContents.send('state:update', serialized);
  }
}

function sendToWebUiTabs(channel, payload) {
  for (const ctx of windowContexts.values()) {
    for (const tab of ctx.tabs.values()) {
      if (!tab || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed()) continue;
      const wcUrl = tab.view.webContents.getURL();
      if (isWebUiUrl(tab.url) || isWebUiUrl(wcUrl)) {
        tab.view.webContents.send(channel, payload);
      }
    }
  }
}

function notifyActiveWebUiTabShown(ctx) {
  if (!ctx || !ctx.activeTabId) return;
  const tab = ctx.tabs.get(ctx.activeTabId);
  if (!tab || tab.sleeping || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed()) return;
  const wcUrl = tab.view.webContents.getURL();
  if (isWebUiUrl(tab.url) || isWebUiUrl(wcUrl)) {
    tab.view.webContents.send('webui:shown');
  }
}

function broadcastAdblockUpdate(stats) {
  const payload = stats || (adBlocker ? adBlocker.getStats() : null);
  if (!payload) return;
  for (const ctx of windowContexts.values()) {
    if (ctx.win && !ctx.win.isDestroyed()) {
      ctx.win.webContents.send('adblock:update', payload);
    }
    if (ctx.popoverView && ctx.popoverView.webContents && !ctx.popoverView.webContents.isDestroyed()) {
      ctx.popoverView.webContents.send('adblock:update', payload);
    }
  }
  sendToWebUiTabs('adblock:update', payload);
}

function broadcastHistoryUpdate() {
  sendToWebUiTabs('history:update');
}

function broadcastDownloadsUpdate(downloads) {
  const payload = downloads || (storage ? storage.getDownloads() : []);
  for (const ctx of windowContexts.values()) {
    if (ctx.win && !ctx.win.isDestroyed()) {
      ctx.win.webContents.send('downloads:update', payload);
    }
    if (ctx.popoverView && ctx.popoverView.webContents && !ctx.popoverView.webContents.isDestroyed()) {
      ctx.popoverView.webContents.send('downloads:update', payload);
    }
  }
  sendToWebUiTabs('downloads:update', payload);
}

function cancelScheduledCookiesBroadcast() {
  if (cookiesUpdateTimer) {
    clearTimeout(cookiesUpdateTimer);
    cookiesUpdateTimer = null;
  }
}

function broadcastCookiesUpdate({ immediate = false } = {}) {
  if (isAppQuitting) return;
  if (immediate) {
    cancelScheduledCookiesBroadcast();
    sendToWebUiTabs('cookies:update');
    return;
  }
  if (cookiesUpdateTimer) return;
  cookiesUpdateTimer = setTimeout(() => {
    cookiesUpdateTimer = null;
    if (!isAppQuitting) {
      sendToWebUiTabs('cookies:update');
    }
  }, 100);
}

function broadcastSettingsUpdate(settings) {
  const payload = settings || (storage ? storage.getSettings() : null);
  if (!payload) return;
  for (const ctx of windowContexts.values()) {
    if (ctx.win && !ctx.win.isDestroyed()) {
      ctx.win.webContents.send('settings:update', payload);
    }
    if (ctx.popoverView && ctx.popoverView.webContents && !ctx.popoverView.webContents.isDestroyed()) {
      ctx.popoverView.webContents.send('settings:update', payload);
    }
    if (ctx.screenshotView && ctx.screenshotView.webContents && !ctx.screenshotView.webContents.isDestroyed()) {
      ctx.screenshotView.webContents.send('settings:update', payload);
    }
    for (const tab of ctx.tabs.values()) {
      if (!tab || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed()) continue;
      const wcUrl = tab.view.webContents.getURL();
      if (
        isNewTabUrl(tab.url) ||
        isWebUiUrl(tab.url) ||
        isErrorPageUrl(tab.url) ||
        isNewTabUrl(wcUrl) ||
        isWebUiUrl(wcUrl) ||
        isErrorPageUrl(wcUrl)
      ) {
        tab.view.webContents.send('settings:update', payload);
      }
    }
  }
}

function broadcastBookmarksUpdate(bookmarks) {
  const payload = bookmarks || (storage ? storage.getBookmarks() : []);
  for (const ctx of windowContexts.values()) {
    if (ctx.win && !ctx.win.isDestroyed()) {
      ctx.win.webContents.send('bookmarks:update', payload);
    }
    if (ctx.popoverView && ctx.popoverView.webContents && !ctx.popoverView.webContents.isDestroyed()) {
      ctx.popoverView.webContents.send('bookmarks:update', payload);
    }
    for (const tab of ctx.tabs.values()) {
      if (!tab || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed()) continue;
      const wcUrl = tab.view.webContents.getURL();
      if (isWebUiUrl(tab.url) || isWebUiUrl(wcUrl)) {
        tab.view.webContents.send('bookmarks:update', payload);
      }
    }
  }
}

function getAllTabWebContents() {
  const list = [];
  for (const ctx of windowContexts.values()) {
    for (const tab of ctx.tabs.values()) {
      if (tab && tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()) {
        list.push(tab.view.webContents);
      }
    }
  }
  return list;
}

async function syncAdblockCosmeticFilters(targetOrigin = '') {
  if (!adBlocker) return;
  await adBlocker.syncCosmeticFilters(getAllTabWebContents(), targetOrigin);
}

function bringOverlaysToFront(ctx) {
  if (!ctx.win || ctx.win.isDestroyed()) return;
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

  const effectiveTabLeft = Math.max(SIDEBAR_ICON_WIDTH, ctx.layoutState.left || SIDEBAR_ICON_WIDTH);

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

function applyZoomAction(ctx, action, { notifyToast = false } = {}) {
  if (!ctx) return 100;
  const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
  if (!tab || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed()) {
    return Math.round((tab?.zoomFactor || 1.0) * 100);
  }
  let factor = tab.zoomFactor || 1.0;
  if (action === 'in') factor = Math.min(3.0, +(factor + 0.1).toFixed(2));
  else if (action === 'out') factor = Math.max(0.3, +(factor - 0.1).toFixed(2));
  else if (action === 'reset') factor = 1.0;
  tab.zoomFactor = factor;
  tab.view.webContents.setZoomFactor(factor);
  const zoomPercent = Math.round(factor * 100);
  broadcastState(ctx);
  if (notifyToast && ctx.win && !ctx.win.isDestroyed()) {
    ctx.win.webContents.send('ui:toast', `Zoom: ${zoomPercent}%`);
  }
  return zoomPercent;
}

function attachKeyboardShortcuts(ctx, webContents) {
  webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    const shift = input.shift;
    const alt = input.alt;
    const key = (input.key || '').toLowerCase();
    const code = input.code || '';

    if (ctrl && !shift && key === 't') {
      event.preventDefault();
      createTab(ctx, { url: 'nextgx://newtab', active: true });
    } else if (ctrl && shift && key === 't') {
      event.preventDefault();
      reopenLastClosedTab(ctx);
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
    } else if (ctrl && !alt && (key === '0' || (!shift && code === 'Digit0'))) {
      event.preventDefault();
      applyZoomAction(ctx, 'reset', { notifyToast: true });
    } else if (ctrl && !alt && (key === '=' || key === '+' || code === 'Equal' || code === 'NumpadAdd')) {
      event.preventDefault();
      applyZoomAction(ctx, 'in', { notifyToast: true });
    } else if (ctrl && !alt && (key === '-' || (!shift && code === 'Minus') || code === 'NumpadSubtract')) {
      event.preventDefault();
      applyZoomAction(ctx, 'out', { notifyToast: true });
    } else if (input.key === 'F11') {
      event.preventDefault();
      ctx.win?.setFullScreen(!ctx.win.isFullScreen());
    } else if (input.key === 'F12') {
      event.preventDefault();
      toggleActiveTabDevTools(ctx);
    } else if (input.key === 'Escape') {
      if (ctx.popoverOpenKind) {
        event.preventDefault();
      }
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

function ensurePopoverView(ctx) {
  if (ctx.popoverView) return ctx.popoverView;
  ctx.popoverView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  webContentsToWinId.set(ctx.popoverView.webContents.id, ctx.win.id);
  attachKeyboardShortcuts(ctx, ctx.popoverView.webContents);
  ctx.popoverView.webContents.loadFile(POPOVER_FILE, {
    query: getInternalUiQuery(ctx.incognito)
  });
  ctx.win.contentView.addChildView(ctx.popoverView);
  ctx.popoverView.setBounds({ x: -5000, y: -5000, width: 1, height: 1 });
  return ctx.popoverView;
}

function restoreFocusToActiveTab(ctx) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return;
  const activeTab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
  if (
    activeTab &&
    !activeTab.sleeping &&
    activeTab.view &&
    activeTab.view.webContents &&
    !activeTab.view.webContents.isDestroyed()
  ) {
    activeTab.view.webContents.focus();
    return;
  }
  ctx.win.focus();
  if (ctx.win.webContents && !ctx.win.webContents.isDestroyed()) {
    ctx.win.webContents.focus();
  }
}

function restoreFocusAfterPopover(ctx) {
  restoreFocusToActiveTab(ctx);
}

function closePopover(ctx) {
  if (!ctx) return;
  const wasOpen = Boolean(ctx.popoverOpenKind);
  const popoverFocused = Boolean(
    ctx.popoverView &&
    ctx.popoverView.webContents &&
    !ctx.popoverView.webContents.isDestroyed() &&
    ctx.popoverView.webContents.isFocused()
  );
  ctx.popoverOpenKind = null;
  ctx.popoverPayload = null;
  if (ctx.popoverView) {
    ctx.popoverView.setBounds({ x: -5000, y: -5000, width: 1, height: 1 });
  }
  if (ctx.win && !ctx.win.isDestroyed() && ctx.win.webContents && !ctx.win.webContents.isDestroyed()) {
    ctx.win.webContents.send('popover:data', { closed: true });
  }
  if (wasOpen || popoverFocused) {
    restoreFocusAfterPopover(ctx);
  }
}

function resizePopover(ctx, { kind, height } = {}) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return false;
  if (!ctx.popoverView || !ctx.popoverOpenKind) return false;
  if (kind && ctx.popoverOpenKind !== kind) return false;
  if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) return false;

  const [cw, ch] = ctx.win.getContentSize();
  const bounds = ctx.popoverView.getBounds();
  const maxAllowedH = Math.max(120, Math.min(540, ch - bounds.y - 12));
  const safeH = Math.max(120, Math.min(Math.ceil(height), maxAllowedH));
  const safeW = Math.min(bounds.width, cw - 16);
  const safeX = Math.max(8, Math.min(bounds.x, cw - safeW - 8));
  if (safeH !== bounds.height || safeW !== bounds.width || safeX !== bounds.x) {
    ctx.popoverView.setBounds({
      x: Math.round(safeX),
      y: Math.round(bounds.y),
      width: Math.round(safeW),
      height: Math.round(safeH)
    });
  }
  return true;
}

function openPopover(ctx, { kind, x, y, width, height, payload }) {
  if (ctx.popoverOpenKind === kind && kind !== 'tab-context') {
    const isDifferentFolder =
      kind === 'bookmark-folder' &&
      ctx.popoverPayload?.payload?.folder !== payload?.folder;
    if (!isDifferentFolder) {
      closePopover(ctx);
      return false;
    }
  }
  const view = ensurePopoverView(ctx);
  ctx.popoverOpenKind = kind;
  ctx.popoverPayload = { kind, payload: payload || {} };
  const [cw, ch] = ctx.win.getContentSize();
  const isTabContext = kind === 'tab-context';
  const isBookmarkFolder = kind === 'bookmark-folder';
  const requestedH =
    kind === 'permissions'
      ? Math.max(height || 0, 410)
      : kind === 'shield'
      ? Math.max(height || 0, 315)
      : isTabContext
      ? height || 222
      : isBookmarkFolder
      ? height || 260
      : height || 420;
  const safeW = Math.min(width || (isTabContext ? 224 : isBookmarkFolder ? 250 : 300), cw - 16);
  const baseY = isTabContext
    ? Math.max(4, y || 38)
    : Math.max(TOP_CHROME_HEIGHT - 2, y || TOP_CHROME_HEIGHT);
  const safeH = Math.min(
    requestedH,
    isTabContext
      ? ch - 16
      : Math.max(80, ch - baseY - 12)
  );
  const safeX = Math.max(8, Math.min(x || 100, cw - safeW - 8));
  const safeY = isTabContext
    ? Math.max(4, Math.min(baseY, ch - safeH - 8))
    : isBookmarkFolder
    ? Math.max(TOP_CHROME_HEIGHT - 2, Math.min(baseY, ch - safeH - 8))
    : baseY;

  ctx.win.contentView.addChildView(view);
  view.setBounds({ x: Math.round(safeX), y: Math.round(safeY), width: Math.round(safeW), height: Math.round(safeH) });
  if ((isTabContext || isBookmarkFolder) && view.webContents && !view.webContents.isDestroyed()) {
    view.webContents.focus();
  }
  const sendData = () => {
    const latest = ctx.popoverPayload;
    if (latest && ctx.popoverOpenKind === latest.kind && view.webContents && !view.webContents.isDestroyed()) {
      view.webContents.send('popover:data', latest);
    }
  };
  if (view.webContents.isLoading()) {
    view.webContents.once('did-finish-load', sendData);
  } else {
    sendData();
  }
  return true;
}

function buildWebContentsViewForTab(ctx, tab) {
  adBlocker.attachToSession(ctx.session);

  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'tab-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
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

  const shouldSkipHistory = (url) =>
    !url ||
    isNewTabUrl(url) ||
    isWebUiUrl(url) ||
    isErrorPageUrl(url) ||
    url.startsWith('chrome-error://');

  wc.on('page-title-updated', (_e, title) => {
    if (isNewTabUrl(tab.url)) {
      tab.title = ctx.incognito ? 'Private Start' : 'Start Page';
    } else if (isErrorPageUrl(tab.url)) {
      const failedUrl = getFailedUrlFromErrorPage(tab.url);
      tab.title = title || formatFailedTabTitle(failedUrl);
    } else {
      tab.title = title;
    }
    if (!ctx.incognito && !shouldSkipHistory(tab.url)) {
      storage.addHistory({ title: tab.title, url: tab.url, favicon: tab.favicon, isVisit: false });
      broadcastHistoryUpdate();
    }
    broadcastState(ctx);
    scheduleSessionSave(ctx);
  });

  wc.on('page-favicon-updated', (_e, favicons) => {
    if (Array.isArray(favicons) && favicons.length > 0 && !isErrorPageUrl(tab.url)) {
      tab.favicon = favicons[0];
      if (!ctx.incognito && !shouldSkipHistory(tab.url)) {
        storage.addHistory({ title: tab.title, url: tab.url, favicon: tab.favicon, isVisit: false });
        broadcastHistoryUpdate();
        const updatedBookmarks = storage.updateBookmarkFavicon(tab.url, tab.favicon);
        if (updatedBookmarks) {
          broadcastBookmarksUpdate(updatedBookmarks);
        }
      }
      broadcastState(ctx);
    }
  });

  const handleUrlChange = (url) => {
    if (url && url.startsWith('chrome-error://')) return;
    tab.url = url;
    if (isNewTabUrl(url)) {
      tab.title = ctx.incognito ? 'Private Start' : 'Start Page';
      tab.favicon = '';
      tab.failedUrl = '';
    } else if (isErrorPageUrl(url)) {
      const failedUrl = getFailedUrlFromErrorPage(url);
      tab.failedUrl = failedUrl;
      tab.title = formatFailedTabTitle(failedUrl);
      tab.favicon = '';
      try {
        if (wc.navigationHistory) {
          while (wc.navigationHistory.getActiveIndex() > 0) {
            const prevIdx = wc.navigationHistory.getActiveIndex() - 1;
            const prevEntry = wc.navigationHistory.getEntryAtIndex(prevIdx);
            if (
              prevEntry &&
              (prevEntry.url === failedUrl ||
                (isErrorPageUrl(prevEntry.url) && getFailedUrlFromErrorPage(prevEntry.url) === failedUrl))
            ) {
              if (!wc.navigationHistory.removeEntryAtIndex(prevIdx)) break;
            } else {
              break;
            }
          }
        }
      } catch (_) {}
    } else {
      tab.failedUrl = '';
      try {
        if (wc.navigationHistory) {
          const activeIdx = wc.navigationHistory.getActiveIndex();
          if (activeIdx > 0) {
            const prevEntry = wc.navigationHistory.getEntryAtIndex(activeIdx - 1);
            if (
              prevEntry &&
              isErrorPageUrl(prevEntry.url) &&
              getFailedUrlFromErrorPage(prevEntry.url) === url
            ) {
              wc.navigationHistory.removeEntryAtIndex(activeIdx - 1);
            }
          }
        }
      } catch (_) {}
    }
    tab.canGoBack = wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack();
    tab.canGoForward = wc.navigationHistory ? wc.navigationHistory.canGoForward() : wc.canGoForward();
    if (!ctx.incognito && !shouldSkipHistory(url)) {
      storage.addHistory({ title: tab.title, url, favicon: tab.favicon });
      broadcastHistoryUpdate();
    }
    broadcastState(ctx);
    scheduleSessionSave(ctx);
  };

  wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    if (!errorCode || errorCode === -3 || errorDescription === 'ERR_ABORTED') return;

    const failedUrl = validatedURL || tab.url || '';
    if (
      !failedUrl ||
      failedUrl.startsWith('chrome-error://') ||
      isErrorPageUrl(failedUrl) ||
      isNewTabUrl(failedUrl) ||
      isWebUiUrl(failedUrl) ||
      Boolean(resolveInternalUiFile(failedUrl))
    ) {
      return;
    }

    const errorPageUrl = buildErrorPageUrl({ failedUrl, errorCode, errorDescription }, ctx);
    const canLoadErrorPage = !wc.isDestroyed();
    tab.isLoading = canLoadErrorPage;
    tab.failedUrl = failedUrl;
    tab.title = formatFailedTabTitle(failedUrl);
    tab.favicon = '';
    tab.url = errorPageUrl;
    broadcastState(ctx);
    scheduleSessionSave(ctx);

    if (canLoadErrorPage) {
      wc.loadURL(errorPageUrl).catch(() => {});
    }
  });

  wc.on('did-navigate', (_e, url) => {
    adBlocker.clearCosmeticKeys(wc);
    handleUrlChange(url);
  });
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    if (isMainFrame) handleUrlChange(url);
  });
  wc.on('dom-ready', () => adBlocker.injectCosmeticFilters(wc));
  wc.on('audio-state-changed', (event) => {
    tab.audible = Boolean(event.audible);
    broadcastState(ctx);
  });

  ctx.win.contentView.addChildView(view);
  return view;
}

function syncTabsMapOrder(ctx) {
  if (!ctx || !ctx.tabs || !Array.isArray(ctx.tabOrder)) return;
  const orderedEntries = [];
  const seen = new Set();
  for (const id of ctx.tabOrder) {
    const t = ctx.tabs.get(id);
    if (t && !seen.has(id)) {
      orderedEntries.push([id, t]);
      seen.add(id);
    }
  }
  for (const [id, t] of ctx.tabs.entries()) {
    if (!seen.has(id)) {
      orderedEntries.push([id, t]);
      seen.add(id);
    }
  }
  ctx.tabs.clear();
  for (const [id, t] of orderedEntries) {
    ctx.tabs.set(id, t);
  }
}

function getTabSourceUrl(tab) {
  if (!tab) return 'nextgx://newtab';
  if (isErrorPageUrl(tab.url)) {
    return tab.failedUrl || getFailedUrlFromErrorPage(tab.url) || 'nextgx://newtab';
  }
  if (isNewTabUrl(tab.url) || isWebUiUrl(tab.url)) {
    return formatDisplayUrl(tab.url);
  }
  const liveUrl =
    tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()
      ? tab.view.webContents.getURL()
      : '';
  if (liveUrl && !liveUrl.startsWith('chrome-error://') && !isErrorPageUrl(liveUrl)) {
    if (isNewTabUrl(liveUrl) || isWebUiUrl(liveUrl)) {
      return formatDisplayUrl(liveUrl);
    }
    return liveUrl;
  }
  return tab.url || 'nextgx://newtab';
}

function recordClosedTabIfEligible(ctx, tab) {
  if (!ctx || !tab) return;
  const displayUrl = formatDisplayUrl(tab.url);
  if (
    !ctx.incognito &&
    !tab.incognito &&
    tab.url &&
    !isNewTabUrl(tab.url) &&
    !isWebUiUrl(tab.url) &&
    !isErrorPageUrl(tab.url) &&
    !displayUrl.startsWith('nextgx://') &&
    !displayUrl.startsWith('gx://') &&
    !displayUrl.startsWith('chrome://') &&
    !tab.url.startsWith('file://') &&
    !tab.url.startsWith('about:')
  ) {
    storage.addClosedTab({
      title: tab.title && tab.title !== 'Loading...' ? tab.title : tab.url,
      url: tab.url,
      favicon: tab.favicon || ''
    });
    broadcastHistoryUpdate();
  }
}

const RESTORABLE_INTERNAL_PAGES = new Set([
  'newtab',
  'history',
  'downloads',
  'bookmarks',
  'passwords',
  'extensions',
  'settings'
]);

function normalizeInternalPageUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  const m = trimmed.match(/^(?:nextgx|gx|chrome):\/\/([a-z0-9-]+)\/?$/i);
  if (!m) return '';
  let page = m[1].toLowerCase();
  if (page === 'password-manager') page = 'passwords';
  if (RESTORABLE_INTERNAL_PAGES.has(page)) {
    return `nextgx://${page}`;
  }
  return '';
}

function getPersistableTabUrl(tab) {
  if (!tab || tab.incognito) return '';
  const rawUrl = typeof tab.url === 'string' ? tab.url.trim() : '';
  if (!rawUrl || rawUrl === 'about:blank') return 'nextgx://newtab';

  if (isNewTabUrl(rawUrl)) return 'nextgx://newtab';

  if (isWebUiUrl(rawUrl)) {
    return normalizeInternalPageUrl(formatDisplayUrl(rawUrl)) || 'nextgx://newtab';
  }

  if (isErrorPageUrl(rawUrl)) {
    const failed = (tab.failedUrl || getFailedUrlFromErrorPage(rawUrl) || '').trim();
    if (failed && /^https?:\/\//i.test(failed)) {
      try {
        const u = new URL(failed);
        if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname) {
          return u.toString();
        }
      } catch (_) {}
    }
    return 'nextgx://newtab';
  }

  const internal = normalizeInternalPageUrl(rawUrl);
  if (internal) return internal;

  if (rawUrl.startsWith('chrome-error://') || resolveInternalUiFile(rawUrl)) {
    return 'nextgx://newtab';
  }

  try {
    const u = new URL(rawUrl);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return u.hostname ? rawUrl : 'nextgx://newtab';
    }
    if (u.protocol === 'file:') {
      return rawUrl;
    }
  } catch (_) {}

  return 'nextgx://newtab';
}

function getPersistableTabTitle(tab, persistUrl) {
  if (persistUrl === 'nextgx://newtab') return 'Start Page';
  const rawTitle = typeof tab?.title === 'string' ? tab.title.trim() : '';
  if (rawTitle && rawTitle !== 'Loading...') {
    return rawTitle.slice(0, 300);
  }
  return persistUrl;
}

function sanitizeRestorableTabUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';

  const internal = normalizeInternalPageUrl(trimmed);
  if (internal) return internal;

  if (trimmed.startsWith('chrome-error://')) return '';

  if (resolveInternalUiFile(trimmed)) {
    if (isNewTabUrl(trimmed)) return 'nextgx://newtab';
    if (isWebUiUrl(trimmed)) {
      return normalizeInternalPageUrl(formatDisplayUrl(trimmed)) || 'nextgx://newtab';
    }
    if (isErrorPageUrl(trimmed)) {
      const failed = getFailedUrlFromErrorPage(trimmed);
      if (failed && /^https?:\/\//i.test(failed)) {
        try {
          const u = new URL(failed);
          if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname) {
            return u.toString();
          }
        } catch (_) {}
      }
      return 'nextgx://newtab';
    }
    return 'nextgx://newtab';
  }

  try {
    const u = new URL(trimmed);
    if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname) {
      return trimmed;
    }
    if (u.protocol === 'file:') {
      return trimmed;
    }
  } catch (_) {}

  return '';
}

function serializeWindowForSession(ctx) {
  if (!ctx || ctx.incognito) return null;
  if (!ctx.sessionReady && ctx.pendingRestoreTabs) {
    return ctx.pendingRestoreTabs;
  }
  if (!ctx.sessionReady) return null;

  const tabs = [];
  let activeTabIndex = 0;

  for (const id of ctx.tabOrder) {
    const tab = ctx.tabs.get(id);
    if (!tab || tab.incognito) continue;
    const url = getPersistableTabUrl(tab);
    if (!url) continue;
    if (id === ctx.activeTabId) {
      activeTabIndex = tabs.length;
    }
    tabs.push({
      url,
      title: getPersistableTabTitle(tab, url),
      pinned: Boolean(tab.pinned)
    });
  }

  if (tabs.length === 0) return null;
  return {
    activeTabIndex: Math.max(0, Math.min(tabs.length - 1, activeTabIndex)),
    tabs
  };
}

function collectNormalWindowSessions({ excludeWinId = null } = {}) {
  const windows = [];
  for (const [id, ctx] of windowContexts.entries()) {
    if (excludeWinId !== null && id === excludeWinId) continue;
    if (!ctx || ctx.incognito) continue;
    if (!ctx.win || ctx.win.isDestroyed()) continue;
    const winData = serializeWindowForSession(ctx);
    if (winData && Array.isArray(winData.tabs) && winData.tabs.length > 0) {
      windows.push(winData);
    }
  }
  return windows;
}

function cancelScheduledSessionSave() {
  if (sessionSaveTimer) {
    clearTimeout(sessionSaveTimer);
    sessionSaveTimer = null;
  }
}

function saveSessionNow({ excludeWinId = null, allowEmpty = false } = {}) {
  if (!storage) return;
  cancelScheduledSessionSave();
  const windows = collectNormalWindowSessions({ excludeWinId });
  if (windows.length === 0 && !allowEmpty) {
    return;
  }
  storage.saveSession({ windows });
}

function scheduleSessionSave(ctx) {
  if (!storage || isAppQuitting) return;
  if (ctx && (ctx.incognito || !ctx.sessionReady || ctx.restoringSession)) return;
  cancelScheduledSessionSave();
  sessionSaveTimer = setTimeout(() => {
    sessionSaveTimer = null;
    if (!isAppQuitting) {
      saveSessionNow();
    }
  }, 300);
}

function getConfiguredHomepageUrl() {
  const raw = storage?.getSettings?.().homepageUrl;
  const check = storage?.validateHomepageUrl ? storage.validateHomepageUrl(raw) : { ok: false, url: '' };
  return check.ok && check.url ? check.url : 'nextgx://newtab';
}

function createTabInternal(
  ctx,
  { url = 'nextgx://newtab', pinned = false, active = true, insertIndex, title, deferActivate = false } = {}
) {
  const id = 'tab-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const resolvedUrl = appendInternalUrlParams(resolveNavigateInput(url), ctx);
  const initialTitle = isNewTabUrl(resolvedUrl)
    ? ctx.incognito
      ? 'Private Start'
      : 'Start Page'
    : typeof title === 'string' && title.trim()
    ? title.trim().slice(0, 300)
    : 'Loading...';

  const tab = {
    id,
    title: initialTitle,
    url: resolvedUrl,
    failedUrl: '',
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

  const lastPinnedIdx = ctx.tabOrder.findLastIndex((tid) => ctx.tabs.get(tid)?.pinned);
  if (tab.pinned) {
    const targetIdx =
      typeof insertIndex === 'number' && Number.isFinite(insertIndex)
        ? Math.max(0, Math.min(lastPinnedIdx + 1, Math.round(insertIndex)))
        : lastPinnedIdx + 1;
    ctx.tabOrder.splice(targetIdx, 0, id);
  } else if (typeof insertIndex === 'number' && Number.isFinite(insertIndex)) {
    const minUnpinnedIdx = lastPinnedIdx + 1;
    const targetIdx = Math.max(minUnpinnedIdx, Math.min(ctx.tabOrder.length, Math.round(insertIndex)));
    ctx.tabOrder.splice(targetIdx, 0, id);
  } else {
    ctx.tabOrder.push(id);
  }
  syncTabsMapOrder(ctx);

  tab.view.webContents.loadURL(resolvedUrl).catch(() => {});

  if (deferActivate) {
    tab.view.setBounds({ x: -5000, y: -5000, width: 1, height: 1 });
  } else if (active || !ctx.activeTabId) {
    switchTab(ctx, id);
  } else {
    updateActiveViewBounds(ctx);
    broadcastState(ctx);
    scheduleSessionSave(ctx);
  }

  return tab;
}

function createTab(ctx, { url = 'nextgx://newtab', pinned = false, active = true, insertIndex } = {}) {
  createTabInternal(ctx, { url, pinned, active, insertIndex });
  return serializeTabs(ctx);
}

function wakeTab(ctx, tab) {
  if (!tab || !tab.sleeping) return;
  tab.sleeping = false;
  tab.lastActiveAt = Date.now();
  tab.view = buildWebContentsViewForTab(ctx, tab);
  const targetUrl = appendInternalUrlParams(tab.url || NEW_TAB_FILE_URL, ctx);
  tab.url = targetUrl;
  tab.view.webContents.loadURL(targetUrl).catch(() => {});
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
  notifyActiveWebUiTabShown(ctx);
  broadcastState(ctx);
  scheduleSessionSave(ctx);
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

  const wasActive = ctx.activeTabId === tabId;
  const wasFocused = Boolean(
    tab.view &&
      tab.view.webContents &&
      !tab.view.webContents.isDestroyed() &&
      tab.view.webContents.isFocused()
  );

  recordClosedTabIfEligible(ctx, tab);

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
    const nextState = createTab(ctx, { url: 'nextgx://newtab', active: true });
    if (wasActive || wasFocused) {
      restoreFocusToActiveTab(ctx);
    }
    return nextState;
  }

  if (wasActive) {
    const nextIdx = Math.min(idx, ctx.tabOrder.length - 1);
    ctx.activeTabId = ctx.tabOrder[nextIdx];
    const nextTab = ctx.tabs.get(ctx.activeTabId);
    if (nextTab && nextTab.sleeping) wakeTab(ctx, nextTab);
  }

  updateActiveViewBounds(ctx);
  if (wasActive || wasFocused) {
    restoreFocusToActiveTab(ctx);
  }
  if (wasActive) {
    notifyActiveWebUiTabShown(ctx);
  }
  broadcastState(ctx);
  scheduleSessionSave(ctx);
  return serializeTabs(ctx);
}

function closeOtherTabs(ctx, keepTabId) {
  const keepTab = ctx.tabs.get(keepTabId);
  if (!keepTab) return serializeTabs(ctx);

  const activeChanged = ctx.activeTabId !== keepTabId;
  const toClose = ctx.tabOrder.filter((id) => id !== keepTabId);
  for (const id of toClose) {
    const tab = ctx.tabs.get(id);
    if (!tab) continue;
    recordClosedTabIfEligible(ctx, tab);
    if (tab.view) {
      try {
        ctx.win.contentView.removeChildView(tab.view);
        tab.view.webContents.close();
      } catch (_) {}
      tab.view = null;
    }
    ctx.tabs.delete(id);
  }

  ctx.tabOrder = [keepTabId];
  syncTabsMapOrder(ctx);

  if (activeChanged) {
    ctx.activeTabId = keepTabId;
    keepTab.lastActiveAt = Date.now();
  }
  if (keepTab.sleeping) {
    wakeTab(ctx, keepTab);
  }

  updateActiveViewBounds(ctx);
  if (activeChanged) {
    restoreFocusToActiveTab(ctx);
    notifyActiveWebUiTabShown(ctx);
  }
  broadcastState(ctx);
  scheduleSessionSave(ctx);
  return serializeTabs(ctx);
}

function duplicateTab(ctx, tabId) {
  const orig = ctx.tabs.get(tabId);
  if (!orig) return serializeTabs(ctx);
  const origIdx = ctx.tabOrder.indexOf(tabId);
  const dupUrl = getTabSourceUrl(orig);
  return createTab(ctx, {
    url: dupUrl,
    pinned: false,
    active: true,
    insertIndex: origIdx >= 0 ? origIdx + 1 : undefined
  });
}

function reorderTab(ctx, opts = {}) {
  if (!ctx || !opts) return serializeTabs(ctx);
  const tabId = opts.tabId || opts.fromId;
  const targetTabId = opts.targetTabId || opts.toId || null;
  const position = opts.position === 'after' ? 'after' : 'before';
  const toIndex = opts.toIndex;

  const tab = tabId ? ctx.tabs.get(tabId) : null;
  if (!tab) return serializeTabs(ctx);

  const pinnedIds = ctx.tabOrder.filter((id) => ctx.tabs.get(id)?.pinned);
  const normalIds = ctx.tabOrder.filter((id) => !ctx.tabs.get(id)?.pinned);
  const group = tab.pinned ? pinnedIds : normalIds;

  const fromGroupIdx = group.indexOf(tabId);
  if (fromGroupIdx === -1) return serializeTabs(ctx);

  if (targetTabId && targetTabId !== tabId && ctx.tabs.has(targetTabId)) {
    const targetTab = ctx.tabs.get(targetTabId);
    group.splice(fromGroupIdx, 1);
    if (Boolean(targetTab.pinned) === Boolean(tab.pinned)) {
      const targetGroupIdx = group.indexOf(targetTabId);
      if (targetGroupIdx !== -1) {
        const insertIdx = position === 'after' ? targetGroupIdx + 1 : targetGroupIdx;
        group.splice(insertIdx, 0, tabId);
      } else {
        group.push(tabId);
      }
    } else if (tab.pinned) {
      // Pinned tab dropped onto unpinned area stays pinned at end of pinned section
      group.push(tabId);
    } else {
      // Unpinned tab dropped onto pinned area stays unpinned right after pinned section
      group.unshift(tabId);
    }
  } else if (typeof toIndex === 'number' && Number.isFinite(toIndex)) {
    group.splice(fromGroupIdx, 1);
    const groupTarget = tab.pinned
      ? Math.max(0, Math.min(group.length, Math.round(toIndex)))
      : Math.max(0, Math.min(group.length, Math.round(toIndex) - pinnedIds.length));
    group.splice(groupTarget, 0, tabId);
  } else {
    return serializeTabs(ctx);
  }

  ctx.tabOrder = [...pinnedIds, ...normalIds];
  syncTabsMapOrder(ctx);
  broadcastState(ctx);
  scheduleSessionSave(ctx);
  return serializeTabs(ctx);
}

function reopenLastClosedTab(ctx) {
  if (!ctx || !storage) return null;
  const closed = storage.getClosedTabs();
  const latest = Array.isArray(closed) ? closed.find((t) => t && t.url) : null;
  if (!latest) return null;
  if (latest.id) {
    storage.removeClosedTab(latest.id);
    broadcastHistoryUpdate();
  }
  return createTab(ctx, { url: latest.url, active: true });
}

function togglePinTab(ctx, tabId) {
  const tab = ctx.tabs.get(tabId);
  if (!tab) return serializeTabs(ctx);
  tab.pinned = !tab.pinned;
  const pinnedIds = ctx.tabOrder.filter((id) => ctx.tabs.get(id)?.pinned);
  const normalIds = ctx.tabOrder.filter((id) => !ctx.tabs.get(id)?.pinned);
  ctx.tabOrder = [...pinnedIds, ...normalIds];
  syncTabsMapOrder(ctx);
  broadcastState(ctx);
  scheduleSessionSave(ctx);
  return serializeTabs(ctx);
}

function findTabByWebContents(ctx, wc) {
  if (!ctx || !wc) return null;
  for (const tab of ctx.tabs.values()) {
    if (tab && tab.view && tab.view.webContents && tab.view.webContents.id === wc.id) {
      return tab;
    }
  }
  return ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
}

function navigateActiveTab(ctx, input) {
  const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
  if (!tab) return;
  if (tab.sleeping) wakeTab(ctx, tab);
  const resolvedUrl = appendInternalUrlParams(resolveNavigateInput(input), ctx);
  tab.failedUrl = '';
  tab.url = resolvedUrl;
  tab.view.webContents.loadURL(resolvedUrl).catch(() => {});
  broadcastState(ctx);
  scheduleSessionSave(ctx);
}

function reloadTab(ctx, tabId) {
  const tab = tabId ? ctx.tabs.get(tabId) : null;
  if (!tab) return;
  if (tab.sleeping) {
    wakeTab(ctx, tab);
    updateActiveViewBounds(ctx);
    broadcastState(ctx);
    return;
  }
  if (!tab.view || tab.view.webContents.isDestroyed()) return;
  const wc = tab.view.webContents;
  const currentUrl = wc.getURL();
  if (isErrorPageUrl(tab.url) || isErrorPageUrl(currentUrl)) {
    const retryUrl =
      getFailedUrlFromErrorPage(currentUrl) ||
      tab.failedUrl ||
      getFailedUrlFromErrorPage(tab.url);
    if (retryUrl && !isErrorPageUrl(retryUrl) && !resolveInternalUiFile(retryUrl)) {
      tab.url = retryUrl;
      tab.isLoading = true;
      broadcastState(ctx);
      scheduleSessionSave(ctx);
      wc.loadURL(retryUrl).catch(() => {});
      return;
    }
  }
  wc.reload();
}

function reloadActiveTab(ctx) {
  reloadTab(ctx, ctx.activeTabId);
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
    const rawName = path.basename(item.getFilename() || 'download');
    const fileName = !rawName || rawName === '.' || rawName === '..' ? 'download' : rawName;
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
    broadcastDownloadsUpdate(storage.getDownloads());

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
      broadcastDownloadsUpdate(storage.getDownloads());
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
      broadcastDownloadsUpdate(storage.getDownloads());
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

  broadcastDownloadsUpdate(storage.getDownloads());
  ctx.win?.webContents.send('ui:toast', `Screenshot saved & copied: ${filename}`);
  return { ok: true, savePath, filename };
}

function createBrowserWindow({ incognito = false, restoreTabs = null } = {}) {
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
      sandbox: true
    }
  });

  const initialTop =
    storage && storage.getSettings().showBookmarksBar === false
      ? TOP_CHROME_HEIGHT
      : TOP_CHROME_HEIGHT + BOOKMARKS_BAR_HEIGHT;

  const ctx = {
    win,
    incognito: Boolean(incognito),
    session: winSession,
    tabs: new Map(),
    tabOrder: [],
    activeTabId: null,
    sessionReady: false,
    restoringSession: false,
    pendingRestoreTabs: !incognito && restoreTabs ? restoreTabs : null,
    layoutState: {
      left: SIDEBAR_ICON_WIDTH,
      top: initialTop,
      right: 0,
      bottom: 0
    },
    popoverView: null,
    popoverOpenKind: null,
    popoverPayload: null,
    screenshotView: null,
    pendingScreenshotDataUrl: ''
  };

  windowContexts.set(win.id, ctx);
  webContentsToWinId.set(win.webContents.id, win.id);

  attachKeyboardShortcuts(ctx, win.webContents);

  win.loadFile(path.join(__dirname, 'ui', 'index.html'), {
    query: getInternalUiQuery(incognito)
  });

  win.on('resize', () => {
    if (ctx.popoverOpenKind === 'tab-context' || ctx.popoverOpenKind === 'bookmark-folder') closePopover(ctx);
    updateActiveViewBounds(ctx);
  });
  win.on('blur', () => {
    if (ctx.popoverOpenKind === 'tab-context' || ctx.popoverOpenKind === 'bookmark-folder') closePopover(ctx);
  });
  win.on('maximize', () => updateActiveViewBounds(ctx));
  win.on('unmaximize', () => updateActiveViewBounds(ctx));
  win.on('close', () => {
    if (isAppQuitting || ctx.incognito || !storage) return;
    const otherNormal = collectNormalWindowSessions({ excludeWinId: win.id });
    if (otherNormal.length === 0) {
      if (ctx.sessionReady) {
        const current = serializeWindowForSession(ctx);
        cancelScheduledSessionSave();
        if (current && current.tabs.length > 0) {
          storage.saveSession({ windows: [current] });
        } else {
          storage.saveSession({ windows: [] });
        }
      } else if (ctx.pendingRestoreTabs) {
        cancelScheduledSessionSave();
        storage.saveSession({ windows: [ctx.pendingRestoreTabs] });
      }
    } else {
      cancelScheduledSessionSave();
      storage.saveSession({ windows: otherNormal });
    }
  });
  win.on('closed', () => {
    windowContexts.delete(win.id);
  });

  win.webContents.once('did-finish-load', () => {
    if (win.isDestroyed()) return;
    const restoreSpec =
      !ctx.incognito &&
      ctx.pendingRestoreTabs &&
      Array.isArray(ctx.pendingRestoreTabs.tabs) &&
      ctx.pendingRestoreTabs.tabs.length > 0
        ? ctx.pendingRestoreTabs
        : null;

    if (restoreSpec) {
      ctx.restoringSession = true;
      const tabsToRestore = restoreSpec.tabs;
      const rawActiveIdx = Number.isInteger(restoreSpec.activeTabIndex) ? restoreSpec.activeTabIndex : 0;
      const targetActiveIdx = Math.max(0, Math.min(tabsToRestore.length - 1, rawActiveIdx));
      let activeTabIdToSelect = null;

      try {
        for (let i = 0; i < tabsToRestore.length; i++) {
          const item = tabsToRestore[i];
          const safeUrl = sanitizeRestorableTabUrl(item?.url);
          if (!safeUrl) continue;
          const created = createTabInternal(ctx, {
            url: safeUrl,
            title: typeof item.title === 'string' ? item.title : undefined,
            pinned: Boolean(item.pinned),
            active: false,
            deferActivate: true
          });
          if (i === targetActiveIdx && created) {
            activeTabIdToSelect = created.id;
          }
        }
      } catch (err) {
        console.error('[Session] Error restoring tabs:', err);
      }

      if (ctx.tabOrder.length === 0) {
        createTabInternal(ctx, { url: 'nextgx://newtab', active: true });
      } else {
        const finalActiveId =
          activeTabIdToSelect && ctx.tabs.has(activeTabIdToSelect)
            ? activeTabIdToSelect
            : ctx.tabOrder[0];
        switchTab(ctx, finalActiveId);
      }

      ctx.pendingRestoreTabs = null;
      ctx.restoringSession = false;
      ctx.sessionReady = true;
      scheduleSessionSave(ctx);
    } else {
      createTabInternal(ctx, { url: 'nextgx://newtab', active: true });
      ctx.pendingRestoreTabs = null;
      ctx.restoringSession = false;
      ctx.sessionReady = true;
      if (!ctx.incognito) {
        scheduleSessionSave(ctx);
      }
    }

    win.webContents.send('adblock:update', adBlocker.getStats());
    win.webContents.send('system:stats-update', collectSystemStats());
  });

  return ctx;
}

function registerIpcHandlers() {
  const handleInternal = (channel, handler) => {
    ipcMain.handle(channel, (e, ...args) => {
      if (!isInternalUiSender(e)) {
        throw new Error(`Forbidden IPC channel: ${channel}`);
      }
      return handler(e, ...args);
    });
  };

  ipcMain.on('internal:get-page-kind', (event) => {
    if (!event || !event.senderFrame || !event.sender || event.senderFrame !== event.sender.mainFrame) {
      event.returnValue = null;
      return;
    }
    const uiFile = resolveInternalUiFile(event.senderFrame.url);
    if (!uiFile) {
      event.returnValue = null;
      return;
    }
    const normalized = normalizePathForCompare(uiFile);
    if (normalized === normalizePathForCompare(NEW_TAB_FILE)) {
      event.returnValue = 'newtab';
    } else if (normalized === normalizePathForCompare(WEBUI_FILE)) {
      event.returnValue = 'webui';
    } else if (normalized === normalizePathForCompare(ERROR_PAGE_FILE)) {
      event.returnValue = 'error';
    } else {
      event.returnValue = null;
    }
  });

  ipcMain.handle('autofill:get', (e) => {
    const frameUrl = e?.senderFrame?.url;
    if (!frameUrl) return [];
    try {
      const u = new URL(frameUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return [];
      const pageHost = u.hostname;
      if (!pageHost) return [];
      return (storage.getPasswords() || []).filter((p) => p && p.site && isAutofillHostMatch(pageHost, p.site));
    } catch (_) {
      return [];
    }
  });

  ipcMain.handle('autofill:save', (e, { username, password } = {}) => {
    const frameUrl = e?.senderFrame?.url;
    if (!frameUrl || typeof username !== 'string' || typeof password !== 'string') return false;
    const cleanUser = username.trim();
    if (!cleanUser || !password) return false;
    try {
      const u = new URL(frameUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      const site = normalizeAutofillHost(u.hostname);
      if (!site) return false;
      storage.addPassword({ site, username: cleanUser, password });
      return true;
    } catch (_) {
      return false;
    }
  });

  handleInternal('tabs:create', (e, opts) => {
    const ctx = getCtxFromSender(e.sender);
    if (opts?.incognito) {
      createBrowserWindow({ incognito: true });
      return serializeTabs(ctx);
    }
    return createTab(ctx, opts || {});
  });
  handleInternal('tabs:switch', (e, tabId) => switchTab(getCtxFromSender(e.sender), tabId));
  handleInternal('tabs:close', (e, tabId) => closeTab(getCtxFromSender(e.sender), tabId));
  handleInternal('tabs:close-others', (e, tabId) => closeOtherTabs(getCtxFromSender(e.sender), tabId));
  handleInternal('tabs:duplicate', (e, tabId) => duplicateTab(getCtxFromSender(e.sender), tabId));
  handleInternal('tabs:reorder', (e, arg1, arg2) => {
    const ctx = getCtxFromSender(e.sender);
    const opts = typeof arg1 === 'object' && arg1 !== null ? arg1 : { tabId: arg1, toIndex: arg2 };
    return reorderTab(ctx, opts);
  });
  handleInternal('tabs:pin', (e, tabId) => togglePinTab(getCtxFromSender(e.sender), tabId));
  handleInternal('tabs:sleep', (e, tabId) => sleepTab(getCtxFromSender(e.sender), tabId));
  handleInternal('tabs:sleep-background', (e) => sleepBackgroundTabs(getCtxFromSender(e.sender)));
  handleInternal('tabs:get-state', (e) => serializeTabs(getCtxFromSender(e.sender)));
  handleInternal('tabs:navigate', (e, input) => {
    const ctx = getCtxFromSender(e.sender);
    navigateActiveTab(ctx, input);
    return serializeTabs(ctx);
  });
  handleInternal('tabs:back', (e) => {
    const ctx = getCtxFromSender(e.sender);
    const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    if (tab?.view?.webContents.canGoBack()) tab.view.webContents.goBack();
    return serializeTabs(ctx);
  });
  handleInternal('tabs:forward', (e) => {
    const ctx = getCtxFromSender(e.sender);
    const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    if (tab?.view?.webContents.canGoForward()) tab.view.webContents.goForward();
    return serializeTabs(ctx);
  });
  handleInternal('tabs:reload', (e, tabId) => {
    const ctx = getCtxFromSender(e.sender);
    if (tabId) reloadTab(ctx, tabId);
    else reloadActiveTab(ctx);
    return serializeTabs(ctx);
  });
  handleInternal('tabs:retry-failed', (e, requestedUrl) => {
    const ctx = getCtxFromSender(e.sender);
    const tab = findTabByWebContents(ctx, e.sender);
    if (!tab || !tab.view || tab.view.webContents.isDestroyed()) return serializeTabs(ctx);
    const currentUrl = tab.view.webContents.getURL();
    const candidate =
      getFailedUrlFromErrorPage(currentUrl) ||
      tab.failedUrl ||
      getFailedUrlFromErrorPage(tab.url) ||
      (typeof requestedUrl === 'string' ? requestedUrl.trim() : '');
    if (!candidate || isErrorPageUrl(candidate) || resolveInternalUiFile(candidate)) {
      return serializeTabs(ctx);
    }
    tab.url = candidate;
    tab.isLoading = true;
    broadcastState(ctx);
    scheduleSessionSave(ctx);
    tab.view.webContents.loadURL(candidate).catch(() => {});
    return serializeTabs(ctx);
  });
  handleInternal('tabs:stop', (e) => {
    const ctx = getCtxFromSender(e.sender);
    const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    if (tab?.view) tab.view.webContents.stop();
    return serializeTabs(ctx);
  });
  handleInternal('tabs:home', (e) => {
    const ctx = getCtxFromSender(e.sender);
    navigateActiveTab(ctx, getConfiguredHomepageUrl());
    return serializeTabs(ctx);
  });
  handleInternal('tabs:devtools', (e) => toggleActiveTabDevTools(getCtxFromSender(e.sender)));

  handleInternal('tabs:zoom', (e, action) => {
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

  handleInternal('tabs:print', (e) => {
    const ctx = getCtxFromSender(e.sender);
    const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    if (tab?.view) tab.view.webContents.print();
  });

  handleInternal('tabs:screenshot', async (e) => {
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

  handleInternal('tabs:screenshot-area-start', async (e) => {
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
          sandbox: true
        }
      });
      webContentsToWinId.set(ctx.screenshotView.webContents.id, ctx.win.id);
      ctx.screenshotView.webContents.loadFile(SCREENSHOT_FILE, {
        query: getInternalUiQuery(ctx.incognito)
      });
      ctx.win.contentView.addChildView(ctx.screenshotView);
    }

    updateActiveViewBounds(ctx);
    ctx.screenshotView.webContents.send('screenshot:captured', { dataUrl: ctx.pendingScreenshotDataUrl });
    setTimeout(() => {
      ctx.screenshotView?.webContents.send('screenshot:captured', { dataUrl: ctx.pendingScreenshotDataUrl });
    }, 180);
    return { ok: true };
  });

  handleInternal('tabs:screenshot-area-finish', async (e, rect) => {
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

  handleInternal('tabs:screenshot-area-cancel', (e) => {
    const ctx = getCtxFromSender(e.sender);
    ctx.pendingScreenshotDataUrl = '';
    updateActiveViewBounds(ctx);
    return { ok: true };
  });

  handleInternal('tabs:reader-mode', async (e) => {
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

  handleInternal('tabs:find', (e, { text, forward = true } = {}) => {
    const ctx = getCtxFromSender(e.sender);
    const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    if (!tab || !tab.view || !text) return;
    tab.view.webContents.findInPage(text, { forward, findNext: true });
  });

  handleInternal('tabs:stop-find', (e) => {
    const ctx = getCtxFromSender(e.sender);
    const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    if (tab?.view) tab.view.webContents.stopFindInPage('clearSelection');
  });

  handleInternal('window:new', () => createBrowserWindow({ incognito: false }));
  handleInternal('window:fullscreen', (e) => {
    const ctx = getCtxFromSender(e.sender);
    if (!ctx?.win) return false;
    const next = !ctx.win.isFullScreen();
    ctx.win.setFullScreen(next);
    return next;
  });

  handleInternal('cleaner:run', async (_e, { cache = true, cookies = false, history = false } = {}) => {
    if (cache) await session.defaultSession.clearCache();
    if (cookies) {
      await session.defaultSession.clearStorageData({ storages: ['cookies', 'localstorage'] });
      await session.defaultSession.cookies.flushStore().catch(() => {});
      broadcastCookiesUpdate({ immediate: true });
    }
    if (history) {
      storage.clearHistory('all');
      broadcastHistoryUpdate();
    }
    return { cleanedAt: Date.now() };
  });

  handleInternal('popover:open', (e, opts) => openPopover(getCtxFromSender(e.sender), opts || {}));
  handleInternal('popover:resize', (e, opts) => resizePopover(getCtxFromSender(e.sender), opts || {}));
  handleInternal('popover:close', (e) => closePopover(getCtxFromSender(e.sender)));

  handleInternal('menu:action', (e, action) => {
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
        const result = storage.toggleBookmark({
          title: tab.title,
          url: formatDisplayUrl(tab.url),
          favicon: tab.favicon || ''
        });
        broadcastBookmarksUpdate(result.bookmarks);
        for (const c of windowContexts.values()) broadcastState(c);
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

  handleInternal('permissions:get', (_e, origin) => storage.getSitePermissions(origin));
  handleInternal('permissions:set', (_e, { origin, key, value }) => storage.setSitePermission(origin, key, value));

  handleInternal('layout:set-offsets', (e, partial) => {
    const ctx = getCtxFromSender(e.sender);
    ctx.layoutState = { ...ctx.layoutState, ...(partial || {}) };
    updateActiveViewBounds(ctx);
    return ctx.layoutState;
  });

  // Bookmarks, History, Downloads, Passwords, Notes, Extensions, Settings
  handleInternal('bookmarks:get', () => storage.getBookmarks());
  handleInternal('bookmarks:toggle', (e) => {
    const ctx = getCtxFromSender(e.sender);
    const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    if (!tab) return { added: false, bookmarks: storage.getBookmarks() };
    const result = storage.toggleBookmark({
      title: tab.title,
      url: formatDisplayUrl(tab.url),
      favicon: tab.favicon || ''
    });
    broadcastBookmarksUpdate(result.bookmarks);
    for (const c of windowContexts.values()) broadcastState(c);
    return result;
  });
  handleInternal('bookmarks:add', (_e, entry) => {
    const result = storage.addBookmark(entry || {});
    if (result.ok) {
      broadcastBookmarksUpdate(result.bookmarks);
      for (const ctx of windowContexts.values()) broadcastState(ctx);
    }
    return result;
  });
  handleInternal('bookmarks:update', (_e, entry) => {
    const payload = entry && typeof entry === 'object' ? entry : {};
    const result = storage.updateBookmark(payload.id, payload);
    if (result.ok) {
      broadcastBookmarksUpdate(result.bookmarks);
      for (const ctx of windowContexts.values()) broadcastState(ctx);
    }
    return result;
  });
  handleInternal('bookmarks:rename-folder', (_e, payload) => {
    const { oldName, newName } = payload && typeof payload === 'object' ? payload : {};
    const result = storage.renameBookmarkFolder(oldName, newName);
    if (result.ok) {
      broadcastBookmarksUpdate(result.bookmarks);
    }
    return result;
  });
  handleInternal('bookmarks:remove', (_e, id) => {
    const list = storage.removeBookmark(id);
    broadcastBookmarksUpdate(list);
    for (const ctx of windowContexts.values()) broadcastState(ctx);
    return list;
  });

  handleInternal('history:get', () => storage.getHistory());
  handleInternal('history:clear', (_e, range) => {
    const res = storage.clearHistory(range || 'all');
    broadcastHistoryUpdate();
    return res;
  });
  handleInternal('history:remove', (_e, id) => {
    const res = storage.removeHistoryItem(id);
    broadcastHistoryUpdate();
    return res;
  });
  handleInternal('history:closed-get', () => storage.getClosedTabs());
  handleInternal('history:closed-clear', () => {
    const res = storage.clearClosedTabs();
    broadcastHistoryUpdate();
    return res;
  });
  handleInternal('history:closed-remove', (_e, id) => {
    const res = storage.removeClosedTab(id);
    broadcastHistoryUpdate();
    return res;
  });

  // Cookies Management (defaultSession)
  // Note: Private-window cookies live in ephemeral partitions and vanish when the window closes.
  const normalizeCookieDomain = (d) =>
    String(d || '')
      .trim()
      .toLowerCase()
      .replace(/^\.+/, '');

  const buildCookieUrl = (cookie) => {
    const host = normalizeCookieDomain(cookie?.domain);
    if (!host) return '';
    const protocol = cookie.secure ? 'https://' : 'http://';
    const rawPath = typeof cookie.path === 'string' && cookie.path ? cookie.path : '/';
    const cookiePath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    return `${protocol}${host}${cookiePath}`;
  };

  const doesCookieMatchTarget = (cookie, target) => {
    const cDom = normalizeCookieDomain(cookie?.domain);
    if (!cDom) return false;
    const raw =
      typeof target === 'object' && target !== null
        ? target.origin || target.url || target.domain || ''
        : String(target || '');
    const trimmed = String(raw || '').trim();
    if (!trimmed) return true;

    if (/^https?:\/\//i.test(trimmed)) {
      try {
        const u = new URL(trimmed);
        const host = normalizeCookieDomain(u.hostname);
        if (!host) return false;
        return cDom === host || host.endsWith(`.${cDom}`);
      } catch (_) {
        return false;
      }
    }

    const targetDom = normalizeCookieDomain(trimmed);
    if (!targetDom) return false;
    return cDom === targetDom;
  };

  handleInternal('cookies:get', async (_e, filter) => {
    const all = await session.defaultSession.cookies.get({});
    const filtered = filter ? (all || []).filter((c) => doesCookieMatchTarget(c, filter)) : all || [];
    return filtered.map((c) => ({
      domain: c.domain || '',
      name: c.name || '',
      path: c.path || '/',
      expirationDate: c.expirationDate ?? null,
      session: Boolean(c.session),
      secure: Boolean(c.secure),
      httpOnly: Boolean(c.httpOnly)
    }));
  });

  handleInternal('cookies:remove', async (_e, arg1, arg2) => {
    let url = '';
    let name = '';
    if (arg1 && typeof arg1 === 'object') {
      url = typeof arg1.url === 'string' ? arg1.url.trim() : '';
      name = typeof arg1.name === 'string' ? arg1.name : '';
    } else {
      url = typeof arg1 === 'string' ? arg1.trim() : '';
      name = typeof arg2 === 'string' ? arg2 : '';
    }
    if (!url || !name || !/^https?:\/\//i.test(url)) return { ok: false };
    await session.defaultSession.cookies.remove(url, name);
    await session.defaultSession.cookies.flushStore().catch(() => {});
    broadcastCookiesUpdate({ immediate: true });
    return { ok: true };
  });

  handleInternal('cookies:clear-site', async (_e, originOrDomain) => {
    const raw =
      typeof originOrDomain === 'object' && originOrDomain !== null
        ? originOrDomain.origin || originOrDomain.url || originOrDomain.domain || ''
        : String(originOrDomain || '');
    if (!String(raw || '').trim()) return { ok: false, removed: 0 };

    const all = await session.defaultSession.cookies.get({});
    const matched = (all || []).filter((c) => doesCookieMatchTarget(c, originOrDomain));
    let removed = 0;
    for (const c of matched) {
      const url = buildCookieUrl(c);
      if (url && c.name) {
        await session.defaultSession.cookies.remove(url, c.name).catch(() => {});
        removed += 1;
      }
    }
    await session.defaultSession.cookies.flushStore().catch(() => {});
    broadcastCookiesUpdate({ immediate: true });
    return { ok: true, removed };
  });

  handleInternal('cookies:clear-all', async () => {
    const all = await session.defaultSession.cookies.get({});
    let removed = 0;
    for (const c of all || []) {
      const url = buildCookieUrl(c);
      if (url && c.name) {
        await session.defaultSession.cookies.remove(url, c.name).catch(() => {});
        removed += 1;
      }
    }
    await session.defaultSession.clearStorageData({ storages: ['cookies'] }).catch(() => {});
    await session.defaultSession.cookies.flushStore().catch(() => {});
    broadcastCookiesUpdate({ immediate: true });
    return { ok: true, removed };
  });

  handleInternal('downloads:get', () => storage.getDownloads());
  handleInternal('downloads:pause', (_e, id) => {
    const item = activeDownloadItems.get(id);
    if (item && !item.isPaused()) item.pause();
    return storage.getDownloads();
  });
  handleInternal('downloads:resume', (_e, id) => {
    const item = activeDownloadItems.get(id);
    if (item && item.isPaused()) item.resume();
    return storage.getDownloads();
  });
  handleInternal('downloads:cancel', (_e, id) => {
    const item = activeDownloadItems.get(id);
    if (item) {
      item.cancel();
      activeDownloadItems.delete(id);
    }
    return storage.getDownloads();
  });
  handleInternal('downloads:remove', (_e, id) => {
    const list = storage.removeDownload(id);
    broadcastDownloadsUpdate(list);
    return list;
  });
  handleInternal('downloads:clear', () => {
    const list = storage.clearDownloads();
    broadcastDownloadsUpdate(list);
    return list;
  });
  handleInternal('downloads:open', (_e, savePath) => {
    const safePath = resolveSafeDownloadPath(savePath);
    if (!safePath) return;
    return shell.openPath(safePath);
  });
  handleInternal('downloads:show-folder', (_e, savePath) => {
    const safePath = resolveSafeDownloadPath(savePath);
    if (!safePath) return;
    shell.showItemInFolder(safePath);
  });

  handleInternal('passwords:get', () => storage.getPasswords());
  handleInternal('passwords:add', (_e, entry) => storage.addPassword(entry));
  handleInternal('passwords:remove', (_e, id) => storage.removePassword(id));
  handleInternal('notes:get', () => storage.getNotes());
  handleInternal('notes:save', (_e, text) => storage.saveNote(text));

  handleInternal('extensions:list', () => listManagedExtensions());

  handleInternal('extensions:load-unpacked', async (e) => {
    const ctx = getCtxFromSender(e.sender);
    const parentWin = ctx?.win && !ctx.win.isDestroyed() ? ctx.win : undefined;
    const dialogOptions = {
      title: 'Select Unpacked Chrome Extension Folder (containing manifest.json)',
      properties: ['openDirectory']
    };
    let res;
    try {
      res = parentWin
        ? await dialog.showOpenDialog(parentWin, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);
    } catch (err) {
      console.error('[Extensions] Failed to open extension folder dialog:', err);
      return {
        ok: false,
        canceled: false,
        error: `Could not open folder picker: ${err?.message || String(err)}`,
        extensions: listManagedExtensions()
      };
    }
    if (!res || res.canceled || !Array.isArray(res.filePaths) || !res.filePaths.length) {
      return {
        ok: false,
        canceled: true,
        extensions: listManagedExtensions()
      };
    }
    const result = await loadUnpackedExtensionFromPath(res.filePaths[0], { persist: true });
    return {
      ...result,
      incognitoNotice: Boolean(ctx?.incognito)
    };
  });

  handleInternal('extensions:toggle', async (_e, arg1, arg2) => {
    const id = typeof arg1 === 'object' && arg1 !== null ? arg1.id : arg1;
    const enabled = typeof arg1 === 'object' && arg1 !== null ? arg1.enabled : arg2;
    return setExtensionEnabled(id, Boolean(enabled));
  });

  handleInternal('extensions:reload', async (_e, id) => reloadManagedExtension(id));

  handleInternal('extensions:remove', (_e, id) => removeManagedExtension(id));

  const buildAdblockSiteInfo = (origin) => {
    const site = storage.getAdblockSite(origin);
    return {
      origin: site.origin,
      enabled: site.enabled,
      hasOverride: site.hasOverride,
      allowlisted: Boolean(site.hasOverride && site.enabled === false),
      globalEnabled: adBlocker.isEnabled(),
      trackerBlockEnabled: adBlocker.isTrackersEnabled(),
      blockedCount: adBlocker.getSiteBlockedCount(site.origin)
    };
  };

  handleInternal('adblock:stats', () => adBlocker.getStats());
  handleInternal('adblock:toggle', async (_e, enabled) => {
    storage.updateSettings({ adblockEnabled: Boolean(enabled) });
    await syncAdblockCosmeticFilters();
    const stats = adBlocker.getStats();
    broadcastAdblockUpdate(stats);
    for (const ctx of windowContexts.values()) {
      broadcastState(ctx);
    }
    return stats;
  });
  handleInternal('adblock:toggle-trackers', (_e, enabled) => {
    storage.updateSettings({ trackerBlockEnabled: Boolean(enabled) });
    const stats = adBlocker.getStats();
    broadcastAdblockUpdate(stats);
    for (const ctx of windowContexts.values()) {
      broadcastState(ctx);
    }
    return stats;
  });
  handleInternal('adblock:get-site', (_e, origin) => buildAdblockSiteInfo(origin));
  handleInternal('adblock:set-site', async (_e, arg1, arg2) => {
    const origin =
      typeof arg1 === 'object' && arg1 !== null ? arg1.origin : arg1;
    const enabled =
      typeof arg1 === 'object' && arg1 !== null ? arg1.enabled : arg2;
    const updated = storage.setAdblockSite(origin, Boolean(enabled));
    if (updated.origin) {
      await syncAdblockCosmeticFilters(updated.origin);
    }
    const stats = adBlocker.getStats();
    broadcastAdblockUpdate(stats);
    for (const ctx of windowContexts.values()) {
      broadcastState(ctx);
    }
    return buildAdblockSiteInfo(updated.origin);
  });
  handleInternal('adblock:get-sites', () => storage.getAdblockSites());
  handleInternal('settings:get', () => storage.getSettings());
  handleInternal('settings:update', async (_e, partial) => {
    const prev = storage.getSettings();
    const s = storage.updateSettings(partial || {});
    const adblockChanged = Boolean(prev.adblockEnabled) !== Boolean(s.adblockEnabled);
    const trackerChanged = Boolean(prev.trackerBlockEnabled) !== Boolean(s.trackerBlockEnabled);
    if (adblockChanged) {
      await syncAdblockCosmeticFilters();
    }
    if (adblockChanged || trackerChanged) {
      broadcastAdblockUpdate(adBlocker.getStats());
    }
    broadcastSettingsUpdate(s);
    for (const ctx of windowContexts.values()) {
      broadcastState(ctx);
    }
    return s;
  });

  handleInternal('newtab:get-data', () => ({
    speedDial: storage.getSpeedDial(),
    settings: storage.getSettings(),
    adblock: adBlocker.getStats(),
    system: collectSystemStats(),
    notes: storage.getNotes()
  }));
  handleInternal('newtab:add-dial', (_e, item) => storage.addSpeedDial(item));
  handleInternal('newtab:remove-dial', (_e, id) => storage.removeSpeedDial(id));
  handleInternal('system:stats', () => collectSystemStats());

  handleInternal('window:minimize', (e) => getCtxFromSender(e.sender)?.win?.minimize());
  handleInternal('window:maximize', (e) => {
    const win = getCtxFromSender(e.sender)?.win;
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  handleInternal('window:close', (e) => getCtxFromSender(e.sender)?.win?.close());
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

function getSessionExtensionsApi(ses = session.defaultSession) {
  return ses.extensions || ses;
}

function parseExtensionWarningLines(message) {
  if (!message || typeof message !== 'string') return [];
  return message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^Warnings loading extension at /i.test(line));
}

async function captureExtensionLoadWarnings(extPath, asyncFn) {
  const captured = [];
  const normTarget = normalizePathForCompare(path.resolve(extPath));
  const onWarning = (warning) => {
    if (!warning || warning.name !== 'ExtensionLoadWarning') return;
    const msg = String(warning.message || '');
    const normMsg = normalizePathForCompare(msg);
    if (!normTarget || normMsg.includes(normTarget) || !msg.includes('Warnings loading extension at')) {
      for (const line of parseExtensionWarningLines(msg)) {
        if (!captured.includes(line)) captured.push(line);
      }
    }
  };

  process.on('warning', onWarning);
  try {
    const value = await asyncFn();
    // Node queues process.emitWarning listeners on nextTick; yield once so warnings are captured.
    await new Promise((resolve) => setImmediate(resolve));
    return { value, warnings: captured };
  } finally {
    process.removeListener('warning', onWarning);
  }
}

function validateUnpackedExtensionPath(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    return { ok: false, error: 'No extension folder path was selected.' };
  }
  const resolved = path.resolve(rawPath.trim());

  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch (err) {
    return {
      ok: false,
      error: `Extension folder is not accessible: "${resolved}" (${err.code || err.message}).`
    };
  }
  if (!stat.isDirectory()) {
    return {
      ok: false,
      error: `Selected path is not a folder: "${resolved}". Select an unpacked extension directory containing manifest.json (packed .crx/.zip archives must be extracted first).`
    };
  }

  const manifestPath = path.join(resolved, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    let nestedCandidates = [];
    try {
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      nestedCandidates = entries
        .filter((d) => d.isDirectory() && fs.existsSync(path.join(resolved, d.name, 'manifest.json')))
        .map((d) => d.name);
    } catch (_) {}

    if (nestedCandidates.length === 1) {
      return {
        ok: false,
        error: `No manifest.json found directly in "${resolved}". Found manifest.json inside subfolder "${nestedCandidates[0]}" — select that subfolder instead.`
      };
    }
    return {
      ok: false,
      error: `Manifest file (manifest.json) is missing or unreadable in "${resolved}". Select the unpacked extension folder that directly contains manifest.json.`
    };
  }

  let manifest;
  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8').replace(/^\uFEFF/, '');
    manifest = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      error: `manifest.json in "${resolved}" is not valid JSON: ${err.message}`
    };
  }

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return {
      ok: false,
      error: `manifest.json in "${resolved}" must be a JSON object.`
    };
  }

  if (manifest.manifest_version !== 2 && manifest.manifest_version !== 3) {
    return {
      ok: false,
      error: `Unsupported manifest_version (${JSON.stringify(manifest.manifest_version)}). Chromium in Electron ${process.versions.electron} supports Manifest V2 and Manifest V3 extensions.`
    };
  }

  return { ok: true, resolvedPath: resolved, manifest };
}

function listManagedExtensions() {
  const loadedMap = new Map();
  try {
    const extApi = getSessionExtensionsApi(session.defaultSession);
    const loaded = extApi.getAllExtensions ? extApi.getAllExtensions() : [];
    for (const ext of loaded) {
      if (ext && ext.id) loadedMap.set(ext.id, ext);
    }
  } catch (err) {
    console.error('[Extensions] Failed listing loaded extensions:', err);
  }

  const result = [];
  const seenIds = new Set();
  const stored = storage ? storage.getExtensions() : [];

  for (const rec of stored) {
    if (!rec || !rec.id) continue;
    const live = loadedMap.get(rec.id) || null;
    const isLoaded = Boolean(live);
    seenIds.add(rec.id);
    result.push({
      id: rec.id,
      name: live?.name || rec.name || 'Unnamed Extension',
      version: live?.version || rec.version || live?.manifest?.version || '',
      description: live?.manifest?.description || rec.description || '',
      path: live?.path || rec.path || '',
      manifestVersion: Number(live?.manifest?.manifest_version ?? rec.manifestVersion) || null,
      enabled: Boolean(rec.enabled && isLoaded),
      loaded: isLoaded,
      warnings: Array.isArray(rec.warnings) ? rec.warnings : [],
      lastError: isLoaded ? '' : rec.lastError || ''
    });
  }

  for (const [id, live] of loadedMap.entries()) {
    if (seenIds.has(id)) continue;
    result.push({
      id: live.id,
      name: live.name || 'Unnamed Extension',
      version: live.version || live.manifest?.version || '',
      description: live.manifest?.description || '',
      path: live.path || '',
      manifestVersion: Number(live.manifest?.manifest_version) || null,
      enabled: true,
      loaded: true,
      warnings: [],
      lastError: ''
    });
  }

  return result;
}

async function loadUnpackedExtensionFromPath(folderPath, { persist = true } = {}) {
  const validation = validateUnpackedExtensionPath(folderPath);
  if (!validation.ok) {
    console.error('[Extensions] Validation failed for', folderPath, '->', validation.error);
    return {
      ok: false,
      canceled: false,
      error: validation.error,
      path: folderPath || '',
      extensions: listManagedExtensions()
    };
  }

  const { resolvedPath } = validation;
  const extApi = getSessionExtensionsApi(session.defaultSession);
  if (!extApi || typeof extApi.loadExtension !== 'function') {
    const errMsg = 'Electron session.extensions.loadExtension API is unavailable in this runtime.';
    console.error('[Extensions]', errMsg);
    return {
      ok: false,
      canceled: false,
      error: errMsg,
      path: resolvedPath,
      extensions: listManagedExtensions()
    };
  }

  try {
    const { value: ext, warnings } = await captureExtensionLoadWarnings(resolvedPath, () =>
      extApi.loadExtension(resolvedPath, { allowFileAccess: false })
    );

    const allWarnings = [...warnings];
    if (ext?.manifest?.theme) {
      allWarnings.push(
        "Chrome theme extensions load in Chromium but do not restyle nextGx Browser's custom UI; use nextGx Settings to change themes."
      );
    }

    const record = {
      id: ext.id,
      path: ext.path || resolvedPath,
      name: ext.name || path.basename(resolvedPath),
      version: ext.version || ext.manifest?.version || '',
      description: ext.manifest?.description || '',
      manifestVersion: Number(ext.manifest?.manifest_version) || null,
      enabled: true,
      warnings: allWarnings,
      lastError: ''
    };

    if (persist && storage) {
      storage.upsertExtension(record);
    }

    return {
      ok: true,
      canceled: false,
      extension: record,
      warnings: allWarnings,
      extensions: listManagedExtensions()
    };
  } catch (err) {
    const rawMsg = err?.message || String(err);
    console.error('[Extensions] Failed to load unpacked extension at', resolvedPath, err);
    return {
      ok: false,
      canceled: false,
      error: rawMsg,
      path: resolvedPath,
      extensions: listManagedExtensions()
    };
  }
}

async function setExtensionEnabled(id, enabled) {
  if (!id || typeof id !== 'string') {
    return {
      ok: false,
      error: 'Missing extension ID.',
      extensions: listManagedExtensions()
    };
  }

  const extApi = getSessionExtensionsApi(session.defaultSession);
  const storedList = storage ? storage.getExtensions() : [];
  const storedRec = storedList.find((item) => item && item.id === id) || null;
  const liveExt = extApi?.getExtension ? extApi.getExtension(id) : null;

  if (!storedRec && !liveExt) {
    return {
      ok: false,
      error: `Extension "${id}" was not found.`,
      extensions: listManagedExtensions()
    };
  }

  if (!enabled) {
    try {
      if (liveExt && extApi?.removeExtension) {
        extApi.removeExtension(id);
      }
      if (storage) {
        storage.upsertExtension({
          id,
          path: storedRec?.path || liveExt?.path || '',
          name: storedRec?.name || liveExt?.name || 'Unnamed Extension',
          version: storedRec?.version || liveExt?.version || '',
          description: storedRec?.description || liveExt?.manifest?.description || '',
          manifestVersion:
            storedRec?.manifestVersion ?? (Number(liveExt?.manifest?.manifest_version) || null),
          enabled: false,
          warnings: Array.isArray(storedRec?.warnings) ? storedRec.warnings : [],
          lastError: ''
        });
      }
      return {
        ok: true,
        id,
        enabled: false,
        extensions: listManagedExtensions()
      };
    } catch (err) {
      console.error('[Extensions] Failed to disable extension', id, err);
      return {
        ok: false,
        id,
        enabled: Boolean(extApi?.getExtension?.(id)),
        error: `Failed to disable extension: ${err?.message || String(err)}`,
        extensions: listManagedExtensions()
      };
    }
  }

  // Enable: load from stored source path
  const sourcePath = storedRec?.path || liveExt?.path || '';
  if (!sourcePath) {
    const errMsg = 'Cannot re-enable extension because its source folder path is unknown. Remove it and load it again.';
    console.error('[Extensions]', errMsg, id);
    return {
      ok: false,
      id,
      enabled: false,
      error: errMsg,
      extensions: listManagedExtensions()
    };
  }

  const loadRes = await loadUnpackedExtensionFromPath(sourcePath, { persist: true });
  if (!loadRes.ok) {
    if (storage && storedRec) {
      storage.updateExtension(id, { enabled: false, lastError: loadRes.error || 'Failed to enable extension.' });
    }
    return {
      ok: false,
      id,
      enabled: false,
      error: loadRes.error || 'Failed to enable extension.',
      extensions: listManagedExtensions()
    };
  }

  return {
    ok: true,
    id: loadRes.extension?.id || id,
    enabled: true,
    extension: loadRes.extension,
    warnings: loadRes.warnings || [],
    extensions: loadRes.extensions
  };
}

async function reloadManagedExtension(id) {
  if (!id || typeof id !== 'string') {
    return {
      ok: false,
      error: 'Missing extension ID.',
      extensions: listManagedExtensions()
    };
  }
  const extApi = getSessionExtensionsApi(session.defaultSession);
  const storedRec = storage ? storage.getExtensions().find((item) => item && item.id === id) : null;
  const liveExt = extApi?.getExtension ? extApi.getExtension(id) : null;
  const sourcePath = storedRec?.path || liveExt?.path || '';

  if (!sourcePath) {
    return {
      ok: false,
      error: 'Cannot reload extension: source folder path is unknown.',
      extensions: listManagedExtensions()
    };
  }

  if (liveExt && extApi?.removeExtension) {
    try {
      extApi.removeExtension(id);
    } catch (err) {
      console.error('[Extensions] Error unloading extension prior to reload:', id, err);
    }
  }

  const loadRes = await loadUnpackedExtensionFromPath(sourcePath, { persist: true });
  if (!loadRes.ok && storage && storedRec) {
    storage.updateExtension(id, { enabled: false, lastError: loadRes.error || 'Reload failed.' });
  }
  return {
    ...loadRes,
    extensions: listManagedExtensions()
  };
}

function removeManagedExtension(id) {
  if (!id || typeof id !== 'string') {
    return { ok: false, error: 'Missing extension ID.', extensions: listManagedExtensions() };
  }
  try {
    const extApi = getSessionExtensionsApi(session.defaultSession);
    if (extApi?.getExtension?.(id) && extApi.removeExtension) {
      extApi.removeExtension(id);
    }
  } catch (err) {
    console.error('[Extensions] Error unloading extension during remove:', id, err);
  }
  if (storage) {
    storage.removeExtension(id);
  }
  return {
    ok: true,
    id,
    extensions: listManagedExtensions()
  };
}

async function restorePersistedExtensions() {
  if (!storage) return;
  const stored = storage.getExtensions();
  for (const rec of stored) {
    if (!rec || !rec.enabled || !rec.path) continue;
    const res = await loadUnpackedExtensionFromPath(rec.path, { persist: true });
    if (!res.ok) {
      console.error('[Extensions] Failed to restore extension on startup:', rec.name, rec.path, res.error);
      storage.updateExtension(rec.id, {
        enabled: false,
        lastError: res.error || 'Failed to restore extension on startup.'
      });
    }
  }
}

function openStartupWindows() {
  const settings = storage.getSettings();
  if (settings.restoreSession !== false) {
    const saved = storage.getSession();
    const savedWindows = Array.isArray(saved?.windows)
      ? saved.windows.filter((w) => w && Array.isArray(w.tabs) && w.tabs.length > 0)
      : [];
    if (savedWindows.length > 0) {
      for (const winSession of savedWindows) {
        createBrowserWindow({ incognito: false, restoreTabs: winSession });
      }
      return;
    }
  }
  createBrowserWindow({ incognito: false });
}

app.whenReady().then(async () => {
  storage = new StorageManager();
  adBlocker = new AdBlocker(storage, (stats) => {
    broadcastAdblockUpdate(stats);
  });

  adBlocker.attachToSession(session.defaultSession);
  setupPermissionsForSession(session.defaultSession);
  setupDownloadListener(session.defaultSession);
  session.defaultSession.cookies.on('changed', () => {
    broadcastCookiesUpdate();
  });
  await restorePersistedExtensions();
  registerIpcHandlers();

  openStartupWindows();
  startBackgroundTimers();
});

app.on('before-quit', () => {
  isAppQuitting = true;
  cancelScheduledSessionSave();
  cancelScheduledCookiesBroadcast();
  saveSessionNow({ allowEmpty: false });
  if (storage) storage.flushSettings();
});

app.on('window-all-closed', () => {
  app.quit();
});
