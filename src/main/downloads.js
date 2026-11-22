const { app, shell } = require('electron');
const path = require('path');
const { activeDownloadItems, state } = require('./core');
const { detectFileCategory, resolveSafeDownloadPath } = require('./utils');
const { getCtxFromSender, broadcastDownloadsUpdate } = require('./broadcast');

function setupDownloadListener(ses, profileId = 'default') {
  ses.on('will-download', (_event, item) => {
    const id = 'dl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const rawName = path.basename(item.getFilename() || 'download');
    const fileName = !rawName || rawName === '.' || rawName === '..' ? 'download' : rawName;
    const downloadsDir = app.getPath('downloads');
    const savePath = path.join(downloadsDir, fileName);
    item.setSavePath(savePath);

    activeDownloadItems.set(id, item);

    let lastBytes = 0;
    let lastTime = Date.now();

    const record = {
      id,
      filename: fileName,
      category: detectFileCategory(fileName),
      url: item.getURL(),
      savePath,
      totalBytes: item.getTotalBytes(),
      receivedBytes: 0,
      speedBytesPerSec: 0,
      etaSeconds: 0,
      isPaused: false,
      state: 'progressing',
      startedAt: Date.now()
    };

    state.storage.upsertDownload(record, profileId);
    broadcastDownloadsUpdate(state.storage.getDownloads(profileId), { profileId });

    item.on('updated', (_e, downloadState) => {
      const now = Date.now();
      const dt = Math.max(0.1, (now - lastTime) / 1000);
      const currBytes = item.getReceivedBytes();
      const totalBytes = item.getTotalBytes();

      if (dt >= 0.35) {
        const diff = Math.max(0, currBytes - lastBytes);
        record.speedBytesPerSec = Math.round(diff / dt);
        lastBytes = currBytes;
        lastTime = now;
      }

      record.receivedBytes = currBytes;
      record.totalBytes = totalBytes;
      record.isPaused = item.isPaused();
      record.state = record.isPaused ? 'paused' : downloadState;
      record.etaSeconds =
        record.speedBytesPerSec > 0 && totalBytes > currBytes
          ? Math.ceil((totalBytes - currBytes) / record.speedBytesPerSec)
          : 0;

      state.storage.upsertDownload(record, profileId);
      broadcastDownloadsUpdate(state.storage.getDownloads(profileId), { profileId });
    });

    item.once('done', (_e, downloadState) => {
      activeDownloadItems.delete(id);
      record.receivedBytes = item.getReceivedBytes();
      record.totalBytes = item.getTotalBytes();
      record.speedBytesPerSec = 0;
      record.etaSeconds = 0;
      record.isPaused = false;
      record.state = downloadState;
      record.completedAt = Date.now();
      state.storage.upsertDownload(record, profileId);
      broadcastDownloadsUpdate(state.storage.getDownloads(profileId), { profileId });
    });
  });
}

function registerDownloadIpcHandlers(handleInternal) {
  const getPid = (e) => getCtxFromSender(e?.sender)?.profileId || state.storage.getActiveProfileId();

  handleInternal('downloads:get', (e) => state.storage.getDownloads(getPid(e)));
  handleInternal('downloads:pause', (e, id) => {
    const item = activeDownloadItems.get(id);
    if (item && !item.isPaused()) item.pause();
    return state.storage.getDownloads(getPid(e));
  });
  handleInternal('downloads:resume', (e, id) => {
    const item = activeDownloadItems.get(id);
    if (item && item.isPaused()) item.resume();
    return state.storage.getDownloads(getPid(e));
  });
  handleInternal('downloads:cancel', (e, id) => {
    const item = activeDownloadItems.get(id);
    if (item) {
      item.cancel();
      activeDownloadItems.delete(id);
    }
    return state.storage.getDownloads(getPid(e));
  });
  handleInternal('downloads:remove', (e, id) => {
    const pid = getPid(e);
    const list = state.storage.removeDownload(id, pid);
    broadcastDownloadsUpdate(list, { profileId: pid });
    return list;
  });
  handleInternal('downloads:clear', (e) => {
    const pid = getPid(e);
    const list = state.storage.clearDownloads(pid);
    broadcastDownloadsUpdate(list, { profileId: pid });
    return list;
  });
  handleInternal('downloads:open', (_e, savePath) => {
    const safePath = resolveSafeDownloadPath(savePath);
    if (!safePath) return;
    return shell.openPath(safePath);
  });
  handleInternal('downloads:show-folder', (_e, savePath) => {
    const safePath = resolveSafeDownloadPath(savePath);
    if (!safePath) return;
    shell.showItemInFolder(safePath);
  });
}

module.exports = {
  setupDownloadListener,
  registerDownloadIpcHandlers
};
