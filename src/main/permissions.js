const { windowContexts, webContentsToWinId, state } = require('./core');
const { getOriginForUrl } = require('./utils');
const popoversMod = () => require('./popovers');

const SAFE_AUTO_ALLOW_PERMISSIONS = new Set([
  'fullscreen',
  'clipboard-sanitized-write',
  'mediaKeySystem'
]);

const PERMISSION_LABELS = {
  camera: 'Camera',
  microphone: 'Microphone',
  geolocation: 'Location',
  notifications: 'Notifications'
};

const PROMPT_TIMEOUT_MS = 45000;

function resolvePermissionKeys(permission, details = {}) {
  if (permission === 'videoCapture') return ['camera'];
  if (permission === 'audioCapture') return ['microphone'];
  if (permission === 'media') {
    const types = Array.isArray(details?.mediaTypes) ? details.mediaTypes : [];
    const keys = [];
    if (types.includes('video')) keys.push('camera');
    if (types.includes('audio')) keys.push('microphone');
    return keys.length > 0 ? keys : ['camera', 'microphone'];
  }
  if (permission === 'geolocation') return ['geolocation'];
  if (permission === 'notifications') return ['notifications'];
  return [];
}

function evaluatePermissionCheck(storage, permission, requestingOrigin, profileId = 'default', details = {}) {
  if (SAFE_AUTO_ALLOW_PERMISSIONS.has(permission)) return true;
  const keys = resolvePermissionKeys(permission, details);
  if (keys.length === 0) return false;
  const origin = getOriginForUrl(requestingOrigin);
  if (!origin || !storage || typeof storage.getSitePermissions !== 'function') return false;
  const perms = storage.getSitePermissions(origin, profileId);
  // Check handler returns true ONLY when explicitly allowed; 'ask' returns false so Chromium prompts.
  return keys.every((k) => perms[k] === 'allow');
}

function getSessionGrants(ctx) {
  if (!ctx._sessionPermissionGrants) {
    ctx._sessionPermissionGrants = new Map();
  }
  return ctx._sessionPermissionGrants;
}

function getSessionGrant(ctx, origin, key) {
  const grants = ctx?._sessionPermissionGrants;
  if (!grants) return null;
  const map = grants.get(origin);
  return map ? map[key] || null : null;
}

function setSessionGrant(ctx, origin, keys, value) {
  if (!ctx || !origin) return;
  const grants = getSessionGrants(ctx);
  const existing = grants.get(origin) || {};
  for (const k of keys) existing[k] = value;
  grants.set(origin, existing);
}

function ensurePromptQueue(ctx) {
  if (!ctx._permissionPromptQueue) ctx._permissionPromptQueue = [];
  return ctx._permissionPromptQueue;
}

function finishActivePrompt(ctx, allowed) {
  if (!ctx || !ctx._activePermissionPrompt) return;
  const active = ctx._activePermissionPrompt;
  ctx._activePermissionPrompt = null;
  if (active.timer) {
    clearTimeout(active.timer);
    active.timer = null;
  }
  try {
    active.callback(Boolean(allowed));
  } catch (_) {}
  pumpPermissionQueue(ctx);
}

function pumpPermissionQueue(ctx) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return;
  if (ctx._activePermissionPrompt) return;
  const queue = ensurePromptQueue(ctx);
  if (queue.length === 0) return;

  const next = queue.shift();
  const requestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const active = {
    ...next,
    requestId,
    timer: setTimeout(() => {
      if (ctx._activePermissionPrompt?.requestId === requestId) {
        if (ctx.popoverOpenKind === 'permission-prompt') {
          popoversMod().closePopover(ctx, { restoreFocus: false });
        } else {
          finishActivePrompt(ctx, false);
        }
      }
    }, PROMPT_TIMEOUT_MS)
  };
  if (typeof active.timer.unref === 'function') active.timer.unref();
  ctx._activePermissionPrompt = active;

  let displayHost = active.origin;
  try {
    displayHost = new URL(active.origin).host || active.origin;
  } catch (_) {}

  const labels = active.keys.map((k) => PERMISSION_LABELS[k] || k);
  const leftX = (ctx.layoutState?.left || 50) + 74;
  const topY = (ctx.layoutState?.top || 84) - 2;

  popoversMod().openPopover(ctx, {
    kind: 'permission-prompt',
    x: leftX,
    y: topY,
    width: 332,
    height: 176,
    payload: {
      requestId,
      origin: active.origin,
      host: displayHost,
      keys: active.keys,
      labels,
      incognito: Boolean(ctx.incognito)
    }
  });
}

function resolvePermissionPrompt(ctx, { requestId, decision } = {}) {
  if (!ctx || !ctx._activePermissionPrompt) return { ok: false };
  const active = ctx._activePermissionPrompt;
  if (requestId && active.requestId !== requestId) return { ok: false };

  const allowed = decision === 'allow-once' || decision === 'allow-always';
  if (decision === 'allow-always') {
    if (ctx.incognito) {
      setSessionGrant(ctx, active.origin, active.keys, 'allow');
    } else if (state.storage) {
      for (const k of active.keys) {
        state.storage.setSitePermission(active.origin, k, 'allow', active.profileId);
      }
    }
  } else if (decision === 'block') {
    if (ctx.incognito) {
      setSessionGrant(ctx, active.origin, active.keys, 'block');
    } else if (state.storage) {
      for (const k of active.keys) {
        state.storage.setSitePermission(active.origin, k, 'block', active.profileId);
      }
    }
  }

  // Close popover first without re-triggering cancel, then resolve callback
  ctx._activePermissionPrompt = null;
  if (active.timer) {
    clearTimeout(active.timer);
    active.timer = null;
  }
  if (ctx.popoverOpenKind === 'permission-prompt') {
    popoversMod().closePopover(ctx, { restoreFocus: true });
  }
  try {
    active.callback(allowed);
  } catch (_) {}
  pumpPermissionQueue(ctx);
  return { ok: true, allowed, decision };
}

function onPermissionPopoverClosed(ctx) {
  if (ctx && ctx._activePermissionPrompt) {
    finishActivePrompt(ctx, false);
  }
}

function cancelPendingPermissionsForWindow(ctx) {
  if (!ctx) return;
  if (ctx._activePermissionPrompt) {
    const active = ctx._activePermissionPrompt;
    ctx._activePermissionPrompt = null;
    if (active.timer) clearTimeout(active.timer);
    try {
      active.callback(false);
    } catch (_) {}
  }
  if (Array.isArray(ctx._permissionPromptQueue)) {
    while (ctx._permissionPromptQueue.length > 0) {
      const item = ctx._permissionPromptQueue.shift();
      try {
        item.callback(false);
      } catch (_) {}
    }
  }
}

function setupPermissionsForSession(ses, profileId = 'default', { incognito = false } = {}) {
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
    if (SAFE_AUTO_ALLOW_PERMISSIONS.has(permission)) return true;
    const keys = resolvePermissionKeys(permission, details);
    if (keys.length === 0) return false;
    const origin = getOriginForUrl(requestingOrigin);
    if (!origin) return false;
    if (incognito && wc) {
      const winId = webContentsToWinId.get(wc.id);
      const ctx = winId ? windowContexts.get(winId) : null;
      if (ctx && keys.every((k) => getSessionGrant(ctx, origin, k) === 'allow')) return true;
      if (ctx && keys.some((k) => getSessionGrant(ctx, origin, k) === 'block')) return false;
    }
    return evaluatePermissionCheck(state.storage, permission, origin, profileId, details);
  });

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (SAFE_AUTO_ALLOW_PERMISSIONS.has(permission)) {
      return callback(true);
    }
    const keys = resolvePermissionKeys(permission, details);
    if (keys.length === 0) {
      // Default-DENY all unmapped sensitive permissions (usb, hid, serial, display-capture, clipboard-read, etc.)
      return callback(false);
    }
    const origin = getOriginForUrl(details?.requestingUrl || webContents?.getURL?.() || '');
    if (!origin) {
      return callback(false);
    }

    const winId = webContents ? webContentsToWinId.get(webContents.id) : null;
    const ctx = winId ? windowContexts.get(winId) : null;

    if (incognito && ctx) {
      if (keys.some((k) => getSessionGrant(ctx, origin, k) === 'block')) return callback(false);
      if (keys.every((k) => getSessionGrant(ctx, origin, k) === 'allow')) return callback(true);
    }

    const stored = state.storage ? state.storage.getSitePermissions(origin, profileId) : {};
    if (keys.some((k) => stored[k] === 'block')) {
      return callback(false);
    }
    if (!incognito && keys.every((k) => stored[k] === 'allow')) {
      return callback(true);
    }

    // One or more requested keys are 'ask' -> show in-app permission prompt popover
    if (!ctx || !ctx.win || ctx.win.isDestroyed()) {
      return callback(false);
    }
    ensurePromptQueue(ctx).push({
      origin,
      keys,
      profileId,
      callback
    });
    pumpPermissionQueue(ctx);
  });
}

module.exports = {
  SAFE_AUTO_ALLOW_PERMISSIONS,
  resolvePermissionKeys,
  evaluatePermissionCheck,
  setupPermissionsForSession,
  resolvePermissionPrompt,
  onPermissionPopoverClosed,
  cancelPendingPermissionsForWindow
};
