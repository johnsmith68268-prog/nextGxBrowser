const { app, shell, Notification } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { windowContexts, state } = require('./core');
const { isWebUiUrl, isPathInsideDir } = require('./utils');

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
  const noBuild = String(raw || '')
    .trim()
    .replace(/^v/i, '')
    .split('+')[0];
  const dashIdx = noBuild.indexOf('-');
  const core = dashIdx === -1 ? noBuild : noBuild.slice(0, dashIdx);
  const prerelease = dashIdx === -1 ? '' : noBuild.slice(dashIdx + 1).trim();
  const parts = core.split('.').map((n) => {
    const parsed = parseInt(n, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  });
  while (parts.length < 3) parts.push(0);
  return { core: parts.slice(0, 3), prerelease };
}

function compareSemver(a, b) {
  const pa = parseSemverParts(a);
  const pb = parseSemverParts(b);
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] > pb.core[i]) return 1;
    if (pa.core[i] < pb.core[i]) return -1;
  }
  if (!pa.prerelease && !pb.prerelease) return 0;
  if (!pa.prerelease && pb.prerelease) return 1;
  if (pa.prerelease && !pb.prerelease) return -1;
  const preA = pa.prerelease.split('.');
  const preB = pb.prerelease.split('.');
  const len = Math.max(preA.length, preB.length);
  for (let i = 0; i < len; i++) {
    if (i >= preA.length) return -1;
    if (i >= preB.length) return 1;
    const idA = preA[i];
    const idB = preB[i];
    if (idA === idB) continue;
    const numA = /^\d+$/.test(idA);
    const numB = /^\d+$/.test(idB);
    if (numA && numB) return Number(idA) > Number(idB) ? 1 : -1;
    if (numA !== numB) return numA ? -1 : 1;
    return idA > idB ? 1 : -1;
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

function normalizeAssetLookupKey(name) {
  return path.posix
    .basename(String(name || '').trim().replace(/\\/g, '/'))
    .toLowerCase()
    .replace(/[\s._-]+/g, '-');
}

function parseSha256Sums(text) {
  const map = new Map();
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    const m = /^\s*([a-f0-9]{64})\s+\*?(.+?)\s*$/i.exec(line);
    if (m) {
      const base = path.posix.basename(m[2].trim().replace(/\\/g, '/'));
      const digest = m[1].toLowerCase();
      if (!base) continue;
      if (map.has(base) && map.get(base) !== digest) {
        throw new Error(`Conflicting SHA256 checksum entries for "${base}".`);
      }
      map.set(base, digest);
    }
  }
  return map;
}

function lookupExpectedSha256(sumsMap, fileName) {
  if (!(sumsMap instanceof Map) || !fileName) return '';
  const safeBase = path.posix.basename(String(fileName).trim().replace(/\\/g, '/'));
  if (sumsMap.has(safeBase)) return sumsMap.get(safeBase) || '';
  const targetKey = normalizeAssetLookupKey(safeBase);
  if (!targetKey) return '';
  let matched = '';
  for (const [k, v] of sumsMap.entries()) {
    if (normalizeAssetLookupKey(k) === targetKey) {
      if (matched && matched !== v) return '';
      matched = v;
    }
  }
  return matched;
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
          let nextUrl;
          try {
            nextUrl = new URL(res.headers.location, url).toString();
          } catch (_) {
            reject(new Error('Invalid redirect URL'));
            return;
          }
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
          let nextUrl;
          try {
            nextUrl = new URL(res.headers.location, url).toString();
          } catch (_) {
            reject(new Error('Invalid redirect URL'));
            return;
          }
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
        let settled = false;

        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        const out = fs.createWriteStream(destPath);
        const fail = (err) => {
          if (settled) return;
          settled = true;
          const cleanupAndReject = () => {
            try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch (_) { }
            reject(err);
          };
          try {
            out.close(() => {
              try { out.destroy(); } catch (_) { }
              cleanupAndReject();
            });
          } catch (_) {
            try { out.destroy(); } catch (__) { }
            cleanupAndReject();
          }
        };

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
        res.on('aborted', () => fail(new Error('Download aborted before completion.')));
        res.pipe(out);
        out.on('finish', () => {
          if (settled) return;
          out.close(() => {
            if (settled) return;
            if (!res.complete || (totalBytes > 0 && receivedBytes !== totalBytes)) {
              settled = true;
              try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch (_) { }
              reject(new Error('Incomplete download (connection closed early).'));
              return;
            }
            settled = true;
            if (typeof onProgress === 'function') {
              onProgress({ receivedBytes, totalBytes: totalBytes || receivedBytes, speedBytesPerSec: 0 });
            }
            resolve({ receivedBytes, totalBytes: totalBytes || receivedBytes });
          });
        });
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
      updaterState.downloadedPath = '';
      updaterState.verifiedSha256 = '';
      updaterState.error = '';
      broadcastUpdaterState();
      return getUpdaterState();
    }

    const { asset, shaAsset, canSilentInstall } = selectReleaseAsset(release.assets || []);
    const nextAssetName = asset?.name || '';
    updaterState.assetName = nextAssetName;
    updaterState.assetUrl = asset?.browser_download_url || '';
    updaterState.assetSize = Number(asset?.size) || 0;
    updaterState.sha256Url = shaAsset?.browser_download_url || '';
    updaterState.canSilentInstall = Boolean(canSilentInstall);

    // Reuse an already-downloaded verified installer ONLY if it matches the current target asset
    if (updaterState.assetName) {
      const safeName = path.posix.basename(updaterState.assetName.replace(/\\/g, '/'));
      const existingPath = path.join(getUpdatesDir(), safeName);
      if (
        isPathInsideDir(getUpdatesDir(), existingPath) &&
        fs.existsSync(existingPath) &&
        updaterState.verifiedSha256 &&
        updaterState.downloadedPath === existingPath
      ) {
        updaterState.status = 'downloaded';
        updaterState.progressPercent = 100;
        broadcastUpdaterState();
        return getUpdaterState();
      }
    }
    updaterState.downloadedPath = '';
    updaterState.verifiedSha256 = '';

    updaterState.status = 'available';
    broadcastUpdaterState();

    const settings = state.storage ? state.storage.getSettings() : {};
    if (settings.autoDownloadUpdates !== false && updaterState.assetUrl) {
      // Automatically download in background so updating is instant when the user clicks Restart & Update (or quits)
      downloadUpdate({ background: true }).catch(() => { });
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

async function downloadUpdate({ background = false } = {}) {
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
  if (!updaterState.sha256Url || !isTrustedUpdateDownloadUrl(updaterState.sha256Url)) {
    updaterState.status = 'error';
    updaterState.error = 'Release is missing a trusted SHA256SUMS.txt checksum manifest.';
    broadcastUpdaterState();
    return getUpdaterState();
  }

  const safeName = path.posix.basename(updaterState.assetName.replace(/\\/g, '/'));
  const updatesDir = getUpdatesDir();
  const finalPath = path.join(updatesDir, safeName);
  if (!safeName || !isPathInsideDir(updatesDir, finalPath)) {
    updaterState.status = 'error';
    updaterState.error = 'Invalid update asset filename.';
    broadcastUpdaterState();
    return getUpdaterState();
  }
  const partPath = `${finalPath}.part`;

  updaterState.status = 'downloading';
  updaterState.error = '';
  updaterState.receivedBytes = 0;
  updaterState.totalBytes = updaterState.assetSize || 0;
  updaterState.progressPercent = 0;
  updaterState.speedBytesPerSec = 0;
  broadcastUpdaterState();

  let integrityFailure = false;
  try {
    const sumsText = await fetchHttpsText(updaterState.sha256Url);
    const sumsMap = parseSha256Sums(sumsText);
    const expectedHash = lookupExpectedSha256(sumsMap, safeName);
    if (!expectedHash) {
      integrityFailure = true;
      throw new Error(`No SHA256 checksum entry found for "${safeName}".`);
    }

    await downloadHttpsFile(updaterState.assetUrl, partPath, ({ receivedBytes, totalBytes, speedBytesPerSec }) => {
      updaterState.receivedBytes = receivedBytes;
      updaterState.totalBytes = totalBytes || updaterState.assetSize || 0;
      updaterState.speedBytesPerSec = speedBytesPerSec || 0;
      updaterState.progressPercent =
        updaterState.totalBytes > 0 ? Math.min(99, Math.round((receivedBytes / updaterState.totalBytes) * 100)) : 0;
      broadcastUpdaterState();
    });

    const actualHash = await computeFileSha256(partPath);
    if (actualHash !== expectedHash) {
      integrityFailure = true;
      try { fs.unlinkSync(partPath); } catch (_) { }
      throw new Error('SHA256 integrity verification failed — update file discarded.');
    }

    if (fs.existsSync(finalPath)) {
      try { fs.unlinkSync(finalPath); } catch (_) { }
    }
    fs.renameSync(partPath, finalPath);
    if (process.platform === 'linux' && /\.appimage$/i.test(finalPath)) {
      try { fs.chmodSync(finalPath, 0o755); } catch (_) { }
    }

    updaterState.downloadedPath = finalPath;
    updaterState.verifiedSha256 = actualHash;
    updaterState.progressPercent = 100;
    updaterState.speedBytesPerSec = 0;
    updaterState.status = 'downloaded';
    updaterState.error = '';
    broadcastUpdaterState();
    notifyDesktopUpdateReady(updaterState.latestVersion);
    return getUpdaterState();
  } catch (err) {
    try { if (fs.existsSync(partPath)) fs.unlinkSync(partPath); } catch (_) { }
    updaterState.downloadedPath = '';
    updaterState.verifiedSha256 = '';
    updaterState.speedBytesPerSec = 0;
    if (background && !integrityFailure) {
      updaterState.status = 'available';
      updaterState.error = '';
    } else {
      updaterState.status = 'error';
      updaterState.error = err?.message || 'Update download failed.';
    }
    broadcastUpdaterState();
    return getUpdaterState();
  } finally {
    activeDownloadRequest = null;
  }
}

function installDownloadedUpdate({ relaunch = true } = {}) {
  const filePath = updaterState.downloadedPath;
  const updatesDir = getUpdatesDir();
  if (!filePath || !isPathInsideDir(updatesDir, filePath) || !fs.existsSync(filePath)) {
    return { ok: false, error: 'Downloaded update file not found.' };
  }
  if (!updaterState.verifiedSha256) {
    return { ok: false, error: 'Update file has not passed SHA256 verification.' };
  }

  if (process.platform === 'win32' && updaterState.canSilentInstall) {
    try {
      quitInstallTriggered = true;
      // Wait for this Electron process to exit and release file/singleton locks before NSIS runs
      const psScript = [
        '$p = [int]$env:NX_UPD_PID',
        'if ($p -gt 0) { try { Wait-Process -Id $p -Timeout 25 -ErrorAction SilentlyContinue } catch {} }',
        'Start-Sleep -Milliseconds 350',
        'if ($env:NX_UPD_RELAUNCH -eq "1") { Start-Process -FilePath $env:NX_UPD_EXE -ArgumentList @("/S", "--force-run") }',
        'else { Start-Process -FilePath $env:NX_UPD_EXE -ArgumentList @("/S") }'
      ].join('; ');
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', psScript],
        {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          env: {
            ...process.env,
            NX_UPD_PID: String(process.pid),
            NX_UPD_EXE: filePath,
            NX_UPD_RELAUNCH: relaunch ? '1' : '0'
          }
        }
      );
      child.unref();
      if (relaunch) {
        setImmediate(() => {
          try { app.quit(); } catch (_) { }
        });
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
  if (activeDownloadRequest) {
    try { activeDownloadRequest.destroy(new Error('App quitting')); } catch (_) { }
    activeDownloadRequest = null;
  }
  if (quitInstallTriggered) return;
  const settings = state.storage ? state.storage.getSettings() : {};
  if (
    settings.autoDownloadUpdates !== false &&
    updaterState.status === 'downloaded' &&
    updaterState.canSilentInstall &&
    updaterState.verifiedSha256 &&
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
    try { activeDownloadRequest.destroy(new Error('Download aborted')); } catch (_) { }
    activeDownloadRequest = null;
  }
}

module.exports = {
  compareSemver,
  isTrustedUpdateDownloadUrl,
  parseSha256Sums,
  lookupExpectedSha256,
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
