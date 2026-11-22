const electron = require('electron');

async function readClipboardText() {
  try {
    const clip = electron.clipboard;
    if (!clip || typeof clip.readText !== 'function') return '';
    const res = await clip.readText();
    return typeof res === 'string' ? res : '';
  } catch (_) {
    return '';
  }
}

async function writeClipboardText(text) {
  try {
    const clip = electron.clipboard;
    if (!clip || typeof clip.writeText !== 'function') return false;
    await clip.writeText(String(text ?? ''));
    return true;
  } catch (_) {
    return false;
  }
}

async function writeClipboardPng(pngBuffer) {
  const clip = electron.clipboard;
  if (!clip || !pngBuffer) return false;
  try {
    const ClipItemCtor = electron.ClipboardItem || globalThis.ClipboardItem;
    if (typeof clip.write === 'function' && typeof ClipItemCtor === 'function' && typeof Blob === 'function') {
      const blob = new Blob([pngBuffer], { type: 'image/png' });
      const item = new ClipItemCtor({ 'image/png': blob });
      await clip.write([item]);
      return true;
    }
    if (typeof clip.writeImage === 'function' && electron.nativeImage) {
      clip.writeImage(electron.nativeImage.createFromBuffer(pngBuffer));
      return true;
    }
  } catch (err) {
    console.warn('[Clipboard] Failed writing PNG image:', err?.message || err);
  }
  return false;
}

module.exports = {
  readClipboardText,
  writeClipboardText,
  writeClipboardPng
};
