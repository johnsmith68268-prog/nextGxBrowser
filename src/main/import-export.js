const { dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { windowContexts, state } = require('./core');
const { DEFAULT_PROFILE_ID, VALID_PROFILE_COLORS } = require('../storage');
const {
  getCtxFromSender,
  broadcastState,
  broadcastBookmarksUpdate,
  broadcastSettingsUpdate,
  broadcastAdblockUpdate,
  broadcastPasswordsUpdate,
  syncAdblockCosmeticFilters
} = require('./broadcast');
const { resolveSafeWallpaperPath, deleteWallpaperFileBestEffort } = require('./wallpapers');
const { updateActiveViewBounds } = require('./layout');
const { clampSidebarWidth, syncSidebarLayoutLeft, broadcastSidebarState } = require('./sidebar');
const { broadcastSystemStatsNow } = require('./stats');
const gxControl = require('./gxcontrol');
const { sleepTab } = require('./tabs');

const MAX_BOOKMARKS_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_SETTINGS_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_PASSWORDS_IMPORT_BYTES = 5 * 1024 * 1024;
const VALID_SEARCH_ENGINES = new Set(['google', 'duckduckgo', 'bing', 'brave', 'ecosia']);
const VALID_THEMES = new Set(VALID_PROFILE_COLORS);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// ---------------------------------------------------------------------------
// 1. Bookmarks HTML (Netscape Bookmark File Format)
// ---------------------------------------------------------------------------

function escapeHtmlAttr(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function decodeHtmlEntities(str) {
  if (typeof str !== 'string' || !str) return '';
  return str.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos|#39|nbsp);/gi, (match, ent) => {
    const lower = ent.toLowerCase();
    if (lower === 'amp') return '&';
    if (lower === 'lt') return '<';
    if (lower === 'gt') return '>';
    if (lower === 'quot') return '"';
    if (lower === 'apos' || lower === '#39') return "'";
    if (lower === 'nbsp') return ' ';
    if (lower.startsWith('#x')) {
      const code = parseInt(lower.slice(2), 16);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch (_) {
          return match;
        }
      }
      return match;
    }
    if (lower.startsWith('#')) {
      const code = parseInt(lower.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch (_) {
          return match;
        }
      }
      return match;
    }
    return match;
  });
}

function serializeBookmarksHtml(bookmarks = []) {
  const list = Array.isArray(bookmarks) ? bookmarks : [];
  const rootItems = [];
  const folderMap = new Map();

  for (const bm of list) {
    if (!bm || typeof bm.url !== 'string' || !bm.url.trim()) continue;
    const folder = typeof bm.folder === 'string' ? bm.folder.trim() : '';
    if (!folder) {
      rootItems.push(bm);
    } else {
      if (!folderMap.has(folder)) folderMap.set(folder, []);
      folderMap.get(folder).push(bm);
    }
  }

  const lines = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file.',
    '     It will be read and overwritten.',
    '     DO NOT EDIT! -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>'
  ];

  const formatLink = (bm, indent) => {
    const addDate =
      typeof bm.createdAt === 'number' && Number.isFinite(bm.createdAt) && bm.createdAt > 0
        ? Math.floor(bm.createdAt / 1000)
        : Math.floor(Date.now() / 1000);
    const attrs = [`HREF="${escapeHtmlAttr(bm.url)}"`, `ADD_DATE="${addDate}"`];
    if (typeof bm.favicon === 'string' && /^data:image\//i.test(bm.favicon.trim())) {
      attrs.push(`ICON="${escapeHtmlAttr(bm.favicon.trim())}"`);
    }
    const title = escapeHtmlAttr(bm.title || bm.url);
    return `${indent}<DT><A ${attrs.join(' ')}>${title}</A>`;
  };

  for (const bm of rootItems) {
    lines.push(formatLink(bm, '    '));
  }

  const nowSec = Math.floor(Date.now() / 1000);
  for (const [folderName, items] of folderMap.entries()) {
    lines.push(`    <DT><H3 ADD_DATE="${nowSec}" LAST_MODIFIED="${nowSec}">${escapeHtmlAttr(folderName)}</H3>`);
    lines.push('    <DL><p>');
    for (const bm of items) {
      lines.push(formatLink(bm, '        '));
    }
    lines.push('    </DL><p>');
  }

  lines.push('</DL><p>');
  lines.push('');
  return lines.join('\n');
}

function extractHtmlAttribute(attrString, attrName) {
  if (!attrString || !attrName) return '';
  const re = new RegExp(`\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = attrString.match(re);
  if (!m) return '';
  return decodeHtmlEntities(m[1] ?? m[2] ?? m[3] ?? '');
}

function parseBookmarksHtml(html) {
  if (typeof html !== 'string' || !html.trim()) return [];
  const results = [];
  const folderStack = [];
  let pendingFolder = null;

  // Tokenize relevant Netscape bookmark tags in document order: <DL>, </DL>, <H3>...</H3>, <A ...>...</A>
  const tokenRe =
    /<(\/?)dl\b[^>]*>|<h3\b([^>]*)>([\s\S]*?)<\/h3>|<a\b([^>]*)>([\s\S]*?)<\/a>/gi;

  let match;
  while ((match = tokenRe.exec(html)) !== null) {
    const dlSlash = match[1];
    const h3Attrs = match[2];
    const h3Inner = match[3];
    const aAttrs = match[4];
    const aInner = match[5];

    if (h3Inner !== undefined) {
      const attrs = h3Attrs || '';
      const isToolbarRoot =
        /\bpersonal_toolbar_folder\s*=\s*["']?true["']?/i.test(attrs) ||
        /\bunfiled_bookmarks_folder\s*=\s*["']?true["']?/i.test(attrs);
      const rawName = decodeHtmlEntities(h3Inner.replace(/<[^>]+>/g, '')).trim().replace(/\s+/g, ' ');
      pendingFolder = isToolbarRoot ? '' : rawName;
    } else if (aInner !== undefined) {
      const href = extractHtmlAttribute(aAttrs || '', 'href').trim();
      if (!href) continue;
      const rawTitle = decodeHtmlEntities(aInner.replace(/<[^>]+>/g, '')).trim().replace(/\s+/g, ' ');
      const addDateStr = extractHtmlAttribute(aAttrs || '', 'add_date');
      const addDateNum = Number(addDateStr);
      const createdAt =
        Number.isFinite(addDateNum) && addDateNum > 0
          ? addDateNum > 1e12
            ? Math.round(addDateNum)
            : Math.round(addDateNum * 1000)
          : Date.now();
      const icon = extractHtmlAttribute(aAttrs || '', 'icon') || extractHtmlAttribute(aAttrs || '', 'icon_uri');
      const activeFolders = folderStack.filter((f) => typeof f === 'string' && f.length > 0);
      const folder = activeFolders.length > 0 ? activeFolders.join(' / ').slice(0, 60) : '';

      results.push({
        title: rawTitle || href,
        url: href,
        folder,
        favicon: icon || '',
        createdAt
      });
    } else if (dlSlash === '/') {
      if (folderStack.length > 0) folderStack.pop();
      pendingFolder = null;
    } else {
      // Opening <DL>
      folderStack.push(pendingFolder || '');
      pendingFolder = null;
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// 2. Settings JSON Export / Validation / Import
// ---------------------------------------------------------------------------

function serializeSettingsJson(settingsObj) {
  return JSON.stringify(
    {
      nextGxSettingsVersion: 1,
      exportedAt: new Date().toISOString(),
      settings: settingsObj || {}
    },
    null,
    2
  );
}

function validateSettingsImport(rawParsed, storageInstance) {
  if (!rawParsed || typeof rawParsed !== 'object' || Array.isArray(rawParsed)) {
    return { ok: false, error: 'Settings file must contain a JSON object.' };
  }

  const candidate =
    rawParsed.settings && typeof rawParsed.settings === 'object' && !Array.isArray(rawParsed.settings)
      ? rawParsed.settings
      : rawParsed;

  const defaults = storageInstance.defaults.settings;
  const validated = {};
  const appliedKeys = [];
  const ignoredKeys = [];

  for (const key of Object.keys(candidate)) {
    if (FORBIDDEN_KEYS.has(key)) {
      ignoredKeys.push(key);
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(defaults, key)) {
      ignoredKeys.push(key);
      continue;
    }

    const val = candidate[key];
    const defVal = defaults[key];

    if (key === 'theme') {
      if (typeof val === 'string' && VALID_THEMES.has(val.trim())) {
        validated.theme = val.trim();
        appliedKeys.push(key);
      } else {
        ignoredKeys.push(key);
      }
      continue;
    }

    if (key === 'searchEngine') {
      if (typeof val === 'string') {
        const cleanId = val.trim().toLowerCase();
        const customEngines = Array.isArray(candidate.searchEngines)
          ? candidate.searchEngines
          : storageInstance.getSettings?.().searchEngines || [];
        const hasMatch =
          VALID_SEARCH_ENGINES.has(cleanId) ||
          customEngines.some((e) => e && typeof e.id === 'string' && e.id.toLowerCase() === cleanId && !e.siteSearch);
        if (cleanId && hasMatch) {
          validated.searchEngine = cleanId;
          appliedKeys.push(key);
        } else {
          ignoredKeys.push(key);
        }
      } else {
        ignoredKeys.push(key);
      }
      continue;
    }

    if (key === 'searchEngines') {
      if (Array.isArray(val) && typeof storageInstance._sanitizeSearchEngines === 'function') {
        validated.searchEngines = storageInstance._sanitizeSearchEngines(val);
        appliedKeys.push(key);
      } else {
        ignoredKeys.push(key);
      }
      continue;
    }

    if (key === 'searchShortcutMode') {
      if (val === 'space-or-tab' || val === 'tab') {
        validated.searchShortcutMode = val;
        appliedKeys.push(key);
      } else {
        ignoredKeys.push(key);
      }
      continue;
    }

    if (key === 'startupMode') {
      if (val === 'newtab' || val === 'restore' || val === 'urls') {
        validated.startupMode = val;
        appliedKeys.push(key);
      } else {
        ignoredKeys.push(key);
      }
      continue;
    }

    if (key === 'startupUrls') {
      if (Array.isArray(val) && typeof storageInstance._sanitizeStartupUrls === 'function') {
        validated.startupUrls = storageInstance._sanitizeStartupUrls(val);
        appliedKeys.push(key);
      } else {
        ignoredKeys.push(key);
      }
      continue;
    }

    if (key === 'preferredLanguages') {
      if (Array.isArray(val) && typeof storageInstance._sanitizeLanguages === 'function') {
        validated.preferredLanguages = storageInstance._sanitizeLanguages(val);
        appliedKeys.push(key);
      } else {
        ignoredKeys.push(key);
      }
      continue;
    }

    if (key === 'thirdPartyCookies') {
      if (val === 'allow' || val === 'block-incognito' || val === 'block') {
        validated.thirdPartyCookies = val;
        appliedKeys.push(key);
      } else {
        ignoredKeys.push(key);
      }
      continue;
    }

    if (key === 'sitePermissionDefaults') {
      if (val && typeof val === 'object' && !Array.isArray(val) && typeof storageInstance._sanitizeSitePermissionDefaults === 'function') {
        validated.sitePermissionDefaults = storageInstance._sanitizeSitePermissionDefaults(val);
        appliedKeys.push(key);
      } else {
        ignoredKeys.push(key);
      }
      continue;
    }

    if (key === 'shaderPreset') {
      const VALID_SHADERS = new Set(['none', 'grayscale', 'sepia', 'warm', 'cool', 'high-contrast', 'vignette', 'night']);
      if (typeof val === 'string' && VALID_SHADERS.has(val.trim())) {
        validated.shaderPreset = val.trim();
        appliedKeys.push(key);
      } else {
        ignoredKeys.push(key);
      }
      continue;
    }

    if (key === 'videoEnhancePreset') {
      const VALID_ENHANCE = new Set(['off', 'vivid', 'sharp', 'crisp', 'cinema']);
      if (typeof val === 'string' && VALID_ENHANCE.has(val.trim())) {
        const cleanVal = val.trim();
        validated.videoEnhancePreset = cleanVal === 'crisp' ? 'sharp' : cleanVal;
        appliedKeys.push(key);
      } else {
        ignoredKeys.push(key);
      }
      continue;
    }

    if (key === 'downloadPath') {
      if (typeof val === 'string') {
        const trimmed = val.trim().slice(0, 500);
        let isValidDir = false;
        if (trimmed && path.isAbsolute(trimmed)) {
          try {
            isValidDir = fs.existsSync(trimmed) && fs.statSync(trimmed).isDirectory();
          } catch (_) {
            isValidDir = false;
          }
        }
        if (!trimmed || isValidDir) {
          validated.downloadPath = trimmed;
          appliedKeys.push(key);
        } else {
          ignoredKeys.push(key);
        }
      } else {
        ignoredKeys.push(key);
      }
      continue;
    }

    if (key === 'homepageUrl') {
      if (typeof val === 'string') {
        const hp = storageInstance.validateHomepageUrl(val);
        if (hp.ok) {
          validated.homepageUrl = hp.url;
          appliedKeys.push(key);
        } else {
          ignoredKeys.push(key);
        }
      } else {
        ignoredKeys.push(key);
      }
      continue;
    }

    if (key === 'wallpaper') {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const rawType = typeof val.type === 'string' ? val.type.trim() : '';
        if (rawType === 'preset' || rawType === 'custom' || rawType === 'none') {
          const rawPreset = typeof val.preset === 'string' ? val.preset.trim() : '';
          const cleanPreset = !rawPreset || VALID_THEMES.has(rawPreset) ? rawPreset : '';
          const rawFile = typeof val.file === 'string' ? val.file.trim() : '';
          const sanitized = storageInstance._sanitizeWallpaper({
            type: rawType,
            preset: cleanPreset,
            file: rawFile
          });
          // If importing a custom wallpaper whose file isn't present locally, fall back cleanly to preset
          if (sanitized.type === 'custom') {
            const safePath = resolveSafeWallpaperPath(sanitized.file);
            if (!safePath || !fs.existsSync(safePath)) {
              sanitized.type = 'preset';
              sanitized.file = '';
            }
          }
          validated.wallpaper = sanitized;
          appliedKeys.push(key);
        } else {
          ignoredKeys.push(key);
        }
      } else {
        ignoredKeys.push(key);
      }
      continue;
    }

    if (key === 'sidebarItems') {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const validSidebar = {};
        let foundAny = false;
        for (const sk of Object.keys(val)) {
          if (FORBIDDEN_KEYS.has(sk)) continue;
          if (
            Object.prototype.hasOwnProperty.call(defaults.sidebarItems, sk) &&
            typeof val[sk] === 'boolean'
          ) {
            validSidebar[sk] = val[sk];
            foundAny = true;
          }
        }
        if (foundAny) {
          validated.sidebarItems = validSidebar;
          appliedKeys.push(key);
        } else {
          ignoredKeys.push(key);
        }
      } else {
        ignoredKeys.push(key);
      }
      continue;
    }

    if (typeof defVal === 'boolean') {
      if (typeof val === 'boolean') {
        validated[key] = val;
        appliedKeys.push(key);
      } else {
        ignoredKeys.push(key);
      }
      continue;
    }

    if (typeof defVal === 'number') {
      if (typeof val === 'number' && Number.isFinite(val)) {
        if (key === 'autoSleepMinutes') validated[key] = storageInstance._sanitizeAutoSleepMinutes(val);
        else if (key === 'gxRamLimitMB') validated[key] = storageInstance._sanitizeGxRamLimitMB(val);
        else if (key === 'gxCpuLimitPercent') validated[key] = storageInstance._sanitizeGxCpuLimitPercent(val);
        else if (key === 'gxNetLimitMbps') validated[key] = storageInstance._sanitizeGxNetLimitMbps(val);
        else if (key === 'sidebarPanelWidth') validated[key] = storageInstance._clampSidebarPanelWidth(val);
        else if (key === 'uiSoundsVolume') validated[key] = Math.max(0, Math.min(1, val));
        else if (key === 'totalAdsBlocked') validated[key] = Math.max(0, Math.round(val));
        else if (key === 'ramLimitMB') validated[key] = Math.max(256, Math.min(65536, Math.round(val)));
        else validated[key] = val;
        appliedKeys.push(key);
      } else {
        ignoredKeys.push(key);
      }
      continue;
    }

    if (typeof defVal === 'string') {
      if (typeof val === 'string') {
        validated[key] = val.trim().slice(0, 120);
        appliedKeys.push(key);
      } else {
        ignoredKeys.push(key);
      }
      continue;
    }

    ignoredKeys.push(key);
  }

  if (appliedKeys.length === 0) {
    return {
      ok: false,
      error: 'No valid nextGx settings were found in the selected file.',
      ignoredKeys
    };
  }

  return {
    ok: true,
    validated,
    appliedKeys,
    ignoredKeys
  };
}

// ---------------------------------------------------------------------------
// 3. Passwords CSV Export / Import (RFC 4180)
// ---------------------------------------------------------------------------

function escapeCsvField(val) {
  const s = String(val ?? '');
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function serializePasswordsCsv(passwords = []) {
  const list = Array.isArray(passwords) ? passwords : [];
  const lines = ['url,username,password'];
  for (const pw of list) {
    if (!pw || typeof pw !== 'object') continue;
    const url = pw.site ?? pw.url ?? '';
    const username = pw.username ?? '';
    const password = pw.password ?? '';
    lines.push([escapeCsvField(url), escapeCsvField(username), escapeCsvField(password)].join(','));
  }
  return lines.join('\n') + '\n';
}

function parseCsvRows(text) {
  if (typeof text !== 'string') return [];
  const src = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      if (field.length === 0) {
        inQuotes = true;
      } else {
        field += '"';
      }
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      if (src[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Filter completely blank trailing rows
  return rows.filter((r) => r.some((cell) => cell !== ''));
}

function parsePasswordsCsv(text) {
  const rows = parseCsvRows(text);
  if (rows.length === 0) {
    return { ok: false, error: 'CSV file is empty.' };
  }

  const header = rows[0].map((col) => String(col || '').trim().toLowerCase());
  const urlIdx = header.findIndex((h) => h === 'url' || h === 'site' || h === 'origin' || h === 'website');
  const userIdx = header.findIndex((h) => h === 'username' || h === 'user' || h === 'login' || h === 'email');
  const passIdx = header.findIndex((h) => h === 'password' || h === 'pass');

  if (urlIdx === -1 || userIdx === -1 || passIdx === -1) {
    return {
      ok: false,
      error: 'Invalid CSV header. Expected columns: url,username,password.'
    };
  }

  const entries = [];
  let invalid = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const url = String(r[urlIdx] ?? '').trim();
    const username = String(r[userIdx] ?? '').trim();
    const password = typeof r[passIdx] === 'string' ? r[passIdx] : '';
    if (!url || !username || !password) {
      invalid += 1;
      continue;
    }
    entries.push({ url, username, password });
  }

  return { ok: true, entries, invalid };
}

// ---------------------------------------------------------------------------
// IPC Handlers (Internal UI Only)
// ---------------------------------------------------------------------------

function resolveSenderProfileId(e) {
  const ctx = getCtxFromSender(e?.sender);
  return ctx?.profileId || state.storage.getActiveProfileId() || DEFAULT_PROFILE_ID;
}

function getParentWindow(e) {
  const ctx = getCtxFromSender(e?.sender);
  return ctx?.win && !ctx.win.isDestroyed() ? ctx.win : undefined;
}

function registerImportExportIpcHandlers(handleInternal) {
  // Bookmarks HTML Export
  handleInternal('import-export:bookmarks-export', async (e) => {
    const profileId = resolveSenderProfileId(e);
    const parentWin = getParentWindow(e);
    const bookmarks = state.storage.getBookmarks(profileId);
    const dialogOpts = {
      title: 'Export Bookmarks (Netscape HTML)',
      defaultPath: 'nextgx-bookmarks.html',
      filters: [{ name: 'HTML Files', extensions: ['html', 'htm'] }]
    };
    const res = parentWin
      ? await dialog.showSaveDialog(parentWin, dialogOpts)
      : await dialog.showSaveDialog(dialogOpts);
    if (!res || res.canceled || !res.filePath) {
      return { ok: false, canceled: true };
    }
    try {
      const html = serializeBookmarksHtml(bookmarks);
      fs.writeFileSync(res.filePath, html, 'utf-8');
      return {
        ok: true,
        canceled: false,
        count: bookmarks.length,
        filePath: res.filePath,
        fileName: path.basename(res.filePath)
      };
    } catch (err) {
      return { ok: false, canceled: false, error: `Failed to export bookmarks: ${err.message}` };
    }
  });

  // Bookmarks HTML Import
  handleInternal('import-export:bookmarks-import', async (e) => {
    const profileId = resolveSenderProfileId(e);
    const parentWin = getParentWindow(e);
    const dialogOpts = {
      title: 'Import Bookmarks (Netscape HTML)',
      properties: ['openFile'],
      filters: [{ name: 'HTML Files', extensions: ['html', 'htm'] }]
    };
    const res = parentWin
      ? await dialog.showOpenDialog(parentWin, dialogOpts)
      : await dialog.showOpenDialog(dialogOpts);
    if (!res || res.canceled || !Array.isArray(res.filePaths) || !res.filePaths.length) {
      return { ok: false, canceled: true };
    }
    const filePath = res.filePaths[0];
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_BOOKMARKS_IMPORT_BYTES) {
        return { ok: false, canceled: false, error: 'Bookmarks file is too large (max 10 MB).' };
      }
      const html = fs.readFileSync(filePath, 'utf-8');
      const parsed = parseBookmarksHtml(html);
      const imported = state.storage.importBookmarks(parsed, profileId);
      broadcastBookmarksUpdate(imported.bookmarks, { profileId });
      for (const ctx of windowContexts.values()) {
        if ((ctx.profileId || DEFAULT_PROFILE_ID) === profileId) {
          broadcastState(ctx);
        }
      }
      return {
        ok: true,
        canceled: false,
        added: imported.added,
        skipped: imported.skipped,
        invalid: imported.invalid,
        total: imported.bookmarks.length,
        fileName: path.basename(filePath)
      };
    } catch (err) {
      return { ok: false, canceled: false, error: `Failed to import bookmarks: ${err.message}` };
    }
  });

  // Settings JSON Export
  handleInternal('import-export:settings-export', async (e) => {
    const profileId = resolveSenderProfileId(e);
    const parentWin = getParentWindow(e);
    const settings = state.storage.getSettings(profileId);
    const dialogOpts = {
      title: 'Export Settings (JSON)',
      defaultPath: 'nextgx-settings.json',
      filters: [{ name: 'JSON Files', extensions: ['json'] }]
    };
    const res = parentWin
      ? await dialog.showSaveDialog(parentWin, dialogOpts)
      : await dialog.showSaveDialog(dialogOpts);
    if (!res || res.canceled || !res.filePath) {
      return { ok: false, canceled: true };
    }
    try {
      const jsonText = serializeSettingsJson(settings);
      fs.writeFileSync(res.filePath, jsonText, 'utf-8');
      return {
        ok: true,
        canceled: false,
        filePath: res.filePath,
        fileName: path.basename(res.filePath)
      };
    } catch (err) {
      return { ok: false, canceled: false, error: `Failed to export settings: ${err.message}` };
    }
  });

  // Settings JSON Import
  handleInternal('import-export:settings-import', async (e) => {
    const profileId = resolveSenderProfileId(e);
    const parentWin = getParentWindow(e);
    const dialogOpts = {
      title: 'Import Settings (JSON)',
      properties: ['openFile'],
      filters: [{ name: 'JSON Files', extensions: ['json'] }]
    };
    const res = parentWin
      ? await dialog.showOpenDialog(parentWin, dialogOpts)
      : await dialog.showOpenDialog(dialogOpts);
    if (!res || res.canceled || !Array.isArray(res.filePaths) || !res.filePaths.length) {
      return { ok: false, canceled: true };
    }
    const filePath = res.filePaths[0];
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_SETTINGS_IMPORT_BYTES) {
        return { ok: false, canceled: false, error: 'Settings file is too large (max 2 MB).' };
      }
      const rawText = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
      let parsed;
      try {
        parsed = JSON.parse(rawText);
      } catch (parseErr) {
        return { ok: false, canceled: false, error: `Invalid JSON file: ${parseErr.message}` };
      }

      const check = validateSettingsImport(parsed, state.storage);
      if (!check.ok) {
        return { ok: false, canceled: false, error: check.error };
      }

      const prev = state.storage.getSettings(profileId);
      const updated = state.storage.updateSettings(check.validated, profileId);

      const prevWallpaperFile = prev.wallpaper?.file || '';
      const nextWallpaperFile = updated.wallpaper?.file || '';
      const wallpaperFileChanged =
        Boolean(prevWallpaperFile) &&
        (process.platform === 'win32'
          ? prevWallpaperFile.toLowerCase() !== nextWallpaperFile.toLowerCase()
          : prevWallpaperFile !== nextWallpaperFile);
      if (wallpaperFileChanged) {
        deleteWallpaperFileBestEffort(prevWallpaperFile, 'previous');
      }

      const adblockChanged = Boolean(prev.adblockEnabled) !== Boolean(updated.adblockEnabled);
      const trackerChanged = Boolean(prev.trackerBlockEnabled) !== Boolean(updated.trackerBlockEnabled);
      if (adblockChanged) {
        await syncAdblockCosmeticFilters();
      }
      if (adblockChanged || trackerChanged) {
        broadcastAdblockUpdate(state.adBlocker.getStats());
      }

      const gxControlChanged =
        Boolean(prev.gxRamLimiterEnabled) !== Boolean(updated.gxRamLimiterEnabled) ||
        Number(prev.gxRamLimitMB) !== Number(updated.gxRamLimitMB) ||
        Boolean(prev.gxCpuLimiterEnabled) !== Boolean(updated.gxCpuLimiterEnabled) ||
        Number(prev.gxCpuLimitPercent) !== Number(updated.gxCpuLimitPercent) ||
        Boolean(prev.gxNetLimiterEnabled) !== Boolean(updated.gxNetLimiterEnabled) ||
        Number(prev.gxNetLimitMbps) !== Number(updated.gxNetLimitMbps);
      if (gxControlChanged) {
        await gxControl.onSettingsChanged(updated, { sleepTab });
        broadcastSystemStatsNow();
      }

      try {
        const { applySessionPrivacyAndPrefs } = require('./ipc');
        if (typeof applySessionPrivacyAndPrefs === 'function') {
          for (const ctx of windowContexts.values()) {
            if (ctx?.session && (ctx.profileId || DEFAULT_PROFILE_ID) === profileId) {
              applySessionPrivacyAndPrefs(ctx.session, { incognito: Boolean(ctx.incognito), profileId });
            }
          }
        }
      } catch (_) {}

      broadcastSettingsUpdate(updated, { profileId });
      const panelChanged =
        Object.prototype.hasOwnProperty.call(check.validated, 'sidebarPanelWidth') ||
        Object.prototype.hasOwnProperty.call(check.validated, 'sidebarPanelPinned');
      for (const ctx of windowContexts.values()) {
        const ctxSettings = state.storage.getSettings(ctx.profileId);
        if (panelChanged && ctx.sidebarPanel && (ctx.profileId || DEFAULT_PROFILE_ID) === profileId) {
          ctx.sidebarPanel.width = clampSidebarWidth(ctxSettings.sidebarPanelWidth);
          ctx.sidebarPanel.pinned = Boolean(ctxSettings.sidebarPanelPinned);
          if (ctx.sidebarPanel.open) {
            syncSidebarLayoutLeft(ctx);
          }
          updateActiveViewBounds(ctx);
          broadcastSidebarState(ctx);
        } else {
          broadcastState(ctx);
        }
      }

      return {
        ok: true,
        canceled: false,
        appliedCount: check.appliedKeys.length,
        ignoredCount: check.ignoredKeys.length,
        appliedKeys: check.appliedKeys,
        ignoredKeys: check.ignoredKeys,
        settings: updated,
        fileName: path.basename(filePath)
      };
    } catch (err) {
      return { ok: false, canceled: false, error: `Failed to import settings: ${err.message}` };
    }
  });

  // Passwords CSV Export (plaintext — UI displays clear warning before invoking)
  handleInternal('import-export:passwords-export', async (e) => {
    const profileId = resolveSenderProfileId(e);
    const parentWin = getParentWindow(e);
    const passwords = state.storage.getPasswords(profileId);
    const dialogOpts = {
      title: 'Export Passwords (Plaintext CSV)',
      defaultPath: 'nextgx-passwords.csv',
      filters: [{ name: 'CSV Files', extensions: ['csv'] }]
    };
    const res = parentWin
      ? await dialog.showSaveDialog(parentWin, dialogOpts)
      : await dialog.showSaveDialog(dialogOpts);
    if (!res || res.canceled || !res.filePath) {
      return { ok: false, canceled: true };
    }
    try {
      const csvText = serializePasswordsCsv(passwords);
      const writeOpts = process.platform === 'win32' ? { encoding: 'utf-8' } : { encoding: 'utf-8', mode: 0o600 };
      fs.writeFileSync(res.filePath, csvText, writeOpts);
      return {
        ok: true,
        canceled: false,
        count: passwords.length,
        filePath: res.filePath,
        fileName: path.basename(res.filePath)
      };
    } catch (err) {
      return { ok: false, canceled: false, error: `Failed to export passwords: ${err.message}` };
    }
  });

  // Passwords CSV Import
  handleInternal('import-export:passwords-import', async (e) => {
    const profileId = resolveSenderProfileId(e);
    const parentWin = getParentWindow(e);
    const dialogOpts = {
      title: 'Import Passwords (CSV)',
      properties: ['openFile'],
      filters: [{ name: 'CSV Files', extensions: ['csv'] }]
    };
    const res = parentWin
      ? await dialog.showOpenDialog(parentWin, dialogOpts)
      : await dialog.showOpenDialog(dialogOpts);
    if (!res || res.canceled || !Array.isArray(res.filePaths) || !res.filePaths.length) {
      return { ok: false, canceled: true };
    }
    const filePath = res.filePaths[0];
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_PASSWORDS_IMPORT_BYTES) {
        return { ok: false, canceled: false, error: 'Passwords CSV file is too large (max 5 MB).' };
      }
      const csvText = fs.readFileSync(filePath, 'utf-8');
      const parsed = parsePasswordsCsv(csvText);
      if (!parsed.ok) {
        return { ok: false, canceled: false, error: parsed.error };
      }
      const imported = state.storage.importPasswords(parsed.entries, profileId);
      broadcastPasswordsUpdate({ profileId });
      return {
        ok: true,
        canceled: false,
        added: imported.added,
        skipped: imported.skipped,
        invalid: parsed.invalid + imported.invalid,
        total: imported.passwords.length,
        fileName: path.basename(filePath)
      };
    } catch (err) {
      return { ok: false, canceled: false, error: `Failed to import passwords: ${err.message}` };
    }
  });
}

module.exports = {
  serializeBookmarksHtml,
  parseBookmarksHtml,
  serializeSettingsJson,
  validateSettingsImport,
  serializePasswordsCsv,
  parseCsvRows,
  parsePasswordsCsv,
  registerImportExportIpcHandlers
};
