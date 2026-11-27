const { app } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { state } = require('./core');
const {
  loadUnpackedExtensionFromPath,
  listManagedExtensions,
  removeManagedExtension
} = require('./extensions');

const ADGUARD_BUNDLE_VERSION = '5.6.1.7';
const DEV_ADGUARD_ZIP = path.resolve(__dirname, '..', '..', 'build', 'adguard-mv3.zip');

function resolveBundledAdguardZip() {
  const candidates = [];
  try {
    if (process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'build', 'adguard-mv3.zip'));
      candidates.push(path.join(process.resourcesPath, 'build', 'adguard-mv3.zip'));
    }
  } catch (_) {}
  candidates.push(DEV_ADGUARD_ZIP);
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) return file;
    } catch (_) {}
  }
  return '';
}

function extractZipAsync(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    if (process.platform === 'win32') {
      execFile(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Expand-Archive -LiteralPath $env:NX_AG_ZIP -DestinationPath $env:NX_AG_DEST -Force'
        ],
        {
          env: { ...process.env, NX_AG_ZIP: zipPath, NX_AG_DEST: destDir },
          windowsHide: true,
          timeout: 45000
        },
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
      return;
    }

    execFile('unzip', ['-q', '-o', zipPath, '-d', destDir], { timeout: 45000 }, (err) => {
      if (!err) {
        resolve();
        return;
      }
      execFile('python3', ['-m', 'zipfile', '-e', zipPath, destDir], { timeout: 45000 }, (err2) => {
        if (err2) reject(err2);
        else resolve();
      });
    });
  });
}

let provisionState = {
  attempted: false,
  loaded: false,
  id: '',
  version: ADGUARD_BUNDLE_VERSION,
  error: ''
};

function getBundledAdguardState() {
  return { ...provisionState };
}

async function ensureBundledAdguardExtension() {
  provisionState = {
    attempted: true,
    loaded: false,
    id: '',
    version: ADGUARD_BUNDLE_VERSION,
    error: ''
  };

  try {
    const dataRoot = path.join(app.getPath('userData'), 'nextgx-data');
    fs.mkdirSync(dataRoot, { recursive: true });
    const markerFile = path.join(dataRoot, 'bundled-adguard-marker.json');
    const unpackDir = path.join(dataRoot, `bundled-adguard-${ADGUARD_BUNDLE_VERSION}`);

    let marker = null;
    try {
      if (fs.existsSync(markerFile)) {
        marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
      }
    } catch (_) {}

    // Check if bundled AdGuard is already registered in managed extensions (explicitly tagged, never loose name regex)
    const stored = state.storage ? state.storage.getExtensions() : [];
    const existingAdguard = stored.find(
      (ext) =>
        ext &&
        (ext.isBundledAdguard === true ||
          (marker && marker.extensionId && ext.id === marker.extensionId) ||
          (typeof ext.path === 'string' && ext.path.includes('bundled-adguard-')))
    );

    if (existingAdguard) {
      if (!existingAdguard.enabled && !existingAdguard.lastError) {
        // Respect explicit user choice to disable bundled AdGuard
        provisionState.id = existingAdguard.id || '';
        return getBundledAdguardState();
      }
      const isCurrentBundleVersion =
        existingAdguard.bundledVersion === ADGUARD_BUNDLE_VERSION ||
        (typeof existingAdguard.path === 'string' &&
          existingAdguard.path.includes(`bundled-adguard-${ADGUARD_BUNDLE_VERSION}`));
      if (isCurrentBundleVersion) {
        const liveList = listManagedExtensions();
        const liveMatch = liveList.find((e) => e.id === existingAdguard.id && e.loaded);
        if (liveMatch) {
          if (state.storage && !existingAdguard.isBundledAdguard) {
            state.storage.updateExtension(existingAdguard.id, {
              isBundledAdguard: true,
              bundledVersion: ADGUARD_BUNDLE_VERSION
            });
          }
          provisionState.loaded = true;
          provisionState.id = liveMatch.id;
          return getBundledAdguardState();
        }
      } else if (existingAdguard.id) {
        // Outdated bundled AdGuard version: replace cleanly with the current bundle
        try {
          removeManagedExtension(existingAdguard.id);
        } catch (_) {}
      }
    } else if (marker && marker.provisionedVersion === ADGUARD_BUNDLE_VERSION) {
      // User explicitly removed the bundled AdGuard extension previously; do not force-reinstall
      return getBundledAdguardState();
    }

    const zipPath = resolveBundledAdguardZip();
    if (!zipPath) {
      provisionState.error = 'Bundled adguard-mv3.zip not found.';
      return getBundledAdguardState();
    }

    if (!fs.existsSync(path.join(unpackDir, 'manifest.json'))) {
      await extractZipAsync(zipPath, unpackDir);
    }

    const res = await loadUnpackedExtensionFromPath(unpackDir, {
      persist: true,
      extraRecord: {
        isBundledAdguard: true,
        bundledVersion: ADGUARD_BUNDLE_VERSION
      }
    });
    if (res && res.ok && res.extension) {
      provisionState.loaded = true;
      provisionState.id = res.extension.id || '';
      try {
        fs.writeFileSync(
          markerFile,
          JSON.stringify(
            {
              provisionedVersion: ADGUARD_BUNDLE_VERSION,
              extensionId: provisionState.id,
              provisionedAt: Date.now()
            },
            null,
            2
          ),
          'utf8'
        );
      } catch (_) {}
      // Notify open UI windows so the Extensions menu reflects AdGuard immediately
      try {
        const { broadcastSettingsUpdate } = require('./broadcast');
        if (state.storage) broadcastSettingsUpdate(state.storage.getSettings());
      } catch (_) {}
    } else {
      provisionState.error = res?.error || 'Failed to load bundled AdGuard extension.';
    }
  } catch (err) {
    provisionState.error = err?.message || String(err);
  }

  return getBundledAdguardState();
}

module.exports = {
  ADGUARD_BUNDLE_VERSION,
  resolveBundledAdguardZip,
  getBundledAdguardState,
  ensureBundledAdguardExtension
};
