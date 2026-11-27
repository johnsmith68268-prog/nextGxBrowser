const { WebContentsView } = require('electron');
const {
  PRELOAD_FILE,
  TAB_PRELOAD_FILE,
  SIDEBAR_PANEL_CHROME_FILE,
  PLAYER_PANEL_FILE,
  PLAYER_PANEL_FILE_URL,
  SIDEBAR_ICON_WIDTH,
  SIDEBAR_PANEL_DEFAULT_WIDTH,
  SIDEBAR_PANEL_MIN_WIDTH,
  SIDEBAR_PANEL_MAX_WIDTH,
  windowContexts,
  webContentsToWinId,
  registerWebContents,
  state
} = require('./core');
const playerMod = () => require('./player');
const {
  resolveInternalUiFile,
  isNewTabUrl,
  isWebUiUrl,
  isErrorPageUrl,
  getInternalUiQuery
} = require('./utils');
const {
  getFailedUrlFromErrorPage,
  buildErrorPageUrl
} = require('./navigation');
const { broadcastState, broadcastSettingsUpdate } = require('./broadcast');
const {
  getMaxEffectiveSidebarPanelWidth,
  getEffectiveSidebarPanelWidth,
  updateActiveViewBounds
} = require('./layout');
const { attachKeyboardShortcuts } = require('./shortcuts');
const { attachWebContentsContextMenu } = require('./context-menu');
const { restoreFocusToActiveTab, closePopover } = require('./popovers');
const { createTab } = require('./tabs');

const SIDEBAR_AUDIO_HOLD_MS = 3000;
const SIDEBAR_OPEN_GRACE_MS = 120;
// [Fix2 A5] Resize guard: while a drag is in progress (or just ended) the
// unpinned panel must NOT auto-close. The drag signals main on every move
// via sidebar:set-width, and a tab-view focus event during the drag used
// to close the panel mid-drag (the 120 ms open-grace only covers the
// first moments after opening). 800 ms after the last resize signal the
// guard lifts and normal outside-click/focus closing resumes.
const SIDEBAR_RESIZE_GUARD_MS = 800;
// [Fix2 Discord] A sidebar service that never finishes loading (blocked
// network, proxy, captive portal) used to sit on a blank panel forever
// with no state at all. After this long with isLoading still true the
// panel reports a timeout error instead, so the UI can show retry UI.
const SIDEBAR_LOAD_TIMEOUT_MS = 25000;

const SIDEBAR_SERVICES = {
  youtube: { key: 'youtube', title: 'YouTube', url: 'https://www.youtube.com' },
  youtubeMusic: { key: 'youtubeMusic', title: 'YouTube Music', url: 'https://music.youtube.com' },
  spotify: { key: 'spotify', title: 'Spotify', url: 'https://open.spotify.com' },
  appleMusic: { key: 'appleMusic', title: 'Apple Music', url: 'https://music.apple.com' },
  soundcloud: { key: 'soundcloud', title: 'SoundCloud', url: 'https://soundcloud.com' },
  deezer: { key: 'deezer', title: 'Deezer', url: 'https://www.deezer.com' },
  tidal: { key: 'tidal', title: 'Tidal', url: 'https://listen.tidal.com' },
  twitch: { key: 'twitch', title: 'Twitch', url: 'https://www.twitch.tv' },
  chatgpt: { key: 'chatgpt', title: 'ChatGPT', url: 'https://chatgpt.com' },
  claude: { key: 'claude', title: 'Claude', url: 'https://claude.ai' },
  gemini: { key: 'gemini', title: 'Gemini', url: 'https://gemini.google.com' },
  perplexity: { key: 'perplexity', title: 'Perplexity', url: 'https://www.perplexity.ai' },
  whatsapp: { key: 'whatsapp', title: 'WhatsApp', url: 'https://web.whatsapp.com' },
  discord: { key: 'discord', title: 'Discord', url: 'https://discord.com/app' },
  player: { key: 'player', title: 'Player', url: PLAYER_PANEL_FILE_URL, internal: true }
};

function clampSidebarWidth(rawWidth) {
  const num = Number(rawWidth);
  if (!Number.isFinite(num)) return SIDEBAR_PANEL_DEFAULT_WIDTH;
  return Math.max(SIDEBAR_PANEL_MIN_WIDTH, Math.min(SIDEBAR_PANEL_MAX_WIDTH, Math.round(num)));
}

function clearSidebarAudioHoldTimer(meta) {
  if (meta && meta._audioHoldTimer) {
    clearTimeout(meta._audioHoldTimer);
    meta._audioHoldTimer = null;
  }
}

function clearSidebarLoadTimer(meta) {
  if (meta && meta._loadTimer) {
    clearTimeout(meta._loadTimer);
    meta._loadTimer = null;
  }
}

function setSidebarLoadError(meta, description) {
  if (!meta) return;
  clearSidebarLoadTimer(meta);
  meta.loadError = typeof description === 'string' && description ? description.slice(0, 300) : 'Failed to load.';
  meta.loadTimedOut = false;
}

function clearSidebarLoadError(meta) {
  if (!meta) return;
  clearSidebarLoadTimer(meta);
  meta.loadError = '';
  meta.loadTimedOut = false;
}

// Pure meta factory (unit-testable): every service view starts loading
// with no error; the watchdog / did-fail-load fill loadError in later.
function createSidebarServiceMeta(service, initialUrl) {
  return {
    key: service.key,
    title: service.title,
    defaultUrl: service.url,
    url: initialUrl,
    failedUrl: '',
    isLoading: true,
    loadError: '',
    loadTimedOut: false,
    audible: false,
    rawAudible: false,
    lastActiveAt: Date.now(),
    suspended: false,
    _audioHoldTimer: null,
    _loadTimer: null
  };
}

function armSidebarLoadTimer(ctx, service, meta) {
  if (!meta || service.internal) return;
  clearSidebarLoadTimer(meta);
  meta._loadTimer = setTimeout(() => {
    meta._loadTimer = null;
    if (!meta.isLoading) return;
    meta.loadTimedOut = true;
    meta.loadError = 'Timed out while loading — the service may be blocked or offline. Retry from the panel header.';
    broadcastSidebarState(ctx);
  }, SIDEBAR_LOAD_TIMEOUT_MS);
  if (meta._loadTimer && typeof meta._loadTimer.unref === 'function') {
    meta._loadTimer.unref();
  }
}

function createSidebarPanelState() {
  const s = state.storage ? state.storage.getSettings() : {};
  return {
    views: new Map(), // serviceKey -> WebContentsView
    meta: new Map(), // serviceKey -> { key, title, defaultUrl, url, failedUrl, isLoading, audible, rawAudible, lastActiveAt, suspended, _audioHoldTimer }
    savedUrls: new Map(), // serviceKey -> last URL preserved across idle suspend
    activeKey: null,
    open: false,
    openedAt: 0,
    pinned: Boolean(s.sidebarPanelPinned),
    width: clampSidebarWidth(s.sidebarPanelWidth),
    // [Fix2 A5] Resize-drag guard state (see SIDEBAR_RESIZE_GUARD_MS).
    resizing: false,
    lastResizeAt: 0,
    _resizeGuardTimer: null
  };
}

function ensureSidebarPanelState(ctx) {
  if (!ctx) return null;
  if (!ctx.sidebarPanel || !(ctx.sidebarPanel.views instanceof Map)) {
    ctx.sidebarPanel = createSidebarPanelState();
  }
  if (!(ctx.sidebarPanel.meta instanceof Map)) {
    ctx.sidebarPanel.meta = new Map();
  }
  if (!(ctx.sidebarPanel.savedUrls instanceof Map)) {
    ctx.sidebarPanel.savedUrls = new Map();
  }
  ctx.sidebarPanel.width = clampSidebarWidth(ctx.sidebarPanel.width);
  ctx.sidebarPanel.pinned = Boolean(ctx.sidebarPanel.pinned);
  ctx.sidebarPanel.resizing = Boolean(ctx.sidebarPanel.resizing);
  ctx.sidebarPanel.lastResizeAt = Number(ctx.sidebarPanel.lastResizeAt) || 0;
  return ctx.sidebarPanel;
}

// Pure predicate (unit-testable): is the resize guard active right now?
function isSidebarResizeGuardActive(panel, nowMs = Date.now()) {
  if (!panel) return false;
  if (panel.resizing) return true;
  const last = Number(panel.lastResizeAt) || 0;
  return last > 0 && nowMs - last < SIDEBAR_RESIZE_GUARD_MS;
}

// Explicit drag signal (sidebar:resize-start / sidebar:resize-end IPC).
// The renderer calls these around a drag; setSidebarWidth also maintains
// the guard, so drags keep working even before the renderer wires them.
function setSidebarResizing(ctx, resizing) {
  if (!ctx) return serializeSidebarState(ctx);
  const panel = ensureSidebarPanelState(ctx);
  panel.resizing = Boolean(resizing);
  if (panel.resizing) {
    panel.lastResizeAt = Date.now();
    if (panel._resizeGuardTimer) {
      clearTimeout(panel._resizeGuardTimer);
      panel._resizeGuardTimer = null;
    }
  } else if (panel._resizeGuardTimer) {
    clearTimeout(panel._resizeGuardTimer);
    panel._resizeGuardTimer = null;
  }
  return serializeSidebarState(ctx);
}

function noteSidebarResizeActivity(panel) {
  if (!panel) return;
  panel.resizing = true;
  panel.lastResizeAt = Date.now();
  if (panel._resizeGuardTimer) clearTimeout(panel._resizeGuardTimer);
  panel._resizeGuardTimer = setTimeout(() => {
    panel._resizeGuardTimer = null;
    panel.resizing = false;
  }, SIDEBAR_RESIZE_GUARD_MS);
  if (panel._resizeGuardTimer && typeof panel._resizeGuardTimer.unref === 'function') {
    panel._resizeGuardTimer.unref();
  }
}

function resolveSidebarService(keyOrOpts) {
  if (!keyOrOpts) return null;
  if (typeof keyOrOpts === 'string') {
    const trimmed = keyOrOpts.trim();
    if (SIDEBAR_SERVICES[trimmed]) return SIDEBAR_SERVICES[trimmed];
    for (const svc of Object.values(SIDEBAR_SERVICES)) {
      if (svc.url === trimmed || svc.url.replace(/\/$/, '') === trimmed.replace(/\/$/, '')) {
        return svc;
      }
    }
    return null;
  }
  if (typeof keyOrOpts === 'object') {
    const candidateKey = keyOrOpts.key || keyOrOpts.serviceKey || keyOrOpts.id || '';
    if (candidateKey && SIDEBAR_SERVICES[candidateKey]) {
      return SIDEBAR_SERVICES[candidateKey];
    }
    if (typeof keyOrOpts.url === 'string') {
      return resolveSidebarService(keyOrOpts.url);
    }
  }
  return null;
}

function getActiveSidebarView(ctx) {
  const panel = ensureSidebarPanelState(ctx);
  if (!panel || !panel.open || !panel.activeKey) return null;
  const view = panel.views.get(panel.activeKey);
  if (!view || !view.webContents || view.webContents.isDestroyed()) return null;
  return view;
}

function findSidebarServiceByWebContents(ctx, wc) {
  const panel = ensureSidebarPanelState(ctx);
  if (!panel || !wc) return null;
  for (const [key, view] of panel.views.entries()) {
    if (view && view.webContents && !view.webContents.isDestroyed() && view.webContents.id === wc.id) {
      return {
        key,
        view,
        meta: panel.meta.get(key) || null,
        service: SIDEBAR_SERVICES[key] || null
      };
    }
  }
  return null;
}

function getSidebarServiceCurrentUrl(ctx, serviceKey) {
  const panel = ensureSidebarPanelState(ctx);
  const service = SIDEBAR_SERVICES[serviceKey];
  if (!panel || !service) return '';
  const view = panel.views.get(serviceKey);
  const meta = panel.meta.get(serviceKey);

  if (view && view.webContents && !view.webContents.isDestroyed()) {
    const liveUrl = view.webContents.getURL();
    if (isErrorPageUrl(liveUrl)) {
      return getFailedUrlFromErrorPage(liveUrl) || meta?.failedUrl || service.url;
    }
    if (liveUrl && !liveUrl.startsWith('chrome-error://') && liveUrl !== 'about:blank') {
      return liveUrl;
    }
  }

  if (meta && meta.url) {
    if (isErrorPageUrl(meta.url)) {
      return meta.failedUrl || getFailedUrlFromErrorPage(meta.url) || service.url;
    }
    return meta.url;
  }

  return service.url;
}

function serializeSidebarState(ctx) {
  const panel = ensureSidebarPanelState(ctx);
  if (!panel) {
    return {
      open: false,
      activeKey: null,
      title: '',
      serviceUrl: '',
      currentUrl: '',
      isInternal: false,
      isLoading: false,
      pinned: false,
      width: SIDEBAR_PANEL_DEFAULT_WIDTH,
      loadedKeys: [],
      audibleKeys: []
    };
  }
  const activeService = panel.activeKey ? SIDEBAR_SERVICES[panel.activeKey] || null : null;
  const activeMeta = panel.activeKey ? panel.meta.get(panel.activeKey) || null : null;
  const currentUrl = panel.activeKey ? getSidebarServiceCurrentUrl(ctx, panel.activeKey) : '';
  const audibleKeys = [];
  for (const [k, m] of panel.meta.entries()) {
    if (m && m.audible) audibleKeys.push(k);
  }
  const clampedWidth = clampSidebarWidth(panel.width);
  const maxWidth = getMaxEffectiveSidebarPanelWidth(ctx);
  const effectiveWidth = getEffectiveSidebarPanelWidth(ctx, clampedWidth);
  return {
    open: Boolean(panel.open && panel.activeKey),
    activeKey: panel.activeKey || null,
    title: activeService ? activeService.title : '',
    serviceUrl: activeService ? activeService.url : '',
    currentUrl,
    isInternal: Boolean(activeService?.internal),
    isLoading: Boolean(activeMeta?.isLoading),
    // [Fix2 Discord] Loading-failure state for the panel chrome: '' while
    // healthy, otherwise a human-readable error + whether it was a timeout.
    // In this VM's MITM-proxy environment Discord genuinely cannot load;
    // this surfaces that honestly with a retry affordance instead of a
    // blank white panel.
    loadError: activeMeta?.loadError || '',
    loadTimedOut: Boolean(activeMeta?.loadTimedOut),
    pinned: Boolean(panel.pinned),
    width: clampedWidth,
    effectiveWidth,
    maxWidth,
    loadedKeys: Array.from(panel.views.keys()),
    audibleKeys
  };
}

function syncSidebarFrameViewState(ctx) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return;
  if (
    ctx.sidebarPanelFrameView &&
    ctx.sidebarPanelFrameView.webContents &&
    !ctx.sidebarPanelFrameView.webContents.isDestroyed()
  ) {
    ctx.sidebarPanelFrameView.webContents.send('sidebar:update', serializeSidebarState(ctx));
  }
}

function broadcastSidebarState(ctx) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return;
  const payload = serializeSidebarState(ctx);
  ctx.win.webContents.send('sidebar:update', payload);
  if (
    ctx.sidebarPanelFrameView &&
    ctx.sidebarPanelFrameView.webContents &&
    !ctx.sidebarPanelFrameView.webContents.isDestroyed()
  ) {
    ctx.sidebarPanelFrameView.webContents.send('sidebar:update', payload);
  }
  broadcastState(ctx);
}

function ensureSidebarPanelFrameView(ctx) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return null;
  if (
    ctx.sidebarPanelFrameView &&
    ctx.sidebarPanelFrameView.webContents &&
    !ctx.sidebarPanelFrameView.webContents.isDestroyed()
  ) {
    return ctx.sidebarPanelFrameView;
  }
  if (ctx.sidebarPanelFrameView) {
    try {
      ctx.win.contentView.removeChildView(ctx.sidebarPanelFrameView);
    } catch (_) {}
    ctx.sidebarPanelFrameView = null;
  }

  const view = new WebContentsView({
    webPreferences: {
      preload: PRELOAD_FILE,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  try {
    view.setBackgroundColor(ctx.incognito ? '#09090d' : '#12101b');
  } catch (_) {}

  const wc = view.webContents;
  registerWebContents(wc, ctx.win.id);
  require('./utils').attachInternalNavigationGuard(wc);
  attachKeyboardShortcuts(ctx, wc);

  wc.on('focus', () => {
    if (ctx.popoverOpenKind) closePopover(ctx, { restoreFocus: false });
  });

  wc.on('did-finish-load', () => {
    if (!ctx.win || ctx.win.isDestroyed() || wc.isDestroyed()) return;
    wc.send('sidebar:update', serializeSidebarState(ctx));
  });

  wc.loadFile(SIDEBAR_PANEL_CHROME_FILE, {
    query: getInternalUiQuery(ctx.incognito, ctx.profileId)
  });

  ctx.win.contentView.addChildView(view);
  if (typeof view.setVisible === 'function') {
    try {
      view.setVisible(false);
    } catch (_) {}
  }
  view.setBounds({ x: -5000, y: -5000, width: 1, height: 1 });
  ctx.sidebarPanelFrameView = view;
  return view;
}

function buildWebContentsViewForSidebarService(ctx, service) {
  const panel = ensureSidebarPanelState(ctx);
  state.adBlocker.attachToSession(ctx.session);

  const view = new WebContentsView({
    webPreferences: {
      preload: TAB_PRELOAD_FILE,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      session: ctx.session
    }
  });

  const initialUrl = !service.internal ? panel.savedUrls.get(service.key) || service.url : service.url;
  const meta = createSidebarServiceMeta(service, initialUrl);

  panel.views.set(service.key, view);
  panel.meta.set(service.key, meta);

  const wc = view.webContents;
  registerWebContents(wc, ctx.win.id);
  wc.setUserAgent(wc.getUserAgent().replace(/Electron\/[^\s]+\s?/g, ''));
  attachKeyboardShortcuts(ctx, wc);
  if (!service.internal) {
    attachWebContentsContextMenu(ctx, wc, { isSidebar: true });
  }

  wc.on('focus', () => {
    meta.lastActiveAt = Date.now();
    if (ctx.popoverOpenKind) closePopover(ctx, { restoreFocus: false });
  });

  wc.setWindowOpenHandler(({ url }) => {
    if (url && /^https?:\/\//i.test(url)) {
      createTab(ctx, { url, incognito: ctx.incognito, active: true });
    }
    return { action: 'deny' };
  });

  wc.on('did-start-loading', () => {
    meta.isLoading = true;
    clearSidebarLoadError(meta);
    armSidebarLoadTimer(ctx, service, meta);
    broadcastSidebarState(ctx);
  });

  wc.on('did-stop-loading', () => {
    meta.isLoading = false;
    clearSidebarLoadError(meta);
    state.adBlocker.injectCosmeticFilters(wc);
    const s = state.storage.getSettings(ctx.profileId);
    if (s.forceDarkWeb && /^https?:/i.test(meta.url)) {
      wc.insertCSS(
        `html { filter: invert(0.92) hue-rotate(180deg) !important; background: #0d0e12 !important; } img, video, iframe, canvas { filter: invert(1) hue-rotate(180deg) !important; }`
      ).catch(() => {});
    }
    broadcastSidebarState(ctx);
  });

  const handleUrlChange = (url) => {
    if (!url || url.startsWith('chrome-error://')) return;
    meta.url = url;
    if (isErrorPageUrl(url)) {
      meta.failedUrl = getFailedUrlFromErrorPage(url) || meta.failedUrl;
    } else {
      meta.failedUrl = '';
      meta.failedErrorCode = 0;
      meta.failedErrorDesc = '';
    }
    broadcastSidebarState(ctx);
  };

  wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    if (!errorCode || errorCode === -3 || errorDescription === 'ERR_ABORTED') return;

    const failedUrl = validatedURL || meta.url || service.url || '';
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
    meta.isLoading = canLoadErrorPage;
    meta.failedUrl = failedUrl;
    meta.failedErrorCode = errorCode;
    meta.failedErrorDesc = errorDescription || '';
    // [Fix2 Discord] Record the failure for the panel chrome so a service
    // that can never load (e.g. Discord behind this VM's MITM proxy) shows
    // an error + retry instead of a blank panel. The error page itself is
    // still loaded below; loadError is cleared when a later load succeeds.
    setSidebarLoadError(meta, errorDescription || `Failed to load (code ${errorCode}).`);
    meta.url = errorPageUrl;
    broadcastSidebarState(ctx);

    if (canLoadErrorPage) {
      wc.loadURL(errorPageUrl).catch(() => {});
    }
  });

  wc.on('did-navigate', (_e, url) => {
    state.adBlocker.clearCosmeticKeys(wc);
    if (!service.internal) {
      playerMod().onSidebarNavigated(ctx, service.key, wc.id);
    }
    handleUrlChange(url);
  });

  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    if (isMainFrame) handleUrlChange(url);
  });

  wc.on('dom-ready', () => state.adBlocker.injectCosmeticFilters(wc));

  wc.on('audio-state-changed', (event) => {
    const isAudibleNow = Boolean(event.audible);
    meta.rawAudible = isAudibleNow;
    meta.lastActiveAt = Date.now();
    if (!service.internal) {
      playerMod().onSidebarAudioChanged(ctx, service.key, wc.id, isAudibleNow);
    }
    if (isAudibleNow) {
      clearSidebarAudioHoldTimer(meta);
      if (!meta.audible) {
        meta.audible = true;
        broadcastSidebarState(ctx);
      }
    } else if (meta.audible && !meta._audioHoldTimer) {
      meta._audioHoldTimer = setTimeout(() => {
        meta._audioHoldTimer = null;
        if (!ctx.win || ctx.win.isDestroyed()) return;
        const currentView = panel.views.get(service.key);
        const stillAudible = Boolean(
          currentView &&
            currentView.webContents &&
            !currentView.webContents.isDestroyed() &&
            typeof currentView.webContents.isCurrentlyAudible === 'function' &&
            currentView.webContents.isCurrentlyAudible()
        );
        if (!stillAudible && !meta.rawAudible && meta.audible) {
          meta.audible = false;
          broadcastSidebarState(ctx);
        }
      }, SIDEBAR_AUDIO_HOLD_MS);
    }
  });

  if (service.internal) {
    try {
      view.setBackgroundColor(ctx.incognito ? '#09090d' : '#12101b');
    } catch (_) {}
    wc.on('did-finish-load', () => {
      if (!ctx.win || ctx.win.isDestroyed() || wc.isDestroyed()) return;
      if (service.key === 'player') {
        playerMod().sendPlayerStateToWebContents(ctx, wc);
      }
    });
    wc.once('destroyed', () => {
      clearSidebarAudioHoldTimer(meta);
      clearSidebarLoadTimer(meta);
    });
  } else {
    wc.once('destroyed', () => {
      clearSidebarAudioHoldTimer(meta);
      clearSidebarLoadTimer(meta);
      playerMod().onWebContentsDestroyed(wc.id);
    });
  }

  ctx.win.contentView.addChildView(view);
  if (typeof view.setVisible === 'function') {
    try {
      view.setVisible(false);
    } catch (_) {}
  }
  view.setBounds({ x: -5000, y: -5000, width: 1, height: 1 });
  if (service.internal && service.key === 'player') {
    wc.loadFile(PLAYER_PANEL_FILE, { query: getInternalUiQuery(ctx.incognito, ctx.profileId) }).catch(() => {});
  } else {
    wc.loadURL(initialUrl).catch(() => {});
  }
  return view;
}

function getOrCreateSidebarView(ctx, service) {
  const panel = ensureSidebarPanelState(ctx);
  const existing = panel.views.get(service.key);
  if (existing && existing.webContents && !existing.webContents.isDestroyed()) {
    return existing;
  }
  if (existing) {
    try {
      if (ctx.win && !ctx.win.isDestroyed() && ctx.win.contentView) {
        ctx.win.contentView.removeChildView(existing);
      }
    } catch (_) {}
    panel.views.delete(service.key);
  }
  return buildWebContentsViewForSidebarService(ctx, service);
}

function syncSidebarLayoutLeft(ctx) {
  if (!ctx || !ctx.layoutState) return;
  const panel = ensureSidebarPanelState(ctx);
  if (panel.open && panel.activeKey && panel.pinned) {
    ctx.layoutState.left = SIDEBAR_ICON_WIDTH + getEffectiveSidebarPanelWidth(ctx, panel.width);
  } else {
    ctx.layoutState.left = SIDEBAR_ICON_WIDTH;
  }
}

function openSidebarPanel(ctx, keyOrOpts) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed() || ctx.shellModalOpen) return serializeSidebarState(ctx);
  const panel = ensureSidebarPanelState(ctx);
  const service = resolveSidebarService(keyOrOpts || panel.activeKey);
  if (!service) return serializeSidebarState(ctx);

  if (ctx.popoverOpenKind) {
    closePopover(ctx, { restoreFocus: false });
  }

  ensureSidebarPanelFrameView(ctx);
  const view = getOrCreateSidebarView(ctx, service);
  panel.activeKey = service.key;
  panel.open = true;
  panel.openedAt = Date.now();
  const activeMeta = panel.meta.get(service.key);
  if (activeMeta) {
    activeMeta.lastActiveAt = Date.now();
    activeMeta.suspended = false;
  }

  // RAM: only one external sidebar service view stays live at a time.
  // Opening a service suspends every other non-audible service view
  // (its URL is saved and it is re-created lazily on next open), so the
  // sidebar cannot accumulate a WebContentsView per service and the
  // ~400 MB jump the run report saw from two open sidebar tabs goes
  // away. Audible services (background music) are never suspended.
  for (const otherKey of Array.from(panel.views.keys())) {
    if (otherKey === service.key) continue;
    const otherMeta = panel.meta.get(otherKey);
    if (otherMeta && (otherMeta.audible || otherMeta.rawAudible)) continue;
    suspendSidebarServiceView(ctx, otherKey);
  }

  syncSidebarLayoutLeft(ctx);
  updateActiveViewBounds(ctx);
  if (view && view.webContents && !view.webContents.isDestroyed()) {
    view.webContents.focus();
  }
  broadcastSidebarState(ctx);
  return serializeSidebarState(ctx);
}

function closeSidebarPanel(ctx, { restoreFocus = true } = {}) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return serializeSidebarState(ctx);
  const panel = ensureSidebarPanelState(ctx);
  if (!panel.open) return serializeSidebarState(ctx);

  const prevMeta = panel.activeKey ? panel.meta.get(panel.activeKey) : null;
  if (prevMeta) {
    prevMeta.lastActiveAt = Date.now();
  }
  panel.open = false;
  syncSidebarLayoutLeft(ctx);
  updateActiveViewBounds(ctx);
  if (restoreFocus) {
    restoreFocusToActiveTab(ctx);
  }
  broadcastSidebarState(ctx);
  return serializeSidebarState(ctx);
}

function closeSidebarIfUnpinned(ctx, { restoreFocus = false, ignoreGrace = false } = {}) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return false;
  const panel = ensureSidebarPanelState(ctx);
  if (!panel || !panel.open || panel.pinned) return false;
  // [Fix2 A5] Never auto-close while a resize drag is in progress (or
  // just ended): tab-view focus events fired during a drag used to kill
  // the panel mid-drag. Explicit closes (closeSidebarPanel) are unaffected.
  if (isSidebarResizeGuardActive(panel)) return false;
  if (!ignoreGrace && Date.now() - (panel.openedAt || 0) < SIDEBAR_OPEN_GRACE_MS) {
    return false;
  }
  closeSidebarPanel(ctx, { restoreFocus });
  return true;
}

function suspendSidebarServiceView(ctx, serviceKey) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return false;
  const panel = ensureSidebarPanelState(ctx);
  const service = SIDEBAR_SERVICES[serviceKey];
  if (!panel || !service || service.internal) return false;
  const view = panel.views.get(serviceKey);
  if (!view) return false;

  const meta = panel.meta.get(serviceKey) || null;
  const resumeUrl = getSidebarServiceCurrentUrl(ctx, serviceKey) || service.url;
  if (resumeUrl && !isErrorPageUrl(resumeUrl) && !resolveInternalUiFile(resumeUrl)) {
    panel.savedUrls.set(serviceKey, resumeUrl);
  }

  clearSidebarAudioHoldTimer(meta);
  clearSidebarLoadTimer(meta);
  const wc = view.webContents;
  if (ctx.fullscreen && ctx.fullscreen.active && (ctx.fullscreen.view === view || ctx.fullscreen.webContents === wc)) {
    try {
      require('./fullscreen').exitFullscreen(ctx);
    } catch (_) {}
  }
  if (wc) {
    webContentsToWinId.delete(wc.id);
    playerMod().onWebContentsDestroyed(wc.id);
  }
  try {
    ctx.win.contentView.removeChildView(view);
  } catch (_) {}
  try {
    if (wc && !wc.isDestroyed()) {
      wc.close();
    }
  } catch (_) {}

  panel.views.delete(serviceKey);
  if (meta) {
    meta.url = resumeUrl;
    meta.isLoading = false;
    meta.audible = false;
    meta.rawAudible = false;
    meta.suspended = true;
  }
  broadcastSidebarState(ctx);
  return true;
}

function suspendIdleSidebarViews(timeoutMs) {
  // timeoutMs === 0 means "suspend every eligible view right now"
  // (Hibernate Now); otherwise idle views older than timeoutMs suspend.
  const num = Number(timeoutMs);
  const safeTimeout =
    num === 0 ? 0 : Number.isFinite(num) && num > 0 ? num : 10 * 60 * 1000;
  const now = Date.now();
  let suspendedCount = 0;

  for (const ctx of windowContexts.values()) {
    if (!ctx || !ctx.win || ctx.win.isDestroyed() || !ctx.sidebarPanel) continue;
    const panel = ensureSidebarPanelState(ctx);
    for (const [serviceKey, view] of Array.from(panel.views.entries())) {
      const service = SIDEBAR_SERVICES[serviceKey];
      if (!service || service.internal) continue;
      const meta = panel.meta.get(serviceKey);
      if (!meta) continue;

      // Never suspend a currently visible sidebar service panel
      if (panel.open && panel.activeKey === serviceKey) {
        meta.lastActiveAt = now;
        continue;
      }

      const wc = view && view.webContents && !view.webContents.isDestroyed() ? view.webContents : null;
      const isCurrentlyAudible = Boolean(
        meta.rawAudible ||
          meta.audible ||
          (wc && typeof wc.isCurrentlyAudible === 'function' && wc.isCurrentlyAudible()) ||
          (wc && playerMod().isWebContentsPlayingMedia(wc.id))
      );

      // Never suspend while media/audio is actively playing; reset idle timer
      if (isCurrentlyAudible) {
        meta.lastActiveAt = now;
        continue;
      }

      const lastActiveAt = Number(meta.lastActiveAt) || 0;
      if (lastActiveAt > 0 && now - lastActiveAt >= safeTimeout) {
        if (suspendSidebarServiceView(ctx, serviceKey)) {
          suspendedCount += 1;
        }
      }
    }
  }
  return suspendedCount;
}

function toggleSidebarPanel(ctx, keyOrOpts) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return serializeSidebarState(ctx);
  const panel = ensureSidebarPanelState(ctx);
  const service = resolveSidebarService(keyOrOpts);
  if (!service) return serializeSidebarState(ctx);

  if (panel.open && panel.activeKey === service.key) {
    return closeSidebarPanel(ctx);
  }
  return openSidebarPanel(ctx, service.key);
}

function setSidebarPinned(ctx, pinnedArg) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return serializeSidebarState(ctx);
  const panel = ensureSidebarPanelState(ctx);
  const nextPinned =
    typeof pinnedArg === 'boolean'
      ? pinnedArg
      : typeof pinnedArg === 'object' && pinnedArg !== null && typeof pinnedArg.pinned === 'boolean'
      ? pinnedArg.pinned
      : !panel.pinned;

  panel.pinned = Boolean(nextPinned);
  if (state.storage) {
    const s = state.storage.updateSettings({ sidebarPanelPinned: panel.pinned }, ctx.profileId);
    broadcastSettingsUpdate(s, { profileId: ctx.profileId });
  }
  let updatedCallingCtx = false;
  for (const winCtx of windowContexts.values()) {
    if (!winCtx || !winCtx.win || winCtx.win.isDestroyed()) continue;
    const winPanel = ensureSidebarPanelState(winCtx);
    winPanel.pinned = panel.pinned;
    if (winPanel.open) {
      syncSidebarLayoutLeft(winCtx);
    }
    updateActiveViewBounds(winCtx);
    broadcastSidebarState(winCtx);
    if (winCtx === ctx) updatedCallingCtx = true;
  }
  if (!updatedCallingCtx) {
    if (panel.open) {
      syncSidebarLayoutLeft(ctx);
    }
    updateActiveViewBounds(ctx);
    broadcastSidebarState(ctx);
  }
  return serializeSidebarState(ctx);
}

function setSidebarWidth(ctx, rawWidth, { persist = true } = {}) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return serializeSidebarState(ctx);
  const panel = ensureSidebarPanelState(ctx);
  const clamped = clampSidebarWidth(rawWidth);
  panel.width = clamped;
  // [Fix2 A5] Every drag move reports a width (persist:false during the
  // drag, persist:true on release), so stamping the guard here covers the
  // whole drag even before the renderer wires resize-start/resize-end.
  // Persisting still happens exactly once, on release (persist:true).
  noteSidebarResizeActivity(panel);

  if (persist) {
    if (state.storage) {
      const s = state.storage.updateSettings({ sidebarPanelWidth: clamped }, ctx.profileId);
      broadcastSettingsUpdate(s, { profileId: ctx.profileId });
    }
    let updatedCallingCtx = false;
    for (const winCtx of windowContexts.values()) {
      if (!winCtx || !winCtx.win || winCtx.win.isDestroyed()) continue;
      const winPanel = ensureSidebarPanelState(winCtx);
      winPanel.width = clamped;
      if (winPanel.open && winPanel.pinned) {
        syncSidebarLayoutLeft(winCtx);
      }
      updateActiveViewBounds(winCtx);
      broadcastSidebarState(winCtx);
      if (winCtx === ctx) updatedCallingCtx = true;
    }
    if (!updatedCallingCtx) {
      if (panel.open && panel.pinned) {
        syncSidebarLayoutLeft(ctx);
      }
      updateActiveViewBounds(ctx);
      broadcastSidebarState(ctx);
    }
    return serializeSidebarState(ctx);
  }

  if (panel.open && panel.pinned) {
    syncSidebarLayoutLeft(ctx);
  }
  updateActiveViewBounds(ctx);
  return serializeSidebarState(ctx);
}

function reloadSidebarPanel(ctx) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return serializeSidebarState(ctx);
  const panel = ensureSidebarPanelState(ctx);
  if (!panel.activeKey) return serializeSidebarState(ctx);

  const view = panel.views.get(panel.activeKey);
  const meta = panel.meta.get(panel.activeKey);
  const service = SIDEBAR_SERVICES[panel.activeKey];
  if (!view || !view.webContents || view.webContents.isDestroyed()) {
    return serializeSidebarState(ctx);
  }

  const wc = view.webContents;
  const currentUrl = wc.getURL();
  if (isErrorPageUrl(meta?.url) || isErrorPageUrl(currentUrl)) {
    const retryUrl =
      getFailedUrlFromErrorPage(currentUrl) ||
      meta?.failedUrl ||
      getFailedUrlFromErrorPage(meta?.url) ||
      service?.url;
    if (retryUrl && !isErrorPageUrl(retryUrl) && !resolveInternalUiFile(retryUrl)) {
      if (meta) {
        meta.url = retryUrl;
        meta.failedUrl = '';
        meta.isLoading = true;
      }
      broadcastSidebarState(ctx);
      wc.loadURL(retryUrl).catch(() => {});
      return serializeSidebarState(ctx);
    }
  }
  wc.reload();
  return serializeSidebarState(ctx);
}

function openSidebarPanelInNewTab(ctx) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return serializeSidebarState(ctx);
  const panel = ensureSidebarPanelState(ctx);
  if (!panel.activeKey) return serializeSidebarState(ctx);
  if (SIDEBAR_SERVICES[panel.activeKey]?.internal) return serializeSidebarState(ctx);

  const targetUrl = getSidebarServiceCurrentUrl(ctx, panel.activeKey);
  if (!targetUrl) return serializeSidebarState(ctx);

  createTab(ctx, {
    url: targetUrl,
    incognito: ctx.incognito,
    active: true
  });
  return serializeSidebarState(ctx);
}

function cleanupSidebarPanelViews(ctx) {
  if (!ctx) return;
  if (ctx.sidebarPanelFrameView) {
    try {
      const wc = ctx.sidebarPanelFrameView.webContents;
      if (wc) {
        webContentsToWinId.delete(wc.id);
        if (typeof wc.isDestroyed === 'function' && !wc.isDestroyed()) wc.close();
      }
    } catch (_) {}
    ctx.sidebarPanelFrameView = null;
  }
  if (!ctx.sidebarPanel || !(ctx.sidebarPanel.views instanceof Map)) return;
  for (const view of ctx.sidebarPanel.views.values()) {
    try {
      const wc = view && view.webContents;
      if (wc) {
        webContentsToWinId.delete(wc.id);
        if (typeof wc.isDestroyed === 'function' && !wc.isDestroyed()) wc.close();
      }
    } catch (_) {}
  }
  ctx.sidebarPanel.views.clear();
  if (ctx.sidebarPanel.meta instanceof Map) {
    for (const meta of ctx.sidebarPanel.meta.values()) {
      clearSidebarAudioHoldTimer(meta);
      clearSidebarLoadTimer(meta);
    }
    ctx.sidebarPanel.meta.clear();
  }
  if (ctx.sidebarPanel.savedUrls instanceof Map) {
    ctx.sidebarPanel.savedUrls.clear();
  }
}

module.exports = {
  SIDEBAR_SERVICES,
  SIDEBAR_OPEN_GRACE_MS,
  SIDEBAR_RESIZE_GUARD_MS,
  SIDEBAR_LOAD_TIMEOUT_MS,
  clampSidebarWidth,
  createSidebarPanelState,
  createSidebarServiceMeta,
  setSidebarLoadError,
  clearSidebarLoadError,
  isSidebarResizeGuardActive,
  setSidebarResizing,
  ensureSidebarPanelState,
  resolveSidebarService,
  getActiveSidebarView,
  findSidebarServiceByWebContents,
  getSidebarServiceCurrentUrl,
  serializeSidebarState,
  syncSidebarFrameViewState,
  broadcastSidebarState,
  syncSidebarLayoutLeft,
  openSidebarPanel,
  closeSidebarPanel,
  closeSidebarIfUnpinned,
  suspendSidebarServiceView,
  suspendIdleSidebarViews,
  toggleSidebarPanel,
  setSidebarPinned,
  setSidebarWidth,
  reloadSidebarPanel,
  openSidebarPanelInNewTab,
  cleanupSidebarPanelViews
};
