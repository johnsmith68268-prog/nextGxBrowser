const workspacesMod = () => require('./workspaces');
const tabsMod = () => require('./tabs');
const layoutMod = () => require('./layout');
const broadcastMod = () => require('./broadcast');
const sessionMod = () => require('./session');
const popoversMod = () => require('./popovers');
const gxControlMod = () => require('./gxcontrol');
const coreMod = () => require('./core');

const DEFAULT_WORKSPACE_ID = 'default';
const SPLIT_DEFAULT_RATIO = 0.5;
const SPLIT_MIN_RATIO = 0.2;
const SPLIT_MAX_RATIO = 0.8;
const SPLIT_DIVIDER_WIDTH = 6;

function clampSplitRatio(rawRatio) {
  const num = Number(rawRatio);
  if (!Number.isFinite(num)) return SPLIT_DEFAULT_RATIO;
  const clamped = Math.max(SPLIT_MIN_RATIO, Math.min(SPLIT_MAX_RATIO, num));
  return Math.round(clamped * 10000) / 10000;
}

function getActiveWorkspaceId(ctx) {
  if (!ctx || ctx.incognito) return DEFAULT_WORKSPACE_ID;
  return ctx.activeWorkspaceId || DEFAULT_WORKSPACE_ID;
}

function ensureSplitsMap(ctx) {
  if (!ctx) return null;
  if (!(ctx.splitsByWorkspace instanceof Map)) {
    ctx.splitsByWorkspace = new Map();
    if (ctx.split && typeof ctx.split === 'object') {
      ctx.splitsByWorkspace.set(getActiveWorkspaceId(ctx), ctx.split);
    }
  }
  return ctx.splitsByWorkspace;
}

function getSplitForWorkspace(ctx, workspaceId = null) {
  if (!ctx) return null;
  const map = ensureSplitsMap(ctx);
  const wsId = ctx.incognito ? DEFAULT_WORKSPACE_ID : workspaceId || getActiveWorkspaceId(ctx);
  return map.get(wsId) || null;
}

function setSplitForWorkspace(ctx, workspaceId, split) {
  if (!ctx) return null;
  const map = ensureSplitsMap(ctx);
  const wsId = ctx.incognito ? DEFAULT_WORKSPACE_ID : workspaceId || getActiveWorkspaceId(ctx);
  if (split && typeof split === 'object') {
    map.set(wsId, split);
  } else {
    map.delete(wsId);
  }
  if (wsId === getActiveWorkspaceId(ctx)) {
    ctx.split = map.get(wsId) || null;
  }
  return map.get(wsId) || null;
}

function deleteSplitForWorkspace(ctx, workspaceId = null) {
  return setSplitForWorkspace(ctx, workspaceId || getActiveWorkspaceId(ctx), null);
}

function pruneInvalidSplit(ctx, workspaceId = null) {
  if (!ctx) return null;
  const map = ensureSplitsMap(ctx);
  const activeWsId = getActiveWorkspaceId(ctx);
  const wsId = ctx.incognito ? DEFAULT_WORKSPACE_ID : workspaceId || activeWsId;
  const split = map.get(wsId) || null;
  if (!split) {
    if (wsId === activeWsId) ctx.split = null;
    return null;
  }
  const leftTabId = typeof split.leftTabId === 'string' ? split.leftTabId : null;
  const rightTabId = typeof split.rightTabId === 'string' ? split.rightTabId : null;
  if (
    !leftTabId ||
    !rightTabId ||
    leftTabId === rightTabId ||
    !(ctx.tabs instanceof Map) ||
    !ctx.tabs.has(leftTabId) ||
    !ctx.tabs.has(rightTabId)
  ) {
    map.delete(wsId);
    if (wsId === activeWsId) ctx.split = null;
    return null;
  }
  split.ratio = clampSplitRatio(split.ratio);
  split.focusedPane = split.focusedPane === 'right' ? 'right' : 'left';
  if (wsId === activeWsId) ctx.split = split;
  return split;
}

function syncSplitFocusedPane(ctx) {
  const split = pruneInvalidSplit(ctx);
  if (!split) return null;
  if (ctx.activeTabId === split.leftTabId) {
    split.focusedPane = 'left';
  } else if (ctx.activeTabId === split.rightTabId) {
    split.focusedPane = 'right';
  } else if (split.focusedPane !== 'left' && split.focusedPane !== 'right') {
    split.focusedPane = 'left';
  }
  return split;
}

/**
 * Returns { leftTab, rightTab, split } when the active workspace's split view should
 * actively render side-by-side:
 *  - active workspace has a valid split referencing two distinct existing tabs
 *  - both tabs are visible in the active workspace (read-only helper from workspaces.js)
 *  - the window's activeTabId is one of the two split tabs
 * Otherwise returns null (split inactive or suspended while viewing another tab/workspace).
 */
function getVisibleSplitTabs(ctx) {
  const split = syncSplitFocusedPane(ctx);
  if (!split) return null;
  if (ctx.activeTabId !== split.leftTabId && ctx.activeTabId !== split.rightTabId) {
    return null;
  }
  const leftTab = ctx.tabs.get(split.leftTabId);
  const rightTab = ctx.tabs.get(split.rightTabId);
  if (!leftTab || !rightTab) {
    deleteSplitForWorkspace(ctx, getActiveWorkspaceId(ctx));
    return null;
  }
  const activeWsId = getActiveWorkspaceId(ctx);
  const { isTabVisibleInWorkspace } = workspacesMod();
  if (!isTabVisibleInWorkspace(leftTab, activeWsId) || !isTabVisibleInWorkspace(rightTab, activeWsId)) {
    return null;
  }
  return { leftTab, rightTab, split };
}

function isSplitVisible(ctx) {
  return Boolean(getVisibleSplitTabs(ctx));
}

function isTabInSplit(ctx, tabId) {
  const split = pruneInvalidSplit(ctx);
  if (!split || !tabId) return false;
  return split.leftTabId === tabId || split.rightTabId === tabId;
}

function isTabInVisibleSplit(ctx, tabId) {
  if (!tabId) return false;
  const vis = getVisibleSplitTabs(ctx);
  if (!vis) return false;
  return vis.split.leftTabId === tabId || vis.split.rightTabId === tabId;
}

function computeSplitPaneBounds({ x, y, width, height, ratio, dividerWidth = SPLIT_DIVIDER_WIDTH }) {
  const safeW = Math.max(120, Math.round(Number(width) || 120));
  const safeH = Math.max(120, Math.round(Number(height) || 120));
  const safeX = Math.round(Number(x) || 0);
  const safeY = Math.round(Number(y) || 0);
  const safeDivW = Math.max(2, Math.round(Number(dividerWidth) || SPLIT_DIVIDER_WIDTH));
  const safeRatio = clampSplitRatio(ratio);

  const availW = Math.max(2, safeW - safeDivW);
  const minPaneW = Math.min(80, Math.floor(availW / 2));
  const leftW = Math.max(minPaneW, Math.min(availW - minPaneW, Math.round(availW * safeRatio)));
  const rightW = Math.max(1, availW - leftW);

  return {
    left: { x: safeX, y: safeY, width: leftW, height: safeH },
    divider: { x: safeX + leftW, y: safeY, width: safeDivW, height: safeH },
    right: { x: safeX + leftW + safeDivW, y: safeY, width: rightW, height: safeH }
  };
}

function serializeSplitState(ctx) {
  const split = syncSplitFocusedPane(ctx);
  if (!split) return null;
  return {
    leftTabId: split.leftTabId,
    rightTabId: split.rightTabId,
    ratio: clampSplitRatio(split.ratio),
    focusedPane: split.focusedPane === 'right' ? 'right' : 'left',
    visible: Boolean(getVisibleSplitTabs(ctx))
  };
}

function serializeSingleSplitForSession(split, tabIdToIndex) {
  if (!split || !(tabIdToIndex instanceof Map)) return null;
  if (!tabIdToIndex.has(split.leftTabId) || !tabIdToIndex.has(split.rightTabId)) {
    return null;
  }
  const leftIndex = tabIdToIndex.get(split.leftTabId);
  const rightIndex = tabIdToIndex.get(split.rightTabId);
  if (!Number.isInteger(leftIndex) || !Number.isInteger(rightIndex) || leftIndex === rightIndex) {
    return null;
  }
  return {
    leftIndex,
    rightIndex,
    ratio: clampSplitRatio(split.ratio),
    focusedPane: split.focusedPane === 'right' ? 'right' : 'left'
  };
}

function serializeSplitForSession(ctx, tabIdToIndex) {
  const split = syncSplitFocusedPane(ctx);
  return serializeSingleSplitForSession(split, tabIdToIndex);
}

function serializeSplitsForSession(ctx, tabIdToIndex) {
  if (!ctx || !(tabIdToIndex instanceof Map)) return {};
  const map = ensureSplitsMap(ctx);
  syncSplitFocusedPane(ctx);
  const out = {};
  for (const wsId of Array.from(map.keys())) {
    const split = pruneInvalidSplit(ctx, wsId);
    const serialized = serializeSingleSplitForSession(split, tabIdToIndex);
    if (serialized) {
      out[wsId] = serialized;
    }
  }
  return out;
}

function syncWorkspaceLastActiveForSplit(ctx) {
  if (!ctx || ctx.incognito || !(ctx.workspaceLastActiveTab instanceof Map)) return;
  const vis = getVisibleSplitTabs(ctx);
  if (!vis) return;
  const activeWsId = getActiveWorkspaceId(ctx);
  const { isTabVisibleInWorkspace } = workspacesMod();
  const focusedTab = vis.split.focusedPane === 'right' ? vis.rightTab : vis.leftTab;
  const partnerTab = vis.split.focusedPane === 'right' ? vis.leftTab : vis.rightTab;
  // Respect R-13: never store a pinned tab in workspaceLastActiveTab.
  if (focusedTab && !focusedTab.pinned && isTabVisibleInWorkspace(focusedTab, activeWsId)) {
    ctx.workspaceLastActiveTab.set(activeWsId, focusedTab.id);
  } else if (partnerTab && !partnerTab.pinned && isTabVisibleInWorkspace(partnerTab, activeWsId)) {
    ctx.workspaceLastActiveTab.set(activeWsId, partnerTab.id);
  }
}

function wakeSplitTabsIfNeeded(ctx) {
  const vis = getVisibleSplitTabs(ctx);
  if (!vis) return;
  const { wakeTab } = tabsMod();
  const now = Date.now();
  if (vis.leftTab.sleeping) {
    wakeTab(ctx, vis.leftTab);
  }
  if (vis.rightTab.sleeping) {
    wakeTab(ctx, vis.rightTab);
  }
  vis.leftTab.lastActiveAt = now;
  vis.rightTab.lastActiveAt = now;
}

function focusTabWebContentsSafe(tab) {
  if (
    tab &&
    !tab.sleeping &&
    tab.view &&
    tab.view.webContents &&
    !tab.view.webContents.isDestroyed()
  ) {
    try {
      tab.view.webContents.focus();
    } catch (_) {}
  }
}

function createCompanionSplitTab(ctx, anchorTab, { url = 'nextgx://newtab', isSplitPicker = false } = {}) {
  const { createTabInternal } = tabsMod();
  const activeWsId = getActiveWorkspaceId(ctx);
  let insertIndex;
  if (anchorTab && !anchorTab.pinned && !anchorTab.groupId) {
    const anchorIdx = ctx.tabOrder.indexOf(anchorTab.id);
    if (anchorIdx !== -1) {
      insertIndex = anchorIdx + 1;
    }
  }
  const created = createTabInternal(ctx, {
    url,
    workspaceId: activeWsId,
    groupId: null,
    active: false,
    deferActivate: true,
    insertIndex
  });
  if (created && isSplitPicker) {
    created.isSplitPicker = true;
    created.title = 'Split View';
  }
  return created;
}

function isTemporarySplitPickerTab(tab) {
  if (!tab) return false;
  const { isSplitPickerUrl } = require('./utils');
  return Boolean(tab.isSplitPicker || isSplitPickerUrl(tab.url));
}

function cleanupDetachedPickerTab(ctx, tabId) {
  if (!ctx || !tabId || !(ctx.tabs instanceof Map)) return false;
  const tab = ctx.tabs.get(tabId);
  if (!isTemporarySplitPickerTab(tab)) return false;
  removeTemporaryPickerTab(ctx, tabId);
  return true;
}

function startSplit(ctx, { tabId = null, openPicker = true } = {}) {
  const { serializeTabs, broadcastState, notifyActiveWebUiTabShown } = broadcastMod();
  if (!ctx || !(ctx.tabs instanceof Map)) return null;

  const { wakeTab } = tabsMod();
  const activeTab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
  if (!activeTab) return serializeTabs(ctx);

  const requestedTabId = typeof tabId === 'string' && tabId.trim() ? tabId.trim() : null;
  if (requestedTabId && !ctx.tabs.has(requestedTabId)) {
    return serializeTabs(ctx);
  }

  const activeWsId = getActiveWorkspaceId(ctx);
  const vis = getVisibleSplitTabs(ctx);

  if (vis) {
    const { split } = vis;
    let newlyFocusedTab = null;
    // Invoked on a tab while split is active and visible
    if (requestedTabId) {
      if (requestedTabId === split.leftTabId || requestedTabId === split.rightTabId) {
        return focusSplitPane(ctx, { tabId: requestedTabId });
      }
      // Replace the NON-focused pane with requestedTabId
      const replacementTab = ctx.tabs.get(requestedTabId);
      if (!replacementTab) return serializeTabs(ctx);
      if (!ctx.incognito && !replacementTab.pinned && replacementTab.workspaceId !== activeWsId) {
        replacementTab.workspaceId = activeWsId;
      }
      if (replacementTab.sleeping) wakeTab(ctx, replacementTab);
      const replacedTabId = split.focusedPane === 'right' ? split.leftTabId : split.rightTabId;
      if (split.focusedPane === 'right') {
        split.leftTabId = requestedTabId;
      } else {
        split.rightTabId = requestedTabId;
      }
      if (replacedTabId && replacedTabId !== requestedTabId) {
        cleanupDetachedPickerTab(ctx, replacedTabId);
      }
      replacementTab.lastActiveAt = Date.now();
    } else {
      const existingPicker = findPickerPaneInSplit(ctx);
      if (openPicker && existingPicker && existingPicker.pickerTab) {
        split.focusedPane = existingPicker.side;
        ctx.activeTabId = existingPicker.pickerTab.id;
        newlyFocusedTab = existingPicker.pickerTab;
      } else {
        // Explicit split:start with no tabId while already split: open picker (or new tab) in the non-focused pane
        const focusedTab = split.focusedPane === 'right' ? vis.rightTab : vis.leftTab;
        const replacedTabId = split.focusedPane === 'right' ? split.leftTabId : split.rightTabId;
        const nextPane = split.focusedPane === 'right' ? 'left' : 'right';
        const newTab = createCompanionSplitTab(
          ctx,
          focusedTab,
          openPicker ? { url: 'nextgx://split-picker', isSplitPicker: true } : { url: 'nextgx://newtab' }
        );
        if (!newTab) return serializeTabs(ctx);
        if (nextPane === 'left') {
          split.leftTabId = newTab.id;
        } else {
          split.rightTabId = newTab.id;
        }
        split.focusedPane = nextPane;
        ctx.activeTabId = newTab.id;
        newlyFocusedTab = newTab;
        if (replacedTabId && replacedTabId !== newTab.id) {
          cleanupDetachedPickerTab(ctx, replacedTabId);
        }
      }
    }

    wakeSplitTabsIfNeeded(ctx);
    syncWorkspaceLastActiveForSplit(ctx);
    gxControlMod().onActiveTabChanged(ctx);
    layoutMod().updateActiveViewBounds(ctx);
    if (newlyFocusedTab) {
      focusTabWebContentsSafe(newlyFocusedTab);
      notifyActiveWebUiTabShown(ctx);
    }
    broadcastState(ctx);
    sessionMod().scheduleSessionSave(ctx);
    return serializeTabs(ctx);
  }

  if (!requestedTabId && isTemporarySplitPickerTab(activeTab)) {
    return serializeTabs(ctx);
  }

  const staleSplit = ensureSplitsMap(ctx).get(activeWsId) || null;

  // No active visible split: create a new split from activeTab + requestedTab (or a new Start Page tab)
  let leftTab = activeTab;
  let rightTab = null;
  let initialFocusedPane = 'left';

  if (requestedTabId && requestedTabId !== activeTab.id) {
    rightTab = ctx.tabs.get(requestedTabId);
    if (rightTab && !ctx.incognito && !rightTab.pinned && rightTab.workspaceId !== activeWsId) {
      rightTab.workspaceId = activeWsId;
    }
    initialFocusedPane = 'left';
  } else if (openPicker) {
    rightTab = createCompanionSplitTab(ctx, activeTab, {
      url: 'nextgx://split-picker',
      isSplitPicker: true
    });
    initialFocusedPane = 'right';
  } else {
    rightTab = createCompanionSplitTab(ctx, activeTab);
    initialFocusedPane = 'right';
  }

  if (!leftTab || !rightTab || leftTab.id === rightTab.id) {
    return serializeTabs(ctx);
  }

  if (leftTab.sleeping) wakeTab(ctx, leftTab);
  if (rightTab.sleeping) wakeTab(ctx, rightTab);

  const now = Date.now();
  leftTab.lastActiveAt = now;
  rightTab.lastActiveAt = now;

  setSplitForWorkspace(ctx, activeWsId, {
    leftTabId: leftTab.id,
    rightTabId: rightTab.id,
    ratio: SPLIT_DEFAULT_RATIO,
    focusedPane: initialFocusedPane
  });

  if (staleSplit) {
    if (staleSplit.leftTabId !== leftTab.id && staleSplit.leftTabId !== rightTab.id) {
      cleanupDetachedPickerTab(ctx, staleSplit.leftTabId);
    }
    if (staleSplit.rightTabId !== leftTab.id && staleSplit.rightTabId !== rightTab.id) {
      cleanupDetachedPickerTab(ctx, staleSplit.rightTabId);
    }
  }

  const focusedTab = initialFocusedPane === 'right' ? rightTab : leftTab;
  ctx.activeTabId = focusedTab.id;

  syncWorkspaceLastActiveForSplit(ctx);
  gxControlMod().onActiveTabChanged(ctx);
  layoutMod().updateActiveViewBounds(ctx);
  focusTabWebContentsSafe(focusedTab);
  notifyActiveWebUiTabShown(ctx);
  broadcastState(ctx);
  sessionMod().scheduleSessionSave(ctx);
  return serializeTabs(ctx);
}

function exitSplit(ctx) {
  const { serializeTabs, broadcastState, notifyActiveWebUiTabShown } = broadcastMod();
  if (!ctx) return null;
  const activeWsId = getActiveWorkspaceId(ctx);
  const split = syncSplitFocusedPane(ctx);
  if (!split) return serializeTabs(ctx);

  const wasVisible = Boolean(getVisibleSplitTabs(ctx));
  const leftId = split.leftTabId;
  const rightId = split.rightTabId;
  const leftIsPicker = isTemporarySplitPickerTab(ctx.tabs.get(leftId));
  const rightIsPicker = isTemporarySplitPickerTab(ctx.tabs.get(rightId));
  const focusedTabId = split.focusedPane === 'right' ? rightId : leftId;
  const fallbackTabId = split.focusedPane === 'right' ? leftId : rightId;

  deleteSplitForWorkspace(ctx, activeWsId);
  if (leftIsPicker) removeTemporaryPickerTab(ctx, leftId);
  if (rightIsPicker && rightId !== leftId) removeTemporaryPickerTab(ctx, rightId);

  if (wasVisible || !ctx.tabs.has(ctx.activeTabId)) {
    const { isTabVisibleInWorkspace } = workspacesMod();
    let targetId =
      focusedTabId && ctx.tabs.has(focusedTabId)
        ? focusedTabId
        : fallbackTabId && ctx.tabs.has(fallbackTabId)
        ? fallbackTabId
        : ctx.activeTabId && ctx.tabs.has(ctx.activeTabId)
        ? ctx.activeTabId
        : null;
    if (!targetId && Array.isArray(ctx.tabOrder)) {
      targetId =
        ctx.tabOrder.find((id) => isTabVisibleInWorkspace(ctx.tabs.get(id), activeWsId)) ||
        ctx.tabOrder[0] ||
        null;
    }
    if (targetId && ctx.tabs.has(targetId)) {
      const prevActive = ctx.activeTabId;
      ctx.activeTabId = targetId;
      const targetTab = ctx.tabs.get(targetId);
      if (targetTab) {
        if (targetTab.sleeping) tabsMod().wakeTab(ctx, targetTab);
        targetTab.lastActiveAt = Date.now();
        if (!ctx.incognito && !targetTab.pinned && ctx.workspaceLastActiveTab instanceof Map) {
          ctx.workspaceLastActiveTab.set(activeWsId, targetId);
        }
      }
      if (prevActive !== targetId) {
        gxControlMod().onActiveTabChanged(ctx);
      }
    }
  }

  layoutMod().updateActiveViewBounds(ctx);
  if (wasVisible) {
    popoversMod().restoreFocusToActiveTab(ctx);
    notifyActiveWebUiTabShown(ctx);
  }
  broadcastState(ctx);
  sessionMod().scheduleSessionSave(ctx);
  return serializeTabs(ctx);
}

function toggleSplit(ctx) {
  if (!ctx) return null;
  if (isSplitVisible(ctx)) {
    return exitSplit(ctx);
  }
  return startSplit(ctx, { tabId: null });
}

function swapSplitPanes(ctx) {
  const { serializeTabs, broadcastState, notifyActiveWebUiTabShown } = broadcastMod();
  if (!ctx || !(ctx.tabs instanceof Map)) return null;
  const vis = getVisibleSplitTabs(ctx);
  const split = vis ? vis.split : syncSplitFocusedPane(ctx);
  if (!split) return serializeTabs(ctx);

  const prevLeft = split.leftTabId;
  const prevRight = split.rightTabId;
  split.leftTabId = prevRight;
  split.rightTabId = prevLeft;
  split.focusedPane = split.focusedPane === 'right' ? 'left' : 'right';
  split.ratio = clampSplitRatio(1 - clampSplitRatio(split.ratio));

  // If the two split tabs sit side-by-side in the tab bar and share pinned/group state, mirror the swap in tabOrder too.
  if (Array.isArray(ctx.tabOrder)) {
    const idxA = ctx.tabOrder.indexOf(prevLeft);
    const idxB = ctx.tabOrder.indexOf(prevRight);
    const tabA = ctx.tabs.get(prevLeft);
    const tabB = ctx.tabs.get(prevRight);
    const canSwapOrder =
      Boolean(tabA?.pinned) === Boolean(tabB?.pinned) &&
      (tabA?.groupId || null) === (tabB?.groupId || null);
    if (idxA !== -1 && idxB !== -1 && Math.abs(idxA - idxB) === 1 && canSwapOrder) {
      ctx.tabOrder[idxA] = prevRight;
      ctx.tabOrder[idxB] = prevLeft;
      if (typeof tabsMod().syncTabsMapOrder === 'function') {
        tabsMod().syncTabsMapOrder(ctx);
      }
    }
  }

  if (vis) {
    wakeSplitTabsIfNeeded(ctx);
    syncWorkspaceLastActiveForSplit(ctx);
    layoutMod().updateActiveViewBounds(ctx);
    const focusedTab = ctx.tabs.get(split.focusedPane === 'right' ? split.rightTabId : split.leftTabId);
    if (focusedTab) {
      ctx.activeTabId = focusedTab.id;
      focusTabWebContentsSafe(focusedTab);
    }
    notifyActiveWebUiTabShown(ctx);
  }
  broadcastState(ctx);
  sessionMod().scheduleSessionSave(ctx);
  return serializeTabs(ctx);
}

function mergeSplitTabs(ctx, { leftTabId = null, rightTabId = null, focusPane = 'right' } = {}) {
  const { serializeTabs, broadcastState, notifyActiveWebUiTabShown } = broadcastMod();
  if (!ctx || !(ctx.tabs instanceof Map)) return null;
  const { wakeTab } = tabsMod();

  const resolvedLeftId =
    typeof leftTabId === 'string' && leftTabId.trim() ? leftTabId.trim() : ctx.activeTabId;
  const resolvedRightId =
    typeof rightTabId === 'string' && rightTabId.trim() ? rightTabId.trim() : null;

  if (!resolvedLeftId || !resolvedRightId || resolvedLeftId === resolvedRightId) {
    return serializeTabs(ctx);
  }
  const leftTab = ctx.tabs.get(resolvedLeftId);
  const rightTab = ctx.tabs.get(resolvedRightId);
  if (!leftTab || !rightTab) {
    return serializeTabs(ctx);
  }

  const activeWsId = getActiveWorkspaceId(ctx);
  const prevSplit = ensureSplitsMap(ctx).get(activeWsId) || null;
  if (!ctx.incognito) {
    if (!leftTab.pinned && leftTab.workspaceId !== activeWsId) leftTab.workspaceId = activeWsId;
    if (!rightTab.pinned && rightTab.workspaceId !== activeWsId) rightTab.workspaceId = activeWsId;
  }

  if (leftTab.sleeping) wakeTab(ctx, leftTab);
  if (rightTab.sleeping) wakeTab(ctx, rightTab);
  const now = Date.now();
  leftTab.lastActiveAt = now;
  rightTab.lastActiveAt = now;

  const initialFocusedPane = focusPane === 'left' ? 'left' : 'right';
  setSplitForWorkspace(ctx, activeWsId, {
    leftTabId: leftTab.id,
    rightTabId: rightTab.id,
    ratio: SPLIT_DEFAULT_RATIO,
    focusedPane: initialFocusedPane
  });

  if (prevSplit) {
    if (prevSplit.leftTabId !== leftTab.id && prevSplit.leftTabId !== rightTab.id) {
      cleanupDetachedPickerTab(ctx, prevSplit.leftTabId);
    }
    if (prevSplit.rightTabId !== leftTab.id && prevSplit.rightTabId !== rightTab.id) {
      cleanupDetachedPickerTab(ctx, prevSplit.rightTabId);
    }
  }

  const focusedTab = initialFocusedPane === 'right' ? rightTab : leftTab;
  ctx.activeTabId = focusedTab.id;

  syncWorkspaceLastActiveForSplit(ctx);
  gxControlMod().onActiveTabChanged(ctx);
  layoutMod().updateActiveViewBounds(ctx);
  focusTabWebContentsSafe(focusedTab);
  notifyActiveWebUiTabShown(ctx);
  broadcastState(ctx);
  sessionMod().scheduleSessionSave(ctx);
  return serializeTabs(ctx);
}

function removeTemporaryPickerTab(ctx, pickerTabId) {
  if (!ctx || !pickerTabId || !(ctx.tabs instanceof Map)) return;
  const pickerTab = ctx.tabs.get(pickerTabId);
  if (!pickerTab) return;
  if (pickerTab.view) {
    try {
      gxControlMod().onTabDetached(pickerTab);
    } catch (_) {}
    try {
      if (ctx.win && !ctx.win.isDestroyed()) {
        ctx.win.contentView.removeChildView(pickerTab.view);
      }
      if (pickerTab.view.webContents && !pickerTab.view.webContents.isDestroyed()) {
        pickerTab.view.webContents.close();
      }
    } catch (_) {}
    pickerTab.view = null;
  }
  ctx.tabs.delete(pickerTabId);
  if (Array.isArray(ctx.tabOrder)) {
    const idx = ctx.tabOrder.indexOf(pickerTabId);
    if (idx !== -1) ctx.tabOrder.splice(idx, 1);
  }
}

function findPickerPaneInSplit(ctx) {
  const { isSplitPickerUrl } = require('./utils');
  const vis = getVisibleSplitTabs(ctx);
  if (!vis) return null;
  const { split, leftTab, rightTab } = vis;
  if (rightTab && (rightTab.isSplitPicker || isSplitPickerUrl(rightTab.url))) {
    return { split, side: 'right', pickerTab: rightTab, partnerTab: leftTab };
  }
  if (leftTab && (leftTab.isSplitPicker || isSplitPickerUrl(leftTab.url))) {
    return { split, side: 'left', pickerTab: leftTab, partnerTab: rightTab };
  }
  return null;
}

function getSplitPickerData(ctx) {
  if (!ctx || !(ctx.tabs instanceof Map)) return { openTabs: [], theme: 'gx-violet' };
  const { isSplitPickerUrl } = require('./utils');
  const { formatDisplayUrl } = require('./navigation');
  const { isTabVisibleInWorkspace } = workspacesMod();
  const activeWsId = getActiveWorkspaceId(ctx);
  const found = findPickerPaneInSplit(ctx);
  const excludeIds = new Set();
  if (found) {
    if (found.pickerTab) excludeIds.add(found.pickerTab.id);
    if (found.partnerTab) excludeIds.add(found.partnerTab.id);
  } else if (ctx.activeTabId) {
    excludeIds.add(ctx.activeTabId);
  }

  const openTabs = [];
  for (const id of ctx.tabOrder || []) {
    if (excludeIds.has(id)) continue;
    const t = ctx.tabs.get(id);
    if (!t || t.isSplitPicker || isSplitPickerUrl(t.url)) continue;
    if (!isTabVisibleInWorkspace(t, activeWsId)) continue;
    openTabs.push({
      id: t.id,
      title: t.title || formatDisplayUrl(t.url) || 'Tab',
      url: formatDisplayUrl(t.url),
      favicon: t.favicon || '',
      pinned: Boolean(t.pinned)
    });
  }

  const theme = coreMod().state.storage?.getSettings?.(ctx.profileId)?.theme || 'gx-violet';
  return { openTabs, theme };
}

function pickSplitPickerTab(ctx, { tabId = null } = {}) {
  const { serializeTabs, broadcastState, notifyActiveWebUiTabShown } = broadcastMod();
  if (!ctx || !(ctx.tabs instanceof Map)) return null;
  const targetId = typeof tabId === 'string' && tabId.trim() ? tabId.trim() : null;
  if (!targetId || !ctx.tabs.has(targetId)) return serializeTabs(ctx);

  const found = findPickerPaneInSplit(ctx);
  if (!found) {
    return mergeSplitTabs(ctx, { rightTabId: targetId, focusPane: 'right' });
  }

  const { split, side, pickerTab, partnerTab } = found;
  if (partnerTab && targetId === partnerTab.id) {
    return serializeTabs(ctx);
  }

  const chosenTab = ctx.tabs.get(targetId);
  if (!chosenTab) return serializeTabs(ctx);
  if (chosenTab.sleeping) tabsMod().wakeTab(ctx, chosenTab);
  chosenTab.lastActiveAt = Date.now();

  if (side === 'right') {
    split.rightTabId = chosenTab.id;
    split.focusedPane = 'right';
  } else {
    split.leftTabId = chosenTab.id;
    split.focusedPane = 'left';
  }

  const pickerTabId = pickerTab ? pickerTab.id : null;
  ctx.activeTabId = chosenTab.id;
  if (pickerTabId && pickerTabId !== chosenTab.id) {
    removeTemporaryPickerTab(ctx, pickerTabId);
  }

  wakeSplitTabsIfNeeded(ctx);
  syncWorkspaceLastActiveForSplit(ctx);
  gxControlMod().onActiveTabChanged(ctx);
  layoutMod().updateActiveViewBounds(ctx);
  focusTabWebContentsSafe(chosenTab);
  notifyActiveWebUiTabShown(ctx);
  broadcastState(ctx);
  sessionMod().scheduleSessionSave(ctx);
  return serializeTabs(ctx);
}

function openNewTabInSplitPicker(ctx) {
  const { serializeTabs, broadcastState, notifyActiveWebUiTabShown } = broadcastMod();
  if (!ctx) return null;
  const { appendInternalUrlParams } = require('./utils');
  const { NEW_TAB_FILE_URL } = coreMod();
  const found = findPickerPaneInSplit(ctx);
  const tab = found?.pickerTab || (ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null);
  if (!tab) return serializeTabs(ctx);

  tab.isSplitPicker = false;
  const targetUrl = appendInternalUrlParams(NEW_TAB_FILE_URL, ctx);
  tab.url = targetUrl;
  tab.title = ctx.incognito ? 'Private Start' : 'Start Page';
  if (tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()) {
    tab.view.webContents.loadURL(targetUrl).catch(() => {});
  }
  ctx.activeTabId = tab.id;
  focusTabWebContentsSafe(tab);
  notifyActiveWebUiTabShown(ctx);
  broadcastState(ctx);
  sessionMod().scheduleSessionSave(ctx);
  return serializeTabs(ctx);
}

function navigateSplitPicker(ctx, { url = '' } = {}) {
  const { serializeTabs, broadcastState } = broadcastMod();
  if (!ctx) return null;
  const trimmed = String(url || '').trim();
  if (!trimmed) return serializeTabs(ctx);
  const { appendInternalUrlParams } = require('./utils');
  const { resolveNavigateInput } = require('./navigation');
  const found = findPickerPaneInSplit(ctx);
  const tab = found?.pickerTab || (ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null);
  if (!tab) return serializeTabs(ctx);

  tab.isSplitPicker = false;
  const targetUrl = appendInternalUrlParams(resolveNavigateInput(trimmed), ctx);
  tab.url = targetUrl;
  tab.navSeq = (tab.navSeq || 0) + 1;
  tab.explicitNavSeq = (tab.explicitNavSeq || 0) + 1;
  if (tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()) {
    tab.view.webContents.loadURL(targetUrl).catch(() => {});
  }
  ctx.activeTabId = tab.id;
  focusTabWebContentsSafe(tab);
  broadcastState(ctx);
  sessionMod().scheduleSessionSave(ctx);
  return serializeTabs(ctx);
}

function cancelSplitPicker(ctx) {
  const { serializeTabs, broadcastState, notifyActiveWebUiTabShown } = broadcastMod();
  if (!ctx) return null;
  const found = findPickerPaneInSplit(ctx);
  if (!found) return exitSplit(ctx);

  const { pickerTab, partnerTab } = found;
  deleteSplitForWorkspace(ctx, getActiveWorkspaceId(ctx));
  if (partnerTab && ctx.tabs.has(partnerTab.id)) {
    ctx.activeTabId = partnerTab.id;
    if (partnerTab.sleeping) tabsMod().wakeTab(ctx, partnerTab);
    partnerTab.lastActiveAt = Date.now();
  }
  if (pickerTab) {
    removeTemporaryPickerTab(ctx, pickerTab.id);
  }

  gxControlMod().onActiveTabChanged(ctx);
  layoutMod().updateActiveViewBounds(ctx);
  popoversMod().restoreFocusToActiveTab(ctx);
  notifyActiveWebUiTabShown(ctx);
  broadcastState(ctx);
  sessionMod().scheduleSessionSave(ctx);
  return serializeTabs(ctx);
}

function setSplitRatio(ctx, rawRatio, { persist = true } = {}) {
  const { serializeTabs, broadcastState } = broadcastMod();
  if (!ctx) return null;
  const split = syncSplitFocusedPane(ctx);
  if (!split) return serializeTabs(ctx);

  const nextRatio = clampSplitRatio(rawRatio);
  const changed = split.ratio !== nextRatio;
  split.ratio = nextRatio;

  layoutMod().updateActiveViewBounds(ctx);
  if (persist !== false) {
    broadcastState(ctx);
    if (changed || persist === true) {
      sessionMod().scheduleSessionSave(ctx);
    }
  }
  return serializeTabs(ctx);
}

function focusSplitPane(ctx, { pane = null, tabId = null } = {}) {
  const { serializeTabs } = broadcastMod();
  if (!ctx) return null;
  const split = syncSplitFocusedPane(ctx);
  if (!split) return serializeTabs(ctx);

  let targetPane = null;
  let targetTabId = null;

  if (pane === 'left') {
    targetPane = 'left';
    targetTabId = split.leftTabId;
  } else if (pane === 'right') {
    targetPane = 'right';
    targetTabId = split.rightTabId;
  } else if (tabId && tabId === split.leftTabId) {
    targetPane = 'left';
    targetTabId = split.leftTabId;
  } else if (tabId && tabId === split.rightTabId) {
    targetPane = 'right';
    targetTabId = split.rightTabId;
  }

  if (!targetPane || !targetTabId || !ctx.tabs.has(targetTabId)) {
    return serializeTabs(ctx);
  }

  split.focusedPane = targetPane;
  const result = tabsMod().switchTab(ctx, targetTabId);
  const targetTab = ctx.tabs.get(targetTabId);
  focusTabWebContentsSafe(targetTab);
  return result;
}

function restoreSplitState(
  ctx,
  { leftTabId, rightTabId, ratio = SPLIT_DEFAULT_RATIO, focusedPane = 'left', workspaceId = null } = {}
) {
  if (!ctx || !(ctx.tabs instanceof Map)) return false;
  if (!leftTabId || !rightTabId || leftTabId === rightTabId) return false;
  if (!ctx.tabs.has(leftTabId) || !ctx.tabs.has(rightTabId)) return false;

  const targetWsId = ctx.incognito ? DEFAULT_WORKSPACE_ID : workspaceId || getActiveWorkspaceId(ctx);
  const activeWsId = getActiveWorkspaceId(ctx);

  setSplitForWorkspace(ctx, targetWsId, {
    leftTabId,
    rightTabId,
    ratio: clampSplitRatio(ratio),
    focusedPane: focusedPane === 'right' ? 'right' : 'left'
  });

  if (targetWsId === activeWsId) {
    syncSplitFocusedPane(ctx);
    wakeSplitTabsIfNeeded(ctx);
    syncWorkspaceLastActiveForSplit(ctx);
    layoutMod().updateActiveViewBounds(ctx);
    broadcastMod().broadcastState(ctx);
  } else if (
    !ctx.incognito &&
    ctx.workspaceLastActiveTab instanceof Map &&
    !ctx.workspaceLastActiveTab.has(targetWsId)
  ) {
    const leftTab = ctx.tabs.get(leftTabId);
    const rightTab = ctx.tabs.get(rightTabId);
    const { isTabVisibleInWorkspace } = workspacesMod();
    const prefTab = focusedPane === 'right' ? rightTab : leftTab;
    const altTab = focusedPane === 'right' ? leftTab : rightTab;
    if (prefTab && !prefTab.pinned && isTabVisibleInWorkspace(prefTab, targetWsId)) {
      ctx.workspaceLastActiveTab.set(targetWsId, prefTab.id);
    } else if (altTab && !altTab.pinned && isTabVisibleInWorkspace(altTab, targetWsId)) {
      ctx.workspaceLastActiveTab.set(targetWsId, altTab.id);
    }
  }
  return true;
}

/**
 * Called from a tab's WebContents 'focus' event in src/main/tabs.js.
 * Keeps focusedPane and activeTabId synchronized when the user clicks
 * directly inside either pane of a visible split view.
 */
function onTabWebContentsFocused(ctx, tabId) {
  if (!ctx || !tabId) return false;
  const vis = getVisibleSplitTabs(ctx);
  if (!vis) return false;
  const { split } = vis;
  if (tabId !== split.leftTabId && tabId !== split.rightTabId) return false;

  const nextPane = tabId === split.leftTabId ? 'left' : 'right';
  const changed = split.focusedPane !== nextPane || ctx.activeTabId !== tabId;
  if (!changed) return false;

  const prevTab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
  if (prevTab && prevTab.id !== tabId) {
    prevTab.lastActiveAt = Date.now();
    if (prevTab.lastFindRequestId !== null) {
      prevTab.lastFindRequestId = null;
      if (prevTab.view && prevTab.view.webContents && !prevTab.view.webContents.isDestroyed()) {
        try {
          prevTab.view.webContents.stopFindInPage('clearSelection');
        } catch (_) {}
      }
    }
  }

  split.focusedPane = nextPane;
  ctx.activeTabId = tabId;
  const focusedTab = ctx.tabs.get(tabId);
  if (focusedTab) {
    focusedTab.lastActiveAt = Date.now();
  }
  syncWorkspaceLastActiveForSplit(ctx);
  gxControlMod().onActiveTabChanged(ctx);
  broadcastMod().notifyActiveWebUiTabShown(ctx);
  broadcastMod().broadcastState(ctx);
  sessionMod().scheduleSessionSave(ctx);
  return true;
}

/**
 * Called inside switchTab(ctx, tabId) after ctx.activeTabId is updated,
 * before updateActiveViewBounds(ctx) and broadcastState(ctx).
 */
function onTabSwitched(ctx, tabId) {
  const split = syncSplitFocusedPane(ctx);
  if (!split) return { inVisibleSplit: false };
  const vis = getVisibleSplitTabs(ctx);
  if (!vis) return { inVisibleSplit: false };
  wakeSplitTabsIfNeeded(ctx);
  syncWorkspaceLastActiveForSplit(ctx);
  return { inVisibleSplit: true };
}

/**
 * Called in closeTab(ctx, tabId) BEFORE deleting tabId from ctx.tabs.
 * Automatically clears any workspace split referencing tabId and returns
 * the surviving partner tab ID for the active workspace so closeTab can
 * activate it cleanly.
 */
function onTabClosing(ctx, tabId) {
  if (!ctx || !tabId) {
    return { wasInSplit: false, wasVisible: false, partnerTabId: null };
  }
  const map = ensureSplitsMap(ctx);
  const activeWsId = getActiveWorkspaceId(ctx);
  let result = { wasInSplit: false, wasVisible: false, partnerTabId: null };

  for (const wsId of Array.from(map.keys())) {
    const split = pruneInvalidSplit(ctx, wsId);
    if (!split) continue;
    if (split.leftTabId !== tabId && split.rightTabId !== tabId) continue;

    const partnerTabId = split.leftTabId === tabId ? split.rightTabId : split.leftTabId;
    const wasVisible = wsId === activeWsId ? Boolean(getVisibleSplitTabs(ctx)) : false;
    deleteSplitForWorkspace(ctx, wsId);

    if (partnerTabId && partnerTabId !== tabId) {
      cleanupDetachedPickerTab(ctx, partnerTabId);
    }

    if (wsId === activeWsId) {
      result = {
        wasInSplit: true,
        wasVisible,
        partnerTabId: partnerTabId && ctx.tabs.has(partnerTabId) ? partnerTabId : null
      };
    }
  }

  return result;
}

/**
 * Called in closeOtherTabs(ctx, keepTabId) after removing closed tabs.
 */
function onTabsClosed(ctx, closedIds) {
  if (!ctx) return false;
  const map = ensureSplitsMap(ctx);
  let clearedAny = false;
  for (const wsId of Array.from(map.keys())) {
    const split = map.get(wsId);
    if (!split) continue;
    if (closedIds instanceof Set && (closedIds.has(split.leftTabId) || closedIds.has(split.rightTabId))) {
      const survivingId = closedIds.has(split.leftTabId) ? split.rightTabId : split.leftTabId;
      deleteSplitForWorkspace(ctx, wsId);
      if (survivingId && !closedIds.has(survivingId)) {
        cleanupDetachedPickerTab(ctx, survivingId);
      }
      clearedAny = true;
      continue;
    }
    if (!pruneInvalidSplit(ctx, wsId)) {
      clearedAny = true;
    }
  }
  syncSplitFocusedPane(ctx);
  return clearedAny;
}

/**
 * Reconciles split view bounds and broadcast state after workspace mutations
 * (e.g. moving a non-focused split tab to another workspace or deleting a workspace)
 * without requiring edits to workspaces.js.
 */
function onWorkspacesChanged(ctx = null, { allNormalWindows = false } = {}) {
  const contexts = allNormalWindows
    ? Array.from(coreMod().windowContexts.values()).filter((c) => c && !c.incognito)
    : ctx
    ? [ctx]
    : [];
  const { getWorkspaces } = workspacesMod();
  const validWsIds = new Set(getWorkspaces().map((w) => w && w.id).filter(Boolean));
  for (const c of contexts) {
    if (!c || !c.win || c.win.isDestroyed()) continue;
    const map = ensureSplitsMap(c);
    const hadAny = map.size > 0 || Boolean(c.split);
    for (const wsId of Array.from(map.keys())) {
      if (!c.incognito && !validWsIds.has(wsId)) {
        map.delete(wsId);
      } else {
        pruneInvalidSplit(c, wsId);
      }
    }
    syncSplitFocusedPane(c);
    if (!hadAny && !c.split) continue;
    wakeSplitTabsIfNeeded(c);
    layoutMod().updateActiveViewBounds(c);
    broadcastMod().broadcastState(c);
  }
}

function registerSplitIpcHandlers(handleInternal) {
  const { getCtxFromSender } = broadcastMod();

  handleInternal('split:toggle', (e) => toggleSplit(getCtxFromSender(e.sender)));

  handleInternal('split:start', (e, payload) => {
    const ctx = getCtxFromSender(e.sender);
    const opts =
      typeof payload === 'string'
        ? { tabId: payload }
        : payload && typeof payload === 'object'
        ? payload
        : {};
    return startSplit(ctx, opts);
  });

  handleInternal('split:exit', (e) => exitSplit(getCtxFromSender(e.sender)));

  handleInternal('split:swap', (e) => swapSplitPanes(getCtxFromSender(e.sender)));

  handleInternal('split:merge', (e, payload) => {
    const ctx = getCtxFromSender(e.sender);
    const opts = payload && typeof payload === 'object' ? payload : {};
    return mergeSplitTabs(ctx, opts);
  });

  handleInternal('split:picker-data', (e) => getSplitPickerData(getCtxFromSender(e.sender)));

  handleInternal('split:picker-choose', (e, payload) => {
    const ctx = getCtxFromSender(e.sender);
    const opts = payload && typeof payload === 'object' ? payload : {};
    return pickSplitPickerTab(ctx, opts);
  });

  handleInternal('split:picker-new-tab', (e) => openNewTabInSplitPicker(getCtxFromSender(e.sender)));

  handleInternal('split:picker-navigate', (e, payload) => {
    const ctx = getCtxFromSender(e.sender);
    const opts = payload && typeof payload === 'object' ? payload : {};
    return navigateSplitPicker(ctx, opts);
  });

  handleInternal('split:picker-cancel', (e) => cancelSplitPicker(getCtxFromSender(e.sender)));

  handleInternal('split:set-ratio', (e, payload) => {
    const ctx = getCtxFromSender(e.sender);
    if (typeof payload === 'number') {
      return setSplitRatio(ctx, payload, { persist: true });
    }
    const opts = payload && typeof payload === 'object' ? payload : {};
    return setSplitRatio(ctx, opts.ratio, { persist: opts.persist !== false });
  });

  handleInternal('split:focus-pane', (e, payload) => {
    const ctx = getCtxFromSender(e.sender);
    const opts =
      typeof payload === 'string'
        ? payload === 'left' || payload === 'right'
          ? { pane: payload }
          : { tabId: payload }
        : payload && typeof payload === 'object'
        ? payload
        : {};
    return focusSplitPane(ctx, opts);
  });
}

module.exports = {
  SPLIT_DEFAULT_RATIO,
  SPLIT_MIN_RATIO,
  SPLIT_MAX_RATIO,
  SPLIT_DIVIDER_WIDTH,
  clampSplitRatio,
  getSplitForWorkspace,
  pruneInvalidSplit,
  syncSplitFocusedPane,
  getVisibleSplitTabs,
  isSplitVisible,
  isTabInSplit,
  isTabInVisibleSplit,
  computeSplitPaneBounds,
  serializeSplitState,
  serializeSplitForSession,
  serializeSplitsForSession,
  startSplit,
  exitSplit,
  toggleSplit,
  swapSplitPanes,
  mergeSplitTabs,
  getSplitPickerData,
  pickSplitPickerTab,
  openNewTabInSplitPicker,
  navigateSplitPicker,
  cancelSplitPicker,
  setSplitRatio,
  focusSplitPane,
  restoreSplitState,
  onTabWebContentsFocused,
  onTabSwitched,
  onTabClosing,
  onTabsClosed,
  onWorkspacesChanged,
  registerSplitIpcHandlers
};
