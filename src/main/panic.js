// Panic button — one action that instantly hides everything, and undoes.
//
// Trigger: snapshot every tab in the focused window (URL, title, pinned,
// group, workspace, active tab), close the sidebar panel and any popover,
// close all tabs and open a single neutral Start page tab. Restore: close
// the neutral tab and re-create the snapshotted tabs in order, with the
// previously active tab active again.
//
// Local only. The snapshot is kept in memory and also persisted through
// storage (panicSnapshot) so a restore stays possible after a restart —
// EXCEPT in incognito windows, where the snapshot is memory-only and never
// written to disk, so private tabs can never leak into a file. Restoring
// clears the snapshot. Split-view layout is not restored (tabs are); that
// is a documented limit, not a silent loss — the tabs themselves come back.

const { windowContexts, state } = require('./core');

let panicDeps = {};

function configurePanic(deps) {
  panicDeps = { ...panicDeps, ...(deps || {}) };
}

const tabsMod = () => panicDeps.tabs || require('./tabs');
const sidebarMod = () => panicDeps.sidebar || require('./sidebar');
const popoversMod = () => panicDeps.popovers || require('./popovers');
const broadcastMod = () => panicDeps.broadcast || require('./broadcast');

function isRestorableUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  if (url.startsWith('chrome-error://') || url.startsWith('devtools://')) return false;
  return /^(https?:\/\/|nextgx:\/\/|gx:\/\/|chrome:\/\/|file:\/\/)/i.test(url);
}

function snapshotWindowTabs(ctx) {
  let getPersistableTabUrl = null;
  try {
    getPersistableTabUrl = require('./session').getPersistableTabUrl;
  } catch (_) {}
  const tabs = [];
  let activeIndex = 0;
  for (const id of ctx.tabOrder || []) {
    const tab = ctx.tabs ? ctx.tabs.get(id) : null;
    if (!tab) continue;
    const url =
      typeof getPersistableTabUrl === 'function'
        ? getPersistableTabUrl(tab) || tab.url
        : tab.url;
    if (!isRestorableUrl(url)) continue;
    if (id === ctx.activeTabId) activeIndex = tabs.length;
    tabs.push({
      url,
      title: typeof tab.title === 'string' ? tab.title.slice(0, 300) : '',
      pinned: Boolean(tab.pinned),
      groupId: tab.pinned ? null : tab.groupId || null,
      workspaceId: tab.workspaceId || 'default'
    });
  }
  return { tabs, activeIndex, savedAt: Date.now() };
}

function getStoredSnapshot(ctx = null) {
  if (ctx && ctx.incognito) return null;
  try {
    const pid = ctx?.profileId || undefined;
    const snap = state.storage ? state.storage.getPanicSnapshot(pid) : null;
    if (snap && Array.isArray(snap.tabs)) return snap;
  } catch (_) {}
  return null;
}

function getPanicState(ctx) {
  const mem = ctx && ctx._panicSnapshot ? ctx._panicSnapshot : null;
  const snap = mem || getStoredSnapshot(ctx);
  return {
    active: Boolean(ctx && ctx.panicActive),
    hasSnapshot: Boolean(snap && Array.isArray(snap.tabs) && snap.tabs.length > 0),
    tabCount: snap && Array.isArray(snap.tabs) ? snap.tabs.length : 0,
    savedAt: snap ? snap.savedAt || 0 : 0
  };
}

function triggerPanic(ctx) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return { ok: false, error: 'No window.' };
  if (ctx.panicActive) return { ok: true, alreadyActive: true, state: getPanicState(ctx) };
  const snapshot = snapshotWindowTabs(ctx);
  if (!snapshot.tabs.length) {
    snapshot.tabs = [];
  }
  ctx._panicSnapshot = snapshot;
  if (!ctx.incognito) {
    try {
      if (state.storage) state.storage.savePanicSnapshot(snapshot, ctx.profileId);
    } catch (_) {}
  }
  try {
    if (ctx.popoverOpenKind) popoversMod().closePopover(ctx, { restoreFocus: false });
  } catch (_) {}
  try {
    const sb = sidebarMod();
    sb.closeSidebarPanel(ctx, { restoreFocus: false });
    if (ctx.sidebarPanel && ctx.sidebarPanel.views && typeof sb.suspendSidebarServiceView === 'function') {
      for (const key of Array.from(ctx.sidebarPanel.views.keys())) {
        try {
          sb.suspendSidebarServiceView(ctx, key);
        } catch (_) {}
      }
    }
  } catch (_) {}

  const ids = [...(ctx.tabOrder || [])];
  for (const id of ids) {
    try {
      tabsMod().closeTab(ctx, id, {
        skipSessionClose: true,
        skipRecentlyClosed: true,
        skipAutoNewTab: true
      });
    } catch (_) {}
  }
  try {
    tabsMod().createTab(ctx, { url: 'nextgx://newtab', active: true });
  } catch (_) {}
  ctx.panicActive = true;
  try {
    broadcastMod().broadcastState(ctx);
  } catch (_) {}
  return { ok: true, state: getPanicState(ctx) };
}

function restorePanic(ctx) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return { ok: false, error: 'No window.' };
  const snapshot = ctx._panicSnapshot || getStoredSnapshot(ctx);
  if (!snapshot || !Array.isArray(snapshot.tabs) || !snapshot.tabs.length) {
    ctx.panicActive = false;
    ctx._panicSnapshot = null;
    try {
      if (state.storage && !ctx.incognito) state.storage.clearPanicSnapshot(ctx.profileId);
    } catch (_) {}
    return { ok: false, error: 'No panicked session to restore.' };
  }
  const ids = [...(ctx.tabOrder || [])];
  for (const id of ids) {
    try {
      tabsMod().closeTab(ctx, id, {
        skipSessionClose: true,
        skipRecentlyClosed: true,
        skipAutoNewTab: true
      });
    } catch (_) {}
  }
  let firstRestoredId = null;
  const created = [];
  for (const t of snapshot.tabs) {
    try {
      const before = new Set(ctx.tabOrder || []);
      tabsMod().createTab(ctx, {
        url: t.url,
        pinned: Boolean(t.pinned),
        groupId: t.groupId || null,
        workspaceId: t.workspaceId || 'default',
        active: false
      });
      const fresh = (ctx.tabOrder || []).find((id) => !before.has(id));
      if (fresh) {
        created.push(fresh);
        if (!firstRestoredId) firstRestoredId = fresh;
      }
    } catch (_) {}
  }
  const activeIdx =
    typeof snapshot.activeIndex === 'number' && snapshot.activeIndex >= 0
      ? snapshot.activeIndex
      : 0;
  const toActivate = created[activeIdx] || firstRestoredId;
  if (toActivate) {
    try {
      tabsMod().switchTab(ctx, toActivate);
    } catch (_) {}
  }
  ctx.panicActive = false;
  ctx._panicSnapshot = null;
  try {
    if (state.storage && !ctx.incognito) state.storage.clearPanicSnapshot(ctx.profileId);
  } catch (_) {}
  try {
    broadcastMod().broadcastState(ctx);
  } catch (_) {}
  return { ok: true, restoredCount: created.length, state: getPanicState(ctx) };
}

function togglePanic(ctx) {
  if (!ctx) return { ok: false, error: 'No window.' };
  if (ctx.panicActive) return restorePanic(ctx);
  return triggerPanic(ctx);
}

module.exports = {
  configurePanic,
  isRestorableUrl,
  snapshotWindowTabs,
  getPanicState,
  triggerPanic,
  restorePanic,
  togglePanic
};
