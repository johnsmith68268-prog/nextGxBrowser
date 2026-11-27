// Built-in Engine-Level Ad & Tracker Blocker (EasyList & EasyPrivacy rules + Cosmetic CSS)

const AD_DOMAINS = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'adservice.google.com',
  'pagead2.googlesyndication.com',
  'tpc.googlesyndication.com',
  'googletagservices.com',
  'adnxs.com',
  'adsrvr.org',
  'adform.net',
  'criteo.com',
  'criteo.net',
  'outbrain.com',
  'taboola.com',
  'rubiconproject.com',
  'pubmatic.com',
  'openx.net',
  'casalemedia.com',
  'zedo.com',
  'popads.net',
  'popcash.net',
  'propellerads.com',
  'adsterra.com',
  'exoclick.com',
  'juicyads.com',
  'hilltopads.net',
  'revcontent.com',
  'mgid.com',
  'teads.tv',
  'smartadserver.com',
  'advertising.com',
  'amazon-adsystem.com',
  'aax.amazon-adsystem.com',
  'an.facebook.com',
  'ads-twitter.com',
  'static.ads-twitter.com',
  '2mdn.net',
  'adroll.com',
  'sharethrough.com',
  'indexexchange.com',
  '3lift.com',
  'bidswitch.net',
  'contextweb.com',
  'lijit.com',
  'sovrn.com',
  'spotxchange.com',
  'yieldmo.com',
  'zemanta.com',
  'adcolony.com',
  'unityads.unity3d.com',
  'applovin.com',
  'vungle.com',
  'inmobi.com',
  'admicro.vn',
  'adhigh.net',
  'adkernel.com',
  'admixer.net',
  'adsco.re',
  'adskeeper.com',
  'adtng.com',
  'a-ads.com',
  'bidvertiser.com',
  'clickadu.com',
  'clickaine.com',
  'galaksion.com',
  'kadam.net',
  'monetag.com',
  'onclkds.com',
  'onclickalgo.com',
  'pushground.com',
  'richads.com',
  'rollerads.com',
  'trafficjunky.net',
  'trafficstars.com',
  'TripleLift.com'.toLowerCase()
];

const TRACKER_DOMAINS = [
  'google-analytics.com',
  'googletagmanager.com',
  'moatads.com',
  'scorecardresearch.com',
  'quantserve.com',
  'connect.facebook.net/en_us/fbevents.js',
  'pixel.facebook.com',
  'analytics.tiktok.com',
  'bat.bing.com',
  'clarity.ms',
  'hotjar.com',
  'mouseflow.com',
  'luckyorange.com',
  'fullstory.com',
  'mixpanel.com',
  'segment.io',
  'segment.com',
  'amplitude.com',
  'bugsnag.com',
  'sentry-cdn.com',
  'newrelic.com',
  'nr-data.net',
  'chartbeat.com',
  'chartbeat.net',
  'omtrdc.net',
  'demdex.net',
  'appsflyer.com',
  'adjust.com',
  'branch.io',
  'kochava.com'
];

const AD_URL_PATTERNS = [
  /\/pagead\//i,
  /\/ads\/(?!.*(?:\.css|player))/i,
  /\/adserver\//i,
  /\/adframe\./i,
  /\/adview\?/i,
  /\/adbanners?\//i,
  /\/popunder/i,
  /\/pbar\.js/i,
  /\/prebid(\.min)?\.js/i,
  /\/gpt\.js/i,
  /[?&](?:ad_id|ad_type|ad_slot|adunit|banner_id)=/i,
  // YouTube ad telemetry beacons (no video data — safe to drop).
  // Note: /api/stats/qoe is intentionally NOT blocked because it is YouTube's
  // video playback Quality-of-Experience channel and blocking it breaks ABR / triggers anti-adblock.
  /\/api\/stats\/ads/i
];

const TRACKER_URL_PATTERNS = [
  /\/analytics\.js/i,
  /\/gtag\/js/i
];

// Pre-indexed Set & path-rule lookups for O(labels) per-request matching instead of linear scans
function buildDomainIndex(domains) {
  const hostSet = new Set();
  const pathRules = [];
  for (const raw of domains) {
    const rule = raw.toLowerCase();
    const slashIdx = rule.indexOf('/');
    if (slashIdx !== -1) {
      pathRules.push({
        rule,
        host: rule.slice(0, slashIdx),
        path: rule.slice(slashIdx)
      });
    } else {
      hostSet.add(rule);
    }
  }
  return { hostSet, pathRules };
}

const TRACKER_INDEX = buildDomainIndex(TRACKER_DOMAINS);
const AD_INDEX = buildDomainIndex(AD_DOMAINS);
const AD_URL_COMBINED_RE = new RegExp(AD_URL_PATTERNS.map((r) => `(?:${r.source})`).join('|'), 'i');
const TRACKER_URL_COMBINED_RE = new RegExp(TRACKER_URL_PATTERNS.map((r) => `(?:${r.source})`).join('|'), 'i');

function matchHostInIndex(host, pathname, index) {
  if (!host) return '';
  // Check exact host and each parent domain label (e.g. a.b.c -> a.b.c, b.c, c)
  let candidate = host;
  while (candidate) {
    if (index.hostSet.has(candidate)) return candidate;
    const dot = candidate.indexOf('.');
    if (dot === -1) break;
    candidate = candidate.slice(dot + 1);
  }
  if (index.pathRules.length > 0 && pathname) {
    for (let i = 0; i < index.pathRules.length; i++) {
      const pr = index.pathRules[i];
      if ((host === pr.host || host.endsWith(`.${pr.host}`)) && pathname.startsWith(pr.path)) {
        return pr.rule;
      }
    }
  }
  return '';
}

const MAX_PER_SITE_ORIGINS = 100;

const COSMETIC_AD_CSS = `
  /* GX Browser Built-in AdBlocker Cosmetic Filters */
  ins.adsbygoogle,
  iframe[id^="google_ads_"],
  div[id^="google_ads_"],
  div[id^="div-gpt-ad"],
  .ad-container:not(body):not(html),
  .ad_container:not(body):not(html),
  [class^="ad-container"]:not(body):not(html),
  [class*=" ad-container"]:not(body):not(html),
  .ad-banner:not(body):not(html),
  [class^="ad-banner"]:not(body):not(html),
  [class*=" ad-banner"]:not(body):not(html),
  [id*="taboola-"],
  [class*="taboola-"],
  [id*="outbrain_"],
  [class*="outbrain-"],
  .ad-slot,
  .ad-leaderboard,
  .advertisement-banner,
  #masthead-ad,
  ytd-companion-slot-renderer,
  ytd-action-companion-ad-renderer,
  ytd-watch-next-secondary-results-renderer > ytd-compact-promoted-video-renderer,
  ytd-promoted-sparkles-web-renderer,
  ytm-promoted-sparkles-web-renderer,
  ytd-ad-slot-renderer,
  ytd-rich-item-renderer:has(ytd-ad-slot-renderer),
  ytd-reel-video-renderer:has(ytd-ad-slot-renderer),
  ytd-in-feed-ad-layout-renderer,
  ytd-banner-promo-renderer,
  ytd-statement-banner-renderer,
  ytd-search-pyv-renderer,
  ytd-display-ad-renderer,
  ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
  .ytp-ad-overlay-container,
  .ytp-ad-message-container,
  .ytp-ad-player-overlay-layout,
  .ytp-ad-action-interstitial {
    display: none !important;
    height: 0 !important;
    min-height: 0 !important;
    pointer-events: none !important;
    visibility: hidden !important;
  }
`;

function fastParseHttpUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const schemeIdx = raw.indexOf('://');
  if (schemeIdx < 4 || schemeIdx > 5) return null;
  const proto = raw.slice(0, schemeIdx).toLowerCase();
  if (proto !== 'http' && proto !== 'https') return null;
  const restStart = schemeIdx + 3;
  let pathStart = raw.indexOf('/', restStart);
  const queryStart = raw.indexOf('?', restStart);
  const hashStart = raw.indexOf('#', restStart);
  let authorityEnd = raw.length;
  if (pathStart !== -1 && pathStart < authorityEnd) authorityEnd = pathStart;
  if (queryStart !== -1 && queryStart < authorityEnd) authorityEnd = queryStart;
  if (hashStart !== -1 && hashStart < authorityEnd) authorityEnd = hashStart;

  let authority = raw.slice(restStart, authorityEnd);
  const atIdx = authority.lastIndexOf('@');
  if (atIdx !== -1) authority = authority.slice(atIdx + 1);
  let host = authority;
  if (host.startsWith('[')) {
    const closeBracket = host.indexOf(']');
    if (closeBracket !== -1) host = host.slice(0, closeBracket + 1);
  } else {
    const colonIdx = host.indexOf(':');
    if (colonIdx !== -1) host = host.slice(0, colonIdx);
  }
  host = host.toLowerCase();
  if (!host) return null;

  let pathname = '/';
  if (pathStart !== -1 && pathStart === authorityEnd) {
    let pathEnd = raw.length;
    if (queryStart !== -1 && queryStart < pathEnd) pathEnd = queryStart;
    if (hashStart !== -1 && hashStart < pathEnd) pathEnd = hashStart;
    pathname = raw.slice(pathStart, pathEnd).toLowerCase() || '/';
  }
  return { proto, host, origin: `${proto}://${authority.toLowerCase()}`, pathname };
}

function extractOrigin(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'null') return '';
  const fast = fastParseHttpUrl(trimmed);
  if (fast) return fast.origin;
  try {
    const u = new URL(trimmed);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return u.origin.toLowerCase();
    }
  } catch (_) {}
  return '';
}

function matchesDomainRule(parsedUrl, lowerUrl, rule) {
  const slashIdx = rule.indexOf('/');
  if (slashIdx !== -1) {
    const ruleHost = rule.slice(0, slashIdx);
    const rulePath = rule.slice(slashIdx);
    if (parsedUrl) {
      const host = parsedUrl.hostname.toLowerCase();
      const pathname = parsedUrl.pathname.toLowerCase();
      return (host === ruleHost || host.endsWith(`.${ruleHost}`)) && pathname.startsWith(rulePath);
    }
    return lowerUrl.includes(`://${rule}`) || lowerUrl.includes(`.${rule}`);
  }
  if (parsedUrl) {
    const host = parsedUrl.hostname.toLowerCase();
    return host === rule || host.endsWith(`.${rule}`);
  }
  return (
    lowerUrl.includes(`://${rule}`) ||
    lowerUrl.includes(`.${rule}/`) ||
    lowerUrl.includes(`.${rule}?`) ||
    lowerUrl.endsWith(`.${rule}`)
  );
}

class AdBlocker {
  constructor(storage, onBlockedCallback) {
    this.storage = storage;
    this.onBlockedCallback = onBlockedCallback;
    this.sessionBlocked = 0;
    this.recentBlocked = [];
    this.perSiteBlocked = new Map(); // origin -> count (LRU: oldest first, newest last)
    this.attachedSessions = new WeakSet();
    this.sessionProfiles = new WeakMap();
    this.cosmeticState = new Map(); // WebContents -> { keys: Set<string>, injecting: boolean, generation: number }
  }

  isEnabled(profileId) {
    const settings = this.storage.getSettings(profileId);
    return Boolean(settings.adblockEnabled);
  }

  isTrackersEnabled(profileId) {
    const settings = this.storage.getSettings(profileId);
    if (!settings.adblockEnabled) return false;
    return typeof settings.trackerBlockEnabled === 'boolean'
      ? settings.trackerBlockEnabled
      : true;
  }

  isSiteAllowlisted(origin, profileId) {
    const norm = extractOrigin(origin);
    if (!norm) return false;
    if (typeof this.storage.getAdblockSite === 'function') {
      const site = this.storage.getAdblockSite(norm, profileId);
      return Boolean(site && site.hasOverride && site.enabled === false);
    }
    return false;
  }

  isSiteBlockingActive(origin, profileId) {
    if (!this.isEnabled(profileId)) return false;
    const norm = extractOrigin(origin);
    if (!norm) return true;
    return !this.isSiteAllowlisted(norm, profileId);
  }

  shouldInjectCosmetic(origin, profileId) {
    if (!this.isEnabled(profileId)) return false;
    const norm = extractOrigin(origin);
    if (!norm) return false;
    return !this.isSiteAllowlisted(norm, profileId);
  }

  shouldBlock(urlStr, resourceType, initiator = '', { initiatorNormalized = false, profileId } = {}) {
    if (!urlStr) return false;
    // Fast-path skip non-HTTP(S) schemes before any parsing
    const c0 = urlStr.charCodeAt(0);
    if (c0 !== 104 && c0 !== 72) {
      // Does not start with 'h' or 'H' (not http:// or https://)
      return false;
    }
    if (!/^https?:\/\//i.test(urlStr)) {
      return false;
    }

    // Never block main top-level navigation documents
    if (resourceType === 'mainFrame') {
      return false;
    }

    const settings = this.storage.getSettings(profileId);
    const adsEnabled = Boolean(settings.adblockEnabled);
    if (!adsEnabled) {
      return false;
    }
    const trackersEnabled =
      typeof settings.trackerBlockEnabled === 'boolean'
        ? settings.trackerBlockEnabled
        : true;

    let initiatorOrigin = '';
    if (initiatorNormalized) {
      initiatorOrigin = typeof initiator === 'string' ? initiator : '';
    } else {
      const rawInitiator =
        typeof initiator === 'object' && initiator !== null
          ? initiator.initiatorOrigin || initiator.initiator
          : initiator;
      initiatorOrigin = extractOrigin(rawInitiator);
    }
    if (initiatorOrigin && this.isSiteAllowlisted(initiatorOrigin, profileId)) {
      return false;
    }

    const fastParsed = fastParseHttpUrl(urlStr);
    let parsedUrl = null;
    if (!fastParsed) {
      try {
        parsedUrl = new URL(urlStr);
      } catch (_) {}
    }

    if (fastParsed || parsedUrl) {
      const host = fastParsed ? fastParsed.host : parsedUrl.hostname.toLowerCase();
      const pathname = fastParsed ? fastParsed.pathname : parsedUrl.pathname.toLowerCase();

      // Check tracker domains first so tracker domains are never blocked when trackerBlockEnabled is off
      const trackerHit = matchHostInIndex(host, pathname, TRACKER_INDEX);
      if (trackerHit) {
        return trackersEnabled ? { blocked: true, reason: trackerHit, category: 'tracker' } : false;
      }

      const adHit = matchHostInIndex(host, pathname, AD_INDEX);
      if (adHit) {
        return { blocked: true, reason: adHit, category: 'ad' };
      }
    } else {
      const lower = urlStr.toLowerCase();
      for (const domain of TRACKER_DOMAINS) {
        if (matchesDomainRule(null, lower, domain)) {
          return trackersEnabled ? { blocked: true, reason: domain, category: 'tracker' } : false;
        }
      }
      for (const domain of AD_DOMAINS) {
        if (matchesDomainRule(null, lower, domain)) {
          return { blocked: true, reason: domain, category: 'ad' };
        }
      }
    }

    if (AD_URL_COMBINED_RE.test(urlStr)) {
      const matchedPat = AD_URL_PATTERNS.find((p) => p.test(urlStr));
      return { blocked: true, reason: matchedPat ? matchedPat.source : 'ad-pattern', category: 'ad' };
    }

    if (trackersEnabled && TRACKER_URL_COMBINED_RE.test(urlStr)) {
      const matchedPat = TRACKER_URL_PATTERNS.find((p) => p.test(urlStr));
      return { blocked: true, reason: matchedPat ? matchedPat.source : 'tracker-pattern', category: 'tracker' };
    }

    return false;
  }

  _recordSiteBlocked(origin) {
    const norm = extractOrigin(origin);
    if (!norm) return 0;
    const next = (this.perSiteBlocked.get(norm) || 0) + 1;
    this.perSiteBlocked.delete(norm);
    this.perSiteBlocked.set(norm, next);
    if (this.perSiteBlocked.size > MAX_PER_SITE_ORIGINS) {
      const oldestKey = this.perSiteBlocked.keys().next().value;
      if (oldestKey !== undefined) {
        this.perSiteBlocked.delete(oldestKey);
      }
    }
    return next;
  }

  getSiteBlockedCount(origin) {
    const norm = extractOrigin(origin);
    if (!norm) return 0;
    return this.perSiteBlocked.get(norm) || 0;
  }

  getPerSiteCounts() {
    const entries = Array.from(this.perSiteBlocked.entries()).reverse();
    const perSite = {};
    for (const [origin, count] of entries) {
      perSite[origin] = count;
    }
    return perSite;
  }

  attachToSession(ses, profileId) {
    if (!ses) return;
    if (profileId) this.sessionProfiles.set(ses, profileId);
    if (this.attachedSessions.has(ses)) return;
    this.attachedSessions.add(ses);

    ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
      const pid = this.sessionProfiles.get(ses);
      const initiatorOrigin = extractOrigin(details.initiatorOrigin || details.initiator);
      const match = this.shouldBlock(details.url, details.resourceType, initiatorOrigin, {
        initiatorNormalized: true,
        profileId: pid
      });
      if (match && match.blocked) {
        this.sessionBlocked += 1;
        const total = this.storage.incrementBlockedCount(1);

        if (initiatorOrigin) {
          this._recordSiteBlocked(initiatorOrigin);
        }

        const fastHost = fastParseHttpUrl(details.url);
        let host = fastHost ? fastHost.host : match.reason;
        if (!fastHost) {
          try {
            host = new URL(details.url).hostname;
          } catch (_) {}
        }

        this.recentBlocked.unshift({
          host,
          type: details.resourceType,
          category: match.category || 'ad',
          origin: initiatorOrigin || '',
          time: Date.now()
        });
        if (this.recentBlocked.length > 25) {
          this.recentBlocked.length = 25;
        }

        if (typeof this.onBlockedCallback === 'function') {
          this.onBlockedCallback({
            _deltaOnly: true,
            totalBlocked: total,
            lastBlockedHost: host,
            lastBlockedOrigin: initiatorOrigin || ''
          });
        }

        return callback({ cancel: true });
      }
      return callback({ cancel: false });
    });
  }

  _ensureCosmeticState(webContents) {
    let state = this.cosmeticState.get(webContents);
    if (!state) {
      state = { keys: new Set(), injecting: false, generation: 0 };
      this.cosmeticState.set(webContents, state);
      if (typeof webContents.once === 'function') {
        webContents.once('destroyed', () => {
          this.cosmeticState.delete(webContents);
        });
      }
    }
    return state;
  }

  clearCosmeticKeys(webContents) {
    if (!webContents) return;
    const state = this.cosmeticState.get(webContents);
    if (state) {
      state.generation += 1;
      state.injecting = false;
      state.keys.clear();
    }
  }

  injectCosmeticFilters(webContents) {
    if (!webContents || webContents.isDestroyed()) return Promise.resolve(false);
    let url = '';
    try {
      url = webContents.getURL();
    } catch (_) {
      return Promise.resolve(false);
    }
    const origin = extractOrigin(url);
    const pid = webContents.session ? this.sessionProfiles.get(webContents.session) : undefined;
    if (!this.shouldInjectCosmetic(origin, pid)) return Promise.resolve(false);

    const state = this._ensureCosmeticState(webContents);
    if (state.keys.size > 0 || state.injecting) {
      return Promise.resolve(true);
    }

    const gen = state.generation;
    state.injecting = true;

    return webContents
      .insertCSS(COSMETIC_AD_CSS)
      .then((key) => {
        state.injecting = false;
        if (webContents.isDestroyed()) {
          this.cosmeticState.delete(webContents);
          return false;
        }
        let currentOrigin = '';
        try {
          currentOrigin = extractOrigin(webContents.getURL());
        } catch (_) {}
        const currentPid = webContents.session ? this.sessionProfiles.get(webContents.session) : pid;
        if (state.generation !== gen || !this.shouldInjectCosmetic(currentOrigin, currentPid)) {
          if (key && typeof webContents.removeInsertedCSS === 'function') {
            webContents.removeInsertedCSS(key).catch(() => {});
          }
          return false;
        }
        if (key) {
          state.keys.add(key);
        }
        return true;
      })
      .catch(() => {
        state.injecting = false;
        return false;
      });
  }

  async removeCosmeticFilters(webContents) {
    if (!webContents || webContents.isDestroyed()) {
      this.cosmeticState.delete(webContents);
      return { removed: false, reloaded: false };
    }
    const state = this.cosmeticState.get(webContents);
    if (!state) return { removed: false, reloaded: false };

    state.generation += 1;
    state.injecting = false;
    const keys = Array.from(state.keys);
    state.keys.clear();
    if (!keys.length) return { removed: false, reloaded: false };

    let removed = false;
    let failed = false;
    for (const key of keys) {
      try {
        if (typeof webContents.removeInsertedCSS === 'function') {
          await webContents.removeInsertedCSS(key);
          removed = true;
        } else {
          failed = true;
        }
      } catch (_) {
        failed = true;
      }
    }

    if (failed && !webContents.isDestroyed()) {
      try {
        webContents.reload();
        return { removed, reloaded: true };
      } catch (_) {}
    }

    return { removed, reloaded: false };
  }

  async removeCosmeticFiltersForOrigin(origin) {
    const norm = extractOrigin(origin);
    if (!norm) return;
    const tasks = [];
    for (const wc of Array.from(this.cosmeticState.keys())) {
      if (!wc || wc.isDestroyed()) {
        this.cosmeticState.delete(wc);
        continue;
      }
      let wcOrigin = '';
      try {
        wcOrigin = extractOrigin(wc.getURL());
      } catch (_) {}
      if (wcOrigin === norm) {
        tasks.push(this.removeCosmeticFilters(wc));
      }
    }
    await Promise.all(tasks);
  }

  async removeCosmeticFiltersForAll() {
    const tasks = [];
    for (const wc of Array.from(this.cosmeticState.keys())) {
      if (!wc || wc.isDestroyed()) {
        this.cosmeticState.delete(wc);
        continue;
      }
      tasks.push(this.removeCosmeticFilters(wc));
    }
    await Promise.all(tasks);
  }

  async syncCosmeticFilters(webContentsList, targetOrigin = '') {
    const normTarget = targetOrigin ? extractOrigin(targetOrigin) : '';
    const seen = new Set();
    const candidates = [];

    for (const wc of webContentsList || []) {
      if (wc && !seen.has(wc)) {
        seen.add(wc);
        candidates.push(wc);
      }
    }
    for (const wc of this.cosmeticState.keys()) {
      if (wc && !seen.has(wc)) {
        seen.add(wc);
        candidates.push(wc);
      }
    }

    const tasks = [];
    for (const wc of candidates) {
      if (wc.isDestroyed()) {
        this.cosmeticState.delete(wc);
        continue;
      }
      let wcOrigin = '';
      try {
        wcOrigin = extractOrigin(wc.getURL());
      } catch (_) {}
      if (!wcOrigin) continue;
      if (normTarget && wcOrigin !== normTarget) continue;

      const wcPid = wc.session ? this.sessionProfiles.get(wc.session) : undefined;
      if (this.shouldInjectCosmetic(wcOrigin, wcPid)) {
        tasks.push(this.injectCosmeticFilters(wc));
      } else {
        tasks.push(this.removeCosmeticFilters(wc));
      }
    }
    await Promise.all(tasks);
  }

  getStats() {
    const settings = this.storage.getSettings();
    const adsEnabled = Boolean(settings.adblockEnabled);
    const trackersEnabled =
      adsEnabled &&
      (typeof settings.trackerBlockEnabled === 'boolean'
        ? settings.trackerBlockEnabled
        : true);
    return {
      enabled: adsEnabled,
      trackerBlockEnabled: trackersEnabled,
      sessionBlocked: this.sessionBlocked,
      totalBlocked: settings.totalAdsBlocked || 0,
      recentBlocked: this.recentBlocked,
      perSite: this.getPerSiteCounts()
    };
  }
}

module.exports = {
  AdBlocker,
  AD_DOMAINS,
  TRACKER_DOMAINS,
  AD_URL_PATTERNS,
  TRACKER_URL_PATTERNS,
  COSMETIC_AD_CSS,
  extractOrigin
};
