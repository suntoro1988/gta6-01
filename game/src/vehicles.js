// Sunset Bay v8 — vehicles.js (ditulis fresh dari SPEC-v8)
// 14 mobil AI + 5 parkir; AI jalan di jalan & berhenti di lampu; curi mobil (E);
// DRIFT baru v8: Space + belok (A/D) saat kecepatan > 8 → +1 drift, +$50.
(function () {
  var SB = window.SB = window.SB || {};
  var GRID = [-160, -120, -80, -40, 0, 40, 80, 120, 160];
  var COLORS = [
    [0.8, 0.1, 0.1], [0.1, 0.3, 0.8], [0.9, 0.8, 0.1], [0.1, 0.7, 0.2],
    [0.85, 0.85, 0.85], [0.15, 0.15, 0.15], [0.9, 0.4, 0.05], [0.5, 0.1, 0.6],
    [0.1, 0.6, 0.7], [0.7, 0.7, 0.75]
  ];
  var _keys = {};
  var _t = 0;
  var _carMeshes = {};

  window.addEventListener("keydown", function (e) { _keys[e.code || e.key] = true; });
  window.addEventListener("keyup", function (e) { _keys[e.code || e.key] = false; });

  function keys() {
    var g = (SB.G && SB.G.keys) || {};
    var out = {}, k;
    for (k in _keys) out[k] = _keys[k];
    for (k in g) out[k] = g[k];
    return out;
  }

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function makeCar(x, z, yaw, ai, parked) {
    return {
      x: x, z: z, yaw: yaw, speed: 0,
      color: pick(COLORS), ai: !!ai, parked: !!parked,
      axis: Math.random() < 0.5 ? "x" : "z",
      dir: Math.random() < 0.5 ? 1 : -1,
      lane: pick(GRID),
      cruise: rnd(8, 14),
      drifting: false, _driftCounted: false
    };
  }

  function spawnTraffic() {
    var cars = [];
    var i;
    // 14 mobil AI di jalan (pada garis jalan, lajur acak).
    for (i = 0; i < 14; i++) {
      var axis = Math.random() < 0.5 ? "x" : "z";
      var lane = pick(GRID);
      var along = rnd(-150, 150);
      var c = makeCar(axis === "x" ? along : lane, axis === "x" ? lane : along, 0, true, false);
      c.axis = axis; c.lane = lane; c.dir = Math.random() < 0.5 ? 1 : -1;
      c.yaw = axis === "x" ? (c.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (c.dir > 0 ? 0 : Math.PI);
      cars.push(c);
    }
    // 5 mobil parkir di tepi jalan (mudah dicuri pemain).
    var spots = [[-38, 6], [42, -38], [-118, 42], [78, 118], [2, -118]];
    for (i = 0; i < 5; i++) {
      var p = makeCar(spots[i][0], spots[i][1], rnd(0, Math.PI * 2), false, true);
      cars.push(p);
    }
    SB.Vehicles.cars = cars;
    return cars;
  }

  // Lampu: siklus 6 detik; sumbu x hijau saat fase 0, sumbu z hijau saat fase 1.
  function lightGreen(axis) {
    var phase = Math.floor(_t / 6) % 2;
    return (axis === "x" && phase === 0) || (axis === "z" && phase === 1);
  }

  function nearIntersection(v) {
    var along = v.axis === "x" ? v.x : v.z;
    for (var i = 0; i < GRID.length; i++) {
      if (Math.abs(along - GRID[i]) < 7) return true;
    }
    return false;
  }

  function hitsBuilding(x, z) {
    var list = (SB.City && SB.City.buildings) || [];
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (Math.abs(x - b.x) < b.w / 2 + 2 && Math.abs(z - b.z) < b.d / 2 + 2) return true;
    }
    return false;
  }

  function updateAI(c, dt) {
    var stop = nearIntersection(c) && !lightGreen(c.axis);
    var target = stop ? 0 : c.cruise;
    c.speed += (target - c.speed) * Math.min(1, 1.5 * dt);
    if (c.speed < 0.05 && !stop) c.speed = 0;
    if (c.axis === "x") c.x += c.dir * c.speed * dt; else c.z += c.dir * c.speed * dt;
    var along = c.axis === "x" ? c.x : c.z;
    if (along > 165 || along < -165) {
      // Putar balik di ujung kota: ganti arah & lajur.
      c.dir *= -1;
      c.lane = pick(GRID);
      if (c.axis === "x") { c.x = Math.max(-160, Math.min(160, c.x)); c.z = c.lane; }
      else { c.z = Math.max(-160, Math.min(160, c.z)); c.x = c.lane; }
      c.yaw = c.axis === "x" ? (c.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (c.dir > 0 ? 0 : Math.PI);
    }
  }

  // --- DRIFT (baru v8) ---
  // Dipanggil tiap frame saat pemain menyetir. Drift dimulai hanya sekali per
  // penekanan Space: flag car.drifting + car._driftCounted mencegah spam.
  function updateDrift(car, k, dt) {
    var space = !!(k["Space"]);
    var turning = !!(k["KeyA"] || k["ArrowLeft"] || k["KeyD"] || k["ArrowRight"]);
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
          if (SB.HUD && SB.HUD.showMessage) SB.HUD.showMessage("Drift! +$50");
        }
      }
      return true; // sedang drift: handling licin
    }
    if (!space) { car.drifting = false; car._driftCounted = false; }
    else if (!turning || !fast) { car.drifting = false; }
    return car.drifting;
  }

  function updatePlayerCar(car, dt) {
    var k = keys();
    var fwd = (k["KeyW"] || k["ArrowUp"]) ? 1 : 0;
    var back = (k["KeyS"] || k["ArrowDown"]) ? 1 : 0;
    var left = (k["KeyA"] || k["ArrowLeft"]) ? 1 : 0;
    var right = (k["KeyD"] || k["ArrowRight"]) ? 1 : 0;
    var drifting = updateDrift(car, k, dt);
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
    if (!hitsBuilding(nx, nz) && nx > -166 && nx < 166 && nz > -166 && nz < 166) {
      car.x = nx; car.z = nz;
    } else {
      car.speed *= 0.3; // menabrak: melambat
      if (SB.Audio && SB.Audio.sfx) SB.Audio.sfx("crash");
    }
    if (SB.G && SB.G.player) {
      var p = SB.G.player;
      p.x = car.x; p.z = car.z; p.yaw = car.yaw; p.speed = Math.abs(car.speed);
      SB.G.dist += Math.abs(car.speed) * dt * 0.2;
    }
  }

  function update(dt) {
    _t += dt;
    var cars = SB.Vehicles.cars;
    for (var i = 0; i < cars.length; i++) {
      var c = cars[i];
      if (c.parked) continue;
      if (c.ai) updateAI(c, dt);
      else if (SB.G && SB.G.player && SB.G.player.inCar && SB.G.player.car === c) updatePlayerCar(c, dt);
    }
  }

  function nearestParked(x, z) {
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

  function nearestAny(x, z, maxD) {
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

  function stealNearest() {
    if (!SB.G || !SB.G.player) return null;
    var p = SB.G.player;
    if (p.inCar || p.inBoat) return null;
    var car = nearestAny(p.x, p.z, 6);
    if (!car) car = nearestParked(p.x, p.z);
    if (!car || Math.hypot(car.x - p.x, car.z - p.z) > 6) return null;
    if (SB.Game && SB.Game.wantedUp) SB.Game.wantedUp(1); // curi mobil → wanted +1
    enterCar(car);
    if (SB.HUD && SB.HUD.showMessage) SB.HUD.showMessage("Mobil dicuri! Wanted +1");
    return car;
  }

  function draw() {
    if (!SB.GL || !SB.GL.draw || !SB.Math3 || !SB.Meshes || !SB.Meshes.car) return;
    var M = SB.Math3;
    var cars = SB.Vehicles.cars;
    for (var i = 0; i < cars.length; i++) {
      var c = cars[i];
      var key = c.color.join(",");
      if (!_carMeshes[key]) {
        var m = SB.Meshes.car(c.color);
        _carMeshes[key] = SB.GL.mesh(m.pos, m.col);
      }
      var mat = M.mat4Mul(M.mat4Translate(c.x, 0.6, c.z), M.mat4RotateY(c.yaw));
      SB.GL.draw(_carMeshes[key], mat);
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
    nearestParked: nearestParked
  };
})();
