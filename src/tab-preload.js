const { contextBridge, ipcRenderer } = require('electron');

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
    onSettingsUpdate: (cb) => ipcRenderer.on('settings:update', (_e, data) => cb(data))
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
    // Passwords & Autofill
    getPasswords: () => ipcRenderer.invoke('passwords:get'),
    addPassword: (entry) => ipcRenderer.invoke('passwords:add', entry),
    removePassword: (id) => ipcRenderer.invoke('passwords:remove', id),
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
