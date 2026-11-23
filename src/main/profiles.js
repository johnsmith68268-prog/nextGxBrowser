const { session } = require('electron');
const { windowContexts, state } = require('./core');
const { DEFAULT_PROFILE_ID } = require('../storage');
const { getCtxFromSender, broadcastSettingsUpdate, broadcastProfilesUpdate } = require('./broadcast');
const { setupDownloadListener } = require('./downloads');
const { broadcastCookiesUpdate } = require('./cookies');
const { registerCornerPreloadForSession } = require('./gxcorner');

const initializedSessions = new WeakSet();
const initializedSessionList = new Set();

function getInitializedProfileSessions() {
  return Array.from(initializedSessionList);
}

function getProfilePartitionName(profileId) {
  const pid = typeof profileId === 'string' && profileId.trim() ? profileId.trim().toLowerCase() : DEFAULT_PROFILE_ID;
  if (pid === DEFAULT_PROFILE_ID) return '';
  return `persist:profile-${pid}`;
}

function getSessionForProfile(profileId) {
  const partition = getProfilePartitionName(profileId);
  if (!partition) return session.defaultSession;
  return session.fromPartition(partition);
}

function ensureProfileSessionInitialized(profileId, { setupPermissionsForSession } = {}) {
  const pid = typeof profileId === 'string' && profileId.trim() ? profileId.trim().toLowerCase() : DEFAULT_PROFILE_ID;
  const ses = getSessionForProfile(pid);
  if (!ses || initializedSessions.has(ses)) return ses;
  initializedSessions.add(ses);
  initializedSessionList.add(ses);

  if (state.adBlocker) {
    state.adBlocker.attachToSession(ses);
  }
  const setupPerms = setupPermissionsForSession || require('./windows').setupPermissionsForSession;
  if (typeof setupPerms === 'function') {
    setupPerms(ses, pid);
  }
  setupDownloadListener(ses, pid);
  registerCornerPreloadForSession(ses);
  if (ses !== session.defaultSession) {
    try {
      const { syncPersistedExtensionsToSession } = require('./extensions');
      if (typeof syncPersistedExtensionsToSession === 'function') {
        syncPersistedExtensionsToSession(ses).catch(() => {});
      }
    } catch (_) {}
  }
  if (ses.cookies && typeof ses.cookies.on === 'function') {
    ses.cookies.on('changed', () => {
      broadcastCookiesUpdate({ profileId: pid });
    });
  }
  return ses;
}

function listOpenProfileIds() {
  const ids = [];
  for (const ctx of windowContexts.values()) {
    if (!ctx || !ctx.win || ctx.win.isDestroyed() || ctx.incognito) continue;
    const pid = ctx.profileId || DEFAULT_PROFILE_ID;
    if (!ids.includes(pid)) ids.push(pid);
  }
  return ids;
}

function listProfilesData(ctx = null) {
  const store = state.storage.getProfilesStore();
  const windowProfileId = ctx?.profileId || store.activeId || DEFAULT_PROFILE_ID;
  const activeProfile =
    store.profiles.find((p) => p.id === store.activeId) || store.profiles[0] || null;
  const windowProfile =
    store.profiles.find((p) => p.id === windowProfileId) || activeProfile;
  return {
    version: 1,
    activeId: store.activeId,
    profiles: store.profiles,
    activeProfile,
    windowProfileId,
    windowProfile,
    // UX phase: which profiles already have a live window, so the UI can
    // offer "Focus window" instead of "Open new window".
    openProfileIds: listOpenProfileIds()
  };
}

// UX phase (Chrome parity): find a live, non-incognito window for a profile.
function findExistingProfileWindow(profileId) {
  const pid =
    typeof profileId === 'string' && profileId.trim()
      ? profileId.trim().toLowerCase()
      : DEFAULT_PROFILE_ID;
  for (const ctx of windowContexts.values()) {
    if (!ctx || !ctx.win || ctx.win.isDestroyed() || ctx.incognito) continue;
    if ((ctx.profileId || DEFAULT_PROFILE_ID) === pid) return ctx;
  }
  return null;
}

// Pure helper (unit-tested): first saved window that actually has tabs, or null.
function pickRestoreWindow(saved) {
  const wins = Array.isArray(saved?.windows)
    ? saved.windows.filter((w) => w && Array.isArray(w.tabs) && w.tabs.length > 0)
    : [];
  return wins[0] || null;
}

function focusProfileWindow(ctx) {
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return false;
  try {
    if (typeof ctx.win.isMinimized === 'function' && ctx.win.isMinimized()) {
      ctx.win.restore();
    }
    if (typeof ctx.win.show === 'function' && !ctx.win.isVisible()) {
      ctx.win.show();
    }
    if (typeof ctx.win.focus === 'function') ctx.win.focus();
    if (typeof ctx.win.moveTop === 'function') ctx.win.moveTop();
  } catch (_) {}
  return true;
}

function getActiveProfileData(ctx = null) {
  const data = listProfilesData(ctx);
  return {
    activeId: data.activeId,
    profile: data.activeProfile,
    windowProfileId: data.windowProfileId,
    windowProfile: data.windowProfile
  };
}

function createProfileAndBroadcast(payload = {}) {
  const res = state.storage.createProfile(payload || {});
  if (res.ok) {
    broadcastProfilesUpdate();
  }
  return res;
}

function renameProfileAndBroadcast(payload = {}) {
  const id = typeof payload === 'object' && payload !== null ? payload.id || payload.profileId : '';
  const res = state.storage.renameProfile(id, payload || {});
  if (res.ok) {
    if (res.profile && res.profile.id !== DEFAULT_PROFILE_ID) {
      for (const ctx of windowContexts.values()) {
        if (ctx && !ctx.incognito && ctx.profileId === res.profile.id && ctx.win && !ctx.win.isDestroyed()) {
          ctx.win.setTitle(`nextGx Browser — ${res.profile.name}`);
        }
      }
    }
    broadcastProfilesUpdate();
  }
  return res;
}

function switchProfileAndOpenWindow(profileId, { openWindow = true } = {}) {
  const res = state.storage.setActiveProfile(profileId);
  if (!res.ok) return res;

  ensureProfileSessionInitialized(res.activeId);

  let createdWindowId = null;
  let focusedWindowId = null;
  if (openWindow) {
    // Chrome behaviour: if this profile already has a window, focus it and
    // restore it exactly as it was — do NOT open a new window or a new tab.
    const existing = findExistingProfileWindow(res.activeId);
    if (existing) {
      if (focusProfileWindow(existing)) {
        focusedWindowId = existing.win.id;
      }
    } else {
      // No live window: restore the profile's saved session (tabs, workspace,
      // split view) instead of a blank start page. Respect the profile's
      // "restore session" setting, like the startup path does.
      let restoreTabs = null;
      try {
        const settings = state.storage ? state.storage.getSettings(res.activeId) : {};
        if (settings.restoreSession !== false) {
          const saved = state.storage ? state.storage.getSession(res.activeId) : null;
          restoreTabs = pickRestoreWindow(saved);
        }
      } catch (_) {
        restoreTabs = null;
      }
      const { createBrowserWindow } = require('./windows');
      const created = createBrowserWindow({
        incognito: false,
        profileId: res.activeId,
        restoreTabs
      });
      createdWindowId = created?.win?.id ?? null;
    }
  }

  broadcastProfilesUpdate();
  broadcastSettingsUpdate();

  return {
    ok: true,
    activeId: res.activeId,
    profile: res.profile,
    profiles: res.profiles,
    windowId: createdWindowId || focusedWindowId,
    createdWindowId,
    focusedWindowId,
    focusedExisting: Boolean(focusedWindowId)
  };
}

async function deleteProfileAndCleanup(profileId) {
  const targetId = typeof profileId === 'string' ? profileId.trim().toLowerCase() : '';
  if (!targetId) {
    return { ok: false, error: 'Missing profile ID.' };
  }
  if (targetId === DEFAULT_PROFILE_ID) {
    return { ok: false, error: 'The Default profile cannot be deleted.' };
  }
  const existing = state.storage.getProfileById(targetId);
  if (!existing) {
    return { ok: false, error: 'Profile not found.' };
  }

  const windowsToClose = [];
  let hasOtherOpenWindow = false;
  for (const ctx of windowContexts.values()) {
    if (!ctx || !ctx.win || ctx.win.isDestroyed()) continue;
    if ((ctx.profileId || DEFAULT_PROFILE_ID) === targetId) {
      windowsToClose.push(ctx);
    } else {
      hasOtherOpenWindow = true;
    }
  }

  // If deleting this profile was active or closes the final window, ensure a Default window is open first
  const wasActive = state.storage.getActiveProfileId() === targetId;
  if (wasActive) {
    state.storage.setActiveProfile(DEFAULT_PROFILE_ID);
  }
  if (!hasOtherOpenWindow && windowsToClose.length > 0) {
    const { createBrowserWindow } = require('./windows');
    createBrowserWindow({ incognito: false, profileId: DEFAULT_PROFILE_ID });
  }

  // Close open windows belonging to the deleted profile without saving session back into its folder
  const closePromises = [];
  for (const ctx of windowsToClose) {
    ctx.skipSessionSave = true;
    if (ctx.win && !ctx.win.isDestroyed()) {
      closePromises.push(
        new Promise((resolve) => {
          let settled = false;
          const done = () => {
            if (settled) return;
            settled = true;
            resolve();
          };
          ctx.win.once('closed', done);
          setTimeout(done, 1500);
          try {
            ctx.win.close();
          } catch (_) {
            done();
          }
        })
      );
    }
  }
  if (closePromises.length > 0) {
    await Promise.all(closePromises);
  }

  // Clear Electron partition storage and cache
  try {
    const ses = getSessionForProfile(targetId);
    if (ses && ses !== session.defaultSession) {
      await ses.clearStorageData().catch(() => {});
      await ses.clearCache().catch(() => {});
    }
  } catch (err) {
    console.error(`[Profiles] Failed clearing session data for ${targetId}:`, err.message);
  }

  // Remove profile entry and storage subdirectory
  const delRes = state.storage.deleteProfile(targetId);
  if (!delRes.ok) {
    return delRes;
  }

  broadcastProfilesUpdate();
  broadcastSettingsUpdate();

  return delRes;
}

// UX phase: one shared "New Profile" modal lives in the shell (index.html).
// Settings (a tab view) and the profile popover (a separate view) cannot show
// it themselves, so they ask main to open it in the shell window instead.
function requestOpenCreateProfileModal() {
  let sent = false;
  for (const ctx of windowContexts.values()) {
    if (!ctx || !ctx.win || ctx.win.isDestroyed() || ctx.incognito) continue;
    try {
      ctx.win.webContents.send('profiles:open-create-modal', { source: 'profile-menu' });
      sent = true;
    } catch (_) {}
  }
  return { ok: sent };
}

function registerProfileIpcHandlers(handleInternal) {
  handleInternal('profiles:open-create-modal', () => requestOpenCreateProfileModal());

  handleInternal('profiles:list', (e) => {
    const ctx = getCtxFromSender(e.sender);
    return listProfilesData(ctx);
  });

  handleInternal('profiles:get-active', (e) => {
    const ctx = getCtxFromSender(e.sender);
    return getActiveProfileData(ctx);
  });

  handleInternal('profiles:create', (_e, payload) => {
    return createProfileAndBroadcast(payload || {});
  });

  handleInternal('profiles:rename', (_e, payload) => {
    return renameProfileAndBroadcast(payload || {});
  });

  handleInternal('profiles:delete', async (_e, arg) => {
    const id = typeof arg === 'object' && arg !== null ? arg.id || arg.profileId : arg;
    return deleteProfileAndCleanup(id);
  });

  handleInternal('profiles:switch', (_e, arg) => {
    const id = typeof arg === 'object' && arg !== null ? arg.id || arg.profileId : arg;
    const openWindow =
      typeof arg === 'object' && arg !== null && typeof arg.openWindow === 'boolean'
        ? arg.openWindow
        : true;
    return switchProfileAndOpenWindow(id, { openWindow });
  });
}

module.exports = {
  getProfilePartitionName,
  getSessionForProfile,
  getInitializedProfileSessions,
  ensureProfileSessionInitialized,
  listProfilesData,
  listOpenProfileIds,
  findExistingProfileWindow,
  focusProfileWindow,
  pickRestoreWindow,
  requestOpenCreateProfileModal,
  getActiveProfileData,
  createProfileAndBroadcast,
  renameProfileAndBroadcast,
  switchProfileAndOpenWindow,
  deleteProfileAndCleanup,
  registerProfileIpcHandlers
};
