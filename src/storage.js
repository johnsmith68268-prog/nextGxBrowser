const fs = require('fs');
const path = require('path');
const { app } = require('electron');

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
      sitePermissions: path.join(this.dataDir, 'site_permissions.json')
    };

    this.defaults = {
      bookmarks: [
        { id: 'bm-1', title: 'YouTube', url: 'https://www.youtube.com', createdAt: Date.now() },
        { id: 'bm-2', title: 'GitHub', url: 'https://github.com', createdAt: Date.now() },
        { id: 'bm-3', title: 'Google', url: 'https://www.google.com', createdAt: Date.now() },
        { id: 'bm-4', title: 'YouTube Music', url: 'https://music.youtube.com', createdAt: Date.now() }
      ],
      history: [],
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
      settings: {
        browserName: 'nextGx Browser',
        theme: 'gx-violet', // gx-violet | crimson | cyan | emerald
        workspace: 'Personal',
        searchEngine: 'google',
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
        musicServiceUrl: 'https://music.youtube.com',
        leftPanelWidth: 420,
        leftPanelPinned: false,
        sidebarItems: {
          musicPlayer: true,
          chatgpt: true,
          twitch: true,
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
    this._initAll();
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

  getSettings() {
    const saved = this.cache.settings || {};
    return {
      ...this.defaults.settings,
      ...saved,
      sidebarItems: {
        ...this.defaults.settings.sidebarItems,
        ...(saved.sidebarItems || {})
      }
    };
  }

  updateSettings(partial) {
    const current = this.getSettings();
    const updated = {
      ...current,
      ...partial,
      sidebarItems: partial.sidebarItems
        ? { ...current.sidebarItems, ...partial.sidebarItems }
        : current.sidebarItems
    };
    return this._write('settings', updated);
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

  // Bookmarks
  getBookmarks() {
    return this.get('bookmarks');
  }

  isBookmarked(url) {
    if (!url) return false;
    const normalized = url.replace(/\/$/, '');
    return this.getBookmarks().some(b => b.url.replace(/\/$/, '') === normalized);
  }

  toggleBookmark({ title, url }) {
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
        title: title || url,
        url,
        createdAt: Date.now()
      };
      list.unshift(item);
      this._write('bookmarks', list);
      return { added: true, item, bookmarks: list };
    }
  }

  removeBookmark(id) {
    const list = this.getBookmarks().filter(b => b.id !== id);
    return this._write('bookmarks', list);
  }

  // History
  getHistory() {
    return this.get('history');
  }

  addHistory({ title, url, favicon }) {
    if (!url || url.startsWith('file://') || url.startsWith('about:') || url.startsWith('nextgx://') || url.startsWith('chrome://')) {
      return this.getHistory();
    }
    const list = [...this.getHistory()];
    if (list.length > 0 && list[0].url === url) {
      list[0].title = title || list[0].title;
      if (favicon) list[0].favicon = favicon;
      list[0].visitedAt = Date.now();
      return this._write('history', list);
    }
    list.unshift({
      id: 'h-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      title: title || url,
      url,
      favicon: favicon || '',
      visitedAt: Date.now()
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
  getPasswords() {
    return this.get('passwords');
  }

  addPassword({ site, username, password }) {
    const list = [...this.getPasswords()];
    const existingIdx = list.findIndex(p => p.site === site && p.username === username);
    if (existingIdx !== -1) {
      list[existingIdx].password = password;
      list[existingIdx].updatedAt = Date.now();
      return this._write('passwords', list);
    }
    list.unshift({
      id: 'pw-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      site,
      username,
      password,
      createdAt: Date.now()
    });
    return this._write('passwords', list);
  }

  removePassword(id) {
    const list = this.getPasswords().filter(p => p.id !== id);
    return this._write('passwords', list);
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
}

module.exports = { StorageManager };
