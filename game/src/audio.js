// Sunset Bay — Audio (v9, ditulis fresh dari SPEC-v8)
// window.SB.Audio: { init, sfx, stations, setStation, nextStation, station }
// Semua suara disintesis dengan WebAudio — tanpa file audio, tanpa network.
// Musik: 5 stasiun radio dengan karakter gelombang/tempo/skala berbeda,
// termasuk TIDE FM. SFX: tembakan, tabrakan, pickup, misi, drift, busted.
(function () {
  'use strict';
  var SB = window.SB = window.SB || {};

  var ctx = null;        // AudioContext (dibuat saat init, butuh gestur user)
  var masterBus = null;  // gain utama
  var radioBus = null;   // gain khusus musik radio
  var current = 0;       // indeks stasiun aktif
  var radioClock = null; // interval penjadwal nada radio
  var beat = 0;          // langkah melodi berjalan

  // Karakter tiap stasiun: bentuk gelombang lead, langkah/detik, tangga nada
  // (interval semitone dari root), dan nada bass (nomor MIDI).
  var PROGRAMS = [
    { wave: 'triangle', stepsPerSec: 6,  notes: [0, 3, 5, 7, 10, 12], bassMidi: 55, label: 'BAY FM' },
    { wave: 'sawtooth', stepsPerSec: 8,  notes: [0, 2, 4, 7, 9, 12],  bassMidi: 49, label: 'SUNSET DRIVE' },
    { wave: 'sine',     stepsPerSec: 5,  notes: [0, 4, 5, 7, 11, 12], bassMidi: 65, label: 'PALM COURT' },
    { wave: 'square',   stepsPerSec: 10, notes: [0, 3, 5, 6, 10, 12], bassMidi: 46, label: 'NIGHT WAVE' },
    { wave: 'sine',     stepsPerSec: 7,  notes: [0, 2, 5, 7, 9, 12],  bassMidi: 58, label: 'TIDE FM' }
  ];

  function midiToHz(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // Satu nada osilator dengan envelope attack/decay sederhana.
  function blip(hz, seconds, wave, loudness, at, out) {
    if (!ctx) return;
    var start = (at == null) ? ctx.currentTime : at;
    var osc = ctx.createOscillator();
    var env = ctx.createGain();
    osc.type = wave || 'sine';
    osc.frequency.setValueAtTime(hz, start);
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(Math.max(loudness || 0.2, 0.0001), start + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
    osc.connect(env);
    env.connect(out || masterBus);
    osc.start(start);
    osc.stop(start + seconds + 0.05);
  }

  // Semburan noise terfilter (tembakan, tabrakan, hi-hat radio).
  function burst(seconds, loudness, cutoffHz, at) {
    if (!ctx) return;
    var start = (at == null) ? ctx.currentTime : at;
    var len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoffHz || 1200;
    var env = ctx.createGain();
    env.gain.value = loudness || 0.3;
    src.connect(filter);
    filter.connect(env);
    env.connect(masterBus);
    src.start(start);
  }

  // Satu langkah sequencer radio: nada lead, bass tiap 4 langkah,
  // ketukan hi-hat tiap langkah genap.
  function radioStep() {
    if (!ctx || !radioBus) return;
    var prog = PROGRAMS[current];
    var n = beat++;
    var degree = prog.notes[n % prog.notes.length];
    var root = 60 + (Math.floor(n / prog.notes.length) % 2) * 12;
    blip(midiToHz(root + degree), 0.22, prog.wave, n % 2 === 0 ? 0.10 : 0.05, 0, radioBus);
    if (n % 4 === 0) blip(midiToHz(prog.bassMidi), 0.5, 'sine', 0.12, 0, radioBus);
    if (n % 2 === 1) burst(0.03, 0.04, 6000);
  }

  function startRadio() {
    stopRadio();
    if (!ctx) return;
    radioClock = setInterval(radioStep, 1000 / PROGRAMS[current].stepsPerSec);
  }

  function stopRadio() {
    if (radioClock) {
      clearInterval(radioClock);
      radioClock = null;
    }
  }

  var Audio = {
    stations: ['BAY FM', 'SUNSET DRIVE', 'PALM COURT', 'NIGHT WAVE', 'TIDE FM'],
    station: 0,

    init: function () {
      if (ctx) {
        if (ctx.state === 'suspended') ctx.resume();
        return;
      }
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        masterBus = ctx.createGain();
        masterBus.gain.value = 0.5;
        masterBus.connect(ctx.destination);
        radioBus = ctx.createGain();
        radioBus.gain.value = 0.6;
        radioBus.connect(masterBus);
        startRadio();
      } catch (e) {
        ctx = null;
      }
    },

    sfx: function (name) {
      if (!ctx) return;
      var now = ctx.currentTime;
      if (name === 'shoot') {
        burst(0.12, 0.5, 2500, now);
        blip(180, 0.1, 'square', 0.25, now);
      } else if (name === 'crash') {
        burst(0.3, 0.5, 700, now);
        blip(70, 0.3, 'sawtooth', 0.3, now);
      } else if (name === 'pickup') {
        blip(660, 0.12, 'sine', 0.3, now);
        blip(880, 0.18, 'sine', 0.3, now + 0.09);
      } else if (name === 'mission') {
        blip(523, 0.15, 'triangle', 0.3, now);
        blip(659, 0.15, 'triangle', 0.3, now + 0.12);
        blip(784, 0.3, 'triangle', 0.3, now + 0.24);
      } else if (name === 'drift') {
        burst(0.4, 0.25, 900, now);
      } else if (name === 'busted') {
        blip(220, 0.4, 'sawtooth', 0.3, now);
        blip(175, 0.5, 'sawtooth', 0.3, now + 0.3);
      } else if (name === 'click') {
        blip(440, 0.05, 'square', 0.15, now);
      }
    },

    setStation: function (i) {
      current = ((i % 5) + 5) % 5;
      Audio.station = current;
      if (ctx) startRadio();
      if (SB.HUD) SB.HUD.update();
    },

    nextStation: function () {
      Audio.setStation(current + 1);
      if (SB.HUD) SB.HUD.showMessage('Radio: ' + Audio.stations[current]);
    }
  };

  SB.Audio = Audio;
})();
