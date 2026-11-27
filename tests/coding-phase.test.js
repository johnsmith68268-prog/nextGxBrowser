const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');

// Lightweight Electron mock (same pattern as settings-wave2.test.js):
// pure Node, no Chromium launch.
function installElectronMock(tmpRoot) {
  const userDataDir = path.join(tmpRoot, 'userData');
  fs.mkdirSync(userDataDir, { recursive: true });
  const mockElectron = {
    app: {
      getPath: (name) => (name === 'downloads' ? path.join(tmpRoot, 'downloads') : userDataDir),
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
  return () => {
    Module._load = origLoad;
  };
}

test('GX-1: Twitch and Discord are surfaced in the sidebar by default', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-gx1-'));
  const restore = installElectronMock(tmpRoot);
  try {
    delete require.cache[require.resolve('../src/storage')];
    const { StorageManager } = require('../src/storage');
    const storage = new StorageManager({ dataDir: path.join(tmpRoot, 'data') });
    const settings = storage.getSettings();
    assert.equal(settings.sidebarItems.twitch, true, 'Twitch on by default');
    assert.equal(settings.sidebarItems.discord, true, 'Discord on by default (Opera GX parity)');
  } finally {
    restore();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('GX-2: WebUI emblem file exists and the header no longer shows a broken image', () => {
  const emblem = path.join(ROOT, 'src', 'ui', 'assets', 'nextgx-emblem.png');
  assert.ok(fs.existsSync(emblem), 'nextgx-emblem.png must exist');
  const buf = fs.readFileSync(emblem);
  // PNG magic bytes + 512x512 (see scripts/generate-icons.js output)
  assert.deepEqual(Array.from(buf.subarray(0, 8)), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(buf.length > 50000, `emblem should be a real raster icon, got ${buf.length} bytes`);
  const html = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'chrome-webui.html'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'chrome-webui.js'), 'utf8');
  assert.match(html, /id="webuiHeaderEmblem"/, 'header emblem element has a hook id without inline onerror');
  assert.match(js, /webuiHeaderEmblem[\s\S]*?addEventListener\('error'/, 'header emblem hides itself if the file ever goes missing again');
});

test('GX-3: cert error page offers a two-step Proceed-anyway path', () => {
  const html =
    fs.readFileSync(path.join(ROOT, 'src', 'ui', 'error.html'), 'utf8') +
    '\n' +
    fs.readFileSync(path.join(ROOT, 'src', 'ui', 'error.js'), 'utf8');
  assert.match(html, /id="btnProceed"/);
  assert.match(html, /Proceed anyway/);
  assert.match(html, /proceedAnyway/);
  assert.match(html, /I understand the risk/);
  assert.match(html, /session only/i);
  // Non-cert errors must not get the button: the gating code is present.
  assert.match(html, /isCertError/);
});

test('GX-4: GX Control has a circular RAM gauge + Hot Tab Killer, tab hover shows memory', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'index.html'), 'utf8');
  assert.match(indexHtml, /id="perfRamGaugeArc"/);
  assert.match(indexHtml, /id="perfRamGaugeText"/);
  assert.match(indexHtml, /id="btnHotTabKiller"/);
  assert.match(indexHtml, /Hot Tab Killer/);
  const renderer = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'renderer.js'), 'utf8');
  assert.match(renderer, /perfRamGaugeArc/);
  assert.match(renderer, /tab-hover-meta/);
  assert.match(renderer, /Memory: \${hoverStat\.ramMB} MB/);
  const styles = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'styles.css'), 'utf8');
  assert.match(styles, /\.gx-gauge-arc/);
  assert.match(styles, /\.tab-hover-meta/);
});

test('GX-5: Settings themes are preview cards, not text pills', () => {
  const webuiJs = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'chrome-webui.js'), 'utf8');
  assert.match(webuiJs, /theme-card/);
  assert.match(webuiJs, /theme-preview gx-violet/);
  assert.match(webuiJs, /theme-preview crimson/);
  const webuiHtml = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'chrome-webui.html'), 'utf8');
  assert.match(webuiHtml, /\.theme-preview/);
});

test('GX-6: bundled GX extension DNR rules are ported into the engine blocker', () => {
  const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'gx-extension', 'rules.json'), 'utf8'));
  assert.ok(Array.isArray(rules) && rules.length >= 20, 'rules.json should include the YouTube stats/ads rules');
  assert.ok(rules.some((r) => r.condition && r.condition.urlFilter === 'youtube.com/api/stats/ads'));
  const { AdBlocker, AD_DOMAINS, TRACKER_DOMAINS } = require('../src/adblocker');
  const covered = new Set([...AD_DOMAINS, ...TRACKER_DOMAINS]);
  // Every domain blocked by rules.json must also be blocked by the engine.
  for (const rule of rules) {
    const filter = rule.condition && rule.condition.urlFilter;
    if (!filter || !filter.startsWith('||')) continue;
    const domain = filter.slice(2).replace(/\^$/, '');
    assert.ok(
      [...covered].some((d) => d === domain || d.endsWith(`.${domain}`) || domain.endsWith(`.${d}`)),
      `DNR domain ${domain} is not covered by the engine blocker`
    );
  }
  const settings = { adblockEnabled: true, trackerBlockEnabled: true };
  const blocker = new AdBlocker({
    getSettings: () => settings,
    getAdblockSite: () => ({ hasOverride: false, enabled: true })
  });
  assert.equal(blocker.shouldBlock('https://www.youtube.com/api/stats/ads?x=1', 'xmlhttprequest', 'https://www.youtube.com').blocked, true);
});

test('GX-7: YouTube scriptlet is wired into the tab preload and sidebar suspends idle views', () => {
  const preload = fs.readFileSync(path.join(ROOT, 'src', 'tab-preload.js'), 'utf8');
  assert.match(preload, /initYouTubeAdStrip/);
  assert.match(preload, /youtube-adstrip/);
  assert.match(preload, /executeJavaScript\(buildMainWorldYouTubeHook\(\)\)/);
  // Regression: sandboxed preloads cannot require() relative modules —
  // a relative require kills the ENTIRE preload (WebUI APIs never appear).
  // Only require('electron') is allowed in the preload.
  // Strip comments first: the note above mentions a relative require in
  // prose, and only real code requires count.
  const codeOnly = preload.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const requires = [...codeOnly.matchAll(/require\(([^)]+)\)/g)].map((m) => m[1].trim());
  assert.deepEqual(requires, ["'electron'"], `preload must only require('electron'), found: ${requires.join(', ')}`);
  // The inlined strip functions in the preload must behave exactly like
  // the unit-tested module: extract them from the preload source and run
  // the same stripping assertions against them.
  const { stripYouTubePlayerResponse: modStrip } = require('../src/youtube-adstrip');
  const extract = (src, name) => {
    const start = src.indexOf(`function ${name}(`);
    assert.ok(start !== -1, `${name} not found in preload`);
    let depth = 0;
    let i = src.indexOf('{', start);
    const bodyStart = i;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return src.slice(start, i);
  };
  const fieldsMatch = preload.match(/const YT_AD_FIELD_NAMES = (\[[\s\S]*?\]);/);
  assert.ok(fieldsMatch, 'YT_AD_FIELD_NAMES not found in preload');
  const sandbox = { module: { exports: {} } };
  const code = `${fieldsMatch[0]}\n${extract(preload, 'stripYouTubePlayerResponse')}\n${extract(preload, 'stripYouTubePlayerResponseText')}\nmodule.exports = { stripYouTubePlayerResponse, stripYouTubePlayerResponseText };`;
  new Function('module', 'exports', code)(sandbox.module, sandbox.module.exports);
  const { stripYouTubePlayerResponse, stripYouTubePlayerResponseText } = sandbox.module.exports;
  const sample = {
    videoDetails: { videoId: 'abc' },
    adPlacements: [{ a: 1 }],
    nested: { playerAds: [{ b: 2 }], adSlots: [{ c: 3 }] },
    streamingData: { formats: [{ url: 'https://rr1---sn.googlevideo.com/x' }] }
  };
  const fromPreload = stripYouTubePlayerResponse(JSON.parse(JSON.stringify(sample)));
  const fromModule = modStrip(JSON.parse(JSON.stringify(sample)));
  assert.equal(fromPreload.stripped, 3);
  assert.equal(fromPreload.stripped, fromModule.stripped);
  assert.deepEqual(fromPreload.data, fromModule.data);
  const textRes = stripYouTubePlayerResponseText(JSON.stringify(sample));
  assert.equal(textRes.stripped, 3);
  assert.ok(!textRes.text.includes('adPlacements'));
  const sidebar = fs.readFileSync(path.join(ROOT, 'src', 'main', 'sidebar.js'), 'utf8');
  assert.match(sidebar, /only one external sidebar service view stays live/);
  assert.match(sidebar, /suspendSidebarServiceView\(ctx, otherKey\)/);
  const tabs = fs.readFileSync(path.join(ROOT, 'src', 'main', 'tabs.js'), 'utf8');
  assert.match(tabs, /do not survive a tab switch/);
  const renderer = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'renderer.js'), 'utf8');
  assert.match(renderer, /Escape closes the GX left tool drawer first/);
});

test('GX-8: packaged build ships the bundled GX extension', () => {
  // Regression (found by launching the built AppImage): electron-builder
  // only packs the paths listed in package.json "build.files" — the
  // gx-extension/ folder was missing, so the loader found nothing in the
  // packaged app. The engine blocker still worked, but the DNR rules
  // never even loaded.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const files = pkg.build && pkg.build.files ? pkg.build.files : [];
  assert.ok(files.some((f) => String(f).startsWith('gx-extension')), `build.files must include gx-extension/**, found: ${files.join(', ')}`);
  assert.ok(fs.existsSync(path.join(ROOT, 'gx-extension', 'manifest.json')));
  assert.ok(fs.existsSync(path.join(ROOT, 'gx-extension', 'rules.json')));
});

test('GX-9: packaged build unpacks the GX extension to a real directory and the loader finds it', () => {
  // Regression (found by launching the built AppImage): Chromium's
  // extension loader cannot read a directory inside app.asar, so the
  // extension must be unpacked (build.asarUnpack) and the loader must
  // look in <resources>/app.asar.unpacked/gx-extension, not inside the
  // asar.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const unpack = pkg.build && pkg.build.asarUnpack ? pkg.build.asarUnpack : [];
  assert.ok(unpack.some((f) => String(f).startsWith('gx-extension')), `build.asarUnpack must include gx-extension/**, found: ${unpack.join(', ')}`);
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nextgx-gxext-'));
  const resourcesPath = path.join(tmpRoot, 'resources');
  const unpackedDir = path.join(resourcesPath, 'app.asar.unpacked', 'gx-extension');
  fs.mkdirSync(unpackedDir, { recursive: true });
  fs.writeFileSync(path.join(unpackedDir, 'manifest.json'), '{"name":"GX"}');
  const restore = installElectronMock(tmpRoot);
  const origResourcesPath = process.resourcesPath;
  try {
    process.resourcesPath = resourcesPath;
    delete require.cache[require.resolve('../src/main/gx-extension')];
    const gx = require('../src/main/gx-extension');
    assert.equal(gx.resolveGxExtensionDir(), unpackedDir);
  } finally {
    if (origResourcesPath === undefined) delete process.resourcesPath;
    else process.resourcesPath = origResourcesPath;
    restore();
  }
});
