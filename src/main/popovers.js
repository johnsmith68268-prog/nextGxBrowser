const { WebContentsView } = require('electron');
const {
  TOP_CHROME_HEIGHT,
  POPOVER_FILE,
  PRELOAD_FILE,
  registerWebContents
} = require('./core');
const { getInternalUiQuery, attachInternalNavigationGuard } = require('./utils');
const { attachKeyboardShortcuts } = require('./shortcuts');
const { closeExtensionPopup } = require('./extension-popup');
const { getExtensionsDropdownData } = require('./extensions');
const sidebarMod = () => require('./sidebar');
const permissionsMod = () => require('./permissions');

const WINDOW_MARGIN = 8;

const POPOVER_KIND_SPECS = {
  menu: {
    isMenu: true,
    align: 'right',
    defaultW: 280,
    defaultH: 542,
    minW: 260,
    maxW: 360,
    minH: 200,
    maxH: 760
  },
  'tab-context': {
    isMenu: true,
    align: 'left',
    defaultW: 224,
    defaultH: 214,
    minW: 200,
    maxW: 320,
    minH: 100,
    maxH: 540
  },
  // Market audit bug #30 (2026-11-24): right-click on a sidebar rail icon
  // had no menu at all. Small menu: Open panel / Hide from rail / Customize.
  'rail-context': {
    isMenu: true,
    align: 'left',
    defaultW: 220,
    defaultH: 132,
    minW: 200,
    maxW: 280,
    minH: 100,
    maxH: 220
  },
  'permission-prompt': {
    isMenu: false,
    align: 'left',
    // Chrome parity (worker A): grown for the reworked prompt — three
    // full-width pills plus a live camera preview and device dropdowns.
    defaultW: 360,
    defaultH: 300,
    minW: 320,
    maxW: 390,
    minH: 180,
    maxH: 560
  },
  // Chrome parity (worker A): centred screen-share picker (Tab / Window /
  // Entire Screen) with thumbnails. Opened centred by permissions.js.
  'share-picker': {
    isMenu: false,
    align: 'left',
    defaultW: 640,
    defaultH: 560,
    minW: 480,
    maxW: 680,
    minH: 420,
    maxH: 640
  },
  'bookmark-folder': {
    isMenu: true,
    align: 'left',
    defaultW: 256,
    defaultH: 220,
    minW: 210,
    maxW: 360,
    minH: 84,
    maxH: 560
  },
  'extensions-dropdown': {
    isMenu: true,
    align: 'right',
    defaultW: 320,
    defaultH: 156,
    minW: 300,
    maxW: 380,
    minH: 140,
    maxH: 480
  },
  screenshot: {
    isMenu: true,
    align: 'right',
    defaultW: 224,
    defaultH: 86,
    minW: 200,
    maxW: 300,
    minH: 76,
    maxH: 220
  },
  permissions: {
    isMenu: false,
    align: 'right',
    defaultW: 316,
    defaultH: 388,
    minW: 290,
    maxW: 380,
    minH: 240,
    maxH: 560
  },
  shield: {
    isMenu: false,
    align: 'right',
    defaultW: 312,
    defaultH: 318,
    minW: 290,
    maxW: 380,
    minH: 240,
    maxH: 520
  },
  downloads: {
    isMenu: false,
    align: 'right',
    defaultW: 316,
    defaultH: 220,
    minW: 290,
    maxW: 380,
    minH: 92,
    maxH: 460
  },
  // [FIXUP-1] Site-info bubble + zoom bubble (Chrome parity gaps 3.3/3.4/3.5):
  // moved from renderer-side fixed panels — the tab's WebContentsView covers
  // any fixed panel below the top chrome, so only the header showed.
  'site-info': {
    isMenu: false,
    align: 'left',
    defaultW: 320,
    defaultH: 424,
    minW: 300,
    maxW: 360,
    minH: 220,
    maxH: 560
  },
  'zoom-bubble': {
    isMenu: false,
    align: 'left',
    defaultW: 320,
    defaultH: 100,
    minW: 280,
    maxW: 360,
    minH: 84,
    maxH: 160
  },
  'omnibox-suggest': {
    isMenu: false,
    align: 'left',
    noFocus: true,
    keepSidebarOpen: true,
    defaultW: 860,
    defaultH: 220,
    minW: 400,
    maxW: 1800,
    minH: 52,
    maxH: 520
  },
  'omnibox-suggest-alt': {
    isMenu: false,
    align: 'left',
    noFocus: true,
    keepSidebarOpen: true,
    defaultW: 860,
    defaultH: 220,
    minW: 400,
    maxW: 1800,
    minH: 52,
    maxH: 520
  },
  'tab-search': {
    isMenu: true,
    align: 'right',
    minY: 36,
    defaultW: 400,
    defaultH: 360,
    minW: 340,
    maxW: 440,
    minH: 120,
    maxH: 440
  },
  'bookmark-bubble': {
    isMenu: false,
    align: 'right',
    defaultW: 320,
    defaultH: 220,
    minW: 280,
    maxW: 360,
    minH: 160,
    maxH: 340
  },
  profiles: {
    isMenu: true,
    align: 'right',
    defaultW: 300,
    defaultH: 280,
    minW: 260,
    maxW: 360,
    minH: 160,
    maxH: 520
  },
  'reading-list': {
    isMenu: false,
    align: 'right',
    defaultW: 330,
    defaultH: 340,
    minW: 290,
    maxW: 380,
    minH: 140,
    maxH: 520
  },
  'qr-code': {
    isMenu: false,
    align: 'right',
    defaultW: 290,
    defaultH: 320,
    minW: 260,
    maxW: 340,
    minH: 240,
    maxH: 400
  },
  'tab-hover': {
    isMenu: false,
    align: 'left',
    minY: 36,
    noFocus: true,
    keepSidebarOpen: true,
    defaultW: 260,
    defaultH: 196,
    minW: 220,
    maxW: 300,
    minH: 72,
    maxH: 260
  }
};

// Fix permissions alignment: anchored to #btnSiteSecurity on the left end of the address bar
POPOVER_KIND_SPECS.permissions.align = 'left';

const measuredPopoverSizes = new Map();

function getPopoverSpec(kind) {
  return (
    POPOVER_KIND_SPECS[kind] || {
      isMenu: false,
      align: 'right',
      defaultW: 300,
      defaultH: 360,
      minW: 200,
      maxW: 400,
      minH: 100,
      maxH: 560
    }
  );
}

function getPopoverCacheKey(kind, payload) {
  if (kind === 'bookmark-folder') {
    const folder = typeof payload?.folder === 'string' ? payload.folder.trim() : '';
    const count = Array.isArray(payload?.items) ? payload.items.length : 0;
    return `bookmark-folder:${folder}:${count}`;
  }
  if (kind === 'extensions-dropdown') {
    const rows = Array.isArray(payload?.rows)
      ? payload.rows
      : Array.isArray(payload?.extensions)
      ? payload.extensions
      : [];
    return `extensions-dropdown:${rows.length}`;
  }
  if (
    kind === 'downloads' ||
    kind === 'tab-context' ||
    kind === 'permission-prompt' ||
    kind === 'omnibox-suggest' ||
    kind === 'omnibox-suggest-alt' ||
    kind === 'rail-context' ||
    kind === 'tab-search' ||
    kind === 'tab-hover'
  ) {
    return null;
  }
  return kind || null;
}

function computePopoverBounds(ctx, kind, requestedW, requestedH) {
  const spec = getPopoverSpec(kind);
  const [cw, ch] = ctx.win.getContentSize();
  const anchor = ctx.popoverAnchor || {};
  const isTabContext = kind === 'tab-context';
  const isBookmarkFolder = kind === 'bookmark-folder';

  const rawW =
    typeof requestedW === 'number' && Number.isFinite(requestedW) && requestedW > 0
      ? Math.ceil(requestedW)
      : spec.defaultW;
  const clampedW = Math.max(spec.minW, Math.min(spec.maxW, rawW));
  const maxWinW = Math.max(120, cw - WINDOW_MARGIN * 2);
  const safeW = Math.max(Math.min(120, maxWinW), Math.min(clampedW, maxWinW));

  const minY =
    typeof spec.minY === 'number'
      ? spec.minY
      : isTabContext
      ? 4
      : TOP_CHROME_HEIGHT - 2;
  const baseY =
    typeof anchor.baseY === 'number' && Number.isFinite(anchor.baseY)
      ? Math.max(minY, anchor.baseY)
      : minY;

  const rawH =
    typeof requestedH === 'number' && Number.isFinite(requestedH) && requestedH > 0
      ? Math.ceil(requestedH)
      : spec.defaultH;
  const clampedH = Math.max(spec.minH, Math.min(spec.maxH, rawH));

  const availWinH =
    isTabContext || isBookmarkFolder
      ? Math.max(80, ch - minY - WINDOW_MARGIN)
      : Math.max(80, ch - baseY - WINDOW_MARGIN);
  const effectiveMinH = Math.min(spec.minH, availWinH);
  const maxAllowedH = Math.max(effectiveMinH, Math.min(spec.maxH, availWinH));
  const safeH = Math.max(effectiveMinH, Math.min(clampedH, maxAllowedH));

  let rawX;
  if (spec.align === 'right' && typeof anchor.right === 'number' && Number.isFinite(anchor.right)) {
    rawX = anchor.right - safeW;
  } else if (typeof anchor.left === 'number' && Number.isFinite(anchor.left)) {
    rawX = anchor.left;
  } else {
    rawX = 100;
  }
  const safeX = Math.max(
    WINDOW_MARGIN,
    Math.min(rawX, Math.max(WINDOW_MARGIN, cw - safeW - WINDOW_MARGIN))
  );

  const safeY =
    isTabContext || isBookmarkFolder
      ? Math.max(minY, Math.min(baseY, Math.max(minY, ch - safeH - WINDOW_MARGIN)))
      : baseY;

  return {
    x: Math.round(safeX),
    y: Math.round(safeY),
    width: Math.round(safeW),
    height: Math.round(safeH)
  };
}

function ensurePopoverView(ctx) {
  if (ctx.popoverView) return ctx.popoverView;
  ctx.popoverView = new WebContentsView({
    webPreferences: {
      preload: PRELOAD_FILE,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  try {
    ctx.popoverView.setBackgroundColor('#00000000');
  } catch (_) {}
  registerWebContents(ctx.popoverView.webContents, ctx.win.id);
  attachInternalNavigationGuard(ctx.popoverView.webContents);
  attachKeyboardShortcuts(ctx, ctx.popoverView.webContents);
  ctx.popoverView.webContents.loadFile(POPOVER_FILE, {
    query: getInternalUiQuery(ctx.incognito)
  });
  ctx.win.contentView.addChildView(ctx.popoverView);
  if (typeof ctx.popoverView.setVisible === 'function') {
    try {
      ctx.popoverView.setVisible(false);
    } catch (_) {}
  }
  ctx.popoverView.setBounds({ x: -5000, y: -5000, width: 1, height: 1 });

  if (ctx.win && !ctx.win.isDestroyed() && !ctx._popoverResizeListenerAttached) {
    ctx._popoverResizeListenerAttached = true;
    ctx.win.on('resize', () => {
      if (!ctx.popoverOpenKind || !ctx.popoverView || !ctx.win || ctx.win.isDestroyed()) return;
      if (ctx.popoverAnchor && typeof ctx.popoverAnchor.rightOffset === 'number') {
        const [cw] = ctx.win.getContentSize();
        ctx.popoverAnchor.right = Math.max(WINDOW_MARGIN, cw - ctx.popoverAnchor.rightOffset);
      }
      const lastW = ctx.popoverLastSize?.width;
      const lastH = ctx.popoverLastSize?.height;
      const nextBounds = computePopoverBounds(ctx, ctx.popoverOpenKind, lastW, lastH);
      ctx.popoverView.setBounds(nextBounds);
    });
  }

  return ctx.popoverView;
}

function restoreFocusToActiveTab(ctx) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return;
  const activeTab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
  if (
    activeTab &&
    !activeTab.sleeping &&
    activeTab.view &&
    activeTab.view.webContents &&
    !activeTab.view.webContents.isDestroyed()
  ) {
    activeTab.view.webContents.focus();
    return;
  }
  ctx.win.focus();
  if (ctx.win.webContents && !ctx.win.webContents.isDestroyed()) {
    ctx.win.webContents.focus();
  }
}

function restoreFocusAfterPopover(ctx) {
  restoreFocusToActiveTab(ctx);
}

function closePopover(ctx, { restoreFocus = true, kind = null } = {}) {
  if (!ctx) return;
  if (kind) {
    const open = ctx.popoverOpenKind || '';
    const matches =
      kind === 'omnibox-suggest'
        ? open === 'omnibox-suggest' || open === 'omnibox-suggest-alt'
        : open === kind;
    if (!matches) return;
  }
  closeExtensionPopup(ctx);
  const wasKind = ctx.popoverOpenKind || '';
  const wasOpen = Boolean(wasKind);
  const wasNoFocusKind =
    wasKind === 'omnibox-suggest' ||
    wasKind === 'omnibox-suggest-alt' ||
    wasKind === 'tab-hover';
  const wasPermissionPrompt = wasKind === 'permission-prompt';
  const shellFocused = Boolean(
    ctx.win &&
      !ctx.win.isDestroyed() &&
      ctx.win.webContents &&
      !ctx.win.webContents.isDestroyed() &&
      ctx.win.webContents.isFocused()
  );
  const popoverFocused = Boolean(
    ctx.popoverView &&
    ctx.popoverView.webContents &&
    !ctx.popoverView.webContents.isDestroyed() &&
    ctx.popoverView.webContents.isFocused()
  );
  ctx.popoverOpenKind = null;
  ctx.popoverPayload = null;
  ctx.popoverAnchor = null;
  ctx.popoverLastSize = null;
  if (ctx.popoverView) {
    if (typeof ctx.popoverView.setVisible === 'function') {
      try {
        ctx.popoverView.setVisible(false);
      } catch (_) {}
    }
    ctx.popoverView.setBounds({ x: -5000, y: -5000, width: 1, height: 1 });
    if (ctx.popoverView.webContents && !ctx.popoverView.webContents.isDestroyed()) {
      ctx.popoverView.webContents.send('popover:data', { closed: true, prevKind: wasKind });
    }
  }
  if (ctx.win && !ctx.win.isDestroyed() && ctx.win.webContents && !ctx.win.webContents.isDestroyed()) {
    ctx.win.webContents.send('popover:data', { closed: true, prevKind: wasKind });
  }
  if (wasPermissionPrompt) {
    try {
      permissionsMod().onPermissionPopoverClosed(ctx);
    } catch (_) {}
  }
  // Never steal focus away from the browser shell (e.g. #addressInput) when
  // dismissing non-focus-stealing popovers such as omnibox-suggest or tab-hover.
  if (restoreFocus && !wasNoFocusKind && !shellFocused && (wasOpen || popoverFocused)) {
    restoreFocusAfterPopover(ctx);
  }
}

function resizePopover(ctx, { kind, width, height } = {}) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return false;
  if (!ctx.popoverView || !ctx.popoverOpenKind) return false;
  if (kind && ctx.popoverOpenKind !== kind) return false;

  const hasValidW = typeof width === 'number' && Number.isFinite(width) && width > 0;
  const hasValidH = typeof height === 'number' && Number.isFinite(height) && height > 0;
  if (!hasValidW && !hasValidH) return false;

  const activeKind = ctx.popoverOpenKind;
  const bounds = ctx.popoverView.getBounds();
  const targetW = hasValidW ? Math.ceil(width) : ctx.popoverLastSize?.width || bounds.width;
  const targetH = hasValidH ? Math.ceil(height) : ctx.popoverLastSize?.height || bounds.height;

  ctx.popoverLastSize = { width: targetW, height: targetH };

  const cacheKey = getPopoverCacheKey(activeKind, ctx.popoverPayload?.payload);
  if (cacheKey) {
    measuredPopoverSizes.set(cacheKey, { width: targetW, height: targetH });
  }

  const nextBounds = computePopoverBounds(ctx, activeKind, targetW, targetH);
  if (
    nextBounds.x !== bounds.x ||
    nextBounds.y !== bounds.y ||
    nextBounds.width !== bounds.width ||
    nextBounds.height !== bounds.height
  ) {
    ctx.popoverView.setBounds(nextBounds);
  }
  return true;
}

function openPopover(ctx, { kind, x, y, width, height, payload }) {
  if (ctx.popoverOpenKind === kind && kind !== 'tab-context' && kind !== 'permission-prompt') {
    const isDifferentFolder =
      kind === 'bookmark-folder' &&
      ctx.popoverPayload?.payload?.folder !== payload?.folder;
    if (!isDifferentFolder) {
      closePopover(ctx);
      return false;
    }
  }
  if (ctx.popoverOpenKind === 'permission-prompt' && kind !== 'permission-prompt') {
    try {
      permissionsMod().onPermissionPopoverClosed(ctx);
    } catch (_) {}
  }
  const spec = getPopoverSpec(kind);
  closeExtensionPopup(ctx);
  if (!spec.keepSidebarOpen) {
    sidebarMod().closeSidebarIfUnpinned(ctx, { restoreFocus: false, ignoreGrace: true });
  }

  let effectivePayload = payload || {};
  let callerWidth = typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : spec.defaultW;
  let estimatedWidth = callerWidth;
  let estimatedHeight =
    typeof height === 'number' && Number.isFinite(height) && height > 0 ? height : spec.defaultH;

  if (kind === 'extensions-dropdown') {
    const extData = getExtensionsDropdownData();
    const rows = Array.isArray(extData?.rows) ? extData.rows : [];
    effectivePayload = { ...effectivePayload, rows, extensions: rows };
    estimatedWidth = 320;
    const rawH = rows.length === 0 ? 156 : 96 + rows.length * 46;
    estimatedHeight = Math.max(140, Math.min(480, rawH));
  } else if (kind === 'bookmark-folder') {
    const items = Array.isArray(effectivePayload?.items) ? effectivePayload.items : [];
    const rawH = items.length === 0 ? 96 : 54 + items.length * 33;
    estimatedHeight = Math.max(84, Math.min(560, height || rawH));
  } else if (kind === 'menu' || kind === 'tab-context' || kind === 'screenshot' || kind === 'shield' || kind === 'permissions' || kind === 'permission-prompt' || kind === 'site-info' || kind === 'zoom-bubble') {
    estimatedWidth = spec.defaultW;
    estimatedHeight = spec.defaultH;
  }

  const cacheKey = getPopoverCacheKey(kind, effectivePayload);
  const cachedSize = cacheKey ? measuredPopoverSizes.get(cacheKey) : null;
  const initialW = cachedSize?.width || estimatedWidth;
  const initialH = cachedSize?.height || estimatedHeight;

  const view = ensurePopoverView(ctx);
  ctx.popoverOpenKind = kind;
  ctx.popoverPayload = { kind, payload: effectivePayload };

  const [cw] = ctx.win.getContentSize();
  const isTabContext = kind === 'tab-context';
  const isBookmarkFolder = kind === 'bookmark-folder';
  const minY =
    typeof spec.minY === 'number'
      ? spec.minY
      : isTabContext
      ? 4
      : TOP_CHROME_HEIGHT - 2;
  const baseY =
    isTabContext || typeof spec.minY === 'number'
      ? Math.max(minY, y || 38)
      : Math.max(minY, y || TOP_CHROME_HEIGHT + 2);

  const rawLeft = typeof x === 'number' && Number.isFinite(x) ? x : 100;
  const anchorRight =
    spec.align === 'right'
      ? Math.round(rawLeft + callerWidth)
      : Math.round(rawLeft + initialW);

  ctx.popoverAnchor = {
    align: spec.align,
    left: Math.round(rawLeft),
    right: anchorRight,
    rightOffset: spec.align === 'right' ? Math.max(WINDOW_MARGIN, cw - anchorRight) : null,
    baseY: Math.round(baseY)
  };
  ctx.popoverLastSize = { width: initialW, height: initialH };

  const initialBounds = computePopoverBounds(ctx, kind, initialW, initialH);

  ctx.win.contentView.addChildView(view);
  if (typeof view.setVisible === 'function') {
    try {
      view.setVisible(true);
    } catch (_) {}
  }
  view.setBounds(initialBounds);
  if (!spec.noFocus && view.webContents && !view.webContents.isDestroyed()) {
    view.webContents.focus();
  }
  const sendData = () => {
    const latest = ctx.popoverPayload;
    if (latest && ctx.popoverOpenKind === latest.kind && view.webContents && !view.webContents.isDestroyed()) {
      view.webContents.send('popover:data', latest);
    }
  };
  if (view.webContents.isLoading()) {
    view.webContents.once('did-finish-load', sendData);
  } else {
    sendData();
  }
  return true;
}

module.exports = {
  ensurePopoverView,
  restoreFocusToActiveTab,
  restoreFocusAfterPopover,
  closePopover,
  resizePopover,
  openPopover
};
