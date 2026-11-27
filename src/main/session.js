const path = require('path');
const { windowContexts, state } = require('./core');
const {
  isNewTabUrl,
  isCornerUrl,
  isWebUiUrl,
  isErrorPageUrl,
  resolveInternalUiFile
} = require('./utils');
const {
  formatDisplayUrl,
  getFailedUrlFromErrorPage
} = require('./navigation');
const splitViewMod = () => require('./splitview');

const RESTORABLE_INTERNAL_PAGES = new Set([
  'newtab',
  'corner',
  'history',
  'downloads',
  'bookmarks',
  'passwords',
  'privacy',
  'extensions',
  'settings'
]);

// File extensions commonly served as direct binary/archive/installer/media downloads.
// Combined with a completed-download match in storage so normal web pages are never skipped.
const DIRECT_DOWNLOAD_EXTENSIONS = new Set([
  '.bin',
  '.exe',
  '.msi',
  '.msix',
  '.dmg',
  '.pkg',
  '.deb',
  '.rpm',
  '.appimage',
  '.apk',
  '.zip',
  '.tar',
  '.gz',
  '.tgz',
  '.bz2',
  '.xz',
  '.7z',
  '.rar',
  '.iso',
  '.img',
  '.cab',
  '.jar',
  '.whl',
  '.crx',
  '.xpi',
  '.torrent',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.csv',
  '.mp3',
  '.wav',
  '.flac',
  '.mp4',
  '.mkv',
  '.avi'
]);

/**
 * Conservative heuristic (T-4) to prevent session restore from re-triggering
 * duplicate downloads for tabs left open on direct file URLs:
 * returns true only when BOTH:
 *  1) the http(s) URL's pathname ends in a known downloadable file extension, AND
 *  2) the same URL already appears in the downloads store with state === 'completed'.
 */
function isDirectDownloadRestoreUrl(rawUrl, profileId) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false;
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (_) {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  const ext = path.posix.extname(parsed.pathname || '').toLowerCase();
  if (!ext || !DIRECT_DOWNLOAD_EXTENSIONS.has(ext)) return false;

  const downloads = state.storage && typeof state.storage.getDownloads === 'function'
    ? state.storage.getDownloads(profileId)
    : [];
  if (!Array.isArray(downloads) || downloads.length === 0) return false;

  const targetHref = parsed.href;
  const targetRaw = rawUrl.trim();
  return downloads.some((entry) => {
    if (!entry || entry.state !== 'completed' || typeof entry.url !== 'string') return false;
    const entryRaw = entry.url.trim();
    if (entryRaw === targetRaw || entryRaw === targetHref) return true;
    try {
      return new URL(entryRaw).href === targetHref;
    } catch (_) {
      return false;
    }
  });
}

function normalizeInternalPageUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  const m = trimmed.match(/^(?:nextgx|gx|chrome):\/\/([a-z0-9-]+)\/?$/i);
  if (!m) return '';
  let page = m[1].toLowerCase();
  if (page === 'password-manager') page = 'passwords';
  if (page === 'privacy-dashboard') page = 'privacy';
  if (RESTORABLE_INTERNAL_PAGES.has(page)) {
    return `nextgx://${page}`;
  }
  return '';
}

function getPersistableTabUrl(tab) {
  if (!tab || tab.incognito) return '';
  if (tab.isSplitPicker || require('./utils').isSplitPickerUrl(tab.url)) return '';
  const rawUrl = typeof tab.url === 'string' ? tab.url.trim() : '';
  if (!rawUrl || rawUrl === 'about:blank') return 'nextgx://newtab';

  if (isNewTabUrl(rawUrl)) return 'nextgx://newtab';
  if (isCornerUrl(rawUrl)) return 'nextgx://corner';

  if (isWebUiUrl(rawUrl)) {
    return normalizeInternalPageUrl(formatDisplayUrl(rawUrl)) || 'nextgx://newtab';
  }

  if (isErrorPageUrl(rawUrl)) {
    const failed = (tab.failedUrl || getFailedUrlFromErrorPage(rawUrl) || '').trim();
    if (failed && /^https?:\/\//i.test(failed)) {
      try {
        const u = new URL(failed);
        if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname) {
          return u.toString();
        }
      } catch (_) {}
    }
    return 'nextgx://newtab';
  }

  const internal = normalizeInternalPageUrl(rawUrl);
  if (internal) return internal;

  if (rawUrl.startsWith('chrome-error://') || resolveInternalUiFile(rawUrl)) {
    return 'nextgx://newtab';
  }

  try {
    const u = new URL(rawUrl);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return u.hostname ? rawUrl : 'nextgx://newtab';
    }
    if (u.protocol === 'file:') {
      return rawUrl;
    }
  } catch (_) {}

  return 'nextgx://newtab';
}

function getPersistableTabTitle(tab, persistUrl) {
  if (persistUrl === 'nextgx://newtab') return 'Start Page';
  if (persistUrl === 'nextgx://corner') return 'GX Corner';
  const rawTitle = typeof tab?.title === 'string' ? tab.title.trim() : '';
  if (rawTitle && rawTitle !== 'Loading...') {
    return rawTitle.slice(0, 300);
  }
  return persistUrl;
}

function sanitizeRestorableTabUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';

  const internal = normalizeInternalPageUrl(trimmed);
  if (internal) return internal;

  if (trimmed.startsWith('chrome-error://')) return '';

  if (resolveInternalUiFile(trimmed)) {
    if (require('./utils').isSplitPickerUrl(trimmed)) return '';
    if (isNewTabUrl(trimmed)) return 'nextgx://newtab';
    if (isCornerUrl(trimmed)) return 'nextgx://corner';
    if (isWebUiUrl(trimmed)) {
      return normalizeInternalPageUrl(formatDisplayUrl(trimmed)) || 'nextgx://newtab';
    }
    if (isErrorPageUrl(trimmed)) {
      const failed = getFailedUrlFromErrorPage(trimmed);
      if (failed && /^https?:\/\//i.test(failed)) {
        try {
          const u = new URL(failed);
          if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname) {
            return u.toString();
          }
        } catch (_) {}
      }
      return 'nextgx://newtab';
    }
    return 'nextgx://newtab';
  }

  try {
    const u = new URL(trimmed);
    if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname) {
      return trimmed;
    }
    if (u.protocol === 'file:') {
      return trimmed;
    }
  } catch (_) {}

  return '';
}

function serializeWindowForSession(ctx) {
  if (!ctx || ctx.incognito) return null;
  if (!ctx.sessionReady && ctx.pendingRestoreTabs) {
    return ctx.pendingRestoreTabs;
  }
  if (!ctx.sessionReady) return null;

  const tabs = [];
  let activeTabIndex = 0;
  const tabIdToIndex = new Map();

  for (const id of ctx.tabOrder) {
    const tab = ctx.tabs.get(id);
    if (!tab || tab.incognito || tab.isSplitPicker || require('./utils').isSplitPickerUrl(tab.url)) continue;
    const url = getPersistableTabUrl(tab);
    if (!url) continue;
    const idx = tabs.length;
    tabIdToIndex.set(id, idx);
    if (id === ctx.activeTabId) {
      activeTabIndex = idx;
    }
    const pinned = Boolean(tab.pinned);
    tabs.push({
      url,
      title: getPersistableTabTitle(tab, url),
      pinned,
      workspaceId: tab.workspaceId || 'default',
      groupId: pinned ? null : tab.groupId || null
    });
  }

  if (tabs.length === 0) return null;

  const workspaceActiveTabIndices = {};
  if (ctx.workspaceLastActiveTab instanceof Map) {
    for (const [wsId, lastTabId] of ctx.workspaceLastActiveTab.entries()) {
      if (tabIdToIndex.has(lastTabId)) {
        workspaceActiveTabIndices[wsId] = tabIdToIndex.get(lastTabId);
      }
    }
  }

  const activeWorkspaceId = ctx.activeWorkspaceId || 'default';
  const workspaceSplits = splitViewMod().serializeSplitsForSession(ctx, tabIdToIndex);
  const activeSplit = workspaceSplits[activeWorkspaceId] || null;
  const windowData = {
    activeWorkspaceId,
    activeTabIndex: Math.max(0, Math.min(tabs.length - 1, activeTabIndex)),
    workspaceActiveTabIndices,
    tabs
  };
  if (Object.keys(workspaceSplits).length > 0) {
    windowData.workspaceSplits = workspaceSplits;
  }
  if (activeSplit) {
    windowData.split = activeSplit;
  }
  return windowData;
}

function collectNormalWindowSessions({ excludeWinId = null, profileId = null } = {}) {
  const windows = [];
  for (const [id, ctx] of windowContexts.entries()) {
    if (excludeWinId !== null && id === excludeWinId) continue;
    if (!ctx || ctx.incognito || ctx.skipSessionSave) continue;
    if (profileId !== null && (ctx.profileId || 'default') !== profileId) continue;
    if (!ctx.win || ctx.win.isDestroyed()) continue;
    const winData = serializeWindowForSession(ctx);
    if (winData && Array.isArray(winData.tabs) && winData.tabs.length > 0) {
      windows.push(winData);
    }
  }
  return windows;
}

function cancelScheduledSessionSave() {
  if (state.sessionSaveTimer) {
    clearTimeout(state.sessionSaveTimer);
    state.sessionSaveTimer = null;
  }
}

function saveSessionNow({ excludeWinId = null, allowEmpty = false, profileId = null } = {}) {
  if (!state.storage) return;
  cancelScheduledSessionSave();
  if (profileId !== null) {
    const windows = collectNormalWindowSessions({ excludeWinId, profileId });
    if (windows.length === 0 && !allowEmpty) return;
    state.storage.saveSession({ windows }, profileId);
    return;
  }
  const byProfile = new Map();
  for (const [id, ctx] of windowContexts.entries()) {
    if (excludeWinId !== null && id === excludeWinId) continue;
    if (!ctx || ctx.incognito || ctx.skipSessionSave) continue;
    if (!ctx.win || ctx.win.isDestroyed()) continue;
    const pid = ctx.profileId || 'default';
    const winData = serializeWindowForSession(ctx);
    if (winData && Array.isArray(winData.tabs) && winData.tabs.length > 0) {
      if (!byProfile.has(pid)) byProfile.set(pid, []);
      byProfile.get(pid).push(winData);
    }
  }
  if (byProfile.size === 0) {
    if (allowEmpty) {
      state.storage.saveSession({ windows: [] });
    }
    return;
  }
  for (const [pid, windows] of byProfile.entries()) {
    state.storage.saveSession({ windows }, pid);
  }
}

function scheduleSessionSave(ctx) {
  if (!state.storage || state.isAppQuitting) return;
  if (ctx && (ctx.incognito || !ctx.sessionReady || ctx.restoringSession)) return;
  cancelScheduledSessionSave();
  state.sessionSaveTimer = setTimeout(() => {
    state.sessionSaveTimer = null;
    if (!state.isAppQuitting) {
      saveSessionNow();
    }
  }, 300);
}

module.exports = {
  RESTORABLE_INTERNAL_PAGES,
  normalizeInternalPageUrl,
  getPersistableTabUrl,
  getPersistableTabTitle,
  sanitizeRestorableTabUrl,
  isDirectDownloadRestoreUrl,
  serializeWindowForSession,
  collectNormalWindowSessions,
  cancelScheduledSessionSave,
  saveSessionNow,
  scheduleSessionSave
};
