const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const DEFAULT_PROFILE_ID = 'default';
const PROFILE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const VALID_PROFILE_COLORS = [
  'gx-violet',
  'crimson',
  'cyan',
  'emerald',
  'magenta',
  'amber',
  'lime',
  'ice'
];
const PER_PROFILE_SETTING_KEYS = [
  'theme',
  'sidebarItems',
  'sidebarPanelWidth',
  'sidebarPanelPinned'
];

function deriveProfileAvatar(name, explicitAvatar = '', fallback = 'P') {
  const tryExtract = (raw) => {
    if (typeof raw !== 'string') return '';
    const matches = raw.trim().match(/[A-Za-z0-9]/g);
    if (!matches || !matches.length) return '';
    return matches[0].toUpperCase();
  };
  return tryExtract(explicitAvatar) || tryExtract(name) || fallback;
}

function buildDefaultSidebarItems() {
  return {
    youtube: true,
    youtubeMusic: true,
    spotify: true,
    appleMusic: false,
    soundcloud: false,
    deezer: false,
    tidal: false,
    twitch: true,
    chatgpt: true,
    claude: false,
    gemini: false,
    perplexity: false,
    whatsapp: false,
    discord: false,
    gxCorner: true,
    player: true,
    gxControl: true,
    gxCleaner: true
  };
}

class StorageManager {
  constructor({ dataDir = null, profileId = DEFAULT_PROFILE_ID, isProfileChild = false } = {}) {
    this.isProfileChild = Boolean(isProfileChild);
    this.profileId = this.isProfileChild ? String(profileId || DEFAULT_PROFILE_ID) : DEFAULT_PROFILE_ID;
    this.dataDir = dataDir ? path.resolve(dataDir) : path.join(app.getPath('userData'), 'nextgx-data');
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    if (!this.isProfileChild) {
      this.rootDataDir = this.dataDir;
      this.profilesDir = path.join(this.rootDataDir, 'profiles');
      this._profileStorages = new Map();
    } else {
      this.rootDataDir = null;
      this.profilesDir = null;
      this._profileStorages = null;
    }

    if (this.isProfileChild) {
      this.files = {
        bookmarks: path.join(this.dataDir, 'bookmarks.json'),
        history: path.join(this.dataDir, 'history.json'),
        downloads: path.join(this.dataDir, 'downloads.json'),
        settings: path.join(this.dataDir, 'settings.json'),
        speedDial: path.join(this.dataDir, 'speed_dial.json'),
        passwords: path.join(this.dataDir, 'passwords.json'),
        notes: path.join(this.dataDir, 'notes.json'),
        sitePermissions: path.join(this.dataDir, 'site_permissions.json'),
        closedTabs: path.join(this.dataDir, 'closed_tabs.json'),
        adblockSites: path.join(this.dataDir, 'adblock_sites.json'),
        session: path.join(this.dataDir, 'session.json')
      };
    } else {
      this.files = {
        bookmarks: path.join(this.dataDir, 'bookmarks.json'),
        history: path.join(this.dataDir, 'history.json'),
        downloads: path.join(this.dataDir, 'downloads.json'),
        settings: path.join(this.dataDir, 'settings.json'),
        speedDial: path.join(this.dataDir, 'speed_dial.json'),
        passwords: path.join(this.dataDir, 'passwords.json'),
        notes: path.join(this.dataDir, 'notes.json'),
        sitePermissions: path.join(this.dataDir, 'site_permissions.json'),
        closedTabs: path.join(this.dataDir, 'closed_tabs.json'),
        adblockSites: path.join(this.dataDir, 'adblock_sites.json'),
        extensions: path.join(this.dataDir, 'extensions.json'),
        session: path.join(this.dataDir, 'session.json'),
        workspaces: path.join(this.dataDir, 'workspaces.json'),
        tabGroups: path.join(this.dataDir, 'tabgroups.json'),
        gxCornerCache: path.join(this.dataDir, 'gxcorner_cache.json'),
        profiles: path.join(this.dataDir, 'profiles.json')
      };
    }

    this.defaults = {
      bookmarks: this.isProfileChild
        ? []
        : [
            { id: 'bm-1', title: 'YouTube', url: 'https://www.youtube.com', createdAt: Date.now() },
            { id: 'bm-2', title: 'GitHub', url: 'https://github.com', createdAt: Date.now() },
            { id: 'bm-3', title: 'Google', url: 'https://www.google.com', createdAt: Date.now() },
            { id: 'bm-4', title: 'YouTube Music', url: 'https://music.youtube.com', createdAt: Date.now() }
          ],
      history: [],
      closedTabs: [],
      downloads: [],
      passwords: [],
      notes: this.isProfileChild
        ? []
        : [
            {
              id: 'note-1',
              text: 'Welcome to nextGx Browser! Jot down quick notes or links here.',
              updatedAt: Date.now()
            }
          ],
      sitePermissions: {},
      adblockSites: {},
      extensions: [],
      session: { version: 1, windows: [] },
      workspaces: [
        {
          id: 'default',
          name: 'Default',
          icon: '',
          color: '',
          createdAt: Date.now()
        }
      ],
      tabGroups: [],
      gxCornerCache: {
        version: 1,
        fetchedAt: 0,
        feedStatus: [],
        items: { news: [], releases: [], deals: [] }
      },
      profiles: {
        version: 1,
        activeId: DEFAULT_PROFILE_ID,
        profiles: [
          {
            id: DEFAULT_PROFILE_ID,
            name: 'Default',
            avatar: 'D',
            color: 'gx-violet',
            createdAt: Date.now()
          }
        ]
      },
      settings: this.isProfileChild
        ? {
            theme: 'gx-violet',
            sidebarPanelWidth: 380,
            sidebarPanelPinned: false,
            sidebarItems: buildDefaultSidebarItems()
          }
        : {
            browserName: 'nextGx Browser',
            theme: 'gx-violet', // gx-violet | crimson | cyan | emerald | magenta | amber | lime | ice
            wallpaper: {
              type: 'preset', // preset | custom | none
              preset: '', // '' follows active theme, or theme id
              file: ''
            },
            workspace: 'Personal',
            searchEngine: 'google',
            restoreSession: true,
            homepageUrl: '',
            showBookmarksBar: true,
            adblockEnabled: true,
            trackerBlockEnabled: true,
            forceDarkWeb: false,
            autoSleepEnabled: true,
            autoSleepMinutes: 10,
            closeWindowOnLastTab: false,
            uiSoundsEnabled: true,
            uiSoundsVolume: 0.35,
            ramLimitMB: 2048,
            gxRamLimiterEnabled: false,
            gxRamLimitMB: 4096,
            gxCpuLimiterEnabled: false,
            gxCpuLimitPercent: 50,
            gxNetLimiterEnabled: false,
            gxNetLimitMbps: 10,
            totalAdsBlocked: 0,
            extensionsDevMode: true,
            sidebarPanelWidth: 380,
            sidebarPanelPinned: false,
            sidebarItems: buildDefaultSidebarItems()
          },
      speedDial: [
        { id: 'sd-1', title: 'YouTube', url: 'https://www.youtube.com', domain: 'youtube.com' },
        { id: 'sd-2', title: 'GitHub', url: 'https://github.com', domain: 'github.com' },
        { id: 'sd-3', title: 'ChatGPT', url: 'https://chatgpt.com', domain: 'chatgpt.com' },
        { id: 'sd-4', title: 'YouTube Music', url: 'https://music.youtube.com', domain: 'music.youtube.com' },
        { id: 'sd-5', title: 'Twitch', url: 'https://www.twitch.tv', domain: 'twitch.tv' },
        { id: 'sd-6', title: 'Reddit', url: 'https://www.reddit.com', domain: 'reddit.com' },
        { id: 'sd-7', title: 'SoundCloud', url: 'https://soundcloud.com', domain: 'soundcloud.com' },
        { id: 'sd-8', title: 'Google', url: 'https://www.google.com', domain: 'google.com' }
      ]
    };

    this.cache = {};
    this._encryptionWarned = false;
    this._initAll();
    if (!this.isProfileChild) {
      this._ensureProfilesStore();
      this._ensureDefaultWorkspace();
    }
    this._migratePasswords();
  }

  _cloneDefault(key) {
    return JSON.parse(JSON.stringify(this.defaults[key]));
  }

  _initAll() {
    for (const [key, filePath] of Object.entries(this.files)) {
      if (!fs.existsSync(filePath)) {
        this._write(key, this._cloneDefault(key));
      } else {
        try {
          const raw = fs.readFileSync(filePath, 'utf-8');
          this.cache[key] = JSON.parse(raw);
        } catch (_) {
          this._write(key, this._cloneDefault(key));
        }
      }
    }
  }

  _write(key, data) {
    this.cache[key] = data;
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
      fs.writeFileSync(this.files[key], JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[Storage] Failed writing ${key}:`, err.message);
    }
    return data;
  }

  get(key) {
    return this.cache[key] ?? this.defaults[key];
  }

  // Profiles Store (profiles.json — root userData/nextgx-data only)
  _sanitizeProfileColor(raw, fallback = 'gx-violet') {
    if (typeof raw === 'string' && VALID_PROFILE_COLORS.includes(raw.trim())) {
      return raw.trim();
    }
    return fallback;
  }

  _sanitizeProfilesStore(raw) {
    const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const rawList = Array.isArray(obj.profiles) ? obj.profiles : [];
    const seen = new Set();
    const profiles = [];
    let hasDefault = false;

    for (const item of rawList) {
      if (!item || typeof item !== 'object') continue;
      const id = typeof item.id === 'string' ? item.id.trim().toLowerCase() : '';
      if (!id || !PROFILE_ID_RE.test(id) || seen.has(id)) continue;
      seen.add(id);
      const isDefault = id === DEFAULT_PROFILE_ID;
      const rawName = typeof item.name === 'string' ? item.name.trim().replace(/\s+/g, ' ').slice(0, 40) : '';
      const name = rawName || (isDefault ? 'Default' : 'Profile');
      const color = this._sanitizeProfileColor(item.color, isDefault ? 'gx-violet' : 'cyan');
      const avatar = deriveProfileAvatar(name, item.avatar, isDefault ? 'D' : 'P');
      const createdAt =
        typeof item.createdAt === 'number' && Number.isFinite(item.createdAt)
          ? item.createdAt
          : Date.now();
      if (isDefault) hasDefault = true;
      profiles.push({ id, name, avatar, color, createdAt });
    }

    if (!hasDefault) {
      profiles.unshift({
        id: DEFAULT_PROFILE_ID,
        name: 'Default',
        avatar: 'D',
        color: 'gx-violet',
        createdAt: Date.now()
      });
    }

    const rawActiveId = typeof obj.activeId === 'string' ? obj.activeId.trim().toLowerCase() : DEFAULT_PROFILE_ID;
    const activeId = profiles.some((p) => p.id === rawActiveId) ? rawActiveId : DEFAULT_PROFILE_ID;

    return {
      version: 1,
      activeId,
      profiles
    };
  }

  _ensureProfilesStore() {
    if (this.isProfileChild) return;
    const raw = this.cache.profiles;
    const sanitized = this._sanitizeProfilesStore(raw);
    const needsWrite =
      !raw ||
      typeof raw !== 'object' ||
      raw.version !== 1 ||
      raw.activeId !== sanitized.activeId ||
      !Array.isArray(raw.profiles) ||
      raw.profiles.length !== sanitized.profiles.length ||
      !raw.profiles.some((p) => p && p.id === DEFAULT_PROFILE_ID);
    if (needsWrite) {
      this._write('profiles', sanitized);
    } else {
      this.cache.profiles = sanitized;
    }
  }

  getProfilesStore() {
    if (this.isProfileChild) {
      return {
        version: 1,
        activeId: this.profileId,
        profiles: []
      };
    }
    return this._sanitizeProfilesStore(this.get('profiles'));
  }

  getActiveProfileId() {
    if (this.isProfileChild) return this.profileId;
    return this.getProfilesStore().activeId || DEFAULT_PROFILE_ID;
  }

  getActiveProfile() {
    const store = this.getProfilesStore();
    return store.profiles.find((p) => p.id === store.activeId) || store.profiles[0];
  }

  getProfileById(id) {
    if (!id || typeof id !== 'string') return null;
    const norm = id.trim().toLowerCase();
    return this.getProfilesStore().profiles.find((p) => p.id === norm) || null;
  }

  _resolveProfileId(profileId) {
    if (this.isProfileChild) return this.profileId;
    if (profileId === undefined || profileId === null || profileId === '') {
      return this.getActiveProfileId();
    }
    const norm = String(profileId).trim().toLowerCase();
    if (norm === DEFAULT_PROFILE_ID) return DEFAULT_PROFILE_ID;
    const store = this.getProfilesStore();
    return store.profiles.some((p) => p.id === norm) ? norm : DEFAULT_PROFILE_ID;
  }

  getProfileDataDir(profileId) {
    if (this.isProfileChild) return this.dataDir;
    const pid = this._resolveProfileId(profileId);
    if (pid === DEFAULT_PROFILE_ID) return this.rootDataDir;
    return path.join(this.profilesDir, pid);
  }

  getProfileStorage(profileId) {
    if (this.isProfileChild) return this;
    const pid = this._resolveProfileId(profileId);
    if (pid === DEFAULT_PROFILE_ID) return this;
    let child = this._profileStorages.get(pid);
    if (!child) {
      const dir = path.join(this.profilesDir, pid);
      child = new StorageManager({
        dataDir: dir,
        profileId: pid,
        isProfileChild: true
      });
      this._profileStorages.set(pid, child);
    }
    return child;
  }

  _targetFor(profileId) {
    if (this.isProfileChild) return this;
    const pid = this._resolveProfileId(profileId);
    if (pid === DEFAULT_PROFILE_ID) return this;
    return this.getProfileStorage(pid);
  }

  createProfile({ name, color, avatar } = {}) {
    if (this.isProfileChild) {
      return { ok: false, error: 'Profiles must be managed from the root storage instance.' };
    }
    const cleanName = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, 40) : '';
    if (!cleanName) {
      return { ok: false, error: 'Profile name cannot be empty.' };
    }
    const store = this.getProfilesStore();
    const usedColors = new Set(store.profiles.map((p) => p.color));
    const autoColor =
      VALID_PROFILE_COLORS.find((c) => !usedColors.has(c)) ||
      VALID_PROFILE_COLORS[store.profiles.length % VALID_PROFILE_COLORS.length];
    const cleanColor = this._sanitizeProfileColor(color, autoColor);
    const cleanAvatar = deriveProfileAvatar(cleanName, avatar, 'P');

    let id = `prof-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    while (store.profiles.some((p) => p.id === id)) {
      id = `prof-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    }

    const profile = {
      id,
      name: cleanName,
      avatar: cleanAvatar,
      color: cleanColor,
      createdAt: Date.now()
    };

    const nextStore = {
      version: 1,
      activeId: store.activeId,
      profiles: [...store.profiles, profile]
    };
    this._write('profiles', nextStore);

    // Pre-create isolated storage directory and seed initial per-profile theme to profile color
    const child = this.getProfileStorage(id);
    child._updateProfileSettingsOverrides({ theme: cleanColor });

    return {
      ok: true,
      profile,
      activeId: nextStore.activeId,
      profiles: nextStore.profiles
    };
  }

  renameProfile(id, { name, color, avatar } = {}) {
    if (this.isProfileChild) {
      return { ok: false, error: 'Profiles must be managed from the root storage instance.' };
    }
    const normId = typeof id === 'string' ? id.trim().toLowerCase() : '';
    const store = this.getProfilesStore();
    const idx = store.profiles.findIndex((p) => p.id === normId);
    if (idx === -1) {
      return { ok: false, error: 'Profile not found.' };
    }
    const existing = store.profiles[idx];
    const cleanName =
      name !== undefined
        ? typeof name === 'string'
          ? name.trim().replace(/\s+/g, ' ').slice(0, 40)
          : ''
        : existing.name;
    if (!cleanName) {
      return { ok: false, error: 'Profile name cannot be empty.' };
    }
    const nextColor =
      color !== undefined ? this._sanitizeProfileColor(color, existing.color) : existing.color;
    const nextAvatar = deriveProfileAvatar(
      cleanName,
      avatar !== undefined ? avatar : '',
      normId === DEFAULT_PROFILE_ID ? 'D' : 'P'
    );

    const updated = {
      ...existing,
      name: cleanName,
      avatar: nextAvatar,
      color: nextColor
    };
    const nextProfiles = [...store.profiles];
    nextProfiles[idx] = updated;
    const nextStore = {
      version: 1,
      activeId: store.activeId,
      profiles: nextProfiles
    };
    this._write('profiles', nextStore);
    return {
      ok: true,
      profile: updated,
      activeId: nextStore.activeId,
      profiles: nextStore.profiles
    };
  }

  setActiveProfile(id) {
    if (this.isProfileChild) {
      return { ok: false, error: 'Profiles must be managed from the root storage instance.' };
    }
    const normId = typeof id === 'string' ? id.trim().toLowerCase() : '';
    const store = this.getProfilesStore();
    const profile = store.profiles.find((p) => p.id === normId);
    if (!profile) {
      return { ok: false, error: 'Profile not found.' };
    }
    const nextStore = {
      version: 1,
      activeId: profile.id,
      profiles: store.profiles
    };
    this._write('profiles', nextStore);
    if (profile.id !== DEFAULT_PROFILE_ID) {
      this.getProfileStorage(profile.id);
    }
    return {
      ok: true,
      activeId: profile.id,
      profile,
      profiles: nextStore.profiles
    };
  }

  deleteProfile(id) {
    if (this.isProfileChild) {
      return { ok: false, error: 'Profiles must be managed from the root storage instance.' };
    }
    const normId = typeof id === 'string' ? id.trim().toLowerCase() : '';
    if (!normId || !PROFILE_ID_RE.test(normId)) {
      return { ok: false, error: 'Invalid profile ID.' };
    }
    if (normId === DEFAULT_PROFILE_ID) {
      return { ok: false, error: 'The Default profile cannot be deleted.' };
    }
    const store = this.getProfilesStore();
    const exists = store.profiles.some((p) => p.id === normId);
    if (!exists) {
      return { ok: false, error: 'Profile not found.' };
    }

    const nextProfiles = store.profiles.filter((p) => p.id !== normId);
    const nextActiveId = store.activeId === normId ? DEFAULT_PROFILE_ID : store.activeId;
    const nextStore = {
      version: 1,
      activeId: nextActiveId,
      profiles: nextProfiles
    };
    this._write('profiles', nextStore);

    this._profileStorages.delete(normId);
    const profileDir = path.join(this.profilesDir, normId);
    try {
      if (fs.existsSync(profileDir)) {
        fs.rmSync(profileDir, { recursive: true, force: true });
      }
    } catch (err) {
      console.error(`[Storage] Failed removing profile directory ${normId}:`, err.message);
    }

    return {
      ok: true,
      deletedId: normId,
      activeId: nextActiveId,
      profiles: nextProfiles
    };
  }

  validateHomepageUrl(rawUrl) {
    if (rawUrl === undefined || rawUrl === null) {
      return { ok: true, url: '' };
    }
    if (typeof rawUrl !== 'string') {
      return { ok: false, error: 'Please enter a valid http(s) URL (or leave empty for Start Page).' };
    }
    const trimmed = rawUrl.trim();
    if (!trimmed || /^(?:nextgx|gx|chrome):\/\/newtab\/?$/i.test(trimmed)) {
      return { ok: true, url: '' };
    }
    if (/^(ftp|mailto|blob):/i.test(trimmed)) {
      return { ok: false, error: 'Please enter a valid http(s) URL (or leave empty for Start Page).' };
    }
    const normalized = this._normalizeBookmarkUrl(trimmed);
    if (!normalized) {
      return { ok: false, error: 'Please enter a valid http(s) URL (or leave empty for Start Page).' };
    }
    return { ok: true, url: normalized };
  }

  _sanitizeWallpaper(raw, fallback = this.defaults.settings.wallpaper) {
    const base = fallback && typeof fallback === 'object' ? fallback : { type: 'preset', preset: '', file: '' };
    const src = raw && typeof raw === 'object' ? raw : {};
    const rawType = typeof src.type === 'string' ? src.type : base.type;
    const type = rawType === 'custom' || rawType === 'none' || rawType === 'preset' ? rawType : 'preset';
    const rawPreset = typeof src.preset === 'string' ? src.preset.trim() : base.preset || '';
    const rawFile = typeof src.file === 'string' ? src.file.trim() : base.file || '';
    const safeFile =
      rawFile &&
      !rawFile.includes('/') &&
      !rawFile.includes('\\') &&
      !rawFile.includes('..') &&
      path.basename(rawFile) === rawFile
        ? rawFile
        : '';
    return {
      type,
      preset: rawPreset,
      file: safeFile
    };
  }

  _clampSidebarPanelWidth(rawWidth) {
    const num = Number(rawWidth);
    if (!Number.isFinite(num)) return this.defaults.settings.sidebarPanelWidth;
    return Math.max(320, Math.min(640, Math.round(num)));
  }

  _sanitizeAutoSleepMinutes(rawMinutes) {
    const num = Number(rawMinutes);
    if (!Number.isFinite(num) || num <= 0) return this.defaults.settings.autoSleepMinutes;
    return Math.max(1, Math.round(num));
  }

  _sanitizeGxRamLimitMB(rawMB) {
    const num = Number(rawMB);
    if (!Number.isFinite(num) || num <= 0) return this.defaults.settings.gxRamLimitMB;
    return Math.max(512, Math.min(16384, Math.round(num)));
  }

  _sanitizeGxCpuLimitPercent(rawPercent) {
    const num = Number(rawPercent);
    if (!Number.isFinite(num) || num <= 0) return this.defaults.settings.gxCpuLimitPercent;
    return Math.max(25, Math.min(100, Math.round(num)));
  }

  _sanitizeGxNetLimitMbps(rawMbps) {
    const num = Number(rawMbps);
    if (!Number.isFinite(num) || num <= 0) return this.defaults.settings.gxNetLimitMbps;
    return Math.max(1, Math.min(100, Math.round(num)));
  }

  _getProfileSettingsOverrides() {
    const saved = this.cache.settings && typeof this.cache.settings === 'object' ? this.cache.settings : {};
    const defaultSidebar = buildDefaultSidebarItems();
    const rawTheme = typeof saved.theme === 'string' && VALID_PROFILE_COLORS.includes(saved.theme.trim())
      ? saved.theme.trim()
      : 'gx-violet';
    return {
      theme: rawTheme,
      sidebarPanelWidth: this._clampSidebarPanelWidth(saved.sidebarPanelWidth),
      sidebarPanelPinned: Boolean(saved.sidebarPanelPinned),
      sidebarItems: {
        ...defaultSidebar,
        ...(saved.sidebarItems && typeof saved.sidebarItems === 'object' ? saved.sidebarItems : {})
      }
    };
  }

  _updateProfileSettingsOverrides(partial) {
    const current = this._getProfileSettingsOverrides();
    const src = partial && typeof partial === 'object' ? partial : {};
    const next = { ...current };
    if (typeof src.theme === 'string' && VALID_PROFILE_COLORS.includes(src.theme.trim())) {
      next.theme = src.theme.trim();
    }
    if (Object.prototype.hasOwnProperty.call(src, 'sidebarPanelWidth')) {
      next.sidebarPanelWidth = this._clampSidebarPanelWidth(src.sidebarPanelWidth);
    }
    if (Object.prototype.hasOwnProperty.call(src, 'sidebarPanelPinned')) {
      next.sidebarPanelPinned = Boolean(src.sidebarPanelPinned);
    }
    if (src.sidebarItems && typeof src.sidebarItems === 'object' && !Array.isArray(src.sidebarItems)) {
      next.sidebarItems = {
        ...current.sidebarItems,
        ...src.sidebarItems
      };
    }
    return this._write('settings', next);
  }

  _getRootSettings() {
    const saved = this.cache.settings || {};
    const merged = {
      ...this.defaults.settings,
      ...saved,
      wallpaper: this._sanitizeWallpaper(saved.wallpaper, this.defaults.settings.wallpaper),
      sidebarItems: {
        ...this.defaults.settings.sidebarItems,
        ...(saved.sidebarItems || {})
      }
    };
    merged.restoreSession = merged.restoreSession !== false;
    merged.autoSleepEnabled = merged.autoSleepEnabled !== false;
    merged.autoSleepMinutes = this._sanitizeAutoSleepMinutes(merged.autoSleepMinutes);
    merged.gxRamLimiterEnabled = Boolean(merged.gxRamLimiterEnabled);
    merged.gxRamLimitMB = this._sanitizeGxRamLimitMB(merged.gxRamLimitMB);
    merged.gxCpuLimiterEnabled = Boolean(merged.gxCpuLimiterEnabled);
    merged.gxCpuLimitPercent = this._sanitizeGxCpuLimitPercent(merged.gxCpuLimitPercent);
    merged.gxNetLimiterEnabled = Boolean(merged.gxNetLimiterEnabled);
    merged.gxNetLimitMbps = this._sanitizeGxNetLimitMbps(merged.gxNetLimitMbps);
    merged.uiSoundsEnabled = merged.uiSoundsEnabled !== false;
    merged.uiSoundsVolume =
      typeof merged.uiSoundsVolume === 'number' && Number.isFinite(merged.uiSoundsVolume)
        ? Math.max(0, Math.min(1, merged.uiSoundsVolume))
        : this.defaults.settings.uiSoundsVolume;
    merged.sidebarPanelWidth = this._clampSidebarPanelWidth(merged.sidebarPanelWidth);
    merged.sidebarPanelPinned = Boolean(merged.sidebarPanelPinned);
    const hpCheck = this.validateHomepageUrl(merged.homepageUrl);
    merged.homepageUrl = hpCheck.ok ? hpCheck.url : '';
    return merged;
  }

  getSettings(profileId) {
    if (this.isProfileChild) {
      return this._getProfileSettingsOverrides();
    }
    const rootSettings = this._getRootSettings();
    const pid = this._resolveProfileId(profileId);
    if (pid === DEFAULT_PROFILE_ID) {
      return rootSettings;
    }
    const child = this.getProfileStorage(pid);
    const overrides = child._getProfileSettingsOverrides();
    return {
      ...rootSettings,
      theme: overrides.theme,
      sidebarPanelWidth: overrides.sidebarPanelWidth,
      sidebarPanelPinned: overrides.sidebarPanelPinned,
      sidebarItems: overrides.sidebarItems
    };
  }

  _updateRootSettings(partial) {
    const current = this._getRootSettings();
    const safePartial = partial && typeof partial === 'object' ? { ...partial } : {};
    if (Object.prototype.hasOwnProperty.call(safePartial, 'restoreSession')) {
      safePartial.restoreSession = Boolean(safePartial.restoreSession);
    }
    if (Object.prototype.hasOwnProperty.call(safePartial, 'autoSleepEnabled')) {
      safePartial.autoSleepEnabled = Boolean(safePartial.autoSleepEnabled);
    }
    if (Object.prototype.hasOwnProperty.call(safePartial, 'autoSleepMinutes')) {
      const mins = Number(safePartial.autoSleepMinutes);
      if (Number.isFinite(mins) && mins > 0) {
        safePartial.autoSleepMinutes = Math.max(1, Math.round(mins));
      } else {
        delete safePartial.autoSleepMinutes;
      }
    }
    if (Object.prototype.hasOwnProperty.call(safePartial, 'gxRamLimiterEnabled')) {
      safePartial.gxRamLimiterEnabled = Boolean(safePartial.gxRamLimiterEnabled);
    }
    if (Object.prototype.hasOwnProperty.call(safePartial, 'gxRamLimitMB')) {
      const mb = Number(safePartial.gxRamLimitMB);
      if (Number.isFinite(mb) && mb > 0) {
        safePartial.gxRamLimitMB = Math.max(512, Math.min(16384, Math.round(mb)));
      } else {
        delete safePartial.gxRamLimitMB;
      }
    }
    if (Object.prototype.hasOwnProperty.call(safePartial, 'gxCpuLimiterEnabled')) {
      safePartial.gxCpuLimiterEnabled = Boolean(safePartial.gxCpuLimiterEnabled);
    }
    if (Object.prototype.hasOwnProperty.call(safePartial, 'gxCpuLimitPercent')) {
      const pct = Number(safePartial.gxCpuLimitPercent);
      if (Number.isFinite(pct) && pct > 0) {
        safePartial.gxCpuLimitPercent = Math.max(25, Math.min(100, Math.round(pct)));
      } else {
        delete safePartial.gxCpuLimitPercent;
      }
    }
    if (Object.prototype.hasOwnProperty.call(safePartial, 'gxNetLimiterEnabled')) {
      safePartial.gxNetLimiterEnabled = Boolean(safePartial.gxNetLimiterEnabled);
    }
    if (Object.prototype.hasOwnProperty.call(safePartial, 'gxNetLimitMbps')) {
      const mbps = Number(safePartial.gxNetLimitMbps);
      if (Number.isFinite(mbps) && mbps > 0) {
        safePartial.gxNetLimitMbps = Math.max(1, Math.min(100, Math.round(mbps)));
      } else {
        delete safePartial.gxNetLimitMbps;
      }
    }
    if (Object.prototype.hasOwnProperty.call(safePartial, 'uiSoundsEnabled')) {
      safePartial.uiSoundsEnabled = Boolean(safePartial.uiSoundsEnabled);
    }
    if (Object.prototype.hasOwnProperty.call(safePartial, 'uiSoundsVolume')) {
      const vol = Number(safePartial.uiSoundsVolume);
      if (Number.isFinite(vol)) {
        safePartial.uiSoundsVolume = Math.max(0, Math.min(1, vol));
      } else {
        delete safePartial.uiSoundsVolume;
      }
    }
    if (Object.prototype.hasOwnProperty.call(safePartial, 'sidebarPanelWidth')) {
      safePartial.sidebarPanelWidth = this._clampSidebarPanelWidth(safePartial.sidebarPanelWidth);
    }
    if (Object.prototype.hasOwnProperty.call(safePartial, 'sidebarPanelPinned')) {
      safePartial.sidebarPanelPinned = Boolean(safePartial.sidebarPanelPinned);
    }
    if (Object.prototype.hasOwnProperty.call(safePartial, 'homepageUrl')) {
      const hpCheck = this.validateHomepageUrl(safePartial.homepageUrl);
      if (hpCheck.ok) {
        safePartial.homepageUrl = hpCheck.url;
      } else {
        delete safePartial.homepageUrl;
      }
    }
    const nextWallpaper = Object.prototype.hasOwnProperty.call(safePartial, 'wallpaper')
      ? this._sanitizeWallpaper(safePartial.wallpaper, current.wallpaper)
      : current.wallpaper;
    const updated = {
      ...current,
      ...safePartial,
      wallpaper: nextWallpaper,
      sidebarItems: safePartial.sidebarItems
        ? { ...current.sidebarItems, ...safePartial.sidebarItems }
        : current.sidebarItems
    };
    return this._write('settings', updated);
  }

  updateSettings(partial, profileId) {
    if (this.isProfileChild) {
      return this._updateProfileSettingsOverrides(partial);
    }
    const pid = this._resolveProfileId(profileId);
    if (pid === DEFAULT_PROFILE_ID) {
      return this._updateRootSettings(partial);
    }
    const src = partial && typeof partial === 'object' ? partial : {};
    const profilePartial = {};
    const globalPartial = {};
    let hasProfile = false;
    let hasGlobal = false;

    for (const key of Object.keys(src)) {
      if (PER_PROFILE_SETTING_KEYS.includes(key)) {
        profilePartial[key] = src[key];
        hasProfile = true;
      } else {
        globalPartial[key] = src[key];
        hasGlobal = true;
      }
    }

    if (hasGlobal) {
      this._updateRootSettings(globalPartial);
    }
    if (hasProfile) {
      this.getProfileStorage(pid)._updateProfileSettingsOverrides(profilePartial);
    }
    return this.getSettings(pid);
  }

  // Session Restore (normal windows only — private/incognito windows are never stored)
  _normalizeSessionUrl(rawUrl) {
    if (typeof rawUrl !== 'string') return '';
    const trimmed = rawUrl.trim();
    if (!trimmed) return '';
    const internalMatch = trimmed.match(/^(?:nextgx|gx|chrome):\/\/([a-z0-9-]+)\/?$/i);
    if (internalMatch) {
      let page = internalMatch[1].toLowerCase();
      if (page === 'password-manager') page = 'passwords';
      if (page === 'privacy-dashboard') page = 'privacy';
      if (
        [
          'newtab',
          'corner',
          'history',
          'downloads',
          'bookmarks',
          'passwords',
          'privacy',
          'extensions',
          'settings'
        ].includes(page)
      ) {
        return `nextgx://${page}`;
      }
      return '';
    }
    try {
      const u = new URL(trimmed);
      if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname) {
        return trimmed;
      }
      if (u.protocol === 'file:') {
        return trimmed;
      }
    } catch (_) {}
    return '';
  }

  _sanitizeSession(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { version: 1, windows: [] };
    }
    const rawWindows = Array.isArray(raw.windows) ? raw.windows : [];
    const windows = [];
    for (const w of rawWindows.slice(0, 20)) {
      if (!w || typeof w !== 'object' || !Array.isArray(w.tabs)) continue;
      const tabs = [];
      const rawActiveIdx =
        typeof w.activeTabIndex === 'number' && Number.isInteger(w.activeTabIndex)
          ? w.activeTabIndex
          : 0;
      let activeTabIndex = 0;
      let matchedActive = false;
      const oldToNewIndex = new Map();

      for (let i = 0; i < w.tabs.length && tabs.length < 200; i++) {
        const t = w.tabs[i];
        if (!t || typeof t !== 'object') continue;
        const cleanUrl = this._normalizeSessionUrl(t.url);
        if (!cleanUrl) continue;
        const newIdx = tabs.length;
        oldToNewIndex.set(i, newIdx);
        if (i === rawActiveIdx) {
          activeTabIndex = newIdx;
          matchedActive = true;
        }
        const cleanTitle =
          typeof t.title === 'string' && t.title.trim()
            ? t.title.trim().slice(0, 300)
            : cleanUrl === 'nextgx://newtab'
            ? 'Start Page'
            : cleanUrl === 'nextgx://corner'
            ? 'GX Corner'
            : cleanUrl;
        const pinned = Boolean(t.pinned);
        const workspaceId =
          typeof t.workspaceId === 'string' && t.workspaceId.trim()
            ? t.workspaceId.trim().slice(0, 80)
            : 'default';
        const groupId =
          !pinned && typeof t.groupId === 'string' && t.groupId.trim()
            ? t.groupId.trim().slice(0, 80)
            : null;
        tabs.push({
          url: cleanUrl,
          title: cleanTitle,
          pinned,
          workspaceId,
          groupId
        });
      }

      if (tabs.length === 0) continue;
      if (!matchedActive) {
        activeTabIndex = Math.max(0, Math.min(tabs.length - 1, rawActiveIdx));
      }
      const activeWorkspaceId =
        typeof w.activeWorkspaceId === 'string' && w.activeWorkspaceId.trim()
          ? w.activeWorkspaceId.trim().slice(0, 80)
          : 'default';
      const workspaceActiveTabIndices = {};
      if (
        w.workspaceActiveTabIndices &&
        typeof w.workspaceActiveTabIndices === 'object' &&
        !Array.isArray(w.workspaceActiveTabIndices)
      ) {
        for (const [wsId, rawIdx] of Object.entries(w.workspaceActiveTabIndices)) {
          if (typeof wsId !== 'string' || !wsId.trim()) continue;
          if (typeof rawIdx !== 'number' || !Number.isInteger(rawIdx)) continue;
          if (oldToNewIndex.has(rawIdx)) {
            workspaceActiveTabIndices[wsId.trim().slice(0, 80)] = oldToNewIndex.get(rawIdx);
          }
        }
      }
      const sanitizeSplitEntry = (rawSplit) => {
        if (!rawSplit || typeof rawSplit !== 'object' || Array.isArray(rawSplit)) return null;
        const rawLeft = rawSplit.leftIndex;
        const rawRight = rawSplit.rightIndex;
        if (
          typeof rawLeft !== 'number' ||
          !Number.isInteger(rawLeft) ||
          typeof rawRight !== 'number' ||
          !Number.isInteger(rawRight) ||
          !oldToNewIndex.has(rawLeft) ||
          !oldToNewIndex.has(rawRight)
        ) {
          return null;
        }
        const leftIndex = oldToNewIndex.get(rawLeft);
        const rightIndex = oldToNewIndex.get(rawRight);
        if (leftIndex === rightIndex) return null;
        const rawRatio = Number(rawSplit.ratio);
        const ratio = Number.isFinite(rawRatio)
          ? Math.round(Math.max(0.2, Math.min(0.8, rawRatio)) * 10000) / 10000
          : 0.5;
        const focusedPane = rawSplit.focusedPane === 'right' ? 'right' : 'left';
        return { leftIndex, rightIndex, ratio, focusedPane };
      };
      const workspaceSplits = {};
      if (w.workspaceSplits && typeof w.workspaceSplits === 'object' && !Array.isArray(w.workspaceSplits)) {
        for (const [wsId, rawSplit] of Object.entries(w.workspaceSplits)) {
          if (typeof wsId !== 'string' || !wsId.trim()) continue;
          const cleanSplit = sanitizeSplitEntry(rawSplit);
          if (cleanSplit) {
            workspaceSplits[wsId.trim().slice(0, 80)] = cleanSplit;
          }
        }
      }
      const legacySplit = sanitizeSplitEntry(w.split);
      if (legacySplit && Object.keys(workspaceSplits).length === 0) {
        const leftTab = tabs[legacySplit.leftIndex];
        const rightTab = tabs[legacySplit.rightIndex];
        let targetWsId = 'default';
        if (
          leftTab &&
          !leftTab.pinned &&
          rightTab &&
          !rightTab.pinned &&
          leftTab.workspaceId === rightTab.workspaceId
        ) {
          targetWsId = leftTab.workspaceId || 'default';
        } else if (leftTab && !leftTab.pinned && rightTab && rightTab.pinned) {
          targetWsId = leftTab.workspaceId || 'default';
        } else if (rightTab && !rightTab.pinned && leftTab && leftTab.pinned) {
          targetWsId = rightTab.workspaceId || 'default';
        }
        workspaceSplits[targetWsId] = legacySplit;
      }
      const winEntry = {
        activeWorkspaceId,
        activeTabIndex,
        workspaceActiveTabIndices,
        tabs
      };
      if (Object.keys(workspaceSplits).length > 0) {
        winEntry.workspaceSplits = workspaceSplits;
      }
      if (workspaceSplits[activeWorkspaceId]) {
        winEntry.split = workspaceSplits[activeWorkspaceId];
      }
      windows.push(winEntry);
    }

    return {
      version: 1,
      savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : Date.now(),
      windows
    };
  }

  getSession(profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.getSession();
    return this._sanitizeSession(this.get('session'));
  }

  saveSession(sessionData, profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.saveSession(sessionData);
    const clean = this._sanitizeSession({
      ...(sessionData && typeof sessionData === 'object' ? sessionData : {}),
      savedAt: Date.now()
    });
    return this._write('session', clean);
  }

  incrementBlockedCount(count = 1) {
    const s = this._getRootSettings();
    s.totalAdsBlocked = (s.totalAdsBlocked || 0) + count;
    this.cache.settings = s;
    if (s.totalAdsBlocked % 15 === 0) {
      this._write('settings', s);
    }
    return s.totalAdsBlocked;
  }

  flushSettings() {
    if (this.cache.settings) {
      this._write('settings', this.cache.settings);
    }
    if (!this.isProfileChild && this._profileStorages instanceof Map) {
      for (const child of this._profileStorages.values()) {
        if (child && typeof child.flushSettings === 'function') {
          child.flushSettings();
        }
      }
    }
  }

  // Site Permissions (per-origin: allow | block | ask)
  _readOwnSitePermissions(origin) {
    const raw = this.get('sitePermissions');
    const map = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const defaults = {
      camera: 'ask',
      microphone: 'ask',
      geolocation: 'ask',
      notifications: 'ask',
      media: 'allow'
    };
    return { ...defaults, ...(map[origin] || {}) };
  }

  _readOwnAllSitePermissions() {
    const raw = this.get('sitePermissions');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const trackedKeys = ['camera', 'microphone', 'geolocation', 'notifications'];
    const validVals = new Set(['ask', 'allow', 'block']);
    const list = [];
    for (const [origin, entry] of Object.entries(raw)) {
      if (typeof origin !== 'string' || !origin.trim()) continue;
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const permissions = {};
      for (const k of trackedKeys) {
        const v = typeof entry[k] === 'string' ? entry[k].trim().toLowerCase() : 'ask';
        permissions[k] = validVals.has(v) ? v : 'ask';
      }
      list.push({ origin, permissions });
    }
    list.sort((a, b) => a.origin.localeCompare(b.origin));
    return list;
  }

  getSitePermissions(origin, profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.getSitePermissions(origin);
    return this._readOwnSitePermissions(origin);
  }

  getAllSitePermissions(profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.getAllSitePermissions();
    return this._readOwnAllSitePermissions();
  }

  setSitePermission(origin, permKey, value, profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.setSitePermission(origin, permKey, value);
    if (!origin || typeof origin !== 'string') return this._readOwnSitePermissions('');
    const trackedKeys = ['camera', 'microphone', 'geolocation', 'notifications'];
    const validVals = new Set(['ask', 'allow', 'block']);
    if (!trackedKeys.includes(permKey) && permKey !== 'media') {
      return this._readOwnSitePermissions(origin);
    }
    const cleanVal = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!validVals.has(cleanVal)) {
      return this._readOwnSitePermissions(origin);
    }
    const raw = this.get('sitePermissions');
    const map = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
    const nextEntry = {
      ...this._readOwnSitePermissions(origin),
      [permKey]: cleanVal
    };
    const allTrackedDefault = trackedKeys.every((k) => (nextEntry[k] || 'ask') === 'ask');
    if (allTrackedDefault && permKey !== 'media') {
      delete map[origin];
      this._write('sitePermissions', map);
      return this._readOwnSitePermissions(origin);
    }
    map[origin] = nextEntry;
    this._write('sitePermissions', map);
    return map[origin];
  }

  clearSitePermissions(origin, profileId, permKey) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.clearSitePermissions(origin, undefined, permKey);
    const cleanOrigin = typeof origin === 'string' ? origin.trim() : '';
    if (!cleanOrigin) {
      return { ok: false, error: 'Missing site origin.', sitePermissions: this._readOwnAllSitePermissions() };
    }
    const raw = this.get('sitePermissions');
    const map = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
    const matchedKey = Object.prototype.hasOwnProperty.call(map, cleanOrigin)
      ? cleanOrigin
      : Object.keys(map).find((k) => k.trim().replace(/\/$/, '') === cleanOrigin.replace(/\/$/, ''));
    if (!matchedKey) {
      return { ok: true, origin: cleanOrigin, removed: false, sitePermissions: this._readOwnAllSitePermissions() };
    }
    const trackedKeys = ['camera', 'microphone', 'geolocation', 'notifications'];
    if (typeof permKey === 'string' && trackedKeys.includes(permKey)) {
      const updated = { ...this._readOwnSitePermissions(matchedKey), [permKey]: 'ask' };
      const allDefault = trackedKeys.every((k) => (updated[k] || 'ask') === 'ask');
      if (allDefault) {
        delete map[matchedKey];
      } else {
        map[matchedKey] = updated;
      }
    } else {
      delete map[matchedKey];
    }
    this._write('sitePermissions', map);
    return { ok: true, origin: matchedKey, removed: true, sitePermissions: this._readOwnAllSitePermissions() };
  }

  // Per-Site AdBlocker Settings (per-origin: { enabled: true | false })
  _normalizeAdblockOrigin(raw) {
    if (!raw || typeof raw !== 'string') return '';
    const trimmed = raw.trim();
    if (!trimmed) return '';
    try {
      const u = new URL(trimmed);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        return u.origin.toLowerCase();
      }
    } catch (_) {}
    return '';
  }

  _readOwnAdblockSites() {
    const raw = this.get('adblockSites');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return { ...raw };
  }

  getAdblockSites(profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.getAdblockSites();
    return this._readOwnAdblockSites();
  }

  getAdblockSite(origin, profileId) {
    const target = this._targetFor(profileId);
    const globalEnabled = Boolean(this.getSettings(profileId).adblockEnabled);
    const norm = this._normalizeAdblockOrigin(origin);
    if (!norm) {
      return { origin: '', enabled: globalEnabled, hasOverride: false };
    }
    const map = target._readOwnAdblockSites();
    const entry = map[norm];
    if (entry && typeof entry === 'object' && typeof entry.enabled === 'boolean') {
      return { origin: norm, enabled: entry.enabled, hasOverride: true };
    }
    if (typeof entry === 'boolean') {
      return { origin: norm, enabled: entry, hasOverride: true };
    }
    return { origin: norm, enabled: globalEnabled, hasOverride: false };
  }

  setAdblockSite(origin, enabled, profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.setAdblockSite(origin, enabled);
    const norm = this._normalizeAdblockOrigin(origin);
    const val = Boolean(enabled);
    if (!norm) {
      return { origin: '', enabled: val, hasOverride: false };
    }
    const map = this._readOwnAdblockSites();
    map[norm] = { enabled: val };
    this._write('adblockSites', map);
    return { origin: norm, enabled: val, hasOverride: true };
  }

  // Bookmarks
  _normalizeBookmarkUrl(rawUrl) {
    if (typeof rawUrl !== 'string') return '';
    const trimmed = rawUrl.trim();
    if (!trimmed) return '';
    if (/^(javascript|data|vbscript|file|chrome|nextgx|gx|about):/i.test(trimmed)) {
      return '';
    }
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
      const u = new URL(withScheme);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      if (!u.hostname) return '';
      return withScheme;
    } catch (_) {
      return '';
    }
  }

  _normalizeBookmarkFolder(folder) {
    if (typeof folder !== 'string') return '';
    return folder.trim().replace(/\s+/g, ' ').slice(0, 60);
  }

  _normalizeBookmarkFavicon(favicon) {
    if (typeof favicon !== 'string') return '';
    const trimmed = favicon.trim();
    if (/^(https?:\/\/|data:image\/)/i.test(trimmed)) return trimmed;
    return '';
  }

  _readOwnBookmarks() {
    const raw = this.get('bookmarks');
    return Array.isArray(raw) ? raw.filter((b) => b && typeof b === 'object' && typeof b.url === 'string') : [];
  }

  getBookmarks(profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.getBookmarks();
    return this._readOwnBookmarks();
  }

  isBookmarked(url, profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.isBookmarked(url);
    if (!url || typeof url !== 'string') return false;
    const normalized = url.replace(/\/$/, '');
    return this._readOwnBookmarks().some(b => b.url.replace(/\/$/, '') === normalized);
  }

  toggleBookmark({ title, url, favicon = '', folder = '' }, profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.toggleBookmark({ title, url, favicon, folder });
    if (!url || url.startsWith('file://') || url.startsWith('nextgx://') || url.startsWith('chrome://')) {
      return { added: false, bookmarks: this._readOwnBookmarks() };
    }
    const normalized = url.replace(/\/$/, '');
    const list = [...this._readOwnBookmarks()];
    const existingIdx = list.findIndex(b => b.url.replace(/\/$/, '') === normalized);
    if (existingIdx !== -1) {
      list.splice(existingIdx, 1);
      this._write('bookmarks', list);
      return { added: false, bookmarks: list };
    } else {
      const item = {
        id: 'bm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        title: (typeof title === 'string' && title.trim()) || url,
        url,
        createdAt: Date.now()
      };
      const cleanFavicon = this._normalizeBookmarkFavicon(favicon);
      if (cleanFavicon) item.favicon = cleanFavicon;
      const cleanFolder = this._normalizeBookmarkFolder(folder);
      if (cleanFolder) item.folder = cleanFolder;
      list.unshift(item);
      this._write('bookmarks', list);
      return { added: true, item, bookmarks: list };
    }
  }

  addBookmark({ title, url, folder = '', favicon = '' } = {}, profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.addBookmark({ title, url, folder, favicon });
    const cleanUrl = this._normalizeBookmarkUrl(url);
    if (!cleanUrl) {
      return { ok: false, error: 'Please enter a valid http(s) URL.', bookmarks: this._readOwnBookmarks() };
    }
    const cleanTitle = (typeof title === 'string' ? title.trim() : '') || cleanUrl;
    const cleanFolder = this._normalizeBookmarkFolder(folder);
    const cleanFavicon = this._normalizeBookmarkFavicon(favicon);
    const item = {
      id: 'bm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      title: cleanTitle,
      url: cleanUrl,
      createdAt: Date.now()
    };
    if (cleanFolder) item.folder = cleanFolder;
    if (cleanFavicon) item.favicon = cleanFavicon;

    const list = [item, ...this._readOwnBookmarks()];
    this._write('bookmarks', list);
    return { ok: true, item, bookmarks: list };
  }

  updateBookmark(id, { title, url, folder, favicon } = {}, profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.updateBookmark(id, { title, url, folder, favicon });
    if (!id || typeof id !== 'string') {
      return { ok: false, error: 'Missing bookmark ID.', bookmarks: this._readOwnBookmarks() };
    }
    const list = [...this._readOwnBookmarks()];
    const idx = list.findIndex((b) => b && b.id === id);
    if (idx === -1) {
      return { ok: false, error: 'Bookmark not found.', bookmarks: list };
    }

    const existing = list[idx];
    const nextUrl = url !== undefined ? this._normalizeBookmarkUrl(url) : existing.url;
    if (!nextUrl) {
      return { ok: false, error: 'Please enter a valid http(s) URL.', bookmarks: list };
    }
    const nextTitle =
      title !== undefined
        ? (typeof title === 'string' ? title.trim() : '') || nextUrl
        : existing.title || nextUrl;

    const updated = {
      ...existing,
      title: nextTitle,
      url: nextUrl
    };

    if (folder !== undefined) {
      const cleanFolder = this._normalizeBookmarkFolder(folder);
      if (cleanFolder) {
        updated.folder = cleanFolder;
      } else {
        delete updated.folder;
      }
    }

    if (favicon !== undefined) {
      const cleanFavicon = this._normalizeBookmarkFavicon(favicon);
      if (cleanFavicon) updated.favicon = cleanFavicon;
      else delete updated.favicon;
    } else if (url !== undefined && nextUrl !== existing.url) {
      try {
        const oldOrigin = new URL(existing.url).origin;
        const newOrigin = new URL(nextUrl).origin;
        if (oldOrigin !== newOrigin) {
          delete updated.favicon;
        }
      } catch (_) {
        delete updated.favicon;
      }
    }

    list[idx] = updated;
    this._write('bookmarks', list);
    return { ok: true, item: updated, bookmarks: list };
  }

  updateBookmarkFavicon(url, favicon, profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.updateBookmarkFavicon(url, favicon);
    if (!url || typeof url !== 'string') return null;
    const cleanFavicon = this._normalizeBookmarkFavicon(favicon);
    if (!cleanFavicon) return null;
    const normalized = url.replace(/\/$/, '');
    const list = [...this._readOwnBookmarks()];
    let changed = false;
    for (let i = 0; i < list.length; i++) {
      if (list[i].url.replace(/\/$/, '') === normalized && list[i].favicon !== cleanFavicon) {
        list[i] = { ...list[i], favicon: cleanFavicon };
        changed = true;
      }
    }
    if (!changed) return null;
    return this._write('bookmarks', list);
  }

  renameBookmarkFolder(oldName, newName, profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.renameBookmarkFolder(oldName, newName);
    const cleanOld = this._normalizeBookmarkFolder(oldName);
    const cleanNew = this._normalizeBookmarkFolder(newName);
    if (!cleanOld) {
      return { ok: false, error: 'Missing folder name.', bookmarks: this._readOwnBookmarks() };
    }
    if (!cleanNew) {
      return { ok: false, error: 'Folder name cannot be empty.', bookmarks: this._readOwnBookmarks() };
    }
    const list = this._readOwnBookmarks().map((b) => {
      if (this._normalizeBookmarkFolder(b.folder) === cleanOld) {
        return { ...b, folder: cleanNew };
      }
      return b;
    });
    this._write('bookmarks', list);
    return { ok: true, bookmarks: list };
  }

  removeBookmark(id, profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.removeBookmark(id);
    const list = this._readOwnBookmarks().filter(b => b.id !== id);
    return this._write('bookmarks', list);
  }

  importBookmarks(entries = [], profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.importBookmarks(entries);
    const input = Array.isArray(entries) ? entries : [];
    const list = [...this._readOwnBookmarks()];
    const existingUrls = new Set();
    const urlDedupeKey = (rawUrl) => {
      try {
        const u = new URL(rawUrl);
        return `${u.origin.toLowerCase()}${u.pathname}${u.search}${u.hash}`.replace(/\/$/, '');
      } catch (_) {
        return String(rawUrl || '').trim().replace(/\/$/, '');
      }
    };
    for (const bm of list) {
      if (bm && typeof bm.url === 'string') {
        existingUrls.add(urlDedupeKey(bm.url));
      }
    }

    let added = 0;
    let skipped = 0;
    let invalid = 0;
    const toAppend = [];

    for (const raw of input) {
      if (!raw || typeof raw !== 'object') {
        invalid += 1;
        continue;
      }
      const cleanUrl = this._normalizeBookmarkUrl(raw.url);
      if (!cleanUrl) {
        invalid += 1;
        continue;
      }
      const key = urlDedupeKey(cleanUrl);
      if (existingUrls.has(key)) {
        skipped += 1;
        continue;
      }
      existingUrls.add(key);

      const cleanTitle = (typeof raw.title === 'string' ? raw.title.trim() : '') || cleanUrl;
      const cleanFolder = this._normalizeBookmarkFolder(raw.folder);
      const cleanFavicon = this._normalizeBookmarkFavicon(raw.favicon);
      const createdAt =
        typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) && raw.createdAt > 0
          ? raw.createdAt
          : Date.now();
      const item = {
        id: 'bm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '-' + added,
        title: cleanTitle.slice(0, 300),
        url: cleanUrl,
        createdAt
      };
      if (cleanFolder) item.folder = cleanFolder;
      if (cleanFavicon) item.favicon = cleanFavicon;
      toAppend.push(item);
      added += 1;
    }

    if (toAppend.length > 0) {
      const merged = [...list, ...toAppend];
      this._write('bookmarks', merged);
      return { ok: true, added, skipped, invalid, bookmarks: merged };
    }
    return { ok: true, added: 0, skipped, invalid, bookmarks: list };
  }

  // History
  _readOwnHistory() {
    const raw = this.get('history');
    return Array.isArray(raw) ? raw : [];
  }

  getHistory(profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.getHistory();
    return this.get('history');
  }

  addHistory({ title, url, favicon, isVisit = true } = {}, profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.addHistory({ title, url, favicon, isVisit });
    if (
      !url ||
      url.startsWith('file://') ||
      url.startsWith('about:') ||
      url.startsWith('nextgx://') ||
      url.startsWith('gx://') ||
      url.startsWith('chrome://')
    ) {
      return this._readOwnHistory();
    }
    const list = [...this._readOwnHistory()];
    const existingIdx = list.findIndex((h) => h && h.url === url);
    if (existingIdx !== -1) {
      const existing = { ...list[existingIdx] };
      if (title && title !== 'Loading...') {
        existing.title = title;
      } else if (!existing.title || existing.title === 'Loading...') {
        existing.title = title || existing.url;
      }
      if (favicon) existing.favicon = favicon;
      existing.visitCount = Math.max(1, Number(existing.visitCount) || 1);
      if (isVisit) {
        existing.visitCount += 1;
        existing.visitedAt = Date.now();
        list.splice(existingIdx, 1);
        list.unshift(existing);
      } else {
        list[existingIdx] = existing;
      }
      return this._write('history', list);
    }
    list.unshift({
      id: 'h-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      title: title || url,
      url,
      favicon: favicon || '',
      visitedAt: Date.now(),
      visitCount: 1
    });
    if (list.length > 800) list.length = 800;
    return this._write('history', list);
  }

  clearHistory(range = 'all', profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.clearHistory(range);
    if (range === 'all') {
      return this._write('history', []);
    }
    const now = Date.now();
    const cutoffs = {
      hour: now - 3600 * 1000,
      day: now - 24 * 3600 * 1000,
      week: now - 7 * 24 * 3600 * 1000
    };
    const cutoff = cutoffs[range] || 0;
    const list = this._readOwnHistory().filter(h => (h.visitedAt || 0) < cutoff);
    return this._write('history', list);
  }

  removeHistoryItem(id, profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.removeHistoryItem(id);
    const list = this._readOwnHistory().filter(h => h.id !== id);
    return this._write('history', list);
  }

  // Recently Closed Tabs
  _readOwnClosedTabs() {
    const raw = this.get('closedTabs');
    return Array.isArray(raw) ? raw : [];
  }

  getClosedTabs(profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.getClosedTabs();
    return this.get('closedTabs') || [];
  }

  addClosedTab({ title, url, favicon } = {}, profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.addClosedTab({ title, url, favicon });
    if (
      !url ||
      url.startsWith('file://') ||
      url.startsWith('about:') ||
      url.startsWith('nextgx://') ||
      url.startsWith('gx://') ||
      url.startsWith('chrome://')
    ) {
      return this._readOwnClosedTabs();
    }
    const list = [...this._readOwnClosedTabs()];
    list.unshift({
      id: 'ct-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      title: title && title !== 'Loading...' ? title : url,
      url,
      favicon: favicon || '',
      closedAt: Date.now()
    });
    if (list.length > 25) list.length = 25;
    return this._write('closedTabs', list);
  }

  removeClosedTab(id, profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.removeClosedTab(id);
    const list = this._readOwnClosedTabs().filter((t) => t && t.id !== id);
    return this._write('closedTabs', list);
  }

  clearClosedTabs(profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.clearClosedTabs();
    return this._write('closedTabs', []);
  }

  // Downloads
  _readOwnDownloads() {
    const raw = this.get('downloads');
    return Array.isArray(raw) ? raw : [];
  }

  getDownloads(profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.getDownloads();
    return this.get('downloads');
  }

  upsertDownload(entry, profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.upsertDownload(entry);
    const list = [...this._readOwnDownloads()];
    const idx = list.findIndex(d => d.id === entry.id);
    if (idx !== -1) {
      list[idx] = { ...list[idx], ...entry };
    } else {
      list.unshift(entry);
    }
    if (list.length > 100) list.length = 100;
    return this._write('downloads', list);
  }

  removeDownload(id, profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.removeDownload(id);
    const list = this._readOwnDownloads().filter(d => d.id !== id);
    return this._write('downloads', list);
  }

  clearDownloads(profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.clearDownloads();
    return this._write('downloads', []);
  }

  // Passwords & Autofill
  _isEncryptionAvailable() {
    try {
      return Boolean(
        safeStorage &&
          typeof safeStorage.isEncryptionAvailable === 'function' &&
          safeStorage.isEncryptionAvailable()
      );
    } catch (_) {
      return false;
    }
  }

  _warnEncryptionUnavailableOnce() {
    if (this._encryptionWarned) return;
    this._encryptionWarned = true;
    console.warn('[Storage] safeStorage encryption is unavailable; passwords cannot be encrypted at rest.');
  }

  _encodePasswordRecord(entry, plainPassword) {
    const cleanEntry = { ...entry };
    delete cleanEntry.password;
    delete cleanEntry.encryptedPassword;
    const secret = String(plainPassword ?? '');

    if (this._isEncryptionAvailable()) {
      try {
        const encrypted = safeStorage.encryptString(secret).toString('base64');
        cleanEntry.encryptedPassword = encrypted;
        return cleanEntry;
      } catch (err) {
        console.warn('[Storage] Failed to encrypt password entry:', err.message);
      }
    } else {
      this._warnEncryptionUnavailableOnce();
    }

    cleanEntry.password = secret;
    return cleanEntry;
  }

  _decodePasswordRecord(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const { encryptedPassword, password, ...rest } = entry;

    if (typeof encryptedPassword === 'string') {
      if (this._isEncryptionAvailable()) {
        try {
          const decrypted = safeStorage.decryptString(Buffer.from(encryptedPassword, 'base64'));
          return { ...rest, password: decrypted };
        } catch (err) {
          console.warn('[Storage] Failed to decrypt a stored password entry:', err.message);
          return { ...rest, password: '' };
        }
      }
      this._warnEncryptionUnavailableOnce();
      return { ...rest, password: '' };
    }

    return { ...rest, password: typeof password === 'string' ? password : '' };
  }

  _migratePasswords() {
    const rawList = this.cache.passwords;
    if (!Array.isArray(rawList)) {
      this._write('passwords', []);
      return;
    }

    if (!this._isEncryptionAvailable()) {
      this._warnEncryptionUnavailableOnce();
      return;
    }

    let migrated = false;
    const updated = rawList.map((entry) => {
      if (!entry || typeof entry !== 'object') return entry;
      if (typeof entry.password === 'string') {
        const encoded = this._encodePasswordRecord(entry, entry.password);
        if (typeof encoded.encryptedPassword === 'string') {
          migrated = true;
          return encoded;
        }
      }
      return entry;
    });

    if (migrated) {
      this._write('passwords', updated);
    }
  }

  isPasswordEncryptionAvailable() {
    return this._isEncryptionAvailable();
  }

  getPasswordCount(profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.getPasswordCount();
    const rawList = this.get('passwords');
    return Array.isArray(rawList) ? rawList.filter((e) => e && typeof e === 'object').length : 0;
  }

  getPasswordById(id, profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.getPasswordById(id);
    if (!id || typeof id !== 'string') return null;
    const rawList = this.get('passwords');
    if (!Array.isArray(rawList)) return null;
    const match = rawList.find((entry) => entry && entry.id === id);
    return match ? this._decodePasswordRecord(match) : null;
  }

  _readOwnPasswords() {
    const rawList = this.get('passwords');
    if (!Array.isArray(rawList)) return [];
    return rawList.map((entry) => this._decodePasswordRecord(entry)).filter(Boolean);
  }

  getPasswords(profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.getPasswords();
    return this._readOwnPasswords();
  }

  addPassword(entry = {}, profileId) {
    const { site, username, password } = entry && typeof entry === 'object' ? entry : {};
    const target = this._targetFor(profileId);
    if (target !== this) return target.addPassword({ site, username, password });
    const cleanSite = typeof site === 'string' ? site.trim() : '';
    const cleanUser = typeof username === 'string' ? username.trim() : '';
    if (!cleanSite) {
      return { ok: false, error: 'Website cannot be empty.', passwords: this._readOwnPasswords() };
    }
    if (!cleanUser) {
      return { ok: false, error: 'Username cannot be empty.', passwords: this._readOwnPasswords() };
    }
    if (typeof password !== 'string' || password.length === 0) {
      return { ok: false, error: 'Password cannot be empty.', passwords: this._readOwnPasswords() };
    }
    const rawList = Array.isArray(this.get('passwords')) ? [...this.get('passwords')] : [];
    const existingIdx = rawList.findIndex((p) => p && p.site === cleanSite && p.username === cleanUser);
    if (existingIdx !== -1) {
      rawList[existingIdx] = this._encodePasswordRecord(
        { ...rawList[existingIdx], updatedAt: Date.now() },
        password
      );
      this._write('passwords', rawList);
      return this._readOwnPasswords();
    }

    const baseRecord = {
      id: 'pw-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      site: cleanSite,
      username: cleanUser,
      createdAt: Date.now()
    };
    rawList.unshift(this._encodePasswordRecord(baseRecord, password));
    this._write('passwords', rawList);
    return this._readOwnPasswords();
  }

  updatePassword(id, { site, username, password } = {}, profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.updatePassword(id, { site, username, password });
    if (!id || typeof id !== 'string') {
      return { ok: false, error: 'Missing password entry ID.', passwords: this._readOwnPasswords() };
    }
    const rawList = Array.isArray(this.get('passwords')) ? [...this.get('passwords')] : [];
    const idx = rawList.findIndex((p) => p && p.id === id);
    if (idx === -1) {
      return { ok: false, error: 'Password entry not found.', passwords: this._readOwnPasswords() };
    }

    const existingRaw = rawList[idx];
    const nextSite = site !== undefined ? String(site).trim() : String(existingRaw.site || '').trim();
    const nextUser = username !== undefined ? String(username).trim() : String(existingRaw.username || '').trim();
    if (!nextSite) {
      return { ok: false, error: 'Website cannot be empty.', passwords: this._readOwnPasswords() };
    }
    if (!nextUser) {
      return { ok: false, error: 'Username cannot be empty.', passwords: this._readOwnPasswords() };
    }

    let nextPass;
    if (password !== undefined) {
      if (typeof password !== 'string' || password.length === 0) {
        return { ok: false, error: 'Password cannot be empty.', passwords: this._readOwnPasswords() };
      }
      nextPass = password;
    } else {
      const decoded = this._decodePasswordRecord(existingRaw);
      nextPass = decoded ? decoded.password : '';
    }

    const duplicate = rawList.some(
      (p, i) =>
        i !== idx &&
        p &&
        String(p.site || '').trim().toLowerCase() === nextSite.toLowerCase() &&
        String(p.username || '').trim() === nextUser
    );
    if (duplicate) {
      return {
        ok: false,
        error: 'A saved login for this website and username already exists.',
        passwords: this._readOwnPasswords()
      };
    }

    const updatedBase = {
      ...existingRaw,
      id: existingRaw.id,
      site: nextSite,
      username: nextUser,
      updatedAt: Date.now()
    };
    rawList[idx] = this._encodePasswordRecord(updatedBase, nextPass);
    this._write('passwords', rawList);
    const passwords = this._readOwnPasswords();
    return {
      ok: true,
      entry: passwords[idx] || this._decodePasswordRecord(rawList[idx]),
      passwords
    };
  }

  removePassword(id, profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.removePassword(id);
    const rawList = Array.isArray(this.get('passwords')) ? this.get('passwords') : [];
    const list = rawList.filter((p) => p && p.id !== id);
    this._write('passwords', list);
    return this._readOwnPasswords();
  }

  importPasswords(entries = [], profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.importPasswords(entries);
    const input = Array.isArray(entries) ? entries : [];
    const rawList = Array.isArray(this.get('passwords')) ? [...this.get('passwords')] : [];
    const existingKeys = new Set();
    for (const p of rawList) {
      if (!p || typeof p !== 'object') continue;
      const k = `${String(p.site || '').trim().toLowerCase()}\0${String(p.username || '').trim()}`;
      existingKeys.add(k);
    }

    let added = 0;
    let skipped = 0;
    let invalid = 0;

    for (const raw of input) {
      if (!raw || typeof raw !== 'object') {
        invalid += 1;
        continue;
      }
      const cleanSite = String(raw.url ?? raw.site ?? '').trim();
      const cleanUser = String(raw.username ?? '').trim();
      const cleanPass = typeof raw.password === 'string' ? raw.password : '';
      if (!cleanSite || !cleanUser || !cleanPass) {
        invalid += 1;
        continue;
      }
      const key = `${cleanSite.toLowerCase()}\0${cleanUser}`;
      if (existingKeys.has(key)) {
        skipped += 1;
        continue;
      }
      existingKeys.add(key);

      const baseRecord = {
        id: 'pw-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '-' + added,
        site: cleanSite,
        username: cleanUser,
        createdAt: Date.now()
      };
      rawList.push(this._encodePasswordRecord(baseRecord, cleanPass));
      added += 1;
    }

    if (added > 0) {
      this._write('passwords', rawList);
    }
    return {
      ok: true,
      added,
      skipped,
      invalid,
      passwords: this._readOwnPasswords()
    };
  }

  // Quick Notes
  getNotes(profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.getNotes();
    return this.get('notes');
  }

  saveNote(text, profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.saveNote(text);
    const list = [{ id: 'note-1', text: String(text || ''), updatedAt: Date.now() }];
    return this._write('notes', list);
  }

  // Speed Dial
  _readOwnSpeedDial() {
    const raw = this.get('speedDial');
    return Array.isArray(raw) ? raw : [];
  }

  getSpeedDial(profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.getSpeedDial();
    return this.get('speedDial');
  }

  addSpeedDial({ title, url }, profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.addSpeedDial({ title, url });
    const list = [...this._readOwnSpeedDial()];
    const formattedUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    let domain = '';
    try {
      domain = new URL(formattedUrl).hostname.replace(/^www\./, '');
    } catch (_) {}
    const cleanTitle = title || domain || formattedUrl;
    const item = {
      id: 'sd-' + Date.now(),
      title: cleanTitle,
      url: formattedUrl,
      domain
    };
    list.push(item);
    return this._write('speedDial', list);
  }

  removeSpeedDial(id, profileId) {
    const target = this._targetFor(profileId);
    if (target !== this) return target.removeSpeedDial(id);
    const list = this._readOwnSpeedDial().filter(s => s.id !== id);
    return this._write('speedDial', list);
  }

  // Unpacked Extensions Registry (persisted so extensions survive restarts and support enable/disable)
  _normalizeExtensionPath(extPath) {
    if (!extPath || typeof extPath !== 'string') return '';
    const resolved = path.resolve(extPath);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }

  getExtensions() {
    const raw = this.get('extensions');
    return Array.isArray(raw) ? raw.filter((e) => e && typeof e === 'object') : [];
  }

  upsertExtension(record) {
    if (!record || typeof record !== 'object') return this.getExtensions();
    const list = [...this.getExtensions()];
    const normPath = this._normalizeExtensionPath(record.path);
    const existingIdx = list.findIndex(
      (item) =>
        (record.id && item.id === record.id) ||
        (normPath && this._normalizeExtensionPath(item.path) === normPath)
    );
    const now = Date.now();
    if (existingIdx !== -1) {
      list[existingIdx] = {
        ...list[existingIdx],
        ...record,
        updatedAt: now
      };
    } else {
      list.unshift({
        id: record.id || '',
        path: record.path ? path.resolve(record.path) : '',
        name: record.name || 'Unnamed Extension',
        version: record.version || '',
        description: record.description || '',
        manifestVersion: record.manifestVersion ?? null,
        enabled: record.enabled !== false,
        warnings: Array.isArray(record.warnings) ? record.warnings : [],
        lastError: record.lastError || '',
        addedAt: now,
        updatedAt: now
      });
    }
    return this._write('extensions', list);
  }

  updateExtension(id, partial = {}) {
    if (!id) return null;
    const list = [...this.getExtensions()];
    const idx = list.findIndex((item) => item && item.id === id);
    if (idx === -1) return null;
    list[idx] = {
      ...list[idx],
      ...partial,
      updatedAt: Date.now()
    };
    this._write('extensions', list);
    return list[idx];
  }

  removeExtension(id) {
    const list = this.getExtensions().filter((item) => item && item.id !== id);
    return this._write('extensions', list);
  }

  // Workspaces (global store in workspaces.json)
  _sanitizeWorkspaces(raw) {
    const input = Array.isArray(raw) ? raw : [];
    const seen = new Set();
    const cleaned = [];
    let hasDefault = false;

    for (const item of input) {
      if (!item || typeof item !== 'object') continue;
      const id = typeof item.id === 'string' ? item.id.trim().slice(0, 80) : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const rawName = typeof item.name === 'string' ? item.name.trim().replace(/\s+/g, ' ').slice(0, 40) : '';
      const name = rawName || (id === 'default' ? 'Default' : 'Workspace');
      const icon = typeof item.icon === 'string' ? item.icon.trim().slice(0, 32) : '';
      const color = typeof item.color === 'string' ? item.color.trim().slice(0, 24) : '';
      const createdAt =
        typeof item.createdAt === 'number' && Number.isFinite(item.createdAt)
          ? item.createdAt
          : Date.now();
      if (id === 'default') hasDefault = true;
      cleaned.push({ id, name, icon, color, createdAt });
    }

    if (!hasDefault) {
      cleaned.unshift({
        id: 'default',
        name: 'Default',
        icon: '',
        color: '',
        createdAt: Date.now()
      });
    }
    return cleaned;
  }

  _ensureDefaultWorkspace() {
    const raw = this.cache.workspaces;
    const sanitized = this._sanitizeWorkspaces(raw);
    const needsWrite =
      !Array.isArray(raw) ||
      raw.length !== sanitized.length ||
      !raw.some((w) => w && w.id === 'default');
    if (needsWrite) {
      this._write('workspaces', sanitized);
    } else {
      this.cache.workspaces = sanitized;
    }
  }

  getWorkspaces() {
    return this._sanitizeWorkspaces(this.get('workspaces'));
  }

  saveWorkspaces(list) {
    const clean = this._sanitizeWorkspaces(list);
    return this._write('workspaces', clean);
  }

  // Tab Islands / Groups (global store in tabgroups.json)
  _sanitizeTabGroups(raw) {
    const VALID_GROUP_COLORS = new Set([
      'group-1',
      'group-2',
      'group-3',
      'group-4',
      'group-5',
      'group-6',
      'group-7',
      'group-8'
    ]);
    const input = Array.isArray(raw) ? raw : [];
    const seen = new Set();
    const cleaned = [];

    for (const item of input) {
      if (!item || typeof item !== 'object') continue;
      const id = typeof item.id === 'string' ? item.id.trim().slice(0, 80) : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const workspaceId =
        typeof item.workspaceId === 'string' && item.workspaceId.trim()
          ? item.workspaceId.trim().slice(0, 80)
          : 'default';
      const name =
        typeof item.name === 'string' && item.name.trim()
          ? item.name.trim().replace(/\s+/g, ' ').slice(0, 40)
          : 'Group';
      const color =
        typeof item.color === 'string' && VALID_GROUP_COLORS.has(item.color.trim())
          ? item.color.trim()
          : 'group-1';
      const collapsed = Boolean(item.collapsed);
      const createdAt =
        typeof item.createdAt === 'number' && Number.isFinite(item.createdAt)
          ? item.createdAt
          : Date.now();
      cleaned.push({ id, workspaceId, name, color, collapsed, createdAt });
    }
    return cleaned;
  }

  getTabGroups() {
    return this._sanitizeTabGroups(this.get('tabGroups'));
  }

  saveTabGroups(list) {
    const clean = this._sanitizeTabGroups(list);
    return this._write('tabGroups', clean);
  }

  // GX Corner RSS Feed Cache (gxcorner_cache.json)
  _sanitizeCornerCacheItem(item, fallbackSection) {
    if (!item || typeof item !== 'object') return null;
    const rawUrl = typeof item.url === 'string' ? item.url.trim() : '';
    const rawTitle = typeof item.title === 'string' ? item.title.trim() : '';
    if (!rawUrl || !rawTitle) return null;
    try {
      const u = new URL(rawUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    } catch (_) {
      return null;
    }
    let thumb = '';
    if (typeof item.thumbnail === 'string' && item.thumbnail.trim()) {
      try {
        const tu = new URL(item.thumbnail.trim());
        if (tu.protocol === 'http:' || tu.protocol === 'https:') {
          thumb = tu.toString().slice(0, 2048);
        }
      } catch (_) {}
    }
    const section =
      item.section === 'news' || item.section === 'releases' || item.section === 'deals'
        ? item.section
        : fallbackSection;
    return {
      id: String(item.id || `${section}-${Math.random().toString(36).slice(2, 8)}`).slice(0, 80),
      title: rawTitle.slice(0, 180),
      summary: typeof item.summary === 'string' ? item.summary.trim().slice(0, 200) : '',
      url: rawUrl.slice(0, 2048),
      source: typeof item.source === 'string' && item.source.trim() ? item.source.trim().slice(0, 48) : 'Gaming Feed',
      feedId: typeof item.feedId === 'string' ? item.feedId.trim().slice(0, 40) : '',
      thumbnail: thumb,
      publishedAt:
        typeof item.publishedAt === 'number' && Number.isFinite(item.publishedAt) && item.publishedAt > 0
          ? item.publishedAt
          : 0,
      tag: typeof item.tag === 'string' ? item.tag.trim().slice(0, 24) : '',
      platforms: Array.isArray(item.platforms)
        ? item.platforms.filter((p) => typeof p === 'string' && p.trim()).map((p) => p.trim().slice(0, 20)).slice(0, 5)
        : [],
      section,
      curated: Boolean(item.curated)
    };
  }

  _sanitizeGxCornerCache(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {
        version: 1,
        fetchedAt: 0,
        feedStatus: [],
        items: { news: [], releases: [], deals: [] }
      };
    }
    const fetchedAt =
      typeof raw.fetchedAt === 'number' && Number.isFinite(raw.fetchedAt) && raw.fetchedAt > 0
        ? raw.fetchedAt
        : 0;
    const rawItems = raw.items && typeof raw.items === 'object' ? raw.items : {};
    const cleanList = (arr, sec, max) =>
      (Array.isArray(arr) ? arr : [])
        .map((it) => this._sanitizeCornerCacheItem(it, sec))
        .filter(Boolean)
        .slice(0, max);
    const feedStatus = (Array.isArray(raw.feedStatus) ? raw.feedStatus : [])
      .filter((f) => f && typeof f === 'object')
      .slice(0, 12)
      .map((f) => ({
        id: String(f.id || '').slice(0, 40),
        name: String(f.name || 'Feed').slice(0, 48),
        ok: Boolean(f.ok),
        count: typeof f.count === 'number' && Number.isFinite(f.count) ? Math.max(0, Math.round(f.count)) : 0,
        error: typeof f.error === 'string' ? f.error.slice(0, 160) : ''
      }));
    return {
      version: 1,
      fetchedAt,
      feedStatus,
      items: {
        news: cleanList(rawItems.news, 'news', 24),
        releases: cleanList(rawItems.releases, 'releases', 16),
        deals: cleanList(rawItems.deals, 'deals', 16)
      }
    };
  }

  getGxCornerCache() {
    return this._sanitizeGxCornerCache(this.get('gxCornerCache'));
  }

  saveGxCornerCache(cacheData) {
    const clean = this._sanitizeGxCornerCache(cacheData);
    return this._write('gxCornerCache', clean);
  }
}

module.exports = {
  StorageManager,
  DEFAULT_PROFILE_ID,
  PROFILE_ID_RE,
  VALID_PROFILE_COLORS,
  PER_PROFILE_SETTING_KEYS,
  deriveProfileAvatar
};
