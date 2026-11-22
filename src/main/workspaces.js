const { windowContexts, state } = require('./core');
const { serializeTabs, broadcastState } = require('./broadcast');
const { scheduleSessionSave } = require('./session');

const tabsMod = () => require('./tabs');

const DEFAULT_WORKSPACE_ID = 'default';
const DEFAULT_WORKSPACE_NAME = 'Default';
const GROUP_COLORS = [
  'group-1',
  'group-2',
  'group-3',
  'group-4',
  'group-5',
  'group-6',
  'group-7',
  'group-8'
];

function sanitizeName(raw, maxLen = 40) {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/\s+/g, ' ').slice(0, maxLen);
}

function getWorkspaces() {
  if (!state.storage) {
    return [{ id: DEFAULT_WORKSPACE_ID, name: DEFAULT_WORKSPACE_NAME, icon: '', color: '', createdAt: 0 }];
  }
  return state.storage.getWorkspaces();
}

function hasWorkspace(workspaceId) {
  if (!workspaceId || typeof workspaceId !== 'string') return false;
  return getWorkspaces().some((w) => w && w.id === workspaceId);
}

function getGroupsForCtx(ctx) {
  if (ctx && ctx.incognito) {
    if (!Array.isArray(ctx.privateGroups)) ctx.privateGroups = [];
    return ctx.privateGroups;
  }
  if (!state.storage) return [];
  return state.storage.getTabGroups();
}

function saveGroupsForCtx(ctx, groups) {
  if (ctx && ctx.incognito) {
    ctx.privateGroups = Array.isArray(groups) ? groups : [];
    return ctx.privateGroups;
  }
  if (!state.storage) return Array.isArray(groups) ? groups : [];
  return state.storage.saveTabGroups(groups);
}

function getGroupById(ctx, groupId) {
  if (!groupId || typeof groupId !== 'string') return null;
  return getGroupsForCtx(ctx).find((g) => g && g.id === groupId) || null;
}

function broadcastNormalWindowsState() {
  for (const c of windowContexts.values()) {
    if (c && !c.incognito) {
      broadcastState(c);
    }
  }
}

function broadcastGroupsChange(ctx) {
  if (ctx && ctx.incognito) {
    broadcastState(ctx);
  } else {
    broadcastNormalWindowsState();
  }
}

function getNextWorkspaceName() {
  const existing = new Set(getWorkspaces().map((w) => (w.name || '').toLowerCase()));
  let idx = 2;
  while (existing.has(`workspace ${idx}`)) idx += 1;
  return `Workspace ${idx}`;
}

function getNextGroupName(ctx, workspaceId) {
  const wsId = workspaceId || DEFAULT_WORKSPACE_ID;
  const existing = new Set(
    getGroupsForCtx(ctx)
      .filter((g) => g && g.workspaceId === wsId)
      .map((g) => (g.name || '').toLowerCase())
  );
  let idx = 1;
  while (existing.has(`group ${idx}`)) idx += 1;
  return `Group ${idx}`;
}

function getNextGroupColor(ctx, workspaceId) {
  const wsId = workspaceId || DEFAULT_WORKSPACE_ID;
  const wsGroups = getGroupsForCtx(ctx).filter((g) => g && g.workspaceId === wsId);
  const used = new Set(wsGroups.map((g) => g.color));
  for (const color of GROUP_COLORS) {
    if (!used.has(color)) return color;
  }
  return GROUP_COLORS[wsGroups.length % GROUP_COLORS.length];
}

function isTabVisibleInWorkspace(tab, workspaceId) {
  if (!tab) return false;
  if (tab.pinned) return true;
  return (tab.workspaceId || DEFAULT_WORKSPACE_ID) === (workspaceId || DEFAULT_WORKSPACE_ID);
}

function normalizeGroupContiguity(ctx) {
  if (!ctx || !Array.isArray(ctx.tabOrder) || !ctx.tabs) return;
  const pinnedIds = [];
  const unpinnedIds = [];

  for (const id of ctx.tabOrder) {
    const tab = ctx.tabs.get(id);
    if (!tab) continue;
    if (tab.pinned) {
      tab.groupId = null;
      pinnedIds.push(id);
      continue;
    }
    unpinnedIds.push(id);
  }

  const orderedUnpinned = [];
  const emittedGroups = new Set();
  for (const id of unpinnedIds) {
    const tab = ctx.tabs.get(id);
    if (!tab) continue;
    const gid = tab.groupId || null;
    if (!gid) {
      orderedUnpinned.push(id);
      continue;
    }
    const wsId = ctx.incognito ? DEFAULT_WORKSPACE_ID : tab.workspaceId || DEFAULT_WORKSPACE_ID;
    const groupKey = `${wsId}::${gid}`;
    if (emittedGroups.has(groupKey)) continue;
    emittedGroups.add(groupKey);
    for (const candidateId of unpinnedIds) {
      const cand = ctx.tabs.get(candidateId);
      if (!cand) continue;
      const candWsId = ctx.incognito ? DEFAULT_WORKSPACE_ID : cand.workspaceId || DEFAULT_WORKSPACE_ID;
      if (candWsId === wsId && cand.groupId === gid) {
        orderedUnpinned.push(candidateId);
      }
    }
  }

  ctx.tabOrder = [...pinnedIds, ...orderedUnpinned];
  tabsMod().syncTabsMapOrder(ctx);
}

function countTabsInGroup(ctx, groupId) {
  if (!groupId) return 0;
  if (ctx && ctx.incognito) {
    let count = 0;
    for (const tab of ctx.tabs.values()) {
      if (tab && !tab.pinned && tab.groupId === groupId) count += 1;
    }
    return count;
  }
  let count = 0;
  for (const c of windowContexts.values()) {
    if (!c || c.incognito) continue;
    if (!c.sessionReady && c.pendingRestoreTabs && Array.isArray(c.pendingRestoreTabs.tabs)) {
      for (const item of c.pendingRestoreTabs.tabs) {
        if (item && !item.pinned && item.groupId === groupId) count += 1;
      }
      continue;
    }
    for (const tab of c.tabs.values()) {
      if (tab && !tab.pinned && tab.groupId === groupId) count += 1;
    }
  }
  return count;
}

function pruneGroupIfEmpty(ctx, groupId, { broadcast = true } = {}) {
  if (!groupId) return false;
  const groups = getGroupsForCtx(ctx);
  if (!groups.some((g) => g && g.id === groupId)) return false;
  if (countTabsInGroup(ctx, groupId) > 0) return false;

  const next = groups.filter((g) => g && g.id !== groupId);
  saveGroupsForCtx(ctx, next);
  if (broadcast) {
    broadcastGroupsChange(ctx);
  }
  return true;
}

function pruneAllEmptyGroups(ctx = null, { broadcast = true } = {}) {
  const targetCtx = ctx && ctx.incognito ? ctx : null;
  const groups = getGroupsForCtx(targetCtx);
  const next = groups.filter((g) => g && countTabsInGroup(targetCtx, g.id) > 0);
  if (next.length === groups.length) return false;
  saveGroupsForCtx(targetCtx, next);
  if (broadcast) {
    broadcastGroupsChange(targetCtx);
  }
  return true;
}

function ensureWorkspaceHasActiveTab(ctx, workspaceId) {
  const wsId = ctx.incognito ? DEFAULT_WORKSPACE_ID : workspaceId || DEFAULT_WORKSPACE_ID;
  const { createTabInternal, switchTab } = tabsMod();

  const wsUnpinned = ctx.tabOrder
    .map((id) => ctx.tabs.get(id))
    .filter((t) => t && !t.pinned && (t.workspaceId || DEFAULT_WORKSPACE_ID) === wsId);

  if (wsUnpinned.length === 0) {
    const created = createTabInternal(ctx, {
      url: 'nextgx://newtab',
      workspaceId: wsId,
      active: true
    });
    if (created && ctx.workspaceLastActiveTab) {
      ctx.workspaceLastActiveTab.set(wsId, created.id);
    }
    return created ? created.id : ctx.activeTabId;
  }

  const savedLastId = ctx.workspaceLastActiveTab?.get(wsId) || null;
  const savedTab = savedLastId ? ctx.tabs.get(savedLastId) : null;
  const targetId =
    savedTab && !savedTab.pinned && isTabVisibleInWorkspace(savedTab, wsId)
      ? savedTab.id
      : wsUnpinned[0].id;

  switchTab(ctx, targetId);
  return targetId;
}

// =========================================================================
// WORKSPACE OPERATIONS
// =========================================================================

function createWorkspace(ctx, { name, icon = '', color = '', switchTo = true } = {}) {
  if (ctx && ctx.incognito) {
    return {
      ok: false,
      error: 'Workspaces are not available in Private windows.',
      state: serializeTabs(ctx)
    };
  }
  if (!state.storage) {
    return { ok: false, error: 'Storage unavailable.' };
  }

  let resolvedName;
  if (name === undefined || name === null) {
    resolvedName = getNextWorkspaceName();
  } else {
    resolvedName = sanitizeName(name, 40);
    if (!resolvedName) {
      return {
        ok: false,
        error: 'Workspace name cannot be empty.',
        state: ctx ? serializeTabs(ctx) : null
      };
    }
  }

  const list = [...getWorkspaces()];
  const ws = {
    id: 'ws-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    name: resolvedName,
    icon: typeof icon === 'string' ? icon.trim().slice(0, 32) : '',
    color: typeof color === 'string' ? color.trim().slice(0, 24) : '',
    createdAt: Date.now()
  };
  list.push(ws);
  state.storage.saveWorkspaces(list);

  if (switchTo && ctx && !ctx.incognito) {
    switchWorkspace(ctx, ws.id);
    broadcastNormalWindowsState();
  } else {
    broadcastNormalWindowsState();
  }

  return {
    ok: true,
    workspace: ws,
    workspaces: state.storage.getWorkspaces(),
    state: ctx ? serializeTabs(ctx) : null
  };
}

function renameWorkspace(ctx, workspaceId, name) {
  if (ctx && ctx.incognito) {
    return {
      ok: false,
      error: 'Workspaces are not available in Private windows.',
      state: serializeTabs(ctx)
    };
  }
  if (!state.storage) return { ok: false, error: 'Storage unavailable.' };

  const cleanName = sanitizeName(name, 40);
  if (!cleanName) {
    return {
      ok: false,
      error: 'Workspace name cannot be empty.',
      state: ctx ? serializeTabs(ctx) : null
    };
  }

  const list = [...getWorkspaces()];
  const idx = list.findIndex((w) => w && w.id === workspaceId);
  if (idx === -1) {
    return {
      ok: false,
      error: 'Workspace not found.',
      state: ctx ? serializeTabs(ctx) : null
    };
  }

  list[idx] = { ...list[idx], name: cleanName };
  state.storage.saveWorkspaces(list);
  broadcastNormalWindowsState();
  return {
    ok: true,
    workspace: list[idx],
    workspaces: state.storage.getWorkspaces(),
    state: ctx ? serializeTabs(ctx) : null
  };
}

function switchWorkspace(ctx, workspaceId) {
  if (!ctx) return null;
  if (ctx.incognito) return serializeTabs(ctx);
  if (!workspaceId || !hasWorkspace(workspaceId)) {
    return serializeTabs(ctx);
  }

  const prevWsId = ctx.activeWorkspaceId || DEFAULT_WORKSPACE_ID;
  if (ctx.workspaceLastActiveTab && ctx.activeTabId && ctx.tabs.has(ctx.activeTabId)) {
    const activeTab = ctx.tabs.get(ctx.activeTabId);
    if (activeTab && !activeTab.pinned && isTabVisibleInWorkspace(activeTab, prevWsId)) {
      ctx.workspaceLastActiveTab.set(prevWsId, ctx.activeTabId);
    }
  }

  if (prevWsId === workspaceId) {
    const activeTab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    if (!activeTab || !isTabVisibleInWorkspace(activeTab, workspaceId)) {
      ensureWorkspaceHasActiveTab(ctx, workspaceId);
    } else {
      broadcastState(ctx);
    }
    return serializeTabs(ctx);
  }

  ctx.activeWorkspaceId = workspaceId;
  ensureWorkspaceHasActiveTab(ctx, workspaceId);
  scheduleSessionSave(ctx);
  return serializeTabs(ctx);
}

function deleteWorkspace(ctx, workspaceId) {
  if (ctx && ctx.incognito) {
    return {
      ok: false,
      error: 'Workspaces are not available in Private windows.',
      state: serializeTabs(ctx)
    };
  }
  if (!state.storage) return { ok: false, error: 'Storage unavailable.' };
  if (!workspaceId || workspaceId === DEFAULT_WORKSPACE_ID) {
    return {
      ok: false,
      error: 'Cannot delete the Default workspace.',
      state: ctx ? serializeTabs(ctx) : null
    };
  }

  const list = getWorkspaces();
  if (!list.some((w) => w && w.id === workspaceId)) {
    return {
      ok: false,
      error: 'Workspace not found.',
      state: ctx ? serializeTabs(ctx) : null
    };
  }

  // Remove groups belonging to the deleted workspace
  const remainingGroups = state.storage
    .getTabGroups()
    .filter((g) => g && g.workspaceId !== workspaceId);
  state.storage.saveTabGroups(remainingGroups);

  // Remove workspace from global store
  const nextWorkspaces = list.filter((w) => w && w.id !== workspaceId);
  state.storage.saveWorkspaces(nextWorkspaces);

  // Move all tabs from the deleted workspace to Default (never close tabs!),
  // and switch any window currently on the deleted workspace to Default.
  for (const c of windowContexts.values()) {
    if (!c || c.incognito) continue;
    const wasOnDeleted = c.activeWorkspaceId === workspaceId;
    if (c.workspaceLastActiveTab) {
      c.workspaceLastActiveTab.delete(workspaceId);
    }

    for (const tab of c.tabs.values()) {
      if (!tab) continue;
      if (!tab.pinned && tab.workspaceId === workspaceId) {
        tab.workspaceId = DEFAULT_WORKSPACE_ID;
        tab.groupId = null;
      }
    }

    if (wasOnDeleted) {
      c.activeWorkspaceId = DEFAULT_WORKSPACE_ID;
      const activeTab = c.activeTabId ? c.tabs.get(c.activeTabId) : null;
      const hasDefaultUnpinned = Array.from(c.tabs.values()).some(
        (t) => t && !t.pinned && (t.workspaceId || DEFAULT_WORKSPACE_ID) === DEFAULT_WORKSPACE_ID
      );
      if (!activeTab || !isTabVisibleInWorkspace(activeTab, DEFAULT_WORKSPACE_ID) || !hasDefaultUnpinned) {
        ensureWorkspaceHasActiveTab(c, DEFAULT_WORKSPACE_ID);
      } else if (!activeTab.pinned && c.workspaceLastActiveTab instanceof Map) {
        c.workspaceLastActiveTab.set(DEFAULT_WORKSPACE_ID, activeTab.id);
      }
    }
    normalizeGroupContiguity(c);
  }

  broadcastNormalWindowsState();
  scheduleSessionSave(ctx);

  return {
    ok: true,
    workspaces: state.storage.getWorkspaces(),
    state: ctx ? serializeTabs(ctx) : null
  };
}

function moveTabToWorkspace(ctx, tabId, targetWorkspaceId) {
  if (!ctx || ctx.incognito) return serializeTabs(ctx);
  const tab = tabId ? ctx.tabs.get(tabId) : null;
  if (!tab || tab.pinned) return serializeTabs(ctx);
  if (!targetWorkspaceId || !hasWorkspace(targetWorkspaceId)) return serializeTabs(ctx);

  const sourceWsId = tab.workspaceId || DEFAULT_WORKSPACE_ID;
  if (sourceWsId === targetWorkspaceId) return serializeTabs(ctx);

  const prevGroupId = tab.groupId || null;
  const wasActive = ctx.activeTabId === tabId;

  tab.workspaceId = targetWorkspaceId;
  tab.groupId = null;

  if (ctx.workspaceLastActiveTab) {
    if (ctx.workspaceLastActiveTab.get(sourceWsId) === tabId) {
      ctx.workspaceLastActiveTab.delete(sourceWsId);
    }
    ctx.workspaceLastActiveTab.set(targetWorkspaceId, tabId);
  }

  normalizeGroupContiguity(ctx);
  if (prevGroupId) {
    pruneGroupIfEmpty(ctx, prevGroupId, { broadcast: false });
  }

  if (wasActive && ctx.activeWorkspaceId === sourceWsId) {
    ensureWorkspaceHasActiveTab(ctx, sourceWsId);
  }

  broadcastNormalWindowsState();
  scheduleSessionSave(ctx);
  return serializeTabs(ctx);
}

// =========================================================================
// TAB ISLAND / GROUP OPERATIONS
// =========================================================================

function createTabGroup(ctx, { tabIds = [], name, color, workspaceId } = {}) {
  if (!ctx) return { ok: false, error: 'Missing window context.' };
  const targetWsId = ctx.incognito
    ? DEFAULT_WORKSPACE_ID
    : workspaceId && hasWorkspace(workspaceId)
    ? workspaceId
    : ctx.activeWorkspaceId || DEFAULT_WORKSPACE_ID;

  const uniqueTabs = [];
  const seen = new Set();
  for (const id of Array.isArray(tabIds) ? tabIds : []) {
    if (!id || seen.has(id)) continue;
    const t = ctx.tabs.get(id);
    if (!t || t.pinned) continue;
    if ((t.workspaceId || DEFAULT_WORKSPACE_ID) !== targetWsId) continue;
    seen.add(id);
    uniqueTabs.push(t);
  }

  if (uniqueTabs.length === 0) {
    return { ok: false, error: 'At least one unpinned tab is required to create a group.', state: serializeTabs(ctx) };
  }

  const groupName = sanitizeName(name, 40) || getNextGroupName(ctx, targetWsId);
  const groupColor = GROUP_COLORS.includes(color) ? color : getNextGroupColor(ctx, targetWsId);

  const group = {
    id: 'grp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    workspaceId: targetWsId,
    name: groupName,
    color: groupColor,
    collapsed: false,
    createdAt: Date.now()
  };

  const prevGroupIds = new Set();
  for (const t of uniqueTabs) {
    if (t.groupId) prevGroupIds.add(t.groupId);
    t.groupId = group.id;
  }

  const groups = [...getGroupsForCtx(ctx), group];
  saveGroupsForCtx(ctx, groups);

  normalizeGroupContiguity(ctx);
  for (const oldGid of prevGroupIds) {
    pruneGroupIfEmpty(ctx, oldGid, { broadcast: false });
  }

  broadcastGroupsChange(ctx);
  scheduleSessionSave(ctx);
  return { ok: true, group, state: serializeTabs(ctx) };
}

function addTabToGroup(ctx, tabId, groupId, { afterTabId = null, atStart = false } = {}) {
  if (!ctx) return serializeTabs(ctx);
  const tab = tabId ? ctx.tabs.get(tabId) : null;
  if (!tab || tab.pinned) return serializeTabs(ctx);

  const group = getGroupById(ctx, groupId);
  if (!group) return serializeTabs(ctx);

  const tabWsId = ctx.incognito ? DEFAULT_WORKSPACE_ID : tab.workspaceId || DEFAULT_WORKSPACE_ID;
  if (group.workspaceId !== tabWsId) return serializeTabs(ctx);

  const prevGroupId = tab.groupId || null;
  if (prevGroupId === groupId && !afterTabId && !atStart) {
    return serializeTabs(ctx);
  }

  tab.groupId = groupId;

  // Position tab contiguously within the group
  const curIdx = ctx.tabOrder.indexOf(tabId);
  if (curIdx !== -1) ctx.tabOrder.splice(curIdx, 1);

  if (afterTabId && afterTabId !== tabId) {
    const afterIdx = ctx.tabOrder.indexOf(afterTabId);
    if (afterIdx !== -1) {
      ctx.tabOrder.splice(afterIdx + 1, 0, tabId);
    } else {
      ctx.tabOrder.push(tabId);
    }
  } else if (atStart) {
    const firstIdx = ctx.tabOrder.findIndex((id) => {
      const t = ctx.tabs.get(id);
      return t && !t.pinned && t.groupId === groupId;
    });
    if (firstIdx !== -1) ctx.tabOrder.splice(firstIdx, 0, tabId);
    else ctx.tabOrder.push(tabId);
  } else {
    const lastIdx = ctx.tabOrder.findLastIndex((id) => {
      const t = ctx.tabs.get(id);
      return t && !t.pinned && t.groupId === groupId;
    });
    if (lastIdx !== -1) ctx.tabOrder.splice(lastIdx + 1, 0, tabId);
    else ctx.tabOrder.push(tabId);
  }

  normalizeGroupContiguity(ctx);
  if (prevGroupId && prevGroupId !== groupId) {
    pruneGroupIfEmpty(ctx, prevGroupId, { broadcast: false });
  }

  broadcastGroupsChange(ctx);
  scheduleSessionSave(ctx);
  return serializeTabs(ctx);
}

function removeTabFromGroup(ctx, tabId) {
  if (!ctx) return serializeTabs(ctx);
  const tab = tabId ? ctx.tabs.get(tabId) : null;
  if (!tab || !tab.groupId) return serializeTabs(ctx);

  const prevGroupId = tab.groupId;
  tab.groupId = null;

  // Place tab right after the remaining tabs of its former group so it does not split the group
  const lastInGroupIdx = ctx.tabOrder.findLastIndex((id) => {
    const t = ctx.tabs.get(id);
    return t && !t.pinned && t.groupId === prevGroupId;
  });
  const curIdx = ctx.tabOrder.indexOf(tabId);
  if (curIdx !== -1 && lastInGroupIdx !== -1 && curIdx < lastInGroupIdx) {
    ctx.tabOrder.splice(curIdx, 1);
    const updatedLastIdx = ctx.tabOrder.findLastIndex((id) => {
      const t = ctx.tabs.get(id);
      return t && !t.pinned && t.groupId === prevGroupId;
    });
    ctx.tabOrder.splice(updatedLastIdx + 1, 0, tabId);
  }

  normalizeGroupContiguity(ctx);
  pruneGroupIfEmpty(ctx, prevGroupId, { broadcast: false });

  broadcastGroupsChange(ctx);
  scheduleSessionSave(ctx);
  return serializeTabs(ctx);
}

function updateTabGroup(ctx, groupId, updates = {}) {
  if (!ctx || !groupId) return { ok: false, error: 'Missing group ID.' };
  const groups = [...getGroupsForCtx(ctx)];
  const idx = groups.findIndex((g) => g && g.id === groupId);
  if (idx === -1) return { ok: false, error: 'Group not found.', state: serializeTabs(ctx) };

  const current = groups[idx];
  const next = { ...current };

  if (Object.prototype.hasOwnProperty.call(updates, 'name')) {
    const clean = sanitizeName(updates.name, 40);
    if (!clean) {
      return { ok: false, error: 'Group name cannot be empty.', state: serializeTabs(ctx) };
    }
    next.name = clean;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'color')) {
    if (GROUP_COLORS.includes(updates.color)) {
      next.color = updates.color;
    }
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'collapsed')) {
    next.collapsed = Boolean(updates.collapsed);
  }

  groups[idx] = next;
  saveGroupsForCtx(ctx, groups);
  broadcastGroupsChange(ctx);
  return { ok: true, group: next, state: serializeTabs(ctx) };
}

function toggleGroupCollapsed(ctx, groupId) {
  const group = getGroupById(ctx, groupId);
  if (!group) return serializeTabs(ctx);
  updateTabGroup(ctx, groupId, { collapsed: !group.collapsed });
  return serializeTabs(ctx);
}

function ungroupTabGroup(ctx, groupId) {
  if (!ctx || !groupId) return serializeTabs(ctx);
  const groups = getGroupsForCtx(ctx);
  if (!groups.some((g) => g && g.id === groupId)) return serializeTabs(ctx);

  if (ctx.incognito) {
    for (const tab of ctx.tabs.values()) {
      if (tab && tab.groupId === groupId) tab.groupId = null;
    }
  } else {
    for (const c of windowContexts.values()) {
      if (!c || c.incognito) continue;
      for (const tab of c.tabs.values()) {
        if (tab && tab.groupId === groupId) tab.groupId = null;
      }
    }
  }

  const nextGroups = groups.filter((g) => g && g.id !== groupId);
  saveGroupsForCtx(ctx, nextGroups);

  broadcastGroupsChange(ctx);
  scheduleSessionSave(ctx);
  return serializeTabs(ctx);
}

function createTabInGroup(ctx, groupId) {
  if (!ctx) return null;
  const group = getGroupById(ctx, groupId);
  if (!group) return serializeTabs(ctx);
  if (group.collapsed) {
    updateTabGroup(ctx, groupId, { collapsed: false });
  }
  const { createTabInternal } = tabsMod();
  createTabInternal(ctx, {
    url: 'nextgx://newtab',
    workspaceId: group.workspaceId,
    groupId: group.id,
    active: true
  });
  return serializeTabs(ctx);
}

module.exports = {
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
  GROUP_COLORS,
  getWorkspaces,
  hasWorkspace,
  getGroupsForCtx,
  saveGroupsForCtx,
  getGroupById,
  broadcastGroupsChange,
  getNextGroupName,
  getNextGroupColor,
  isTabVisibleInWorkspace,
  normalizeGroupContiguity,
  countTabsInGroup,
  pruneGroupIfEmpty,
  pruneAllEmptyGroups,
  ensureWorkspaceHasActiveTab,
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
};
