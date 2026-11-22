const { app, session, nativeTheme } = require('electron');

if (process.platform === 'win32' && typeof app.setAppUserModelId === 'function') {
  app.setAppUserModelId('com.marjan.nextgxbrowser');
}

// n-7: follow the OS theme for native menus/dialogs instead of forcing dark.
// The app's own GX dark theme is CSS-based and unaffected by this.
nativeTheme.themeSource = 'system';

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

const isRunningAsRoot =
  typeof process.geteuid === 'function'
    ? process.geteuid() === 0
    : typeof process.getuid === 'function' && process.getuid() === 0;
if (isRunningAsRoot) {
  app.commandLine.appendSwitch('no-sandbox');
}
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const { windowContexts, state, initCore } = require('./main/core');
const { cleanupOrphanedWallpapers } = require('./main/wallpapers');
const { broadcastAdblockUpdate, cancelScheduledAdblockBroadcast } = require('./main/broadcast');
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

app.on('second-instance', (_event, argv) => {
  const existingCtx =
    Array.from(windowContexts.values()).find((c) => c && !c.incognito && c.win && !c.win.isDestroyed()) ||
    Array.from(windowContexts.values()).find((c) => c && c.win && !c.win.isDestroyed()) ||
    null;

  const urlArg = Array.isArray(argv)
    ? argv.find((arg) => typeof arg === 'string' && /^https?:\/\//i.test(arg.trim()))
    : null;

  if (existingCtx && existingCtx.win) {
    if (existingCtx.win.isMinimized()) existingCtx.win.restore();
    existingCtx.win.focus();
    if (urlArg) {
      createTab(existingCtx, { url: urlArg.trim(), active: true });
    }
  } else if (app.isReady()) {
    createBrowserWindow({ incognito: false, initialUrl: urlArg ? urlArg.trim() : null });
  }
});

if (gotSingleInstanceLock) {
  app.whenReady().then(async () => {
    initCore({
      onAdblockUpdate: (stats) => {
        broadcastAdblockUpdate(stats, { throttled: true });
      }
    });

    ensureProfileSessionInitialized('default', { setupPermissionsForSession });
    const activeProfileId = state.storage.getActiveProfileId();
    if (activeProfileId && activeProfileId !== 'default') {
      ensureProfileSessionInitialized(activeProfileId, { setupPermissionsForSession });
    }
    registerIpcHandlers();
    openStartupWindows();
    startBackgroundTimers();
    startCornerBackgroundRefresh();

    // Non-blocking post-window startup tasks so first frame renders immediately
    setTimeout(() => {
      restorePersistedExtensions().catch((err) => {
        console.error('[Extensions] Startup restore failed:', err);
      });
    }, 50);
    setTimeout(() => {
      cleanupOrphanedWallpapers();
    }, 5000);
  });
}

app.on('before-quit', () => {
  state.isAppQuitting = true;
  stopBackgroundTimers();
  stopCornerBackgroundRefresh();
  gxControl.shutdown();
  cancelScheduledSessionSave();
  cancelScheduledCookiesBroadcast();
  cancelScheduledAdblockBroadcast();
  saveSessionNow({ allowEmpty: false });
  if (state.storage) {
    if (typeof state.storage.flushAll === 'function') state.storage.flushAll();
    state.storage.flushSettings();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});
