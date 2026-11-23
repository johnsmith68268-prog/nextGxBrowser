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

const allowedOrigins = new Set();

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

function allowCertException(origin) {
  const norm = normalizeOrigin(origin);
  if (!norm) return '';
  allowedOrigins.add(norm);
  return norm;
}

function isCertExceptionAllowed(origin) {
  const norm = normalizeOrigin(origin);
  if (!norm) return false;
  return allowedOrigins.has(norm);
}

function listCertExceptions() {
  return Array.from(allowedOrigins).sort();
}

function clearCertExceptions() {
  allowedOrigins.clear();
}

module.exports = {
  normalizeOrigin,
  isCertErrorCode,
  allowCertException,
  isCertExceptionAllowed,
  listCertExceptions,
  clearCertExceptions
};
