// A tiny seeded random number generator (mulberry32): the same seed always
// gives the same sequence, so the city and the screenshot scenes are stable.
export function createRng(seed) {
  let a = seed >>> 0;
  function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    next,
    range(lo, hi) {
      return lo + next() * (hi - lo);
    },
    int(lo, hi) {
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    pick(list) {
      return list[Math.floor(next() * list.length)];
    },
    chance(p) {
      return next() < p;
    },
    /** A standard-normal sample (Box-Muller, from the same seeded stream),
     * for natural-looking jitter — building heights, tree scales. */
    gauss() {
      const u = Math.max(next(), 1e-9);
      const v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    /** Fisher-Yates shuffle, in place, from the same seeded stream. */
    shuffle(list) {
      for (let i = list.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        const t = list[i];
        list[i] = list[j];
        list[j] = t;
      }
      return list;
    },
    /** A random element that is not `avoid` (up to 4 tries, then any). */
    pickNot(list, avoid) {
      let v = list[Math.floor(next() * list.length)];
      for (let i = 0; i < 4 && v === avoid; i += 1) {
        v = list[Math.floor(next() * list.length)];
      }
      return v;
    },
  };
}
