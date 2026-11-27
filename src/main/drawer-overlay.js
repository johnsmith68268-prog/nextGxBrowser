const { WebContentsView, ipcMain } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  UI_DIR,
  PRELOAD_FILE,
  TOP_CHROME_HEIGHT,
  SIDEBAR_ICON_WIDTH,
  registerWebContents,
  state
} = require('./core');
const {
  getInternalUiQuery,
  attachInternalNavigationGuard,
  isInternalUiSender
} = require('./utils');
const { attachKeyboardShortcuts } = require('./shortcuts');
const { getCtxFromSender } = require('./broadcast');

const RAIL_EXPANDED_WIDTH = 184;
const LEFT_TOOL_WIDTH = 340;
const RIGHT_DRAWER_WIDTH = 360;
const PARKED_BOUNDS = { x: -5000, y: -5000, width: 1, height: 1 };

const layoutMod = () => require('./layout');
const sidebarMod = () => require('./sidebar');
const popoversMod = () => require('./popovers');

function buildShellOverlayUrl(ctx) {
  const indexUrl = pathToFileURL(path.join(UI_DIR, 'index.html'));
  const q = getInternalUiQuery(Boolean(ctx?.incognito), ctx?.profileId);
  indexUrl.searchParams.set('overlay', '1');
  for (const [k, v] of Object.entries(q)) {
    indexUrl.searchParams.set(k, String(v));
  }
  return indexUrl.toString();
}

function ensureShellDrawerView(ctx) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return null;
  if (ctx.drawerOverlayView && !ctx.drawerOverlayView.webContents.isDestroyed()) {
    return ctx.drawerOverlayView;
  }

  const view = new WebContentsView({
    webPreferences: {
      preload: PRELOAD_FILE,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  try {
    view.setBackgroundColor('#00000000');
  } catch (_) {}

  const wc = view.webContents;
  registerWebContents(wc, ctx.win.id);
  attachInternalNavigationGuard(wc);
  attachKeyboardShortcuts(ctx, wc);

  ctx._drawerOverlayReady = false;
  wc.once('did-finish-load', () => {
    ctx._drawerOverlayReady = true;
    sendDrawerStateToViews(ctx);
    // Sync initial state & settings into the overlay view
    try {
      const { serializeTabs } = require('./broadcast');
      if (!wc.isDestroyed()) {
        wc.send('state:update', serializeTabs(ctx));
        if (state.storage) {
          wc.send('settings:update', state.storage.getSettings(ctx.profileId));
        }
        if (state.adBlocker) {
          wc.send('adblock:update', state.adBlocker.getStats());
        }
      }
    } catch (_) {}
    if (ctx.gxControlOpen) {
      try {
        require('./stats').broadcastSystemStatsNow();
      } catch (_) {}
    }
  });

  ctx.win.contentView.addChildView(view);
  try {
    view.setVisible(false);
    view.setBounds(PARKED_BOUNDS);
  } catch (_) {}

  wc.loadURL(buildShellOverlayUrl(ctx)).catch(() => {});
  ctx.drawerOverlayView = view;
  return view;
}

function getShellDrawerState(ctx) {
  if (!ctx || !ctx.shellDrawerState) {
    return { open: false, kind: null, tool: null, panel: null };
  }
  return { ...ctx.shellDrawerState };
}

function sendDrawerStateToViews(ctx) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return;
  const payload = getShellDrawerState(ctx);
  try {
    if (!ctx.win.webContents.isDestroyed()) {
      ctx.win.webContents.send('drawer:state', payload);
    }
  } catch (_) {}
  try {
    if (
      ctx.drawerOverlayView &&
      ctx._drawerOverlayReady &&
      !ctx.drawerOverlayView.webContents.isDestroyed()
    ) {
      ctx.drawerOverlayView.webContents.send('drawer:state', payload);
    }
  } catch (_) {}
}

function computeDrawerBounds(ctx) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return PARKED_BOUNDS;
  const st = ctx.shellDrawerState;
  if (!st || !st.open || !st.kind) return PARKED_BOUNDS;

  const [contentWidth, contentHeight] = ctx.win.getContentSize();
  const top = Math.max(TOP_CHROME_HEIGHT, ctx.layoutState?.top || TOP_CHROME_HEIGHT);
  const bottomOffset = Math.max(0, ctx.layoutState?.bottom || 0);
  const h = Math.max(120, contentHeight - top - bottomOffset);

  if (st.kind === 'rail') {
    return {
      x: 0,
      y: top,
      width: Math.min(RAIL_EXPANDED_WIDTH, Math.max(120, contentWidth)),
      height: h
    };
  }
  if (st.kind === 'left-tool') {
    const w = Math.min(LEFT_TOOL_WIDTH, Math.max(180, contentWidth - SIDEBAR_ICON_WIDTH - 24));
    return {
      x: SIDEBAR_ICON_WIDTH,
      y: top,
      width: w,
      height: h
    };
  }
  if (st.kind === 'right-drawer') {
    const w = Math.min(RIGHT_DRAWER_WIDTH, Math.max(200, contentWidth - SIDEBAR_ICON_WIDTH - 24));
    return {
      x: Math.max(SIDEBAR_ICON_WIDTH, contentWidth - w),
      y: top,
      width: w,
      height: h
    };
  }
  return PARKED_BOUNDS;
}

function updateShellDrawerBounds(ctx) {
  if (!ctx || !ctx.drawerOverlayView) return;
  const view = ctx.drawerOverlayView;
  if (view.webContents.isDestroyed()) return;
  const st = ctx.shellDrawerState;
  if (!st || !st.open || ctx.shellModalOpen) {
    try {
      view.setVisible(false);
      view.setBounds(PARKED_BOUNDS);
    } catch (_) {}
    return;
  }
  const bounds = computeDrawerBounds(ctx);
  try {
    view.setVisible(true);
    view.setBounds(bounds);
  } catch (_) {}
}

function openShellDrawer(ctx, spec = {}) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed() || ctx.shellModalOpen) return getShellDrawerState(ctx);
  const kind = spec.kind;
  if (kind !== 'rail' && kind !== 'left-tool' && kind !== 'right-drawer') {
    return closeShellDrawer(ctx);
  }

  // Close competing transient overlays (popovers & unpinned sidebar panels)
  try {
    popoversMod().closePopover(ctx, { restoreFocus: false });
  } catch (_) {}
  if (kind === 'left-tool') {
    try {
      sidebarMod().closeSidebarIfUnpinned(ctx, { restoreFocus: false, ignoreGrace: true });
    } catch (_) {}
  }

  const tool = kind === 'left-tool' ? String(spec.tool || 'gxControl') : null;
  const panel = kind === 'right-drawer' ? String(spec.panel || 'easySetup') : null;

  ctx.shellDrawerState = {
    open: true,
    kind,
    tool,
    panel
  };
  ctx.gxControlOpen = Boolean(kind === 'left-tool' && tool === 'gxControl');

  const view = ensureShellDrawerView(ctx);
  layoutMod().updateActiveViewBounds(ctx);
  sendDrawerStateToViews(ctx);

  if (view && !view.webContents.isDestroyed()) {
    try {
      view.webContents.focus();
    } catch (_) {}
  }
  if (ctx.gxControlOpen) {
    try {
      require('./stats').broadcastSystemStatsNow();
    } catch (_) {}
  }
  return getShellDrawerState(ctx);
}

function closeShellDrawer(ctx) {
  if (!ctx) return { open: false, kind: null, tool: null, panel: null };
  const wasOpen = Boolean(ctx.shellDrawerState && ctx.shellDrawerState.open);
  ctx.shellDrawerState = { open: false, kind: null, tool: null, panel: null };
  ctx.gxControlOpen = false;
  if (wasOpen) {
    updateShellDrawerBounds(ctx);
    sendDrawerStateToViews(ctx);
  }
  return getShellDrawerState(ctx);
}

function toggleShellDrawer(ctx, spec = {}) {
  if (!ctx) return { open: false, kind: null, tool: null, panel: null };
  const cur = ctx.shellDrawerState;
  const kind = spec.kind;
  const sameKind = Boolean(cur && cur.open && cur.kind === kind);
  if (sameKind) {
    if (kind === 'rail') return closeShellDrawer(ctx);
    if (kind === 'left-tool' && cur.tool === (spec.tool || 'gxControl')) return closeShellDrawer(ctx);
    if (kind === 'right-drawer' && cur.panel === (spec.panel || 'easySetup')) return closeShellDrawer(ctx);
  }
  return openShellDrawer(ctx, spec);
}

function registerShellDrawerIpcHandlers() {
  ipcMain.handle('drawer:open', (event, spec) => {
    if (!isInternalUiSender(event)) return null;
    const ctx = getCtxFromSender(event.sender);
    return openShellDrawer(ctx, spec || {});
  });
  ipcMain.handle('drawer:toggle', (event, spec) => {
    if (!isInternalUiSender(event)) return null;
    const ctx = getCtxFromSender(event.sender);
    return toggleShellDrawer(ctx, spec || {});
  });
  ipcMain.handle('drawer:close', (event) => {
    if (!isInternalUiSender(event)) return null;
    const ctx = getCtxFromSender(event.sender);
    return closeShellDrawer(ctx);
  });
  ipcMain.handle('drawer:get-state', (event) => {
    if (!isInternalUiSender(event)) return null;
    const ctx = getCtxFromSender(event.sender);
    return getShellDrawerState(ctx);
  });
}

module.exports = {
  getShellDrawerState,
  openShellDrawer,
  closeShellDrawer,
  toggleShellDrawer,
  updateShellDrawerBounds,
  registerShellDrawerIpcHandlers
};
