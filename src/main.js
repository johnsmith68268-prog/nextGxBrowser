const { app, session } = require('electron');

const isRunningAsRoot =
  typeof process.geteuid === 'function'
    ? process.geteuid() === 0
    : typeof process.getuid === 'function' && process.getuid() === 0;
if (isRunningAsRoot) {
  app.commandLine.appendSwitch('no-sandbox');
}
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const { state, initCore } = require('./main/core');
const { cleanupOrphanedWallpapers } = require('./main/wallpapers');
const { broadcastAdblockUpdate } = require('./main/broadcast');
const { cancelScheduledSessionSave, saveSessionNow } = require('./main/session');
const { setupDownloadListener } = require('./main/downloads');
const { broadcastCookiesUpdate, cancelScheduledCookiesBroadcast } = require('./main/cookies');
const { restorePersistedExtensions } = require('./main/extensions');
const { configureShortcuts } = require('./main/shortcuts');
const { closePopover } = require('./main/popovers');
const { closeSidebarPanel } = require('./main/sidebar');
const {
  createTab,
  closeTab,
  reopenLastClosedTab,
  reloadActiveTab,
  toggleActiveTabDevTools
} = require('./main/tabs');
const { startBackgroundTimers, stopBackgroundTimers } = require('./main/stats');
const gxControl = require('./main/gxcontrol');
const {
  registerCornerPreloadForSession,
  startCornerBackgroundRefresh,
  stopCornerBackgroundRefresh
} = require('./main/gxcorner');
const {
  setupPermissionsForSession,
  createBrowserWindow,
  openStartupWindows
} = require('./main/windows');
const { ensureProfileSessionInitialized } = require('./main/profiles');
const { registerIpcHandlers } = require('./main/ipc');

configureShortcuts({
  createTab,
  reopenLastClosedTab,
  createBrowserWindow,
  closeTab,
  reloadActiveTab,
  toggleActiveTabDevTools,
  closePopover,
  closeSidebarPanel
});

app.whenReady().then(async () => {
  initCore({
    onAdblockUpdate: (stats) => {
      broadcastAdblockUpdate(stats);
    }
  });

  ensureProfileSessionInitialized('default', { setupPermissionsForSession });
  const activeProfileId = state.storage.getActiveProfileId();
  if (activeProfileId && activeProfileId !== 'default') {
    ensureProfileSessionInitialized(activeProfileId, { setupPermissionsForSession });
  }
  cleanupOrphanedWallpapers();
  await restorePersistedExtensions();
  registerIpcHandlers();

  openStartupWindows();
  startBackgroundTimers();
  startCornerBackgroundRefresh();
});

app.on('before-quit', () => {
  state.isAppQuitting = true;
  stopBackgroundTimers();
  stopCornerBackgroundRefresh();
  gxControl.shutdown();
  cancelScheduledSessionSave();
  cancelScheduledCookiesBroadcast();
  saveSessionNow({ allowEmpty: false });
  if (state.storage) state.storage.flushSettings();
});

app.on('window-all-closed', () => {
  app.quit();
});
