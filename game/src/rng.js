window.SB = window.SB || {};
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // SB.Rng — deterministic seeded random numbers for Sunset Bay v12.
  // Every procedural system (city layout, traffic, NPCs, weather, loot,
  // mission placement) draws from here so a given seed always rebuilds
  // the same bay. No Math.random() anywhere in this module.
  // Core generator: mulberry32 — small, fast, well distributed for 32-bit
  // seeds, and trivially auditable. String seeds are folded with FNV-1a
  // plus a final avalanche so "sunset-bay" and "sunset-bay!" differ wildly.
  // ---------------------------------------------------------------------------

  var UINT32 = 4294967296; // 2^32
  var GOLDEN = 0x9E3779B9;
  var FALLBACK_SEED = 0x51EED007;

  // FNV-1a 32-bit hash: turns any string into a well-spread 32-bit seed.
  function hashString(str) {
    var s = String(str == null ? '' : str);
    var h = 0x811C9DC5; // FNV offset basis
    var i, c;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      h ^= c;
      // h *= 16777619 (FNV prime), done with shifts to stay in 32 bits.
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    // Final avalanche (MurmurHash3 fmix32) so short similar strings spread.
    h ^= h >>> 16;
    h = Math.imul(h, 0x85EBCA6B) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0xC2B2AE35) >>> 0;
    h ^= h >>> 16;
    return h >>> 0;
  }

  // Normalise any seed input (number, string, undefined) to a uint32.
  function normaliseSeed(seed) {
    if (seed === undefined || seed === null) return FALLBACK_SEED;
    if (typeof seed === 'number') {
      if (!isFinite(seed)) return FALLBACK_SEED;
      return (Math.floor(Math.abs(seed)) >>> 0) || 0x1234567;
    }
    if (typeof seed === 'string') {
      return hashString(seed);
    }
    return hashString(String(seed));
  }

  // mulberry32 state step. `state` is a one-element array so it is mutable
  // by closure without exposing the raw integer.
  function mulberry32Step(state) {
    state[0] = (state[0] + GOLDEN) >>> 0;
    var t = state[0];
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  }

  // SplitMix32 — a second, independent stream used for sub-streams so a
  // module can fork a child RNG without disturbing its parent's sequence.
  function splitmix32(state) {
    state[0] = (state[0] + GOLDEN) >>> 0;
    var z = state[0];
    z = Math.imul(z ^ (z >>> 16), 0x21F0AAAD) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735A2D97) >>> 0;
    return ((z ^ (z >>> 15)) >>> 0) / UINT32;
  }

  // Build one RNG instance. The returned object is the public API; the
  // raw state stays private inside the closure.
  function make(seed) {
    var raw = normaliseSeed(seed);
    var state = [raw];
    var spare = null; // cached second Gaussian sample (Box-Muller)
    var calls = 0;

    function next() {
      calls++;
      return mulberry32Step(state);
    }

    function range(a, b) {
      var lo = (a === undefined ? 0 : a);
      var hi = (b === undefined ? 1 : b);
      if (hi < lo) { var t = lo; lo = hi; hi = t; }
      return lo + next() * (hi - lo);
    }

    function int(a, b) {
      var lo = Math.ceil(a === undefined ? 0 : a);
      var hi = Math.floor(b === undefined ? 1 : b);
      if (hi < lo) { var t = lo; lo = hi; hi = t; }
      // Inclusive on both ends: [lo, hi].
      return lo + Math.floor(next() * (hi - lo + 1));
    }

    function pick(arr) {
      if (!arr || arr.length === 0) return undefined;
      return arr[Math.floor(next() * arr.length)];
    }

    // --- Extra helpers (all deterministic, all derived from next()) -----

    function chance(p) {
      return next() < p;
    }

    function bool() {
      return next() < 0.5;
    }

    function sign() {
      return next() < 0.5 ? -1 : 1;
    }

    // Fisher-Yates shuffle that returns a NEW array (input untouched).
    function shuffle(arr) {
      var out = arr.slice();
      var i, j, tmp;
      for (i = out.length - 1; i > 0; i--) {
        j = Math.floor(next() * (i + 1));
        tmp = out[i]; out[i] = out[j]; out[j] = tmp;
      }
      return out;
    }

    // Weighted pick: items like [{value:'a', weight:3}, ...] or parallel
    // arrays via pickWeighted(values, weights).
    function pickWeighted(items, weights) {
      var values, wts, i, total = 0, roll;
      if (weights) {
        values = items; wts = weights;
      } else {
        values = []; wts = [];
        for (i = 0; i < items.length; i++) {
          values.push(items[i].value !== undefined ? items[i].value : items[i]);
          wts.push(items[i].weight !== undefined ? items[i].weight : 1);
        }
      }
      for (i = 0; i < wts.length; i++) total += Math.max(0, wts[i]);
      if (total <= 0) return values.length ? values[0] : undefined;
      roll = next() * total;
      for (i = 0; i < wts.length; i++) {
        roll -= Math.max(0, wts[i]);
        if (roll <= 0) return values[i];
      }
      return values[values.length - 1];
    }

    // Approximately normal value in [0,1] via Box-Muller, clamped.
    function gaussian(mean, std) {
      var m = (mean === undefined ? 0.5 : mean);
      var s = (std === undefined ? 0.15 : std);
      var u, v, mag;
      if (spare !== null) {
        mag = spare; spare = null;
      } else {
        u = Math.max(next(), 1e-9);
        v = next();
        var r = Math.sqrt(-2 * Math.log(u));
        var th = 2 * Math.PI * v;
        mag = r * Math.cos(th);
        spare = r * Math.sin(th);
      }
      var out = m + mag * s;
      if (out < 0) out = 0;
      if (out > 1) out = 1;
      return out;
    }

    // Fork an independent child RNG: same parent seed + a label always
    // yields the same child stream, whatever the parent has consumed.
    function fork(label) {
      var childSeed = (raw ^ hashString(String(label))) >>> 0;
      return make(childSeed);
    }

    // Snapshot / restore so the game can save mid-sequence determinism.
    function getState() {
      return { seed: raw, counter: state[0], calls: calls };
    }

    function setState(snap) {
      if (!snap) return;
      state[0] = (snap.counter >>> 0) || raw;
      calls = snap.calls || 0;
    }

    function reset(newSeed) {
      var s = (newSeed === undefined) ? raw : normaliseSeed(newSeed);
      raw = s;
      state[0] = s;
      spare = null;
      calls = 0;
    }

    return {
      next: next,
      range: range,
      pick: pick,
      int: int,
      chance: chance,
      bool: bool,
      sign: sign,
      shuffle: shuffle,
      pickWeighted: pickWeighted,
      gaussian: gaussian,
      fork: fork,
      getState: getState,
      setState: setState,
      reset: reset,
      seed: raw
    };
  }

  // Module-level convenience RNG (seeded from the bay's name) for code
  // that just needs a quick deterministic draw without owning an instance.
  var shared = make('sunset-bay-v12');

  window.SB.Rng = {
    make: make,
    hashString: hashString,
    normaliseSeed: normaliseSeed,
    shared: shared,
    // Quick one-shot helpers that do not disturb the shared stream.
    fromString: function (str) { return make(hashString(str)); },
    seedFor: function (label, day) {
      return hashString('sunset-bay:' + String(label) + ':' + String(day || 0));
    }
  };
})();
