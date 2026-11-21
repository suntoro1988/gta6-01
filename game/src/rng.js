// rng.js — Sunset Bay (v11)
// Seeded deterministic random numbers for Sunset Bay.
// Written from scratch for v11. No dependencies, no external data.
// Every procedural choice in the game (traffic, pedestrians, weather,
// loot, radio chatter timing) can draw from one seeded stream so a
// replay with the same seed reproduces the same bay.

'use strict';

// mulberry32: small, fast, well-distributed 32-bit PRNG.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// splitmix32: a second stream, useful when a subsystem needs an
// independent sequence derived from the same master seed.
export function splitmix32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x9E3779B9) >>> 0;
    let z = a;
    z = Math.imul(z ^ (z >>> 16), 0x21F0AAAD);
    z = Math.imul(z ^ (z >>> 15), 0x735A2D97);
    return ((z ^ (z >>> 15)) >>> 0) / 4294967296;
  };
}

// Turn any short string ("sunset-bay-day-4", a player name, a mission
// id) into a stable 32-bit seed so named content is reproducible.
export function seedFromString(text) {
  const s = String(text == null ? '' : text);
  let h = 2166136261 >>> 0; // FNV-1a offset basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Final avalanche so similar strings diverge fast.
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return h >>> 0;
}

// A forkable RNG object: one master stream plus named sub-streams
// ("traffic", "pedestrians", "weather", "loot") that stay independent
// even when they are consumed at different rates.
export class SeededRng {
  constructor(seed) {
    if (typeof seed === 'string') seed = seedFromString(seed);
    if (seed == null || !Number.isFinite(seed)) seed = (Date.now() % 2147483647) >>> 0;
    this.seed = seed >>> 0;
    this.next = mulberry32(this.seed);
    this._streams = new Map();
  }

  // Raw float in [0, 1).
  float() { return this.next(); }

  // Float in [min, max).
  range(min, max) {
    if (max === undefined) { max = min; min = 0; }
    return min + this.float() * (max - min);
  }

  // Integer in [min, max] inclusive.
  int(min, max) {
    if (max === undefined) { max = min; min = 0; }
    return Math.floor(this.range(min, max + 1));
  }

  // True with probability p (0..1).
  chance(p) { return this.float() < p; }

  // One element of a non-empty array, uniformly.
  pick(list) {
    if (!list || list.length === 0) return undefined;
    return list[Math.floor(this.float() * list.length)];
  }

  // One element weighted by `weight` (default 1) on each entry.
  // Entries look like { value, weight } or { weight } with any payload.
  weightedPick(entries) {
    if (!entries || entries.length === 0) return undefined;
    let total = 0;
    for (const e of entries) total += (e && e.weight != null ? e.weight : 1);
    if (total <= 0) return this.pick(entries);
    let roll = this.float() * total;
    for (const e of entries) {
      roll -= (e && e.weight != null ? e.weight : 1);
      if (roll <= 0) return e;
    }
    return entries[entries.length - 1];
  }

  // Fisher-Yates shuffle. Returns a NEW array; the input is untouched.
  shuffle(list) {
    const out = Array.isArray(list) ? list.slice() : [];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.float() * (i + 1));
      const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
    }
    return out;
  }

  // Sample k distinct elements without replacement.
  sample(list, k) {
    return this.shuffle(list).slice(0, Math.max(0, Math.min(k, list.length)));
  }

  // Approximately normal value (mean 0, stddev 1) via Box-Muller.
  gaussian() {
    let u = 0, v = 0;
    while (u === 0) u = this.float();
    while (v === 0) v = this.float();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  // Gaussian clamped to [min, max] around a centre.
  gaussianRange(min, max, centre) {
    const c = centre == null ? (min + max) / 2 : centre;
    const spread = (max - min) / 6;
    const v = c + this.gaussian() * spread;
    return Math.max(min, Math.min(max, v));
  }

  // Random point inside a circle of radius r around (x, z).
  pointInCircle(x, z, r) {
    const a = this.float() * Math.PI * 2;
    const d = Math.sqrt(this.float()) * r;
    return { x: x + Math.cos(a) * d, z: z + Math.sin(a) * d };
  }

  // Random bearing in degrees, 0..360.
  bearing() { return this.float() * 360; }

  // A short id made of unambiguous characters (no 0/O, 1/l).
  id(length) {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < (length || 8); i++) out += chars[this.int(0, chars.length - 1)];
    return out;
  }

  // Named sub-stream, derived deterministically from the master seed
  // plus the stream name. Two systems can each own a stream and never
  // disturb each other's sequence.
  stream(name) {
    if (!this._streams.has(name)) {
      this._streams.set(name, new SeededRng(seedFromString(String(this.seed) + ':' + name)));
    }
    return this._streams.get(name);
  }

  // Snapshot / restore so a mission can rewind its own rolls.
  getState() { return { seed: this.seed }; }
  reseed(seed) {
    if (typeof seed === 'string') seed = seedFromString(seed);
    this.seed = seed >>> 0;
    this.next = mulberry32(this.seed);
    this._streams.clear();
    return this;
  }
}

// The game's default shared stream. Systems that do not need their own
// seed should use this one (or a named stream off it) so gameplay
// stays varied run to run while remaining debuggable.
export const rng = new SeededRng(20261121);

// Convenience one-liners over the shared stream.
export const randomRange = (min, max) => rng.range(min, max);
export const randomInt = (min, max) => rng.int(min, max);
export const randomPick = (list) => rng.pick(list);
export const randomShuffle = (list) => rng.shuffle(list);
export const randomChance = (p) => rng.chance(p);

export function createRng(seed) { return new SeededRng(seed); }

if (typeof window !== 'undefined') {
  window.SunsetRng = window.SunsetRng || {};
  window.SunsetRng.SeededRng = SeededRng;
  window.SunsetRng.mulberry32 = mulberry32;
  window.SunsetRng.splitmix32 = splitmix32;
  window.SunsetRng.seedFromString = seedFromString;
  window.SunsetRng.rng = rng;
  window.SunsetRng.createRng = createRng;
}
