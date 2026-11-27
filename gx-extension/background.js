// GX Browser Core Background Service Worker for Full Chromium

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
  chrome.storage.local.set({
    adblockEnabled: true,
    autoDiscardMinutes: 10,
    activeTool: 'music',
    musicService: 'https://music.youtube.com'
  });
});

// Listen for messages from New Tab Speed Dial or Side Panel
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'OPEN_SIDE_PANEL') {
    if (msg.tool) {
      chrome.storage.local.set({ activeTool: msg.tool });
    }
    if (sender.tab && sender.tab.windowId && chrome.sidePanel && chrome.sidePanel.open) {
      chrome.sidePanel.open({ windowId: sender.tab.windowId }).catch(() => {});
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg && msg.type === 'TOGGLE_ADBLOCK') {
    const enable = Boolean(msg.enabled);
    chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: enable ? ['gx_adblock_rules'] : [],
      disableRulesetIds: enable ? [] : ['gx_adblock_rules']
    }).then(() => {
      chrome.storage.local.set({ adblockEnabled: enable });
      sendResponse({ enabled: enable });
    }).catch((err) => {
      sendResponse({ enabled: false, error: err && err.message ? err.message : 'Failed to update ruleset' });
    });
    return true;
  }

  if (msg && msg.type === 'SLEEP_BACKGROUND_TABS') {
    chrome.tabs.query({ active: false, audible: false, pinned: false }, async (tabs) => {
      let count = 0;
      for (const t of tabs) {
        if (t.id && !t.discarded && t.url && !t.url.startsWith('chrome://')) {
          try {
            await chrome.tabs.discard(t.id);
            count += 1;
          } catch (_) {}
        }
      }
      sendResponse({ discardedCount: count });
    });
    return true;
  }

  if (msg && msg.type === 'CLEAN_BROWSER_DATA') {
    const opts = msg.options || { cache: true };
    const dataToRemove = {};
    if (opts.cache) dataToRemove.cache = true;
    if (opts.cookies) dataToRemove.cookies = true;
    if (opts.history) dataToRemove.history = true;
    chrome.browsingData.remove({ since: 0 }, dataToRemove, () => {
      sendResponse({ cleaned: true });
    });
    return true;
  }
});
