const {
  WebContentsView,
  ipcMain,
  session,
  nativeImage
} = require('electron');
const {
  NEW_TAB_FILE,
  CORNER_FILE,
  WEBUI_FILE,
  ERROR_PAGE_FILE,
  PLAYER_PANEL_FILE,
  SCREENSHOT_FILE,
  PRELOAD_FILE,
  windowContexts,
  registerWebContents,
  state
} = require('./core');
const {
  normalizePathForCompare,
  resolveInternalUiFile,
  isInternalUiSender,
  normalizeAutofillHost,
  isAutofillHostMatch,
  isErrorPageUrl,
  getInternalUiQuery
} = require('./utils');
const {
  getFailedUrlFromErrorPage,
  formatDisplayUrl,
  getConfiguredHomepageUrl
} = require('./navigation');
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
const { updateActiveViewBounds } = require('./layout');
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
  createTab,
  switchTab,
  sleepTab,
  sleepBackgroundTabs,
  closeTab,
  closeOtherTabs,
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
const { saveScreenshotPng } = require('./screenshots');
const { collectSystemStats, broadcastSystemStatsNow } = require('./stats');
const gxControl = require('./gxcontrol');
const { registerPlayerIpcHandlers } = require('./player');
const { registerGxCornerIpcHandlers } = require('./gxcorner');
const { getSessionForProfile, registerProfileIpcHandlers } = require('./profiles');
const { registerImportExportIpcHandlers } = require('./import-export');
const { registerPrivacyAndPasswordIpcHandlers } = require('./privacy');
const { registerSplitIpcHandlers, onWorkspacesChanged } = require('./splitview');
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

  ipcMain.handle('autofill:get', (e) => {
    const frameUrl = e?.senderFrame?.url;
    if (!frameUrl) return [];
    try {
      const u = new URL(frameUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return [];
      const pageHost = u.hostname;
      if (!pageHost) return [];
      const pid = getSenderProfileId(e);
      return (state.storage.getPasswords(pid) || []).filter((p) => p && p.site && isAutofillHostMatch(pageHost, p.site));
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
    navigateActiveTab(ctx, input);
    return serializeTabs(ctx);
  });
  handleInternal('tabs:back', (e) => {
    const ctx = getCtxFromSender(e.sender);
    const sidebarEntry = findSidebarServiceByWebContents(ctx, e.sender);
    if (sidebarEntry) {
      if (sidebarEntry.view.webContents.canGoBack()) {
        sidebarEntry.view.webContents.goBack();
      }
      return serializeTabs(ctx);
    }
    const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    if (tab?.view?.webContents.canGoBack()) tab.view.webContents.goBack();
    return serializeTabs(ctx);
  });
  handleInternal('tabs:forward', (e) => {
    const ctx = getCtxFromSender(e.sender);
    const sidebarEntry = findSidebarServiceByWebContents(ctx, e.sender);
    if (sidebarEntry) {
      if (sidebarEntry.view.webContents.canGoForward()) {
        sidebarEntry.view.webContents.goForward();
      }
      return serializeTabs(ctx);
    }
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
    const sidebarEntry = findSidebarServiceByWebContents(ctx, e.sender);
    if (sidebarEntry && sidebarEntry.service) {
      if (sidebarEntry.meta) {
        sidebarEntry.meta.url = sidebarEntry.service.url;
        sidebarEntry.meta.failedUrl = '';
        sidebarEntry.meta.isLoading = true;
      }
      broadcastSidebarState(ctx);
      sidebarEntry.view.webContents.loadURL(sidebarEntry.service.url).catch(() => {});
      return serializeTabs(ctx);
    }
    navigateActiveTab(ctx, getConfiguredHomepageUrl());
    return serializeTabs(ctx);
  });
  handleInternal('tabs:devtools', (e) => toggleActiveTabDevTools(getCtxFromSender(e.sender)));

  handleInternal('tabs:zoom', (e, action) => applyZoomAction(getCtxFromSender(e.sender), action));

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
          preload: PRELOAD_FILE,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      });
      registerWebContents(ctx.screenshotView.webContents, ctx.win.id);
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
    const requestId = tab.view.webContents.findInPage(text, {
      forward: Boolean(forward),
      findNext: false
    });
    tab.lastFindRequestId = requestId;
    return { requestId };
  });

  handleInternal('tabs:stop-find', (e) => {
    const ctx = getCtxFromSender(e.sender);
    const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    if (tab) {
      tab.lastFindRequestId = null;
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

  handleInternal('cleaner:run', async (e, { cache = true, cookies = false, history = false } = {}) => {
    const ctx = getCtxFromSender(e.sender);
    const pid = ctx?.profileId || state.storage.getActiveProfileId();
    const targetSession =
      ctx && !ctx.incognito && ctx.session ? ctx.session : getSessionForProfile(pid) || session.defaultSession;
    if (cache) await targetSession.clearCache();
    if (cookies) {
      await targetSession.clearStorageData({ storages: ['cookies', 'localstorage'] });
      await targetSession.cookies.flushStore().catch(() => {});
      broadcastCookiesUpdate({ immediate: true, profileId: pid });
    }
    if (history) {
      state.storage.clearHistory('all', pid);
      broadcastHistoryUpdate({ profileId: pid });
    }
    return { cleanedAt: Date.now() };
  });

  handleInternal('popover:open', (e, opts) => openPopover(getCtxFromSender(e.sender), opts || {}));
  handleInternal('popover:resize', (e, opts) => resizePopover(getCtxFromSender(e.sender), opts || {}));
  handleInternal('popover:close', (e) => closePopover(getCtxFromSender(e.sender)));

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
        } catch (_) {}
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
    if (action === 'new-tab') createTab(ctx, { url: 'nextgx://newtab', active: true });
    else if (action === 'new-window') createBrowserWindow({ incognito: false });
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
      if (tab?.view) tab.view.webContents.print();
    } else if (action === 'find') {
      if (ctx.win && !ctx.win.isDestroyed() && ctx.win.webContents && !ctx.win.webContents.isDestroyed()) {
        try {
          ctx.win.webContents.focus();
        } catch (_) {}
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

  handleInternal('layout:set-offsets', (e, partial) => {
    const ctx = getCtxFromSender(e.sender);
    const prevRight = ctx.layoutState?.right || 0;
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
  handleInternal('sidebar:close', (e) => closeSidebarPanel(getCtxFromSender(e.sender)));
  handleInternal('sidebar:set-pinned', (e, pinned) => setSidebarPinned(getCtxFromSender(e.sender), pinned));
  handleInternal('sidebar:reload', (e) => reloadSidebarPanel(getCtxFromSender(e.sender)));
  handleInternal('sidebar:open-in-new-tab', (e) => openSidebarPanelInNewTab(getCtxFromSender(e.sender)));
  handleInternal('sidebar:set-width', (e, arg1, arg2) => {
    const ctx = getCtxFromSender(e.sender);
    const width = typeof arg1 === 'object' && arg1 !== null ? arg1.width : arg1;
    const opts = typeof arg1 === 'object' && arg1 !== null ? arg1 : arg2;
    return setSidebarWidth(ctx, width, opts);
  });
  handleInternal('sidebar:get-state', (e) => serializeSidebarState(getCtxFromSender(e.sender)));

  // Bookmarks, History, Downloads, Passwords, Notes, Extensions, Settings, Profiles, Import/Export
  handleInternal('bookmarks:get', (e) => state.storage.getBookmarks(getSenderProfileId(e)));
  handleInternal('bookmarks:toggle', (e) => {
    const ctx = getCtxFromSender(e.sender);
    const pid = ctx?.profileId || state.storage.getActiveProfileId();
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

  handleInternal('passwords:get', (e) => state.storage.getPasswords(getSenderProfileId(e)));
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
  handleInternal('window:close', (e) => getCtxFromSender(e.sender)?.win?.close());
}

module.exports = {
  registerIpcHandlers,
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
