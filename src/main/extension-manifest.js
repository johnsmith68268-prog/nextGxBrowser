const fs = require('fs');
const path = require('path');

const MAX_ICON_BYTES = 200 * 1024;

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon'
};

function sanitizeRelativeAssetPath(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const stripped = trimmed.replace(/^(?:\.\/|\/)+/, '').replace(/\\/g, '/');
  if (!stripped) return null;
  const segments = stripped.split('/');
  if (segments.some((seg) => !seg || seg === '.' || seg === '..')) {
    return null;
  }
  return stripped;
}

function resolveExtensionPopup(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return null;
  }
  const rawPopup =
    (manifest.action && typeof manifest.action === 'object' ? manifest.action.default_popup : null) ??
    (manifest.browser_action && typeof manifest.browser_action === 'object'
      ? manifest.browser_action.default_popup
      : null);
  return sanitizeRelativeAssetPath(rawPopup);
}

function collectIconCandidatesFromSpec(spec) {
  if (!spec) return [];
  if (typeof spec === 'string') {
    const clean = sanitizeRelativeAssetPath(spec);
    return clean ? [clean] : [];
  }
  if (typeof spec !== 'object' || Array.isArray(spec)) {
    return [];
  }

  const le48 = [];
  const gt48 = [];
  const other = [];

  for (const [key, val] of Object.entries(spec)) {
    const clean = sanitizeRelativeAssetPath(val);
    if (!clean) continue;
    const size = Number(key);
    if (Number.isFinite(size) && size > 0) {
      if (size <= 48) {
        le48.push({ size, rel: clean });
      } else {
        gt48.push({ size, rel: clean });
      }
    } else {
      other.push(clean);
    }
  }

  // Prefer largest size <= 48, else smallest available > 48
  le48.sort((a, b) => b.size - a.size);
  gt48.sort((a, b) => a.size - b.size);

  return [
    ...le48.map((item) => item.rel),
    ...gt48.map((item) => item.rel),
    ...other
  ];
}

function resolveExtensionIcon(manifest, extPath) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return null;
  }
  if (typeof extPath !== 'string' || !extPath.trim()) {
    return null;
  }

  const baseDir = path.resolve(extPath.trim());
  const candidates = [
    ...collectIconCandidatesFromSpec(manifest.icons),
    ...collectIconCandidatesFromSpec(manifest.action?.default_icon),
    ...collectIconCandidatesFromSpec(manifest.browser_action?.default_icon)
  ];

  const seen = new Set();
  for (const rel of candidates) {
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);

    const absPath = path.resolve(baseDir, rel);
    if (absPath !== baseDir && !absPath.startsWith(baseDir + path.sep)) {
      continue;
    }

    let stat;
    try {
      stat = fs.statSync(absPath);
    } catch (_) {
      continue;
    }

    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_ICON_BYTES) {
      continue;
    }

    const ext = path.extname(absPath).toLowerCase();
    const mime = MIME_BY_EXT[ext];
    if (!mime) continue;

    try {
      const buf = fs.readFileSync(absPath);
      if (!buf || buf.length === 0 || buf.length > MAX_ICON_BYTES) continue;
      const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
      return { path: absPath, dataUrl };
    } catch (_) {
      continue;
    }
  }

  return null;
}

function readManifestFromPath(extPath) {
  if (typeof extPath !== 'string' || !extPath.trim()) return null;
  try {
    const manifestPath = path.join(path.resolve(extPath.trim()), 'manifest.json');
    if (!fs.existsSync(manifestPath)) return null;
    const raw = fs.readFileSync(manifestPath, 'utf-8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  MAX_ICON_BYTES,
  sanitizeRelativeAssetPath,
  resolveExtensionPopup,
  resolveExtensionIcon,
  readManifestFromPath
};
