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
    this._playToneAt(0, freqStart, freqEnd, duration, type, gainScale);
  }

  _playToneAt(startOffset, freqStart, freqEnd, duration = 0.06, type = 'sine', gainScale = 0.18) {
    if (!this.enabled || this.volume <= 0) return;
    const ctx = this._ensureCtx();
    if (!ctx) return;

    const start = ctx.currentTime + Math.max(0, startOffset);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), start + duration);

    const amp = this.volume * gainScale;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(amp, start + Math.min(0.008, duration * 0.25));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.01);
  }

  playClick() {
    this._playTone(520, 320, 0.04, 'triangle', 0.14);
  }

  playKeyTick() {
    if (this.volume <= 0) return;
    const prev = this.enabled;
    this.enabled = true;
    try {
      this._playTone(620, 380, 0.025, 'triangle', 0.1);
    } finally {
      this.enabled = prev;
    }
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

  playNotification() {
    if (!this.enabled || this.volume <= 0) return;
    this._playToneAt(0, 587.33, 659.25, 0.08, 'sine', 0.14);
    this._playToneAt(0.07, 880, 932.33, 0.12, 'triangle', 0.12);
  }
}

window.gxSounds = new GXSoundEngine();
