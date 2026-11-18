// A tiny WebAudio synth for game sounds: pickup chimes, crash thuds, the
// wanted sting and a two-tone police siren. No audio files, all oscillators.
// Everything is guarded so the game plays fine with sound off or blocked.
export function createAudio() {
  let ctx = null;
  let muted = false;
  let sirenTimer = 0;
  let sirenHigh = false;

  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
    } catch {
      ctx = null;
    }
    return ctx;
  }

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

  return {
    unlock() {
      const ac = ensure();
      if (ac && ac.state === 'suspended') ac.resume();
    },
    toggleMute() {
      muted = !muted;
      return muted;
    },
    get muted() {
      return muted;
    },
    pickup() {
      tone(880, 0.12, 'sine', 0.16);
      tone(1318, 0.2, 'sine', 0.14, 0.08);
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
    /** Call every frame; beeps the siren while the player is wanted. */
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
