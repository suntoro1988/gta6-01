// audio.js — Sunset Bay v5 (Builder D)
// WebAudio synth: efek suara + 5 stasiun radio prosedural (oscillator).
// Modul mandiri, tanpa impor. AudioContext dibuat malas (lazy) supaya tidak
// diblokir autoplay sebelum interaksi pertama pemain.
// Ditulis fresh dari design-spec, sesi recording 01a1f13f-5466-77cb-9088-12e78d473c06.

'use strict';

// ---------- stasiun radio ----------
// Tiap stasiun: tempo (BPM), waveform, root note (MIDI), pola interval
// (skala), dan karakter. Musik prosedural: sequencer 8 langkah per bar,
// bass di langkah genap + melodi di langkah ganjil, berubah tiap bar.
export const STATIONS = [
  {
    name: 'BAY FM',
    bpm: 96, wave: 'triangle', root: 57, // A3 — pop cerah
    scale: [0, 2, 4, 7, 9, 12, 14, 16],
    bass: [0, 0, 7, 5],
    mood: 'bright pop',
  },
  {
    name: 'SUNSET DRIVE',
    bpm: 82, wave: 'sawtooth', root: 52, // E3 — synthwave santai
    scale: [0, 3, 5, 7, 10, 12, 15, 17],
    bass: [0, 0, 3, 10],
    mood: 'mellow synthwave',
  },
  {
    name: 'NEON NIGHTS',
    bpm: 118, wave: 'square', root: 45, // A2 — electro malam
    scale: [0, 2, 3, 7, 8, 12, 14, 15],
    bass: [0, 0, 0, 7],
    mood: 'driving electro',
  },
  {
    name: 'PALM COURT',
    bpm: 72, wave: 'sine', root: 60, // C4 — lounge jazzy
    scale: [0, 4, 5, 7, 11, 12, 16, 17],
    bass: [0, 7, 5, 4],
    mood: 'smooth lounge',
  },
  {
    name: 'TIDE FM',
    bpm: 104, wave: 'triangle', root: 55, // G3 — reggae pantai (BARU)
    scale: [0, 2, 4, 7, 9, 12, 14, 16],
    bass: [0, 7, 0, 5],
    mood: 'laid-back island',
  },
];

const SONG_TITLES = [
  ['Golden Hour', 'Palm Shadows', 'Bay Lights'],
  ['Drive Into Dusk', 'Chrome Sunset', 'Coastal Road'],
  ['Neon Rain', 'Midnight Grid', 'Ultraviolet'],
  ['Cocktail Hour', 'Velvet Palm', 'Slow Tide'],
  ['Island Breeze', 'Coral Sky', 'Salt Air'],
];

function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

export function createAudio() {
  return {
    ctx: null,          // AudioContext (dibuat saat pertama dipakai)
    master: null,       // GainNode utama
    radioGain: null,    // GainNode radio
    sfxGain: null,      // GainNode efek
    muted: false,
    station: 0,
    radioOn: false,
    radioTimer: null,
    radioStep: 0,
    radioBar: 0,
    currentSong: SONG_TITLES[0][0],
    engineOsc: null,
    engineGain: null,
    sirenOsc: null,
    sirenGain: null,
    sirenTimer: null,
  };
}

function ensureCtx(A) {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!A.ctx) {
    A.ctx = new AC();
    A.master = A.ctx.createGain();
    A.master.gain.value = A.muted ? 0 : 0.9;
    A.master.connect(A.ctx.destination);
    A.radioGain = A.ctx.createGain();
    A.radioGain.gain.value = 0.32;
    A.radioGain.connect(A.master);
    A.sfxGain = A.ctx.createGain();
    A.sfxGain.gain.value = 0.9;
    A.sfxGain.connect(A.master);
  }
  if (A.ctx.state === 'suspended' && !A.muted) {
    A.ctx.resume().catch(() => {});
  }
  return A.ctx;
}

function tone(A, dest, freq, dur, type, vol, when, slideTo) {
  const ctx = A.ctx;
  if (!ctx || !dest) return;
  const t0 = when || ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(Math.max(20, freq), t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol || 0.3, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g);
  g.connect(dest);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noiseBurst(A, dest, dur, vol, filterFreq, type) {
  const ctx = A.ctx;
  if (!ctx || !dest) return;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  let node = src;
  if (filterFreq) {
    const f = ctx.createBiquadFilter();
    f.type = type || 'lowpass';
    f.frequency.value = filterFreq;
    src.connect(f);
    node = f;
  }
  const g = ctx.createGain();
  g.gain.value = vol || 0.4;
  node.connect(g);
  g.connect(dest);
  src.start();
}

// ---------- efek suara ----------
const SFX_IMPL = {
  shoot(A) {
    noiseBurst(A, A.sfxGain, 0.14, 0.5, 1800, 'lowpass');
    tone(A, A.sfxGain, 320, 0.09, 'square', 0.22, 0, 70);
  },
  punch(A) {
    tone(A, A.sfxGain, 140, 0.12, 'sine', 0.55, 0, 45);
    noiseBurst(A, A.sfxGain, 0.08, 0.3, 500, 'lowpass');
  },
  engine(A) {
    // Deru mesin singkat (loop kontinu diurus main loop via setEngine bila ada).
    tone(A, A.sfxGain, 90, 0.25, 'sawtooth', 0.16, 0, 160);
  },
  horn(A) {
    const ctx = A.ctx;
    if (!ctx) return;
    tone(A, A.sfxGain, 370, 0.35, 'square', 0.2);
    tone(A, A.sfxGain, 466, 0.35, 'square', 0.2);
  },
  pickup(A) {
    const ctx = A.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(A, A.sfxGain, 660, 0.1, 'sine', 0.3, t);
    tone(A, A.sfxGain, 880, 0.12, 'sine', 0.3, t + 0.09);
    tone(A, A.sfxGain, 1320, 0.16, 'sine', 0.28, t + 0.18);
  },
  cash(A) {
    const ctx = A.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(A, A.sfxGain, 988, 0.09, 'sine', 0.3, t);
    tone(A, A.sfxGain, 1319, 0.18, 'sine', 0.3, t + 0.08);
  },
  siren(A) {
    // Satu lengking sirene naik-turun; loop penuh diurus startSiren/stopSiren.
    tone(A, A.sfxGain, 700, 0.5, 'sine', 0.16, 0, 950);
    tone(A, A.sfxGain, 950, 0.5, 'sine', 0.16, 0, 700);
  },
  splash(A) {
    noiseBurst(A, A.sfxGain, 0.45, 0.4, 900, 'bandpass');
    tone(A, A.sfxGain, 220, 0.3, 'sine', 0.12, 0, 60);
  },
  click(A) {
    tone(A, A.sfxGain, 1200, 0.05, 'square', 0.15);
  },
};

export function sfx(A, name) {
  if (!A) return;
  if (A.muted) return;
  const ctx = ensureCtx(A);
  if (!ctx) return;
  const fn = SFX_IMPL[name];
  if (fn) {
    try { fn(A); } catch (e) { /* efek gagal = diam, game tetap jalan */ }
  }
}

// Sirene loop (dipakai game.js saat wanted tinggi; opsional, tidak wajib).
export function startSiren(A) {
  if (!A || A.sirenTimer) return;
  if (!ensureCtx(A)) return;
  let high = false;
  A.sirenTimer = setInterval(() => {
    if (A.muted) return;
    tone(A, A.sfxGain, high ? 950 : 700, 0.45, 'sine', 0.1, 0, high ? 700 : 950);
    high = !high;
  }, 450);
}
export function stopSiren(A) {
  if (!A || !A.sirenTimer) return;
  clearInterval(A.sirenTimer);
  A.sirenTimer = null;
}

// ---------- radio ----------
export function stationName(A) {
  if (!A) return STATIONS[0].name;
  const st = STATIONS[((A.station % STATIONS.length) + STATIONS.length) % STATIONS.length];
  return st ? st.name : STATIONS[0].name;
}

function radioTick(A) {
  if (!A || !A.ctx || !A.radioOn || A.muted) return;
  const st = STATIONS[A.station];
  const stepDur = 60 / st.bpm / 2; // 8 langkah per bar (eighth notes)
  const step = A.radioStep % 8;
  const bar = A.radioBar;

  // Bass di langkah 0 & 4 (TIDE FM: off-beat khas island di 2 & 6).
  const bassSteps = st.name === 'TIDE FM' ? [2, 6] : [0, 4];
  if (bassSteps.indexOf(step) !== -1) {
    const deg = st.bass[(bar + step) % st.bass.length];
    tone(A, A.radioGain, midiToFreq(st.root - 12 + deg), stepDur * 1.8, 'sine', 0.5);
  }
  // Melodi: pola deterministik dari bar+step (tanpa RNG supaya stabil).
  const melIdx = (bar * 5 + step * 3) % st.scale.length;
  if (step % 2 === 1) {
    const deg = st.scale[melIdx];
    tone(A, A.radioGain, midiToFreq(st.root + deg), stepDur * 0.9, st.wave, 0.2);
    // Harmoni oktaf di NEON NIGHTS.
    if (st.name === 'NEON NIGHTS' && step % 4 === 1) {
      tone(A, A.radioGain, midiToFreq(st.root + deg + 12), stepDur * 0.9, 'square', 0.08);
    }
  }
  // Hat: ketukan ringan tiap langkah genap di stasiun cepat.
  if (st.bpm >= 100 && step % 2 === 0) {
    noiseBurst(A, A.radioGain, 0.03, 0.06, 6000, 'highpass');
  }

  A.radioStep += 1;
  if (A.radioStep % 8 === 0) {
    A.radioBar += 1;
    if (A.radioBar % 4 === 0) {
      // Ganti lagu tiap 4 bar.
      const titles = SONG_TITLES[A.station];
      A.currentSong = titles[(A.radioBar / 4) % titles.length];
    }
  }
}

function scheduleRadio(A) {
  if (A.radioTimer) clearInterval(A.radioTimer);
  const st = STATIONS[A.station];
  const stepMs = (60 / st.bpm / 2) * 1000;
  A.radioTimer = setInterval(() => radioTick(A), stepMs);
}

export function startRadio(A) {
  if (!A) return;
  if (!ensureCtx(A)) return;
  A.radioOn = true;
  A.radioStep = 0;
  A.radioBar = 0;
  A.currentSong = SONG_TITLES[A.station][0];
  scheduleRadio(A);
}

export function stopRadio(A) {
  if (!A) return;
  A.radioOn = false;
  if (A.radioTimer) { clearInterval(A.radioTimer); A.radioTimer = null; }
}

export function setStation(A, i) {
  if (!A) return;
  const n = STATIONS.length;
  A.station = ((Math.floor(i) % n) + n) % n;
  A.currentSong = SONG_TITLES[A.station][0];
  A.radioStep = 0;
  A.radioBar = 0;
  if (A.radioOn) scheduleRadio(A);
}

export function nextStation(A) {
  if (!A) return;
  setStation(A, (A.station || 0) + 1);
}

export function toggleMute(A) {
  if (!A) return false;
  A.muted = !A.muted;
  if (A.ctx && A.master) {
    A.master.gain.value = A.muted ? 0 : 0.9;
    if (!A.muted && A.ctx.state === 'suspended') A.ctx.resume().catch(() => {});
  }
  return A.muted;
}
