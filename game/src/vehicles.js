window.SB = window.SB || {};
(function(){
'use strict';

/* =========================================================================
   SB.Vehicles — Sunset Bay v12 (Builder C, dunia)
   Traffic 36+ mobil AI di jalan grid: ikut jalur, berhenti di lampu merah,
   belok acak di persimpangan, hindari tabrakan kasar. Pemain bisa:
   curi mobil (E / stealCar), masuk/keluar, drift (+$50), respray (-$150),
   mobil rusak + asap (SB.FX, guard).
   Input mengemudi dibaca dari state.input (ditulis SB.Player.update):
     keys.w/s = gas/rem, keys.a/d = belok, keys.shift = boost,
     keys.space = rem tangan (picu drift).
   Arah mobil: angle yaw; depan mobil = (sin(angle), cos(angle)) di XZ.
   Jalan grid tiap 30 unit; mobil traffic bergerak sepanjang sumbu X/Z.
   ========================================================================= */

var GRID = 30;
var MAP_HALF = 178;
var DRIFT_REWARD = 50;
var RESPRAY_COST = 150;

var CAR_COLORS = [
  [0.85, 0.15, 0.15], [0.15, 0.3, 0.85], [0.9, 0.85, 0.2],
  [0.2, 0.7, 0.3], [0.9, 0.9, 0.9], [0.1, 0.1, 0.12],
  [0.95, 0.5, 0.1], [0.6, 0.2, 0.7], [0.2, 0.7, 0.75],
  [0.75, 0.75, 0.75], [0.4, 0.15, 0.1], [0.1, 0.4, 0.35]
];
var CAR_TYPES = [
  { name: 'Sedan',  top: 11, accel: 9,  turn: 2.2 },
  { name: 'Taxi',   top: 10, accel: 8,  turn: 2.2 },
  { name: 'Sports', top: 16, accel: 14, turn: 2.8 },
  { name: 'Truck',  top: 8,  accel: 6,  turn: 1.6 },
  { name: 'Van',    top: 9,  accel: 7,  turn: 1.8 }
];

var cars = [];          // traffic + mobil pemain (flag player)
var state = null;
var meshCar = null;
var meshSmoke = null;
var initialized = false;
var lightPhase = 0;     // 0 = jalan X hijau, 1 = jalan Z hijau
var lightTimer = 0;
var driftTimer = 0;     // durasi drift aktif
var driftPaid = false;  // reward sudah dibayar untuk drift ini
var smokeTimer = 0;
var carSeed = 0;

function rr(a, b){ return a + Math.random() * (b - a); }
function ri(a, b){ return Math.floor(rr(a, b + 1)); }
function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(v, a, b){ return v < a ? a : (v > b ? b : v); }

/* Lampu lalu lintas per persimpangan: fase global berganti tiap 6 detik,
   paritas persimpangan membalik fase (tetangga tidak hijau bersamaan). */
function lightGreenFor(axis, gx, gz){
  var parity = ((gx / GRID) + (gz / GRID)) % 2 === 0 ? 0 : 1;
  var phase = (lightPhase + parity) % 2;
  return (axis === 'x') ? (phase === 0) : (phase === 1);
}

/* Posisi terdekat di jalan grid untuk sebuah titik. */
function snapToRoad(x, z){
  var rx = Math.round(x / GRID) * GRID;
  var rz = Math.round(z / GRID) * GRID;
  if (Math.abs(x - rx) < Math.abs(z - rz)) return { x: rx, z: z, axis: 'x' };
  return { x: x, z: rz, axis: 'z' };
}

function makeCar(x, z, isPlayer){
  var type = pick(CAR_TYPES);
  var snapped = snapToRoad(x, z);
  var axis = snapped.axis;
  var dir = Math.random() < 0.5 ? 1 : -1;
  // Arah hadap HARUS sejajar jalannya: jalan 'x' (x=rx) membujur ke Z,
  // jadi hadap 0/PI; jalan 'z' (z=rz) membujur ke X, jadi hadap +-PI/2.
  // (Sebelumnya terbalik: mobil melaju menembus blok/gedung.)
  var angle = axis === 'x' ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
  return {
    id: ++carSeed,
    x: snapped.x + (axis === 'x' ? 0 : rr(-1.5, 1.5)),
    z: snapped.z + (axis === 'z' ? 0 : rr(-1.5, 1.5)),
    angle: angle,
    axis: axis,
    dir: dir,
    speed: isPlayer ? 0 : rr(5, 9),
    cruise: rr(5, 9),
    color: pick(CAR_COLORS),
    type: type.name,
    top: type.top,
    accel: type.accel,
    turn: type.turn,
    player: !!isPlayer,
    damage: 0,
    stopped: false,
    smoke: false,
    honk: 0
  };
}

function spawnCar(x, z){
  var c = makeCar(x, z, false);
  cars.push(c);
  return c;
}

function init(st){
  state = st || null;
  if (initialized) return;
  initialized = true;
  if (window.SB && SB.Meshes){
    meshCar = SB.Meshes.car([0.8, 0.2, 0.2]);
    meshSmoke = SB.Meshes.box(1, 1, 1);
  }
  // 38 mobil traffic tersebar di jalan grid
  cars = [];
  for (var i = 0; i < 38; i++){
    var gx = ri(-5, 5) * GRID;
    var gz = ri(-5, 5) * GRID;
    var c = makeCar(gx + rr(-14, 14), gz + rr(-14, 14), false);
    cars.push(c);
  }
  SB.Vehicles.cars = cars;
}

/* Mobil traffic: maju di jalurnya; di persimpangan bisa belok;
   berhenti bila lampu merah atau mobil di depan terlalu dekat. */
function updateTraffic(c, dt){
  var fx = Math.sin(c.angle), fz = Math.cos(c.angle);
  // Dekat persimpangan? (jarak ke garis grid terdekat < 1.2)
  var nearX = Math.abs(c.x - Math.round(c.x / GRID) * GRID) < 1.2;
  var nearZ = Math.abs(c.z - Math.round(c.z / GRID) * GRID) < 1.2;
  var atCross = nearX && nearZ;
  // Lampu merah: berhenti sebelum garis persimpangan
  var axis = Math.abs(fx) > 0.5 ? 'x' : 'z';
  if (atCross){
    var gx = Math.round(c.x / GRID) * GRID;
    var gz = Math.round(c.z / GRID) * GRID;
    if (!lightGreenFor(axis, gx, gz)){
      c.speed = Math.max(0, c.speed - 14 * dt);
      c.stopped = true;
    } else {
      c.stopped = false;
      // Belok acak 25% di persimpangan hijau
      if (Math.random() < 0.25){
        var turn = Math.random() < 0.5 ? Math.PI/2 : -Math.PI/2;
        c.angle += turn;
        c.axis = (Math.abs(Math.sin(c.angle)) > 0.5) ? 'x' : 'z';
      }
    }
  }
  // Mobil di depan terlalu dekat -> rem
  for (var i = 0; i < cars.length; i++){
    var o = cars[i];
    if (o === c || o.player) continue;
    var dx = o.x - c.x, dz = o.z - c.z;
    var d = Math.sqrt(dx*dx + dz*dz);
    if (d < 7 && d > 0.01){
      var dot = (dx*fx + dz*fz) / d;
      if (dot > 0.9){ c.speed = Math.max(0, c.speed - 16 * dt); }
    }
  }
  // Akselerasi kembali ke cruise
  if (!c.stopped && c.speed < c.cruise) c.speed += 4 * dt;
  if (c.speed > c.cruise) c.speed = Math.max(c.cruise, c.speed - 6 * dt);
  c.x += Math.sin(c.angle) * c.speed * dt;
  c.z += Math.cos(c.angle) * c.speed * dt;
  // Keluar peta -> respawn di sisi berlawanan (traffic tak berujung)
  if (c.x > MAP_HALF){ c.x = -MAP_HALF; }
  if (c.x < -MAP_HALF){ c.x = MAP_HALF; }
  if (c.z > MAP_HALF){ c.z = -MAP_HALF; }
  if (c.z < -MAP_HALF){ c.z = MAP_HALF; }
  // Asap bila rusak parah
  if (c.damage > 60 && !c.smoke){ c.smoke = true; }
}

/* Tabrakan mobil pemain dengan gedung (AABB) -> damage + pantul. */
function collideBuildings(c){
  if (!window.SB || !SB.City || !SB.City.buildings) return;
  var list = SB.City.buildings;
  for (var i = 0; i < list.length; i++){
    var b = list[i];
    if (Math.abs(c.x - b.x) < b.w/2 + 1.6 && Math.abs(c.z - b.z) < b.d/2 + 1.6){
      // Dorong keluar ke sisi terdekat + damage proporsional kecepatan
      var push = Math.abs(c.speed) * 0.6;
      c.damage = Math.min(100, c.damage + 4 + push);
      c.speed *= -0.35;
      var dx = c.x - b.x, dz = c.z - b.z;
      if (Math.abs(dx) > Math.abs(dz)) c.x = b.x + (dx > 0 ? b.w/2 + 1.7 : -b.w/2 - 1.7);
      else c.z = b.z + (dz > 0 ? b.d/2 + 1.7 : -b.d/2 - 1.7);
      if (window.SB && SB.FX) SB.FX.sparks(c.x, 1, c.z);
      if (window.SB && SB.Audio) SB.Audio.sfx('crash');
      break;
    }
  }
}

/* Tabrakan mobil pemain dengan mobil traffic -> damage kedua belah pihak. */
function collideCars(c){
  for (var i = 0; i < cars.length; i++){
    var o = cars[i];
    if (o === c) continue;
    var dx = o.x - c.x, dz = o.z - c.z;
    var d = Math.sqrt(dx*dx + dz*dz);
    if (d < 3.4 && d > 0.01){
      var impact = Math.abs(c.speed - o.speed);
      c.damage = Math.min(100, c.damage + impact * 0.8);
      o.damage = Math.min(100, o.damage + impact * 0.8);
      c.speed *= 0.4;
      o.speed = Math.max(o.speed, impact * 0.3);
      // Dorong menjauh
      var push = (3.4 - d) / 2;
      var nx = dx / d, nz = dz / d;
      c.x -= nx * push; c.z -= nz * push;
      o.x += nx * push; o.z += nz * push;
      if (window.SB && SB.FX) SB.FX.sparks(c.x, 1, c.z);
      if (window.SB && SB.Audio) SB.Audio.sfx('crash');
    }
  }
}

function updatePlayerCar(c, dt){
  var input = state.input || {};
  var keys = input.keys || {};
  var steering = 0;
  if (keys.a || keys.arrowleft) steering += 1;
  if (keys.d || keys.arrowright) steering -= 1;
  var boost = (keys.shift) ? 1.35 : 1;
  // Gas / rem / mundur
  if (keys.w || keys.arrowup){
    c.speed += c.accel * boost * dt;
  } else if (keys.s || keys.arrowdown){
    if (c.speed > 0.5) c.speed -= c.accel * 1.4 * dt;
    else c.speed -= c.accel * 0.5 * dt;   // mundur pelan
  } else {
    // Gesekan: melambat alami
    c.speed -= Math.sign(c.speed) * 4 * dt;
    if (Math.abs(c.speed) < 0.2) c.speed = 0;
  }
  c.speed = clamp(c.speed, -6, c.top * boost);
  // Belok: makin cepat makin lebar; rem tangan = drift
  var handbrake = !!(keys.space);
  var steerRate = c.turn * (handbrake ? 1.9 : 1) * clamp(Math.abs(c.speed) / 8, 0.25, 1);
  c.angle += steering * steerRate * dt * (c.speed >= 0 ? 1 : -1);
  // DRIFT: belok keras + rem tangan + kecepatan tinggi
  var drifting = handbrake && Math.abs(steering) > 0 && Math.abs(c.speed) > 9;
  if (drifting){
    driftTimer += dt;
    if (driftTimer > 0.8 && !driftPaid){
      driftPaid = true;
      state.money = (state.money || 0) + DRIFT_REWARD;
      state.stats.drifts = (state.stats.drifts || 0) + 1;
      if (window.SB && SB.HUD) SB.HUD.showToast('DRIFT! +$' + DRIFT_REWARD);
      if (window.SB && SB.Audio) SB.Audio.sfx('drift');
    }
    if (window.SB && SB.FX && Math.random() < 0.5){
      SB.FX.smoke(c.x - Math.sin(c.angle) * 2, 0.4, c.z - Math.cos(c.angle) * 2);
    }
  } else {
    if (driftTimer > 0){ driftTimer = 0; driftPaid = false; }
  }
  c.x += Math.sin(c.angle) * c.speed * dt;
  c.z += Math.cos(c.angle) * c.speed * dt;
  c.x = clamp(c.x, -MAP_HALF, MAP_HALF);
  c.z = clamp(c.z, -MAP_HALF, MAP_HALF);
  collideBuildings(c);
  collideCars(c);
  // Asap kerusakan + mobil mogok total bila damage 100
  if (c.damage > 60){
    smokeTimer -= dt;
    if (smokeTimer <= 0){
      smokeTimer = 0.25;
      if (window.SB && SB.FX) SB.FX.smoke(c.x, 1.2, c.z);
    }
    if (c.damage >= 100){
      c.speed *= 0.9;
      if (Math.abs(c.speed) < 0.5){
        if (window.SB && SB.HUD) SB.HUD.showToast('Mobil rusak total! Keluar (F) dan cari mobil lain.');
      }
    }
  }
  // Sinkron state pemain ke mobil
  state.player.x = c.x;
  state.player.z = c.z;
  state.player.angle = c.angle;
}

function update(dt, st){
  if (st) state = st;
  if (!state) return;
  lightTimer += dt;
  if (lightTimer > 6){ lightTimer = 0; lightPhase = (lightPhase + 1) % 2; }
  for (var i = 0; i < cars.length; i++){
    var c = cars[i];
    if (c.player) updatePlayerCar(c, dt);
    else updateTraffic(c, dt);
  }
  // Jaga jumlah traffic: bila ada yang hilang, spawn pengganti
  var traffic = 0;
  for (var j = 0; j < cars.length; j++) if (!cars[j].player) traffic++;
  while (traffic < 36){
    spawnCar(ri(-5, 5) * GRID, ri(-5, 5) * GRID);
    traffic++;
  }
}

/* Mobil traffic terdekat dari pemain (maks 6 unit). */
function nearestCar(maxD){
  var best = null, bestD = maxD;
  var p = state.player;
  for (var i = 0; i < cars.length; i++){
    var c = cars[i];
    if (c.player) continue;
    var dx = c.x - p.x, dz = c.z - p.z;
    var d = Math.sqrt(dx*dx + dz*dz);
    if (d < bestD){ bestD = d; best = c; }
  }
  return best;
}

function enterCar(car){
  if (!state || !car) return false;
  if (state.player.vehicle) return false;
  car.player = true;
  car.speed = 0;
  state.player.vehicle = car;
  state.player.onFoot = false;
  state.player.x = car.x;
  state.player.z = car.z;
  state.player.angle = car.angle;
  if (window.SB && SB.Audio) SB.Audio.sfx('door');
  return true;
}

function exitCar(){
  if (!state) return false;
  var car = state.player.vehicle;
  if (!car) return false;
  car.player = false;
  car.speed = 0;
  // Turun di samping mobil (sisi kanan, bebas gedung)
  var sx = car.x + Math.cos(car.angle) * 2.2;
  var sz = car.z - Math.sin(car.angle) * 2.2;
  state.player.vehicle = null;
  state.player.onFoot = true;
  state.player.x = clamp(sx, -MAP_HALF, MAP_HALF);
  state.player.z = clamp(sz, -MAP_HALF, MAP_HALF);
  if (window.SB && SB.Audio) SB.Audio.sfx('door');
  return true;
}

/* Curi mobil terdekat (tombol E): +1 wanted, statistik, toast. */
function stealCar(){
  if (!state) return false;
  if (state.player.vehicle) return false;
  var car = nearestCar(6);
  if (!car) {
    if (window.SB && SB.HUD) SB.HUD.showToast('Tidak ada mobil di dekatmu.');
    return false;
  }
  enterCar(car);
  state.stats.carsStolen = (state.stats.carsStolen || 0) + 1;
  state.wanted = Math.min(5, (state.wanted || 0) + 1);
  state.heat = Math.min(100, (state.heat || 0) + 15);
  if (window.SB && SB.Police) SB.Police.setWanted(state.wanted);
  if (window.SB && SB.HUD) SB.HUD.showToast('Mobil dicuri! Wanted +' + 1 + ' — ' + car.type);
  if (window.SB && SB.Audio) SB.Audio.sfx('steal');
  return true;
}

/* Respray: ganti warna mobil pemain, -$150. Hanya di dalam mobil. */
function respray(){
  if (!state || !state.player.vehicle) return false;
  if ((state.money || 0) < RESPRAY_COST){
    if (window.SB && SB.HUD) SB.HUD.showToast('Respray butuh $' + RESPRAY_COST);
    return false;
  }
  var car = state.player.vehicle;
  var old = car.color;
  do { car.color = pick(CAR_COLORS); } while (car.color === old);
  state.money -= RESPRAY_COST;
  car.damage = Math.max(0, car.damage - 20);   // cat baru = perbaikan ringan
  if (window.SB && SB.HUD) SB.HUD.showToast('Respray selesai! -$' + RESPRAY_COST);
  if (window.SB && SB.Audio) SB.Audio.sfx('respray');
  return true;
}

function draw(gl, st){
  if (st) state = st;
  if (!gl || !SB.GL || !SB.Math3 || !state) return;
  if (!meshCar) return;
  var M = SB.Math3;
  var cam = state.camera ? state.camera.look : { x: 0, z: 0 };
  for (var i = 0; i < cars.length; i++){
    var c = cars[i];
    var dx = c.x - (cam.x || 0), dz = c.z - (cam.z || 0);
    if (dx*dx + dz*dz > 200*200) continue;
    var m = M.mat4Identity();
    m = M.mat4Translate(m, c.x, 0, c.z);
    m = M.mat4RotateY(m, c.angle);
    SB.GL.drawMesh(meshCar, m, c.color);
    // Lampu depan menyala saat malam (dua kotak kecil di depan mobil)
    var t = state.timeOfDay || 18.33;
    var night = (t >= 19 || t < 6);
    if (night && meshSmoke){
      var hm = M.mat4Identity();
      hm = M.mat4Translate(hm, c.x + Math.sin(c.angle) * 2.2, 0.6, c.z + Math.cos(c.angle) * 2.2);
      SB.GL.drawMesh(meshSmoke, hm, [1.0, 0.9, 0.5]);
    }
    // Asap kerusakan: kotak abu-abu di atas kap
    if (c.damage > 60 && meshSmoke){
      var sm = M.mat4Identity();
      sm = M.mat4Translate(sm, c.x, 1.6 + Math.sin((state.time || 0) * 5 + i) * 0.2, c.z);
      SB.GL.drawMesh(meshSmoke, sm, [0.4, 0.4, 0.4]);
    }
  }
}

window.SB.Vehicles = {
  init: init,
  update: update,
  draw: draw,
  spawnCar: spawnCar,
  stealCar: stealCar,
  cars: cars,
  enterCar: enterCar,
  exitCar: exitCar,
  respray: respray
};

})();
