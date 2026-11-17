const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gxNewTabAPI', {
  getInitialData: () => ipcRenderer.invoke('newtab:get-data'),
  navigate: (urlOrQuery) => ipcRenderer.invoke('tabs:navigate', urlOrQuery),
  addSpeedDial: (item) => ipcRenderer.invoke('newtab:add-dial', item),
  removeSpeedDial: (id) => ipcRenderer.invoke('newtab:remove-dial', id),
  sleepBackgroundTabs: () => ipcRenderer.invoke('tabs:sleep-background'),
  saveNote: (text) => ipcRenderer.invoke('notes:save', text),
  updateSettings: (partial) => ipcRenderer.invoke('settings:update', partial)
});

contextBridge.exposeInMainWorld('gxChromePagesAPI', {
  navigate: (url) => ipcRenderer.invoke('tabs:navigate', url),
  createTab: (opts) => ipcRenderer.invoke('tabs:create', opts),
  // History
  getHistory: () => ipcRenderer.invoke('history:get'),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  removeHistoryItem: (id) => ipcRenderer.invoke('history:remove', id),
  // Pro Download Manager
  getDownloads: () => ipcRenderer.invoke('downloads:get'),
  pauseDownload: (id) => ipcRenderer.invoke('downloads:pause', id),
  resumeDownload: (id) => ipcRenderer.invoke('downloads:resume', id),
  cancelDownload: (id) => ipcRenderer.invoke('downloads:cancel', id),
  removeDownload: (id) => ipcRenderer.invoke('downloads:remove', id),
  clearDownloads: () => ipcRenderer.invoke('downloads:clear'),
  openDownloadItem: (savePath) => ipcRenderer.invoke('downloads:open', savePath),
  showDownloadInFolder: (savePath) => ipcRenderer.invoke('downloads:show-folder', savePath),
  // Bookmarks
  getBookmarks: () => ipcRenderer.invoke('bookmarks:get'),
  toggleBookmark: () => ipcRenderer.invoke('bookmarks:toggle'),
  removeBookmark: (id) => ipcRenderer.invoke('bookmarks:remove', id),
  // Passwords & Autofill
  getPasswords: () => ipcRenderer.invoke('passwords:get'),
  addPassword: (entry) => ipcRenderer.invoke('passwords:add', entry),
  removePassword: (id) => ipcRenderer.invoke('passwords:remove', id),
  // Extensions
  getExtensions: () => ipcRenderer.invoke('extensions:list'),
  loadUnpackedExtension: () => ipcRenderer.invoke('extensions:load-unpacked'),
  removeExtension: (id) => ipcRenderer.invoke('extensions:remove', id),
  // Settings, AdBlocker, Cleaner & Performance
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (partial) => ipcRenderer.invoke('settings:update', partial),
  getAdblockStats: () => ipcRenderer.invoke('adblock:stats'),
  toggleAdblock: (enabled) => ipcRenderer.invoke('adblock:toggle', enabled),
  getSystemStats: () => ipcRenderer.invoke('system:stats'),
  sleepBackgroundTabs: () => ipcRenderer.invoke('tabs:sleep-background'),
  clearBrowsingData: (opts) => ipcRenderer.invoke('cleaner:run', opts)
});

// Automatic Website Password Autofill & Save Engine
window.addEventListener('DOMContentLoaded', async () => {
  if (!/^https?:$/i.test(window.location.protocol)) return;
  const host = window.location.hostname.replace(/^www\./, '');
  if (!host) return;

  try {
    const passwords = await ipcRenderer.invoke('passwords:get');
    const matched = (passwords || []).filter(
      (p) => p.site && (host.includes(p.site.replace(/^www\./, '')) || p.site.includes(host))
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
                ipcRenderer.invoke('passwords:add', {
                  site: host,
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
