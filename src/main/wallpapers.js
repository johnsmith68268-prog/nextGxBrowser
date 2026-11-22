const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { state } = require('./core');
const { isPathInsideDir } = require('./utils');
const { broadcastSettingsUpdate } = require('./broadcast');

const WALLPAPER_MAX_BYTES = 5 * 1024 * 1024;
const WALLPAPER_EXT_TO_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

function getWallpapersDir() {
  return path.resolve(app.getPath('userData'), 'wallpapers');
}

function detectWallpaperImageFormat(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return { ext: '.png', mime: 'image/png' };
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: '.jpg', mime: 'image/jpeg' };
  }
  // GIF: GIF87a / GIF89a
  const gifSig = buf.subarray(0, 6).toString('ascii');
  if (gifSig === 'GIF87a' || gifSig === 'GIF89a') {
    return { ext: '.gif', mime: 'image/gif' };
  }
  // WebP: RIFF....WEBP
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { ext: '.webp', mime: 'image/webp' };
  }
  return null;
}

function resolveSafeWallpaperPath(filename) {
  if (typeof filename !== 'string' || !filename || filename.includes('\0')) return null;
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) return null;
  if (path.basename(filename) !== filename) return null;
  const ext = path.extname(filename).toLowerCase();
  if (!WALLPAPER_EXT_TO_MIME[ext]) return null;
  const dir = getWallpapersDir();
  const fullPath = path.resolve(dir, filename);
  if (!isPathInsideDir(dir, fullPath)) return null;
  return fullPath;
}

function getCustomWallpaperDataUrl(filename) {
  const safePath = resolveSafeWallpaperPath(filename);
  if (!safePath) return '';
  try {
    const stat = fs.statSync(safePath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > WALLPAPER_MAX_BYTES) return '';
    const buf = fs.readFileSync(safePath);
    const detected = detectWallpaperImageFormat(buf);
    if (!detected) return '';
    return `data:${detected.mime};base64,${buf.toString('base64')}`;
  } catch (_) {
    return '';
  }
}

function saveCustomWallpaperPayload(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const rawName = typeof input.name === 'string' ? input.name.trim() : '';
  const rawExt = path.extname(rawName).toLowerCase();
  if (rawName && !WALLPAPER_EXT_TO_MIME[rawExt]) {
    return {
      ok: false,
      error: 'Unsupported image format. Please choose a PNG, JPG, WebP, or GIF image.'
    };
  }

  let buf = null;
  if (Buffer.isBuffer(input.bytes)) {
    buf = input.bytes;
  } else if (ArrayBuffer.isView(input.bytes)) {
    buf = Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength);
  } else if (input.bytes instanceof ArrayBuffer) {
    buf = Buffer.from(input.bytes);
  }

  if (!buf || buf.length === 0) {
    return { ok: false, error: 'Selected image file is empty.' };
  }
  if (buf.length > WALLPAPER_MAX_BYTES) {
    return { ok: false, error: 'Image is too large. Maximum wallpaper size is 5 MB.' };
  }

  const detected = detectWallpaperImageFormat(buf);
  if (!detected) {
    return {
      ok: false,
      error: 'File is not a valid PNG, JPG, WebP, or GIF image.'
    };
  }

  const dir = getWallpapersDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    const filename = `wallpaper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${detected.ext}`;
    const destPath = path.join(dir, filename);
    fs.writeFileSync(destPath, buf);

    const prevSettings = state.storage.getSettings();
    const prevFile = prevSettings?.wallpaper?.file || '';
    if (prevFile && prevFile !== filename) {
      const oldPath = resolveSafeWallpaperPath(prevFile);
      if (oldPath) {
        try {
          fs.unlinkSync(oldPath);
        } catch (_) {}
      }
    }

    const updated = state.storage.updateSettings({
      wallpaper: {
        ...(prevSettings.wallpaper || {}),
        type: 'custom',
        file: filename
      }
    });
    broadcastSettingsUpdate(updated);
    return {
      ok: true,
      settings: updated,
      dataUrl: `data:${detected.mime};base64,${buf.toString('base64')}`
    };
  } catch (err) {
    console.error('[Wallpaper] Failed to save custom wallpaper:', err.message);
    return { ok: false, error: 'Could not save custom wallpaper image.' };
  }
}

function removeCustomWallpaperFile() {
  const prevSettings = state.storage.getSettings();
  const prevWp = prevSettings?.wallpaper || { type: 'preset', preset: '', file: '' };
  if (prevWp.file) {
    const oldPath = resolveSafeWallpaperPath(prevWp.file);
    if (oldPath) {
      try {
        fs.unlinkSync(oldPath);
      } catch (_) {}
    }
  }
  const nextType = prevWp.type === 'custom' ? 'preset' : prevWp.type || 'preset';
  const updated = state.storage.updateSettings({
    wallpaper: {
      ...prevWp,
      type: nextType,
      file: ''
    }
  });
  broadcastSettingsUpdate(updated);
  return { ok: true, settings: updated };
}

function deleteWallpaperFileBestEffort(filename, context = 'previous') {
  if (!filename) return;
  try {
    const targetPath = resolveSafeWallpaperPath(filename);
    if (!targetPath) return;
    fs.unlinkSync(targetPath);
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      const msg = err && err.message ? err.message : String(err);
      console.warn(`[Wallpaper] Failed to delete ${context} wallpaper "${filename}": ${msg}`);
    }
  }
}

function isManagedWallpaperFilename(filename) {
  if (typeof filename !== 'string' || !filename.startsWith('wallpaper-')) return false;
  if (!resolveSafeWallpaperPath(filename)) return false;
  const ext = path.extname(filename).toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(WALLPAPER_EXT_TO_MIME, ext)) return false;
  return filename.length > 'wallpaper-'.length + ext.length;
}

function cleanupOrphanedWallpapers() {
  try {
    const dir = getWallpapersDir();
    if (!fs.existsSync(dir)) return;
    const currentFile = state.storage?.getSettings?.()?.wallpaper?.file || '';
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry || !entry.isFile()) continue;
      const name = entry.name;
      if (!name) continue;
      const isCurrent =
        Boolean(currentFile) &&
        (process.platform === 'win32'
          ? name.toLowerCase() === currentFile.toLowerCase()
          : name === currentFile);
      if (isCurrent) continue;
      if (!isManagedWallpaperFilename(name)) continue;
      deleteWallpaperFileBestEffort(name, 'orphaned');
    }
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.warn(`[Wallpaper] Orphan wallpaper sweep failed: ${msg}`);
  }
}

module.exports = {
  WALLPAPER_MAX_BYTES,
  WALLPAPER_EXT_TO_MIME,
  getWallpapersDir,
  detectWallpaperImageFormat,
  resolveSafeWallpaperPath,
  getCustomWallpaperDataUrl,
  saveCustomWallpaperPayload,
  removeCustomWallpaperFile,
  deleteWallpaperFileBestEffort,
  isManagedWallpaperFilename,
  cleanupOrphanedWallpapers
};
