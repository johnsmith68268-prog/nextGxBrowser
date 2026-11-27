const path = require('path');
const {
  NEW_TAB_FILE_URL,
  CORNER_FILE_URL,
  WEBUI_FILE_URL,
  ONBOARDING_FILE_URL,
  SPLIT_PICKER_FILE_URL,
  ERROR_PAGE_FILE_URL,
  state
} = require('./core');
const {
  isNewTabUrl,
  isCornerUrl,
  isWebUiUrl,
  isOnboardingUrl,
  isSplitPickerUrl,
  isErrorPageUrl
} = require('./utils');

function getFailedUrlFromErrorPage(urlStr) {
  if (!isErrorPageUrl(urlStr)) return '';
  try {
    const u = new URL(urlStr);
    return u.searchParams.get('url') || '';
  } catch (_) {
    return '';
  }
}

function formatFailedTabTitle(failedUrl) {
  if (!failedUrl || typeof failedUrl !== 'string') return 'Failed to load';
  try {
    const u = new URL(failedUrl);
    if (u.host) return `${u.host} — Failed to load`;
    if (u.protocol === 'file:') {
      const base = path.basename(decodeURIComponent(u.pathname || ''));
      if (base) return `${base} — Failed to load`;
    }
  } catch (_) {}
  return 'Failed to load';
}

function buildErrorPageUrl({ failedUrl, errorCode, errorDescription }, ctx) {
  const u = new URL(ERROR_PAGE_FILE_URL);
  u.searchParams.set('url', failedUrl || '');
  u.searchParams.set('code', String(errorCode ?? ''));
  u.searchParams.set('desc', String(errorDescription || ''));
  const theme = state.storage?.getSettings?.(ctx?.profileId).theme || 'gx-violet';
  u.searchParams.set('theme', theme);
  if (ctx?.incognito) {
    u.searchParams.set('incognito', '1');
  }
  return u.toString();
}

function formatDisplayUrl(rawUrl) {
  if (isNewTabUrl(rawUrl)) return 'nextgx://newtab';
  if (isCornerUrl(rawUrl)) return 'nextgx://corner';
  if (isOnboardingUrl(rawUrl)) return 'nextgx://welcome';
  if (isSplitPickerUrl(rawUrl)) return 'nextgx://split-picker';
  if (isWebUiUrl(rawUrl)) {
    const hash = (rawUrl.split('#')[1] || 'history').toLowerCase();
    if (hash === 'passwords') return 'nextgx://passwords';
    return `nextgx://${hash}`;
  }
  if (isErrorPageUrl(rawUrl)) {
    return getFailedUrlFromErrorPage(rawUrl) || '';
  }
  return rawUrl || '';
}

function buildSearchUrl(template, query) {
  const t =
    typeof template === 'string' && template.includes('%s')
      ? template
      : 'https://www.google.com/search?q=%s';
  return t.replace('%s', encodeURIComponent(query));
}

function resolveSearchEngineMeta(settingsOverride = null) {
  const settings = settingsOverride || (state.storage ? state.storage.getSettings() : {});
  const engines = Array.isArray(settings?.searchEngines) ? settings.searchEngines : [];
  const chosenId = settings?.searchEngine || 'google';
  const match = engines.find((e) => e && e.id === chosenId && !e.siteSearch);
  if (match && typeof match.url === 'string' && match.url.includes('%s')) {
    return {
      id: match.id,
      name: match.name || match.id,
      template: match.url,
      buildUrl: (q) => buildSearchUrl(match.url, q)
    };
  }
  if (chosenId === 'duckduckgo') {
    return { id: 'duckduckgo', name: 'DuckDuckGo', template: 'https://duckduckgo.com/?q=%s', buildUrl: (q) => buildSearchUrl('https://duckduckgo.com/?q=%s', q) };
  }
  if (chosenId === 'bing') {
    return { id: 'bing', name: 'Bing', template: 'https://www.bing.com/search?q=%s', buildUrl: (q) => buildSearchUrl('https://www.bing.com/search?q=%s', q) };
  }
  if (chosenId === 'brave') {
    return { id: 'brave', name: 'Brave Search', template: 'https://search.brave.com/search?q=%s', buildUrl: (q) => buildSearchUrl('https://search.brave.com/search?q=%s', q) };
  }
  if (chosenId === 'ecosia') {
    return { id: 'ecosia', name: 'Ecosia', template: 'https://www.ecosia.org/search?q=%s', buildUrl: (q) => buildSearchUrl('https://www.ecosia.org/search?q=%s', q) };
  }
  return { id: 'google', name: 'Google', template: 'https://www.google.com/search?q=%s', buildUrl: (q) => buildSearchUrl('https://www.google.com/search?q=%s', q) };
}

function isValidIpv4Host(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  for (let i = 1; i <= 4; i++) {
    const n = Number(m[i]);
    if (n < 0 || n > 255) return false;
  }
  return true;
}

function splitBareAuthority(trimmed) {
  const m = /^(\[[0-9a-fA-F:]+\]|[^/?#\s:]+)(?::(\d{1,5}))?([/?#].*)?$/.exec(trimmed);
  if (!m) return null;
  if (m[2]) {
    const port = Number(m[2]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  }
  return { host: m[1].toLowerCase(), port: m[2] || '', rest: m[3] || '' };
}

function isLocalOrPrivateAuthority(host) {
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '[::1]' ||
    host === '[::]' ||
    /^\[(fc|fd|fe[89ab])[0-9a-f:]*\]$/i.test(host)
  ) {
    return true;
  }
  if (!isValidIpv4Host(host)) return false;
  const parts = host.split('.').map(Number);
  return (
    parts[0] === 0 ||
    parts[0] === 127 ||
    parts[0] === 10 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
  );
}

function isDomainOrIpAuthority(host) {
  if (host.startsWith('[') && host.endsWith(']')) return true;
  if (isValidIpv4Host(host)) return true;
  if (host.startsWith('-') || host.endsWith('-')) return false;
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/i.test(host);
}

function isUrlLikeInput(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  if (/^(https?:\/\/|chrome-extension:\/\/|file:\/\/|view-source:|data:|about:|blob:|(?:nextgx|chrome|gx):\/\/)/i.test(trimmed)) {
    return true;
  }
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) return true;
  const auth = splitBareAuthority(trimmed);
  if (!auth) return false;
  return isLocalOrPrivateAuthority(auth.host) || isDomainOrIpAuthority(auth.host);
}

function resolveNavigateInput(input, settingsOverride = null) {
  const trimmed = String(input || '').trim();
  if (
    !trimmed ||
    trimmed === 'nextgx://newtab' ||
    trimmed === 'gx://newtab' ||
    trimmed === 'chrome://newtab' ||
    trimmed === 'about:newtab'
  ) {
    return NEW_TAB_FILE_URL;
  }
  if (/^about:blank$/i.test(trimmed)) {
    return 'about:blank';
  }
  const internalMatch = trimmed.match(/^(?:nextgx|chrome|gx):\/\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?([?#].*)?$/i);
  if (internalMatch) {
    let page = internalMatch[1].toLowerCase();
    const sub = internalMatch[2] ? internalMatch[2].toLowerCase() : '';
    const suffix = internalMatch[3] || '';
    if (page === 'corner' || page === 'gx-corner' || page === 'gxcorner') {
      return CORNER_FILE_URL;
    }
    if (page === 'welcome' || page === 'setup' || page === 'onboarding') {
      return ONBOARDING_FILE_URL;
    }
    if (page === 'split-picker' || page === 'split') {
      return SPLIT_PICKER_FILE_URL;
    }
    if (page === 'password-manager') page = 'passwords';
    if (page === 'privacy-dashboard') page = 'privacy';
    if (['history', 'downloads', 'bookmarks', 'passwords', 'privacy', 'extensions', 'settings'].includes(page)) {
      if (page === 'settings' && sub) {
        return `${WEBUI_FILE_URL}#settings/${sub}`;
      }
      if (suffix.startsWith('#') && page === 'settings') {
        return `${WEBUI_FILE_URL}#settings/${suffix.slice(1)}`;
      }
      return `${WEBUI_FILE_URL}#${page}`;
    }
    return NEW_TAB_FILE_URL;
  }
  if (!/\s/.test(trimmed) && /^(https?:\/\/|chrome-extension:\/\/|file:\/\/|view-source:https?:\/\/|data:|blob:|about:)/i.test(trimmed)) {
    return trimmed;
  }
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) {
    try {
      const { pathToFileURL } = require('url');
      return pathToFileURL(trimmed).toString();
    } catch (_) {}
  }

  if (!/\s/.test(trimmed)) {
    const auth = splitBareAuthority(trimmed);
    if (auth) {
      if (isLocalOrPrivateAuthority(auth.host)) return `http://${trimmed}`;
      if (isDomainOrIpAuthority(auth.host)) return `https://${trimmed}`;
    }
  }

  const settings = settingsOverride || (state.storage ? state.storage.getSettings() : {});
  const engines = Array.isArray(settings?.searchEngines) ? settings.searchEngines : [];
  const shortcutMode = settings?.searchShortcutMode === 'tab' ? 'tab' : 'space-or-tab';
  const kwMatch =
    shortcutMode === 'tab'
      ? /^([^\s\t]+)\t+([\s\S]+)$/.exec(trimmed)
      : /^([^\s\t]+)[\s\t]+([\s\S]+)$/.exec(trimmed);
  if (kwMatch) {
    const keyword = kwMatch[1].toLowerCase();
    const query = kwMatch[2].trim();
    const kwEngine = engines.find(
      (e) => e && typeof e.keyword === 'string' && e.keyword && e.keyword.toLowerCase() === keyword
    );
    if (kwEngine && query) {
      return buildSearchUrl(kwEngine.url, query);
    }
  }
  return resolveSearchEngineMeta(settings).buildUrl(trimmed);
}

function getConfiguredHomepageUrl() {
  const raw = state.storage?.getSettings?.().homepageUrl;
  const check = state.storage?.validateHomepageUrl ? state.storage.validateHomepageUrl(raw) : { ok: false, url: '' };
  return check.ok && check.url ? check.url : 'nextgx://newtab';
}

module.exports = {
  getFailedUrlFromErrorPage,
  formatFailedTabTitle,
  buildErrorPageUrl,
  formatDisplayUrl,
  buildSearchUrl,
  resolveSearchEngineMeta,
  isUrlLikeInput,
  resolveNavigateInput,
  getConfiguredHomepageUrl
};
