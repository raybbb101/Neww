// Procedural audio (WebAudio) — no asset files needed.
class AudioEngine {
  constructor() { this.ctx = null; this.musicMode = 'none'; this.volume = 0.8; this.musicVolume = 0.45; this._nextNote = 0; this._step = 0; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = this.volume; this.master.connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain(); this.sfxBus.connect(this.master);
    this.musicBus = this.ctx.createGain(); this.musicBus.gain.value = this.musicVolume; this.musicBus.connect(this.master);
    // simple reverb
    this.reverb = this.ctx.createConvolver(); this.reverb.buffer = this._impulse(2.2, 2.5);
    const rg = this.ctx.createGain(); rg.gain.value = 0.35; this.reverb.connect(rg); rg.connect(this.master);
    this.noiseBuf = this._noise(1.5);
    this.ambGain = this.ctx.createGain(); this.ambGain.gain.value = 0; this.ambGain.connect(this.master);
    const n = this.ctx.createBufferSource(); n.buffer = this._noise(4, true); n.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
    n.connect(f); f.connect(this.ambGain); n.start();
    this.ambFilter = f;
  }
  _noise(sec, brown) {
    const len = Math.floor(this.ctx.sampleRate * sec), b = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
    return b;
  }
  _impulse(sec, decay) {
    const len = Math.floor(this.ctx.sampleRate * sec), b = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return b;
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  setMusicVolume(v) { this.musicVolume = v; if (this.musicBus) this.musicBus.gain.value = v; }
  get t() { return this.ctx.currentTime; }

  tone({ f = 440, f2, type = 'sine', dur = 0.2, vol = 0.3, attack = 0.005, delay = 0, bus, rev = 0.2, filter, q = 1, curve }) {
    if (!this.ctx) return;
    const t0 = this.t + delay, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0);
    if (curve) o.frequency.setValueCurveAtTime(new Float32Array(curve.map((m) => f * m)), t0, dur);
    else if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = o;
    if (filter) { const fl = this.ctx.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = filter; fl.Q.value = q; o.connect(fl); node = fl; }
    node.connect(g); g.connect(bus || this.sfxBus);
    if (rev) { const rg = this.ctx.createGain(); rg.gain.value = rev; g.connect(rg); rg.connect(this.reverb); }
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  noise({ dur = 0.2, vol = 0.3, f = 1200, f2, type = 'bandpass', q = 1, delay = 0, rev = 0.1, attack = 0.004 }) {
    if (!this.ctx) return;
    const t0 = this.t + delay, s = this.ctx.createBufferSource(), fl = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    s.buffer = this.noiseBuf; fl.type = type; fl.frequency.setValueAtTime(f, t0); fl.Q.value = q;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(fl); fl.connect(g); g.connect(this.sfxBus);
    if (rev) { const rg = this.ctx.createGain(); rg.gain.value = rev; g.connect(rg); rg.connect(this.reverb); }
    s.start(t0, Math.random() * 0.5); s.stop(t0 + dur + 0.05);
  }

  sfx(name, opt = {}) {
    if (!this.ctx) return;
    const v = opt.vol ?? 1;
    switch (name) {
      case 'step': this.noise({ dur: 0.06, vol: 0.05 * v, f: 900 + Math.random() * 600, q: 0.8, rev: 0 }); break;
      case 'jump': this.noise({ dur: 0.15, vol: 0.08 * v, f: 500, f2: 1500, q: 1.5 }); break;
      case 'land': this.noise({ dur: 0.12, vol: 0.1 * v, f: 300, f2: 120, type: 'lowpass' }); break;
      case 'flap': this.noise({ dur: 0.12, vol: 0.07 * v, f: 700, f2: 300, q: 0.7, rev: 0 }); break;
      case 'eat': for (let i = 0; i < 3; i++) this.noise({ dur: 0.05, vol: 0.12, f: 2500, q: 2, delay: i * 0.11 }); break;
      case 'happy': [0, 4, 7, 12].forEach((s, i) => this.tone({ f: 523 * 2 ** (s / 12), type: 'triangle', dur: 0.25, vol: 0.12, delay: i * 0.07 })); break;
      case 'sad': [0, -3, -7].forEach((s, i) => this.tone({ f: 392 * 2 ** (s / 12), type: 'triangle', dur: 0.3, vol: 0.1, delay: i * 0.12 })); break;
      case 'pickup': [0, 7, 12, 19].forEach((s, i) => this.tone({ f: 660 * 2 ** (s / 12), type: 'sine', dur: 0.35, vol: 0.12, delay: i * 0.06, rev: 0.5 })); break;
      case 'shard': [0, 5, 9, 12, 17, 21, 24].forEach((s, i) => this.tone({ f: 440 * 2 ** (s / 12), type: 'sine', dur: 0.8, vol: 0.09, delay: i * 0.08, rev: 0.8 })); break;
      case 'ui': this.tone({ f: 880, f2: 1100, type: 'sine', dur: 0.07, vol: 0.06, rev: 0 }); break;
      case 'uiBack': this.tone({ f: 700, f2: 500, type: 'sine', dur: 0.07, vol: 0.06, rev: 0 }); break;
      case 'swipe': this.noise({ dur: 0.14, vol: 0.18 * v, f: 2400, f2: 700, q: 1.2 }); break;
      case 'hit': this.noise({ dur: 0.12, vol: 0.25 * v, f: 500, f2: 150, type: 'lowpass' }); this.tone({ f: 180, f2: 60, type: 'square', dur: 0.1, vol: 0.08 * v, rev: 0 }); break;
      case 'crit': this.tone({ f: 1400, f2: 2200, type: 'sawtooth', dur: 0.12, vol: 0.05, filter: 1800 }); this.sfx('hit', { vol: 1.3 }); break;
      case 'hurt': this.tone({ f: 300, f2: 120, type: 'sawtooth', dur: 0.2, vol: 0.12, filter: 600, q: 2 }); break;
      case 'shoot': this.tone({ f: 900, f2: 300, type: 'triangle', dur: 0.18, vol: 0.1 }); break;
      case 'boom': this.noise({ dur: 0.7, vol: 0.4 * v, f: 800, f2: 60, type: 'lowpass', rev: 0.5 }); this.tone({ f: 90, f2: 35, type: 'sine', dur: 0.6, vol: 0.3 * v }); break;
      case 'skill': this.tone({ f: 400, f2: 900, type: 'triangle', dur: 0.25, vol: 0.1, rev: 0.6 }); break;
      case 'ult': [0, 7, 12, 19, 24].forEach((s, i) => this.tone({ f: 220 * 2 ** (s / 12), type: 'sawtooth', dur: 0.6, vol: 0.06, filter: 1600, q: 0.8, delay: i * 0.05, rev: 0.8 })); this.sfx('boom'); break;
      case 'heal': [0, 4, 7, 11, 14].forEach((s, i) => this.tone({ f: 660 * 2 ** (s / 12), type: 'sine', dur: 0.5, vol: 0.06, delay: i * 0.05, rev: 0.8 })); break;
      case 'dodge': this.noise({ dur: 0.2, vol: 0.12, f: 1200, f2: 3000, q: 0.8 }); break;
      case 'monsterDie': this.tone({ f: 600, f2: 60, type: 'sawtooth', dur: 0.6, vol: 0.1, filter: 900, q: 3, rev: 0.6 }); this.noise({ dur: 0.5, vol: 0.15, f: 3000, f2: 200 }); break;
      case 'monsterCry': this.tone({ f: 140 + Math.random() * 60, type: 'sawtooth', dur: 0.8, vol: 0.06, filter: 500, q: 6, curve: [1, 1.5, 0.8, 1.3, 0.6], rev: 0.9 }); break;
      case 'telegraph': this.tone({ f: 200, f2: 600, type: 'square', dur: 0.4, vol: 0.04, filter: 800, q: 4 }); break;
      case 'mist': this.tone({ f: 55, f2: 45, type: 'sawtooth', dur: 2.5, vol: 0.08, filter: 300, q: 4, attack: 0.6, rev: 1 }); this.tone({ f: 82, type: 'sine', dur: 2.5, vol: 0.08, attack: 0.8, rev: 1 }); break;
      case 'portal': this.noise({ dur: 1.6, vol: 0.25, f: 200, f2: 4000, q: 2, rev: 1, attack: 0.5 }); this.tone({ f: 60, f2: 400, type: 'sawtooth', dur: 1.6, vol: 0.08, filter: 700, attack: 0.4, rev: 1 }); break;
      case 'victory': [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => this.tone({ f: 392 * 2 ** (s / 12), type: 'triangle', dur: 0.7, vol: 0.1, delay: i * 0.09, rev: 0.7 })); break;
      case 'levelup': [0, 4, 7, 12].forEach((s, i) => { this.tone({ f: 523 * 2 ** (s / 12), type: 'square', dur: 0.4, vol: 0.05, filter: 2000, delay: i * 0.1, rev: 0.6 }); this.tone({ f: 1046 * 2 ** (s / 12), type: 'sine', dur: 0.5, vol: 0.05, delay: i * 0.1 + 0.03, rev: 0.6 }); }); break;
      case 'car': this.tone({ f: 330, type: 'square', dur: 0.25, vol: 0.05, filter: 900 }); this.tone({ f: 415, type: 'square', dur: 0.3, vol: 0.05, filter: 900, delay: 0.28 }); break;
      case 'splash': this.noise({ dur: 0.4, vol: 0.15, f: 1500, f2: 400, q: 0.6, rev: 0.3 }); break;
      case 'dig': this.noise({ dur: 0.1, vol: 0.12, f: 400, q: 0.8 }); this.noise({ dur: 0.1, vol: 0.12, f: 350, q: 0.8, delay: 0.18 }); break;
      case 'knock': this.tone({ f: 1800, type: 'sine', dur: 0.05, vol: 0.1 }); this.noise({ dur: 0.25, vol: 0.2, f: 3000, q: 3, delay: 0.35 }); break;
      case 'scream': this.tone({ f: 900, type: 'sawtooth', dur: 0.6, vol: 0.05, filter: 1400, q: 3, curve: [1, 1.3, 1.25, 1.1, 0.9] }); break;
      case 'laugh': for (let i = 0; i < 4; i++) this.tone({ f: 500 - i * 20, type: 'triangle', dur: 0.09, vol: 0.05, filter: 900, delay: i * 0.13 }); break;
    }
  }
  /** Species vocalisation */
  voice(kind) {
    if (!this.ctx) return;
    switch (kind) {
      case 'cat': this.tone({ f: 600, type: 'sawtooth', dur: 0.55, vol: 0.1, filter: 1100, q: 4, curve: [0.8, 1.15, 1.25, 1.05, 0.75], rev: 0.3 }); this.tone({ f: 1200, type: 'sine', dur: 0.5, vol: 0.04, curve: [0.8, 1.15, 1.2, 1, 0.75] }); break;
      case 'purr': for (let i = 0; i < 12; i++) this.noise({ dur: 0.05, vol: 0.06, f: 160, q: 2, type: 'lowpass', delay: i * 0.045 }); break;
      case 'hiss': this.noise({ dur: 0.6, vol: 0.18, f: 4500, q: 0.6, attack: 0.05 }); break;
      case 'dog': this.noise({ dur: 0.12, vol: 0.2, f: 700, q: 1.5 }); this.tone({ f: 330, f2: 220, type: 'sawtooth', dur: 0.15, vol: 0.12, filter: 800, q: 2 });
        this.noise({ dur: 0.12, vol: 0.2, f: 700, q: 1.5, delay: 0.22 }); this.tone({ f: 330, f2: 220, type: 'sawtooth', dur: 0.15, vol: 0.12, filter: 800, q: 2, delay: 0.22 }); break;
      case 'rabbit': this.tone({ f: 1800, f2: 2400, type: 'sine', dur: 0.06, vol: 0.05 }); this.noise({ dur: 0.08, vol: 0.12, f: 400, type: 'lowpass', delay: 0.1 }); this.noise({ dur: 0.08, vol: 0.12, f: 400, type: 'lowpass', delay: 0.22 }); break;
      case 'bird': for (let i = 0; i < 4; i++) this.tone({ f: 2400 + Math.random() * 1200, f2: 3600 + Math.random() * 800, type: 'sine', dur: 0.08, vol: 0.06, delay: i * 0.1, rev: 0.4 }); break;
      case 'snake': this.noise({ dur: 0.9, vol: 0.14, f: 5000, q: 0.5, attack: 0.15 }); break;
      case 'butterfly': [0, 7, 12, 16].forEach((s, i) => this.tone({ f: 1320 * 2 ** (s / 12), type: 'sine', dur: 0.6, vol: 0.04, delay: i * 0.05, rev: 0.9 })); break;
      case 'pigeon': this.tone({ f: 260, type: 'sine', dur: 0.4, vol: 0.05, curve: [1, 1.2, 0.9, 1.1, 0.8] }); break;
      case 'duck': this.tone({ f: 500, type: 'sawtooth', dur: 0.18, vol: 0.06, filter: 900, q: 5, curve: [1, 1.2, 0.8] }); break;
    }
  }
  setAmbient(level, cutoff = 380) {
    if (!this.ctx) return;
    this.ambGain.gain.setTargetAtTime(level, this.t, 0.8);
    this.ambFilter.frequency.setTargetAtTime(cutoff, this.t, 0.8);
  }
  setMusic(mode) { this.musicMode = mode; this._step = 0; if (this.ctx) this._nextNote = this.t + 0.1; }
  /** Generative music scheduler. Call every frame. */
  update() {
    if (!this.ctx || this.musicMode === 'none' || this.musicVolume <= 0.001) return;
    while (this._nextNote < this.t + 0.25) {
      const s = this._step++, t = this._nextNote - this.t;
      if (this.musicMode === 'city' || this.musicMode === 'night' || this.musicMode === 'menu') {
        const night = this.musicMode === 'night';
        const scale = [0, 2, 4, 7, 9, 12, 14, 16];
        const root = night ? 196 : 262;
        const chords = [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]];
        const ch = chords[Math.floor(s / 16) % 4];
        if (s % 16 === 0) ch.forEach((c) => this.tone({ f: root / 2 * 2 ** (c / 12), type: 'triangle', dur: 3.6, vol: 0.05, attack: 0.4, delay: t, bus: this.musicBus, rev: 0.6 }));
        if (s % 2 === 0 && Math.random() < (night ? 0.35 : 0.55)) {
          const n = scale[Math.floor(Math.random() * scale.length)] + ch[0];
          this.tone({ f: root * 2 ** (n / 12), type: night ? 'sine' : 'triangle', dur: 0.7, vol: 0.045, delay: t, bus: this.musicBus, rev: 0.7 });
        }
        this._nextNote += night ? 0.3 : 0.24;
      } else if (this.musicMode === 'rift' || this.musicMode === 'boss') {
        const boss = this.musicMode === 'boss';
        const root = 55, seq = [0, 0, 3, 0, 7, 0, 6, 3];
        if (s % 8 === 0) this.tone({ f: root * 2 ** ((Math.floor(s / 32) % 2 ? -2 : 0) / 12), type: 'sawtooth', dur: 2.2, vol: 0.06, filter: 400, q: 3, attack: 0.2, delay: t, bus: this.musicBus, rev: 0.6 });
        const n = seq[s % 8] + (Math.floor(s / 32) % 2 ? -2 : 0);
        this.tone({ f: root * 4 * 2 ** (n / 12), type: 'square', dur: 0.14, vol: boss ? 0.035 : 0.025, filter: 1200 + 600 * Math.sin(s * 0.1), q: 4, delay: t, bus: this.musicBus, rev: 0.3 });
        if (s % 4 === 0) this.noise({ dur: 0.15, vol: boss ? 0.12 : 0.07, f: 120, type: 'lowpass', delay: t, rev: 0 });
        if (boss && s % 4 === 2) this.noise({ dur: 0.08, vol: 0.05, f: 6000, q: 1, delay: t, rev: 0 });
        this._nextNote += boss ? 0.13 : 0.16;
      } else this._nextNote += 0.25;
    }
  }
}
export const audio = new AudioEngine();
