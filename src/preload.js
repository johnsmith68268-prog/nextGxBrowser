const { contextBridge, ipcRenderer } = require('electron');

if (window === window.top && window.location.protocol === 'file:') {
contextBridge.exposeInMainWorld('gxAPI', {
  // Tab Management
  createTab: (options) => ipcRenderer.invoke('tabs:create', options),
  openGxCorner: () => ipcRenderer.invoke('tabs:open-corner'),
  switchTab: (tabId) => ipcRenderer.invoke('tabs:switch', tabId),
  closeTab: (tabId) => ipcRenderer.invoke('tabs:close', tabId),
  reopenLastClosedTab: () => ipcRenderer.invoke('tabs:reopen-closed'),
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
  swapSplitPanes: () => ipcRenderer.invoke('split:swap'),
  mergeSplitTabs: (opts) => ipcRenderer.invoke('split:merge', opts && typeof opts === 'object' ? opts : {}),
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
  // [URLBAR-9.2] Per-site zoom store (bridge for the ipc.js handlers above).
  getSiteZoom: (origin) => ipcRenderer.invoke('zoom:get-site', origin),
  saveSiteZoom: (origin, factor) => ipcRenderer.invoke('zoom:save-site', { origin, factor }),
  // [URLBAR-3.3] Certificate of the active tab's page (may report unavailable).
  getSiteCertificate: () => ipcRenderer.invoke('site:certificate'),
  printPage: () => ipcRenderer.invoke('tabs:print'),
  captureScreenshot: () => ipcRenderer.invoke('tabs:screenshot'),
  startAreaScreenshot: () => ipcRenderer.invoke('tabs:screenshot-area-start'),
  finishAreaScreenshot: (rect) => ipcRenderer.invoke('tabs:screenshot-area-finish', rect),
  cancelAreaScreenshot: () => ipcRenderer.invoke('tabs:screenshot-area-cancel'),
  savePageAsPdf: () => ipcRenderer.invoke('tabs:save-pdf'),
  toggleReaderMode: () => ipcRenderer.invoke('tabs:reader-mode'),
  // [TABS-W2] Chrome-parity Wave 2 (worker E) bridge — tab actions, reading
  // list, extraction-based reader mode, omnibox permission chips. Handlers
  // live in src/main/tabs.js (owned by worker E); this block only exposes
  // them to the internal UI. Added as one block to keep the shared bridge
  // diff contained.
  muteTab: (tabId, muted) =>
    ipcRenderer.invoke(
      'tabs:mute',
      typeof tabId === 'object' && tabId !== null ? tabId : { tabId, muted }
    ),
  getTabMuteState: (tabId) => ipcRenderer.invoke('tabs:mute-state', { tabId }),
  closeTabsToRight: (tabId) => ipcRenderer.invoke('tabs:close-right', { tabId }),
  moveTabToNewWindow: (tabId) => ipcRenderer.invoke('tabs:move-to-new-window', { tabId }),
  toggleReaderModeExtract: () => ipcRenderer.invoke('tabs:reader-mode-extract'),
  getReadingList: () => ipcRenderer.invoke('reading-list:get'),
  addReadingList: (payload) => ipcRenderer.invoke('reading-list:add', payload || {}),
  removeReadingList: (id) =>
    ipcRenderer.invoke(
      'reading-list:remove',
      typeof id === 'object' && id !== null ? id : { id }
    ),
  markReadingListRead: (id, read) => ipcRenderer.invoke('reading-list:mark-read', { id, read }),
  notifyPermissionPromptState: (payload) =>
    ipcRenderer.invoke('ui:permission-prompt-state', payload || {}),
  findInPage: (text, forward) => ipcRenderer.invoke('tabs:find', { text, forward }),
  stopFindInPage: () => ipcRenderer.invoke('tabs:stop-find'),
  newWindow: (options) => ipcRenderer.invoke('window:new', options),
  toggleFullscreen: () => ipcRenderer.invoke('window:fullscreen'),
  clearBrowsingData: (options) => ipcRenderer.invoke('cleaner:run', options),
  // Market audit bug #36: live cache size for the GX Cleaner drawer.
  getCacheSize: () => ipcRenderer.invoke('cleaner:get-cache-size'),

  // Floating Popover Overlay Management
  openPopover: (options) => ipcRenderer.invoke('popover:open', options),
  resizePopover: (options) => ipcRenderer.invoke('popover:resize', options),
  closePopover: (opts) => ipcRenderer.invoke('popover:close', opts),
  triggerMenuAction: (action) => ipcRenderer.invoke('menu:action', action),
  setChromeContextTarget: (target) => ipcRenderer.invoke('contextmenu:chrome-target', target),

  // Site Permissions & Privacy Dashboard
  getSitePermissions: (origin) => ipcRenderer.invoke('permissions:get', origin),
  setSitePermission: (origin, key, value) => ipcRenderer.invoke('permissions:set', { origin, key, value }),
  respondPermissionPrompt: (payload) => ipcRenderer.invoke('permissions:prompt-respond', payload),
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
  closeSidebarPanel: (opts) => ipcRenderer.invoke('sidebar:close', opts),
  setSidebarPinned: (pinned) => ipcRenderer.invoke('sidebar:set-pinned', pinned),
  toggleSidebarPin: () => ipcRenderer.invoke('sidebar:set-pinned'),
  reloadSidebarPanel: () => ipcRenderer.invoke('sidebar:reload'),
  openSidebarInNewTab: () => ipcRenderer.invoke('sidebar:open-in-new-tab'),
  openSidebarPanelInNewTab: () => ipcRenderer.invoke('sidebar:open-in-new-tab'),
  setSidebarWidth: (width, opts) => ipcRenderer.invoke('sidebar:set-width', width, opts),
  // [Fix2 A5] Drag signals so the unpinned panel cannot auto-close mid-drag.
  setSidebarResizing: (resizing) =>
    ipcRenderer.invoke(resizing ? 'sidebar:resize-start' : 'sidebar:resize-end'),
  // Shell-DOM modal overlay (market audit bug #2): hides content views while
  // a shell modal (e.g. New Profile) is open so it is visible and focusable.
  setShellModalOpen: (open) => ipcRenderer.invoke('shell:set-modal-open', Boolean(open)),
  // Rail context menu (market audit bug #30): ask the shell to open a left
  // system drawer (e.g. Customize Dock) from the popover view.
  openLeftTool: (tool) => ipcRenderer.invoke('shell:open-left-tool', tool),
  onOpenLeftTool: (cb) => ipcRenderer.on('shell:open-left-tool', (_e, tool) => cb(tool)),
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
  getRemoteSuggestions: (query) => ipcRenderer.invoke('omnibox:remote-suggest', query),
  // [Fix2 #20] History/bookmark writes already broadcast history:update
  // from main (tabs.js / ipc.js); the shell subscribes here so the
  // omnibox suggestion cache can be invalidated on write instead of
  // waiting out its 30 s TTL.
  onHistoryUpdate: (cb) => ipcRenderer.on('history:update', (_e, data) => cb(data)),
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
  getPasswordEncryptionStatus: () => ipcRenderer.invoke('passwords:encryption-status'),
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
  saveCustomWallpaper: (payload) => ipcRenderer.invoke('newtab:save-wallpaper', payload),
  removeCustomWallpaper: () => ipcRenderer.invoke('newtab:remove-wallpaper'),
  getWallpaperImage: () => ipcRenderer.invoke('newtab:get-wallpaper-image'),
  setDefaultBrowser: () => ipcRenderer.invoke('app:set-default-browser'),
  openProxySettings: () => ipcRenderer.invoke('system:open-proxy-settings'),
  openOnboarding: () => ipcRenderer.invoke('system:open-onboarding'),
  // Auto-Updater
  getUpdaterState: () => ipcRenderer.invoke('updater:get-state'),
  checkForUpdates: (opts) => ipcRenderer.invoke('updater:check', opts || {}),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: (opts) => ipcRenderer.invoke('updater:install', opts || {}),
  notifyOnline: () => ipcRenderer.invoke('updater:online'),
  onUpdaterState: (cb) => ipcRenderer.on('updater:state', (_e, data) => cb(data)),

  // System / RAM Saver Stats & GX Control
  getSystemStats: () => ipcRenderer.invoke('system:stats'),
  getGxControlState: () => ipcRenderer.invoke('gxcontrol:get-state'),
  // [Fix2 A6] Hibernate Now — hibernates all eligible background tabs +
  // idle sidebar views and returns MEASURED RAM before/after.
  hibernateNow: () => ipcRenderer.invoke('tabs:hibernate-now'),

  // [Fix2 Panic] Hide everything / restore the previous session.
  triggerPanic: () => ipcRenderer.invoke('panic:trigger'),
  restorePanic: () => ipcRenderer.invoke('panic:restore'),
  togglePanic: () => ipcRenderer.invoke('panic:toggle'),
  getPanicState: () => ipcRenderer.invoke('panic:get-state'),

  // [Fix2 GX Mods] Local packs only — no online store.
  listGxMods: () => ipcRenderer.invoke('gxmods:list'),
  loadGxMod: () => ipcRenderer.invoke('gxmods:load'),
  applyGxMod: (id) => ipcRenderer.invoke('gxmods:apply', id),
  removeGxMod: (id) => ipcRenderer.invoke('gxmods:remove', id),
  getGxModStatus: () => ipcRenderer.invoke('gxmods:get-status'),

  // [Fix2 Sounds] Honest local-audio status (no sound pack installed
  // unless a local Mod pack folder contains audio files).
  getSoundsStatus: () => ipcRenderer.invoke('sounds:get-status'),

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
  // UX phase: ask main to open the ONE shared "New Profile" modal in the shell.
  openCreateProfileModal: () => ipcRenderer.invoke('profiles:open-create-modal'),

  // Floating Shell Drawer Overlay (Expand Rail, GX Control, Cleaner, Customize Dock, Easy Setup)
  openShellDrawer: (spec) => ipcRenderer.invoke('drawer:open', spec),
  toggleShellDrawer: (spec) => ipcRenderer.invoke('drawer:toggle', spec),
  closeShellDrawer: () => ipcRenderer.invoke('drawer:close'),
  getShellDrawerState: () => ipcRenderer.invoke('drawer:get-state'),
  onShellDrawerState: (cb) => ipcRenderer.on('drawer:state', (_e, data) => cb(data)),

  // Window Controls
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  isWindowMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  onWindowMaximizeChanged: (cb) => ipcRenderer.on('window:maximize-changed', (_e, isMax) => cb(Boolean(isMax))),

  // Event Listeners from Main Process
  onStateUpdate: (cb) => ipcRenderer.on('state:update', (_e, data) => cb(data)),
  onSidebarUpdate: (cb) => ipcRenderer.on('sidebar:update', (_e, data) => cb(data)),
  onAdblockUpdate: (cb) => ipcRenderer.on('adblock:update', (_e, data) => cb(data)),
  onDownloadsUpdate: (cb) => ipcRenderer.on('downloads:update', (_e, data) => cb(data)),
  onSystemStats: (cb) => ipcRenderer.on('system:stats-update', (_e, data) => cb(data)),
  onSettingsUpdate: (cb) => ipcRenderer.on('settings:update', (_e, data) => cb(data)),
  onBookmarksUpdate: (cb) => ipcRenderer.on('bookmarks:update', (_e, data) => cb(data)),
  onPermissionsUpdate: (cb) => ipcRenderer.on('permissions:update', (_e, data) => cb(data)),
  // [TABS-W2] Omnibox permission-chip lifecycle (gap 1.5) + tab mute state.
  onPermissionPromptState: (cb) => ipcRenderer.on('permission-prompt:state', (_e, data) => cb(data)),
  onTabMuteState: (cb) => ipcRenderer.on('tabs:mute-state', (_e, data) => cb(data)),
  onProfilesUpdate: (cb) => ipcRenderer.on('profiles:update', (_e, data) => cb(data)),
  onOpenCreateProfileModal: (cb) => ipcRenderer.on('profiles:open-create-modal', (_e, data) => cb(data)),
  onShortcutAction: (cb) => ipcRenderer.on('shortcut:action', (_e, action) => cb(action)),
  onPopoverData: (cb) => ipcRenderer.on('popover:data', (_e, data) => cb(data)),
  onFindResult: (cb) => ipcRenderer.on('find:result', (_e, data) => cb(data)),
  onScreenshotCaptured: (cb) => ipcRenderer.on('screenshot:captured', (_e, data) => cb(data)),
  onPlayerUpdate: (cb) => ipcRenderer.on('player:update', (_e, data) => cb(data)),
  onToast: (cb) => ipcRenderer.on('ui:toast', (_e, msg) => cb(msg))
});
}
