// A small seeded random source (mulberry32). One seed always replays the
// same sequence, so the city, the traffic and the staged screenshots are
// identical on every run with the same seed.

export function createRng(seed) {
  let state = seed >>> 0;

  function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next,

    /** Uniform float in [lo, hi). */
    range(lo, hi) {
      return lo + next() * (hi - lo);
    },

    /** Uniform integer in [lo, hi], both ends included. */
    int(lo, hi) {
      return lo + Math.floor(next() * (hi - lo + 1));
    },

    /** One element of `list`, uniformly at random. */
    pick(list) {
      return list[Math.floor(next() * list.length)];
    },

    /** True with probability `p`. */
    chance(p) {
      return next() < p;
    },

    /** A standard-normal sample (Box-Muller over the same stream), for
     * natural-looking jitter — building heights, tree scales. */
    gauss() {
      const u = Math.max(next(), 1e-9);
      const v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },

    /** A normal sample with the given mean and spread. */
    normal(mean, sd) {
      return mean + this.gauss() * sd;
    },

    /** Fisher-Yates shuffle, in place, from the same seeded stream. */
    shuffle(list) {
      for (let i = list.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        const tmp = list[i];
        list[i] = list[j];
        list[j] = tmp;
      }
      return list;
    },

    /** A random element that is not `avoid` (a few retries, then any). */
    pickNot(list, avoid) {
      let value = list[Math.floor(next() * list.length)];
      for (let i = 0; i < 4 && value === avoid; i += 1) {
        value = list[Math.floor(next() * list.length)];
      }
      return value;
    },

    /** One element of `list`, weighted by the matching entry of `weights`. */
    pickWeighted(list, weights) {
      let total = 0;
      for (const w of weights) total += w;
      let roll = next() * total;
      for (let i = 0; i < list.length; i += 1) {
        roll -= weights[i];
        if (roll <= 0) return list[i];
      }
      return list[list.length - 1];
    },
  };
}
