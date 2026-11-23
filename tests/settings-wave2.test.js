const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

// [Wave2-D] Unit tests for the Settings / privacy / autofill storage work
// (gaps 5.1–5.9, 5.11–5.14, 6.2/6.3). Same lightweight Electron mock pattern
// as audit-fixes.test.js: pure Node, no Chromium launch.
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

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nextgx-wave2-settings-test-'));
const mock = installElectronMock(tmpRoot);

test.after(() => {
  mock.restore();
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (_) {}
});

function freshStorage() {
  const { StorageManager } = require('../src/storage');
  return new StorageManager();
}

test('Wave2-D defaults: new settings keys exist with Chrome-like values', () => {
  const store = freshStorage();
  const s = store.getSettings();
  assert.equal(s.searchEngine, 'google');
  assert.equal(s.searchEngines.length, 5);
  assert.deepEqual(
    s.searchEngines.map((e) => e.id),
    ['google', 'bing', 'duckduckgo', 'brave', 'ecosia']
  );
  assert.equal(s.searchShortcutMode, 'space-or-tab');
  assert.equal(s.startupMode, 'restore');
  assert.deepEqual(s.startupUrls, []);
  assert.equal(s.restoreSession, true);
  assert.deepEqual(s.preferredLanguages, ['en-US']);
  assert.equal(s.spellcheckEnabled, true);
  assert.equal(s.downloadPath, '');
  assert.equal(s.downloadAskWhere, false);
  assert.equal(s.downloadShowWhenDone, true);
  assert.equal(s.thirdPartyCookies, 'block-incognito');
  assert.deepEqual(s.sitePermissionDefaults, {
    camera: 'ask',
    microphone: 'ask',
    geolocation: 'ask',
    notifications: 'ask',
    'clipboard-read': 'ask',
    'screen-share': 'ask'
  });
  assert.equal(s.showHomeButton, true);
  assert.equal(s.showTabSearchButton, true);
  assert.equal(s.ctrlTabMru, false);
  assert.equal(s.tabHoverPreview, true);
  assert.equal(s.accessibilityCaretBrowsing, false);
  assert.equal(s.accessibilityFocusHighlight, false);
  assert.equal(s.runBackgroundApps, false);
  assert.equal(s.gpuAcceleration, true);
});

test('Wave2-D search engines: sanitization drops bad entries, keeps Google, default falls back', () => {
  const store = freshStorage();
  const out = store.updateSettings({
    searchEngines: [
      { id: 'wiki', name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search=%s', keyword: 'wiki' },
      { id: 'bad', name: 'Bad', url: 'https://example.com/search?q=test' },
      { id: 'evil', name: 'Evil', url: 'javascript:alert(1)' },
      { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=%s', keyword: '' }
    ],
    searchEngine: 'wiki'
  });
  assert.deepEqual(out.searchEngines.map((e) => e.id), ['wiki', 'google']);
  assert.equal(out.searchEngine, 'wiki');

  // A site-search engine can never be the default.
  const out2 = store.updateSettings({
    searchEngines: [
      { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=%s', keyword: '' },
      { id: 'so', name: 'Stack Overflow', url: 'https://stackoverflow.com/search?q=%s', keyword: 'so', siteSearch: true }
    ],
    searchEngine: 'so'
  });
  assert.equal(out2.searchEngine, 'google');

  // Empty/invalid lists recover the built-in Google entry.
  const out3 = store.updateSettings({ searchEngines: [], searchEngine: 'nope' });
  assert.ok(out3.searchEngines.some((e) => e.id === 'google'));
  assert.equal(out3.searchEngine, 'google');
});

test('Wave2-D startup mode stays in sync with restoreSession', () => {
  const store = freshStorage();
  let s = store.updateSettings({ startupMode: 'urls', startupUrls: ['https://example.com', 'not a url', 'https://example.com'] });
  assert.equal(s.startupMode, 'urls');
  assert.equal(s.restoreSession, false);
  assert.deepEqual(s.startupUrls, ['https://example.com']);

  s = store.updateSettings({ startupMode: 'newtab' });
  assert.equal(s.startupMode, 'newtab');
  assert.equal(s.restoreSession, false);

  // The privacy-dashboard toggle writes restoreSession; it maps back.
  s = store.updateSettings({ restoreSession: true });
  assert.equal(s.startupMode, 'restore');
  assert.equal(s.restoreSession, true);

  // Turning restore off while in 'urls' mode keeps the explicit choice.
  store.updateSettings({ startupMode: 'urls', startupUrls: ['https://example.com'] });
  s = store.updateSettings({ restoreSession: false });
  assert.equal(s.startupMode, 'urls');
  assert.equal(s.restoreSession, false);

  assert.equal(store.updateSettings({ startupMode: 'bogus' }).startupMode, 'restore');
  assert.equal(store.updateSettings({ thirdPartyCookies: 'bogus' }).thirdPartyCookies, 'block-incognito');
  assert.deepEqual(store.updateSettings({ preferredLanguages: ['xx', 'fr-FR'] }).preferredLanguages, ['fr-FR']);
});

test('Wave2-D addresses: add / update / remove / validation', () => {
  const store = freshStorage();
  assert.deepEqual(store.getAddresses(), []);

  const bad = store.addAddress({ fullName: '', addressLine1: '1 Main St' });
  assert.equal(bad.ok, false);

  const added = store.addAddress({
    label: 'Home',
    fullName: 'Test Person',
    addressLine1: '1 Main St',
    city: 'Dhaka',
    postalCode: '1212',
    country: 'Bangladesh'
  });
  assert.equal(added.ok, true);
  assert.equal(added.addresses.length, 1);
  const id = added.addresses[0].id;
  assert.equal(added.addresses[0].city, 'Dhaka');

  const updated = store.updateAddress(id, { city: 'Chattogram' });
  assert.equal(updated.ok, true);
  assert.equal(updated.addresses[0].city, 'Chattogram');

  const removed = store.removeAddress(id);
  assert.deepEqual(removed, []);
  assert.deepEqual(store.clearAddresses(), []);
});

test('Wave2-D payment methods: Luhn validation, brand, masking, encrypted-at-rest shape', () => {
  const store = freshStorage();
  assert.deepEqual(store.getPaymentMethods(), []);

  const bad = store.addPaymentMethod({
    cardholderName: 'Test Person',
    number: '1234 5678 9012 3456',
    expiryMonth: 12,
    expiryYear: 2030
  });
  assert.equal(bad.ok, false);

  const badExp = store.addPaymentMethod({
    cardholderName: 'Test Person',
    number: '4242424242424242',
    expiryMonth: 13,
    expiryYear: 2030
  });
  assert.equal(badExp.ok, false);

  // 4242… is the standard Visa test number (passes Luhn).
  const added = store.addPaymentMethod({
    label: 'Personal',
    cardholderName: 'Test Person',
    number: '4242 4242 4242 4242',
    expiryMonth: 12,
    expiryYear: 2030
  });
  assert.equal(added.ok, true);
  assert.equal(added.paymentMethods.length, 1);
  const masked = added.paymentMethods[0];
  assert.equal(masked.brand, 'Visa');
  assert.equal(masked.last4, '4242');
  assert.equal(masked.number, ''); // UI never receives the full number
  const id = masked.id;

  // The autofill path decodes the full number (mock safeStorage is a no-op).
  const full = store.getPaymentMethodsForAutofill();
  assert.equal(full[0].number, '4242424242424242');

  // Update without a number keeps the stored number.
  const updated = store.updatePaymentMethod(id, { label: 'Work' });
  assert.equal(updated.ok, true);
  assert.equal(store.getPaymentMethodsForAutofill()[0].number, '4242424242424242');
  assert.equal(store.getPaymentMethodsForAutofill()[0].label, 'Work');

  // Amex detection: 378282246310005 passes Luhn.
  store.addPaymentMethod({
    cardholderName: 'Test Person',
    number: '378282246310005',
    expiryMonth: 1,
    expiryYear: 2031
  });
  assert.equal(store.getPaymentMethods().find((c) => c.last4 === '0005').brand, 'Amex');

  const removed = store.removePaymentMethod(id);
  assert.equal(removed.length, 1);
});

test('Wave2-D site permission defaults merge: rapid single-key updates compose', () => {
  const store = freshStorage();
  // The UI sends one permission at a time; a later update must not clobber
  // an earlier one (lost-update race found in live verification).
  store.updateSettings({ sitePermissionDefaults: { microphone: 'block' } });
  store.updateSettings({ sitePermissionDefaults: { camera: 'block' } });
  const defaults = store.getSettings().sitePermissionDefaults;
  assert.equal(defaults.microphone, 'block');
  assert.equal(defaults.camera, 'block');
  assert.equal(defaults.geolocation, 'ask');
  // A full-map write still works (the UI used to send the whole map).
  store.updateSettings({ sitePermissionDefaults: { camera: 'ask', microphone: 'ask', geolocation: 'block', notifications: 'ask', 'clipboard-read': 'ask', 'screen-share': 'ask' } });
  assert.equal(store.getSettings().sitePermissionDefaults.geolocation, 'block');
  assert.equal(store.getSettings().sitePermissionDefaults.camera, 'ask');
});

test('Wave2-D delete browsing data helpers + reset settings', () => {
  const store = freshStorage();
  store.addPassword({ site: 'example.com', username: 'u', password: 'p' });
  assert.equal(store.getPasswords().length, 1);
  assert.deepEqual(store.clearPasswords(), []);
  assert.deepEqual(store.getPasswords(), []);

  store.addAddress({ fullName: 'A B', addressLine1: '1 Road' });
  assert.equal(store.getAddresses().length, 1);
  assert.deepEqual(store.clearAddresses(), []);
  assert.deepEqual(store.getAddresses(), []);

  // clearHistory 'month' clears the last 4 weeks: the recent entry goes,
  // the 40-day-old entry stays (same "clear the range" semantics as hour/day/week).
  store._write('history', [
    { id: 'h-old', title: 'Old', url: 'https://old.example.com', visitedAt: Date.now() - 40 * 24 * 3600 * 1000, visitCount: 1 },
    { id: 'h-new', title: 'New', url: 'https://new.example.com', visitedAt: Date.now(), visitCount: 1 }
  ]);
  const remaining = store.clearHistory('month');
  assert.equal(remaining.filter((h) => h.url.includes('new.example')).length, 0);
  assert.equal(remaining.filter((h) => h.url.includes('old.example')).length, 1);

  store.updateSettings({ theme: 'crimson', searchEngine: 'bing', startupMode: 'urls' });
  const reset = store.resetSettings();
  assert.equal(reset.theme, 'gx-violet');
  assert.equal(reset.searchEngine, 'google');
  assert.equal(reset.startupMode, 'restore');
  // Reset touches settings only — passwords/history survive.
  store.addPassword({ site: 'example.com', username: 'u', password: 'p' });
  store.resetSettings();
  assert.equal(store.getPasswords().length, 1);
});
