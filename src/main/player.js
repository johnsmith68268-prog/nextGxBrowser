const { ipcMain } = require('electron');
const { windowContexts, webContentsToWinId } = require('./core');
const { formatDisplayUrl } = require('./navigation');

const tabsMod = () => require('./tabs');
const sidebarMod = () => require('./sidebar');
const broadcastMod = () => require('./broadcast');

const MAX_TITLE_LEN = 200;
const MAX_SUBTITLE_LEN = 160;
const MAX_URL_LEN = 500;
const MAX_DATA_ARTWORK_LEN = 512 * 1024;
const COMMAND_TIMEOUT_MS = 3000;
const BROADCAST_COALESCE_MS = 60;
const PAUSED_SOURCE_IDLE_TTL_MS = 30 * 60 * 1000;
const MAX_SWITCHER_SOURCES = 12;

// wcId -> MediaSourceEntry
const sources = new Map();
// requestId -> { wcId, resolve, timer }
const pendingCommands = new Map();
// privacyScopeKey ('normal' | `private:${winId}`) -> wcId manually selected by user (cleared when a new source starts playing)
const manualSelectedWcId = new Map();

let commandSeq = 0;
let playerBroadcastTimer = null;
let ipcRegistered = false;

function getScopeKey(ctxOrIncognito, winId) {
  if (typeof ctxOrIncognito === 'object' && ctxOrIncognito !== null) {
    return ctxOrIncognito.incognito ? `private:${ctxOrIncognito.win?.id || 0}` : 'normal';
  }
  return ctxOrIncognito ? `private:${winId || 0}` : 'normal';
}

function clampString(val, maxLen = MAX_TITLE_LEN) {
  if (typeof val !== 'string') return '';
  const trimmed = val.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

function sanitizeArtworkUrl(raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=]+$/i.test(trimmed)) {
    return trimmed.length <= MAX_DATA_ARTWORK_LEN ? trimmed : '';
  }
  if (trimmed.length > 2048) return '';
  try {
    const u = new URL(trimmed);
    if (u.protocol === 'https:' || u.protocol === 'http:') {
      return u.toString();
    }
  } catch (_) {}
  return '';
}

function sanitizeFiniteNumber(val, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function getHostnameLabel(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl) return '';
  try {
    const u = new URL(rawUrl);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return u.hostname.replace(/^www\./i, '');
    }
    if (u.protocol === 'file:') {
      return 'Local File';
    }
  } catch (_) {}
  return '';
}

function resolveSenderSource(wc) {
  if (!wc || typeof wc.id !== 'number') return null;
  if (typeof wc.isDestroyed === 'function' && wc.isDestroyed()) return null;

  const winId = webContentsToWinId.get(wc.id);
  const candidateCtxs = [];
  if (winId !== undefined && windowContexts.has(winId)) {
    candidateCtxs.push(windowContexts.get(winId));
  } else {
    for (const c of windowContexts.values()) {
      candidateCtxs.push(c);
    }
  }

  for (const ctx of candidateCtxs) {
    if (!ctx || !ctx.win || ctx.win.isDestroyed()) continue;

    if (ctx.tabs instanceof Map) {
      for (const tab of ctx.tabs.values()) {
        if (
          tab &&
          !tab.sleeping &&
          tab.view &&
          tab.view.webContents &&
          !tab.view.webContents.isDestroyed() &&
          tab.view.webContents.id === wc.id
        ) {
          return {
            ctx,
            winId: ctx.win.id,
            incognito: Boolean(ctx.incognito),
            sourceType: 'tab',
            tab,
            tabId: tab.id,
            serviceKey: null,
            serviceTitle: '',
            wc
          };
        }
      }
    }

    if (ctx.sidebarPanel && ctx.sidebarPanel.views instanceof Map) {
      const { SIDEBAR_SERVICES } = sidebarMod();
      for (const [key, view] of ctx.sidebarPanel.views.entries()) {
        if (
          view &&
          view.webContents &&
          !view.webContents.isDestroyed() &&
          view.webContents.id === wc.id
        ) {
          const svc = SIDEBAR_SERVICES[key];
          if (svc && svc.internal) return null; // Never track the Player panel itself as a media source
          return {
            ctx,
            winId: ctx.win.id,
            incognito: Boolean(ctx.incognito),
            sourceType: 'sidebar',
            tab: null,
            tabId: null,
            serviceKey: key,
            serviceTitle: svc?.title || key,
            wc
          };
        }
      }
    }
  }

  return null;
}

function findEntryLiveTarget(entry) {
  if (!entry) return null;
  const ctx = windowContexts.get(entry.winId);
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return null;

  if (entry.sourceType === 'tab') {
    const tab = entry.tabId ? ctx.tabs.get(entry.tabId) : null;
    if (
      !tab ||
      tab.sleeping ||
      !tab.view ||
      !tab.view.webContents ||
      tab.view.webContents.isDestroyed() ||
      tab.view.webContents.id !== entry.wcId
    ) {
      return null;
    }
    return { ctx, tab, wc: tab.view.webContents, serviceKey: null };
  }

  if (entry.sourceType === 'sidebar') {
    const view = entry.serviceKey ? ctx.sidebarPanel?.views?.get(entry.serviceKey) : null;
    if (
      !view ||
      !view.webContents ||
      view.webContents.isDestroyed() ||
      view.webContents.id !== entry.wcId
    ) {
      return null;
    }
    return { ctx, tab: null, wc: view.webContents, serviceKey: entry.serviceKey };
  }

  return null;
}

function refreshEntryLabels(entry, target) {
  if (!entry || !target) return;
  if (entry.sourceType === 'tab' && target.tab) {
    entry.sourceName = clampString(target.tab.title || 'Tab', MAX_SUBTITLE_LEN) || 'Tab';
    entry.sourceUrl = clampString(formatDisplayUrl(target.tab.url || ''), MAX_URL_LEN);
    entry.favicon = typeof target.tab.favicon === 'string' ? target.tab.favicon : '';
  } else if (entry.sourceType === 'sidebar') {
    const { SIDEBAR_SERVICES, getSidebarServiceCurrentUrl } = sidebarMod();
    const svc = SIDEBAR_SERVICES[entry.serviceKey];
    entry.sourceName = clampString(svc?.title || entry.serviceKey || 'Sidebar', MAX_SUBTITLE_LEN);
    const liveUrl = getSidebarServiceCurrentUrl(target.ctx, entry.serviceKey);
    entry.sourceUrl = clampString(liveUrl || svc?.url || '', MAX_URL_LEN);
    entry.favicon = '';
  }
}

function getTabVideoState(tab) {
  if (!tab || tab.sleeping || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed()) {
    return { hasPlayingVideo: false, pipActive: false, videoTitle: '' };
  }
  const entry = sources.get(tab.view.webContents.id);
  if (!entry) {
    return { hasPlayingVideo: false, pipActive: false, videoTitle: '' };
  }
  return {
    hasPlayingVideo: Boolean(entry.hasPlayingVideo),
    pipActive: Boolean(entry.pipActive),
    videoTitle: entry.videoTitle || ''
  };
}

function isPlayerEligible(entry) {
  if (!entry) return false;
  if (entry.isPlaying || entry.audible || entry.pipActive) return true;
  if (entry.hasEverPlayed && (entry.hasMediaElement || entry.canPlayPause)) return true;
  return false;
}

function serializeSourceForClient(entry) {
  const hostLabel = getHostnameLabel(entry.sourceUrl);
  const displayTitle = entry.title || entry.videoTitle || entry.sourceName || hostLabel || 'Untitled Media';
  const displayArtist = entry.artist || (entry.title && entry.title !== entry.sourceName ? entry.sourceName : hostLabel) || '';

  return {
    wcId: entry.wcId,
    winId: entry.winId,
    sourceType: entry.sourceType,
    tabId: entry.tabId || null,
    serviceKey: entry.serviceKey || null,
    sourceName: entry.sourceName || '',
    sourceUrl: entry.sourceUrl || '',
    favicon: entry.favicon || '',
    mediaKind: entry.mediaKind || (entry.audible ? 'audible' : 'audio'),
    isPlaying: Boolean(entry.isPlaying || (!entry.hasMediaElement && entry.audible)),
    paused: Boolean(!entry.isPlaying && !(!entry.hasMediaElement && entry.audible)),
    ended: Boolean(entry.ended),
    audible: Boolean(entry.audible),
    hasPlayingVideo: Boolean(entry.hasPlayingVideo),
    pipActive: Boolean(entry.pipActive),
    currentTime: sanitizeFiniteNumber(entry.currentTime, { min: 0, fallback: 0 }),
    duration: typeof entry.duration === 'number' && Number.isFinite(entry.duration) && entry.duration > 0 ? entry.duration : null,
    isLive: Boolean(entry.isLive),
    playbackRate: sanitizeFiniteNumber(entry.playbackRate, { min: 0.1, max: 16, fallback: 1 }),
    title: displayTitle,
    artist: displayArtist,
    album: entry.album || '',
    artwork: entry.artwork || '',
    canPlayPause: Boolean(entry.canPlayPause),
    canSeek: Boolean(entry.canSeek),
    canNext: Boolean(entry.canNext),
    canPrevious: Boolean(entry.canPrevious),
    lastPlayedAt: entry.lastPlayedAt || 0,
    updatedAt: entry.updatedAt || Date.now()
  };
}

function pruneStaleSources({ broadcast = true, now = Date.now(), maxIdleMs = PAUSED_SOURCE_IDLE_TTL_MS } = {}) {
  let changed = false;
  const affectedCtxs = new Set();

  for (const [wcId, entry] of Array.from(sources.entries())) {
    const live = findEntryLiveTarget(entry);
    const isCurrentlyActive = Boolean(entry?.isPlaying || entry?.audible || entry?.pipActive);
    const idleSince = !isCurrentlyActive
      ? (entry?.pausedAt || entry?.lastPlayedAt || entry?.updatedAt || 0)
      : 0;
    const isExpiredIdle =
      !isCurrentlyActive &&
      (!entry?.hasMediaElement || (idleSince > 0 && now - idleSince > maxIdleMs));

    if (!live || isExpiredIdle) {
      sources.delete(wcId);
      changed = true;
      const ctx = windowContexts.get(entry.winId);
      if (ctx && ctx.win && !ctx.win.isDestroyed()) affectedCtxs.add(ctx);
      for (const [scope, selectedId] of manualSelectedWcId.entries()) {
        if (selectedId === wcId) manualSelectedWcId.delete(scope);
      }
    }
  }

  if (changed && broadcast) {
    for (const ctx of affectedCtxs) {
      broadcastMod().broadcastState(ctx);
    }
    schedulePlayerBroadcast();
  }
  return changed;
}

function collectScopedSources(ctx) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return [];
  const list = [];

  for (const [wcId, entry] of Array.from(sources.entries())) {
    if (ctx.incognito) {
      if (!entry.incognito || entry.winId !== ctx.win.id) continue;
    } else if (entry.incognito) {
      continue;
    }

    const live = findEntryLiveTarget(entry);
    if (!live) {
      sources.delete(wcId);
      continue;
    }
    refreshEntryLabels(entry, live);
    if (isPlayerEligible(entry)) {
      list.push(entry);
    }
  }

  list.sort((a, b) => {
    const aPlaying = a.isPlaying || (!a.hasMediaElement && a.audible) ? 1 : 0;
    const bPlaying = b.isPlaying || (!b.hasMediaElement && b.audible) ? 1 : 0;
    if (aPlaying !== bPlaying) return bPlaying - aPlaying;
    if ((b.lastPlayedAt || 0) !== (a.lastPlayedAt || 0)) {
      return (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0);
    }
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });

  if (list.length > MAX_SWITCHER_SOURCES) {
    return list.slice(0, MAX_SWITCHER_SOURCES);
  }
  return list;
}

function serializePlayerState(ctx) {
  const scoped = collectScopedSources(ctx);
  const scopeKey = getScopeKey(ctx);
  const selectedId = manualSelectedWcId.get(scopeKey);
  let activeEntry = null;

  if (selectedId !== undefined) {
    activeEntry = scoped.find((e) => e.wcId === selectedId) || null;
    if (!activeEntry) {
      manualSelectedWcId.delete(scopeKey);
    }
  }
  if (!activeEntry && scoped.length > 0) {
    activeEntry = scoped[0];
  }

  const serializedList = scoped.map(serializeSourceForClient);
  const activeSource = activeEntry ? serializeSourceForClient(activeEntry) : null;
  const hasPlayingMedia = serializedList.some((s) => s.isPlaying);

  return {
    activeSource,
    sources: serializedList,
    hasPlayingMedia
  };
}

function sendPlayerStateToWebContents(ctx, wc) {
  if (!ctx || !wc || wc.isDestroyed()) return;
  try {
    wc.send('player:update', serializePlayerState(ctx));
  } catch (_) {}
}

function broadcastPlayerStateNow() {
  if (playerBroadcastTimer) {
    clearTimeout(playerBroadcastTimer);
    playerBroadcastTimer = null;
  }
  for (const ctx of windowContexts.values()) {
    if (!ctx || !ctx.win || ctx.win.isDestroyed()) continue;
    const payload = serializePlayerState(ctx);
    if (ctx.win.webContents && !ctx.win.webContents.isDestroyed()) {
      try {
        ctx.win.webContents.send('player:update', payload);
      } catch (_) {}
    }
    const playerView = ctx.sidebarPanel?.views?.get('player');
    if (playerView && playerView.webContents && !playerView.webContents.isDestroyed()) {
      try {
        playerView.webContents.send('player:update', payload);
      } catch (_) {}
    }
  }
}

function schedulePlayerBroadcast({ immediate = false } = {}) {
  if (immediate) {
    broadcastPlayerStateNow();
    return;
  }
  if (playerBroadcastTimer) return;
  playerBroadcastTimer = setTimeout(() => {
    playerBroadcastTimer = null;
    broadcastPlayerStateNow();
  }, BROADCAST_COALESCE_MS);
}

function handleMediaReport(senderWc, rawPayload) {
  const resolved = resolveSenderSource(senderWc);
  if (!resolved) return;

  const { ctx, winId, incognito, sourceType, tab, tabId, serviceKey, serviceTitle } = resolved;
  const wcId = senderWc.id;
  const payload = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};

  if (payload.cleared) {
    const prev = sources.get(wcId);
    if (prev) {
      const hadVideoFlag = prev.hasPlayingVideo || prev.pipActive;
      sources.delete(wcId);
      const scopeKey = getScopeKey(incognito, winId);
      if (manualSelectedWcId.get(scopeKey) === wcId) {
        manualSelectedWcId.delete(scopeKey);
      }
      if (sourceType === 'tab' && hadVideoFlag) {
        broadcastMod().broadcastState(ctx);
      }
      schedulePlayerBroadcast({ immediate: true });
    }
    return;
  }

  const now = Date.now();
  const prev = sources.get(wcId);
  const prevHasPlayingVideo = Boolean(prev?.hasPlayingVideo);
  const prevPipActive = Boolean(prev?.pipActive);
  const prevVideoTitle = prev?.videoTitle || '';
  const prevWasPlaying = Boolean(prev?.isPlaying);

  const hasMediaElement = Boolean(payload.hasMediaElement);
  const hasPlayingVideo = Boolean(payload.hasPlayingVideo);
  const pipActive = Boolean(payload.pipActive);
  const isPlaying = Boolean(payload.isPlaying);
  const ended = Boolean(payload.ended);
  const isLive = Boolean(payload.isLive);

  const rawDuration = payload.duration;
  const duration =
    !isLive && typeof rawDuration === 'number' && Number.isFinite(rawDuration) && rawDuration > 0
      ? rawDuration
      : null;

  const currentTime = sanitizeFiniteNumber(payload.currentTime, {
    min: 0,
    max: duration ? duration + 1 : 86400 * 30,
    fallback: 0
  });
  const playbackRate = sanitizeFiniteNumber(payload.playbackRate, { min: 0.1, max: 16, fallback: 1 });
  const volume = sanitizeFiniteNumber(payload.volume, { min: 0, max: 1, fallback: 1 });
  const muted = Boolean(payload.muted);

  const actions = payload.supportedActions && typeof payload.supportedActions === 'object'
    ? payload.supportedActions
    : {};
  const canPlayPause = Boolean(
    hasMediaElement || actions.play || actions.pause
  );
  const canSeek = Boolean(
    !isLive && duration !== null && duration > 0 && (hasMediaElement || actions.seekto)
  );
  const canNext = Boolean(actions.nexttrack);
  const canPrevious = Boolean(actions.previoustrack);

  const title = clampString(payload.title, MAX_TITLE_LEN);
  const artist = clampString(payload.artist, MAX_SUBTITLE_LEN);
  const album = clampString(payload.album, MAX_SUBTITLE_LEN);
  const artwork = sanitizeArtworkUrl(payload.artwork);
  const videoTitle = clampString(payload.videoTitle, MAX_TITLE_LEN);
  const videoSrc = clampString(payload.videoSrc, MAX_URL_LEN);
  const mediaKind =
    payload.mediaKind === 'video' || payload.mediaKind === 'audio' ? payload.mediaKind : null;

  const resolvedAudible = Boolean(prev?.audible || tab?.audible || senderWc.isCurrentlyAudible?.());
  const hasEverPlayed = Boolean(prev?.hasEverPlayed || isPlaying || hasPlayingVideo || pipActive || resolvedAudible);
  const startedPlaying = isPlaying && !prevWasPlaying;
  const lastPlayedAt = startedPlaying
    ? now
    : isPlaying
    ? prev?.lastPlayedAt || now
    : prev?.lastPlayedAt || 0;
  const pausedAt =
    isPlaying || resolvedAudible || pipActive
      ? 0
      : prevWasPlaying || !prev?.pausedAt
      ? now
      : prev.pausedAt;

  // If this source has never played and has no playing video/PiP/audible state, do not clutter sources
  if (!hasEverPlayed && !hasPlayingVideo && !pipActive && !resolvedAudible) {
    if (prev) {
      sources.delete(wcId);
      if (sourceType === 'tab' && (prevHasPlayingVideo || prevPipActive)) {
        broadcastMod().broadcastState(ctx);
      }
      schedulePlayerBroadcast();
    }
    return;
  }

  const entry = {
    wcId,
    winId,
    incognito,
    sourceType,
    tabId,
    serviceKey,
    sourceName:
      sourceType === 'tab'
        ? clampString(tab?.title || 'Tab', MAX_SUBTITLE_LEN)
        : clampString(serviceTitle || serviceKey || 'Sidebar', MAX_SUBTITLE_LEN),
    sourceUrl:
      sourceType === 'tab'
        ? clampString(formatDisplayUrl(tab?.url || ''), MAX_URL_LEN)
        : clampString(sidebarMod().getSidebarServiceCurrentUrl(ctx, serviceKey), MAX_URL_LEN),
    favicon: sourceType === 'tab' && typeof tab?.favicon === 'string' ? tab.favicon : '',
    hasPlayingVideo,
    pipActive,
    videoTitle,
    videoSrc,
    hasMediaElement,
    mediaKind,
    isPlaying,
    paused: !isPlaying,
    ended,
    audible: Boolean(prev?.audible || tab?.audible || senderWc.isCurrentlyAudible?.()),
    hasEverPlayed,
    currentTime,
    duration,
    isLive,
    playbackRate,
    volume,
    muted,
    title,
    artist,
    album,
    artwork,
    canPlayPause,
    canSeek,
    canNext,
    canPrevious,
    lastPlayedAt,
    pausedAt,
    updatedAt: now
  };

  sources.set(wcId, entry);

  // Follow newly playing source automatically
  if (startedPlaying) {
    manualSelectedWcId.delete(getScopeKey(incognito, winId));
  }

  const videoStateChanged =
    prevHasPlayingVideo !== hasPlayingVideo ||
    prevPipActive !== pipActive ||
    (hasPlayingVideo && prevVideoTitle !== videoTitle);
  if (sourceType === 'tab' && videoStateChanged) {
    broadcastMod().broadcastState(ctx);
  }

  schedulePlayerBroadcast({ immediate: startedPlaying || prevWasPlaying !== isPlaying || videoStateChanged });
}

function handleAudibleStateChanged(ctx, { sourceType, tab = null, serviceKey = null, wcId, audible }) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed() || typeof wcId !== 'number') return;
  const now = Date.now();
  const prev = sources.get(wcId);

  if (audible) {
    if (prev) {
      const wasActive = Boolean(prev.isPlaying || (!prev.hasMediaElement && prev.audible));
      prev.audible = true;
      prev.hasEverPlayed = true;
      if (!prev.hasMediaElement) {
        prev.isPlaying = true;
        prev.paused = false;
      }
      if (!wasActive) {
        prev.lastPlayedAt = now;
        manualSelectedWcId.delete(getScopeKey(ctx));
      }
      prev.updatedAt = now;
    } else {
      const { SIDEBAR_SERVICES, getSidebarServiceCurrentUrl } = sidebarMod();
      const svc = serviceKey ? SIDEBAR_SERVICES[serviceKey] : null;
      if (svc && svc.internal) return;
      sources.set(wcId, {
        wcId,
        winId: ctx.win.id,
        incognito: Boolean(ctx.incognito),
        sourceType,
        tabId: tab ? tab.id : null,
        serviceKey: serviceKey || null,
        sourceName:
          sourceType === 'tab'
            ? clampString(tab?.title || 'Tab', MAX_SUBTITLE_LEN)
            : clampString(svc?.title || serviceKey || 'Sidebar', MAX_SUBTITLE_LEN),
        sourceUrl:
          sourceType === 'tab'
            ? clampString(formatDisplayUrl(tab?.url || ''), MAX_URL_LEN)
            : clampString(getSidebarServiceCurrentUrl(ctx, serviceKey), MAX_URL_LEN),
        favicon: sourceType === 'tab' && typeof tab?.favicon === 'string' ? tab.favicon : '',
        hasPlayingVideo: false,
        pipActive: false,
        videoTitle: '',
        videoSrc: '',
        hasMediaElement: false,
        mediaKind: 'audible',
        isPlaying: true,
        paused: false,
        ended: false,
        audible: true,
        hasEverPlayed: true,
        currentTime: 0,
        duration: null,
        isLive: false,
        playbackRate: 1,
        volume: 1,
        muted: false,
        title: '',
        artist: '',
        album: '',
        artwork: '',
        canPlayPause: false,
        canSeek: false,
        canNext: false,
        canPrevious: false,
        lastPlayedAt: now,
        updatedAt: now
      });
      manualSelectedWcId.delete(getScopeKey(ctx));
    }
    schedulePlayerBroadcast({ immediate: true });
    return;
  }

  // audible === false
  if (!prev) return;
  prev.audible = false;
  if (!prev.hasMediaElement && !prev.canPlayPause) {
    // Pure audible-only source (e.g. Web Audio without controllable media element) stopped
    sources.delete(wcId);
    const scopeKey = getScopeKey(ctx);
    if (manualSelectedWcId.get(scopeKey) === wcId) {
      manualSelectedWcId.delete(scopeKey);
    }
  }
  schedulePlayerBroadcast();
}

function removeSourceByWcId(wcId, { notifyCtx = null } = {}) {
  if (typeof wcId !== 'number') return false;
  const prev = sources.get(wcId);
  if (!prev) return false;
  const hadVideoFlag = prev.hasPlayingVideo || prev.pipActive;
  sources.delete(wcId);

  for (const [scope, selectedId] of manualSelectedWcId.entries()) {
    if (selectedId === wcId) manualSelectedWcId.delete(scope);
  }
  for (const [reqId, pending] of pendingCommands.entries()) {
    if (pending.wcId === wcId) {
      clearTimeout(pending.timer);
      pendingCommands.delete(reqId);
      pending.resolve({ ok: false, error: 'Source closed' });
    }
  }

  const ctx = notifyCtx || windowContexts.get(prev.winId);
  if (prev.sourceType === 'tab' && hadVideoFlag && ctx && ctx.win && !ctx.win.isDestroyed()) {
    broadcastMod().broadcastState(ctx);
  }
  schedulePlayerBroadcast({ immediate: true });
  return true;
}

function onTabAudioChanged(ctx, tab, audible) {
  if (!tab || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed()) return;
  handleAudibleStateChanged(ctx, {
    sourceType: 'tab',
    tab,
    wcId: tab.view.webContents.id,
    audible: Boolean(audible)
  });
}

function onTabNavigated(ctx, tab) {
  if (!tab || !tab.view || !tab.view.webContents) return;
  removeSourceByWcId(tab.view.webContents.id, { notifyCtx: ctx });
}

function onTabMetadataChanged(ctx, tab) {
  if (!tab || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed()) return;
  const entry = sources.get(tab.view.webContents.id);
  if (!entry) return;
  entry.sourceName = clampString(tab.title || 'Tab', MAX_SUBTITLE_LEN);
  entry.sourceUrl = clampString(formatDisplayUrl(tab.url || ''), MAX_URL_LEN);
  entry.favicon = typeof tab.favicon === 'string' ? tab.favicon : '';
  schedulePlayerBroadcast();
}

function onTabHibernated(ctx, tab) {
  if (!tab) return;
  const wcId = tab.view?.webContents?.id;
  if (typeof wcId === 'number') {
    removeSourceByWcId(wcId, { notifyCtx: ctx });
    return;
  }
  for (const [id, entry] of Array.from(sources.entries())) {
    if (entry.sourceType === 'tab' && entry.tabId === tab.id) {
      removeSourceByWcId(id, { notifyCtx: ctx });
    }
  }
}

function onTabClosed(ctx, tab) {
  onTabHibernated(ctx, tab);
}

function onSidebarAudioChanged(ctx, serviceKey, wcId, audible) {
  handleAudibleStateChanged(ctx, {
    sourceType: 'sidebar',
    serviceKey,
    wcId,
    audible: Boolean(audible)
  });
}

function onSidebarNavigated(ctx, _serviceKey, wcId) {
  removeSourceByWcId(wcId, { notifyCtx: ctx });
}

function onWebContentsDestroyed(wcId) {
  removeSourceByWcId(wcId);
}

function onWindowClosed(ctx) {
  if (!ctx) return;
  const winId = ctx.win?.id;
  let changed = false;
  for (const [wcId, entry] of Array.from(sources.entries())) {
    if (entry.winId === winId) {
      if (removeSourceByWcId(wcId, { notifyCtx: ctx })) {
        changed = true;
      }
    }
  }
  if (winId !== undefined) {
    manualSelectedWcId.delete(`private:${winId}`);
  }
  if (changed) {
    schedulePlayerBroadcast({ immediate: true });
  }
}

async function sendCommandToWebContents(wc, payload, { grantUserGesture = false, timeoutMs = COMMAND_TIMEOUT_MS } = {}) {
  if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) {
    return { ok: false, error: 'Target page is no longer available' };
  }

  if (grantUserGesture && typeof wc.executeJavaScript === 'function') {
    try {
      await wc.executeJavaScript('0', true);
    } catch (_) {}
  }

  if (typeof wc.isDestroyed === 'function' && wc.isDestroyed()) {
    return { ok: false, error: 'Target page closed' };
  }

  const requestId = `pcmd-${++commandSeq}-${Date.now()}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingCommands.delete(requestId);
      resolve({ ok: false, error: 'Timed out waiting for page media response' });
    }, timeoutMs);

    pendingCommands.set(requestId, { wcId: wc.id, resolve, timer });
    try {
      wc.send('player:command', { requestId, ...payload });
    } catch (err) {
      clearTimeout(timer);
      pendingCommands.delete(requestId);
      resolve({ ok: false, error: err?.message || 'Failed to message page' });
    }
  });
}

const PIP_FALLBACK_MAIN_WORLD_SCRIPT = `(() => {
  try {
    if (!document.pictureInPictureEnabled) {
      return { ok: false, errorName: 'NotSupportedError', error: 'Picture-in-Picture is not supported on this page' };
    }
    const collectVideos = (root, out, depth = 0) => {
      if (!root || depth > 4) return;
      try {
        root.querySelectorAll('video').forEach((v) => out.push(v));
        root.querySelectorAll('*').forEach((el) => {
          if (el.shadowRoot) collectVideos(el.shadowRoot, out, depth + 1);
        });
      } catch (_) {}
    };
    const videos = [];
    collectVideos(document, videos, 0);
    const playing = videos.filter((v) => !v.paused && !v.ended && v.readyState >= 1 && v.videoWidth > 0);
    playing.sort((a, b) => {
      const aDis = a.disablePictureInPicture ? 1 : 0;
      const bDis = b.disablePictureInPicture ? 1 : 0;
      if (aDis !== bDis) return aDis - bDis;
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const areaA = (ra.width * ra.height) || (a.videoWidth * a.videoHeight);
      const areaB = (rb.width * rb.height) || (b.videoWidth * b.videoHeight);
      return areaB - areaA;
    });
    const best = playing[0] || null;
    if (document.pictureInPictureElement) {
      let el = document.pictureInPictureElement;
      while (el?.shadowRoot?.pictureInPictureElement) el = el.shadowRoot.pictureInPictureElement;
      if (best && best !== el) {
        return best.requestPictureInPicture()
          .then(() => ({ ok: true, active: true }))
          .catch((e) => ({ ok: false, errorName: e?.name || 'Error', error: e?.message || 'Picture-in-Picture failed' }));
      }
      return document.exitPictureInPicture()
        .then(() => ({ ok: true, active: false }))
        .catch((e) => ({ ok: false, errorName: e?.name || 'Error', error: e?.message || 'Failed to exit Picture-in-Picture' }));
    }
    if (!best) {
      return { ok: false, errorName: 'NoVideo', error: 'No playing video found to pop out' };
    }
    if (best.disablePictureInPicture) {
      return { ok: false, errorName: 'InvalidStateError', error: 'This video does not allow Picture-in-Picture' };
    }
    return best.requestPictureInPicture()
      .then(() => ({ ok: true, active: true }))
      .catch((e) => ({ ok: false, errorName: e?.name || 'Error', error: e?.message || 'Picture-in-Picture failed' }));
  } catch (e) {
    return { ok: false, errorName: e?.name || 'Error', error: e?.message || 'Picture-in-Picture failed' };
  }
})()`;

function formatPipErrorToast(result) {
  const errName = String(result?.errorName || '');
  const rawErr = String(result?.error || '');
  if (errName === 'NoVideo' || /no playing video/i.test(rawErr)) {
    return 'No playing video found in this tab';
  }
  if (/disablePictureInPicture|does not allow/i.test(rawErr)) {
    return 'This video does not allow Picture-in-Picture';
  }
  if (errName === 'NotSupportedError' || /not supported/i.test(rawErr)) {
    return 'Picture-in-Picture is not supported on this page';
  }
  if (errName === 'InvalidStateError') {
    return 'Video is not ready for Picture-in-Picture yet';
  }
  if (rawErr) {
    return `Could not pop out video: ${rawErr.slice(0, 110)}`;
  }
  return 'Could not pop out video';
}

function sendToast(ctx, message) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed() || !message) return;
  try {
    ctx.win.webContents.send('ui:toast', message);
  } catch (_) {}
}

async function waitForTabViewVisible(ctx, tab, timeoutMs = 900) {
  const start = Date.now();
  const wc = tab?.view?.webContents;
  if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) return;

  while (Date.now() - start < timeoutMs) {
    if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) return;
    let boundsReady = ctx.activeTabId === tab.id;
    if (boundsReady && tab.view && typeof tab.view.getBounds === 'function') {
      try {
        const b = tab.view.getBounds();
        if (b && (b.width <= 1 || b.height <= 1 || b.x < 0)) {
          boundsReady = false;
        }
      } catch (_) {}
    }
    if (boundsReady) {
      if (typeof wc.executeJavaScript === 'function') {
        try {
          const remaining = Math.max(40, timeoutMs - (Date.now() - start));
          const ready = await Promise.race([
            wc.executeJavaScript(
              `new Promise((r) => requestAnimationFrame(() => r(document.visibilityState === 'visible' || !document.hidden)))`,
              false
            ),
            new Promise((r) => setTimeout(() => r(false), remaining))
          ]);
          if (ready !== false) return;
        } catch (_) {
          return;
        }
      } else {
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function triggerPopOutVideo(ctx, requestedTabId = null) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) {
    return { ok: false, error: 'No active browser window' };
  }

  const targetTabId = requestedTabId || ctx.activeTabId;
  const tab = targetTabId ? ctx.tabs.get(targetTabId) : null;
  if (!tab || tab.sleeping || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed()) {
    sendToast(ctx, 'No playing video in this tab');
    return { ok: false, error: 'No eligible tab' };
  }

  // If invoked from a background tab's context menu, activate it first and wait for the view to become visible
  if (requestedTabId && requestedTabId !== ctx.activeTabId) {
    tabsMod().switchTab(ctx, requestedTabId);
    await waitForTabViewVisible(ctx, tab, 900);
  }

  const wc = tab.view?.webContents;
  if (!wc || wc.isDestroyed()) {
    sendToast(ctx, 'No playing video in this tab');
    return { ok: false, error: 'Tab closed' };
  }

  let res = await sendCommandToWebContents(wc, { command: 'pip' }, { grantUserGesture: true });

  // Fallback: if Chromium rejected the isolated-world IPC callback for missing synchronous user gesture,
  // execute directly inside WebScopedUserGesture.
  if (!res?.ok && res?.errorName === 'NotAllowedError' && !wc.isDestroyed() && typeof wc.executeJavaScript === 'function') {
    try {
      const fallbackRes = await wc.executeJavaScript(PIP_FALLBACK_MAIN_WORLD_SCRIPT, true);
      if (fallbackRes && typeof fallbackRes === 'object') {
        res = fallbackRes;
      }
    } catch (err) {
      res = { ok: false, errorName: err?.name || 'Error', error: err?.message || 'Picture-in-Picture failed' };
    }
  }

  if (!res || !res.ok) {
    const toastMsg = formatPipErrorToast(res);
    sendToast(ctx, toastMsg);
    return { ok: false, active: false, error: toastMsg, errorName: res?.errorName || '' };
  }

  const entry = sources.get(wc.id);
  if (entry) {
    entry.pipActive = Boolean(res.active);
    entry.updatedAt = Date.now();
  }
  broadcastMod().broadcastState(ctx);
  schedulePlayerBroadcast({ immediate: true });
  sendToast(ctx, res.active ? 'Video popped out (Picture-in-Picture)' : 'Exited Picture-in-Picture');
  return { ok: true, active: Boolean(res.active) };
}

async function handlePlayerControl(ctx, payload = {}) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) {
    return { ok: false, error: 'No active window' };
  }
  const action = typeof payload?.action === 'string' ? payload.action.trim() : '';
  if (!action) return { ok: false, error: 'Missing action' };

  const scoped = collectScopedSources(ctx);
  const scopeKey = getScopeKey(ctx);

  let targetEntry = null;
  if (typeof payload.sourceWcId === 'number') {
    targetEntry = scoped.find((e) => e.wcId === payload.sourceWcId) || null;
  }
  if (!targetEntry) {
    const selectedId = manualSelectedWcId.get(scopeKey);
    if (selectedId !== undefined) {
      targetEntry = scoped.find((e) => e.wcId === selectedId) || null;
    }
  }
  if (!targetEntry && scoped.length > 0) {
    targetEntry = scoped[0];
  }

  if (!targetEntry) {
    return { ok: false, error: 'Nothing playing', state: serializePlayerState(ctx) };
  }

  if (action === 'select-source') {
    manualSelectedWcId.set(scopeKey, targetEntry.wcId);
    broadcastPlayerStateNow();
    return { ok: true, state: serializePlayerState(ctx) };
  }

  const live = findEntryLiveTarget(targetEntry);
  if (!live) {
    removeSourceByWcId(targetEntry.wcId);
    return { ok: false, error: 'Media source is no longer available', state: serializePlayerState(ctx) };
  }

  if (action === 'focus-source') {
    if (live.ctx && live.ctx.win && !live.ctx.win.isDestroyed()) {
      try {
        if (live.ctx.win.isMinimized()) live.ctx.win.restore();
        live.ctx.win.focus();
      } catch (_) {}
    }
    if (targetEntry.sourceType === 'tab' && targetEntry.tabId) {
      tabsMod().switchTab(live.ctx, targetEntry.tabId);
      return { ok: true, focused: 'tab', tabId: targetEntry.tabId };
    }
    if (targetEntry.sourceType === 'sidebar' && targetEntry.serviceKey) {
      sidebarMod().openSidebarPanel(live.ctx, targetEntry.serviceKey);
      return { ok: true, focused: 'sidebar', serviceKey: targetEntry.serviceKey };
    }
    return { ok: false, error: 'Cannot focus source' };
  }

  if (action === 'pip') {
    if (targetEntry.sourceType === 'tab' && targetEntry.tabId) {
      return await triggerPopOutVideo(live.ctx, targetEntry.tabId);
    }
    // Sidebar service with video: try PiP directly on its webContents (with main-world fallback on NotAllowedError)
    let res = await sendCommandToWebContents(live.wc, { command: 'pip' }, { grantUserGesture: true });
    if (!res?.ok && res?.errorName === 'NotAllowedError' && !live.wc.isDestroyed() && typeof live.wc.executeJavaScript === 'function') {
      try {
        const fallbackRes = await live.wc.executeJavaScript(PIP_FALLBACK_MAIN_WORLD_SCRIPT, true);
        if (fallbackRes && typeof fallbackRes === 'object') {
          res = fallbackRes;
        }
      } catch (err) {
        res = { ok: false, errorName: err?.name || 'Error', error: err?.message || 'Picture-in-Picture failed' };
      }
    }
    if (!res?.ok) {
      sendToast(ctx, formatPipErrorToast(res));
      return { ok: false, error: formatPipErrorToast(res) };
    }
    targetEntry.pipActive = Boolean(res.active);
    schedulePlayerBroadcast({ immediate: true });
    sendToast(ctx, res.active ? 'Video popped out (Picture-in-Picture)' : 'Exited Picture-in-Picture');
    return { ok: true, active: Boolean(res.active) };
  }

  if (action === 'play' || action === 'pause' || action === 'toggle-play') {
    if (!targetEntry.canPlayPause) {
      return { ok: false, error: 'Playback control not supported for this source' };
    }
    const desired =
      action === 'toggle-play' ? (targetEntry.isPlaying ? 'pause' : 'play') : action;
    const res = await sendCommandToWebContents(
      live.wc,
      { command: 'control', action: desired },
      { grantUserGesture: desired === 'play' }
    );
    if (res?.ok && typeof res.isPlaying === 'boolean') {
      targetEntry.isPlaying = res.isPlaying;
      targetEntry.paused = !res.isPlaying;
      if (typeof res.currentTime === 'number' && Number.isFinite(res.currentTime)) {
        targetEntry.currentTime = Math.max(0, res.currentTime);
      }
      if (res.isPlaying) {
        targetEntry.lastPlayedAt = Date.now();
      }
      targetEntry.updatedAt = Date.now();
      schedulePlayerBroadcast({ immediate: true });
    }
    return { ...(res || { ok: false }), state: serializePlayerState(ctx) };
  }

  if (action === 'next' || action === 'previous') {
    const supported = action === 'next' ? targetEntry.canNext : targetEntry.canPrevious;
    if (!supported) {
      return { ok: false, error: `${action === 'next' ? 'Next' : 'Previous'} track not supported by this page` };
    }
    const res = await sendCommandToWebContents(
      live.wc,
      { command: 'control', action },
      { grantUserGesture: true }
    );
    return { ...(res || { ok: false }), state: serializePlayerState(ctx) };
  }

  if (action === 'seek') {
    if (!targetEntry.canSeek) {
      return { ok: false, error: 'Seeking is not supported for this media' };
    }
    const rawSeek = Number(payload.seekTime);
    if (!Number.isFinite(rawSeek) || rawSeek < 0) {
      return { ok: false, error: 'Invalid seek time' };
    }
    const maxTime = targetEntry.duration ? Math.max(0, targetEntry.duration) : rawSeek;
    const seekTime = Math.max(0, Math.min(maxTime, rawSeek));
    const res = await sendCommandToWebContents(
      live.wc,
      { command: 'control', action: 'seek', seekTime },
      { grantUserGesture: false }
    );
    if (res?.ok) {
      targetEntry.currentTime =
        typeof res.currentTime === 'number' && Number.isFinite(res.currentTime)
          ? Math.max(0, res.currentTime)
          : seekTime;
      targetEntry.updatedAt = Date.now();
      schedulePlayerBroadcast({ immediate: true });
    }
    return { ...(res || { ok: false }), state: serializePlayerState(ctx) };
  }

  return { ok: false, error: `Unknown player action: ${action}` };
}

function registerPlayerIpcHandlers(handleInternal) {
  if (!ipcRegistered) {
    ipcRegistered = true;

    // Untrusted web tab / sidebar service preload -> main (main frame + known managed view only)
    ipcMain.on('media:report', (event, payload) => {
      if (!event || !event.sender || !event.senderFrame) return;
      if (event.senderFrame !== event.sender.mainFrame) return;
      handleMediaReport(event.sender, payload);
    });

    ipcMain.on('player:command-result', (event, payload) => {
      if (!event || !event.sender || !payload || typeof payload !== 'object') return;
      const reqId = typeof payload.requestId === 'string' ? payload.requestId : '';
      if (!reqId || !pendingCommands.has(reqId)) return;
      const pending = pendingCommands.get(reqId);
      if (pending.wcId !== event.sender.id) return;
      clearTimeout(pending.timer);
      pendingCommands.delete(reqId);
      pending.resolve(payload);
    });
  }

  // Strictly internal UI -> main
  handleInternal('video:pop-out', async (e, tabId) => {
    const ctx = broadcastMod().getCtxFromSender(e.sender);
    return await triggerPopOutVideo(ctx, typeof tabId === 'string' && tabId ? tabId : null);
  });

  handleInternal('player:get-state', (e) => {
    const ctx = broadcastMod().getCtxFromSender(e.sender);
    return serializePlayerState(ctx);
  });

  handleInternal('player:control', async (e, payload) => {
    const ctx = broadcastMod().getCtxFromSender(e.sender);
    return await handlePlayerControl(ctx, payload || {});
  });
}

function _resetForTests() {
  if (playerBroadcastTimer) {
    clearTimeout(playerBroadcastTimer);
    playerBroadcastTimer = null;
  }
  for (const pending of pendingCommands.values()) {
    clearTimeout(pending.timer);
  }
  pendingCommands.clear();
  sources.clear();
  manualSelectedWcId.clear();
}

module.exports = {
  PAUSED_SOURCE_IDLE_TTL_MS,
  MAX_SWITCHER_SOURCES,
  sanitizeArtworkUrl,
  getTabVideoState,
  serializePlayerState,
  sendPlayerStateToWebContents,
  broadcastPlayerStateNow,
  pruneStaleSources,
  handleMediaReport,
  onTabAudioChanged,
  onTabNavigated,
  onTabMetadataChanged,
  onTabHibernated,
  onTabClosed,
  onSidebarAudioChanged,
  onSidebarNavigated,
  onWebContentsDestroyed,
  onWindowClosed,
  triggerPopOutVideo,
  handlePlayerControl,
  registerPlayerIpcHandlers,
  _resetForTests
};
