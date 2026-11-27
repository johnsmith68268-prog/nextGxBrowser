const { WebContentsView, ipcMain } = require('electron');
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
  isOnboardingUrl,
  isSplitPickerUrl,
  isErrorPageUrl,
  appendInternalUrlParams,
  sanitizeFaviconUrl,
  // [TABS-W2] Used by the Wave-2 tab IPC channels registered at the bottom
  // of this file (mute / close-right / move-to-window / reading list /
  // reader extract / permission-prompt state). Follows the permissions.js
  // precedent: handlers live in the owning module, not in ipc.js.
  isInternalUiSender,
  getOriginForUrl
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
  scheduleBroadcastState,
  getCtxFromSender,
  notifyActiveWebUiTabShown,
  broadcastHistoryUpdate,
  broadcastBookmarksUpdate
} = require('./broadcast');
const { updateActiveViewBounds } = require('./layout');
const { scheduleSessionSave } = require('./session');
const { attachKeyboardShortcuts } = require('./shortcuts');
const { attachWebContentsContextMenu } = require('./context-menu');
const { restoreFocusToActiveTab, closePopover } = require('./popovers');
// [TABS-W2] Lazy require avoids a require cycle (windows.js requires tabs.js).
const windowsMod = () => require('./windows');
const gxControl = require('./gxcontrol');
const player = require('./player');
const splitView = require('./splitview');
const sidebarMod = () => require('./sidebar');
const drawerOverlayMod = () => require('./drawer-overlay');
const TAB_AUDIO_HOLD_MS = 3000;
const MAX_CONCURRENT_BG_LOADS = 2;
const MAX_LIVE_TABS_SOFT_CAP = 8;

function extractCleanDomainTitle(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return u.host.replace(/^www\.(?=[^.]+\.)/i, '') || rawUrl;
    }
  } catch (_) {}
  return rawUrl || 'New Tab';
}

function countTabLoadMetrics(ctx) {
  let bgLoadingCount = 0;
  let liveTabCount = 0;
  if (!ctx || !ctx.tabs) return { bgLoadingCount, liveTabCount };
  for (const t of ctx.tabs.values()) {
    if (!t) continue;
    if (!t.sleeping && t.view) {
      liveTabCount += 1;
      if (t.id !== ctx.activeTabId && t.isLoading) {
        bgLoadingCount += 1;
      }
    }
  }
  return { bgLoadingCount, liveTabCount };
}

function pumpQueuedBackgroundTabs(ctx) {
  if (!ctx || !ctx.tabs || !ctx.win || ctx.win.isDestroyed()) return;
  let { bgLoadingCount, liveTabCount } = countTabLoadMetrics(ctx);
  if (bgLoadingCount >= MAX_CONCURRENT_BG_LOADS || liveTabCount >= MAX_LIVE_TABS_SOFT_CAP) return;

  let changed = false;
  for (const id of ctx.tabOrder || []) {
    if (bgLoadingCount >= MAX_CONCURRENT_BG_LOADS || liveTabCount >= MAX_LIVE_TABS_SOFT_CAP) break;
    const t = ctx.tabs.get(id);
    if (!t || !t._queuedBgLoad || !t.sleeping) continue;
    t._queuedBgLoad = false;
    t.sleeping = false;
    t.isLoading = true;
    t.view = buildWebContentsViewForTab(ctx, t);
    try {
      if (typeof t.view.setVisible === 'function') t.view.setVisible(false);
      t.view.setBounds({ x: -5000, y: -5000, width: 1, height: 1 });
    } catch (_) {}
    const targetUrl = appendInternalUrlParams(t.url || NEW_TAB_FILE_URL, ctx);
    t.url = targetUrl;
    t.view.webContents.loadURL(targetUrl).catch(() => {});
    bgLoadingCount += 1;
    liveTabCount += 1;
    changed = true;
  }
  if (changed) {
    scheduleBroadcastState(ctx);
  }
}

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
      backgroundThrottling: true,
      session: ctx.session,
      plugins: true
    }
  });

  const wc = view.webContents;
  try {
    if (typeof wc.setBackgroundThrottling === 'function') {
      wc.setBackgroundThrottling(true);
    }
  } catch (_) {}
  registerWebContents(wc, ctx.win.id);
  wc.setUserAgent(wc.getUserAgent().replace(/Electron\/[^\s]+\s?/g, ''));
  attachKeyboardShortcuts(ctx, wc);
  attachWebContentsContextMenu(ctx, wc, { isSidebar: false });

  // [TABS-W2] Mute site (gap 8.2/8.6): a tab opened on a muted origin starts
  // muted, so "Mute site" covers the whole site in this window.
  try {
    const origin = getOriginForUrl(tab.url);
    if (origin && ctx._mutedOrigins instanceof Set && ctx._mutedOrigins.has(origin)) {
      tab.muted = true;
      wc.setAudioMuted(true);
    }
  } catch (_) {}

  wc.on('focus', () => {
    splitView.onTabWebContentsFocused(ctx, tab.id);
    if (ctx.popoverOpenKind) closePopover(ctx, { restoreFocus: false });
    drawerOverlayMod().closeShellDrawer(ctx);
    sidebarMod().closeSidebarIfUnpinned(ctx, { restoreFocus: false });
  });

  wc.setWindowOpenHandler(({ url, disposition }) => {
    if (url && /^https?:\/\//i.test(url)) {
      const parentIdx = Array.isArray(ctx.tabOrder) ? ctx.tabOrder.indexOf(tab.id) : -1;
      const openInBg = disposition === 'background-tab';
      createTab(ctx, {
        url,
        incognito: ctx.incognito,
        active: !openInBg,
        insertIndex: parentIdx >= 0 ? parentIdx + 1 : undefined,
        workspaceId: !tab.pinned ? tab.workspaceId : undefined,
        groupId: !tab.pinned ? tab.groupId : null
      });
    }
    return { action: 'deny' };
  });

  wc.on('did-start-loading', () => {
    tab.isLoading = true;
    gxControl.onTabNavigated(ctx, tab, { forceReapply: false });
    scheduleBroadcastState(ctx);
  });

  wc.on('did-stop-loading', () => {
    tab.isLoading = false;
    tab.canGoBack = wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack();
    tab.canGoForward = wc.navigationHistory ? wc.navigationHistory.canGoForward() : wc.canGoForward();
    state.adBlocker.injectCosmeticFilters(wc);
    const s = state.storage.getSettings(ctx.profileId);
    if (s.forceDarkWeb && /^https?:/i.test(tab.url)) {
      if (!tab._forceDarkCssKey) {
        wc.insertCSS(`html { filter: invert(0.92) hue-rotate(180deg) !important; background: #0d0e12 !important; } img, video, iframe, canvas { filter: invert(1) hue-rotate(180deg) !important; }`)
          .then((key) => { tab._forceDarkCssKey = key; })
          .catch(() => {});
      }
    } else if (tab._forceDarkCssKey) {
      const k = tab._forceDarkCssKey;
      tab._forceDarkCssKey = null;
      wc.removeInsertedCSS?.(k).catch(() => {});
    }
    broadcastState(ctx);
    pumpQueuedBackgroundTabs(ctx);
  });

  const shouldSkipHistory = (url) =>
    !url ||
    isNewTabUrl(url) ||
    isCornerUrl(url) ||
    isWebUiUrl(url) ||
    isOnboardingUrl(url) ||
    isSplitPickerUrl(url) ||
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
    scheduleBroadcastState(ctx);
    scheduleSessionSave(ctx);
  });

  wc.on('page-favicon-updated', (_e, favicons) => {
    if (Array.isArray(favicons) && favicons.length > 0 && !isErrorPageUrl(tab.url)) {
      let safeFavicon = '';
      for (let i = 0; i < favicons.length; i++) {
        safeFavicon = sanitizeFaviconUrl(favicons[i]);
        if (safeFavicon) break;
      }
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
      scheduleBroadcastState(ctx);
    }
  });

  const handleUrlChange = (url) => {
    if (url && url.startsWith('chrome-error://')) return;
    if (!isSplitPickerUrl(url)) {
      tab.isSplitPicker = false;
    }
    const prevOrigin = tab._committedOrigin || getOriginForUrl(tab.url);
    if (url && url !== tab.url) {
      tab.navSeq = (tab.navSeq || 0) + 1;
    }
    tab.url = url;
    if (!isErrorPageUrl(url)) {
      tab._committedOrigin = getOriginForUrl(url);
      tab.failedErrorCode = 0;
      tab.failedErrorDesc = '';
    }
    // [TABS-W2] Mute follows the site: navigating a muted tab to another
    // origin unmutes it, navigating onto a muted origin mutes it.
    try {
      const origin = getOriginForUrl(url);
      const shouldMute = Boolean(
        origin && ctx._mutedOrigins instanceof Set && ctx._mutedOrigins.has(origin)
      );
      if (shouldMute !== Boolean(tab.muted)) {
        tab.muted = shouldMute;
        if (!wc.isDestroyed()) wc.setAudioMuted(shouldMute);
        notifyTabMuteState(ctx, tab.id, shouldMute);
      }
    } catch (_) {}
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
      const nextOrigin = getOriginForUrl(url);
      if (nextOrigin && prevOrigin && nextOrigin !== prevOrigin) {
        tab.favicon = '';
      }
      if (!tab.favicon && nextOrigin && /^https?:\/\//i.test(url)) {
        tab.favicon = `${nextOrigin}/favicon.ico`;
      }
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
    if (!errorCode || errorCode === -3 || errorDescription === 'ERR_ABORTED') {
      if (tab._preRedirectUrl && tab.url !== tab._preRedirectUrl) {
        tab.url = tab._preRedirectUrl;
        tab._preRedirectUrl = '';
        broadcastState(ctx);
      }
      return;
    }

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
    tab._preRedirectUrl = '';
    tab.isLoading = canLoadErrorPage;
    tab.failedUrl = failedUrl;
    tab.failedErrorCode = errorCode;
    tab.failedErrorDesc = errorDescription || '';
    tab.title = formatFailedTabTitle(failedUrl);
    tab.favicon = '';
    tab.url = errorPageUrl;
    broadcastState(ctx);
    scheduleSessionSave(ctx);

    if (canLoadErrorPage) {
      wc.loadURL(errorPageUrl).catch(() => {});
    }
    pumpQueuedBackgroundTabs(ctx);
  });

  wc.on('did-redirect-navigation', (_e, url, _isInPlace, isMainFrame) => {
    if (!isMainFrame || !url || url.startsWith('chrome-error://')) return;
    if (url !== tab.url) {
      if (!tab._preRedirectUrl) tab._preRedirectUrl = tab.url;
      if (!tab._committedOrigin) tab._committedOrigin = getOriginForUrl(tab.url);
      tab.url = url;
      tab.navSeq = (tab.navSeq || 0) + 1;
      broadcastState(ctx);
    }
  });
  wc.on('did-navigate', (_e, url) => {
    tab._preRedirectUrl = '';
    clearTabAudioHoldTimer(tab);
    tab.readerMode = false;
    tab._forceDarkCssKey = null;
    tab.audible = Boolean(typeof wc.isCurrentlyAudible === 'function' && wc.isCurrentlyAudible());
    state.adBlocker.clearCosmeticKeys(wc);
    player.onTabNavigated(ctx, tab);
    handleUrlChange(url);
    // Same rule as a tab switch: an unpinned sidebar panel must not
    // stick open over a freshly navigated page.
    sidebarMod().closeSidebarIfUnpinned(ctx, { restoreFocus: false });
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
    : isSplitPickerUrl(resolvedUrl)
    ? 'Split View'
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

  const startAsleepManual = Boolean(sleeping && deferActivate);
  const isBgWebTab = Boolean(
    !active &&
      !deferActivate &&
      ctx.activeTabId &&
      /^https?:\/\//i.test(resolvedUrl) &&
      !isErrorPageUrl(resolvedUrl)
  );
  const { bgLoadingCount, liveTabCount } = isBgWebTab ? countTabLoadMetrics(ctx) : { bgLoadingCount: 0, liveTabCount: 0 };
  const shouldThrottleNewBgTab = isBgWebTab && (bgLoadingCount >= MAX_CONCURRENT_BG_LOADS || liveTabCount >= MAX_LIVE_TABS_SOFT_CAP);
  const startAsleep = startAsleepManual || shouldThrottleNewBgTab;

  const initialOrigin =
    /^https?:\/\//i.test(resolvedUrl) && !isErrorPageUrl(resolvedUrl)
      ? getOriginForUrl(resolvedUrl)
      : '';
  const effectiveInitialTitle =
    shouldThrottleNewBgTab && initialTitle === 'Loading...'
      ? extractCleanDomainTitle(resolvedUrl)
      : initialTitle;
  const tab = {
    id,
    title: effectiveInitialTitle,
    url: resolvedUrl,
    failedUrl: '',
    favicon: initialOrigin ? `${initialOrigin}/favicon.ico` : '',
    isLoading: !startAsleep,
    canGoBack: false,
    canGoForward: false,
    pinned: isPinned,
    workspaceId: resolvedWsId,
    groupId: resolvedGroupId,
    incognito: Boolean(ctx.incognito),
    sleeping: startAsleep,
    _queuedBgLoad: Boolean(shouldThrottleNewBgTab && liveTabCount < MAX_LIVE_TABS_SOFT_CAP),
    audible: false,
    // [TABS-W2] Mute-site state (gap 8.2/8.6). Not serialized by broadcast.js,
    // so the renderer learns it via the 'tabs:mute-state' event (see below).
    muted: false,
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
  tab._queuedBgLoad = false;
  tab.sleeping = false;
  tab.lastActiveAt = Date.now();
  tab.view = buildWebContentsViewForTab(ctx, tab);
  const wc = tab.view.webContents;
  if (tab.muted && !wc.isDestroyed()) {
    try {
      wc.setAudioMuted(true);
    } catch (_) {}
  }
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
  // Unpinned sidebar panels do not survive a tab switch: previously the
  // panel stayed open over the new tab's page (Settings / History /
  // Downloads). Pinned panels are unaffected (closeSidebarIfUnpinned
  // is a no-op for them), and the grace period is bypassed here because
  // a deliberate tab switch is not an accidental click.
  sidebarMod().closeSidebarIfUnpinned(ctx, { restoreFocus: false, ignoreGrace: true });
  drawerOverlayMod().closeShellDrawer(ctx);
  // [TABS-W2] MRU order for Ctrl+Tab (gap 5.1): most recently activated first.
  if (!Array.isArray(ctx._mruTabIds)) ctx._mruTabIds = [];
  const mruIdx = ctx._mruTabIds.indexOf(tabId);
  if (mruIdx !== -1) ctx._mruTabIds.splice(mruIdx, 1);
  ctx._mruTabIds.unshift(tabId);
  if (ctx._mruTabIds.length > 50) ctx._mruTabIds.length = 50;
  if (ctx.workspaceLastActiveTab instanceof Map && !tab.pinned) {
    const activeWsId = ctx.incognito ? DEFAULT_WORKSPACE_ID : ctx.activeWorkspaceId || DEFAULT_WORKSPACE_ID;
    ctx.workspaceLastActiveTab.set(activeWsId, tabId);
  }
  tab.lastActiveAt = Date.now();
  if (tab.sleeping) wakeTab(ctx, tab);
  splitView.onTabSwitched(ctx, tabId);
  gxControl.onActiveTabChanged(ctx);
  updateActiveViewBounds(ctx);
  // [TABS-W2] Focus the newly active tab's page on every switch (not only in
  // split view): after a programmatic switch the previously focused view is
  // hidden, so without this the window has no keyboard focus at all and
  // Ctrl+Tab / Ctrl+T / every other shortcut is silently lost until the
  // user clicks somewhere. Chrome focuses the new tab's page on switch.
  if (
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
  pumpQueuedBackgroundTabs(ctx);
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

function closeTab(ctx, tabId, opts = {}) {
  const {
    skipSessionClose = false,
    skipRecentlyClosed = false,
    skipAutoNewTab = false
  } = opts || {};
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

  if (!skipRecentlyClosed) {
    recordClosedTabIfEligible(ctx, tab);
  }

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
  pumpQueuedBackgroundTabs(ctx);

  if (ctx.tabOrder.length === 0) {
    if (skipAutoNewTab) {
      ctx.activeTabId = null;
      if (prunedGroup) broadcastGroupsChange(ctx);
      return serializeTabs(ctx);
    }
    const s = state.storage.getSettings(ctx.profileId);
    if (!skipSessionClose && s.closeWindowOnLastTab) {
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

  if (!skipAutoNewTab && (remainingVisible.length === 0 || (!wasPinned && remainingWsUnpinned.length === 0))) {
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
  pumpQueuedBackgroundTabs(ctx);

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

// ---------------------------------------------------------------------------
// [TABS-W2] Chrome-parity Wave 2 tab actions (gaps 8.2, 8.3, 8.6, 8.8, 9.6, 5.1)
// ---------------------------------------------------------------------------

function notifyTabMuteState(ctx, tabId, muted) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed() || !ctx.win.webContents) return;
  try {
    ctx.win.webContents.send('tabs:mute-state', { tabId, muted: Boolean(muted) });
  } catch (_) {}
}

function getMutedOrigins(ctx) {
  if (!ctx._mutedOrigins || !(ctx._mutedOrigins instanceof Set)) {
    ctx._mutedOrigins = new Set();
  }
  return ctx._mutedOrigins;
}

// Gap 8.2 / 8.6 — "Mute site": mutes this tab and every other tab in the
// window on the same origin (Chrome mutes the site, not just the tab).
// `muted` null toggles. Returns the new state for the tab.
function toggleTabMute(ctx, tabId, muted = null) {
  const tab = ctx.tabs.get(tabId);
  if (!tab) return { ok: false };
  const origin = getOriginForUrl(tab.url);
  const next = muted === null || muted === undefined ? !tab.muted : Boolean(muted);
  const origins = getMutedOrigins(ctx);
  if (origin) {
    if (next) origins.add(origin);
    else origins.delete(origin);
  }
  for (const t of ctx.tabs.values()) {
    if (!t) continue;
    const sameTab = t.id === tabId;
    const sameOrigin = origin && getOriginForUrl(t.url) === origin;
    if (!sameTab && !sameOrigin) continue;
    t.muted = next;
    if (t.view && t.view.webContents && !t.view.webContents.isDestroyed()) {
      try {
        t.view.webContents.setAudioMuted(next);
      } catch (_) {}
    }
    notifyTabMuteState(ctx, t.id, next);
  }
  broadcastState(ctx);
  return { ok: true, muted: next, origin: origin || '' };
}

// Gap 8.2 — "Close tabs to the right": closes unpinned tabs after the given
// tab in the active workspace, mirroring closeOtherTabs (closed-tab restore,
// group pruning, split cleanup, keep-at-least-one-tab).
function closeTabsToRight(ctx, tabId) {
  const anchor = ctx.tabs.get(tabId);
  if (!anchor) return serializeTabs(ctx);
  const activeWsId = ctx.incognito ? DEFAULT_WORKSPACE_ID : ctx.activeWorkspaceId || DEFAULT_WORKSPACE_ID;
  const anchorIdx = ctx.tabOrder.indexOf(tabId);
  const toClose = ctx.tabOrder.filter((id, idx) => {
    if (idx <= anchorIdx) return false;
    const t = ctx.tabs.get(id);
    if (!t || t.pinned) return false;
    return (t.workspaceId || DEFAULT_WORKSPACE_ID) === activeWsId;
  });
  if (toClose.length === 0) return serializeTabs(ctx);

  const activeClosed = toClose.includes(ctx.activeTabId);
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
  pumpQueuedBackgroundTabs(ctx);
  if (ctx.workspaceLastActiveTab instanceof Map && closedIds.size > 0) {
    for (const [wsId, lastId] of ctx.workspaceLastActiveTab.entries()) {
      if (closedIds.has(lastId)) ctx.workspaceLastActiveTab.delete(wsId);
    }
  }
  let prunedAnyGroup = false;
  for (const gid of affectedGroups) {
    if (pruneGroupIfEmpty(ctx, gid, { broadcast: false })) prunedAnyGroup = true;
  }
  if (activeClosed) {
    ctx.activeTabId = tabId;
    anchor.lastActiveAt = Date.now();
    if (ctx.workspaceLastActiveTab instanceof Map && !anchor.pinned && isTabVisibleInWorkspace(anchor, activeWsId)) {
      ctx.workspaceLastActiveTab.set(activeWsId, tabId);
    }
    if (anchor.sleeping) wakeTab(ctx, anchor);
    gxControl.onActiveTabChanged(ctx);
  }
  updateActiveViewBounds(ctx);
  if (activeClosed) {
    restoreFocusToActiveTab(ctx);
    notifyActiveWebUiTabShown(ctx);
  }
  if (prunedAnyGroup) broadcastGroupsChange(ctx);
  else broadcastState(ctx);
  scheduleSessionSave(ctx);
  return serializeTabs(ctx);
}

// Gap 8.2 — "Move tab to new window": opens the tab's URL in a fresh window
// (same profile / private state) and closes the tab here. Chrome greys the
// entry out for a lone tab, so this is a no-op when it is the only tab.
function moveTabToNewWindow(ctx, tabId) {
  const tab = ctx.tabs.get(tabId);
  if (!tab) return { ok: false, error: 'Tab not found.' };
  if (ctx.tabOrder.length <= 1) {
    return { ok: false, error: 'Cannot move the only tab to a new window.' };
  }
  const url = getTabSourceUrl(tab) || tab.url;
  const created = windowsMod().createBrowserWindow({
    incognito: Boolean(ctx.incognito),
    profileId: ctx.profileId || null,
    initialUrl: url
  });
  if (!created || !created.win) return { ok: false, error: 'Could not open a new window.' };
  closeTab(ctx, tabId);
  return { ok: true };
}

// Gap 5.1 — Ctrl+Tab: with the MRU setting on, jump to the most recently
// used *other* tab (Chrome's "Ctrl+Tab switches between 2 most recent tabs");
// otherwise cycle to the next visible tab in strip order.
function switchToMruTab(ctx) {
  if (!ctx || !ctx.tabs || ctx.tabs.size === 0) return serializeTabs(ctx);
  const mru = Array.isArray(ctx._mruTabIds) ? ctx._mruTabIds : [];
  const activeWsId = ctx.incognito ? DEFAULT_WORKSPACE_ID : ctx.activeWorkspaceId || DEFAULT_WORKSPACE_ID;
  for (const id of mru) {
    if (id === ctx.activeTabId) continue;
    const t = ctx.tabs.get(id);
    if (!t || t.pinned) continue;
    if (!isTabVisibleInWorkspace(t, activeWsId)) continue;
    return switchTab(ctx, id);
  }
  return cycleTab(ctx, 1);
}

function cycleTab(ctx, direction = 1) {
  if (!ctx || !ctx.tabs || ctx.tabs.size === 0) return serializeTabs(ctx);
  const activeWsId = ctx.incognito ? DEFAULT_WORKSPACE_ID : ctx.activeWorkspaceId || DEFAULT_WORKSPACE_ID;
  const visible = ctx.tabOrder.filter((id) => {
    const t = ctx.tabs.get(id);
    return t && isTabVisibleInWorkspace(t, activeWsId);
  });
  if (visible.length <= 1) return serializeTabs(ctx);
  let idx = visible.indexOf(ctx.activeTabId);
  if (idx === -1) idx = 0;
  const next = visible[(idx + (direction >= 0 ? 1 : visible.length - 1)) % visible.length];
  return switchTab(ctx, next);
}

// Gap 9.6 — Reading mode with real article extraction (readability-style,
// done locally). Runs entirely in the page: picks the most text-dense
// candidate (article/main/largest text block), strips scripts, nav, ads and
// sidebars, and rewrites the page into a clean reader layout. Toggle off
// reloads the original page. The old CSS-only `tabs:reader-mode` channel in
// ipc.js is left untouched; the UI uses this channel instead.
function extractArticleForReader() {
  // Runs inside the page — must not reference anything outside this function.
  function textLen(el) {
    return (el.innerText || '').trim().length;
  }
  function linkDensity(el) {
    const text = textLen(el);
    if (!text) return 1;
    let linkText = 0;
    const links = el.querySelectorAll('a');
    for (const a of links) linkText += (a.innerText || '').trim().length;
    return linkText / text;
  }
  const kill = (root, sel) => {
    const nodes = root.querySelectorAll(sel);
    for (const n of nodes) n.remove();
  };
  const doc = document;
  const candidates = [];
  const seen = new Set();
  const consider = (el) => {
    if (!el || seen.has(el)) return;
    seen.add(el);
    const len = textLen(el);
    if (len < 200) return;
    const paras = el.querySelectorAll('p').length;
    if (paras === 0 && len < 800) return;
    candidates.push({ el, score: len * (1 - Math.min(0.9, linkDensity(el))) + paras * 40 });
  };
  doc.querySelectorAll('article, main, [role="main"]').forEach(consider);
  if (candidates.length === 0) {
    const all = doc.querySelectorAll('div, section');
    for (const el of all) consider(el);
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0].el.cloneNode(true);
  kill(best, 'script, style, noscript, iframe, svg, form, button, input, select, textarea, nav, header, footer, aside, [role="navigation"], [role="banner"], [role="complementary"], .ad, [class*="ad-"], [id*="ad-"], [class*="sidebar"], [class*="share"], [class*="comment"], [class*="related"], [class*="newsletter"], [class*="paywall"]');
  const titleEl = doc.querySelector('h1');
  const title = (titleEl ? titleEl.innerText : doc.title || '').trim();
  const metaAuthor = doc.querySelector('meta[name="author"]');
  const byline = metaAuthor ? (metaAuthor.getAttribute('content') || '').trim() : '';
  const paras = best.querySelectorAll('p');
  let bodyText = '';
  for (const p of paras) bodyText += (p.innerText || '').trim() + '\n';
  if (bodyText.trim().length < 300) return null;
  const allowed = ['P', 'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'FIGURE', 'FIGCAPTION', 'IMG', 'A', 'STRONG', 'EM', 'BR'];
  const clean = (node) => {
    const kids = Array.from(node.childNodes);
    for (const kid of kids) {
      if (kid.nodeType === 3) continue;
      if (kid.nodeType !== 1) {
        kid.remove();
        continue;
      }
      if (allowed.indexOf(kid.tagName) === -1) {
        const span = doc.createElement('span');
        while (kid.firstChild) span.appendChild(kid.firstChild);
        node.replaceChild(span, kid);
        clean(span);
      } else {
        if (kid.tagName === 'IMG') {
          const src = kid.getAttribute('src') || '';
          if (!/^https?:\/\//i.test(src) && !/^data:image\//i.test(src)) kid.remove();
          else {
            kid.removeAttribute('srcset');
            kid.removeAttribute('loading');
          }
        }
        if (kid.tagName === 'A') {
          const href = kid.getAttribute('href') || '';
          if (!/^https?:\/\//i.test(href) && href.charAt(0) !== '#') kid.removeAttribute('href');
        }
        for (const attr of Array.from(kid.attributes || [])) {
          if (['src', 'href', 'alt', 'title'].indexOf(attr.name) === -1) kid.removeAttribute(attr.name);
        }
        clean(kid);
      }
    }
  };
  clean(best);
  // [TABS-W2] The reader template prints the title itself; drop the matching
  // first H1 from the extracted body so the title is not shown twice.
  const firstH1 = best.querySelector('h1');
  if (firstH1 && title && (firstH1.innerText || '').trim() === title) firstH1.remove();
  return { title, byline, html: best.innerHTML, textLength: bodyText.trim().length };
}

async function toggleReaderModeExtract(ctx) {
  const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
  if (!tab || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed()) {
    return { ok: false, error: 'No active tab.' };
  }
  const wc = tab.view.webContents;
  if (tab.readerMode) {
    tab.readerMode = false;
    try {
      await wc.reload();
    } catch (_) {}
    broadcastState(ctx);
    return { ok: true, active: false };
  }
  const url = tab.url || '';
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: 'Reader view works on web pages.' };
  }
  let extracted = null;
  try {
    extracted = await wc.executeJavaScript(`(${extractArticleForReader.toString()})()`);
  } catch (_) {
    extracted = null;
  }
  if (!extracted || typeof extracted.html !== 'string' || (extracted.textLength || 0) < 300) {
    return { ok: false, error: 'Could not extract a readable article from this page.' };
  }
  const esc = (s) =>
    String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const readerHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(extracted.title || 'Reader view')}</title><style>
    body{background:#14161f;color:#e2e8f0;font-family:Georgia,'Charter',serif;font-size:19px;line-height:1.75;margin:0;padding:0}
    .nx-reader-bar{position:sticky;top:0;display:flex;gap:12px;align-items:center;padding:10px 20px;background:#1b1e2b;border-bottom:1px solid #2b2f42;font-family:system-ui,sans-serif;font-size:13px;color:#9aa3b2}
    .nx-reader-bar button{background:#7c5cff;color:#fff;border:0;border-radius:999px;padding:6px 14px;font-size:13px;cursor:pointer}
    .nx-reader-bar a{color:#9aa3b2;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    article{max-width:680px;margin:36px auto 80px;padding:0 28px}
    h1{font-size:32px;line-height:1.25;margin:0 0 8px}
    h2{font-size:24px;margin:32px 0 8px} h3{font-size:20px;margin:24px 0 8px}
    .nx-byline{color:#9aa3b2;font-family:system-ui,sans-serif;font-size:13px;margin-bottom:28px}
    p{margin:0 0 18px} img{max-width:100%;height:auto;border-radius:8px}
    a{color:#8ab4ff} blockquote{border-left:3px solid #7c5cff;margin:18px 0;padding-left:16px;color:#b9c0d0}
    ul,ol{margin:0 0 18px;padding-left:24px}
  </style></head><body>
  <div class="nx-reader-bar"><button id="nxReaderBackBtn" type="button">← Back to original</button><span>Reader view</span><a href="${esc(url)}">${esc(url)}</a></div>
  <article><h1>${esc(extracted.title || 'Untitled')}</h1>${extracted.byline ? `<div class="nx-byline">${esc(extracted.byline)}</div>` : ''}${extracted.html}</article>
  </body></html>`;
  try {
    await wc.executeJavaScript(`(() => {
      document.open();
      document.write(${JSON.stringify(readerHtml)});
      document.close();
      const b = document.getElementById('nxReaderBackBtn');
      if (b) b.addEventListener('click', () => location.reload());
    })()`);
  } catch (err) {
    return { ok: false, error: err?.message || 'Reader view failed.' };
  }
  tab.readerMode = true;
  broadcastState(ctx);
  return { ok: true, active: true };
}

// [TABS-W2] Wave-2 IPC channels. Registered from this module (owned) instead
// of ipc.js, following the permissions.js / passkeys.js precedent. Internal-UI
// senders only (same guard ipc.js uses for its own channels).
let tabsWave2IpcRegistered = false;
function ensureTabsWave2IpcRegistered() {
  if (tabsWave2IpcRegistered) return;
  tabsWave2IpcRegistered = true;
  try {
    if (!ipcMain || typeof ipcMain.handle !== 'function') return;
    const handleInternal = (channel, handler) => {
      ipcMain.handle(channel, (e, ...args) => {
        if (!isInternalUiSender(e)) throw new Error(`Forbidden IPC channel: ${channel}`);
        return handler(e, ...args);
      });
    };
    handleInternal('tabs:mute', (e, payload = {}) => {
      const ctx = getCtxFromSender(e.sender);
      const tabId = typeof payload === 'string' ? payload : payload.tabId;
      return toggleTabMute(ctx, tabId, payload && 'muted' in payload ? payload.muted : null);
    });
    handleInternal('tabs:mute-state', (e, payload = {}) => {
      const ctx = getCtxFromSender(e.sender);
      const tabId = typeof payload === 'string' ? payload : payload.tabId;
      const tab = tabId ? ctx.tabs.get(tabId) : null;
      return { tabId: tabId || null, muted: Boolean(tab && tab.muted) };
    });
    handleInternal('tabs:close-right', (e, payload = {}) => {
      const ctx = getCtxFromSender(e.sender);
      const tabId = typeof payload === 'string' ? payload : payload.tabId;
      return closeTabsToRight(ctx, tabId);
    });
    handleInternal('tabs:move-to-new-window', (e, payload = {}) => {
      const ctx = getCtxFromSender(e.sender);
      const tabId = typeof payload === 'string' ? payload : payload.tabId;
      return moveTabToNewWindow(ctx, tabId);
    });
    handleInternal('tabs:reader-mode-extract', async (e) => {
      const ctx = getCtxFromSender(e.sender);
      return toggleReaderModeExtract(ctx);
    });
    handleInternal('reading-list:get', (e) => {
      const ctx = getCtxFromSender(e.sender);
      const pid = ctx?.profileId || state.storage.getActiveProfileId();
      return state.storage.getReadingList(pid);
    });
    handleInternal('reading-list:add', (e, payload = {}) => {
      const ctx = getCtxFromSender(e.sender);
      const pid = ctx?.profileId || state.storage.getActiveProfileId();
      const tab = payload.tabId ? ctx.tabs.get(payload.tabId) : null;
      const entry = {
        title: payload.title || tab?.title || '',
        url: payload.url || tab?.url || '',
        favicon: payload.favicon || tab?.favicon || ''
      };
      const res = state.storage.addReadingListItem(entry, pid);
      if (ctx?.win && !ctx.win.isDestroyed()) {
        if (res.ok) {
          ctx.win.webContents.send('ui:toast', 'Added to Reading List');
        } else if (res.duplicate) {
          ctx.win.webContents.send('ui:toast', 'Already in your reading list');
        }
      }
      return res;
    });
    handleInternal('reading-list:remove', (e, payload = {}) => {
      const ctx = getCtxFromSender(e.sender);
      const pid = ctx?.profileId || state.storage.getActiveProfileId();
      const id = typeof payload === 'string' ? payload : payload.id;
      return state.storage.removeReadingListItem(id, pid);
    });
    handleInternal('reading-list:mark-read', (e, payload = {}) => {
      const ctx = getCtxFromSender(e.sender);
      const pid = ctx?.profileId || state.storage.getActiveProfileId();
      return state.storage.markReadingListRead(payload.id, payload.read, pid);
    });
    // Gap 1.5 — omnibox permission chips: the permission-prompt popover
    // (popover.html, owned) reports its open/close lifecycle here; main
    // forwards it to the chrome window so the renderer can render the chip
    // while prompting and the persistent site icon after a decision.
    // A decision also triggers the stored-permissions broadcast, which the
    // renderer uses to refresh the persistent icons.
    handleInternal('ui:permission-prompt-state', (e, payload = {}) => {
      const ctx = getCtxFromSender(e.sender);
      if (!ctx || !ctx.win || ctx.win.isDestroyed() || !ctx.win.webContents) return { ok: false };
      ctx.win.webContents.send('permission-prompt:state', {
        open: Boolean(payload.open),
        origin: typeof payload.origin === 'string' ? payload.origin : '',
        host: typeof payload.host === 'string' ? payload.host : '',
        keys: Array.isArray(payload.keys) ? payload.keys : [],
        labels: Array.isArray(payload.labels) ? payload.labels : []
      });
      return { ok: true };
    });
  } catch (_) {}
}
ensureTabsWave2IpcRegistered();

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
    } else if (
      !tab.workspaceId ||
      !hasWorkspace(tab.workspaceId) ||
      splitView.isTabInSplit(ctx, tab.id)
    ) {
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
  tab.isSplitPicker = false;
  tab._preRedirectUrl = '';
  tab.failedUrl = '';
  tab.failedErrorCode = 0;
  tab.failedErrorDesc = '';
  tab.url = resolvedUrl;
  tab.navSeq = (tab.navSeq || 0) + 1;
  tab.explicitNavSeq = (tab.explicitNavSeq || 0) + 1;
  tab.view.webContents.loadURL(resolvedUrl).catch(() => {});
  if (tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()) {
    try {
      tab.view.webContents.focus();
    } catch (_) {}
  }
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
  drawerOverlayMod().closeShellDrawer(ctx);
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
  // [TABS-W2]
  closeTabsToRight,
  toggleTabMute,
  moveTabToNewWindow,
  switchToMruTab,
  cycleTab,
  toggleReaderModeExtract,
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
