const { Menu, dialog } = require('electron');
const path = require('path');
const { state, windowContexts } = require('./core');
const { broadcastState, broadcastBookmarksUpdate, broadcastSettingsUpdate } = require('./broadcast');
const { formatDisplayUrl } = require('./navigation');
const { resolveInternalUiFile, isErrorPageUrl } = require('./utils');
const { savePageAsPdf } = require('./screenshots');
const { readClipboardText, writeClipboardText } = require('./clipboard-utils');

const tabsMod = () => require('./tabs');
const windowsMod = () => require('./windows');

function getSearchEngineMeta() {
  const engine = state.storage?.getSettings?.()?.searchEngine || 'google';
  if (engine === 'duckduckgo') {
    return { name: 'DuckDuckGo', buildUrl: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}` };
  }
  if (engine === 'bing') {
    return { name: 'Bing', buildUrl: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}` };
  }
  return { name: 'Google', buildUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}` };
}

function truncateLabel(text, max = 32) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1) + '…';
}

function isWebUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

// s-9: Electron's showSaveDialog result carries no selected-filter info, so
// the old single dialog with two filters could never honor the "HTML Only"
// choice — the handler always saved 'HTMLComplete'. The choice now lives in
// the menu (submenu), and each item calls this helper with its save type.
async function savePageWithType(ctx, wc, pageTitle, saveType) {
  if (!wc || wc.isDestroyed() || !ctx.win || ctx.win.isDestroyed()) return;
  const safeName = pageTitle.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 64) || 'page';
  const filterName = saveType === 'HTMLOnly' ? 'Webpage, HTML Only' : 'Webpage, Complete';
  const res = await dialog.showSaveDialog(ctx.win, {
    title: 'Save Page As',
    defaultPath: path.join(require('electron').app.getPath('downloads'), `${safeName}.html`),
    filters: [{ name: filterName, extensions: ['html', 'htm'] }]
  });
  if (res.canceled || !res.filePath || wc.isDestroyed()) return;
  try {
    await wc.savePage(res.filePath, saveType);
    ctx.win?.webContents.send('ui:toast', `Saved: ${path.basename(res.filePath)}`);
  } catch (err) {
    ctx.win?.webContents.send('ui:toast', `Save failed: ${err?.message || 'Error'}`);
  }
}

function attachWebContentsContextMenu(ctx, wc, { isSidebar = false } = {}) {
  if (!ctx || !wc) return;

  wc.on('context-menu', (_event, params) => {
    if (!ctx.win || ctx.win.isDestroyed() || wc.isDestroyed()) return;

    const template = [];
    const pageUrl = params.pageURL || wc.getURL() || '';
    const displayUrl = formatDisplayUrl(pageUrl);
    const hasWebUrl = isWebUrl(pageUrl) && !isErrorPageUrl(pageUrl) && !resolveInternalUiFile(pageUrl);
    const selection = typeof params.selectionText === 'string' ? params.selectionText.trim() : '';

    // 1. Spellcheck suggestions for misspelled words in editable inputs
    if (
      params.isEditable &&
      params.misspelledWord &&
      Array.isArray(params.dictionarySuggestions) &&
      params.dictionarySuggestions.length > 0
    ) {
      for (const word of params.dictionarySuggestions.slice(0, 5)) {
        template.push({
          label: word,
          click: () => {
            if (!wc.isDestroyed()) wc.replaceMisspelling(word);
          }
        });
      }
      template.push({ type: 'separator' });
    }

    // 2. Link actions
    if (params.linkURL && /^https?:\/\//i.test(params.linkURL)) {
      const linkUrl = params.linkURL;
      template.push(
        {
          label: 'Open link in new tab',
          click: () => tabsMod().createTab(ctx, { url: linkUrl, incognito: ctx.incognito, active: true })
        },
        {
          label: 'Open link in new window',
          click: () => {
            // n-1: from a private window, open a private window so the URL
            // does not land in normal history.
            windowsMod().createBrowserWindow({ incognito: Boolean(ctx.incognito), initialUrl: linkUrl });
          }
        },
        {
          label: 'Open link in Private window',
          click: () => {
            windowsMod().createBrowserWindow({ incognito: true, initialUrl: linkUrl });
          }
        },
        {
          label: 'Copy link address',
          click: async () => {
            if (await writeClipboardText(linkUrl)) {
              ctx.win?.webContents.send('ui:toast', 'Link address copied');
            }
          }
        },
        { type: 'separator' }
      );
    }

    // 3. Image actions
    if (params.mediaType === 'image' && params.srcURL) {
      const srcUrl = params.srcURL;
      template.push(
        {
          label: 'Open image in new tab',
          click: () => tabsMod().createTab(ctx, { url: srcUrl, incognito: ctx.incognito, active: true })
        },
        {
          label: 'Save image as...',
          click: () => {
            if (!wc.isDestroyed()) wc.downloadURL(srcUrl);
          }
        },
        {
          label: 'Copy image',
          click: () => {
            if (!wc.isDestroyed()) wc.copyImageAt(params.x, params.y);
          }
        },
        {
          label: 'Copy image address',
          click: async () => {
            if (await writeClipboardText(srcUrl)) {
              ctx.win?.webContents.send('ui:toast', 'Image address copied');
            }
          }
        },
        { type: 'separator' }
      );
    }

    // 4. Editable field menu (matches Opera GX text-box right click)
    if (params.isEditable) {
      const flags = params.editFlags || {};
      template.push(
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          enabled: Boolean(flags.canUndo),
          click: () => {
            if (!wc.isDestroyed()) wc.undo();
          }
        },
        {
          label: 'Redo',
          accelerator: 'CmdOrCtrl+Y',
          enabled: Boolean(flags.canRedo),
          click: () => {
            if (!wc.isDestroyed()) wc.redo();
          }
        },
        { type: 'separator' },
        {
          label: 'Cut',
          accelerator: 'CmdOrCtrl+X',
          enabled: Boolean(flags.canCut),
          click: () => {
            if (!wc.isDestroyed()) wc.cut();
          }
        },
        {
          label: 'Copy',
          accelerator: 'CmdOrCtrl+C',
          enabled: Boolean(flags.canCopy),
          click: () => {
            if (!wc.isDestroyed()) wc.copy();
          }
        },
        {
          label: 'Paste',
          accelerator: 'CmdOrCtrl+V',
          enabled: Boolean(flags.canPaste),
          click: () => {
            if (!wc.isDestroyed()) wc.paste();
          }
        },
        {
          label: 'Paste as plain text',
          accelerator: 'CmdOrCtrl+Shift+V',
          enabled: Boolean(flags.canPaste),
          click: () => {
            if (!wc.isDestroyed()) wc.pasteAndMatchStyle();
          }
        },
        {
          label: 'Delete',
          enabled: Boolean(flags.canDelete),
          click: () => {
            if (!wc.isDestroyed()) wc.delete();
          }
        },
        {
          label: 'Select all',
          accelerator: 'CmdOrCtrl+A',
          enabled: Boolean(flags.canSelectAll),
          click: () => {
            if (!wc.isDestroyed()) wc.selectAll();
          }
        }
      );

      if (selection) {
        const engine = getSearchEngineMeta();
        template.push(
          { type: 'separator' },
          {
            label: `Search ${engine.name} for "${truncateLabel(selection)}"`,
            click: () => tabsMod().createTab(ctx, { url: engine.buildUrl(selection), incognito: ctx.incognito, active: true })
          }
        );
      }

      template.push(
        { type: 'separator' },
        {
          label: 'Inspect element',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => {
            if (!wc.isDestroyed()) wc.inspectElement(params.x, params.y);
          }
        }
      );
    } else {
      // 5. Text selection actions on normal page
      if (selection) {
        const engine = getSearchEngineMeta();
        template.push(
          {
            label: 'Copy',
            accelerator: 'CmdOrCtrl+C',
            click: () => {
              if (!wc.isDestroyed()) wc.copy();
            }
          },
          {
            label: `Search ${engine.name} for "${truncateLabel(selection)}"`,
            click: () => tabsMod().createTab(ctx, { url: engine.buildUrl(selection), incognito: ctx.incognito, active: true })
          },
          { type: 'separator' }
        );
      }

      // 6. Standard Page Menu (Opera GX style)
      const canGoBack = wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack();
      const canGoForward = wc.navigationHistory ? wc.navigationHistory.canGoForward() : wc.canGoForward();
      const settings = state.storage?.getSettings?.(ctx.profileId) || {};
      const pid = ctx.profileId || state.storage?.getActiveProfileId?.() || 'default';
      const pageTitle = wc.getTitle?.() || displayUrl || 'Page';

      template.push(
        {
          label: 'Back',
          accelerator: 'Alt+Left',
          enabled: Boolean(canGoBack),
          click: () => {
            if (!wc.isDestroyed() && (wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack())) {
              wc.goBack();
            }
          }
        },
        {
          label: 'Forward',
          accelerator: 'Alt+Right',
          enabled: Boolean(canGoForward),
          click: () => {
            if (!wc.isDestroyed() && (wc.navigationHistory ? wc.navigationHistory.canGoForward() : wc.canGoForward())) {
              wc.goForward();
            }
          }
        },
        {
          label: 'Reload',
          accelerator: 'F5',
          click: () => {
            if (!wc.isDestroyed()) wc.reload();
          }
        },
        { type: 'separator' },
        {
          label: 'Add to Speed Dial',
          enabled: hasWebUrl,
          click: () => {
            if (!hasWebUrl || !state.storage?.addSpeedDial) return;
            state.storage.addSpeedDial({ title: truncateLabel(pageTitle, 28), url: pageUrl });
            ctx.win?.webContents.send('ui:toast', 'Added to Speed Dial');
          }
        },
        {
          label: 'Add to bookmarks...',
          enabled: hasWebUrl,
          click: () => {
            if (!hasWebUrl || !state.storage?.toggleBookmark) return;
            const res = state.storage.toggleBookmark({ title: pageTitle, url: pageUrl }, pid);
            broadcastBookmarksUpdate(res.bookmarks, { profileId: pid });
            for (const c of windowContexts.values()) {
              if ((c.profileId || 'default') === pid) broadcastState(c);
            }
            ctx.win?.webContents.send('ui:toast', res.added ? 'Saved to Bookmarks' : 'Removed from Bookmarks');
          }
        },
        { type: 'separator' },
        {
          label: ctx.win.isFullScreen() ? 'Exit full screen' : 'Enter full screen',
          accelerator: 'F11',
          click: () => {
            if (ctx.win && !ctx.win.isDestroyed()) {
              ctx.win.setFullScreen(!ctx.win.isFullScreen());
            }
          }
        },
        {
          label: 'Copy address',
          enabled: Boolean(displayUrl),
          click: async () => {
            if (await writeClipboardText(displayUrl)) {
              ctx.win?.webContents.send('ui:toast', 'Page address copied');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Save as...',
          enabled: hasWebUrl && !isSidebar,
          submenu: [
            {
              label: 'Webpage, Complete',
              // Accelerator lives here (not on the submenu parent, where
              // Electron ignores it) so CmdOrCtrl+S keeps working as before.
              accelerator: 'CmdOrCtrl+S',
              click: () => savePageWithType(ctx, wc, pageTitle, 'HTMLComplete')
            },
            {
              label: 'Webpage, HTML Only',
              click: () => savePageWithType(ctx, wc, pageTitle, 'HTMLOnly')
            }
          ]
        },
        {
          label: 'Save as PDF...',
          enabled: !isSidebar,
          click: () => savePageAsPdf(ctx, wc)
        },
        {
          label: 'Force dark page',
          type: 'checkbox',
          checked: Boolean(settings.forceDarkWeb),
          click: () => {
            if (!state.storage) return;
            const nextDark = !Boolean(state.storage.getSettings(pid)?.forceDarkWeb);
            const updated = state.storage.updateSettings({ forceDarkWeb: nextDark }, pid);
            broadcastSettingsUpdate(updated, { profileId: pid });
            if (!wc.isDestroyed()) wc.reload();
          }
        },
        {
          label: 'Print...',
          accelerator: 'CmdOrCtrl+P',
          click: () => {
            if (!wc.isDestroyed()) wc.print();
          }
        },
        { type: 'separator' },
        {
          label: 'View page source',
          accelerator: 'CmdOrCtrl+U',
          enabled: hasWebUrl,
          click: () => tabsMod().createTab(ctx, { url: `view-source:${pageUrl}`, incognito: ctx.incognito, active: true })
        },
        {
          label: 'Inspect element',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => {
            if (!wc.isDestroyed()) wc.inspectElement(params.x, params.y);
          }
        }
      );
    }

    try {
      const menu = Menu.buildFromTemplate(template);
      menu.popup({ window: ctx.win });
    } catch (_) {}
  });
}

function isUrlLikeClipboard(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  if (/^(https?:\/\/|file:\/\/|view-source:|data:|(?:nextgx|chrome|gx):\/\/)/i.test(trimmed)) return true;
  return (
    /^(localhost(:\d+)?|(\d{1,3}\.){3}\d{1,3}(:\d+)?|([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(:\d+)?)(\/.*)?$/i.test(
      trimmed
    ) && !trimmed.includes(' ')
  );
}

function attachChromeContextMenu(ctx) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return;
  const wc = ctx.win.webContents;
  if (!wc || wc.isDestroyed()) return;

  wc.on('context-menu', async (_event, params) => {
    if (!ctx.win || ctx.win.isDestroyed() || wc.isDestroyed()) return;
    if (!params || !params.isEditable) return;

    const flags = params.editFlags || {};
    const explicitTarget = ctx._lastChromeContextTarget || null;
    ctx._lastChromeContextTarget = null;
    const isAddressBar =
      explicitTarget === 'address-bar' ||
      (explicitTarget === null && typeof params.y === 'number' && params.y >= 36 && params.y <= 88);
    const clipText = await readClipboardText();
    if (!ctx.win || ctx.win.isDestroyed() || wc.isDestroyed()) return;
    const trimmedClip = clipText.trim();
    const pasteAndGoLabel = isUrlLikeClipboard(trimmedClip) ? 'Paste and go' : 'Paste and search';

    const template = [
      {
        label: 'Undo',
        accelerator: 'CmdOrCtrl+Z',
        enabled: Boolean(flags.canUndo),
        click: () => {
          if (!wc.isDestroyed()) wc.undo();
        }
      },
      { type: 'separator' },
      {
        label: 'Cut',
        accelerator: 'CmdOrCtrl+X',
        enabled: Boolean(flags.canCut),
        click: () => {
          if (!wc.isDestroyed()) wc.cut();
        }
      },
      {
        label: 'Copy',
        accelerator: 'CmdOrCtrl+C',
        enabled: Boolean(flags.canCopy),
        click: () => {
          if (!wc.isDestroyed()) wc.copy();
        }
      },
      {
        label: 'Paste',
        accelerator: 'CmdOrCtrl+V',
        enabled: Boolean(flags.canPaste || clipText.length > 0),
        click: () => {
          if (!wc.isDestroyed()) wc.paste();
        }
      }
    ];

    if (isAddressBar) {
      template.push({
        label: pasteAndGoLabel,
        enabled: trimmedClip.length > 0,
        click: () => {
          if (trimmedClip) {
            tabsMod().navigateActiveTab(ctx, trimmedClip);
          }
        }
      });
    } else {
      template.push({
        label: 'Delete',
        enabled: Boolean(flags.canDelete),
        click: () => {
          if (!wc.isDestroyed()) wc.delete();
        }
      });
    }

    template.push(
      { type: 'separator' },
      {
        label: 'Select all',
        accelerator: 'CmdOrCtrl+A',
        enabled: Boolean(flags.canSelectAll),
        click: () => {
          if (!wc.isDestroyed()) wc.selectAll();
        }
      }
    );

    if (isAddressBar) {
      template.push(
        { type: 'separator' },
        {
          label: 'Edit search engines...',
          click: () => tabsMod().createTab(ctx, { url: 'nextgx://settings', active: true })
        }
      );
    }

    try {
      const menu = Menu.buildFromTemplate(template);
      menu.popup({ window: ctx.win });
    } catch (_) {}
  });
}

module.exports = {
  attachWebContentsContextMenu,
  attachChromeContextMenu
};
