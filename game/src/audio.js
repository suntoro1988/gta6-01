window.SB = window.SB || {};
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // SB.Audio — pure WebAudio, zero external audio files. Sunset Bay v12.
  // Two layers:
  //  1. DIEGETIC RADIO: 6 original stations, each with its own tempo, scale,
  //     waveform, bass pattern and drum feel. Music is synthesised live by
  //     a step scheduler, so switching station genuinely changes the song.
  //     Stations are named after in-world Sunset Bay places / DJs — all
  //     original, no licensed tracks, no real-world station names.
  //  2. SYNTH SFX: gunshots, explosions, horns, police siren, cha-ching,
  //     tyre screech, ocean waves, footsteps — all built from oscillators
  //     and filtered noise, so the game ships with no .mp3/.wav at all.
  // AudioContext is created lazily on first user gesture (browser policy);
  // init() is safe to call early and will arm itself on the next key/click.
  // ---------------------------------------------------------------------------

  var ctx = null;        // AudioContext (lazy)
  var master = null;     // master gain
  var musicBus = null;   // music gain
  var sfxBus = null;     // sfx gain
  var muted = false;
  var stationIndex = 0;
  var musicOn = true;
  var schedulerTimer = null;
  var stepIndex = 0;
  var nextStepTime = 0;
  var currentState = null;
  var sirenNodes = null; // {osc, gain} while a siren is playing
  var waveNodes = null;  // ambient ocean loop nodes
  var started = false;

  // --- 6 ORIGINAL STATIONS -------------------------------------------------
  // bpm: tempo. root: MIDI note of the tonic. scale: semitone offsets.
  // wave: lead waveform. bassWave: bass waveform. swing: 0..0.5 feel.
  // drum: 'four' | 'half' | 'latin' | 'boom' — the hat/kick pattern.
  // mood: flavour text shown in the HUD. dj: in-world presenter.
  var STATIONS = [
    {
      name: 'Bay FM 88.1 — Sunset Drive',
      short: 'Bay FM',
      genre: 'Sunset synth-pop',
      dj: 'DJ Marisol',
      bpm: 96, root: 57, scale: [0, 2, 3, 5, 7, 8, 10],
      wave: 'sawtooth', bassWave: 'triangle', swing: 0.12, drum: 'four',
      leadGain: 0.10, bassGain: 0.16, bright: 1400
    },
    {
      name: 'Harbour Lights 94.6 — Neon Nights',
      short: 'Harbour Lights',
      genre: 'Neon electro-funk',
      dj: 'DJ Kelp',
      bpm: 112, root: 50, scale: [0, 2, 3, 5, 7, 10],
      wave: 'square', bassWave: 'sawtooth', swing: 0.08, drum: 'four',
      leadGain: 0.08, bassGain: 0.18, bright: 2200
    },
    {
      name: 'Palma Soul 101.3 — Golden Hour Soul',
      short: 'Palma Soul',
      genre: 'Warm soul / R&B',
      dj: 'DJ Aurelia',
      bpm: 78, root: 55, scale: [0, 2, 4, 5, 7, 9, 11],
      wave: 'sine', bassWave: 'sine', swing: 0.22, drum: 'half',
      leadGain: 0.13, bassGain: 0.15, bright: 900
    },
    {
      name: 'Tide Line 107.9 — Surf & Reggae',
      short: 'Tide Line',
      genre: 'Surf reggae / ska',
      dj: 'DJ Reef',
      bpm: 84, root: 52, scale: [0, 2, 4, 7, 9],
      wave: 'triangle', bassWave: 'triangle', swing: 0.28, drum: 'latin',
      leadGain: 0.11, bassGain: 0.17, bright: 1100
    },
    {
      name: 'Neon Mile 99.5 — Midnight Drive',
      short: 'Neon Mile',
      genre: 'Dark synthwave',
      dj: 'DJ Vesper',
      bpm: 104, root: 45, scale: [0, 2, 3, 5, 7, 8, 11],
      wave: 'sawtooth', bassWave: 'square', swing: 0.0, drum: 'boom',
      leadGain: 0.09, bassGain: 0.20, bright: 1800
    },
    {
      name: 'Boardwalk Talk 90.2 — Bay Talk & Oldies',
      short: 'Boardwalk Talk',
      genre: 'Talk / mellow oldies',
      dj: 'Marta & The Gulls',
      bpm: 66, root: 60, scale: [0, 4, 5, 7, 11],
      wave: 'sine', bassWave: 'sine', swing: 0.15, drum: 'half',
      leadGain: 0.12, bassGain: 0.12, bright: 700
    }
  ];

  // Chord roots (in scale degrees) cycled per 8-step bar, per station.
  // Each station gets a different progression so the harmony is audible.
  var PROGRESSIONS = [
    [0, 5, 3, 4],   // Bay FM: I – vi – IV – V
    [0, 3, 5, 4],   // Harbour Lights: I – IV – vi – V
    [0, 4, 5, 3],   // Palma Soul: I – V – vi – IV
    [0, 5, 0, 4],   // Tide Line: I – vi – I – V
    [0, 0, 3, 5],   // Neon Mile: i – i – III – VI (minor drive)
    [0, 3, 4, 3]    // Boardwalk: I – IV – V – IV
  ];

  // Melody seeds: rhythmic patterns (1 = note, 0 = rest) per 16 steps.
  // The actual pitch is picked from the station scale + chord tone.
  var MELODY_PATTERNS = [
    [1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0],
    [1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1],
    [1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0],
    [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0],
    [1, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 1, 0, 0, 1, 0],
    [1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0]
  ];

  var BASS_PATTERNS = [
    [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0],
    [1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0],
    [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1],
    [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0],
    [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]
  ];

  // --- AudioContext plumbing ------------------------------------------------

  function ensureContext() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      ctx = new AC();
    } catch (e) {
      return false;
    }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.85;
    master.connect(ctx.destination);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.55;
    musicBus.connect(master);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.9;
    sfxBus.connect(master);
    return true;
  }

  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // Deterministic per-step pitch: uses a tiny local LCG seeded by
  // (station, bar, step) so the melody repeats every 4 bars — a real
  // song structure, not random noodling.
  function stepRand(station, bar, step) {
    var x = (station * 2654435761 + bar * 40503 + step * 97 + 12345) >>> 0;
    x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0;
    x ^= x >>> 13; x = Math.imul(x, 3266489917) >>> 0;
    x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
  }

  function scaleNote(station, degree, octave) {
    var st = STATIONS[station];
    var len = st.scale.length;
    var oct = Math.floor(degree / len) + (octave || 0);
    var idx = ((degree % len) + len) % len;
    return st.root + st.scale[idx] + oct * 12;
  }

  // --- Music scheduler ------------------------------------------------------

  function noteOn(freq, time, dur, type, gainVal, bus, filterFreq) {
    if (!ctx) return;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(gainVal, time + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    if (filterFreq) {
      var f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filterFreq;
      osc.connect(f); f.connect(g); g.connect(bus);
    } else {
      osc.connect(g); g.connect(bus);
    }
    osc.start(time);
    osc.stop(time + dur + 0.05);
  }

  function drumHit(time, kind, gainVal) {
    if (!ctx) return;
    if (kind === 'kick') {
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, time);
      osc.frequency.exponentialRampToValueAtTime(42, time + 0.12);
      g.gain.setValueAtTime(gainVal, time);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
      osc.connect(g); g.connect(musicBus);
      osc.start(time); osc.stop(time + 0.22);
    } else if (kind === 'hat') {
      noiseBurst(time, 0.03, 7000, 'highpass', gainVal * 0.5, musicBus);
    } else if (kind === 'snare') {
      noiseBurst(time, 0.12, 1800, 'bandpass', gainVal, musicBus);
      noteOn(190, time, 0.09, 'triangle', gainVal * 0.4, musicBus);
    } else if (kind === 'shaker') {
      noiseBurst(time, 0.06, 5000, 'highpass', gainVal * 0.35, musicBus);
    }
  }

  function noiseBurst(time, dur, freq, type, gainVal, bus) {
    if (!ctx) return;
    var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    var i;
    for (i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var f = ctx.createBiquadFilter();
    f.type = type || 'lowpass';
    f.frequency.value = freq || 1000;
    var g = ctx.createGain();
    g.gain.setValueAtTime(gainVal || 0.2, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    src.connect(f); f.connect(g); g.connect(bus || sfxBus);
    src.start(time);
    src.stop(time + dur + 0.02);
  }

  function scheduleStep(step, time) {
    var st = STATIONS[stationIndex];
    var bar = Math.floor(step / 16) % 4;
    var s16 = step % 16;
    var chordDeg = PROGRESSIONS[stationIndex][bar];
    var stepDur = 60 / st.bpm / 4; // 16th notes
    var swingOff = (s16 % 2 === 1) ? stepDur * st.swing : 0;
    var t = time + swingOff;

    // Drums.
    if (st.drum === 'four') {
      if (s16 % 4 === 0) drumHit(t, 'kick', 0.5);
      if (s16 % 4 === 2) drumHit(t, 'snare', 0.28);
      if (s16 % 2 === 0) drumHit(t, 'hat', 0.16);
    } else if (st.drum === 'half') {
      if (s16 === 0 || s16 === 8) drumHit(t, 'kick', 0.42);
      if (s16 === 4 || s16 === 12) drumHit(t, 'snare', 0.26);
      if (s16 % 4 === 2) drumHit(t, 'hat', 0.12);
    } else if (st.drum === 'latin') {
      if (s16 === 0 || s16 === 6 || s16 === 8) drumHit(t, 'kick', 0.4);
      if (s16 === 4 || s16 === 12) drumHit(t, 'snare', 0.24);
      drumHit(t, 'shaker', 0.14);
    } else { // boom
      if (s16 % 8 === 0) drumHit(t, 'kick', 0.55);
      if (s16 === 4 || s16 === 12) drumHit(t, 'snare', 0.3);
      if (s16 % 2 === 1) drumHit(t, 'hat', 0.1);
    }

    // Bass on its pattern, rooted on the chord.
    if (BASS_PATTERNS[stationIndex][s16]) {
      var bassMidi = scaleNote(stationIndex, chordDeg, -1);
      noteOn(midiToFreq(bassMidi), t, stepDur * 1.8, st.bassWave,
        st.bassGain, musicBus, st.bright * 0.5);
    }

    // Lead melody: pattern + deterministic pitch walk.
    if (MELODY_PATTERNS[stationIndex][s16]) {
      var r = stepRand(stationIndex, bar, s16);
      var deg = chordDeg + Math.floor(r * 5); // chord tone + neighbours
      if (r > 0.82) deg += 7; // occasional octave sparkle
      var leadMidi = scaleNote(stationIndex, deg, 1);
      noteOn(midiToFreq(leadMidi), t, stepDur * 1.6, st.wave,
        st.leadGain, musicBus, st.bright);
      // Soft harmony a third above on strong beats.
      if (s16 % 8 === 0) {
        noteOn(midiToFreq(scaleNote(stationIndex, deg + 2, 1)), t,
          stepDur * 1.4, 'sine', st.leadGain * 0.5, musicBus, st.bright);
      }
    }

    // Pad chord on bar starts (Boardwalk Talk & Palma Soul only — mellow).
    if (s16 === 0 && (stationIndex === 2 || stationIndex === 5)) {
      var i, m;
      for (i = 0; i < 3; i++) {
        m = scaleNote(stationIndex, chordDeg + i * 2, 0);
        noteOn(midiToFreq(m), t, stepDur * 14, 'sine', 0.045, musicBus);
      }
    }
  }

  function schedulerTick() {
    if (!ctx || !musicOn || muted) return;
    var st = STATIONS[stationIndex];
    var stepDur = 60 / st.bpm / 4;
    while (nextStepTime < ctx.currentTime + 0.18) {
      scheduleStep(stepIndex, nextStepTime);
      nextStepTime += stepDur;
      stepIndex = (stepIndex + 1) % 64; // 4 bars loop
    }
  }

  function startScheduler() {
    if (schedulerTimer || !ctx) return;
    stepIndex = 0;
    nextStepTime = ctx.currentTime + 0.08;
    schedulerTimer = setInterval(schedulerTick, 40);
  }

  function stopScheduler() {
    if (schedulerTimer) { clearInterval(schedulerTimer); schedulerTimer = null; }
  }

  // --- SFX (all synthesised) ------------------------------------------------

  function sfxGunshot() {
    if (!ctx) return;
    var t = ctx.currentTime;
    noiseBurst(t, 0.14, 3000, 'lowpass', 0.7, sfxBus);
    noiseBurst(t, 0.05, 8000, 'highpass', 0.4, sfxBus);
    var osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.09);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    osc.connect(g); g.connect(sfxBus);
    osc.start(t); osc.stop(t + 0.12);
  }

  function sfxExplosion() {
    if (!ctx) return;
    var t = ctx.currentTime;
    noiseBurst(t, 0.9, 400, 'lowpass', 0.9, sfxBus);
    noiseBurst(t + 0.05, 0.5, 1200, 'bandpass', 0.5, sfxBus);
    var osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.7);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    osc.connect(g); g.connect(sfxBus);
    osc.start(t); osc.stop(t + 0.85);
  }

  function sfxHorn(long) {
    if (!ctx) return;
    var t = ctx.currentTime;
    var dur = long ? 0.7 : 0.28;
    [311, 370, 415].forEach(function (freq) {
      var osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.02);
      g.gain.setValueAtTime(0.12, t + dur - 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(sfxBus);
      osc.start(t); osc.stop(t + dur + 0.05);
    });
  }

  function sfxSirenStart() {
    if (!ctx || sirenNodes) return;
    var osc = ctx.createOscillator(), g = ctx.createGain();
    var lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 750;
    lfo.type = 'sine';
    lfo.frequency.value = 0.55; // slow two-tone wail
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
    g.gain.value = 0.07;
    osc.connect(g); g.connect(sfxBus);
    osc.start(); lfo.start();
    sirenNodes = { osc: osc, gain: g, lfo: lfo };
  }

  function sfxSirenStop() {
    if (!sirenNodes) return;
    try {
      sirenNodes.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
      var n = sirenNodes;
      setTimeout(function () {
        try { n.osc.stop(); n.lfo.stop(); } catch (e) {}
      }, 400);
    } catch (e) {}
    sirenNodes = null;
  }

  function sfxChaChing() {
    if (!ctx) return;
    var t = ctx.currentTime;
    // Till drawer + two bright coin pings (E6 then B6).
    noiseBurst(t, 0.08, 2500, 'bandpass', 0.25, sfxBus);
    noteOn(midiToFreq(88), t + 0.05, 0.35, 'sine', 0.22, sfxBus);
    noteOn(midiToFreq(95), t + 0.16, 0.5, 'sine', 0.22, sfxBus);
    noteOn(midiToFreq(100), t + 0.28, 0.6, 'triangle', 0.14, sfxBus);
  }

  function sfxScreech() {
    if (!ctx) return;
    var t = ctx.currentTime;
    var osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(900, t);
    osc.frequency.linearRampToValueAtTime(1400, t + 0.25);
    osc.frequency.linearRampToValueAtTime(700, t + 0.55);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.14, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    var f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 1200; f.Q.value = 6;
    osc.connect(f); f.connect(g); g.connect(sfxBus);
    osc.start(t); osc.stop(t + 0.65);
    noiseBurst(t, 0.4, 2000, 'highpass', 0.08, sfxBus);
  }

  function sfxWaves() {
    if (!ctx) return;
    var t = ctx.currentTime;
    // One swell: filtered noise rising then falling, like a breaker.
    var len = Math.floor(ctx.sampleRate * 1.6);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    var i;
    for (i = 0; i < len; i++) {
      var env = Math.sin((i / len) * Math.PI);
      data[i] = (Math.random() * 2 - 1) * env * 0.5;
    }
    var src = ctx.createBufferSource(); src.buffer = buf;
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(400, t);
    f.frequency.linearRampToValueAtTime(900, t + 0.7);
    f.frequency.linearRampToValueAtTime(300, t + 1.6);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.6);
    g.gain.linearRampToValueAtTime(0.0001, t + 1.6);
    src.connect(f); f.connect(g); g.connect(sfxBus);
    src.start(t);
  }

  function sfxFootstep(run) {
    if (!ctx) return;
    var t = ctx.currentTime;
    noiseBurst(t, run ? 0.07 : 0.09, run ? 500 : 320, 'lowpass',
      run ? 0.22 : 0.16, sfxBus);
  }

  function sfxClick() {
    if (!ctx) return;
    noteOn(1200, ctx.currentTime, 0.05, 'square', 0.08, sfxBus);
  }

  function sfxPickup() {
    if (!ctx) return;
    var t = ctx.currentTime;
    noteOn(midiToFreq(76), t, 0.12, 'sine', 0.2, sfxBus);
    noteOn(midiToFreq(83), t + 0.08, 0.2, 'sine', 0.2, sfxBus);
  }

  function sfxCheckpoint() {
    if (!ctx) return;
    var t = ctx.currentTime;
    [72, 76, 79, 84].forEach(function (m, i) {
      noteOn(midiToFreq(m), t + i * 0.07, 0.22, 'triangle', 0.18, sfxBus);
    });
  }

  function sfxFail() {
    if (!ctx) return;
    var t = ctx.currentTime;
    [64, 61, 58].forEach(function (m, i) {
      noteOn(midiToFreq(m), t + i * 0.16, 0.3, 'sawtooth', 0.12, sfxBus);
    });
  }

  function sfxWin() {
    if (!ctx) return;
    var t = ctx.currentTime;
    [60, 64, 67, 72, 76, 79, 84].forEach(function (m, i) {
      noteOn(midiToFreq(m), t + i * 0.09, 0.4, 'triangle', 0.16, sfxBus);
    });
  }

  function sfxEngineStart() {
    if (!ctx) return;
    var t = ctx.currentTime;
    var osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(60, t);
    osc.frequency.linearRampToValueAtTime(140, t + 0.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 500;
    osc.connect(f); f.connect(g); g.connect(sfxBus);
    osc.start(t); osc.stop(t + 0.65);
  }

  function sfxDoor() {
    if (!ctx) return;
    var t = ctx.currentTime;
    noiseBurst(t, 0.1, 300, 'lowpass', 0.4, sfxBus);
    noteOn(90, t + 0.05, 0.12, 'sine', 0.25, sfxBus);
  }

  // Ambient ocean: a slow LFO-modulated filtered-noise loop, started once.
  function startWaves() {
    if (!ctx || waveNodes) return;
    var len = ctx.sampleRate * 2;
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    var i;
    for (i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 480;
    var g = ctx.createGain(); g.gain.value = 0.05;
    var lfo = ctx.createOscillator();
    var lfoGain = ctx.createGain();
    lfo.frequency.value = 0.09; // one swell every ~11 s
    lfoGain.gain.value = 0.03;
    lfo.connect(lfoGain); lfoGain.connect(g.gain);
    src.connect(f); f.connect(g); g.connect(sfxBus);
    src.start(); lfo.start();
    waveNodes = { src: src, lfo: lfo };
  }

  // --- Public API -----------------------------------------------------------

  var SFX_MAP = {
    shoot: sfxGunshot, gunshot: sfxGunshot, gun: sfxGunshot,
    explosion: sfxExplosion, explode: sfxExplosion, boom: sfxExplosion,
    horn: function () { sfxHorn(false); },
    hornLong: function () { sfxHorn(true); },
    siren: sfxSirenStart, sirenStart: sfxSirenStart,
    sirenStop: sfxSirenStop,
    money: sfxChaChing, cash: sfxChaChing, chaChing: sfxChaChing,
    screech: sfxScreech, drift: sfxScreech, tyre: sfxScreech, tire: sfxScreech,
    waves: sfxWaves, ocean: sfxWaves,
    footstep: function () { sfxFootstep(false); },
    run: function () { sfxFootstep(true); },
    step: function () { sfxFootstep(false); },
    click: sfxClick, ui: sfxClick,
    pickup: sfxPickup, collect: sfxPickup,
    checkpoint: sfxCheckpoint, race: sfxCheckpoint,
    fail: sfxFail, busted: sfxFail,
    win: sfxWin, missionComplete: sfxWin, success: sfxWin,
    engine: sfxEngineStart, engineStart: sfxEngineStart,
    door: sfxDoor, carDoor: sfxDoor
  };

  function init(state) {
    currentState = state || null;
    if (state && typeof state.radio === 'number') {
      stationIndex = ((state.radio % 6) + 6) % 6;
    }
    if (started) return;
    started = true;
    // Browsers block audio before a gesture: arm on first interaction.
    function arm() {
      if (ensureContext()) {
        startScheduler();
        startWaves();
        document.removeEventListener('keydown', arm);
        document.removeEventListener('pointerdown', arm);
      }
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', arm);
      document.addEventListener('pointerdown', arm);
    }
    // Try immediately too — harmless if the browser defers it.
    if (ensureContext()) { startScheduler(); startWaves(); }
  }

  function setStation(i) {
    var idx = ((Math.floor(i) % 6) + 6) % 6;
    stationIndex = idx;
    stepIndex = 0;
    if (currentState) currentState.radio = idx;
    if (ctx) nextStepTime = ctx.currentTime + 0.08;
    sfxClick();
    return STATIONS[idx].name;
  }

  function nextStation() {
    return setStation(stationIndex + 1);
  }

  function prevStation() {
    return setStation(stationIndex - 1);
  }

  function sfx(name) {
    if (!name) return false;
    if (!ensureContext()) return false;
    var fn = SFX_MAP[String(name)];
    if (!fn) return false;
    try { fn(); } catch (e) { return false; }
    return true;
  }

  function toggleMute() {
    muted = !muted;
    if (master && ctx) {
      master.gain.setTargetAtTime(muted ? 0 : 0.85, ctx.currentTime, 0.05);
    }
    if (!muted && ctx) startScheduler();
    return muted;
  }

  function setMuted(m) {
    muted = !!m;
    if (master && ctx) {
      master.gain.setTargetAtTime(muted ? 0 : 0.85, ctx.currentTime, 0.05);
    }
    return muted;
  }

  function setMusicOn(on) {
    musicOn = !!on;
    if (musicOn) startScheduler(); else stopScheduler();
    return musicOn;
  }

  function stationInfo() {
    return STATIONS[stationIndex];
  }

  window.SB.Audio = {
    init: init,
    setStation: setStation,
    nextStation: nextStation,
    prevStation: prevStation,
    sfx: sfx,
    toggleMute: toggleMute,
    setMuted: setMuted,
    setMusicOn: setMusicOn,
    stationInfo: stationInfo,
    startWaves: startWaves,
    stations: STATIONS.map(function (s) { return s.name; }),
    stationList: STATIONS,
    get station() { return stationIndex; },
    get muted() { return muted; },
    get ready() { return !!ctx; }
  };
})();
