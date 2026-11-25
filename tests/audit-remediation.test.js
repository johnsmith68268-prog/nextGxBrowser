const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function installElectronMock(tmpRoot) {
  const downloadsDir = path.join(tmpRoot, 'downloads');
  const userDataDir = path.join(tmpRoot, 'userData');
  fs.mkdirSync(downloadsDir, { recursive: true });
  fs.mkdirSync(userDataDir, { recursive: true });

  const mockElectron = {
    app: {
      getPath: (name) => (name === 'downloads' ? downloadsDir : userDataDir),
      getVersion: () => '3.0.0',
      getAppMetrics: () => []
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (s) => Buffer.from(s, 'utf8'),
      decryptString: (b) => b.toString('utf8')
    },
    shell: { openPath: async () => '', showItemInFolder: () => {} },
    session: { defaultSession: {} },
    dialog: { showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true }) },
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

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nextgx-remediation-test-'));
const mock = installElectronMock(tmpRoot);

test.after(() => {
  mock.restore();
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (_) {}
});

const {
  isYouTubePlayerEndpoint,
  isYouTubeAdStatsUrl,
  stripYouTubePlayerResponse,
  stripYouTubePlayerResponseText
} = require('../src/youtube-adstrip');
const { AdBlocker, COSMETIC_AD_CSS } = require('../src/adblocker');
const { StorageManager } = require('../src/storage');
const { isUrlLikeInput, resolveNavigateInput, resolveSearchEngineMeta } = require('../src/main/navigation');
const { selectRamHibernationCandidate } = require('../src/main/gxcontrol');
const { validateSettingsImport } = require('../src/main/import-export');
const {
  findManifestDirectory,
  sanitizeManifestForElectron,
  extractCrxToZipBuffer
} = require('../src/main/extensions');

test('P0-SEC: gx-extension no longer strips CSP/X-Frame-Options, uses no innerHTML, and trims dangerous manifest keys', () => {
  const rules = JSON.parse(read('gx-extension/rules.json'));
  assert.ok(Array.isArray(rules) && rules.length >= 20, 'expected >= 20 DNR rules');
  for (const r of rules) {
    assert.notEqual(r?.action?.type, 'modifyHeaders', 'must not strip security headers globally');
    const serialized = JSON.stringify(r).toLowerCase();
    assert.ok(!serialized.includes('x-frame-options'), 'must not touch x-frame-options');
    assert.ok(!serialized.includes('content-security-policy'), 'must not touch content-security-policy');
  }

  const manifest = JSON.parse(read('gx-extension/manifest.json'));
  assert.equal(manifest.chrome_url_overrides, undefined, 'manifest must not hijack chrome_url_overrides');
  assert.equal(manifest.side_panel, undefined, 'manifest must not claim side_panel');
  assert.equal(manifest.content_scripts, undefined, 'manifest must not inject unconditional <all_urls> CSS');
  assert.ok(!(manifest.permissions || []).includes('browsingData'), 'manifest must not ask for browsingData');

  const newtabJs = read('gx-extension/newtab.js');
  assert.ok(!/\.innerHTML\s*=/.test(newtabJs), 'gx-extension/newtab.js must not use innerHTML');
});

test('P1-YT: YouTube stripper strips adSlots-only JSON, modern ad fields, and array ad wrappers without hurting video playback', () => {
  const adSlotsOnly = JSON.stringify({
    videoDetails: { videoId: 'abc123', title: 'Clean Video' },
    adSlots: [{ adSlotRenderer: { id: 'slot-1' } }],
    adBreakHeartbeatParams: 'opaque-token',
    contents: [
      { videoRenderer: { videoId: 'keep-1' } },
      { adSlotRenderer: { adSlotLoggingData: { x: 1 } } },
      { inFeedAdLayoutRenderer: { ad: true } },
      { mastheadAdRenderer: { ad: true } },
      { promotedSparklesWebRenderer: { ad: true } }
    ]
  });

  const { text: strippedText, stripped } = stripYouTubePlayerResponseText(adSlotsOnly);
  assert.ok(stripped >= 5, `expected >= 5 ad items stripped, got ${stripped}`);
  const parsed = JSON.parse(strippedText);
  assert.equal(parsed.adSlots, undefined);
  assert.equal(parsed.adBreakHeartbeatParams, undefined);
  assert.equal(parsed.videoDetails.videoId, 'abc123');
  assert.equal(parsed.contents.length, 1);
  assert.equal(parsed.contents[0].videoRenderer.videoId, 'keep-1');

  // Expanded YouTube endpoints
  for (const ep of [
    'https://www.youtube.com/youtubei/v1/player?key=k',
    'https://www.youtube.com/youtubei/v1/next?key=k',
    'https://www.youtube.com/youtubei/v1/browse?key=k',
    'https://www.youtube.com/youtubei/v1/search?key=k',
    'https://www.youtube.com/youtubei/v1/reel/reel_item_watch?key=k'
  ]) {
    assert.equal(isYouTubePlayerEndpoint(ep), true, `endpoint should match: ${ep}`);
  }

  // QoE telemetry must NOT be treated as ad stats (dropping QoE triggers anti-adblock / stalls)
  assert.equal(isYouTubeAdStatsUrl('https://www.youtube.com/api/stats/qoe?event=streamingstats'), false);
  assert.equal(isYouTubeAdStatsUrl('https://www.youtube.com/api/stats/ads?adformat=15'), true);

  const storage = {
    getSettings: () => ({ adblockEnabled: true, trackerBlockEnabled: true }),
    getAdblockSite: () => ({ hasOverride: false, enabled: true })
  };
  const blocker = new AdBlocker(storage);
  assert.equal(
    blocker.shouldBlock('https://www.youtube.com/api/stats/qoe?event=streamingstats', 'xmlhttprequest', 'https://www.youtube.com'),
    false,
    'AdBlocker must not block /api/stats/qoe'
  );
  assert.equal(
    Boolean(blocker.shouldBlock('https://www.youtube.com/api/stats/ads?adformat=15', 'xmlhttprequest', 'https://www.youtube.com')?.blocked),
    true
  );

  // Cosmetic CSS must not contain broad substring selectors that hide legitimate site UI like .download-container
  assert.ok(!COSMETIC_AD_CSS.includes('[class*="ad-container"]'), 'COSMETIC_AD_CSS must not match download-container');
  assert.ok(!COSMETIC_AD_CSS.includes('[class*="ad-banner"]'), 'COSMETIC_AD_CSS must not match broad ad-banner substring');
});

test('P1-YT: tab-preload checks per-site adblock config and includes enforcement dismissal', () => {
  const preload = read('src/tab-preload.js');
  assert.ok(preload.includes("'adblock:get-page-config'"), 'tab-preload must query per-site adblock config');
  assert.ok(preload.includes('ytd-enforcement-message-view-model'), 'tab-preload must handle anti-adblock enforcement dialog');
  const pagefxIdx = preload.indexOf('stopObserver()');
  assert.ok(pagefxIdx > 0, 'PageFX observer lifecycle must exist in tab-preload');
  const pagefxSlice = preload.slice(pagefxIdx);
  assert.ok(!pagefxSlice.includes("ipcRenderer.invoke('settings:get')"), 'PageFX must not call internal-only settings:get');
  assert.ok(pagefxSlice.includes("'pagefx:get-settings'"), 'PageFX must use web-safe pagefx:get-settings');
});

test('P1-NAV: unified navigation resolves URLs, local hosts, Punycode, query-without-slash, and search engines accurately', () => {
  const baseSettings = {
    searchEngine: 'google',
    searchShortcutMode: 'space-or-tab',
    searchEngines: [
      { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=%s', keyword: '', siteSearch: false, builtin: true },
      { id: 'brave', name: 'Brave', url: 'https://search.brave.com/search?q=%s', keyword: 'brave', siteSearch: false, builtin: true },
      { id: 'ecosia', name: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s', keyword: 'ecosia', siteSearch: false, builtin: true },
      { id: 'gh', name: 'GitHub', url: 'https://github.com/search?q=%s', keyword: 'gh', siteSearch: true, builtin: false }
    ]
  };

  assert.equal(isUrlLikeInput('example.com?q=1'), true);
  assert.equal(isUrlLikeInput('example.com#top'), true);
  assert.equal(isUrlLikeInput('api.localhost:3000?tab=1'), true);
  assert.equal(isUrlLikeInput('nas.local'), true);
  assert.equal(isUrlLikeInput('example.xn--p1ai'), true);
  assert.equal(isUrlLikeInput('999.999.999.999'), false, 'invalid IPv4 octets must not be treated as a URL');

  assert.equal(resolveNavigateInput('example.com?q=1', baseSettings), 'https://example.com?q=1');
  assert.equal(resolveNavigateInput('example.com#section', baseSettings), 'https://example.com#section');
  assert.equal(resolveNavigateInput('api.localhost:3000?tab=1', baseSettings), 'http://api.localhost:3000?tab=1');
  assert.equal(resolveNavigateInput('nas.local', baseSettings), 'http://nas.local');
  assert.equal(resolveNavigateInput('example.xn--p1ai', baseSettings), 'https://example.xn--p1ai');
  assert.equal(resolveNavigateInput('about:blank', baseSettings), 'about:blank');
  assert.match(resolveNavigateInput('nextgx://settings/gx', baseSettings), /chrome-webui\.html#settings\/gx$/);

  // Invalid IPv4 falls back to search
  assert.match(resolveNavigateInput('999.999.999.999', baseSettings), /^https:\/\/www\.google\.com\/search\?q=/);

  // Brave & Ecosia engines + custom site-search keyword
  assert.equal(
    resolveNavigateInput('electron', { ...baseSettings, searchEngine: 'brave' }),
    'https://search.brave.com/search?q=electron'
  );
  assert.equal(
    resolveNavigateInput('trees', { ...baseSettings, searchEngine: 'ecosia' }),
    'https://www.ecosia.org/search?q=trees'
  );
  assert.equal(
    resolveNavigateInput('gh nextgx', baseSettings),
    'https://github.com/search?q=nextgx'
  );
  // searchShortcutMode: 'tab' must NOT trigger keyword on space
  assert.equal(
    resolveNavigateInput('gh nextgx', { ...baseSettings, searchShortcutMode: 'tab' }),
    'https://www.google.com/search?q=gh%20nextgx'
  );
  assert.equal(resolveSearchEngineMeta({ ...baseSettings, searchEngine: 'brave' }).name, 'Brave');
});

test('P1-POPOVER: omnibox-suggest is non-focusing left-aligned and closePopover supports kind guard', () => {
  const popoversSrc = read('src/main/popovers.js');
  assert.match(popoversSrc, /'omnibox-suggest':\s*\{[^}]*align:\s*'left'[^}]*noFocus:\s*true/);
  assert.match(popoversSrc, /'tab-search':\s*\{[^}]*minY:\s*36/);
  assert.match(popoversSrc, /if\s*\(kind\s*&&\s*ctx\.popoverOpenKind\s*!==\s*kind\)/);
  assert.match(popoversSrc, /!wasNoFocusKind\s*&&\s*!shellFocused/);
});

test('P1-STORAGE: resetSettings resets non-default profile overrides and panic snapshots are isolated per profile', () => {
  const storage = new StorageManager();
  const created = storage.createProfile({ name: 'Work', color: 'cyan' });
  assert.equal(created.ok, true);
  const workId = created.profile.id;

  // Customize non-default profile settings and reset them
  storage.updateSettings({ theme: 'crimson', sidebarPanelPinned: true }, workId);
  assert.equal(storage.getSettings(workId).theme, 'crimson');
  assert.equal(storage.getSettings(workId).sidebarPanelPinned, true);

  storage.resetSettings(workId);
  assert.equal(storage.getSettings(workId).theme, 'gx-violet');
  assert.equal(storage.getSettings(workId).sidebarPanelPinned, false);

  // Per-profile panic snapshot isolation
  storage.savePanicSnapshot({ savedAt: 1, tabs: [{ url: 'https://default.example' }] }, 'default');
  storage.savePanicSnapshot({ savedAt: 2, tabs: [{ url: 'https://work.example' }] }, workId);
  assert.equal(storage.getPanicSnapshot('default').tabs[0].url, 'https://default.example');
  assert.equal(storage.getPanicSnapshot(workId).tabs[0].url, 'https://work.example');
  storage.clearPanicSnapshot('default');
  assert.equal(storage.getPanicSnapshot('default'), null);
  assert.equal(storage.getPanicSnapshot(workId).tabs[0].url, 'https://work.example');
});

test('P1-SPLIT: selectRamHibernationCandidate never hibernates a visible Split View partner tab', () => {
  const tabs = new Map([
    ['t1', { id: 't1', sleeping: false, pinned: false, audible: false, lastActiveAt: 100 }],
    ['t2', { id: 't2', sleeping: false, pinned: false, audible: false, lastActiveAt: 50 }],
    ['t3', { id: 't3', sleeping: false, pinned: false, audible: false, lastActiveAt: 200 }]
  ]);
  const ctx = {
    activeTabId: 't1',
    tabs,
    split: { active: true, leftTabId: 't1', rightTabId: 't2', ratio: 0.5 }
  };
  const { candidate, eligibleCount } = selectRamHibernationCandidate([ctx]);
  assert.equal(eligibleCount, 1);
  assert.equal(candidate.tab.id, 't3', 'split-view partner t2 must be protected from hibernation');
});

test('P2-IMPORT: validateSettingsImport preserves Wave2/Fix2 settings keys cleanly', () => {
  const storage = new StorageManager();
  const payload = {
    settings: {
      searchEngine: 'brave',
      searchShortcutMode: 'tab',
      startupMode: 'urls',
      startupUrls: ['https://example.com', 'http://localhost:3000'],
      preferredLanguages: ['en-US', 'bn-BD'],
      thirdPartyCookies: 'block',
      sitePermissionDefaults: { camera: 'block', notifications: 'ask' },
      shaderPreset: 'night',
      videoEnhancePreset: 'cinema',
      batterySaverEnabled: true
    }
  };
  const res = validateSettingsImport(payload, storage);
  assert.equal(res.ok, true);
  assert.equal(res.validated.searchEngine, 'brave');
  assert.equal(res.validated.searchShortcutMode, 'tab');
  assert.equal(res.validated.startupMode, 'urls');
  assert.deepEqual(res.validated.startupUrls, ['https://example.com', 'http://localhost:3000']);
  assert.equal(res.validated.thirdPartyCookies, 'block');
  assert.equal(res.validated.sitePermissionDefaults.camera, 'block');
  assert.equal(res.validated.shaderPreset, 'night');
  assert.equal(res.validated.videoEnhancePreset, 'cinema');
  assert.equal(res.validated.batterySaverEnabled, true);
});

test('P2-PACKAGING: icons are unpacked from asar and NSIS uninstall cleanup script exists', () => {
  const pkg = JSON.parse(read('package.json'));
  const unpacked = pkg.build?.asarUnpack || [];
  assert.ok(unpacked.includes('build/icon.ico'), 'build/icon.ico must be in asarUnpack');
  assert.ok(unpacked.includes('build/icon.png'), 'build/icon.png must be in asarUnpack');
  assert.equal(pkg.build?.nsis?.include, 'build/installer.nsh');
  assert.equal(fs.existsSync(path.join(ROOT, 'build/installer.nsh')), true);
});

test('LIVE-UX: sidebar hover never slices behind webview, panic hidden in toolbar, 34px URL pill, corner reload spinner, clean popover border', () => {
  const indexHtml = read('src/ui/index.html');
  assert.match(indexHtml, /id="panicToolbarSlot"[^>]*|class="nx-toolbar-slot hidden" id="panicToolbarSlot"/);

  const css = read('src/ui/styles.css');
  assert.match(css, /\.nx-address-capsule\s*\{[^}]*height:\s*34px;[^}]*border-radius:\s*17px;/);
  assert.match(css, /\.nav-icon-btn\.is-stop::after\s*\{[^}]*animation:\s*nxSpin/);
  assert.ok(!css.includes('.nx-sidebar.rail-hover-expand:hover,'), 'hover-expanding 184px rail over WebContentsView must be disabled');

  const popover = read('src/ui/popover.html');
  const bodyRule = popover.match(/body\s*\{[\s\S]*?\n    \}/);
  assert.ok(bodyRule, 'popover body CSS rule missing');
  assert.ok(!bodyRule[0].includes('inset 0 0 10px var(--nx-brand-soft)'), 'popover body must not have red inner glow border');
  assert.ok(popover.includes('site-info-icon-badge'), 'site-info popover uses crisp SVG badge icon');

  const sidebarChrome = read('src/ui/sidebar-panel-chrome.html');
  assert.match(sidebarChrome, /border-right:\s*none;/, 'sidebar panel must not draw harsh right accent border');
  assert.ok(sidebarChrome.includes('e.screenX'), 'sidebar resizer must track absolute e.screenX');

  const preload = read('src/tab-preload.js');
  assert.ok(preload.includes('clickAllVisibleSkipButtons'), 'YouTube adblock must auto-click delayed skip buttons');
  assert.ok(preload.includes('ytp-ad-action-interstitial'), 'YouTube adblock must handle post-ad interstitial screens');
});

test('LIVE-EXT: extension loader auto-descends nested manifests, sanitizes Chrome-only keys, and parses CRX3 headers', () => {
  const nestedRoot = path.join(tmpRoot, 'ext-nested');
  const versionDir = path.join(nestedRoot, '1.4.2_0');
  fs.mkdirSync(versionDir, { recursive: true });
  fs.writeFileSync(path.join(versionDir, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Test', version: '1.4.2' }));
  assert.equal(findManifestDirectory(nestedRoot), versionDir);

  const { manifest } = sanitizeManifestForElectron(
    {
      manifest_version: '3',
      name: 'Sample',
      update_url: 'https://clients2.google.com/service/update2/crx',
      side_panel: { default_path: 'side.html' },
      differential_fingerprint: 'abc',
      permissions: ['storage', 'sidePanel', 'tabs', 'offscreen']
    },
    versionDir,
    { aggressive: true }
  );
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.update_url, undefined);
  assert.equal(manifest.side_panel, undefined);
  assert.equal(manifest.differential_fingerprint, undefined);
  assert.deepEqual(manifest.permissions, ['storage', 'tabs']);

  // Build synthetic CRX3 header + PK\x03\x04 ZIP payload
  const headerPayload = Buffer.alloc(16, 0xaa);
  const zipPayload = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
  const crx3 = Buffer.alloc(12 + headerPayload.length + zipPayload.length);
  crx3.write('Cr24', 0, 'ascii');
  crx3.writeUInt32LE(3, 4);
  crx3.writeUInt32LE(headerPayload.length, 8);
  headerPayload.copy(crx3, 12);
  zipPayload.copy(crx3, 12 + headerPayload.length);
  const extractedZip = extractCrxToZipBuffer(crx3);
  assert.deepEqual(extractedZip, zipPayload);
});
