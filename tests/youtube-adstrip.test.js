const assert = require('node:assert/strict');
const test = require('node:test');
const {
  isYouTubeHost,
  isYouTubePlayerEndpoint,
  isYouTubeAdStatsUrl,
  stripYouTubePlayerResponse,
  stripYouTubePlayerResponseText
} = require('../src/youtube-adstrip');
const { AdBlocker } = require('../src/adblocker');

function samplePlayerResponse() {
  return {
    responseContext: { serviceTrackingParams: [{ service: 'GFEEDBACK' }] },
    playabilityStatus: { status: 'OK', playableInEmbed: true },
    streamingData: {
      formats: [{ itag: 18, url: 'https://rr1---sn.googlevideo.com/videoplayback?id=abc' }],
      adaptiveFormats: []
    },
    videoDetails: { videoId: 'dQw4w9WgXcQ', title: 'Test Video', lengthSeconds: '212' },
    playerAds: [{ playerAdRenderer: { adId: 'ad-1' } }],
    adPlacements: [
      { adPlacementRenderer: { config: { adPlacementConfig: { kind: 'AD_PLACEMENT_KIND_PREROLL' } } } },
      { adPlacementRenderer: { config: { adPlacementConfig: { kind: 'AD_PLACEMENT_KIND_MIDROLL' } } } }
    ],
    adSlots: [{ adSlotRenderer: { adSlotLoggingData: { serializedSlotAdServingDataEntry: 'x' } } }],
    playbackTracking: { videostatsPlaybackUrl: { baseUrl: 'https://www.youtube.com/api/stats/playback?' } }
  };
}

test('YT-1: stripYouTubePlayerResponse removes ad schedule but keeps the video', () => {
  const input = samplePlayerResponse();
  const { data, stripped } = stripYouTubePlayerResponse(input);
  assert.equal(stripped, 4, 'expected 2 adPlacements + 1 adSlots + 1 playerAds stripped');
  assert.equal(data.adPlacements, undefined);
  assert.equal(data.adSlots, undefined);
  assert.equal(data.playerAds, undefined);
  // Video payload untouched
  assert.equal(data.playabilityStatus.status, 'OK');
  assert.equal(data.videoDetails.videoId, 'dQw4w9WgXcQ');
  assert.equal(data.streamingData.formats[0].itag, 18);
  assert.match(data.streamingData.formats[0].url, /googlevideo\.com/);
  assert.equal(data.playbackTracking.videostatsPlaybackUrl.baseUrl.includes('stats/playback'), true);
});

test('YT-2: stripper is a no-op (stripped=0) on a clean response and never throws on junk', () => {
  const clean = { playabilityStatus: { status: 'OK' }, videoDetails: { videoId: 'abc' } };
  const { data, stripped } = stripYouTubePlayerResponse(clean);
  assert.equal(stripped, 0);
  assert.deepEqual(data, clean);
  for (const junk of [null, undefined, 42, 'str', [], { a: { b: [null, { adPlacements: 'not-an-array' }] } }]) {
    const r = stripYouTubePlayerResponse(junk);
    assert.equal(typeof r.stripped, 'number');
  }
  // Nested ad fields are found at any depth
  const nested = { a: { b: { c: { adPlacements: [{ x: 1 }, { x: 2 }] } } }, keep: 1 };
  const r2 = stripYouTubePlayerResponse(nested);
  assert.equal(r2.stripped, 2);
  assert.equal(r2.data.keep, 1);
  assert.equal(r2.data.a.b.c.adPlacements, undefined);
});

test('YT-3: stripYouTubePlayerResponseText round-trips JSON and passes clean text through', () => {
  const text = JSON.stringify(samplePlayerResponse());
  const { text: out, stripped } = stripYouTubePlayerResponseText(text);
  assert.equal(stripped, 4);
  const parsed = JSON.parse(out);
  assert.equal(parsed.adPlacements, undefined);
  assert.equal(parsed.videoDetails.title, 'Test Video');
  assert.equal(stripYouTubePlayerResponseText('not json {').stripped, 0);
  assert.equal(stripYouTubePlayerResponseText('{"a":1}').stripped, 0);
});

test('YT-4: host / endpoint / stats-url classifiers', () => {
  for (const h of ['www.youtube.com', 'youtube.com', 'music.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com']) {
    assert.equal(isYouTubeHost(h), true, h);
  }
  for (const h of ['example.com', 'googlevideo.com', 'youtu.be', 'notyoutube.com']) {
    assert.equal(isYouTubeHost(h), false, h);
  }
  assert.equal(isYouTubePlayerEndpoint('https://www.youtube.com/youtubei/v1/player?key=abc'), true);
  assert.equal(isYouTubePlayerEndpoint('https://www.youtube.com/youtubei/v1/next?key=abc'), true);
  assert.equal(isYouTubePlayerEndpoint('https://www.youtube.com/watch?v=abc'), false);
  assert.equal(isYouTubeAdStatsUrl('https://www.youtube.com/api/stats/ads?adformat=1'), true);
  assert.equal(isYouTubeAdStatsUrl('https://www.youtube.com/api/stats/playback?ns=yt'), false);
});

test('YT-5: engine blocker drops YouTube ad beacons but never blocks googlevideo playback', () => {
  const settings = { adblockEnabled: true, trackerBlockEnabled: true };
  const fakeStorage = {
    getSettings: () => settings,
    getAdblockSite: () => ({ hasOverride: false, enabled: true })
  };
  const blocker = new AdBlocker(fakeStorage);
  const ads = blocker.shouldBlock('https://www.youtube.com/api/stats/ads?adformat=15', 'xmlhttprequest', 'https://www.youtube.com');
  assert.equal(ads && ads.blocked, true);
  assert.equal(ads.category, 'ad');
  // Video segments must never be blocked — this is the whole point.
  for (const u of [
    'https://rr1---sn.googlevideo.com/videoplayback?expire=1&id=abc&itag=22',
    'https://www.youtube.com/youtubei/v1/player?key=AIzaSy',
    'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
  ]) {
    assert.equal(blocker.shouldBlock(u, 'xmlhttprequest', 'https://www.youtube.com'), false, u);
  }
  // Classic ad requests still blocked (regression guard for the local HTTP test server)
  const classic = blocker.shouldBlock('http://127.0.0.1:8123/pagead/test.png', 'image', 'http://127.0.0.1:8123/');
  assert.equal(classic && classic.blocked, true);
  const dc = blocker.shouldBlock('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', 'script', 'https://news.example');
  assert.equal(dc && dc.blocked, true);
});
