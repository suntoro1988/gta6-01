window.SB = window.SB || {};
(function(){
'use strict';

/* =========================================================================
   SB.Water — Sunset Bay v12 (Builder C, dunia)
   Laut barat (x < -172) + ombak + pantai + pelabuhan + 6 perahu.
   Perahu bisa dinaiki (boardBoat) dan DITURUNKAN TANPA SOFT-LOCK:
   exitBoat() SELALU berhasil — pemain diletakkan di titik darat
   terdekat (dermaga / pantai / pelabuhan), tidak peduli posisi perahu.
   Pelajaran v10: jangan pernah mengunci pemain di kendaraan air.
   Ombak: ubin laut naik-turun sinusoidal mengikuti state.time.
   Wake: cincin putih melebar di belakang perahu yang bergerak.
   ========================================================================= */

var SEA_X = -172;       // garis pantai: laut di x < SEA_X
var SHORE_X = -160;     // tepi pasir yang bisa dipijak
var MAP_HALF = 178;

var boats = [];         // {x,z,angle,speed,type,color,anchored,bobPhase}
var wakes = [];         // {x,z,age,life}
var state = null;
var meshBoat = null;
var meshSea = null;
var meshWake = [];      // 3 ukuran cincin wake (tanpa scale di matriks)
var meshBuoy = null;
var meshPier = null;
var initialized = false;
var wavePhase = 0;

var BOAT_TYPES = [
  { name: 'Speedboat', top: 14, accel: 8,  color: [0.9, 0.2, 0.2] },
  { name: 'Yacht',     top: 9,  accel: 5,  color: [0.95, 0.95, 0.9] },
  { name: 'Fishing',   top: 7,  accel: 4,  color: [0.3, 0.6, 0.9] },
  { name: 'Jet Ski',   top: 16, accel: 11, color: [0.95, 0.7, 0.1] }
];

function rr(a, b){ return a + Math.random() * (b - a); }
function clamp(v, a, b){ return v < a ? a : (v > b ? b : v); }

function makeBoat(x, z, typeName){
  var t = BOAT_TYPES[0];
  for (var i = 0; i < BOAT_TYPES.length; i++){
    if (BOAT_TYPES[i].name === typeName){ t = BOAT_TYPES[i]; break; }
  }
  return {
    x: x, z: z,
    angle: rr(0, Math.PI * 2),
    speed: 0,
    type: t.name,
    top: t.top,
    accel: t.accel,
    color: t.color,
    anchored: Math.random() < 0.5,
    bobPhase: rr(0, Math.PI * 2),
    player: false
  };
}

function init(st){
  state = st || null;
  if (initialized) return;
  initialized = true;
  if (window.SB && SB.Meshes){
    meshBoat = SB.Meshes.boat();
    meshSea = SB.Meshes.plane(60, 60);
    meshWake = [
      SB.Meshes.plane(2.5, 2.5),
      SB.Meshes.plane(5, 5),
      SB.Meshes.plane(8, 8)
    ];
    meshBuoy = SB.Meshes.box(0.8, 0.8, 0.8);
    meshPier = SB.Meshes.box(4, 0.4, 4);
  }
  // 6 perahu: 2 dekat dermaga pantai, 2 di marina, 2 lepas pantai
  boats = [
    makeBoat(-178, -30, 'Speedboat'),
    makeBoat(-180, 20, 'Fishing'),
    makeBoat(-176, 60, 'Yacht'),
    makeBoat(-182, 120, 'Speedboat'),
    makeBoat(-190, -90, 'Jet Ski'),
    makeBoat(-185, 150, 'Fishing')
  ];
  boats[0].anchored = false;
  boats[2].anchored = false;
  SB.Water.boats = boats;
}

/* Titik darat terdekat dari (x,z): dermaga / pantai / pelabuhan.
   Dipakai exitBoat — selalu mengembalikan titik yang bisa dipijak. */
function nearestLand(x, z){
  var best = { x: SHORE_X + 1, z: clamp(z, -170, 170) };
  var bestD = Math.abs(x - best.x);
  // Dermaga dari SB.City (papan kayu menjorok ke laut)
  if (window.SB && SB.City && SB.City.piers){
    var piers = SB.City.piers;
    for (var i = 0; i < piers.length; i++){
      var P = piers[i];
      // Dermaga membujur sumbu Z dari z .. z+len
      var pz = clamp(z, P.z, P.z + P.len);
      var d = Math.sqrt((x - P.x) * (x - P.x) + (z - pz) * (z - pz));
      if (d < bestD){ bestD = d; best = { x: P.x, z: pz }; }
    }
  }
  // Pelabuhan tenggara (darat di x > 120, z > 120)
  if (z > 100){
    var hd = Math.sqrt((x - 140) * (x - 140) + (z - 175) * (z - 175));
    if (hd < bestD){ best = { x: 140, z: 175 }; }
  }
  return best;
}

/* Naik perahu terdekat (maks 6 unit dari pemain). */
function boardBoat(){
  if (!state) return false;
  var p = state.player;
  if (!p || p.vehicle || p.boat) return false;
  var best = null, bestD = 6;
  for (var i = 0; i < boats.length; i++){
    var b = boats[i];
    if (b.player) continue;
    var dx = b.x - p.x, dz = b.z - p.z;
    var d = Math.sqrt(dx*dx + dz*dz);
    if (d < bestD){ bestD = d; best = b; }
  }
  if (!best){
    if (window.SB && SB.HUD) SB.HUD.showToast('Tidak ada perahu di dekatmu. Cari di dermaga.');
    return false;
  }
  best.player = true;
  best.anchored = false;
  best.speed = 0;
  p.boat = best;
  p.onFoot = false;
  p.x = best.x; p.z = best.z; p.angle = best.angle;
  if (window.SB && SB.HUD) SB.HUD.showToast('Naik ' + best.type + '! (F = turun di darat terdekat)');
  if (window.SB && SB.Audio) SB.Audio.sfx('board');
  return true;
}

/* Turun dari perahu — SELALU BISA, tanpa soft-lock (pelajaran v10).
   Pemain diletakkan di darat terdekat; perahu dibiarkan mengapung
   di tempat (anchored) agar bisa dinaiki lagi. */
function exitBoat(){
  if (!state) return false;
  var p = state.player;
  var b = p ? p.boat : null;
  if (!b) return false;
  var land = nearestLand(b.x, b.z);
  b.player = false;
  b.speed = 0;
  b.anchored = true;      // perahu menunggu di dekat darat
  p.boat = null;
  p.onFoot = true;
  p.x = land.x;
  p.z = land.z;
  p.y = 0;
  p.angle = b.angle;
  if (window.SB && SB.HUD) SB.HUD.showToast('Turun di darat. Perahu menunggu di dekat sini.');
  if (window.SB && SB.Audio) SB.Audio.sfx('board');
  return true;
}

/* Wake: cincin putih di belakang perahu. Dipanggil tiap frame oleh
   update() untuk perahu pemain, dan bisa dipanggil modul lain. */
function wake(x, z){
  if (wakes.length > 40) wakes.shift();
  wakes.push({ x: x, z: z, age: 0, life: 1.6 });
}

function updatePlayerBoat(b, dt){
  var input = state.input || {};
  var keys = input.keys || {};
  var steering = 0;
  if (keys.a || keys.arrowleft) steering += 1;
  if (keys.d || keys.arrowright) steering -= 1;
  if (keys.w || keys.arrowup) b.speed += b.accel * dt;
  else if (keys.s || keys.arrowdown) b.speed -= b.accel * 0.8 * dt;
  else b.speed -= Math.sign(b.speed) * 2.5 * dt;   // hambatan air
  if (Math.abs(b.speed) < 0.2) b.speed = 0;
  b.speed = clamp(b.speed, -4, b.top);
  // Belok lebih lambat di air
  b.angle += steering * 1.4 * dt * clamp(Math.abs(b.speed) / 6, 0.2, 1) * (b.speed >= 0 ? 1 : -1);
  b.x += Math.sin(b.angle) * b.speed * dt;
  b.z += Math.cos(b.angle) * b.speed * dt;
  // Batas laut: jangan sampai menabrak pantai / keluar peta
  if (b.x > SEA_X - 2){
    b.x = SEA_X - 2;
    b.speed *= -0.3;
    if (window.SB && SB.HUD) SB.HUD.showToast('Perahu kandas di pantai! Turun (F).');
  }
  b.x = clamp(b.x, -260, SEA_X - 2);
  b.z = clamp(b.z, -200, 200);
  // Wake di belakang perahu saat bergerak
  if (Math.abs(b.speed) > 3 && Math.random() < 0.6){
    wake(b.x - Math.sin(b.angle) * 3.5, b.z - Math.cos(b.angle) * 3.5);
  }
  // Sinkron pemain ke perahu
  state.player.x = b.x;
  state.player.z = b.z;
  state.player.angle = b.angle;
}

function update(dt, st){
  if (st) state = st;
  if (!state) return;
  wavePhase += dt;
  // Ombak: perahu tak berpenumpang hanyut pelan + bob
  for (var i = 0; i < boats.length; i++){
    var b = boats[i];
    b.bobPhase += dt * 1.4;
    if (!b.player){
      if (!b.anchored){
        // Hanyut pelan mengikuti arus (utara-selatan)
        b.z += Math.sin(wavePhase * 0.3 + i) * 0.4 * dt;
        b.x = clamp(b.x + Math.cos(wavePhase * 0.2 + i) * 0.3 * dt, -260, SEA_X - 4);
        b.angle += Math.sin(wavePhase * 0.5 + i) * 0.05 * dt;
      }
    } else {
      updatePlayerBoat(b, dt);
    }
  }
  // Wake menua & menghilang
  for (var w = wakes.length - 1; w >= 0; w--){
    wakes[w].age += dt;
    if (wakes[w].age > wakes[w].life) wakes.splice(w, 1);
  }
  // Perahu pemain jatuh ke air? Tidak mungkin — pemain di atas perahu.
  // Tapi bila pemain berjalan ke laut tanpa perahu, Water tidak intervensi;
  // Player.update yang mendorongnya kembali ke pantai.
}

function draw(gl, st){
  if (st) state = st;
  if (!gl || !SB.GL || !SB.Math3 || !state) return;
  var M = SB.Math3;
  var t = state.time || 0;
  var cam = state.camera ? state.camera.look : { x: 0, z: 0 };

  function mat(x, y, z, ry){
    var m = M.mat4Identity();
    m = M.mat4Translate(m, x, y, z);
    if (ry) m = M.mat4RotateY(m, ry);
    return m;
  }

  // Laut: ubin 60x60 dari x=-260..-172, z=-200..200, naik-turun ombak.
  // Warna biru laut berubah halus dengan fase ombak (kilau golden hour).
  var seaBase = [0.1, 0.35, 0.55];
  for (var tx = -260; tx < SEA_X; tx += 60){
    for (var tz = -200; tz < 200; tz += 60){
      var waveY = Math.sin(t * 1.1 + tx * 0.08 + tz * 0.05) * 0.18;
      var shimmer = 0.03 * Math.sin(t * 0.7 + tx + tz);
      SB.GL.drawMesh(meshSea, mat(tx + 30, waveY, tz + 30, 0),
        [seaBase[0] + shimmer, seaBase[1] + shimmer, seaBase[2] + shimmer]);
    }
  }
  // Garis buih di pantai (pita putih tipis di garis air, bergerak)
  var foamX = SEA_X + Math.sin(t * 0.9) * 0.8;
  for (var fz = -180; fz < 180; fz += 30){
    SB.GL.drawMesh(meshWake[0], mat(foamX, 0.12, fz, 0), [0.95, 0.97, 0.95]);
  }

  // Pelampung penanda jalur perahu (oranye, bob naik-turun)
  for (var bi = 0; bi < 8; bi++){
    var bx = -195 - (bi % 3) * 12;
    var bz = -140 + bi * 40;
    var by = 0.4 + Math.sin(t * 1.3 + bi) * 0.15;
    SB.GL.drawMesh(meshBuoy, mat(bx, by, bz, 0), [1.0, 0.5, 0.1]);
  }

  // Perahu (bob + oleng kecil mengikuti ombak)
  for (var i = 0; i < boats.length; i++){
    var b = boats[i];
    var dx = b.x - (cam.x || 0), dz = b.z - (cam.z || 0);
    if (dx*dx + dz*dz > 220*220) continue;
    var bobY = Math.sin(b.bobPhase) * 0.18;
    SB.GL.drawMesh(meshBoat, mat(b.x, bobY, b.z, b.angle), b.color);
  }

  // Wake: cincin putih melebar & memudar (3 ukuran, dipilih dari umur)
  for (var wi = 0; wi < wakes.length; wi++){
    var W = wakes[wi];
    var frac = W.age / W.life;
    var idx = frac < 0.33 ? 0 : (frac < 0.66 ? 1 : 2);
    var fade = 1 - frac;
    SB.GL.drawMesh(meshWake[idx], mat(W.x, 0.15, W.z, 0),
      [0.9 * fade + 0.1, 0.95 * fade + 0.05, 1.0 * fade]);
  }
}

window.SB.Water = {
  init: init,
  update: update,
  draw: draw,
  boardBoat: boardBoat,
  exitBoat: exitBoat,
  boats: boats,
  wake: wake,
  nearestLand: nearestLand
};

})();
