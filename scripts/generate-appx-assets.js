// Generates Windows AppX/MSIX tile assets inside build/appx/ from build/icon.png
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ICON_PNG = path.join(ROOT, 'build', 'icon.png');
const APPX_DIR = path.join(ROOT, 'build', 'appx');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(APPX_DIR, { recursive: true });
    const iconB64 = fs.readFileSync(ICON_PNG).toString('base64');
    const specs = [
      { name: 'StoreLogo.png', w: 50, h: 50, iconScale: 0.9 },
      { name: 'Square44x44Logo.png', w: 44, h: 44, iconScale: 0.92 },
      { name: 'Square150x150Logo.png', w: 150, h: 150, iconScale: 0.68 },
      { name: 'Wide310x150Logo.png', w: 310, h: 150, iconScale: 0.72 }
    ];

    const win = new BrowserWindow({
      width: 320,
      height: 200,
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    });
    await win.loadURL('data:text/html;charset=utf-8,<!DOCTYPE html><html><body></body></html>');

    const dataUrlJson = JSON.stringify(`data:image/png;base64,${iconB64}`);
    const rendered = await win.webContents.executeJavaScript(`(async () => {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = ${dataUrlJson};
      });
      const specs = ${JSON.stringify(specs)};
      const out = {};
      for (const s of specs) {
        const c = document.createElement('canvas');
        c.width = s.w;
        c.height = s.h;
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, s.w, s.h);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        const side = Math.round(Math.min(s.w, s.h) * s.iconScale);
        const dx = Math.round((s.w - side) / 2);
        const dy = Math.round((s.h - side) / 2);
        ctx.drawImage(img, dx, dy, side, side);
        out[s.name] = c.toDataURL('image/png').replace(/^data:image\\/png;base64,/, '');
      }
      return out;
    })()`);

    win.destroy();
    for (const [name, b64] of Object.entries(rendered)) {
      fs.writeFileSync(path.join(APPX_DIR, name), Buffer.from(b64, 'base64'));
    }
    console.log('[AppX Assets] Generated', Object.keys(rendered).join(', '));
    app.exit(0);
  } catch (err) {
    console.error('[AppX Assets] Failed:', err);
    app.exit(1);
  }
});
