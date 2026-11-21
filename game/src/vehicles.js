// Sunset Bay v9 — vehicles.js
// 14 mobil AI + 5 mobil parkir; AI melaju di jalan & berhenti di lampu merah;
// curi mobil (E) — wanted +2; DRIFT: Space + belok saat kecepatan > 8
// memberi +1 drift dan +$50, sekali per penekanan Space.
(function () {
  'use strict';
  var SB = window.SB = window.SB || {};

  // Garis jalan (dipakai AI untuk lajur & persimpangan).
  var LANES = [-160, -120, -80, -40, 0, 40, 80, 120, 160];
  var PAINTS = [
    [0.8, 0.1, 0.1], [0.1, 0.3, 0.8], [0.9, 0.8, 0.1], [0.1, 0.7, 0.2],
    [0.85, 0.85, 0.85], [0.15, 0.15, 0.15], [0.9, 0.4, 0.05], [0.5, 0.1, 0.6],
    [0.1, 0.6, 0.7], [0.7, 0.7, 0.75]
  ];
  // Tempat mobil parkir (mudah dicuri pemain).
  var PARKED_SPOTS = [[-38, 6], [42, -38], [-118, 42], [78, 118], [2, -118]];

  var _held = {};   // tombol yang sedang ditekan (listener lokal)
  var _clock = 0;   // jam internal untuk siklus lampu lalu lintas
  var _meshByColor = {};

  window.addEventListener('keydown', function (e) { _held[e.code || e.key] = true; });
  window.addEventListener('keyup', function (e) { _held[e.code || e.key] = false; });

  // Gabung tombol lokal + tombol global dari main (SB.G.keys) bila ada.
  function readKeys() {
    var shared = (SB.G && SB.G.keys) || {};
    var out = {}, k;
    for (k in _held) out[k] = _held[k];
    for (k in shared) out[k] = shared[k];
    return out;
  }

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function anyOf(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function newCar(x, z, yaw, ai, parked) {
    return {
      x: x, z: z, yaw: yaw, speed: 0,
      color: anyOf(PAINTS), ai: !!ai, parked: !!parked,
      axis: Math.random() < 0.5 ? 'x' : 'z',
      dir: Math.random() < 0.5 ? 1 : -1,
      lane: anyOf(LANES),
      cruise: rnd(8, 14),
      drifting: false, _driftCounted: false
    };
  }

  function spawnTraffic() {
    var cars = [];
    var i;
    // 14 mobil AI di jalan (pada garis jalan, lajur & arah acak).
    for (i = 0; i < 14; i++) {
      var axis = Math.random() < 0.5 ? 'x' : 'z';
      var lane = anyOf(LANES);
      var along = rnd(-150, 150);
      var c = newCar(axis === 'x' ? along : lane, axis === 'x' ? lane : along, 0, true, false);
      c.axis = axis; c.lane = lane; c.dir = Math.random() < 0.5 ? 1 : -1;
      c.yaw = axis === 'x' ? (c.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (c.dir > 0 ? 0 : Math.PI);
      cars.push(c);
    }
    // 5 mobil parkir di tepi jalan.
    for (i = 0; i < PARKED_SPOTS.length; i++) {
      cars.push(newCar(PARKED_SPOTS[i][0], PARKED_SPOTS[i][1], rnd(0, Math.PI * 2), false, true));
    }
    SB.Vehicles.cars = cars;
    return cars;
  }

  // Lampu: siklus 6 detik; sumbu x hijau saat fase 0, sumbu z saat fase 1.
  function greenFor(axis) {
    var phase = Math.floor(_clock / 6) % 2;
    return (axis === 'x' && phase === 0) || (axis === 'z' && phase === 1);
  }

  function atCrossing(v) {
    var along = v.axis === 'x' ? v.x : v.z;
    for (var i = 0; i < LANES.length; i++) {
      if (Math.abs(along - LANES[i]) < 7) return true;
    }
    return false;
  }

  function hitsWall(x, z) {
    var list = (SB.City && SB.City.buildings) || [];
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (Math.abs(x - b.x) < b.w / 2 + 2 && Math.abs(z - b.z) < b.d / 2 + 2) return true;
    }
    return false;
  }

  // AI: kejar kecepatan jelajah, berhenti di lampu merah di persimpangan,
  // putar balik + ganti lajur di ujung kota.
  function driveAI(c, dt) {
    var stop = atCrossing(c) && !greenFor(c.axis);
    var target = stop ? 0 : c.cruise;
    c.speed += (target - c.speed) * Math.min(1, 1.5 * dt);
    if (c.speed < 0.05 && !stop) c.speed = 0;
    if (c.axis === 'x') c.x += c.dir * c.speed * dt;
    else c.z += c.dir * c.speed * dt;
    var along = c.axis === 'x' ? c.x : c.z;
    if (along > 165 || along < -165) {
      c.dir *= -1;
      c.lane = anyOf(LANES);
      if (c.axis === 'x') { c.x = Math.max(-160, Math.min(160, c.x)); c.z = c.lane; }
      else { c.z = Math.max(-160, Math.min(160, c.z)); c.x = c.lane; }
      c.yaw = c.axis === 'x' ? (c.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (c.dir > 0 ? 0 : Math.PI);
    }
  }

  // --- DRIFT ---
  // Dipanggil tiap frame saat pemain menyetir. Drift dihitung hanya sekali
  // per penekanan Space: flag car.drifting + car._driftCounted mencegah spam.
  // Syarat: Space ditekan + belok (A/D) + kecepatan > 8.
  function driftCheck(car, k) {
    var space = !!k['Space'];
    var turning = !!(k['KeyA'] || k['ArrowLeft'] || k['KeyD'] || k['ArrowRight']);
    var fast = Math.abs(car.speed) > 8;
    if (space && turning && fast) {
      if (!car.drifting) {
        car.drifting = true;
        if (!car._driftCounted) {
          car._driftCounted = true;
          if (SB.G) {
            SB.G.drifts = (SB.G.drifts || 0) + 1;
            SB.G.money = (SB.G.money || 0) + 50;
          }
          if (SB.HUD && SB.HUD.showMessage) SB.HUD.showMessage('Drift! +$50');
        }
      }
      return true; // sedang drift: handling licin
    }
    if (!space) { car.drifting = false; car._driftCounted = false; }
    else if (!turning || !fast) { car.drifting = false; }
    return car.drifting;
  }

  // Mobil yang dikendarai pemain: gas/rem, belok, tabrakan, batas kota.
  function drivePlayer(car, dt) {
    var k = readKeys();
    var fwd = (k['KeyW'] || k['ArrowUp']) ? 1 : 0;
    var back = (k['KeyS'] || k['ArrowDown']) ? 1 : 0;
    var left = (k['KeyA'] || k['ArrowLeft']) ? 1 : 0;
    var right = (k['KeyD'] || k['ArrowRight']) ? 1 : 0;
    var drifting = driftCheck(car, k);
    if (fwd) car.speed += 16 * dt;
    if (back) car.speed -= (car.speed > 0 ? 22 : 8) * dt;
    if (!fwd && !back) car.speed *= Math.max(0, 1 - (drifting ? 0.4 : 1.2) * dt);
    car.speed = Math.max(-10, Math.min(30, car.speed));
    var steer = (left ? 1 : 0) - (right ? 1 : 0);
    // Saat drift: belok lebih tajam, grip berkurang (mobil sedikit meluncur).
    var turnRate = drifting ? 2.4 : 1.6;
    car.yaw += steer * turnRate * dt * Math.min(1, Math.abs(car.speed) / 8) * (car.speed < 0 ? -1 : 1);
    var nx = car.x + Math.sin(car.yaw) * car.speed * dt;
    var nz = car.z + Math.cos(car.yaw) * car.speed * dt;
    if (!hitsWall(nx, nz) && nx > -166 && nx < 166 && nz > -166 && nz < 166) {
      car.x = nx; car.z = nz;
    } else {
      car.speed *= 0.3; // menabrak: melambat
      if (SB.Audio && SB.Audio.sfx) SB.Audio.sfx('crash');
    }
    if (SB.G && SB.G.player) {
      var p = SB.G.player;
      p.x = car.x; p.z = car.z; p.yaw = car.yaw; p.speed = Math.abs(car.speed);
      SB.G.dist += Math.abs(car.speed) * dt * 0.2;
    }
  }

  function update(dt) {
    _clock += dt;
    var cars = SB.Vehicles.cars;
    for (var i = 0; i < cars.length; i++) {
      var c = cars[i];
      if (c.parked) continue;
      if (c.ai) driveAI(c, dt);
      else if (SB.G && SB.G.player && SB.G.player.inCar && SB.G.player.car === c) drivePlayer(c, dt);
    }
  }

  function closestParked(x, z) {
    var best = null, bd = Infinity;
    var cars = SB.Vehicles.cars;
    for (var i = 0; i < cars.length; i++) {
      var c = cars[i];
      if (!c.parked) continue;
      var d = Math.hypot(c.x - x, c.z - z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  function closestAny(x, z, maxD) {
    var best = null, bd = maxD == null ? 6 : maxD;
    var cars = SB.Vehicles.cars;
    for (var i = 0; i < cars.length; i++) {
      var c = cars[i];
      if (c.parked === false && c.ai && c.speed > 6) continue; // jangan curi mobil AI ngebut
      var d = Math.hypot(c.x - x, c.z - z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  function enterCar(car) {
    if (!car || !SB.G || !SB.G.player) return false;
    var p = SB.G.player;
    car.parked = false; car.ai = false;
    car.drifting = false; car._driftCounted = false;
    p.inCar = true; p.car = car; p.inBoat = false;
    return true;
  }

  function exitCar() {
    if (!SB.G || !SB.G.player) return false;
    var p = SB.G.player;
    if (!p.inCar || !p.car) return false;
    var car = p.car;
    car.speed = 0; car.drifting = false; car._driftCounted = false;
    var spot = { x: car.x + Math.cos(car.yaw) * 3, z: car.z - Math.sin(car.yaw) * 3 };
    if (SB.City && SB.City.findClearSpot) spot = SB.City.findClearSpot(spot.x, spot.z, 2);
    p.x = spot.x; p.z = spot.z; p.inCar = false; p.car = null; p.speed = 0;
    return true;
  }

  // Curi mobil terdekat (E): masuk mobil + wanted naik 2 bintang.
  function stealNearest() {
    if (!SB.G || !SB.G.player) return null;
    var p = SB.G.player;
    if (p.inCar || p.inBoat) return null;
    var car = closestAny(p.x, p.z, 6);
    if (!car) car = closestParked(p.x, p.z);
    if (!car || Math.hypot(car.x - p.x, car.z - p.z) > 6) return null;
    if (SB.Game && SB.Game.wantedUp) SB.Game.wantedUp(2); // curi mobil → wanted +2
    enterCar(car);
    if (SB.HUD && SB.HUD.showMessage) SB.HUD.showMessage('Mobil dicuri! Wanted +2');
    return car;
  }

  function draw() {
    if (!SB.GL || !SB.GL.draw || !SB.Math3 || !SB.Meshes || !SB.Meshes.car) return;
    var M = SB.Math3;
    var cars = SB.Vehicles.cars;
    for (var i = 0; i < cars.length; i++) {
      var c = cars[i];
      var key = c.color.join(',');
      if (!_meshByColor[key]) {
        var m = SB.Meshes.car(c.color);
        _meshByColor[key] = SB.GL.mesh(m.pos, m.col);
      }
      var mat = M.mat4Mul(M.mat4Translate(c.x, 0.6, c.z), M.mat4RotateY(c.yaw));
      SB.GL.draw(_meshByColor[key], mat);
    }
  }

  SB.Vehicles = {
    cars: [],
    spawnTraffic: spawnTraffic,
    update: update,
    draw: draw,
    stealNearest: stealNearest,
    enterCar: enterCar,
    exitCar: exitCar,
    nearestParked: closestParked
  };
})();
