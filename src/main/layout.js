const {
  TOP_CHROME_HEIGHT,
  SIDEBAR_ICON_WIDTH,
  SIDEBAR_PANEL_HEADER_HEIGHT,
  SIDEBAR_PANEL_RESIZER_WIDTH,
  SIDEBAR_PANEL_DEFAULT_WIDTH,
  SIDEBAR_PANEL_MIN_WIDTH,
  SIDEBAR_PANEL_MAX_WIDTH
} = require('./core');

const fullscreenMod = () => require('./fullscreen');
const splitViewMod = () => require('./splitview');

const EFFECTIVE_PANEL_MIN_FLOOR = 240;
const MIN_TAB_VIEWPORT_WIDTH = 160;

function getMaxEffectiveSidebarPanelWidth(ctx) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return SIDEBAR_PANEL_MAX_WIDTH;
  const [contentWidth] = ctx.win.getContentSize();
  if (!Number.isFinite(contentWidth) || contentWidth <= 0) return SIDEBAR_PANEL_MAX_WIDTH;
  const rightOffset = Math.max(0, Number(ctx.layoutState?.right) || 0);
  const maxAvail = Math.max(
    EFFECTIVE_PANEL_MIN_FLOOR,
    Math.floor(contentWidth - SIDEBAR_ICON_WIDTH - rightOffset - MIN_TAB_VIEWPORT_WIDTH)
  );
  return Math.min(SIDEBAR_PANEL_MAX_WIDTH, maxAvail);
}

function getEffectiveSidebarPanelWidth(ctx, rawWidth) {
  const base = Math.max(
    SIDEBAR_PANEL_MIN_WIDTH,
    Math.min(SIDEBAR_PANEL_MAX_WIDTH, Math.round(Number(rawWidth) || SIDEBAR_PANEL_DEFAULT_WIDTH))
  );
  return Math.min(base, getMaxEffectiveSidebarPanelWidth(ctx));
}

function bringOverlaysToFront(ctx) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return;
  if (ctx.fullscreen && ctx.fullscreen.active) {
    if (ctx.fullscreen.view) {
      try {
        ctx.win.contentView.addChildView(ctx.fullscreen.view);
      } catch (_) {}
    }
    return;
  }
  if (ctx.sidebarPanel && ctx.sidebarPanel.open && ctx.sidebarPanel.activeKey) {
    if (ctx.sidebarPanelFrameView) {
      ctx.win.contentView.addChildView(ctx.sidebarPanelFrameView);
    }
    const activePanelView = ctx.sidebarPanel.views?.get(ctx.sidebarPanel.activeKey);
    if (activePanelView) {
      ctx.win.contentView.addChildView(activePanelView);
    }
  }
  if (ctx.popoverView && ctx.popoverOpenKind) {
    ctx.win.contentView.addChildView(ctx.popoverView);
  }
  if (ctx.extensionPopupView) {
    ctx.win.contentView.addChildView(ctx.extensionPopupView);
  }
  if (ctx.screenshotView && ctx.pendingScreenshotDataUrl) {
    ctx.win.contentView.addChildView(ctx.screenshotView);
  }
}

function updateActiveViewBounds(ctx) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return;

  if (ctx.fullscreen && ctx.fullscreen.active) {
    const { shouldExitFullscreenOnLayout, exitFullscreen, applyFullscreenBounds } = fullscreenMod();
    if (shouldExitFullscreenOnLayout(ctx)) {
      exitFullscreen(ctx, { skipLayout: true });
    } else if (applyFullscreenBounds(ctx)) {
      return;
    }
  }

  const [contentWidth, contentHeight] = ctx.win.getContentSize();
  const top = Math.max(TOP_CHROME_HEIGHT, ctx.layoutState.top || TOP_CHROME_HEIGHT);
  const rightOffset = Math.max(0, ctx.layoutState.right || 0);
  const bottomOffset = Math.max(0, ctx.layoutState.bottom || 0);

  const panel = ctx.sidebarPanel;
  const panelOpen = Boolean(panel && panel.open && panel.activeKey);
  const panelWidth = getEffectiveSidebarPanelWidth(ctx, panel ? panel.width : SIDEBAR_PANEL_DEFAULT_WIDTH);
  const effectiveTabLeft =
    panelOpen && panel.pinned
      ? SIDEBAR_ICON_WIDTH + panelWidth
      : Math.max(SIDEBAR_ICON_WIDTH, ctx.layoutState.left || SIDEBAR_ICON_WIDTH);

  const contentW = Math.max(120, contentWidth - effectiveTabLeft - rightOffset);
  const contentH = Math.max(120, contentHeight - top - bottomOffset);

  const { getVisibleSplitTabs, computeSplitPaneBounds } = splitViewMod();
  const visibleSplit = getVisibleSplitTabs(ctx);
  const canRenderSplit = Boolean(
    visibleSplit &&
      visibleSplit.leftTab &&
      visibleSplit.rightTab &&
      !visibleSplit.leftTab.sleeping &&
      !visibleSplit.rightTab.sleeping &&
      visibleSplit.leftTab.view &&
      visibleSplit.rightTab.view
  );

  if (canRenderSplit) {
    const { leftTab, rightTab, split } = visibleSplit;
    const paneBounds = computeSplitPaneBounds({
      x: effectiveTabLeft,
      y: top,
      width: contentW,
      height: contentH,
      ratio: split.ratio
    });

    for (const [id, tab] of ctx.tabs.entries()) {
      if (!tab.view) continue;
      if (id === leftTab.id) {
        tab.view.setBounds(paneBounds.left);
      } else if (id === rightTab.id) {
        tab.view.setBounds(paneBounds.right);
      } else {
        tab.view.setBounds({ x: -5000, y: -5000, width: 1, height: 1 });
      }
    }
  } else {
    for (const [id, tab] of ctx.tabs.entries()) {
      if (!tab.view) continue;
      if (id === ctx.activeTabId && !tab.sleeping) {
        tab.view.setBounds({
          x: effectiveTabLeft,
          y: top,
          width: contentW,
          height: contentH
        });
      } else {
        tab.view.setBounds({ x: -5000, y: -5000, width: 1, height: 1 });
      }
    }
  }

  if (ctx.sidebarPanelFrameView) {
    if (panelOpen) {
      ctx.sidebarPanelFrameView.setBounds({
        x: SIDEBAR_ICON_WIDTH,
        y: top,
        width: panelWidth,
        height: Math.max(120, contentHeight - top - bottomOffset)
      });
    } else {
      ctx.sidebarPanelFrameView.setBounds({ x: -5000, y: -5000, width: 1, height: 1 });
    }
  }

  if (panel && panel.views instanceof Map) {
    const panelY = top + SIDEBAR_PANEL_HEADER_HEIGHT;
    const panelH = Math.max(120, contentHeight - panelY - bottomOffset);
    const panelContentW = Math.max(120, panelWidth - SIDEBAR_PANEL_RESIZER_WIDTH);
    for (const [key, view] of panel.views.entries()) {
      if (!view) continue;
      if (panelOpen && key === panel.activeKey) {
        view.setBounds({
          x: SIDEBAR_ICON_WIDTH,
          y: panelY,
          width: panelContentW,
          height: panelH
        });
      } else {
        view.setBounds({ x: -5000, y: -5000, width: 1, height: 1 });
      }
    }
  }

  if (ctx.screenshotView) {
    if (ctx.pendingScreenshotDataUrl) {
      ctx.screenshotView.setBounds({
        x: effectiveTabLeft,
        y: top,
        width: Math.max(120, contentWidth - effectiveTabLeft - rightOffset),
        height: Math.max(120, contentHeight - top - bottomOffset)
      });
    } else {
      ctx.screenshotView.setBounds({ x: -5000, y: -5000, width: 1, height: 1 });
    }
  }

  bringOverlaysToFront(ctx);
}

module.exports = {
  getMaxEffectiveSidebarPanelWidth,
  getEffectiveSidebarPanelWidth,
  bringOverlaysToFront,
  updateActiveViewBounds
};
