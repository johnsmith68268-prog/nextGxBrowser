const { app, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { state } = require('./core');
const { broadcastDownloadsUpdate } = require('./broadcast');
const { writeClipboardPng } = require('./clipboard-utils');

function recordSavedFileInDownloads(ctx, { filename, savePath, bytes, category = 'media', url = 'nextgx://screenshot' }) {
  if (ctx?.incognito) return;
  const pid = ctx?.profileId || state.storage?.getActiveProfileId?.() || 'default';
  state.storage.upsertDownload(
    {
      id: 'dl-shot-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
      filename,
      category,
      url,
      savePath,
      totalBytes: bytes,
      receivedBytes: bytes,
      speedBytesPerSec: 0,
      etaSeconds: 0,
      isPaused: false,
      state: 'completed',
      startedAt: Date.now(),
      completedAt: Date.now()
    },
    pid
  );
  broadcastDownloadsUpdate(state.storage.getDownloads(pid), { profileId: pid });
}

async function captureFullPagePng(ctx, fallbackBuffer = null) {
  const tab = ctx?.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
  const wc = tab?.view?.webContents;
  if (!wc || wc.isDestroyed()) return fallbackBuffer;
  const pageUrl = wc.getURL?.() || '';
  // CDP full-page capture works best on web documents; gracefully fall back if debugger already attached
  if (!/^https?:\/\//i.test(pageUrl)) return fallbackBuffer;

  let attachedHere = false;
  try {
    if (!wc.debugger.isAttached()) {
      wc.debugger.attach('1.3');
      attachedHere = true;
    }
    const res = await wc.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      fromSurface: true
    });
    if (res && typeof res.data === 'string' && res.data.length > 0) {
      return Buffer.from(res.data, 'base64');
    }
  } catch (err) {
    console.warn('[Screenshot] Full-page CDP capture fallback to visible viewport:', err?.message || err);
  } finally {
    if (attachedHere && !wc.isDestroyed()) {
      try {
        wc.debugger.detach();
      } catch (_) {}
    }
  }
  return fallbackBuffer;
}

async function copyScreenshotPng(ctx, pngBuffer) {
  const ok = await writeClipboardPng(pngBuffer);
  if (ok) {
    ctx.win?.webContents.send('ui:toast', 'Screenshot copied to clipboard');
    return { ok: true, copied: true };
  }
  ctx.win?.webContents.send('ui:toast', 'Failed to copy screenshot to clipboard');
  return { ok: false, error: 'Clipboard image write failed' };
}

async function saveScreenshotPng(ctx, pngBuffer, label = 'Full') {
  const filename = `nextGx-${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
  const savePath = path.join(app.getPath('downloads'), filename);
  fs.writeFileSync(savePath, pngBuffer);

  await writeClipboardPng(pngBuffer);

  recordSavedFileInDownloads(ctx, { filename, savePath, bytes: pngBuffer.length });
  ctx.win?.webContents.send('ui:toast', `Screenshot saved & copied: ${filename}`);
  return { ok: true, savePath, filename };
}

async function saveScreenshotWithDialog(ctx, pngBuffer, label = 'Snap') {
  const defaultName = `nextGx-${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
  const defaultPath = path.join(app.getPath('downloads'), defaultName);

  const res = await dialog.showSaveDialog(ctx.win, {
    title: 'Save Screenshot',
    defaultPath,
    filters: [{ name: 'PNG Image', extensions: ['png'] }]
  });

  if (res.canceled || !res.filePath) {
    return { ok: false, canceled: true };
  }

  fs.writeFileSync(res.filePath, pngBuffer);
  await writeClipboardPng(pngBuffer);

  const filename = path.basename(res.filePath);
  recordSavedFileInDownloads(ctx, { filename, savePath: res.filePath, bytes: pngBuffer.length });
  ctx.win?.webContents.send('ui:toast', `Screenshot saved: ${filename}`);
  return { ok: true, savePath: res.filePath, filename };
}

async function savePageAsPdf(ctx, targetWc = null) {
  const tab = ctx?.activeTabId ? ctx.tabs.get(ctx.activeTabId) : null;
  const wc = targetWc || tab?.view?.webContents;
  if (!wc || wc.isDestroyed() || !ctx?.win || ctx.win.isDestroyed()) {
    return { ok: false, error: 'No active page to export' };
  }

  const rawTitle = (wc.getTitle?.() || tab?.title || 'page').replace(/[\\/:*?"<>|]+/g, '_').trim();
  const defaultName = `${rawTitle.slice(0, 64) || 'page'}.pdf`;
  const res = await dialog.showSaveDialog(ctx.win, {
    title: 'Save Page as PDF',
    defaultPath: path.join(app.getPath('downloads'), defaultName),
    filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
  });

  if (res.canceled || !res.filePath || wc.isDestroyed()) {
    return { ok: false, canceled: true };
  }

  try {
    const pdfBuffer = await wc.printToPDF({
      printBackground: true,
      preferCSSPageSize: true
    });
    fs.writeFileSync(res.filePath, pdfBuffer);
    const filename = path.basename(res.filePath);
    recordSavedFileInDownloads(ctx, {
      filename,
      savePath: res.filePath,
      bytes: pdfBuffer.length,
      category: 'documents',
      url: 'nextgx://pdf-export'
    });
    ctx.win?.webContents.send('ui:toast', `PDF saved: ${filename}`);
    return { ok: true, savePath: res.filePath, filename };
  } catch (err) {
    ctx.win?.webContents.send('ui:toast', `PDF export failed: ${err?.message || 'Error'}`);
    return { ok: false, error: err?.message || 'PDF export failed' };
  }
}

module.exports = {
  captureFullPagePng,
  copyScreenshotPng,
  saveScreenshotPng,
  saveScreenshotWithDialog,
  savePageAsPdf
};
