const { contextBridge, ipcRenderer } = require('electron');

// Strictly gated preload bridge for the internal GX Corner hub (nextgx://corner).
// Registered via session.registerPreloadScript so src/tab-preload.js stays untouched
// and external web pages never receive any privileged APIs.
if (window.location.protocol === 'file:' && window === window.top) {
  let internalPageKind = null;
  try {
    internalPageKind = ipcRenderer.sendSync('internal:get-page-kind');
  } catch (_) {
    internalPageKind = null;
  }

  if (internalPageKind === 'corner') {
    contextBridge.exposeInMainWorld('gxCornerAPI', {
      getData: () => ipcRenderer.invoke('corner:get-data'),
      refresh: () => ipcRenderer.invoke('corner:refresh'),
      openLink: (url) => ipcRenderer.invoke('corner:open-link', url),
      getSettings: () => ipcRenderer.invoke('settings:get'),
      onUpdate: (cb) => ipcRenderer.on('corner:update', (_e, data) => cb(data)),
      onSettingsUpdate: (cb) => ipcRenderer.on('settings:update', (_e, data) => cb(data))
    });
  }
}
