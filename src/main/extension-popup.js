const { WebContentsView, session } = require('electron');
const {
  TOP_CHROME_HEIGHT,
  windowContexts,
  webContentsToWinId,
  registerWebContents
} = require('./core');
const { attachKeyboardShortcuts } = require('./shortcuts');

const DEFAULT_POPUP_WIDTH = 360;
const DEFAULT_POPUP_HEIGHT = 520;
const MIN_POPUP_WIDTH = 280;
const MAX_POPUP_WIDTH = 420;
const MIN_POPUP_HEIGHT = 200;
const MAX_POPUP_HEIGHT = 600;
const BLUR_GUARD_MS = 200;
const BLUR_TOGGLE_DEBOUNCE_MS = 250;

function computePopupBounds(ctx, requestedWidth, requestedHeight, anchor) {
  const [cw, ch] = ctx.win.getContentSize();
  const baseY = TOP_CHROME_HEIGHT + 2;

  const clampedW = Math.max(
    MIN_POPUP_WIDTH,
    Math.min(MAX_POPUP_WIDTH, Math.round(Number(requestedWidth) || DEFAULT_POPUP_WIDTH))
  );
  const clampedH = Math.max(
    MIN_POPUP_HEIGHT,
    Math.min(MAX_POPUP_HEIGHT, Math.round(Number(requestedHeight) || DEFAULT_POPUP_HEIGHT))
  );

  const width = Math.max(120, Math.min(clampedW, Math.max(120, cw - 16)));
  const maxWinH = Math.max(120, ch - baseY - 12);
  const height = Math.max(120, Math.min(clampedH, maxWinH));

  let rightEdge = cw - 12;
  if (anchor && typeof anchor === 'object') {
    if (typeof anchor.right === 'number' && Number.isFinite(anchor.right) && anchor.right > 0) {
      rightEdge = Math.round(anchor.right);
    } else if (
      typeof anchor.x === 'number' &&
      Number.isFinite(anchor.x) &&
      typeof anchor.width === 'number' &&
      Number.isFinite(anchor.width)
    ) {
      rightEdge = Math.round(anchor.x + anchor.width);
    }
  }

  const rawX = rightEdge - width;
  const x = Math.max(8, Math.min(rawX, Math.max(8, cw - width - 8)));
  const y = Math.max(8, Math.min(baseY, Math.max(8, ch - height - 8)));

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  };
}

function closeExtensionPopup(ctx, { fromBlur = false } = {}) {
  if (!ctx) return false;

  if (ctx._onWinBlurCloseExtPopup && ctx.win && !ctx.win.isDestroyed()) {
    try {
      ctx.win.removeListener('blur', ctx._onWinBlurCloseExtPopup);
    } catch (_) {}
  }
  ctx._onWinBlurCloseExtPopup = null;

  if (ctx._onWinResizeExtPopup && ctx.win && !ctx.win.isDestroyed()) {
    try {
      ctx.win.removeListener('resize', ctx._onWinResizeExtPopup);
    } catch (_) {}
  }
  ctx._onWinResizeExtPopup = null;

  const view = ctx.extensionPopupView;
  const closedId = ctx.extensionPopupId;
  ctx.extensionPopupView = null;
  ctx.extensionPopupId = null;
  ctx.extensionPopupAnchor = null;
  ctx.extensionPopupLastSize = null;

  if (!view) return false;

  if (fromBlur && closedId) {
    ctx.lastBlurClosedExtPopup = { id: closedId, closedAt: Date.now() };
  } else {
    ctx.lastBlurClosedExtPopup = null;
  }

  if (view.webContents && typeof view.webContents.id === 'number') {
    webContentsToWinId.delete(view.webContents.id);
  }

  try {
    if (ctx.win && !ctx.win.isDestroyed() && ctx.win.contentView) {
      ctx.win.contentView.removeChildView(view);
    }
  } catch (_) {}

  try {
    if (view.webContents && !view.webContents.isDestroyed()) {
      if (typeof view.webContents.close === 'function') {
        view.webContents.close();
      } else if (typeof view.webContents.destroy === 'function') {
        view.webContents.destroy();
      }
    }
  } catch (_) {}

  return true;
}

function closeExtensionPopupsForExtension(extensionId) {
  for (const ctx of windowContexts.values()) {
    if (!ctx || !ctx.extensionPopupView) continue;
    if (!extensionId || ctx.extensionPopupId === extensionId) {
      closeExtensionPopup(ctx);
    }
  }
}

function sendToast(ctx, message) {
  if (
    ctx &&
    ctx.win &&
    !ctx.win.isDestroyed() &&
    ctx.win.webContents &&
    !ctx.win.webContents.isDestroyed()
  ) {
    ctx.win.webContents.send('ui:toast', message);
  }
}

function openExtensionPopup(ctx, id, anchor = null) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) {
    return { ok: false, reason: 'no-window' };
  }

  if (ctx.incognito) {
    closeExtensionPopup(ctx);
    sendToast(ctx, 'Extensions do not run in Private windows');
    return { ok: false, reason: 'incognito' };
  }

  if (!id || typeof id !== 'string') {
    closeExtensionPopup(ctx);
    return { ok: false, reason: 'invalid-id' };
  }

  // Clicking the pinned toolbar icon while its popup is open first blurs and
  // closes the popup on mousedown, then dispatches extension-popup:<id> on
  // click. Treat a repeat open within the debounce window as a toggle-close.
  const lastBlur = ctx.lastBlurClosedExtPopup;
  if (lastBlur && lastBlur.id === id && Date.now() - lastBlur.closedAt <= BLUR_TOGGLE_DEBOUNCE_MS) {
    ctx.lastBlurClosedExtPopup = null;
    return { ok: true, id, toggledClosed: true };
  }
  ctx.lastBlurClosedExtPopup = null;

  const { getExtensionPopupInfo } = require('./extensions');
  const info = getExtensionPopupInfo(id);

  if (!info || !info.enabled || !info.loaded) {
    closeExtensionPopup(ctx);
    sendToast(ctx, 'Extension is disabled');
    return { ok: false, reason: 'disabled' };
  }

  if (!info.hasPopup || !info.url) {
    closeExtensionPopup(ctx);
    sendToast(ctx, 'This extension has no popup');
    return { ok: false, reason: 'no-popup' };
  }

  closeExtensionPopup(ctx);

  const view = new WebContentsView({
    webPreferences: {
      session: session.defaultSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const wc = view.webContents;
  const openedAt = Date.now();
  registerWebContents(wc, ctx.win.id);
  attachKeyboardShortcuts(ctx, wc);

  wc.setWindowOpenHandler(({ url }) => {
    if (url && /^(https?:\/\/|chrome-extension:\/\/)/i.test(url)) {
      const { createTab } = require('./tabs');
      setImmediate(() => {
        if (ctx.extensionPopupView === view) {
          closeExtensionPopup(ctx);
        }
        if (ctx.win && !ctx.win.isDestroyed()) {
          createTab(ctx, { url, active: true });
        }
      });
    }
    return { action: 'deny' };
  });

  let storedAnchor = null;
  if (anchor && typeof anchor === 'object') {
    storedAnchor = { ...anchor };
    const [cw] = ctx.win.getContentSize();
    let anchorRight = null;
    if (typeof anchor.right === 'number' && Number.isFinite(anchor.right) && anchor.right > 0) {
      anchorRight = Math.round(anchor.right);
    } else if (
      typeof anchor.x === 'number' &&
      Number.isFinite(anchor.x) &&
      typeof anchor.width === 'number' &&
      Number.isFinite(anchor.width)
    ) {
      anchorRight = Math.round(anchor.x + anchor.width);
    }
    if (anchorRight !== null) {
      storedAnchor.rightOffset = Math.max(8, cw - anchorRight);
    }
  }

  ctx.extensionPopupView = view;
  ctx.extensionPopupId = id;
  ctx.extensionPopupAnchor = storedAnchor;
  ctx.extensionPopupLastSize = { width: DEFAULT_POPUP_WIDTH, height: DEFAULT_POPUP_HEIGHT };

  const initialBounds = computePopupBounds(ctx, DEFAULT_POPUP_WIDTH, DEFAULT_POPUP_HEIGHT, storedAnchor);
  ctx.win.contentView.addChildView(view);
  view.setBounds(initialBounds);

  const onWinBlur = () => {
    if (ctx.extensionPopupView === view) {
      closeExtensionPopup(ctx);
    }
  };
  ctx._onWinBlurCloseExtPopup = onWinBlur;
  ctx.win.on('blur', onWinBlur);

  const onWinResize = () => {
    if (ctx.extensionPopupView !== view || !ctx.win || ctx.win.isDestroyed()) return;
    let effectiveAnchor = ctx.extensionPopupAnchor;
    if (effectiveAnchor && typeof effectiveAnchor.rightOffset === 'number') {
      const [cw] = ctx.win.getContentSize();
      effectiveAnchor = {
        ...effectiveAnchor,
        right: Math.max(8, cw - effectiveAnchor.rightOffset)
      };
    }
    const lastW = ctx.extensionPopupLastSize?.width || DEFAULT_POPUP_WIDTH;
    const lastH = ctx.extensionPopupLastSize?.height || DEFAULT_POPUP_HEIGHT;
    const nextBounds = computePopupBounds(ctx, lastW, lastH, effectiveAnchor);
    try {
      view.setBounds(nextBounds);
    } catch (_) {}
  };
  ctx._onWinResizeExtPopup = onWinResize;
  ctx.win.on('resize', onWinResize);

  wc.on('before-input-event', (event, input) => {
    if (input && input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault();
      closeExtensionPopup(ctx);
    }
  });

  wc.on('blur', () => {
    if (ctx.extensionPopupView !== view) return;
    if (Date.now() - openedAt < BLUR_GUARD_MS) {
      return;
    }
    closeExtensionPopup(ctx, { fromBlur: true });
  });

  wc.once('did-finish-load', async () => {
    if (ctx.extensionPopupView !== view || !ctx.win || ctx.win.isDestroyed() || wc.isDestroyed()) {
      return;
    }
    try {
      wc.focus();
    } catch (_) {}

    try {
      const measured = await wc.executeJavaScript(
        `(() => {
          const docEl = document.documentElement;
          const body = document.body;
          const vw = window.innerWidth || ${DEFAULT_POPUP_WIDTH};
          const vh = window.innerHeight || ${DEFAULT_POPUP_HEIGHT};
          const docScrollW = docEl ? docEl.scrollWidth : 0;
          const docScrollH = docEl ? docEl.scrollHeight : 0;
          const bodyRect = body ? body.getBoundingClientRect() : null;
          const docRect = docEl ? docEl.getBoundingClientRect() : null;
          const cs = body ? window.getComputedStyle(body) : null;
          const mx = cs ? (parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.marginRight) || 0) : 0;
          const my = cs ? (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0) : 0;
          const bodyW = body
            ? Math.ceil(Math.max(body.offsetWidth || 0, bodyRect ? bodyRect.width : 0) + mx)
            : 0;
          const bodyH = body
            ? Math.ceil(Math.max(body.offsetHeight || 0, body.scrollHeight || 0, bodyRect ? bodyRect.height : 0) + my)
            : 0;
          const docBoxW = docRect ? Math.ceil(docRect.width) : 0;
          const docBoxH = docRect ? Math.ceil(docRect.height) : 0;

          let width = docScrollW;
          if (docBoxW > 0 && docBoxW < vw) {
            width = docBoxW;
          } else if (bodyW > 0 && bodyW < vw) {
            width = bodyW;
          }

          let height = docScrollH;
          if (docBoxH > 0 && docBoxH < vh) {
            height = Math.max(docBoxH, bodyH);
          } else if (bodyH > 0 && bodyH < vh) {
            height = bodyH;
          }

          return { width: Number(width) || 0, height: Number(height) || 0 };
        })()`,
        true
      );

      if (ctx.extensionPopupView !== view || !ctx.win || ctx.win.isDestroyed() || wc.isDestroyed()) {
        return;
      }

      if (
        measured &&
        typeof measured.width === 'number' &&
        measured.width > 0 &&
        typeof measured.height === 'number' &&
        measured.height > 0
      ) {
        ctx.extensionPopupLastSize = { width: measured.width, height: measured.height };
        let effectiveAnchor = ctx.extensionPopupAnchor;
        if (effectiveAnchor && typeof effectiveAnchor.rightOffset === 'number') {
          const [cw] = ctx.win.getContentSize();
          effectiveAnchor = {
            ...effectiveAnchor,
            right: Math.max(8, cw - effectiveAnchor.rightOffset)
          };
        }
        const nextBounds = computePopupBounds(ctx, measured.width, measured.height, effectiveAnchor);
        view.setBounds(nextBounds);
      }
    } catch (_) {
      // Keep default size on measurement failure
    }
  });

  wc.loadURL(info.url).catch(() => {});
  try {
    wc.focus();
  } catch (_) {}

  return {
    ok: true,
    id,
    url: info.url,
    bounds: initialBounds
  };
}

module.exports = {
  DEFAULT_POPUP_WIDTH,
  DEFAULT_POPUP_HEIGHT,
  MIN_POPUP_WIDTH,
  MAX_POPUP_WIDTH,
  MIN_POPUP_HEIGHT,
  MAX_POPUP_HEIGHT,
  computePopupBounds,
  openExtensionPopup,
  closeExtensionPopup,
  closeExtensionPopupsForExtension
};
