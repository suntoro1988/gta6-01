// Sunset Bay — seeded random number generator.
// Written from scratch for v10. Deterministic: the same seed always
// produces the same sequence, so replays and recordings stay stable.
// No dependencies.

const SB = (globalThis.SB = globalThis.SB || {});

/** Hash any seed (number or string) down to a uint32. */
function hashSeed(seed) {
  if (typeof seed === "number" && Number.isFinite(seed)) {
    return seed >>> 0;
  }
  const text = String(seed ?? "sunset-bay");
  let h = 2166136261 >>> 0; // FNV-1a offset basis
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, good-quality 32-bit PRNG. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function nextUint32() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0);
  };
}

/**
 * Create a seeded RNG.
 *   const r = rng(1337);
 *   r.next()          -> float in [0, 1)
 *   r.range(10, 20)   -> float in [10, 20)
 *   r.int(1, 6)       -> integer in [1, 6]
 *   r.pick(['a','b']) -> one element
 *   r.chance(0.25)    -> true 25% of the time
 *   r.shuffle(arr)    -> new shuffled copy
 */
function rng(seed) {
  const nextUint32 = mulberry32(hashSeed(seed));
  let calls = 0;

  const api = {
    seed: hashSeed(seed),
    get calls() {
      return calls;
    },

    next() {
      calls++;
      return nextUint32() / 4294967296;
    },

    range(min, max) {
      if (max === undefined) {
        max = min;
        min = 0;
      }
      return min + api.next() * (max - min);
    },

    int(min, max) {
      // Inclusive on both ends.
      return Math.floor(api.range(min, max + 1));
    },

    pick(array) {
      if (!array || array.length === 0) return undefined;
      return array[Math.floor(api.next() * array.length)];
    },

    chance(p) {
      return api.next() < p;
    },

    shuffle(array) {
      const copy = array.slice();
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(api.next() * (i + 1));
        const tmp = copy[i];
        copy[i] = copy[j];
        copy[j] = tmp;
      }
      return copy;
    },

    /** Gaussian-ish value via the average of three uniforms. */
    normal(mean, spread) {
      const m = mean === undefined ? 0 : mean;
      const s = spread === undefined ? 1 : spread;
      return m + ((api.next() + api.next() + api.next()) / 3 - 0.5) * 2 * s;
    },

    /** Fresh independent stream derived from this one. */
    fork() {
      return rng(nextUint32());
    },
  };
  return api;
}

/** One shared instance for quick one-off rolls (seeded per session). */
let shared = null;
function sharedRng(seed) {
  if (!shared || seed !== undefined) shared = rng(seed === undefined ? Date.now() : seed);
  return shared;
}

SB.RNG = {
  rng,
  create: rng,
  hashSeed,
  mulberry32,
  shared: sharedRng,
};

export { rng, hashSeed, mulberry32, sharedRng };
export default rng;
