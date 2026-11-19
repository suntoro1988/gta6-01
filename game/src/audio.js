// Sunset Bay — Audio (ditulis fresh untuk v7, dari SPEC)
// SB.Audio: synth WebAudio — init setelah interaksi user, sfx, 5 stasiun
// radio synth loop, setStation / nextStation. Tombol M ganti stasiun.
(function () {
  'use strict';
  var SB = window.SB = window.SB || {};

  var ctx = null, master = null, musicBus = null, noiseBuf = null;
  var stations = ['BAY FM', 'SUNSET DRIVE', 'PALM COURT', 'NIGHT WAVE', 'TIDE FM'];
  var station = 0, step = 0, nextTime = 0, musicTimer = null, musicOn = false;

  // Pola musik per stasiun: root MIDI, bpm, wave bass, pola bass & lead
  // (angka = langkah skala pentatonik, 0 = istirahat).
  var PATTERNS = [
    { root: 45, bpm: 112, wave: 'square', bass: [0, 0, 3, 0, 5, 0, 3, 2], lead: [0, 2, 0, 4, 0, 5, 4, 2] },   // BAY FM — pop cerah
    { root: 43, bpm: 96,  wave: 'sawtooth', bass: [0, 0, 0, 3, 0, 5, 0, 0], lead: [0, 0, 3, 0, 0, 4, 0, 7] }, // SUNSET DRIVE — santai
    { root: 48, bpm: 120, wave: 'triangle', bass: [0, 3, 0, 5, 0, 3, 2, 0], lead: [2, 0, 4, 0, 5, 0, 7, 5] }, // PALM COURT — jazzy
    { root: 41, bpm: 84,  wave: 'sine', bass: [0, 0, 0, 0, 3, 0, 0, 5], lead: [0, 0, 0, 2, 0, 0, 4, 0] },     // NIGHT WAVE — malam
    { root: 46, bpm: 128, wave: 'sawtooth', bass: [0, 3, 5, 3, 0, 3, 5, 7], lead: [0, 4, 0, 5, 7, 5, 4, 0] }    // TIDE FM — energik
  ];
  var PENTA = [0, 2, 4, 7, 9, 12, 14, 16]; // langkah skala mayor pentatonik

  function midi(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function makeNoise() {
    var len = ctx.sampleRate * 1;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  function tone(freq, dur, type, vol, slideTo, when, dest) {
    var t0 = when || ctx.currentTime;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(vol || 0.2, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(dest || master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function noise(dur, vol, cutoff, when) {
    var t0 = when || ctx.currentTime;
    var s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = cutoff || 1200;
    var g = ctx.createGain();
    g.gain.setValueAtTime(vol || 0.3, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t0); s.stop(t0 + dur + 0.02);
  }

  function musicStep() {
    if (!ctx || !musicOn) return;
    var pat = PATTERNS[station];
    var spb = 60 / pat.bpm / 2; // langkah = 1/8 ketuk
    while (nextTime < ctx.currentTime + 0.25) {
      var i = step % 8;
      var b = pat.bass[i], l = pat.lead[i];
      if (b) tone(midi(pat.root + PENTA[b - 1]), spb * 1.8, pat.wave, 0.10, 0, nextTime, musicBus);
      if (l) tone(midi(pat.root + 12 + PENTA[l - 1]), spb * 0.9, 'sine', 0.07, 0, nextTime, musicBus);
      if (i === 0) noise(spb * 0.4, 0.05, 6000, nextTime); // hi-hat tipis tiap bar
      step++;
      nextTime += spb;
    }
  }

  function startMusic() {
    if (!ctx || musicOn) return;
    musicOn = true;
    step = 0;
    nextTime = ctx.currentTime + 0.1;
    musicTimer = setInterval(musicStep, 110);
  }

  function stopMusic() {
    musicOn = false;
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  }

  SB.Audio = {
    stations: stations,

    init: function () {
      // Hanya dipanggil setelah interaksi user (klik / tombol).
      if (ctx) {
        if (ctx.state === 'suspended') ctx.resume();
        return;
      }
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      musicBus = ctx.createGain();
      musicBus.gain.value = 0.35;
      musicBus.connect(master);
      makeNoise();
      startMusic();
    },

    sfx: function (name) {
      if (!ctx) return;
      try {
        if (name === 'busted') name = 'bust'; // alias dari Game (WASTED/BUSTED)
        if (name === 'shoot') {
          noise(0.09, 0.35, 3000);
          tone(190, 0.10, 'square', 0.22, 55);
        } else if (name === 'punch') {
          tone(140, 0.09, 'sine', 0.3, 60);
          noise(0.06, 0.2, 900);
        } else if (name === 'crash') {
          noise(0.28, 0.4, 700);
          tone(75, 0.25, 'sine', 0.35, 38);
        } else if (name === 'pickup') {
          tone(660, 0.08, 'sine', 0.22);
          tone(880, 0.12, 'sine', 0.22, 0, ctx.currentTime + 0.08);
        } else if (name === 'mission') {
          var seq = [523, 659, 784, 1046];
          for (var i = 0; i < seq.length; i++)
            tone(seq[i], 0.16, 'triangle', 0.22, 0, ctx.currentTime + i * 0.11);
        } else if (name === 'click') {
          tone(1000, 0.035, 'square', 0.12);
        } else if (name === 'horn') {
          tone(370, 0.18, 'square', 0.14);
          tone(466, 0.18, 'square', 0.14, 0, ctx.currentTime + 0.02);
        } else if (name === 'bust') {
          tone(392, 0.18, 'sawtooth', 0.18, 196);
          tone(196, 0.3, 'sawtooth', 0.18, 98, ctx.currentTime + 0.18);
        } else if (name === 'engine') {
          tone(90, 0.2, 'sawtooth', 0.10, 140);
        }
      } catch (e) { /* audio tidak boleh mematikan game */ }
    },

    setStation: function (i) {
      station = ((i % stations.length) + stations.length) % stations.length;
      step = 0;
      if (ctx) nextTime = ctx.currentTime + 0.05;
      if (SB.HUD) SB.HUD.showMessage('♪ Radio: ' + stations[station]);
    },

    nextStation: function () {
      SB.Audio.setStation(station + 1);
      SB.Audio.sfx('click');
    },

    stationName: function () { return stations[station]; },
    stationIndex: function () { return station; },
    toggleMusic: function () {
      if (musicOn) stopMusic(); else startMusic();
    }
  };
})();
