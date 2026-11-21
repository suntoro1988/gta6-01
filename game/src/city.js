// Sunset Bay v9 — city.js
// Kota prosedural deterministik: kisi jalan + 219 bangunan, 10 distrik.
// Laut membatasi kota di barat (x < -168) dan selatan (z > 168).
// Urutan pemakaian RNG dipertahankan agar build(7) selalu menghasilkan
// tata kota yang sama seperti v8 (219 bangunan, posisi identik).
(function () {
  'use strict';
  var SB = window.SB = window.SB || {};

  // Nama distrik — dipakai HUD (minimap + label distrik) dan misi.
  var NAMES = [
    'Downtown', 'Old Town', 'Harbor', 'Marina Bay', 'Hillcrest',
    'Northside', 'Southside', 'Beachfront', 'Uptown', 'Industrial'
  ];
  // Garis tengah jalan (sumbu x dan sumbu z memakai daftar yang sama).
  var STREETS = [-160, -120, -80, -40, 0, 40, 80, 120, 160];
  // Setengah lebar kota; di luar ini daratan habis (laut / pantai).
  var EDGE = 168;
  // Pusat blok di antara garis jalan (jarak antar pusat 40 unit).
  var BLOCKS = [-140, -100, -60, -20, 20, 60, 100, 140];
  // Empat kuadran di dalam satu blok (offset dari pusat blok).
  var QUADS = [[-8, -8], [8, -8], [-8, 8], [8, 8]];

  // Distrik berdasarkan posisi: pantai selatan, marina/harbor barat,
  // industrial timur, lalu downtown di tengah dan sisanya menurut kuadran.
  function where(x, z) {
    if (z > 130) return 'Beachfront';
    if (x < -110) return z < 0 ? 'Marina Bay' : 'Harbor';
    if (x > 120) return 'Industrial';
    if (z < -110) return 'Northside';
    if (Math.abs(x) < 40 && Math.abs(z) < 40) return 'Downtown';
    if (x < 0) return z < 0 ? 'Old Town' : 'Southside';
    return z < 0 ? 'Uptown' : 'Hillcrest';
  }

  // Bangun kota dari seed. Mengisi SB.City dan mengembalikan data kota.
  function generate(seed) {
    var rng = SB.RNG;
    rng.seed(seed == null ? 7 : seed);

    // Jalan: satu strip untuk tiap garis, di kedua sumbu.
    var roads = [];
    var s;
    for (s = 0; s < STREETS.length; s++) {
      roads.push({ x: STREETS[s], z: 0, w: 8, d: 340, axis: 'z' });
      roads.push({ x: 0, z: STREETS[s], w: 340, d: 8, axis: 'x' });
    }

    // Bangunan: tiap blok diisi 3-4 bangunan (satu kuadran satu bangunan),
    // kecuali dua plaza yang hanya punya 1 bangunan.
    var list = [];
    var i, j;
    for (i = 0; i < BLOCKS.length; i++) {
      for (j = 0; j < BLOCKS.length; j++) {
        var cx = BLOCKS[i], cz = BLOCKS[j];
        var dist = where(cx, cz);
        var isPlaza = (cx === -20 && cz === -20) || (cx === 100 && cz === 60);
        // Jumlah bangunan blok ini: plaza 1, sisanya 3 atau 4.
        var count = isPlaza ? 1 : 3 + (rng.next() < 0.55 ? 1 : 0);
        // Acak urutan kuadran (Fisher-Yates) supaya bangunan tersebar.
        var order = [0, 1, 2, 3];
        for (s = 3; s > 0; s--) {
          var t = Math.floor(rng.next() * (s + 1));
          var tmp = order[s]; order[s] = order[t]; order[t] = tmp;
        }
        for (var q = 0; q < count; q++) {
          var qd = QUADS[order[q]];
          var w = 8 + rng.range(0, 4);
          var d = 8 + rng.range(0, 4);
          var x = cx + qd[0] + rng.range(-1.5, 1.5);
          var z = cz + qd[1] + rng.range(-1.5, 1.5);
          var isTall = dist === 'Downtown' || dist === 'Uptown';
          var h = isTall ? rng.range(18, 60) : rng.range(6, 26);
          if (dist === 'Industrial') h = rng.range(8, 16);
          list.push({ x: x, z: z, w: w, d: d, h: h, district: dist });
        }
      }
    }
    // Pengaman jumlah: potong bila melebihi 225 (dengan seed 7 hasilnya 219).
    while (list.length > 225) list.pop();

    var data = {
      buildings: list,
      roads: roads,
      districts: NAMES.slice(),
      roadCoords: STREETS.slice()
    };
    SB.City.buildings = list;
    SB.City.roads = roads;
    SB.City.districts = NAMES.slice();
    SB.City._data = data;
    return data;
  }

  // Cari titik kosong (tidak menabrak bangunan, masih di dalam kota).
  // Dipakai saat pemain keluar mobil / turun dari kapal.
  function clearSpot(x, z, r) {
    r = r || 2;
    var list = SB.City.buildings || [];
    function free(px, pz) {
      if (px < -EDGE + 2 || px > EDGE - 2 || pz < -EDGE + 2 || pz > EDGE - 2) return false;
      for (var i = 0; i < list.length; i++) {
        var b = list[i];
        if (Math.abs(px - b.x) < b.w / 2 + r && Math.abs(pz - b.z) < b.d / 2 + r) return false;
      }
      return true;
    }
    if (free(x, z)) return { x: x, z: z };
    for (var rad = 4; rad <= 120; rad += 4) {
      for (var k = 0; k < 16; k++) {
        var a = Math.random() * Math.PI * 2;
        var px = x + Math.cos(a) * rad;
        var pz = z + Math.sin(a) * rad;
        if (free(px, pz)) return { x: px, z: pz };
      }
    }
    return { x: 0, z: 0 };
  }

  SB.City = {
    districts: NAMES.slice(),
    buildings: [],
    roads: [],
    roadCoords: STREETS.slice(),
    build: generate,
    districtAt: where,
    findClearSpot: clearSpot
  };
})();
