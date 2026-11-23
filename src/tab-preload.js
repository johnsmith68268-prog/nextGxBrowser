const { contextBridge, ipcRenderer, webFrame } = require('electron');

// NOTE: this preload runs sandboxed (webPreferences.sandbox: true), so
// it may ONLY require('electron') — a relative require such as
// require('./youtube-adstrip') fails with "module not found" and the
// ENTIRE preload fails to load (which silently kills every API the WebUI
// and media observer expose). The YouTube stripping logic below is
// therefore inlined here, copied verbatim from src/youtube-adstrip.js
// (the unit-tested module — keep the two in sync; tests/coding-phase.test.js
// GX-7 asserts this file has no relative requires).
const YT_AD_FIELD_NAMES = [
  'adPlacements',
  'adSlots',
  'playerAds',
  'adBreaks',
  'adBreak',
  'adInfo',
  'adSlotLoggingData',
  'adPlacementsRenderer'
];

function isYouTubeHost(hostname) {
  if (!hostname || typeof hostname !== 'string') return false;
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return (
    host === 'youtube.com' ||
    host === 'www.youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'music.youtube.com' ||
    host === 'youtube-nocookie.com' ||
    host === 'www.youtube-nocookie.com' ||
    host.endsWith('.youtube.com') ||
    host.endsWith('.youtube-nocookie.com')
  );
}

function stripYouTubePlayerResponse(input) {
  let stripped = 0;
  if (!input || typeof input !== 'object') {
    return { data: input, stripped: 0 };
  }
  function stripValue(value, depth) {
    if (!value || typeof value !== 'object' || depth > 24) return value;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        value[i] = stripValue(value[i], depth + 1);
      }
      return value;
    }
    for (const key of Object.keys(value)) {
      if (YT_AD_FIELD_NAMES.indexOf(key) !== -1) {
        const removed = value[key];
        if (Array.isArray(removed)) stripped += removed.length;
        else if (removed) stripped += 1;
        delete value[key];
        continue;
      }
      if (key === 'adTrackingParams' || key === 'adInfoRenderer') {
        stripped += 1;
        delete value[key];
        continue;
      }
      value[key] = stripValue(value[key], depth + 1);
    }
    return value;
  }
  let data = input;
  try {
    data = stripValue(input, 0);
  } catch (_) {
    return { data: input, stripped: 0 };
  }
  return { data, stripped };
}

function stripYouTubePlayerResponseText(text) {
  if (!text || typeof text !== 'string') return { text, stripped: 0 };
  if (text.indexOf('adPlacement') === -1 && text.indexOf('playerAds') === -1) {
    return { text, stripped: 0 };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    return { text, stripped: 0 };
  }
  const result = stripYouTubePlayerResponse(parsed);
  if (!result.stripped) return { text, stripped: 0 };
  try {
    return { text: JSON.stringify(result.data), stripped: result.stripped };
  } catch (_) {
    return { text, stripped: 0 };
  }
}

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
    getHistory: () => ipcRenderer.invoke('history:get'),
    navigate: (urlOrQuery) => ipcRenderer.invoke('tabs:navigate', urlOrQuery),
    addSpeedDial: (item) => ipcRenderer.invoke('newtab:add-dial', item),
    updateSpeedDial: (id, item) => ipcRenderer.invoke('newtab:update-dial', { id, ...(item || {}) }),
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
    // UX phase: Settings (a tab view) asks the shell to open the shared modal.
    openCreateProfileModal: () => ipcRenderer.invoke('profiles:open-create-modal'),
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
    getPasswordEncryptionStatus: () => ipcRenderer.invoke('passwords:encryption-status'),
    // Passkeys (software authenticator) — worker C
    getPasskeys: () => ipcRenderer.invoke('passkeys:list'),
    deletePasskey: (id) => ipcRenderer.invoke('passkeys:delete', id),
    getPasskeyEncryptionStatus: () => ipcRenderer.invoke('passkeys:encryption-status'),
    sleepBackgroundTabs: () => ipcRenderer.invoke('tabs:sleep-background'),
    clearBrowsingData: (opts) => ipcRenderer.invoke('cleaner:run', opts),
    // [Wave2-D] Autofill management (gaps 6.2/6.3) + Settings/About (5.14) +
    // download location picker (5.5). Additive one-line exposures only; no
    // existing method or the autofill engine below was modified.
    getAddresses: () => ipcRenderer.invoke('autofill:get-addresses'),
    addAddress: (entry) => ipcRenderer.invoke('autofill:add-address', entry),
    updateAddress: (entry) => ipcRenderer.invoke('autofill:update-address', entry),
    removeAddress: (id) => ipcRenderer.invoke('autofill:remove-address', id),
    getPaymentMethods: () => ipcRenderer.invoke('autofill:get-payment-methods'),
    addPaymentMethod: (entry) => ipcRenderer.invoke('autofill:add-payment-method', entry),
    updatePaymentMethod: (entry) => ipcRenderer.invoke('autofill:update-payment-method', entry),
    removePaymentMethod: (id) => ipcRenderer.invoke('autofill:remove-payment-method', id),
    chooseDownloadLocation: () => ipcRenderer.invoke('downloads:choose-location'),
    resetSettings: () => ipcRenderer.invoke('settings:reset'),
    getAppVersion: () => ipcRenderer.invoke('app:version'),
    setDefaultBrowser: () => ipcRenderer.invoke('app:set-default-browser')
  });
}

if (internalPageKind === 'error') {
  contextBridge.exposeInMainWorld('gxErrorPageAPI', {
    retry: (url) => ipcRenderer.invoke('tabs:retry-failed', url),
    goBack: () => ipcRenderer.invoke('tabs:back'),
    goHome: () => ipcRenderer.invoke('tabs:home'),
    proceedAnyway: (url) => ipcRenderer.invoke('tabs:proceed-insecure', url),
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

// ---------------------------------------------------------------------------
// YouTube video-ad scriptlet (P0).
// Domain blocking cannot stop YouTube video ads: the ads and the video
// come from the same googlevideo.com hosts, so blocking that host would
// break playback. Instead this hook runs in the page's main world and
// strips the ad schedule (adPlacements / adSlots / playerAds) out of the
// /youtubei/v1/player and /youtubei/v1/next JSON responses before the
// player reads them, and drops the /api/stats/ads beacons. The pure
// The stripping logic is inlined in this file (sandboxed preloads cannot
// require() relative modules — see the note at the top of this file) and
// duplicated in src/youtube-adstrip.js, which is the unit-tested copy;
// keep the two in sync. Only the functions' source is injected into the
// page, so the page never sees the preload's Node APIs.
// If any step fails, the original response is passed through untouched —
// ads may show again, but playback never breaks because of this hook.
// Top frame + YouTube hosts only; internal pages and other sites are
// untouched. See src/youtube-adstrip.js for the honest limits (notably:
// ads baked into the initial page HTML are not reachable from here).
// ---------------------------------------------------------------------------
(function initYouTubeAdStrip() {
  if (window !== window.top || internalPageKind) return;
  const proto = window.location.protocol;
  if (proto !== 'http:' && proto !== 'https:') return;
  let host = '';
  try {
    host = window.location.hostname || '';
  } catch (_) {
    return;
  }
  if (!isYouTubeHost(host)) return;
  if (!webFrame || typeof webFrame.executeJavaScript !== 'function') return;

  function buildMainWorldYouTubeHook() {
    return `(() => {
      try {
        const sym = Symbol.for('__nx_yt_adstrip__');
        if (window[sym]) return true;
        window[sym] = { stripped: 0 };
        const YT_AD_FIELD_NAMES = ${JSON.stringify(YT_AD_FIELD_NAMES)};
        const stripYouTubePlayerResponse = ${stripYouTubePlayerResponse.toString()};
        const stripYouTubePlayerResponseText = ${stripYouTubePlayerResponseText.toString()};
        const isPlayerEndpoint = (url) => typeof url === 'string' && (url.indexOf('/youtubei/v1/player') !== -1 || url.indexOf('/youtubei/v1/next') !== -1);
        const isAdStats = (url) => typeof url === 'string' && (url.indexOf('/api/stats/ads') !== -1 || url.indexOf('/pagead/') !== -1);
        const getUrl = (input) => {
          try {
            if (typeof input === 'string') return input;
            if (input && typeof input.url === 'string') return input.url;
          } catch (_) {}
          return '';
        };

        if (typeof window.fetch === 'function') {
          const origFetch = window.fetch.bind(window);
          window.fetch = function (...args) {
            const url = getUrl(args[0]);
            if (isAdStats(url)) {
              return Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }));
            }
            if (!isPlayerEndpoint(url)) return origFetch(...args);
            return origFetch(...args).then(async (res) => {
              try {
                const ct = (res.headers && res.headers.get('content-type')) || '';
                if (ct.indexOf('json') === -1) return res;
                const text = await res.clone().text();
                const stripped = stripYouTubePlayerResponseText(text);
                if (!stripped.stripped) return res;
                window[sym].stripped += stripped.stripped;
                return new Response(stripped.text, { status: res.status, statusText: res.statusText, headers: res.headers });
              } catch (_) {
                return res;
              }
            });
          };
        }

        if (typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype) {
          const origOpen = XMLHttpRequest.prototype.open;
          const origSend = XMLHttpRequest.prototype.send;
          XMLHttpRequest.prototype.open = function (method, url) {
            try { this.__nx_yt_url = getUrl(url); } catch (_) {}
            return origOpen.apply(this, arguments);
          };
          XMLHttpRequest.prototype.send = function () {
            const xhr = this;
            const url = xhr.__nx_yt_url || '';
            if (isAdStats(url)) {
              // Drop the beacon without ever hitting the network.
              try { xhr.abort(); } catch (_) {}
              return undefined;
            }
            if (isPlayerEndpoint(url)) {
              xhr.addEventListener('load', function () {
                try {
                  const raw = xhr.responseText;
                  if (!raw) return;
                  const stripped = stripYouTubePlayerResponseText(raw);
                  if (!stripped.stripped) return;
                  window[sym].stripped += stripped.stripped;
                  Object.defineProperty(xhr, 'responseText', { value: stripped.text, configurable: true });
                  try {
                    Object.defineProperty(xhr, 'response', { value: stripped.text, configurable: true });
                  } catch (_) {}
                } catch (_) {}
              });
            }
            return origSend.apply(this, arguments);
          };
        }
        return true;
      } catch (_) {
        return false;
      }
    })()`;
  }

  try {
    webFrame.executeJavaScript(buildMainWorldYouTubeHook()).catch(() => {});
  } catch (_) {}
})();

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
          if (mutationTimer) return;
          let relevant = false;
          for (let i = 0; i < mutations.length && !relevant; i++) {
            const m = mutations[i];
            for (let j = 0; j < m.addedNodes.length; j++) {
              const n = m.addedNodes[j];
              if (!n || n.nodeType !== 1) continue;
              const t = n.tagName;
              if (t === 'SPAN' || t === 'PATH' || t === 'SVG' || t === 'IMG' || t === 'A' || t === 'P' || t === 'B' || t === 'I') continue;
              if (nodeMayContainMedia(n)) {
                relevant = true;
                break;
              }
            }
            if (!relevant && trackedMedia.size > 0) {
              for (let j = 0; j < m.removedNodes.length; j++) {
                const n = m.removedNodes[j];
                if (!n || n.nodeType !== 1) continue;
                const t = n.tagName;
                if (t === 'SPAN' || t === 'PATH' || t === 'SVG' || t === 'IMG' || t === 'A' || t === 'P' || t === 'B' || t === 'I') continue;
                if (nodeMayContainMedia(n)) {
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

// ---------------------------------------------------------------------------
// Software Passkey Authenticator (WebAuthn) — worker C, gaps 4.1/4.3.
// Electron ships no authenticator UI/backend, so this preload overrides
// navigator.credentials in the page's main world (same webFrame injection
// pattern as the media-session hook above) and marshals ceremonies to the
// main process (src/main/passkeys.js), where keys are generated, stored and
// signed. The page never sees a private key.
//
// Honest limits: attestation is always "none"; user verification is NOT
// performed (the dialog confirm is user presence only); only ES256 (-7);
// returned credentials are duck-typed objects with PublicKeyCredential
// prototypes applied (the constructor is not constructible by pages).
// Top frame + http(s) only; iframes keep native behaviour.
// ---------------------------------------------------------------------------
(function initPasskeyAuthenticator() {
  if (window !== window.top || internalPageKind) return;
  const proto = window.location.protocol;
  if (proto !== 'http:' && proto !== 'https:') return;

  function makeToken() {
    try {
      const bytes = new Uint8Array(12);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    } catch (_) {
      return Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
  }

  const PK_TOKEN = makeToken();
  const PK_BRIDGE_NAME = `__nx_pk_bridge_${PK_TOKEN}`;
  const PK_SYM_KEY = `__nx_pk_${PK_TOKEN}`;

  try {
    contextBridge.exposeInMainWorld(PK_BRIDGE_NAME, {
      ceremony: (payload) => ipcRenderer.invoke('passkey:ceremony', payload)
    });
  } catch (_) {
    return;
  }

  function buildMainWorldPasskeyHook(symKey, bridgeName) {
    return `(() => {
      try {
        const sym = Symbol.for(${JSON.stringify(symKey)});
        if (window[sym]) return true;
        window[sym] = true;
        const bridge = window[${JSON.stringify(bridgeName)}];
        if (!bridge || typeof bridge.ceremony !== 'function') return false;

        function b64urlEncode(bytes) {
          const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
          let s = '';
          for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
          return btoa(s).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '');
        }
        function b64urlDecode(str) {
          const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
          const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
          const u8 = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          return u8;
        }
        function toU8(value) {
          if (value instanceof Uint8Array) return new Uint8Array(value);
          if (value instanceof ArrayBuffer) return new Uint8Array(value);
          if (value && typeof value === 'object' && value.buffer instanceof ArrayBuffer) {
            return new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength);
          }
          throw new DOMException('Expected an ArrayBuffer or typed array.', 'TypeError');
        }
        function toAB(u8) {
          const copy = new Uint8Array(u8);
          return copy.buffer;
        }
        function domErr(name, message) {
          try { return new DOMException(message, name); }
          catch (_) { const e = new Error(message); e.name = name; return e; }
        }
        function withTimeout(promise, ms) {
          let timer = null;
          const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(domErr('NotAllowedError', 'The passkey request timed out.')), ms);
          });
          return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer); });
        }
        function baseCred(res) {
          // Plain object on purpose: do NOT set PublicKeyCredential.prototype.
          // Its response/rawId are native getters that throw "Illegal
          // invocation" on a non-native object, and assigning .response after
          // setPrototypeOf silently drops the value (getter-only accessor).
          return {
            id: res.id,
            rawId: toAB(b64urlDecode(res.rawId)),
            type: 'public-key',
            authenticatorAttachment: 'platform',
            getClientExtensionResults: function () { return {}; }
          };
        }

        async function create(options) {
          if (!window.isSecureContext) throw domErr('SecurityError', 'WebAuthn requires a secure context.');
          const pk = (options && options.publicKey) || null;
          if (!pk) throw domErr('TypeError', 'Missing publicKey options.');
          const challenge = toU8(pk.challenge);
          const user = pk.user || {};
          const userId = toU8(user.id);
          const serialized = {
            challenge: b64urlEncode(challenge),
            rpId: pk.rp && typeof pk.rp.id === 'string' ? pk.rp.id : undefined,
            rp: pk.rp && typeof pk.rp === 'object' ? { name: typeof pk.rp.name === 'string' ? pk.rp.name : undefined, id: typeof pk.rp.id === 'string' ? pk.rp.id : undefined } : undefined,
            user: { id: b64urlEncode(userId), name: user.name, displayName: user.displayName },
            pubKeyCredParams: Array.isArray(pk.pubKeyCredParams) ? pk.pubKeyCredParams : [],
            authenticatorSelection: pk.authenticatorSelection || undefined,
            attestation: pk.attestation,
            timeout: pk.timeout,
            excludeCredentials: Array.isArray(pk.excludeCredentials)
              ? pk.excludeCredentials.map((c) => ({ id: b64urlEncode(toU8(c.id)), type: c.type || 'public-key', transports: c.transports }))
              : []
          };
          const timeoutMs = (typeof pk.timeout === 'number' && pk.timeout > 0 ? pk.timeout : 120000) + 10000;
          const res = await withTimeout(
            bridge.ceremony({ kind: 'create', origin: window.location.origin, options: serialized }),
            timeoutMs
          );
          if (!res || !res.ok) throw domErr(res && res.name ? res.name : 'NotAllowedError', (res && res.message) || 'The passkey operation could not be completed.');
          const cred = baseCred(res);
          const response = {
            clientDataJSON: toAB(b64urlDecode(res.response.clientDataJSON)),
            attestationObject: toAB(b64urlDecode(res.response.attestationObject)),
            authenticatorData: toAB(b64urlDecode(res.response.authenticatorData)),
            publicKey: res.response.publicKey ? toAB(b64urlDecode(res.response.publicKey)) : null,
            publicKeyAlgorithm: typeof res.response.publicKeyAlgorithm === 'number' ? res.response.publicKeyAlgorithm : -7,
            getTransports: function () { return Array.isArray(res.response.transports) ? res.response.transports.slice() : ['internal']; },
            getAuthenticatorData: function () { return toAB(b64urlDecode(res.response.authenticatorData)); },
            getPublicKey: function () { return res.response.publicKey ? toAB(b64urlDecode(res.response.publicKey)) : null; },
            getPublicKeyAlgorithm: function () { return typeof res.response.publicKeyAlgorithm === 'number' ? res.response.publicKeyAlgorithm : -7; }
          };
          cred.response = response;
          cred.toJSON = function () {
            return {
              id: res.id,
              rawId: res.rawId,
              type: 'public-key',
              authenticatorAttachment: 'platform',
              clientExtensionResults: {},
              response: {
                clientDataJSON: res.response.clientDataJSON,
                attestationObject: res.response.attestationObject,
                authenticatorData: res.response.authenticatorData,
                publicKey: res.response.publicKey,
                publicKeyAlgorithm: res.response.publicKeyAlgorithm,
                transports: Array.isArray(res.response.transports) ? res.response.transports.slice() : ['internal']
              }
            };
          };
          return cred;
        }

        async function get(options) {
          if (!window.isSecureContext) throw domErr('SecurityError', 'WebAuthn requires a secure context.');
          const pk = (options && options.publicKey) || null;
          if (!pk) throw domErr('TypeError', 'Missing publicKey options.');
          if (pk.mediation === 'conditional') {
            throw domErr('NotSupportedError', 'Conditional mediation is not supported by this authenticator.');
          }
          const challenge = toU8(pk.challenge);
          const serialized = {
            challenge: b64urlEncode(challenge),
            rpId: pk.rpId,
            allowCredentials: Array.isArray(pk.allowCredentials)
              ? pk.allowCredentials.map((c) => ({ id: b64urlEncode(toU8(c.id)), type: c.type || 'public-key', transports: c.transports }))
              : [],
            userVerification: pk.userVerification,
            timeout: pk.timeout
          };
          const timeoutMs = (typeof pk.timeout === 'number' && pk.timeout > 0 ? pk.timeout : 120000) + 10000;
          const res = await withTimeout(
            bridge.ceremony({ kind: 'get', origin: window.location.origin, options: serialized }),
            timeoutMs
          );
          if (!res || !res.ok) throw domErr(res && res.name ? res.name : 'NotAllowedError', (res && res.message) || 'The passkey operation could not be completed.');
          const cred = baseCred(res);
          const response = {
            clientDataJSON: toAB(b64urlDecode(res.response.clientDataJSON)),
            authenticatorData: toAB(b64urlDecode(res.response.authenticatorData)),
            signature: toAB(b64urlDecode(res.response.signature)),
            userHandle: res.response.userHandle ? toAB(b64urlDecode(res.response.userHandle)) : null
          };
          cred.response = response;
          cred.toJSON = function () {
            return {
              id: res.id,
              rawId: res.rawId,
              type: 'public-key',
              authenticatorAttachment: 'platform',
              clientExtensionResults: {},
              response: {
                clientDataJSON: res.response.clientDataJSON,
                authenticatorData: res.response.authenticatorData,
                signature: res.response.signature,
                userHandle: res.response.userHandle || null
              }
            };
          };
          return cred;
        }

        function parseCreationOptions(json) {
          const out = Object.assign({}, json || {});
          if (typeof out.challenge === 'string') out.challenge = toAB(b64urlDecode(out.challenge));
          if (out.user && typeof out.user.id === 'string') {
            out.user = Object.assign({}, out.user, { id: toAB(b64urlDecode(out.user.id)) });
          }
          if (Array.isArray(out.excludeCredentials)) {
            out.excludeCredentials = out.excludeCredentials.map((c) => Object.assign({}, c, { id: toAB(b64urlDecode(c.id)) }));
          }
          return out;
        }
        function parseRequestOptions(json) {
          const out = Object.assign({}, json || {});
          if (typeof out.challenge === 'string') out.challenge = toAB(b64urlDecode(out.challenge));
          if (Array.isArray(out.allowCredentials)) {
            out.allowCredentials = out.allowCredentials.map((c) => Object.assign({}, c, { id: toAB(b64urlDecode(c.id)) }));
          }
          return out;
        }

        const fakeCredentials = { create: create, get: get };
        let installed = false;
        try {
          Object.defineProperty(navigator, 'credentials', { value: fakeCredentials, configurable: true, enumerable: true });
          installed = true;
        } catch (_) {}
        if (!installed) {
          try {
            const navProto = Object.getPrototypeOf(navigator);
            Object.defineProperty(navProto, 'credentials', { get: function () { return fakeCredentials; }, configurable: true });
            installed = true;
          } catch (_) {}
        }
        if (typeof PublicKeyCredential !== 'undefined') {
          try { Object.defineProperty(PublicKeyCredential, 'isUserVerifyingPlatformAuthenticatorAvailable', { value: function () { return Promise.resolve(false); }, configurable: true }); } catch (_) {}
          try { Object.defineProperty(PublicKeyCredential, 'isConditionalMediationAvailable', { value: function () { return Promise.resolve(false); }, configurable: true }); } catch (_) {}
          try { Object.defineProperty(PublicKeyCredential, 'parseCreationOptionsFromJSON', { value: parseCreationOptions, configurable: true }); } catch (_) {}
          try { Object.defineProperty(PublicKeyCredential, 'parseRequestOptionsFromJSON', { value: parseRequestOptions, configurable: true }); } catch (_) {}
        }
        return installed;
      } catch (_) {
        return false;
      }
    })();`;
  }

  if (webFrame && typeof webFrame.executeJavaScript === 'function') {
    try {
      webFrame.executeJavaScript(buildMainWorldPasskeyHook(PK_SYM_KEY, PK_BRIDGE_NAME)).catch(() => {});
    } catch (_) {}
  }
})();

// Automatic Website Password Autofill & Save Engine (HTTPS + top frame + user-gesture gated)
window.addEventListener('DOMContentLoaded', async () => {
  // Never autofill inside third-party / nested iframes
  if (window.top !== window) return;
  const proto = window.location.protocol;
  const rawHost = (window.location.hostname || '').toLowerCase();
  const isLocalDev = rawHost === 'localhost' || rawHost === '127.0.0.1';
  if (proto !== 'https:' && !(proto === 'http:' && isLocalDev)) return;
  const host = normalizeHost(rawHost);
  if (!host) return;

  let cachedCredentials = null;
  let fetchingCredentials = null;
  const loadCredentials = async () => {
    if (cachedCredentials !== null) return cachedCredentials;
    if (!fetchingCredentials) {
      fetchingCredentials = ipcRenderer
        .invoke('autofill:get')
        .then((list) => {
          cachedCredentials = (Array.isArray(list) ? list : []).filter(
            (p) => p && p.site && normalizeHost(p.site) === host
          );
          return cachedCredentials;
        })
        .catch(() => {
          cachedCredentials = [];
          return [];
        });
    }
    return fetchingCredentials;
  };

  try {
    const bindForms = () => {
      const passInputs = document.querySelectorAll('input[type="password"]');
      passInputs.forEach((pwInput) => {
        if (pwInput.dataset.gxAutofillBound) return;
        pwInput.dataset.gxAutofillBound = '1';

        const form = pwInput.closest('form') || document.body;
        const userInput = form.querySelector(
          'input[type="email"], input[type="text"][name*="user" i], input[type="text"][name*="login" i], input[type="text"][name*="email" i], input[type="text"]'
        );

        let filledOnce = false;
        const triggerAutofillOnGesture = async (ev) => {
          if (filledOnce || !ev || !ev.isTrusted) return;
          const matched = await loadCredentials();
          if (!matched.length) return;
          filledOnce = true;
          const cred = matched[0];
          if (userInput && !userInput.value) {
            userInput.value = cred.username;
            userInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
          if (!pwInput.value) {
            pwInput.value = cred.password;
            pwInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
        };

        pwInput.addEventListener('focus', triggerAutofillOnGesture);
        pwInput.addEventListener('click', triggerAutofillOnGesture);
        if (userInput) {
          userInput.addEventListener('focus', triggerAutofillOnGesture);
          userInput.addEventListener('click', triggerAutofillOnGesture);
        }

        if (form && !form.dataset.gxSaveBound) {
          form.dataset.gxSaveBound = '1';
          form.addEventListener('submit', async () => {
            const username = userInput ? userInput.value.trim() : '';
            const password = pwInput.value;
            if (username && password) {
              const matched = cachedCredentials || (await loadCredentials());
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

    bindForms();

    const nodeMayHavePasswordField = (node) => {
      if (!node || node.nodeType !== 1) return false;
      const tag = node.tagName;
      if (tag === 'INPUT') {
        return (node.type || '').toLowerCase() === 'password';
      }
      if (tag === 'FORM') return true;
      if (typeof node.querySelector === 'function') {
        return Boolean(node.querySelector('input[type="password"]'));
      }
      return false;
    };

    let autofillTimer = null;
    const scheduleBindForms = () => {
      if (autofillTimer) return;
      autofillTimer = setTimeout(() => {
        autofillTimer = null;
        bindForms();
      }, 500);
    };

    const obs = new MutationObserver((mutations) => {
      if (autofillTimer) return;
      for (let i = 0; i < mutations.length; i++) {
        const added = mutations[i].addedNodes;
        if (!added || added.length === 0) continue;
        for (let j = 0; j < added.length; j++) {
          if (nodeMayHavePasswordField(added[j])) {
            scheduleBindForms();
            return;
          }
        }
      }
    });
    if (document.documentElement) {
      obs.observe(document.documentElement, { childList: true, subtree: true });
      window.addEventListener(
        'pagehide',
        () => {
          obs.disconnect();
          if (autofillTimer) {
            clearTimeout(autofillTimer);
            autofillTimer = null;
          }
        },
        { once: true }
      );
    }
  } catch (_) {}
});

// Automatic Address & Payment Autofill Engine (gaps 6.2/6.3) — same gates
// and gesture pattern as the password engine above: top frame only, HTTPS
// or http localhost/127.0.0.1 only, fill on a trusted focus/click, only
// EMPTY fields are filled (never overwrite what the user typed), first
// stored entry wins. CVC/security-code fields are NEVER filled (we do not
// store them). Card numbers come from 'autofill:page-payment-methods'
// (full decrypted number, same trust level as passwords:get).
window.addEventListener('DOMContentLoaded', async () => {
  if (window.top !== window) return;
  const proto = window.location.protocol;
  const rawHost = (window.location.hostname || '').toLowerCase();
  const isLocalDev = rawHost === 'localhost' || rawHost === '127.0.0.1';
  if (proto !== 'https:' && !(proto === 'http:' && isLocalDev)) return;
  if (!normalizeHost(rawHost)) return;

  let cachedAddresses = null;
  let cachedCards = null;
  let fetchingAddresses = null;
  let fetchingCards = null;
  const loadAddresses = async () => {
    if (cachedAddresses !== null) return cachedAddresses;
    if (!fetchingAddresses) {
      fetchingAddresses = ipcRenderer
        .invoke('autofill:page-addresses')
        .then((list) => {
          cachedAddresses = Array.isArray(list) ? list.filter((a) => a && typeof a === 'object') : [];
          return cachedAddresses;
        })
        .catch(() => {
          cachedAddresses = [];
          return [];
        });
    }
    return fetchingAddresses;
  };
  const loadCards = async () => {
    if (cachedCards !== null) return cachedCards;
    if (!fetchingCards) {
      fetchingCards = ipcRenderer
        .invoke('autofill:page-payment-methods')
        .then((list) => {
          cachedCards = Array.isArray(list) ? list.filter((c) => c && typeof c === 'object') : [];
          return cachedCards;
        })
        .catch(() => {
          cachedCards = [];
          return [];
        });
    }
    return fetchingCards;
  };

  const norm = (s) => String(s || '').toLowerCase();
  const tokensOf = (el) => {
    const parts = [];
    const ac = norm(el.getAttribute('autocomplete')).trim().split(/\s+/).pop();
    if (ac) parts.push(ac);
    [el.name, el.id].forEach((v) => {
      norm(v)
        .split(/[^a-z0-9]+/)
        .forEach((t) => {
          if (t) parts.push(t);
        });
    });
    return new Set(parts);
  };
  const hayOf = (el) =>
    [el.getAttribute('autocomplete'), el.name, el.id, el.placeholder].map(norm).join(' ');

  // Classify a field into an autofill kind, or null (not fillable).
  // autocomplete tokens are authoritative; name/id tokens are the fallback.
  const classifyField = (el) => {
    if (!el || el.disabled || el.readOnly) return null;
    const tag = (el.tagName || '').toUpperCase();
    if (tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') return null;
    const type = (el.type || '').toLowerCase();
    if (
      type === 'password' || type === 'hidden' || type === 'submit' || type === 'button' ||
      type === 'checkbox' || type === 'radio' || type === 'file' || type === 'search'
    ) {
      return null;
    }
    const toks = tokensOf(el);
    const hay = hayOf(el);
    const has = (...ns) => ns.some((n) => toks.has(n) || hay.includes(n));
    // Security code is never filled.
    if (has('cc-csc', 'cvc', 'cvv', 'cvc2', 'securitycode', 'security-code')) return null;
    // Card fields first (a "card name" field must not match the name rules).
    if (has('cc-number', 'cardnumber', 'card-number', 'ccnumber', 'cardnum')) return 'cardNumber';
    if (has('cc-exp-month', 'expmonth', 'exp-month', 'expirymonth', 'expiry-month')) return 'cardExpMonth';
    if (has('cc-exp-year', 'expyear', 'exp-year', 'expiryyear', 'expiry-year')) return 'cardExpYear';
    if (has('cc-exp', 'expdate', 'exp-date', 'expirydate', 'expiry-date', 'expiry', 'expiration')) return 'cardExp';
    if (has('cc-name', 'cardholder', 'cardholdername', 'cardholder-name', 'name-on-card', 'card-name', 'cardname')) return 'cardName';
    if (has('email', 'e-mail')) return 'email';
    if (has('given-name', 'firstname', 'first-name', 'first')) return 'givenName';
    if (has('family-name', 'lastname', 'last-name', 'surname', 'last')) return 'familyName';
    if (has('organization', 'organisation', 'company')) return 'organization';
    // 'name' is token-exact only: a hay substring match would also catch
    // 'username' (a login field, not a name field).
    if (toks.has('name') || has('fullname', 'full-name', 'yourname')) return 'fullName';
    if (has('address-line2', 'address2', 'address-line-2', 'apt', 'suite', 'unit')) return 'addressLine2';
    // Bare 'address' is token-exact only: hay.includes('address') would also
    // catch 'address-level1'/'address-level2' and misclassify state/city as
    // the street line (their autocomplete tokens contain 'address').
    if (has('address-line1', 'address1', 'address-line-1', 'street', 'streetaddress') || toks.has('address')) return 'addressLine1';
    if (has('address-level2', 'city', 'town')) return 'city';
    if (has('address-level1', 'state', 'region', 'province', 'county')) return 'region';
    if (has('postal-code', 'postalcode', 'zip', 'zipcode', 'postcode')) return 'postalCode';
    if (has('country', 'country-name')) return 'country';
    if (has('tel', 'tel-national', 'phone', 'mobile', 'telephone')) return 'phone';
    return null;
  };

  const addressValues = (addr) => {
    const parts = String(addr.fullName || '').trim().split(/\s+/).filter(Boolean);
    return {
      fullName: addr.fullName || '',
      givenName: parts[0] || '',
      familyName: parts.slice(1).join(' ') || '',
      organization: addr.organization || '',
      addressLine1: addr.addressLine1 || '',
      addressLine2: addr.addressLine2 || '',
      city: addr.city || '',
      region: addr.region || '',
      postalCode: addr.postalCode || '',
      country: addr.country || '',
      phone: addr.phone || '',
      email: addr.email || ''
    };
  };

  const cardValues = (card) => {
    const mm = String(card.expiryMonth || '').padStart(2, '0');
    const yy = String(card.expiryYear || '');
    const yyyy = yy.length === 2 ? '20' + yy : yy;
    return {
      cardNumber: String(card.number || '').replace(/\D/g, ''),
      cardName: card.cardholderName || '',
      cardExp: mm && yyyy ? mm + '/' + yyyy.slice(-2) : '',
      cardExpMonth: mm,
      cardExpYear: yyyy,
      cardExpYear2: yyyy.slice(-2)
    };
  };

  const setFieldValue = (el, kind, value) => {
    if (!value || el.value) return false;
    if (el.tagName === 'SELECT') {
      const v = String(value).toLowerCase();
      const opt = Array.from(el.options || []).find(
        (o) => String(o.value).toLowerCase() === v || String(o.text).trim().toLowerCase() === v
      );
      if (!opt) return false;
      el.value = opt.value;
    } else {
      let v = String(value);
      if (kind === 'cardExpYear' && el.maxLength === 2) v = v.slice(-2);
      el.value = v;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };

  try {
    const bindForms = () => {
      const fields = document.querySelectorAll('input, select, textarea');
      fields.forEach((el) => {
        const kind = classifyField(el);
        if (!kind || el.dataset.gxAddrCardBound) return;
        el.dataset.gxAddrCardBound = '1';
        let filledOnce = false;
        const triggerFillOnGesture = async (ev) => {
          if (filledOnce || !ev || !ev.isTrusted) return;
          const form = el.closest('form') || document;
          const [addresses, cards] = await Promise.all([loadAddresses(), loadCards()]);
          if (!addresses.length && !cards.length) return;
          filledOnce = true;
          const addrVals = addresses.length ? addressValues(addresses[0]) : null;
          const cardVals = cards.length ? cardValues(cards[0]) : null;
          form.querySelectorAll('input, select, textarea').forEach((f) => {
            const k = classifyField(f);
            if (!k) return;
            if (addrVals && k in addrVals) setFieldValue(f, k, addrVals[k]);
            if (cardVals && k in cardVals) {
              const v = k === 'cardExpYear' ? cardVals.cardExpYear : cardVals[k];
              setFieldValue(f, k, v);
            }
          });
        };
        el.addEventListener('focus', triggerFillOnGesture);
        el.addEventListener('click', triggerFillOnGesture);
      });
    };

    bindForms();

    const nodeMayHaveFillableField = (node) => {
      if (!node || node.nodeType !== 1) return false;
      const tag = node.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return true;
      if (tag === 'FORM') return true;
      if (typeof node.querySelector === 'function') {
        return Boolean(node.querySelector('input, select, textarea'));
      }
      return false;
    };

    let addrCardTimer = null;
    const scheduleBindForms = () => {
      if (addrCardTimer) return;
      addrCardTimer = setTimeout(() => {
        addrCardTimer = null;
        bindForms();
      }, 500);
    };

    const obs = new MutationObserver((mutations) => {
      if (addrCardTimer) return;
      for (let i = 0; i < mutations.length; i++) {
        const added = mutations[i].addedNodes;
        if (!added || added.length === 0) continue;
        for (let j = 0; j < added.length; j++) {
          if (nodeMayHaveFillableField(added[j])) {
            scheduleBindForms();
            return;
          }
        }
      }
    });
    if (document.documentElement) {
      obs.observe(document.documentElement, { childList: true, subtree: true });
      window.addEventListener(
        'pagehide',
        () => {
          obs.disconnect();
          if (addrCardTimer) {
            clearTimeout(addrCardTimer);
            addrCardTimer = null;
          }
        },
        { once: true }
      );
    }
  } catch (_) {}
});

// ---------------------------------------------------------------------------
// Chrome parity (worker A) — media capture wrappers: preferred-device
// application for getUserMedia (gap 1.3) and the "Stop sharing" floating pill
// for getDisplayMedia (gap 2.3). mediaDevices wrappers ONLY — the
// navigator.credentials override elsewhere in this file belongs to worker C;
// do not touch it.
//
// IMPORTANT: the preload runs in an isolated world, so assigning
// navigator.mediaDevices.getUserMedia here would only shadow the preload's
// copy and the page would never see it. Like the media-session and passkey
// hooks above, the wrappers are injected into the page's MAIN world with
// webFrame.executeJavaScript, and talk back to main through a small
// contextBridge bridge (device prefs + the device-choice push).
// ---------------------------------------------------------------------------
(function gxMediaCaptureSetup() {
  try {
    // Internal UI pages (file://) never call page media APIs.
    if (window.location.protocol === 'file:') return;
    if (!webFrame || typeof webFrame.executeJavaScript !== 'function') return;
    if (typeof contextBridge === 'undefined') return;

    const makeMediaToken = () => {
      try {
        const bytes = new Uint8Array(12);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      } catch (_) {
        return Math.random().toString(36).slice(2) + Date.now().toString(36);
      }
    };
    // NOTE: makeRandomToken() lives inside initMediaObserver's closure — do
    // not call it from here; this local generator is independent.
    const GX_MEDIA_TOKEN = makeMediaToken();
    const GX_MEDIA_BRIDGE = `__nx_media_bridge_${GX_MEDIA_TOKEN}`;
    const GX_MEDIA_SYM = `__nx_media_${GX_MEDIA_TOKEN}`;

    try {
      contextBridge.exposeInMainWorld(GX_MEDIA_BRIDGE, {
        getPreferredDevice: (origin) =>
          ipcRenderer.invoke('media:get-preferred-device', { origin }),
        queryPermissionState: (origin, name) =>
          ipcRenderer.invoke('permissions:query-state', { origin, name }),
        onDeviceChoice: (cb) => {
          ipcRenderer.on('gx-media-device-choice', (_e, payload) => {
            try {
              cb(payload);
            } catch (_) {}
          });
        }
      });
    } catch (_) {
      return;
    }

    try {
      webFrame
        .executeJavaScript(buildMainWorldMediaCaptureHook(GX_MEDIA_SYM, GX_MEDIA_BRIDGE))
        .catch(() => {});
    } catch (_) {}
  } catch (_) {}
})();

function buildMainWorldMediaCaptureHook(symKey, bridgeName) {
  return `(() => {
    try {
      const sym = Symbol.for(${JSON.stringify(symKey)});
      if (window[sym]) return true;
      window[sym] = true;
      const bridge = window[${JSON.stringify(bridgeName)}];
      if (!bridge || typeof bridge.getPreferredDevice !== 'function') return false;
      const md = navigator && navigator.mediaDevices;
      if (!md || typeof md.getUserMedia !== 'function') return false;
      const origin = window.location.origin || '';
      const origGetUserMedia = md.getUserMedia.bind(md);
      const origGetDisplayMedia =
        typeof md.getDisplayMedia === 'function' ? md.getDisplayMedia.bind(md) : null;

      // --- Preferred devices (gap 1.3) ---
      // Stored deviceIds are NOT applied: deviceIds are salted per
      // origin/profile, so an id recorded in the popover (file:// origin) is
      // meaningless in this page's origin. Labels are stable across origins,
      // so the choice is matched by label after the grant, when
      // enumerateDevices() returns labels in page scope.
      let preferredDevices = {};
      let preferredLoaded = false;
      let preferredLoadPromise = null;
      function loadPreferredDevices(force) {
        if (preferredLoaded && !force) return Promise.resolve(preferredDevices);
        if (!preferredLoadPromise || force) {
          preferredLoadPromise = bridge
            .getPreferredDevice(origin)
            .then((res) => {
              preferredLoaded = true;
              if (res && typeof res === 'object') preferredDevices = res;
              return preferredDevices;
            })
            .catch(() => {
              preferredLoaded = true;
              return preferredDevices;
            });
        }
        return preferredLoadPromise;
      }
      try {
        bridge.onDeviceChoice((payload) => {
          if (!payload || payload.origin !== origin || !payload.devices) return;
          preferredDevices = Object.assign({}, preferredDevices, payload.devices);
          preferredLoaded = true;
        });
      } catch (_) {}

      function trackDeviceId(stream, kind) {
        try {
          const t = stream.getTracks().find((x) => x.kind === kind);
          return (t && t.getSettings && t.getSettings().deviceId) || '';
        } catch (_) {
          return '';
        }
      }
      function applyDeviceConstraint(constraints, kind, deviceId) {
        const out = Object.assign({}, constraints || {});
        const prop = kind === 'video' ? 'video' : 'audio';
        const cur = out[prop];
        if (cur === false || cur === undefined || cur === null) return out;
        if (cur === true) {
          out[prop] = { deviceId: { exact: deviceId } };
          return out;
        }
        if (typeof cur === 'object') {
          if (cur.deviceId !== undefined) return out;
          out[prop] = Object.assign({}, cur, { deviceId: { exact: deviceId } });
        }
        return out;
      }
      function constraintsWantKind(constraints, kind) {
        const prop = kind === 'video' ? 'video' : 'audio';
        const v = constraints ? constraints[prop] : undefined;
        return v !== false && v !== undefined && v !== null;
      }

      md.getUserMedia = async function gxGetUserMedia(constraints) {
        await loadPreferredDevices(false);
        let stream = await origGetUserMedia(constraints || {});
        // A device choice can arrive while the permission prompt is open
        // (the user picks a device in the prompt), or be stored from an
        // earlier visit. If the stream we got uses a different device than
        // the chosen label, re-request once with this origin's deviceId for
        // that label. The re-call passes the permission check without
        // re-prompting (session grant from allow-once, or the persisted
        // allow). If the re-request fails, keep the first stream.
        try {
          // A choice may have been stored while the prompt was open, after
          // this page's first (cached) read — re-read from main so the
          // mapping below sees it even if the push has not landed yet. Main
          // stores the choice before resolving the permission callback, so
          // by the time the stream exists the stored labels are current.
          let latest = preferredDevices;
          if (!latest.cameraLabel && !latest.microphoneLabel) {
            latest = await loadPreferredDevices(true);
          }
          const labelCam = typeof latest.cameraLabel === 'string' ? latest.cameraLabel : '';
          const labelMic = typeof latest.microphoneLabel === 'string' ? latest.microphoneLabel : '';
          const wantVideo = labelCam && constraintsWantKind(constraints, 'video');
          const wantAudio = labelMic && constraintsWantKind(constraints, 'audio');
          if (wantVideo || wantAudio) {
            const devices = await md.enumerateDevices();
            let retry = null;
            if (wantVideo) {
              const match = devices.find((d) => d.kind === 'videoinput' && d.label === labelCam);
              if (match && match.deviceId) {
                const cur = trackDeviceId(stream, 'video');
                if (cur && cur !== match.deviceId) {
                  retry = applyDeviceConstraint(constraints, 'video', match.deviceId);
                }
              }
            }
            if (wantAudio) {
              const match = devices.find((d) => d.kind === 'audioinput' && d.label === labelMic);
              if (match && match.deviceId) {
                const cur = trackDeviceId(stream, 'audio');
                if (cur && cur !== match.deviceId) {
                  retry = applyDeviceConstraint(retry || constraints, 'audio', match.deviceId);
                }
              }
            }
            if (retry) {
              const replacement = await origGetUserMedia(retry);
              try {
                stream.getTracks().forEach((t) => t.stop());
              } catch (_) {}
              stream = replacement;
            }
          }
        } catch (_) {}
        return stream;
      };

      // --- Permissions API state correction (gap 1.1 / YouTube voice search) ---
      // Electron's boolean check handler reports an undecided permission as
      // 'denied' to navigator.permissions.query, so sites that pre-check
      // (YouTube voice search) never call getUserMedia. Chrome reports
      // 'prompt' for undecided. Correct the reported state to the stored /
      // session decision kept in main, without replacing the genuine
      // PermissionStatus object (instanceof, events and later states stay
      // native — only the state value is shadowed when it differs).
      try {
        const perms = navigator.permissions;
        if (perms && typeof perms.query === 'function') {
          const origQuery = perms.query.bind(perms);
          const QUERY_KEYS = {
            microphone: 1,
            camera: 1,
            geolocation: 1,
            notifications: 1,
            'clipboard-read': 1
          };
          perms.query = async function gxPermissionsQuery(descriptor) {
            const result = await origQuery(descriptor);
            try {
              const name =
                descriptor && typeof descriptor.name === 'string' ? descriptor.name : '';
              if (QUERY_KEYS[name] && typeof bridge.queryPermissionState === 'function') {
                const mine = await bridge.queryPermissionState(origin, name);
                const state = mine && typeof mine.state === 'string' ? mine.state : '';
                if (state && state !== result.state) {
                  Object.defineProperty(result, 'state', {
                    value: state,
                    configurable: true
                  });
                }
              }
            } catch (_) {}
            return result;
          };
        }
      } catch (_) {}

      // --- Screen-share pill (gap 2.3) ---
      if (origGetDisplayMedia) {
        const activeDisplayStreams = new Set();
        let sharePillHost = null;
        let sharePillMini = null;

        const liveDisplayTracks = () => {
          const out = [];
          for (const s of activeDisplayStreams) {
            try {
              for (const t of s.getTracks()) if (t.readyState === 'live') out.push(t);
            } catch (_) {}
          }
          return out;
        };
        const removeSharePill = () => {
          try {
            if (sharePillHost) sharePillHost.remove();
          } catch (_) {}
          try {
            if (sharePillMini) sharePillMini.remove();
          } catch (_) {}
          sharePillHost = null;
          sharePillMini = null;
        };
        const stopAllDisplayStreams = () => {
          for (const s of Array.from(activeDisplayStreams)) {
            try {
              s.getTracks().forEach((t) => t.stop());
            } catch (_) {}
          }
          activeDisplayStreams.clear();
          removeSharePill();
        };
        const ensureShareMini = () => {
          if (sharePillMini && sharePillMini.isConnected) {
            sharePillMini.style.display = '';
            return sharePillMini;
          }
          const parent = document.body || document.documentElement;
          if (!parent) return null;
          const mini = document.createElement('button');
          mini.type = 'button';
          mini.setAttribute('data-gx-share-pill-mini', '1');
          mini.textContent = '● Sharing';
          mini.style.cssText =
            'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483647;' +
            'background:#1b1b2e;color:#fff;border:1px solid #7c5cff;border-radius:999px;' +
            'padding:7px 14px;font:600 12px/1.2 system-ui,sans-serif;cursor:pointer;box-shadow:0 8px 28px rgba(0,0,0,.5);';
          mini.addEventListener('click', () => {
            mini.style.display = 'none';
            ensureSharePill();
          });
          parent.appendChild(mini);
          sharePillMini = mini;
          return mini;
        };
        const ensureSharePill = () => {
          if (sharePillHost && sharePillHost.isConnected) {
            sharePillHost.style.display = '';
            return sharePillHost;
          }
          const parent = document.body || document.documentElement;
          if (!parent) return null;
          const host = document.createElement('div');
          host.setAttribute('data-gx-share-pill', '1');
          host.style.cssText =
            'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483647;';
          let shadow = null;
          try {
            shadow = host.attachShadow({ mode: 'open' });
          } catch (_) {
            return null;
          }
          const style = document.createElement('style');
          style.textContent =
            '.gx-pill{display:flex;align-items:center;gap:10px;background:#1b1b2e;color:#fff;' +
            'border:1px solid #7c5cff;border-radius:999px;padding:8px 8px 8px 14px;' +
            'font:600 13px/1.2 system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.5);white-space:nowrap}' +
            '.gx-dot{width:9px;height:9px;border-radius:50%;background:#ff4d4d;flex:none}' +
            '.gx-btn{border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#fff;' +
            'border-radius:999px;padding:6px 12px;font:600 12px/1 system-ui,sans-serif;cursor:pointer}' +
            '.gx-btn:hover{background:rgba(255,255,255,.18)}' +
            '.gx-btn-stop{background:#7c5cff;border-color:transparent}';
          const pill = document.createElement('div');
          pill.className = 'gx-pill';
          const dot = document.createElement('span');
          dot.className = 'gx-dot';
          const label = document.createElement('span');
          label.textContent = origin + ' is sharing your screen';
          const stopBtn = document.createElement('button');
          stopBtn.className = 'gx-btn gx-btn-stop';
          stopBtn.type = 'button';
          stopBtn.textContent = 'Stop sharing';
          stopBtn.addEventListener('click', () => stopAllDisplayStreams());
          const hideBtn = document.createElement('button');
          hideBtn.className = 'gx-btn';
          hideBtn.type = 'button';
          hideBtn.textContent = 'Hide';
          hideBtn.addEventListener('click', () => {
            host.style.display = 'none';
            ensureShareMini();
          });
          pill.appendChild(dot);
          pill.appendChild(label);
          pill.appendChild(stopBtn);
          pill.appendChild(hideBtn);
          shadow.appendChild(style);
          shadow.appendChild(pill);
          parent.appendChild(host);
          sharePillHost = host;
          return host;
        };
        const registerDisplayStream = (stream) => {
          if (!stream) return;
          activeDisplayStreams.add(stream);
          ensureSharePill();
          const onEnded = () => {
            if (liveDisplayTracks().length === 0) {
              activeDisplayStreams.clear();
              removeSharePill();
            }
          };
          try {
            stream.getTracks().forEach((t) => {
              try {
                t.addEventListener('ended', onEnded);
              } catch (_) {}
            });
          } catch (_) {}
        };

        md.getDisplayMedia = async function gxGetDisplayMedia(constraints) {
          const stream = await origGetDisplayMedia(constraints);
          registerDisplayStream(stream);
          return stream;
        };
      }
      return true;
    } catch (_) {
      return false;
    }
  })()`;
}
