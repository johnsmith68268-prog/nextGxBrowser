// Generates tight-cropped transparent multi-resolution Windows .ico, .png app icons,
// and the in-browser src/ui/assets/nextgx-emblem.png from the high-res golden 3D nGX emblem.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RAW_EMBLEM_PATH = path.join(ROOT, 'src', 'ui', 'assets', 'nextgx-emblem-raw.png');
const CLEAN_EMBLEM_PATH = path.join(ROOT, 'src', 'ui', 'assets', 'nextgx-emblem.png');
const BUILD_DIR = path.join(ROOT, 'build');
const PREVIEW_SHEET_PATH = process.env.PREVIEW_SHEET_PATH || '';

function packIco(pngBuffersWithSizes) {
  const count = pngBuffersWithSizes.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const dirEntries = [];
  let offset = 6 + count * 16;

  for (const { size, buf } of pngBuffersWithSizes) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(buf.length, 8);
    entry.writeUInt32LE(offset, 12);
    dirEntries.push(entry);
    offset += buf.length;
  }

  return Buffer.concat([header, ...dirEntries, ...pngBuffersWithSizes.map((x) => x.buf)]);
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(BUILD_DIR, { recursive: true });
    const srcPath = fs.existsSync(RAW_EMBLEM_PATH) ? RAW_EMBLEM_PATH : CLEAN_EMBLEM_PATH;
    const rawB64 = fs.readFileSync(srcPath).toString('base64');
    const sizes = [16, 24, 32, 48, 64, 128, 256, 512];

    const win = new BrowserWindow({
      width: 960,
      height: 520,
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    await win.loadURL('data:text/html;charset=utf-8,<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#12101b;"></body></html>');

    const result = await win.webContents.executeJavaScript(`(async () => {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('Emblem PNG failed to load'));
        img.src = 'data:image/png;base64,${rawB64}';
      });

      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const scan = document.createElement('canvas');
      scan.width = w;
      scan.height = h;
      const sctx = scan.getContext('2d');
      sctx.drawImage(img, 0, 0);
      const data = sctx.getImageData(0, 0, w, h).data;

      // Detect opaque non-transparent bounding box (alpha > 12)
      let minX = w, minY = h, maxX = 0, maxY = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const a = data[(y * w + x) * 4 + 3];
          if (a > 12) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX <= minX || maxY <= minY) {
        minX = 0; minY = 0; maxX = w - 1; maxY = h - 1;
      }
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      const side = Math.max(bw, bh);
      // Balanced 9% safe padding for Windows taskbar/desktop & UI breathing room (prevents clipping)
      const padIcon = Math.round(side * 0.09);
      const srcSideIcon = side + padIcon * 2;
      const padUi = Math.round(side * 0.05);
      const srcSideUi = side + padUi * 2;
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const sxIcon = cx - srcSideIcon / 2;
      const syIcon = cy - srcSideIcon / 2;
      const sxUi = cx - srcSideUi / 2;
      const syUi = cy - srcSideUi / 2;

      const sizes = ${JSON.stringify(sizes)};
      const out = {};
      for (const size of sizes) {
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, size, size);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(scan, sxIcon, syIcon, srcSideIcon, srcSideIcon, 0, 0, size, size);
        out[size] = c.toDataURL('image/png').replace(/^data:image\\/png;base64,/, '');
      }
      const uiCanvas = document.createElement('canvas');
      uiCanvas.width = 512;
      uiCanvas.height = 512;
      const uctx = uiCanvas.getContext('2d');
      uctx.clearRect(0, 0, 512, 512);
      uctx.imageSmoothingEnabled = true;
      uctx.imageSmoothingQuality = 'high';
      uctx.drawImage(scan, sxUi, syUi, srcSideUi, srcSideUi, 0, 0, 512, 512);
      const uiEmblem512 = uiCanvas.toDataURL('image/png').replace(/^data:image\\/png;base64,/, '');

      return { out, uiEmblem512, cropBox: { minX, minY, maxX, maxY, w, h } };
    })()`);

    win.destroy();

    const icoSizes = [16, 24, 32, 48, 64, 128, 256];
    const entries = icoSizes.map((size) => ({
      size,
      buf: Buffer.from(result.out[size], 'base64')
    }));
    const icoBuf = packIco(entries);
    const png256 = Buffer.from(result.out[256], 'base64');
    const png512 = Buffer.from(result.out[512], 'base64');
    const uiEmblemBuf = Buffer.from(result.uiEmblem512, 'base64');

    fs.writeFileSync(path.join(BUILD_DIR, 'icon.ico'), icoBuf);
    fs.writeFileSync(path.join(BUILD_DIR, 'icon.png'), png512);
    fs.writeFileSync(path.join(BUILD_DIR, 'icon-256.png'), png256);
    fs.writeFileSync(CLEAN_EMBLEM_PATH, uiEmblemBuf);

    if (PREVIEW_SHEET_PATH) {
      fs.mkdirSync(path.dirname(PREVIEW_SHEET_PATH), { recursive: true });
      fs.writeFileSync(PREVIEW_SHEET_PATH, Buffer.from(result.sheetB64, 'base64'));
    }

    console.log('[Icons] Crop:', JSON.stringify(result.cropBox));
    console.log(`[Icons] Generated build/icon.ico (${icoBuf.length} bytes), build/icon.png, and src/ui/assets/nextgx-emblem.png`);
    app.exit(0);
  } catch (err) {
    console.error('[Icons] Failed:', err);
    app.exit(1);
  }
});
