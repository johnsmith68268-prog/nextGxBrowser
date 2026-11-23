const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

// Lightweight Electron mock for pure Node unit testing without launching Chromium
function installElectronMock(tmpRoot) {
  const downloadsDir = path.join(tmpRoot, 'downloads');
  const userDataDir = path.join(tmpRoot, 'userData');
  fs.mkdirSync(downloadsDir, { recursive: true });
  fs.mkdirSync(userDataDir, { recursive: true });

  const mockElectron = {
    app: {
      getPath: (name) => (name === 'downloads' ? downloadsDir : userDataDir),
      getVersion: () => '3.0.0'
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (s) => Buffer.from(s, 'utf8'),
      decryptString: (b) => b.toString('utf8')
    },
    shell: { openPath: async () => '', showItemInFolder: () => {} },
    session: { defaultSession: {} },
    BrowserWindow: function () {},
    WebContentsView: function () {},
    ipcMain: { handle: () => {}, on: () => {} }
  };

  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return mockElectron;
    return origLoad.apply(this, arguments);
  };
  return {
    downloadsDir,
    userDataDir,
    restore: () => {
      Module._load = origLoad;
    }
  };
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nextgx-audit-test-'));
const mock = installElectronMock(tmpRoot);

test.after(() => {
  mock.restore();
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (_) {}
});

test('SEC-1: Permissions policy enforces default-deny, separates mediaTypes, and never auto-allows ask', () => {
  const {
    resolvePermissionKeys,
    evaluatePermissionCheck
  } = require('../src/main/permissions');

  assert.deepEqual(resolvePermissionKeys('media', { mediaTypes: ['audio'] }), ['microphone']);
  assert.deepEqual(resolvePermissionKeys('media', { mediaTypes: ['video'] }), ['camera']);
  assert.deepEqual(resolvePermissionKeys('media', { mediaTypes: ['video', 'audio'] }), ['camera', 'microphone']);
  assert.deepEqual(resolvePermissionKeys('videoCapture'), ['camera']);
  assert.deepEqual(resolvePermissionKeys('audioCapture'), ['microphone']);
  assert.deepEqual(resolvePermissionKeys('geolocation'), ['geolocation']);
  assert.deepEqual(resolvePermissionKeys('notifications'), ['notifications']);

  // S-2: screen sharing and clipboard-read are promptable (mapped keys), not
  // default-denied — the user gets an Allow/Block choice like camera/mic.
  assert.deepEqual(resolvePermissionKeys('display-capture'), ['screen-share']);
  assert.deepEqual(resolvePermissionKeys('clipboard-read'), ['clipboard-read']);

  // Sensitive unmapped capabilities must NOT map and must default-deny
  for (const dangerous of ['usb', 'hid', 'serial', 'openExternal', 'midiSysex']) {
    assert.deepEqual(resolvePermissionKeys(dangerous), []);
  }

  const fakeStorage = {
    perms: { camera: 'ask', microphone: 'block', geolocation: 'allow', notifications: 'ask' },
    getSitePermissions() {
      return this.perms;
    }
  };

  // Safe auto-allow permissions
  assert.equal(evaluatePermissionCheck(fakeStorage, 'fullscreen', 'https://example.com'), true);
  assert.equal(evaluatePermissionCheck(fakeStorage, 'clipboard-sanitized-write', 'https://example.com'), true);

  // Unknown/dangerous permissions must be DENIED (unmapped -> false)
  assert.equal(evaluatePermissionCheck(fakeStorage, 'usb', 'https://example.com'), false);

  // Screen-share / clipboard-read with no stored grant return false ('ask'),
  // which makes Chromium prompt via the request handler — not a deny.
  assert.equal(evaluatePermissionCheck(fakeStorage, 'clipboard-read', 'https://example.com'), false);
  assert.equal(evaluatePermissionCheck(fakeStorage, 'display-capture', 'https://example.com'), false);

  // ...and with a stored allow grant they return true (grants are honored).
  const grantedStorage = {
    getSitePermissions() {
      return { 'screen-share': 'allow', 'clipboard-read': 'allow' };
    }
  };
  assert.equal(evaluatePermissionCheck(grantedStorage, 'clipboard-read', 'https://example.com'), true);
  assert.equal(evaluatePermissionCheck(grantedStorage, 'display-capture', 'https://example.com'), true);

  // 'ask' must return false in check handler (so Chromium triggers prompt), 'block' false, 'allow' true
  assert.equal(evaluatePermissionCheck(fakeStorage, 'videoCapture', 'https://example.com'), false);
  assert.equal(evaluatePermissionCheck(fakeStorage, 'audioCapture', 'https://example.com'), false);
  assert.equal(evaluatePermissionCheck(fakeStorage, 'media', 'https://example.com', 'default', { mediaTypes: ['audio'] }), false);
  assert.equal(evaluatePermissionCheck(fakeStorage, 'geolocation', 'https://example.com'), true);
});

test('SEC-2 / SEC-5 / SEC-7: Autofill host matching, favicon sanitizer, and fail-closed download path', () => {
  const {
    isAutofillHostMatch,
    sanitizeFaviconUrl,
    resolveSafeDownloadPath
  } = require('../src/main/utils');

  // Exact normalized host match (allows www. apex equivalence, rejects arbitrary subdomains)
  assert.equal(isAutofillHostMatch('github.com', 'www.github.com'), true);
  assert.equal(isAutofillHostMatch('app.example.com', 'app.example.com'), true);
  assert.equal(isAutofillHostMatch('evil.github.io', 'github.io'), false);
  assert.equal(isAutofillHostMatch('phish.example.com', 'example.com'), false);

  // Favicon URL sanitization
  assert.equal(sanitizeFaviconUrl('https://example.com/favicon.ico'), 'https://example.com/favicon.ico');
  assert.equal(sanitizeFaviconUrl('http://192.168.1.1/icon.png'), 'http://192.168.1.1/icon.png');
  assert.equal(sanitizeFaviconUrl('data:image/png;base64,iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(sanitizeFaviconUrl('file:///C:/Windows/win.ini'), '');
  assert.equal(sanitizeFaviconUrl('javascript:alert(1)'), '');
  assert.equal(sanitizeFaviconUrl('data:image/svg+xml;base64,PHN2Zz4='), '');
  assert.equal(sanitizeFaviconUrl('data:image/png;base64,' + 'A'.repeat(40000)), '');

  // Path traversal blocked
  assert.equal(resolveSafeDownloadPath(path.join(mock.downloadsDir, '..', 'evil.exe')), null);
  assert.ok(resolveSafeDownloadPath(path.join(mock.downloadsDir, 'safe.pdf')));
});

test('BUG-1 / PERF-3: Atomic JSON storage writes, .bak recovery, .corrupt quarantine, and deferred flushAll', () => {
  const { StorageManager } = require('../src/storage');
  const s1 = new StorageManager();
  s1.addBookmark({ title: 'Test Site', url: 'https://example.com' });
  s1.addBookmark({ title: 'Second Site', url: 'https://github.com' });

  // Verify .bak exists after 2nd write
  const bmFile = s1.files.bookmarks;
  assert.ok(fs.existsSync(bmFile), 'bookmarks.json should exist');
  assert.ok(fs.existsSync(`${bmFile}.bak`), 'bookmarks.json.bak should exist');

  // Simulate crash mid-write corrupting bookmarks.json
  fs.writeFileSync(bmFile, '{"broken json...', 'utf-8');

  // Re-initialize storage -> must recover from .bak and quarantine corrupted file
  const s2 = new StorageManager();
  const recovered = s2.getBookmarks();
  assert.ok(recovered.length >= 1, 'Bookmarks should be recovered from .bak');
  const dirEntries = fs.readdirSync(path.dirname(bmFile));
  assert.ok(dirEntries.some((f) => f.startsWith('bookmarks.json.corrupt-')), 'Corrupt file should be quarantined');

  // Deferred write via addHistory + flushAll
  s2.addHistory({ title: 'Example', url: 'https://example.com', favicon: 'https://example.com/favicon.ico' });
  s2.flushAll();
  const persistedHistory = JSON.parse(fs.readFileSync(s2.files.history, 'utf-8'));
  assert.ok(persistedHistory.some((h) => h.url === 'https://example.com'));
});

test('BUG-2: Download filename deduplication auto-numbers collisions', () => {
  const { getUniqueDownloadPath } = require('../src/main/downloads');
  const dlDir = path.join(mock.downloadsDir, 'dedup-test');
  fs.mkdirSync(dlDir, { recursive: true });

  const first = getUniqueDownloadPath(dlDir, 'archive.zip');
  assert.equal(first.fileName, 'archive.zip');
  fs.writeFileSync(first.savePath, 'v1');

  const second = getUniqueDownloadPath(dlDir, 'archive.zip');
  assert.equal(second.fileName, 'archive (1).zip');
  fs.writeFileSync(second.savePath, 'v2');

  const third = getUniqueDownloadPath(dlDir, 'archive.zip');
  assert.equal(third.fileName, 'archive (2).zip');
});

test('SEC-6: GX Corner SSRF private/loopback IP filter blocks local ranges and allows public hosts', () => {
  const { isPrivateOrReservedIp } = require('../src/main/gxcorner');
  for (const blocked of [
    'localhost',
    '127.0.0.1',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1'
  ]) {
    assert.equal(isPrivateOrReservedIp(blocked), true, `Expected ${blocked} to be blocked`);
  }
  for (const allowed of ['1.1.1.1', '8.8.8.8', 'feeds.ign.com', 'store.steampowered.com']) {
    assert.equal(isPrivateOrReservedIp(allowed), false, `Expected ${allowed} to be allowed`);
  }
});

test('PERF-4: Set-based AdBlocker matches ads/trackers accurately and runs fast', () => {
  const { AdBlocker } = require('../src/adblocker');
  const settings = { adblockEnabled: true, trackerBlockEnabled: true };
  const allowlisted = new Set(['https://trusted.example']);
  const fakeStorage = {
    getSettings: () => settings,
    getAdblockSite: (origin) => ({
      origin,
      hasOverride: allowlisted.has(origin),
      enabled: !allowlisted.has(origin)
    })
  };
  const blocker = new AdBlocker(fakeStorage);

  // Ad & tracker hits
  const adRes = blocker.shouldBlock('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', 'script', 'https://news.example');
  assert.equal(adRes.blocked, true);
  assert.equal(adRes.category, 'ad');

  const trRes = blocker.shouldBlock('https://www.google-analytics.com/analytics.js', 'script', 'https://news.example');
  assert.equal(trRes.blocked, true);
  assert.equal(trRes.category, 'tracker');

  const pathRuleRes = blocker.shouldBlock('https://connect.facebook.net/en_us/fbevents.js', 'script', 'https://news.example');
  assert.equal(pathRuleRes.blocked, true);
  assert.equal(pathRuleRes.category, 'tracker');

  // Tracker toggle respected
  settings.trackerBlockEnabled = false;
  assert.equal(blocker.shouldBlock('https://www.google-analytics.com/analytics.js', 'script', 'https://news.example'), false);
  settings.trackerBlockEnabled = true;

  // Bypass mainFrame, internal protocols, allowlisted origin, and clean URLs
  assert.equal(blocker.shouldBlock('https://doubleclick.net/promo', 'mainFrame', 'https://news.example'), false);
  assert.equal(blocker.shouldBlock('file:///C:/nextGx/index.html', 'script', 'https://news.example'), false);
  assert.equal(blocker.shouldBlock('https://doubleclick.net/ad.js', 'script', 'https://trusted.example'), false);
  assert.equal(blocker.shouldBlock('https://cdn.example.org/assets/app.bundle.js', 'script', 'https://news.example'), false);

  // Micro-benchmark: 10,000 requests should complete quickly (< 250ms)
  const t0 = performance.now();
  for (let i = 0; i < 10000; i++) {
    blocker.shouldBlock('https://cdn.example.org/assets/app.bundle.js', 'script', 'https://news.example', { initiatorNormalized: true });
  }
  const elapsedMs = performance.now() - t0;
  assert.ok(elapsedMs < 250, `Expected fast matching, took ${elapsedMs.toFixed(1)}ms`);
});

test('SEC-3 / BUG-9: Every active internal UI HTML file has a CSP meta tag with the intended policy, and dead left-dock files are removed', () => {
  const uiDir = path.join(__dirname, '..', 'src', 'ui');
  const htmlFiles = fs.readdirSync(uiDir).filter((f) => f.endsWith('.html'));
  assert.ok(!htmlFiles.includes('left-dock-header.html'), 'left-dock-header.html should be removed');
  assert.ok(!htmlFiles.includes('left-dock-resizer.html'), 'left-dock-resizer.html should be removed');
  assert.ok(htmlFiles.length >= 9, 'Expected all 9 active UI HTML files');

  // Documented intended policy (shared by all internal pages):
  // - script-src 'self' 'unsafe-inline' is genuinely required: 7 of the 9 pages
  //   carry inline <script> blocks (corner, error, newtab, player, popover,
  //   screenshot, sidebar-panel-chrome). chrome-webui.html and index.html only
  //   load external scripts, but keep the uniform policy for consistency.
  // - style-src 'self' 'unsafe-inline' is required by inline <style> blocks and
  //   inline style="" attributes used across the pages.
  // - No remote code is ever allowed: no http:/https: in script-src or style-src,
  //   no 'unsafe-eval', no wildcard '*', and no network at all (connect-src 'none').
  const COMMON_DIRECTIVES = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'none'"]
  };
  // img-src varies by page because only some pages show remote/file images:
  // - file: images (local wallpapers/favicons): chrome-webui, newtab
  // - remote images (favicons, artwork, thumbnails): corner, index, player,
  //   popover, sidebar-panel-chrome
  // - local images only: error, screenshot
  const IMG_SRC_BY_FILE = {
    'chrome-webui.html': ["'self'", 'data:', 'file:', 'https:', 'http:'],
    'newtab.html': ["'self'", 'data:', 'file:', 'https:', 'http:'],
    'corner.html': ["'self'", 'data:', 'https:', 'http:'],
    'index.html': ["'self'", 'data:', 'https:', 'http:'],
    'player.html': ["'self'", 'data:', 'https:', 'http:'],
    'popover.html': ["'self'", 'data:', 'https:', 'http:'],
    'sidebar-panel-chrome.html': ["'self'", 'data:', 'https:', 'http:'],
    'error.html': ["'self'", 'data:'],
    'screenshot.html': ["'self'", 'data:'],
    'passkey-dialog.html': ["'self'", 'data:'] // worker C: dialog shows no images
  };

  for (const file of htmlFiles) {
    const content = fs.readFileSync(path.join(uiDir, file), 'utf-8');
    // The meta tag may span multiple lines (popover.html), so match across lines.
    const meta = content.match(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/is);
    assert.ok(meta, `${file} must define a CSP meta tag`);
    const cspValue = meta[0].match(/content="([^"]*)"/s)[1];
    assert.ok(cspValue.length > 0, `${file} CSP must not be empty`);

    const directives = {};
    for (const part of cspValue.split(';')) {
      const tokens = part.trim().split(/\s+/).filter(Boolean);
      if (tokens.length === 0) continue;
      directives[tokens[0]] = tokens.slice(1);
    }

    const expected = { ...COMMON_DIRECTIVES, 'img-src': IMG_SRC_BY_FILE[file] };
    assert.ok(expected['img-src'], `${file} has no expected img-src policy defined in this test`);
    assert.deepEqual(
      Object.keys(directives).sort(),
      Object.keys(expected).sort(),
      `${file} CSP must contain exactly the documented directives (no missing, no extra)`
    );
    for (const [directive, values] of Object.entries(expected)) {
      assert.deepEqual(directives[directive], values, `${file} CSP ${directive} must be exactly: ${values.join(' ')}`);
    }

    // Belt-and-braces guards: never allow a wildcard source or eval anywhere.
    assert.ok(!cspValue.includes('*'), `${file} CSP must not contain a wildcard source`);
    assert.ok(!cspValue.includes('unsafe-eval'), `${file} CSP must not allow unsafe-eval`);
  }
});
