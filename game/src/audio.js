// audio.js — Sunset Bay v14, Builder F.
// All sound is synthesized with the WebAudio API. No audio files, no
// network requests. init() must be called after a user gesture
// (autoplay policy); every other function is safe to call before init
// and simply does nothing until the context exists.
// SFX: engine, siren, gunshot, pickup, mission, crash, horn, radio
// static. Radio: 6 procedural stations — each station is a looping
// pattern of oscillators, so switching stations changes the music.

window.SB = window.SB || {};

(function () {
  "use strict";

  // Musical helpers: note frequencies for the radio patterns.
  var NOTE = {
    C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.00, A3: 220.00, B3: 246.94,
    C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00, A4: 440.00, B4: 493.88,
    C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.00,
    C2: 65.41, G2: 98.00, A2: 110.00, E2: 82.41, D2: 73.42
  };

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  var AudioSys = {
    // 6 radio stations: name + genre. The player cycles them with R.
    RADIO: [
      { name: "Sunset FM", genre: "Synthwave", desc: "Golden hour synthwave" },
      { name: "Bay 102.7", genre: "Hip-Hop", desc: "West coast hip-hop" },
      { name: "Coral Rock", genre: "Rock", desc: "Guitar-driven rock" },
      { name: "Havana Nights", genre: "Latin", desc: "Salsa and Latin pop" },
      { name: "Golden Hour Jazz", genre: "Jazz", desc: "Smooth evening jazz" },
      { name: "Wave Talk", genre: "Talk", desc: "Bay news and talk radio" }
    ],
    station: 0,
    stationName: "Sunset FM",
    muted: false,
    volume: 0.6,
    ready: false,
    // WebAudio nodes, created in init().
    ctx: null,
    master: null,
    sfxGain: null,
    radioGain: null,
    engineGain: null,
    engineOsc: null,
    engineOsc2: null,
    radioTimer: null,
    radioStep: 0,
    engineOn: false,

    // Create the AudioContext and the gain graph. Call from a click /
    // keydown handler. Safe to call twice; the second call resumes.
    init: function () {
      if (typeof window === "undefined") return false;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try {
        if (!AudioSys.ctx) {
          AudioSys.ctx = new AC();
          AudioSys.master = AudioSys.ctx.createGain();
          AudioSys.master.gain.value = AudioSys.muted ? 0 : AudioSys.volume;
          AudioSys.master.connect(AudioSys.ctx.destination);
          AudioSys.sfxGain = AudioSys.ctx.createGain();
          AudioSys.sfxGain.gain.value = 0.9;
          AudioSys.sfxGain.connect(AudioSys.master);
          AudioSys.radioGain = AudioSys.ctx.createGain();
          AudioSys.radioGain.gain.value = 0.35;
          AudioSys.radioGain.connect(AudioSys.master);
          AudioSys.engineGain = AudioSys.ctx.createGain();
          AudioSys.engineGain.gain.value = 0;
          AudioSys.engineGain.connect(AudioSys.master);
        }
        if (AudioSys.ctx.state === "suspended") {
          var p = AudioSys.ctx.resume();
          if (p && typeof p.catch === "function") p.catch(function () { /* resume is best-effort */ });
        }
        AudioSys.ready = true;
        return true;
      } catch (e) {
        AudioSys.ready = false;
        return false;
      }
    },

    // True when the context exists and is running.
    isReady: function () {
      return !!AudioSys.ctx && AudioSys.ctx.state === "running";
    },

    // Mute / unmute everything. Returns the new muted state.
    toggleMute: function () {
      AudioSys.muted = !AudioSys.muted;
      AudioSys.setMuted(AudioSys.muted);
      return AudioSys.muted;
    },

    setMuted: function (m) {
      AudioSys.muted = !!m;
      if (AudioSys.master && AudioSys.ctx) {
        AudioSys.master.gain.setTargetAtTime(
          AudioSys.muted ? 0 : AudioSys.volume,
          AudioSys.ctx.currentTime, 0.05
        );
      }
      return AudioSys.muted;
    },

    setVolume: function (v) {
      AudioSys.volume = clamp(v, 0, 1);
      if (AudioSys.master && AudioSys.ctx && !AudioSys.muted) {
        AudioSys.master.gain.setTargetAtTime(AudioSys.volume, AudioSys.ctx.currentTime, 0.05);
      }
      return AudioSys.volume;
    },

    // --- Low-level synth helpers (all guarded: no ctx, no sound) ---

    _tone: function (freq, dur, type, vol, when, slideTo) {
      if (!AudioSys.ctx || !AudioSys.sfxGain) return null;
      var t0 = AudioSys.ctx.currentTime + (when || 0);
      var osc = AudioSys.ctx.createOscillator();
      var gain = AudioSys.ctx.createGain();
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(vol || 0.3, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(gain);
      gain.connect(AudioSys.sfxGain);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
      return osc;
    },

    _noise: function (dur, vol, filterFreq, filterType, when) {
      if (!AudioSys.ctx || !AudioSys.sfxGain) return null;
      var t0 = AudioSys.ctx.currentTime + (when || 0);
      var len = Math.max(1, Math.floor(AudioSys.ctx.sampleRate * dur));
      var buffer = AudioSys.ctx.createBuffer(1, len, AudioSys.ctx.sampleRate);
      var data = buffer.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      var src = AudioSys.ctx.createBufferSource();
      src.buffer = buffer;
      var filter = AudioSys.ctx.createBiquadFilter();
      filter.type = filterType || "lowpass";
      filter.frequency.value = filterFreq || 1200;
      var gain = AudioSys.ctx.createGain();
      gain.gain.setValueAtTime(vol || 0.4, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(AudioSys.sfxGain);
      src.start(t0);
      src.stop(t0 + dur + 0.05);
      return src;
    },

    // --- Sound effects. Every name below is synthesized live. ---

    sfx: function (name) {
      if (!AudioSys.ctx) return false;
      if (AudioSys.ctx.state === "suspended") AudioSys.ctx.resume();
      var n = String(name || "").toLowerCase().trim();
      switch (n) {
        case "engine":
        case "enginestart":
        case "engine_start":
          AudioSys._tone(55, 0.5, "sawtooth", 0.35, 0, 140);
          AudioSys._noise(0.4, 0.15, 500, "lowpass", 0);
          AudioSys.startEngine();
          return true;
        case "siren":
          // Two-tone police siren: high-low, three cycles.
          for (var i = 0; i < 3; i++) {
            AudioSys._tone(880, 0.28, "sine", 0.22, i * 0.56, 880);
            AudioSys._tone(660, 0.28, "sine", 0.22, i * 0.56 + 0.28, 660);
          }
          return true;
        case "gunshot":
        case "shoot":
        case "gun":
          AudioSys._noise(0.12, 0.7, 3000, "highpass", 0);
          AudioSys._noise(0.18, 0.5, 400, "lowpass", 0);
          AudioSys._tone(150, 0.12, "square", 0.3, 0, 50);
          return true;
        case "pickup":
        case "cash":
          AudioSys._tone(880, 0.09, "sine", 0.3, 0);
          AudioSys._tone(1318, 0.14, "sine", 0.3, 0.09);
          return true;
        case "mission":
        case "missioncomplete":
        case "mission_complete":
        case "success":
          AudioSys._tone(523, 0.14, "triangle", 0.32, 0);
          AudioSys._tone(659, 0.14, "triangle", 0.32, 0.13);
          AudioSys._tone(784, 0.22, "triangle", 0.32, 0.26);
          AudioSys._tone(1046, 0.3, "triangle", 0.28, 0.39);
          return true;
        case "crash":
        case "explosion":
        case "boom":
          AudioSys._noise(0.7, 0.8, 300, "lowpass", 0);
          AudioSys._noise(0.35, 0.5, 2000, "bandpass", 0);
          AudioSys._tone(90, 0.5, "sine", 0.5, 0, 35);
          return true;
        case "horn":
          AudioSys._tone(370, 0.35, "square", 0.22, 0, 370);
          AudioSys._tone(466, 0.35, "square", 0.18, 0, 466);
          return true;
        case "static":
        case "radiostatic":
        case "radio_static":
        case "radio static":
          AudioSys._noise(0.4, 0.22, 4500, "bandpass", 0);
          return true;
        case "click":
        case "ui":
          AudioSys._tone(1200, 0.05, "sine", 0.18, 0);
          return true;
        case "checkpoint":
          AudioSys._tone(660, 0.1, "sine", 0.28, 0);
          AudioSys._tone(990, 0.18, "sine", 0.28, 0.1);
          return true;
        case "fail":
        case "gameover":
          AudioSys._tone(392, 0.25, "sawtooth", 0.25, 0, 392);
          AudioSys._tone(311, 0.25, "sawtooth", 0.25, 0.24, 311);
          AudioSys._tone(233, 0.5, "sawtooth", 0.25, 0.48, 220);
          return true;
        case "splash":
          AudioSys._noise(0.35, 0.3, 900, "bandpass", 0);
          return true;
        case "footstep":
          AudioSys._noise(0.06, 0.12, 300, "lowpass", 0);
          return true;
        case "door":
          AudioSys._noise(0.15, 0.25, 600, "lowpass", 0);
          AudioSys._tone(120, 0.12, "square", 0.12, 0, 80);
          return true;
        default:
          AudioSys._tone(440, 0.1, "sine", 0.2, 0);
          return true;
      }
    },

    // --- Engine loop: a low sawtooth pair whose pitch follows speed.
    // startEngine() begins it, setEngineSpeed(0..1) revs it,
    // stopEngine() fades it out. Called by the vehicle code. ---

    startEngine: function () {
      if (!AudioSys.ctx || AudioSys.engineOn) return false;
      try {
        AudioSys.engineOsc = AudioSys.ctx.createOscillator();
        AudioSys.engineOsc2 = AudioSys.ctx.createOscillator();
        AudioSys.engineOsc.type = "sawtooth";
        AudioSys.engineOsc.frequency.value = 70;
        AudioSys.engineOsc2.type = "square";
        AudioSys.engineOsc2.frequency.value = 35;
        var filter = AudioSys.ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 500;
        AudioSys.engineOsc.connect(filter);
        AudioSys.engineOsc2.connect(filter);
        filter.connect(AudioSys.engineGain);
        AudioSys.engineOsc.start();
        AudioSys.engineOsc2.start();
        AudioSys.engineGain.gain.setTargetAtTime(0.12, AudioSys.ctx.currentTime, 0.1);
        AudioSys.engineOn = true;
        return true;
      } catch (e) {
        return false;
      }
    },

    setEngineSpeed: function (speed01) {
      var s = clamp(speed01 || 0, 0, 1);
      if (!AudioSys.ctx || !AudioSys.engineOn) return s;
      var freq = 55 + s * 180;
      AudioSys.engineOsc.frequency.setTargetAtTime(freq, AudioSys.ctx.currentTime, 0.08);
      AudioSys.engineOsc2.frequency.setTargetAtTime(freq * 0.5, AudioSys.ctx.currentTime, 0.08);
      AudioSys.engineGain.gain.setTargetAtTime(0.08 + s * 0.12, AudioSys.ctx.currentTime, 0.1);
      return s;
    },

    stopEngine: function () {
      if (!AudioSys.ctx || !AudioSys.engineOn) return false;
      try {
        AudioSys.engineGain.gain.setTargetAtTime(0, AudioSys.ctx.currentTime, 0.08);
        var o1 = AudioSys.engineOsc;
        var o2 = AudioSys.engineOsc2;
        window.setTimeout(function () {
          try { o1.stop(); } catch (e) { /* already stopped */ }
          try { o2.stop(); } catch (e) { /* already stopped */ }
        }, 400);
      } catch (e) { /* engine stop is best-effort */ }
      AudioSys.engineOn = false;
      AudioSys.engineOsc = null;
      AudioSys.engineOsc2 = null;
      return true;
    },

    // --- Radio: 6 stations, each a short looping note pattern. ---

    // Patterns per station: [note, beats] sequences, one bar each.
    // Wave Talk has no melody — it is filtered noise bursts (speech-like).
    _patterns: {
      0: { wave: "sawtooth", bass: "triangle", bpm: 96, notes: [NOTE.A3, NOTE.C4, NOTE.E4, NOTE.G4, NOTE.A4, NOTE.G4, NOTE.E4, NOTE.C4], bassNotes: [NOTE.A2, NOTE.A2, NOTE.F3, NOTE.G3] },
      1: { wave: "square", bass: "sine", bpm: 92, notes: [NOTE.C4, NOTE.C4, NOTE.E4, NOTE.G4, NOTE.A4, NOTE.G4, NOTE.E4, NOTE.D4], bassNotes: [NOTE.C2, NOTE.G2, NOTE.A2, NOTE.G2] },
      2: { wave: "sawtooth", bass: "sawtooth", bpm: 128, notes: [NOTE.E4, NOTE.G4, NOTE.A4, NOTE.G4, NOTE.E4, NOTE.D4, NOTE.C4, NOTE.D4], bassNotes: [NOTE.E2, NOTE.E2, NOTE.A2, NOTE.G2] },
      3: { wave: "triangle", bass: "sine", bpm: 110, notes: [NOTE.C4, NOTE.E4, NOTE.G4, NOTE.A4, NOTE.G4, NOTE.E4, NOTE.C4, NOTE.E4], bassNotes: [NOTE.C3, NOTE.G2, NOTE.A2, NOTE.G2] },
      4: { wave: "sine", bass: "sine", bpm: 72, notes: [NOTE.F4, NOTE.A4, NOTE.C5, NOTE.A4, NOTE.G4, NOTE.E4, NOTE.D4, NOTE.C4], bassNotes: [NOTE.F3, NOTE.D3, NOTE.G2, NOTE.C3] },
      5: { wave: "none", bass: "none", bpm: 60, notes: [], bassNotes: [] }
    },

    _radioNote: function (freq, dur, type, vol) {
      if (!AudioSys.ctx || !AudioSys.radioGain) return;
      var t0 = AudioSys.ctx.currentTime;
      var osc = AudioSys.ctx.createOscillator();
      var gain = AudioSys.ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(vol, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(gain);
      gain.connect(AudioSys.radioGain);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    },

    _radioStep: function () {
      var pattern = AudioSys._patterns[AudioSys.station];
      if (!pattern) return;
      if (AudioSys.station === 5) {
        // Talk radio: short bursts of band-passed noise, like speech.
        if (AudioSys.ctx && AudioSys.radioGain) {
          var len = Math.floor(AudioSys.ctx.sampleRate * 0.18);
          var buffer = AudioSys.ctx.createBuffer(1, len, AudioSys.ctx.sampleRate);
          var data = buffer.getChannelData(0);
          for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
          var src = AudioSys.ctx.createBufferSource();
          src.buffer = buffer;
          var filter = AudioSys.ctx.createBiquadFilter();
          filter.type = "bandpass";
          filter.frequency.value = 900 + Math.random() * 600;
          src.connect(filter);
          filter.connect(AudioSys.radioGain);
          src.start();
        }
        return;
      }
      var notes = pattern.notes;
      var bass = pattern.bassNotes;
      var idx = AudioSys.radioStep % notes.length;
      var beat = 60 / pattern.bpm;
      AudioSys._radioNote(notes[idx], beat * 0.9, pattern.wave, 0.16);
      if (idx % 2 === 0) {
        var bIdx = Math.floor(idx / 2) % bass.length;
        AudioSys._radioNote(bass[bIdx], beat * 1.8, pattern.bass, 0.22);
      }
      AudioSys.radioStep++;
    },

    _startRadioLoop: function () {
      AudioSys._stopRadioLoop();
      if (!AudioSys.ctx) return;
      var pattern = AudioSys._patterns[AudioSys.station];
      var beat = 60 / (pattern ? pattern.bpm : 90);
      AudioSys.radioTimer = window.setInterval(function () {
        if (!AudioSys.muted) AudioSys._radioStep();
      }, Math.max(120, beat * 500));
    },

    _stopRadioLoop: function () {
      if (AudioSys.radioTimer) {
        window.clearInterval(AudioSys.radioTimer);
        AudioSys.radioTimer = null;
      }
    },

    // Switch station by index (wraps 0..5). Plays a burst of radio
    // static, then starts the new station's pattern. Returns the
    // station object now playing.
    setStation: function (i) {
      var count = AudioSys.RADIO.length;
      var idx = ((Math.floor(i) || 0) % count + count) % count;
      var changed = idx !== AudioSys.station;
      AudioSys.station = idx;
      AudioSys.stationName = AudioSys.RADIO[idx].name;
      AudioSys.radioStep = 0;
      if (changed && AudioSys.ctx) AudioSys.sfx("static");
      if (AudioSys.ctx) AudioSys._startRadioLoop();
      return AudioSys.RADIO[idx];
    },

    nextStation: function () {
      return AudioSys.setStation(AudioSys.station + 1);
    },

    prevStation: function () {
      return AudioSys.setStation(AudioSys.station - 1);
    },

    currentStation: function () {
      return AudioSys.RADIO[AudioSys.station];
    },

    stopRadio: function () {
      AudioSys._stopRadioLoop();
      return true;
    },

    startRadio: function () {
      if (AudioSys.ctx) AudioSys._startRadioLoop();
      return AudioSys.RADIO[AudioSys.station];
    }
  };

  SB.Audio = AudioSys;
})();
