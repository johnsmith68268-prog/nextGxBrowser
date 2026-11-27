const { app } = require('electron');
const { windowContexts, webContentsToWinId } = require('./core');

const sidebarMod = () => require('./sidebar');
const popoversMod = () => require('./popovers');
const layoutMod = () => require('./layout');
const splitViewMod = () => require('./splitview');

const PARKED_BOUNDS = { x: -5000, y: -5000, width: 1, height: 1 };

let appListenersRegistered = false;
const hookedWebContents = new WeakSet();

function createFullscreenState() {
  return {
    active: false,
    html: false,
    implicitWindow: false,
    view: null,
    webContents: null,
    source: null, // 'tab' | 'sidebar' | 'other' | null
    tabId: null,
    serviceKey: null,
    savedPanel: null, // { open, pinned, activeKey } | null
    savedViewBounds: null, // Map<WebContentsView, Rectangle> | null
    savedChildOrder: null, // Array<WebContentsView> | null
    entering: false,
    exiting: false
  };
}

function ensureFullscreenState(ctx) {
  if (!ctx) return null;
  if (!ctx.fullscreen || typeof ctx.fullscreen !== 'object') {
    ctx.fullscreen = createFullscreenState();
  }
  return ctx.fullscreen;
}

function getCtxForWebContents(wc) {
  if (!wc || typeof wc.id !== 'number') return null;
  const winId = webContentsToWinId.get(wc.id);
  if (winId === undefined) return null;
  const ctx = windowContexts.get(winId);
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return null;
  return ctx;
}

function isNonContentWebContents(ctx, wc) {
  if (!ctx || !wc) return true;
  if (ctx.win && ctx.win.webContents && wc.id === ctx.win.webContents.id) return true;
  if (ctx.popoverView && ctx.popoverView.webContents && wc.id === ctx.popoverView.webContents.id) return true;
  if (
    ctx.sidebarPanelFrameView &&
    ctx.sidebarPanelFrameView.webContents &&
    wc.id === ctx.sidebarPanelFrameView.webContents.id
  ) {
    return true;
  }
  if (
    ctx.extensionPopupView &&
    ctx.extensionPopupView.webContents &&
    wc.id === ctx.extensionPopupView.webContents.id
  ) {
    return true;
  }
  if (ctx.screenshotView && ctx.screenshotView.webContents && wc.id === ctx.screenshotView.webContents.id) return true;
  if (ctx.drawerOverlayView && ctx.drawerOverlayView.webContents && wc.id === ctx.drawerOverlayView.webContents.id) {
    return true;
  }
  return false;
}

function resolveTargetForWebContents(ctx, wc) {
  if (!ctx || !wc || isNonContentWebContents(ctx, wc)) return null;

  const sidebarEntry = sidebarMod().findSidebarServiceByWebContents(ctx, wc);
  if (sidebarEntry && sidebarEntry.view) {
    return {
      view: sidebarEntry.view,
      webContents: wc,
      source: 'sidebar',
      tabId: ctx.activeTabId,
      serviceKey: sidebarEntry.key
    };
  }

  if (ctx.tabs instanceof Map) {
    for (const [id, tab] of ctx.tabs.entries()) {
      if (
        tab &&
        tab.view &&
        tab.view.webContents &&
        !tab.view.webContents.isDestroyed() &&
        tab.view.webContents.id === wc.id
      ) {
        return {
          view: tab.view,
          webContents: wc,
          source: 'tab',
          tabId: id,
          serviceKey: null
        };
      }
    }
  }

  const children = ctx.win?.contentView?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      if (
        child &&
        child.webContents &&
        !child.webContents.isDestroyed() &&
        child.webContents.id === wc.id
      ) {
        return {
          view: child,
          webContents: wc,
          source: 'other',
          tabId: ctx.activeTabId,
          serviceKey: null
        };
      }
    }
  }

  return null;
}

function resolveWindowFullscreenTarget(ctx) {
  if (!ctx) return null;
  const activeTab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
  if (
    activeTab &&
    !activeTab.sleeping &&
    activeTab.view &&
    activeTab.view.webContents &&
    !activeTab.view.webContents.isDestroyed()
  ) {
    return {
      view: activeTab.view,
      webContents: activeTab.view.webContents,
      source: 'tab',
      tabId: activeTab.id,
      serviceKey: null
    };
  }

  const activeSidebarView = sidebarMod().getActiveSidebarView(ctx);
  if (activeSidebarView) {
    return {
      view: activeSidebarView,
      webContents: activeSidebarView.webContents,
      source: 'sidebar',
      tabId: ctx.activeTabId,
      serviceKey: ctx.sidebarPanel?.activeKey || null
    };
  }

  return null;
}

function collectManagedViews(ctx) {
  const views = new Set();
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return views;

  const children = ctx.win.contentView?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      if (child) views.add(child);
    }
  }
  if (ctx.tabs instanceof Map) {
    for (const tab of ctx.tabs.values()) {
      if (tab && tab.view) views.add(tab.view);
    }
  }
  if (ctx.sidebarPanel && ctx.sidebarPanel.views instanceof Map) {
    for (const view of ctx.sidebarPanel.views.values()) {
      if (view) views.add(view);
    }
  }
  if (ctx.sidebarPanelFrameView) views.add(ctx.sidebarPanelFrameView);
  if (ctx.popoverView) views.add(ctx.popoverView);
  if (ctx.extensionPopupView) views.add(ctx.extensionPopupView);
  if (ctx.screenshotView) views.add(ctx.screenshotView);
  if (ctx.drawerOverlayView) views.add(ctx.drawerOverlayView);

  return views;
}

function shouldExitFullscreenOnLayout(ctx) {
  if (!ctx || !ctx.fullscreen || !ctx.fullscreen.active) return false;
  const fs = ctx.fullscreen;
  if (fs.entering || fs.exiting) return false;

  const fsView = fs.view;
  if (!fsView) return true;
  if (fsView.webContents && fsView.webContents.isDestroyed()) return true;

  if (fs.tabId !== null && ctx.activeTabId !== fs.tabId) {
    return true;
  }

  if (fs.source === 'tab') {
    const activeTab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
    if (!activeTab || activeTab.sleeping || activeTab.view !== fsView) {
      return true;
    }
  } else if (fs.source === 'sidebar') {
    const panelViews = ctx.sidebarPanel?.views;
    if (!(panelViews instanceof Map) || !Array.from(panelViews.values()).includes(fsView)) {
      return true;
    }
  }

  return false;
}

function applyFullscreenBounds(ctx) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return false;
  const fs = ctx.fullscreen;
  if (!fs || !fs.active || !fs.view) return false;
  const fsView = fs.view;
  if (fsView.webContents && fsView.webContents.isDestroyed()) return false;

  const [contentWidth, contentHeight] = ctx.win.getContentSize();
  const managedViews = collectManagedViews(ctx);

  for (const view of managedViews) {
    if (!view || view === fsView) continue;
    try {
      if (typeof view.setVisible === 'function') view.setVisible(false);
      view.setBounds(PARKED_BOUNDS);
    } catch (_) { }
  }

  try {
    if (typeof fsView.setVisible === 'function') fsView.setVisible(true);
    fsView.setBounds({
      x: 0,
      y: 0,
      width: Math.max(1, contentWidth),
      height: Math.max(1, contentHeight)
    });
    ctx.win.contentView.addChildView(fsView);
  } catch (_) {
    return false;
  }

  return true;
}

function exitDomFullscreen(wc) {
  if (!wc || wc.isDestroyed() || typeof wc.executeJavaScript !== 'function') return;
  try {
    Promise.resolve(
      wc.executeJavaScript(
        'if (document.fullscreenElement || document.webkitFullscreenElement) { Promise.resolve((document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen && document.webkitExitFullscreen())).catch(() => {}); }',
        true
      )
    ).catch(() => { });
  } catch (_) { }
}

function enterFullscreen(
  ctx,
  {
    html = false,
    view = null,
    webContents = null,
    source = null,
    tabId = null,
    serviceKey = null,
    implicitWindow = false
  } = {}
) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return false;
  const fs = ensureFullscreenState(ctx);
  if (fs.exiting) return false;

  let targetView = view;
  let targetWc = webContents || (targetView && targetView.webContents) || null;
  let targetSource = source;
  let targetTabId = tabId;
  let targetServiceKey = serviceKey;

  if (!targetView) {
    const fallback = resolveWindowFullscreenTarget(ctx);
    if (!fallback) return false;
    targetView = fallback.view;
    targetWc = fallback.webContents;
    targetSource = fallback.source;
    targetTabId = fallback.tabId;
    targetServiceKey = fallback.serviceKey;
  }

  if (!targetView || (targetWc && targetWc.isDestroyed())) return false;

  // Allow a non-focused pane in the visible split to enter fullscreen by
  // focusing that pane first; refuse true background tabs and unwind any
  // DOM fullscreen they already entered.
  if (targetSource === 'tab' && targetTabId && targetTabId !== ctx.activeTabId) {
    const canSwitchVisibleSplitPane =
      (!fs.active || (html && !fs.html && fs.implicitWindow)) &&
      splitViewMod().isTabInVisibleSplit(ctx, targetTabId);
    if (canSwitchVisibleSplitPane) {
      const prevEntering = fs.entering;
      if (fs.active) {
        fs.entering = true;
      }
      try {
        splitViewMod().focusSplitPane(ctx, { tabId: targetTabId });
      } finally {
        fs.entering = prevEntering;
      }
    }
    if (ctx.activeTabId !== targetTabId) {
      if (html) {
        exitDomFullscreen(targetWc);
        if (fs.active && !fs.html && fs.implicitWindow) {
          exitFullscreen(ctx);
        }
      }
      return false;
    }
    if (!targetView || (targetWc && targetWc.isDestroyed())) {
      return false;
    }
  }

  if (fs.active) {
    fs.html = Boolean(fs.html || html);
    if (html || !implicitWindow) {
      fs.implicitWindow = false;
    }
    if (targetView && fs.view !== targetView) {
      fs.view = targetView;
      fs.webContents = targetWc;
      fs.source = targetSource || fs.source || 'tab';
      fs.tabId = targetTabId !== null ? targetTabId : ctx.activeTabId;
      fs.serviceKey = targetServiceKey !== null ? targetServiceKey : fs.serviceKey;
    }
    if (!ctx.win.isDestroyed() && !ctx.win.isFullScreen()) {
      try {
        ctx.win.setFullScreen(true);
      } catch (_) { }
    }
    layoutMod().updateActiveViewBounds(ctx);
    if (fs.webContents && !fs.webContents.isDestroyed()) {
      try {
        fs.webContents.focus();
      } catch (_) { }
    }
    return true;
  }

  const panel = ctx.sidebarPanel;
  const savedPanel = panel
    ? {
      open: Boolean(panel.open && panel.activeKey),
      pinned: Boolean(panel.pinned),
      activeKey: panel.activeKey || null
    }
    : null;

  const savedChildOrder = Array.isArray(ctx.win.contentView?.children)
    ? [...ctx.win.contentView.children]
    : [];
  const savedViewBounds = new Map();
  for (const child of collectManagedViews(ctx)) {
    if (
      !child ||
      child === ctx.popoverView ||
      child === ctx.sidebarPanelFrameView ||
      child === ctx.extensionPopupView ||
      child === ctx.drawerOverlayView
    ) {
      continue;
    }
    try {
      if (typeof child.getBounds === 'function') {
        savedViewBounds.set(child, { ...child.getBounds() });
      }
    } catch (_) { }
  }

  fs.entering = true;
  fs.active = true;
  fs.html = Boolean(html);
  fs.implicitWindow = Boolean(!html && implicitWindow);
  fs.view = targetView;
  fs.webContents = targetWc;
  fs.source = targetSource || 'tab';
  fs.tabId = targetTabId !== null ? targetTabId : ctx.activeTabId;
  fs.serviceKey = targetServiceKey || null;
  fs.savedPanel = savedPanel;
  fs.savedViewBounds = savedViewBounds;
  fs.savedChildOrder = savedChildOrder;

  try {
    if (ctx.popoverOpenKind || ctx.extensionPopupView) {
      popoversMod().closePopover(ctx, { restoreFocus: false });
    }
  } catch (_) { }

  try {
    require('./drawer-overlay').closeShellDrawer(ctx);
  } catch (_) { }

  try {
    if (panel && panel.open) {
      sidebarMod().closeSidebarPanel(ctx, { restoreFocus: false });
    }
  } catch (_) { }

  try {
    if (!ctx.win.isDestroyed() && !ctx.win.isFullScreen()) {
      ctx.win.setFullScreen(true);
    }
  } catch (_) { }

  fs.entering = false;

  if (!ctx.win.isDestroyed()) {
    layoutMod().updateActiveViewBounds(ctx);
    if (targetWc && !targetWc.isDestroyed()) {
      try {
        targetWc.focus();
      } catch (_) { }
    }
  }

  return true;
}

function exitFullscreen(ctx, { skipLayout = false } = {}) {
  if (!ctx) return false;
  const fs = ensureFullscreenState(ctx);
  if (fs.exiting) return false;

  if (!fs.active) {
    if (ctx.win && !ctx.win.isDestroyed() && ctx.win.isFullScreen()) {
      try {
        ctx.win.setFullScreen(false);
      } catch (_) { }
    }
    return false;
  }

  fs.exiting = true;
  const targetWc = fs.webContents || (fs.view && fs.view.webContents) || null;
  const prevSource = fs.source;
  const savedPanel = fs.savedPanel;
  const savedViewBounds = fs.savedViewBounds;
  const savedChildOrder = fs.savedChildOrder;

  fs.active = false;
  fs.html = false;
  fs.implicitWindow = false;
  fs.view = null;
  fs.webContents = null;
  fs.source = null;
  fs.tabId = null;
  fs.serviceKey = null;
  fs.savedPanel = null;
  fs.savedViewBounds = null;
  fs.savedChildOrder = null;

  exitDomFullscreen(targetWc);

  if (ctx.win && !ctx.win.isDestroyed()) {
    try {
      ctx.win.setFullScreen(false);
    } catch (_) { }
  }

  if (ctx.win && !ctx.win.isDestroyed()) {
    if (savedViewBounds instanceof Map) {
      for (const [child, bounds] of savedViewBounds.entries()) {
        if (
          !child ||
          child === ctx.popoverView ||
          child === ctx.sidebarPanelFrameView ||
          child === ctx.extensionPopupView
        ) {
          continue;
        }
        try {
          if (bounds && typeof child.setBounds === 'function') {
            child.setBounds(bounds);
          }
          if (bounds && bounds.x >= -1000 && bounds.width > 1 && bounds.height > 1 && typeof child.setVisible === 'function') {
            child.setVisible(true);
          }
        } catch (_) { }
      }
    }
    if (Array.isArray(savedChildOrder) && ctx.win.contentView) {
      const currentChildren = Array.isArray(ctx.win.contentView.children)
        ? new Set(ctx.win.contentView.children)
        : null;
      for (const child of savedChildOrder) {
        if (child && (!currentChildren || currentChildren.has(child))) {
          try {
            ctx.win.contentView.addChildView(child);
          } catch (_) { }
        }
      }
    }
  }

  let restoredPanel = false;
  if (ctx.win && !ctx.win.isDestroyed() && savedPanel) {
    try {
      const { setSidebarPinned, openSidebarPanel, closeSidebarPanel } = sidebarMod();
      if (ctx.sidebarPanel && Boolean(ctx.sidebarPanel.pinned) !== Boolean(savedPanel.pinned)) {
        setSidebarPinned(ctx, Boolean(savedPanel.pinned));
      }
      if (savedPanel.open && savedPanel.activeKey) {
        openSidebarPanel(ctx, savedPanel.activeKey);
        restoredPanel = true;
      } else if (ctx.sidebarPanel && ctx.sidebarPanel.open) {
        closeSidebarPanel(ctx, { restoreFocus: false });
      }
    } catch (_) { }
  }

  fs.exiting = false;

  if (ctx.win && !ctx.win.isDestroyed()) {
    if (!skipLayout) {
      layoutMod().updateActiveViewBounds(ctx);
    }
    if (!(prevSource === 'sidebar' && restoredPanel)) {
      try {
        popoversMod().restoreFocusToActiveTab(ctx);
      } catch (_) { }
    }
  }

  return true;
}

function handleEnterHtmlFullScreen(wc) {
  const ctx = getCtxForWebContents(wc);
  if (!ctx) return;
  const target = resolveTargetForWebContents(ctx, wc);
  if (!target || !target.view) return;
  enterFullscreen(ctx, {
    html: true,
    view: target.view,
    webContents: wc,
    source: target.source,
    tabId: target.tabId,
    serviceKey: target.serviceKey
  });
}

function handleLeaveHtmlFullScreen(wc) {
  const ctx = getCtxForWebContents(wc);
  if (!ctx) return;
  const fs = ensureFullscreenState(ctx);
  if (!fs.active) return;
  if (fs.webContents && fs.webContents !== wc) return;
  fs.html = false;
  exitFullscreen(ctx);
}

function handleWindowEnterFullScreen(ctx) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return;
  const fs = ensureFullscreenState(ctx);
  if (fs.entering) return;
  if (fs.active) {
    layoutMod().updateActiveViewBounds(ctx);
    if (fs.webContents && !fs.webContents.isDestroyed()) {
      try {
        fs.webContents.focus();
      } catch (_) { }
    }
    return;
  }
  const target = resolveWindowFullscreenTarget(ctx);
  if (!target || !target.view) return;
  enterFullscreen(ctx, {
    html: false,
    view: target.view,
    webContents: target.webContents,
    source: target.source,
    tabId: target.tabId,
    serviceKey: target.serviceKey,
    implicitWindow: true
  });
}

function handleWindowLeaveFullScreen(ctx) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return;
  const fs = ensureFullscreenState(ctx);
  if (fs.exiting) return;
  if (fs.active) {
    exitFullscreen(ctx);
  } else {
    layoutMod().updateActiveViewBounds(ctx);
  }
}

function attachWebContentsFullscreenListeners(wc) {
  if (!wc || hookedWebContents.has(wc)) return;
  hookedWebContents.add(wc);

  wc.on('enter-html-full-screen', () => {
    handleEnterHtmlFullScreen(wc);
  });

  wc.on('leave-html-full-screen', () => {
    handleLeaveHtmlFullScreen(wc);
  });

  wc.on('before-input-event', (_event, input) => {
    if (!input || input.type !== 'keyDown' || input.key !== 'Escape') return;
    const ctx = getCtxForWebContents(wc);
    if (!ctx || !ctx.fullscreen || !ctx.fullscreen.active || !ctx.fullscreen.html) return;
    // Defer past the current before-input-event cycle so shortcuts.js sees the
    // fullscreen state (with unpinned panel closed) and does not swallow Escape.
    // Restricted to HTML fullscreen (fs.html) so F11 window fullscreen is exited
    // by F11 only, matching Chrome and preserving Esc for in-page UI/modals.
    setImmediate(() => {
      if (ctx.fullscreen && ctx.fullscreen.active && ctx.fullscreen.html) {
        exitFullscreen(ctx);
      }
    });
  });

  wc.once('destroyed', () => {
    const ctx = getCtxForWebContents(wc);
    if (!ctx || !ctx.fullscreen || !ctx.fullscreen.active) return;
    if (ctx.fullscreen.webContents === wc) {
      exitFullscreen(ctx);
    }
  });
}

function initFullscreenListeners() {
  if (appListenersRegistered) return;
  appListenersRegistered = true;
  app.on('web-contents-created', (_event, wc) => {
    attachWebContentsFullscreenListeners(wc);
  });
}

function toggleWindowFullscreen(ctx) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return false;
  const fs = ensureFullscreenState(ctx);
  if (fs.entering || fs.exiting) {
    return Boolean(ctx.win.isFullScreen() || fs.active);
  }
  const isCurrentlyFullScreen = Boolean(ctx.win.isFullScreen() || fs.active);
  if (isCurrentlyFullScreen) {
    exitFullscreen(ctx);
    return false;
  }
  // Resolve the fullscreen target before invoking native fullscreen so a window
  // with no active non-sleeping tab or open panel does not enter OS fullscreen
  // with all chrome still visible.
  const target = resolveWindowFullscreenTarget(ctx);
  if (!target || !target.view) {
    return false;
  }
  return enterFullscreen(ctx, {
    html: false,
    view: target.view,
    webContents: target.webContents,
    source: target.source,
    tabId: target.tabId,
    serviceKey: target.serviceKey
  });
}

function attachWindowFullscreenHandlers(ctx) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return;
  ensureFullscreenState(ctx);
  initFullscreenListeners();

  const win = ctx.win;
  if (win.webContents && !win.webContents.isDestroyed()) {
    attachWebContentsFullscreenListeners(win.webContents);
  }

  win.on('enter-full-screen', () => {
    handleWindowEnterFullScreen(ctx);
  });

  win.on('leave-full-screen', () => {
    handleWindowLeaveFullScreen(ctx);
  });
}

function cleanupWindowFullscreen(ctx) {
  if (!ctx || !ctx.fullscreen) return;
  ctx.fullscreen.active = false;
  ctx.fullscreen.html = false;
  ctx.fullscreen.implicitWindow = false;
  ctx.fullscreen.view = null;
  ctx.fullscreen.webContents = null;
  ctx.fullscreen.source = null;
  ctx.fullscreen.tabId = null;
  ctx.fullscreen.serviceKey = null;
  ctx.fullscreen.savedPanel = null;
  ctx.fullscreen.savedViewBounds = null;
  ctx.fullscreen.savedChildOrder = null;
  ctx.fullscreen.entering = false;
  ctx.fullscreen.exiting = false;
}

module.exports = {
  createFullscreenState,
  ensureFullscreenState,
  shouldExitFullscreenOnLayout,
  applyFullscreenBounds,
  enterFullscreen,
  exitFullscreen,
  toggleWindowFullscreen,
  handleEnterHtmlFullScreen,
  handleLeaveHtmlFullScreen,
  handleWindowEnterFullScreen,
  handleWindowLeaveFullScreen,
  initFullscreenListeners,
  attachWindowFullscreenHandlers,
  cleanupWindowFullscreen
};
