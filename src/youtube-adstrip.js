// YouTube player-response ad stripping (pure module — no Electron/Node APIs).
//
// Why this exists: YouTube video ads are NOT served from a blockable ad
// domain. The video and its ads come from the same first-party
// `googlevideo.com` hosts, so domain blocking would break playback.
// What YouTube *does* expose is the ad schedule itself, inside the
// `/youtubei/v1/player` (and `/youtubei/v1/next`) JSON responses:
// `adPlacements`, `adSlots` and `playerAds`. Stripping those fields from
// the response before the player reads it removes the ad breaks from the
// schedule, while the video streams themselves are untouched.
//
// This module is deliberately pure and self-contained (no external
// references) so the preload can inject its source into the page's main
// world via `Function.prototype.toString` — see src/tab-preload.js.
//
// What it does NOT do (honest limits):
// - Ads baked into the initial HTML (`ytInitialPlayerResponse` embedded in
//   the page) are not reachable from a network hook; the cosmetic CSS in
//   src/adblocker.js hides companion/overlay ad elements instead.
// - It cannot block `googlevideo.com` ad segments: they are
//   indistinguishable from video segments at request time.
// - YouTube changes its player API shape often; the stripper removes
//   every known ad field wherever it appears (deep walk), so a renamed
//   field degrades to "ads show again" rather than breaking playback.

const YT_AD_FIELD_NAMES = [
  'adPlacements',
  'adSlots',
  'playerAds',
  'adBreaks',
  'adBreak',
  'adBreakParams',
  'adBreakHeartbeatParams',
  'adInfo',
  'adSlotLoggingData',
  'adPlacementsRenderer',
  'playerLegacyDesktopWatchAdsRenderer',
  'instreamVideoAdRenderer',
  'linearAdSequenceRenderer',
  'mastheadAdRenderer',
  'adSlotRenderer'
];

// Keys inside a playback-tracking / ad-tracking payload. Removing the
// whole `adPlacements` array covers these, but they are also stripped
// when they appear on their own so a partial response cannot re-arm ads.
const YT_AD_TRACKING_KEYS = ['adPlacements', 'adSlots', 'playerAds'];

// youtubei endpoints whose JSON may carry an ad schedule or feed/shorts ads.
const YT_PLAYER_ENDPOINTS = [
  '/youtubei/v1/player',
  '/youtubei/v1/next',
  '/youtubei/v1/browse',
  '/youtubei/v1/search',
  '/youtubei/v1/reel/'
];

function isYouTubeHost(hostname) {
  if (!hostname || typeof hostname !== 'string') return false;
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return (
    host === 'youtube.com' ||
    host === 'www.youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'music.youtube.com' ||
    host === 'youtube-nocookie.com' ||
    host === 'www.youtube-nocookie.com' ||
    host.endsWith('.youtube.com') ||
    host.endsWith('.youtube-nocookie.com')
  );
}

function isYouTubePlayerEndpoint(url) {
  if (!url || typeof url !== 'string') return false;
  for (const ep of YT_PLAYER_ENDPOINTS) {
    if (url.indexOf(ep) !== -1) return true;
  }
  return false;
}

// True for the ad-telemetry beacons the player fires when an ad plays.
// These carry no video data; the engine blocker also blocks them
// (see AD_URL_PATTERNS in src/adblocker.js), so dropping them here too
// is belt-and-braces and never affects playback.
function isYouTubeAdStatsUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return (
    url.indexOf('/api/stats/ads') !== -1 ||
    url.indexOf('/pagead/') !== -1
  );
}

// Deep-strip ad fields from a parsed player/next/browse response.
// Returns { data, stripped } — `stripped` counts removed ad entries.
// Never throws: on any unexpected shape it returns the input untouched.
function stripYouTubePlayerResponse(input) {
  let stripped = 0;
  if (!input || typeof input !== 'object') {
    return { data: input, stripped: 0 };
  }

  function stripValue(value, depth) {
    if (!value || typeof value !== 'object' || depth > 24) return value;
    if (Array.isArray(value)) {
      const out = [];
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        if (
          item &&
          typeof item === 'object' &&
          ((item.richItemRenderer &&
            item.richItemRenderer.content &&
            item.richItemRenderer.content.adSlotRenderer) ||
            item.adSlotRenderer ||
            item.inFeedAdLayoutRenderer ||
            item.mastheadAdRenderer ||
            item.promotedSparklesWebRenderer ||
            item.compactPromotedVideoRenderer)
        ) {
          stripped += 1;
          continue;
        }
        out.push(stripValue(item, depth + 1));
      }
      return out;
    }
    for (const key of Object.keys(value)) {
      if (YT_AD_FIELD_NAMES.indexOf(key) !== -1) {
        const removed = value[key];
        if (Array.isArray(removed)) stripped += removed.length;
        else if (removed) stripped += 1;
        delete value[key];
        continue;
      }
      if (key === 'adTrackingParams' || key === 'adInfoRenderer') {
        stripped += 1;
        delete value[key];
        continue;
      }
      value[key] = stripValue(value[key], depth + 1);
    }
    return value;
  }

  let data = input;
  try {
    data = stripValue(input, 0);
  } catch (_) {
    return { data: input, stripped: 0 };
  }
  return { data, stripped };
}

// Strip a raw JSON string (e.g. a fetched response body). Returns the
// original string unchanged when it is not valid JSON or contains no
// ad fields, so the caller can pass the body through untouched.
function stripYouTubePlayerResponseText(text) {
  if (!text || typeof text !== 'string') return { text, stripped: 0 };
  if (
    text.indexOf('adPlacement') === -1 &&
    text.indexOf('playerAds') === -1 &&
    text.indexOf('adSlots') === -1 &&
    text.indexOf('adSlotRenderer') === -1 &&
    text.indexOf('adSlotLoggingData') === -1 &&
    text.indexOf('adBreak') === -1 &&
    text.indexOf('mastheadAdRenderer') === -1 &&
    text.indexOf('instreamVideoAdRenderer') === -1 &&
    text.indexOf('linearAdSequenceRenderer') === -1 &&
    text.indexOf('inFeedAdLayoutRenderer') === -1 &&
    text.indexOf('promotedSparklesWebRenderer') === -1 &&
    text.indexOf('compactPromotedVideoRenderer') === -1 &&
    text.indexOf('adTrackingParams') === -1 &&
    text.indexOf('adInfo') === -1
  ) {
    return { text, stripped: 0 };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    return { text, stripped: 0 };
  }
  const result = stripYouTubePlayerResponse(parsed);
  if (!result.stripped) return { text, stripped: 0 };
  try {
    return { text: JSON.stringify(result.data), stripped: result.stripped };
  } catch (_) {
    return { text, stripped: 0 };
  }
}

module.exports = {
  YT_AD_FIELD_NAMES,
  YT_AD_TRACKING_KEYS,
  YT_PLAYER_ENDPOINTS,
  isYouTubeHost,
  isYouTubePlayerEndpoint,
  isYouTubeAdStatsUrl,
  stripYouTubePlayerResponse,
  stripYouTubePlayerResponseText
};
