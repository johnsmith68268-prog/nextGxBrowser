const { app, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { activeDownloadItems, windowContexts, state } = require('./core');
const { detectFileCategory, resolveSafeDownloadPath } = require('./utils');
const { getCtxFromSender, broadcastDownloadsUpdate } = require('./broadcast');

const inFlightSavePaths = new Set();
const incognitoDownloads = [];
const DOWNLOAD_PROGRESS_BROADCAST_MS = 250;

function getUniqueDownloadPath(downloadsDir, rawFileName) {
  const baseName = path.basename(rawFileName || 'download');
  const safeName = !baseName || baseName === '.' || baseName === '..' ? 'download' : baseName;
  const ext = path.extname(safeName);
  const stem = ext ? safeName.slice(0, -ext.length) : safeName;

  for (let i = 0; i < 1000; i++) {
    const candidateName = i === 0 ? safeName : `${stem} (${i})${ext}`;
    const candidatePath = path.join(downloadsDir, candidateName);
    const normKey = process.platform === 'win32' ? candidatePath.toLowerCase() : candidatePath;
    if (!inFlightSavePaths.has(normKey) && !fs.existsSync(candidatePath)) {
      return { fileName: candidateName, savePath: candidatePath, normKey };
    }
  }
  const fallbackName = `${stem}-${Date.now()}${ext}`;
  const fallbackPath = path.join(downloadsDir, fallbackName);
  const normKey = process.platform === 'win32' ? fallbackPath.toLowerCase() : fallbackPath;
  return { fileName: fallbackName, savePath: fallbackPath, normKey };
}

function upsertIncognitoDownload(entry) {
  const idx = incognitoDownloads.findIndex((d) => d.id === entry.id);
  if (idx !== -1) {
    incognitoDownloads[idx] = { ...incognitoDownloads[idx], ...entry };
  } else {
    incognitoDownloads.unshift({ ...entry });
  }
  if (incognitoDownloads.length > 100) incognitoDownloads.length = 100;
  return [...incognitoDownloads];
}

function clearIncognitoDownloads() {
  incognitoDownloads.length = 0;
}

function broadcastIncognitoDownloads() {
  const snapshot = [...incognitoDownloads];
  for (const ctx of windowContexts.values()) {
    if (!ctx || !ctx.incognito || !ctx.win || ctx.win.isDestroyed()) continue;
    try {
      ctx.win.webContents.send('downloads:update', snapshot);
      ctx.popoverView?.webContents?.send('downloads:update', snapshot);
    } catch (_) {}
  }
}

function setupDownloadListener(ses, profileId = 'default', { incognito = false } = {}) {
  ses.on('will-download', (_event, item) => {
    const id = 'dl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const downloadsDir = app.getPath('downloads');
    const { fileName, savePath, normKey } = getUniqueDownloadPath(downloadsDir, item.getFilename());
    inFlightSavePaths.add(normKey);
    item.setSavePath(savePath);

    activeDownloadItems.set(id, item);

    let lastBytes = 0;
    let lastTime = Date.now();
    let lastBroadcastAt = 0;
    let prevState = 'progressing';

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
      startedAt: Date.now(),
      incognito: Boolean(incognito)
    };

    if (incognito) {
      upsertIncognitoDownload(record);
      broadcastIncognitoDownloads();
    } else {
      state.storage.upsertDownload(record, profileId, { deferWrite: false });
      broadcastDownloadsUpdate(state.storage.getDownloads(profileId), { profileId });
    }

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

      const stateChanged = record.state !== prevState;
      prevState = record.state;

      if (incognito) {
        upsertIncognitoDownload(record);
        if (stateChanged || now - lastBroadcastAt >= DOWNLOAD_PROGRESS_BROADCAST_MS) {
          lastBroadcastAt = now;
          broadcastIncognitoDownloads();
        }
      } else {
        // Persist immediately only on pause/resume/interrupted transitions; debounce active progress ticks
        state.storage.upsertDownload(record, profileId, { deferWrite: !stateChanged });
        if (stateChanged || now - lastBroadcastAt >= DOWNLOAD_PROGRESS_BROADCAST_MS) {
          lastBroadcastAt = now;
          broadcastDownloadsUpdate(state.storage.getDownloads(profileId), { profileId });
        }
      }
    });

    item.once('done', (_e, downloadState) => {
      activeDownloadItems.delete(id);
      inFlightSavePaths.delete(normKey);
      record.receivedBytes = item.getReceivedBytes();
      record.totalBytes = item.getTotalBytes();
      record.speedBytesPerSec = 0;
      record.etaSeconds = 0;
      record.isPaused = false;
      record.state = downloadState;
      record.completedAt = Date.now();
      if (incognito) {
        upsertIncognitoDownload(record);
        broadcastIncognitoDownloads();
      } else {
        state.storage.upsertDownload(record, profileId, { deferWrite: false });
        broadcastDownloadsUpdate(state.storage.getDownloads(profileId), { profileId });
      }
    });
  });
}

function registerDownloadIpcHandlers(handleInternal) {
  const getPid = (e) => getCtxFromSender(e?.sender)?.profileId || state.storage.getActiveProfileId();
  const isIncog = (e) => Boolean(getCtxFromSender(e?.sender)?.incognito);

  handleInternal('downloads:get', (e) =>
    isIncog(e) ? [...incognitoDownloads] : state.storage.getDownloads(getPid(e))
  );
  handleInternal('downloads:pause', (e, id) => {
    const item = activeDownloadItems.get(id);
    if (item && !item.isPaused()) item.pause();
    return isIncog(e) ? [...incognitoDownloads] : state.storage.getDownloads(getPid(e));
  });
  handleInternal('downloads:resume', (e, id) => {
    const item = activeDownloadItems.get(id);
    if (item && item.isPaused()) item.resume();
    return isIncog(e) ? [...incognitoDownloads] : state.storage.getDownloads(getPid(e));
  });
  handleInternal('downloads:cancel', (e, id) => {
    const item = activeDownloadItems.get(id);
    if (item) {
      item.cancel();
      activeDownloadItems.delete(id);
    }
    return isIncog(e) ? [...incognitoDownloads] : state.storage.getDownloads(getPid(e));
  });
  handleInternal('downloads:remove', (e, id) => {
    if (isIncog(e)) {
      const idx = incognitoDownloads.findIndex((d) => d.id === id);
      if (idx !== -1) incognitoDownloads.splice(idx, 1);
      broadcastIncognitoDownloads();
      return [...incognitoDownloads];
    }
    const pid = getPid(e);
    const list = state.storage.removeDownload(id, pid);
    broadcastDownloadsUpdate(list, { profileId: pid });
    return list;
  });
  handleInternal('downloads:clear', (e) => {
    if (isIncog(e)) {
      clearIncognitoDownloads();
      broadcastIncognitoDownloads();
      return [];
    }
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
  getUniqueDownloadPath,
  clearIncognitoDownloads,
  setupDownloadListener,
  registerDownloadIpcHandlers
};
