const path = require('path');
const { pathToFileURL } = require('url');
const { StorageManager } = require('../storage');
const { AdBlocker } = require('../adblocker');

const TOP_CHROME_HEIGHT = 82;
const BOOKMARKS_BAR_HEIGHT = 30;
const SIDEBAR_ICON_WIDTH = 50;
const SIDEBAR_PANEL_HEADER_HEIGHT = 44; // Keep in sync with .sidebar-panel-header in src/ui/styles.css and .drawer-header in src/ui/sidebar-panel-chrome.html
const SIDEBAR_PANEL_RESIZER_WIDTH = 7; // 6px drag handle + 1px neon right border
const SIDEBAR_PANEL_DEFAULT_WIDTH = 380;
const SIDEBAR_PANEL_MIN_WIDTH = 320;
const SIDEBAR_PANEL_MAX_WIDTH = 640;
const PRIVATE_WINDOW_TITLE = 'nextGx Private';

const SRC_DIR = path.resolve(__dirname, '..');
const UI_DIR = path.resolve(SRC_DIR, 'ui');
const INDEX_FILE = path.join(UI_DIR, 'index.html');
const NEW_TAB_FILE = path.join(UI_DIR, 'newtab.html');
const NEW_TAB_FILE_URL = pathToFileURL(NEW_TAB_FILE).toString();
const CORNER_FILE = path.join(UI_DIR, 'corner.html');
const CORNER_FILE_URL = pathToFileURL(CORNER_FILE).toString();
const WEBUI_FILE = path.join(UI_DIR, 'chrome-webui.html');
const WEBUI_FILE_URL = pathToFileURL(WEBUI_FILE).toString();
const ERROR_PAGE_FILE = path.join(UI_DIR, 'error.html');
const ERROR_PAGE_FILE_URL = pathToFileURL(ERROR_PAGE_FILE).toString();
const POPOVER_FILE = path.join(UI_DIR, 'popover.html');
const SIDEBAR_PANEL_CHROME_FILE = path.join(UI_DIR, 'sidebar-panel-chrome.html');
const PLAYER_PANEL_FILE = path.join(UI_DIR, 'player.html');
const PLAYER_PANEL_FILE_URL = pathToFileURL(PLAYER_PANEL_FILE).toString();
const SCREENSHOT_FILE = path.join(UI_DIR, 'screenshot.html');
const PRELOAD_FILE = path.join(SRC_DIR, 'preload.js');
const TAB_PRELOAD_FILE = path.join(SRC_DIR, 'tab-preload.js');
const CORNER_PRELOAD_FILE = path.join(SRC_DIR, 'corner-preload.js');

const activeDownloadItems = new Map();
const windowContexts = new Map(); // BrowserWindow.id -> ctx
const webContentsToWinId = new Map(); // webContents.id -> BrowserWindow.id

function registerWebContents(wc, winId) {
  if (!wc || typeof wc.id !== 'number' || typeof winId !== 'number') return;
  if (typeof wc.isDestroyed === 'function' && wc.isDestroyed()) return;
  const id = wc.id;
  webContentsToWinId.set(id, winId);
  if (typeof wc.once === 'function') {
    wc.once('destroyed', () => {
      if (webContentsToWinId.get(id) === winId) {
        webContentsToWinId.delete(id);
      }
    });
  }
}

const state = {
  storage: null,
  adBlocker: null,
  sessionSaveTimer: null,
  cookiesUpdateTimer: null,
  isAppQuitting: false
};

function initCore({ onAdblockUpdate } = {}) {
  if (!state.storage) {
    state.storage = new StorageManager();
  }
  if (!state.adBlocker) {
    state.adBlocker = new AdBlocker(state.storage, onAdblockUpdate);
  }
  return { storage: state.storage, adBlocker: state.adBlocker };
}

module.exports = {
  TOP_CHROME_HEIGHT,
  BOOKMARKS_BAR_HEIGHT,
  SIDEBAR_ICON_WIDTH,
  SIDEBAR_PANEL_HEADER_HEIGHT,
  SIDEBAR_PANEL_RESIZER_WIDTH,
  SIDEBAR_PANEL_DEFAULT_WIDTH,
  SIDEBAR_PANEL_MIN_WIDTH,
  SIDEBAR_PANEL_MAX_WIDTH,
  PRIVATE_WINDOW_TITLE,
  SRC_DIR,
  UI_DIR,
  INDEX_FILE,
  NEW_TAB_FILE,
  NEW_TAB_FILE_URL,
  CORNER_FILE,
  CORNER_FILE_URL,
  WEBUI_FILE,
  WEBUI_FILE_URL,
  ERROR_PAGE_FILE,
  ERROR_PAGE_FILE_URL,
  POPOVER_FILE,
  SIDEBAR_PANEL_CHROME_FILE,
  PLAYER_PANEL_FILE,
  PLAYER_PANEL_FILE_URL,
  SCREENSHOT_FILE,
  PRELOAD_FILE,
  TAB_PRELOAD_FILE,
  CORNER_PRELOAD_FILE,
  activeDownloadItems,
  windowContexts,
  webContentsToWinId,
  registerWebContents,
  state,
  initCore
};
