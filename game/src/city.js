window.SB = window.SB || {};
(function(){ 'use strict';

// SB.City — dunia Sunset Bay: 14 distrik, 300+ gedung, pelabuhan, pantai,
// jalan raya, 3 interior, palma, lampu jalan, dan papan neon.
// Kota pesisir: laut di selatan (z > +210), pelabuhan di barat (x < -190).
// Jalan grid tiap 40 unit; blok kota di antara jalan.
// Semua penempatan deterministik (mulberry32, seed tetap) agar kota sama
// di setiap load dan sama untuk semua modul yang membaca SB.City.

// RNG lokal deterministik (tidak bergantung modul lain).

function mulberry32(seed) {
  var a = seed >>> 0;
  return function() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Data distrik: nama + pusat + radius + karakter.
// districts (publik) = array 14 NAMA distrik (string), sesuai spec.
// districtInfo (internal) = geometri tiap distrik untuk districtAt().

var DISTRICT_INFO = [
  { name: 'Marina Bay',       x: -150, z:  120, r: 70, kind: 'marina' },
  { name: 'Sunset Beach',     x:   40, z:  185, r: 80, kind: 'beach' },
  { name: 'Downtown',         x:    0, z:    0, r: 75, kind: 'downtown' },
  { name: 'Old Town',         x: -100, z:  -60, r: 60, kind: 'old' },
  { name: 'Neon Strip',       x:   80, z:  -40, r: 60, kind: 'neon' },
  { name: 'Harbour Heights',  x: -140, z: -140, r: 65, kind: 'hills' },
  { name: 'Palm Court',       x:  120, z:  100, r: 60, kind: 'residential' },
  { name: "Fisherman's Wharf",x: -185, z:   40, r: 55, kind: 'port' },
  { name: 'University Hill',  x:  140, z: -120, r: 60, kind: 'campus' },
  { name: 'Industrial Park',  x:  160, z:   20, r: 65, kind: 'industrial' },
  { name: 'Coral Gardens',    x:  -40, z:  140, r: 55, kind: 'residential' },
  { name: 'Sunset Hills',     x:   60, z: -160, r: 60, kind: 'hills' },
  { name: 'Boardwalk',        x: -120, z:  175, r: 55, kind: 'beach' },
  { name: 'The Docks',        x: -190, z: -100, r: 50, kind: 'port' }
];

var DISTRICT_NAMES = [];
for (var di = 0; di < DISTRICT_INFO.length; di++) {
  DISTRICT_NAMES.push(DISTRICT_INFO[di].name);
}

// Konstanta peta.

var WORLD = 480;        // bentang kota: x,z dalam [-240, +240]
var BLOCK = 40;         // jarak antar jalan (grid)
var ROAD_HALF = 5;      // setengah lebar jalan
var SEA_Z = 210;        // z > SEA_Z adalah laut (pantai di z 165..210)
var PORT_X = -190;      // x < PORT_X adalah area pelabuhan
var SEED = 20261122;

// State internal modul.

var city = {
  ready: false,
  rng: null,
  // buildings: { x, z, w, h, d, style, district, angle }
  buildings: [],
  // palms: { x, z, s }  (s = skala)
  palms: [],
  // lamps: { x, z } lampu jalan
  lamps: [],
  // roads: { x, z, w, d } strip jalan (untuk draw)
  roads: [],
  // interiors: { name, x, z, r, style } — 3 interior yang bisa dimasuki
  interiors: [
    { name: 'The Crab Shack', x: -170, z: 60,  r: 9, style: 'restaurant' },
    { name: 'Neon Arcade',    x: 80,   z: -40, r: 10, style: 'arcade' },
    { name: 'Sunset Hotel',   x: 20,   z: 120, r: 11, style: 'hotel' }
  ],
  // port: kontainer + crane di pelabuhan
  containers: [],
  cranes: [],
  // beach: payung + kursi pantai
  umbrellas: [],
  // highway: strip jalan raya layang (z = -195, timur-barat)
  highway: { x: 0, z: -198, w: 480, d: 14 },
  // cache mesh gedung per kunci "w|h|d|style"
  meshCache: {},
  groundMesh: null,
  palmMesh: null,
  neonTime: 0
};

// Cari distrik yang mengandung titik (x,z); bila di luar semua radius,
// kembalikan distrik terdekat.
function districtInfoAt(x, z) {
  var best = null, bestD = Infinity;
  for (var i = 0; i < DISTRICT_INFO.length; i++) {
    var d = DISTRICT_INFO[i];
    var dx = x - d.x, dz = z - d.z;
    var dist = Math.sqrt(dx * dx + dz * dz);
    if (dist <= d.r) { return d; }
    if (dist < bestD) { bestD = dist; best = d; }
  }
  return best;
}

// Gaya gedung berdasarkan karakter distrik.
function styleFor(kind, rng) {
  if (kind === 'downtown') {
    var r = rng();
    if (r < 0.45) { return 'glass'; }
    if (r < 0.8) { return 'concrete'; }
    return 'neon';
  }
  if (kind === 'neon') { return (rng() < 0.7) ? 'neon' : 'glass'; }
  if (kind === 'old') { return (rng() < 0.6) ? 'brick' : 'concrete'; }
  if (kind === 'beach' || kind === 'marina') {
    return (rng() < 0.5) ? 'hotel' : 'concrete';
  }
  if (kind === 'industrial' || kind === 'port') {
    return (rng() < 0.7) ? 'concrete' : 'shack';
  }
  if (kind === 'residential' || kind === 'hills') {
    return (rng() < 0.5) ? 'brick' : 'concrete';
  }
  if (kind === 'campus') { return (rng() < 0.5) ? 'concrete' : 'glass'; }
  return 'concrete';
}

// Tinggi gedung berdasarkan karakter distrik.
function heightFor(kind, rng) {
  if (kind === 'downtown') { return 18 + rng() * 42; }      // 18..60
  if (kind === 'neon') { return 14 + rng() * 26; }          // 14..40
  if (kind === 'hills') { return 8 + rng() * 14; }           // 8..22
  if (kind === 'industrial' || kind === 'port') { return 6 + rng() * 8; }
  if (kind === 'beach' || kind === 'marina') { return 10 + rng() * 18; }
  if (kind === 'campus') { return 8 + rng() * 12; }
  if (kind === 'old') { return 6 + rng() * 10; }
  return 7 + rng() * 12;                                     // residential
}

// Apakah titik (x,z) berada di jalan (grid) atau di area khusus?
function isRoad(x, z) {
  // Jalan grid: dekat kelipatan BLOCK.
  var mx = Math.abs(((x % BLOCK) + BLOCK) % BLOCK);
  var mz = Math.abs(((z % BLOCK) + BLOCK) % BLOCK);
  var nearX = (mx < ROAD_HALF) || (mx > BLOCK - ROAD_HALF);
  var nearZ = (mz < ROAD_HALF) || (mz > BLOCK - ROAD_HALF);
  return nearX || nearZ;
}

// Generasi kota (dipanggil sekali dari init).

function generate() {
  var rng = mulberry32(SEED);
  city.rng = rng;
  // Kosongkan in-place (JANGAN reassign): array yang diekspor di
  // window.SB.City.buildings menunjuk objek array ini.
  city.buildings.length = 0;
  city.palms.length = 0;
  city.lamps.length = 0;
  city.roads.length = 0;
  city.containers.length = 0;
  city.cranes.length = 0;
  city.umbrellas.length = 0;

  // --- Gedung: 3 per blok kota (blok = sel grid 40x40 di dalam kota) ---
  var bx, bz, k;
  for (bx = -200; bx <= 200; bx += BLOCK) {
    for (bz = -200; bz <= 160; bz += BLOCK) {
      // Lewati area laut/pantai (z >= 165) dan pelabuhan (x <= -190).
      var cx = bx + BLOCK / 2, cz = bz + BLOCK / 2;
      if (cz >= 165) { continue; }
      if (cx <= -185) { continue; }
      var info = districtInfoAt(cx, cz);
      var kind = info ? info.kind : 'residential';
      var n = 3;
      for (k = 0; k < n; k++) {
        var ox = (rng() - 0.5) * 22;
        var oz = (rng() - 0.5) * 22;
        var px = cx + ox, pz = cz + oz;
        if (isRoad(px, pz)) { continue; }
        var w = 10 + rng() * 10;
        var d = 10 + rng() * 10;
        var h = heightFor(kind, rng);
        city.buildings.push({
          x: px, z: pz, w: w, h: Math.round(h), d: d,
          style: styleFor(kind, rng),
          district: info ? info.name : 'Downtown',
          angle: (rng() < 0.25) ? Math.PI / 2 : 0
        });
      }
    }
  }

  // --- Gedung tambahan di Downtown (pencakar langit, 12 menara) ---
  for (k = 0; k < 12; k++) {
    var ax = -50 + rng() * 100;
    var az = -50 + rng() * 100;
    if (isRoad(ax, az)) { continue; }
    city.buildings.push({
      x: ax, z: az,
      w: 14 + rng() * 10, h: Math.round(45 + rng() * 30), d: 14 + rng() * 10,
      style: (rng() < 0.6) ? 'glass' : 'neon',
      district: 'Downtown', angle: 0
    });
  }

  // --- Palma: sepanjang jalan pantai + boulevard + tiap blok (total ~140) ---
  var pi;
  for (pi = 0; pi < 90; pi++) {
    var px2 = -220 + rng() * 440;
    var pz2 = 168 + rng() * 30; // garis pantai
    city.palms.push({ x: px2, z: pz2, s: 0.8 + rng() * 0.5 });
  }
  for (pi = 0; pi < 50; pi++) {
    var bx2 = -200 + Math.floor(rng() * 11) * BLOCK;
    var bz2 = -200 + Math.floor(rng() * 10) * BLOCK;
    city.palms.push({
      x: bx2 + 14 + rng() * 12, z: bz2 + 14 + rng() * 12,
      s: 0.7 + rng() * 0.5
    });
  }

  // --- Lampu jalan: tiap persimpangan grid ---
  var lx, lz;
  for (lx = -200; lx <= 200; lx += BLOCK) {
    for (lz = -200; lz <= 160; lz += BLOCK) {
      city.lamps.push({ x: lx + ROAD_HALF + 1, z: lz + ROAD_HALF + 1 });
    }
  }

  // --- Strip jalan (untuk draw): jalan vertikal + horizontal grid ---
  var gx;
  for (gx = -200; gx <= 200; gx += BLOCK) {
    city.roads.push({ x: gx, z: 0, w: ROAD_HALF * 2, d: 420 });
    city.roads.push({ x: 0, z: gx, w: 420, d: ROAD_HALF * 2 });
  }

  // --- Pelabuhan (x < -190): kontainer warna-warni + crane ---
  var ci;
  for (ci = 0; ci < 48; ci++) {
    city.containers.push({
      x: -235 + rng() * 40,
      z: -180 + rng() * 340,
      w: 12, h: 2.6 + Math.floor(rng() * 3) * 2.6, d: 2.6,
      color: ['#c0392b', '#2980b9', '#27ae60', '#f39c12', '#8e44ad'][ci % 5],
      angle: (rng() < 0.5) ? 0 : Math.PI / 2
    });
  }
  for (ci = 0; ci < 4; ci++) {
    city.cranes.push({ x: -205, z: -150 + ci * 100, h: 42 + rng() * 10 });
  }

  // --- Pantai: payung + kursi (z 170..205) ---
  var ui;
  for (ui = 0; ui < 36; ui++) {
    city.umbrellas.push({
      x: -200 + rng() * 420,
      z: 170 + rng() * 32,
      color: ['#e74c3c', '#f1c40f', '#3498db', '#e67e22', '#9b59b6'][ui % 5]
    });
  }
}

// API publik

// init(state): bangun kota sekali, siapkan cache mesh, isi reputasi distrik.
function init(state) {
  if (city.ready) { return; }
  generate();
  city.ready = true;

  // Reputasi awal tiap distrik = 10 (netral rendah) di state bersama.
  if (state) {
    if (!state.districtRep) { state.districtRep = {}; }
    for (var i = 0; i < DISTRICT_NAMES.length; i++) {
      if (state.districtRep[DISTRICT_NAMES[i]] === undefined) {
        state.districtRep[DISTRICT_NAMES[i]] = 10;
      }
    }
    // Spawn awal pemain di Boardwalk, menghadap laut saat sunset.
    if (state.player) {
      state.player.x = -40;
      state.player.z = 150;
      state.player.angle = Math.PI; // menghadap +z (laut)
    }
  }

  // Cache mesh tanah + palma sekali (dipakai tiap frame di draw).
  if (window.SB && window.SB.Meshes) {
    city.groundMesh = window.SB.Meshes.plane(WORLD + 80, WORLD + 80);
    city.palmMesh = window.SB.Meshes.palm();
  }
  city.meshCache = {};
}

// Ambil (atau bangun + simpan) mesh gedung untuk satu ukuran/gaya.
function buildingMesh(b) {
  var key = b.w + '|' + b.h + '|' + b.d + '|' + b.style;
  var m = city.meshCache[key];
  if (!m) {
    m = window.SB.Meshes.building(b.w, b.h, b.d, b.style);
    city.meshCache[key] = m;
  }
  return m;
}

// update(dt, state): animasi kota — denyut neon, lampu jalan menyala saat
// malam, dan bendera pelabuhan berkibar (diwakili timer).
function update(dt, state) {
  city.neonTime += dt;
  // Malam hari: lampu jalan + jendela menyala (flag dipakai draw + HUD).
  if (state) {
    var t = state.timeOfDay || 18.33;
    state.flags.cityNight = (t >= 19.0 || t < 6.0);
    // Golden hour: 17.30 - 19.00.
    state.flags.goldenHour = (t >= 17.5 && t < 19.0);
  }
}

// draw(gl, state): gambar seluruh kota.
// gl = SB.GL (punya drawMesh(mesh, matrix, color)); state = SB.state.
// Urutan: tanah -> jalan -> highway -> gedung -> interior -> pelabuhan ->
// pantai -> palma -> lampu.
function draw(gl, state) {
  if (!city.ready || !gl || !gl.drawMesh) { return; }
  var M = window.SB.Math3;
  if (!M) { return; }
  var white = [1, 1, 1];
  var i, m4;

  // --- Tanah dasar (plane 560x560, hijau-abu kota) ---
  if (city.groundMesh) {
    m4 = M.mat4Identity();
    gl.drawMesh(city.groundMesh, m4, white);
  }

  // --- Jalan grid (strip abu gelap, y = 0.02 agar di atas tanah) ---
  var roadMesh = window.SB.Meshes.box(1, 0.06, 1);
  for (i = 0; i < city.roads.length; i++) {
    var r = city.roads[i];
    m4 = M.mat4Identity();
    m4 = M.mat4Translate(m4, r.x, 0.02, r.z);
    // Skala via matriks: box satuan diskala ke ukuran jalan.
    m4 = scaleMat(M, m4, r.w, 1, r.d);
    gl.drawMesh(roadMesh, m4, [0.22, 0.22, 0.24]);
  }

  // --- Jalan raya layang (highway timur-barat di z = -198, y = 6) ---
  var hw = city.highway;
  m4 = M.mat4Identity();
  m4 = M.mat4Translate(m4, hw.x, 6, hw.z);
  m4 = scaleMat(M, m4, hw.w, 1, hw.d);
  gl.drawMesh(roadMesh, m4, [0.18, 0.18, 0.2]);
  // Tiang penyangga highway tiap 40 unit.
  var pillarMesh = window.SB.Meshes.box(1, 1, 1);
  for (var hx = -220; hx <= 220; hx += 40) {
    m4 = M.mat4Identity();
    m4 = M.mat4Translate(m4, hx, 0, hw.z);
    m4 = scaleMat(M, m4, 3, 6, 3);
    gl.drawMesh(pillarMesh, m4, [0.35, 0.35, 0.38]);
  }

  // --- Gedung (mesh di-cache per ukuran/gaya) ---
  for (i = 0; i < city.buildings.length; i++) {
    var b = city.buildings[i];
    m4 = M.mat4Identity();
    m4 = M.mat4Translate(m4, b.x, 0, b.z);
    if (b.angle) { m4 = M.mat4RotateY(m4, b.angle); }
    gl.drawMesh(buildingMesh(b), m4, white);
  }

  // --- 3 interior: gedung penanda dengan atap warna khas + papan nama ---
  var interiorColors = {
    restaurant: [0.9, 0.4, 0.2],
    arcade: [0.9, 0.2, 0.7],
    hotel: [0.95, 0.75, 0.3]
  };
  for (i = 0; i < city.interiors.length; i++) {
    var it = city.interiors[i];
    var im = window.SB.Meshes.building(16, 9, 14,
      it.style === 'hotel' ? 'hotel' : 'neon');
    m4 = M.mat4Identity();
    m4 = M.mat4Translate(m4, it.x, 0, it.z);
    gl.drawMesh(im, m4, white);
    // Papan nama menyala di depan pintu.
    var signMesh = window.SB.Meshes.box(1, 1, 1);
    m4 = M.mat4Identity();
    m4 = M.mat4Translate(m4, it.x, 4.2, it.z + 7.4);
    m4 = scaleMat(M, m4, 8, 1.2, 0.3);
    gl.drawMesh(signMesh, m4, interiorColors[it.style] || white);
  }

  // --- Pelabuhan: kontainer bertumpuk + crane ---
  var contMesh = window.SB.Meshes.box(1, 1, 1);
  for (i = 0; i < city.containers.length; i++) {
    var c = city.containers[i];
    m4 = M.mat4Identity();
    m4 = M.mat4Translate(m4, c.x, 0, c.z);
    if (c.angle) { m4 = M.mat4RotateY(m4, c.angle); }
    m4 = scaleMat(M, m4, c.w, c.h, c.d);
    gl.drawMesh(contMesh, m4, hexToRgbArr(c.color));
  }
  for (i = 0; i < city.cranes.length; i++) {
    var cr = city.cranes[i];
    // Menara crane.
    m4 = M.mat4Identity();
    m4 = M.mat4Translate(m4, cr.x, 0, cr.z);
    m4 = scaleMat(M, m4, 4, cr.h, 4);
    gl.drawMesh(contMesh, m4, [0.95, 0.6, 0.1]);
    // Lengan horizontal crane.
    m4 = M.mat4Identity();
    m4 = M.mat4Translate(m4, cr.x + 14, cr.h, cr.z);
    m4 = scaleMat(M, m4, 32, 2, 2);
    gl.drawMesh(contMesh, m4, [0.95, 0.6, 0.1]);
    // Kait gantung (bergerak naik-turun pelan dengan waktu).
    var hookY = cr.h - 8 - Math.sin(city.neonTime * 0.5 + i) * 4;
    m4 = M.mat4Identity();
    m4 = M.mat4Translate(m4, cr.x + 24, hookY, cr.z);
    m4 = scaleMat(M, m4, 2, 2, 2);
    gl.drawMesh(contMesh, m4, [0.2, 0.2, 0.22]);
  }

  // --- Pantai: pasir (strip terang) + payung warna-warni ---
  var sandMesh = window.SB.Meshes.box(1, 1, 1);
  m4 = M.mat4Identity();
  m4 = M.mat4Translate(m4, 0, 0.01, 188);
  m4 = scaleMat(M, m4, 480, 0.1, 46);
  gl.drawMesh(sandMesh, m4, [0.93, 0.85, 0.62]);
  for (i = 0; i < city.umbrellas.length; i++) {
    var u = city.umbrellas[i];
    // Tiang payung.
    m4 = M.mat4Identity();
    m4 = M.mat4Translate(m4, u.x, 0, u.z);
    m4 = scaleMat(M, m4, 0.12, 2.2, 0.12);
    gl.drawMesh(contMesh, m4, [0.9, 0.9, 0.9]);
    // Kanopi payung (kotak pipih miring tipis = atap payung).
    m4 = M.mat4Identity();
    m4 = M.mat4Translate(m4, u.x, 2.3, u.z);
    m4 = scaleMat(M, m4, 3.2, 0.15, 3.2);
    gl.drawMesh(contMesh, m4, hexToRgbArr(u.color));
  }

  // --- Palma (mesh bersama, diskala per pohon) ---
  if (city.palmMesh) {
    for (i = 0; i < city.palms.length; i++) {
      var p = city.palms[i];
      m4 = M.mat4Identity();
      m4 = M.mat4Translate(m4, p.x, 0, p.z);
      m4 = scaleMat(M, m4, p.s, p.s, p.s);
      gl.drawMesh(city.palmMesh, m4, white);
    }
  }

  // --- Lampu jalan: tiang + bola lampu (menyala saat malam) ---
  var night = state && state.flags && state.flags.cityNight;
  var lampGlow = night ? [1.0, 0.85, 0.5] : [0.75, 0.75, 0.72];
  for (i = 0; i < city.lamps.length; i++) {
    var l = city.lamps[i];
    m4 = M.mat4Identity();
    m4 = M.mat4Translate(m4, l.x, 0, l.z);
    m4 = scaleMat(M, m4, 0.18, 5, 0.18);
    gl.drawMesh(contMesh, m4, [0.25, 0.25, 0.28]);
    m4 = M.mat4Identity();
    m4 = M.mat4Translate(m4, l.x, 5.1, l.z);
    m4 = scaleMat(M, m4, 0.7, 0.3, 0.7);
    gl.drawMesh(contMesh, m4, lampGlow);
  }
}

// Skala matriks: kalikan kolom basis matriks dengan (sx, sy, sz).
// (Dipakai karena SB.Math3 tidak menyediakan mat4Scale.)
function scaleMat(M, m, sx, sy, sz) {
  // m adalah array 16 kolom-mayor; kolom 0,1,2 diskala.
  var out = m.slice();
  out[0] *= sx; out[1] *= sx; out[2] *= sx; out[3] *= sx;
  out[4] *= sy; out[5] *= sy; out[6] *= sy; out[7] *= sy;
  out[8] *= sz; out[9] *= sz; out[10] *= sz; out[11] *= sz;
  return out;
}

// '#rrggbb' -> [r,g,b] 0..1 (duplikat lokal kecil agar mandiri).
function hexToRgbArr(hex) {
  var h = (hex || '#888888').replace('#', '');
  if (h.length === 3) { h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; }
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255
  ];
}

// Helper posisi / distrik (dipakai modul lain: NPC, Police, Jobs, Races).

// Posisi acak di tengah jalan (dipakai spawn NPC / mobil / misi).
function randomStreetPos() {
  var rng = city.rng || mulberry32(SEED + 7);
  // Pilih satu jalan vertikal + satu horizontal secara acak.
  var gx = -200 + Math.floor(rng() * 11) * BLOCK;
  var gz = -200 + Math.floor(rng() * 10) * BLOCK;
  var onVertical = rng() < 0.5;
  if (onVertical) {
    return { x: gx + (rng() - 0.5) * 6, z: -190 + rng() * 340 };
  }
  return { x: -190 + rng() * 380, z: gz + (rng() - 0.5) * 6 };
}

// Nama distrik pada titik (x, z). Selalu mengembalikan string.
function districtAt(x, z) {
  var info = districtInfoAt(x, z);
  return info ? info.name : 'Downtown';
}

// Export namespace.

window.SB.City = {
  init: init,
  update: update,
  draw: draw,
  districts: DISTRICT_NAMES,
  buildings: city.buildings,
  randomStreetPos: randomStreetPos,
  districtAt: districtAt,
  // Ekstra (dipakai modul lain, bukan bagian spec inti):
  interiors: city.interiors,
  palms: city.palms,
  lamps: city.lamps
};

})();
