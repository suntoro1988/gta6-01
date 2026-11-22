window.SB = window.SB || {};
(function(){ 'use strict';

// SB.Vehicles — lalu lintas Sunset Bay: 40 mobil (traffic AI + mobil pemain),
// curi mobil, masuk/keluar mobil, tabrakan ringan, klakson.
// Mobil pemain + traffic berbagi struktur car:
//   { id, x, z, angle, speed, targetSpeed, color, kind, stolen, ai,
//     waypoint, lane, brake, meshKey }
// state.player.vehicle menunjuk objek car saat mengemudi (atau null).
// PENTING (pelajaran v12): stealCar() HARUS mengembalikan OBJEK mobil,
// BUKAN boolean — pemanggil (Player/Jobs) memakai objeknya langsung.

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

var CAR_COLORS = [
  '#c0392b', '#2980b9', '#f1c40f', '#ecf0f1', '#2c3e50',
  '#e67e22', '#8e44ad', '#16a085', '#7f8c8d', '#d35400',
  '#1abc9c', '#34495e', '#e74c3c', '#f39c12', '#bdc3c7'
];

var KINDS = ['sedan', 'sedan', 'sedan', 'taxi', 'coupe', 'van', 'pickup'];

var TRAFFIC_COUNT = 40;   // target spec: 36+ mobil traffic
var BLOCK = 40;           // grid jalan (selaras SB.City)
var MAX_SPEED = 14;       // traffic santai (unit/detik)
var PLAYER_TOP = 26;      // mobil pemain bisa lebih kencang
var STEAL_RADIUS = 7;     // jarak maksimal mencuri mobil
var RESPRAY_COST = 150;   // biaya cat ulang mobil pemain (respray)

var veh = {
  ready: false,
  cars: [],
  nextId: 1,
  rng: null,
  meshCache: {},
  hornTimer: 0
};

// Pembuatan mobil

// Posisi jalan acak (di tengah jalur grid).
function streetPos(rng) {
  var vertical = rng() < 0.5;
  var g = -200 + Math.floor(rng() * 11) * BLOCK;
  if (vertical) {
    return { x: g + (rng() < 0.5 ? 2.5 : -2.5), z: -190 + rng() * 350 };
  }
  return { x: -190 + rng() * 380, z: g + (rng() < 0.5 ? 2.5 : -2.5) };
}

// Buat objek car baru di (x, z). kind 'taxi' berwarna kuning.
function makeCar(x, z, kind) {
  var rng = veh.rng || mulberry32(99);
  kind = kind || KINDS[Math.floor(rng() * KINDS.length)];
  var color = (kind === 'taxi') ? '#f1c40f'
    : CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)];
  var vertical = rng() < 0.5;
  return {
    id: 'car-' + (veh.nextId++),
    x: x, z: z,
    angle: vertical ? (rng() < 0.5 ? 0 : Math.PI) : (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2),
    speed: 0,
    targetSpeed: 6 + rng() * 6,
    color: color,
    kind: kind,
    stolen: false,
    ai: true,
    lane: vertical ? 'v' : 'h',
    grid: vertical ? Math.round(x / BLOCK) * BLOCK : Math.round(z / BLOCK) * BLOCK,
    brake: 0,
    hp: 100
  };
}

// spawnCar(x, z): buat mobil baru di posisi itu, masukkan ke cars, kembalikan.
// Bila x/z tidak diberikan, pakai posisi jalan acak.
function spawnCar(x, z) {
  var rng = veh.rng || mulberry32(99);
  if (x === undefined || z === undefined) {
    var p = streetPos(rng);
    x = p.x; z = p.z;
  }
  var car = makeCar(x, z);
  veh.cars.push(car);
  return car;
}

// Mobil terdekat dari (x, z) dalam radius r.
function nearestCar(x, z, r) {
  var best = null, bestD = r;
  for (var i = 0; i < veh.cars.length; i++) {
    var c = veh.cars[i];
    var dx = c.x - x, dz = c.z - z;
    var d = Math.sqrt(dx * dx + dz * dz);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

// API publik

// init(state): isi 40 traffic + 2 mobil parkir dekat spawn pemain.
function init(state) {
  if (veh.ready) { return; }
  veh.ready = true;
  veh.rng = mulberry32(20261122);
  // Kosongkan in-place (JANGAN reassign): array yang diekspor di
  // window.SB.Vehicles.cars menunjuk objek array ini.
  veh.cars.length = 0;
  veh.nextId = 1;
  for (var i = 0; i < TRAFFIC_COUNT; i++) {
    var p = streetPos(veh.rng);
    veh.cars.push(makeCar(p.x, p.z));
  }
  // Dua mobil parkir di Boardwalk dekat spawn pemain (mudah dicuri di awal).
  var parked1 = makeCar(-36, 146, 'sedan');
  parked1.ai = false; parked1.targetSpeed = 0;
  veh.cars.push(parked1);
  var parked2 = makeCar(-30, 158, 'coupe');
  parked2.ai = false; parked2.targetSpeed = 0;
  veh.cars.push(parked2);
  if (state) { state.flags.carsReady = true; }
}

// update(dt, state): traffic AI + mobil pemain.
function update(dt, state) {
  if (!veh.ready) { return; }
  var p = state ? state.player : null;

  for (var i = 0; i < veh.cars.length; i++) {
    var c = veh.cars[i];

    // --- Mobil yang dikemudikan pemain ---
    if (p && p.vehicle === c) {
      var input = state._carInput || { f: 0, turn: 0 };
      var top = PLAYER_TOP;
      c.targetSpeed = input.f * top;
      // Akselerasi / pengereman halus.
      var accel = (c.targetSpeed > c.speed) ? 10 : 16;
      if (c.speed < c.targetSpeed) {
        c.speed = Math.min(c.targetSpeed, c.speed + accel * dt);
      } else if (c.speed > c.targetSpeed) {
        c.speed = Math.max(c.targetSpeed, c.speed - accel * dt);
      }
      // Belok: hanya efektif saat bergerak; mundur membalik arah belok.
      var steer = input.turn * (0.55 + Math.min(1, Math.abs(c.speed) / 12) * 0.9);
      c.angle += steer * dt * (c.speed < -0.5 ? -1 : 1);
      c.x += Math.sin(c.angle) * c.speed * dt;
      c.z += Math.cos(c.angle) * c.speed * dt;
      // Batas dunia: pantai selatan + tepi peta (pantul pelan).
      if (c.z > 200) { c.z = 200; c.speed *= 0.3; }
      if (c.z < -235) { c.z = -235; c.speed *= 0.3; }
      if (c.x < -235) { c.x = -235; c.speed *= 0.3; }
      if (c.x > 235) { c.x = 235; c.speed *= 0.3; }
      // Tabrakan dengan traffic: dorong pelan, kurangi kecepatan.
      for (var j = 0; j < veh.cars.length; j++) {
        if (i === j) { continue; }
        var o = veh.cars[j];
        var dx = c.x - o.x, dz = c.z - o.z;
        var d2 = dx * dx + dz * dz;
        if (d2 < 9 && d2 > 0.01) {
          var d = Math.sqrt(d2);
          var push = (3 - d) * 0.5;
          c.x += (dx / d) * push;
          c.z += (dz / d) * push;
          c.speed *= 0.85;
        }
      }
      // Sinkronkan state pemain ke mobil.
      p.x = c.x; p.z = c.z; p.y = 0;
      p.angle = c.angle;
      // Drift: belok tajam di kecepatan tinggi.
      if (Math.abs(input.turn) > 0.7 && Math.abs(c.speed) > 14) {
        if (state.stats) { state.stats.drifts = (state.stats.drifts || 0) + dt; }
      }
      continue;
    }

    // --- Traffic AI: jalan lurus di jalurnya, belok di persimpangan ---
    if (!c.ai) { continue; }
    // Rem bila ada mobil di depan (jarak < 10 searah).
    c.brake = 0;
    for (var k = 0; k < veh.cars.length; k++) {
      if (k === i) { continue; }
      var ahead = veh.cars[k];
      var ax = ahead.x - c.x, az = ahead.z - c.z;
      var dist = Math.sqrt(ax * ax + az * az);
      if (dist < 9) {
        // Apakah mobil itu ada di depan (searah hadap)?
        var dot = (ax * Math.sin(c.angle) + az * Math.cos(c.angle)) / (dist || 1);
        if (dot > 0.7) { c.brake = 1; break; }
      }
    }
    var want = c.brake ? 0 : c.targetSpeed;
    if (c.speed < want) { c.speed = Math.min(want, c.speed + 5 * dt); }
    else if (c.speed > want) { c.speed = Math.max(want, c.speed - 12 * dt); }
    c.x += Math.sin(c.angle) * c.speed * dt;
    c.z += Math.cos(c.angle) * c.speed * dt;

    // Di persimpangan (dekat kelipatan BLOCK di kedua sumbu), kadang belok.
    var nearIx = Math.abs(c.x - Math.round(c.x / BLOCK) * BLOCK) < 3;
    var nearIz = Math.abs(c.z - Math.round(c.z / BLOCK) * BLOCK) < 3;
    if (nearIx && nearIz && c.speed > 1) {
      var r = veh.rng();
      if (r < 0.12) { c.angle += Math.PI / 2; }        // belok kanan
      else if (r < 0.24) { c.angle -= Math.PI / 2; }   // belok kiri
      else if (r < 0.27) { c.angle += Math.PI; }       // putar balik
      // Setelah belok, kunci jalur baru.
      c.lane = (Math.abs(Math.sin(c.angle)) > 0.5) ? 'v' : 'h';
    }
    // Keluar peta -> respawn di sisi berlawanan (lalu lintas tak habis).
    if (c.z > 205 || c.z < -235 || c.x < -235 || c.x > 235) {
      var np = streetPos(veh.rng);
      c.x = np.x; c.z = np.z;
      c.speed = c.targetSpeed * 0.5;
    }
  }

  // Klakson acak dari traffic yang mengerem (dipakai Audio bila ada).
  veh.hornTimer -= dt;
  if (veh.hornTimer <= 0) {
    veh.hornTimer = 4 + veh.rng() * 8;
    if (state && window.SB.Audio) {
      // Hanya bunyikan bila ada mobil mengerem di dekat pemain.
      for (var h = 0; h < veh.cars.length; h++) {
        var hc = veh.cars[h];
        if (hc.brake && p) {
          var hdx = hc.x - p.x, hdz = hc.z - p.z;
          if (hdx * hdx + hdz * hdz < 900) {
            window.SB.Audio.sfx('horn');
            break;
          }
        }
      }
    }
  }
}

// draw(gl, state): gambar semua mobil (mesh di-cache per warna).
function draw(gl, state) {
  if (!veh.ready || !gl || !gl.drawMesh) { return; }
  var M = window.SB.Math3;
  if (!M) { return; }
  var white = [1, 1, 1];
  for (var i = 0; i < veh.cars.length; i++) {
    var c = veh.cars[i];
    var mesh = carMesh(c.color);
    if (!mesh) { continue; }
    var m4 = M.mat4Identity();
    m4 = M.mat4Translate(m4, c.x, 0, c.z);
    m4 = M.mat4RotateY(m4, c.angle);
    gl.drawMesh(mesh, m4, white);
  }
}

// Ambil mesh mobil per warna (cache).
function carMesh(color) {
  if (!window.SB || !window.SB.Meshes) { return null; }
  var m = veh.meshCache[color];
  if (!m) {
    m = window.SB.Meshes.car(color);
    veh.meshCache[color] = m;
  }
  return m;
}

// Curi / masuk / keluar mobil.

// stealCar(): curi mobil terdekat dan LANGSUNG masuk ke dalamnya.
// MENGEMBALIKAN OBJEK MOBIL (bukan boolean):
//   - mobil terdekat dalam STEAL_RADIUS bila ada;
//   - bila tidak ada mobil dekat, spawn satu mobil di jalan terdekat dan
//     kembalikan mobil itu (pemain tidak pernah gagal total).
//   - bila pemain sudah mengemudi / di perahu, kembalikan mobil yang sedang
//     dikemudikan (atau null bila tidak ada).
// Efek samping: stats.carsStolen +1, wanted +1 (maks 5), heat +8.
function stealCar() {
  var state = window.SB.state;
  if (!veh.ready) { return null; }
  if (!state || !state.player) { return null; }
  var p = state.player;

  // Sudah mengemudi: kembalikan mobil yang sedang dipakai.
  if (p.vehicle && p.vehicle.id && p.vehicle.id.indexOf('car-') === 0) {
    return p.vehicle;
  }
  // Sedang di perahu: tidak bisa mencuri mobil.
  if (p.onBoat) { return null; }

  var car = nearestCar(p.x, p.z, STEAL_RADIUS);
  if (!car) {
    // Tidak ada mobil dekat: spawn satu di jalan terdekat dari pemain.
    var rng = veh.rng || mulberry32(7);
    var gx = Math.round(p.x / BLOCK) * BLOCK + (rng() < 0.5 ? 2.5 : -2.5);
    var gz = clamp(p.z + (rng() - 0.5) * 20, -190, 195);
    car = spawnCar(gx, gz);
  }

  car.stolen = true;
  car.ai = false;
  car.speed = 0;
  enterCar(car);

  if (state.stats) {
    state.stats.carsStolen = (state.stats.carsStolen || 0) + 1;
  }
  // Mencuri mobil menaikkan wanted + heat (polisi memperhatikan).
  if (typeof state.wanted === 'number') {
    state.wanted = Math.min(5, state.wanted + 1);
  }
  if (typeof state.heat === 'number') {
    state.heat = Math.min(100, state.heat + 8);
  }
  return car;
}

// enterCar(car): pemain masuk ke mobil (tanpa efek wanted).
// Mengembalikan mobil yang dimasuki, atau null bila argumen tidak valid.
function enterCar(car) {
  var state = window.SB.state;
  if (!car || !car.id) { return null; }
  if (!state || !state.player) { return null; }
  var p = state.player;
  // Turun dulu dari perahu bila sedang di perahu (tidak bisa dua kendaraan).
  if (p.onBoat && window.SB.Water) { window.SB.Water.exitBoat(); }
  p.vehicle = car;
  p.onFoot = false;
  p.onBoat = false;
  p.x = car.x;
  p.z = car.z;
  p.y = 0;
  p.angle = car.angle;
  car.ai = false;
  state._carInput = state._carInput || { f: 0, turn: 0 };
  return car;
}

// exitCar(): pemain keluar dari mobil ke sisi jalan. Return true bila
// berhasil, false bila pemain memang tidak sedang mengemudi.
function exitCar() {
  var state = window.SB.state;
  if (!state || !state.player) { return false; }
  var p = state.player;
  var car = p.vehicle;
  if (!car || !car.id || car.id.indexOf('car-') !== 0) { return false; }
  // Parkir mobil (berhenti, kembali jadi traffic pasif bila bukan curian).
  car.speed = 0;
  car.targetSpeed = 0;
  if (!car.stolen) { car.ai = true; car.targetSpeed = 6 + (veh.rng ? veh.rng() * 6 : 6); }
  // Pemain turun di sisi kiri mobil (tegak lurus arah hadap).
  var sideX = Math.cos(car.angle), sideZ = -Math.sin(car.angle);
  p.x = car.x + sideX * 2.2;
  p.z = car.z + sideZ * 2.2;
  p.y = 0;
  p.vehicle = null;
  p.onFoot = true;
  p.onBoat = false;
  if (state) { state._carInput = { f: 0, turn: 0 }; }
  return true;
}

// respray(): cat ulang mobil pemain seharga RESPRAY_COST ($150).
// Hanya bisa dipakai saat pemain BERADA DI DALAM mobil.
//   - Berhasil: potong $150 dari uang pemain, ganti warna mobil pemain ke
//     warna baru (acak dari CAR_COLORS, berbeda dari warna sekarang),
//     tampilkan toast, mainkan sfx 'respray', kembalikan {ok:true}.
//   - Gagal (pemain tidak di dalam mobil, atau uang kurang):
//     kembalikan {ok:false} TANPA memotong uang.
// Uang dibaca dari state.money bila ada, kalau tidak state.player.money.
function respray() {
  var state = window.SB.state;
  if (!veh.ready) { return { ok: false }; }
  if (!state || !state.player) { return { ok: false }; }
  var p = state.player;
  var car = p.vehicle;
  if (!car || !car.id || car.id.indexOf('car-') !== 0) { return { ok: false }; }
  var hasStateMoney = (typeof state.money === 'number');
  var money = hasStateMoney ? state.money
    : (typeof p.money === 'number' ? p.money : null);
  if (money === null || money < RESPRAY_COST) { return { ok: false }; }
  if (hasStateMoney) { state.money -= RESPRAY_COST; }
  else { p.money -= RESPRAY_COST; }
  // Warna baru: acak, berbeda dari warna sekarang.
  var rng = veh.rng || mulberry32(31);
  var color = car.color;
  var guard = 0;
  while (color === car.color && guard++ < 12) {
    color = CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)];
  }
  car.color = color;
  // Mesh warna baru dibuat otomatis saat draw berikutnya (carMesh cache
  // per warna; cache warna lama tetap valid).
  if (window.SB.Audio) { window.SB.Audio.sfx('respray'); }
  if (window.SB.UI && window.SB.UI.toast) {
    window.SB.UI.toast('Respray selesai! Mobil dicat ' + color + ' (-$150)');
  }
  if (state.stats) {
    state.stats.resprays = (state.stats.resprays || 0) + 1;
  }
  return { ok: true };
}

// Export namespace.

window.SB.Vehicles = {
  init: init,
  update: update,
  draw: draw,
  spawnCar: spawnCar,
  stealCar: stealCar,
  cars: veh.cars,
  enterCar: enterCar,
  exitCar: exitCar,
  respray: respray
};

})();
