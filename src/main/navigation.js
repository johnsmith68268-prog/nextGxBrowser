const path = require('path');
const {
  NEW_TAB_FILE_URL,
  CORNER_FILE_URL,
  WEBUI_FILE_URL,
  ERROR_PAGE_FILE_URL,
  state
} = require('./core');
const {
  isNewTabUrl,
  isCornerUrl,
  isWebUiUrl,
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

function resolveNavigateInput(input) {
  const trimmed = (input || '').trim();
  if (
    !trimmed ||
    trimmed === 'nextgx://newtab' ||
    trimmed === 'gx://newtab' ||
    trimmed === 'chrome://newtab' ||
    trimmed === 'about:newtab'
  ) {
    return NEW_TAB_FILE_URL;
  }
  const internalMatch = trimmed.match(/^(?:nextgx|chrome|gx):\/\/([a-z0-9-]+)\/?$/i);
  if (internalMatch) {
    let page = internalMatch[1].toLowerCase();
    if (page === 'corner' || page === 'gx-corner' || page === 'gxcorner') {
      return CORNER_FILE_URL;
    }
    if (page === 'password-manager') page = 'passwords';
    if (page === 'privacy-dashboard') page = 'privacy';
    if (['history', 'downloads', 'bookmarks', 'passwords', 'privacy', 'extensions', 'settings'].includes(page)) {
      return `${WEBUI_FILE_URL}#${page}`;
    }
  }
  if (/^(https?:\/\/|chrome-extension:\/\/|file:\/\/|view-source:|data:)/i.test(trimmed)) return trimmed;
  const isDomainOrIp =
    /^(localhost(:\d+)?|(\d{1,3}\.){3}\d{1,3}(:\d+)?|([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,})(\/.*)?$/i.test(
      trimmed
    ) && !trimmed.includes(' ');
  if (isDomainOrIp) return `https://${trimmed}`;

  const settings = state.storage.getSettings();
  const q = encodeURIComponent(trimmed);
  if (settings.searchEngine === 'duckduckgo') return `https://duckduckgo.com/?q=${q}`;
  if (settings.searchEngine === 'bing') return `https://www.bing.com/search?q=${q}`;
  return `https://www.google.com/search?q=${q}`;
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
  resolveNavigateInput,
  getConfiguredHomepageUrl
};
