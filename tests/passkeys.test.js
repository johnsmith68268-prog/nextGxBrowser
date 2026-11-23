const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');

// ---------------------------------------------------------------------------
// Electron mock (same pattern as tests/new-modules.test.js). safeStorage is
// deliberately UNAVAILABLE here, matching this VM, so the store falls back
// to unencrypted private keys and the tests assert that fallback is visible.
// ---------------------------------------------------------------------------
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nextgx-passkeys-test-'));
const userDataDir = path.join(tmpRoot, 'userData');
fs.mkdirSync(userDataDir, { recursive: true });

const mockElectron = {
  app: { getPath: () => userDataDir, getVersion: () => '3.0.0' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s) => Buffer.from(s, 'utf8'),
    decryptString: (b) => b.toString('utf8')
  },
  BrowserWindow: function () {},
  ipcMain: { handle: () => {}, on: () => {} }
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return mockElectron;
  return origLoad.apply(this, arguments);
};

const {
  PasskeyStore,
  b64urlEncode,
  b64urlDecode,
  cborEncode,
  validateRpId,
  createKeyPair,
  buildCosePublicKey,
  buildAuthenticatorData,
  buildAttestedCredentialData,
  buildAttestationObject,
  buildClientData,
  signWithPrivateKey,
  verifySignature,
  isEncryptionAvailable
} = require('../src/main/passkeys');

test.after(() => {
  Module._load = origLoad;
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (_) {}
});

// Minimal CBOR decoder (definite lengths only) for verifying encoder output.
function cborDecode(buf, offset = 0) {
  const initial = buf[offset];
  const major = initial >> 5;
  const ai = initial & 0x1f;
  let pos = offset + 1;
  let n;
  if (ai < 24) n = ai;
  else if (ai === 24) { n = buf[pos]; pos += 1; }
  else if (ai === 25) { n = buf.readUInt16BE(pos); pos += 2; }
  else if (ai === 26) { n = buf.readUInt32BE(pos); pos += 4; }
  else if (ai === 27) { n = Number(buf.readBigUInt64BE(pos)); pos += 8; }
  else throw new Error(`unsupported additional info ${ai}`);
  if (major === 0) return { value: n, next: pos };
  if (major === 1) return { value: -1 - n, next: pos };
  if (major === 2) return { value: buf.subarray(pos, pos + n), next: pos + n };
  if (major === 3) return { value: buf.toString('utf8', pos, pos + n), next: pos + n };
  if (major === 4) {
    const arr = [];
    for (let i = 0; i < n; i++) {
      const item = cborDecode(buf, pos);
      arr.push(item.value);
      pos = item.next;
    }
    return { value: arr, next: pos };
  }
  if (major === 5) {
    const map = new Map();
    for (let i = 0; i < n; i++) {
      const k = cborDecode(buf, pos);
      const v = cborDecode(buf, k.next);
      map.set(k.value, v.value);
      pos = v.next;
    }
    return { value: map, next: pos };
  }
  if (major === 7) {
    if (ai === 20) return { value: false, next: pos };
    if (ai === 21) return { value: true, next: pos };
    if (ai === 22) return { value: null, next: pos };
  }
  throw new Error(`unsupported major type ${major}`);
}

test('b64url helpers round-trip binary data', () => {
  const bytes = crypto.randomBytes(32);
  assert.equal(b64urlDecode(b64urlEncode(bytes)).toString('hex'), bytes.toString('hex'));
  assert.equal(b64urlEncode(Buffer.from([0xfb, 0xff, 0xfe])), '-__-');
  assert.equal(b64urlDecode('not!valid'), null);
});

test('safeStorage reports unavailable under the mock (VM caveat)', () => {
  assert.equal(isEncryptionAvailable(), false);
});

test('validateRpId: localhost allowed, IP literals rejected, suffix rule', () => {
  assert.deepEqual(validateRpId('localhost', undefined), { ok: true, rpId: 'localhost' });
  assert.deepEqual(validateRpId('localhost', 'localhost'), { ok: true, rpId: 'localhost' });
  assert.deepEqual(validateRpId('login.example.com', 'example.com'), { ok: true, rpId: 'example.com' });
  assert.equal(validateRpId('127.0.0.1', '127.0.0.1').ok, false);
  assert.equal(validateRpId('127.0.0.1', '127.0.0.1').name, 'SecurityError');
  assert.equal(validateRpId('example.com', 'other.com').ok, false);
  assert.equal(validateRpId('example.com', 'com').ok, false); // 'com' is not a registrable suffix match here (host must equal or be subdomain; 'com' has no dot and is not localhost)
  assert.equal(validateRpId('example.com', '').ok, true); // empty rp.id defaults to the host
});

test('COSE public key encodes as a valid CBOR map', () => {
  const { publicJwk } = createKeyPair();
  const cose = buildCosePublicKey(publicJwk);
  const { value, next } = cborDecode(cose);
  assert.equal(next, cose.length);
  assert.equal(value.get(1), 2); // kty EC2
  assert.equal(value.get(3), -7); // alg ES256
  assert.equal(value.get(-1), 1); // crv P-256
  assert.equal(value.get(-2).length, 32);
  assert.equal(value.get(-3).length, 32);
  assert.equal(Buffer.compare(value.get(-2), b64urlDecode(publicJwk.x)), 0);
});

test('attestation object (fmt none) decodes with correct authData', () => {
  const { publicJwk } = createKeyPair();
  const rawId = crypto.randomBytes(16);
  const cose = buildCosePublicKey(publicJwk);
  const attested = buildAttestedCredentialData(rawId, cose);
  const authData = buildAuthenticatorData('localhost', { counter: 0, attested });
  assert.equal(authData.length, 37 + attested.length);
  assert.equal(authData[32] & 0x01, 1); // UP
  assert.equal(authData[32] & 0x40, 0x40); // AT
  assert.equal(authData[32] & 0x04, 0); // UV never set
  assert.equal(authData.readUInt32BE(33), 0);
  const attObj = buildAttestationObject(authData);
  const { value } = cborDecode(attObj);
  assert.equal(value.get('fmt'), 'none');
  assert.equal(value.get('attStmt').size, 0);
  assert.equal(Buffer.compare(value.get('authData'), authData), 0);
});

test('assertion signing verifies with the public key and fails when tampered', () => {
  const { publicJwk, privateD } = createKeyPair();
  const authData = buildAuthenticatorData('localhost', { counter: 7 });
  const clientDataJSON = buildClientData('webauthn.get', b64urlEncode(crypto.randomBytes(32)), 'http://localhost:8931');
  const clientDataHash = crypto.createHash('sha256').update(clientDataJSON).digest();
  const signed = Buffer.concat([authData, clientDataHash]);
  const sig = signWithPrivateKey(privateD, publicJwk, signed);
  assert.equal(sig.length, 64);
  assert.equal(verifySignature(publicJwk, signed, sig), true);
  const tampered = Buffer.from(signed);
  tampered[tampered.length - 1] ^= 1;
  assert.equal(verifySignature(publicJwk, tampered, sig), false);
  const parsed = JSON.parse(clientDataJSON.toString('utf8'));
  assert.equal(parsed.type, 'webauthn.get');
  assert.equal(parsed.origin, 'http://localhost:8931');
  assert.equal(parsed.crossOrigin, false);
});

test('PasskeyStore: add/list/remove, public listing hides private keys', () => {
  const profileDir = path.join(tmpRoot, 'profile-default');
  fs.mkdirSync(profileDir, { recursive: true });
  const fakeStorage = { dataDir: profileDir, _targetFor: () => fakeStorage };
  const store = new PasskeyStore(() => fakeStorage);
  const rec = {
    id: b64urlEncode(crypto.randomBytes(16)),
    rpId: 'localhost',
    rpName: 'Test RP',
    username: 'test@example.com',
    displayName: 'Test User',
    userId: b64urlEncode(Buffer.from([1, 2, 3, 4])),
    createdAt: Date.now(),
    lastUsedAt: null,
    counter: 0,
    publicKey: createKeyPair().publicJwk,
    privateKey: { plain: 'secret-d-value', encrypted: false },
    transports: ['internal']
  };
  store.add('default', rec);
  assert.ok(fs.existsSync(path.join(profileDir, 'passkeys.json')));
  const listed = store.listPublic('default');
  assert.equal(listed.length, 1);
  assert.equal(listed[0].rpId, 'localhost');
  assert.equal(listed[0].username, 'test@example.com');
  assert.equal(listed[0].privateKey, undefined);
  assert.equal(listed[0].publicKey, undefined);
  assert.equal(store.findForRp('default', 'localhost').length, 1);
  assert.equal(store.findForRp('default', 'example.com').length, 0);
  const afterDelete = store.remove('default', rec.id);
  assert.equal(afterDelete.length, 0);
  assert.equal(store.findById('default', rec.id), null);
});
