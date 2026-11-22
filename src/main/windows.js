const { BrowserWindow, session } = require('electron');
const {
  TOP_CHROME_HEIGHT,
  BOOKMARKS_BAR_HEIGHT,
  SIDEBAR_ICON_WIDTH,
  PRIVATE_WINDOW_TITLE,
  APP_ICON_FILE,
  INDEX_FILE,
  PRELOAD_FILE,
  windowContexts,
  webContentsToWinId,
  registerWebContents,
  state
} = require('./core');
const { getInternalUiQuery, attachInternalNavigationGuard } = require('./utils');
const { bringOverlaysToFront, updateActiveViewBounds } = require('./layout');
const { attachKeyboardShortcuts } = require('./shortcuts');
const { attachChromeContextMenu } = require('./context-menu');
const { closePopover } = require('./popovers');
const {
  setupPermissionsForSession,
  cancelPendingPermissionsForWindow
} = require('./permissions');
const {
  sanitizeRestorableTabUrl,
  isDirectDownloadRestoreUrl,
  serializeWindowForSession,
  collectNormalWindowSessions,
  cancelScheduledSessionSave,
  scheduleSessionSave
} = require('./session');
const { createTabInternal, switchTab } = require('./tabs');
const {
  DEFAULT_WORKSPACE_ID,
  getWorkspaces,
  getGroupsForCtx,
  isTabVisibleInWorkspace,
  normalizeGroupContiguity,
  pruneAllEmptyGroups
} = require('./workspaces');
const {
  createSidebarPanelState,
  clampSidebarWidth,
  serializeSidebarState,
  syncSidebarFrameViewState,
  cleanupSidebarPanelViews
} = require('./sidebar');
const { setupDownloadListener, clearIncognitoDownloads } = require('./downloads');
const { collectSystemStats } = require('./stats');
const player = require('./player');
const { registerCornerPreloadForSession } = require('./gxcorner');
const {
  createFullscreenState,
  initFullscreenListeners,
  attachWindowFullscreenHandlers,
  cleanupWindowFullscreen
} = require('./fullscreen');
const { ensureProfileSessionInitialized } = require('./profiles');
const splitViewMod = () => require('./splitview');

function createBrowserWindow({ incognito = false, restoreTabs = null, profileId = null, initialUrl = null } = {}) {
  initFullscreenListeners();

  const resolvedProfileId =
    state.storage && typeof state.storage._resolveProfileId === 'function'
      ? state.storage._resolveProfileId(profileId || undefined)
      : 'default';

  const winSession = incognito
    ? session.fromPartition('incognito-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), { cache: false })
    : ensureProfileSessionInitialized(resolvedProfileId, { setupPermissionsForSession });

  if (incognito) {
    state.adBlocker.attachToSession(winSession);
    setupPermissionsForSession(winSession, resolvedProfileId, { incognito: true });
    setupDownloadListener(winSession, resolvedProfileId, { incognito: true });
    registerCornerPreloadForSession(winSession);
  }

  const profileSettings = state.storage ? state.storage.getSettings(resolvedProfileId) : {};
  const profileObj = state.storage?.getProfileById?.(resolvedProfileId) || null;
  const normalTitle =
    profileObj && resolvedProfileId !== 'default'
      ? `nextGx Browser — ${profileObj.name}`
      : 'nextGx Browser';

  const win = new BrowserWindow({
    width: 1420,
    height: 890,
    minWidth: 960,
    minHeight: 620,
    show: false,
    frame: false,
    ...(APP_ICON_FILE ? { icon: APP_ICON_FILE } : {}),
    backgroundColor: incognito ? '#09090d' : '#12101b',
    title: incognito ? PRIVATE_WINDOW_TITLE : normalTitle,
    webPreferences: {
      preload: PRELOAD_FILE,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const showWindowSafely = () => {
    if (!win.isDestroyed() && !win.isVisible()) {
      win.show();
    }
  };
  win.once('ready-to-show', showWindowSafely);
  const showFallbackTimer = setTimeout(showWindowSafely, 700);
  if (typeof showFallbackTimer.unref === 'function') showFallbackTimer.unref();

  if (incognito) {
    win.on('page-title-updated', (e) => {
      e.preventDefault();
      if (!win.isDestroyed()) {
        win.setTitle(PRIVATE_WINDOW_TITLE);
      }
    });
    win.webContents.on('did-finish-load', () => {
      if (!win.isDestroyed()) {
        win.setTitle(PRIVATE_WINDOW_TITLE);
      }
    });
  }

  const initialTop =
    profileSettings.showBookmarksBar === false
      ? TOP_CHROME_HEIGHT
      : TOP_CHROME_HEIGHT + BOOKMARKS_BAR_HEIGHT;

  const sidebarPanel = createSidebarPanelState();
  sidebarPanel.pinned = Boolean(profileSettings.sidebarPanelPinned);
  sidebarPanel.width = clampSidebarWidth(profileSettings.sidebarPanelWidth);

  const ctx = {
    win,
    incognito: Boolean(incognito),
    profileId: resolvedProfileId,
    skipSessionSave: false,
    session: winSession,
    tabs: new Map(),
    tabOrder: [],
    activeTabId: null,
    split: null,
    splitsByWorkspace: new Map(),
    activeWorkspaceId: DEFAULT_WORKSPACE_ID,
    workspaceLastActiveTab: new Map(),
    privateGroups: [],
    sessionReady: false,
    restoringSession: false,
    pendingRestoreTabs: !incognito && restoreTabs ? restoreTabs : null,
    layoutState: {
      left: SIDEBAR_ICON_WIDTH,
      top: initialTop,
      right: 0,
      bottom: 0
    },
    sidebarPanel,
    sidebarPanelFrameView: null,
    popoverView: null,
    popoverOpenKind: null,
    popoverPayload: null,
    screenshotView: null,
    pendingScreenshotDataUrl: '',
    fullscreen: createFullscreenState()
  };

  windowContexts.set(win.id, ctx);
  registerWebContents(win.webContents, win.id);
  attachInternalNavigationGuard(win.webContents);

  attachKeyboardShortcuts(ctx, win.webContents);
  attachChromeContextMenu(ctx);
  attachWindowFullscreenHandlers(ctx);

  win.loadFile(INDEX_FILE, {
    query: getInternalUiQuery(incognito, resolvedProfileId)
  });

  win.on('resize', () => {
    if (
      ctx.popoverOpenKind === 'tab-context' ||
      ctx.popoverOpenKind === 'bookmark-folder'
    ) {
      closePopover(ctx);
    }
    updateActiveViewBounds(ctx);
    if (ctx.sidebarPanel?.open) {
      syncSidebarFrameViewState(ctx);
    }
  });
  win.on('blur', () => {
    if (
      ctx.popoverOpenKind === 'tab-context' ||
      ctx.popoverOpenKind === 'bookmark-folder'
    ) {
      closePopover(ctx);
    }
  });
  win.on('maximize', () => updateActiveViewBounds(ctx));
  win.on('unmaximize', () => updateActiveViewBounds(ctx));
  win.on('close', () => {
    if (state.isAppQuitting || ctx.incognito || ctx.skipSessionSave || !state.storage) return;
    const pid = ctx.profileId || 'default';
    const otherNormal = collectNormalWindowSessions({ excludeWinId: win.id, profileId: pid });
    if (otherNormal.length === 0) {
      if (ctx.sessionReady) {
        const current = serializeWindowForSession(ctx);
        cancelScheduledSessionSave();
        if (current && current.tabs.length > 0) {
          state.storage.saveSession({ windows: [current] }, pid);
        } else {
          state.storage.saveSession({ windows: [] }, pid);
        }
      } else if (ctx.pendingRestoreTabs) {
        cancelScheduledSessionSave();
        state.storage.saveSession({ windows: [ctx.pendingRestoreTabs] }, pid);
      }
    } else {
      cancelScheduledSessionSave();
      state.storage.saveSession({ windows: otherNormal }, pid);
    }
  });
  win.on('closed', () => {
    clearTimeout(showFallbackTimer);
    cancelPendingPermissionsForWindow(ctx);
    ctx.split = null;
    if (ctx.splitsByWorkspace instanceof Map) {
      ctx.splitsByWorkspace.clear();
    }
    cleanupWindowFullscreen(ctx);
    cleanupSidebarPanelViews(ctx);
    if (ctx.screenshotView) {
      if (ctx.screenshotView.webContents) webContentsToWinId.delete(ctx.screenshotView.webContents.id);
      ctx.screenshotView = null;
    }
    ctx.pendingScreenshotDataUrl = '';
    if (ctx.popoverView) {
      if (ctx.popoverView.webContents) webContentsToWinId.delete(ctx.popoverView.webContents.id);
      ctx.popoverView = null;
    }
    player.onWindowClosed(ctx);
    windowContexts.delete(win.id);
    if (ctx.incognito) {
      const hasRemainingIncognito = Array.from(windowContexts.values()).some((c) => c && c.incognito);
      if (!hasRemainingIncognito) {
        clearIncognitoDownloads();
      }
    } else if (!state.isAppQuitting) {
      const hasRemainingNormalWindow = Array.from(windowContexts.values()).some((c) => c && !c.incognito);
      if (hasRemainingNormalWindow) {
        pruneAllEmptyGroups();
      }
    }
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
      const validWsIds = new Set(getWorkspaces().map((w) => w.id));
      const validGroupsById = new Map(getGroupsForCtx(ctx).map((g) => [g.id, g]));
      const restoredActiveWsId = validWsIds.has(restoreSpec.activeWorkspaceId)
        ? restoreSpec.activeWorkspaceId
        : DEFAULT_WORKSPACE_ID;
      ctx.activeWorkspaceId = restoredActiveWsId;

      const tabsToRestore = restoreSpec.tabs;
      const rawActiveIdx = Number.isInteger(restoreSpec.activeTabIndex) ? restoreSpec.activeTabIndex : 0;
      const targetActiveIdx = Math.max(0, Math.min(tabsToRestore.length - 1, rawActiveIdx));
      let activeTabIdToSelect = null;
      const restoredIndexToTabId = new Map();

      try {
        for (let i = 0; i < tabsToRestore.length; i++) {
          const item = tabsToRestore[i];
          const safeUrl = sanitizeRestorableTabUrl(item?.url);
          if (!safeUrl || isDirectDownloadRestoreUrl(safeUrl, ctx.profileId)) continue;
          const pinned = Boolean(item.pinned);
          const wsId = validWsIds.has(item?.workspaceId) ? item.workspaceId : DEFAULT_WORKSPACE_ID;
          let grpId = null;
          if (!pinned && item?.groupId) {
            const grp = validGroupsById.get(item.groupId);
            if (grp && grp.workspaceId === wsId) {
              grpId = grp.id;
            }
          }
          const created = createTabInternal(ctx, {
            url: safeUrl,
            title: typeof item.title === 'string' ? item.title : undefined,
            pinned,
            workspaceId: wsId,
            groupId: grpId,
            active: false,
            deferActivate: true,
            // Lazy-restore non-active tabs as sleeping stubs to cut startup RAM & load time
            sleeping: true
          });
          if (created) {
            restoredIndexToTabId.set(i, created.id);
            if (i === targetActiveIdx) {
              activeTabIdToSelect = created.id;
            }
          }
        }
      } catch (err) {
        console.error('[Session] Error restoring tabs:', err);
      }

      if (
        restoreSpec.workspaceActiveTabIndices &&
        typeof restoreSpec.workspaceActiveTabIndices === 'object'
      ) {
        for (const [wsId, savedIdx] of Object.entries(restoreSpec.workspaceActiveTabIndices)) {
          if (!validWsIds.has(wsId)) continue;
          const mappedId = restoredIndexToTabId.get(savedIdx);
          const mappedTab = mappedId ? ctx.tabs.get(mappedId) : null;
          if (mappedTab && !mappedTab.pinned) {
            ctx.workspaceLastActiveTab.set(wsId, mappedId);
          }
        }
      }

      normalizeGroupContiguity(ctx);

      if (ctx.tabOrder.length === 0) {
        createTabInternal(ctx, { url: 'nextgx://newtab', workspaceId: ctx.activeWorkspaceId, active: true });
      } else {
        let finalActiveId = null;
        if (activeTabIdToSelect && ctx.tabs.has(activeTabIdToSelect)) {
          const selected = ctx.tabs.get(activeTabIdToSelect);
          if (selected && !selected.pinned && selected.workspaceId !== ctx.activeWorkspaceId) {
            ctx.activeWorkspaceId = selected.workspaceId || DEFAULT_WORKSPACE_ID;
          }
          finalActiveId = activeTabIdToSelect;
        } else {
          const savedWsLast = ctx.workspaceLastActiveTab.get(ctx.activeWorkspaceId);
          if (
            savedWsLast &&
            ctx.tabs.has(savedWsLast) &&
            isTabVisibleInWorkspace(ctx.tabs.get(savedWsLast), ctx.activeWorkspaceId)
          ) {
            finalActiveId = savedWsLast;
          } else {
            finalActiveId =
              ctx.tabOrder.find((id) => isTabVisibleInWorkspace(ctx.tabs.get(id), ctx.activeWorkspaceId)) ||
              null;
          }
        }

        if (finalActiveId && ctx.tabs.has(finalActiveId)) {
          switchTab(ctx, finalActiveId);
        } else {
          createTabInternal(ctx, { url: 'nextgx://newtab', workspaceId: ctx.activeWorkspaceId, active: true });
        }

        if (
          restoreSpec.workspaceSplits &&
          typeof restoreSpec.workspaceSplits === 'object' &&
          !Array.isArray(restoreSpec.workspaceSplits)
        ) {
          for (const [wsId, savedSplit] of Object.entries(restoreSpec.workspaceSplits)) {
            if (!validWsIds.has(wsId) || !savedSplit || typeof savedSplit !== 'object') continue;
            const leftId = restoredIndexToTabId.get(savedSplit.leftIndex);
            const rightId = restoredIndexToTabId.get(savedSplit.rightIndex);
            if (leftId && rightId && leftId !== rightId && ctx.tabs.has(leftId) && ctx.tabs.has(rightId)) {
              splitViewMod().restoreSplitState(ctx, {
                workspaceId: wsId,
                leftTabId: leftId,
                rightTabId: rightId,
                ratio: savedSplit.ratio,
                focusedPane: savedSplit.focusedPane
              });
            }
          }
        } else if (restoreSpec.split && typeof restoreSpec.split === 'object') {
          const leftId = restoredIndexToTabId.get(restoreSpec.split.leftIndex);
          const rightId = restoredIndexToTabId.get(restoreSpec.split.rightIndex);
          if (leftId && rightId && leftId !== rightId && ctx.tabs.has(leftId) && ctx.tabs.has(rightId)) {
            const leftTab = ctx.tabs.get(leftId);
            const rightTab = ctx.tabs.get(rightId);
            let targetWsId = DEFAULT_WORKSPACE_ID;
            if (
              leftTab &&
              !leftTab.pinned &&
              rightTab &&
              !rightTab.pinned &&
              leftTab.workspaceId === rightTab.workspaceId &&
              validWsIds.has(leftTab.workspaceId)
            ) {
              targetWsId = leftTab.workspaceId;
            } else if (leftTab && !leftTab.pinned && rightTab && rightTab.pinned && validWsIds.has(leftTab.workspaceId)) {
              targetWsId = leftTab.workspaceId;
            } else if (rightTab && !rightTab.pinned && leftTab && leftTab.pinned && validWsIds.has(rightTab.workspaceId)) {
              targetWsId = rightTab.workspaceId;
            }
            splitViewMod().restoreSplitState(ctx, {
              workspaceId: targetWsId,
              leftTabId: leftId,
              rightTabId: rightId,
              ratio: restoreSpec.split.ratio,
              focusedPane: restoreSpec.split.focusedPane
            });
          }
        }
      }

      ctx.pendingRestoreTabs = null;
      ctx.restoringSession = false;
      ctx.sessionReady = true;
      pruneAllEmptyGroups(ctx, { broadcast: true });
      scheduleSessionSave(ctx);
    } else {
      ctx.activeWorkspaceId = DEFAULT_WORKSPACE_ID;
      const startUrl = typeof initialUrl === 'string' && initialUrl.trim() ? initialUrl.trim() : 'nextgx://newtab';
      createTabInternal(ctx, { url: startUrl, workspaceId: DEFAULT_WORKSPACE_ID, active: true });
      ctx.pendingRestoreTabs = null;
      ctx.restoringSession = false;
      ctx.sessionReady = true;
      if (!ctx.incognito) {
        pruneAllEmptyGroups(ctx, { broadcast: true });
        scheduleSessionSave(ctx);
      }
    }

    win.webContents.send('sidebar:update', serializeSidebarState(ctx));
    win.webContents.send('adblock:update', state.adBlocker.getStats());
    win.webContents.send('system:stats-update', collectSystemStats());
    player.sendPlayerStateToWebContents(ctx, win.webContents);
  });

  return ctx;
}

function openStartupWindows() {
  const activeProfileId = state.storage.getActiveProfileId();
  const settings = state.storage.getSettings(activeProfileId);
  if (settings.restoreSession !== false) {
    const saved = state.storage.getSession(activeProfileId);
    const savedWindows = Array.isArray(saved?.windows)
      ? saved.windows.filter((w) => w && Array.isArray(w.tabs) && w.tabs.length > 0)
      : [];
    if (savedWindows.length > 0) {
      for (const winSession of savedWindows) {
        createBrowserWindow({ incognito: false, profileId: activeProfileId, restoreTabs: winSession });
      }
      return;
    }
  }
  createBrowserWindow({ incognito: false, profileId: activeProfileId });
}

module.exports = {
  bringOverlaysToFront,
  updateActiveViewBounds,
  setupPermissionsForSession,
  createBrowserWindow,
  openStartupWindows
};
