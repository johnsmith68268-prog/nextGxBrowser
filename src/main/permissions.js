const { windowContexts, webContentsToWinId, state } = require('./core');
const { getOriginForUrl } = require('./utils');
const { desktopCapturer } = require('electron');
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
  notifications: 'Notifications',
  // S-2: screen sharing and clipboard-read now have a prompt path.
  'screen-share': 'Screen sharing',
  'clipboard-read': 'Clipboard'
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
  // S-2: screen sharing (Meet/Zoom/Teams) and clipboard-read get a prompt path
  // instead of a silent default-deny. usb/hid/serial stay unmapped (denied).
  if (permission === 'display-capture') return ['screen-share'];
  if (permission === 'clipboard-read') return ['clipboard-read'];
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
  // s-3: per-key decisions only — never overwrite a pre-existing grant with the
  // opposite decision (e.g. a Block on a camera+mic prompt must not revoke an
  // already-allowed camera). The request handler already queues only undecided
  // keys; this guard covers decisions that changed while the prompt was open.
  if (decision === 'allow-always') {
    if (ctx.incognito) {
      const toAllow = active.keys.filter((k) => getSessionGrant(ctx, active.origin, k) !== 'block');
      setSessionGrant(ctx, active.origin, toAllow, 'allow');
    } else if (state.storage) {
      const current = state.storage.getSitePermissions(active.origin, active.profileId);
      for (const k of active.keys) {
        if (current[k] !== 'block') {
          state.storage.setSitePermission(active.origin, k, 'allow', active.profileId);
        }
      }
    }
  } else if (decision === 'block') {
    if (ctx.incognito) {
      const toBlock = active.keys.filter((k) => getSessionGrant(ctx, active.origin, k) !== 'allow');
      setSessionGrant(ctx, active.origin, toBlock, 'block');
    } else if (state.storage) {
      const current = state.storage.getSitePermissions(active.origin, active.profileId);
      for (const k of active.keys) {
        if (current[k] !== 'allow') {
          state.storage.setSitePermission(active.origin, k, 'block', active.profileId);
        }
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
    if (incognito) {
      // s-2: private windows NEVER read persistent (normal-profile) grants —
      // a site allowed in the normal profile must show as 'prompt' here.
      // Only this window's session grants count; anything else is undecided,
      // so return false and let Chromium ask via the request handler.
      if (wc) {
        const winId = webContentsToWinId.get(wc.id);
        const ctx = winId ? windowContexts.get(winId) : null;
        if (ctx && keys.every((k) => getSessionGrant(ctx, origin, k) === 'allow')) return true;
        if (ctx && keys.some((k) => getSessionGrant(ctx, origin, k) === 'block')) return false;
      }
      return false;
    }
    return evaluatePermissionCheck(state.storage, permission, origin, profileId, details);
  });

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (SAFE_AUTO_ALLOW_PERMISSIONS.has(permission)) {
      return callback(true);
    }
    const keys = resolvePermissionKeys(permission, details);
    if (keys.length === 0) {
      // Default-DENY all unmapped sensitive permissions (usb, hid, serial, etc.).
      // display-capture and clipboard-read ARE mapped (S-2) and prompt below.
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
    if (!incognito) {
      // s-2: persistent blocks apply to normal windows only; a private window
      // must not inherit the normal profile's decisions (it prompts instead).
      if (keys.some((k) => stored[k] === 'block')) {
        return callback(false);
      }
      if (keys.every((k) => stored[k] === 'allow')) {
        return callback(true);
      }
    }

    // One or more requested keys are 'ask' -> show in-app permission prompt popover
    if (!ctx || !ctx.win || ctx.win.isDestroyed()) {
      return callback(false);
    }

    // s-3: prompt ONLY for keys that are still undecided in the store this
    // window reads. Pre-existing grants are preserved and never re-decided:
    // e.g. camera already allowed + mic asked -> prompt asks about mic only,
    // so Block cannot revoke the camera grant.
    const pendingKeys = incognito
      ? keys.filter((k) => !getSessionGrant(ctx, origin, k))
      : keys.filter((k) => stored[k] !== 'allow' && stored[k] !== 'block');
    if (pendingKeys.length === 0) {
      // Defensive: every key already has a decision (early checks above should
      // have caught this). Re-check grants instead of prompting.
      const granted = incognito
        ? keys.every((k) => getSessionGrant(ctx, origin, k) === 'allow')
        : keys.every((k) => stored[k] === 'allow');
      return callback(granted);
    }
    ensurePromptQueue(ctx).push({
      origin,
      keys: pendingKeys,
      profileId,
      callback
    });
    pumpPermissionQueue(ctx);
  });

  // S-2: without a display-media handler, getDisplayMedia() can never return a
  // stream even after the user allows screen sharing. Return the primary
  // screen; audio is not captured (video-only stream).
  ses.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      const primary = sources.find((src) => String(src.id).startsWith('screen:')) || sources[0];
      if (!primary) return callback({});
      callback({ video: primary });
    } catch (_) {
      callback({});
    }
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
