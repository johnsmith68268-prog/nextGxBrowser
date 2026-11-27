const fs = require('fs');
const path = require('path');
const {
  WebContentsView,
  app,
  dialog,
  ipcMain,
  session,
  shell,
  nativeImage
} = require('electron');
const { readClipboardText, writeClipboardText } = require('./clipboard-utils');
const {
  NEW_TAB_FILE,
  CORNER_FILE,
  WEBUI_FILE,
  ONBOARDING_FILE,
  SPLIT_PICKER_FILE,
  ERROR_PAGE_FILE,
  PLAYER_PANEL_FILE,
  SCREENSHOT_FILE,
  PRELOAD_FILE,
  windowContexts,
  webContentsToWinId,
  registerWebContents,
  state
} = require('./core');
const {
  normalizePathForCompare,
  resolveInternalUiFile,
  isInternalUiSender,
  normalizeAutofillHost,
  isAutofillHostMatch,
  attachInternalNavigationGuard,
  isErrorPageUrl,
  getInternalUiQuery,
  getOriginForUrl
} = require('./utils');
const {
  getFailedUrlFromErrorPage,
  formatDisplayUrl,
  getConfiguredHomepageUrl
} = require('./navigation');
const { registerPasskeyIpcHandlers } = require('./passkeys'); // worker C: software passkey authenticator (gaps 4.1-4.3)
const {
  getCtxFromSender,
  serializeTabs,
  broadcastState,
  sendToWebUiTabs,
  notifyActiveWebUiTabShown,
  broadcastAdblockUpdate,
  broadcastHistoryUpdate,
  broadcastPasswordsUpdate,
  broadcastPermissionsUpdate,
  broadcastDownloadsUpdate,
  broadcastSettingsUpdate,
  broadcastBookmarksUpdate,
  getAllTabWebContents,
  syncAdblockCosmeticFilters
} = require('./broadcast');
const { updateActiveViewBounds, setShellModalOpen } = require('./layout');
const {
  getCustomWallpaperDataUrl,
  saveCustomWallpaperPayload,
  removeCustomWallpaperFile,
  deleteWallpaperFileBestEffort
} = require('./wallpapers');
const { applyZoomAction } = require('./shortcuts');
const { openPopover, resizePopover, closePopover } = require('./popovers');
const { scheduleSessionSave } = require('./session');
const {
  allowCertException,
  isCertErrorCode,
  normalizeOrigin,
  getObservedCertFingerprint
} = require('./cert-exceptions');
const {
  createTab,
  openOrFocusGxCornerTab,
  switchTab,
  sleepTab,
  sleepBackgroundTabs,
  closeTab,
  closeOtherTabs,
  reopenLastClosedTab,
  duplicateTab,
  reorderTab,
  togglePinTab,
  findTabByWebContents,
  navigateActiveTab,
  reloadTab,
  reloadActiveTab,
  toggleActiveTabDevTools
} = require('./tabs');
const { createBrowserWindow } = require('./windows');
const {
  clampSidebarWidth,
  findSidebarServiceByWebContents,
  serializeSidebarState,
  syncSidebarFrameViewState,
  broadcastSidebarState,
  syncSidebarLayoutLeft,
  openSidebarPanel,
  closeSidebarPanel,
  toggleSidebarPanel,
  setSidebarPinned,
  setSidebarWidth,
  setSidebarResizing,
  reloadSidebarPanel,
  openSidebarPanelInNewTab
} = require('./sidebar');
const { registerDownloadIpcHandlers } = require('./downloads');
const { broadcastCookiesUpdate, registerCookieIpcHandlers } = require('./cookies');
const {
  registerExtensionIpcHandlers,
  getExtensionsDropdownData,
  setExtensionPinned
} = require('./extensions');
const { openExtensionPopup } = require('./extension-popup');
const { toggleWindowFullscreen } = require('./fullscreen');
const {
  captureFullPagePng,
  copyScreenshotPng,
  saveScreenshotPng,
  saveScreenshotWithDialog,
  savePageAsPdf
} = require('./screenshots');
const { resolvePermissionPrompt } = require('./permissions');
const { collectSystemStats, broadcastSystemStatsNow, hibernateNow } = require('./stats');
const gxControl = require('./gxcontrol');
const { togglePanic, triggerPanic, restorePanic, getPanicState } = require('./panic');
const { readModPack, sanitizeModRegistry, buildModSettingsPatch, getModStatus } = require('./gxmods');
const { registerPlayerIpcHandlers } = require('./player');
const { registerGxCornerIpcHandlers } = require('./gxcorner');
const { getSessionForProfile, registerProfileIpcHandlers } = require('./profiles');
const { registerImportExportIpcHandlers } = require('./import-export');
const { registerPrivacyAndPasswordIpcHandlers } = require('./privacy');
const { registerSplitIpcHandlers, onWorkspacesChanged } = require('./splitview');
const { registerShellDrawerIpcHandlers, openShellDrawer } = require('./drawer-overlay');
const {
  getWorkspaces,
  getGroupsForCtx,
  createWorkspace,
  renameWorkspace,
  switchWorkspace,
  deleteWorkspace,
  moveTabToWorkspace,
  createTabGroup,
  addTabToGroup,
  removeTabFromGroup,
  updateTabGroup,
  toggleGroupCollapsed,
  ungroupTabGroup,
  createTabInGroup
} = require('./workspaces');

// ---------------------------------------------------------------------------
// [Wave2-D] Settings-driven browser behaviour (Chrome parity, gaps 5.2/5.4/5.5/5.9).
// These helpers live here because ipc.js is the one main-process module this
// worker may extend; they apply stored settings to live Electron sessions.
// ---------------------------------------------------------------------------

// [Wave2-D] Registrable-domain (eTLD+1) heuristic for third-party checks and
// search grouping. A small suffix list covers the common two-label public
// suffixes; anything else uses the last two labels. Rough but safe: when in
// doubt a host is treated as first-party (never blocked).
const TP_COOKIE_TWO_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.jp',
  'co.kr', 'co.nz', 'com.br', 'com.cn', 'co.in', 'co.za', 'com.mx', 'com.tw',
  'com.hk', 'co.il', 'com.sg', 'com.ar', 'com.co', 'com.pl', 'co.th'
]);

const registrableDomainCache = new Map();

function fastExtractHost(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl) return '';
  const idx = rawUrl.indexOf('://');
  if (idx === -1) return '';
  const start = idx + 3;
  let authorityEnd = rawUrl.length;
  for (let i = start; i < authorityEnd; i++) {
    const c = rawUrl.charCodeAt(i);
    if (c === 47 || c === 63 || c === 35) {
      // '/', '?', '#'
      authorityEnd = i;
      break;
    }
  }
  let hostStart = start;
  const atIdx = rawUrl.lastIndexOf('@', authorityEnd - 1);
  if (atIdx >= start) {
    hostStart = atIdx + 1;
  }
  if (hostStart >= authorityEnd) return '';
  if (rawUrl.charCodeAt(hostStart) === 91) {
    // IPv6 literal [::1] or [::1]:8080
    const closeBracket = rawUrl.indexOf(']', hostStart + 1);
    if (closeBracket === -1 || closeBracket >= authorityEnd) return '';
    return rawUrl.slice(hostStart, closeBracket + 1).toLowerCase();
  }
  let hostEnd = authorityEnd;
  for (let i = hostStart; i < authorityEnd; i++) {
    if (rawUrl.charCodeAt(i) === 58) {
      hostEnd = i;
      break;
    }
  }
  return rawUrl.slice(hostStart, hostEnd).toLowerCase();
}

function getRegistrableDomain(host) {
  const h = String(host || '').toLowerCase().replace(/^\.+|\.+$/g, '');
  if (!h) return '';
  const cached = registrableDomainCache.get(h);
  if (cached !== undefined) return cached;
  const parts = h.split('.').filter(Boolean);
  let res;
  if (parts.length <= 2) {
    res = h;
  } else {
    const lastTwo = parts.slice(-2).join('.');
    res = TP_COOKIE_TWO_LABEL_SUFFIXES.has(lastTwo) && parts.length >= 3
      ? parts.slice(-3).join('.')
      : lastTwo;
  }
  if (registrableDomainCache.size >= 512) {
    registrableDomainCache.clear();
  }
  registrableDomainCache.set(h, res);
  return res;
}

// [Wave2-D] Third-party cookie blocking (gap 5.9), enforced at the network
// level: Cookie request headers and Set-Cookie response headers are stripped
// for cross-site requests. Listeners are attached once per session and read
// the live mode, so toggling the setting needs no re-attach. Limitation:
// `document.cookie` access from third-party iframes is NOT blocked by this;
// full parity would need Chromium cookie-policy support Electron lacks.
let tpCookieMode = 'block-incognito';
const tpCookieSessions = new Map(); // session -> isIncognito

function isThirdPartyRequest(details) {
  try {
    if (details.resourceType === 'mainFrame') return false;
    const reqHost = fastExtractHost(details.url) || new URL(details.url).hostname.toLowerCase();
    if (!reqHost) return false;
    const initiatorRaw =
      (typeof details.initiator === 'string' && details.initiator) ||
      (typeof details.referrer === 'string' && details.referrer) ||
      '';
    if (!initiatorRaw) return false;
    if (initiatorRaw === 'null') return true;
    const initHost = fastExtractHost(initiatorRaw) || new URL(initiatorRaw).hostname.toLowerCase();
    if (!initHost || reqHost === initHost) return false;
    return getRegistrableDomain(reqHost) !== getRegistrableDomain(initHost);
  } catch (_) {
    return false;
  }
}

function shouldBlockThirdPartyCookies(ses, details) {
  if (tpCookieMode === 'allow') return false;
  if (tpCookieMode === 'block-incognito' && !tpCookieSessions.get(ses)) return false;
  return isThirdPartyRequest(details);
}

function ensureThirdPartyCookieListeners(ses, isIncognito) {
  if (!ses || !ses.webRequest) return;
  if (tpCookieSessions.has(ses)) {
    tpCookieSessions.set(ses, Boolean(isIncognito));
    return;
  }
  tpCookieSessions.set(ses, Boolean(isIncognito));
  try {
    ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
      try {
        if (shouldBlockThirdPartyCookies(ses, details)) {
          const headers = { ...(details.requestHeaders || {}) };
          for (const k of Object.keys(headers)) {
            if (k.toLowerCase() === 'cookie') delete headers[k];
          }
          callback({ requestHeaders: headers });
          return;
        }
      } catch (_) { }
      callback({});
    });
    ses.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
      try {
        if (shouldBlockThirdPartyCookies(ses, details)) {
          const headers = { ...(details.responseHeaders || {}) };
          for (const k of Object.keys(headers)) {
            if (k.toLowerCase() === 'set-cookie') delete headers[k];
          }
          callback({ responseHeaders: headers });
          return;
        }
      } catch (_) { }
      callback({});
    });
  } catch (_) { }
}

function resolveValidDownloadDir(rawPath) {
  if (typeof rawPath === 'string' && rawPath.trim()) {
    const candidate = rawPath.trim();
    try {
      if (path.isAbsolute(candidate) && fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch (_) { }
  }
  return app.getPath('downloads');
}

function applySessionPrivacyAndPrefs(ses, { incognito = false, profileId = 'default' } = {}) {
  if (!ses) return;
  try {
    const s = state.storage ? state.storage.getSettings(profileId) : {};
    tpCookieMode = ['allow', 'block-incognito', 'block'].includes(s.thirdPartyCookies)
      ? s.thirdPartyCookies
      : 'block-incognito';
    ensureThirdPartyCookieListeners(ses, Boolean(incognito));
    const enabled = s.spellcheckEnabled !== false;
    const langs =
      Array.isArray(s.preferredLanguages) && s.preferredLanguages.length
        ? s.preferredLanguages
        : ['en-US'];
    if (typeof ses.setSpellCheckerLanguages === 'function') {
      ses.setSpellCheckerLanguages(enabled ? langs : []);
    }
    const target = resolveValidDownloadDir(s.downloadPath);
    if (typeof ses.setDownloadPath === 'function') {
      ses.setDownloadPath(target);
    }
  } catch (_) { }
}

function applyThirdPartyCookieMode(mode) {
  tpCookieMode = ['allow', 'block-incognito', 'block'].includes(mode) ? mode : 'block-incognito';
  ensureThirdPartyCookieListeners(session.defaultSession, false);
  try {
    const ses = getSessionForProfile(state.storage.getActiveProfileId());
    if (ses) ensureThirdPartyCookieListeners(ses, false);
  } catch (_) { }
  for (const ctx of windowContexts.values()) {
    if (ctx && ctx.session) ensureThirdPartyCookieListeners(ctx.session, Boolean(ctx.incognito));
  }
}

// [Wave2-D] Spellcheck (gap 5.4): preferredLanguages drives the Chromium
// spellchecker for every live session; an empty list disables checking.
function applySpellcheckSettings(settings) {
  const enabled = !settings || settings.spellcheckEnabled !== false;
  const langs =
    settings && Array.isArray(settings.preferredLanguages) && settings.preferredLanguages.length
      ? settings.preferredLanguages
      : ['en-US'];
  const applyTo = (ses) => {
    try {
      if (ses && typeof ses.setSpellCheckerLanguages === 'function') {
        ses.setSpellCheckerLanguages(enabled ? langs : []);
      }
    } catch (_) { }
  };
  applyTo(session.defaultSession);
  try {
    applyTo(getSessionForProfile(state.storage.getActiveProfileId()));
  } catch (_) { }
  for (const ctx of windowContexts.values()) {
    if (ctx && ctx.session) applyTo(ctx.session);
  }
}

// [Wave2-D] Download location (gap 5.5): sets the session default download
// path. NOTE: downloads.js's will-download handler calls setSavePath() with
// its own path, which overrides this — the location setting only takes full
// effect once that handler reads settings.downloadPath (see the work log).
function applyDownloadPathSetting(settings) {
  let target = '';
  try {
    target = resolveValidDownloadDir(settings?.downloadPath);
  } catch (_) {
    return;
  }
  const applyTo = (ses) => {
    try {
      if (ses && typeof ses.setDownloadPath === 'function') ses.setDownloadPath(target);
    } catch (_) { }
  };
  applyTo(session.defaultSession);
  try {
    applyTo(getSessionForProfile(state.storage.getActiveProfileId()));
  } catch (_) { }
  for (const ctx of windowContexts.values()) {
    if (ctx && ctx.session) applyTo(ctx.session);
  }
}

// [Wave2-D] Address-bar search resolution (gap 5.2). Mirrors the URL-vs-query
// detection in navigation.js: URLs, domains, localhost and internal schemes
// pass through untouched (return null); anything else is a search query,
// resolved against the editable engine list (keyword prefix first, then the
// default engine). Called from the tabs:navigate handler so custom engines
// actually drive searches without touching navigation.js.
function buildSearchUrl(template, query) {
  const t = typeof template === 'string' && template.includes('%s') ? template : 'https://www.google.com/search?q=%s';
  return t.replace('%s', encodeURIComponent(query));
}

function resolveAddressBarSearch(input, settings) {
  const trimmed = String(input || '').trim();
  if (!trimmed) return null;
  const { isUrlLikeInput, resolveNavigateInput } = require('./navigation');
  if (isUrlLikeInput(trimmed)) return null;
  return resolveNavigateInput(trimmed, settings);
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
    } else if (normalized === normalizePathForCompare(CORNER_FILE)) {
      event.returnValue = 'corner';
    } else if (normalized === normalizePathForCompare(WEBUI_FILE)) {
      event.returnValue = 'webui';
    } else if (normalized === normalizePathForCompare(ONBOARDING_FILE)) {
      event.returnValue = 'onboarding';
    } else if (normalized === normalizePathForCompare(SPLIT_PICKER_FILE)) {
      event.returnValue = 'split-picker';
    } else if (normalized === normalizePathForCompare(ERROR_PAGE_FILE)) {
      event.returnValue = 'error';
    } else if (normalized === normalizePathForCompare(PLAYER_PANEL_FILE)) {
      event.returnValue = 'player';
    } else {
      event.returnValue = null;
    }
  });

  const getSenderProfileId = (e) => {
    const ctx = getCtxFromSender(e?.sender);
    return ctx?.profileId || state.storage.getActiveProfileId();
  };

  ipcMain.on('adblock:get-page-config', (event) => {
    try {
      const url = event?.senderFrame?.url || event?.sender?.getURL?.() || '';
      const ctx = getCtxFromSender(event?.sender);
      const pid = ctx?.profileId || state.storage?.getActiveProfileId?.() || 'default';
      const enabled = state.adBlocker ? state.adBlocker.isSiteBlockingActive(url, pid) : true;
      event.returnValue = { enabled: Boolean(enabled) };
    } catch (_) {
      event.returnValue = { enabled: true };
    }
  });

  ipcMain.handle('pagefx:get-settings', (e) => {
    try {
      if (!e?.sender || !e?.senderFrame || e.senderFrame !== e.sender.mainFrame) {
        return { shaderPreset: 'none', videoEnhancePreset: 'off' };
      }
      const pid = getSenderProfileId(e);
      const s = state.storage ? state.storage.getSettings(pid) : {};
      return {
        shaderPreset: typeof s.shaderPreset === 'string' ? s.shaderPreset : 'none',
        videoEnhancePreset: typeof s.videoEnhancePreset === 'string' ? s.videoEnhancePreset : 'off'
      };
    } catch (_) {
      return { shaderPreset: 'none', videoEnhancePreset: 'off' };
    }
  });

  ipcMain.handle('autofill:get', (e) => {
    // Only allow top-level mainFrame over HTTPS (or localhost/127.0.0.1 for local dev)
    if (!e?.sender || !e?.senderFrame || e.senderFrame !== e.sender.mainFrame) return [];
    const ctx = getCtxFromSender(e.sender);
    if (ctx && ctx.incognito) return [];
    const frameUrl = e.senderFrame.url;
    if (!frameUrl) return [];
    try {
      const u = new URL(frameUrl);
      const rawHost = (u.hostname || '').toLowerCase();
      const isLocalDev = rawHost === 'localhost' || rawHost === '127.0.0.1' || rawHost === '[::1]' || rawHost === '::1';
      if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocalDev)) return [];
      const pageHost = isLocalDev && u.port ? `${u.hostname}:${u.port}` : u.hostname;
      if (!pageHost) return [];
      const pid = getSenderProfileId(e);
      return (state.storage.getPasswords(pid) || []).filter((p) => p && p.site && isAutofillHostMatch(pageHost, p.site));
    } catch (_) {
      return [];
    }
  });

  // [FIXUP-5] (Chrome parity gaps 6.2/6.3) Page fill engine channels.
  // Same gates as 'autofill:get' (top-level mainFrame, HTTPS or
  // localhost/127.0.0.1 only), but these are plain handles the TAB PRELOAD
  // may invoke — the 'autofill:get-addresses' / 'autofill:get-payment-methods'
  // channels above are handleInternal (internal UI only) and the tab preload
  // cannot call them. Incognito windows get [] (never expose stored
  // addresses/cards to a private window). Cards come back with the full
  // decrypted number (getPaymentMethodsForAutofill — same trust level as
  // passwords:get); the masked getPaymentMethods is for settings UI only.
  const pageAutofillGate = (e) => {
    if (!e?.sender || !e?.senderFrame || e.senderFrame !== e.sender.mainFrame) return null;
    const frameUrl = e.senderFrame.url;
    if (!frameUrl) return null;
    try {
      const u = new URL(frameUrl);
      const rawHost = (u.hostname || '').toLowerCase();
      const isLocalDev = rawHost === 'localhost' || rawHost === '127.0.0.1';
      if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocalDev)) return null;
      if (!u.hostname) return null;
      if (getCtxFromSender(e.sender)?.incognito) return [];
      return getSenderProfileId(e);
    } catch (_) {
      return null;
    }
  };

  ipcMain.handle('autofill:page-addresses', (e) => {
    const pid = pageAutofillGate(e);
    if (typeof pid !== 'string' || !pid) return [];
    return state.storage.getAddresses(pid) || [];
  });

  ipcMain.handle('autofill:page-payment-methods', (e) => {
    const pid = pageAutofillGate(e);
    if (typeof pid !== 'string' || !pid) return [];
    return state.storage.getPaymentMethodsForAutofill(pid) || [];
  });

  ipcMain.handle('autofill:save', (e, { username, password } = {}) => {
    if (!e?.sender || !e?.senderFrame || e.senderFrame !== e.sender.mainFrame) return false;
    const ctx = getCtxFromSender(e.sender);
    // Never persist credentials entered in Private/Incognito windows
    if (ctx?.incognito) return false;
    const frameUrl = e.senderFrame.url;
    if (!frameUrl || typeof username !== 'string' || typeof password !== 'string') return false;
    const cleanUser = username.trim();
    if (!cleanUser || !password) return false;
    try {
      const u = new URL(frameUrl);
      const rawHost = (u.hostname || '').toLowerCase();
      const isLocalDev = rawHost === 'localhost' || rawHost === '127.0.0.1' || rawHost === '[::1]' || rawHost === '::1';
      if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocalDev)) return false;
      const site = normalizeAutofillHost(isLocalDev && u.port ? `${u.hostname}:${u.port}` : u.hostname);
      if (!site) return false;
      const pid = getSenderProfileId(e);
      state.storage.addPassword({ site, username: cleanUser, password }, pid);
      broadcastPasswordsUpdate({ profileId: pid });
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
  handleInternal('tabs:open-corner', (e) => openOrFocusGxCornerTab(getCtxFromSender(e.sender)));
  handleInternal('tabs:switch', (e, tabId) => switchTab(getCtxFromSender(e.sender), tabId));
  handleInternal('tabs:close', (e, tabId) => closeTab(getCtxFromSender(e.sender), tabId));
  // UX phase: Undo for a closed tab (toast action in the shell).
  handleInternal('tabs:reopen-closed', (e) => reopenLastClosedTab(getCtxFromSender(e.sender)));
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
  // [Fix2 A6] Hibernate Now: sleep every eligible background tab in every
  // window + suspend idle sidebar views, and report MEASURED RAM before /
  // after (never fabricated). Stronger than sleep-background, which only
  // covers the sending window and reports no numbers.
  handleInternal('tabs:hibernate-now', () => hibernateNow());

  // [Fix2 Panic] One action hides all tabs (neutral Start page); a second
  // press — or panic:restore — brings the previous session back. The
  // toolbar / GX Control entry point is this IPC; the keyboard shortcut is
  // Ctrl+Shift+P (shortcuts.js).
  handleInternal('panic:trigger', (e) => triggerPanic(getCtxFromSender(e.sender)));
  handleInternal('panic:restore', (e) => restorePanic(getCtxFromSender(e.sender)));
  handleInternal('panic:toggle', (e) => togglePanic(getCtxFromSender(e.sender)));
  handleInternal('panic:get-state', (e) => getPanicState(getCtxFromSender(e.sender)));

  // [Fix2 GX Mods] LOCAL packs only — no online store, no network fetch.
  // load opens a folder picker; apply copies a pack wallpaper locally and
  // sets the theme through settings:update.
  handleInternal('gxmods:list', () => {
    const s = state.storage.getSettings();
    return getModStatus(s);
  });
  handleInternal('gxmods:load', async (e) => {
    const ctx = getCtxFromSender(e.sender);
    const win = ctx && ctx.win && !ctx.win.isDestroyed() ? ctx.win : null;
    const res = await dialog.showOpenDialog(win || undefined, {
      properties: ['openDirectory'],
      title: 'Load a local GX Mod pack folder'
    });
    if (res.canceled || !res.filePaths || !res.filePaths[0]) {
      return { ok: false, canceled: true };
    }
    const read = readModPack(res.filePaths[0]);
    if (!read.ok) return { ok: false, error: read.error };
    const s = state.storage.getSettings();
    const registry = sanitizeModRegistry(s.gxModPacks || []);
    const existingIdx = registry.findIndex((p) => p.path === read.pack.path);
    if (existingIdx === -1) registry.push(read.pack);
    else registry[existingIdx] = read.pack;
    state.storage.updateSettings({ gxModPacks: registry });
    return { ok: true, pack: read.pack, status: getModStatus(state.storage.getSettings()) };
  });
  handleInternal('gxmods:apply', (e, id) => {
    const s = state.storage.getSettings();
    const packs = sanitizeModRegistry(s.gxModPacks || []);
    const pack = packs.find((p) => p.id === id);
    if (!pack) return { ok: false, error: 'Mod pack not found.' };
    const { patch, warnings } = buildModSettingsPatch(pack);
    const updated = state.storage.updateSettings({ ...patch, activeGxModId: pack.id });
    broadcastSettingsUpdate(updated);
    return { ok: true, pack, warnings, status: getModStatus(updated) };
  });
  handleInternal('gxmods:remove', (e, id) => {
    const s = state.storage.getSettings();
    const packs = sanitizeModRegistry(s.gxModPacks || []).filter((p) => p.id !== id);
    const nextActive = s.activeGxModId === id ? '' : s.activeGxModId;
    const updated = state.storage.updateSettings({ gxModPacks: packs, activeGxModId: nextActive });
    return { ok: true, status: getModStatus(updated) };
  });
  handleInternal('gxmods:get-status', () => getModStatus(state.storage.getSettings()));

  // [Fix2 Sounds] Honest local-audio status. This repo ships NO audio
  // files — UI sounds are Web Audio synth (src/ui/sounds.js). The toggles
  // (keyboardSoundsEnabled / backgroundMusicEnabled) are real settings;
  // soundPackInstalled is true only when the active local Mod pack folder
  // actually contains audio files.
  handleInternal('sounds:get-status', () => {
    const s = state.storage.getSettings();
    const modStatus = getModStatus(s);
    return {
      keyboardSoundsEnabled: Boolean(s.keyboardSoundsEnabled),
      backgroundMusicEnabled: Boolean(s.backgroundMusicEnabled),
      uiSoundsEnabled: s.uiSoundsEnabled !== false,
      uiSoundsVolume: typeof s.uiSoundsVolume === 'number' ? s.uiSoundsVolume : 0.35,
      soundPackInstalled: modStatus.soundPackInstalled,
      audioFiles: modStatus.audioFiles,
      activeModName: modStatus.active ? modStatus.active.name : '',
      note: modStatus.soundPackInstalled
        ? 'A local sound pack is installed (files inside the active Mod pack folder).'
        : 'No sound pack installed — keyboard sounds and background music are off until a local Mod pack with audio files is loaded.'
    };
  });

  // Workspaces
  handleInternal('workspaces:get', () => getWorkspaces());
  handleInternal('workspaces:create', (e, opts) => createWorkspace(getCtxFromSender(e.sender), opts || {}));
  handleInternal('workspaces:switch', (e, workspaceId) => switchWorkspace(getCtxFromSender(e.sender), workspaceId));
  handleInternal('workspaces:rename', (e, payload) => {
    const p = payload && typeof payload === 'object' ? payload : {};
    return renameWorkspace(getCtxFromSender(e.sender), p.workspaceId || p.id, p.name);
  });
  handleInternal('workspaces:delete', (e, workspaceId) => {
    const ctx = getCtxFromSender(e.sender);
    const res = deleteWorkspace(ctx, workspaceId);
    onWorkspacesChanged(null, { allNormalWindows: true });
    if (res && typeof res === 'object' && res.state && ctx) {
      res.state = serializeTabs(ctx);
    }
    return res;
  });
  handleInternal('workspaces:move-tab', (e, payload) => {
    const ctx = getCtxFromSender(e.sender);
    const p = payload && typeof payload === 'object' ? payload : {};
    moveTabToWorkspace(ctx, p.tabId, p.workspaceId);
    onWorkspacesChanged(ctx);
    return serializeTabs(ctx);
  });

  // Tab Islands / Groups
  handleInternal('groups:get', (e) => getGroupsForCtx(getCtxFromSender(e.sender)));
  handleInternal('groups:create', (e, opts) => createTabGroup(getCtxFromSender(e.sender), opts || {}));
  handleInternal('groups:add-tab', (e, payload) => {
    const p = payload && typeof payload === 'object' ? payload : {};
    return addTabToGroup(getCtxFromSender(e.sender), p.tabId, p.groupId, p);
  });
  handleInternal('groups:remove-tab', (e, tabId) => removeTabFromGroup(getCtxFromSender(e.sender), tabId));
  handleInternal('groups:update', (e, payload) => {
    const p = payload && typeof payload === 'object' ? payload : {};
    return updateTabGroup(getCtxFromSender(e.sender), p.groupId || p.id, p);
  });
  handleInternal('groups:toggle-collapse', (e, groupId) => toggleGroupCollapsed(getCtxFromSender(e.sender), groupId));
  handleInternal('groups:ungroup', (e, groupId) => ungroupTabGroup(getCtxFromSender(e.sender), groupId));
  handleInternal('groups:create-tab', (e, groupId) => createTabInGroup(getCtxFromSender(e.sender), groupId));
  handleInternal('tabs:get-state', (e) => serializeTabs(getCtxFromSender(e.sender)));
  handleInternal('tabs:navigate', (e, input) => {
    const ctx = getCtxFromSender(e.sender);
    if (!ctx) return null;
    const rawTrimmed = typeof input === 'string' ? input.trim() : '';
    if (/^(?:data|blob|vbscript):/i.test(rawTrimmed)) {
      return serializeTabs(ctx);
    }
    const safeInput = /^javascript:/i.test(rawTrimmed) ? rawTrimmed.replace(/^javascript:\s*/i, '') : input;
    // [Wave2-D] Custom search engines (gap 5.2): resolve address-bar search
    // queries against the editable engine list before navigating, so a
    // chosen custom engine (or a `keyword query`) actually drives the search.
    // URLs pass through untouched; navigateActiveTab resolves them as before.
    let resolved = safeInput;
    try {
      const searchUrl = resolveAddressBarSearch(safeInput, state.storage.getSettings(getSenderProfileId(e)));
      if (searchUrl) resolved = searchUrl;
    } catch (_) { }
    navigateActiveTab(ctx, resolved);
    return serializeTabs(ctx);
  });
  handleInternal('tabs:back', (e) => {
    const ctx = getCtxFromSender(e.sender);
    if (!ctx) return null;
    const goBackSafe = (wc) => {
      if (!wc || wc.isDestroyed()) return;
      if (wc.navigationHistory) {
        if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
      } else if (wc.canGoBack()) {
        wc.goBack();
      }
    };
    const sidebarEntry = findSidebarServiceByWebContents(ctx, e.sender);
    if (sidebarEntry) {
      goBackSafe(sidebarEntry.view?.webContents);
      return serializeTabs(ctx);
    }
    const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    goBackSafe(tab?.view?.webContents);
    return serializeTabs(ctx);
  });
  handleInternal('tabs:forward', (e) => {
    const ctx = getCtxFromSender(e.sender);
    if (!ctx) return null;
    const goForwardSafe = (wc) => {
      if (!wc || wc.isDestroyed()) return;
      if (wc.navigationHistory) {
        if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
      } else if (wc.canGoForward()) {
        wc.goForward();
      }
    };
    const sidebarEntry = findSidebarServiceByWebContents(ctx, e.sender);
    if (sidebarEntry) {
      goForwardSafe(sidebarEntry.view?.webContents);
      return serializeTabs(ctx);
    }
    const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    goForwardSafe(tab?.view?.webContents);
    return serializeTabs(ctx);
  });
  handleInternal('tabs:reload', (e, tabId) => {
    const ctx = getCtxFromSender(e.sender);
    if (!ctx) return null;
    if (tabId) reloadTab(ctx, tabId);
    else reloadActiveTab(ctx);
    return serializeTabs(ctx);
  });
  handleInternal('tabs:retry-failed', (e, requestedUrl) => {
    const ctx = getCtxFromSender(e.sender);
    if (!ctx) return null;
    const sidebarEntry = findSidebarServiceByWebContents(ctx, e.sender);
    if (sidebarEntry) {
      reloadSidebarPanel(ctx);
      return serializeTabs(ctx);
    }
    const tab = findTabByWebContents(ctx, e.sender);
    if (!tab || !tab.view || tab.view.webContents.isDestroyed()) return serializeTabs(ctx);
    const currentUrl = tab.view.webContents.getURL();
    const candidate =
      getFailedUrlFromErrorPage(currentUrl) ||
      tab.failedUrl ||
      getFailedUrlFromErrorPage(tab.url) ||
      (typeof requestedUrl === 'string' ? requestedUrl.trim() : '');
    if (
      !candidate ||
      !/^https?:\/\//i.test(candidate) ||
      isErrorPageUrl(candidate) ||
      resolveInternalUiFile(candidate)
    ) {
      return serializeTabs(ctx);
    }
    tab.url = candidate;
    tab.isLoading = true;
    broadcastState(ctx);
    scheduleSessionSave(ctx);
    tab.view.webContents.loadURL(candidate).catch(() => { });
    return serializeTabs(ctx);
  });
  // "Proceed anyway" from the Connection Not Private error page. The
  // error page only offers this for cert errors, and only after showing
  // the full warning. The exception is session-only (in-memory, cleared
  // on quit — see src/main/cert-exceptions.js) and covers exactly the
  // failed origin, https only. It does NOT change the default: every
  // other cert error is still denied by the app-level handler in main.js.
  const hasErrorPageCertParams = (errorPageUrl) => {
    if (!errorPageUrl || !isErrorPageUrl(errorPageUrl)) return false;
    try {
      const sp = new URL(errorPageUrl).searchParams;
      return isCertErrorCode(sp.get('code'), sp.get('desc') || sp.get('error'));
    } catch (_) {
      return false;
    }
  };

  handleInternal('tabs:proceed-insecure', (e, requestedUrl) => {
    const ctx = getCtxFromSender(e.sender);
    if (!ctx) return null;
    const sessionKey = ctx.incognito
      ? `incog:${ctx.win?.id || 0}`
      : `prof:${ctx.profileId || 'default'}`;
    const sidebarEntry = findSidebarServiceByWebContents(ctx, e.sender);
    if (sidebarEntry) {
      const meta = sidebarEntry.meta || null;
      const currentSidebarUrl =
        sidebarEntry.view && !sidebarEntry.view.webContents.isDestroyed()
          ? sidebarEntry.view.webContents.getURL()
          : '';
      const candidate =
        getFailedUrlFromErrorPage(currentSidebarUrl) ||
        meta?.failedUrl ||
        (typeof requestedUrl === 'string' ? requestedUrl.trim() : '');
      const safeOrigin = normalizeOrigin(candidate);
      const isCertFailure =
        isCertErrorCode(meta?.failedErrorCode, meta?.failedErrorDesc) ||
        hasErrorPageCertParams(currentSidebarUrl) ||
        Boolean(safeOrigin && getObservedCertFingerprint(safeOrigin, sessionKey));
      if (!safeOrigin || !isCertFailure || isErrorPageUrl(candidate) || resolveInternalUiFile(candidate)) {
        return serializeTabs(ctx);
      }
      allowCertException(safeOrigin, { sessionKey });
      reloadSidebarPanel(ctx);
      return serializeTabs(ctx);
    }
    const tab = findTabByWebContents(ctx, e.sender);
    if (!tab || !tab.view || tab.view.webContents.isDestroyed()) return serializeTabs(ctx);
    const currentUrl = tab.view.webContents.getURL();
    const candidate =
      getFailedUrlFromErrorPage(currentUrl) ||
      tab.failedUrl ||
      getFailedUrlFromErrorPage(tab.url) ||
      (typeof requestedUrl === 'string' ? requestedUrl.trim() : '');
    const safeOrigin = normalizeOrigin(candidate);
    const isCertFailure =
      isCertErrorCode(tab.failedErrorCode, tab.failedErrorDesc) ||
      hasErrorPageCertParams(currentUrl) ||
      hasErrorPageCertParams(tab.url) ||
      Boolean(safeOrigin && getObservedCertFingerprint(safeOrigin, sessionKey));
    if (!safeOrigin || !isCertFailure || isErrorPageUrl(candidate) || resolveInternalUiFile(candidate)) {
      return serializeTabs(ctx);
    }
    allowCertException(safeOrigin, { sessionKey });
    tab.url = candidate;
    tab.isLoading = true;
    broadcastState(ctx);
    scheduleSessionSave(ctx);
    tab.view.webContents.loadURL(candidate).catch(() => { });
    return serializeTabs(ctx);
  });
  handleInternal('tabs:stop', (e) => {
    const ctx = getCtxFromSender(e.sender);
    if (!ctx) return null;
    const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    if (tab?.view && !tab.view.webContents.isDestroyed()) {
      tab.view.webContents.stop();
    }
    if (tab && tab.isLoading) {
      tab.isLoading = false;
      broadcastState(ctx);
    }
    return serializeTabs(ctx);
  });
  handleInternal('tabs:home', (e) => {
    const ctx = getCtxFromSender(e.sender);
    if (!ctx) return null;
    const sidebarEntry = findSidebarServiceByWebContents(ctx, e.sender);
    if (sidebarEntry && sidebarEntry.service) {
      if (sidebarEntry.meta) {
        sidebarEntry.meta.url = sidebarEntry.service.url;
        sidebarEntry.meta.failedUrl = '';
        sidebarEntry.meta.isLoading = true;
      }
      broadcastSidebarState(ctx);
      sidebarEntry.view.webContents.loadURL(sidebarEntry.service.url).catch(() => { });
      return serializeTabs(ctx);
    }
    navigateActiveTab(ctx, getConfiguredHomepageUrl());
    return serializeTabs(ctx);
  });
  handleInternal('tabs:devtools', (e) => toggleActiveTabDevTools(getCtxFromSender(e.sender)));

  // [URLBAR-9.2] Persist the active tab's zoom per origin after any zoom change
  // (menu/bubble buttons go through here; keyboard shortcuts are persisted by the
  // renderer-side zoom watcher via 'zoom:save-site' below).
  const persistActiveTabZoom = (ctx, profileId) => {
    try {
      const tab = ctx?.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
      const origin = getOriginForUrl(tab?.url || '');
      if (!origin || !tab) return;
      state.storage.setSiteZoom(origin, tab.zoomFactor || 1, profileId);
    } catch (_) { }
  };

  handleInternal('tabs:zoom', (e, action) => {
    const ctx = getCtxFromSender(e.sender);
    const pid = getSenderProfileId(e);
    // [URLBAR-3.5/9.2] Numeric action = set an exact zoom factor (used by the
    // omnibox zoom bubble and by the per-site zoom restore on navigation).
    if (typeof action === 'number' && Number.isFinite(action)) {
      const tab = ctx?.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
      if (!tab || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed()) {
        return Math.round((tab?.zoomFactor || 1.0) * 100);
      }
      const factor = Math.max(0.3, Math.min(3.0, Math.round(action * 100) / 100));
      tab.zoomFactor = factor;
      tab.view.webContents.setZoomFactor(factor);
      const zoomPercent = Math.round(factor * 100);
      broadcastState(ctx);
      persistActiveTabZoom(ctx, pid);
      return zoomPercent;
    }
    const zoomPercent = applyZoomAction(ctx, action);
    persistActiveTabZoom(ctx, pid);
    return zoomPercent;
  });

  // [URLBAR-9.2] Per-site zoom store access for the renderer.
  handleInternal('zoom:get-site', (e, origin) =>
    state.storage.getSiteZoom(origin, getSenderProfileId(e))
  );
  handleInternal('zoom:save-site', (e, { origin, factor } = {}) => {
    const cleanFactor = Number(factor);
    if (!origin || !Number.isFinite(cleanFactor)) return null;
    return state.storage.setSiteZoom(origin, cleanFactor, getSenderProfileId(e));
  });

  // [URLBAR-3.3] Certificate of the active tab's page, when Electron exposes it.
  // Returns { available: false } when the API is absent (e.g. non-https pages) —
  // the bubble then says certificate detail is unavailable instead of faking it.
  handleInternal('site:certificate', (e) => {
    const ctx = getCtxFromSender(e.sender);
    try {
      const tab = ctx?.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
      const wc = tab?.view?.webContents;
      if (!wc || wc.isDestroyed() || typeof wc.getCertificate !== 'function') {
        return { available: false };
      }
      const cert = wc.getCertificate();
      if (!cert) return { available: false };
      return {
        available: true,
        subjectName: cert.subjectName || '',
        issuerName: cert.issuerName || '',
        validStart: cert.validStart || 0,
        validExpiry: cert.validExpiry || 0,
        fingerprint: cert.fingerprint || '',
        serialNumber: cert.serialNumber || ''
      };
    } catch (_) {
      return { available: false };
    }
  });

  handleInternal('tabs:print', (e) => {
    const ctx = getCtxFromSender(e.sender);
    if (!ctx) return;
    const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    if (tab?.view && !tab.view.webContents.isDestroyed()) tab.view.webContents.print();
  });

  handleInternal('tabs:screenshot', async (e) => {
    const ctx = getCtxFromSender(e.sender);
    if (!ctx) return { ok: false };
    closePopover(ctx);
    const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    if (!tab || !tab.view || tab.view.webContents.isDestroyed()) return { ok: false };
    try {
      const image = await tab.view.webContents.capturePage();
      return await saveScreenshotPng(ctx, image.toPNG(), 'Full');
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  const destroyScreenshotView = (ctx) => {
    if (!ctx) return;
    ctx.pendingScreenshotDataUrl = '';
    const view = ctx.screenshotView;
    ctx.screenshotView = null;
    if (view) {
      try {
        if (view.webContents) {
          webContentsToWinId.delete(view.webContents.id);
        }
      } catch (_) { }
      try {
        if (ctx.win && !ctx.win.isDestroyed() && ctx.win.contentView) {
          ctx.win.contentView.removeChildView(view);
        }
      } catch (_) { }
      try {
        if (view.webContents && !view.webContents.isDestroyed()) {
          view.webContents.close();
        }
      } catch (_) { }
    }
    updateActiveViewBounds(ctx);
  };

  handleInternal('tabs:screenshot-area-start', async (e) => {
    const ctx = getCtxFromSender(e.sender);
    if (!ctx || !ctx.win || ctx.win.isDestroyed()) return { ok: false };
    closePopover(ctx);
    const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    if (!tab || !tab.view || tab.view.webContents.isDestroyed()) return { ok: false };
    const image = await tab.view.webContents.capturePage();
    ctx.pendingScreenshotDataUrl = image.toDataURL();

    let created = false;
    if (!ctx.screenshotView || !ctx.screenshotView.webContents || ctx.screenshotView.webContents.isDestroyed()) {
      ctx.screenshotView = new WebContentsView({
        webPreferences: {
          preload: PRELOAD_FILE,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      });
      registerWebContents(ctx.screenshotView.webContents, ctx.win.id);
      attachInternalNavigationGuard(ctx.screenshotView.webContents);
      ctx.screenshotView.webContents.loadFile(SCREENSHOT_FILE, {
        query: getInternalUiQuery(ctx.incognito, ctx.profileId)
      });
      ctx.win.contentView.addChildView(ctx.screenshotView);
      created = true;
    }

    updateActiveViewBounds(ctx);
    const deliverCapture = () => {
      if (!ctx.pendingScreenshotDataUrl || !ctx.screenshotView || ctx.screenshotView.webContents.isDestroyed()) return;
      try {
        ctx.screenshotView.webContents.focus();
      } catch (_) { }
      ctx.screenshotView.webContents.send('screenshot:captured', { dataUrl: ctx.pendingScreenshotDataUrl });
    };

    if (created || ctx.screenshotView.webContents.isLoading()) {
      ctx.screenshotView.webContents.once('did-finish-load', deliverCapture);
    } else {
      deliverCapture();
    }
    return { ok: true };
  });

  handleInternal('tabs:screenshot-area-finish', async (e, payload) => {
    const ctx = getCtxFromSender(e.sender);
    if (!ctx) return { ok: false };
    const dataUrl = ctx.pendingScreenshotDataUrl;
    destroyScreenshotView(ctx);
    if (!dataUrl) return { ok: false };

    const mode = typeof payload?.mode === 'string' ? payload.mode : 'save';
    const img = nativeImage.createFromDataURL(dataUrl);

    if (mode === 'visible') {
      return await saveScreenshotWithDialog(ctx, img.toPNG(), 'Visible');
    }
    if (mode === 'full') {
      const fullBuf = await captureFullPagePng(ctx, img.toPNG());
      return await saveScreenshotWithDialog(ctx, fullBuf || img.toPNG(), 'Full');
    }

    if (!payload || payload.width < 4 || payload.height < 4) return { ok: false };
    const size = img.getSize();
    const cropRect = {
      x: Math.max(0, Math.min(size.width - 1, Math.round(payload.x))),
      y: Math.max(0, Math.min(size.height - 1, Math.round(payload.y))),
      width: Math.max(1, Math.min(size.width - Math.round(payload.x), Math.round(payload.width))),
      height: Math.max(1, Math.min(size.height - Math.round(payload.y), Math.round(payload.height)))
    };
    const cropped = img.crop(cropRect);
    const pngBuffer = cropped.toPNG();
    if (mode === 'copy') {
      return await copyScreenshotPng(ctx, pngBuffer);
    }
    return await saveScreenshotWithDialog(ctx, pngBuffer, 'Snap');
  });

  handleInternal('tabs:save-pdf', async (e) => {
    const ctx = getCtxFromSender(e.sender);
    if (!ctx) return { ok: false };
    if (ctx.screenshotView || ctx.pendingScreenshotDataUrl) {
      destroyScreenshotView(ctx);
    }
    return await savePageAsPdf(ctx);
  });

  handleInternal('tabs:screenshot-area-cancel', (e) => {
    const ctx = getCtxFromSender(e.sender);
    destroyScreenshotView(ctx);
    return { ok: true };
  });

  handleInternal('tabs:reader-mode', async (e) => {
    const ctx = getCtxFromSender(e.sender);
    if (!ctx) return false;
    const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    if (!tab || !tab.view || tab.view.webContents.isDestroyed()) return false;
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
      `).catch(() => { });
    } else {
      tab.view.webContents.reload();
    }
    broadcastState(ctx);
    return tab.readerMode;
  });

  handleInternal('tabs:find', (e, { text, forward = true } = {}) => {
    const ctx = getCtxFromSender(e.sender);
    if (!ctx) return null;
    const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    if (!text) return null;
    if (!tab || tab.sleeping || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed()) {
      if (ctx?.win && !ctx.win.isDestroyed()) {
        ctx.win.webContents.send('find:result', {
          tabId: tab?.id || null,
          requestId: -1,
          activeMatchOrdinal: 0,
          matches: 0,
          finalUpdate: true
        });
      }
      return null;
    }
    // [URLBAR-9.1] A repeat search for the SAME text in the same tab (Enter /
    // up-down arrows) must continue from the current match (findNext: true);
    // with findNext: false every call restarts at match 1 and the counter
    // never advances past 1/N. A new query (or a new tab) starts fresh.
    const isRepeatSearch = tab.lastFindText === text;
    const requestId = tab.view.webContents.findInPage(text, {
      forward: Boolean(forward),
      findNext: isRepeatSearch
    });
    tab.lastFindRequestId = requestId;
    tab.lastFindText = text;
    return { requestId };
  });

  handleInternal('tabs:stop-find', (e) => {
    const ctx = getCtxFromSender(e.sender);
    if (!ctx) return;
    const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    if (tab) {
      tab.lastFindRequestId = null;
      tab.lastFindText = null;
      if (tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()) {
        tab.view.webContents.stopFindInPage('clearSelection');
      }
    }
  });

  handleInternal('window:new', (_e, opts) => {
    const incognito = Boolean(opts && typeof opts === 'object' && (opts.incognito || opts.private));
    const profileId = opts && typeof opts === 'object' && typeof opts.profileId === 'string' ? opts.profileId : null;
    const created = createBrowserWindow({ incognito, profileId });
    return {
      ok: Boolean(created?.win),
      windowId: created?.win?.id ?? null,
      incognito: Boolean(created?.incognito),
      profileId: created?.profileId || 'default'
    };
  });
  handleInternal('window:fullscreen', (e) => {
    const ctx = getCtxFromSender(e.sender);
    if (!ctx?.win) return false;
    return toggleWindowFullscreen(ctx);
  });

  // [Wave2-D] Delete browsing data (gap 5.11): time range + full data-type
  // checklist. The range applies to history (storage.clearHistory); cookies
  // and cache have no time-range API in Electron so they are always cleared
  // for all time — the UI says so.
  // Market audit bug #36: the Cleaner drawer was one short card over a
  // large empty space. The drawer now shows the live cache size, which
  // needs a real reading from the profile session.
  handleInternal('cleaner:get-cache-size', async (e) => {
    const ctx = getCtxFromSender(e.sender);
    const pid = ctx?.profileId || state.storage.getActiveProfileId();
    const targetSession =
      ctx && ctx.session ? ctx.session : getSessionForProfile(pid) || session.defaultSession;
    try {
      const bytes = await targetSession.getCacheSize();
      return { bytes: Number(bytes) || 0 };
    } catch (_) {
      return { bytes: 0 };
    }
  });

  handleInternal('cleaner:run', async (e, { cache = true, cookies = false, history = false, range = 'all', downloads = false, passwords = false, autofill = false, siteSettings = false } = {}) => {
    const ctx = getCtxFromSender(e.sender);
    const isIncognito = Boolean(ctx?.incognito);
    const pid = ctx?.profileId || state.storage.getActiveProfileId();
    const targetSession =
      ctx && ctx.session ? ctx.session : getSessionForProfile(pid) || session.defaultSession;
    const cleared = {};
    if (cache) {
      await targetSession.clearCache();
      cleared.cache = true;
    }
    if (cookies) {
      await targetSession.clearStorageData({ storages: ['cookies', 'localstorage'] });
      await targetSession.cookies.flushStore().catch(() => { });
      if (!isIncognito) {
        try {
          const { clearDevicePrefsCache } = require('./permissions');
          if (typeof clearDevicePrefsCache === 'function') clearDevicePrefsCache(pid);
        } catch (_) { }
        broadcastCookiesUpdate({ immediate: true, profileId: pid });
      }
      cleared.cookies = true;
    }
    if (!isIncognito) {
      if (history) {
        state.storage.clearHistory(range || 'all', pid);
        broadcastHistoryUpdate({ profileId: pid });
        cleared.history = range || 'all';
      }
      if (downloads) {
        state.storage.clearDownloads(pid);
        broadcastDownloadsUpdate(state.storage.getDownloads(pid), { profileId: pid });
        cleared.downloads = true;
      }
      if (passwords) {
        state.storage.clearPasswords(pid);
        broadcastPasswordsUpdate({ profileId: pid });
        cleared.passwords = true;
      }
      if (autofill) {
        state.storage.clearAddresses(pid);
        state.storage.clearPaymentMethods(pid);
        cleared.autofill = true;
      }
      if (siteSettings) {
        state.storage.clearAllSitePermissions(pid);
        broadcastPermissionsUpdate({ profileId: pid });
        cleared.siteSettings = true;
      }
    }
    return { cleanedAt: Date.now(), cleared };
  });

  // Market-readiness audit (2026-11-24, bug #2): shell-DOM modals (e.g. New
  // Profile) are covered by every WebContentsView; main hides the content
  // views while one is open so the modal is visible and focusable.
  handleInternal('shell:set-modal-open', (e, open) => {
    const ctx = getCtxFromSender(e.sender);
    if (!ctx) return { ok: false };
    return { ok: setShellModalOpen(ctx, Boolean(open)) };
  });

  // Market audit bug #30: the rail context menu lives in the popover view,
  // but the Customize Dock drawer is shell DOM — relay the request to the
  // shell, which calls openLeftTool() itself.
  handleInternal('shell:open-left-tool', (e, tool) => {
    const ctx = getCtxFromSender(e.sender);
    if (!ctx || !ctx.win || ctx.win.isDestroyed()) return { ok: false };
    ctx.win.webContents.send('shell:open-left-tool', String(tool || ''));
    return { ok: true };
  });

  handleInternal('popover:open', (e, opts) => openPopover(getCtxFromSender(e.sender), opts || {}));
  handleInternal('popover:resize', (e, opts) => resizePopover(getCtxFromSender(e.sender), opts || {}));
  handleInternal('popover:close', (e, opts) => closePopover(getCtxFromSender(e.sender), opts || {}));

  handleInternal('menu:action', (e, action) => {
    const ctx = getCtxFromSender(e.sender);
    if (
      typeof action === 'string' &&
      (action.startsWith('extension-pin:') || action.startsWith('extension-unpin:'))
    ) {
      const isPin = action.startsWith('extension-pin:');
      const extId = action.slice(isPin ? 'extension-pin:'.length : 'extension-unpin:'.length).trim();
      const pinnedExtensions = setExtensionPinned(extId, isPin);
      for (const c of windowContexts.values()) {
        if (
          c &&
          c.popoverOpenKind === 'extensions-dropdown' &&
          c.popoverView &&
          c.popoverView.webContents &&
          !c.popoverView.webContents.isDestroyed()
        ) {
          const extData = getExtensionsDropdownData();
          const rows = Array.isArray(extData?.rows) ? extData.rows : [];
          c.popoverPayload = {
            kind: 'extensions-dropdown',
            payload: { rows, extensions: rows }
          };
          c.popoverView.webContents.send('popover:data', c.popoverPayload);
        }
      }
      return { ok: true, pinnedExtensions };
    }

    if (typeof action === 'string' && action.startsWith('extension-popup:')) {
      const extId = action.slice('extension-popup:'.length).trim();
      const wasSamePopupOpen = Boolean(ctx && ctx.extensionPopupView && ctx.extensionPopupId === extId);
      let anchor = null;
      if (ctx && ctx.popoverOpenKind === 'extensions-dropdown' && ctx.popoverView) {
        try {
          const b = ctx.popoverView.getBounds();
          if (b && b.x >= 0 && b.width > 0) {
            anchor = { x: b.x, y: b.y, width: b.width, right: b.x + b.width };
          }
        } catch (_) { }
      }
      closePopover(ctx);
      if (wasSamePopupOpen) {
        return { ok: true, id: extId, toggledClosed: true };
      }
      if (ctx?.incognito) {
        ctx.win?.webContents.send('ui:toast', 'Extensions do not run in Private windows');
        return { ok: false, reason: 'incognito' };
      }
      return openExtensionPopup(ctx, extId, anchor);
    }

    closePopover(ctx);
    if (!ctx) return { ok: false };
    if (action === 'new-tab') createTab(ctx, { url: 'nextgx://newtab', active: true });
    else if (action === 'new-window') createBrowserWindow({ incognito: false, profileId: ctx.profileId });
    else if (action === 'new-incognito') createBrowserWindow({ incognito: true });
    else if (action === 'passwords') createTab(ctx, { url: 'nextgx://passwords', active: true });
    else if (action === 'privacy') createTab(ctx, { url: 'nextgx://privacy', active: true });
    else if (action === 'history') createTab(ctx, { url: 'nextgx://history', active: true });
    else if (action === 'downloads') createTab(ctx, { url: 'nextgx://downloads', active: true });
    else if (action === 'bookmarks') createTab(ctx, { url: 'nextgx://bookmarks', active: true });
    else if (action === 'bookmark-current') {
      const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
      if (tab) {
        const pid = ctx.profileId || state.storage.getActiveProfileId();
        const result = state.storage.toggleBookmark(
          {
            title: tab.title,
            url: formatDisplayUrl(tab.url),
            favicon: tab.favicon || ''
          },
          pid
        );
        broadcastBookmarksUpdate(result.bookmarks, { profileId: pid });
        for (const c of windowContexts.values()) {
          if ((c.profileId || 'default') === pid) broadcastState(c);
        }
        ctx.win?.webContents.send('ui:toast', result.added ? 'Saved to Bookmarks' : 'Removed from Bookmarks');
      }
    } else if (action === 'extensions') createTab(ctx, { url: 'nextgx://extensions', active: true });
    else if (action === 'print') {
      const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
      if (tab?.view && !tab.view.webContents.isDestroyed()) tab.view.webContents.print();
    } else if (action === 'find') {
      if (ctx.win && !ctx.win.isDestroyed() && ctx.win.webContents && !ctx.win.webContents.isDestroyed()) {
        try {
          ctx.win.webContents.focus();
        } catch (_) { }
        ctx.win.webContents.send('shortcut:action', 'open-find');
      }
    } else if (action === 'devtools') toggleActiveTabDevTools(ctx);
    else if (action === 'settings') createTab(ctx, { url: 'nextgx://settings', active: true });
    else if (action === 'exit') ctx.win?.close();
  });

  handleInternal('permissions:get', (e, origin) => state.storage.getSitePermissions(origin, getSenderProfileId(e)));
  handleInternal('permissions:set', (e, { origin, key, value } = {}) => {
    const pid = getSenderProfileId(e);
    const updated = state.storage.setSitePermission(origin, key, value, pid);
    broadcastPermissionsUpdate({ profileId: pid });
    return updated;
  });
  handleInternal('permissions:prompt-respond', (e, payload) => {
    const ctx = getCtxFromSender(e.sender);
    const res = resolvePermissionPrompt(ctx, payload || {});
    if (res?.ok && !ctx?.incognito) {
      broadcastPermissionsUpdate({ profileId: getSenderProfileId(e) });
    }
    return res;
  });
  handleInternal('contextmenu:chrome-target', (e, target) => {
    const ctx = getCtxFromSender(e.sender);
    if (ctx) {
      ctx._lastChromeContextTarget = typeof target === 'string' ? target : null;
    }
    return true;
  });

  handleInternal('layout:set-offsets', (e, partial) => {
    const ctx = getCtxFromSender(e.sender);
    if (!ctx) return null;
    const prevRight = ctx.layoutState?.right || 0;
    if (partial && typeof partial.gxControlOpen === 'boolean') {
      ctx.gxControlOpen = partial.gxControlOpen;
    }
    ctx.layoutState = { ...ctx.layoutState, ...(partial || {}) };
    updateActiveViewBounds(ctx);
    if (ctx.sidebarPanel?.open && (ctx.layoutState.right || 0) !== prevRight) {
      syncSidebarFrameViewState(ctx);
    }
    return ctx.layoutState;
  });

  // Sidebar Overlay Panel (GX Left Rail)
  handleInternal('sidebar:toggle', (e, keyOrOpts) => toggleSidebarPanel(getCtxFromSender(e.sender), keyOrOpts));
  handleInternal('sidebar:open', (e, keyOrOpts) => openSidebarPanel(getCtxFromSender(e.sender), keyOrOpts));
  handleInternal('sidebar:close', (e, opts) => closeSidebarPanel(getCtxFromSender(e.sender), opts || {}));
  handleInternal('sidebar:set-pinned', (e, pinned) => setSidebarPinned(getCtxFromSender(e.sender), pinned));
  handleInternal('sidebar:reload', (e) => reloadSidebarPanel(getCtxFromSender(e.sender)));
  handleInternal('sidebar:open-in-new-tab', (e) => openSidebarPanelInNewTab(getCtxFromSender(e.sender)));
  handleInternal('sidebar:set-width', (e, arg1, arg2) => {
    const ctx = getCtxFromSender(e.sender);
    const width = typeof arg1 === 'object' && arg1 !== null ? arg1.width : arg1;
    const opts = typeof arg1 === 'object' && arg1 !== null ? arg1 : arg2;
    return setSidebarWidth(ctx, width, opts);
  });
  // [Fix2 A5] Explicit drag signals. The renderer calls resize-start on
  // pointerdown on the resizer and resize-end on release, so the unpinned
  // panel cannot auto-close mid-drag. setSidebarWidth also maintains the
  // guard, so this is belt-and-braces, not the only mechanism.
  handleInternal('sidebar:resize-start', (e) => setSidebarResizing(getCtxFromSender(e.sender), true));
  handleInternal('sidebar:resize-end', (e) => setSidebarResizing(getCtxFromSender(e.sender), false));
  handleInternal('sidebar:get-state', (e) => serializeSidebarState(getCtxFromSender(e.sender)));

  // Bookmarks, History, Downloads, Passwords, Notes, Extensions, Settings, Profiles, Import/Export
  handleInternal('bookmarks:get', (e) => state.storage.getBookmarks(getSenderProfileId(e)));
  handleInternal('bookmarks:toggle', (e) => {
    const ctx = getCtxFromSender(e.sender);
    const pid = ctx?.profileId || state.storage.getActiveProfileId();
    if (!ctx) return { added: false, bookmarks: state.storage.getBookmarks(pid) };
    const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    if (!tab) return { added: false, bookmarks: state.storage.getBookmarks(pid) };
    const result = state.storage.toggleBookmark(
      {
        title: tab.title,
        url: formatDisplayUrl(tab.url),
        favicon: tab.favicon || ''
      },
      pid
    );
    broadcastBookmarksUpdate(result.bookmarks, { profileId: pid });
    for (const c of windowContexts.values()) {
      if ((c.profileId || 'default') === pid) broadcastState(c);
    }
    return result;
  });
  handleInternal('bookmarks:add', (e, entry) => {
    const pid = getSenderProfileId(e);
    const result = state.storage.addBookmark(entry || {}, pid);
    if (result.ok) {
      broadcastBookmarksUpdate(result.bookmarks, { profileId: pid });
      for (const ctx of windowContexts.values()) {
        if ((ctx.profileId || 'default') === pid) broadcastState(ctx);
      }
    }
    return result;
  });
  handleInternal('bookmarks:update', (e, entry) => {
    const pid = getSenderProfileId(e);
    const payload = entry && typeof entry === 'object' ? entry : {};
    const result = state.storage.updateBookmark(payload.id, payload, pid);
    if (result.ok) {
      broadcastBookmarksUpdate(result.bookmarks, { profileId: pid });
      for (const ctx of windowContexts.values()) {
        if ((ctx.profileId || 'default') === pid) broadcastState(ctx);
      }
    }
    return result;
  });
  handleInternal('bookmarks:rename-folder', (e, payload) => {
    const pid = getSenderProfileId(e);
    const { oldName, newName } = payload && typeof payload === 'object' ? payload : {};
    const result = state.storage.renameBookmarkFolder(oldName, newName, pid);
    if (result.ok) {
      broadcastBookmarksUpdate(result.bookmarks, { profileId: pid });
    }
    return result;
  });
  handleInternal('bookmarks:remove', (e, id) => {
    const pid = getSenderProfileId(e);
    const list = state.storage.removeBookmark(id, pid);
    broadcastBookmarksUpdate(list, { profileId: pid });
    for (const ctx of windowContexts.values()) {
      if ((ctx.profileId || 'default') === pid) broadcastState(ctx);
    }
    return list;
  });

  handleInternal('history:get', (e) => state.storage.getHistory(getSenderProfileId(e)));
  // Live search suggestions for the Opera GX expanded omnibox (skipped in Private windows; cached 2m)
  const remoteSuggestCache = new Map();
  handleInternal('omnibox:remote-suggest', async (e, rawQuery) => {
    const ctx = getCtxFromSender(e.sender);
    if (ctx && ctx.incognito) return [];
    const pid = getSenderProfileId(e);
    const settings = state.storage ? state.storage.getSettings(pid) : {};
    if (settings && settings.addressBarSuggestions === false) return [];
    const q = typeof rawQuery === 'string' ? rawQuery.trim() : '';
    if (
      !q ||
      q.length < 2 ||
      q.length > 96 ||
      /^https?:\/\//i.test(q) ||
      /^(?:nextgx|chrome|gx|about|file|data|blob|javascript):/i.test(q) ||
      /^(?:localhost|127\.|10\.|192\.168\.|\[::1\])/i.test(q)
    ) {
      return [];
    }
    const key = q.toLowerCase();
    const cached = remoteSuggestCache.get(key);
    if (cached && Date.now() - cached.at < 120000) return cached.items;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 700);
    try {
      const resp = await fetch(
        `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(q)}`,
        { signal: ctrl.signal, headers: { Accept: 'application/json' } }
      );
      if (!resp.ok) return [];
      const json = await resp.json();
      const rawList = Array.isArray(json) && Array.isArray(json[1]) ? json[1] : [];
      const items = rawList
        .filter((s) => typeof s === 'string' && s.trim() && s.trim().toLowerCase() !== key)
        .slice(0, 4)
        .map((s) => s.trim());
      if (remoteSuggestCache.size >= 120) remoteSuggestCache.clear();
      remoteSuggestCache.set(key, { at: Date.now(), items });
      return items;
    } catch (_) {
      return [];
    } finally {
      clearTimeout(timer);
    }
  });
  handleInternal('history:clear', (e, range) => {
    const pid = getSenderProfileId(e);
    const res = state.storage.clearHistory(range || 'all', pid);
    broadcastHistoryUpdate({ profileId: pid });
    return res;
  });
  handleInternal('history:remove', (e, id) => {
    const pid = getSenderProfileId(e);
    const res = state.storage.removeHistoryItem(id, pid);
    broadcastHistoryUpdate({ profileId: pid });
    return res;
  });
  handleInternal('history:closed-get', (e) => state.storage.getClosedTabs(getSenderProfileId(e)));
  handleInternal('history:closed-clear', (e) => {
    const pid = getSenderProfileId(e);
    const res = state.storage.clearClosedTabs(pid);
    broadcastHistoryUpdate({ profileId: pid });
    return res;
  });
  handleInternal('history:closed-remove', (e, id) => {
    const pid = getSenderProfileId(e);
    const res = state.storage.removeClosedTab(id, pid);
    broadcastHistoryUpdate({ profileId: pid });
    return res;
  });

  registerCookieIpcHandlers(handleInternal);
  registerDownloadIpcHandlers(handleInternal);
  registerPlayerIpcHandlers(handleInternal);
  registerGxCornerIpcHandlers(handleInternal);
  registerProfileIpcHandlers(handleInternal);
  registerImportExportIpcHandlers(handleInternal);
  registerPrivacyAndPasswordIpcHandlers(handleInternal, { getSenderProfileId });
  registerSplitIpcHandlers(handleInternal);
  registerShellDrawerIpcHandlers();

  // Passkeys (software authenticator) — worker C, gaps 4.1-4.3. The ceremony
  // channel is deliberately NOT internal-UI gated (web pages call it); the
  // handler itself enforces top-frame + origin + secure-context + rp.id.
  registerPasskeyIpcHandlers({
    handleInternal,
    handleWeb: (channel, handler) => ipcMain.handle(channel, handler),
    getSenderProfileId,
    getCtxFromSender,
    getStorage: () => state.storage
  });

  handleInternal('passwords:get', (e) => state.storage.getPasswords(getSenderProfileId(e)));
  handleInternal('passwords:encryption-status', () => ({
    available: Boolean(state.storage?.isPasswordEncryptionAvailable?.())
  }));
  handleInternal('passwords:add', (e, entry) => {
    const pid = getSenderProfileId(e);
    const result = state.storage.addPassword(entry, pid);
    if (!result || result.ok !== false) {
      broadcastPasswordsUpdate({ profileId: pid });
    }
    return result;
  });
  handleInternal('passwords:remove', (e, id) => {
    const pid = getSenderProfileId(e);
    const list = state.storage.removePassword(id, pid);
    broadcastPasswordsUpdate({ profileId: pid });
    return list;
  });
  handleInternal('notes:get', (e) => state.storage.getNotes(getSenderProfileId(e)));
  handleInternal('notes:save', (e, text) => state.storage.saveNote(text, getSenderProfileId(e)));

  registerExtensionIpcHandlers(handleInternal);

  const buildAdblockSiteInfo = (origin, profileId) => {
    const site = state.storage.getAdblockSite(origin, profileId);
    return {
      origin: site.origin,
      enabled: site.enabled,
      hasOverride: site.hasOverride,
      allowlisted: Boolean(site.hasOverride && site.enabled === false),
      globalEnabled: state.adBlocker.isEnabled(),
      trackerBlockEnabled: state.adBlocker.isTrackersEnabled(),
      blockedCount: state.adBlocker.getSiteBlockedCount(site.origin)
    };
  };

  handleInternal('adblock:stats', () => state.adBlocker.getStats());
  handleInternal('adblock:toggle', async (e, enabled) => {
    state.storage.updateSettings({ adblockEnabled: Boolean(enabled) }, getSenderProfileId(e));
    await syncAdblockCosmeticFilters();
    const stats = state.adBlocker.getStats();
    broadcastAdblockUpdate(stats);
    for (const ctx of windowContexts.values()) {
      broadcastState(ctx);
    }
    return stats;
  });
  handleInternal('adblock:toggle-trackers', (e, enabled) => {
    state.storage.updateSettings({ trackerBlockEnabled: Boolean(enabled) }, getSenderProfileId(e));
    const stats = state.adBlocker.getStats();
    broadcastAdblockUpdate(stats);
    for (const ctx of windowContexts.values()) {
      broadcastState(ctx);
    }
    return stats;
  });
  handleInternal('adblock:get-site', (e, origin) => buildAdblockSiteInfo(origin, getSenderProfileId(e)));
  handleInternal('adblock:set-site', async (e, arg1, arg2) => {
    const pid = getSenderProfileId(e);
    const origin =
      typeof arg1 === 'object' && arg1 !== null ? arg1.origin : arg1;
    const enabled =
      typeof arg1 === 'object' && arg1 !== null ? arg1.enabled : arg2;
    const updated = state.storage.setAdblockSite(origin, Boolean(enabled), pid);
    if (updated.origin) {
      await syncAdblockCosmeticFilters(updated.origin);
    }
    const stats = state.adBlocker.getStats();
    broadcastAdblockUpdate(stats);
    for (const ctx of windowContexts.values()) {
      broadcastState(ctx);
    }
    return buildAdblockSiteInfo(updated.origin, pid);
  });
  handleInternal('adblock:get-sites', (e) => state.storage.getAdblockSites(getSenderProfileId(e)));
  handleInternal('settings:get', (e) => state.storage.getSettings(getSenderProfileId(e)));
  handleInternal('settings:update', async (e, partial) => {
    const pid = getSenderProfileId(e);
    const prev = state.storage.getSettings(pid);
    const s = state.storage.updateSettings(partial || {}, pid);
    // [Wave2-D] Apply stored settings that drive live browser behaviour.
    const changedKeys = Object.keys(partial || {});
    if (changedKeys.includes('spellcheckEnabled') || changedKeys.includes('preferredLanguages')) {
      applySpellcheckSettings(s);
    }
    if (changedKeys.includes('thirdPartyCookies')) {
      applyThirdPartyCookieMode(s.thirdPartyCookies);
    }
    if (changedKeys.includes('downloadPath')) {
      applyDownloadPathSetting(s);
    }
    if (changedKeys.includes('runOnStartup')) {
      try {
        if (typeof app.setLoginItemSettings === 'function') {
          app.setLoginItemSettings({ openAtLogin: Boolean(s.runOnStartup) });
        }
      } catch (_) { }
    }
    if (changedKeys.includes('dnsOverHttps')) {
      try {
        if (typeof app.configureHostResolver === 'function') {
          Promise.resolve(app.configureHostResolver({ secureDnsMode: s.dnsOverHttps ? 'automatic' : 'off' })).catch(
            () => { }
          );
        }
      } catch (_) { }
    }
    if (changedKeys.includes('webrtcPolicy')) {
      try {
        for (const wc of getAllTabWebContents()) {
          if (typeof wc.setWebRTCIPHandlingPolicy === 'function') {
            wc.setWebRTCIPHandlingPolicy(s.webrtcPolicy || 'default');
          }
        }
      } catch (_) { }
    }
    const prevWallpaperFile = prev.wallpaper?.file || '';
    const nextWallpaperFile = s.wallpaper?.file || '';
    const wallpaperFileChanged =
      Boolean(prevWallpaperFile) &&
      (process.platform === 'win32'
        ? prevWallpaperFile.toLowerCase() !== nextWallpaperFile.toLowerCase()
        : prevWallpaperFile !== nextWallpaperFile);
    if (wallpaperFileChanged) {
      deleteWallpaperFileBestEffort(prevWallpaperFile, 'previous');
    }
    const adblockChanged = Boolean(prev.adblockEnabled) !== Boolean(s.adblockEnabled);
    const trackerChanged = Boolean(prev.trackerBlockEnabled) !== Boolean(s.trackerBlockEnabled);
    if (adblockChanged) {
      await syncAdblockCosmeticFilters();
    }
    if (adblockChanged || trackerChanged) {
      broadcastAdblockUpdate(state.adBlocker.getStats());
    }
    const gxControlChanged =
      Boolean(prev.gxRamLimiterEnabled) !== Boolean(s.gxRamLimiterEnabled) ||
      Number(prev.gxRamLimitMB) !== Number(s.gxRamLimitMB) ||
      Boolean(prev.gxCpuLimiterEnabled) !== Boolean(s.gxCpuLimiterEnabled) ||
      Number(prev.gxCpuLimitPercent) !== Number(s.gxCpuLimitPercent) ||
      Boolean(prev.gxNetLimiterEnabled) !== Boolean(s.gxNetLimiterEnabled) ||
      Number(prev.gxNetLimitMbps) !== Number(s.gxNetLimitMbps);
    if (gxControlChanged) {
      await gxControl.onSettingsChanged(s, { sleepTab });
      broadcastSystemStatsNow();
    }
    broadcastSettingsUpdate(s, { profileId: pid });
    const panelSettingsChanged =
      Object.prototype.hasOwnProperty.call(partial || {}, 'sidebarPanelWidth') ||
      Object.prototype.hasOwnProperty.call(partial || {}, 'sidebarPanelPinned');
    for (const ctx of windowContexts.values()) {
      if (panelSettingsChanged && ctx.sidebarPanel && (ctx.profileId || 'default') === pid) {
        ctx.sidebarPanel.width = clampSidebarWidth(s.sidebarPanelWidth);
        ctx.sidebarPanel.pinned = Boolean(s.sidebarPanelPinned);
        if (ctx.sidebarPanel.open) {
          syncSidebarLayoutLeft(ctx);
        }
        updateActiveViewBounds(ctx);
        broadcastSidebarState(ctx);
      } else {
        broadcastState(ctx);
      }
    }
    return s;
  });

  handleInternal('newtab:get-data', (e) => {
    const pid = getSenderProfileId(e);
    const s = state.storage.getSettings(pid);
    return {
      speedDial: state.storage.getSpeedDial(pid),
      settings: s,
      wallpaperDataUrl: getCustomWallpaperDataUrl(s.wallpaper?.file),
      adblock: state.adBlocker.getStats(),
      system: collectSystemStats(),
      notes: state.storage.getNotes(pid)
    };
  });
  handleInternal('newtab:add-dial', (e, item) => state.storage.addSpeedDial(item, getSenderProfileId(e)));
  handleInternal('newtab:update-dial', (e, payload) => state.storage.updateSpeedDial(payload?.id, payload || {}, getSenderProfileId(e)));
  handleInternal('newtab:remove-dial', (e, id) => state.storage.removeSpeedDial(id, getSenderProfileId(e)));
  handleInternal('newtab:save-wallpaper', (_e, payload) => saveCustomWallpaperPayload(payload));
  handleInternal('newtab:remove-wallpaper', () => removeCustomWallpaperFile());
  handleInternal('newtab:get-wallpaper-image', (e) => {
    const s = state.storage.getSettings(getSenderProfileId(e));
    return getCustomWallpaperDataUrl(s.wallpaper?.file);
  });
  handleInternal('system:stats', () => collectSystemStats());
  handleInternal('gxcontrol:get-state', () => collectSystemStats().gxControl);

  handleInternal('window:minimize', (e) => getCtxFromSender(e.sender)?.win?.minimize());
  handleInternal('window:maximize', (e) => {
    const win = getCtxFromSender(e.sender)?.win;
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  handleInternal('window:is-maximized', (e) => {
    const win = getCtxFromSender(e.sender)?.win;
    return Boolean(win && !win.isDestroyed() && win.isMaximized());
  });
  handleInternal('window:close', (e) => getCtxFromSender(e.sender)?.win?.close());

  // [Wave2-D] Autofill management (gaps 6.2/6.3): addresses + payment methods.
  // Internal-UI only; the settings page manages entries here. The page fill
  // engine itself (tab-preload) is a later round and will read the same
  // storage via its own channels.
  handleInternal('autofill:get-addresses', (e) => state.storage.getAddresses(getSenderProfileId(e)));
  handleInternal('autofill:add-address', (e, entry) =>
    state.storage.addAddress(entry || {}, getSenderProfileId(e))
  );
  handleInternal('autofill:update-address', (e, payload) =>
    state.storage.updateAddress(payload?.id, payload || {}, getSenderProfileId(e))
  );
  handleInternal('autofill:remove-address', (e, id) => state.storage.removeAddress(id, getSenderProfileId(e)));
  handleInternal('autofill:get-payment-methods', (e) =>
    state.storage.getPaymentMethods(getSenderProfileId(e))
  );
  handleInternal('autofill:add-payment-method', (e, entry) =>
    state.storage.addPaymentMethod(entry || {}, getSenderProfileId(e))
  );
  handleInternal('autofill:update-payment-method', (e, payload) =>
    state.storage.updatePaymentMethod(payload?.id, payload || {}, getSenderProfileId(e))
  );
  handleInternal('autofill:remove-payment-method', (e, id) =>
    state.storage.removePaymentMethod(id, getSenderProfileId(e))
  );

  // [Wave2-D] Downloads settings (gap 5.5): native folder picker for the
  // download location. The chosen path is stored via settings:update (which
  // also applies it with session.setDownloadPath).
  handleInternal('downloads:choose-location', async (e) => {
    const win = getCtxFromSender(e.sender)?.win;
    try {
      const res = await dialog.showOpenDialog(win || undefined, {
        title: 'Choose download location',
        properties: ['openDirectory', 'createDirectory']
      });
      if (res.canceled || !res.filePaths || !res.filePaths[0]) return { canceled: true };
      return { canceled: false, path: res.filePaths[0] };
    } catch (err) {
      return { canceled: false, ok: false, error: err?.message || String(err) };
    }
  });

  // [Wave2-D] Reset settings (gap 5.14) + About (gap 5.14) + Default browser.
  handleInternal('settings:reset', async (e) => {
    const ctx = getCtxFromSender(e.sender);
    const pid = getSenderProfileId(e);
    const s = state.storage.resetSettings(pid);
    applySpellcheckSettings(s);
    applyThirdPartyCookieMode(s.thirdPartyCookies);
    applyDownloadPathSetting(s);
    try {
      await gxControl.onSettingsChanged(s, { sleepTab });
    } catch (_) { }
    try {
      await syncAdblockCosmeticFilters();
      if (state.adBlocker) broadcastAdblockUpdate(state.adBlocker.getStats());
    } catch (_) { }
    broadcastSettingsUpdate(s, { profileId: pid });
    if (ctx) broadcastState(ctx);
    return s;
  });
  handleInternal('app:version', () => ({
    app: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform
  }));
  handleInternal('app:set-default-browser', () => {
    try {
      const args = !app.isPackaged && process.argv[1] ? [path.resolve(process.argv[1])] : undefined;
      const http = args
        ? app.setAsDefaultProtocolClient('http', process.execPath, args)
        : app.setAsDefaultProtocolClient('http');
      const https = args
        ? app.setAsDefaultProtocolClient('https', process.execPath, args)
        : app.setAsDefaultProtocolClient('https');
      if (process.platform === 'win32' && shell && typeof shell.openExternal === 'function') {
        shell.openExternal('ms-settings:defaultapps').catch(() => { });
      }
      return { ok: Boolean(http && https), http: Boolean(http), https: Boolean(https), openedSystemSettings: process.platform === 'win32' };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });
  handleInternal('system:open-proxy-settings', () => {
    try {
      if (process.platform === 'win32' && shell && typeof shell.openExternal === 'function') {
        shell.openExternal('ms-settings:network-proxy').catch(() => { });
        return { ok: true };
      }
      return { ok: false, error: 'Open your OS network proxy settings manually on this platform.' };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });
  handleInternal('system:open-onboarding', (e) => {
    const ctx = getCtxFromSender(e.sender);
    if (!ctx) return { ok: false };
    createTab(ctx, { url: 'nextgx://welcome', incognito: false, active: true });
    return { ok: true };
  });

  // Auto-Updater (GitHub Releases + SHA256 verification)
  const updater = require('./updater');
  handleInternal('updater:get-state', () => updater.getUpdaterState());
  handleInternal('updater:check', (_e, opts) => updater.checkForUpdates({ manual: Boolean(opts?.manual) }));
  handleInternal('updater:download', () => updater.downloadUpdate());
  handleInternal('updater:install', (_e, opts) => updater.installDownloadedUpdate({ relaunch: opts?.relaunch !== false }));
  handleInternal('updater:online', () => {
    updater.notifyNetworkOnline();
    return { ok: true };
  });

  // [Wave2-D] Apply stored spellcheck / third-party-cookie / download-path
  // settings to the live sessions at startup (settings:update re-applies
  // them whenever they change).
  try {
    const bootSettings = state.storage.getSettings();
    applySpellcheckSettings(bootSettings);
    applyThirdPartyCookieMode(bootSettings.thirdPartyCookies);
    applyDownloadPathSetting(bootSettings);
  } catch (_) { }
}

module.exports = {
  registerIpcHandlers,
  applySessionPrivacyAndPrefs,
  getCtxFromSender,
  sendToWebUiTabs,
  notifyActiveWebUiTabShown,
  broadcastAdblockUpdate,
  broadcastHistoryUpdate,
  broadcastPasswordsUpdate,
  broadcastPermissionsUpdate,
  broadcastDownloadsUpdate,
  broadcastSettingsUpdate,
  broadcastBookmarksUpdate,
  getAllTabWebContents,
  syncAdblockCosmeticFilters
};
