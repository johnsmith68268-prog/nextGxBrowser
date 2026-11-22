const crypto = require('crypto');
const { clipboard } = require('electron');
const { state } = require('./core');
const { DEFAULT_PROFILE_ID } = require('../storage');
const {
  getCtxFromSender,
  broadcastPasswordsUpdate,
  broadcastPermissionsUpdate
} = require('./broadcast');

const PASSWORD_CHARSETS = {
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{}|;:,.<>?'
};

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 64;
const PASSWORD_DEFAULT_LENGTH = 16;

/**
 * Unbiased cryptographically secure integer in [0, max) using Node crypto.randomBytes
 * with rejection sampling.
 */
function secureRandomIndex(max) {
  if (!Number.isInteger(max) || max <= 1) return 0;
  const limit = Math.floor(0x100000000 / max) * max;
  let val;
  do {
    val = crypto.randomBytes(4).readUInt32BE(0);
  } while (val >= limit);
  return val % max;
}

/**
 * Generate a cryptographically strong password using Node crypto.randomBytes.
 * Guarantees at least one character from every selected charset and shuffles
 * with unbiased Fisher-Yates.
 */
function generatePassword(options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const rawLen = opts.length === undefined || opts.length === null || opts.length === ''
    ? PASSWORD_DEFAULT_LENGTH
    : Number(opts.length);

  if (!Number.isFinite(rawLen)) {
    return {
      ok: false,
      error: `Password length must be a number between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH}.`
    };
  }

  const length = Math.max(
    PASSWORD_MIN_LENGTH,
    Math.min(PASSWORD_MAX_LENGTH, Math.round(rawLen))
  );

  const normalizedOptions = {
    length,
    lowercase: opts.lowercase !== false,
    uppercase: opts.uppercase !== false,
    digits: opts.digits !== false,
    symbols: opts.symbols !== false
  };

  const selectedSets = [];
  if (normalizedOptions.lowercase) selectedSets.push(PASSWORD_CHARSETS.lowercase);
  if (normalizedOptions.uppercase) selectedSets.push(PASSWORD_CHARSETS.uppercase);
  if (normalizedOptions.digits) selectedSets.push(PASSWORD_CHARSETS.digits);
  if (normalizedOptions.symbols) selectedSets.push(PASSWORD_CHARSETS.symbols);

  if (selectedSets.length === 0) {
    return {
      ok: false,
      error: 'Select at least one character set (lowercase, uppercase, digits, or symbols).'
    };
  }

  const pool = selectedSets.join('');
  const chars = [];

  // Guarantee at least one character from each selected charset
  for (const charset of selectedSets) {
    chars.push(charset[secureRandomIndex(charset.length)]);
  }

  while (chars.length < length) {
    chars.push(pool[secureRandomIndex(pool.length)]);
  }

  // Unbiased Fisher-Yates shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = secureRandomIndex(i + 1);
    const tmp = chars[i];
    chars[i] = chars[j];
    chars[j] = tmp;
  }

  return {
    ok: true,
    password: chars.join(''),
    length: chars.length,
    options: normalizedOptions
  };
}

function buildPrivacyDashboardData(ctx, profileId) {
  const pid = profileId || ctx?.profileId || state.storage?.getActiveProfileId?.() || DEFAULT_PROFILE_ID;
  const profileObj =
    state.storage?.getProfileById?.(pid) ||
    state.storage?.getActiveProfile?.() || {
      id: DEFAULT_PROFILE_ID,
      name: 'Default',
      avatar: 'D',
      color: 'gx-violet'
    };

  const adblock = state.adBlocker
    ? state.adBlocker.getStats()
    : {
        enabled: false,
        trackerBlockEnabled: false,
        sessionBlocked: 0,
        totalBlocked: 0,
        recentBlocked: [],
        perSite: {}
      };

  const adblockSites = state.storage?.getAdblockSites ? state.storage.getAdblockSites(pid) : {};
  const sitePermissions = state.storage?.getAllSitePermissions
    ? state.storage.getAllSitePermissions(pid)
    : [];
  const settings = state.storage?.getSettings ? state.storage.getSettings(pid) : {};
  const passwordEncryptionAvailable = state.storage?.isPasswordEncryptionAvailable
    ? state.storage.isPasswordEncryptionAvailable()
    : false;
  const savedPasswordsCount = state.storage?.getPasswordCount
    ? state.storage.getPasswordCount(pid)
    : 0;
  const historyList = state.storage?.getHistory ? state.storage.getHistory(pid) : [];

  return {
    profile: {
      id: profileObj.id,
      name: profileObj.name,
      avatar: profileObj.avatar,
      color: profileObj.color
    },
    isIncognito: Boolean(ctx?.incognito),
    adblock,
    adblockSites,
    sitePermissions,
    trackedPermissionKeys: ['camera', 'microphone', 'geolocation', 'notifications'],
    settings: {
      adblockEnabled: Boolean(settings.adblockEnabled),
      trackerBlockEnabled:
        typeof settings.trackerBlockEnabled === 'boolean' ? settings.trackerBlockEnabled : true,
      restoreSession: settings.restoreSession !== false,
      autoSleepEnabled: settings.autoSleepEnabled !== false,
      autoSleepMinutes: Number(settings.autoSleepMinutes || 10)
    },
    security: {
      passwordEncryptionAvailable: Boolean(passwordEncryptionAvailable),
      privateWindowsAvailable: true,
      savedPasswordsCount,
      historyCount: Array.isArray(historyList) ? historyList.length : 0
    }
  };
}

function registerPrivacyAndPasswordIpcHandlers(handleInternal, { getSenderProfileId } = {}) {
  const resolveProfileId = (e) => {
    if (typeof getSenderProfileId === 'function') return getSenderProfileId(e);
    const ctx = getCtxFromSender(e?.sender);
    return ctx?.profileId || state.storage.getActiveProfileId() || DEFAULT_PROFILE_ID;
  };

  // Privacy & Security Dashboard
  handleInternal('privacy:get-dashboard', (e) => {
    const ctx = getCtxFromSender(e.sender);
    const pid = resolveProfileId(e);
    return buildPrivacyDashboardData(ctx, pid);
  });

  handleInternal('privacy:clear-site-permission', (e, arg) => {
    const pid = resolveProfileId(e);
    const origin = typeof arg === 'object' && arg !== null ? arg.origin : arg;
    const key = typeof arg === 'object' && arg !== null ? arg.key : undefined;
    const res = state.storage.clearSitePermissions(origin, pid, key);
    if (res && res.ok) {
      broadcastPermissionsUpdate({ profileId: pid });
    }
    return res;
  });

  // Password Manager Polish (CSPRNG generator, in-place update, main-process clipboard copy)
  handleInternal('passwords:generate', (_e, options) => {
    return generatePassword(options || {});
  });

  handleInternal('passwords:update', (e, payload) => {
    const pid = resolveProfileId(e);
    const data = payload && typeof payload === 'object' ? payload : {};
    const res = state.storage.updatePassword(data.id, data, pid);
    if (res && res.ok) {
      broadcastPasswordsUpdate({ profileId: pid });
    }
    return res;
  });

  // Security hardening: copy decrypted password via main-process Electron clipboard by entry ID
  // so renderer DOM buttons never need plaintext password attributes.
  handleInternal('passwords:copy', async (e, arg) => {
    const pid = resolveProfileId(e);
    const id = typeof arg === 'object' && arg !== null ? arg.id : arg;
    if (!id || typeof id !== 'string') {
      return { ok: false, error: 'Missing password entry ID.' };
    }
    const entry = state.storage.getPasswordById(id, pid);
    if (!entry) {
      return { ok: false, error: 'Password entry not found.' };
    }
    try {
      await clipboard.writeText(String(entry.password ?? ''));
      return { ok: true, id: entry.id };
    } catch (err) {
      return { ok: false, error: err?.message || 'Failed to copy to clipboard.' };
    }
  });
}

module.exports = {
  PASSWORD_CHARSETS,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_DEFAULT_LENGTH,
  secureRandomIndex,
  generatePassword,
  buildPrivacyDashboardData,
  registerPrivacyAndPasswordIpcHandlers
};
