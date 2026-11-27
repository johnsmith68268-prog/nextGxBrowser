const { broadcastState } = require('./broadcast');
const { toggleWindowFullscreen } = require('./fullscreen');
// [TABS-W2] Lazy requires avoid cycles (tabs.js requires this module).
const tabsMod = () => require('./tabs');
const coreMod = () => require('./core');

let shortcutDeps = {};

function configureShortcuts(deps) {
  shortcutDeps = { ...shortcutDeps, ...(deps || {}) };
}

function sendChromeInputShortcut(ctx, action) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return;
  const winWc = ctx.win.webContents;
  if (!winWc || winWc.isDestroyed()) return;
  try {
    winWc.focus();
  } catch (_) {}
  winWc.send('shortcut:action', action);
}

function applyZoomAction(ctx, action, { notifyToast = false } = {}) {
  if (!ctx) return 100;
  const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
  if (!tab || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed()) {
    return Math.round((tab?.zoomFactor || 1.0) * 100);
  }
  let factor = tab.zoomFactor || 1.0;
  if (action === 'in') factor = Math.min(3.0, +(factor + 0.1).toFixed(2));
  else if (action === 'out') factor = Math.max(0.3, +(factor - 0.1).toFixed(2));
  else if (action === 'reset') factor = 1.0;
  tab.zoomFactor = factor;
  tab.view.webContents.setZoomFactor(factor);
  const zoomPercent = Math.round(factor * 100);
  broadcastState(ctx);
  if (notifyToast && ctx.win && !ctx.win.isDestroyed()) {
    ctx.win.webContents.send('ui:toast', `Zoom: ${zoomPercent}%`);
  }
  return zoomPercent;
}

function attachKeyboardShortcuts(ctx, webContents) {
  webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    const shift = input.shift;
    const alt = input.alt;
    const key = (input.key || '').toLowerCase();
    const code = input.code || '';

    // [TABS-W2] Gap 8.1 — tab search (Ctrl+Shift+A). Gap 5.1 — Ctrl+Tab:
    // MRU switch when the setting is on (Chrome default: off, plain cycle),
    // otherwise cycle in strip order. Gap 9.6 — reading mode (Alt+Shift+R).
    if (ctrl && shift && key === 'a') {
      event.preventDefault();
      sendChromeInputShortcut(ctx, 'open-tab-search');
    } else if (ctrl && input.key === 'Tab') {
      event.preventDefault();
      let mruOn = false;
      try {
        mruOn = coreMod().state?.storage?.getSettings?.(ctx.profileId)?.ctrlTabMru === true;
      } catch (_) {}
      if (mruOn) tabsMod().switchToMruTab(ctx);
      else tabsMod().cycleTab(ctx, shift ? -1 : 1);
    } else if (alt && shift && key === 'r') {
      event.preventDefault();
      sendChromeInputShortcut(ctx, 'toggle-reader-mode');
    } else if (ctrl && !shift && key === 't') {
      event.preventDefault();
      shortcutDeps.createTab(ctx, { url: 'nextgx://newtab', active: true });
    } else if (ctrl && shift && key === 't') {
      event.preventDefault();
      shortcutDeps.reopenLastClosedTab(ctx);
    } else if (ctrl && shift && key === 'p') {
      // [Fix2 Panic] One action hides everything (snapshot + neutral Start
      // page); pressing it again restores the previous session. Local only.
      event.preventDefault();
      try {
        require('./panic').togglePanic(ctx);
      } catch (_) {}
    } else if (ctrl && !shift && key === 'n') {
      event.preventDefault();
      shortcutDeps.createBrowserWindow({ incognito: false });
    } else if (ctrl && shift && key === 'n') {
      event.preventDefault();
      shortcutDeps.createBrowserWindow({ incognito: true });
    } else if (ctrl && !shift && key === 'w') {
      event.preventDefault();
      if (ctx.activeTabId) shortcutDeps.closeTab(ctx, ctx.activeTabId);
    } else if ((ctrl && key === 'r') || input.key === 'F5') {
      event.preventDefault();
      shortcutDeps.reloadActiveTab(ctx);
    } else if (ctrl && !shift && key === 'l') {
      event.preventDefault();
      sendChromeInputShortcut(ctx, 'focus-address-bar');
    } else if (ctrl && !shift && key === 'd') {
      event.preventDefault();
      ctx.win?.webContents.send('shortcut:action', 'toggle-bookmark');
    } else if (ctrl && !shift && key === 'h') {
      event.preventDefault();
      shortcutDeps.createTab(ctx, { url: 'nextgx://history', active: true });
    } else if (ctrl && !shift && key === 'j') {
      event.preventDefault();
      shortcutDeps.createTab(ctx, { url: 'nextgx://downloads', active: true });
    } else if (ctrl && !shift && key === 'f') {
      event.preventDefault();
      sendChromeInputShortcut(ctx, 'open-find');
    } else if (ctrl && !shift && key === 'p') {
      event.preventDefault();
      const tab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
      if (tab?.view) tab.view.webContents.print();
    } else if (ctrl && !alt && (key === '0' || (!shift && code === 'Digit0'))) {
      event.preventDefault();
      applyZoomAction(ctx, 'reset', { notifyToast: true });
    } else if (ctrl && !alt && (key === '=' || key === '+' || code === 'Equal' || code === 'NumpadAdd')) {
      event.preventDefault();
      applyZoomAction(ctx, 'in', { notifyToast: true });
    } else if (ctrl && !alt && (key === '-' || (!shift && code === 'Minus') || code === 'NumpadSubtract')) {
      event.preventDefault();
      applyZoomAction(ctx, 'out', { notifyToast: true });
    } else if (input.key === 'F11') {
      event.preventDefault();
      toggleWindowFullscreen(ctx);
    } else if (input.key === 'F12') {
      event.preventDefault();
      shortcutDeps.toggleActiveTabDevTools(ctx);
    } else if (input.key === 'Escape') {
      if (ctx.popoverOpenKind || ctx.extensionPopupView) {
        const isOmnibox =
          ctx.popoverOpenKind === 'omnibox-suggest' ||
          ctx.popoverOpenKind === 'omnibox-suggest-alt';
        if (!isOmnibox) event.preventDefault();
        shortcutDeps.closePopover(ctx, { restoreFocus: !isOmnibox });
      } else if (ctx.shellDrawerState && ctx.shellDrawerState.open) {
        event.preventDefault();
        try {
          require('./drawer-overlay').closeShellDrawer(ctx);
        } catch (_) {}
      } else if (ctx.sidebarPanel && ctx.sidebarPanel.open && !ctx.sidebarPanel.pinned) {
        event.preventDefault();
        if (typeof shortcutDeps.closeSidebarPanel === 'function') {
          shortcutDeps.closeSidebarPanel(ctx);
        }
      } else {
        const activeTab = ctx.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
        if (activeTab && activeTab.isLoading && activeTab.view?.webContents && !activeTab.view.webContents.isDestroyed()) {
          event.preventDefault();
          try {
            activeTab.view.webContents.stop();
          } catch (_) {}
        } else {
          shortcutDeps.closePopover(ctx);
        }
      }
    }
  });
}

module.exports = {
  configureShortcuts,
  applyZoomAction,
  attachKeyboardShortcuts
};
