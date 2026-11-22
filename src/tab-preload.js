const { contextBridge, ipcRenderer, webFrame } = require('electron');

function normalizeHost(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const input = raw.trim().toLowerCase();
  if (!input) return '';
  try {
    const u = new URL(input.includes('://') ? input : `https://${input}`);
    let host = u.hostname.toLowerCase().replace(/\.$/, '');
    if (!host || host.startsWith('.') || host.includes('..')) return '';
    if (/^www\.[^.]+\./.test(host)) {
      host = host.slice(4);
    }
    return host;
  } catch (_) {
    return '';
  }
}

function isIpAddress(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

function isAutofillHostMatch(pageHost, savedSite) {
  const current = normalizeHost(pageHost);
  const saved = normalizeHost(savedSite);
  if (!current || !saved) return false;
  if (current === saved) return true;
  if (isIpAddress(current) || isIpAddress(saved)) return false;
  if (!saved.includes('.')) return false;
  return current.endsWith(`.${saved}`);
}

const isFileTopFrame = window.location.protocol === 'file:' && window === window.top;
const internalPageKind = isFileTopFrame ? ipcRenderer.sendSync('internal:get-page-kind') : null;

if (internalPageKind === 'newtab') {
  contextBridge.exposeInMainWorld('gxNewTabAPI', {
    getInitialData: () => ipcRenderer.invoke('newtab:get-data'),
    navigate: (urlOrQuery) => ipcRenderer.invoke('tabs:navigate', urlOrQuery),
    addSpeedDial: (item) => ipcRenderer.invoke('newtab:add-dial', item),
    removeSpeedDial: (id) => ipcRenderer.invoke('newtab:remove-dial', id),
    sleepBackgroundTabs: () => ipcRenderer.invoke('tabs:sleep-background'),
    saveNote: (text) => ipcRenderer.invoke('notes:save', text),
    getSettings: () => ipcRenderer.invoke('settings:get'),
    updateSettings: (partial) => ipcRenderer.invoke('settings:update', partial),
    onSettingsUpdate: (cb) => ipcRenderer.on('settings:update', (_e, data) => cb(data)),
    onSystemStats: (cb) => ipcRenderer.on('system:stats-update', (_e, data) => cb(data)),
    saveCustomWallpaper: (payload) => ipcRenderer.invoke('newtab:save-wallpaper', payload),
    removeCustomWallpaper: () => ipcRenderer.invoke('newtab:remove-wallpaper'),
    getWallpaperImage: () => ipcRenderer.invoke('newtab:get-wallpaper-image')
  });
}

if (internalPageKind === 'webui') {
  contextBridge.exposeInMainWorld('gxChromePagesAPI', {
    navigate: (url) => ipcRenderer.invoke('tabs:navigate', url),
    createTab: (opts) => ipcRenderer.invoke('tabs:create', opts),
    // History
    getHistory: () => ipcRenderer.invoke('history:get'),
    clearHistory: (range) => ipcRenderer.invoke('history:clear', range),
    removeHistoryItem: (id) => ipcRenderer.invoke('history:remove', id),
    getClosedTabs: () => ipcRenderer.invoke('history:closed-get'),
    clearClosedTabs: () => ipcRenderer.invoke('history:closed-clear'),
    removeClosedTab: (id) => ipcRenderer.invoke('history:closed-remove', id),
    onHistoryUpdate: (cb) => ipcRenderer.on('history:update', (_e, data) => cb(data)),
    // Cookies
    getCookies: (filter) => ipcRenderer.invoke('cookies:get', filter),
    removeCookie: (urlOrObj, name) =>
      ipcRenderer.invoke(
        'cookies:remove',
        typeof urlOrObj === 'object' ? urlOrObj : { url: urlOrObj, name }
      ),
    clearSiteCookies: (originOrDomain) => ipcRenderer.invoke('cookies:clear-site', originOrDomain),
    clearAllCookies: () => ipcRenderer.invoke('cookies:clear-all'),
    onCookiesUpdate: (cb) => ipcRenderer.on('cookies:update', (_e, data) => cb(data)),
    // Pro Download Manager
    getDownloads: () => ipcRenderer.invoke('downloads:get'),
    pauseDownload: (id) => ipcRenderer.invoke('downloads:pause', id),
    resumeDownload: (id) => ipcRenderer.invoke('downloads:resume', id),
    cancelDownload: (id) => ipcRenderer.invoke('downloads:cancel', id),
    removeDownload: (id) => ipcRenderer.invoke('downloads:remove', id),
    clearDownloads: () => ipcRenderer.invoke('downloads:clear'),
    openDownloadItem: (savePath) => ipcRenderer.invoke('downloads:open', savePath),
    showDownloadInFolder: (savePath) => ipcRenderer.invoke('downloads:show-folder', savePath),
    onDownloadsUpdate: (cb) => ipcRenderer.on('downloads:update', (_e, data) => cb(data)),
    // Bookmarks
    getBookmarks: () => ipcRenderer.invoke('bookmarks:get'),
    toggleBookmark: () => ipcRenderer.invoke('bookmarks:toggle'),
    addBookmark: (entry) => ipcRenderer.invoke('bookmarks:add', entry),
    updateBookmark: (entry) => ipcRenderer.invoke('bookmarks:update', entry),
    removeBookmark: (id) => ipcRenderer.invoke('bookmarks:remove', id),
    renameBookmarkFolder: (oldName, newName) =>
      ipcRenderer.invoke('bookmarks:rename-folder', { oldName, newName }),
    onBookmarksUpdate: (cb) => ipcRenderer.on('bookmarks:update', (_e, data) => cb(data)),
    exportBookmarksHtml: () => ipcRenderer.invoke('import-export:bookmarks-export'),
    importBookmarksHtml: () => ipcRenderer.invoke('import-export:bookmarks-import'),
    // Passwords & Autofill
    getPasswords: () => ipcRenderer.invoke('passwords:get'),
    addPassword: (entry) => ipcRenderer.invoke('passwords:add', entry),
    updatePassword: (entry) => ipcRenderer.invoke('passwords:update', entry),
    removePassword: (id) => ipcRenderer.invoke('passwords:remove', id),
    generatePassword: (options) => ipcRenderer.invoke('passwords:generate', options),
    copyPassword: (id) =>
      ipcRenderer.invoke('passwords:copy', typeof id === 'object' && id !== null ? id : { id }),
    exportPasswordsCsv: () => ipcRenderer.invoke('import-export:passwords-export'),
    importPasswordsCsv: () => ipcRenderer.invoke('import-export:passwords-import'),
    onPasswordsUpdate: (cb) => ipcRenderer.on('passwords:update', (_e, data) => cb(data)),
    // Privacy & Security Dashboard + Site Permissions
    getPrivacyDashboard: () => ipcRenderer.invoke('privacy:get-dashboard'),
    getSitePermissions: (origin) => ipcRenderer.invoke('permissions:get', origin),
    setSitePermission: (origin, key, value) => ipcRenderer.invoke('permissions:set', { origin, key, value }),
    clearSitePermission: (origin, key) =>
      ipcRenderer.invoke(
        'privacy:clear-site-permission',
        typeof origin === 'object' && origin !== null ? origin : { origin, key }
      ),
    onPermissionsUpdate: (cb) => ipcRenderer.on('permissions:update', (_e, data) => cb(data)),
    // Profiles (Local Only)
    listProfiles: () => ipcRenderer.invoke('profiles:list'),
    getActiveProfile: () => ipcRenderer.invoke('profiles:get-active'),
    createProfile: (payload) => ipcRenderer.invoke('profiles:create', payload),
    renameProfile: (id, payload) =>
      ipcRenderer.invoke(
        'profiles:rename',
        typeof id === 'object' && id !== null
          ? id
          : { id, ...(typeof payload === 'string' ? { name: payload } : payload || {}) }
      ),
    deleteProfile: (id) => ipcRenderer.invoke('profiles:delete', id),
    switchProfile: (id) => ipcRenderer.invoke('profiles:switch', id),
    onProfilesUpdate: (cb) => ipcRenderer.on('profiles:update', (_e, data) => cb(data)),
    // Extensions
    getExtensions: () => ipcRenderer.invoke('extensions:list'),
    loadUnpackedExtension: () => ipcRenderer.invoke('extensions:load-unpacked'),
    toggleExtension: (id, enabled) =>
      ipcRenderer.invoke(
        'extensions:toggle',
        typeof id === 'object' && id !== null ? id : { id, enabled }
      ),
    reloadExtension: (id) => ipcRenderer.invoke('extensions:reload', id),
    removeExtension: (id) => ipcRenderer.invoke('extensions:remove', id),
    // Settings, AdBlocker, Cleaner & Performance
    getSettings: () => ipcRenderer.invoke('settings:get'),
    updateSettings: (partial) => ipcRenderer.invoke('settings:update', partial),
    exportSettingsJson: () => ipcRenderer.invoke('import-export:settings-export'),
    importSettingsJson: () => ipcRenderer.invoke('import-export:settings-import'),
    onSettingsUpdate: (cb) => ipcRenderer.on('settings:update', (_e, data) => cb(data)),
    getAdblockStats: () => ipcRenderer.invoke('adblock:stats'),
    toggleAdblock: (enabled) => ipcRenderer.invoke('adblock:toggle', enabled),
    toggleTrackerBlock: (enabled) => ipcRenderer.invoke('adblock:toggle-trackers', enabled),
    getAdblockSite: (origin) => ipcRenderer.invoke('adblock:get-site', origin),
    setAdblockSite: (origin, enabled) =>
      ipcRenderer.invoke(
        'adblock:set-site',
        typeof origin === 'object' && origin !== null ? origin : { origin, enabled }
      ),
    getAdblockSites: () => ipcRenderer.invoke('adblock:get-sites'),
    onAdblockUpdate: (cb) => ipcRenderer.on('adblock:update', (_e, data) => cb(data)),
    onPageShown: (cb) => ipcRenderer.on('webui:shown', () => cb()),
    getSystemStats: () => ipcRenderer.invoke('system:stats'),
    sleepBackgroundTabs: () => ipcRenderer.invoke('tabs:sleep-background'),
    clearBrowsingData: (opts) => ipcRenderer.invoke('cleaner:run', opts)
  });
}

if (internalPageKind === 'error') {
  contextBridge.exposeInMainWorld('gxErrorPageAPI', {
    retry: (url) => ipcRenderer.invoke('tabs:retry-failed', url),
    goBack: () => ipcRenderer.invoke('tabs:back'),
    goHome: () => ipcRenderer.invoke('tabs:home'),
    getSettings: () => ipcRenderer.invoke('settings:get'),
    onSettingsUpdate: (cb) => ipcRenderer.on('settings:update', (_e, data) => cb(data))
  });
}

if (internalPageKind === 'player') {
  contextBridge.exposeInMainWorld('gxPlayerAPI', {
    getState: () => ipcRenderer.invoke('player:get-state'),
    control: (payload) => ipcRenderer.invoke('player:control', payload),
    popOutVideo: (tabId) => ipcRenderer.invoke('video:pop-out', tabId),
    openSidebarService: (serviceKey) => ipcRenderer.invoke('sidebar:open', serviceKey),
    getSettings: () => ipcRenderer.invoke('settings:get'),
    onUpdate: (cb) => ipcRenderer.on('player:update', (_e, data) => cb(data)),
    onSettingsUpdate: (cb) => ipcRenderer.on('settings:update', (_e, data) => cb(data))
  });
}

// Media Observer (Video Pop-Out PiP + Sidebar Player MediaSession & Element Sync)
(function initMediaObserver() {
  if (window !== window.top || internalPageKind) return;
  const proto = window.location.protocol;
  if (proto !== 'http:' && proto !== 'https:' && proto !== 'file:') return;

  function makeRandomToken() {
    try {
      const bytes = new Uint8Array(12);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    } catch (_) {
      return Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
  }

  const MS_TOKEN = makeRandomToken();
  const MS_SYM_KEY = `__nx_ms_${MS_TOKEN}`;
  const MS_EVT_NAME = `__nx_ms_evt_${MS_TOKEN}`;
  let mainWorldHookInstalled = false;
  let mainWorldHookPromise = null;

  function buildMainWorldMediaSessionHook(symKey, evtName) {
    return `(() => {
      try {
        const sym = Symbol.for(${JSON.stringify(symKey)});
        if (window[sym]) return true;
        const handlers = Object.create(null);
        const KNOWN_ACTIONS = ['play', 'pause', 'nexttrack', 'previoustrack', 'seekto', 'seekbackward', 'seekforward'];
        const notify = () => {
          try { window.dispatchEvent(new Event(${JSON.stringify(evtName)})); } catch (_) {}
        };
        const ms = navigator && navigator.mediaSession;
        if (ms) {
          const proto = Object.getPrototypeOf(ms) || (typeof MediaSession !== 'undefined' ? MediaSession.prototype : null);
          if (proto && typeof proto.setActionHandler === 'function') {
            const origSet = proto.setActionHandler;
            proto.setActionHandler = function(action, handler) {
              const res = origSet.call(this, action, handler);
              try {
                if (typeof action === 'string') {
                  if (typeof handler === 'function') handlers[action] = handler;
                  else delete handlers[action];
                  notify();
                }
              } catch (_) {}
              return res;
            };
          }
          if (proto) {
            const metaDesc = Object.getOwnPropertyDescriptor(proto, 'metadata');
            if (metaDesc && metaDesc.configurable && typeof metaDesc.set === 'function') {
              Object.defineProperty(proto, 'metadata', {
                configurable: true,
                enumerable: metaDesc.enumerable,
                get: metaDesc.get,
                set: function(val) {
                  metaDesc.set.call(this, val);
                  notify();
                }
              });
            }
          }
        }
        const api = {
          getState() {
            const curMs = navigator && navigator.mediaSession;
            const md = curMs && curMs.metadata;
            const artwork = [];
            if (md && Array.isArray(md.artwork)) {
              for (let i = 0; i < Math.min(md.artwork.length, 12); i++) {
                const a = md.artwork[i];
                if (a && typeof a.src === 'string') {
                  artwork.push({
                    src: a.src,
                    sizes: typeof a.sizes === 'string' ? a.sizes : '',
                    type: typeof a.type === 'string' ? a.type : ''
                  });
                }
              }
            }
            const actions = {};
            for (const act of KNOWN_ACTIONS) {
              actions[act] = typeof handlers[act] === 'function';
            }
            return {
              title: md && typeof md.title === 'string' ? md.title : '',
              artist: md && typeof md.artist === 'string' ? md.artist : '',
              album: md && typeof md.album === 'string' ? md.album : '',
              artwork,
              playbackState: curMs && typeof curMs.playbackState === 'string' ? curMs.playbackState : 'none',
              actions
            };
          },
          invoke(action, seekTime) {
            const fn = typeof action === 'string' ? handlers[action] : null;
            if (typeof fn !== 'function') {
              return { ok: false, invoked: false, error: 'No handler registered' };
            }
            try {
              const details = action === 'seekto' && typeof seekTime === 'number' && Number.isFinite(seekTime)
                ? { action: 'seekto', seekTime, fastSeek: false }
                : { action };
              fn(details);
              return { ok: true, invoked: true };
            } catch (e) {
              return { ok: false, invoked: false, error: e && e.message ? String(e.message) : 'Handler error' };
            }
          }
        };
        Object.defineProperty(window, sym, {
          value: api,
          enumerable: false,
          configurable: true,
          writable: false
        });
        if (ms && (ms.metadata || (ms.playbackState && ms.playbackState !== 'none'))) {
          notify();
        }
        return true;
      } catch (_) {
        return false;
      }
    })()`;
  }

  // R-15: Dispatch the main-world MediaSession hook at the earliest safe point in the
  // preload (before defining the rest of the media observer or awaiting DOM events).
  // Note on residual limitation: DOM <script> tag injection cannot be used because it
  // violates page CSP, and Chromium/Blink's MediaSession API provides no getter or
  // enumeration mechanism for already-registered action handlers (calling setActionHandler
  // with a no-op probe would destructively overwrite any existing handler). If a page
  // registers nexttrack/previoustrack synchronously before webFrame.executeJavaScript
  // runs and never re-registers them, those handlers cannot be discovered retroactively
  // (metadata is still recovered via readDirectMediaSessionFallback).
  if (webFrame && typeof webFrame.executeJavaScript === 'function') {
    try {
      mainWorldHookPromise = webFrame
        .executeJavaScript(buildMainWorldMediaSessionHook(MS_SYM_KEY, MS_EVT_NAME))
        .then((ok) => {
          mainWorldHookInstalled = Boolean(ok);
          return mainWorldHookInstalled;
        })
        .catch(() => false);
    } catch (_) {}
  }

  const STATE_DEBOUNCE_MS = 120;
  const TIMEUPDATE_THROTTLE_MS = 1000;
  const MUTATION_COALESCE_MS = 300;
  const MAX_DATA_ARTWORK_LEN = 512 * 1024;

  const trackedMedia = new Set();
  const mediaMeta = new WeakMap();
  const observedDocs = new WeakSet();

  let stateDebounceTimer = null;
  let mutationTimer = null;
  let lastTimeReportAt = 0;
  let lastReportSig = '';
  let hasEverPlayedInDoc = false;
  let msPullInFlight = false;
  let msPullQueued = false;

  let cachedMediaSession = {
    title: '',
    artist: '',
    album: '',
    artwork: '',
    playbackState: 'none',
    actions: {
      play: false,
      pause: false,
      nexttrack: false,
      previoustrack: false,
      seekto: false
    }
  };

  function sanitizeArtworkSrc(rawSrc) {
    if (typeof rawSrc !== 'string') return '';
    const trimmed = rawSrc.trim();
    if (!trimmed) return '';
    if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=]+$/i.test(trimmed)) {
      return trimmed.length <= MAX_DATA_ARTWORK_LEN ? trimmed : '';
    }
    try {
      const resolved = new URL(trimmed, window.location.href);
      if (resolved.protocol === 'https:' || resolved.protocol === 'http:') {
        const str = resolved.toString();
        return str.length <= 2048 ? str : '';
      }
    } catch (_) {}
    return '';
  }

  function pickBestArtwork(artworkList) {
    if (!Array.isArray(artworkList) || artworkList.length === 0) return '';
    let bestUrl = '';
    let bestScore = -1;
    for (const item of artworkList) {
      if (!item || typeof item.src !== 'string') continue;
      const safe = sanitizeArtworkSrc(item.src);
      if (!safe) continue;
      let dim = 0;
      if (typeof item.sizes === 'string') {
        const m = item.sizes.match(/(\d+)\s*x\s*(\d+)/i);
        if (m) dim = Math.max(Number(m[1]) || 0, Number(m[2]) || 0);
      }
      // Prefer crisp medium-large artwork (~256-512px) over tiny 64px or huge 4K images
      const score = dim > 0 ? (dim <= 512 ? dim : Math.max(100, 1024 - dim / 4)) : 180;
      if (score > bestScore) {
        bestScore = score;
        bestUrl = safe;
      }
    }
    return bestUrl;
  }

  function applyMediaSessionSnapshot(snap) {
    if (!snap || typeof snap !== 'object') return;
    cachedMediaSession = {
      title: typeof snap.title === 'string' ? snap.title.trim().slice(0, 200) : '',
      artist: typeof snap.artist === 'string' ? snap.artist.trim().slice(0, 160) : '',
      album: typeof snap.album === 'string' ? snap.album.trim().slice(0, 160) : '',
      artwork: pickBestArtwork(snap.artwork),
      playbackState: typeof snap.playbackState === 'string' ? snap.playbackState : 'none',
      actions: {
        play: Boolean(snap.actions?.play),
        pause: Boolean(snap.actions?.pause),
        nexttrack: Boolean(snap.actions?.nexttrack),
        previoustrack: Boolean(snap.actions?.previoustrack),
        seekto: Boolean(snap.actions?.seekto)
      }
    };
  }

  function readDirectMediaSessionFallback() {
    try {
      const md = navigator?.mediaSession?.metadata;
      if (!md) return;
      const artwork = Array.isArray(md.artwork)
        ? md.artwork.map((a) => ({ src: a?.src || '', sizes: a?.sizes || '', type: a?.type || '' }))
        : [];
      if (md.title || md.artist || md.album || artwork.length) {
        cachedMediaSession = {
          ...cachedMediaSession,
          title: typeof md.title === 'string' ? md.title.trim().slice(0, 200) : cachedMediaSession.title,
          artist: typeof md.artist === 'string' ? md.artist.trim().slice(0, 160) : cachedMediaSession.artist,
          album: typeof md.album === 'string' ? md.album.trim().slice(0, 160) : cachedMediaSession.album,
          artwork: pickBestArtwork(artwork) || cachedMediaSession.artwork
        };
      }
    } catch (_) {}
  }

  async function pullMediaSessionState() {
    if (!mainWorldHookInstalled && mainWorldHookPromise) {
      try {
        await mainWorldHookPromise;
      } catch (_) {}
    }
    if (!mainWorldHookInstalled || !webFrame || typeof webFrame.executeJavaScript !== 'function') {
      readDirectMediaSessionFallback();
      return;
    }
    if (msPullInFlight) {
      msPullQueued = true;
      return;
    }
    msPullInFlight = true;
    try {
      const snap = await webFrame.executeJavaScript(
        `window[Symbol.for(${JSON.stringify(MS_SYM_KEY)})]?.getState?.() || null`
      );
      if (snap) applyMediaSessionSnapshot(snap);
      else readDirectMediaSessionFallback();
    } catch (_) {
      readDirectMediaSessionFallback();
    } finally {
      msPullInFlight = false;
      if (msPullQueued) {
        msPullQueued = false;
        pullMediaSessionState().then(() => scheduleStateReport());
      }
    }
  }

  async function invokeMediaSessionAction(action, seekTime) {
    if (!mainWorldHookInstalled && mainWorldHookPromise) {
      try {
        await mainWorldHookPromise;
      } catch (_) {}
    }
    if (!mainWorldHookInstalled || !webFrame || typeof webFrame.executeJavaScript !== 'function') {
      return { ok: false, invoked: false, error: 'MediaSession bridge unavailable' };
    }
    try {
      const code = `window[Symbol.for(${JSON.stringify(MS_SYM_KEY)})]?.invoke?.(${JSON.stringify(
        action
      )}, ${typeof seekTime === 'number' && Number.isFinite(seekTime) ? seekTime : 'undefined'}) || { ok: false, invoked: false }`;
      const res = await webFrame.executeJavaScript(code, true);
      return res && typeof res === 'object' ? res : { ok: false, invoked: false };
    } catch (err) {
      return { ok: false, invoked: false, error: err?.message || 'Invoke failed' };
    }
  }

  window.addEventListener(MS_EVT_NAME, () => {
    pullMediaSessionState().then(() => scheduleStateReport());
  });

  function isMediaElement(el) {
    return Boolean(el && (el.tagName === 'VIDEO' || el.tagName === 'AUDIO'));
  }

  function isElementPlaying(el) {
    if (!isMediaElement(el)) return false;
    return !el.paused && !el.ended && (el.readyState >= 2 || el.currentTime > 0);
  }

  function isVideoEligiblePlaying(v) {
    if (!v || v.tagName !== 'VIDEO') return false;
    if (v.paused || v.ended) return false;
    if (v.readyState < 1) return false;
    return v.videoWidth > 0 && v.videoHeight > 0;
  }

  function touchMediaMeta(el, { played = false } = {}) {
    if (!isMediaElement(el)) return;
    trackedMedia.add(el);
    const existing = mediaMeta.get(el) || { lastPlayedAt: 0, everPlayed: false };
    if (played) {
      existing.lastPlayedAt = Date.now();
      existing.everPlayed = true;
      hasEverPlayedInDoc = true;
    }
    mediaMeta.set(el, existing);
  }

  function getMediaDocs() {
    const docs = [document];
    try {
      const iframes = document.querySelectorAll('iframe');
      for (let i = 0; i < Math.min(iframes.length, 20); i++) {
        try {
          const idoc = iframes[i].contentDocument;
          if (idoc) docs.push(idoc);
        } catch (_) {}
      }
    } catch (_) {}
    return docs;
  }

  function collectMediaRoots(root, out, depth = 0) {
    if (!root || depth > 4) return;
    out.push(root);
    try {
      const els = root.querySelectorAll('*');
      for (let i = 0; i < Math.min(els.length, 250); i++) {
        if (els[i].shadowRoot) {
          collectMediaRoots(els[i].shadowRoot, out, depth + 1);
        }
      }
    } catch (_) {}
  }

  function collectAllMediaElements() {
    for (const el of Array.from(trackedMedia)) {
      if (!el) {
        trackedMedia.delete(el);
        continue;
      }
      // Keep disconnected elements only if they are actively playing (e.g. detached Audio)
      if (!el.isConnected && (el.paused || el.ended)) {
        trackedMedia.delete(el);
      }
    }
    const roots = [];
    for (const doc of getMediaDocs()) {
      collectMediaRoots(doc, roots, 0);
    }
    for (const root of roots) {
      try {
        const found = root.querySelectorAll('video, audio');
        for (let i = 0; i < Math.min(found.length, 64); i++) {
          trackedMedia.add(found[i]);
        }
      } catch (_) {}
    }
    return Array.from(trackedMedia);
  }

  function getElementArea(el) {
    try {
      const rect = el.getBoundingClientRect();
      const rendered = rect.width * rect.height;
      if (rendered > 0) return rendered;
    } catch (_) {}
    if (el.tagName === 'VIDEO') {
      return (el.videoWidth || 0) * (el.videoHeight || 0);
    }
    return 0;
  }

  function getBestPlayingVideo(list) {
    const candidates = (list || collectAllMediaElements()).filter((el) => isVideoEligiblePlaying(el));
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      const aDis = a.disablePictureInPicture ? 1 : 0;
      const bDis = b.disablePictureInPicture ? 1 : 0;
      if (aDis !== bDis) return aDis - bDis;
      const aPlayed = mediaMeta.get(a)?.lastPlayedAt || 0;
      const bPlayed = mediaMeta.get(b)?.lastPlayedAt || 0;
      if (Math.abs(aPlayed - bPlayed) > 1500) return bPlayed - aPlayed;
      return getElementArea(b) - getElementArea(a);
    });
    return candidates[0];
  }

  function getPrimaryMediaElement(list) {
    const all = list || collectAllMediaElements();
    if (all.length === 0) return null;
    const playing = all.filter((el) => isElementPlaying(el));
    if (playing.length > 0) {
      playing.sort((a, b) => {
        const aAud = !a.muted && a.volume > 0 ? 1 : 0;
        const bAud = !b.muted && b.volume > 0 ? 1 : 0;
        if (aAud !== bAud) return bAud - aAud;
        const aPlayed = mediaMeta.get(a)?.lastPlayedAt || 0;
        const bPlayed = mediaMeta.get(b)?.lastPlayedAt || 0;
        if (Math.abs(aPlayed - bPlayed) > 1500) return bPlayed - aPlayed;
        return getElementArea(b) - getElementArea(a);
      });
      return playing[0];
    }

    const previouslyPlayed = all.filter(
      (el) => (mediaMeta.get(el)?.everPlayed || el.currentTime > 0) && el.readyState >= 1
    );
    if (previouslyPlayed.length === 0) return null;
    previouslyPlayed.sort((a, b) => {
      const aPlayed = mediaMeta.get(a)?.lastPlayedAt || 0;
      const bPlayed = mediaMeta.get(b)?.lastPlayedAt || 0;
      return bPlayed - aPlayed;
    });
    return previouslyPlayed[0];
  }

  function getActivePipInfo() {
    for (const doc of getMediaDocs()) {
      try {
        if (doc.pictureInPictureElement) {
          let el = doc.pictureInPictureElement;
          while (el?.shadowRoot?.pictureInPictureElement) el = el.shadowRoot.pictureInPictureElement;
          return { doc, element: el };
        }
      } catch (_) {}
    }
    return null;
  }

  function extractElementTitle(el) {
    if (!el) return '';
    const attrTitle = el.getAttribute?.('title') || el.getAttribute?.('aria-label') || '';
    if (attrTitle && attrTitle.trim()) return attrTitle.trim().slice(0, 200);
    const docTitle = document.title ? document.title.trim() : '';
    if (docTitle) return docTitle.slice(0, 200);
    const src = el.currentSrc || el.src || '';
    if (src && !src.startsWith('blob:') && !src.startsWith('data:')) {
      try {
        const u = new URL(src, window.location.href);
        const seg = decodeURIComponent(u.pathname.split('/').pop() || '');
        if (seg) return seg.slice(0, 160);
      } catch (_) {}
    }
    return '';
  }

  function extractSafeSrc(el) {
    const raw = el?.currentSrc || el?.src || '';
    if (!raw || raw.startsWith('data:')) return '';
    if (raw.startsWith('blob:')) return raw.slice(0, 120);
    try {
      const u = new URL(raw, window.location.href);
      return `${u.origin}${u.pathname}`.slice(0, 300);
    } catch (_) {
      return '';
    }
  }

  function buildMediaReportPayload() {
    const all = collectAllMediaElements();
    const bestVideo = getBestPlayingVideo(all);
    const primary = getPrimaryMediaElement(all);
    const pipInfo = getActivePipInfo();

    const hasPlayingVideo = Boolean(bestVideo);
    const pipActive = Boolean(pipInfo);
    const hasMediaElement = Boolean(primary);
    const isPlaying = primary
      ? isElementPlaying(primary)
      : cachedMediaSession.playbackState === 'playing';
    const ended = Boolean(primary && primary.ended);
    const rawDur = primary ? primary.duration : NaN;
    const isLive = Boolean(primary && rawDur === Infinity);
    const duration =
      primary && Number.isFinite(rawDur) && rawDur > 0 ? rawDur : null;
    const currentTime =
      primary && Number.isFinite(primary.currentTime) && primary.currentTime >= 0
        ? primary.currentTime
        : 0;

    const title = cachedMediaSession.title || extractElementTitle(primary || bestVideo);
    const artist = cachedMediaSession.artist || '';
    const album = cachedMediaSession.album || '';
    const artwork = cachedMediaSession.artwork || '';

    return {
      hasPlayingVideo,
      pipActive,
      videoTitle: bestVideo ? (cachedMediaSession.title || extractElementTitle(bestVideo)) : '',
      videoSrc: bestVideo ? extractSafeSrc(bestVideo) : '',
      hasMediaElement,
      mediaKind: primary ? (primary.tagName === 'VIDEO' ? 'video' : 'audio') : null,
      isPlaying,
      ended,
      isLive,
      currentTime,
      duration,
      playbackRate: primary && Number.isFinite(primary.playbackRate) ? primary.playbackRate : 1,
      volume: primary && Number.isFinite(primary.volume) ? primary.volume : 1,
      muted: Boolean(primary && primary.muted),
      title,
      artist,
      album,
      artwork,
      supportedActions: { ...cachedMediaSession.actions }
    };
  }

  function sendMediaReportNow({ force = false } = {}) {
    if (stateDebounceTimer) {
      clearTimeout(stateDebounceTimer);
      stateDebounceTimer = null;
    }
    const payload = buildMediaReportPayload();
    if (!hasEverPlayedInDoc && !payload.hasPlayingVideo && !payload.pipActive && !payload.isPlaying && !lastReportSig) {
      return;
    }
    const roundedTime = payload.isPlaying ? Math.floor(payload.currentTime) : Math.round(payload.currentTime * 2) / 2;
    const sig = JSON.stringify({
      ...payload,
      currentTime: roundedTime
    });
    if (!force && sig === lastReportSig) return;
    lastReportSig = sig;
    lastTimeReportAt = Date.now();
    try {
      ipcRenderer.send('media:report', payload);
    } catch (_) {}
  }

  function scheduleStateReport({ immediate = false } = {}) {
    if (immediate) {
      sendMediaReportNow({ force: true });
      return;
    }
    if (stateDebounceTimer) clearTimeout(stateDebounceTimer);
    stateDebounceTimer = setTimeout(() => {
      stateDebounceTimer = null;
      sendMediaReportNow();
    }, STATE_DEBOUNCE_MS);
  }

  function handleMediaDomEvent(e) {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : null;
    const target = (path && path.length > 0 ? path[0] : e.target);
    if (!isMediaElement(target)) return;

    const type = e.type;
    if (type === 'play' || type === 'playing') {
      touchMediaMeta(target, { played: true });
      pullMediaSessionState().then(() => scheduleStateReport());
      return;
    }

    if (type === 'timeupdate') {
      if (!isElementPlaying(target)) return;
      touchMediaMeta(target, { played: false });
      if (Date.now() - lastTimeReportAt >= TIMEUPDATE_THROTTLE_MS) {
        sendMediaReportNow();
      }
      return;
    }

    touchMediaMeta(target, { played: false });
    if (type === 'enterpictureinpicture' || type === 'leavepictureinpicture') {
      scheduleStateReport({ immediate: true });
      return;
    }
    scheduleStateReport();
  }

  const MEDIA_EVENTS = [
    'play',
    'playing',
    'pause',
    'ended',
    'timeupdate',
    'durationchange',
    'loadedmetadata',
    'resize',
    'seeked',
    'emptied',
    'volumechange',
    'ratechange',
    'enterpictureinpicture',
    'leavepictureinpicture'
  ];

  function attachDocMediaListeners(doc) {
    if (!doc || observedDocs.has(doc)) return;
    observedDocs.add(doc);
    for (const ev of MEDIA_EVENTS) {
      try {
        doc.addEventListener(ev, handleMediaDomEvent, true);
      } catch (_) {}
    }
  }

  function scanExistingMediaAndFrames() {
    attachDocMediaListeners(document);
    const roots = [];
    for (const doc of getMediaDocs()) {
      collectMediaRoots(doc, roots, 0);
    }
    for (const root of roots) {
      attachDocMediaListeners(root);
      try {
        root.querySelectorAll('video, audio').forEach((el) => {
          const playing = isElementPlaying(el);
          touchMediaMeta(el, { played: playing });
        });
      } catch (_) {}
    }
  }

  function nodeMayContainMedia(node) {
    if (!node || node.nodeType !== 1) return false;
    const tag = node.tagName;
    if (tag === 'VIDEO' || tag === 'AUDIO' || tag === 'IFRAME') return true;
    if (typeof node.querySelector === 'function') {
      try {
        return Boolean(node.querySelector('video, audio, iframe'));
      } catch (_) {}
    }
    return false;
  }

  function scheduleMutationScan() {
    if (mutationTimer) return;
    mutationTimer = setTimeout(() => {
      mutationTimer = null;
      scanExistingMediaAndFrames();
      scheduleStateReport();
    }, MUTATION_COALESCE_MS);
  }

  attachDocMediaListeners(document);

  window.addEventListener('DOMContentLoaded', () => {
    scanExistingMediaAndFrames();
    pullMediaSessionState().then(() => scheduleStateReport());

    if (document.documentElement && typeof MutationObserver === 'function') {
      try {
        const obs = new MutationObserver((mutations) => {
          let relevant = false;
          for (let i = 0; i < mutations.length && !relevant; i++) {
            const m = mutations[i];
            for (let j = 0; j < m.addedNodes.length; j++) {
              if (nodeMayContainMedia(m.addedNodes[j])) {
                relevant = true;
                break;
              }
            }
            if (!relevant && trackedMedia.size > 0) {
              for (let j = 0; j < m.removedNodes.length; j++) {
                if (nodeMayContainMedia(m.removedNodes[j])) {
                  relevant = true;
                  break;
                }
              }
            }
          }
          if (relevant) scheduleMutationScan();
        });
        obs.observe(document.documentElement, { childList: true, subtree: true });
      } catch (_) {}
    }
  });

  window.addEventListener('load', () => {
    scanExistingMediaAndFrames();
    pullMediaSessionState().then(() => scheduleStateReport());
  });

  window.addEventListener('pagehide', () => {
    if (lastReportSig) {
      lastReportSig = '';
      try {
        ipcRenderer.send('media:report', { cleared: true });
      } catch (_) {}
    }
  });

  async function handlePipCommand() {
    scanExistingMediaAndFrames();
    const pipInfo = getActivePipInfo();
    const bestVideo = getBestPlayingVideo();

    if (pipInfo) {
      let el = pipInfo.element;
      while (el?.shadowRoot?.pictureInPictureElement) el = el.shadowRoot.pictureInPictureElement;
      if (bestVideo && bestVideo !== el && !bestVideo.disablePictureInPicture) {
        try {
          await bestVideo.requestPictureInPicture();
          sendMediaReportNow({ force: true });
          return { ok: true, active: true };
        } catch (err) {
          return { ok: false, errorName: err?.name || 'Error', error: err?.message || 'Picture-in-Picture failed' };
        }
      }
      try {
        await pipInfo.doc.exitPictureInPicture();
        sendMediaReportNow({ force: true });
        return { ok: true, active: false };
      } catch (err) {
        return { ok: false, errorName: err?.name || 'Error', error: err?.message || 'Failed to exit Picture-in-Picture' };
      }
    }

    if (!document.pictureInPictureEnabled) {
      return { ok: false, errorName: 'NotSupportedError', error: 'Picture-in-Picture is not supported on this page' };
    }
    if (!bestVideo) {
      return { ok: false, errorName: 'NoVideo', error: 'No playing video found to pop out' };
    }
    if (bestVideo.disablePictureInPicture) {
      return { ok: false, errorName: 'InvalidStateError', error: 'This video does not allow Picture-in-Picture' };
    }

    try {
      await bestVideo.requestPictureInPicture();
      sendMediaReportNow({ force: true });
      return { ok: true, active: true };
    } catch (err) {
      return { ok: false, errorName: err?.name || 'Error', error: err?.message || 'Picture-in-Picture failed' };
    }
  }

  async function handleControlCommand(cmd) {
    scanExistingMediaAndFrames();
    await pullMediaSessionState();

    const action = cmd.action;
    const el = getPrimaryMediaElement();

    if (action === 'play' || action === 'pause') {
      const hasMs = Boolean(cachedMediaSession.actions[action]);
      if (hasMs) {
        await invokeMediaSessionAction(action);
        if (el) {
          await new Promise((r) => setTimeout(r, 60));
          if (action === 'pause' && !el.paused) {
            try { el.pause(); } catch (_) {}
          } else if (action === 'play' && el.paused) {
            try { await el.play(); } catch (_) {}
          }
        }
      } else if (el) {
        try {
          if (action === 'pause') el.pause();
          else await el.play();
        } catch (err) {
          return { ok: false, error: err?.message || `Failed to ${action}` };
        }
      } else {
        return { ok: false, error: 'No controllable media element found' };
      }
      sendMediaReportNow({ force: true });
      return {
        ok: true,
        isPlaying: el ? isElementPlaying(el) : action === 'play',
        currentTime: el && Number.isFinite(el.currentTime) ? el.currentTime : 0
      };
    }

    if (action === 'next' || action === 'previous') {
      const msAction = action === 'next' ? 'nexttrack' : 'previoustrack';
      if (!cachedMediaSession.actions[msAction]) {
        return { ok: false, error: `${action === 'next' ? 'Next' : 'Previous'} track not supported by this page` };
      }
      const res = await invokeMediaSessionAction(msAction);
      setTimeout(() => {
        pullMediaSessionState().then(() => sendMediaReportNow({ force: true }));
      }, 180);
      return { ok: Boolean(res?.ok && res?.invoked), error: res?.error || '' };
    }

    if (action === 'seek') {
      const rawSeek = Number(cmd.seekTime);
      if (!Number.isFinite(rawSeek) || rawSeek < 0) {
        return { ok: false, error: 'Invalid seek time' };
      }
      const hasFiniteDuration = Boolean(el && Number.isFinite(el.duration) && el.duration > 0);
      const targetTime = hasFiniteDuration ? Math.max(0, Math.min(el.duration, rawSeek)) : rawSeek;

      if (cachedMediaSession.actions.seekto) {
        await invokeMediaSessionAction('seekto', targetTime);
        if (el && hasFiniteDuration && Math.abs(el.currentTime - targetTime) > 1.5) {
          try { el.currentTime = targetTime; } catch (_) {}
        }
      } else if (el && hasFiniteDuration) {
        try {
          el.currentTime = targetTime;
        } catch (err) {
          return { ok: false, error: err?.message || 'Failed to seek' };
        }
      } else {
        return { ok: false, error: 'Media is not seekable' };
      }
      sendMediaReportNow({ force: true });
      return {
        ok: true,
        currentTime: el && Number.isFinite(el.currentTime) ? el.currentTime : targetTime
      };
    }

    return { ok: false, error: `Unsupported command action: ${action}` };
  }

  ipcRenderer.on('player:command', async (_e, cmd) => {
    if (!cmd || typeof cmd !== 'object' || typeof cmd.requestId !== 'string') return;
    let result = { ok: false, error: 'Unknown command' };
    try {
      if (cmd.command === 'pip') {
        result = await handlePipCommand();
      } else if (cmd.command === 'control') {
        result = await handleControlCommand(cmd);
      }
    } catch (err) {
      result = { ok: false, error: err?.message || 'Command error' };
    }
    try {
      ipcRenderer.send('player:command-result', { requestId: cmd.requestId, ...result });
    } catch (_) {}
  });
})();

// Automatic Website Password Autofill & Save Engine
window.addEventListener('DOMContentLoaded', async () => {
  if (!/^https?:$/i.test(window.location.protocol)) return;
  const host = normalizeHost(window.location.hostname);
  if (!host) return;

  try {
    const passwords = await ipcRenderer.invoke('autofill:get');
    const matched = (passwords || []).filter(
      (p) => p && p.site && isAutofillHostMatch(host, p.site)
    );

    const fillForms = () => {
      const passInputs = document.querySelectorAll('input[type="password"]');
      passInputs.forEach((pwInput) => {
        if (pwInput.dataset.gxAutofillBound) return;
        pwInput.dataset.gxAutofillBound = '1';

        const form = pwInput.closest('form') || document.body;
        const userInput = form.querySelector(
          'input[type="email"], input[type="text"][name*="user" i], input[type="text"][name*="login" i], input[type="text"][name*="email" i], input[type="text"]'
        );

        if (matched.length > 0) {
          const cred = matched[0];
          if (userInput && !userInput.value) {
            userInput.value = cred.username;
            userInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
          if (!pwInput.value) {
            pwInput.value = cred.password;
            pwInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }

        if (form && !form.dataset.gxSaveBound) {
          form.dataset.gxSaveBound = '1';
          form.addEventListener('submit', () => {
            const username = userInput ? userInput.value.trim() : '';
            const password = pwInput.value;
            if (username && password) {
              const alreadySaved = matched.some(
                (m) => m.username === username && m.password === password
              );
              if (!alreadySaved) {
                ipcRenderer.invoke('autofill:save', {
                  username,
                  password
                });
              }
            }
          });
        }
      });
    };

    fillForms();
    const obs = new MutationObserver(() => fillForms());
    obs.observe(document.documentElement, { childList: true, subtree: true });
  } catch (_) {}
});
