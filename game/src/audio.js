// audio.js — every sound is synthesised with WebAudio: no audio files, no
// network. Created lazily on the first user gesture.
export class SoundBank {
  constructor() {
    this.ctx = null;
    this.master = null;
  }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.25;
      this.master.connect(this.ctx.destination);
    } catch { this.ctx = null; }
  }
  _noise(dur, freq, gain, type = 'lowpass') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t);
  }
  _tone(freq, dur, gain, type = 'sine', slide = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur);
  }
  shot(kind) {
    if (kind === 'thunder') this._noise(0.22, 900, 0.9);
    else if (kind === 'needle') this._noise(0.3, 2400, 0.8, 'highpass');
    else this._noise(0.12, 1600, 0.6);
    this._tone(160, 0.08, 0.35, 'square', -90);
  }
  enemyShot(dist) {
    const g = Math.max(0.05, 0.4 - dist * 0.008);
    this._noise(0.1, 1200, g);
  }
  dry() { this._tone(1200, 0.03, 0.15, 'square'); }
  reload() { this._tone(500, 0.05, 0.2, 'square'); setTimeout(() => this._tone(700, 0.05, 0.2, 'square'), 350); }
  hit() { this._tone(1900, 0.05, 0.25, 'sine'); }
  kill() { this._tone(1400, 0.07, 0.3, 'sine'); setTimeout(() => this._tone(2100, 0.09, 0.3, 'sine'), 70); }
  hurt() { this._tone(220, 0.15, 0.4, 'sawtooth', -120); }
  plant() { this._tone(880, 0.12, 0.3, 'sine'); }
  beep() { this._tone(1100, 0.09, 0.25, 'sine'); }
  boom() { this._noise(0.7, 300, 1.0); this._tone(60, 0.5, 0.6, 'sine', -30); }
  roundWin() { [523, 659, 784].forEach((f, i) => setTimeout(() => this._tone(f, 0.16, 0.25, 'triangle'), i * 110)); }
  roundLose() { [392, 330, 262].forEach((f, i) => setTimeout(() => this._tone(f, 0.18, 0.25, 'triangle'), i * 130)); }
}
