// Sunset Bay — Audio (v8, written fresh from SPEC-v8)
// window.SB.Audio: { init, sfx, stations, setStation, nextStation }
// All sound is synthesized with WebAudio — no audio files, no network.
(function () {
  'use strict';
  var SB = window.SB = window.SB || {};

  var actx = null;
  var master = null;
  var musicGain = null;
  var station = 0;
  var musicTimer = null;
  var step = 0;

  // Per-station character: waveform, tempo (steps/sec), scale, bass note.
  var STYLES = [
    { wave: 'triangle', tempo: 6, scale: [0, 3, 5, 7, 10, 12], bass: 55, name: 'BAY FM' },
    { wave: 'sawtooth', tempo: 8, scale: [0, 2, 4, 7, 9, 12], bass: 49, name: 'SUNSET DRIVE' },
    { wave: 'sine', tempo: 5, scale: [0, 4, 5, 7, 11, 12], bass: 65, name: 'PALM COURT' },
    { wave: 'square', tempo: 10, scale: [0, 3, 5, 6, 10, 12], bass: 46, name: 'NIGHT WAVE' },
    { wave: 'sine', tempo: 7, scale: [0, 2, 5, 7, 9, 12], bass: 58, name: 'TIDE FM' }
  ];

  function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }

  function tone(freq, dur, type, vol, when, dest) {
    if (!actx) return;
    var t0 = when || actx.currentTime;
    var o = actx.createOscillator();
    var g = actx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(vol || 0.2, 0.0001), t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(dest || master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  function noise(dur, vol, freq, when) {
    if (!actx) return;
    var t0 = when || actx.currentTime;
    var len = Math.floor(actx.sampleRate * dur);
    var buf = actx.createBuffer(1, len, actx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = actx.createBufferSource();
    src.buffer = buf;
    var f = actx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq || 1200;
    var g = actx.createGain();
    g.gain.value = vol || 0.3;
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0);
  }

  function musicStep() {
    if (!actx || !musicGain) return;
    var st = STYLES[station];
    var s = step++;
    var deg = st.scale[s % st.scale.length];
    var oct = 60 + (Math.floor(s / st.scale.length) % 2) * 12;
    // lead note every step, quieter on off-beats
    tone(midi(oct + deg), 0.22, st.wave, s % 2 === 0 ? 0.10 : 0.05, 0, musicGain);
    // bass every 4 steps
    if (s % 4 === 0) tone(midi(st.bass), 0.5, 'sine', 0.12, 0, musicGain);
    // soft hat tick every 2 steps
    if (s % 2 === 1) noise(0.03, 0.04, 6000);
  }

  function startMusic() {
    stopMusic();
    if (!actx) return;
    var st = STYLES[station];
    musicTimer = setInterval(musicStep, 1000 / st.tempo);
  }

  function stopMusic() {
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  }

  var Audio = {
    stations: ['BAY FM', 'SUNSET DRIVE', 'PALM COURT', 'NIGHT WAVE', 'TIDE FM'],
    station: 0,

    init: function () {
      if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        actx = new AC();
        master = actx.createGain();
        master.gain.value = 0.5;
        master.connect(actx.destination);
        musicGain = actx.createGain();
        musicGain.gain.value = 0.6;
        musicGain.connect(master);
        startMusic();
      } catch (e) { actx = null; }
    },

    sfx: function (name) {
      if (!actx) return;
      var t = actx.currentTime;
      if (name === 'shoot') {
        noise(0.12, 0.5, 2500, t);
        tone(180, 0.1, 'square', 0.25, t);
      } else if (name === 'crash') {
        noise(0.3, 0.5, 700, t);
        tone(70, 0.3, 'sawtooth', 0.3, t);
      } else if (name === 'pickup') {
        tone(660, 0.12, 'sine', 0.3, t);
        tone(880, 0.18, 'sine', 0.3, t + 0.09);
      } else if (name === 'mission') {
        tone(523, 0.15, 'triangle', 0.3, t);
        tone(659, 0.15, 'triangle', 0.3, t + 0.12);
        tone(784, 0.3, 'triangle', 0.3, t + 0.24);
      } else if (name === 'drift') {
        noise(0.4, 0.25, 900, t);
      } else if (name === 'busted') {
        tone(220, 0.4, 'sawtooth', 0.3, t);
        tone(175, 0.5, 'sawtooth', 0.3, t + 0.3);
      } else if (name === 'click') {
        tone(440, 0.05, 'square', 0.15, t);
      }
    },

    setStation: function (i) {
      station = ((i % 5) + 5) % 5;
      Audio.station = station;
      if (actx) startMusic();
      if (SB.HUD) SB.HUD.update();
    },

    nextStation: function () {
      Audio.setStation(station + 1);
      if (SB.HUD) SB.HUD.showMessage('Radio: ' + Audio.stations[station]);
    }
  };

  SB.Audio = Audio;
})();
