const { app, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { activeDownloadItems, windowContexts, state } = require('./core');
const { detectFileCategory, resolveSafeDownloadPath } = require('./utils');
const { getCtxFromSender, broadcastDownloadsUpdate } = require('./broadcast');

const inFlightSavePaths = new Set();
// s-13: incognito downloads used to live in ONE shared array, so window A's
// private downloads showed up in window B. Each private window gets its own
// session partition (see windows.js), so the session object is the natural
// per-window key: Map<session, download list>.
const incognitoDownloadsBySession = new Map();
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

function getIncognitoList(session) {
  let list = incognitoDownloadsBySession.get(session);
  if (!list) {
    list = [];
    incognitoDownloadsBySession.set(session, list);
  }
  return list;
}

function snapshotIncognitoDownloads(session) {
  const list = incognitoDownloadsBySession.get(session);
  return list ? [...list] : [];
}

// Drop lists whose window is gone. windows.js only calls
// clearIncognitoDownloads() when the LAST private window closes, so without
// this a closed window's list would linger while other private windows stay
// open (invisible, but a leak).
function pruneStaleIncognitoLists() {
  const liveSessions = new Set();
  for (const ctx of windowContexts.values()) {
    if (ctx && ctx.incognito && ctx.session) liveSessions.add(ctx.session);
  }
  for (const ses of incognitoDownloadsBySession.keys()) {
    if (!liveSessions.has(ses)) incognitoDownloadsBySession.delete(ses);
  }
}

function upsertIncognitoDownload(entry, session) {
  pruneStaleIncognitoLists();
  const list = getIncognitoList(session);
  const idx = list.findIndex((d) => d.id === entry.id);
  if (idx !== -1) {
    list[idx] = { ...list[idx], ...entry };
  } else {
    list.unshift({ ...entry });
  }
  if (list.length > 100) list.length = 100;
  return [...list];
}

function clearIncognitoDownloads(session = null) {
  // With a session: clear just that window's list. Without one (windows.js
  // calls it when the last private window closes): clear everything.
  if (session) {
    incognitoDownloadsBySession.delete(session);
    return;
  }
  incognitoDownloadsBySession.clear();
}

function broadcastIncognitoDownloads(session = null) {
  pruneStaleIncognitoLists();
  for (const ctx of windowContexts.values()) {
    if (!ctx || !ctx.incognito || !ctx.win || ctx.win.isDestroyed()) continue;
    if (session && ctx.session !== session) continue;
    try {
      // Each private window gets ONLY its own session's list.
      const snapshot = snapshotIncognitoDownloads(ctx.session);
      ctx.win.webContents.send('downloads:update', snapshot);
      ctx.popoverView?.webContents?.send('downloads:update', snapshot);
    } catch (_) {}
  }
}

function setupDownloadListener(ses, profileId = 'default', { incognito = false } = {}) {
  ses.on('will-download', (_event, item) => {
    const id = 'dl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    // [FIXUP-3] (Chrome parity gap 5.5) Honour the stored download location
    // + ask-where setting instead of always pinning app.getPath('downloads').
    // The session default path (set from ipc.js) is NOT enough: this
    // handler's setSavePath() overrides it, so it must read the settings
    // itself. Ask-where uses the synchronous native dialog — the download
    // has no path yet at this point, so blocking here is the race-free way
    // to let the user pick before any bytes are written.
    let downloadsDir = app.getPath('downloads');
    let askWhere = false;
    try {
      const settings = state.storage ? state.storage.getSettings(profileId) : null;
      if (settings) {
        if (typeof settings.downloadPath === 'string' && settings.downloadPath.trim()) {
          downloadsDir = settings.downloadPath.trim();
        }
        askWhere = settings.downloadAskWhere === true;
      }
    } catch (_) {}
    const { fileName, savePath, normKey } = getUniqueDownloadPath(downloadsDir, item.getFilename());
    let finalSavePath = savePath;
    let finalFileName = fileName;
    if (askWhere) {
      let parentWin = null;
      try {
        for (const ctx of windowContexts.values()) {
          if (ctx && ctx.session === ses && ctx.win && !ctx.win.isDestroyed()) {
            parentWin = ctx.win;
            break;
          }
        }
      } catch (_) {}
      try {
        const picked = dialog.showSaveDialogSync(parentWin || undefined, {
          title: 'Save file as',
          defaultPath: savePath,
          buttonLabel: 'Save'
        });
        if (!picked) {
          item.cancel();
          return;
        }
        finalSavePath = picked;
        finalFileName = path.basename(picked) || fileName;
      } catch (_) {
        // Dialog unavailable — fall through to the default location.
      }
    }
    inFlightSavePaths.add(normKey);
    item.setSavePath(finalSavePath);

    activeDownloadItems.set(id, item);

    let lastBytes = 0;
    let lastTime = Date.now();
    let lastBroadcastAt = 0;
    let prevState = 'progressing';

    const record = {
      id,
      filename: finalFileName,
      category: detectFileCategory(finalFileName),
      url: item.getURL(),
      savePath: finalSavePath,
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
      upsertIncognitoDownload(record, ses);
      broadcastIncognitoDownloads(ses);
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
        upsertIncognitoDownload(record, ses);
        if (stateChanged || now - lastBroadcastAt >= DOWNLOAD_PROGRESS_BROADCAST_MS) {
          lastBroadcastAt = now;
          broadcastIncognitoDownloads(ses);
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
        upsertIncognitoDownload(record, ses);
        broadcastIncognitoDownloads(ses);
      } else {
        state.storage.upsertDownload(record, profileId, { deferWrite: false });
        broadcastDownloadsUpdate(state.storage.getDownloads(profileId), { profileId });
      }
    });
  });
}

function registerDownloadIpcHandlers(handleInternal) {
  const getCtx = (e) => getCtxFromSender(e?.sender);
  const getPid = (e) => getCtx(e)?.profileId || state.storage.getActiveProfileId();
  const isIncog = (e) => Boolean(getCtx(e)?.incognito);
  // s-13: an incognito caller sees only its own window's (session's) list.
  const getIncogList = (e) => snapshotIncognitoDownloads(getCtx(e)?.session);

  handleInternal('downloads:get', (e) => (isIncog(e) ? getIncogList(e) : state.storage.getDownloads(getPid(e))));
  handleInternal('downloads:pause', (e, id) => {
    const item = activeDownloadItems.get(id);
    if (item && !item.isPaused()) item.pause();
    return isIncog(e) ? getIncogList(e) : state.storage.getDownloads(getPid(e));
  });
  handleInternal('downloads:resume', (e, id) => {
    const item = activeDownloadItems.get(id);
    if (item && item.isPaused()) item.resume();
    return isIncog(e) ? getIncogList(e) : state.storage.getDownloads(getPid(e));
  });
  handleInternal('downloads:cancel', (e, id) => {
    const item = activeDownloadItems.get(id);
    if (item) {
      item.cancel();
      activeDownloadItems.delete(id);
    }
    return isIncog(e) ? getIncogList(e) : state.storage.getDownloads(getPid(e));
  });
  handleInternal('downloads:remove', (e, id) => {
    if (isIncog(e)) {
      const ses = getCtx(e)?.session;
      if (!ses) return [];
      const list = getIncognitoList(ses);
      const idx = list.findIndex((d) => d.id === id);
      if (idx !== -1) list.splice(idx, 1);
      broadcastIncognitoDownloads(ses);
      return [...list];
    }
    const pid = getPid(e);
    const list = state.storage.removeDownload(id, pid);
    broadcastDownloadsUpdate(list, { profileId: pid });
    return list;
  });
  handleInternal('downloads:clear', (e) => {
    if (isIncog(e)) {
      // s-13: clearing in one private window must not wipe other private
      // windows' lists, so clear only this window's (session's) list.
      const ses = getCtx(e)?.session;
      if (ses) {
        clearIncognitoDownloads(ses);
        broadcastIncognitoDownloads(ses);
      }
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
