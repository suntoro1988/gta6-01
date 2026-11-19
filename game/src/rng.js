// Sunset Bay v5 — seeded deterministic RNG.
// Written fresh for v5 from the design spec. No code copied from earlier rounds.
// mulberry32 core: small, fast, and fully deterministic for a given seed.

function hashSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return seed >>> 0;
  }
  if (typeof seed === 'string') {
    let h = 2166136261 >>> 0; // FNV-1a start
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    // Final avalanche so short similar strings spread out.
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }
  // No usable seed: fall back to a time-based one (non-deterministic by choice).
  return (Math.random() * 4294967296) >>> 0;
}

export function createRng(seed) {
  let state = hashSeed(seed);
  if (state === 0) state = 0x9e3779b9;

  function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    // Uniform float in [0, 1).
    next,

    // Uniform float in [a, b).
    range(a, b) {
      return a + (b - a) * next();
    },

    // Uniform integer in [a, b] (both ends inclusive).
    int(a, b) {
      const lo = Math.ceil(a);
      const hi = Math.floor(b);
      if (hi < lo) return lo;
      return lo + Math.floor(next() * (hi - lo + 1));
    },

    // One random element of an array (undefined for an empty array).
    pick(arr) {
      if (!arr || arr.length === 0) return undefined;
      return arr[Math.floor(next() * arr.length)];
    },

    // True with probability p (0..1).
    chance(p) {
      return next() < p;
    },
  };
}
