const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const electron = require('electron');
const {
  SRC_DIR,
  CORNER_PRELOAD_FILE,
  windowContexts,
  state
} = require('./core');
const { isCornerUrl } = require('./utils');
const { getCtxFromSender, sendToCornerTabs } = require('./broadcast');
const { createTab } = require('./tabs');

const CURATED_DATA_FILE = path.join(SRC_DIR, 'data', 'gxcorner-curated.json');

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache TTL
const BACKGROUND_REFRESH_MS = 30 * 60 * 1000; // 30-minute background refresh cadence
const PER_FEED_TIMEOUT_MS = 10 * 1000; // 10s per-feed timeout
const OVERALL_REFRESH_TIMEOUT_MS = 15 * 1000; // 15s overall cap across all feeds
const MAX_FEED_BYTES = 2 * 1024 * 1024; // 2 MB cap per feed
const MAX_REDIRECTS = 3;

const MAX_NEWS_ITEMS = 18;
const MAX_RELEASE_ITEMS = 12;
const MAX_DEAL_ITEMS = 12;

const DEFAULT_FEEDS = Object.freeze([
  {
    id: 'pcgamer',
    name: 'PC Gamer',
    url: 'https://www.pcgamer.com/rss/',
    defaultSection: 'news'
  },
  {
    id: 'ign',
    name: 'IGN',
    url: 'https://feeds.feedburner.com/ign/all',
    defaultSection: 'news'
  },
  {
    id: 'eurogamer',
    name: 'Eurogamer',
    url: 'https://www.eurogamer.net/feed',
    defaultSection: 'news'
  },
  {
    id: 'gamesradar',
    name: 'GamesRadar+',
    url: 'https://www.gamesradar.com/rss/',
    defaultSection: 'news'
  },
  {
    id: 'rps',
    name: 'Rock Paper Shotgun',
    url: 'https://www.rockpapershotgun.com/feed',
    defaultSection: 'news'
  }
]);

const DEAL_KEYWORDS_RE =
  /\b(free\s+game|free\s+to\s+keep|free\s+on\s+(epic|steam|gog|prime)|giveaway|deal|deals|discount|discounted|sale|sales|bundle|humble\s+bundle|humble\s+choice|steam\s+sale|epic\s+games\s+store\s+free|prime\s+gaming|%\s*off|cheapest|lowest\s+price|bargain|save\s+\$|save\s+£|save\s+€|promo\s+code|freebie|freebies)\b/i;

const RELEASE_KEYWORDS_RE =
  /\b(release\s+date|releases?\s+(this\s+week|today|soon|tomorrow|next\s+week|in\s+20\d\d)|out\s+now|launches?\s+today|launching\s+(today|this\s+week|soon)|upcoming\s+games?|release\s+calendar|new\s+release|early\s+access\s+launch|coming\s+to\s+(pc|steam|ps5|xbox|switch|game\s+pass)|playable\s+demo|open\s+beta|launch\s+trailer|arrives?\s+on\s+(pc|steam|ps5|xbox|switch))\b/i;

const TRACKER_IMAGE_RE =
  /(feedburner\.com\/~|doubleclick\.net|google-analytics\.com|pixel\.|\/1x1\.|blank\.gif|spacer\.gif)/i;

const registeredPreloadSessions = new WeakSet();
let cachedCuratedData = null;
let activeRefreshPromise = null;
let refreshIntervalId = null;

let runtimeStatus = {
  isRefreshing: false,
  lastAttemptAt: 0,
  lastRefreshFailed: false,
  lastCacheSaveFailed: false,
  lastError: '',
  lastFeedStatus: []
};

function loadCuratedData() {
  if (cachedCuratedData) return cachedCuratedData;
  const fallback = {
    version: 1,
    storefronts: [],
    news: [],
    releases: [],
    deals: []
  };
  try {
    const raw = fs.readFileSync(CURATED_DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      cachedCuratedData = {
        version: Number(parsed.version) || 1,
        storefronts: Array.isArray(parsed.storefronts) ? parsed.storefronts.map(sanitizeStorefront).filter(Boolean) : [],
        news: Array.isArray(parsed.news) ? parsed.news.map((i) => sanitizeCuratedItem(i, 'news')).filter(Boolean) : [],
        releases: Array.isArray(parsed.releases)
          ? parsed.releases.map((i) => sanitizeCuratedItem(i, 'releases')).filter(Boolean)
          : [],
        deals: Array.isArray(parsed.deals) ? parsed.deals.map((i) => sanitizeCuratedItem(i, 'deals')).filter(Boolean) : []
      };
      return cachedCuratedData;
    }
  } catch (err) {
    console.warn('[GXCorner] Failed loading curated data:', err?.message || err);
  }
  return fallback;
}

function sanitizeHttpUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 2048) return '';
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    if (!parsed.hostname) return '';
    return parsed.toString();
  } catch (_) {
    return '';
  }
}

function sanitizeThumbnailUrl(rawUrl) {
  const safe = sanitizeHttpUrl(rawUrl);
  if (!safe) return '';
  if (TRACKER_IMAGE_RE.test(safe)) return '';
  return safe;
}

function sanitizeStorefront(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const url = sanitizeHttpUrl(raw.url);
  if (!url) return null;
  const name = stripHtmlToText(raw.name || '', 48);
  if (!name) return null;
  return {
    id: String(raw.id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-')).slice(0, 64),
    name,
    tagline: stripHtmlToText(raw.tagline || '', 80),
    badge: stripHtmlToText(raw.badge || '', 24),
    url
  };
}

function sanitizeCuratedItem(raw, section) {
  if (!raw || typeof raw !== 'object') return null;
  const url = sanitizeHttpUrl(raw.url);
  const title = stripHtmlToText(raw.title || '', 180);
  if (!url || !title) return null;
  const platforms = Array.isArray(raw.platforms)
    ? raw.platforms.map((p) => stripHtmlToText(p, 20)).filter(Boolean).slice(0, 5)
    : [];
  return {
    id: String(raw.id || `curated-${section}-${Math.random().toString(36).slice(2, 8)}`).slice(0, 80),
    title,
    summary: stripHtmlToText(raw.summary || '', 200),
    url,
    source: stripHtmlToText(raw.source || 'Curated Pick', 48),
    thumbnail: sanitizeThumbnailUrl(raw.thumbnail || ''),
    publishedAt: typeof raw.publishedAt === 'number' && Number.isFinite(raw.publishedAt) ? raw.publishedAt : 0,
    dateLabel: stripHtmlToText(raw.dateLabel || 'Curated Pick', 40),
    tag: stripHtmlToText(raw.tag || '', 24),
    platforms,
    section,
    curated: true
  };
}

// Single-pass XML/HTML entity decoder (avoids double-unescaping &amp;lt; -> <).
const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  trade: '™',
  copy: '©',
  reg: '®'
};

function decodeXmlEntities(str) {
  if (typeof str !== 'string' || !str) return '';
  return str.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,12});/g, (match, code) => {
    if (code[0] === '#') {
      const isHex = code[1] === 'x' || code[1] === 'X';
      const num = parseInt(isHex ? code.slice(2) : code.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(num) || num <= 0 || num > 0x10ffff) return match;
      // Ignore control characters except tab/newline/cr
      if (num < 32 && num !== 9 && num !== 10 && num !== 13) return ' ';
      try {
        return String.fromCodePoint(num);
      } catch (_) {
        return match;
      }
    }
    const lower = code.toLowerCase();
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, lower) ? NAMED_ENTITIES[lower] : match;
  });
}

function unwrapCdata(raw) {
  if (typeof raw !== 'string' || !raw) return '';
  return raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function stripHtmlToText(raw, maxLen = 200) {
  if (typeof raw !== 'string' || !raw) return '';
  let text = unwrapCdata(raw);
  // Decode entities once so encoded HTML inside RSS <description> (&lt;p&gt;...) becomes tags to strip
  text = decodeXmlEntities(text);
  text = text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (maxLen > 0 && text.length > maxLen) {
    text = text.slice(0, Math.max(1, maxLen - 1)).trimEnd() + '…';
  }
  return text;
}

function sanitizeTitleText(raw, maxLen = 180) {
  if (typeof raw !== 'string' || !raw) return '';
  let text = unwrapCdata(raw);
  // Strip any literal <script>/<style>/comment blocks before stripping generic tags
  text = text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  text = decodeXmlEntities(text);
  // Also strip any decoded HTML markup fragments (e.g. encoded <b> or <script> tags in feeds)
  text = text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/?[a-z][^>]*>/gi, ' ')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (maxLen > 0 && text.length > maxLen) {
    text = text.slice(0, Math.max(1, maxLen - 1)).trimEnd() + '…';
  }
  return text;
}

function parseXmlAttributes(attrStr) {
  const attrs = Object.create(null);
  if (typeof attrStr !== 'string' || !attrStr) return attrs;
  const re = /([a-zA-Z_:][a-zA-Z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let m;
  while ((m = re.exec(attrStr)) !== null) {
    const key = m[1].toLowerCase();
    const val = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] || '';
    attrs[key] = decodeXmlEntities(val.trim());
  }
  return attrs;
}

function extractFirstTagText(block, tagNames) {
  for (const tag of tagNames) {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i');
    const m = block.match(re);
    if (m && m[1] !== undefined) {
      return m[1];
    }
  }
  return '';
}

function extractAllTags(block, tagName) {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<${escaped}(\\s[^>]*)?(?:\\/>|>([\\s\\S]*?)<\\/${escaped}>)`, 'gi');
  const results = [];
  let m;
  while ((m = re.exec(block)) !== null) {
    results.push({
      attrs: parseXmlAttributes(m[1] || ''),
      body: m[2] || ''
    });
  }
  return results;
}

function extractEntryLink(block, isAtom) {
  const links = extractAllTags(block, 'link');
  if (isAtom) {
    for (const l of links) {
      const rel = (l.attrs.rel || 'alternate').toLowerCase();
      if (rel === 'alternate' && l.attrs.href) {
        const safe = sanitizeHttpUrl(l.attrs.href);
        if (safe) return safe;
      }
    }
    for (const l of links) {
      if (l.attrs.href) {
        const safe = sanitizeHttpUrl(l.attrs.href);
        if (safe) return safe;
      }
    }
  }
  for (const l of links) {
    const candidate = l.body ? decodeXmlEntities(unwrapCdata(l.body)).trim() : l.attrs.href || '';
    const safe = sanitizeHttpUrl(candidate);
    if (safe) return safe;
  }
  const guidRaw = extractFirstTagText(block, ['guid', 'id']);
  if (guidRaw) {
    const safeGuid = sanitizeHttpUrl(decodeXmlEntities(unwrapCdata(guidRaw)).trim());
    if (safeGuid) return safeGuid;
  }
  return '';
}

function extractEntryThumbnail(block, rawBodyHtml) {
  // 1. <media:content url="...">
  const mediaContents = extractAllTags(block, 'media:content');
  for (const mc of mediaContents) {
    const url = mc.attrs.url || '';
    const medium = (mc.attrs.medium || '').toLowerCase();
    const type = (mc.attrs.type || '').toLowerCase();
    if (!url) continue;
    if (medium === 'video' || medium === 'audio' || type.startsWith('video/') || type.startsWith('audio/')) {
      continue;
    }
    const safe = sanitizeThumbnailUrl(url);
    if (safe) return safe;
  }

  // 2. <media:thumbnail url="...">
  const mediaThumbs = extractAllTags(block, 'media:thumbnail');
  for (const mt of mediaThumbs) {
    const safe = sanitizeThumbnailUrl(mt.attrs.url || '');
    if (safe) return safe;
  }

  // 3. <enclosure url="..." type="image/...">
  const enclosures = extractAllTags(block, 'enclosure');
  for (const enc of enclosures) {
    const type = (enc.attrs.type || '').toLowerCase();
    if (type && !type.startsWith('image/')) continue;
    const safe = sanitizeThumbnailUrl(enc.attrs.url || '');
    if (safe) return safe;
  }

  // 4. Atom <link rel="enclosure" type="image/..." href="...">
  const links = extractAllTags(block, 'link');
  for (const l of links) {
    const rel = (l.attrs.rel || '').toLowerCase();
    const type = (l.attrs.type || '').toLowerCase();
    if (rel === 'enclosure' && (!type || type.startsWith('image/'))) {
      const safe = sanitizeThumbnailUrl(l.attrs.href || '');
      if (safe) return safe;
    }
  }

  // 5. Fallback: first <img src="https://..."> inside description/content HTML
  if (rawBodyHtml) {
    const decoded = decodeXmlEntities(unwrapCdata(rawBodyHtml));
    const imgMatch = decoded.match(/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'=<>`]+))/i);
    if (imgMatch) {
      const src = imgMatch[1] || imgMatch[2] || imgMatch[3] || '';
      const safe = sanitizeThumbnailUrl(src);
      if (safe) return safe;
    }
  }

  return '';
}

function parsePublishedAt(rawDate) {
  if (typeof rawDate !== 'string' || !rawDate.trim()) return 0;
  const cleaned = decodeXmlEntities(unwrapCdata(rawDate)).trim();
  const parsed = Date.parse(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function classifyFeedItem(item, defaultSection = 'news') {
  const haystack = `${item.title || ''} ${(item.categories || []).join(' ')} ${item.summary || ''}`;
  if (DEAL_KEYWORDS_RE.test(haystack)) return 'deals';
  const titleAndCats = `${item.title || ''} ${(item.categories || []).join(' ')}`;
  if (RELEASE_KEYWORDS_RE.test(titleAndCats)) return 'releases';
  if (defaultSection === 'deals' || defaultSection === 'releases') return defaultSection;
  return 'news';
}

function parseFeedXml(xmlText, feedMeta = {}) {
  if (typeof xmlText !== 'string' || !xmlText.trim()) return [];
  const bounded = xmlText.length > MAX_FEED_BYTES ? xmlText.slice(0, MAX_FEED_BYTES) : xmlText;

  const isAtom = /<feed\b[^>]*>/i.test(bounded) && !/<item\b[^>]*>/i.test(bounded);
  const blockRe = isAtom ? /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi : /<item\b[^>]*>([\s\S]*?)<\/item>/gi;

  // Fallback channel title if feedMeta.name not provided
  let sourceName = stripHtmlToText(feedMeta.name || '', 48);
  if (!sourceName) {
    const headChunk = bounded.slice(0, 4000);
    const channelTitle = extractFirstTagText(headChunk, ['title']);
    sourceName = sanitizeTitleText(channelTitle, 48) || 'Gaming Feed';
  }

  const items = [];
  let match;
  while ((match = blockRe.exec(bounded)) !== null && items.length < 30) {
    const block = match[1] || '';
    const rawTitle = extractFirstTagText(block, ['title']);
    const title = sanitizeTitleText(rawTitle, 180);
    const url = extractEntryLink(block, isAtom);
    if (!title || !url) continue;

    const rawDesc = extractFirstTagText(block, ['description', 'summary', 'media:description']);
    const rawContent = extractFirstTagText(block, ['content:encoded', 'content']);
    const summary = stripHtmlToText(rawDesc || rawContent, 200);
    const thumbnail = extractEntryThumbnail(block, `${rawDesc}\n${rawContent}`);

    const rawDate = extractFirstTagText(block, ['pubDate', 'published', 'updated', 'dc:date']);
    const publishedAt = parsePublishedAt(rawDate);

    const catTags = extractAllTags(block, 'category');
    const categories = [];
    for (const c of catTags) {
      const catText = stripHtmlToText(c.attrs.term || c.attrs.label || c.body || '', 40);
      if (catText) categories.push(catText);
    }

    const baseItem = {
      id: `${feedMeta.id || 'feed'}-${items.length}-${publishedAt || 0}`,
      title,
      summary,
      url,
      source: sourceName,
      feedId: String(feedMeta.id || '').slice(0, 40),
      thumbnail,
      publishedAt,
      categories: categories.slice(0, 6),
      curated: false
    };
    const section = classifyFeedItem(baseItem, feedMeta.defaultSection || 'news');
    const tag =
      section === 'deals'
        ? /\b(free|giveaway|freebie)\b/i.test(`${title} ${summary}`)
          ? 'FREE'
          : 'DEAL'
        : section === 'releases'
        ? 'RELEASE'
        : '';

    items.push({
      id: baseItem.id,
      title: baseItem.title,
      summary: baseItem.summary,
      url: baseItem.url,
      source: baseItem.source,
      feedId: baseItem.feedId,
      thumbnail: baseItem.thumbnail,
      publishedAt: baseItem.publishedAt,
      tag,
      platforms: [],
      section,
      curated: false
    });
  }

  return items;
}

function isPrivateOrReservedIp(ip) {
  if (!ip || typeof ip !== 'string') return true;
  const clean = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!clean) return true;
  if (clean === 'localhost' || clean.endsWith('.localhost') || clean.endsWith('.local')) return true;
  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
  const v4Mapped = clean.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  const v4 = v4Mapped ? v4Mapped[1] : clean;
  const parts = v4.split('.');
  if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
    const [a, b] = parts.map((n) => parseInt(n, 10));
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast/reserved
    return false;
  }
  if (clean.includes(':')) {
    if (clean === '::' || clean === '::1') return true;
    if (clean.startsWith('fc') || clean.startsWith('fd') || clean.startsWith('fe80')) return true;
  }
  return false;
}

function getCornerUserAgent() {
  let ver = '3.0.0';
  try {
    const appObj = electron && electron.app;
    if (appObj && typeof appObj.getVersion === 'function') {
      ver = appObj.getVersion() || ver;
    }
  } catch (_) {}
  return `nextGxBrowser/${ver} (GX Corner RSS Reader)`;
}

function fetchTextViaNodeHttp(
  urlStr,
  {
    timeoutMs = PER_FEED_TIMEOUT_MS,
    redirectsLeft = MAX_REDIRECTS,
    signal = null,
    deadlineAt = null
  } = {}
) {
  return new Promise((resolve, reject) => {
    const safeUrl = sanitizeHttpUrl(urlStr);
    if (!safeUrl) {
      reject(new Error('Invalid feed URL'));
      return;
    }

    const parsedCheck = new URL(safeUrl);
    if (isPrivateOrReservedIp(parsedCheck.hostname)) {
      reject(new Error('Blocked private or loopback feed host'));
      return;
    }

    const effectiveDeadlineAt =
      typeof deadlineAt === 'number' && Number.isFinite(deadlineAt) ? deadlineAt : Date.now() + timeoutMs;
    const makeAbortError = () => {
      if (signal && signal.reason instanceof Error) return signal.reason;
      if (signal && typeof signal.reason === 'string' && signal.reason) return new Error(signal.reason);
      return new Error('Refresh timeout');
    };

    if (signal && signal.aborted) {
      reject(makeAbortError());
      return;
    }

    const remainingMs = effectiveDeadlineAt - Date.now();
    if (remainingMs <= 0) {
      reject(new Error(`Feed timeout after ${timeoutMs}ms`));
      return;
    }

    const parsed = new URL(safeUrl);
    const client = parsed.protocol === 'https:' ? https : http;
    let settled = false;
    let activeRes = null;
    let onAbort = null;

    const cleanupAbort = () => {
      if (signal && onAbort) {
        try {
          signal.removeEventListener('abort', onAbort);
        } catch (_) {}
        onAbort = null;
      }
    };

    const deadlineTimer = setTimeout(() => {
      const timeoutErr = new Error(`Feed timeout after ${timeoutMs}ms`);
      try {
        if (activeRes && typeof activeRes.destroy === 'function') activeRes.destroy(timeoutErr);
      } catch (_) {}
      try {
        req.destroy(timeoutErr);
      } catch (_) {}
      finish(timeoutErr);
    }, remainingMs);

    const finish = (err, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      cleanupAbort();
      if (err) reject(err);
      else resolve(val);
    };

    const req = client.get(
      parsed,
      {
        headers: {
          'User-Agent': getCornerUserAgent(),
          Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1'
        }
      },
      (res) => {
        activeRes = res;
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
          clearTimeout(deadlineTimer);
          cleanupAbort();
          res.resume();
          try {
            const nextUrl = new URL(res.headers.location, parsed).toString();
            fetchTextViaNodeHttp(nextUrl, {
              timeoutMs,
              redirectsLeft: redirectsLeft - 1,
              signal,
              deadlineAt: effectiveDeadlineAt
            }).then(
              (val) => finish(null, val),
              (err) => finish(err)
            );
          } catch (err) {
            finish(err);
          }
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          finish(new Error(`HTTP ${status}`));
          return;
        }
        const chunks = [];
        let totalBytes = 0;
        res.on('data', (chunk) => {
          totalBytes += chunk.length;
          if (totalBytes <= MAX_FEED_BYTES) {
            chunks.push(chunk);
          } else {
            const remaining = MAX_FEED_BYTES - (totalBytes - chunk.length);
            if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
            res.destroy();
          }
        });
        res.on('end', () => finish(null, Buffer.concat(chunks).toString('utf-8')));
        res.on('close', () => {
          if (!settled && chunks.length > 0 && totalBytes > MAX_FEED_BYTES) {
            finish(null, Buffer.concat(chunks).toString('utf-8'));
          }
        });
        res.on('error', (err) => finish(err));
      }
    );

    if (signal) {
      onAbort = () => {
        const abortErr = makeAbortError();
        try {
          if (activeRes && typeof activeRes.destroy === 'function') activeRes.destroy(abortErr);
        } catch (_) {}
        try {
          req.destroy(abortErr);
        } catch (_) {}
        finish(abortErr);
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    req.setTimeout(remainingMs, () => {
      const timeoutErr = new Error(`Feed timeout after ${timeoutMs}ms`);
      req.destroy(timeoutErr);
      finish(timeoutErr);
    });
    req.on('error', (err) => finish(err));
  });
}

async function readResponseBodyBounded(res, maxBytes = MAX_FEED_BYTES) {
  if (res && res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        const buf = Buffer.isBuffer(value)
          ? value
          : value instanceof Uint8Array
          ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
          : Buffer.from(String(value), 'utf-8');
        if (buf.length === 0) continue;
        totalBytes += buf.length;
        if (totalBytes <= maxBytes) {
          chunks.push(buf);
        } else {
          const remaining = maxBytes - (totalBytes - buf.length);
          if (remaining > 0) {
            chunks.push(buf.subarray(0, remaining));
          }
          try {
            await reader.cancel();
          } catch (_) {}
          break;
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch (_) {}
    }
    return Buffer.concat(chunks).toString('utf-8');
  }

  if (res && res.body && typeof res.body[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    let totalBytes = 0;
    for await (const chunk of res.body) {
      if (!chunk) continue;
      const buf = Buffer.isBuffer(chunk)
        ? chunk
        : chunk instanceof Uint8Array
        ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
        : Buffer.from(String(chunk), 'utf-8');
      if (buf.length === 0) continue;
      totalBytes += buf.length;
      if (totalBytes <= maxBytes) {
        chunks.push(buf);
      } else {
        const remaining = maxBytes - (totalBytes - buf.length);
        if (remaining > 0) {
          chunks.push(buf.subarray(0, remaining));
        }
        if (typeof res.body.destroy === 'function') {
          try {
            res.body.destroy();
          } catch (_) {}
        }
        break;
      }
    }
    return Buffer.concat(chunks).toString('utf-8');
  }

  const text = typeof res?.text === 'function' ? await res.text() : '';
  if (Buffer.byteLength(text, 'utf-8') > maxBytes) {
    return Buffer.from(text, 'utf-8').subarray(0, maxBytes).toString('utf-8');
  }
  return text;
}

async function fetchTextDefault(urlStr, { timeoutMs = PER_FEED_TIMEOUT_MS, signal = null } = {}) {
  const safeUrl = sanitizeHttpUrl(urlStr);
  if (!safeUrl) throw new Error('Invalid feed URL');
  const parsedCheck = new URL(safeUrl);
  if (isPrivateOrReservedIp(parsedCheck.hostname)) {
    throw new Error('Blocked private or loopback feed host');
  }

  const netFetch = electron && electron.net && typeof electron.net.fetch === 'function' ? electron.net.fetch : null;
  if (!netFetch) {
    return fetchTextViaNodeHttp(safeUrl, { timeoutMs, signal });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Feed timeout after ${timeoutMs}ms`)), timeoutMs);
  const onParentAbort = () => controller.abort(new Error('Refresh timeout'));
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer);
      throw new Error('Refresh timeout');
    }
    signal.addEventListener('abort', onParentAbort, { once: true });
  }

  try {
    const res = await netFetch(safeUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': getCornerUserAgent(),
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1'
      }
    });
    if (res && res.url) {
      try {
        const finalHost = new URL(res.url).hostname;
        if (isPrivateOrReservedIp(finalHost)) {
          throw new Error('Blocked redirect to private or loopback host');
        }
      } catch (err) {
        if (err && /Blocked redirect/i.test(err.message)) throw err;
      }
    }
    if (!res || !res.ok) {
      throw new Error(`HTTP ${res ? res.status : 'error'}`);
    }
    return await readResponseBodyBounded(res, MAX_FEED_BYTES);
  } finally {
    clearTimeout(timer);
    if (signal) {
      try {
        signal.removeEventListener('abort', onParentAbort);
      } catch (_) {}
    }
  }
}

function normalizeUrlForDedup(rawUrl) {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    const params = Array.from(u.searchParams.keys());
    for (const k of params) {
      if (/^(utm_|ref|source|fbclid|gclid)/i.test(k)) {
        u.searchParams.delete(k);
      }
    }
    return `${u.origin.toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch (_) {
    return String(rawUrl || '').trim().toLowerCase();
  }
}

function dedupeAndSortItems(items, limit) {
  const seenUrls = new Set();
  const seenTitles = new Set();
  const list = [];
  const sorted = [...(Array.isArray(items) ? items : [])].sort(
    (a, b) => (Number(b?.publishedAt) || 0) - (Number(a?.publishedAt) || 0)
  );
  for (const item of sorted) {
    if (!item || !item.url || !item.title) continue;
    const normUrl = normalizeUrlForDedup(item.url);
    const normTitle = item.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (seenUrls.has(normUrl) || (normTitle && seenTitles.has(normTitle))) continue;
    seenUrls.add(normUrl);
    if (normTitle) seenTitles.add(normTitle);
    list.push(item);
    if (list.length >= limit) break;
  }
  return list;
}

function readStoredCache() {
  if (state.storage && typeof state.storage.getGxCornerCache === 'function') {
    return state.storage.getGxCornerCache();
  }
  return {
    version: 1,
    fetchedAt: 0,
    feedStatus: [],
    items: { news: [], releases: [], deals: [] }
  };
}

function countLiveItems(itemsObj) {
  if (!itemsObj || typeof itemsObj !== 'object') return 0;
  const n = Array.isArray(itemsObj.news) ? itemsObj.news.length : 0;
  const r = Array.isArray(itemsObj.releases) ? itemsObj.releases.length : 0;
  const d = Array.isArray(itemsObj.deals) ? itemsObj.deals.length : 0;
  return n + r + d;
}

function mergeSectionWithCurated(liveItems, curatedItems, limit) {
  const live = Array.isArray(liveItems) ? liveItems : [];
  const curated = Array.isArray(curatedItems) ? curatedItems : [];
  const seenUrls = new Set();
  const merged = [];

  for (const item of live) {
    if (!item || !item.url) continue;
    const norm = normalizeUrlForDedup(item.url);
    if (seenUrls.has(norm)) continue;
    seenUrls.add(norm);
    merged.push({ ...item, curated: false });
    if (merged.length >= limit) return merged;
  }

  for (const item of curated) {
    if (!item || !item.url) continue;
    const norm = normalizeUrlForDedup(item.url);
    if (seenUrls.has(norm)) continue;
    seenUrls.add(norm);
    merged.push({ ...item, curated: true });
    if (merged.length >= limit) return merged;
  }

  return merged;
}

function buildCornerPayload({ now = Date.now(), cacheOverride = null } = {}) {
  const curated = loadCuratedData();
  const cache = cacheOverride || readStoredCache();
  const fetchedAt = typeof cache?.fetchedAt === 'number' && Number.isFinite(cache.fetchedAt) ? cache.fetchedAt : 0;
  const liveCount = countLiveItems(cache?.items);
  const ageMs = fetchedAt > 0 ? Math.max(0, now - fetchedAt) : Infinity;
  const isWithinTtl = fetchedAt > 0 && ageMs < CACHE_TTL_MS && liveCount > 0;
  const isUsableWhileRefreshing = runtimeStatus.isRefreshing && fetchedAt > 0 && liveCount > 0;
  const hasUsableLive = isWithinTtl || isUsableWhileRefreshing;

  const feedStatus =
    runtimeStatus.lastFeedStatus.length > 0
      ? runtimeStatus.lastFeedStatus
      : Array.isArray(cache?.feedStatus)
      ? cache.feedStatus
      : [];
  const feedsTotal = feedStatus.length || DEFAULT_FEEDS.length;
  const feedsSucceeded = feedStatus.filter((f) => f && f.ok).length;

  let mode = 'offline';
  let isOfflineFallback = false;
  let statusMessage = 'Offline — showing curated picks';

  if (hasUsableLive) {
    if (runtimeStatus.lastRefreshFailed) {
      mode = 'offline-cached';
      isOfflineFallback = false;
      statusMessage = runtimeStatus.lastCacheSaveFailed
        ? `Live feeds loaded, but cache save failed (${runtimeStatus.lastError || 'storage error'})`
        : "Offline — couldn't reach live feeds; showing cached gaming news";
    } else if (ageMs < 60 * 1000 && runtimeStatus.lastAttemptAt > 0 && !runtimeStatus.lastRefreshFailed) {
      mode = 'live';
      statusMessage = `Live RSS — ${feedsSucceeded || 1} of ${feedsTotal} feeds active`;
    } else {
      mode = 'cached';
      statusMessage = 'Showing cached feeds';
    }
  } else if (runtimeStatus.isRefreshing && !runtimeStatus.lastRefreshFailed) {
    mode = 'offline';
    isOfflineFallback = true;
    statusMessage = 'Loading live gaming feeds — showing curated picks';
  } else {
    mode = 'offline';
    isOfflineFallback = true;
    statusMessage = 'Offline — showing curated picks';
  }

  const liveNews = hasUsableLive && Array.isArray(cache?.items?.news) ? cache.items.news : [];
  const liveReleases = hasUsableLive && Array.isArray(cache?.items?.releases) ? cache.items.releases : [];
  const liveDeals = hasUsableLive && Array.isArray(cache?.items?.deals) ? cache.items.deals : [];

  // News: live RSS articles when online/cached; curated picks only when live news is unavailable.
  const news = liveNews.length > 0 ? liveNews.slice(0, MAX_NEWS_ITEMS) : curated.news.slice(0, MAX_NEWS_ITEMS);
  // Releases: live RSS release items (if any) on top of the curated editable release calendar.
  const releases = mergeSectionWithCurated(liveReleases, curated.releases, MAX_RELEASE_ITEMS);
  // Deals: live RSS deals/free games (if any) supplemented with curated storefront deal picks.
  const deals = mergeSectionWithCurated(liveDeals, curated.deals, MAX_DEAL_ITEMS);

  return {
    mode,
    isRefreshing: Boolean(runtimeStatus.isRefreshing),
    isOfflineFallback,
    lastRefreshFailed: Boolean(runtimeStatus.lastRefreshFailed),
    statusMessage,
    lastError: runtimeStatus.lastError || '',
    fetchedAt,
    cacheTtlMs: CACHE_TTL_MS,
    refreshIntervalMs: BACKGROUND_REFRESH_MS,
    feedsTotal,
    feedsSucceeded,
    feedStatus,
    storefronts: curated.storefronts,
    sections: {
      news,
      releases,
      deals
    }
  };
}

function broadcastCornerUpdate(payload) {
  const data = payload || buildCornerPayload();
  try {
    sendToCornerTabs('corner:update', data);
  } catch (_) {}
  return data;
}

async function refreshFeeds({
  feeds = DEFAULT_FEEDS,
  fetchImpl = fetchTextDefault,
  perFeedTimeoutMs = PER_FEED_TIMEOUT_MS,
  overallTimeoutMs = OVERALL_REFRESH_TIMEOUT_MS,
  broadcast = true
} = {}) {
  if (activeRefreshPromise) {
    return activeRefreshPromise;
  }

  const run = (async () => {
    runtimeStatus.isRefreshing = true;
    runtimeStatus.lastAttemptAt = Date.now();
    if (broadcast) {
      broadcastCornerUpdate();
    }

    const overallController = new AbortController();
    const overallTimer = setTimeout(() => {
      overallController.abort(new Error(`Overall RSS refresh timed out after ${overallTimeoutMs}ms`));
    }, overallTimeoutMs);

    const feedList = Array.isArray(feeds) && feeds.length > 0 ? feeds : DEFAULT_FEEDS;
    const allParsed = [];
    const feedStatus = [];

    try {
      const settled = await Promise.allSettled(
        feedList.map(async (feed) => {
          const startedAt = Date.now();
          try {
            const xml = await fetchImpl(feed.url, {
              timeoutMs: perFeedTimeoutMs,
              signal: overallController.signal
            });
            const parsed = parseFeedXml(xml, feed);
            if (!parsed.length) {
              throw new Error('No valid entries parsed');
            }
            return {
              id: feed.id,
              name: feed.name,
              url: feed.url,
              ok: true,
              count: parsed.length,
              durationMs: Date.now() - startedAt,
              items: parsed
            };
          } catch (err) {
            return {
              id: feed.id,
              name: feed.name,
              url: feed.url,
              ok: false,
              count: 0,
              durationMs: Date.now() - startedAt,
              error: String(err?.message || err || 'Fetch failed').slice(0, 160),
              items: []
            };
          }
        })
      );

      for (const entry of settled) {
        if (entry.status === 'fulfilled' && entry.value) {
          const res = entry.value;
          feedStatus.push({
            id: res.id,
            name: res.name,
            ok: Boolean(res.ok),
            count: res.count || 0,
            error: res.error || ''
          });
          if (res.ok && Array.isArray(res.items)) {
            allParsed.push(...res.items);
          }
        } else {
          feedStatus.push({
            id: 'unknown',
            name: 'Feed',
            ok: false,
            count: 0,
            error: String(entry.reason?.message || 'Fetch error').slice(0, 160)
          });
        }
      }
    } finally {
      clearTimeout(overallTimer);
    }

    const newsItems = dedupeAndSortItems(
      allParsed.filter((i) => i.section === 'news'),
      MAX_NEWS_ITEMS
    );
    const releaseItems = dedupeAndSortItems(
      allParsed.filter((i) => i.section === 'releases'),
      MAX_RELEASE_ITEMS
    );
    const dealItems = dedupeAndSortItems(
      allParsed.filter((i) => i.section === 'deals'),
      MAX_DEAL_ITEMS
    );

    const totalLive = newsItems.length + releaseItems.length + dealItems.length;
    const now = Date.now();

    runtimeStatus.isRefreshing = false;
    runtimeStatus.lastFeedStatus = feedStatus;

    let freshCacheOverride = null;
    if (totalLive > 0) {
      const cacheRecord = {
        version: 1,
        fetchedAt: now,
        feedStatus,
        items: {
          news: newsItems,
          releases: releaseItems,
          deals: dealItems
        }
      };
      freshCacheOverride = cacheRecord;
      try {
        if (state.storage && typeof state.storage.saveGxCornerCache === 'function') {
          state.storage.saveGxCornerCache(cacheRecord);
        }
        runtimeStatus.lastRefreshFailed = false;
        runtimeStatus.lastCacheSaveFailed = false;
        runtimeStatus.lastError = '';
      } catch (err) {
        const errMsg = String(err?.message || err || 'Failed to save GX Corner cache').slice(0, 160);
        console.warn('[GXCorner] Failed saving GX Corner cache:', errMsg);
        runtimeStatus.lastRefreshFailed = true;
        runtimeStatus.lastCacheSaveFailed = true;
        runtimeStatus.lastError = errMsg;
      }
    } else {
      runtimeStatus.lastRefreshFailed = true;
      runtimeStatus.lastCacheSaveFailed = false;
      const firstErr = feedStatus.find((f) => f && f.error)?.error || 'Unable to reach gaming RSS feeds';
      runtimeStatus.lastError = firstErr;
    }

    const payload = buildCornerPayload({ now, cacheOverride: freshCacheOverride });
    if (broadcast) {
      broadcastCornerUpdate(payload);
    }
    return payload;
  })();

  activeRefreshPromise = run.finally(() => {
    activeRefreshPromise = null;
  });

  return activeRefreshPromise;
}

function getCornerData({ triggerBackgroundRefresh = true } = {}) {
  const now = Date.now();
  const cache = readStoredCache();
  const fetchedAt = typeof cache?.fetchedAt === 'number' ? cache.fetchedAt : 0;
  const hasLiveItems = countLiveItems(cache?.items) > 0;
  const ageMs = fetchedAt > 0 ? Math.max(0, now - fetchedAt) : Infinity;
  const needsRefresh = !hasLiveItems || ageMs >= BACKGROUND_REFRESH_MS;

  if (triggerBackgroundRefresh && needsRefresh && !activeRefreshPromise && !state.isAppQuitting) {
    runtimeStatus.isRefreshing = true;
    // Non-blocking background refresh so the page paints cached/curated content immediately
    setImmediate(() => {
      if (state.isAppQuitting) {
        if (!activeRefreshPromise) {
          runtimeStatus.isRefreshing = false;
        }
        return;
      }
      refreshFeeds({ broadcast: true }).catch(() => {});
    });
  }

  return buildCornerPayload({ now, cacheOverride: cache });
}

function hasOpenCornerTab() {
  for (const ctx of windowContexts.values()) {
    if (!ctx || !ctx.tabs) continue;
    for (const tab of ctx.tabs.values()) {
      if (!tab || tab.sleeping) continue;
      if (isCornerUrl(tab.url)) return true;
      const wcUrl =
        tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()
          ? tab.view.webContents.getURL()
          : '';
      if (isCornerUrl(wcUrl)) return true;
    }
  }
  return false;
}

function startCornerBackgroundRefresh() {
  stopCornerBackgroundRefresh();
  refreshIntervalId = setInterval(() => {
    if (state.isAppQuitting) return;
    if (!hasOpenCornerTab()) return;
    const cache = readStoredCache();
    const ageMs = cache?.fetchedAt ? Math.max(0, Date.now() - cache.fetchedAt) : Infinity;
    if (ageMs >= BACKGROUND_REFRESH_MS && !activeRefreshPromise) {
      refreshFeeds({ broadcast: true }).catch(() => {});
    }
  }, BACKGROUND_REFRESH_MS);
  if (typeof refreshIntervalId.unref === 'function') {
    refreshIntervalId.unref();
  }
}

function stopCornerBackgroundRefresh() {
  if (refreshIntervalId) {
    clearInterval(refreshIntervalId);
    refreshIntervalId = null;
  }
}

function registerCornerPreloadForSession(ses) {
  if (!ses || registeredPreloadSessions.has(ses)) return false;
  try {
    if (typeof ses.registerPreloadScript === 'function') {
      const existing = typeof ses.getPreloadScripts === 'function' ? ses.getPreloadScripts() : [];
      const alreadyRegistered =
        Array.isArray(existing) && existing.some((p) => p && (p.id === 'nextgx-corner-preload' || p.filePath === CORNER_PRELOAD_FILE));
      if (!alreadyRegistered) {
        ses.registerPreloadScript({
          id: 'nextgx-corner-preload',
          type: 'frame',
          filePath: CORNER_PRELOAD_FILE,
          includeGlobs: ['file://*corner.html*']
        });
      }
      registeredPreloadSessions.add(ses);
      return true;
    }
  } catch (err) {
    console.warn('[GXCorner] Failed registering corner preload script:', err?.message || err);
  }
  return false;
}

function registerGxCornerIpcHandlers(handleInternal) {
  handleInternal('corner:get-data', () => getCornerData({ triggerBackgroundRefresh: true }));
  handleInternal('corner:refresh', () => refreshFeeds({ broadcast: true }));
  handleInternal('corner:open-link', (e, rawUrl) => {
    const safeUrl = sanitizeHttpUrl(rawUrl);
    if (!safeUrl) return { ok: false, error: 'Invalid link URL' };
    const ctx = getCtxFromSender(e.sender);
    if (!ctx) return { ok: false, error: 'Window context unavailable' };
    createTab(ctx, { url: safeUrl, active: true });
    return { ok: true, url: safeUrl };
  });
}

function _resetRuntimeForTest() {
  cachedCuratedData = null;
  activeRefreshPromise = null;
  runtimeStatus = {
    isRefreshing: false,
    lastAttemptAt: 0,
    lastRefreshFailed: false,
    lastCacheSaveFailed: false,
    lastError: '',
    lastFeedStatus: []
  };
}

module.exports = {
  DEFAULT_FEEDS,
  CACHE_TTL_MS,
  BACKGROUND_REFRESH_MS,
  PER_FEED_TIMEOUT_MS,
  OVERALL_REFRESH_TIMEOUT_MS,
  MAX_FEED_BYTES,
  CURATED_DATA_FILE,
  loadCuratedData,
  sanitizeHttpUrl,
  sanitizeThumbnailUrl,
  isPrivateOrReservedIp,
  decodeXmlEntities,
  stripHtmlToText,
  sanitizeTitleText,
  parseFeedXml,
  classifyFeedItem,
  fetchTextViaNodeHttp,
  readResponseBodyBounded,
  fetchTextDefault,
  buildCornerPayload,
  getCornerData,
  refreshFeeds,
  broadcastCornerUpdate,
  startCornerBackgroundRefresh,
  stopCornerBackgroundRefresh,
  registerCornerPreloadForSession,
  registerGxCornerIpcHandlers,
  _resetRuntimeForTest
};
