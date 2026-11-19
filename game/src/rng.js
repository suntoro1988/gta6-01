// rng.js — deterministic seedable RNG (mulberry32).
// Same seed => same sequence, every run, every machine.
export function makeRng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    next,
    range(lo, hi) { return lo + next() * (hi - lo); },
    int(lo, hi) { return lo + Math.floor(next() * (hi - lo + 1)); },
    pick(arr) { return arr[Math.floor(next() * arr.length)]; },
    shuffle(arr) {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const t = out[i]; out[i] = out[j]; out[j] = t;
      }
      return out;
    },
  };
}
// Seed helper: read ?seed= from the page URL when present,
// otherwise fall back to a time-based seed (not reproducible).
export function seedFromUrl(def = (Math.random() * 0xffffffff) >>> 0) {
  try {
    const s = new URLSearchParams(location.search).get('seed');
    if (s !== null && s !== '') {
      const n = Number(s);
      return Number.isFinite(n) ? (n >>> 0) : hashSeed(s);
    }
  } catch (e) { /* no URL available (e.g. tests) — use default */ }
  return def >>> 0;
}
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
