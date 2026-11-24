// GX Mods — LOCAL packs only. No online store, no network fetch.
//
// A Mod pack is a local folder containing a `mod.json`:
//   {
//     "name": "Neon Nights",          // required
//     "version": "1.0.0",            // optional
//     "theme": "crimson",            // optional, must be a built-in theme id
//     "wallpaper": "wallpaper.jpg",  // optional, image file inside the pack
//     "sounds": "chimes"            // optional, built-in synth preset name only
//   }
//
// Applying a pack sets the theme (and copies its wallpaper, if any, into
// the app's wallpaper store as a custom wallpaper). Sounds: this repo
// ships NO audio files — UI sounds are synthesised with Web Audio
// (src/ui/sounds.js). A pack may name a built-in synth preset, but a pack
// can never ship audio: if a pack folder contains .mp3/.wav/.ogg files
// they are LISTED in the pack status (local files, for a future renderer
// player) and never fetched, executed or auto-played. `soundPackInstalled`
// is therefore false unless the pack actually contains audio files, and
// the settings UI must show "no sound pack installed" otherwise.

const fs = require('fs');
const path = require('path');

const KNOWN_THEMES = ['gx-violet', 'crimson', 'cyan', 'emerald', 'magenta', 'amber', 'lime', 'ice'];
const KNOWN_SYNTH_SOUND_PRESETS = ['clicks', 'chimes', 'blips', 'silent'];
const MOD_JSON_MAX_BYTES = 64 * 1024;
const WALLPAPER_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg']);

function modPackIdForPath(dirPath) {
  const normalized = String(dirPath || '');
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0;
  }
  return `mod-${path.basename(normalized).replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 40) || 'pack'}-${hash
    .toString(36)
    .slice(0, 8)}`;
}

function listPackAudioFiles(dirPath) {
  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (_) {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && AUDIO_EXTS.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort();
}

function readModPack(dirPath) {
  if (typeof dirPath !== 'string' || !dirPath.trim()) {
    return { ok: false, error: 'No pack folder given.' };
  }
  const dir = path.resolve(dirPath.trim());
  let stat = null;
  try {
    stat = fs.statSync(dir);
  } catch (_) {
    return { ok: false, error: 'Pack folder does not exist.' };
  }
  if (!stat.isDirectory()) return { ok: false, error: 'Pack path is not a folder.' };

  const jsonPath = path.join(dir, 'mod.json');
  let raw = null;
  try {
    raw = fs.readFileSync(jsonPath);
  } catch (_) {
    return { ok: false, error: 'mod.json not found in pack folder.' };
  }
  if (raw.length > MOD_JSON_MAX_BYTES) {
    return { ok: false, error: 'mod.json is too large.' };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch (_) {
    return { ok: false, error: 'mod.json is not valid JSON.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'mod.json must contain a JSON object.' };
  }
  const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
  if (!name) return { ok: false, error: 'mod.json needs a "name".' };

  const warnings = [];
  let theme = '';
  if (parsed.theme !== undefined) {
    if (typeof parsed.theme === 'string' && KNOWN_THEMES.includes(parsed.theme)) {
      theme = parsed.theme;
    } else {
      warnings.push(`Unknown theme "${String(parsed.theme).slice(0, 40)}" ignored.`);
    }
  }
  let wallpaper = '';
  if (parsed.wallpaper !== undefined) {
    if (typeof parsed.wallpaper === 'string' && parsed.wallpaper.trim()) {
      const rel = parsed.wallpaper.trim();
      if (rel.includes('..') || path.isAbsolute(rel)) {
        warnings.push('Wallpaper path must be a file inside the pack folder; ignored.');
      } else {
        const full = path.resolve(dir, rel);
        if (!full.startsWith(dir + path.sep)) {
          warnings.push('Wallpaper path escapes the pack folder; ignored.');
        } else if (!WALLPAPER_EXTS.has(path.extname(rel).toLowerCase())) {
          warnings.push('Wallpaper must be a .png/.jpg/.webp/.gif file; ignored.');
        } else {
          try {
            if (fs.statSync(full).isFile()) wallpaper = rel;
            else warnings.push('Wallpaper file does not exist; ignored.');
          } catch (_) {
            warnings.push('Wallpaper file does not exist; ignored.');
          }
        }
      }
    } else {
      warnings.push('Wallpaper must be a file name; ignored.');
    }
  }
  let sounds = '';
  if (parsed.sounds !== undefined) {
    if (typeof parsed.sounds === 'string' && KNOWN_SYNTH_SOUND_PRESETS.includes(parsed.sounds)) {
      sounds = parsed.sounds;
    } else {
      warnings.push(
        'Sounds must name a built-in synth preset (clicks/chimes/blips/silent); audio files are never fetched. Ignored.'
      );
    }
  }

  const audioFiles = listPackAudioFiles(dir);
  const pack = {
    id: modPackIdForPath(dir),
    name: name.slice(0, 80),
    version: typeof parsed.version === 'string' ? parsed.version.trim().slice(0, 20) : '',
    path: dir,
    theme,
    wallpaper,
    sounds,
    audioFiles,
    soundPackInstalled: audioFiles.length > 0,
    warnings
  };
  return { ok: true, pack };
}

function sanitizeModRegistry(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw.slice(0, 50)) {
    if (!item || typeof item !== 'object') continue;
    const p = typeof item.path === 'string' ? item.path : '';
    const name = typeof item.name === 'string' ? item.name.trim().slice(0, 80) : '';
    if (!p || !name) continue;
    const id = typeof item.id === 'string' && item.id ? item.id.slice(0, 80) : modPackIdForPath(p);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name,
      version: typeof item.version === 'string' ? item.version.slice(0, 20) : '',
      path: p,
      theme: typeof item.theme === 'string' && KNOWN_THEMES.includes(item.theme) ? item.theme : '',
      wallpaper: typeof item.wallpaper === 'string' ? item.wallpaper.slice(0, 200) : '',
      sounds:
        typeof item.sounds === 'string' && KNOWN_SYNTH_SOUND_PRESETS.includes(item.sounds)
          ? item.sounds
          : '',
      audioFiles: Array.isArray(item.audioFiles)
        ? item.audioFiles.filter((f) => typeof f === 'string').slice(0, 20)
        : [],
      soundPackInstalled: Boolean(item.soundPackInstalled)
    });
  }
  return out;
}

// Copy a pack's wallpaper into the app wallpaper store and return the
// stored file name (or '' when there is nothing to copy). The copy keeps
// everything local: the pack folder is never referenced at runtime.
function installPackWallpaper(pack) {
  if (!pack || !pack.wallpaper || !pack.path) return '';
  const { resolveSafeWallpaperPath } = require('./wallpapers');
  const base = path.basename(pack.wallpaper);
  const storedName = `gxmod-${pack.id.slice(0, 32)}-${base}`.slice(0, 120);
  const target = resolveSafeWallpaperPath(storedName);
  if (!target) return '';
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.resolve(pack.path, pack.wallpaper), target);
    return storedName;
  } catch (_) {
    return '';
  }
}

// Settings patch for applying a pack. Never touches the network.
function buildModSettingsPatch(pack) {
  if (!pack || typeof pack !== 'object') return { patch: {}, warnings: ['No pack given.'] };
  const patch = {};
  const warnings = Array.isArray(pack.warnings) ? [...pack.warnings] : [];
  if (pack.theme) patch.theme = pack.theme;
  if (pack.wallpaper) {
    const stored = installPackWallpaper(pack);
    if (stored) {
      patch.wallpaper = { type: 'custom', preset: '', file: stored };
    } else {
      warnings.push('Pack wallpaper could not be installed; theme applied without it.');
    }
  }
  if (pack.sounds) {
    // Recorded on the pack, not applied: UI sounds are the built-in Web
    // Audio synth (src/ui/sounds.js) and there is no per-pack sound engine.
    warnings.push(`Pack sound preset "${pack.sounds}" noted; UI sounds stay on the built-in synth.`);
  }
  return { patch, warnings };
}

function getModStatus(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const packs = sanitizeModRegistry(s.gxModPacks);
  const activeId = typeof s.activeGxModId === 'string' ? s.activeGxModId : '';
  const active = packs.find((p) => p.id === activeId) || null;
  return {
    packs,
    activeId: active ? active.id : '',
    active,
    // Honest audio state: true only when the active pack folder actually
    // contains local audio files. This repo ships no audio files.
    soundPackInstalled: Boolean(active && active.soundPackInstalled),
    audioFiles: active ? active.audioFiles : [],
    keyboardSoundsEnabled: Boolean(s.keyboardSoundsEnabled),
    backgroundMusicEnabled: Boolean(s.backgroundMusicEnabled),
    note: 'Local packs only — no online Mods store. No sound pack is installed unless the active pack folder contains audio files.'
  };
}

module.exports = {
  KNOWN_THEMES,
  KNOWN_SYNTH_SOUND_PRESETS,
  modPackIdForPath,
  listPackAudioFiles,
  readModPack,
  sanitizeModRegistry,
  installPackWallpaper,
  buildModSettingsPatch,
  getModStatus
};
