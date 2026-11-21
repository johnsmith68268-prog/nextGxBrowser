const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

class StorageManager {
  constructor() {
    this.dataDir = path.join(app.getPath('userData'), 'nextgx-data');
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

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
      session: path.join(this.dataDir, 'session.json')
    };

    this.defaults = {
      bookmarks: [
        { id: 'bm-1', title: 'YouTube', url: 'https://www.youtube.com', createdAt: Date.now() },
        { id: 'bm-2', title: 'GitHub', url: 'https://github.com', createdAt: Date.now() },
        { id: 'bm-3', title: 'Google', url: 'https://www.google.com', createdAt: Date.now() },
        { id: 'bm-4', title: 'YouTube Music', url: 'https://music.youtube.com', createdAt: Date.now() }
      ],
      history: [],
      closedTabs: [],
      downloads: [],
      passwords: [],
      notes: [
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
      settings: {
        browserName: 'nextGx Browser',
        theme: 'gx-violet', // gx-violet | crimson | cyan | emerald
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
        totalAdsBlocked: 0,
        extensionsDevMode: true,
        sidebarItems: {
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
          gxControl: true,
          gxCleaner: true
        }
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
    this._migratePasswords();
  }

  _initAll() {
    for (const [key, filePath] of Object.entries(this.files)) {
      if (!fs.existsSync(filePath)) {
        this._write(key, this.defaults[key]);
      } else {
        try {
          const raw = fs.readFileSync(filePath, 'utf-8');
          this.cache[key] = JSON.parse(raw);
        } catch (_) {
          this._write(key, this.defaults[key]);
        }
      }
    }
  }

  _write(key, data) {
    this.cache[key] = data;
    try {
      fs.writeFileSync(this.files[key], JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[Storage] Failed writing ${key}:`, err.message);
    }
    return data;
  }

  get(key) {
    return this.cache[key] ?? this.defaults[key];
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

  getSettings() {
    const saved = this.cache.settings || {};
    const merged = {
      ...this.defaults.settings,
      ...saved,
      sidebarItems: {
        ...this.defaults.settings.sidebarItems,
        ...(saved.sidebarItems || {})
      }
    };
    merged.restoreSession = merged.restoreSession !== false;
    const hpCheck = this.validateHomepageUrl(merged.homepageUrl);
    merged.homepageUrl = hpCheck.ok ? hpCheck.url : '';
    return merged;
  }

  updateSettings(partial) {
    const current = this.getSettings();
    const safePartial = partial && typeof partial === 'object' ? { ...partial } : {};
    if (Object.prototype.hasOwnProperty.call(safePartial, 'restoreSession')) {
      safePartial.restoreSession = Boolean(safePartial.restoreSession);
    }
    if (Object.prototype.hasOwnProperty.call(safePartial, 'homepageUrl')) {
      const hpCheck = this.validateHomepageUrl(safePartial.homepageUrl);
      if (hpCheck.ok) {
        safePartial.homepageUrl = hpCheck.url;
      } else {
        delete safePartial.homepageUrl;
      }
    }
    const updated = {
      ...current,
      ...safePartial,
      sidebarItems: safePartial.sidebarItems
        ? { ...current.sidebarItems, ...safePartial.sidebarItems }
        : current.sidebarItems
    };
    return this._write('settings', updated);
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
      if (
        ['newtab', 'history', 'downloads', 'bookmarks', 'passwords', 'extensions', 'settings'].includes(
          page
        )
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

      for (let i = 0; i < w.tabs.length && tabs.length < 200; i++) {
        const t = w.tabs[i];
        if (!t || typeof t !== 'object') continue;
        const cleanUrl = this._normalizeSessionUrl(t.url);
        if (!cleanUrl) continue;
        if (i === rawActiveIdx) {
          activeTabIndex = tabs.length;
          matchedActive = true;
        }
        const cleanTitle =
          typeof t.title === 'string' && t.title.trim()
            ? t.title.trim().slice(0, 300)
            : cleanUrl === 'nextgx://newtab'
            ? 'Start Page'
            : cleanUrl;
        tabs.push({
          url: cleanUrl,
          title: cleanTitle,
          pinned: Boolean(t.pinned)
        });
      }

      if (tabs.length === 0) continue;
      if (!matchedActive) {
        activeTabIndex = Math.max(0, Math.min(tabs.length - 1, rawActiveIdx));
      }
      windows.push({
        activeTabIndex,
        tabs
      });
    }

    return {
      version: 1,
      savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : Date.now(),
      windows
    };
  }

  getSession() {
    return this._sanitizeSession(this.get('session'));
  }

  saveSession(sessionData) {
    const clean = this._sanitizeSession({
      ...(sessionData && typeof sessionData === 'object' ? sessionData : {}),
      savedAt: Date.now()
    });
    return this._write('session', clean);
  }

  incrementBlockedCount(count = 1) {
    const s = this.getSettings();
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
  }

  // Site Permissions (per-origin: allow | block | ask)
  getSitePermissions(origin) {
    const map = this.get('sitePermissions') || {};
    const defaults = {
      camera: 'ask',
      microphone: 'ask',
      geolocation: 'ask',
      notifications: 'ask',
      media: 'allow'
    };
    return { ...defaults, ...(map[origin] || {}) };
  }

  setSitePermission(origin, permKey, value) {
    if (!origin) return this.getSitePermissions('');
    const map = { ...(this.get('sitePermissions') || {}) };
    map[origin] = {
      ...this.getSitePermissions(origin),
      [permKey]: value
    };
    this._write('sitePermissions', map);
    return map[origin];
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

  getAdblockSites() {
    const raw = this.get('adblockSites');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return { ...raw };
  }

  getAdblockSite(origin) {
    const norm = this._normalizeAdblockOrigin(origin);
    const globalEnabled = Boolean(this.getSettings().adblockEnabled);
    if (!norm) {
      return { origin: '', enabled: globalEnabled, hasOverride: false };
    }
    const map = this.getAdblockSites();
    const entry = map[norm];
    if (entry && typeof entry === 'object' && typeof entry.enabled === 'boolean') {
      return { origin: norm, enabled: entry.enabled, hasOverride: true };
    }
    if (typeof entry === 'boolean') {
      return { origin: norm, enabled: entry, hasOverride: true };
    }
    return { origin: norm, enabled: globalEnabled, hasOverride: false };
  }

  setAdblockSite(origin, enabled) {
    const norm = this._normalizeAdblockOrigin(origin);
    const val = Boolean(enabled);
    if (!norm) {
      return { origin: '', enabled: val, hasOverride: false };
    }
    const map = this.getAdblockSites();
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

  getBookmarks() {
    const raw = this.get('bookmarks');
    return Array.isArray(raw) ? raw.filter((b) => b && typeof b === 'object' && typeof b.url === 'string') : [];
  }

  isBookmarked(url) {
    if (!url || typeof url !== 'string') return false;
    const normalized = url.replace(/\/$/, '');
    return this.getBookmarks().some(b => b.url.replace(/\/$/, '') === normalized);
  }

  toggleBookmark({ title, url, favicon = '', folder = '' }) {
    if (!url || url.startsWith('file://') || url.startsWith('nextgx://') || url.startsWith('chrome://')) {
      return { added: false, bookmarks: this.getBookmarks() };
    }
    const normalized = url.replace(/\/$/, '');
    const list = [...this.getBookmarks()];
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

  addBookmark({ title, url, folder = '', favicon = '' } = {}) {
    const cleanUrl = this._normalizeBookmarkUrl(url);
    if (!cleanUrl) {
      return { ok: false, error: 'Please enter a valid http(s) URL.', bookmarks: this.getBookmarks() };
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

    const list = [item, ...this.getBookmarks()];
    this._write('bookmarks', list);
    return { ok: true, item, bookmarks: list };
  }

  updateBookmark(id, { title, url, folder, favicon } = {}) {
    if (!id || typeof id !== 'string') {
      return { ok: false, error: 'Missing bookmark ID.', bookmarks: this.getBookmarks() };
    }
    const list = [...this.getBookmarks()];
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

  updateBookmarkFavicon(url, favicon) {
    if (!url || typeof url !== 'string') return null;
    const cleanFavicon = this._normalizeBookmarkFavicon(favicon);
    if (!cleanFavicon) return null;
    const normalized = url.replace(/\/$/, '');
    const list = [...this.getBookmarks()];
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

  renameBookmarkFolder(oldName, newName) {
    const cleanOld = this._normalizeBookmarkFolder(oldName);
    const cleanNew = this._normalizeBookmarkFolder(newName);
    if (!cleanOld) {
      return { ok: false, error: 'Missing folder name.', bookmarks: this.getBookmarks() };
    }
    if (!cleanNew) {
      return { ok: false, error: 'Folder name cannot be empty.', bookmarks: this.getBookmarks() };
    }
    const list = this.getBookmarks().map((b) => {
      if (this._normalizeBookmarkFolder(b.folder) === cleanOld) {
        return { ...b, folder: cleanNew };
      }
      return b;
    });
    this._write('bookmarks', list);
    return { ok: true, bookmarks: list };
  }

  removeBookmark(id) {
    const list = this.getBookmarks().filter(b => b.id !== id);
    return this._write('bookmarks', list);
  }

  // History
  getHistory() {
    return this.get('history');
  }

  addHistory({ title, url, favicon, isVisit = true } = {}) {
    if (
      !url ||
      url.startsWith('file://') ||
      url.startsWith('about:') ||
      url.startsWith('nextgx://') ||
      url.startsWith('gx://') ||
      url.startsWith('chrome://')
    ) {
      return this.getHistory();
    }
    const list = [...this.getHistory()];
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

  clearHistory(range = 'all') {
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
    const list = this.getHistory().filter(h => (h.visitedAt || 0) < cutoff);
    return this._write('history', list);
  }

  removeHistoryItem(id) {
    const list = this.getHistory().filter(h => h.id !== id);
    return this._write('history', list);
  }

  // Recently Closed Tabs
  getClosedTabs() {
    return this.get('closedTabs') || [];
  }

  addClosedTab({ title, url, favicon } = {}) {
    if (
      !url ||
      url.startsWith('file://') ||
      url.startsWith('about:') ||
      url.startsWith('nextgx://') ||
      url.startsWith('gx://') ||
      url.startsWith('chrome://')
    ) {
      return this.getClosedTabs();
    }
    const list = [...this.getClosedTabs()];
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

  removeClosedTab(id) {
    const list = this.getClosedTabs().filter((t) => t && t.id !== id);
    return this._write('closedTabs', list);
  }

  clearClosedTabs() {
    return this._write('closedTabs', []);
  }

  // Downloads
  getDownloads() {
    return this.get('downloads');
  }

  upsertDownload(entry) {
    const list = [...this.getDownloads()];
    const idx = list.findIndex(d => d.id === entry.id);
    if (idx !== -1) {
      list[idx] = { ...list[idx], ...entry };
    } else {
      list.unshift(entry);
    }
    if (list.length > 100) list.length = 100;
    return this._write('downloads', list);
  }

  removeDownload(id) {
    const list = this.getDownloads().filter(d => d.id !== id);
    return this._write('downloads', list);
  }

  clearDownloads() {
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

  getPasswords() {
    const rawList = this.get('passwords');
    if (!Array.isArray(rawList)) return [];
    return rawList.map((entry) => this._decodePasswordRecord(entry)).filter(Boolean);
  }

  addPassword({ site, username, password }) {
    const rawList = Array.isArray(this.get('passwords')) ? [...this.get('passwords')] : [];
    const existingIdx = rawList.findIndex((p) => p && p.site === site && p.username === username);
    if (existingIdx !== -1) {
      rawList[existingIdx] = this._encodePasswordRecord(
        { ...rawList[existingIdx], updatedAt: Date.now() },
        password
      );
      this._write('passwords', rawList);
      return this.getPasswords();
    }

    const baseRecord = {
      id: 'pw-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      site,
      username,
      createdAt: Date.now()
    };
    rawList.unshift(this._encodePasswordRecord(baseRecord, password));
    this._write('passwords', rawList);
    return this.getPasswords();
  }

  removePassword(id) {
    const rawList = Array.isArray(this.get('passwords')) ? this.get('passwords') : [];
    const list = rawList.filter((p) => p && p.id !== id);
    this._write('passwords', list);
    return this.getPasswords();
  }

  // Quick Notes
  getNotes() {
    return this.get('notes');
  }

  saveNote(text) {
    const list = [{ id: 'note-1', text: String(text || ''), updatedAt: Date.now() }];
    return this._write('notes', list);
  }

  // Speed Dial
  getSpeedDial() {
    return this.get('speedDial');
  }

  addSpeedDial({ title, url }) {
    const list = [...this.getSpeedDial()];
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

  removeSpeedDial(id) {
    const list = this.getSpeedDial().filter(s => s.id !== id);
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
}

module.exports = { StorageManager };
