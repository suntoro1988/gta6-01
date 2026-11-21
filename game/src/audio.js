// Sunset Bay — synthesized audio: SFX + 5 radio stations.
// Written from scratch for v10. No external audio files: every sound is
// synthesized live with the Web Audio API (oscillators + filtered noise).
// Depends only on ./rng.js for musical variation.

import { rng } from "./rng.js";

const SB = (globalThis.SB = globalThis.SB || {});

// ---------------------------------------------------------------------------
// Core context
// ---------------------------------------------------------------------------

let ctx = null;
let masterGain = null;
let musicGain = null;
let sfxGain = null;
let muted = false;
let radioTimer = null;
let currentStation = null;
let radioStep = 0;
let radioNextTime = 0;
const radioRng = rng("sunset-bay-radio");

const STATIONS = [
  {
    id: "vice-fm",
    name: "VICE FM",
    genre: "Synthwave",
    bpm: 104,
    wave: "sawtooth",
    bassWave: "triangle",
    scale: [0, 3, 5, 7, 10, 12, 15],
    root: 110,
  },
  {
    id: "bay-rock",
    name: "BAY ROCK",
    genre: "Rock",
    bpm: 132,
    wave: "square",
    bassWave: "sawtooth",
    scale: [0, 2, 3, 5, 7, 8, 10],
    root: 98,
  },
  {
    id: "sunset-soul",
    name: "SUNSET SOUL",
    genre: "Soul / R&B",
    bpm: 88,
    wave: "sine",
    bassWave: "sine",
    scale: [0, 2, 4, 7, 9, 12, 14],
    root: 130.81,
  },
  {
    id: "neon-wave",
    name: "NEON WAVE",
    genre: "Electro",
    bpm: 122,
    wave: "sawtooth",
    bassWave: "square",
    scale: [0, 2, 5, 7, 10, 12, 14],
    root: 116.54,
  },
  {
    id: "talk-bay",
    name: "TALK BAY",
    genre: "Talk / Chill",
    bpm: 72,
    wave: "triangle",
    bassWave: "sine",
    scale: [0, 3, 5, 7, 12],
    root: 146.83,
  },
];

function ensureContext() {
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  }
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  masterGain = ctx.createGain();
  masterGain.gain.value = muted ? 0 : 0.8;
  masterGain.connect(ctx.destination);
  musicGain = ctx.createGain();
  musicGain.gain.value = 0.32;
  musicGain.connect(masterGain);
  sfxGain = ctx.createGain();
  sfxGain.gain.value = 0.9;
  sfxGain.connect(masterGain);
  return ctx;
}

/** Must be called from a user gesture at least once. */
function initAudio() {
  const c = ensureContext();
  return Boolean(c);
}

function setMuted(value) {
  muted = Boolean(value);
  if (masterGain && ctx) {
    masterGain.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.05);
  }
  return muted;
}

// ---------------------------------------------------------------------------
// Synth helpers
// ---------------------------------------------------------------------------

function noiseBuffer(duration) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function playTone({ freq, freqEnd, wave, duration, volume, attack, when, dest }) {
  // Jangan pernah meneruskan nilai non-finite ke AudioParam.
  if (!Number.isFinite(freq)) return;
  const t0 = when === undefined ? ctx.currentTime : when;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = wave || "sine";
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd !== undefined && freqEnd !== freq) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + duration);
  }
  const a = attack === undefined ? 0.005 : attack;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), t0 + a);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain);
  gain.connect(dest || sfxGain);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

function playNoise({ duration, volume, filterFreq, filterType, when, dest }) {
  const t0 = when === undefined ? ctx.currentTime : when;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(duration + 0.05);
  const filter = ctx.createBiquadFilter();
  filter.type = filterType || "lowpass";
  filter.frequency.value = filterFreq || 1200;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(Math.max(0.0001, volume), t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(dest || sfxGain);
  src.start(t0);
  src.stop(t0 + duration + 0.05);
}

// ---------------------------------------------------------------------------
// SFX
// ---------------------------------------------------------------------------

const SFX = {
  shot() {
    playNoise({ duration: 0.16, volume: 0.9, filterFreq: 3200, filterType: "highpass" });
    playTone({ freq: 220, freqEnd: 55, wave: "square", duration: 0.12, volume: 0.55 });
  },
  emptyClick() {
    playTone({ freq: 1400, freqEnd: 900, wave: "square", duration: 0.04, volume: 0.25 });
  },
  reload() {
    playTone({ freq: 500, wave: "square", duration: 0.05, volume: 0.3 });
    setTimeout(() => {
      if (ctx) playTone({ freq: 760, wave: "square", duration: 0.05, volume: 0.3 });
    }, 110);
  },
  hit() {
    playTone({ freq: 180, freqEnd: 90, wave: "sawtooth", duration: 0.12, volume: 0.5 });
  },
  explosion() {
    playNoise({ duration: 0.9, volume: 1.0, filterFreq: 500 });
    playTone({ freq: 90, freqEnd: 28, wave: "sine", duration: 0.8, volume: 0.9 });
  },
  cash() {
    playTone({ freq: 880, wave: "sine", duration: 0.09, volume: 0.4 });
    setTimeout(() => {
      if (ctx) playTone({ freq: 1318, wave: "sine", duration: 0.16, volume: 0.4 });
    }, 90);
  },
  pickup() {
    playTone({ freq: 520, freqEnd: 1040, wave: "sine", duration: 0.14, volume: 0.45 });
  },
  mission() {
    [523, 659, 784, 1046].forEach((f, i) => {
      setTimeout(() => {
        if (ctx) playTone({ freq: f, wave: "triangle", duration: 0.18, volume: 0.4 });
      }, i * 110);
    });
  },
  fail() {
    playTone({ freq: 320, freqEnd: 160, wave: "sawtooth", duration: 0.4, volume: 0.4 });
  },
  click() {
    playTone({ freq: 900, wave: "square", duration: 0.03, volume: 0.2 });
  },
  horn() {
    playTone({ freq: 370, wave: "sawtooth", duration: 0.28, volume: 0.35 });
    playTone({ freq: 466, wave: "sawtooth", duration: 0.28, volume: 0.3 });
  },
  engineStart() {
    playTone({ freq: 60, freqEnd: 140, wave: "sawtooth", duration: 0.5, volume: 0.35 });
    playNoise({ duration: 0.4, volume: 0.2, filterFreq: 900 });
  },
  crash() {
    playNoise({ duration: 0.45, volume: 0.9, filterFreq: 800 });
    playTone({ freq: 70, freqEnd: 35, wave: "square", duration: 0.3, volume: 0.5 });
  },
  sirenBlip() {
    playTone({ freq: 950, freqEnd: 700, wave: "sine", duration: 0.22, volume: 0.3 });
  },
};

function playSFX(name) {
  if (!ensureContext()) return false;
  const fn = SFX[name];
  if (!fn) return false;
  fn();
  return true;
}

// ---------------------------------------------------------------------------
// Engine hum (continuous, pitch follows speed)
// ---------------------------------------------------------------------------

let engineOsc = null;
let engineOsc2 = null;
let engineGain = null;
let engineFilter = null;

function startEngine() {
  if (!ensureContext() || engineOsc) return false;
  engineOsc = ctx.createOscillator();
  engineOsc.type = "sawtooth";
  engineOsc.frequency.value = 70;
  engineOsc2 = ctx.createOscillator();
  engineOsc2.type = "square";
  engineOsc2.frequency.value = 35;
  engineFilter = ctx.createBiquadFilter();
  engineFilter.type = "lowpass";
  engineFilter.frequency.value = 420;
  engineGain = ctx.createGain();
  engineGain.gain.value = 0.0;
  engineGain.gain.setTargetAtTime(0.12, ctx.currentTime, 0.2);
  engineOsc.connect(engineFilter);
  engineOsc2.connect(engineFilter);
  engineFilter.connect(engineGain);
  engineGain.connect(masterGain);
  engineOsc.start();
  engineOsc2.start();
  return true;
}

/** speed01: 0 (idle) .. 1 (top speed). */
function setEngineSpeed(speed01) {
  if (!ctx || !engineOsc) return;
  const s = Math.max(0, Math.min(1, speed01));
  const t = ctx.currentTime;
  engineOsc.frequency.setTargetAtTime(65 + s * 165, t, 0.08);
  engineOsc2.frequency.setTargetAtTime(32 + s * 82, t, 0.08);
  engineFilter.frequency.setTargetAtTime(380 + s * 1600, t, 0.1);
  engineGain.gain.setTargetAtTime(0.1 + s * 0.1, t, 0.1);
}

function stopEngine() {
  if (!engineOsc) return false;
  const t = ctx.currentTime;
  engineGain.gain.setTargetAtTime(0, t, 0.05);
  const o1 = engineOsc;
  const o2 = engineOsc2;
  setTimeout(() => {
    try {
      o1.stop();
      o2.stop();
    } catch (e) {
      /* already stopped */
    }
  }, 300);
  engineOsc = null;
  engineOsc2 = null;
  engineGain = null;
  engineFilter = null;
  return true;
}

// ---------------------------------------------------------------------------
// Police siren (continuous two-tone)
// ---------------------------------------------------------------------------

let sirenOsc = null;
let sirenGain = null;
let sirenLfo = null;

function startSiren() {
  if (!ensureContext() || sirenOsc) return false;
  sirenOsc = ctx.createOscillator();
  sirenOsc.type = "triangle";
  sirenOsc.frequency.value = 820;
  sirenLfo = ctx.createOscillator();
  sirenLfo.type = "square";
  sirenLfo.frequency.value = 0.55;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 140;
  sirenLfo.connect(lfoGain);
  lfoGain.connect(sirenOsc.frequency);
  sirenGain = ctx.createGain();
  sirenGain.gain.value = 0.0;
  sirenGain.gain.setTargetAtTime(0.11, ctx.currentTime, 0.1);
  sirenOsc.connect(sirenGain);
  sirenGain.connect(masterGain);
  sirenOsc.start();
  sirenLfo.start();
  return true;
}

function stopSiren() {
  if (!sirenOsc) return false;
  const t = ctx.currentTime;
  sirenGain.gain.setTargetAtTime(0, t, 0.05);
  const o = sirenOsc;
  const l = sirenLfo;
  setTimeout(() => {
    try {
      o.stop();
      l.stop();
    } catch (e) {
      /* already stopped */
    }
  }, 300);
  sirenOsc = null;
  sirenLfo = null;
  sirenGain = null;
  return true;
}

// ---------------------------------------------------------------------------
// Radio: 5 stations, step-sequenced synth patterns
// ---------------------------------------------------------------------------

function stationById(id) {
  return STATIONS.find((s) => s.id === id) || null;
}

function listStations() {
  return STATIONS.map((s) => ({ id: s.id, name: s.name, genre: s.genre }));
}

function scaleFreq(station, degree) {
  // Derajat negatif (bass: deg - 12) harus dibungkus dengan benar:
  // JS % negatif menghasilkan indeks negatif -> scale[negatif] =
  // undefined -> frekuensi NaN -> setValueAtTime melempar.
  const len = station.scale.length;
  const idx = ((degree % len) + len) % len;
  const semis = station.scale[idx];
  const oct = Math.floor(degree / len);
  return station.root * Math.pow(2, (semis + oct * 12) / 12);
}

function scheduleRadioStep(station, step, when) {
  const bar = Math.floor(step / 16);
  const beat = step % 16;
  // Bass: root on beats 0, 4, 8, 12 (and a walk-up on some bars).
  if (beat % 4 === 0) {
    const deg = bar % 3 === 2 ? 4 : 0;
    playTone({
      freq: scaleFreq(station, deg - 12),
      wave: station.bassWave,
      duration: 0.22,
      volume: 0.5,
      when,
      dest: musicGain,
    });
  }
  // Lead: sparse melody, denser on electro / rock.
  const density = station.id === "talk-bay" ? 0.22 : station.id === "sunset-soul" ? 0.3 : 0.42;
  if (radioRng.chance(density)) {
    const deg = radioRng.int(0, 9);
    playTone({
      freq: scaleFreq(station, deg),
      wave: station.wave,
      duration: 0.18,
      volume: 0.16,
      when,
      dest: musicGain,
    });
  }
  // Hat tick on off-beats for upbeat stations.
  if (station.bpm >= 100 && beat % 2 === 1) {
    playNoise({ duration: 0.03, volume: 0.06, filterFreq: 7000, filterType: "highpass", when, dest: musicGain });
  }
  // Kick on the beat for electro / rock.
  if ((station.id === "neon-wave" || station.id === "bay-rock") && beat % 4 === 0) {
    playTone({ freq: 120, freqEnd: 45, wave: "sine", duration: 0.14, volume: 0.5, when, dest: musicGain });
  }
}

function radioTick() {
  if (!ctx || !currentStation) return;
  const spb = 60 / currentStation.bpm / 4; // 16th notes
  while (radioNextTime < ctx.currentTime + 0.15) {
    scheduleRadioStep(currentStation, radioStep, radioNextTime);
    radioStep++;
    radioNextTime += spb;
  }
}

function startRadio(id) {
  const station = stationById(id) || STATIONS[0];
  if (!ensureContext()) return null;
  stopRadio();
  currentStation = station;
  radioStep = 0;
  radioNextTime = ctx.currentTime + 0.05;
  radioTimer = setInterval(radioTick, 30);
  return station;
}

function stopRadio() {
  if (radioTimer) {
    clearInterval(radioTimer);
    radioTimer = null;
  }
  currentStation = null;
  return true;
}

function nextStation() {
  const idx = currentStation ? STATIONS.findIndex((s) => s.id === currentStation.id) : -1;
  const next = STATIONS[(idx + 1) % STATIONS.length];
  return startRadio(next.id);
}

function getCurrentStation() {
  return currentStation ? { id: currentStation.id, name: currentStation.name, genre: currentStation.genre } : null;
}

/** Aliases used by main.js (v10 integration). */
function init() {
  return initAudio();
}

/** Start the radio music (default: first station). Call from a user gesture. */
function startMusic(stationId) {
  return startRadio(stationId || STATIONS[0].id);
}

function pauseMusic() {
  return stopRadio();
}

function resumeMusic() {
  return startRadio((currentStation && currentStation.id) || STATIONS[0].id);
}

function toggleMute() {
  return setMuted(!muted);
}

function playShot() {
  return playSFX("shot");
}

SB.Audio = {
  initAudio,
  init,
  startMusic,
  pauseMusic,
  resumeMusic,
  toggleMute,
  playShot,
  playSFX,
  setMuted,
  isMuted: () => muted,
  startEngine,
  setEngineSpeed,
  stopEngine,
  startSiren,
  stopSiren,
  startRadio,
  stopRadio,
  nextStation,
  getCurrentStation,
  listStations,
  stationById,
};

const Audio = SB.Audio;

export {
  Audio,
  initAudio,
  init,
  startMusic,
  pauseMusic,
  resumeMusic,
  toggleMute,
  playShot,
  playSFX,
  setMuted,
  startEngine,
  setEngineSpeed,
  stopEngine,
  startSiren,
  stopSiren,
  startRadio,
  stopRadio,
  nextStation,
  getCurrentStation,
  listStations,
  STATIONS,
};
export default SB.Audio;
