// A tiny WebAudio synth for game sounds: pickup chimes, crash thuds, the
// wanted sting, a two-tone police siren — and four looping radio stations
// of synth music (bass, chords and a lead line, all oscillators, no files).
// Everything is guarded so the game plays fine with sound off or blocked.
export function createAudio() {
  let ctx = null;
  let muted = false;
  let sirenTimer = 0;
  let sirenHigh = false;
  let radioGain = null;

  // --- Radio: a 16th-note step sequencer. Each station is a loop of chords
  // (one per bar), a bass riff and a sparse lead, all in Hz. The scheduler
  // runs off the audio clock, so the music never drifts with frame rate.
  // Every station rotates three named tracks, four bars each. ---
  const TRACKS = [
    [
      { title: 'Sunset Cruise', artist: 'The Palms' },
      { title: 'Golden Hour', artist: 'Marina Lights' },
      { title: 'Boardwalk Nights', artist: 'The Palms' },
    ],
    [
      { title: 'Full Throttle', artist: 'Neon Coast' },
      { title: 'Redline', artist: 'DJ Sunset' },
      { title: 'Night Drive', artist: 'Neon Coast' },
    ],
    [
      { title: 'Ultraviolet', artist: 'DJ Sunset' },
      { title: 'After Dark', artist: 'Midnight Static' },
      { title: 'Chrome Hearts', artist: 'Midnight Static' },
    ],
    [
      { title: 'Palm Shadows', artist: 'The Palms' },
      { title: 'Boardwalk Breeze', artist: 'Marina Lights' },
      { title: 'Low Tide', artist: 'The Palms' },
    ],
  ];
  const STATIONS = [
    {
      name: 'BAY FM',
      bpm: 96,
      bass: [110, 0, 110, 0, 130.81, 0, 110, 0, 98, 0, 98, 0, 146.83, 0, 130.81, 0],
      chords: [
        [220, 261.63, 329.63],
        [174.61, 220, 261.63],
        [196, 246.94, 293.66],
        [146.83, 220, 293.66],
      ],
      lead: [0, 0, 440, 0, 0, 523.25, 0, 0, 0, 0, 392, 0, 0, 659.25, 0, 0],
      leadType: 'sine',
    },
    {
      name: 'SUNSET DRIVE',
      bpm: 122,
      bass: [82.41, 82.41, 0, 82.41, 0, 98, 0, 82.41, 73.42, 73.42, 0, 73.42, 0, 87.31, 0, 98],
      chords: [
        [164.81, 207.65, 246.94],
        [146.83, 185, 220],
        [130.81, 164.81, 196],
        [174.61, 220, 261.63],
      ],
      lead: [329.63, 0, 392, 0, 440, 0, 392, 0, 329.63, 0, 0, 392, 0, 523.25, 0, 0],
      leadType: 'square',
    },
    {
      name: 'NEON NIGHTS',
      bpm: 112,
      bass: [55, 0, 0, 55, 0, 65.41, 0, 0, 49, 0, 0, 49, 0, 58.27, 0, 0],
      chords: [
        [110, 130.81, 164.81],
        [98, 123.47, 146.83],
        [87.31, 110, 130.81],
        [103.83, 130.81, 155.56],
      ],
      lead: [0, 220, 0, 261.63, 0, 0, 329.63, 0, 0, 392, 0, 329.63, 0, 261.63, 0, 0],
      leadType: 'triangle',
    },
    {
      // A slower, breezier fourth station for the beach side of town.
      name: 'PALM COURT',
      bpm: 88,
      bass: [98, 0, 0, 98, 0, 0, 123.47, 0, 87.31, 0, 0, 87.31, 0, 0, 110, 0],
      chords: [
        [196, 246.94, 293.66],
        [164.81, 207.65, 246.94],
        [174.61, 220, 261.63],
        [146.83, 185, 220],
      ],
      lead: [0, 0, 392, 0, 493.88, 0, 0, 0, 440, 0, 0, 523.25, 0, 0, 587.33, 0],
      leadType: 'sine',
    },
  ];
  let stationIndex = -1; // -1 = radio off; 0..3 = a station is playing
  let radioStep = 0;
  let nextStepTime = 0;

  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      radioGain = ctx.createGain();
      radioGain.gain.value = muted ? 0 : 0.5;
      radioGain.connect(ctx.destination);
    } catch {
      ctx = null;
    }
    return ctx;
  }

  // A one-shot sound effect: an oscillator with a fast decay envelope.
  function tone(freq, dur, type, gain, delay = 0) {
    if (muted) return;
    const ac = ensure();
    if (!ac) return;
    const t0 = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g);
    g.connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // One radio note, through the radio bus (quieter than SFX).
  function radioTone(freq, t0, dur, type, gain) {
    const ac = ctx;
    if (!ac || !radioGain) return;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g);
    g.connect(radioGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // Schedule the radio's next steps, called every frame.
  function radioTick() {
    if (stationIndex < 0 || muted) return;
    const ac = ensure();
    if (!ac || ac.state !== 'running') return;
    const st = STATIONS[stationIndex];
    const stepDur = 60 / st.bpm / 4;
    if (nextStepTime < ac.currentTime) nextStepTime = ac.currentTime + 0.05;
    while (nextStepTime < ac.currentTime + 0.18) {
      const s = radioStep % 16;
      const bar = Math.floor(radioStep / 16) % st.chords.length;
      const t0 = nextStepTime;
      const bass = st.bass[s];
      if (bass) radioTone(bass, t0, stepDur * 1.8, 'sawtooth', 0.16);
      if (s === 0) {
        // One soft pad chord per bar, two detuned triangles.
        for (const f of st.chords[bar]) {
          radioTone(f, t0, stepDur * 16, 'triangle', 0.045);
          radioTone(f * 1.005, t0, stepDur * 16, 'triangle', 0.035);
        }
      }
      const lead = st.lead[s];
      if (lead) radioTone(lead, t0, stepDur * 2.2, st.leadType, 0.07);
      // A light hat tick on the off-beats, from a very short high square.
      if (s % 4 === 2) radioTone(5200, t0, 0.03, 'square', 0.012);
      radioStep += 1;
      nextStepTime += stepDur;
    }
  }

  return {
    unlock() {
      const ac = ensure();
      if (ac && ac.state === 'suspended') ac.resume();
    },
    toggleMute() {
      muted = !muted;
      if (radioGain) radioGain.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    get muted() {
      return muted;
    },
    // Start the radio on the first station (called when play begins).
    startRadio() {
      ensure();
      if (stationIndex < 0) {
        stationIndex = 0;
        radioStep = 0;
        nextStepTime = 0;
      }
      return STATIONS[stationIndex].name;
    },
    // Cycle OFF -> BAY FM -> SUNSET DRIVE -> NEON NIGHTS -> PALM COURT -> OFF ...
    cycleStation() {
      ensure();
      stationIndex = stationIndex >= STATIONS.length - 1 ? -1 : stationIndex + 1;
      radioStep = 0;
      nextStepTime = 0;
      return stationIndex < 0 ? null : STATIONS[stationIndex].name;
    },
    get stationName() {
      return stationIndex < 0 ? null : STATIONS[stationIndex].name;
    },
    // The track now playing: rotates every 4 bars, per station.
    get currentTrack() {
      if (stationIndex < 0) return null;
      const tracks = TRACKS[stationIndex];
      return tracks[Math.floor(radioStep / 64) % tracks.length];
    },
    get stationCount() {
      return STATIONS.length;
    },
    // Call every frame while playing; schedules radio notes ahead.
    radio(dt) {
      void dt;
      radioTick();
    },
    pickup() {
      tone(880, 0.12, 'sine', 0.16);
      tone(1318, 0.2, 'sine', 0.14, 0.08);
    },
    // A stash pack is worth more than a road coin: a longer, rising chime.
    stash() {
      tone(659, 0.12, 'sine', 0.16);
      tone(880, 0.12, 'sine', 0.16, 0.09);
      tone(1318, 0.26, 'sine', 0.15, 0.18);
    },
    jobDone() {
      tone(523, 0.12, 'triangle', 0.16);
      tone(659, 0.12, 'triangle', 0.16, 0.1);
      tone(784, 0.24, 'triangle', 0.16, 0.2);
    },
    crash() {
      tone(90, 0.25, 'square', 0.2);
      tone(55, 0.3, 'sawtooth', 0.14, 0.02);
    },
    sting() {
      tone(220, 0.18, 'sawtooth', 0.14);
      tone(277, 0.22, 'sawtooth', 0.14, 0.14);
    },
    busted() {
      tone(392, 0.25, 'sawtooth', 0.16);
      tone(311, 0.25, 'sawtooth', 0.16, 0.22);
      tone(233, 0.5, 'sawtooth', 0.16, 0.44);
    },
    shoot() {
      tone(1400, 0.06, 'square', 0.14);
      tone(320, 0.1, 'sawtooth', 0.12, 0.01);
    },
    punch() {
      tone(140, 0.08, 'sine', 0.18);
      tone(90, 0.1, 'square', 0.08, 0.02);
    },
    buy() {
      tone(1046, 0.1, 'sine', 0.15);
      tone(1568, 0.16, 'sine', 0.13, 0.08);
    },
    denied() {
      tone(180, 0.16, 'square', 0.12);
    },
    // Call every frame; beeps the siren while the player is wanted.
    siren(dt, wanted) {
      if (wanted <= 0 || muted) return;
      sirenTimer -= dt;
      if (sirenTimer <= 0) {
        sirenHigh = !sirenHigh;
        tone(sirenHigh ? 950 : 700, 0.32, 'square', 0.045);
        sirenTimer = 0.36;
      }
    },
  };
}
