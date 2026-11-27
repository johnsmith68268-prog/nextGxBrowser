const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const {
  UI_DIR,
  NEW_TAB_FILE,
  CORNER_FILE,
  WEBUI_FILE,
  ONBOARDING_FILE,
  SPLIT_PICKER_FILE,
  ERROR_PAGE_FILE,
  PLAYER_PANEL_FILE,
  NEW_TAB_FILE_URL,
  CORNER_FILE_URL,
  WEBUI_FILE_URL,
  ONBOARDING_FILE_URL,
  SPLIT_PICKER_FILE_URL,
  ERROR_PAGE_FILE_URL,
  PLAYER_PANEL_FILE_URL,
  state
} = require('./core');

function normalizePathForCompare(p) {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

function isPathInsideDir(baseDir, candidatePath) {
  const rel = path.relative(baseDir, candidatePath);
  return Boolean(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

function resolveInternalUiFile(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'file:') return null;
    if (parsed.hostname && parsed.hostname !== 'localhost') return null;
    const resolved = path.resolve(fileURLToPath(parsed));
    if (!isPathInsideDir(UI_DIR, resolved)) return null;
    return resolved;
  } catch (_) {
    return null;
  }
}

function isInternalUiSender(event) {
  if (!event || !event.senderFrame || !event.sender) return false;
  if (event.senderFrame !== event.sender.mainFrame) return false;
  return Boolean(resolveInternalUiFile(event.senderFrame.url));
}

function resolveSafeDownloadPath(targetPath) {
  if (typeof targetPath !== 'string' || !targetPath || targetPath.includes('\0')) return null;
  if (!path.isAbsolute(targetPath)) return null;

  const downloadsDir = path.resolve(app.getPath('downloads'));
  const resolved = path.resolve(targetPath);
  if (!isPathInsideDir(downloadsDir, resolved)) return null;

  try {
    const realDownloads = fs.realpathSync(downloadsDir);
    try {
      const realTarget = fs.realpathSync(resolved);
      if (!isPathInsideDir(realDownloads, realTarget)) return null;
      return realTarget;
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        try {
          if (fs.lstatSync(resolved).isSymbolicLink()) return null;
        } catch (_) { }
        try {
          const realParent = fs.realpathSync(path.dirname(resolved));
          if (
            normalizePathForCompare(realParent) !== normalizePathForCompare(realDownloads) &&
            !isPathInsideDir(realDownloads, realParent)
          ) {
            return null;
          }
        } catch (_) { }
        return resolved;
      }
      return null;
    }
  } catch (_) {
    return null;
  }
}

function normalizeAutofillHost(raw) {
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
    if (u.port && (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1')) {
      return `${host}:${u.port}`;
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
  const current = normalizeAutofillHost(pageHost);
  const saved = normalizeAutofillHost(savedSite);
  if (!current || !saved) return false;
  // Exact normalized host match only (normalizeAutofillHost already normalizes www. apex)
  // Prevents credential leakage across untrusted subdomains on shared hosting (e.g. *.github.io).
  return current === saved;
}

const MAX_FAVICON_DATA_URI_LEN = 32 * 1024;
const SAFE_DATA_FAVICON_RE = /^data:image\/(?:png|jpeg|jpg|webp|gif|x-icon|vnd\.microsoft\.icon);base64,[a-z0-9+/=]+$/i;

function sanitizeFaviconUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return '';
  if (/^data:/i.test(trimmed)) {
    if (trimmed.length > MAX_FAVICON_DATA_URI_LEN) return '';
    return SAFE_DATA_FAVICON_RE.test(trimmed) ? trimmed : '';
  }
  if (trimmed.length > 2048) return '';
  try {
    const u = new URL(trimmed);
    if (u.protocol === 'https:' || u.protocol === 'http:') {
      return u.toString();
    }
  } catch (_) { }
  return '';
}

function attachInternalNavigationGuard(wc) {
  if (!wc || wc.isDestroyed?.()) return;
  if (wc._nxInternalGuardAttached) return;
  wc._nxInternalGuardAttached = true;
  try {
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  } catch (_) { }
  wc.on('will-navigate', (event, targetUrl) => {
    if (!resolveInternalUiFile(targetUrl)) {
      event.preventDefault();
    }
  });
}

function matchesInternalUiPage(urlStr, targetFile, mockPathname) {
  if (typeof urlStr !== 'string' || !urlStr.startsWith('file:')) return false;
  const resolved = resolveInternalUiFile(urlStr);
  if (resolved) {
    return normalizePathForCompare(resolved) === normalizePathForCompare(targetFile);
  }
  try {
    const u = new URL(urlStr);
    if (u.protocol === 'file:' && !u.hostname && u.pathname === mockPathname) {
      return true;
    }
  } catch (_) {}
  return false;
}

function isNewTabUrl(urlStr) {
  if (!urlStr) return true;
  if (typeof urlStr !== 'string') return false;
  return (
    urlStr === 'nextgx://newtab' ||
    urlStr === 'gx://newtab' ||
    urlStr === 'chrome://newtab' ||
    matchesInternalUiPage(urlStr, NEW_TAB_FILE, '/src/ui/newtab.html')
  );
}

function isCornerUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  return (
    urlStr === 'nextgx://corner' ||
    urlStr === 'gx://corner' ||
    urlStr === 'chrome://corner' ||
    urlStr === 'nextgx://corner/' ||
    urlStr === 'gx://corner/' ||
    urlStr === 'chrome://corner/' ||
    matchesInternalUiPage(urlStr, CORNER_FILE, '/src/ui/corner.html')
  );
}

function isWebUiUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  return matchesInternalUiPage(urlStr, WEBUI_FILE, '/src/ui/chrome-webui.html');
}

function isOnboardingUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  return (
    urlStr === 'nextgx://welcome' ||
    urlStr === 'nextgx://setup' ||
    urlStr === 'nextgx://onboarding' ||
    matchesInternalUiPage(urlStr, ONBOARDING_FILE, '/src/ui/onboarding.html')
  );
}

function isSplitPickerUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  return (
    urlStr === 'nextgx://split-picker' ||
    urlStr === 'nextgx://split' ||
    matchesInternalUiPage(urlStr, SPLIT_PICKER_FILE, '/src/ui/split-picker.html')
  );
}

function isErrorPageUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  return matchesInternalUiPage(urlStr, ERROR_PAGE_FILE, '/src/ui/error.html');
}

function isPlayerPanelUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  return matchesInternalUiPage(urlStr, PLAYER_PANEL_FILE, '/src/ui/player.html');
}

function getInternalUiQuery(incognito = false, profileId) {
  const s = state.storage?.getSettings?.(profileId) || {};
  const theme = s.theme || 'gx-violet';
  const bookmarksBar = s.showBookmarksBar === false ? '0' : '1';
  return incognito ? { theme, bookmarksBar, incognito: '1' } : { theme, bookmarksBar };
}

function appendInternalUrlParams(rawUrl, ctx) {
  if (!isNewTabUrl(rawUrl) && !isCornerUrl(rawUrl) && !isWebUiUrl(rawUrl) && !isOnboardingUrl(rawUrl) && !isSplitPickerUrl(rawUrl) && !isErrorPageUrl(rawUrl)) return rawUrl;
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'file:') return rawUrl;
    const theme = state.storage?.getSettings?.(ctx?.profileId).theme || 'gx-violet';
    u.searchParams.set('theme', theme);
    if (ctx?.incognito) {
      u.searchParams.set('incognito', '1');
    } else {
      u.searchParams.delete('incognito');
    }
    return u.toString();
  } catch (_) {
    return rawUrl;
  }
}

function getOriginForUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.origin;
  } catch (_) { }
  return '';
}

function detectFileCategory(filename) {
  const ext = path.extname(filename || '').toLowerCase().replace('.', '');
  if (['mp4', 'mkv', 'webm', 'mp3', 'wav', 'flac', 'ogg', 'png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'media';
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv'].includes(ext)) return 'documents';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(ext)) return 'archives';
  if (['exe', 'msi', 'msix', 'deb', 'rpm', 'appimage', 'dmg', 'apk'].includes(ext)) return 'apps';
  return 'other';
}

module.exports = {
  normalizePathForCompare,
  isPathInsideDir,
  resolveInternalUiFile,
  isInternalUiSender,
  resolveSafeDownloadPath,
  normalizeAutofillHost,
  isIpAddress,
  isAutofillHostMatch,
  isNewTabUrl,
  isCornerUrl,
  isWebUiUrl,
  isOnboardingUrl,
  isSplitPickerUrl,
  isErrorPageUrl,
  isPlayerPanelUrl,
  getInternalUiQuery,
  appendInternalUrlParams,
  getOriginForUrl,
  detectFileCategory,
  sanitizeFaviconUrl,
  attachInternalNavigationGuard
};
