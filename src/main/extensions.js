const { session, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { state } = require('./core');
const { normalizePathForCompare } = require('./utils');
const { getCtxFromSender, broadcastSettingsUpdate } = require('./broadcast');
const {
  resolveExtensionPopup,
  resolveExtensionIcon,
  readManifestFromPath
} = require('./extension-manifest');
const { closeExtensionPopupsForExtension } = require('./extension-popup');

function getSessionExtensionsApi(ses = session.defaultSession) {
  return ses.extensions || ses;
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
      error: `Selected path is not a folder: "${resolved}". Select an unpacked extension directory containing manifest.json (packed .crx/.zip archives must be extracted first).`
    };
  }

  const manifestPath = path.join(resolved, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    let nestedCandidates = [];
    try {
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      nestedCandidates = entries
        .filter((d) => d.isDirectory() && fs.existsSync(path.join(resolved, d.name, 'manifest.json')))
        .map((d) => d.name);
    } catch (_) {}

    if (nestedCandidates.length === 1) {
      return {
        ok: false,
        error: `No manifest.json found directly in "${resolved}". Found manifest.json inside subfolder "${nestedCandidates[0]}" — select that subfolder instead.`
      };
    }
    return {
      ok: false,
      error: `Manifest file (manifest.json) is missing or unreadable in "${resolved}". Select the unpacked extension folder that directly contains manifest.json.`
    };
  }

  let manifest;
  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8').replace(/^\uFEFF/, '');
    manifest = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      error: `manifest.json in "${resolved}" is not valid JSON: ${err.message}`
    };
  }

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return {
      ok: false,
      error: `manifest.json in "${resolved}" must be a JSON object.`
    };
  }

  if (manifest.manifest_version !== 2 && manifest.manifest_version !== 3) {
    return {
      ok: false,
      error: `Unsupported manifest_version (${JSON.stringify(manifest.manifest_version)}). Chromium in Electron ${process.versions.electron} supports Manifest V2 and Manifest V3 extensions.`
    };
  }

  return { ok: true, resolvedPath: resolved, manifest };
}

function listManagedExtensions() {
  const loadedMap = new Map();
  try {
    const extApi = getSessionExtensionsApi(session.defaultSession);
    const loaded = extApi.getAllExtensions ? extApi.getAllExtensions() : [];
    for (const ext of loaded) {
      if (ext && ext.id) loadedMap.set(ext.id, ext);
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

async function loadUnpackedExtensionFromPath(folderPath, { persist = true } = {}) {
  const validation = validateUnpackedExtensionPath(folderPath);
  if (!validation.ok) {
    console.error('[Extensions] Validation failed for', folderPath, '->', validation.error);
    return {
      ok: false,
      canceled: false,
      error: validation.error,
      path: folderPath || '',
      extensions: listManagedExtensions()
    };
  }

  const { resolvedPath } = validation;
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

  try {
    const { value: ext, warnings } = await captureExtensionLoadWarnings(resolvedPath, () =>
      extApi.loadExtension(resolvedPath, { allowFileAccess: false })
    );

    const allWarnings = [...warnings];
    if (ext?.manifest?.theme) {
      allWarnings.push(
        "Chrome theme extensions load in Chromium but do not restyle nextGx Browser's custom UI; use nextGx Settings to change themes."
      );
    }

    const record = {
      id: ext.id,
      path: ext.path || resolvedPath,
      name: ext.name || path.basename(resolvedPath),
      version: ext.version || ext.manifest?.version || '',
      description: ext.manifest?.description || '',
      manifestVersion: Number(ext.manifest?.manifest_version) || null,
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
  } catch (err) {
    const rawMsg = err?.message || String(err);
    console.error('[Extensions] Failed to load unpacked extension at', resolvedPath, err);
    return {
      ok: false,
      canceled: false,
      error: rawMsg,
      path: resolvedPath,
      extensions: listManagedExtensions()
    };
  }
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
      if (liveExt && extApi?.removeExtension) {
        extApi.removeExtension(id);
      }
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

  if (liveExt && extApi?.removeExtension) {
    try {
      extApi.removeExtension(id);
    } catch (err) {
      console.error('[Extensions] Error unloading extension prior to reload:', id, err);
    }
  }

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
  try {
    const extApi = getSessionExtensionsApi(session.defaultSession);
    if (extApi?.getExtension?.(id) && extApi.removeExtension) {
      extApi.removeExtension(id);
    }
  } catch (err) {
    console.error('[Extensions] Error unloading extension during remove:', id, err);
  }
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
  const stored = state.storage.getExtensions();
  for (const rec of stored) {
    if (!rec || !rec.enabled || !rec.path) continue;
    const res = await loadUnpackedExtensionFromPath(rec.path, { persist: true });
    if (!res.ok) {
      console.error('[Extensions] Failed to restore extension on startup:', rec.name, rec.path, res.error);
      state.storage.updateExtension(rec.id, {
        enabled: false,
        lastError: res.error || 'Failed to restore extension on startup.'
      });
    }
  }
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
  listManagedExtensions,
  loadUnpackedExtensionFromPath,
  setExtensionEnabled,
  reloadManagedExtension,
  removeManagedExtension,
  getExtensionPopupInfo,
  getExtensionsDropdownData,
  setExtensionPinned,
  restorePersistedExtensions,
  registerExtensionIpcHandlers
};
