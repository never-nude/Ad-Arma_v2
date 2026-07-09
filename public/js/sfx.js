// Tiny WebAudio synth — no assets, no network.
let ctx = null;
let muted = localStorage.getItem('adarma-muted') === '1';

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone({ f = 440, f2 = null, type = 'sine', dur = 0.15, gain = 0.12, delay = 0 }) {
  if (muted) return;
  try {
    const a = ac();
    const t0 = a.currentTime + delay;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(a.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  } catch { /* audio is a luxury */ }
}

function noiseBurst({ dur = 0.12, gain = 0.1, delay = 0, low = 400, high = 2400 }) {
  if (muted) return;
  try {
    const a = ac();
    const t0 = a.currentTime + delay;
    const len = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.createBufferSource();
    src.buffer = buf;
    const bp = a.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = (low + high) / 2;
    bp.Q.value = 0.8;
    const g = a.createGain();
    g.gain.value = gain;
    src.connect(bp).connect(g).connect(a.destination);
    src.start(t0);
  } catch { /* shrug */ }
}

export const sfx = {
  toggleMute() { muted = !muted; localStorage.setItem('adarma-muted', muted ? '1' : '0'); return muted; },
  isMuted() { return muted; },
  click() { tone({ f: 660, dur: 0.05, gain: 0.05, type: 'triangle' }); },
  take() { tone({ f: 392, f2: 523, dur: 0.16, type: 'triangle', gain: 0.09 }); },
  coin() { tone({ f: 988, dur: 0.09, gain: 0.08, type: 'sine' }); tone({ f: 1319, dur: 0.12, gain: 0.07, delay: 0.07 }); },
  dice() { for (let i = 0; i < 4; i++) noiseBurst({ dur: 0.05, gain: 0.06, delay: i * 0.05, low: 900, high: 3200 }); },
  hit() { noiseBurst({ dur: 0.16, gain: 0.14, low: 150, high: 900 }); tone({ f: 130, f2: 70, dur: 0.18, type: 'square', gain: 0.07 }); },
  push() { tone({ f: 300, f2: 180, dur: 0.2, type: 'sawtooth', gain: 0.05 }); },
  omen() { tone({ f: 587, f2: 880, dur: 0.35, type: 'sine', gain: 0.07 }); },
  death() { tone({ f: 220, f2: 55, dur: 0.6, type: 'sawtooth', gain: 0.1 }); noiseBurst({ dur: 0.3, gain: 0.08, low: 80, high: 400 }); },
  horn() { // the sprung-trap horn
    tone({ f: 233, f2: 311, dur: 0.5, type: 'sawtooth', gain: 0.12 });
    tone({ f: 349, f2: 466, dur: 0.5, type: 'sawtooth', gain: 0.08, delay: 0.12 });
  },
  march() { for (let i = 0; i < 2; i++) noiseBurst({ dur: 0.06, gain: 0.05, delay: i * 0.14, low: 200, high: 700 }); },
  laurel() { [523, 659, 784].forEach((f, i) => tone({ f, dur: 0.22, gain: 0.09, delay: i * 0.1, type: 'triangle' })); },
  victory() { [392, 523, 659, 784, 1047].forEach((f, i) => tone({ f, dur: 0.4, gain: 0.1, delay: i * 0.16, type: 'triangle' })); },
  defeat() { [392, 349, 311, 233].forEach((f, i) => tone({ f, dur: 0.45, gain: 0.09, delay: i * 0.18, type: 'sawtooth' })); },
};
