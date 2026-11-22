const { WebContentsView } = require('electron');
const {
  NEW_TAB_FILE_URL,
  TAB_PRELOAD_FILE,
  registerWebContents,
  state
} = require('./core');
const {
  resolveInternalUiFile,
  isNewTabUrl,
  isCornerUrl,
  isWebUiUrl,
  isErrorPageUrl,
  appendInternalUrlParams,
  sanitizeFaviconUrl
} = require('./utils');
const {
  getFailedUrlFromErrorPage,
  formatFailedTabTitle,
  buildErrorPageUrl,
  formatDisplayUrl,
  resolveNavigateInput
} = require('./navigation');
const {
  serializeTabs,
  broadcastState,
  notifyActiveWebUiTabShown,
  broadcastHistoryUpdate,
  broadcastBookmarksUpdate
} = require('./broadcast');
const { updateActiveViewBounds } = require('./layout');
const { scheduleSessionSave } = require('./session');
const { attachKeyboardShortcuts } = require('./shortcuts');
const { attachWebContentsContextMenu } = require('./context-menu');
const { restoreFocusToActiveTab, closePopover } = require('./popovers');
const gxControl = require('./gxcontrol');
const player = require('./player');
const splitView = require('./splitview');
const sidebarMod = () => require('./sidebar');
const TAB_AUDIO_HOLD_MS = 3000;

function clearTabAudioHoldTimer(tab) {
  if (tab && tab._audioHoldTimer) {
    clearTimeout(tab._audioHoldTimer);
    tab._audioHoldTimer = null;
  }
}
const {
  DEFAULT_WORKSPACE_ID,
  hasWorkspace,
  getGroupById,
  getGroupsForCtx,
  saveGroupsForCtx,
  broadcastGroupsChange,
  getNextGroupName,
  getNextGroupColor,
  isTabVisibleInWorkspace,
  normalizeGroupContiguity,
  pruneGroupIfEmpty
} = require('./workspaces');

function buildWebContentsViewForTab(ctx, tab) {
  state.adBlocker.attachToSession(ctx.session);

  const view = new WebContentsView({
    webPreferences: {
      preload: TAB_PRELOAD_FILE,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      session: ctx.session,
      plugins: true
    }
  });

  const wc = view.webContents;
  registerWebContents(wc, ctx.win.id);
  wc.setUserAgent(wc.getUserAgent().replace(/Electron\/[^\s]+\s?/g, ''));
  attachKeyboardShortcuts(ctx, wc);
  attachWebContentsContextMenu(ctx, wc, { isSidebar: false });

  wc.on('focus', () => {
    splitView.onTabWebContentsFocused(ctx, tab.id);
    if (ctx.popoverOpenKind) closePopover(ctx);
    sidebarMod().closeSidebarIfUnpinned(ctx, { restoreFocus: false });
  });

  wc.setWindowOpenHandler(({ url }) => {
    if (url && /^https?:\/\//i.test(url)) {
      createTab(ctx, { url, incognito: ctx.incognito, active: true });
    }
    return { action: 'deny' };
  });

  wc.on('did-start-loading', () => {
    tab.isLoading = true;
    gxControl.onTabNavigated(ctx, tab, { forceReapply: false });
    broadcastState(ctx);
  });

  wc.on('did-stop-loading', () => {
    tab.isLoading = false;
    tab.canGoBack = wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack();
    tab.canGoForward = wc.navigationHistory ? wc.navigationHistory.canGoForward() : wc.canGoForward();
    state.adBlocker.injectCosmeticFilters(wc);
    const s = state.storage.getSettings(ctx.profileId);
    if (s.forceDarkWeb && /^https?:/i.test(tab.url)) {
      wc.insertCSS(`html { filter: invert(0.92) hue-rotate(180deg) !important; background: #0d0e12 !important; } img, video, iframe, canvas { filter: invert(1) hue-rotate(180deg) !important; }`).catch(() => {});
    }
    broadcastState(ctx);
  });

  const shouldSkipHistory = (url) =>
    !url ||
    isNewTabUrl(url) ||
    isCornerUrl(url) ||
    isWebUiUrl(url) ||
    isErrorPageUrl(url) ||
    url.startsWith('chrome-error://');

  wc.on('page-title-updated', (_e, title) => {
    if (isNewTabUrl(tab.url)) {
      tab.title = ctx.incognito ? 'Private Start' : 'Start Page';
    } else if (isCornerUrl(tab.url)) {
      tab.title = 'GX Corner';
    } else if (isErrorPageUrl(tab.url)) {
      const failedUrl = getFailedUrlFromErrorPage(tab.url);
      tab.title = title || formatFailedTabTitle(failedUrl);
    } else {
      tab.title = title;
    }
    if (!ctx.incognito && !shouldSkipHistory(tab.url)) {
      state.storage.addHistory({ title: tab.title, url: tab.url, favicon: tab.favicon, isVisit: false }, ctx.profileId);
      broadcastHistoryUpdate({ profileId: ctx.profileId });
    }
    player.onTabMetadataChanged(ctx, tab);
    broadcastState(ctx);
    scheduleSessionSave(ctx);
  });

  wc.on('page-favicon-updated', (_e, favicons) => {
    if (Array.isArray(favicons) && favicons.length > 0 && !isErrorPageUrl(tab.url)) {
      const safeFavicon = sanitizeFaviconUrl(favicons[0]);
      if (!safeFavicon || safeFavicon === tab.favicon) return;
      tab.favicon = safeFavicon;
      if (!ctx.incognito && !shouldSkipHistory(tab.url)) {
        state.storage.addHistory({ title: tab.title, url: tab.url, favicon: tab.favicon, isVisit: false }, ctx.profileId);
        broadcastHistoryUpdate({ profileId: ctx.profileId });
        const updatedBookmarks = state.storage.updateBookmarkFavicon(tab.url, tab.favicon, ctx.profileId);
        if (updatedBookmarks) {
          broadcastBookmarksUpdate(updatedBookmarks, { profileId: ctx.profileId });
        }
      }
      player.onTabMetadataChanged(ctx, tab);
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
    } else if (isCornerUrl(url)) {
      tab.title = 'GX Corner';
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
      state.storage.addHistory({ title: tab.title, url, favicon: tab.favicon }, ctx.profileId);
      broadcastHistoryUpdate({ profileId: ctx.profileId });
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
      isCornerUrl(failedUrl) ||
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
    clearTabAudioHoldTimer(tab);
    tab.audible = Boolean(typeof wc.isCurrentlyAudible === 'function' && wc.isCurrentlyAudible());
    state.adBlocker.clearCosmeticKeys(wc);
    player.onTabNavigated(ctx, tab);
    handleUrlChange(url);
    gxControl.onTabNavigated(ctx, tab, { forceReapply: true });
  });
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    if (isMainFrame) handleUrlChange(url);
  });
  wc.on('dom-ready', () => state.adBlocker.injectCosmeticFilters(wc));
  wc.on('audio-state-changed', (event) => {
    const isAudibleNow = Boolean(event.audible);
    player.onTabAudioChanged(ctx, tab, isAudibleNow);
    if (isAudibleNow) {
      clearTabAudioHoldTimer(tab);
      if (!tab.audible) {
        tab.audible = true;
        broadcastState(ctx);
      }
    } else if (tab.audible && !tab._audioHoldTimer) {
      tab._audioHoldTimer = setTimeout(() => {
        tab._audioHoldTimer = null;
        if (!ctx || !ctx.win || ctx.win.isDestroyed()) return;
        if (ctx.tabs.get(tab.id) !== tab || tab.sleeping) return;
        const stillAudible = Boolean(
          tab.view &&
            tab.view.webContents &&
            !tab.view.webContents.isDestroyed() &&
            typeof tab.view.webContents.isCurrentlyAudible === 'function' &&
            tab.view.webContents.isCurrentlyAudible()
        );
        if (!stillAudible && tab.audible) {
          tab.audible = false;
          broadcastState(ctx);
        }
      }, TAB_AUDIO_HOLD_MS);
    }
  });
  wc.once('destroyed', () => {
    clearTabAudioHoldTimer(tab);
    player.onWebContentsDestroyed(wc.id);
  });
  wc.on('found-in-page', (_event, result) => {
    if (!ctx.win || ctx.win.isDestroyed()) return;
    if (tab.id !== ctx.activeTabId || !result) return;
    if (tab.lastFindRequestId === null || result.requestId < tab.lastFindRequestId) return;
    ctx.win.webContents.send('find:result', {
      tabId: tab.id,
      requestId: result.requestId,
      activeMatchOrdinal: Number(result.activeMatchOrdinal) || 0,
      matches: Number(result.matches) || 0,
      finalUpdate: Boolean(result.finalUpdate)
    });
  });

  ctx.win.contentView.addChildView(view);
  tab.view = view;
  gxControl.onTabViewCreated(ctx, tab);
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
  if (isNewTabUrl(tab.url) || isCornerUrl(tab.url) || isWebUiUrl(tab.url)) {
    return formatDisplayUrl(tab.url);
  }
  const liveUrl =
    tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()
      ? tab.view.webContents.getURL()
      : '';
  if (liveUrl && !liveUrl.startsWith('chrome-error://') && !isErrorPageUrl(liveUrl)) {
    if (isNewTabUrl(liveUrl) || isCornerUrl(liveUrl) || isWebUiUrl(liveUrl)) {
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
    !isCornerUrl(tab.url) &&
    !isWebUiUrl(tab.url) &&
    !isErrorPageUrl(tab.url) &&
    !displayUrl.startsWith('nextgx://') &&
    !displayUrl.startsWith('gx://') &&
    !displayUrl.startsWith('chrome://') &&
    !tab.url.startsWith('file://') &&
    !tab.url.startsWith('about:')
  ) {
    state.storage.addClosedTab({
      title: tab.title && tab.title !== 'Loading...' ? tab.title : tab.url,
      url: tab.url,
      favicon: tab.favicon || ''
    }, ctx.profileId);
    broadcastHistoryUpdate({ profileId: ctx.profileId });
  }
}

function createTabInternal(
  ctx,
  {
    url = 'nextgx://newtab',
    pinned = false,
    active = true,
    insertIndex,
    title,
    deferActivate = false,
    sleeping = false,
    workspaceId,
    groupId = null
  } = {}
) {
  const id = 'tab-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const resolvedUrl = appendInternalUrlParams(resolveNavigateInput(url), ctx);
  const initialTitle = isNewTabUrl(resolvedUrl)
    ? ctx.incognito
      ? 'Private Start'
      : 'Start Page'
    : isCornerUrl(resolvedUrl)
    ? 'GX Corner'
    : typeof title === 'string' && title.trim()
    ? title.trim().slice(0, 300)
    : 'Loading...';

  const isPinned = Boolean(pinned);
  const resolvedWsId = ctx.incognito
    ? DEFAULT_WORKSPACE_ID
    : workspaceId && hasWorkspace(workspaceId)
    ? workspaceId
    : ctx.activeWorkspaceId || DEFAULT_WORKSPACE_ID;

  let resolvedGroupId = null;
  if (!isPinned && groupId) {
    const grp = getGroupById(ctx, groupId);
    if (grp && grp.workspaceId === resolvedWsId) {
      resolvedGroupId = grp.id;
    }
  }

  const startAsleep = Boolean(sleeping && deferActivate);
  const tab = {
    id,
    title: initialTitle,
    url: resolvedUrl,
    failedUrl: '',
    favicon: '',
    isLoading: !startAsleep,
    canGoBack: false,
    canGoForward: false,
    pinned: isPinned,
    workspaceId: resolvedWsId,
    groupId: resolvedGroupId,
    incognito: Boolean(ctx.incognito),
    sleeping: startAsleep,
    audible: false,
    readerMode: false,
    zoomFactor: 1.0,
    lastFindRequestId: null,
    lastActiveAt: Date.now(),
    view: null
  };

  if (!startAsleep) {
    tab.view = buildWebContentsViewForTab(ctx, tab);
  }
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
  } else if (resolvedGroupId) {
    const lastGroupIdx = ctx.tabOrder.findLastIndex((tid) => {
      const existing = ctx.tabs.get(tid);
      return existing && !existing.pinned && existing.groupId === resolvedGroupId;
    });
    if (lastGroupIdx !== -1) {
      ctx.tabOrder.splice(lastGroupIdx + 1, 0, id);
    } else {
      ctx.tabOrder.push(id);
    }
  } else {
    ctx.tabOrder.push(id);
  }
  syncTabsMapOrder(ctx);

  if (tab.view) {
    tab.view.webContents.loadURL(resolvedUrl).catch(() => {});
  }

  if (deferActivate) {
    if (tab.view) {
      if (typeof tab.view.setVisible === 'function') {
        try {
          tab.view.setVisible(false);
        } catch (_) {}
      }
      tab.view.setBounds({ x: -5000, y: -5000, width: 1, height: 1 });
    }
  } else if (active || !ctx.activeTabId) {
    switchTab(ctx, id);
  } else {
    updateActiveViewBounds(ctx);
    broadcastState(ctx);
    scheduleSessionSave(ctx);
  }

  return tab;
}

function createTab(
  ctx,
  { url = 'nextgx://newtab', pinned = false, active = true, insertIndex, workspaceId, groupId = null } = {}
) {
  createTabInternal(ctx, { url, pinned, active, insertIndex, workspaceId, groupId });
  return serializeTabs(ctx);
}

function wakeTab(ctx, tab) {
  if (!tab || !tab.sleeping) return;
  tab.sleeping = false;
  tab.lastActiveAt = Date.now();
  tab.view = buildWebContentsViewForTab(ctx, tab);
  const wc = tab.view.webContents;
  const applyTabZoom = () => {
    if (!wc.isDestroyed()) {
      wc.setZoomFactor(tab.zoomFactor || 1);
    }
  };
  applyTabZoom();
  wc.once('dom-ready', applyTabZoom);
  wc.once('did-finish-load', applyTabZoom);
  const targetUrl = appendInternalUrlParams(tab.url || NEW_TAB_FILE_URL, ctx);
  tab.url = targetUrl;
  wc.loadURL(targetUrl).catch(() => {});
}

function switchTab(ctx, tabId) {
  const tab = ctx.tabs.get(tabId);
  if (!tab) return serializeTabs(ctx);
  const prevWsId = ctx.incognito ? DEFAULT_WORKSPACE_ID : ctx.activeWorkspaceId || DEFAULT_WORKSPACE_ID;
  if (ctx.activeTabId && ctx.activeTabId !== tabId && ctx.tabs.has(ctx.activeTabId)) {
    const prevTab = ctx.tabs.get(ctx.activeTabId);
    prevTab.lastActiveAt = Date.now();
    if (ctx.workspaceLastActiveTab instanceof Map && !prevTab.pinned && isTabVisibleInWorkspace(prevTab, prevWsId)) {
      ctx.workspaceLastActiveTab.set(prevWsId, ctx.activeTabId);
    }
    if (prevTab.lastFindRequestId !== null) {
      prevTab.lastFindRequestId = null;
      if (prevTab.view && prevTab.view.webContents && !prevTab.view.webContents.isDestroyed()) {
        try {
          prevTab.view.webContents.stopFindInPage('clearSelection');
        } catch (_) {}
      }
    }
  }
  if (!ctx.incognito && !tab.pinned) {
    const tabWsId = tab.workspaceId || DEFAULT_WORKSPACE_ID;
    if (tabWsId !== ctx.activeWorkspaceId && hasWorkspace(tabWsId)) {
      ctx.activeWorkspaceId = tabWsId;
    }
  }
  ctx.activeTabId = tabId;
  if (ctx.workspaceLastActiveTab instanceof Map && !tab.pinned) {
    const activeWsId = ctx.incognito ? DEFAULT_WORKSPACE_ID : ctx.activeWorkspaceId || DEFAULT_WORKSPACE_ID;
    ctx.workspaceLastActiveTab.set(activeWsId, tabId);
  }
  tab.lastActiveAt = Date.now();
  if (tab.sleeping) wakeTab(ctx, tab);
  const splitSwitch = splitView.onTabSwitched(ctx, tabId);
  gxControl.onActiveTabChanged(ctx);
  updateActiveViewBounds(ctx);
  if (
    splitSwitch.inVisibleSplit &&
    !ctx.restoringSession &&
    tab.view &&
    tab.view.webContents &&
    !tab.view.webContents.isDestroyed()
  ) {
    try {
      tab.view.webContents.focus();
    } catch (_) {}
  }
  notifyActiveWebUiTabShown(ctx);
  broadcastState(ctx);
  scheduleSessionSave(ctx);
  return serializeTabs(ctx);
}

function sleepTab(ctx, tabId) {
  const tab = ctx.tabs.get(tabId);
  if (!tab || tab.sleeping || tabId === ctx.activeTabId || splitView.isTabInVisibleSplit(ctx, tabId)) {
    return serializeTabs(ctx);
  }
  player.onTabHibernated(ctx, tab);
  clearTabAudioHoldTimer(tab);
  if (tab.view) {
    gxControl.onTabDetached(tab);
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
    const pipActive = Boolean(tab?.pipActive || player.getTabVideoState(tab)?.pipActive);
    if (
      id !== ctx.activeTabId &&
      !tab.sleeping &&
      !tab.pinned &&
      !tab.audible &&
      !pipActive &&
      !splitView.isTabInVisibleSplit(ctx, id)
    ) {
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
  const wasPinned = Boolean(tab.pinned);
  const prevGroupId = tab.pinned ? null : tab.groupId || null;
  const activeWsId = ctx.incognito ? DEFAULT_WORKSPACE_ID : ctx.activeWorkspaceId || DEFAULT_WORKSPACE_ID;
  const splitClose = splitView.onTabClosing(ctx, tabId);
  const prevVisibleOrder = ctx.tabOrder.filter((id) =>
    isTabVisibleInWorkspace(ctx.tabs.get(id), activeWsId)
  );
  const prevVisibleIdx = prevVisibleOrder.indexOf(tabId);

  const wasFocused = Boolean(
    tab.view &&
      tab.view.webContents &&
      !tab.view.webContents.isDestroyed() &&
      tab.view.webContents.isFocused()
  );

  recordClosedTabIfEligible(ctx, tab);

  const idx = ctx.tabOrder.indexOf(tabId);
  if (idx !== -1) ctx.tabOrder.splice(idx, 1);

  player.onTabClosed(ctx, tab);
  clearTabAudioHoldTimer(tab);
  if (tab.view) {
    gxControl.onTabDetached(tab);
    try {
      ctx.win.contentView.removeChildView(tab.view);
      tab.view.webContents.close();
    } catch (_) {}
    tab.view = null;
  }
  ctx.tabs.delete(tabId);

  if (ctx.workspaceLastActiveTab instanceof Map) {
    for (const [wsId, lastId] of ctx.workspaceLastActiveTab.entries()) {
      if (lastId === tabId) ctx.workspaceLastActiveTab.delete(wsId);
    }
  }

  const prunedGroup = prevGroupId ? pruneGroupIfEmpty(ctx, prevGroupId, { broadcast: false }) : false;

  if (ctx.tabOrder.length === 0) {
    const s = state.storage.getSettings();
    if (s.closeWindowOnLastTab) {
      if (prunedGroup) broadcastGroupsChange(ctx);
      ctx.win?.close();
      return serializeTabs(ctx);
    }
    const nextState = createTab(ctx, { url: 'nextgx://newtab', workspaceId: activeWsId, active: true });
    if (prunedGroup) broadcastGroupsChange(ctx);
    if (wasActive || wasFocused) {
      restoreFocusToActiveTab(ctx);
    }
    return nextState;
  }

  const remainingWsUnpinned = ctx.tabOrder.filter((id) => {
    const t = ctx.tabs.get(id);
    return t && !t.pinned && (ctx.incognito ? DEFAULT_WORKSPACE_ID : t.workspaceId || DEFAULT_WORKSPACE_ID) === activeWsId;
  });
  const remainingVisible = ctx.tabOrder.filter((id) =>
    isTabVisibleInWorkspace(ctx.tabs.get(id), activeWsId)
  );

  if (remainingVisible.length === 0 || (!wasPinned && remainingWsUnpinned.length === 0)) {
    const nextState = createTab(ctx, { url: 'nextgx://newtab', workspaceId: activeWsId, active: true });
    if (prunedGroup) broadcastGroupsChange(ctx);
    if (wasActive || wasFocused) {
      restoreFocusToActiveTab(ctx);
    }
    return nextState;
  }

  if (wasActive) {
    const partnerTab =
      splitClose.partnerTabId && ctx.tabs.has(splitClose.partnerTabId)
        ? ctx.tabs.get(splitClose.partnerTabId)
        : null;
    if (partnerTab && isTabVisibleInWorkspace(partnerTab, activeWsId)) {
      ctx.activeTabId = partnerTab.id;
    } else {
      const nextIdx = Math.min(Math.max(0, prevVisibleIdx), remainingVisible.length - 1);
      ctx.activeTabId = remainingVisible[nextIdx];
    }
    const nextTab = ctx.tabs.get(ctx.activeTabId);
    if (ctx.workspaceLastActiveTab instanceof Map && nextTab && !nextTab.pinned) {
      ctx.workspaceLastActiveTab.set(activeWsId, ctx.activeTabId);
    }
    if (nextTab && nextTab.sleeping) wakeTab(ctx, nextTab);
    gxControl.onActiveTabChanged(ctx);
  }

  updateActiveViewBounds(ctx);
  if (wasActive || wasFocused) {
    restoreFocusToActiveTab(ctx);
  }
  if (wasActive) {
    notifyActiveWebUiTabShown(ctx);
  }
  if (prunedGroup) {
    broadcastGroupsChange(ctx);
  } else {
    broadcastState(ctx);
  }
  scheduleSessionSave(ctx);
  return serializeTabs(ctx);
}

function closeOtherTabs(ctx, keepTabId) {
  const keepTab = ctx.tabs.get(keepTabId);
  if (!keepTab) return serializeTabs(ctx);

  const activeWsId = ctx.incognito ? DEFAULT_WORKSPACE_ID : ctx.activeWorkspaceId || DEFAULT_WORKSPACE_ID;
  const toClose = ctx.tabOrder.filter((id) => {
    if (id === keepTabId) return false;
    const t = ctx.tabs.get(id);
    if (!t || t.pinned) return false;
    return (t.workspaceId || DEFAULT_WORKSPACE_ID) === activeWsId;
  });

  const activeChanged = ctx.activeTabId !== keepTabId;
  const affectedGroups = new Set();
  const closedIds = new Set();

  for (const id of toClose) {
    const tab = ctx.tabs.get(id);
    if (!tab) continue;
    if (tab.groupId) affectedGroups.add(tab.groupId);
    closedIds.add(id);
    recordClosedTabIfEligible(ctx, tab);
    player.onTabClosed(ctx, tab);
    if (tab.view) {
      gxControl.onTabDetached(tab);
      try {
        ctx.win.contentView.removeChildView(tab.view);
        tab.view.webContents.close();
      } catch (_) {}
      tab.view = null;
    }
    ctx.tabs.delete(id);
  }

  ctx.tabOrder = ctx.tabOrder.filter((id) => ctx.tabs.has(id));
  syncTabsMapOrder(ctx);
  splitView.onTabsClosed(ctx, closedIds);

  if (ctx.workspaceLastActiveTab instanceof Map && closedIds.size > 0) {
    for (const [wsId, lastId] of ctx.workspaceLastActiveTab.entries()) {
      if (closedIds.has(lastId)) ctx.workspaceLastActiveTab.delete(wsId);
    }
  }

  let prunedAnyGroup = false;
  for (const gid of affectedGroups) {
    if (pruneGroupIfEmpty(ctx, gid, { broadcast: false })) {
      prunedAnyGroup = true;
    }
  }

  const remainingWsUnpinned = ctx.tabOrder.filter((id) => {
    const t = ctx.tabs.get(id);
    return t && !t.pinned && (ctx.incognito ? DEFAULT_WORKSPACE_ID : t.workspaceId || DEFAULT_WORKSPACE_ID) === activeWsId;
  });

  if (remainingWsUnpinned.length === 0) {
    const created = createTabInternal(ctx, {
      url: 'nextgx://newtab',
      workspaceId: activeWsId,
      active: true
    });
    if (created && ctx.workspaceLastActiveTab instanceof Map) {
      ctx.workspaceLastActiveTab.set(activeWsId, created.id);
    }
    if (prunedAnyGroup) {
      broadcastGroupsChange(ctx);
    }
    return serializeTabs(ctx);
  }

  if (activeChanged) {
    ctx.activeTabId = keepTabId;
    keepTab.lastActiveAt = Date.now();
    if (ctx.workspaceLastActiveTab instanceof Map && !keepTab.pinned && isTabVisibleInWorkspace(keepTab, activeWsId)) {
      ctx.workspaceLastActiveTab.set(activeWsId, keepTabId);
    }
  }
  if (keepTab.sleeping) {
    wakeTab(ctx, keepTab);
  }
  if (activeChanged) {
    gxControl.onActiveTabChanged(ctx);
  }

  updateActiveViewBounds(ctx);
  if (activeChanged) {
    restoreFocusToActiveTab(ctx);
    notifyActiveWebUiTabShown(ctx);
  }
  if (prunedAnyGroup) {
    broadcastGroupsChange(ctx);
  } else {
    broadcastState(ctx);
  }
  scheduleSessionSave(ctx);
  return serializeTabs(ctx);
}

function duplicateTab(ctx, tabId) {
  const orig = ctx.tabs.get(tabId);
  if (!orig) return serializeTabs(ctx);
  const origIdx = ctx.tabOrder.indexOf(tabId);
  const dupUrl = getTabSourceUrl(orig);
  const targetWsId = ctx.incognito
    ? DEFAULT_WORKSPACE_ID
    : orig.pinned
    ? ctx.activeWorkspaceId || DEFAULT_WORKSPACE_ID
    : orig.workspaceId || ctx.activeWorkspaceId || DEFAULT_WORKSPACE_ID;
  const targetGroupId = !orig.pinned && orig.groupId ? orig.groupId : null;
  return createTab(ctx, {
    url: dupUrl,
    pinned: false,
    active: true,
    workspaceId: targetWsId,
    groupId: targetGroupId,
    insertIndex: !orig.pinned && origIdx >= 0 ? origIdx + 1 : undefined
  });
}

function reorderTab(ctx, opts = {}) {
  if (!ctx || !opts) return serializeTabs(ctx);
  const tabId = opts.tabId || opts.fromId;
  const targetTabId = opts.targetTabId || opts.toId || null;
  const targetGroupId = opts.targetGroupId || null;
  const position =
    opts.position === 'after'
      ? 'after'
      : opts.position === 'center' || opts.position === 'into'
      ? 'center'
      : 'before';
  const toIndex = opts.toIndex;
  const toEnd = Boolean(opts.toEnd);
  const forceUngroup = Boolean(opts.ungroup);

  const tab = tabId ? ctx.tabs.get(tabId) : null;
  if (!tab) return serializeTabs(ctx);

  const pinnedIds = ctx.tabOrder.filter((id) => ctx.tabs.get(id)?.pinned);

  // Pinned tabs are global and never belong to groups
  if (tab.pinned) {
    const normalIds = ctx.tabOrder.filter((id) => !ctx.tabs.get(id)?.pinned);
    const fromIdx = pinnedIds.indexOf(tabId);
    if (fromIdx === -1) return serializeTabs(ctx);

    if (toEnd) {
      pinnedIds.splice(fromIdx, 1);
      pinnedIds.push(tabId);
    } else if (targetTabId && targetTabId !== tabId && ctx.tabs.has(targetTabId)) {
      const targetTab = ctx.tabs.get(targetTabId);
      pinnedIds.splice(fromIdx, 1);
      if (targetTab.pinned) {
        const targetIdx = pinnedIds.indexOf(targetTabId);
        if (targetIdx !== -1) {
          pinnedIds.splice(position === 'after' ? targetIdx + 1 : targetIdx, 0, tabId);
        } else {
          pinnedIds.push(tabId);
        }
      } else {
        pinnedIds.push(tabId);
      }
    } else if (typeof toIndex === 'number' && Number.isFinite(toIndex)) {
      pinnedIds.splice(fromIdx, 1);
      const dst = Math.max(0, Math.min(pinnedIds.length, Math.round(toIndex)));
      pinnedIds.splice(dst, 0, tabId);
    } else {
      return serializeTabs(ctx);
    }

    ctx.tabOrder = [...pinnedIds, ...normalIds];
    syncTabsMapOrder(ctx);
    broadcastState(ctx);
    scheduleSessionSave(ctx);
    return serializeTabs(ctx);
  }

  // Unpinned tab: reorder within its workspace and splice into global tabOrder without re-partitioning other workspaces
  const tabWsId = ctx.incognito ? DEFAULT_WORKSPACE_ID : tab.workspaceId || DEFAULT_WORKSPACE_ID;
  const wsIds = ctx.tabOrder.filter((id) => {
    const t = ctx.tabs.get(id);
    return t && !t.pinned && (ctx.incognito ? DEFAULT_WORKSPACE_ID : t.workspaceId || DEFAULT_WORKSPACE_ID) === tabWsId;
  });

  const fromWsIdx = wsIds.indexOf(tabId);
  if (fromWsIdx === -1) return serializeTabs(ctx);

  const prevGroupId = tab.groupId || null;
  let groupsMutated = false;

  const findGroupBounds = (ids, gid) => {
    let first = -1;
    let last = -1;
    for (let i = 0; i < ids.length; i++) {
      const t = ctx.tabs.get(ids[i]);
      if (t && t.groupId === gid) {
        if (first === -1) first = i;
        last = i;
      }
    }
    return { first, last };
  };

  if (toEnd) {
    wsIds.splice(fromWsIdx, 1);
    if (opts.ungroup !== false) {
      tab.groupId = null;
    }
    wsIds.push(tabId);
  } else if (targetGroupId) {
    const targetGroup = getGroupById(ctx, targetGroupId);
    if (!targetGroup || targetGroup.workspaceId !== tabWsId) {
      return serializeTabs(ctx);
    }
    wsIds.splice(fromWsIdx, 1);
    const { first, last } = findGroupBounds(wsIds, targetGroupId);
    if (first === -1) {
      // Tab was the only member of targetGroup
      if (position === 'before' || position === 'after' || forceUngroup) {
        tab.groupId = null;
      } else {
        tab.groupId = targetGroupId;
      }
      wsIds.splice(Math.min(fromWsIdx, wsIds.length), 0, tabId);
    } else if (position === 'before') {
      tab.groupId = null;
      wsIds.splice(first, 0, tabId);
    } else if (position === 'after') {
      tab.groupId = null;
      wsIds.splice(last + 1, 0, tabId);
    } else {
      // Dropped onto group pill -> join group
      tab.groupId = targetGroupId;
      const insertAt = opts.atStart ? first : last + 1;
      wsIds.splice(insertAt, 0, tabId);
    }
  } else if (targetTabId && targetTabId !== tabId && ctx.tabs.has(targetTabId)) {
    const targetTab = ctx.tabs.get(targetTabId);
    wsIds.splice(fromWsIdx, 1);
    if (targetTab.pinned) {
      tab.groupId = null;
      wsIds.unshift(tabId);
    } else {
      const targetWsIdx = wsIds.indexOf(targetTabId);
      if (targetWsIdx === -1) {
        wsIds.push(tabId);
      } else if (position === 'center') {
        if (targetTab.groupId && getGroupById(ctx, targetTab.groupId)) {
          tab.groupId = targetTab.groupId;
          wsIds.splice(targetWsIdx + 1, 0, tabId);
        } else {
          // Centre-drop onto an ungrouped tab creates a new tab island/group
          const newGroup = {
            id: 'grp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
            workspaceId: tabWsId,
            name: getNextGroupName(ctx, tabWsId),
            color: getNextGroupColor(ctx, tabWsId),
            collapsed: false,
            createdAt: Date.now()
          };
          saveGroupsForCtx(ctx, [...getGroupsForCtx(ctx), newGroup]);
          targetTab.groupId = newGroup.id;
          tab.groupId = newGroup.id;
          wsIds.splice(targetWsIdx + 1, 0, tabId);
          groupsMutated = true;
        }
      } else if (forceUngroup) {
        tab.groupId = null;
        if (targetTab.groupId) {
          const { first, last } = findGroupBounds(wsIds, targetTab.groupId);
          if (first !== -1) {
            wsIds.splice(position === 'after' ? last + 1 : first, 0, tabId);
          } else {
            wsIds.splice(position === 'after' ? targetWsIdx + 1 : targetWsIdx, 0, tabId);
          }
        } else {
          wsIds.splice(position === 'after' ? targetWsIdx + 1 : targetWsIdx, 0, tabId);
        }
      } else {
        // Edge-drop (before/after) on a tab: keep the dragged tab's existing groupId
        // (reorder within its own group if it has one, stay ungrouped if it doesn't).
        const existingGroupId = tab.groupId && getGroupById(ctx, tab.groupId) ? tab.groupId : null;
        tab.groupId = existingGroupId;
        if (existingGroupId) {
          if (targetTab.groupId === existingGroupId) {
            const insertIdx = position === 'after' ? targetWsIdx + 1 : targetWsIdx;
            wsIds.splice(insertIdx, 0, tabId);
          } else {
            const ownBounds = findGroupBounds(wsIds, existingGroupId);
            if (ownBounds.first !== -1) {
              const insertIdx = targetWsIdx <= ownBounds.first ? ownBounds.first : ownBounds.last + 1;
              wsIds.splice(insertIdx, 0, tabId);
            } else {
              const insertIdx = position === 'after' ? targetWsIdx + 1 : targetWsIdx;
              wsIds.splice(insertIdx, 0, tabId);
            }
          }
        } else if (targetTab.groupId && getGroupById(ctx, targetTab.groupId)) {
          const { first, last } = findGroupBounds(wsIds, targetTab.groupId);
          if (first !== -1) {
            wsIds.splice(position === 'after' ? last + 1 : first, 0, tabId);
          } else {
            wsIds.splice(position === 'after' ? targetWsIdx + 1 : targetWsIdx, 0, tabId);
          }
        } else {
          const insertIdx = position === 'after' ? targetWsIdx + 1 : targetWsIdx;
          wsIds.splice(insertIdx, 0, tabId);
        }
      }
    }
  } else if (typeof toIndex === 'number' && Number.isFinite(toIndex)) {
    wsIds.splice(fromWsIdx, 1);
    const dst = Math.max(0, Math.min(wsIds.length, Math.round(toIndex) - pinnedIds.length));
    wsIds.splice(dst, 0, tabId);
    const leftTab = dst > 0 ? ctx.tabs.get(wsIds[dst - 1]) : null;
    const rightTab = dst + 1 < wsIds.length ? ctx.tabs.get(wsIds[dst + 1]) : null;
    if (leftTab?.groupId && leftTab.groupId === rightTab?.groupId) {
      tab.groupId = leftTab.groupId;
    } else if (tab.groupId && leftTab?.groupId !== tab.groupId && rightTab?.groupId !== tab.groupId) {
      tab.groupId = null;
    }
  } else {
    return serializeTabs(ctx);
  }

  // Splice moved tab within global ctx.tabOrder at its destination index in global coordinates
  const curGlobalIdx = ctx.tabOrder.indexOf(tabId);
  if (curGlobalIdx !== -1) {
    ctx.tabOrder.splice(curGlobalIdx, 1);
  }
  const newWsIdx = wsIds.indexOf(tabId);
  let globalDstIdx = ctx.tabOrder.length;
  if (wsIds.length <= 1 || newWsIdx === -1) {
    globalDstIdx =
      curGlobalIdx !== -1
        ? Math.max(pinnedIds.length, Math.min(ctx.tabOrder.length, curGlobalIdx))
        : ctx.tabOrder.length;
  } else if (newWsIdx === 0) {
    const nextSiblingIdx = ctx.tabOrder.indexOf(wsIds[1]);
    globalDstIdx = nextSiblingIdx !== -1 ? Math.max(pinnedIds.length, nextSiblingIdx) : ctx.tabOrder.length;
  } else {
    const prevSiblingIdx = ctx.tabOrder.indexOf(wsIds[newWsIdx - 1]);
    globalDstIdx = prevSiblingIdx !== -1 ? prevSiblingIdx + 1 : ctx.tabOrder.length;
  }
  ctx.tabOrder.splice(globalDstIdx, 0, tabId);
  normalizeGroupContiguity(ctx);

  if (prevGroupId && prevGroupId !== tab.groupId) {
    if (pruneGroupIfEmpty(ctx, prevGroupId, { broadcast: false })) {
      groupsMutated = true;
    }
  }

  if (groupsMutated) {
    broadcastGroupsChange(ctx);
  } else {
    broadcastState(ctx);
  }
  scheduleSessionSave(ctx);
  return serializeTabs(ctx);
}

function reopenLastClosedTab(ctx) {
  if (!ctx || !state.storage) return null;
  const closed = state.storage.getClosedTabs(ctx.profileId);
  const latest = Array.isArray(closed) ? closed.find((t) => t && t.url) : null;
  if (!latest) return null;
  if (latest.id) {
    state.storage.removeClosedTab(latest.id, ctx.profileId);
    broadcastHistoryUpdate({ profileId: ctx.profileId });
  }
  return createTab(ctx, { url: latest.url, active: true });
}

function togglePinTab(ctx, tabId) {
  const tab = ctx.tabs.get(tabId);
  if (!tab) return serializeTabs(ctx);

  const prevGroupId = tab.pinned ? null : tab.groupId || null;
  tab.pinned = !tab.pinned;
  tab.groupId = null;

  let prunedGroup = false;
  if (tab.pinned) {
    if (prevGroupId) {
      prunedGroup = pruneGroupIfEmpty(ctx, prevGroupId, { broadcast: false });
    }
  } else {
    if (ctx.incognito) {
      tab.workspaceId = DEFAULT_WORKSPACE_ID;
    } else if (!tab.workspaceId || !hasWorkspace(tab.workspaceId)) {
      tab.workspaceId = ctx.activeWorkspaceId || DEFAULT_WORKSPACE_ID;
    }
    if (!ctx.incognito && tab.id === ctx.activeTabId && tab.workspaceId !== ctx.activeWorkspaceId) {
      ctx.activeWorkspaceId = tab.workspaceId;
      if (ctx.workspaceLastActiveTab instanceof Map) {
        ctx.workspaceLastActiveTab.set(ctx.activeWorkspaceId, tab.id);
      }
    }
  }

  const pinnedIds = ctx.tabOrder.filter((id) => ctx.tabs.get(id)?.pinned);
  const normalIds = ctx.tabOrder.filter((id) => !ctx.tabs.get(id)?.pinned);
  ctx.tabOrder = [...pinnedIds, ...normalIds];
  normalizeGroupContiguity(ctx);

  const hadSplit = Boolean(ctx.split);
  const splitAfter = splitView.onTabSwitched(ctx, ctx.activeTabId);
  if (hadSplit || splitAfter.inVisibleSplit || ctx.split) {
    updateActiveViewBounds(ctx);
  }
  if (prunedGroup) {
    broadcastGroupsChange(ctx);
  } else {
    broadcastState(ctx);
  }
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

function openOrFocusGxCornerTab(ctx) {
  // n-2: the old guard called serializeTabs(ctx) for a null ctx, but
  // serializeTabs dereferences ctx immediately, so it still threw. Return a
  // minimal state object with the same shape instead.
  if (!ctx) {
    return {
      windowIncognito: false,
      profileId: 'default',
      activeWorkspaceId: DEFAULT_WORKSPACE_ID,
      workspaces: [],
      groups: [],
      tabs: [],
      activeTabId: null,
      activeTab: null,
      split: null,
      sidebarPanel: null
    };
  }
  if (!ctx.win || ctx.win.isDestroyed()) return serializeTabs(ctx);
  sidebarMod().closeSidebarIfUnpinned(ctx, { restoreFocus: false, ignoreGrace: true });
  const activeWsId = ctx.incognito ? DEFAULT_WORKSPACE_ID : ctx.activeWorkspaceId || DEFAULT_WORKSPACE_ID;

  // Prefer an existing GX Corner tab in the current workspace (or pinned)
  for (const id of ctx.tabOrder) {
    const t = ctx.tabs.get(id);
    if (!t || !isCornerUrl(t.url)) continue;
    if (isTabVisibleInWorkspace(t, activeWsId)) {
      return switchTab(ctx, id);
    }
  }
  return createTab(ctx, { url: 'nextgx://corner', active: true });
}

module.exports = {
  serializeTabs,
  broadcastState,
  buildWebContentsViewForTab,
  syncTabsMapOrder,
  getTabSourceUrl,
  recordClosedTabIfEligible,
  createTabInternal,
  createTab,
  openOrFocusGxCornerTab,
  wakeTab,
  switchTab,
  sleepTab,
  sleepBackgroundTabs,
  closeTab,
  closeOtherTabs,
  duplicateTab,
  reorderTab,
  reopenLastClosedTab,
  togglePinTab,
  findTabByWebContents,
  navigateActiveTab,
  reloadTab,
  reloadActiveTab,
  toggleActiveTabDevTools
};
