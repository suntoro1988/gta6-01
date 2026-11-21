// audio.js — Sunset Bay (v11)
// All-original WebAudio synthesis for Sunset Bay. No audio files, no
// licensed music, no borrowed songs, no borrowed franchise names anywhere.
// Every station, DJ, shop, character and jingle below is invented here.
//
// Design:
//  * 5 original radio stations, each with one genre, one invented DJ
//    persona (text lines only — never audio clips), a scale, a tempo
//    and a synth voice. Music is generated live with oscillators.
//  * Radio is DIEGETIC: it only sounds inside a vehicle. Every stolen
//    car remembers its own last station (vehicle.radioStation), so
//    jacking a new car can mean a new station.
//  * District ambience (beach surf, market crowd, night crickets,
//    downtown traffic, harbour gulls) fades with district + time of day.
//  * One-shot synth SFX: gunshot, explosion, horn, police siren,
//    cash pickup, reload, door, engine start, radio static blip.

'use strict';

// ---------------------------------------------------------------------
// Original stations. Names, DJs and taglines are all invented here.
// ---------------------------------------------------------------------
export const RADIO_STATIONS = [
  {
    id: 'bay-breeze',
    name: 'Bay Breeze FM',
    freq: '91.2',
    genre: 'chill beach / surf pop',
    tagline: 'Slow waves, slower afternoons.',
    dj: { name: 'Marina Sol', style: 'warm, unhurried, barefoot-radio host' },
    tempo: 76,
    scale: [0, 2, 4, 7, 9],       // major pentatonic
    root: 220.0,                  // A3
    wave: 'triangle',
    colour: '#4fc3c9',
    lines: [
      'Marina Sol here — the tide is in, the coffee is hot, and the bay is doing all the work today.',
      'If you are driving along the shore right now, roll the window down. That is the whole show.',
      'Next up, a song about a boat that never left the harbour. It did not need to.',
      'Bay Breeze FM — where the weather report is always "lovely, probably".',
    ],
  },
  {
    id: 'neon-tide',
    name: 'Neon Tide',
    freq: '98.7',
    genre: 'night electronic / synthwave',
    tagline: 'The city lights up, so do we.',
    dj: { name: 'DJ Volt', style: 'fast, hype, talks over the beat' },
    tempo: 122,
    scale: [0, 2, 3, 5, 7, 8, 10], // natural minor
    root: 110.0,                    // A2
    wave: 'sawtooth',
    colour: '#ff4fd8',
    lines: [
      'DJ Volt on Neon Tide — if your headlights are on, you are already dancing.',
      'This one goes out to everyone stuck at the red light on Meridian Avenue. Green is coming.',
      'Turn it up. The neighbours on the third floor already did.',
      'Neon Tide, ninety-eight point seven — the night shift starts now.',
    ],
  },
  {
    id: 'palm-talk',
    name: 'Palm Talk 88',
    freq: '88.4',
    genre: 'satirical talk show',
    tagline: 'All opinions, no refunds.',
    dj: { name: 'Rico Palmas', style: 'dry, sarcastic, loves caller arguments' },
    tempo: 92,
    scale: [0, 3, 5, 7, 10], // minor pentatonic, used for bumper stings only
    root: 196.0,
    wave: 'sine',
    colour: '#ffb020',
    lines: [
      'Rico Palmas, Palm Talk 88. Caller, you are wrong, but please continue — the ratings love it.',
      'Today we ask: should the harbour charge seagulls rent? The seagulls declined to comment.',
      'A listener writes in: "Rico, the traffic is terrible." Friend, the traffic is the city. You are the traffic.',
      'Palm Talk 88 — all opinions, no refunds, and absolutely no apologies.',
    ],
  },
  {
    id: 'coral-rock',
    name: 'Coral Rock Radio',
    freq: '104.9',
    genre: 'indie rock / garage',
    tagline: 'Loud guitars, salty air.',
    dj: { name: 'June Harbor', style: 'enthusiastic, shouts the band names' },
    tempo: 138,
    scale: [0, 2, 3, 5, 7, 9, 10],
    root: 146.83, // D3
    wave: 'square',
    colour: '#ff5a3c',
    lines: [
      'June Harbor, Coral Rock Radio — that last one was recorded in a garage two streets from the pier!',
      'If your car does not shake a little when the chorus hits, your speakers are broken. Sorry, that is science.',
      'Coming up: a band named after a bus stop. You will know why when you hear the chorus.',
      'Coral Rock Radio — loud guitars, salty air, zero apologies.',
    ],
  },
  {
    id: 'midnight-meridian',
    name: 'Midnight Meridian',
    freq: '101.5',
    genre: 'late-night jazz / soul',
    tagline: 'For drivers who are not in a hurry.',
    dj: { name: 'Theo Nightingale', style: 'low, slow, reads the city like a poem' },
    tempo: 64,
    scale: [0, 2, 4, 6, 7, 9, 11], // lydian-ish, dreamy
    root: 174.61, // F3
    wave: 'sine',
    colour: '#7a6cff',
    lines: [
      'Theo Nightingale, Midnight Meridian. The bay is dark, the lights are gold, and you are exactly on time.',
      'This next piece is for the night drivers, the harbour workers, and anyone who ever missed a turn on purpose.',
      'Somewhere out there a lighthouse is blinking. It has been blinking for a hundred years. It has never once been in a hurry.',
      'Midnight Meridian — for drivers who are not in a hurry.',
    ],
  },
];

export const STATION_BY_ID = {};
for (const s of RADIO_STATIONS) STATION_BY_ID[s.id] = s;

// District ambience definitions. All generated with filtered noise /
// oscillators — no recordings.
export const DISTRICT_AMBIENCE = {
  beach:   { label: 'Beach surf',      waves: 0.9, crowd: 0.15, crickets: 0.0, traffic: 0.05, gulls: 0.5 },
  market:  { label: 'Market crowd',    waves: 0.0, crowd: 0.9,  crickets: 0.0, traffic: 0.25, gulls: 0.0 },
  downtown:{ label: 'Downtown traffic',waves: 0.0, crowd: 0.5,  crickets: 0.0, traffic: 0.9,  gulls: 0.0 },
  harbour: { label: 'Harbour',         waves: 0.55,crowd: 0.25, crickets: 0.0, traffic: 0.2,  gulls: 0.8 },
  suburb:  { label: 'Quiet suburb',    waves: 0.0, crowd: 0.1,  crickets: 0.35,traffic: 0.15, gulls: 0.0 },
  hills:   { label: 'Hills at night',  waves: 0.0, crowd: 0.0,  crickets: 0.8, traffic: 0.0,  gulls: 0.0 },
};

function noteFreq(root, semitone) {
  return root * Math.pow(2, semitone / 12);
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.radioGain = null;
    this.ambGain = null;
    this.sfxGain = null;
    this.muted = false;
    this.started = false;

    // Radio state — diegetic, per vehicle.
    this.currentVehicle = null;      // vehicle object the player is in
    this.stationIndex = 0;
    this.station = RADIO_STATIONS[0];
    this.radioOn = false;
    this._musicTimer = null;
    this._step = 0;
    this._djTimer = null;
    this._lastDjLine = -1;
    this._noiseBuffer = null;

    // Ambience state.
    this.district = 'downtown';
    this.hour = 12;                  // 0..23
    this._ambNodes = null;           // { waves, crowd, crickets, traffic, gulls }
    this._sirenNodes = null;
    this._engineOsc = null;
    this._engineGain = null;
  }

  // Must be called from a user gesture at least once (browser policy).
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return this.ctx; }
    const AC = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext));
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    this.radioGain = this.ctx.createGain(); this.radioGain.gain.value = 0.0;
    this.radioGain.connect(this.master);
    this.ambGain = this.ctx.createGain(); this.ambGain.gain.value = 0.55;
    this.ambGain.connect(this.master);
    this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = 0.9;
    this.sfxGain.connect(this.master);
    this._noiseBuffer = this._makeNoiseBuffer(2);
    this.started = true;
    this._startAmbience();
    return this.ctx;
  }

  _makeNoiseBuffer(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _noiseSource(loop) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.loop = !!loop;
    return src;
  }

  setMuted(m) {
    this.muted = !!m;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.9;
  }

  // ---------------------------------------------------------------
  // Radio — diegetic: only audible inside a vehicle.
  // ---------------------------------------------------------------
  enterVehicle(vehicle) {
    this.init();
    this.currentVehicle = vehicle || null;
    if (vehicle && vehicle.radioStation) {
      const idx = RADIO_STATIONS.findIndex((s) => s.id === vehicle.radioStation);
      if (idx >= 0) this.stationIndex = idx;
    } else if (vehicle) {
      // A freshly stolen car keeps whatever its previous driver left on.
      const idx = Math.floor(Math.random() * RADIO_STATIONS.length);
      this.stationIndex = idx;
      vehicle.radioStation = RADIO_STATIONS[idx].id;
    }
    this.station = RADIO_STATIONS[this.stationIndex];
    this.setRadio(true);
    return this.station;
  }

  exitVehicle() {
    this.currentVehicle = null;
    this.setRadio(false);
  }

  // Remember the station on the vehicle itself, per the brief.
  setStation(indexOrId) {
    let idx = -1;
    if (typeof indexOrId === 'string') idx = RADIO_STATIONS.findIndex((s) => s.id === indexOrId);
    else idx = indexOrId;
    if (idx < 0 || idx >= RADIO_STATIONS.length) return this.station;
    this.stationIndex = idx;
    this.station = RADIO_STATIONS[idx];
    if (this.currentVehicle) this.currentVehicle.radioStation = this.station.id;
    this._step = 0;
    this._blip();
    return this.station;
  }

  nextStation() {
    return this.setStation((this.stationIndex + 1) % RADIO_STATIONS.length);
  }

  prevStation() {
    return this.setStation((this.stationIndex - 1 + RADIO_STATIONS.length) % RADIO_STATIONS.length);
  }

  setRadio(on) {
    this.radioOn = !!on && !!this.currentVehicle;
    if (this.radioGain) {
      const t = this.ctx.currentTime;
      this.radioGain.gain.cancelScheduledValues(t);
      this.radioGain.gain.linearRampToValueAtTime(this.radioOn ? 0.5 : 0.0, t + 0.4);
    }
    if (this.radioOn) this._startMusicLoop();
    else this._stopMusicLoop();
    return this.radioOn;
  }

  // DJ chatter is TEXT for the HUD/subtitle system, never an audio
  // clip. Callers poll getDjLine() and show it as a subtitle.
  getDjLine() {
    const lines = this.station.lines;
    let i = Math.floor(Math.random() * lines.length);
    if (i === this._lastDjLine) i = (i + 1) % lines.length;
    this._lastDjLine = i;
    return { dj: this.station.dj.name, station: this.station.name, text: lines[i] };
  }

  _startMusicLoop() {
    this._stopMusicLoop();
    if (!this.ctx) return;
    const beatMs = 60000 / this.station.tempo / 2; // eighth notes
    this._musicTimer = setInterval(() => this._playStep(), beatMs);
  }

  _stopMusicLoop() {
    if (this._musicTimer) { clearInterval(this._musicTimer); this._musicTimer = null; }
    if (this._djTimer) { clearInterval(this._djTimer); this._djTimer = null; }
  }

  // One generative step: bass on the beat, a pentatonic melody note
  // every other step, a soft hat tick from filtered noise. Talk radio
  // (Palm Talk 88) only plays short bumper stings, leaving room for
  // the DJ text lines.
  _playStep() {
    if (!this.ctx || !this.radioOn) return;
    const st = this.station;
    const step = this._step++;
    const t = this.ctx.currentTime;
    const bar = Math.floor(step / 8) % 4;
    const chordRoots = [0, 0, 7, 5]; // I, I, V, IV-ish movement
    const rootSemi = chordRoots[bar];

    if (st.id === 'palm-talk') {
      if (step % 16 === 0) this._tone(noteFreq(st.root, 0), 0.18, 'sine', 0.12, t);
      if (step % 16 === 4) this._tone(noteFreq(st.root, 7), 0.12, 'sine', 0.08, t);
      return;
    }

    if (step % 4 === 0) {
      this._tone(noteFreq(st.root / 2, rootSemi), 0.5, st.wave, 0.16, t);
    }
    if (step % 2 === 0 && Math.random() < 0.75) {
      const scale = st.scale;
      const deg = scale[Math.floor(Math.random() * scale.length)];
      const oct = Math.random() < 0.25 ? 12 : 0;
      this._tone(noteFreq(st.root, rootSemi + deg + oct), 0.28, st.wave, 0.07, t + 0.02);
    }
    if (step % 2 === 1) this._hat(t);
  }

  _tone(freq, dur, wave, vol, when) {
    const t = when || this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = wave || 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(this.radioGain);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  _hat(when) {
    const t = when || this.ctx.currentTime;
    const src = this._noiseSource(false);
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'highpass'; filt.frequency.value = 7000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(filt); filt.connect(g); g.connect(this.radioGain);
    src.start(t); src.stop(t + 0.06);
  }

  _blip() {
    if (!this.ctx || !this.radioGain) return;
    this._tone(880, 0.07, 'sine', 0.08, this.ctx.currentTime);
  }

  // ---------------------------------------------------------------
  // District ambience. Volume follows district + time of day:
  // crickets rise at night, market crowd peaks at midday, waves are
  // constant on the beach, traffic peaks at rush hour.
  // ---------------------------------------------------------------
  setDistrict(district, hour) {
    if (district && DISTRICT_AMBIENCE[district]) this.district = district;
    if (hour != null && Number.isFinite(hour)) this.hour = ((hour % 24) + 24) % 24;
    this._applyAmbience();
  }

  setTimeOfDay(hour) { this.setDistrict(this.district, hour); }

  _startAmbience() {
    if (!this.ctx || this._ambNodes) return;
    const mk = (type, freq, q) => {
      const src = this._noiseSource(true);
      const filt = this.ctx.createBiquadFilter();
      filt.type = type; filt.frequency.value = freq; filt.Q.value = q || 1;
      const g = this.ctx.createGain(); g.gain.value = 0;
      src.connect(filt); filt.connect(g); g.connect(this.ambGain);
      src.start();
      return { src, filt, gain: g };
    };
    // Waves: slow LFO on a low-passed noise bed.
    const waves = mk('lowpass', 500, 0.7);
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 0.12; lfoGain.gain.value = 0.08;
    lfo.connect(lfoGain); lfoGain.connect(waves.gain.gain); lfo.start();
    this._ambNodes = {
      waves,
      crowd: mk('bandpass', 900, 0.6),
      crickets: mk('highpass', 4200, 1),
      traffic: mk('lowpass', 300, 0.8),
      gulls: mk('bandpass', 2400, 4),
    };
    this._applyAmbience();
  }

  _applyAmbience() {
    if (!this._ambNodes) return;
    const def = DISTRICT_AMBIENCE[this.district] || DISTRICT_AMBIENCE.downtown;
    const h = this.hour;
    const night = (h >= 20 || h < 6) ? 1 : (h >= 18 || h < 8 ? 0.5 : 0);
    const midday = (h >= 10 && h <= 15) ? 1 : 0.4;
    const rush = ((h >= 7 && h <= 9) || (h >= 17 && h <= 19)) ? 1 : 0.45;
    const t = this.ctx.currentTime;
    const set = (node, v) => node.gain.gain.linearRampToValueAtTime(Math.max(0, Math.min(0.5, v)), t + 1.2);
    set(this._ambNodes.waves, def.waves * 0.35);
    set(this._ambNodes.crowd, def.crowd * 0.22 * midday);
    set(this._ambNodes.crickets, def.crickets * 0.16 * (0.25 + 0.75 * night));
    set(this._ambNodes.traffic, def.traffic * 0.2 * rush);
    set(this._ambNodes.gulls, def.gulls * 0.06);
  }

  // ---------------------------------------------------------------
  // One-shot synth SFX.
  // ---------------------------------------------------------------
  _burst(dur, filterType, filterFreq, vol, when) {
    if (!this.ctx) return;
    const t = when || this.ctx.currentTime;
    const src = this._noiseSource(false);
    const filt = this.ctx.createBiquadFilter();
    filt.type = filterType; filt.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(this.sfxGain);
    src.start(t); src.stop(t + dur + 0.02);
  }

  _sfxTone(freq, dur, wave, vol, slideTo) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = wave; osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(this.sfxGain);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  sfxGunshot() {
    // Sharp crack: noise burst + a low thump.
    this._burst(0.12, 'highpass', 1200, 0.5);
    this._sfxTone(160, 0.1, 'sine', 0.35, 55);
  }

  sfxExplosion() {
    this._burst(0.9, 'lowpass', 400, 0.8);
    this._sfxTone(90, 0.8, 'sine', 0.5, 30);
    this._burst(0.3, 'highpass', 2000, 0.25);
  }

  sfxHorn(long) {
    const d = long ? 0.7 : 0.28;
    this._sfxTone(370, d, 'square', 0.12);
    this._sfxTone(466, d, 'square', 0.1);
  }

  sfxSirenStart() {
    if (!this.ctx || this._sirenNodes) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    const g = this.ctx.createGain(); g.gain.value = 0.0;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.5;
    const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 280;
    lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
    osc.frequency.value = 850;
    osc.connect(g); g.connect(this.sfxGain);
    g.gain.linearRampToValueAtTime(0.08, this.ctx.currentTime + 0.5);
    osc.start(); lfo.start();
    this._sirenNodes = { osc, lfo, gain: g };
  }

  sfxSirenStop() {
    if (!this._sirenNodes) return;
    const { osc, lfo, gain } = this._sirenNodes;
    gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.4);
    setTimeout(() => { try { osc.stop(); lfo.stop(); } catch (e) {} }, 500);
    this._sirenNodes = null;
  }

  sfxCashPickup() {
    // Bright two-note "cha-ching" — pure synth, no sample.
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._sfxTone(1320, 0.12, 'sine', 0.18);
    setTimeout(() => this._sfxTone(1760, 0.22, 'sine', 0.18), 90);
    void t;
  }

  sfxReload() {
    this._burst(0.05, 'bandpass', 1800, 0.2);
    setTimeout(() => this._burst(0.06, 'bandpass', 1200, 0.25), 180);
    setTimeout(() => this._burst(0.05, 'bandpass', 2400, 0.2), 360);
  }

  sfxDoor() { this._burst(0.09, 'lowpass', 700, 0.3); }
  sfxEngineStart() { this._sfxTone(70, 0.5, 'sawtooth', 0.12, 140); }
  sfxClick() { this._burst(0.03, 'highpass', 3000, 0.12); }
  sfxMissionDone() {
    if (!this.ctx) return;
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this._sfxTone(f, 0.25, 'triangle', 0.16), i * 110));
  }
  sfxMissionFail() {
    [392, 330, 262].forEach((f, i) => setTimeout(() => this._sfxTone(f, 0.3, 'triangle', 0.14), i * 140));
  }

  // Simple engine hum while driving; call with speed 0..1, or 0 to stop.
  setEngine(speed) {
    if (!this.ctx) return;
    if (speed <= 0.02) {
      if (this._engineOsc) {
        try { this._engineOsc.stop(); } catch (e) {}
        this._engineOsc = null; this._engineGain = null;
      }
      return;
    }
    if (!this._engineOsc) {
      this._engineOsc = this.ctx.createOscillator();
      this._engineOsc.type = 'sawtooth';
      this._engineGain = this.ctx.createGain();
      this._engineGain.gain.value = 0.03;
      const filt = this.ctx.createBiquadFilter();
      filt.type = 'lowpass'; filt.frequency.value = 600;
      this._engineOsc.connect(filt); filt.connect(this._engineGain);
      this._engineGain.connect(this.sfxGain);
      this._engineOsc.start();
    }
    this._engineOsc.frequency.value = 60 + speed * 160;
    this._engineGain.gain.value = 0.02 + speed * 0.05;
  }

  dispose() {
    this._stopMusicLoop();
    this.sfxSirenStop();
    if (this.ctx) { try { this.ctx.close(); } catch (e) {} }
    this.ctx = null; this.started = false;
  }
}

export const audio = new AudioEngine();

if (typeof window !== 'undefined') {
  window.SunsetAudio = window.SunsetAudio || {};
  window.SunsetAudio.AudioEngine = AudioEngine;
  window.SunsetAudio.RADIO_STATIONS = RADIO_STATIONS;
  window.SunsetAudio.DISTRICT_AMBIENCE = DISTRICT_AMBIENCE;
  window.SunsetAudio.audio = audio;
}
