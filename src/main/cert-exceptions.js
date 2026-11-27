// Per-origin certificate exceptions granted explicitly by the user from
// the "Connection Not Private" error page ("Proceed anyway").
//
// Safety rules (do not weaken):
// - In-memory ONLY, for this app run. Exceptions are never written to
//   disk, never survive a restart, and are cleared on quit. A user who
//   proceeds once does not silently trust that origin forever.
// - One origin at a time, https only, exact origin match (scheme +
//   host + port). No wildcards, no suffix matching.
// - Nothing is trusted by default: the app-level `certificate-error`
//   handler in src/main.js denies every cert error unless the origin is
//   in this set AND the user just clicked through. The error page still
//   shows the full warning first; there is no silent bypass anywhere.
// - Intended for exactly the case the run report found: a corporate /
//   MITM proxy whose CA is not in the OS store (ERR_CERT_AUTHORITY_INVALID
//   on every HTTPS site). On a normal network this path never triggers.

const allowedExceptions = new Map(); // `${sessionKey}|${origin}` -> Set<fingerprintOrWildcard>
const observedCertErrors = new Map(); // `${sessionKey}|${origin}` -> fingerprint

function normalizeOrigin(raw) {
  if (!raw || typeof raw !== 'string') return '';
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:') return '';
    return u.origin.toLowerCase();
  } catch (_) {
    return '';
  }
}

function isCertErrorCode(code, description) {
  const desc = String(description || '').toUpperCase();
  if (desc.startsWith('ERR_CERT_')) return true;
  const n = Number(code);
  // Chromium net cert errors live in -200..-219 (e.g. -201 AUTHORITY_INVALID).
  return Number.isFinite(n) && n <= -200 && n >= -219;
}

function normalizeScopeKey(sessionKey) {
  return typeof sessionKey === 'string' && sessionKey.trim() ? sessionKey.trim() : 'global';
}

function recordObservedCertError(origin, { sessionKey = 'global', fingerprint = '' } = {}) {
  const norm = normalizeOrigin(origin);
  if (!norm) return;
  const scope = normalizeScopeKey(sessionKey);
  const fp = typeof fingerprint === 'string' && fingerprint.trim() ? fingerprint.trim() : '*';
  observedCertErrors.set(`${scope}|${norm}`, fp);
}

function getObservedCertFingerprint(origin, sessionKey = 'global') {
  const norm = normalizeOrigin(origin);
  if (!norm) return '';
  const scope = normalizeScopeKey(sessionKey);
  return observedCertErrors.get(`${scope}|${norm}`) || '';
}

function allowCertException(origin, opts = {}) {
  const norm = normalizeOrigin(origin);
  if (!norm) return '';
  const scope = normalizeScopeKey(opts?.sessionKey);
  const fp =
    (typeof opts?.fingerprint === 'string' && opts.fingerprint.trim()) ||
    getObservedCertFingerprint(norm, scope) ||
    '*';
  const mapKey = `${scope}|${norm}`;
  let set = allowedExceptions.get(mapKey);
  if (!set) {
    set = new Set();
    allowedExceptions.set(mapKey, set);
  }
  set.add(fp);
  return norm;
}

function isCertExceptionAllowed(origin, opts = {}) {
  const norm = normalizeOrigin(origin);
  if (!norm) return false;
  const fp = typeof opts?.fingerprint === 'string' && opts.fingerprint.trim() ? opts.fingerprint.trim() : '';
  const checkScope = (scope) => {
    const set = allowedExceptions.get(`${scope}|${norm}`);
    if (!set || set.size === 0) return false;
    if (set.has('*') || !fp) return true;
    return set.has(fp);
  };
  if (opts && typeof opts.sessionKey === 'string' && opts.sessionKey.trim()) {
    if (checkScope(opts.sessionKey.trim())) return true;
  }
  return checkScope('global');
}

function listCertExceptions(sessionKey = null) {
  const origins = new Set();
  for (const key of allowedExceptions.keys()) {
    const sep = key.indexOf('|');
    if (sep === -1) continue;
    const scope = key.slice(0, sep);
    const origin = key.slice(sep + 1);
    if (!sessionKey || scope === sessionKey || scope === 'global') {
      origins.add(origin);
    }
  }
  return Array.from(origins).sort();
}

function clearCertExceptions(sessionKey = null) {
  if (!sessionKey) {
    allowedExceptions.clear();
    observedCertErrors.clear();
    return;
  }
  const prefix = `${sessionKey}|`;
  for (const key of Array.from(allowedExceptions.keys())) {
    if (key.startsWith(prefix)) allowedExceptions.delete(key);
  }
  for (const key of Array.from(observedCertErrors.keys())) {
    if (key.startsWith(prefix)) observedCertErrors.delete(key);
  }
}

module.exports = {
  normalizeOrigin,
  isCertErrorCode,
  recordObservedCertError,
  getObservedCertFingerprint,
  allowCertException,
  isCertExceptionAllowed,
  listCertExceptions,
  clearCertExceptions
};
