// audio.js — Sunset Bay v6 (fresh rewrite, session-recorded)
// Standalone WebAudio synth. No imports, no audio files, no network.
// Named export: createAudio() -> { sfx, nextStation, setStation, toggleMute, stationName }
const STATIONS = [
  { name: 'BAY FM', bpm: 96, wave: 'triangle', root: 220, scale: [0, 3, 5, 7, 10], bass: [0, 0, -4, 3], bright: 0.5 },
  { name: 'SUNSET DRIVE', bpm: 112, wave: 'sawtooth', root: 196, scale: [0, 2, 4, 7, 9], bass: [0, -2, 5, 3], bright: 0.35 },
  { name: 'NEON NIGHTS', bpm: 124, wave: 'square', root: 174.61, scale: [0, 3, 5, 6, 10], bass: [0, 0, 3, -2], bright: 0.3 },
  { name: 'PALM COURT', bpm: 84, wave: 'sine', root: 261.63, scale: [0, 2, 4, 7, 11], bass: [0, 4, -3, 5], bright: 0.6 },
  { name: 'TIDE FM', bpm: 100, wave: 'triangle', root: 207.65, scale: [0, 2, 3, 7, 8], bass: [0, -5, 3, 0], bright: 0.55 },
];
const NOTE = (semi) => 440 * Math.pow(2, semi / 12);

export function createAudio() {
  let ctx = null;
  let master = null;
  let musicGain = null;
  let sfxGain = null;
  let muted = false;
  let station = 0;
  let step = 0;
  let timer = null;
  let engineOsc = null;
  let engineGain = null;

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9; master.connect(ctx.destination);
    musicGain = ctx.createGain(); musicGain.gain.value = 0.16; musicGain.connect(master);
    sfxGain = ctx.createGain(); sfxGain.gain.value = 0.5; sfxGain.connect(master);
    startSequencer();
    return true;
  }
  function tone(freq, dur, type, vol, when, dest) {
    if (!ctx) return;
    const t = when || ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.3, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || sfxGain);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function noiseBurst(dur, vol, filterFreq) {
    if (!ctx) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterFreq || 1800;
    const g = ctx.createGain(); g.gain.value = vol || 0.4;
    src.connect(f); f.connect(g); g.connect(sfxGain); src.start();
  }
  function startSequencer() {
    if (timer) return;
    timer = setInterval(() => {
      if (!ctx || muted) return;
      const st = STATIONS[station];
      const beat = 60 / st.bpm / 2; // eighth notes
      const idx = step % 16;
      const barStep = step % 4;
      // bass on beats 0 and 2 of each bar
      if (idx % 4 === 0) {
        const semis = st.bass[(idx / 4) | 0];
        tone(st.root * Math.pow(2, semis / 12) / 2, beat * 3.2, 'sine', 0.5, ctx.currentTime, musicGain);
      }
      // melody: pentatonic walk, deterministic-ish pattern per station
      const pat = [0, 2, 1, 4, 3, 2, 4, 1, 0, 3, 2, 4, 1, 2, 0, 3];
      const deg = st.scale[pat[idx] % st.scale.length];
      const oct = pat[idx] >= 4 ? 2 : 1;
      tone(st.root * Math.pow(2, deg / 12) * oct, beat * 0.9, st.wave, st.bright * 0.35, ctx.currentTime, musicGain);
      // hat tick on off-beats for faster stations
      if (st.bpm >= 110 && idx % 2 === 1) noiseBurst(0.03, 0.05, 6000);
      step++;
      void barStep;
    }, 130);
    // tempo handled loosely: 130ms tick approximates eighth notes across stations;
    // bpm differences come through in pattern density via wave/brightness.
  }
  function sirenLoop() {
    if (!ctx) return;
    const o = ctx.createOscillator(); o.type = 'sine';
    const g = ctx.createGain(); g.gain.value = 0.12;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.7;
    const lg = ctx.createGain(); lg.gain.value = 320;
    lfo.connect(lg); lg.connect(o.frequency); o.frequency.value = 780;
    o.connect(g); g.connect(sfxGain);
    o.start(); lfo.start();
    setTimeout(() => { try { o.stop(); lfo.stop(); } catch (e) {} }, 1800);
  }
  function sfx(name) {
    if (!ensure()) return;
    switch (name) {
      case 'shoot': noiseBurst(0.09, 0.5, 2400); tone(180, 0.08, 'square', 0.25); break;
      case 'punch': noiseBurst(0.07, 0.45, 900); tone(90, 0.1, 'sine', 0.4); break;
      case 'pickup': tone(660, 0.09, 'sine', 0.3); tone(990, 0.14, 'sine', 0.3, ctx.currentTime + 0.08); break;
      case 'crash': noiseBurst(0.35, 0.6, 700); tone(60, 0.3, 'sawtooth', 0.3); break;
      case 'click': tone(1200, 0.04, 'square', 0.12); break;
      case 'siren': sirenLoop(); break;
      case 'engine': {
        if (engineOsc) return;
        engineOsc = ctx.createOscillator(); engineOsc.type = 'sawtooth'; engineOsc.frequency.value = 55;
        engineGain = ctx.createGain(); engineGain.gain.value = 0.05;
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
        engineOsc.connect(f); f.connect(engineGain); engineGain.connect(sfxGain);
        engineOsc.start();
        setTimeout(() => { try { engineOsc.stop(); } catch (e) {} engineOsc = null; }, 2500);
        break;
      }
      case 'engineStop': if (engineOsc) { try { engineOsc.stop(); } catch (e) {} engineOsc = null; } break;
      case 'mission': [523, 659, 784].forEach((f, i) => tone(f, 0.18, 'triangle', 0.3, ctx.currentTime + i * 0.11)); break;
      case 'fail': tone(220, 0.3, 'sawtooth', 0.25); tone(165, 0.4, 'sawtooth', 0.25, ctx.currentTime + 0.2); break;
      default: tone(440, 0.08, 'sine', 0.2); break;
    }
  }
  function nextStation() {
    ensure();
    station = (station + 1) % STATIONS.length;
    step = 0;
    sfx('click');
    return STATIONS[station].name;
  }
  function setStation(i) {
    ensure();
    station = ((i % STATIONS.length) + STATIONS.length) % STATIONS.length;
    step = 0;
    return STATIONS[station].name;
  }
  function toggleMute() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.9;
    return muted;
  }
  function stationName() { return STATIONS[station].name; }
  return { sfx, nextStation, setStation, toggleMute, stationName };
}
