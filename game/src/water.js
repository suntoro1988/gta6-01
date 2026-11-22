window.SB = window.SB || {};
(function(){ 'use strict';

// SB.Water — laut Sunset Bay: air reflektif + ombak, 6 perahu, naik/turun
// perahu tanpa soft-lock, wake (jejak buih) di belakang perahu yang bergerak.
// Laut menutupi z > 205 (garis pantai di z ~205). Perahu berlabuh di
// Marina Bay + Fisherman's Wharf dan berlayar di sekitar teluk.
// State perahu hidup di modul ini; status naik perahu ditulis ke SB.state
// (state.player.onBoat + state.player.vehicle) agar Player/Vehicles sinkron.

// RNG lokal deterministik.

function mulberry32(seed) {
  var a = seed >>> 0;
  return function() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

// Data perahu.
// boat: { id, name, x, z, angle, speed, targetSpeed, anchored, bobPhase,
//         color, wakeTimer }

var BOAT_DEFS = [
  { name: 'Sea Breeze',   x: -160, z: 225, angle: 0.4,  color: '#e74c3c' },
  { name: 'Golden Hour',  x: -120, z: 240, angle: -0.3, color: '#f1c40f' },
  { name: 'Wave Rider',   x:  -60, z: 230, angle: 1.2,  color: '#3498db' },
  { name: 'Coral Dream',  x:   20, z: 245, angle: 2.4,  color: '#9b59b6' },
  { name: 'Sunset Runner',x:   90, z: 228, angle: -1.1, color: '#e67e22' },
  { name: 'Harbour King', x:  160, z: 240, angle: 0.9,  color: '#2ecc71' }
];

var water = {
  ready: false,
  time: 0,
  // boats: array 6 perahu (publik via SB.Water.boats).
  boats: [],
  // wakes: { x, z, age, life, size } — jejak buih yang memudar.
  wakes: [],
  // ombak: daftar gelombang sinus (amplitudo, panjang, arah, kecepatan).
  waves: [
    { amp: 0.35, len: 26, dir: 0.6, speed: 0.9 },
    { amp: 0.22, len: 13, dir: -0.4, speed: 1.4 },
    { amp: 0.12, len: 6, dir: 1.2, speed: 2.1 }
  ],
  seaMesh: null,
  boatMeshes: {},
  wakeMesh: null,
  // Perahu yang sedang dinaiki pemain (null bila jalan kaki / di mobil).
  boarded: null,
  // Kecepatan jelajah perahu pemain (unit/detik).
  cruiseSpeed: 16
};

// Tinggi permukaan air di (x, z, t): gabungan 3 gelombang sinus.
function waveHeight(x, z, t) {
  var h = 0;
  for (var i = 0; i < water.waves.length; i++) {
    var w = water.waves[i];
    var phase = (x * Math.cos(w.dir) + z * Math.sin(w.dir)) / w.len * Math.PI * 2
      + t * w.speed;
    h += Math.sin(phase) * w.amp;
  }
  return h;
}

// Perahu terdekat dari (x, z) dalam radius r (atau null).
function nearestBoat(x, z, r) {
  var best = null, bestD = r;
  for (var i = 0; i < water.boats.length; i++) {
    var b = water.boats[i];
    var dx = b.x - x, dz = b.z - z;
    var d = Math.sqrt(dx * dx + dz * dz);
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

// API publik

// init(state): buat 6 perahu + mesh laut, reset wake.
function init(state) {
  if (water.ready) { return; }
  water.ready = true;
  water.time = 0;
  // Kosongkan in-place (JANGAN reassign): array yang diekspor di
  // window.SB.Water.boats menunjuk objek array ini.
  water.boats.length = 0;
  water.wakes.length = 0;
  water.boarded = null;

  for (var i = 0; i < BOAT_DEFS.length; i++) {
    var def = BOAT_DEFS[i];
    water.boats.push({
      id: 'boat-' + (i + 1),
      name: def.name,
      x: def.x, z: def.z,
      angle: def.angle,
      speed: 0,
      targetSpeed: 0,
      anchored: true,
      bobPhase: i * 1.3,
      color: def.color,
      wakeTimer: 0
    });
  }

  if (window.SB && window.SB.Meshes) {
    // Laut: bidang besar 560 x 260 berpusat di z = 335 (menutup z 205..465).
    water.seaMesh = window.SB.Meshes.plane(560, 260);
    water.wakeMesh = window.SB.Meshes.box(1, 0.1, 1);
  }
  if (state) {
    state.flags.onBoat = false;
    state.flags.nearBoat = false;
  }
}

// update(dt, state): ombak, goyangan perahu, gerak perahu pemain, wake memudar.
function update(dt, state) {
  if (!water.ready) { return; }
  water.time += dt;
  var t = water.time;

  // --- Perahu: goyang ombak + gerak ---
  for (var i = 0; i < water.boats.length; i++) {
    var b = water.boats[i];
    // Goyang mengikuti tinggi ombak di posisinya.
    b.bob = waveHeight(b.x, b.z, t);
    b.pitch = Math.sin(t * 0.9 + b.bobPhase) * 0.03;
    b.roll = Math.cos(t * 0.7 + b.bobPhase * 1.7) * 0.04;

    // Perahu yang dinaiki pemain: bergerak sesuai input pemain.
    if (water.boarded === b && state && state.player) {
      var p = state.player;
      var input = state._boatInput || { f: 0, turn: 0 };
      // Maju/mundur: akselerasi halus menuju target.
      b.targetSpeed = input.f * water.cruiseSpeed;
      b.speed += (b.targetSpeed - b.speed) * Math.min(1, dt * 1.5);
      // Belok: makin cepat makin responsif, tapi tetap stabil.
      b.angle += input.turn * dt * (0.9 + Math.abs(b.speed) * 0.03)
        * (b.speed < 0 ? -1 : 1);
      // Integrasi posisi.
      b.x += Math.sin(b.angle) * b.speed * dt;
      b.z += Math.cos(b.angle) * b.speed * dt;
      // Batas teluk: jangan menabrak pantai / keluar peta.
      b.x = clamp(b.x, -235, 235);
      b.z = clamp(b.z, 212, 460);
      // Pemain menempel di perahu.
      p.x = b.x;
      p.z = b.z;
      p.y = b.bob + 1.1;
      p.angle = b.angle;
      // Wake saat melaju.
      b.wakeTimer -= dt;
      if (Math.abs(b.speed) > 4 && b.wakeTimer <= 0) {
        b.wakeTimer = 0.12;
        var wx = b.x - Math.sin(b.angle) * 2.6;
        var wz = b.z - Math.cos(b.angle) * 2.6;
        wake(wx, wz);
      }
      // Tabrakan ringan dengan pantai: dorong kembali ke laut.
      if (b.z < 214 && b.speed > 0) { b.speed *= 0.4; }
    } else if (!b.anchored) {
      // Perahu AI yang tidak berlabuh: hanyut pelan mengikuti arus.
      b.x += Math.sin(t * 0.1 + b.bobPhase) * dt * 0.5;
      b.z += Math.cos(t * 0.07 + b.bobPhase) * dt * 0.3;
      b.x = clamp(b.x, -235, 235);
      b.z = clamp(b.z, 212, 460);
    }
  }

  // --- Wake memudar (umur > life = hapus) ---
  for (var w = water.wakes.length - 1; w >= 0; w--) {
    var wk = water.wakes[w];
    wk.age += dt;
    wk.size += dt * 1.5; // buih membesar sambil memudar
    if (wk.age >= wk.life) { water.wakes.splice(w, 1); }
  }

  // --- Flag jarak: pemain dekat perahu? (dipakai HUD / prompt "naik perahu") ---
  if (state && state.player) {
    var near = nearestBoat(state.player.x, state.player.z, 6);
    state.flags.nearBoat = !!near && water.boarded !== near;
    state.flags.onBoat = !!water.boarded;
  }
}

// draw(gl, state): laut reflektif + perahu + wake.
// Warna laut berubah dengan waktu (golden hour oranye -> malam biru gelap).
function draw(gl, state) {
  if (!water.ready || !gl || !gl.drawMesh) { return; }
  var M = window.SB.Math3;
  if (!M) { return; }
  var white = [1, 1, 1];
  var t = water.time;

  // --- Laut: bidang besar, warna dasar biru kehijauan ---
  if (water.seaMesh) {
    var tod = (state && state.timeOfDay !== undefined) ? state.timeOfDay : 18.33;
    var seaColor = [0.1, 0.35, 0.5]; // siang
    if (tod >= 17.5 && tod < 19.0) { seaColor = [0.75, 0.35, 0.25]; } // sunset
    else if (tod >= 19.0 || tod < 6.0) { seaColor = [0.04, 0.08, 0.18]; } // malam
    var m4 = M.mat4Identity();
    // Bidang laut digeser ke selatan (z = 335) dan naik-turun halus ombak.
    var lift = Math.sin(t * 0.8) * 0.08;
    m4 = M.mat4Translate(m4, 0, lift, 335);
    gl.drawMesh(water.seaMesh, m4, seaColor);
  }

  // --- Perahu ---
  for (var i = 0; i < water.boats.length; i++) {
    var b = water.boats[i];
    var mesh = boatMesh(b.color);
    if (!mesh) { continue; }
    var bm = M.mat4Identity();
    bm = M.mat4Translate(bm, b.x, (b.bob || 0) + 0.15, b.z);
    bm = M.mat4RotateY(bm, b.angle);
    gl.drawMesh(mesh, bm, white);
  }

  // --- Wake: kotak pipih putih transparan-seolah (memudar via skala+warna) ---
  if (water.wakeMesh) {
    for (var w = 0; w < water.wakes.length; w++) {
      var wk = water.wakes[w];
      var fade = 1 - (wk.age / wk.life);
      var wm = M.mat4Identity();
      wm = M.mat4Translate(wm, wk.x, 0.25, wk.z);
      wm = scaleMat(M, wm, wk.size, 1, wk.size);
      gl.drawMesh(water.wakeMesh, wm,
        [0.9 * fade + 0.1, 0.95 * fade + 0.05, 1.0 * fade]);
    }
  }
}

// Ambil mesh perahu per warna (cache).
function boatMesh(color) {
  if (!window.SB || !window.SB.Meshes) { return null; }
  var m = water.boatMeshes[color];
  if (!m) {
    m = window.SB.Meshes.boat();
    water.boatMeshes[color] = m;
  }
  return m;
}

// Skala kolom matriks (kolom-mayor 16 elemen).
function scaleMat(M, m, sx, sy, sz) {
  var out = m.slice();
  out[0] *= sx; out[1] *= sx; out[2] *= sx; out[3] *= sx;
  out[4] *= sy; out[5] *= sy; out[6] *= sy; out[7] *= sy;
  out[8] *= sz; out[9] *= sz; out[10] *= sz; out[11] *= sz;
  return out;
}

// Naik / turun perahu — TANPA SOFT-LOCK:
//  - boardBoat() gagal dengan aman (return null) bila tidak ada perahu dekat
//    atau pemain sedang mengemudi / sudah di perahu.
//  - exitBoat() SELALU menaruh pemain di tempat aman: dermaga terdekat bila
//    perahu jauh dari pantai, atau tepi pantai bila dekat; tidak pernah
//    meninggalkan pemain di tengah laut tanpa perahu.

// boardBoat(): naik ke perahu terdekat (radius 6). Return perahu, atau null.
function boardBoat() {
  var state = window.SB.state;
  if (!water.ready) { return null; }
  if (water.boarded) { return water.boarded; } // sudah di perahu
  if (!state || !state.player) { return null; }
  var p = state.player;
  // Tidak bisa naik perahu sambil mengemudi mobil.
  if (p.vehicle) { return null; }
  // Harus berada di darat dekat pantai / dermaga (z > 150) agar masuk akal.
  var b = nearestBoat(p.x, p.z, 6);
  if (!b) { return null; }
  water.boarded = b;
  b.anchored = false;
  b.speed = 0;
  b.targetSpeed = 0;
  p.onFoot = false;
  p.onBoat = true;
  p.vehicle = b;
  p.x = b.x;
  p.z = b.z;
  p.y = (b.bob || 0) + 1.1;
  p.angle = b.angle;
  if (state) {
    state.flags.onBoat = true;
    state.flags.nearBoat = false;
    state._boatInput = { f: 0, turn: 0 };
  }
  return b;
}

// exitBoat(): turun dari perahu. Return true bila berhasil turun,
// false bila pemain memang tidak sedang di perahu.
function exitBoat() {
  var state = window.SB.state;
  if (!water.boarded) { return false; }
  var b = water.boarded;
  water.boarded = null;
  b.speed = 0;
  b.targetSpeed = 0;
  // Perahu kembali berlabuh (diam) di tempatnya — tidak hanyut.
  b.anchored = true;

  if (state && state.player) {
    var p = state.player;
    p.onFoot = true;
    p.onBoat = false;
    p.vehicle = null;
    state.flags.onBoat = false;
    state._boatInput = { f: 0, turn: 0 };
    // Turun di mana? Bila perahu dekat pantai (z < 235), turun ke tepi
    // pantai (z = 203, daratan). Bila jauh di tengah laut, turun ke
    // dermaga terdekat (Marina Bay / Fisherman's Wharf) — pemain tidak
    // pernah tertinggal berenang di tengah laut.
    if (b.z < 235) {
      p.x = b.x;
      p.z = 203;
      p.y = 0;
    } else {
      var docks = [
        { x: -160, z: 203 }, // Marina Bay
        { x: -185, z: 203 }  // Fisherman's Wharf
      ];
      var best = docks[0], bestD = Infinity;
      for (var i = 0; i < docks.length; i++) {
        var dx = b.x - docks[i].x, dz = b.z - docks[i].z;
        var d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = docks[i]; }
      }
      p.x = best.x;
      p.z = best.z;
      p.y = 0;
    }
    // Perahu ikut merapat ke dermaga bila pemain turun jauh dari pantai,
    // agar perahu tidak hilang di tengah laut.
    if (b.z >= 235) {
      b.x = p.x;
      b.z = 222;
    }
  }
  return true;
}

// wake(x, z): tambah satu jejak buih di posisi (x, z).
// Jejak dicatat di SB.FX.wakes — sumber kebenaran efek wake (fx.js sendiri
// menulis "Wake perahu ... (dipanggil SB.Water / game)"): SB.FX.wake()
// menambahkan wake ke SB.FX.wakes + partikel buih, dan FX.update() yang
// memudarkan + menggambarnya. Sebelum perbaikan ini, wake() hanya push ke
// array internal Water (tidak diekspor), sehingga SB.FX.wakes tetap 0.
// Bila SB.FX belum tersedia, fallback ke array internal Water agar jejak
// tetap digambar oleh Water.draw().
function wake(x, z) {
  if (!water.ready) { return; }
  if (window.SB && window.SB.FX && typeof window.SB.FX.wake === 'function') {
    window.SB.FX.wake(x, z);
    return;
  }
  // Fallback bila FX tidak tersedia: simpan di array internal Water.
  if (water.wakes.length > 120) { water.wakes.shift(); }
  water.wakes.push({ x: x, z: z, age: 0, life: 2.5, size: 0.8 });
}

// Tinggi ombak di titik tertentu (dipakai modul lain, mis. FX cipratan).
function waveAt(x, z) {
  return waveHeight(x, z, water.time);
}

// Export namespace.

window.SB.Water = {
  init: init,
  update: update,
  draw: draw,
  boardBoat: boardBoat,
  exitBoat: exitBoat,
  boats: water.boats,
  wake: wake,
  // Ekstra (dipakai modul lain):
  waveAt: waveAt,
  boarded: function() { return water.boarded; }
};

})();
