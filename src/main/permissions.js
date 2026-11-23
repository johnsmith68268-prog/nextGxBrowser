const fs = require('fs');
const path = require('path');
const { windowContexts, webContentsToWinId, state, TOP_CHROME_HEIGHT } = require('./core');
const { getOriginForUrl } = require('./utils');
const { app, desktopCapturer, ipcMain, webContents } = require('electron');
const popoversMod = () => require('./popovers');

const SAFE_AUTO_ALLOW_PERMISSIONS = new Set([
  'fullscreen',
  'clipboard-sanitized-write',
  'mediaKeySystem'
]);

// [FIXUP-4] (Chrome parity gap 5.12) Per-permission defaults ("Sites can
// ask" / "Don't allow") from settings.sitePermissionDefaults. Only
// 'ask' | 'block' are storable (storage.js sanitizer); an 'allow' value is
// handled defensively but cannot be set through settings today. A default
// of 'block' denies without prompting; a per-site explicit decision
// (stored, or this window's session grant) overrides the default.
function getSitePermissionDefaults(profileId) {
  try {
    const settings = state.storage ? state.storage.getSettings(profileId || 'default') : null;
    const d = settings && settings.sitePermissionDefaults;
    return d && typeof d === 'object' ? d : {};
  } catch (_) {
    return {};
  }
}

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
const DISPLAY_MEDIA_PICKER_TIMEOUT_MS = 120000;
const DEVICE_PREFS_FILE = 'media_device_prefs.json';

// Chrome parity (gap 1.2/1.6): media/location prompts get three full-width
// pills; notifications/clipboard prompts get a two-pill Block/Allow layout.
function resolvePromptVariant(keys) {
  const list = Array.isArray(keys) ? keys : [];
  if (list.length > 0 && list.every((k) => k === 'notifications' || k === 'clipboard-read')) {
    return 'simple';
  }
  return 'media';
}

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

// ---------------------------------------------------------------------------
// Preferred media devices (Chrome parity gap 1.3)
// Per-origin camera/microphone deviceId chosen in the permission prompt.
// Persisted to media_device_prefs.json next to site_permissions.json so the
// choice survives a relaunch; also kept in memory for the current session.
// ---------------------------------------------------------------------------
const devicePrefsCache = new Map(); // profileId -> { file, data }

function resolveDevicePrefsPath(profileId) {
  try {
    const storage = state.storage;
    let dir = null;
    if (storage) {
      if (typeof storage._targetFor === 'function') {
        try {
          const target = storage._targetFor(profileId);
          if (target && typeof target.dataDir === 'string' && target.dataDir) dir = target.dataDir;
        } catch (_) {}
      }
      if (!dir && typeof storage.dataDir === 'string' && storage.dataDir) dir = storage.dataDir;
    }
    if (!dir && app && typeof app.getPath === 'function') {
      dir = path.join(app.getPath('userData'), 'nextgx-data');
    }
    return dir ? path.join(dir, DEVICE_PREFS_FILE) : null;
  } catch (_) {
    return null;
  }
}

function loadDevicePrefs(profileId) {
  const pid = typeof profileId === 'string' && profileId ? profileId : 'default';
  const cached = devicePrefsCache.get(pid);
  if (cached) return cached.data;
  const file = resolveDevicePrefsPath(pid);
  let data = {};
  if (file) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed;
    } catch (_) {}
  }
  devicePrefsCache.set(pid, { file, data });
  return data;
}

function saveDevicePrefs(profileId) {
  const pid = typeof profileId === 'string' && profileId ? profileId : 'default';
  const cached = devicePrefsCache.get(pid);
  if (!cached || !cached.file) return;
  try {
    fs.mkdirSync(path.dirname(cached.file), { recursive: true });
    fs.writeFileSync(cached.file, JSON.stringify(cached.data, null, 2), 'utf8');
  } catch (_) {}
}

function getPreferredDevices(origin, profileId = 'default') {
  if (!origin || typeof origin !== 'string') return {};
  const data = loadDevicePrefs(profileId);
  const entry = data[origin];
  return entry && typeof entry === 'object' ? { ...entry } : {};
}

function setPreferredDevices(origin, profileId = 'default', devices = {}) {
  if (!origin || typeof origin !== 'string' || !devices || typeof devices !== 'object') return {};
  const data = loadDevicePrefs(profileId);
  const prev = data[origin] && typeof data[origin] === 'object' ? data[origin] : {};
  const next = { ...prev };
  if (typeof devices.camera === 'string' && devices.camera) next.camera = devices.camera;
  if (typeof devices.microphone === 'string' && devices.microphone) next.microphone = devices.microphone;
  // Labels are the portable part of a device choice: deviceIds are salted
  // per origin/profile, so the tab preload matches on the label (see
  // tab-preload.js). The raw ids are kept for diagnostics only.
  if (typeof devices.cameraLabel === 'string' && devices.cameraLabel) next.cameraLabel = devices.cameraLabel;
  if (typeof devices.microphoneLabel === 'string' && devices.microphoneLabel) {
    next.microphoneLabel = devices.microphoneLabel;
  }
  if (Object.keys(next).length === 0) return { ...prev };
  data[origin] = next;
  saveDevicePrefs(profileId);
  return { ...next };
}

function pushDeviceChoiceToTab(ctx, origin, devices) {
  try {
    const tab = ctx?.activeTabId ? ctx.tabs?.get(ctx.activeTabId) : null;
    const wc = tab?.view?.webContents;
    if (wc && typeof wc.isDestroyed === 'function' && !wc.isDestroyed() && typeof wc.send === 'function') {
      wc.send('gx-media-device-choice', { origin, devices: { ...devices } });
    }
  } catch (_) {}
}

// The permission prompt itself (src/ui/popover.html, a trusted internal UI
// page) needs a media grant so it can show a live camera preview and
// enumerate devices with labels. Without a grant, enumerateDevices() returns
// empty labels AND empty deviceIds, so no picker is possible. The popover
// view runs in the default session with no web origin, so it is allow-listed
// here by its file URL; regular web pages are unaffected.
function isPopoverWebContents(wc) {
  try {
    const url = wc && typeof wc.getURL === 'function' ? wc.getURL() : '';
    return typeof url === 'string' && url.startsWith('file://') && url.includes('popover.html');
  } catch (_) {
    return false;
  }
}

function isMediaPermission(permission) {
  return permission === 'media' || permission === 'videoCapture' || permission === 'audioCapture';
}

// Chrome parity (gap 1.1 / YouTube voice search): navigator.permissions.query
// must report Chrome-accurate states. Electron's boolean check handler can
// only say granted/denied, so an undecided permission reports 'denied' and
// YouTube shows "go to your browser settings" instead of calling
// getUserMedia. The tab preload corrects the reported state to the stored /
// session decision ('prompt' when undecided). The channel is origin-bound.
const PERMISSIONS_QUERY_KEY_BY_NAME = {
  microphone: 'microphone',
  camera: 'camera',
  geolocation: 'geolocation',
  notifications: 'notifications',
  'clipboard-read': 'clipboard-read'
};
function getEffectivePermissionState(origin, key, ctx) {
  if (!origin || !key) return 'prompt';
  const incognito = Boolean(ctx && ctx.incognito);
  const pid = (ctx && ctx.profileId) || 'default';
  if (!incognito && state.storage) {
    const stored = state.storage.getSitePermissions(origin, pid) || {};
    if (stored[key] === 'allow') return 'granted';
    if (stored[key] === 'block') return 'denied';
  }
  if (ctx) {
    const grant = getSessionGrant(ctx, origin, key);
    if (grant === 'allow') return 'granted';
    if (grant === 'block') return 'denied';
  }
  // [FIXUP-4] A 'block' default reports 'denied' (the request is denied
  // without prompting); 'ask' stays 'prompt'.
  const defaults = getSitePermissionDefaults(pid);
  if (defaults[key] === 'block') return 'denied';
  if (defaults[key] === 'allow') return 'granted';
  return 'prompt';
}

// Tab preload (src/tab-preload.js) asks for the stored device choice before
// calling getUserMedia. The channel is origin-bound: a page may only read the
// prefs for its own origin, so this is safe to expose to web content.
let mediaIpcRegistered = false;
function ensureMediaIpcRegistered() {
  if (mediaIpcRegistered) return;
  mediaIpcRegistered = true;
  try {
    if (!ipcMain || typeof ipcMain.handle !== 'function') return;
    ipcMain.handle('media:get-preferred-device', (e, payload = {}) => {
      const origin = typeof payload?.origin === 'string' ? payload.origin : '';
      if (!origin) return {};
      try {
        const senderOrigin = e?.sender && typeof e.sender.getURL === 'function'
          ? new URL(e.sender.getURL()).origin
          : '';
        if (senderOrigin !== origin) return {};
      } catch (_) {
        return {};
      }
      const pid = typeof payload?.profileId === 'string' && payload.profileId ? payload.profileId : 'default';
      return getPreferredDevices(origin, pid);
    });
    ipcMain.handle('permissions:query-state', (e, payload = {}) => {
      const origin = typeof payload?.origin === 'string' ? payload.origin : '';
      const name = typeof payload?.name === 'string' ? payload.name : '';
      const key = PERMISSIONS_QUERY_KEY_BY_NAME[name];
      if (!origin || !key) return { state: 'prompt' };
      try {
        const senderOrigin = e?.sender && typeof e.sender.getURL === 'function'
          ? new URL(e.sender.getURL()).origin
          : '';
        if (senderOrigin !== origin) return { state: 'prompt' };
      } catch (_) {
        return { state: 'prompt' };
      }
      const winId = e?.sender ? webContentsToWinId.get(e.sender.id) : null;
      const ctx = winId ? windowContexts.get(winId) : null;
      return { state: getEffectivePermissionState(origin, key, ctx) };
    });
  } catch (_) {}
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
    width: 360,
    height: 300,
    payload: {
      requestId,
      origin: active.origin,
      host: displayHost,
      keys: active.keys,
      labels,
      variant: resolvePromptVariant(active.keys),
      incognito: Boolean(ctx.incognito)
    }
  });
}

function resolvePermissionPrompt(ctx, { requestId, decision, devices, displayMediaRequestId, source, tabAudio } = {}) {
  // Share-picker responses arrive on the same gxAPI channel; route them to
  // the pending display-media request instead of the permission prompt.
  if (displayMediaRequestId) {
    return resolveDisplayMediaRequest(ctx, {
      requestId: displayMediaRequestId,
      decision,
      source,
      tabAudio
    });
  }
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
  } else if (decision === 'allow-once') {
    // Chrome parity (gap 1.7): a one-time grant is NOT persisted — it never
    // appears in the privacy dashboard listing — but it does cover the rest
    // of the visit in this window, so a second getUserMedia call (including
    // the tab preload's re-call with a chosen device) does not re-prompt.
    setSessionGrant(ctx, active.origin, active.keys, 'allow');
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

  // Chrome parity (gap 1.3): remember the device the user picked in the
  // prompt alongside the grant, and hand it to the requesting tab so the tab
  // preload can apply it to the page's stream.
  if (devices && (decision === 'allow-always' || decision === 'allow-once')) {
    try {
      const stored = setPreferredDevices(active.origin, active.profileId, devices);
      if (stored && Object.keys(stored).length > 0) {
        pushDeviceChoiceToTab(ctx, active.origin, stored);
      }
    } catch (_) {}
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
    // Gap 1.4: dismissing via ✕ / outside click stores NO decision — the
    // site is asked again next time. finishActivePrompt(false) only resolves
    // the in-flight callback; nothing is written to the store.
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
  cancelPendingDisplayMediaForWindow(ctx);
}

// ---------------------------------------------------------------------------
// Screen-share picker (Chrome parity gap 2.1 / 2.2 / 2.3 / 2.4)
// Replaces the old auto-pick-primary-screen handler. The picker is a centred
// popover view with three tabs (Tab / Window / Entire Screen), live
// thumbnails, a Share button that stays disabled until a source is picked,
// and a "Share with tab audio" toggle on the Tab tab.
// Tab capture uses Electron 45's WebFrameMain stream support: the display
// media callback accepts { video: frame, audio: frame } for a tab's main
// frame, so a tab share returns a genuinely live MediaStream.
// ---------------------------------------------------------------------------

function thumbnailDataUrl(image) {
  try {
    if (image && typeof image.toDataURL === 'function') return image.toDataURL();
  } catch (_) {}
  return '';
}

function withTimeout(promise, ms) {
  if (!promise || typeof promise.then !== 'function') return Promise.resolve(null);
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), ms))
  ]);
}

function findDisplayMediaCtx(request) {
  let wc = null;
  try {
    if (request?.frame && webContents && typeof webContents.fromFrame === 'function') {
      wc = webContents.fromFrame(request.frame);
    }
  } catch (_) {}
  const winId = wc ? webContentsToWinId.get(wc.id) : null;
  return winId ? windowContexts.get(winId) || null : null;
}

async function handleDisplayMediaRequest(request, callback) {
  const ctx = findDisplayMediaCtx(request);
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return callback({});
  if (ctx._activeDisplayMediaRequest) return callback({});

  const origin = typeof request?.securityOrigin === 'string' ? request.securityOrigin : '';
  const requestId = `dm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const pending = {
    requestId,
    ctx,
    callback,
    origin,
    videoRequested: Boolean(request?.videoRequested),
    audioRequested: Boolean(request?.audioRequested),
    timer: null,
    sources: [],
    tabs: []
  };
  ctx._activeDisplayMediaRequest = pending;
  pending.timer = setTimeout(() => {
    if (ctx._activeDisplayMediaRequest === pending) {
      resolveDisplayMediaRequest(ctx, { requestId, decision: 'cancel' });
    }
  }, DISPLAY_MEDIA_PICKER_TIMEOUT_MS);
  if (typeof pending.timer.unref === 'function') pending.timer.unref();

  try {
    let displayHost = origin;
    try {
      displayHost = new URL(origin).host || origin;
    } catch (_) {}

    // Desktop sources (screens + windows) with thumbnails.
    let rawSources = [];
    try {
      rawSources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true
      });
    } catch (_) {
      rawSources = [];
    }
    pending.sources = Array.isArray(rawSources) ? rawSources : [];
    const screens = [];
    const windows = [];
    for (const src of pending.sources) {
      if (!src || typeof src.id !== 'string') continue;
      const item = { id: src.id, name: src.name || src.id, thumbnail: thumbnailDataUrl(src.thumbnail) };
      if (src.id.startsWith('screen:')) screens.push(item);
      else windows.push(item);
    }

    // Open tabs in this window, with a best-effort live thumbnail each.
    const tabs = [];
    const order = Array.isArray(ctx.tabOrder) ? ctx.tabOrder : [];
    for (const tabId of order) {
      const tab = ctx.tabs ? ctx.tabs.get(tabId) : null;
      if (!tab || tab.sleeping) continue;
      let thumb = '';
      try {
        const wc = tab.view?.webContents;
        if (wc && typeof wc.capturePage === 'function' && !wc.isDestroyed()) {
          const img = await withTimeout(wc.capturePage(), 900);
          if (img && typeof img.resize === 'function') {
            thumb = thumbnailDataUrl(img.resize({ width: 320, height: 180 }));
          }
        }
      } catch (_) {}
      tabs.push({
        tabId: tab.id,
        title: tab.title || tab.url || 'Tab',
        url: tab.url || '',
        thumbnail: thumb
      });
    }
    pending.tabs = tabs;

    // The request may have been resolved (timeout / window close) while the
    // sources were being gathered; never open a picker for a dead request.
    if (ctx._activeDisplayMediaRequest !== pending) return;

    // Centre the picker over the content area (below the top chrome).
    const [cw, ch] = ctx.win.getContentSize();
    const pickerW = 640;
    const pickerH = 560;
    const topChrome = typeof TOP_CHROME_HEIGHT === 'number' ? TOP_CHROME_HEIGHT : 82;
    const x = Math.max(8, Math.round((cw - pickerW) / 2));
    const y = Math.max(
      topChrome,
      Math.round(topChrome + Math.max(0, ch - topChrome - pickerH) / 2)
    );

    popoversMod().openPopover(ctx, {
      kind: 'share-picker',
      x,
      y,
      width: pickerW,
      height: pickerH,
      payload: { requestId, origin, host: displayHost, screens, windows, tabs }
    });
  } catch (_) {
    resolveDisplayMediaRequest(ctx, { requestId, decision: 'cancel' });
  }
}

function resolveDisplayMediaRequest(ctx, { requestId, decision, source, tabAudio } = {}) {
  if (!ctx || !ctx._activeDisplayMediaRequest) return { ok: false };
  const pending = ctx._activeDisplayMediaRequest;
  if (requestId && pending.requestId !== requestId) return { ok: false };

  ctx._activeDisplayMediaRequest = null;
  if (pending.timer) {
    clearTimeout(pending.timer);
    pending.timer = null;
  }
  if (ctx.popoverOpenKind === 'share-picker') {
    try {
      popoversMod().closePopover(ctx, { restoreFocus: true });
    } catch (_) {}
  }

  let streams = {};
  if (decision === 'share' && source && typeof source === 'object') {
    try {
      if (source.kind === 'screen' || source.kind === 'window') {
        const src = (pending.sources || []).find((s) => s && s.id === source.id);
        // Window / Entire Screen are video-only: Chrome shows
        // "To share audio, share a tab instead." System-audio loopback is
        // Windows-only in Electron, so no audio is attached here.
        if (src) streams = { video: src };
      } else if (source.kind === 'tab') {
        const tab = ctx.tabs ? ctx.tabs.get(source.tabId) : null;
        const wc = tab?.view?.webContents;
        const frame =
          wc && typeof wc.isDestroyed === 'function' && !wc.isDestroyed() ? wc.mainFrame : null;
        if (frame) {
          streams = { video: frame };
          if (pending.audioRequested && tabAudio !== false) {
            streams.audio = frame;
            streams.enableLocalEcho = true;
          }
        }
      }
    } catch (_) {
      streams = {};
    }
  }

  try {
    pending.callback(streams);
  } catch (_) {}
  return { ok: true, shared: Boolean(streams.video), decision };
}

function cancelPendingDisplayMediaForWindow(ctx) {
  if (!ctx || !ctx._activeDisplayMediaRequest) return;
  const pending = ctx._activeDisplayMediaRequest;
  ctx._activeDisplayMediaRequest = null;
  if (pending.timer) {
    clearTimeout(pending.timer);
    pending.timer = null;
  }
  try {
    pending.callback({});
  } catch (_) {}
}

const configuredPermissionSessions = new WeakSet();

function setupPermissionsForSession(ses, profileId = 'default', { incognito = false } = {}) {
  ensureMediaIpcRegistered();

  // The permission prompt's own preview/enumeration runs in the popover view,
  // which lives on the default session. Make sure that session has these
  // handlers too (guarded: a profile session may be the default session
  // already, and test doubles have no usable defaultSession).
  try {
    if (ses && !configuredPermissionSessions.has(ses)) {
      configuredPermissionSessions.add(ses);
    }
    const electronMod = require('electron');
    const defaultSes = electronMod?.session?.defaultSession;
    if (
      defaultSes &&
      defaultSes !== ses &&
      !configuredPermissionSessions.has(defaultSes) &&
      typeof defaultSes.setPermissionCheckHandler === 'function'
    ) {
      configuredPermissionSessions.add(defaultSes);
      setupPermissionsForSession(defaultSes, 'default', {});
    }
  } catch (_) {}

  // NOTE (Chrome parity gap 1.1 / YouTube voice search): this check handler
  // can only answer true/false, so an undecided permission reports 'denied'
  // to navigator.permissions.query. Removing the handler was tried
  // (2026-11-23): Electron's default is worse — query then returns
  // 'granted' for undecided mic/camera/notifications. There is no way to
  // express Chrome's 'prompt' state through this boolean API, so the
  // handler stays; YouTube's voice-search pre-check is a known limitation.
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
    if (SAFE_AUTO_ALLOW_PERMISSIONS.has(permission)) return true;
    // Trusted internal UI: the permission prompt preview + device picker.
    if (isPopoverWebContents(wc) && isMediaPermission(permission)) return true;
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
    // Persisted decisions first, then this window's session grants
    // ("Allow this time" covers the rest of the visit).
    if (state.storage) {
      const stored = state.storage.getSitePermissions(origin, profileId);
      if (keys.some((k) => stored[k] === 'block')) return false;
      if (keys.every((k) => stored[k] === 'allow')) return true;
    }
    if (wc) {
      const winId = webContentsToWinId.get(wc.id);
      const ctx = winId ? windowContexts.get(winId) : null;
      if (ctx) {
        if (keys.some((k) => getSessionGrant(ctx, origin, k) === 'block')) return false;
        if (keys.every((k) => getSessionGrant(ctx, origin, k) === 'allow')) return true;
      }
    }
    return false;
  });

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (SAFE_AUTO_ALLOW_PERMISSIONS.has(permission)) {
      return callback(true);
    }
    // Trusted internal UI: the permission prompt preview + device picker.
    if (isPopoverWebContents(webContents) && isMediaPermission(permission)) {
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
    // [FIXUP-4] (gap 5.12) Per-permission defaults: a default of 'block'
    // denies the whole request WITHOUT prompting (Chromium's request
    // callback is a single boolean for all requested keys, so a partially
    // blocked request cannot be half-granted — same as the existing
    // stored-block early return above). Per-site explicit decisions
    // override the default: a stored 'allow' (normal windows only — a
    // private window never inherits persistent decisions) or this
    // window's session grant. 'ask' (or no default) keeps the prompt flow.
    const defaults = getSitePermissionDefaults(profileId);
    const defaultBlocked = keys.filter((k) => {
      if (defaults[k] !== 'block') return false;
      if (!incognito && stored[k] === 'allow') return false;
      if (ctx && getSessionGrant(ctx, origin, k) === 'allow') return false;
      return true;
    });
    if (defaultBlocked.length > 0) {
      return callback(false);
    }
    if (!incognito) {
      // s-2: persistent blocks apply to normal windows only; a private window
      // must not inherit the normal profile's decisions (it prompts instead).
      if (keys.some((k) => stored[k] === 'block')) {
        return callback(false);
      }
      if (keys.every((k) => stored[k] === 'allow')) {
        return callback(true);
      }
      // Session grants ("Allow this time") cover the rest of the visit.
      if (ctx) {
        if (keys.some((k) => getSessionGrant(ctx, origin, k) === 'block')) return callback(false);
        if (keys.every((k) => getSessionGrant(ctx, origin, k) === 'allow')) return callback(true);
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
      : keys.filter(
          (k) =>
            stored[k] !== 'allow' &&
            stored[k] !== 'block' &&
            getSessionGrant(ctx, origin, k) !== 'allow' &&
            getSessionGrant(ctx, origin, k) !== 'block'
        );
    if (pendingKeys.length === 0) {
      // Defensive: every key already has a decision (early checks above should
      // have caught this). Re-check grants instead of prompting.
      const granted = incognito
        ? keys.every((k) => getSessionGrant(ctx, origin, k) === 'allow')
        : keys.every((k) => stored[k] === 'allow' || getSessionGrant(ctx, origin, k) === 'allow');
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

  ses.setDisplayMediaRequestHandler((request, callback) => {
    handleDisplayMediaRequest(request, callback).catch(() => {
      try {
        callback({});
      } catch (_) {}
    });
  });
}

module.exports = {
  SAFE_AUTO_ALLOW_PERMISSIONS,
  resolvePermissionKeys,
  evaluatePermissionCheck,
  setupPermissionsForSession,
  resolvePermissionPrompt,
  onPermissionPopoverClosed,
  cancelPendingPermissionsForWindow,
  getPreferredDevices,
  setPreferredDevices,
  resolveDisplayMediaRequest,
  cancelPendingDisplayMediaForWindow
};
