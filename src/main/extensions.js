const { app, session, dialog } = require('electron');
const crypto = require('crypto');
const { execFile, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { state } = require('./core');
const { normalizePathForCompare, isPathInsideDir } = require('./utils');
const { getCtxFromSender, broadcastSettingsUpdate } = require('./broadcast');
const {
  sanitizeRelativeAssetPath,
  resolveExtensionPopup,
  resolveExtensionIcon,
  readManifestFromPath
} = require('./extension-manifest');
const { closeExtensionPopupsForExtension } = require('./extension-popup');

function getSessionExtensionsApi(ses = session.defaultSession) {
  return ses.extensions || ses;
}

function getAllProfileExtensionSessions() {
  const sessions = new Set();
  if (session.defaultSession) sessions.add(session.defaultSession);
  try {
    const { getInitializedProfileSessions } = require('./profiles');
    if (typeof getInitializedProfileSessions === 'function') {
      for (const s of getInitializedProfileSessions()) {
        if (s) sessions.add(s);
      }
    }
  } catch (_) { }
  return Array.from(sessions);
}

async function mirrorExtensionLoadToOtherSessions(resolvedPath, extId = '') {
  const sessions = getAllProfileExtensionSessions();
  await Promise.allSettled(
    sessions
      .filter((s) => s && s !== session.defaultSession)
      .map(async (ses) => {
        const api = getSessionExtensionsApi(ses);
        if (api && typeof api.loadExtension === 'function') {
          if (extId && typeof api.getExtension === 'function' && api.getExtension(extId)) return;
          await api.loadExtension(resolvedPath, { allowFileAccess: false });
        }
      })
  );
}

function mirrorExtensionRemoveFromAllSessions(id) {
  const sessions = getAllProfileExtensionSessions();
  for (const ses of sessions) {
    try {
      const api = getSessionExtensionsApi(ses);
      if (api?.getExtension?.(id) && typeof api.removeExtension === 'function') {
        api.removeExtension(id);
      }
    } catch (_) { }
  }
}

async function syncPersistedExtensionsToSession(ses) {
  if (!ses || ses === session.defaultSession || !state.storage) return;
  const api = getSessionExtensionsApi(ses);
  if (!api || typeof api.loadExtension !== 'function') return;
  const stored = state.storage.getExtensions();
  await Promise.allSettled(
    stored
      .filter((rec) => rec && rec.enabled && rec.path)
      .map(async (rec) => {
        if (api.getExtension?.(rec.id)) return;
        await api.loadExtension(rec.path, { allowFileAccess: false });
      })
  );
}

function parseExtensionWarningLines(message) {
  if (!message || typeof message !== 'string') return [];
  return message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^Warnings loading extension at /i.test(line));
}

async function captureExtensionLoadWarnings(extPath, asyncFn) {
  const captured = [];
  const normTarget = normalizePathForCompare(path.resolve(extPath));
  const onWarning = (warning) => {
    if (!warning || warning.name !== 'ExtensionLoadWarning') return;
    const msg = String(warning.message || '');
    const normMsg = normalizePathForCompare(msg);
    if (!normTarget || normMsg.includes(normTarget) || !msg.includes('Warnings loading extension at')) {
      for (const line of parseExtensionWarningLines(msg)) {
        if (!captured.includes(line)) captured.push(line);
      }
    }
  };

  process.on('warning', onWarning);
  try {
    const value = await asyncFn();
    // Node queues process.emitWarning listeners on nextTick; yield once so warnings are captured.
    await new Promise((resolve) => setImmediate(resolve));
    return { value, warnings: captured };
  } finally {
    process.removeListener('warning', onWarning);
  }
}

const CHROME_ONLY_MANIFEST_KEYS = [
  'differential_fingerprint',
  'update_url',
  'minimum_chrome_version',
  'offline_enabled',
  'side_panel',
  'trial_tokens',
  'chrome_settings_overrides',
  'chrome_url_overrides',
  'oauth2',
  'cross_origin_embedder_policy',
  'cross_origin_opener_policy',
  'sandbox',
  'key'
];

const ELECTRON_UNSUPPORTED_PERMISSIONS = new Set([
  'sidePanel',
  'offscreen',
  'tabGroups',
  'identity',
  'identity.email',
  'gcm',
  'notifications',
  'privacy',
  'browsingData',
  'search',
  'readingList',
  'declarativeContent',
  'sessions',
  'topSites',
  'bookmarks',
  'history',
  'fontSettings',
  'wallpaper',
  'tts',
  'ttsEngine',
  'system.cpu',
  'system.memory',
  'system.storage',
  'system.display',
  'loginState',
  'printing',
  'printingMetrics',
  'documentScan',
  'platformKeys',
  'certificateProvider',
  'vpnProvider',
  'fileBrowserHandler',
  'fileSystemProvider',
  'processes',
  'signedInDevices',
  'tabCapture',
  'desktopCapture',
  'pageCapture',
  'management',
  'power',
  'idle',
  'proxy',
  'downloads.open',
  'downloads.shelf',
  'downloads.ui'
]);

function getManagedExtensionsBaseDir(subdir) {
  let base;
  try {
    base = path.join(app.getPath('userData'), 'nextgx-data', subdir);
  } catch (_) {
    base = path.join(os.tmpdir(), 'nextgx-extensions', subdir);
  }
  fs.mkdirSync(base, { recursive: true });
  return base;
}

function stripJsonTrailingCommas(src) {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      out += ch;
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      out += ch;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j])) j++;
      if (src[j] === '}' || src[j] === ']') continue;
    }
    out += ch;
  }
  return out;
}

function parseManifestJsonText(raw) {
  const cleaned = stripJsonTrailingCommas(String(raw || '').replace(/^\uFEFF/, ''));
  return JSON.parse(cleaned);
}

function findManifestDirectory(rootDir, maxDepth = 3) {
  if (fs.existsSync(path.join(rootDir, 'manifest.json'))) {
    return rootDir;
  }
  if (maxDepth <= 0) return null;
  let entries;
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch (_) {
    return null;
  }
  const subdirs = entries
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== '__MACOSX' && d.name !== 'node_modules')
    .map((d) => d.name);

  if (subdirs.length === 0) return null;
  // Prefer direct single child or Chrome versioned folder (e.g. 1.60.0_0)
  const prioritized = subdirs.slice().sort((a, b) => {
    const aVer = /^\d+(\.\d+)+/.test(a) ? 0 : 1;
    const bVer = /^\d+(\.\d+)+/.test(b) ? 0 : 1;
    if (aVer !== bVer) return aVer - bVer;
    return b.localeCompare(a, undefined, { numeric: true });
  });
  if (prioritized.length === 1 || /^\d+(\.\d+)+/.test(prioritized[0])) {
    for (const sub of prioritized) {
      const found = findManifestDirectory(path.join(rootDir, sub), maxDepth - 1);
      if (found) return found;
    }
  } else {
    const directHits = prioritized.filter((sub) => fs.existsSync(path.join(rootDir, sub, 'manifest.json')));
    if (directHits.length === 1) {
      return path.join(rootDir, directHits[0]);
    }
  }
  return null;
}

function hasForbiddenUnderscoreEntries(dirPath) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries.some((e) => e.name.startsWith('_') && e.name !== '_locales');
  } catch (_) {
    return false;
  }
}

function copyExtensionDirSanitized(srcDir, destDir, isRoot = true) {
  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === '.DS_Store' || entry.name === 'Thumbs.db') continue;
    // Chromium rejects any root entry starting with '_' except '_locales' (e.g. '_metadata')
    if (isRoot && entry.name.startsWith('_') && entry.name !== '_locales') continue;
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyExtensionDirSanitized(srcPath, dstPath, false);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

function pruneMissingIconRefs(iconMap, baseDir) {
  if (!iconMap || typeof iconMap !== 'object') return iconMap;
  const resolvedBase = path.resolve(baseDir);
  const out = {};
  let kept = 0;
  for (const [size, rel] of Object.entries(iconMap)) {
    const cleanRel = sanitizeRelativeAssetPath(rel);
    if (!cleanRel) continue;
    const candidate = path.resolve(resolvedBase, cleanRel);
    if (isPathInsideDir(resolvedBase, candidate) && fs.existsSync(candidate)) {
      out[size] = cleanRel;
      kept += 1;
    }
  }
  return kept > 0 ? out : undefined;
}

function sanitizeManifestForElectron(rawManifest, baseDir, { aggressive = false } = {}) {
  const manifest = JSON.parse(JSON.stringify(rawManifest || {}));
  const notes = [];

  if (typeof manifest.manifest_version === 'string') {
    const n = Number(manifest.manifest_version);
    if (n === 2 || n === 3) manifest.manifest_version = n;
  }

  for (const key of CHROME_ONLY_MANIFEST_KEYS) {
    if (Object.prototype.hasOwnProperty.call(manifest, key)) {
      delete manifest[key];
      notes.push(`stripped ${key}`);
    }
  }

  // MV3 extensions cannot have background.scripts alongside service_worker in Chromium
  if (manifest.manifest_version === 3 && manifest.background && typeof manifest.background === 'object') {
    if (manifest.background.service_worker && manifest.background.scripts) {
      delete manifest.background.scripts;
      notes.push('stripped MV3 background.scripts');
    }
  }

  if (aggressive) {
    const filterPerms = (list) => {
      if (!Array.isArray(list)) return list;
      return list.filter((p) => {
        if (typeof p !== 'string') return false;
        if (p.startsWith('enterprise.') || ELECTRON_UNSUPPORTED_PERMISSIONS.has(p)) {
          notes.push(`pruned permission "${p}"`);
          return false;
        }
        return true;
      });
    };
    if (Array.isArray(manifest.permissions)) {
      manifest.permissions = filterPerms(manifest.permissions);
    }
    if (Array.isArray(manifest.optional_permissions)) {
      manifest.optional_permissions = filterPerms(manifest.optional_permissions);
    }
    if (manifest.icons && typeof manifest.icons === 'object') {
      const pruned = pruneMissingIconRefs(manifest.icons, baseDir);
      if (pruned) manifest.icons = pruned;
      else delete manifest.icons;
    }
    for (const actionKey of ['action', 'browser_action', 'page_action']) {
      const act = manifest[actionKey];
      if (act && typeof act === 'object' && act.default_icon && typeof act.default_icon === 'object') {
        const pruned = pruneMissingIconRefs(act.default_icon, baseDir);
        if (pruned) act.default_icon = pruned;
        else delete act.default_icon;
      }
    }
    if (manifest.declarative_net_request && Array.isArray(manifest.declarative_net_request.rule_resources)) {
      const resolvedBase = path.resolve(baseDir);
      const validRules = manifest.declarative_net_request.rule_resources.filter((r) => {
        if (!r || typeof r.path !== 'string') return false;
        const cleanRel = sanitizeRelativeAssetPath(r.path);
        if (!cleanRel) return false;
        const absRule = path.resolve(resolvedBase, cleanRel);
        return isPathInsideDir(resolvedBase, absRule) && fs.existsSync(absRule);
      });
      if (validRules.length) manifest.declarative_net_request.rule_resources = validRules;
      else delete manifest.declarative_net_request;
    }
    if (manifest.commands) {
      delete manifest.commands;
      notes.push('stripped commands');
    }
  }

  return { manifest, notes };
}

const ELECTRON_BG_SHIM_MARKER = '/* __NX_ELECTRON_EXT_SHIM_V1__ */';
const ELECTRON_BG_SHIM_SOURCE =
  `${ELECTRON_BG_SHIM_MARKER}\n` +
  `;(function(){try{if(typeof chrome==='undefined'||!chrome)return;` +
  `const noopEvt=()=>({addListener(){},removeListener(){},hasListener(){return false;},hasListeners(){return false;}});` +
  `if(chrome.permissions){for(const fn of['contains','request','remove']){const orig=chrome.permissions[fn];if(typeof orig==='function'){chrome.permissions[fn]=function(perms,cb){try{const r=orig.call(chrome.permissions,perms,cb);if(r&&typeof r.catch==='function')return r.catch(()=>{if(typeof cb==='function'){try{cb(false);}catch(_){}}return false;});return r;}catch(_){if(typeof cb==='function'){try{cb(false);}catch(__){}}return Promise.resolve(false);}};}}}` +
  `if(!chrome.commands){chrome.commands={getAll(cb){if(typeof cb==='function')try{cb([]);}catch(_){}return Promise.resolve([]);},onCommand:noopEvt()};}` +
  `if(!chrome.windows){chrome.windows={WINDOW_ID_NONE:-1,WINDOW_ID_CURRENT:-2,getAll(o,cb){const f=typeof o==='function'?o:cb;if(typeof f==='function')try{f([]);}catch(_){}return Promise.resolve([]);},getCurrent(o,cb){const f=typeof o==='function'?o:cb;if(typeof f==='function')try{f(null);}catch(_){}return Promise.resolve(null);},getLastFocused(o,cb){const f=typeof o==='function'?o:cb;if(typeof f==='function')try{f(null);}catch(_){}return Promise.resolve(null);},onCreated:noopEvt(),onRemoved:noopEvt(),onFocusChanged:noopEvt()};}` +
  `if(!chrome.notifications){chrome.notifications={getAll(cb){if(typeof cb==='function')try{cb({});}catch(_){}return Promise.resolve({});},create(a,b,cb){const f=typeof a==='function'?a:typeof b==='function'?b:cb;if(typeof f==='function')try{f('');}catch(_){}return Promise.resolve('');},clear(a,cb){if(typeof cb==='function')try{cb(false);}catch(_){}return Promise.resolve(false);},onClicked:noopEvt(),onButtonClicked:noopEvt(),onClosed:noopEvt()};}` +
  `}catch(_){}})();\n`;

function isManagedInternalExtensionCopy(targetDir) {
  try {
    const resolved = path.resolve(targetDir);
    const roots = [];
    try {
      roots.push(path.join(app.getPath('userData'), 'nextgx-data'));
    } catch (_) {}
    roots.push(path.join(os.tmpdir(), 'nextgx-extensions'));
    return roots.some((r) => isPathInsideDir(path.resolve(r), resolved));
  } catch (_) {
    return false;
  }
}

function applyElectronBackgroundCompatShim(extDir, manifest) {
  if (!extDir || !manifest || typeof manifest !== 'object') return;
  if (!isManagedInternalExtensionCopy(extDir)) return;
  const bg = manifest.background;
  if (!bg || typeof bg !== 'object') return;
  const candidates = [];
  if (typeof bg.service_worker === 'string') candidates.push(bg.service_worker);
  if (Array.isArray(bg.scripts)) {
    for (const s of bg.scripts) {
      if (typeof s === 'string') candidates.push(s);
    }
  }
  const resolvedBase = path.resolve(extDir);
  for (const rel of candidates) {
    const cleanRel = sanitizeRelativeAssetPath(rel);
    if (!cleanRel || !/\.m?js$/i.test(cleanRel)) continue;
    const scriptPath = path.resolve(resolvedBase, cleanRel);
    if (!isPathInsideDir(resolvedBase, scriptPath)) continue;
    try {
      if (!fs.existsSync(scriptPath)) continue;
      const src = fs.readFileSync(scriptPath, 'utf-8');
      if (src.startsWith(ELECTRON_BG_SHIM_MARKER)) continue;
      fs.writeFileSync(scriptPath, ELECTRON_BG_SHIM_SOURCE + src, 'utf-8');
    } catch (_) {}
  }
}

function manifestNeedsCompatibilityStaging(sourceDir, rawManifest) {
  if (hasForbiddenUnderscoreEntries(sourceDir)) return true;
  if (!rawManifest || typeof rawManifest !== 'object') return false;
  if (typeof rawManifest.manifest_version === 'string') return true;
  for (const key of CHROME_ONLY_MANIFEST_KEYS) {
    if (Object.prototype.hasOwnProperty.call(rawManifest, key)) return true;
  }
  const hasUnsupportedPerm = (list) =>
    Array.isArray(list) &&
    list.some((p) => typeof p === 'string' && (p.startsWith('enterprise.') || ELECTRON_UNSUPPORTED_PERMISSIONS.has(p)));
  if (hasUnsupportedPerm(rawManifest.permissions) || hasUnsupportedPerm(rawManifest.optional_permissions)) {
    return true;
  }
  if (rawManifest.commands) return true;
  return false;
}

function prepareCompatibleExtensionDir(sourceDir, rawManifest, { aggressive = false } = {}) {
  const hash = crypto.createHash('sha1').update(`${sourceDir}|${aggressive ? 'agg' : 'std'}`).digest('hex').slice(0, 12);
  const slug = path.basename(sourceDir).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32) || 'ext';
  const stageRoot = getManagedExtensionsBaseDir('extensions-staged');
  const stageDir = path.join(stageRoot, `${slug}-${hash}`);
  try {
    fs.rmSync(stageDir, { recursive: true, force: true });
  } catch (_) {}
  copyExtensionDirSanitized(sourceDir, stageDir, true);
  const { manifest, notes } = sanitizeManifestForElectron(rawManifest, stageDir, { aggressive });
  fs.writeFileSync(path.join(stageDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  applyElectronBackgroundCompatShim(stageDir, manifest);
  return { stageDir, notes, manifest };
}

function extractCrxToZipBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) {
    throw new Error('Archive file is empty or corrupted.');
  }
  // Standard ZIP file already starts with PK\x03\x04
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    return buf;
  }
  // CRX2 / CRX3 magic: "Cr24"
  if (buf.slice(0, 4).toString('ascii') === 'Cr24') {
    const version = buf.readUInt32LE(4);
    if (version === 2) {
      const pubKeyLen = buf.readUInt32LE(8);
      const sigLen = buf.readUInt32LE(12);
      const offset = 16 + pubKeyLen + sigLen;
      if (offset < buf.length) return buf.slice(offset);
    } else if (version === 3) {
      const headerSize = buf.readUInt32LE(8);
      const offset = 12 + headerSize;
      if (offset < buf.length) return buf.slice(offset);
    }
  }
  // Fallback: locate ZIP local file header PK\x03\x04
  const pkIdx = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if (pkIdx >= 0) return buf.slice(pkIdx);
  throw new Error('File is not a valid .crx or .zip extension archive.');
}

function runExecFileAsync(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function extractPackedExtensionFileAsync(archivePath) {
  const resolved = path.resolve(String(archivePath || '').trim());
  if (!fs.existsSync(resolved)) {
    return { ok: false, error: `Archive file not found: "${resolved}".` };
  }
  const baseName = path.basename(resolved, path.extname(resolved)).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 36) || 'extension';
  const unpackRoot = getManagedExtensionsBaseDir('extensions-unpacked');
  const targetDir = path.join(unpackRoot, `${baseName}-${Date.now()}`);
  const tempZip = path.join(os.tmpdir(), `nextgx-ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.zip`);

  try {
    const rawBuf = await fs.promises.readFile(resolved);
    const zipBuf = extractCrxToZipBuffer(rawBuf);
    await fs.promises.writeFile(tempZip, zipBuf);
    await fs.promises.mkdir(targetDir, { recursive: true });

    if (process.platform === 'win32') {
      await runExecFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:NX_ZIP -DestinationPath $env:NX_DEST -Force'],
        {
          env: { ...process.env, NX_ZIP: tempZip, NX_DEST: targetDir },
          windowsHide: true,
          timeout: 30000
        }
      );
    } else {
      try {
        await runExecFileAsync('unzip', ['-q', '-o', tempZip, '-d', targetDir], { timeout: 30000 });
      } catch (_) {
        await runExecFileAsync('python3', ['-m', 'zipfile', '-e', tempZip, targetDir], { timeout: 30000 });
      }
    }
    return { ok: true, extractedDir: targetDir };
  } catch (err) {
    try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch (_) {}
    return { ok: false, error: `Could not unpack "${path.basename(resolved)}": ${err?.message || String(err)}` };
  } finally {
    try { if (fs.existsSync(tempZip)) fs.unlinkSync(tempZip); } catch (_) {}
  }
}

function validateUnpackedExtensionPath(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    return { ok: false, error: 'No extension folder path was selected.' };
  }
  const resolved = path.resolve(rawPath.trim());

  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch (err) {
    return {
      ok: false,
      error: `Extension folder is not accessible: "${resolved}" (${err.code || err.message}).`
    };
  }
  if (!stat.isDirectory()) {
    return {
      ok: false,
      error: `Selected path is not a folder: "${resolved}". Use "Load Packed (.crx / .zip)" for archive files or select an unpacked extension directory containing manifest.json.`
    };
  }

  const effectiveDir = findManifestDirectory(resolved, 3);
  if (!effectiveDir) {
    return {
      ok: false,
      error: `Manifest file (manifest.json) is missing or unreadable in "${resolved}". Select the unpacked extension folder containing manifest.json.`
    };
  }

  const manifestPath = path.join(effectiveDir, 'manifest.json');
  let manifest;
  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    manifest = parseManifestJsonText(raw);
  } catch (err) {
    return {
      ok: false,
      error: `manifest.json in "${effectiveDir}" is not valid JSON: ${err.message}`
    };
  }

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return {
      ok: false,
      error: `manifest.json in "${effectiveDir}" must be a JSON object.`
    };
  }

  const mv = Number(manifest.manifest_version);
  if (mv !== 2 && mv !== 3) {
    return {
      ok: false,
      error: `Unsupported manifest_version (${JSON.stringify(manifest.manifest_version)}). Chromium in Electron ${process.versions.electron} supports Manifest V2 and Manifest V3 extensions.`
    };
  }

  return { ok: true, resolvedPath: effectiveDir, manifest };
}

function isInternalBundledGxExtension(ext) {
  if (!ext) return false;
  try {
    const gxExt = require('./gx-extension');
    const loadState = typeof gxExt.getLoadState === 'function' ? gxExt.getLoadState() : null;
    if (loadState && loadState.id && ext.id === loadState.id) return true;
    const bundledDir = typeof gxExt.resolveGxExtensionDir === 'function' ? gxExt.resolveGxExtensionDir() : '';
    if (bundledDir && ext.path) {
      const normA = path.resolve(bundledDir).toLowerCase();
      const normB = path.resolve(ext.path).toLowerCase();
      if (normA === normB) return true;
    }
  } catch (_) {}
  return false;
}

function listManagedExtensions() {
  const loadedMap = new Map();
  try {
    const extApi = getSessionExtensionsApi(session.defaultSession);
    const loaded = extApi.getAllExtensions ? extApi.getAllExtensions() : [];
    for (const ext of loaded) {
      if (ext && ext.id && !isInternalBundledGxExtension(ext)) {
        loadedMap.set(ext.id, ext);
      }
    }
  } catch (err) {
    console.error('[Extensions] Failed listing loaded extensions:', err);
  }

  const result = [];
  const seenIds = new Set();
  const stored = state.storage ? state.storage.getExtensions() : [];

  for (const rec of stored) {
    if (!rec || !rec.id) continue;
    const live = loadedMap.get(rec.id) || null;
    const isLoaded = Boolean(live);
    seenIds.add(rec.id);
    result.push({
      id: rec.id,
      name: live?.name || rec.name || 'Unnamed Extension',
      version: live?.version || rec.version || live?.manifest?.version || '',
      description: live?.manifest?.description || rec.description || '',
      path: live?.path || rec.path || '',
      manifestVersion: Number(live?.manifest?.manifest_version ?? rec.manifestVersion) || null,
      enabled: Boolean(rec.enabled && isLoaded),
      loaded: isLoaded,
      warnings: Array.isArray(rec.warnings) ? rec.warnings : [],
      lastError: isLoaded ? '' : rec.lastError || ''
    });
  }

  for (const [id, live] of loadedMap.entries()) {
    if (seenIds.has(id)) continue;
    result.push({
      id: live.id,
      name: live.name || 'Unnamed Extension',
      version: live.version || live.manifest?.version || '',
      description: live.manifest?.description || '',
      path: live.path || '',
      manifestVersion: Number(live.manifest?.manifest_version) || null,
      enabled: true,
      loaded: true,
      warnings: [],
      lastError: ''
    });
  }

  return result;
}

async function loadUnpackedExtensionFromPath(folderPath, { persist = true, extraRecord = null } = {}) {
  let effectiveInputPath = folderPath;
  // Also allow passing a .crx or .zip archive directly
  if (typeof folderPath === 'string' && /\.(crx|zip)$/i.test(folderPath.trim()) && fs.existsSync(folderPath.trim())) {
    const unpacked = await extractPackedExtensionFileAsync(folderPath.trim());
    if (!unpacked.ok) {
      return {
        ok: false,
        canceled: false,
        error: unpacked.error,
        path: folderPath,
        extensions: listManagedExtensions()
      };
    }
    effectiveInputPath = unpacked.extractedDir;
  }

  const validation = validateUnpackedExtensionPath(effectiveInputPath);
  if (!validation.ok) {
    console.error('[Extensions] Validation failed for', effectiveInputPath, '->', validation.error);
    return {
      ok: false,
      canceled: false,
      error: validation.error,
      path: effectiveInputPath || '',
      extensions: listManagedExtensions()
    };
  }

  const { resolvedPath, manifest } = validation;
  const extApi = getSessionExtensionsApi(session.defaultSession);
  if (!extApi || typeof extApi.loadExtension !== 'function') {
    const errMsg = 'Electron session.extensions.loadExtension API is unavailable in this runtime.';
    console.error('[Extensions]', errMsg);
    return {
      ok: false,
      canceled: false,
      error: errMsg,
      path: resolvedPath,
      extensions: listManagedExtensions()
    };
  }

  const compatNotes = [];
  let loadTargetPath = resolvedPath;

  // Proactively stage a clean Electron-compatible copy whenever _metadata, Chrome-only keys,
  // or Electron-unsupported permissions exist so Pass 1 never spews runtime permission errors.
  if (manifestNeedsCompatibilityStaging(resolvedPath, manifest)) {
    try {
      const staged = prepareCompatibleExtensionDir(resolvedPath, manifest, { aggressive: true });
      loadTargetPath = staged.stageDir;
      if (staged.notes.length) {
        compatNotes.push(`Compatibility mode: ${staged.notes.slice(0, 6).join(', ')}.`);
      }
    } catch (_) {}
  } else if (isManagedInternalExtensionCopy(loadTargetPath)) {
    applyElectronBackgroundCompatShim(loadTargetPath, manifest);
  }

  // Unload any already-loaded extension from the same path before reloading
  try {
    const existing = extApi.getAllExtensions ? extApi.getAllExtensions() : [];
    const normA = normalizePathForCompare(loadTargetPath);
    const normB = normalizePathForCompare(resolvedPath);
    for (const prev of existing) {
      if (!prev || !prev.path) continue;
      const pNorm = normalizePathForCompare(prev.path);
      if (pNorm === normA || pNorm === normB) {
        mirrorExtensionRemoveFromAllSessions(prev.id);
      }
    }
  } catch (_) {}

  const attemptLoad = async (targetPath) => {
    const res = await captureExtensionLoadWarnings(targetPath, () =>
      extApi.loadExtension(targetPath, { allowFileAccess: false })
    );
    await mirrorExtensionLoadToOtherSessions(targetPath, res?.value?.id || '');
    return res;
  };

  let loadedRes = null;
  let lastErr = null;
  try {
    loadedRes = await attemptLoad(loadTargetPath);
  } catch (err1) {
    lastErr = err1;
    // Pass 2: Standard compatibility staging (strips _metadata + Chrome-only keys)
    if (loadTargetPath === resolvedPath) {
      try {
        const staged = prepareCompatibleExtensionDir(resolvedPath, manifest, { aggressive: false });
        loadTargetPath = staged.stageDir;
        loadedRes = await attemptLoad(loadTargetPath);
        compatNotes.push('Applied standard Electron compatibility staging (removed Chrome-only manifest keys/_metadata).');
      } catch (err2) {
        lastErr = err2;
      }
    }
    // Pass 3: Aggressive ManifestError cleanup (strips unsupported permissions / missing icon/ruleset refs)
    if (!loadedRes) {
      try {
        const stagedAgg = prepareCompatibleExtensionDir(resolvedPath, manifest, { aggressive: true });
        loadTargetPath = stagedAgg.stageDir;
        loadedRes = await attemptLoad(loadTargetPath);
        compatNotes.push(
          stagedAgg.notes.length
            ? `Compatibility mode: ${stagedAgg.notes.slice(0, 6).join(', ')}.`
            : 'Loaded in Electron compatibility mode (unsupported Chrome-only manifest fields stripped).'
        );
      } catch (err3) {
        lastErr = err3;
      }
    }
  }

  if (!loadedRes) {
    const rawMsg = lastErr?.message || String(lastErr || 'Unknown error loading extension.');
    console.error('[Extensions] Failed to load unpacked extension at', resolvedPath, lastErr);
    return {
      ok: false,
      canceled: false,
      error: rawMsg,
      path: resolvedPath,
      extensions: listManagedExtensions()
    };
  }

  const { value: ext, warnings } = loadedRes;
  const allWarnings = [...compatNotes, ...warnings];
  if (ext?.manifest?.theme) {
    allWarnings.push(
      "Chrome theme extensions load in Chromium but do not restyle nextGx Browser's custom UI; use nextGx Settings to change themes."
    );
  }

  const record = {
    ...(extraRecord && typeof extraRecord === 'object' ? extraRecord : {}),
    id: ext.id,
    path: loadTargetPath || ext.path || resolvedPath,
    name: ext.name || manifest.name || path.basename(resolvedPath),
    version: ext.version || ext.manifest?.version || manifest.version || '',
    description: ext.manifest?.description || manifest.description || '',
    manifestVersion: Number(ext.manifest?.manifest_version ?? manifest.manifest_version) || null,
    enabled: true,
    warnings: allWarnings,
    lastError: ''
  };

  if (persist && state.storage) {
    state.storage.upsertExtension(record);
  }

  return {
    ok: true,
    canceled: false,
    extension: record,
    warnings: allWarnings,
    extensions: listManagedExtensions()
  };
}

async function setExtensionEnabled(id, enabled) {
  if (!id || typeof id !== 'string') {
    return {
      ok: false,
      error: 'Missing extension ID.',
      extensions: listManagedExtensions()
    };
  }

  const extApi = getSessionExtensionsApi(session.defaultSession);
  const storedList = state.storage ? state.storage.getExtensions() : [];
  const storedRec = storedList.find((item) => item && item.id === id) || null;
  const liveExt = extApi?.getExtension ? extApi.getExtension(id) : null;

  if (!storedRec && !liveExt) {
    return {
      ok: false,
      error: `Extension "${id}" was not found.`,
      extensions: listManagedExtensions()
    };
  }

  if (!enabled) {
    try {
      const wasPinned = getPinnedExtensionsFromSettings().some((item) => item && item.id === id);
      mirrorExtensionRemoveFromAllSessions(id);
      if (state.storage) {
        state.storage.upsertExtension({
          id,
          path: storedRec?.path || liveExt?.path || '',
          name: storedRec?.name || liveExt?.name || 'Unnamed Extension',
          version: storedRec?.version || liveExt?.version || '',
          description: storedRec?.description || liveExt?.manifest?.description || '',
          manifestVersion:
            storedRec?.manifestVersion ?? (Number(liveExt?.manifest?.manifest_version) || null),
          enabled: false,
          restorePinnedOnEnable: wasPinned || Boolean(storedRec?.restorePinnedOnEnable),
          warnings: Array.isArray(storedRec?.warnings) ? storedRec.warnings : [],
          lastError: ''
        });
      }
      closeExtensionPopupsForExtension(id);
      // Prunes the disabled extension from settings.pinnedExtensions and broadcasts settings:update
      getExtensionsDropdownData();
      return {
        ok: true,
        id,
        enabled: false,
        extensions: listManagedExtensions()
      };
    } catch (err) {
      console.error('[Extensions] Failed to disable extension', id, err);
      return {
        ok: false,
        id,
        enabled: Boolean(extApi?.getExtension?.(id)),
        error: `Failed to disable extension: ${err?.message || String(err)}`,
        extensions: listManagedExtensions()
      };
    }
  }

  // Enable: load from stored source path
  const sourcePath = storedRec?.path || liveExt?.path || '';
  if (!sourcePath) {
    const errMsg = 'Cannot re-enable extension because its source folder path is unknown. Remove it and load it again.';
    console.error('[Extensions]', errMsg, id);
    return {
      ok: false,
      id,
      enabled: false,
      error: errMsg,
      extensions: listManagedExtensions()
    };
  }

  const shouldRestorePin = Boolean(storedRec?.restorePinnedOnEnable);
  const loadRes = await loadUnpackedExtensionFromPath(sourcePath, { persist: true });
  if (!loadRes.ok) {
    if (state.storage && storedRec) {
      state.storage.updateExtension(id, { enabled: false, lastError: loadRes.error || 'Failed to enable extension.' });
    }
    return {
      ok: false,
      id,
      enabled: false,
      error: loadRes.error || 'Failed to enable extension.',
      extensions: listManagedExtensions()
    };
  }

  const enabledId = loadRes.extension?.id || id;
  if (state.storage && shouldRestorePin) {
    state.storage.updateExtension(enabledId, { restorePinnedOnEnable: false });
    setExtensionPinned(enabledId, true);
  }

  return {
    ok: true,
    id: enabledId,
    enabled: true,
    extension: loadRes.extension,
    warnings: loadRes.warnings || [],
    extensions: loadRes.extensions
  };
}

async function reloadManagedExtension(id) {
  if (!id || typeof id !== 'string') {
    return {
      ok: false,
      error: 'Missing extension ID.',
      extensions: listManagedExtensions()
    };
  }
  closeExtensionPopupsForExtension(id);
  const extApi = getSessionExtensionsApi(session.defaultSession);
  const storedRec = state.storage ? state.storage.getExtensions().find((item) => item && item.id === id) : null;
  const liveExt = extApi?.getExtension ? extApi.getExtension(id) : null;
  const sourcePath = storedRec?.path || liveExt?.path || '';

  if (!sourcePath) {
    return {
      ok: false,
      error: 'Cannot reload extension: source folder path is unknown.',
      extensions: listManagedExtensions()
    };
  }

  mirrorExtensionRemoveFromAllSessions(id);

  const loadRes = await loadUnpackedExtensionFromPath(sourcePath, { persist: true });
  if (!loadRes.ok && state.storage && storedRec) {
    state.storage.updateExtension(id, { enabled: false, lastError: loadRes.error || 'Reload failed.' });
  }
  getExtensionsDropdownData();
  return {
    ...loadRes,
    extensions: listManagedExtensions()
  };
}

function removeManagedExtension(id) {
  if (!id || typeof id !== 'string') {
    return { ok: false, error: 'Missing extension ID.', extensions: listManagedExtensions() };
  }
  closeExtensionPopupsForExtension(id);
  mirrorExtensionRemoveFromAllSessions(id);
  if (state.storage) {
    state.storage.removeExtension(id);
    const s = state.storage.getSettings();
    const prevPinned = Array.isArray(s?.pinnedExtensions) ? s.pinnedExtensions : [];
    const nextPinned = prevPinned.filter((item) => item && item.id !== id);
    if (nextPinned.length !== prevPinned.length) {
      const updated = state.storage.updateSettings({ pinnedExtensions: nextPinned });
      broadcastSettingsUpdate(updated);
    }
  }
  return {
    ok: true,
    id,
    extensions: listManagedExtensions()
  };
}

function getLiveExtensionById(id) {
  if (!id || typeof id !== 'string') return null;
  try {
    const extApi = getSessionExtensionsApi(session.defaultSession);
    if (extApi?.getExtension) {
      const found = extApi.getExtension(id);
      if (found) return found;
    }
    const all = extApi?.getAllExtensions ? extApi.getAllExtensions() : [];
    return all.find((ext) => ext && ext.id === id) || null;
  } catch (_) {
    return null;
  }
}

function isPopupFileOnDisk(extPath, popupRelPath) {
  if (!extPath || !popupRelPath) return false;
  try {
    const baseDir = path.resolve(extPath);
    const absPopup = path.resolve(baseDir, popupRelPath);
    if (absPopup !== baseDir && !absPopup.startsWith(baseDir + path.sep)) {
      return false;
    }
    const stat = fs.statSync(absPopup);
    return stat.isFile();
  } catch (_) {
    return false;
  }
}

function getExtensionPopupInfo(id) {
  if (!id || typeof id !== 'string') {
    return { id: '', url: null, hasPopup: false, enabled: false, loaded: false, name: '' };
  }
  const live = getLiveExtensionById(id);
  const storedList = state.storage ? state.storage.getExtensions() : [];
  const storedRec = storedList.find((item) => item && item.id === id) || null;
  const extPath = live?.path || storedRec?.path || '';
  const manifest = live?.manifest || (extPath ? readManifestFromPath(extPath) : null);
  const popupRel = manifest ? resolveExtensionPopup(manifest) : null;
  const hasPopup = Boolean(popupRel && extPath && isPopupFileOnDisk(extPath, popupRel));
  const url = hasPopup ? `chrome-extension://${id}/${popupRel.replace(/^\/+/, '')}` : null;
  const isLoaded = Boolean(live);
  const isEnabled = Boolean(isLoaded && (storedRec ? storedRec.enabled !== false : true));

  return {
    id,
    url,
    hasPopup,
    enabled: isEnabled,
    loaded: isLoaded,
    name: live?.name || storedRec?.name || 'Unnamed Extension'
  };
}

function getPinnedExtensionsFromSettings() {
  if (!state.storage) return [];
  const s = state.storage.getSettings();
  return Array.isArray(s?.pinnedExtensions)
    ? s.pinnedExtensions.filter((item) => item && typeof item.id === 'string')
    : [];
}

function getExtensionsDropdownData() {
  const managed = listManagedExtensions();
  const currentPinned = getPinnedExtensionsFromSettings();
  const pinnedIdSet = new Set(currentPinned.map((item) => item.id));

  const rows = managed.map((ext) => {
    const live = getLiveExtensionById(ext.id);
    const extPath = live?.path || ext.path || '';
    const manifest = live?.manifest || (extPath ? readManifestFromPath(extPath) : null);
    const popupRel = manifest ? resolveExtensionPopup(manifest) : null;
    const hasPopup = Boolean(popupRel && extPath && isPopupFileOnDisk(extPath, popupRel));
    const iconRes = manifest && extPath ? resolveExtensionIcon(manifest, extPath) : null;

    return {
      id: ext.id,
      name: ext.name || 'Unnamed Extension',
      version: ext.version || '',
      description: ext.description || '',
      iconDataUrl: iconRes ? iconRes.dataUrl : '',
      hasPopup,
      enabled: Boolean(ext.enabled),
      loaded: Boolean(ext.loaded),
      pinned: Boolean(ext.enabled && pinnedIdSet.has(ext.id)),
      warnings: Array.isArray(ext.warnings) ? ext.warnings : []
    };
  });

  if (state.storage) {
    const rowMap = new Map(rows.map((r) => [r.id, r]));
    const refreshedPinned = [];
    for (const item of currentPinned) {
      const row = rowMap.get(item.id);
      if (!row || !row.enabled) continue;
      refreshedPinned.push({
        id: row.id,
        name: row.name,
        iconDataUrl: row.iconDataUrl || '',
        hasPopup: Boolean(row.hasPopup)
      });
    }
    if (JSON.stringify(currentPinned) !== JSON.stringify(refreshedPinned)) {
      const updated = state.storage.updateSettings({ pinnedExtensions: refreshedPinned });
      broadcastSettingsUpdate(updated);
    }
  }

  return { rows, extensions: rows };
}

function setExtensionPinned(id, pinned) {
  if (!id || typeof id !== 'string' || !state.storage) {
    return getPinnedExtensionsFromSettings();
  }
  const { rows } = getExtensionsDropdownData();
  const rowMap = new Map(rows.map((r) => [r.id, r]));
  const current = getPinnedExtensionsFromSettings().filter((item) => {
    const r = rowMap.get(item.id);
    return Boolean(r && r.enabled);
  });
  const targetRow = rowMap.get(id);

  let nextPinned;
  if (pinned) {
    if (!targetRow || !targetRow.enabled) {
      return current;
    }
    const entry = {
      id: targetRow.id,
      name: targetRow.name,
      iconDataUrl: targetRow.iconDataUrl || '',
      hasPopup: Boolean(targetRow.hasPopup)
    };
    const existingIdx = current.findIndex((item) => item.id === id);
    if (existingIdx !== -1) {
      nextPinned = [...current];
      nextPinned[existingIdx] = entry;
    } else {
      nextPinned = [...current, entry];
    }
  } else {
    nextPinned = current.filter((item) => item.id !== id);
  }

  const updatedSettings = state.storage.updateSettings({ pinnedExtensions: nextPinned });
  broadcastSettingsUpdate(updatedSettings);
  return nextPinned;
}

async function restorePersistedExtensions() {
  if (!state.storage) return;
  const stored = state.storage.getExtensions().filter((rec) => rec && rec.enabled && rec.path);
  await Promise.allSettled(
    stored.map(async (rec) => {
      const res = await loadUnpackedExtensionFromPath(rec.path, { persist: true });
      if (!res.ok) {
        console.error('[Extensions] Failed to restore extension on startup:', rec.name, rec.path, res.error);
        state.storage.updateExtension(rec.id, {
          enabled: false,
          lastError: res.error || 'Failed to restore extension on startup.'
        });
      }
    })
  );
  getExtensionsDropdownData();
}

function registerExtensionIpcHandlers(handleInternal) {
  handleInternal('extensions:list', () => listManagedExtensions());

  handleInternal('extensions:load-unpacked', async (e) => {
    const ctx = getCtxFromSender(e.sender);
    const parentWin = ctx?.win && !ctx.win.isDestroyed() ? ctx.win : undefined;
    const dialogOptions = {
      title: 'Select Unpacked Chrome Extension Folder (containing manifest.json)',
      properties: ['openDirectory']
    };
    let res;
    try {
      res = parentWin
        ? await dialog.showOpenDialog(parentWin, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);
    } catch (err) {
      console.error('[Extensions] Failed to open extension folder dialog:', err);
      return {
        ok: false,
        canceled: false,
        error: `Could not open folder picker: ${err?.message || String(err)}`,
        extensions: listManagedExtensions()
      };
    }
    if (!res || res.canceled || !Array.isArray(res.filePaths) || !res.filePaths.length) {
      return {
        ok: false,
        canceled: true,
        extensions: listManagedExtensions()
      };
    }
    const result = await loadUnpackedExtensionFromPath(res.filePaths[0], { persist: true });
    return {
      ...result,
      incognitoNotice: Boolean(ctx?.incognito)
    };
  });

  handleInternal('extensions:load-packed', async (e) => {
    const ctx = getCtxFromSender(e.sender);
    const parentWin = ctx?.win && !ctx.win.isDestroyed() ? ctx.win : undefined;
    const dialogOptions = {
      title: 'Select Packed Extension Archive (.crx or .zip)',
      properties: ['openFile'],
      filters: [{ name: 'Chrome Extension Package', extensions: ['crx', 'zip'] }]
    };
    let res;
    try {
      res = parentWin
        ? await dialog.showOpenDialog(parentWin, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);
    } catch (err) {
      return {
        ok: false,
        canceled: false,
        error: `Could not open file picker: ${err?.message || String(err)}`,
        extensions: listManagedExtensions()
      };
    }
    if (!res || res.canceled || !Array.isArray(res.filePaths) || !res.filePaths.length) {
      return {
        ok: false,
        canceled: true,
        extensions: listManagedExtensions()
      };
    }
    const result = await loadUnpackedExtensionFromPath(res.filePaths[0], { persist: true });
    return {
      ...result,
      incognitoNotice: Boolean(ctx?.incognito)
    };
  });

  handleInternal('extensions:toggle', async (_e, arg1, arg2) => {
    const id = typeof arg1 === 'object' && arg1 !== null ? arg1.id : arg1;
    const enabled = typeof arg1 === 'object' && arg1 !== null ? arg1.enabled : arg2;
    return setExtensionEnabled(id, Boolean(enabled));
  });

  handleInternal('extensions:reload', async (_e, id) => reloadManagedExtension(id));

  handleInternal('extensions:remove', (_e, id) => removeManagedExtension(id));
}

module.exports = {
  getSessionExtensionsApi,
  parseExtensionWarningLines,
  captureExtensionLoadWarnings,
  validateUnpackedExtensionPath,
  findManifestDirectory,
  sanitizeManifestForElectron,
  extractCrxToZipBuffer,
  listManagedExtensions,
  loadUnpackedExtensionFromPath,
  setExtensionEnabled,
  reloadManagedExtension,
  removeManagedExtension,
  getExtensionPopupInfo,
  getExtensionsDropdownData,
  setExtensionPinned,
  restorePersistedExtensions,
  syncPersistedExtensionsToSession,
  registerExtensionIpcHandlers
};
