// Preload for the passkey authenticator dialog (src/ui/passkey-dialog.html).
// Exposes only the two calls the dialog needs; the main process verifies the
// sender is the dialog file before answering.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gxPasskeyDialogAPI', {
  getRequest: (dialogId) => ipcRenderer.invoke('passkey:dialog-get', dialogId),
  submit: (result) => ipcRenderer.send('passkey:dialog-result', result)
});
