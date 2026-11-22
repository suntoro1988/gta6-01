window.SB = window.SB || {};
(function(){ 'use strict';
// ---------------------------------------------------------------------------
// SB.Rng — deterministic seeded random numbers for Sunset Bay.
// Every system that needs randomness (city layout, traffic, NPCs, weather,
// loot, radio jingles) draws from here so a fixed seed reproduces the
// exact same world. No Math.random() anywhere in the game code.
// Algorithm: mulberry32 (fast, tiny, excellent distribution for 32-bit
// seeds) plus a string-hash helper so seeds can be words as well as ints.
// API (spec): SB.Rng.make(seed) -> { next(), range(a,b), pick(arr), int(a,b) }
// ---------------------------------------------------------------------------

// Hash an arbitrary string into a stable unsigned 32-bit seed.
// FNV-1a, the classic tiny string hash. Same string -> same seed, forever.
function hashString(str) {
  var h = 2166136261 >>> 0;
  var s = String(str);
  var i, c;
  for (i = 0; i < s.length; i++) {
    c = s.charCodeAt(i);
    h ^= c;
    h = Math.imul(h, 16777619);
  }
  // Final avalanche so short similar strings spread far apart.
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489917);
  h ^= h >>> 16;
  return h >>> 0;
}

// Normalise any seed value (number, string, null, undefined) to a
// non-zero unsigned 32-bit integer. Zero is a degenerate mulberry32
// state, so it is mapped to a fixed well-spread constant.
function normaliseSeed(seed) {
  var n;
  if (seed === undefined || seed === null) {
    n = 0x9E3779B9;
  } else if (typeof seed === 'string') {
    n = hashString(seed);
  } else if (typeof seed === 'number') {
    if (!isFinite(seed)) { n = 0x9E3779B9; }
    else { n = (seed | 0) >>> 0; }
  } else {
    n = hashString(String(seed));
  }
  if (n === 0) { n = 0x85EBCA6B; }
  return n >>> 0;
}

// mulberry32 core step. `state` is a one-element array so the closure
// can mutate it without an object allocation per call.
function mulberry32Step(st) {
  st[0] = (st[0] + 0x6D2B79F5) | 0;
  var t = st[0];
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Build one deterministic stream. The returned object is the whole
// public API of a stream; streams are independent and cheap.
function make(seed) {
  var raw = normaliseSeed(seed);
  var st = [raw | 0];
  var calls = 0;

  // Uniform float in [0, 1).
  function next() {
    calls++;
    return mulberry32Step(st);
  }

  // Uniform float in [a, b). One argument -> [0, a).
  function range(a, b) {
    if (b === undefined) { b = a; a = 0; }
    if (a === b) { return a; }
    if (a > b) { var t = a; a = b; b = t; }
    return a + next() * (b - a);
  }

  // Uniform integer in [a, b] inclusive on both ends.
  function int(a, b) {
    if (b === undefined) { b = a; a = 0; }
    if (a === b) { return a; }
    if (a > b) { var t = a; a = b; b = t; }
    return a + Math.floor(next() * (b - a + 1));
  }

  // Uniform random element of a non-empty array. Empty array -> undefined.
  function pick(arr) {
    if (!arr || arr.length === 0) { return undefined; }
    return arr[Math.floor(next() * arr.length)];
  }

  // True with probability p (0..1). Default p = 0.5, a coin flip.
  function chance(p) {
    if (p === undefined) { p = 0.5; }
    if (p <= 0) { return false; }
    if (p >= 1) { return true; }
    return next() < p;
  }

  // Random element, then remove it from the array (draw without
  // replacement). Returns undefined for an empty array.
  function draw(arr) {
    if (!arr || arr.length === 0) { return undefined; }
    var i = Math.floor(next() * arr.length);
    return arr.splice(i, 1)[0];
  }

  // In-place Fisher-Yates shuffle. Returns the same array for chaining.
  function shuffle(arr) {
    var i, j, t;
    for (i = arr.length - 1; i > 0; i--) {
      j = Math.floor(next() * (i + 1));
      t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // Copy of the array, shuffled. The input is left untouched.
  function shuffled(arr) {
    return shuffle(arr.slice());
  }

  // Approximately normal (bell-curve) float, mean 0, stddev ~1,
  // via the sum of three uniforms (Irwin-Hall, cheap and bounded).
  function gaussian() {
    return (next() + next() + next() - 1.5) * 2 / Math.sqrt(3);
  }

  // Normal float with a given mean and standard deviation.
  function normal(mean, sd) {
    if (mean === undefined) { mean = 0; }
    if (sd === undefined) { sd = 1; }
    return mean + gaussian() * sd;
  }

  // Random pick weighted by `weights` (same length as `arr`).
  // Total weight <= 0 falls back to a uniform pick.
  function weighted(arr, weights) {
    if (!arr || arr.length === 0) { return undefined; }
    if (!weights || weights.length !== arr.length) { return pick(arr); }
    var total = 0, i;
    for (i = 0; i < weights.length; i++) {
      if (weights[i] > 0) { total += weights[i]; }
    }
    if (total <= 0) { return pick(arr); }
    var r = next() * total;
    for (i = 0; i < weights.length; i++) {
      r -= weights[i] > 0 ? weights[i] : 0;
      if (r <= 0) { return arr[i]; }
    }
    return arr[arr.length - 1];
  }

  // Random 2D direction as {x, z} on the unit circle.
  function dir2() {
    var a = next() * Math.PI * 2;
    return { x: Math.cos(a), z: Math.sin(a) };
  }

  // Random point inside a disc of radius r around (cx, cz).
  function inDisc(cx, cz, r) {
    var a = next() * Math.PI * 2;
    var d = Math.sqrt(next()) * r;
    return { x: cx + Math.cos(a) * d, z: cz + Math.sin(a) * d };
  }

  // Random point inside an axis-aligned box.
  function inBox(x0, z0, x1, z1) {
    return { x: range(x0, x1), z: range(z0, z1) };
  }

  // Fork a new independent stream from this one. The child seed is
  // drawn from the parent, so the whole tree of streams stays
  // deterministic as long as the parent's call order is fixed.
  function fork() {
    return make(Math.floor(next() * 4294967296));
  }

  // Re-seed this stream in place. All later draws change accordingly.
  function reseed(seed) {
    st[0] = normaliseSeed(seed) | 0;
    calls = 0;
  }

  // Snapshot / restore the exact internal state, so a system can
  // rewind its own stream (used by the save system and by replays).
  function saveState() {
    return { s: st[0] >>> 0, c: calls };
  }
  function loadState(snap) {
    if (!snap) { return; }
    st[0] = (snap.s | 0);
    calls = snap.c | 0;
  }

  return {
    next: next,
    range: range,
    pick: pick,
    int: int,
    chance: chance,
    draw: draw,
    shuffle: shuffle,
    shuffled: shuffled,
    gaussian: gaussian,
    normal: normal,
    weighted: weighted,
    dir2: dir2,
    inDisc: inDisc,
    inBox: inBox,
    fork: fork,
    reseed: reseed,
    saveState: saveState,
    loadState: loadState,
    seed: raw,
    calls: function () { return calls; }
  };
}

// ---------------------------------------------------------------------------
// World seed helpers. The whole map is built from one master seed so a
// fresh load with the same seed builds the identical Sunset Bay.
// ---------------------------------------------------------------------------

// Derive a child seed for one named subsystem from a master seed.
// "city" + 1337 and "traffic" + 1337 never collide.
function subSeed(master, name) {
  return hashString(String(master) + ':' + String(name));
}

// The default shared stream, seeded from the world seed. Systems that
// only need "some" randomness (ambient jitter, idle chatter) use this
// instead of building their own stream.
var _worldSeed = 1337;
var _shared = make(_worldSeed);

// Re-seed the shared stream (called once at boot with the world seed).
function seedWorld(seed) {
  _worldSeed = normaliseSeed(seed);
  _shared.reseed(_worldSeed);
  return _worldSeed;
}

window.SB.Rng = {
  make: make,
  hashString: hashString,
  subSeed: subSeed,
  seedWorld: seedWorld,
  worldSeed: function () { return _worldSeed; },
  // Shared-stream shortcuts, same names as a stream's methods.
  next: function () { return _shared.next(); },
  range: function (a, b) { return _shared.range(a, b); },
  pick: function (arr) { return _shared.pick(arr); },
  int: function (a, b) { return _shared.int(a, b); },
  chance: function (p) { return _shared.chance(p); },
  shuffle: function (arr) { return _shared.shuffle(arr); },
  fork: function () { return _shared.fork(); }
};
})();
