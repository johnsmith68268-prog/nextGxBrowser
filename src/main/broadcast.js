const { BrowserWindow } = require('electron');
const { windowContexts, webContentsToWinId, state } = require('./core');
const {
  isCornerUrl,
  isWebUiUrl,
  getOriginForUrl
} = require('./utils');
const { formatDisplayUrl } = require('./navigation');
const playerMod = () => require('./player');
const splitViewMod = () => require('./splitview');

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
  const activeWorkspaceId = ctx.incognito ? 'default' : ctx.activeWorkspaceId || 'default';
  const workspaces = ctx.incognito
    ? [{ id: 'default', name: 'Default', icon: '', color: '', createdAt: 0 }]
    : state.storage
    ? state.storage.getWorkspaces()
    : [{ id: 'default', name: 'Default', icon: '', color: '', createdAt: 0 }];
  const groups = ctx.incognito
    ? Array.isArray(ctx.privateGroups)
      ? ctx.privateGroups.map((g) => ({ ...g }))
      : []
    : state.storage
    ? state.storage.getTabGroups()
    : [];

  const { isErrorPageUrl } = require('./utils');
  const { isCertExceptionAllowed } = require('./cert-exceptions');
  const ordered = ctx.tabOrder
    .map((id) => ctx.tabs.get(id))
    .filter(Boolean)
    .map((t) => {
      const displayUrl = formatDisplayUrl(t.url);
      const origin = getOriginForUrl(t.url);
      const pinned = Boolean(t.pinned);
      const videoState = playerMod().getTabVideoState(t);
      const isErrPage = isErrorPageUrl(t.url);
      const hasCertBypass = Boolean(origin && isCertExceptionAllowed(origin));
      const isInternal =
        displayUrl.startsWith('nextgx://') ||
        t.url.startsWith('file://') ||
        t.url.startsWith('about:') ||
        t.url.startsWith('data:');
      const isHttpInsecure =
        t.url.startsWith('http://') ||
        hasCertBypass ||
        (isErrPage && typeof displayUrl === 'string' && /^https?:\/\//i.test(displayUrl));
      const isSecure = !isHttpInsecure && !isErrPage && t.url.startsWith('https://');
      const securityState = isHttpInsecure ? 'insecure' : isSecure ? 'secure' : isInternal ? 'neutral' : 'neutral';
      return {
        id: t.id,
        title: t.title || (ctx.incognito ? 'Private Start' : 'Start Page'),
        url: displayUrl,
        origin,
        isSecure,
        isHttpInsecure,
        securityState,
        hasCertBypass,
        favicon: t.favicon || '',
        isLoading: Boolean(t.isLoading),
        canGoBack: Boolean(t.canGoBack),
        canGoForward: Boolean(t.canGoForward),
        pinned,
        workspaceId: ctx.incognito ? 'default' : t.workspaceId || 'default',
        groupId: pinned ? null : t.groupId || null,
        incognito: Boolean(t.incognito || ctx.incognito),
        sleeping: Boolean(t.sleeping),
        audible: Boolean(t.audible),
        hasPlayingVideo: Boolean(videoState.hasPlayingVideo),
        pipActive: Boolean(videoState.pipActive),
        videoTitle: videoState.videoTitle || '',
        readerMode: Boolean(t.readerMode),
        zoomPercent: Math.round((t.zoomFactor || 1) * 100),
        isBookmarked: state.storage.isBookmarked(displayUrl, ctx.profileId),
        adblockSiteEnabled: state.adBlocker
          ? origin
            ? state.adBlocker.isSiteBlockingActive(origin, ctx.profileId)
            : state.adBlocker.isEnabled(ctx.profileId)
          : true
      };
    });

  return {
    windowIncognito: ctx.incognito,
    profileId: ctx.profileId || 'default',
    activeWorkspaceId,
    workspaces,
    groups,
    tabs: ordered,
    activeTabId: ctx.activeTabId,
    activeTab: ordered.find((t) => t.id === ctx.activeTabId) || null,
    // [Fix2 Panic] The shell shows a "panicked" state while this is true.
    panicActive: Boolean(ctx.panicActive),
    split: splitViewMod().serializeSplitState(ctx),
    sidebarPanel: ctx.sidebarPanel
      ? {
          open: Boolean(ctx.sidebarPanel.open && ctx.sidebarPanel.activeKey),
          activeKey: ctx.sidebarPanel.activeKey || null,
          pinned: Boolean(ctx.sidebarPanel.pinned),
          width: Number(ctx.sidebarPanel.width) || 380
        }
      : null
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

function sendToWebUiTabs(channel, payload, { profileId = null } = {}) {
  for (const ctx of windowContexts.values()) {
    if (profileId && (ctx.profileId || 'default') !== profileId) continue;
    for (const tab of ctx.tabs.values()) {
      if (!tab || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed()) continue;
      const wcUrl = tab.view.webContents.getURL();
      if (isWebUiUrl(tab.url) || isWebUiUrl(wcUrl)) {
        tab.view.webContents.send(channel, payload);
      }
    }
  }
}

function sendToCornerTabs(channel, payload) {
  for (const ctx of windowContexts.values()) {
    for (const tab of ctx.tabs.values()) {
      if (!tab || tab.sleeping || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed()) continue;
      const wcUrl = tab.view.webContents.getURL();
      if (isCornerUrl(tab.url) || isCornerUrl(wcUrl)) {
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

const ADBLOCK_BROADCAST_THROTTLE_MS = 750;
let adblockBroadcastTimer = null;
let lastAdblockBroadcastAt = 0;
let pendingAdblockPayload = null;

function flushAdblockBroadcastNow(stats) {
  const payload = stats || pendingAdblockPayload || (state.adBlocker ? state.adBlocker.getStats() : null);
  pendingAdblockPayload = null;
  if (!payload) return;
  lastAdblockBroadcastAt = Date.now();
  for (const ctx of windowContexts.values()) {
    if (ctx.win && !ctx.win.isDestroyed()) {
      ctx.win.webContents.send('adblock:update', payload);
    }
    if (
      ctx.popoverOpenKind &&
      ctx.popoverView &&
      ctx.popoverView.webContents &&
      !ctx.popoverView.webContents.isDestroyed()
    ) {
      ctx.popoverView.webContents.send('adblock:update', payload);
    }
  }
  sendToWebUiTabs('adblock:update', payload);
}

function broadcastAdblockUpdate(stats, { throttled = false } = {}) {
  const payload = stats || (state.adBlocker ? state.adBlocker.getStats() : null);
  if (!payload) return;
  if (!throttled) {
    if (adblockBroadcastTimer) {
      clearTimeout(adblockBroadcastTimer);
      adblockBroadcastTimer = null;
    }
    flushAdblockBroadcastNow(payload);
    return;
  }
  pendingAdblockPayload = payload;
  const elapsed = Date.now() - lastAdblockBroadcastAt;
  if (elapsed >= ADBLOCK_BROADCAST_THROTTLE_MS && !adblockBroadcastTimer) {
    flushAdblockBroadcastNow(payload);
    return;
  }
  if (!adblockBroadcastTimer) {
    const delay = Math.max(50, ADBLOCK_BROADCAST_THROTTLE_MS - elapsed);
    adblockBroadcastTimer = setTimeout(() => {
      adblockBroadcastTimer = null;
      if (!state.isAppQuitting) {
        flushAdblockBroadcastNow();
      }
    }, delay);
  }
}

function cancelScheduledAdblockBroadcast() {
  if (adblockBroadcastTimer) {
    clearTimeout(adblockBroadcastTimer);
    adblockBroadcastTimer = null;
  }
  pendingAdblockPayload = null;
}

function broadcastHistoryUpdate({ profileId = null } = {}) {
  // [Fix2 #20] The omnibox suggestion cache lives in the SHELL window
  // (renderer.js), not in a WebUI tab — send there too, so the shell can
  // invalidate its cache the moment history/bookmarks change instead of
  // waiting out the 30 s TTL. Previously this only reached WebUI tabs.
  for (const ctx of windowContexts.values()) {
    if (profileId && (ctx.profileId || 'default') !== profileId) continue;
    if (ctx.win && !ctx.win.isDestroyed()) {
      ctx.win.webContents.send('history:update', undefined);
    }
  }
  sendToWebUiTabs('history:update', undefined, { profileId });
}

function broadcastPasswordsUpdate({ profileId = null } = {}) {
  sendToWebUiTabs('passwords:update', undefined, { profileId });
}

function broadcastPermissionsUpdate({ profileId = null } = {}) {
  sendToWebUiTabs('permissions:update', undefined, { profileId });
}

function broadcastProfilesUpdate() {
  if (!state.storage) return;
  const store = state.storage.getProfilesStore();
  const activeProfile =
    store.profiles.find((p) => p.id === store.activeId) || store.profiles[0] || null;
  for (const ctx of windowContexts.values()) {
    const windowProfileId = ctx.profileId || 'default';
    const windowProfile =
      store.profiles.find((p) => p.id === windowProfileId) || activeProfile;
    const payload = {
      version: 1,
      activeId: store.activeId,
      profiles: store.profiles,
      activeProfile,
      windowProfileId,
      windowProfile
    };
    if (ctx.win && !ctx.win.isDestroyed()) {
      ctx.win.webContents.send('profiles:update', payload);
    }
    if (
      ctx.popoverOpenKind &&
      ctx.popoverView &&
      ctx.popoverView.webContents &&
      !ctx.popoverView.webContents.isDestroyed()
    ) {
      ctx.popoverView.webContents.send('profiles:update', payload);
    }
    for (const tab of ctx.tabs.values()) {
      if (!tab || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed()) continue;
      const wcUrl = tab.view.webContents.getURL();
      if (isWebUiUrl(tab.url) || isWebUiUrl(wcUrl)) {
        tab.view.webContents.send('profiles:update', payload);
      }
    }
  }
}

function broadcastDownloadsUpdate(downloads, { profileId = null } = {}) {
  for (const ctx of windowContexts.values()) {
    const ctxPid = ctx.profileId || 'default';
    if (profileId && ctxPid !== profileId) continue;
    const payload =
      profileId && Array.isArray(downloads)
        ? downloads
        : state.storage
        ? state.storage.getDownloads(ctxPid)
        : downloads || [];
    if (ctx.win && !ctx.win.isDestroyed()) {
      ctx.win.webContents.send('downloads:update', payload);
    }
    if (
      ctx.popoverOpenKind &&
      ctx.popoverView &&
      ctx.popoverView.webContents &&
      !ctx.popoverView.webContents.isDestroyed()
    ) {
      ctx.popoverView.webContents.send('downloads:update', payload);
    }
    for (const tab of ctx.tabs.values()) {
      if (!tab || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed()) continue;
      const wcUrl = tab.view.webContents.getURL();
      if (isWebUiUrl(tab.url) || isWebUiUrl(wcUrl)) {
        tab.view.webContents.send('downloads:update', payload);
      }
    }
  }
}

function broadcastSettingsUpdate(settings, { profileId = null } = {}) {
  for (const ctx of windowContexts.values()) {
    const ctxPid = ctx.profileId || 'default';
    const payload = state.storage
      ? state.storage.getSettings(ctxPid)
      : settings || null;
    if (!payload) continue;
    if (ctx.win && !ctx.win.isDestroyed()) {
      ctx.win.webContents.send('settings:update', payload);
    }
    if (ctx.popoverView && ctx.popoverView.webContents && !ctx.popoverView.webContents.isDestroyed()) {
      ctx.popoverView.webContents.send('settings:update', payload);
    }
    if (
      ctx.sidebarPanelFrameView &&
      ctx.sidebarPanelFrameView.webContents &&
      !ctx.sidebarPanelFrameView.webContents.isDestroyed()
    ) {
      ctx.sidebarPanelFrameView.webContents.send('settings:update', payload);
    }
    if (ctx.screenshotView && ctx.screenshotView.webContents && !ctx.screenshotView.webContents.isDestroyed()) {
      ctx.screenshotView.webContents.send('settings:update', payload);
    }
    // [Fix2 Page effects] settings:update now goes to EVERY awake tab
    // view, not just internal pages: tab-preload's page-effects code
    // (Shaders / video Enhance) lives in ordinary web pages and must
    // re-apply live when a preset changes. The message lands in the
    // preload's isolated world, never in page JS, and web-page preloads
    // had no settings:update listener before, so this is additive only.
    for (const tab of ctx.tabs.values()) {
      if (!tab || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed()) continue;
      tab.view.webContents.send('settings:update', payload);
    }
    if (ctx.sidebarPanel && ctx.sidebarPanel.views instanceof Map) {
      for (const view of ctx.sidebarPanel.views.values()) {
        if (!view || !view.webContents || view.webContents.isDestroyed()) continue;
        view.webContents.send('settings:update', payload);
      }
    }
  }
}

function broadcastBookmarksUpdate(bookmarks, { profileId = null } = {}) {
  for (const ctx of windowContexts.values()) {
    const ctxPid = ctx.profileId || 'default';
    if (profileId && ctxPid !== profileId) continue;
    const payload =
      profileId && Array.isArray(bookmarks)
        ? bookmarks
        : state.storage
        ? state.storage.getBookmarks(ctxPid)
        : bookmarks || [];
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
    if (ctx.sidebarPanel && ctx.sidebarPanel.views instanceof Map) {
      for (const view of ctx.sidebarPanel.views.values()) {
        if (view && view.webContents && !view.webContents.isDestroyed()) {
          list.push(view.webContents);
        }
      }
    }
  }
  return list;
}

async function syncAdblockCosmeticFilters(targetOrigin = '') {
  if (!state.adBlocker) return;
  await state.adBlocker.syncCosmeticFilters(getAllTabWebContents(), targetOrigin);
}

module.exports = {
  getCtxFromSender,
  serializeTabs,
  broadcastState,
  sendToWebUiTabs,
  sendToCornerTabs,
  notifyActiveWebUiTabShown,
  broadcastAdblockUpdate,
  cancelScheduledAdblockBroadcast,
  broadcastHistoryUpdate,
  broadcastPasswordsUpdate,
  broadcastPermissionsUpdate,
  broadcastProfilesUpdate,
  broadcastDownloadsUpdate,
  broadcastSettingsUpdate,
  broadcastBookmarksUpdate,
  getAllTabWebContents,
  syncAdblockCosmeticFilters
};
