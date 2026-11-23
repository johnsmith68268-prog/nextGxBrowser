// Bundled GX extension (gx-extension/) — the built-in ad-blocker /
// sidebar-player extension that ships with the repo.
//
// Finding (2026-11-23 audit): this extension was NEVER loaded by the app.
// Only user-picked unpacked extensions are loaded (src/main/extensions.js);
// nothing ever called loadExtension on the bundled folder, so its
// declarativeNetRequest rules.json was dead code in the Electron build.
// Its block list is already ported into the engine blocker
// (src/adblocker.js covers every domain in rules.json), so the engine
// blocker remains the authoritative ad-block path.
//
// This loader is best-effort reinforcement, not a dependency:
// - It loads the bundled extension into the default session (and profile
//   sessions) at startup, so its DNR rules + cosmetic content script get
//   a chance to run alongside the engine blocker.
// - It never throws and never blocks startup: any failure is logged and
//   the app keeps working on the engine blocker alone.
// - Whether Electron 45 actually enforces MV3 declarativeNetRequest
//   rules for a loaded extension is NOT guaranteed by Electron's
//   extensions support (it is partial); the load result is recorded in
//   state so Settings can report it honestly instead of claiming DNR
//   enforcement that was never verified. Do not treat "loaded" as
//   "DNR rules enforced" — the engine blocker is what is verified by
//   tests (tests/youtube-adstrip.test.js YT-5) and by the local HTTP
//   test server in the coding report.

const { session } = require('electron');
const fs = require('fs');
const path = require('path');

// Dev / unpacked layout: <repo>/gx-extension (npm start, tests).
const GX_EXTENSION_DIR = path.resolve(__dirname, '..', '..', 'gx-extension');

// Packaged layout: the extension lives INSIDE app.asar, and Chromium's
// extension loader cannot read a directory inside an asar archive — so
// electron-builder unpacks it (package.json build.asarUnpack) to a real
// directory at <resources>/app.asar.unpacked/gx-extension. The loader
// must look there, not inside app.asar.
function resolveGxExtensionDir() {
  // Packaged builds first: when the app runs from app.asar, the dev
  // path points inside the archive and Chromium cannot load from it.
  // In dev (npm start) process.resourcesPath is Electron's own resources
  // dir, which has no unpacked copy, so the dev path wins there.
  const candidates = [];
  try {
    if (process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'gx-extension'));
    }
  } catch (_) {}
  candidates.push(GX_EXTENSION_DIR);
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'manifest.json'))) return dir;
    } catch (_) {}
  }
  return GX_EXTENSION_DIR;
}

let loadState = { attempted: false, loaded: false, id: '', error: '', dnrEnforced: 'unverified' };

function getLoadState() {
  return { ...loadState };
}

async function loadBundledGxExtension({ sessions = null } = {}) {
  loadState = { attempted: true, loaded: false, id: '', error: '', dnrEnforced: 'unverified' };
  const extensionDir = resolveGxExtensionDir();
  try {
    if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) {
      loadState.error = `Bundled GX extension not found at ${extensionDir}`;
      return getLoadState();
    }
    const targets = [];
    if (Array.isArray(sessions)) {
      for (const s of sessions) if (s) targets.push(s);
    }
    if (session.defaultSession) targets.push(session.defaultSession);
    if (!targets.length) {
      loadState.error = 'No Electron session available to load the GX extension into.';
      return getLoadState();
    }
    let lastError = '';
    for (const ses of targets) {
      try {
        const api = ses.extensions || ses;
        if (!api || typeof api.loadExtension !== 'function') {
          lastError = 'session.extensions.loadExtension is unavailable in this runtime.';
          continue;
        }
        const ext = await api.loadExtension(extensionDir, { allowFileAccess: false });
        if (ext && ext.id) {
          loadState.loaded = true;
          loadState.id = ext.id;
        }
      } catch (err) {
        lastError = err?.message || String(err);
      }
    }
    if (!loadState.loaded) {
      loadState.error = lastError || 'GX extension failed to load for an unknown reason.';
    }
    return getLoadState();
  } catch (err) {
    loadState.error = err?.message || String(err);
    return getLoadState();
  }
}

module.exports = { GX_EXTENSION_DIR, resolveGxExtensionDir, getLoadState, loadBundledGxExtension };
