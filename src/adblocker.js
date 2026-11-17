// Built-in Engine-Level Ad & Tracker Blocker (EasyList & EasyPrivacy rules + Cosmetic CSS)

const BLOCKED_DOMAINS = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'adservice.google.com',
  'pagead2.googlesyndication.com',
  'tpc.googlesyndication.com',
  'google-analytics.com',
  'googletagmanager.com',
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
  'moatads.com',
  'scorecardresearch.com',
  'quantserve.com',
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
  'connect.facebook.net/en_US/fbevents.js',
  'pixel.facebook.com',
  'an.facebook.com',
  'analytics.tiktok.com',
  'ads-twitter.com',
  'static.ads-twitter.com',
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
  'Appsflyer.com',
  'adjust.com',
  'branch.io',
  'kochava.com'
];

const BLOCKED_URL_PATTERNS = [
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
  /\/ analytics\.js/i,
  /\/gtag\/js/i,
  /[?&](?:ad_id|ad_type|ad_slot|adunit|banner_id)=/i
];

const COSMETIC_AD_CSS = `
  /* GX Browser Built-in AdBlocker Cosmetic Filters */
  ins.adsbygoogle,
  iframe[id^="google_ads_"],
  div[id^="google_ads_"],
  div[id^="div-gpt-ad"],
  [class*="ad-container"]:not(body):not(html),
  [class*="ad-banner"]:not(body):not(html),
  [id*="taboola-"],
  [class*="taboola-"],
  [id*="outbrain_"],
  [class*="outbrain-"],
  .ad-slot,
  .ad-leaderboard,
  .advertisement-banner,
  ytd-companion-slot-renderer,
  ytd-action-companion-ad-renderer,
  ytd-Watch-next-secondary-results-renderer > ytd-compact-promoted-video-renderer,
  ytd-promoted-sparkles-web-renderer,
  ytd-ad-slot-renderer,
  ytd-in-feed-ad-layout-renderer,
  ytd-banner-promo-renderer,
  .ytp-ad-overlay-container,
  .ytp-ad-message-container {
    display: none !important;
    height: 0 !important;
    min-height: 0 !important;
    pointer-events: none !important;
    visibility: hidden !important;
  }
`;

class AdBlocker {
  constructor(storage, onBlockedCallback) {
    this.storage = storage;
    this.onBlockedCallback = onBlockedCallback;
    this.sessionBlocked = 0;
    this.recentBlocked = [];
    this.attachedSessions = new WeakSet();
  }

  isEnabled() {
    const settings = this.storage.getSettings();
    return Boolean(settings.adblockEnabled);
  }

  shouldBlock(urlStr, resourceType) {
    if (!this.isEnabled()) return false;
    if (!urlStr || urlStr.startsWith('file://') || urlStr.startsWith('data:') || urlStr.startsWith('devtools://')) {
      return false;
    }
    // Never block main top-level navigation documents unless it's a known popup ad domain
    if (resourceType === 'mainFrame') {
      return false;
    }

    const lower = urlStr.toLowerCase();

    for (const domain of BLOCKED_DOMAINS) {
      if (
        lower.includes(`://${domain}`) ||
        lower.includes(`.${domain}/`) ||
        lower.includes(`.${domain}?`) ||
        lower.endsWith(`.${domain}`)
      ) {
        return { blocked: true, reason: domain };
      }
    }

    for (const pattern of BLOCKED_URL_PATTERNS) {
      if (pattern.test(urlStr)) {
        return { blocked: true, reason: pattern.source };
      }
    }

    return false;
  }

  attachToSession(ses) {
    if (!ses || this.attachedSessions.has(ses)) return;
    this.attachedSessions.add(ses);

    ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
      const match = this.shouldBlock(details.url, details.resourceType);
      if (match && match.blocked) {
        this.sessionBlocked += 1;
        const total = this.storage.incrementBlockedCount(1);

        let host = match.reason;
        try {
          host = new URL(details.url).hostname;
        } catch (_) {}

        this.recentBlocked.unshift({
          host,
          type: details.resourceType,
          time: Date.now()
        });
        if (this.recentBlocked.length > 25) {
          this.recentBlocked.length = 25;
        }

        if (typeof this.onBlockedCallback === 'function') {
          this.onBlockedCallback({
            sessionBlocked: this.sessionBlocked,
            totalBlocked: total,
            lastBlockedHost: host,
            recentBlocked: this.recentBlocked
          });
        }

        return callback({ cancel: true });
      }
      return callback({ cancel: false });
    });
  }

  injectCosmeticFilters(webContents) {
    if (!this.isEnabled() || !webContents || webContents.isDestroyed()) return;
    webContents.insertCSS(COSMETIC_AD_CSS).catch(() => {});
  }

  getStats() {
    const settings = this.storage.getSettings();
    return {
      enabled: Boolean(settings.adblockEnabled),
      sessionBlocked: this.sessionBlocked,
      totalBlocked: settings.totalAdsBlocked || 0,
      recentBlocked: this.recentBlocked
    };
  }
}

module.exports = { AdBlocker };
