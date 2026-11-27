const { app, shell, Notification } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { windowContexts, state } = require('./core');
const { isWebUiUrl } = require('./utils');

const REPO_OWNER = 'johnsmith68268-prog';
const REPO_NAME = 'nextGxBrowser';
const LATEST_RELEASE_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
const RELEASES_PAGE_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`;

const INITIAL_CHECK_DELAY_MS = 12 * 1000;
const PERIODIC_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const ONLINE_RECHECK_COOLDOWN_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10 * 1000;
const MAX_REDIRECTS = 5;

const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com'
]);

let startupTimer = null;
let periodicTimer = null;
let lastCheckAt = 0;
let activeDownloadRequest = null;
let quitInstallTriggered = false;

const updaterState = {
  status: 'idle', // idle | checking | up-to-date | available | downloading | downloaded | error
  currentVersion: typeof app?.getVersion === 'function' ? app.getVersion() : '0.0.0',
  latestVersion: '',
  releaseUrl: RELEASES_PAGE_URL,
  releaseNotes: '',
  assetName: '',
  assetUrl: '',
  assetSize: 0,
  sha256Url: '',
  downloadedPath: '',
  verifiedSha256: '',
  receivedBytes: 0,
  totalBytes: 0,
  progressPercent: 0,
  speedBytesPerSec: 0,
  canSilentInstall: false,
  lastCheckedAt: 0,
  error: ''
};

function parseSemverParts(raw) {
  const cleaned = String(raw || '')
    .trim()
    .replace(/^v/i, '')
    .split('-')[0];
  const parts = cleaned.split('.').map((n) => {
    const parsed = parseInt(n, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  });
  while (parts.length < 3) parts.push(0);
  return parts.slice(0, 3);
}

function compareSemver(a, b) {
  const pa = parseSemverParts(a);
  const pb = parseSemverParts(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

function isTrustedUpdateDownloadUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false;
  try {
    const u = new URL(rawUrl.trim());
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (!ALLOWED_DOWNLOAD_HOSTS.has(host)) return false;
    if (host === 'github.com') {
      return u.pathname.toLowerCase().startsWith(`/${REPO_OWNER.toLowerCase()}/${REPO_NAME.toLowerCase()}/`);
    }
    return true;
  } catch (_) {
    return false;
  }
}

function parseSha256Sums(text) {
  const map = new Map();
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    const m = /^\s*([a-f0-9]{64})\s+\*?(.+?)\s*$/i.exec(line);
    if (m) {
      map.set(path.basename(m[2].trim()), m[1].toLowerCase());
    }
  }
  return map;
}

function selectReleaseAsset(assets, { platform = process.platform, isPortable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE), isAppImage = Boolean(process.env.APPIMAGE) } = {}) {
  const list = Array.isArray(assets) ? assets.filter((a) => a && typeof a.name === 'string' && typeof a.browser_download_url === 'string') : [];
  const shaAsset = list.find((a) => a.name.toLowerCase() === 'sha256sums.txt') || null;
  let picked = null;
  let canSilentInstall = false;

  if (platform === 'win32') {
    if (isPortable) {
      picked = list.find((a) => /portable.*\.exe$/i.test(a.name)) || list.find((a) => /setup.*\.exe$/i.test(a.name)) || null;
      canSilentInstall = false;
    } else {
      picked = list.find((a) => /setup.*\.exe$/i.test(a.name)) || list.find((a) => /\.exe$/i.test(a.name)) || null;
      canSilentInstall = Boolean(picked && /setup.*\.exe$/i.test(picked.name));
    }
  } else if (platform === 'linux') {
    if (isAppImage) {
      picked = list.find((a) => /\.appimage$/i.test(a.name)) || list.find((a) => /\.deb$/i.test(a.name)) || null;
    } else {
      picked = list.find((a) => /\.deb$/i.test(a.name)) || list.find((a) => /\.appimage$/i.test(a.name)) || null;
    }
    canSilentInstall = false;
  }

  return {
    asset: picked,
    shaAsset,
    canSilentInstall
  };
}

function getUpdaterState() {
  return {
    ...updaterState,
    currentVersion: typeof app?.getVersion === 'function' ? app.getVersion() : updaterState.currentVersion
  };
}

function broadcastUpdaterState() {
  const snapshot = getUpdaterState();
  for (const ctx of windowContexts.values()) {
    if (!ctx || !ctx.win || ctx.win.isDestroyed()) continue;
    try {
      ctx.win.webContents.send('updater:state', snapshot);
    } catch (_) { }
    if (ctx.tabs instanceof Map) {
      for (const tab of ctx.tabs.values()) {
        const wc = tab?.view?.webContents;
        if (!wc || wc.isDestroyed()) continue;
        try {
          if (isWebUiUrl(wc.getURL())) {
            wc.send('updater:state', snapshot);
          }
        } catch (_) { }
      }
    }
  }
}

function fetchHttpsText(url, redirectDepth = 0) {
  return new Promise((resolve, reject) => {
    if (redirectDepth > MAX_REDIRECTS) {
      reject(new Error('Too many redirects'));
      return;
    }
    if (!isTrustedUpdateDownloadUrl(url)) {
      reject(new Error('Untrusted update URL'));
      return;
    }
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': `nextGx-Browser/${getUpdaterState().currentVersion}`,
          Accept: 'application/vnd.github+json'
        },
        timeout: REQUEST_TIMEOUT_MS
      },
      (res) => {
        const code = res.statusCode || 0;
        if (code >= 300 && code < 400 && res.headers.location) {
          res.resume();
          const nextUrl = new URL(res.headers.location, url).toString();
          fetchHttpsText(nextUrl, redirectDepth + 1).then(resolve, reject);
          return;
        }
        if (code < 200 || code >= 300) {
          res.resume();
          reject(new Error(`HTTP ${code}`));
          return;
        }
        const chunks = [];
        let total = 0;
        res.on('data', (chunk) => {
          total += chunk.length;
          if (total > 2 * 1024 * 1024) {
            req.destroy(new Error('Response too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
  });
}

function computeFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex').toLowerCase()));
    stream.on('error', reject);
  });
}

function downloadHttpsFile(url, destPath, onProgress, redirectDepth = 0) {
  return new Promise((resolve, reject) => {
    if (redirectDepth > MAX_REDIRECTS) {
      reject(new Error('Too many redirects'));
      return;
    }
    if (!isTrustedUpdateDownloadUrl(url)) {
      reject(new Error('Untrusted download URL'));
      return;
    }
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': `nextGx-Browser/${getUpdaterState().currentVersion}`
        },
        timeout: 30 * 1000
      },
      (res) => {
        const code = res.statusCode || 0;
        if (code >= 300 && code < 400 && res.headers.location) {
          res.resume();
          const nextUrl = new URL(res.headers.location, url).toString();
          downloadHttpsFile(nextUrl, destPath, onProgress, redirectDepth + 1).then(resolve, reject);
          return;
        }
        if (code < 200 || code >= 300) {
          res.resume();
          reject(new Error(`Download failed (HTTP ${code})`));
          return;
        }
        const totalBytes = Number(res.headers['content-length']) || 0;
        let receivedBytes = 0;
        let lastBytes = 0;
        let lastTime = Date.now();
        let lastEmit = 0;

        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        const out = fs.createWriteStream(destPath);
        res.on('data', (chunk) => {
          receivedBytes += chunk.length;
          const now = Date.now();
          if (now - lastEmit >= 250) {
            const dt = Math.max(0.1, (now - lastTime) / 1000);
            const speed = Math.round((receivedBytes - lastBytes) / dt);
            lastBytes = receivedBytes;
            lastTime = now;
            lastEmit = now;
            if (typeof onProgress === 'function') {
              onProgress({ receivedBytes, totalBytes, speedBytesPerSec: speed });
            }
          }
        });
        res.pipe(out);
        out.on('finish', () => {
          out.close(() => {
            if (typeof onProgress === 'function') {
              onProgress({ receivedBytes, totalBytes: totalBytes || receivedBytes, speedBytesPerSec: 0 });
            }
            resolve({ receivedBytes, totalBytes: totalBytes || receivedBytes });
          });
        });
        const fail = (err) => {
          try { out.destroy(); } catch (_) { }
          try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch (_) { }
          reject(err);
        };
        res.on('error', fail);
        out.on('error', fail);
      }
    );
    activeDownloadRequest = req;
    req.on('timeout', () => req.destroy(new Error('Download timed out')));
    req.on('error', (err) => {
      try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch (_) { }
      reject(err);
    });
  });
}

function getUpdatesDir() {
  return path.join(app.getPath('userData'), 'updates');
}

function notifyDesktopUpdateReady(version) {
  try {
    if (Notification && typeof Notification.isSupported === 'function' && Notification.isSupported()) {
      const n = new Notification({
        title: `nextGx Browser v${version} Ready`,
        body: 'An update has been downloaded and verified. Click Restart & Update in the toolbar whenever you are ready.'
      });
      n.show();
    }
  } catch (_) { }
}

async function checkForUpdates({ manual = false } = {}) {
  if (updaterState.status === 'checking' || updaterState.status === 'downloading') {
    return getUpdaterState();
  }
  const currentVersion = typeof app?.getVersion === 'function' ? app.getVersion() : '0.0.0';
  updaterState.currentVersion = currentVersion;
  updaterState.status = 'checking';
  updaterState.error = '';
  broadcastUpdaterState();

  try {
    const raw = await fetchHttpsText(LATEST_RELEASE_API_URL);
    const release = JSON.parse(raw);
    const latestTag = String(release?.tag_name || '').trim();
    const latestVersion = latestTag.replace(/^v/i, '');
    lastCheckAt = Date.now();
    updaterState.lastCheckedAt = lastCheckAt;
    updaterState.latestVersion = latestVersion || currentVersion;
    updaterState.releaseUrl =
      typeof release?.html_url === 'string' && isTrustedUpdateDownloadUrl(release.html_url)
        ? release.html_url
        : RELEASES_PAGE_URL;
    updaterState.releaseNotes = typeof release?.body === 'string' ? release.body.slice(0, 1500) : '';

    if (!latestVersion || compareSemver(latestVersion, currentVersion) <= 0) {
      updaterState.status = 'up-to-date';
      updaterState.error = '';
      broadcastUpdaterState();
      return getUpdaterState();
    }

    const { asset, shaAsset, canSilentInstall } = selectReleaseAsset(release.assets || []);
    updaterState.assetName = asset?.name || '';
    updaterState.assetUrl = asset?.browser_download_url || '';
    updaterState.assetSize = Number(asset?.size) || 0;
    updaterState.sha256Url = shaAsset?.browser_download_url || '';
    updaterState.canSilentInstall = Boolean(canSilentInstall);

    // Reuse an already-downloaded verified installer for the same version
    if (updaterState.assetName) {
      const existingPath = path.join(getUpdatesDir(), path.basename(updaterState.assetName));
      if (fs.existsSync(existingPath) && updaterState.verifiedSha256 && updaterState.downloadedPath === existingPath) {
        updaterState.status = 'downloaded';
        updaterState.progressPercent = 100;
        broadcastUpdaterState();
        return getUpdaterState();
      }
    }

    updaterState.status = 'available';
    broadcastUpdaterState();

    const settings = state.storage ? state.storage.getSettings() : {};
    if (settings.autoDownloadUpdates !== false && updaterState.assetUrl) {
      // Automatically download in background so updating is instant when the user clicks Restart & Update (or quits)
      downloadUpdate().catch(() => { });
    }
    return getUpdaterState();
  } catch (err) {
    lastCheckAt = Date.now();
    updaterState.lastCheckedAt = lastCheckAt;
    if (manual) {
      updaterState.status = 'error';
      updaterState.error = 'Could not reach GitHub Releases. Please check your internet connection and try again.';
    } else {
      // Stay quiet on automatic background checks when offline
      updaterState.status = 'idle';
      updaterState.error = '';
    }
    broadcastUpdaterState();
    return getUpdaterState();
  }
}

async function downloadUpdate() {
  if (updaterState.status === 'downloading') return getUpdaterState();
  if (!updaterState.assetUrl || !updaterState.assetName) {
    return { ...getUpdaterState(), error: 'No matching installer asset found for this platform.' };
  }
  if (!isTrustedUpdateDownloadUrl(updaterState.assetUrl)) {
    updaterState.status = 'error';
    updaterState.error = 'Update download URL failed host verification.';
    broadcastUpdaterState();
    return getUpdaterState();
  }

  const safeName = path.basename(updaterState.assetName);
  const updatesDir = getUpdatesDir();
  const finalPath = path.join(updatesDir, safeName);
  const partPath = `${finalPath}.part`;

  updaterState.status = 'downloading';
  updaterState.error = '';
  updaterState.receivedBytes = 0;
  updaterState.totalBytes = updaterState.assetSize || 0;
  updaterState.progressPercent = 0;
  updaterState.speedBytesPerSec = 0;
  broadcastUpdaterState();

  try {
    await downloadHttpsFile(updaterState.assetUrl, partPath, ({ receivedBytes, totalBytes, speedBytesPerSec }) => {
      updaterState.receivedBytes = receivedBytes;
      updaterState.totalBytes = totalBytes || updaterState.assetSize || 0;
      updaterState.speedBytesPerSec = speedBytesPerSec || 0;
      updaterState.progressPercent =
        updaterState.totalBytes > 0 ? Math.min(99, Math.round((receivedBytes / updaterState.totalBytes) * 100)) : 0;
      broadcastUpdaterState();
    });

    // Verify integrity via SHA256SUMS.txt whenever published with the release
    let verifiedHash = '';
    if (updaterState.sha256Url && isTrustedUpdateDownloadUrl(updaterState.sha256Url)) {
      const sumsText = await fetchHttpsText(updaterState.sha256Url);
      const sumsMap = parseSha256Sums(sumsText);
      const expectedHash = sumsMap.get(safeName);
      if (expectedHash) {
        const actualHash = await computeFileSha256(partPath);
        if (actualHash !== expectedHash) {
          try { fs.unlinkSync(partPath); } catch (_) { }
          throw new Error('SHA256 integrity verification failed — update file discarded.');
        }
        verifiedHash = actualHash;
      }
    }

    if (fs.existsSync(finalPath)) {
      try { fs.unlinkSync(finalPath); } catch (_) { }
    }
    fs.renameSync(partPath, finalPath);

    updaterState.downloadedPath = finalPath;
    updaterState.verifiedSha256 = verifiedHash || (await computeFileSha256(finalPath));
    updaterState.progressPercent = 100;
    updaterState.speedBytesPerSec = 0;
    updaterState.status = 'downloaded';
    updaterState.error = '';
    broadcastUpdaterState();
    notifyDesktopUpdateReady(updaterState.latestVersion);
    return getUpdaterState();
  } catch (err) {
    try { if (fs.existsSync(partPath)) fs.unlinkSync(partPath); } catch (_) { }
    updaterState.status = 'error';
    updaterState.error = err?.message || 'Update download failed.';
    updaterState.speedBytesPerSec = 0;
    broadcastUpdaterState();
    return getUpdaterState();
  } finally {
    activeDownloadRequest = null;
  }
}

function installDownloadedUpdate({ relaunch = true } = {}) {
  const filePath = updaterState.downloadedPath;
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, error: 'Downloaded update file not found.' };
  }

  if (process.platform === 'win32' && updaterState.canSilentInstall) {
    try {
      quitInstallTriggered = true;
      // NSIS silent update: --force-run tells electron-builder's NSIS installer to relaunch nextGx after updating
      const args = relaunch ? ['/S', '--force-run'] : ['/S'];
      const child = spawn(filePath, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      });
      child.unref();
      if (relaunch) {
        setTimeout(() => {
          try { app.quit(); } catch (_) { }
        }, 250);
      }
      return { ok: true, mode: 'silent-nsis' };
    } catch (err) {
      quitInstallTriggered = false;
      return { ok: false, error: err?.message || 'Could not launch installer.' };
    }
  }

  // Portable .exe or Linux .AppImage / .deb: reveal verified package for 1-click apply
  try {
    shell.showItemInFolder(filePath);
    return { ok: true, mode: 'reveal-folder', path: filePath };
  } catch (err) {
    return { ok: false, error: err?.message || 'Could not open downloaded update folder.' };
  }
}

function handleAppBeforeQuitAutoUpdate() {
  if (quitInstallTriggered) return;
  const settings = state.storage ? state.storage.getSettings() : {};
  if (
    settings.autoDownloadUpdates !== false &&
    updaterState.status === 'downloaded' &&
    updaterState.canSilentInstall &&
    updaterState.downloadedPath &&
    fs.existsSync(updaterState.downloadedPath)
  ) {
    installDownloadedUpdate({ relaunch: false });
  }
}

function notifyNetworkOnline() {
  const settings = state.storage ? state.storage.getSettings() : {};
  if (settings.autoCheckUpdates === false) return;
  if (updaterState.status === 'downloading' || updaterState.status === 'downloaded' || updaterState.status === 'checking') {
    return;
  }
  if (Date.now() - lastCheckAt < ONLINE_RECHECK_COOLDOWN_MS) return;
  checkForUpdates({ manual: false }).catch(() => { });
}

function startUpdaterBackgroundChecks() {
  stopUpdaterBackgroundChecks();
  startupTimer = setTimeout(() => {
    startupTimer = null;
    const settings = state.storage ? state.storage.getSettings() : {};
    if (settings.autoCheckUpdates !== false) {
      checkForUpdates({ manual: false }).catch(() => { });
    }
  }, INITIAL_CHECK_DELAY_MS);
  if (typeof startupTimer.unref === 'function') startupTimer.unref();

  periodicTimer = setInterval(() => {
    const settings = state.storage ? state.storage.getSettings() : {};
    if (settings.autoCheckUpdates !== false) {
      checkForUpdates({ manual: false }).catch(() => { });
    }
  }, PERIODIC_CHECK_INTERVAL_MS);
  if (typeof periodicTimer.unref === 'function') periodicTimer.unref();
}

function stopUpdaterBackgroundChecks() {
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  if (periodicTimer) {
    clearInterval(periodicTimer);
    periodicTimer = null;
  }
  if (activeDownloadRequest) {
    try { activeDownloadRequest.destroy(); } catch (_) { }
    activeDownloadRequest = null;
  }
}

module.exports = {
  compareSemver,
  isTrustedUpdateDownloadUrl,
  parseSha256Sums,
  selectReleaseAsset,
  computeFileSha256,
  getUpdaterState,
  checkForUpdates,
  downloadUpdate,
  installDownloadedUpdate,
  handleAppBeforeQuitAutoUpdate,
  notifyNetworkOnline,
  startUpdaterBackgroundChecks,
  stopUpdaterBackgroundChecks
};
