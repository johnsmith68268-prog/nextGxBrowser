// Generates tight-cropped transparent multi-resolution Windows .ico, .png app icons,
// and the in-browser src/ui/assets/nextgx-emblem.png from the high-res golden 3D nGX emblem.
//
// Input resolution (first match wins):
//   1. src/ui/assets/nextgx-emblem-raw.png — the high-res transparent raw emblem (preferred).
//   2. NextGX_Logo_Pack_Refined/nextgx-app-icon.svg — pure-vector app icon, rasterized at
//      1024px. Vector, so no quality loss across runs. Note it renders the opaque dark
//      gaming tile, not the transparent golden emblem, so the raw PNG stays preferred.
// The script NEVER falls back to its own 512px output (src/ui/assets/nextgx-emblem.png):
// that would degrade quality on every run and overwrite its own input. If no source is
// found it refuses with a clear error instead.
//
// Optional: PREVIEW_SHEET_PATH=/path/to/sheet.png also writes a preview sheet PNG showing
// every generated icon size side by side.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RAW_EMBLEM_PATH = path.join(ROOT, 'src', 'ui', 'assets', 'nextgx-emblem-raw.png');
const CLEAN_EMBLEM_PATH = path.join(ROOT, 'src', 'ui', 'assets', 'nextgx-emblem.png');
const LOGO_PACK_APP_ICON_PATH = path.join(ROOT, 'NextGX_Logo_Pack_Refined', 'nextgx-app-icon.svg');
const BUILD_DIR = path.join(ROOT, 'build');
const PREVIEW_SHEET_PATH = process.env.PREVIEW_SHEET_PATH || '';
// Long side (px) at which vector (SVG) input is rasterized. 2x the largest output size.
const SVG_RASTER_LONG_SIDE = 1024;

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

// True when both paths name the same file on disk (resolves symlinks), so an aliased
// input can never silently be the script's own output file.
function sameFile(a, b) {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

// Pick the emblem source. Refuses (clear, actionable error) when nothing usable exists,
// instead of falling back to the script's own output or crashing with a raw ENOENT.
function resolveInput() {
  if (fs.existsSync(RAW_EMBLEM_PATH)) {
    return { path: RAW_EMBLEM_PATH, kind: 'png' };
  }
  if (fs.existsSync(LOGO_PACK_APP_ICON_PATH)) {
    return { path: LOGO_PACK_APP_ICON_PATH, kind: 'svg' };
  }
  throw new Error(
    '[Icons] No emblem source found — refusing to generate icons.\n' +
      `  Expected the high-res transparent emblem at:\n    ${RAW_EMBLEM_PATH}\n` +
      `  (Vector fallback is also missing: ${LOGO_PACK_APP_ICON_PATH})\n` +
      '  To fix: add the raw emblem PNG at the path above and re-run.\n' +
      `  The script will NOT regenerate from its own 512px output (${CLEAN_EMBLEM_PATH}):\n` +
      '  that would degrade quality on every run and overwrite its own input.'
  );
}

// Give an SVG explicit pixel dimensions (from its viewBox aspect ratio) so Chromium
// rasterizes it at SVG_RASTER_LONG_SIDE on the long side instead of its 300px default
// for viewBox-only SVGs. Replaces any width/height already on the root <svg> element.
function rasterizeSvgAt(svgText, longSide) {
  const vb = svgText.match(/viewBox\s*=\s*["']\s*([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s*["']/);
  let w = longSide;
  let h = longSide;
  if (vb) {
    const vbW = parseFloat(vb[3]);
    const vbH = parseFloat(vb[4]);
    if (vbW > 0 && vbH > 0) {
      const scale = longSide / Math.max(vbW, vbH);
      w = Math.max(1, Math.round(vbW * scale));
      h = Math.max(1, Math.round(vbH * scale));
    }
  }
  return svgText.replace(/<svg\b([^>]*)>/, (_m, attrs) => {
    const cleaned = attrs
      .replace(/\swidth\s*=\s*("[^"]*"|'[^']*')/g, '')
      .replace(/\sheight\s*=\s*("[^"]*"|'[^']*')/g, '');
    return `<svg${cleaned} width="${w}" height="${h}">`;
  });
}

function loadSourceDataUrl(input) {
  if (input.kind === 'svg') {
    const svg = rasterizeSvgAt(fs.readFileSync(input.path, 'utf8'), SVG_RASTER_LONG_SIDE);
    return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  }
  return `data:image/png;base64,${fs.readFileSync(input.path).toString('base64')}`;
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(BUILD_DIR, { recursive: true });
    const input = resolveInput();

    // Guard: never use the script's own output as its input (also catches symlinks).
    if (sameFile(input.path, CLEAN_EMBLEM_PATH)) {
      throw new Error(
        '[Icons] Refusing to run: the emblem input is the script\'s own output file.\n' +
          `  Input resolves to: ${input.path}\n` +
          `  Output file is:    ${CLEAN_EMBLEM_PATH}\n` +
          `  Supply the high-res raw emblem at ${RAW_EMBLEM_PATH} instead.`
      );
    }
    if (input.kind === 'svg') {
      console.log(`[Icons] No raw emblem PNG found; using vector fallback ${input.path} (opaque dark tile — for the transparent golden emblem, add ${RAW_EMBLEM_PATH})`);
    } else {
      console.log(`[Icons] Input: ${input.path}`);
    }
    const srcDataUrl = loadSourceDataUrl(input);
    const wantSheet = Boolean(PREVIEW_SHEET_PATH);
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
        img.onerror = () => reject(new Error('Emblem failed to load'));
        img.src = ${JSON.stringify(srcDataUrl)};
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
      const wantSheet = ${wantSheet};
      const out = {};
      const sizeCanvases = [];
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
        sizeCanvases.push({ size, canvas: c });
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

      // Preview sheet: every generated size side by side with labels, on the same
      // dark background the browser UI uses. Only built when the caller asked for it.
      let sheetB64 = null;
      if (wantSheet) {
        const sheet = document.createElement('canvas');
        sheet.width = 1000;
        sheet.height = 300;
        const shctx = sheet.getContext('2d');
        shctx.fillStyle = '#12101b';
        shctx.fillRect(0, 0, sheet.width, sheet.height);
        shctx.fillStyle = '#e8e6f0';
        shctx.font = '600 20px system-ui, sans-serif';
        shctx.textAlign = 'left';
        shctx.fillText('nextGx icon preview', 24, 36);
        // Display width per size (largest sizes capped so the row fits the sheet).
        const display = { 512: 160, 256: 128, 128: 96, 64: 64, 48: 48, 32: 32, 24: 24, 16: 16 };
        const top = 56;
        const rowH = 168;
        let x = 24;
        shctx.font = '13px system-ui, sans-serif';
        shctx.textAlign = 'center';
        for (const { size, canvas } of sizeCanvases) {
          const d = display[size] || size;
          const dy = top + (rowH - d) / 2;
          shctx.drawImage(canvas, x, dy, d, d);
          shctx.fillStyle = '#a9a6b8';
          shctx.fillText(size + 'px', x + d / 2, top + rowH + 20);
          x += d + 24;
        }
        sheetB64 = sheet.toDataURL('image/png').replace(/^data:image\\/png;base64,/, '');
      }

      return { out, uiEmblem512, sheetB64, cropBox: { minX, minY, maxX, maxY, w, h } };
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
      if (!result.sheetB64) {
        throw new Error('[Icons] Preview sheet was requested (PREVIEW_SHEET_PATH is set) but the renderer did not produce one.');
      }
      fs.mkdirSync(path.dirname(PREVIEW_SHEET_PATH), { recursive: true });
      fs.writeFileSync(PREVIEW_SHEET_PATH, Buffer.from(result.sheetB64, 'base64'));
      console.log(`[Icons] Wrote preview sheet: ${PREVIEW_SHEET_PATH}`);
    }

    console.log('[Icons] Crop:', JSON.stringify(result.cropBox));
    console.log(`[Icons] Generated build/icon.ico (${icoBuf.length} bytes), build/icon.png, and src/ui/assets/nextgx-emblem.png`);
    app.exit(0);
  } catch (err) {
    // Errors this script throws already carry a clear, actionable message; print it
    // plainly. Unexpected errors print with their stack for debugging.
    if (err instanceof Error && err.message.startsWith('[Icons]')) {
      console.error(err.message);
    } else {
      console.error('[Icons] Failed:', err);
    }
    app.exit(1);
  }
});
