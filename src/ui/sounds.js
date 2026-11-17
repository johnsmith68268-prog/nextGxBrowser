// Opera GX-style Subtle UI Sound Effects via Web Audio API

class GXSoundEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.35;
  }

  setConfig({ enabled, volume }) {
    if (typeof enabled === 'boolean') this.enabled = enabled;
    if (typeof volume === 'number') this.volume = Math.max(0, Math.min(1, volume));
  }

  _ensureCtx() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  _playTone(freqStart, freqEnd, duration = 0.06, type = 'sine', gainScale = 0.18) {
    if (!this.enabled || this.volume <= 0) return;
    const ctx = this._ensureCtx();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), now + duration);

    const amp = this.volume * gainScale;
    gain.gain.setValueAtTime(amp, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.01);
  }

  playClick() {
    this._playTone(520, 320, 0.04, 'triangle', 0.14);
  }

  playTabOpen() {
    this._playTone(440, 680, 0.08, 'sine', 0.16);
  }

  playTabClose() {
    this._playTone(420, 210, 0.08, 'sine', 0.15);
  }

  playPanelOpen() {
    this._playTone(300, 480, 0.09, 'triangle', 0.14);
  }

  playShutter() {
    this._playTone(900, 260, 0.1, 'square', 0.12);
  }
}

window.gxSounds = new GXSoundEngine();
