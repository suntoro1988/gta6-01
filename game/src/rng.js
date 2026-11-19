// Sunset Bay — rng: generator acak deterministik mulberry32.
(function () {
  var SB = window.SB = window.SB || {};
  var state = 1;

  function seed(s) {
    state = (s >>> 0) || 1;
  }
  function next() {
    // mulberry32
    state = (state + 0x6D2B79F5) >>> 0;
    var t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function range(a, b) { return a + next() * (b - a); }
  function int(a, b) { return Math.floor(range(a, b + 1)); }
  function pick(arr) {
    if (!arr || arr.length === 0) return undefined;
    return arr[Math.floor(next() * arr.length)];
  }

  SB.RNG = { seed: seed, next: next, range: range, int: int, pick: pick };
})();
