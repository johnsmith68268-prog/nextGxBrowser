const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gxAPI', {
  // Tab Management
  createTab: (options) => ipcRenderer.invoke('tabs:create', options),
  switchTab: (tabId) => ipcRenderer.invoke('tabs:switch', tabId),
  closeTab: (tabId) => ipcRenderer.invoke('tabs:close', tabId),
  closeOtherTabs: (tabId) => ipcRenderer.invoke('tabs:close-others', tabId),
  duplicateTab: (tabId) => ipcRenderer.invoke('tabs:duplicate', tabId),
  reorderTab: (options) => ipcRenderer.invoke('tabs:reorder', options),
  pinTab: (tabId) => ipcRenderer.invoke('tabs:pin', tabId),
  sleepTab: (tabId) => ipcRenderer.invoke('tabs:sleep', tabId),
  sleepBackgroundTabs: () => ipcRenderer.invoke('tabs:sleep-background'),
  navigate: (input) => ipcRenderer.invoke('tabs:navigate', input),
  goBack: () => ipcRenderer.invoke('tabs:back'),
  goForward: () => ipcRenderer.invoke('tabs:forward'),
  reload: (tabId) => ipcRenderer.invoke('tabs:reload', tabId),
  stopLoading: () => ipcRenderer.invoke('tabs:stop'),
  goHome: () => ipcRenderer.invoke('tabs:home'),
  toggleDevTools: () => ipcRenderer.invoke('tabs:devtools'),
  getActiveState: () => ipcRenderer.invoke('tabs:get-state'),

  // Extra Power Features
  setZoom: (action) => ipcRenderer.invoke('tabs:zoom', action),
  printPage: () => ipcRenderer.invoke('tabs:print'),
  captureScreenshot: () => ipcRenderer.invoke('tabs:screenshot'),
  startAreaScreenshot: () => ipcRenderer.invoke('tabs:screenshot-area-start'),
  finishAreaScreenshot: (rect) => ipcRenderer.invoke('tabs:screenshot-area-finish', rect),
  cancelAreaScreenshot: () => ipcRenderer.invoke('tabs:screenshot-area-cancel'),
  toggleReaderMode: () => ipcRenderer.invoke('tabs:reader-mode'),
  findInPage: (text, forward) => ipcRenderer.invoke('tabs:find', { text, forward }),
  stopFindInPage: () => ipcRenderer.invoke('tabs:stop-find'),
  newWindow: () => ipcRenderer.invoke('window:new'),
  toggleFullscreen: () => ipcRenderer.invoke('window:fullscreen'),
  clearBrowsingData: (options) => ipcRenderer.invoke('cleaner:run', options),

  // Floating Popover Overlay Management
  openPopover: (options) => ipcRenderer.invoke('popover:open', options),
  resizePopover: (options) => ipcRenderer.invoke('popover:resize', options),
  closePopover: () => ipcRenderer.invoke('popover:close'),
  triggerMenuAction: (action) => ipcRenderer.invoke('menu:action', action),

  // Site Permissions
  getSitePermissions: (origin) => ipcRenderer.invoke('permissions:get', origin),
  setSitePermission: (origin, key, value) => ipcRenderer.invoke('permissions:set', { origin, key, value }),

  // Layout / Bounds for WebContentsView
  setLayoutOffsets: (offsets) => ipcRenderer.invoke('layout:set-offsets', offsets),

  // Bookmarks
  getBookmarks: () => ipcRenderer.invoke('bookmarks:get'),
  toggleBookmark: () => ipcRenderer.invoke('bookmarks:toggle'),
  addBookmark: (entry) => ipcRenderer.invoke('bookmarks:add', entry),
  updateBookmark: (entry) => ipcRenderer.invoke('bookmarks:update', entry),
  removeBookmark: (id) => ipcRenderer.invoke('bookmarks:remove', id),
  renameBookmarkFolder: (oldName, newName) =>
    ipcRenderer.invoke('bookmarks:rename-folder', { oldName, newName }),

  // History
  getHistory: () => ipcRenderer.invoke('history:get'),
  clearHistory: (range) => ipcRenderer.invoke('history:clear', range),
  removeHistoryItem: (id) => ipcRenderer.invoke('history:remove', id),
  getClosedTabs: () => ipcRenderer.invoke('history:closed-get'),
  clearClosedTabs: () => ipcRenderer.invoke('history:closed-clear'),
  removeClosedTab: (id) => ipcRenderer.invoke('history:closed-remove', id),

  // Cookies
  getCookies: (filter) => ipcRenderer.invoke('cookies:get', filter),
  removeCookie: (urlOrObj, name) =>
    ipcRenderer.invoke(
      'cookies:remove',
      typeof urlOrObj === 'object' ? urlOrObj : { url: urlOrObj, name }
    ),
  clearSiteCookies: (originOrDomain) => ipcRenderer.invoke('cookies:clear-site', originOrDomain),
  clearAllCookies: () => ipcRenderer.invoke('cookies:clear-all'),

  // Pro Download Manager
  getDownloads: () => ipcRenderer.invoke('downloads:get'),
  pauseDownload: (id) => ipcRenderer.invoke('downloads:pause', id),
  resumeDownload: (id) => ipcRenderer.invoke('downloads:resume', id),
  cancelDownload: (id) => ipcRenderer.invoke('downloads:cancel', id),
  removeDownload: (id) => ipcRenderer.invoke('downloads:remove', id),
  clearDownloads: () => ipcRenderer.invoke('downloads:clear'),
  openDownloadItem: (savePath) => ipcRenderer.invoke('downloads:open', savePath),
  showDownloadInFolder: (savePath) => ipcRenderer.invoke('downloads:show-folder', savePath),

  // Passwords & Notes
  getPasswords: () => ipcRenderer.invoke('passwords:get'),
  addPassword: (entry) => ipcRenderer.invoke('passwords:add', entry),
  removePassword: (id) => ipcRenderer.invoke('passwords:remove', id),
  getNotes: () => ipcRenderer.invoke('notes:get'),
  saveNote: (text) => ipcRenderer.invoke('notes:save', text),

  // AdBlocker & Settings
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
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (partial) => ipcRenderer.invoke('settings:update', partial),

  // System / RAM Saver Stats
  getSystemStats: () => ipcRenderer.invoke('system:stats'),

  // Window Controls
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),

  // Event Listeners from Main Process
  onStateUpdate: (cb) => ipcRenderer.on('state:update', (_e, data) => cb(data)),
  onAdblockUpdate: (cb) => ipcRenderer.on('adblock:update', (_e, data) => cb(data)),
  onDownloadsUpdate: (cb) => ipcRenderer.on('downloads:update', (_e, data) => cb(data)),
  onSystemStats: (cb) => ipcRenderer.on('system:stats-update', (_e, data) => cb(data)),
  onSettingsUpdate: (cb) => ipcRenderer.on('settings:update', (_e, data) => cb(data)),
  onBookmarksUpdate: (cb) => ipcRenderer.on('bookmarks:update', (_e, data) => cb(data)),
  onShortcutAction: (cb) => ipcRenderer.on('shortcut:action', (_e, action) => cb(action)),
  onPopoverData: (cb) => ipcRenderer.on('popover:data', (_e, data) => cb(data)),
  onFindResult: (cb) => ipcRenderer.on('find:result', (_e, data) => cb(data)),
  onScreenshotCaptured: (cb) => ipcRenderer.on('screenshot:captured', (_e, data) => cb(data)),
  onToast: (cb) => ipcRenderer.on('ui:toast', (_e, msg) => cb(msg))
});
