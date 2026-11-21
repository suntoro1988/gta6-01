// Sunset Bay — RNG (v9, ditulis fresh dari SPEC-v8)
// window.SB.RNG: { seed, next, range, int, pick, bool, shuffle }
// Random deterministik berbasis mulberry32: urutan angka yang sama akan
// muncul kembali bila seed yang sama dipakai. Dipakai untuk hal-hal yang
// harus stabil antar sesi (penempatan kota, loot), bukan untuk gameplay
// yang memang boleh acak tiap frame.
(function () {
  'use strict';
  var SB = window.SB = window.SB || {};

  // State internal generator. 0 tidak valid sebagai seed, jadi dipaksa ke 1.
  var cursor = 1;

  function reseed(value) {
    var v = (value >>> 0);
    cursor = v === 0 ? 1 : v;
  }

  // mulberry32 — satu langkah, hasil di [0, 1).
  function step() {
    cursor = (cursor + 0x6D2B79F5) >>> 0;
    var t = cursor;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Bilangan riil di [low, high).
  function between(low, high) {
    return low + step() * (high - low);
  }

  // Bilangan bulat di [low, high] (inklusif kedua ujung).
  function whole(low, high) {
    return Math.floor(between(low, high + 1));
  }

  // Satu elemen acak dari array (undefined bila array kosong).
  function choose(list) {
    if (!list || list.length === 0) return undefined;
    return list[Math.floor(step() * list.length)];
  }

  // true dengan peluang `chance` (0..1).
  function chance(p) {
    return step() < p;
  }

  // Salinan array yang diacak urutannya (Fisher-Yates, array asli utuh).
  function shuffled(list) {
    var out = (list || []).slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(step() * (i + 1));
      var tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  SB.RNG = {
    seed: reseed,
    next: step,
    range: between,
    int: whole,
    pick: choose,
    bool: chance,
    shuffle: shuffled
  };
})();
