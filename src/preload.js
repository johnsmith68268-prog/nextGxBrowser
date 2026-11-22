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

  // Split View
  toggleSplit: () => ipcRenderer.invoke('split:toggle'),
  startSplit: (tabIdOrOpts) =>
    ipcRenderer.invoke(
      'split:start',
      typeof tabIdOrOpts === 'object' && tabIdOrOpts !== null
        ? tabIdOrOpts
        : tabIdOrOpts !== undefined
        ? { tabId: tabIdOrOpts }
        : {}
    ),
  exitSplit: () => ipcRenderer.invoke('split:exit'),
  setSplitRatio: (ratioOrOpts, opts) =>
    ipcRenderer.invoke(
      'split:set-ratio',
      typeof ratioOrOpts === 'object' && ratioOrOpts !== null
        ? ratioOrOpts
        : { ...(opts || {}), ratio: ratioOrOpts }
    ),
  focusSplitPane: (paneOrOpts) =>
    ipcRenderer.invoke(
      'split:focus-pane',
      typeof paneOrOpts === 'object' && paneOrOpts !== null
        ? paneOrOpts
        : paneOrOpts === 'left' || paneOrOpts === 'right'
        ? { pane: paneOrOpts }
        : { tabId: paneOrOpts }
    ),

  // Workspaces
  getWorkspaces: () => ipcRenderer.invoke('workspaces:get'),
  createWorkspace: (options) => ipcRenderer.invoke('workspaces:create', options),
  switchWorkspace: (workspaceId) => ipcRenderer.invoke('workspaces:switch', workspaceId),
  renameWorkspace: (workspaceId, name) =>
    ipcRenderer.invoke(
      'workspaces:rename',
      typeof workspaceId === 'object' && workspaceId !== null ? workspaceId : { workspaceId, name }
    ),
  deleteWorkspace: (workspaceId) => ipcRenderer.invoke('workspaces:delete', workspaceId),
  moveTabToWorkspace: (tabId, workspaceId) =>
    ipcRenderer.invoke(
      'workspaces:move-tab',
      typeof tabId === 'object' && tabId !== null ? tabId : { tabId, workspaceId }
    ),

  // Tab Islands / Groups
  getTabGroups: () => ipcRenderer.invoke('groups:get'),
  createTabGroup: (options) => ipcRenderer.invoke('groups:create', options),
  addTabToGroup: (tabId, groupId, opts) =>
    ipcRenderer.invoke(
      'groups:add-tab',
      typeof tabId === 'object' && tabId !== null ? tabId : { ...(opts || {}), tabId, groupId }
    ),
  removeTabFromGroup: (tabId) => ipcRenderer.invoke('groups:remove-tab', tabId),
  updateTabGroup: (groupId, updates) =>
    ipcRenderer.invoke(
      'groups:update',
      typeof groupId === 'object' && groupId !== null ? groupId : { ...(updates || {}), groupId }
    ),
  toggleTabGroupCollapse: (groupId) => ipcRenderer.invoke('groups:toggle-collapse', groupId),
  ungroupTabGroup: (groupId) => ipcRenderer.invoke('groups:ungroup', groupId),
  createTabInGroup: (groupId) => ipcRenderer.invoke('groups:create-tab', groupId),
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
  newWindow: (options) => ipcRenderer.invoke('window:new', options),
  toggleFullscreen: () => ipcRenderer.invoke('window:fullscreen'),
  clearBrowsingData: (options) => ipcRenderer.invoke('cleaner:run', options),

  // Floating Popover Overlay Management
  openPopover: (options) => ipcRenderer.invoke('popover:open', options),
  resizePopover: (options) => ipcRenderer.invoke('popover:resize', options),
  closePopover: () => ipcRenderer.invoke('popover:close'),
  triggerMenuAction: (action) => ipcRenderer.invoke('menu:action', action),

  // Site Permissions & Privacy Dashboard
  getSitePermissions: (origin) => ipcRenderer.invoke('permissions:get', origin),
  setSitePermission: (origin, key, value) => ipcRenderer.invoke('permissions:set', { origin, key, value }),
  clearSitePermission: (origin, key) =>
    ipcRenderer.invoke(
      'privacy:clear-site-permission',
      typeof origin === 'object' && origin !== null ? origin : { origin, key }
    ),
  getPrivacyDashboard: () => ipcRenderer.invoke('privacy:get-dashboard'),

  // Layout / Bounds for WebContentsView
  setLayoutOffsets: (offsets) => ipcRenderer.invoke('layout:set-offsets', offsets),

  // Sidebar Overlay Panel (GX Left Rail)
  toggleSidebarPanel: (serviceKey) => ipcRenderer.invoke('sidebar:toggle', serviceKey),
  openSidebarPanel: (serviceKey) => ipcRenderer.invoke('sidebar:open', serviceKey),
  closeSidebarPanel: () => ipcRenderer.invoke('sidebar:close'),
  setSidebarPinned: (pinned) => ipcRenderer.invoke('sidebar:set-pinned', pinned),
  toggleSidebarPin: () => ipcRenderer.invoke('sidebar:set-pinned'),
  reloadSidebarPanel: () => ipcRenderer.invoke('sidebar:reload'),
  openSidebarInNewTab: () => ipcRenderer.invoke('sidebar:open-in-new-tab'),
  openSidebarPanelInNewTab: () => ipcRenderer.invoke('sidebar:open-in-new-tab'),
  setSidebarWidth: (width, opts) => ipcRenderer.invoke('sidebar:set-width', width, opts),
  getSidebarState: () => ipcRenderer.invoke('sidebar:get-state'),

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
  updatePassword: (entry) => ipcRenderer.invoke('passwords:update', entry),
  removePassword: (id) => ipcRenderer.invoke('passwords:remove', id),
  generatePassword: (options) => ipcRenderer.invoke('passwords:generate', options),
  copyPassword: (id) =>
    ipcRenderer.invoke('passwords:copy', typeof id === 'object' && id !== null ? id : { id }),
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

  // System / RAM Saver Stats & GX Control
  getSystemStats: () => ipcRenderer.invoke('system:stats'),
  getGxControlState: () => ipcRenderer.invoke('gxcontrol:get-state'),

  // Video Pop-Out (Native PiP) & Sidebar Player
  popOutVideo: (tabId) => ipcRenderer.invoke('video:pop-out', tabId),
  getPlayerState: () => ipcRenderer.invoke('player:get-state'),
  playerControl: (payload) => ipcRenderer.invoke('player:control', payload),

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

  // Window Controls
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),

  // Event Listeners from Main Process
  onStateUpdate: (cb) => ipcRenderer.on('state:update', (_e, data) => cb(data)),
  onSidebarUpdate: (cb) => ipcRenderer.on('sidebar:update', (_e, data) => cb(data)),
  onAdblockUpdate: (cb) => ipcRenderer.on('adblock:update', (_e, data) => cb(data)),
  onDownloadsUpdate: (cb) => ipcRenderer.on('downloads:update', (_e, data) => cb(data)),
  onSystemStats: (cb) => ipcRenderer.on('system:stats-update', (_e, data) => cb(data)),
  onSettingsUpdate: (cb) => ipcRenderer.on('settings:update', (_e, data) => cb(data)),
  onBookmarksUpdate: (cb) => ipcRenderer.on('bookmarks:update', (_e, data) => cb(data)),
  onPermissionsUpdate: (cb) => ipcRenderer.on('permissions:update', (_e, data) => cb(data)),
  onProfilesUpdate: (cb) => ipcRenderer.on('profiles:update', (_e, data) => cb(data)),
  onShortcutAction: (cb) => ipcRenderer.on('shortcut:action', (_e, action) => cb(action)),
  onPopoverData: (cb) => ipcRenderer.on('popover:data', (_e, data) => cb(data)),
  onFindResult: (cb) => ipcRenderer.on('find:result', (_e, data) => cb(data)),
  onScreenshotCaptured: (cb) => ipcRenderer.on('screenshot:captured', (_e, data) => cb(data)),
  onPlayerUpdate: (cb) => ipcRenderer.on('player:update', (_e, data) => cb(data)),
  onToast: (cb) => ipcRenderer.on('ui:toast', (_e, msg) => cb(msg))
});
