const { app, clipboard, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { state } = require('./core');
const { broadcastDownloadsUpdate } = require('./broadcast');

async function saveScreenshotPng(ctx, pngBuffer, label = 'Full') {
  const filename = `nextGx-${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
  const savePath = path.join(app.getPath('downloads'), filename);
  fs.writeFileSync(savePath, pngBuffer);

  try {
    clipboard.writeImage(nativeImage.createFromBuffer(pngBuffer));
  } catch (_) {}

  state.storage.upsertDownload({
    id: 'dl-shot-' + Date.now(),
    filename,
    category: 'media',
    url: 'nextgx://screenshot',
    savePath,
    totalBytes: pngBuffer.length,
    receivedBytes: pngBuffer.length,
    speedBytesPerSec: 0,
    etaSeconds: 0,
    isPaused: false,
    state: 'completed',
    startedAt: Date.now(),
    completedAt: Date.now()
  });

  broadcastDownloadsUpdate(state.storage.getDownloads());
  ctx.win?.webContents.send('ui:toast', `Screenshot saved & copied: ${filename}`);
  return { ok: true, savePath, filename };
}

module.exports = {
  saveScreenshotPng
};
