/**
 * nextGxBrowser — software passkey authenticator (WebAuthn, gap 4.1–4.3).
 *
 * Electron ships no authenticator UI/backend (no platform authenticator, no
 * security-key prompt, no Windows Hello bridge), so nextGxBrowser implements
 * a SOFTWARE authenticator: the tab preload overrides navigator.credentials
 * in the page's main world and marshals ceremonies to this module over IPC.
 * All key material and crypto live in the main process; pages never see a
 * private key.
 *
 * Honest limits (see also chrome-parity-log-passkeys.md):
 *  - Attestation format is always "none" (zero AAGUID). RPs that require
 *    attestation will reject the credential; most accept "none".
 *  - User verification is NOT performed: the dialog's Continue button is
 *    user presence only (UV flag = 0). Ceremonies requesting
 *    userVerification "required" fail with NotAllowedError rather than lying.
 *  - Only ES256 (-7) is supported; only "public-key" credentials.
 *  - Private keys are encrypted with safeStorage when available; when it is
 *    not (e.g. this VM), they are stored unencrypted in the profile's
 *    passkeys.json and the management UI warns about it (same caveat as
 *    saved passwords).
 *  - Google-account sync (gap 4.4) is NOT FEASIBLE and is not attempted.
 *  - Windows Hello / platform authenticators are not available to Electron;
 *    this software authenticator IS the Windows story too.
 */
const { BrowserWindow, ipcMain, safeStorage } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { windowContexts, webContentsToWinId } = require('./core');

const PASSKEY_DIALOG_FILE = path.join(__dirname, '..', 'ui', 'passkey-dialog.html');
const PASSKEY_DIALOG_PRELOAD = path.join(__dirname, '..', 'passkey-dialog-preload.js');
const PASSKEY_DIALOG_FILE_URL = pathToFileURL(PASSKEY_DIALOG_FILE).href;
const STORE_FILE_NAME = 'passkeys.json';
const STORE_VERSION = 1;
const DEFAULT_CEREMONY_TIMEOUT_MS = 120000;
const MAX_CEREMONY_TIMEOUT_MS = 300000;

// ---------------------------------------------------------------------------
// Base64url helpers
// ---------------------------------------------------------------------------
function b64urlEncode(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlDecode(str) {
  if (typeof str !== 'string' || !/^[A-Za-z0-9_-]*$/.test(str)) return null;
  if (str.length === 0) return Buffer.alloc(0);
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
  try {
    return Buffer.from(padded, 'base64');
  } catch (_) {
    return null;
  }
}

function isIpLiteral(host) {
  if (!host || typeof host !== 'string') return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(':'); // IPv6 literal (brackets already stripped by URL)
}

// ---------------------------------------------------------------------------
// Minimal deterministic CBOR encoder (enough for attestation objects +
// COSE public keys). Values: int, Buffer/Uint8Array, string, Array,
// Map/plain-object (int or string keys), boolean, null.
// ---------------------------------------------------------------------------
function cborEncode(value) {
  const chunks = [];
  const push = (b) => chunks.push(Buffer.isBuffer(b) ? b : Buffer.from(b));

  function encodeHead(major, n) {
    const mt = major << 5;
    if (n < 24) {
      push([mt | n]);
    } else if (n < 256) {
      push([mt | 24, n]);
    } else if (n < 65536) {
      const b = Buffer.alloc(3);
      b[0] = mt | 25;
      b.writeUInt16BE(n, 1);
      push(b);
    } else if (n < 4294967296) {
      const b = Buffer.alloc(5);
      b[0] = mt | 26;
      b.writeUInt32BE(n, 1);
      push(b);
    } else {
      const b = Buffer.alloc(9);
      b[0] = mt | 27;
      b.writeBigUInt64BE(BigInt(n), 1);
      push(b);
    }
  }

  function encode(val) {
    if (val === null || val === undefined) {
      push([0xf6]);
    } else if (typeof val === 'boolean') {
      push([val ? 0xf5 : 0xf4]);
    } else if (typeof val === 'number' && Number.isInteger(val)) {
      if (val >= 0) encodeHead(0, val);
      else encodeHead(1, -1 - val);
    } else if (Buffer.isBuffer(val) || val instanceof Uint8Array) {
      const buf = Buffer.from(val);
      encodeHead(2, buf.length);
      push(buf);
    } else if (typeof val === 'string') {
      const buf = Buffer.from(val, 'utf8');
      encodeHead(3, buf.length);
      push(buf);
    } else if (Array.isArray(val)) {
      encodeHead(4, val.length);
      for (const item of val) encode(item);
    } else if (val instanceof Map) {
      const entries = Array.from(val.entries());
      entries.sort((a, b) => {
        const ea = cborEncode(a[0]);
        const eb = cborEncode(b[0]);
        if (ea.length !== eb.length) return ea.length - eb.length;
        return Buffer.compare(ea, eb);
      });
      encodeHead(5, entries.length);
      for (const [k, v] of entries) {
        encode(k);
        encode(v);
      }
    } else if (typeof val === 'object') {
      const entries = Object.entries(val);
      encodeHead(5, entries.length);
      for (const [k, v] of entries) {
        encode(k);
        encode(v);
      }
    } else {
      throw new TypeError(`Cannot CBOR-encode value of type ${typeof val}`);
    }
  }

  encode(value);
  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// RP ID validation (per spec; mirrors Chrome: IP literals rejected, localhost
// allowed, rp.id must be the host or a domain suffix of it).
// Returns { ok: true, rpId } or { ok: false, name, message }.
// ---------------------------------------------------------------------------
function validateRpId(hostname, requestedRpId) {
  const host = typeof hostname === 'string' ? hostname.toLowerCase() : '';
  if (!host) {
    return { ok: false, name: 'SecurityError', message: 'Could not determine the relying party ID.' };
  }
  const rpId = requestedRpId === undefined || requestedRpId === null || requestedRpId === ''
    ? host
    : String(requestedRpId).toLowerCase();
  if (!rpId || rpId.startsWith('.') || rpId.endsWith('.') || rpId.includes('..')) {
    return { ok: false, name: 'SecurityError', message: 'This is an invalid domain' };
  }
  if (isIpLiteral(host) || isIpLiteral(rpId)) {
    return { ok: false, name: 'SecurityError', message: 'This is an invalid domain' };
  }
  if (rpId !== 'localhost' && !rpId.includes('.')) {
    return { ok: false, name: 'SecurityError', message: 'This is an invalid domain' };
  }
  if (host !== rpId && !host.endsWith(`.${rpId}`)) {
    return {
      ok: false,
      name: 'SecurityError',
      message: `The relying party ID "${rpId}" is not a valid domain for this site.`
    };
  }
  return { ok: true, rpId };
}

// ---------------------------------------------------------------------------
// Crypto: ES256 (P-256) keypairs, COSE keys, authenticator data, signing
// ---------------------------------------------------------------------------
function createKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pubJwk = publicKey.export({ format: 'jwk' });
  const privJwk = privateKey.export({ format: 'jwk' });
  return {
    publicJwk: { kty: 'EC', crv: 'P-256', x: pubJwk.x, y: pubJwk.y },
    privateD: privJwk.d
  };
}

function buildCosePublicKey(publicJwk) {
  const x = b64urlDecode(publicJwk.x);
  const y = b64urlDecode(publicJwk.y);
  if (!x || x.length !== 32 || !y || y.length !== 32) {
    throw new Error('Invalid P-256 public key.');
  }
  return cborEncode(new Map([[1, 2], [3, -7], [-1, 1], [-2, x], [-3, y]]));
}

const FLAG_UP = 0x01; // user presence
const FLAG_UV = 0x04; // user verification (never set: we do not verify users)
const FLAG_AT = 0x40; // attested credential data present
const FLAG_ED = 0x80; // extension data present (unused)

function buildAuthenticatorData(rpId, { counter = 0, attested = null } = {}) {
  const rpIdHash = crypto.createHash('sha256').update(rpId, 'utf8').digest();
  let flags = FLAG_UP;
  if (attested) flags |= FLAG_AT;
  const header = Buffer.alloc(37);
  rpIdHash.copy(header, 0);
  header[32] = flags;
  header.writeUInt32BE(counter >>> 0, 33);
  return attested ? Buffer.concat([header, attested]) : header;
}

function buildAttestedCredentialData(credentialId, cosePublicKey) {
  const aaguid = Buffer.alloc(16, 0); // attestation "none": zero AAGUID
  const idLen = Buffer.alloc(2);
  idLen.writeUInt16BE(credentialId.length, 0);
  return Buffer.concat([aaguid, idLen, Buffer.from(credentialId), cosePublicKey]);
}

function buildAttestationObject(authenticatorData) {
  return cborEncode(
    new Map([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', authenticatorData]
    ])
  );
}

function buildClientData(type, challengeB64url, origin) {
  const json = JSON.stringify({
    type,
    challenge: challengeB64url,
    origin,
    crossOrigin: false
  });
  return Buffer.from(json, 'utf8');
}

function signWithPrivateKey(privateD, publicJwk, data) {
  const key = crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', x: publicJwk.x, y: publicJwk.y, d: privateD },
    format: 'jwk'
  });
  // NOTE: algorithm must be 'sha256' explicitly (ES256). crypto.sign(null,
  // ...) works on system Node 24 but throws NO_DEFAULT_DIGEST on Electron's
  // bundled Node for EC keys — found live 2026-11-22.
  return crypto.sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' });
}

function verifySignature(publicJwk, data, signature) {
  const key = crypto.createPublicKey({ key: publicJwk, format: 'jwk' });
  return crypto.verify('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature));
}

// ---------------------------------------------------------------------------
// safeStorage helpers (mirrors the password store's approach)
// ---------------------------------------------------------------------------
function isEncryptionAvailable() {
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

function encryptPrivateKey(privateD) {
  if (isEncryptionAvailable()) {
    try {
      return {
        enc: safeStorage.encryptString(JSON.stringify({ d: privateD })).toString('base64'),
        encrypted: true
      };
    } catch (err) {
      console.warn('[Passkeys] Failed to encrypt private key:', err.message);
    }
  }
  return { plain: privateD, encrypted: false };
}

function decryptPrivateKey(record) {
  if (!record) return null;
  if (typeof record.enc === 'string') {
    if (!isEncryptionAvailable()) return null;
    try {
      const parsed = JSON.parse(safeStorage.decryptString(Buffer.from(record.enc, 'base64')));
      return typeof parsed?.d === 'string' ? parsed.d : null;
    } catch (err) {
      console.warn('[Passkeys] Failed to decrypt a stored passkey:', err.message);
      return null;
    }
  }
  return typeof record.plain === 'string' ? record.plain : null;
}

// ---------------------------------------------------------------------------
// Store: one passkeys.json per profile dir (never touches src/storage.js).
// Records keep the private key out of any list/get response.
// ---------------------------------------------------------------------------
class PasskeyStore {
  constructor(getStorage) {
    this._getStorage = getStorage;
    this._cache = new Map(); // profileId -> { file, data }
  }

  _resolveProfileId(profileId) {
    return typeof profileId === 'string' && profileId ? profileId : 'default';
  }

  _profileDir(profileId) {
    const storage = typeof this._getStorage === 'function' ? this._getStorage() : null;
    if (!storage) return null;
    const pid = this._resolveProfileId(profileId);
    try {
      const target =
        typeof storage._targetFor === 'function' ? storage._targetFor(pid) : storage;
      if (target && target.dataDir) return target.dataDir;
    } catch (_) {}
    return storage.dataDir || null;
  }

  _load(profileId) {
    const pid = this._resolveProfileId(profileId);
    const cached = this._cache.get(pid);
    if (cached) return cached;
    const dir = this._profileDir(pid);
    const file = dir ? path.join(dir, STORE_FILE_NAME) : null;
    let data = { version: STORE_VERSION, credentials: [] };
    if (file) {
      try {
        if (fs.existsSync(file)) {
          const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
          if (parsed && Array.isArray(parsed.credentials)) data = parsed;
        }
      } catch (err) {
        console.warn('[Passkeys] Could not read passkey store, starting empty:', err.message);
      }
    }
    const entry = { file, data };
    this._cache.set(pid, entry);
    return entry;
  }

  _save(profileId) {
    const entry = this._load(profileId);
    if (!entry.file) return false;
    try {
      fs.mkdirSync(path.dirname(entry.file), { recursive: true });
      fs.writeFileSync(entry.file, JSON.stringify(entry.data, null, 2), 'utf8');
      return true;
    } catch (err) {
      console.warn('[Passkeys] Could not write passkey store:', err.message);
      return false;
    }
  }

  listPublic(profileId) {
    const { data } = this._load(profileId);
    return data.credentials.map((c) => ({
      id: c.id,
      rpId: c.rpId,
      rpName: c.rpName,
      username: c.username,
      displayName: c.displayName,
      createdAt: c.createdAt,
      lastUsedAt: c.lastUsedAt || null,
      counter: c.counter || 0
    }));
  }

  findById(profileId, credentialIdB64url) {
    const { data } = this._load(profileId);
    return data.credentials.find((c) => c && c.id === credentialIdB64url) || null;
  }

  findForRp(profileId, rpId) {
    const { data } = this._load(profileId);
    return data.credentials.filter((c) => c && c.rpId === rpId);
  }

  add(profileId, record) {
    const entry = this._load(profileId);
    entry.data.credentials.unshift(record);
    this._save(profileId);
    return record;
  }

  touch(profileId, credentialIdB64url, mutator) {
    const entry = this._load(profileId);
    const rec = entry.data.credentials.find((c) => c && c.id === credentialIdB64url);
    if (!rec) return null;
    if (typeof mutator === 'function') mutator(rec);
    this._save(profileId);
    return rec;
  }

  remove(profileId, credentialIdB64url) {
    const entry = this._load(profileId);
    const before = entry.data.credentials.length;
    entry.data.credentials = entry.data.credentials.filter((c) => c && c.id !== credentialIdB64url);
    if (entry.data.credentials.length !== before) this._save(profileId);
    return this.listPublic(profileId);
  }
}

// ---------------------------------------------------------------------------
// Authenticator dialog (modal BrowserWindow; NOT the popover system)
// ---------------------------------------------------------------------------
const pendingDialogs = new Map(); // dialogId -> { request, resolve, win, timer }

function resolveParentWindow(senderWebContents) {
  try {
    const win = BrowserWindow.fromWebContents(senderWebContents);
    if (win && !win.isDestroyed()) return win;
  } catch (_) {}
  try {
    const winId = senderWebContents && webContentsToWinId.get(senderWebContents.id);
    const ctx = winId ? windowContexts.get(winId) : null;
    if (ctx && ctx.win && !ctx.win.isDestroyed()) return ctx.win;
  } catch (_) {}
  for (const ctx of windowContexts.values()) {
    if (ctx && ctx.win && !ctx.win.isDestroyed() && !ctx.incognito) return ctx.win;
  }
  for (const ctx of windowContexts.values()) {
    if (ctx && ctx.win && !ctx.win.isDestroyed()) return ctx.win;
  }
  return null;
}

function showPasskeyDialog(parentWin, request, timeoutMs) {
  return new Promise((resolve) => {
    const dialogId = `pk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fullRequest = { ...request, dialogId };
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      pendingDialogs.delete(dialogId);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try {
        if (win && !win.isDestroyed()) win.close();
      } catch (_) {}
      settle({ action: 'timeout' });
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    const win = new BrowserWindow({
      width: 460,
      height: 600,
      minWidth: 420,
      minHeight: 520,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      modal: Boolean(parentWin),
      parent: parentWin || undefined,
      backgroundColor: '#12101b',
      title: 'nextGx Passkey',
      webPreferences: {
        preload: PASSKEY_DIALOG_PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    pendingDialogs.set(dialogId, { request: fullRequest, resolve: settle, win });
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.show();
    });
    win.on('closed', () => settle({ action: 'cancel' }));
    const fileUrl = `${PASSKEY_DIALOG_FILE_URL}?dialog=${encodeURIComponent(dialogId)}`;
    win.loadURL(fileUrl).catch((err) => {
      console.warn('[Passkeys] Dialog failed to load:', err.message);
      settle({ action: 'cancel' });
    });
  });
}

function isDialogSender(event) {
  try {
    const url = event?.senderFrame?.url || event?.sender?.getURL?.() || '';
    return typeof url === 'string' && url.startsWith(PASSKEY_DIALOG_FILE_URL);
  } catch (_) {
    return false;
  }
}

let dialogIpcRegistered = false;
function registerDialogIpc() {
  if (dialogIpcRegistered) return;
  dialogIpcRegistered = true;
  ipcMain.handle('passkey:dialog-get', (e, dialogId) => {
    if (!isDialogSender(e)) throw new Error('Forbidden IPC channel: passkey:dialog-get');
    const pending = typeof dialogId === 'string' ? pendingDialogs.get(dialogId) : null;
    return pending ? pending.request : null;
  });
  ipcMain.on('passkey:dialog-result', (e, payload) => {
    if (!isDialogSender(e)) return;
    const dialogId = payload && typeof payload.dialogId === 'string' ? payload.dialogId : '';
    const pending = pendingDialogs.get(dialogId);
    if (!pending) return;
    if (payload.action === 'confirm') {
      pending.resolve({
        action: 'confirm',
        selectedCredentialId:
          typeof payload.selectedCredentialId === 'string' ? payload.selectedCredentialId : null
      });
    } else {
      pending.resolve({ action: 'cancel' });
    }
    try {
      if (pending.win && !pending.win.isDestroyed()) pending.win.close();
    } catch (_) {}
  });
}

// ---------------------------------------------------------------------------
// Ceremony handling (called from the tab preload over 'passkey:ceremony')
// ---------------------------------------------------------------------------
function ceremonyError(name, message) {
  return { ok: false, name, message };
}

function parseBinaryField(value, fieldName, { required = true, minLength = 1, maxLength = 1024 } = {}) {
  if (value === undefined || value === null) {
    if (!required) return null;
    throw Object.assign(new Error(`${fieldName} is required.`), { errorName: 'TypeError' });
  }
  const buf = typeof value === 'string' ? b64urlDecode(value) : null;
  if (!buf || buf.length < minLength || buf.length > maxLength) {
    throw Object.assign(new Error(`${fieldName} must be a byte sequence of ${minLength}–${maxLength} bytes.`), {
      errorName: 'TypeError'
    });
  }
  return buf;
}

function isLoopbackHttp(url) {
  const host = (url.hostname || '').toLowerCase();
  return url.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1' || host === '[::1]');
}

async function handleCeremony(event, payload, deps) {
  const { store, getSenderProfileId, getCtxFromSender } = deps;
  try {
    if (!event?.sender || !event?.senderFrame || event.senderFrame !== event.sender.mainFrame) {
      return ceremonyError('SecurityError', 'Passkey ceremonies are only allowed in the top-level frame.');
    }
    const frameUrl = event.senderFrame.url || '';
    let frameParsed;
    try {
      frameParsed = new URL(frameUrl);
    } catch (_) {
      return ceremonyError('SecurityError', 'Could not determine the page origin.');
    }
    const origin = frameParsed.origin;
    if (frameParsed.protocol !== 'https:' && !isLoopbackHttp(frameParsed)) {
      return ceremonyError('SecurityError', 'WebAuthn requires a secure context (https or localhost).');
    }
    if (!payload || typeof payload !== 'object') {
      return ceremonyError('TypeError', 'Missing ceremony request.');
    }
    if (payload.origin !== origin) {
      return ceremonyError('SecurityError', 'Ceremony origin does not match the page origin.');
    }
    const kind = payload.kind;
    if (kind !== 'create' && kind !== 'get') {
      return ceremonyError('TypeError', 'Unknown passkey ceremony kind.');
    }
    const options = payload.options && typeof payload.options === 'object' ? payload.options : {};
    const profileId = getSenderProfileId(event);
    const ctx = getCtxFromSender ? getCtxFromSender(event.sender) : null;
    const incognito = Boolean(ctx?.incognito);

    const challengeBuf = parseBinaryField(options.challenge, 'challenge', { maxLength: 1024 });
    const challengeB64url = b64urlEncode(challengeBuf);
    const rpIdCheck = validateRpId(frameParsed.hostname, options.rpId);
    if (!rpIdCheck.ok) return ceremonyError(rpIdCheck.name, rpIdCheck.message);
    const rpId = rpIdCheck.rpId;
    const userVerification =
      (options.authenticatorSelection && options.authenticatorSelection.userVerification) ||
      options.userVerification ||
      'preferred';
    if (userVerification === 'required') {
      // Honest failure: this authenticator provides user presence only, never
      // PIN/biometric verification. Lying here would break RP security policy.
      return ceremonyError(
        'NotAllowedError',
        'User verification is required, but this authenticator only provides user presence (no PIN or biometrics).'
      );
    }
    const timeoutMs = Math.min(
      Math.max(Number(options.timeout) || DEFAULT_CEREMONY_TIMEOUT_MS, 1000),
      MAX_CEREMONY_TIMEOUT_MS
    );

    if (kind === 'create') {
      if (incognito) {
        return ceremonyError('NotAllowedError', 'Passkeys cannot be created in a private window.');
      }
      const pubKeyCredParams = Array.isArray(options.pubKeyCredParams) ? options.pubKeyCredParams : [];
      if (!pubKeyCredParams.some((p) => p && p.type === 'public-key' && p.alg === -7)) {
        return ceremonyError('NotSupportedError', 'This authenticator only supports ES256 (alg -7).');
      }
      const user = options.user && typeof options.user === 'object' ? options.user : {};
      const userIdBuf = parseBinaryField(user.id, 'user.id', { minLength: 1, maxLength: 64 });
      const username = typeof user.name === 'string' ? user.name.slice(0, 256) : '';
      const displayName = typeof user.displayName === 'string' ? user.displayName.slice(0, 256) : username;
      if (!username) return ceremonyError('TypeError', 'user.name is required.');
      const rpName =
        options.rp && typeof options.rp.name === 'string' && options.rp.name
          ? options.rp.name.slice(0, 256)
          : rpId;

      const excludeList = Array.isArray(options.excludeCredentials) ? options.excludeCredentials : [];
      for (const ex of excludeList) {
        if (ex && ex.type === 'public-key' && typeof ex.id === 'string') {
          if (store.findById(profileId, ex.id)) {
            return ceremonyError('InvalidStateError', 'A passkey for this site already exists on this authenticator.');
          }
        }
      }

      const parentWin = resolveParentWindow(event.sender);
      const dialog = await showPasskeyDialog(
        parentWin,
        {
          mode: 'create',
          rpId,
          rpName,
          origin,
          username,
          displayName,
          candidates: []
        },
        timeoutMs
      );
      if (dialog.action !== 'confirm') {
        return ceremonyError(
          'NotAllowedError',
          dialog.action === 'timeout'
            ? 'The passkey request timed out.'
            : 'The passkey request was cancelled.'
        );
      }

      let rawId = crypto.randomBytes(16);
      while (store.findById(profileId, b64urlEncode(rawId))) rawId = crypto.randomBytes(16);
      const { publicJwk, privateD } = createKeyPair();
      const cosePublicKey = buildCosePublicKey(publicJwk);
      const attested = buildAttestedCredentialData(rawId, cosePublicKey);
      const authenticatorData = buildAuthenticatorData(rpId, { counter: 0, attested });
      const attestationObject = buildAttestationObject(authenticatorData);
      const clientDataJSON = buildClientData('webauthn.create', challengeB64url, origin);
      const keyStorage = encryptPrivateKey(privateD);
      store.add(profileId, {
        id: b64urlEncode(rawId),
        rpId,
        rpName,
        username,
        displayName,
        userId: b64urlEncode(userIdBuf),
        createdAt: Date.now(),
        lastUsedAt: null,
        counter: 0,
        publicKey: publicJwk,
        privateKey: keyStorage,
        transports: ['internal']
      });
      return {
        ok: true,
        id: b64urlEncode(rawId),
        rawId: b64urlEncode(rawId),
        type: 'public-key',
        response: {
          clientDataJSON: b64urlEncode(clientDataJSON),
          attestationObject: b64urlEncode(attestationObject),
          authenticatorData: b64urlEncode(authenticatorData),
          publicKey: b64urlEncode(cosePublicKey),
          publicKeyAlgorithm: -7,
          transports: ['internal']
        }
      };
    }

    // ---- get (assertion) ----
    const allowList = Array.isArray(options.allowCredentials) ? options.allowCredentials : [];
    let candidates;
    if (allowList.length > 0) {
      candidates = [];
      for (const allowed of allowList) {
        if (!allowed || allowed.type !== 'public-key' || typeof allowed.id !== 'string') continue;
        const rec = store.findById(profileId, allowed.id);
        if (rec && rec.rpId === rpId) candidates.push(rec);
      }
    } else {
      candidates = store.findForRp(profileId, rpId); // discoverable credentials
    }
    if (candidates.length === 0) {
      return ceremonyError('NotAllowedError', 'No passkey found for this site on this device.');
    }
    const parentWin = resolveParentWindow(event.sender);
    const dialog = await showPasskeyDialog(
      parentWin,
      {
        mode: 'get',
        rpId,
        rpName: candidates[0].rpName || rpId,
        origin,
        username: candidates[0].username,
        displayName: candidates[0].displayName,
        candidates: candidates.map((c) => ({
          id: c.id,
          username: c.username,
          displayName: c.displayName,
          createdAt: c.createdAt
        }))
      },
      timeoutMs
    );
    if (dialog.action !== 'confirm') {
      return ceremonyError(
        'NotAllowedError',
        dialog.action === 'timeout' ? 'The passkey request timed out.' : 'The passkey request was cancelled.'
      );
    }
    const chosen =
      (dialog.selectedCredentialId && candidates.find((c) => c.id === dialog.selectedCredentialId)) ||
      candidates[0];
    const privateD = decryptPrivateKey(chosen.privateKey);
    if (!privateD) {
      return ceremonyError('NotAllowedError', 'The stored passkey could not be unlocked on this device.');
    }
    const nextCounter = (chosen.counter || 0) + 1;
    store.touch(profileId, chosen.id, (rec) => {
      rec.counter = nextCounter;
      rec.lastUsedAt = Date.now();
    });
    const authenticatorData = buildAuthenticatorData(rpId, { counter: nextCounter });
    const clientDataJSON = buildClientData('webauthn.get', challengeB64url, origin);
    const clientDataHash = crypto.createHash('sha256').update(clientDataJSON).digest();
    const signature = signWithPrivateKey(
      privateD,
      chosen.publicKey,
      Buffer.concat([authenticatorData, clientDataHash])
    );
    return {
      ok: true,
      id: chosen.id,
      rawId: chosen.id,
      type: 'public-key',
      response: {
        clientDataJSON: b64urlEncode(clientDataJSON),
        authenticatorData: b64urlEncode(authenticatorData),
        signature: b64urlEncode(signature),
        userHandle: chosen.userId
      }
    };
  } catch (err) {
    if (err && err.errorName) return ceremonyError(err.errorName, err.message);
    console.warn('[Passkeys] Ceremony failed:', err && err.message ? err.message : err);
    return ceremonyError('NotAllowedError', 'The passkey operation could not be completed.');
  }
}

// ---------------------------------------------------------------------------
// IPC registration (called from src/main/ipc.js)
// ---------------------------------------------------------------------------
function registerPasskeyIpcHandlers({ handleInternal, handleWeb, getSenderProfileId, getCtxFromSender, getStorage }) {
  const store = new PasskeyStore(getStorage);
  registerDialogIpc();

  // Web-page ceremonies: NOT internal-UI gated (pages call these), but the
  // handler enforces top-frame + origin + secure-context + rp.id rules.
  handleWeb('passkey:ceremony', (e, payload) =>
    handleCeremony(e, payload, { store, getSenderProfileId, getCtxFromSender })
  );

  // Management UI (internal webui pages only).
  handleInternal('passkeys:list', (e) => store.listPublic(getSenderProfileId(e)));
  handleInternal('passkeys:delete', (e, id) => {
    const pid = getSenderProfileId(e);
    if (typeof id !== 'string' || !id) return store.listPublic(pid);
    return store.remove(pid, id);
  });
  handleInternal('passkeys:encryption-status', () => ({ available: isEncryptionAvailable() }));
  return store;
}

module.exports = {
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
  isEncryptionAvailable,
  encryptPrivateKey,
  decryptPrivateKey,
  registerPasskeyIpcHandlers
};
