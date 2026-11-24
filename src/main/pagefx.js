// nextGx page effects (Shaders + RGX-like video enhance) — pure helpers.
//
// Shaders are CSS `filter` presets applied to the page; video enhance is a
// CSS `filter` preset applied to <video> elements. Both are pure CSS, so
// they degrade gracefully with no GPU: without GPU acceleration Chromium
// still renders CSS filters in software — pages never break, they just
// render slower. There is NO AI upscaling here: the video preset is
// honestly labelled "Enhance (filter)" in settings, it only adjusts
// contrast / saturation / brightness.
//
// The preset tables are duplicated (small, by design) in src/tab-preload.js,
// which is sandboxed and cannot require() relative modules — the same
// pattern as the YouTube adstrip. Keep the two in sync; the tests assert
// the contract (every preset maps to a filter string, unknown -> '').

const PAGE_FX_STYLE_ID = 'nextgx-pagefx-style';

const SHADER_PRESETS = {
  none: '',
  grayscale: 'grayscale(1)',
  sepia: 'sepia(1)',
  warm: 'sepia(0.35) saturate(1.2) hue-rotate(-10deg)',
  cool: 'hue-rotate(15deg) saturate(1.1)',
  'high-contrast': 'contrast(1.35) saturate(1.1)',
  vignette: 'contrast(1.05) brightness(0.97)',
  night: 'brightness(0.85) contrast(1.05)'
};

// 'Enhance (filter)' — CSS-filter video presets. NOT AI upscaling.
const VIDEO_ENHANCE_PRESETS = {
  off: '',
  sharp: 'contrast(1.15) saturate(1.15) brightness(1.05)',
  vivid: 'contrast(1.2) saturate(1.5) brightness(1.03)',
  cinema: 'contrast(1.1) saturate(0.9) brightness(0.98) sepia(0.15)'
};

function isValidShaderPreset(preset) {
  return typeof preset === 'string' && Object.prototype.hasOwnProperty.call(SHADER_PRESETS, preset);
}

function isValidVideoEnhancePreset(preset) {
  return typeof preset === 'string' && Object.prototype.hasOwnProperty.call(VIDEO_ENHANCE_PRESETS, preset);
}

function shaderFilterForPreset(preset) {
  return isValidShaderPreset(preset) ? SHADER_PRESETS[preset] : '';
}

function videoFilterForPreset(preset) {
  return isValidVideoEnhancePreset(preset) ? VIDEO_ENHANCE_PRESETS[preset] : '';
}

// CSS injected (as a <style> element by tab-preload) for the page shader.
// Vignette needs an overlay as well as a filter, so it appends a fixed,
// pointer-events:none radial-gradient ::after on <html>.
function buildPageFxCss(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const shader = isValidShaderPreset(s.shaderPreset) ? s.shaderPreset : 'none';
  const filter = SHADER_PRESETS[shader];
  if (!filter) return '';
  let css = `html { filter: ${filter} !important; }`;
  if (shader === 'vignette') {
    css +=
      ' html::after { content: ""; position: fixed; inset: 0; pointer-events: none; ' +
      'background: radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.35) 100%); z-index: 2147483647; }';
  }
  return css;
}

function sanitizePageFxSettings(partial) {
  const s = partial && typeof partial === 'object' ? partial : {};
  return {
    shaderPreset: isValidShaderPreset(s.shaderPreset) ? s.shaderPreset : 'none',
    videoEnhancePreset: isValidVideoEnhancePreset(s.videoEnhancePreset)
      ? s.videoEnhancePreset
      : 'off'
  };
}

module.exports = {
  PAGE_FX_STYLE_ID,
  SHADER_PRESETS,
  VIDEO_ENHANCE_PRESETS,
  isValidShaderPreset,
  isValidVideoEnhancePreset,
  shaderFilterForPreset,
  videoFilterForPreset,
  buildPageFxCss,
  sanitizePageFxSettings
};
