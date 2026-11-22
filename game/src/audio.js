window.SB = window.SB || {};
(function(){ 'use strict';
// ---------------------------------------------------------------------------
// SB.Audio — all sound in Sunset Bay is synthesised live with WebAudio.
// No external audio files: six ORIGINAL diegetic radio stations, plus a
// full sound-effects library (engine, gunfire, sirens, UI, ambience).
// "Diegetic" means the radio is sound inside the world: it plays from the
// car / beach speakers, ducks under dialogue toasts, and keeps playing
// across scenes. Every melody is generated from original note patterns
// written for this game — no licensed or sampled music anywhere.
// API (spec): init(state), setStation(i), sfx(name), toggleMute(),
// stations (array of 6 names).
// ---------------------------------------------------------------------------

// --- Station catalogue: six original stations, each with its own vibe,
// tempo, scale, waveform palette and jingle. Names are fictional.
// ---------------------------------------------------------------------------
var stations = [
  'SUNSET FM 88.1',      // 0 — golden-hour synthwave, the default
  'PALM TREE REGGAE',    // 1 — laid-back island reggae
  'HARBOUR JAZZ 101',    // 2 — late-night smooth jazz
  'NEON NIGHTS 94.5',    // 3 — driving electro / night-drive synth
  'BAY COUNTRY 107',     // 4 — breezy coastal country
  'VICE TALK 1290 AM'    // 5 — talk radio: traffic, weather, city lore
];

// Musical DNA per station. `root` is a MIDI note, `scale` is semitone
// offsets from the root, `bpm` drives the step scheduler, `wave` picks
// the lead voice, `bassWave` the bass voice.
var STATION_DNA = [
  { root: 57, bpm: 96,  scale: [0, 2, 3, 5, 7, 8, 10], wave: 'sawtooth', bassWave: 'triangle', swing: 0.12, bright: 0.7 },
  { root: 55, bpm: 74,  scale: [0, 2, 4, 5, 7, 9, 10], wave: 'triangle', bassWave: 'sine',     swing: 0.0,  bright: 0.5 },
  { root: 60, bpm: 82,  scale: [0, 2, 3, 5, 7, 9, 10], wave: 'sine',     bassWave: 'sine',     swing: 0.18, bright: 0.4 },
  { root: 52, bpm: 122, scale: [0, 2, 3, 5, 7, 8, 11], wave: 'square',   bassWave: 'sawtooth', swing: 0.0,  bright: 0.9 },
  { root: 59, bpm: 104, scale: [0, 2, 4, 5, 7, 9, 11], wave: 'triangle', bassWave: 'triangle', swing: 0.08, bright: 0.6 },
  { root: 57, bpm: 100, scale: [0, 2, 4, 5, 7, 9, 11], wave: 'sine',     bassWave: 'sine',     swing: 0.0,  bright: 0.3 }
];

// Original 16-step lead patterns per station (scale degrees, -1 = rest).
// Each pattern loops; the scheduler transposes it through a chord walk.
var LEAD_PATTERNS = [
  [0, -1, 2, -1, 4, -1, 3, 2, 0, -1, 4, -1, 5, 4, 2, -1],
  [0, -1, -1, 2, -1, 4, -1, -1, 3, -1, 2, -1, -1, 4, -1, 2],
  [4, -1, 2, 3, -1, 0, -1, 2, 4, -1, 5, -1, 3, 2, -1, 0],
  [0, 0, -1, 2, -1, 4, 4, -1, 5, -1, 4, 2, -1, 0, -1, 2],
  [0, -1, 2, -1, 4, 3, -1, 2, 0, -1, 4, -1, 2, -1, 1, -1],
  [0, -1, -1, -1, 2, -1, -1, -1, 4, -1, -1, -1, 3, -1, 2, -1]
];

// Original 16-step bass roots (scale degrees, -1 = rest).
var BASS_PATTERNS = [
  [0, -1, 0, -1, 3, -1, 0, -1, 4, -1, 0, -1, 3, 2, -1, -1],
  [0, -1, -1, 0, -1, -1, 3, -1, 0, -1, -1, 0, -1, 4, -1, -1],
  [0, -1, -1, -1, 3, -1, -1, -1, 4, -1, -1, -1, 2, -1, -1, -1],
  [0, 0, -1, 0, -1, 0, 3, -1, 0, -1, 4, -1, 3, -1, 2, -1],
  [0, -1, 0, -1, 4, -1, 3, -1, 0, -1, 0, -1, 4, -1, -1, -1],
  [0, -1, -1, -1, -1, -1, -1, -1, 0, -1, -1, -1, -1, -1, -1, -1]
];

// Chord walk per station: scale-degree roots, one chord per bar.
var CHORD_WALKS = [
  [0, 5, 3, 4], [0, 3, 4, 0], [0, 2, 5, 3],
  [0, 5, 3, 3], [0, 4, 5, 4], [0, 0, 4, 3]
];

// Talk-radio lines for VICE TALK 1290 AM. Spoken via short synth blips
// is not possible, so talk segments are represented as scheduled
// "bulletin" events the HUD can display, with a low murmuring bed
// underneath. Lines are original city lore, written for Sunset Bay.
var TALK_LINES = [
  'Good evening, Sunset Bay. The harbour lights are on and the tide is high.',
  'Traffic on the coast road is moving slow past the palm parade. Take the marina cut-through.',
  'The Bay Festival committee promises fireworks over the water this weekend.',
  'Remember folks: respect is earned on these streets, one job at a time.',
  'A reminder from the harbour master: keep clear of pier nine after dark.',
  'The sunset today is rated nine out of ten by our very scientific sky watchers.',
  'And now, the weather: golden hour, then neon night. Classic Sunset Bay.'
];

// --- Runtime state ---------------------------------------------------------
var ctx = null;          // AudioContext, created lazily on first gesture
var masterGain = null;   // final output
var musicGain = null;    // radio + jingles
var sfxGain = null;      // effects
var ambGain = null;      // wind / waves / city bed
var muted = false;
var currentStation = 0;
var radioOn = true;
var musicTimer = null;   // scheduler interval id
var step = 0;            // 16th-note step counter
var nextStepTime = 0;    // audio-clock time of the next step
var barCount = 0;
var duckUntil = 0;       // music ducks (drops volume) until this time
var stateRef = null;
var talkTimer = 0;
var talkIndex = 0;
var noiseBuffer = null;
var engineOsc = null;
var engineGain = null;
var engineFilter = null;
var sirenOscA = null;
var sirenOscB = null;
var sirenGain = null;
var sirenOn = false;
var started = false;

// MIDI note number -> frequency in Hz.
function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

// Scale degree (0..) -> MIDI note, wrapping octaves.
function degreeToMidi(dna, degree, octave) {
  var scale = dna.scale;
  var oct = Math.floor(degree / scale.length) + (octave || 0);
  var idx = ((degree % scale.length) + scale.length) % scale.length;
  return dna.root + oct * 12 + scale[idx];
}

// Build a 2-second white-noise buffer once, reused by drums and surf.
function getNoiseBuffer() {
  if (noiseBuffer) { return noiseBuffer; }
  var len = ctx.sampleRate * 2;
  var buf = ctx.createBuffer(1, len, ctx.sampleRate);
  var data = buf.getChannelData(0);
  var i;
  for (i = 0; i < len; i++) { data[i] = Math.random() * 2 - 1; }
  noiseBuffer = buf;
  return buf;
}

// ---------------------------------------------------------------------------
// Context + graph setup. Called from init(); safe to call twice.
// Browsers require a user gesture before audio starts, so the context is
// created suspended and resumed on the first key/click the game sees.
// ---------------------------------------------------------------------------
function ensureContext() {
  if (ctx) { return true; }
  var AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) { return false; }
  ctx = new AC();
  masterGain = ctx.createGain();
  masterGain.gain.value = muted ? 0 : 0.9;
  masterGain.connect(ctx.destination);
  musicGain = ctx.createGain();
  musicGain.gain.value = 0.5;
  musicGain.connect(masterGain);
  sfxGain = ctx.createGain();
  sfxGain.gain.value = 0.8;
  sfxGain.connect(masterGain);
  ambGain = ctx.createGain();
  ambGain.gain.value = 0.0;
  ambGain.connect(masterGain);
  return true;
}

function resumeContext() {
  if (ctx && ctx.state === 'suspended') { ctx.resume(); }
}

// ---------------------------------------------------------------------------
// init(state): wire the audio engine to shared state. Does NOT start
// audible sound until the player interacts (browser autoplay policy).
// ---------------------------------------------------------------------------
function init(state) {
  stateRef = state || null;
  ensureContext();
  if (!started) {
    started = true;
    if (stateRef) { currentStation = stateRef.radio || 0; }
    startScheduler();
    startAmbience();
  }
  return true;
}

// Duck the music briefly (e.g. under a mission toast or a phone call).
function duck(seconds) {
  duckUntil = ctx ? ctx.currentTime + (seconds || 1.5) : 0;
  if (musicGain && ctx) {
    musicGain.gain.cancelScheduledValues(ctx.currentTime);
    musicGain.gain.setValueAtTime(0.18, ctx.currentTime);
    musicGain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + (seconds || 1.5));
  }
}

// ---------------------------------------------------------------------------
// Radio scheduler: a 16th-note lookahead loop. Every 25 ms it schedules
// all steps whose time falls inside the next 120 ms, so timing stays
// tight even when the main thread is busy rendering the city.
// ---------------------------------------------------------------------------
function startScheduler() {
  if (!ctx || musicTimer !== null) { return; }
  nextStepTime = ctx.currentTime + 0.1;
  step = 0;
  musicTimer = setInterval(function () {
    if (!ctx || !radioOn || muted) { return; }
    if (ctx.state === 'suspended') { return; }
    var stepDur = 60 / STATION_DNA[currentStation].bpm / 4;
    while (nextStepTime < ctx.currentTime + 0.12) {
      scheduleStep(step, nextStepTime, stepDur);
      step = (step + 1) % 64; // 4 bars of 16 steps
      if (step === 0) { barCount++; }
      nextStepTime += stepDur;
    }
  }, 25);
}

function scheduleStep(globalStep, when, stepDur) {
  var dna = STATION_DNA[currentStation];
  var s16 = globalStep % 16;
  var bar = Math.floor(globalStep / 16) % 4;
  var chordRoot = CHORD_WALKS[currentStation][bar];
  var swing = (s16 % 2 === 1) ? dna.swing * stepDur : 0;
  var t = when + swing;

  if (currentStation === 5) {
    scheduleTalkBed(globalStep, t, stepDur);
    return;
  }

  // Lead voice.
  var leadDeg = LEAD_PATTERNS[currentStation][s16];
  if (leadDeg >= 0) {
    var leadMidi = degreeToMidi(dna, leadDeg + chordRoot, 1);
    playTone(t, midiToFreq(leadMidi), stepDur * 1.8, dna.wave,
      0.16, musicGain);
  }

  // Bass voice, one octave below the chord root.
  var bassDeg = BASS_PATTERNS[currentStation][s16];
  if (bassDeg >= 0) {
    var bassMidi = degreeToMidi(dna, bassDeg + chordRoot, -1);
    playTone(t, midiToFreq(bassMidi), stepDur * 2.2, dna.bassWave,
      0.30, musicGain);
  }

  // Pad chord on bar starts: three soft sines, long release.
  if (s16 === 0) {
    var i, midi;
    for (i = 0; i < 3; i++) {
      midi = degreeToMidi(dna, chordRoot + i * 2, 0);
      playTone(t, midiToFreq(midi), stepDur * 16, 'sine', 0.05, musicGain);
    }
  }

  scheduleDrums(currentStation, s16, t, stepDur);
}

// Drums per station: kick on quarters, hats on off-beats, snare on 2 & 4
// for the poppier stations, a soft shaker for reggae/jazz.
function scheduleDrums(station, s16, t, stepDur) {
  if (station === 1) { // reggae: kick on 2 & 4, rim on the off-beat
    if (s16 === 4 || s16 === 12) { playKick(t, 0.5); }
    if (s16 % 4 === 2) { playHat(t, 0.10, true); }
    if (s16 % 2 === 0) { playShaker(t, 0.05); }
  } else if (station === 2) { // jazz: brushed hats, soft kick
    if (s16 % 4 === 0) { playKick(t, 0.25); }
    if (s16 % 2 === 1) { playHat(t, 0.06, true); }
    if (s16 === 4 || s16 === 12) { playSnare(t, 0.10); }
  } else if (station === 3) { // electro: four-on-the-floor + hats
    if (s16 % 4 === 0) { playKick(t, 0.6); }
    if (s16 % 2 === 1) { playHat(t, 0.12, false); }
    if (s16 === 4 || s16 === 12) { playSnare(t, 0.22); }
  } else { // sunset FM / country: kick 1 & 3, snare 2 & 4
    if (s16 % 8 === 0) { playKick(t, 0.4); }
    if (s16 === 4 || s16 === 12) { playSnare(t, 0.16); }
    if (s16 % 2 === 1) { playHat(t, 0.08, false); }
  }
}

// Talk-radio bed: a low murmur (filtered noise pulsing like speech
// cadence) plus a soft station-ident blip every 4 bars.
function scheduleTalkBed(globalStep, t, stepDur) {
  var s16 = globalStep % 16;
  if (s16 % 4 === 0) {
    playNoiseBurst(t, stepDur * 2.4, 300, 0.05, musicGain);
  }
  if (globalStep % 64 === 0) {
    playTone(t, midiToFreq(69), stepDur * 2, 'sine', 0.08, musicGain);
    playTone(t + stepDur * 2, midiToFreq(72), stepDur * 2, 'sine', 0.08, musicGain);
  }
}

// --- Primitive voices ------------------------------------------------------
// One oscillator note with a quick attack and exponential decay.
function playTone(when, freq, dur, wave, vol, dest) {
  if (!ctx) { return; }
  var osc = ctx.createOscillator();
  var g = ctx.createGain();
  osc.type = wave || 'sine';
  osc.frequency.setValueAtTime(freq, when);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(vol, when + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(0.03, dur));
  osc.connect(g);
  g.connect(dest || musicGain);
  osc.start(when);
  osc.stop(when + dur + 0.1);
}

// Kick: sine dropping from 120 Hz to 45 Hz.
function playKick(when, vol) {
  if (!ctx) { return; }
  var osc = ctx.createOscillator();
  var g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(120, when);
  osc.frequency.exponentialRampToValueAtTime(45, when + 0.12);
  g.gain.setValueAtTime(vol, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.22);
  osc.connect(g); g.connect(musicGain);
  osc.start(when); osc.stop(when + 0.25);
}

// Snare: noise burst through a 1800 Hz bandpass + a 200 Hz thump.
function playSnare(when, vol) {
  if (!ctx) { return; }
  playNoiseBurst(when, 0.14, 1800, vol, musicGain);
  playTone(when, 200, 0.09, 'triangle', vol * 0.5, musicGain);
}

// Hat: very short highpassed noise. `open` lengthens it.
function playHat(when, vol, open) {
  if (!ctx) { return; }
  var src = ctx.createBufferSource();
  var filter = ctx.createBiquadFilter();
  var g = ctx.createGain();
  src.buffer = getNoiseBuffer();
  filter.type = 'highpass';
  filter.frequency.value = 7500;
  g.gain.setValueAtTime(vol, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + (open ? 0.09 : 0.035));
  src.connect(filter); filter.connect(g); g.connect(musicGain);
  src.start(when); src.stop(when + 0.12);
}

// Shaker: bandpassed noise, softer and breathier than a hat.
function playShaker(when, vol) {
  if (!ctx) { return; }
  playNoiseBurst(when, 0.07, 4200, vol, musicGain);
}

// Filtered noise burst of `dur` seconds at `freq` Hz.
function playNoiseBurst(when, dur, freq, vol, dest) {
  if (!ctx) { return; }
  var src = ctx.createBufferSource();
  var filter = ctx.createBiquadFilter();
  var g = ctx.createGain();
  src.buffer = getNoiseBuffer();
  src.loop = true;
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = 0.9;
  g.gain.setValueAtTime(vol, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  src.connect(filter); filter.connect(g); g.connect(dest || sfxGain);
  src.start(when); src.stop(when + dur + 0.05);
}

// ---------------------------------------------------------------------------
// setStation(i): switch radio station (0-5). Out-of-range wraps around.
// Updates shared state so the HUD and save system see the same station.
// ---------------------------------------------------------------------------
function setStation(i) {
  var n = stations.length;
  var idx = ((i | 0) % n + n) % n;
  var changed = idx !== currentStation;
  currentStation = idx;
  if (stateRef) { stateRef.radio = idx; }
  if (changed) {
    // Station-change sting: two-note ident, then the new pattern starts.
    if (ctx && !muted) {
      var t = ctx.currentTime;
      playTone(t, midiToFreq(72), 0.12, 'sine', 0.12, sfxGain);
      playTone(t + 0.12, midiToFreq(76), 0.18, 'sine', 0.12, sfxGain);
    }
    sfx('static');
    if (currentStation === 5) { talkIndex = 0; talkTimer = 0; }
  }
  return stations[idx];
}

function nextStation() { return setStation(currentStation + 1); }
function prevStation() { return setStation(currentStation - 1); }

// Toggle the radio on/off without touching the mute state.
function toggleRadio() {
  radioOn = !radioOn;
  return radioOn;
}

// ---------------------------------------------------------------------------
// toggleMute(): silence everything (master gain to 0) or restore it.
// Returns the new muted state.
// ---------------------------------------------------------------------------
function toggleMute() {
  muted = !muted;
  if (masterGain && ctx) {
    masterGain.gain.setValueAtTime(muted ? 0 : 0.9, ctx.currentTime);
  }
  return muted;
}

function isMuted() { return muted; }

function setVolume(v) {
  var vol = Math.max(0, Math.min(1, v));
  if (masterGain && ctx && !muted) {
    masterGain.gain.setValueAtTime(vol, ctx.currentTime);
  }
  return vol;
}

// ---------------------------------------------------------------------------
// SFX library. sfx(name) plays one named effect. Unknown names are
// ignored silently (no crash in the middle of a chase). Every effect is
// synthesised — no audio files.
// ---------------------------------------------------------------------------
var SFX_NAMES = [
  'click', 'select', 'back', 'static', 'pickup', 'cash', 'mission',
  'missionFail', 'success', 'gunshot', 'shotgun', 'rifle', 'reload',
  'empty', 'hit', 'crash', 'horn', 'engineStart', 'drift', 'siren',
  'wantedUp', 'wantedDown', 'checkpoint', 'raceWin', 'raceLose',
  'door', 'splash', 'wave', 'explosion', 'fire', 'heal', 'phone',
  'radioJingle', 'crowd', 'seagull', 'footstep', 'jump', 'land'
];

function sfx(name) {
  if (!ctx || muted) { return false; }
  if (ctx.state === 'suspended') { resumeContext(); }
  var t = ctx.currentTime;
  switch (name) {
    case 'click': playTone(t, 900, 0.05, 'square', 0.10, sfxGain); break;
    case 'select': playTone(t, 660, 0.07, 'sine', 0.14, sfxGain); playTone(t + 0.07, 990, 0.10, 'sine', 0.14, sfxGain); break;
    case 'back': playTone(t, 520, 0.07, 'sine', 0.12, sfxGain); playTone(t + 0.07, 340, 0.10, 'sine', 0.12, sfxGain); break;
    case 'static': playNoiseBurst(t, 0.18, 1200, 0.10, sfxGain); break;
    case 'pickup': playTone(t, 880, 0.09, 'sine', 0.16, sfxGain); playTone(t + 0.08, 1320, 0.14, 'sine', 0.16, sfxGain); break;
    case 'cash': playTone(t, 1200, 0.06, 'square', 0.08, sfxGain); playTone(t + 0.06, 1500, 0.06, 'square', 0.08, sfxGain); playTone(t + 0.12, 1800, 0.12, 'square', 0.08, sfxGain); break;
    case 'mission': playTone(t, 523, 0.12, 'triangle', 0.18, sfxGain); playTone(t + 0.12, 659, 0.12, 'triangle', 0.18, sfxGain); playTone(t + 0.24, 784, 0.22, 'triangle', 0.18, sfxGain); break;
    case 'missionFail': playTone(t, 392, 0.18, 'sawtooth', 0.12, sfxGain); playTone(t + 0.18, 311, 0.18, 'sawtooth', 0.12, sfxGain); playTone(t + 0.36, 233, 0.35, 'sawtooth', 0.12, sfxGain); break;
    case 'success': playTone(t, 523, 0.10, 'sine', 0.16, sfxGain); playTone(t + 0.10, 659, 0.10, 'sine', 0.16, sfxGain); playTone(t + 0.20, 784, 0.10, 'sine', 0.16, sfxGain); playTone(t + 0.30, 1046, 0.28, 'sine', 0.18, sfxGain); break;
    case 'gunshot': playNoiseBurst(t, 0.12, 900, 0.55, sfxGain); playTone(t, 160, 0.08, 'square', 0.25, sfxGain); break;
    case 'shotgun': playNoiseBurst(t, 0.22, 600, 0.7, sfxGain); playTone(t, 110, 0.14, 'square', 0.35, sfxGain); break;
    case 'rifle': playNoiseBurst(t, 0.10, 1400, 0.5, sfxGain); playTone(t, 220, 0.06, 'square', 0.22, sfxGain); break;
    case 'reload': playTone(t, 500, 0.04, 'square', 0.10, sfxGain); playTone(t + 0.12, 700, 0.04, 'square', 0.10, sfxGain); playTone(t + 0.24, 900, 0.05, 'square', 0.10, sfxGain); break;
    case 'empty': playTone(t, 300, 0.05, 'square', 0.10, sfxGain); break;
    case 'hit': playNoiseBurst(t, 0.08, 500, 0.3, sfxGain); playTone(t, 90, 0.10, 'sine', 0.25, sfxGain); break;
    case 'crash': playNoiseBurst(t, 0.35, 400, 0.6, sfxGain); playTone(t, 70, 0.30, 'sawtooth', 0.3, sfxGain); playNoiseBurst(t + 0.1, 0.2, 2000, 0.2, sfxGain); break;
    case 'horn': playTone(t, 370, 0.35, 'sawtooth', 0.14, sfxGain); playTone(t, 466, 0.35, 'sawtooth', 0.10, sfxGain); break;
    case 'engineStart': playTone(t, 60, 0.4, 'sawtooth', 0.12, sfxGain); playTone(t + 0.3, 90, 0.4, 'sawtooth', 0.12, sfxGain); break;
    case 'drift': playNoiseBurst(t, 0.5, 2600, 0.16, sfxGain); break;
    case 'siren': startSiren(); break;
    case 'wantedUp': playTone(t, 700, 0.12, 'square', 0.14, sfxGain); playTone(t + 0.12, 900, 0.12, 'square', 0.14, sfxGain); break;
    case 'wantedDown': playTone(t, 900, 0.12, 'square', 0.12, sfxGain); playTone(t + 0.12, 600, 0.16, 'square', 0.12, sfxGain); break;
    case 'checkpoint': playTone(t, 1046, 0.08, 'sine', 0.16, sfxGain); playTone(t + 0.08, 1318, 0.14, 'sine', 0.16, sfxGain); break;
    case 'raceWin':
      playTone(t, 523, 0.10, 'sine', 0.16, sfxGain);
      playTone(t + 0.10, 659, 0.10, 'sine', 0.16, sfxGain);
      playTone(t + 0.20, 784, 0.10, 'sine', 0.16, sfxGain);
      playTone(t + 0.30, 1046, 0.10, 'sine', 0.16, sfxGain);
      playTone(t + 0.40, 1318, 0.30, 'sine', 0.18, sfxGain);
      break;
    case 'raceLose': playTone(t, 440, 0.15, 'triangle', 0.14, sfxGain); playTone(t + 0.15, 415, 0.15, 'triangle', 0.14, sfxGain); playTone(t + 0.30, 392, 0.30, 'triangle', 0.14, sfxGain); break;
    case 'door': playNoiseBurst(t, 0.10, 300, 0.25, sfxGain); playTone(t, 120, 0.08, 'sine', 0.2, sfxGain); break;
    case 'splash': playNoiseBurst(t, 0.4, 800, 0.3, sfxGain); break;
    case 'wave': playNoiseBurst(t, 0.9, 500, 0.12, sfxGain); break;
    case 'explosion': playNoiseBurst(t, 0.8, 250, 0.9, sfxGain); playTone(t, 50, 0.7, 'sine', 0.5, sfxGain); playNoiseBurst(t + 0.05, 0.4, 3000, 0.3, sfxGain); break;
    case 'fire': playNoiseBurst(t, 0.6, 900, 0.2, sfxGain); break;
    case 'heal': playTone(t, 660, 0.10, 'sine', 0.12, sfxGain); playTone(t + 0.10, 880, 0.16, 'sine', 0.12, sfxGain); break;
    case 'phone': playTone(t, 1200, 0.09, 'sine', 0.12, sfxGain); playTone(t + 0.18, 1200, 0.09, 'sine', 0.12, sfxGain); break;
    case 'radioJingle': playTone(t, 784, 0.10, 'sine', 0.14, sfxGain); playTone(t + 0.10, 988, 0.10, 'sine', 0.14, sfxGain); playTone(t + 0.20, 1175, 0.18, 'sine', 0.14, sfxGain); break;
    case 'crowd': playNoiseBurst(t, 0.8, 1000, 0.14, sfxGain); playNoiseBurst(t + 0.2, 0.6, 1400, 0.10, sfxGain); break;
    case 'seagull': playTone(t, 1400, 0.12, 'sine', 0.08, sfxGain); playTone(t + 0.12, 1100, 0.14, 'sine', 0.08, sfxGain); break;
    case 'footstep': playNoiseBurst(t, 0.06, 300, 0.12, sfxGain); break;
    case 'jump': playTone(t, 300, 0.18, 'sine', 0.10, sfxGain); break;
    case 'land': playNoiseBurst(t, 0.10, 250, 0.2, sfxGain); break;
    default:
      return false;
  }
  return true;
}

// Play the gunshot for the currently equipped weapon (0-3).
function weaponShot(weapon) {
  if (weapon === 2) { return sfx('shotgun'); }
  if (weapon === 3) { return sfx('rifle'); }
  return sfx('gunshot');
}

// ---------------------------------------------------------------------------
// Engine hum: a continuous two-oscillator drone whose pitch follows the
// car's speed. startEngine/stopEngine bracket driving; setEngineSpeed
// is called every frame by the vehicle system.
// ---------------------------------------------------------------------------
function startEngine() {
  if (!ctx || engineOsc) { return; }
  engineOsc = ctx.createOscillator();
  var osc2 = ctx.createOscillator();
  engineFilter = ctx.createBiquadFilter();
  engineGain = ctx.createGain();
  engineOsc.type = 'sawtooth';
  engineOsc.frequency.value = 55;
  osc2.type = 'square';
  osc2.frequency.value = 110;
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 420;
  engineGain.gain.value = 0.0;
  engineOsc.connect(engineFilter);
  osc2.connect(engineFilter);
  engineFilter.connect(engineGain);
  engineGain.connect(sfxGain);
  engineOsc.start();
  osc2.start();
  engineOsc._mate = osc2;
  engineGain.gain.linearRampToValueAtTime(0.10, ctx.currentTime + 0.4);
}

function setEngineSpeed(speed01, rpm01) {
  if (!ctx || !engineOsc || !engineGain) { return; }
  var t = ctx.currentTime;
  var f = 55 + (rpm01 || speed01 || 0) * 165;
  engineOsc.frequency.setTargetAtTime(f, t, 0.08);
  if (engineOsc._mate) {
    engineOsc._mate.frequency.setTargetAtTime(f * 2, t, 0.08);
  }
  engineGain.gain.setTargetAtTime(0.06 + (speed01 || 0) * 0.08, t, 0.1);
  if (engineFilter) {
    engineFilter.frequency.setTargetAtTime(400 + (speed01 || 0) * 1600, t, 0.1);
  }
}

function stopEngine() {
  if (!ctx || !engineOsc) { return; }
  var t = ctx.currentTime;
  var osc = engineOsc, mate = engineOsc._mate, g = engineGain;
  g.gain.setTargetAtTime(0.0, t, 0.1);
  window.setTimeout(function () {
    try { osc.stop(); if (mate) { mate.stop(); } } catch (e) {}
  }, 400);
  engineOsc = null; engineGain = null; engineFilter = null;
}

// ---------------------------------------------------------------------------
// Police siren: two detuned saws alternating 700/950 Hz through a
// lowpass, started when wanted >= 1 and stopped when the heat dies.
// ---------------------------------------------------------------------------
function startSiren() {
  if (!ctx || sirenOn) { return; }
  sirenOscA = ctx.createOscillator();
  sirenOscB = ctx.createOscillator();
  sirenGain = ctx.createGain();
  sirenOscA.type = 'sawtooth';
  sirenOscB.type = 'sawtooth';
  sirenOscA.frequency.value = 700;
  sirenOscB.frequency.value = 950;
  sirenGain.gain.value = 0.0;
  var filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1400;
  sirenOscA.connect(filter);
  sirenOscB.connect(filter);
  filter.connect(sirenGain);
  sirenGain.connect(sfxGain);
  sirenOscA.start();
  sirenOscB.start();
  sirenOn = true;
  // Wail: swap which oscillator is loud, twice a second.
  var phase = 0;
  sirenOscA._wail = setInterval(function () {
    if (!sirenOn || !ctx) { return; }
    phase = 1 - phase;
    var t = ctx.currentTime;
    sirenGain.gain.setTargetAtTime(phase ? 0.05 : 0.035, t, 0.15);
    sirenOscA.frequency.setTargetAtTime(phase ? 950 : 700, t, 0.1);
    sirenOscB.frequency.setTargetAtTime(phase ? 700 : 950, t, 0.1);
  }, 500);
  sirenGain.gain.setTargetAtTime(0.05, ctx.currentTime, 0.3);
}

function stopSiren() {
  if (!sirenOn) { return; }
  sirenOn = false;
  if (sirenOscA && sirenOscA._wail) { clearInterval(sirenOscA._wail); }
  var a = sirenOscA, b = sirenOscB, g = sirenGain;
  sirenOscA = null; sirenOscB = null; sirenGain = null;
  if (g && ctx) { g.gain.setTargetAtTime(0.0, ctx.currentTime, 0.1); }
  window.setTimeout(function () {
    try { if (a) { a.stop(); } if (b) { b.stop(); } } catch (e) {}
  }, 400);
}

// Keep the siren in sync with the wanted level (called from update).
function syncSiren(wanted) {
  if (wanted >= 1 && !sirenOn) { startSiren(); }
  else if (wanted === 0 && sirenOn) { stopSiren(); }
}

// ---------------------------------------------------------------------------
// Ambience bed: looping surf + wind, volume following weather and
// whether the player is near the beach. Built from looped noise through
// slow LFO-driven filters — no audio files.
// ---------------------------------------------------------------------------
function startAmbience() {
  if (!ctx) { return; }
  var src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer();
  src.loop = true;
  var filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 500;
  var lfo = ctx.createOscillator();
  var lfoGain = ctx.createGain();
  lfo.frequency.value = 0.12; // slow swell, like waves
  lfoGain.gain.value = 220;
  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);
  src.connect(filter);
  filter.connect(ambGain);
  src.start();
  lfo.start();
  ambGain.gain.setTargetAtTime(0.05, ctx.currentTime, 1.0);
}

// Per-frame update hook, called by SB.Game.frame(dt).
// `state` is SB.state. Handles: talk-radio line rotation, siren sync,
// ambience level by weather/time, and engine pitch by vehicle speed.
function update(dt, state) {
  if (!ctx || !state) { return; }
  var t = ctx.currentTime;
  // Talk radio: a new bulletin line every ~20 s while station 5 plays.
  if (currentStation === 5 && radioOn && !muted) {
    talkTimer += dt;
    if (talkTimer > 20) {
      talkTimer = 0;
      talkIndex = (talkIndex + 1) % TALK_LINES.length;
      if (window.SB && window.SB.HUD) {
        window.SB.HUD.showToast('VICE TALK: ' + TALK_LINES[talkIndex]);
      }
    }
  }
  // Siren follows the wanted level.
  syncSiren(state.wanted || 0);
  // Ambience: louder rain + wind when it rains, quieter at noon.
  var rain = (state.weather && state.weather.rain) || 0;
  var target = 0.04 + rain * 0.10;
  if (state.player && state.player.onFoot === false) { target *= 0.6; }
  if (ambGain) { ambGain.gain.setTargetAtTime(target, t, 0.5); }
  // Engine pitch follows the vehicle.
  if (engineOsc) {
    var speed01 = 0;
    if (state.player && state.player.vehicle) { speed01 = 0.55; }
    setEngineSpeed(speed01, speed01);
  }
  // Music duck expires on its own (gain ramp set in duck()).
  if (duckUntil && t > duckUntil) { duckUntil = 0; }
}

// Current talk-radio line (for the HUD / pause screen).
function currentTalkLine() {
  return TALK_LINES[talkIndex];
}

// One-line station ident, e.g. "SUNSET FM 88.1 — golden-hour synthwave".
function stationLabel(i) {
  var idx = (i === undefined) ? currentStation : ((i % 6 + 6) % 6);
  var taglines = [
    'golden-hour synthwave', 'island reggae', 'late-night smooth jazz',
    'night-drive electro', 'coastal country', 'talk radio'
  ];
  return stations[idx] + ' — ' + taglines[idx];
}

window.SB.Audio = {
  init: init,
  update: update,
  setStation: setStation,
  nextStation: nextStation,
  prevStation: prevStation,
  toggleRadio: toggleRadio,
  sfx: sfx,
  weaponShot: weaponShot,
  toggleMute: toggleMute,
  isMuted: isMuted,
  setVolume: setVolume,
  duck: duck,
  resume: resumeContext,
  startEngine: startEngine,
  setEngineSpeed: setEngineSpeed,
  stopEngine: stopEngine,
  startSiren: startSiren,
  stopSiren: stopSiren,
  syncSiren: syncSiren,
  stationLabel: stationLabel,
  currentTalkLine: currentTalkLine,
  stations: stations,
  talkLines: TALK_LINES,
  sfxNames: SFX_NAMES,
  currentStation: function () { return currentStation; },
  isRadioOn: function () { return radioOn; }
};
})();
