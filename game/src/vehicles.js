// Sunset Bay — vehicles module (v7, written fresh from SPEC)
// 14 AI traffic cars driving the road grid + 5 parked cars. The player
// can steal / enter / exit cars (E). AI cars pause briefly at crossings.
(function () {
  var SB = window.SB = window.SB || {};

  var COLORS = [0xd83a2e, 0x2e6fd8, 0xe8c832, 0xeeeeee, 0x222222, 0x3aa655,
    0xd86a1e, 0x7a4fd0, 0x9fb4c0, 0x5a2e1e, 0xc0c0c0, 0x1e8a8a];
  var MAX_SPEED = 30, AI_SPEED_MIN = 8, AI_SPEED_MAX = 14;
  var DRIFT_MIN_SPEED = 8, DRIFT_REWARD = 50, DRIFT_COOLDOWN = 2;
  var driftCd = 0; // cooldown antar bonus drift (detik) — anti spam

  var keys = {};
  if (typeof window !== "undefined") {
    window.addEventListener("keydown", function (e) { keys[e.key.toLowerCase()] = true; });
    window.addEventListener("keyup", function (e) { keys[e.key.toLowerCase()] = false; });
  }

  function pickRoad(rngRoads, axis) {
    var pool = [];
    var i;
    for (i = 0; i < rngRoads.length; i++) {
      if (!axis || rngRoads[i].axis === axis) pool.push(rngRoads[i]);
    }
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : rngRoads[0];
  }

  function carOnRoad(road) {
    var along = -260 + Math.random() * 520;
    var lane = (Math.random() < 0.5 ? -1 : 1) * 2;
    var dir = Math.random() < 0.5 ? 1 : -1;
    var c = {
      x: road.axis === "z" ? road.at + lane : along,
      z: road.axis === "z" ? along : road.at + lane,
      yaw: 0, speed: AI_SPEED_MIN + Math.random() * (AI_SPEED_MAX - AI_SPEED_MIN),
      road: road, dir: dir, lane: lane, stop: 0, stopCd: 4 + Math.random() * 6,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      ai: true, parked: false, driven: false, mesh: null
    };
    c.yaw = road.axis === "z" ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    return c;
  }

  function hitsBuilding(x, z) {
    var list = SB.City && SB.City.buildings;
    if (!list) return false;
    var i, b;
    for (i = 0; i < list.length; i++) {
      b = list[i];
      if (Math.abs(x - b.x) < b.w / 2 + 1.5 && Math.abs(z - b.z) < b.d / 2 + 1.5) return true;
    }
    return false;
  }

  var Vehicles = {
    cars: [],

    spawnTraffic: function () {
      var roads = (SB.City && SB.City.roads) || [];
      this.cars = [];
      var i;
      if (roads.length) {
        for (i = 0; i < 14; i++) this.cars.push(carOnRoad(pickRoad(roads)));
      }
      // 5 parked cars at curbside spots around the districts.
      var spots = [
        { x: -104, z: -40, yaw: 0 },            // Downtown edge
        { x: 20, z: 120, yaw: Math.PI / 2 },    // Old Town
        { x: -200, z: 120, yaw: 0 },            // Marina Bay
        { x: 100, z: -200, yaw: Math.PI / 2 },  // Uptown
        { x: 220, z: 200, yaw: 0 }              // Industrial
      ];
      for (i = 0; i < spots.length; i++) {
        this.cars.push({
          x: spots[i].x, z: spots[i].z, yaw: spots[i].yaw, speed: 0,
          road: null, dir: 0, lane: 0, stop: 0, stopCd: 0,
          color: COLORS[(i * 3 + 1) % COLORS.length],
          ai: false, parked: true, driven: false, mesh: null
        });
      }
    },

    nearestParked: function (x, z) {
      var best = null, bestD = 144; // within 12 units
      var i, c, d;
      for (i = 0; i < this.cars.length; i++) {
        c = this.cars[i];
        if (!c.parked) continue;
        d = (c.x - x) * (c.x - x) + (c.z - z) * (c.z - z);
        if (d < bestD) { bestD = d; best = c; }
      }
      return best;
    },

    // Take the closest car (parked or AI) within 6 units of the player.
    stealNearest: function () {
      var p = SB.G && SB.G.player;
      if (!p || p.inCar || p.inBoat) return null;
      var best = null, bestD = 36;
      var i, c, d;
      for (i = 0; i < this.cars.length; i++) {
        c = this.cars[i];
        if (c.driven) continue;
        d = (c.x - p.x) * (c.x - p.x) + (c.z - p.z) * (c.z - p.z);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (!best) return null;
      this.enterCar(best);
      return best;
    },

    enterCar: function (car) {
      var p = SB.G && SB.G.player;
      if (!p || !car) return;
      car.ai = false;
      car.parked = false;
      car.driven = true;
      car.speed = 0;
      p.inCar = true;
      p.inBoat = false;
      p.car = car;
      if (SB.HUD) SB.HUD.showMessage("Mengemudi — W gas, S rem, A/D belok, Space drift, E keluar");
    },

    exitCar: function () {
      var p = SB.G && SB.G.player;
      if (!p || !p.inCar || !p.car) return;
      var car = p.car;
      car.driven = false;
      car.parked = true;
      car.speed = 0;
      p.inCar = false;
      p.car = null;
      var spot = { x: car.x + 3, z: car.z + 2 };
      if (SB.City && SB.City.findClearSpot) spot = SB.City.findClearSpot(car.x + 3, car.z + 2, 1);
      p.x = spot.x; p.z = spot.z; p.speed = 0;
    },

    update: function (dt) {
      var p = SB.G && SB.G.player;
      var i, c;
      for (i = 0; i < this.cars.length; i++) {
        c = this.cars[i];
        if (c.driven) {
          // Player-driven car.
          if (keys["w"] || keys["arrowup"]) c.speed += 16 * dt;
          else if (keys["s"] || keys["arrowdown"]) c.speed -= 22 * dt;
          else c.speed -= Math.sign(c.speed) * 8 * dt;
          if (c.speed > MAX_SPEED) c.speed = MAX_SPEED;
          if (c.speed < -8) c.speed = -8;
          if (Math.abs(c.speed) < 0.2 && !keys["w"] && !keys["s"]) c.speed = 0;
          var steer = 0;
          if (keys["a"] || keys["arrowleft"]) steer += 1;
          if (keys["d"] || keys["arrowright"]) steer -= 1;
          // Drift: Space + belok (A/D) saat kecepatan > 8. Input drift
          // disinkron main.js ke G.input.drift (Space); keys[" "] cadangan.
          var driftHeld = (SB.G && SB.G.input && SB.G.input.drift) || keys[" "];
          var drifting = driftHeld && steer !== 0 && c.speed > DRIFT_MIN_SPEED;
          if (driftCd > 0) driftCd -= dt;
          if (drifting && driftCd <= 0) {
            driftCd = DRIFT_COOLDOWN;
            SB.G.money += DRIFT_REWARD;
            SB.G.drifts = (SB.G.drifts || 0) + 1;
            if (SB.HUD) SB.HUD.showMessage("Drift +$" + DRIFT_REWARD);
            if (SB.Audio) SB.Audio.sfx("pickup");
          }
          // Saat drift, mobil berbelok lebih tajam (rasa selip).
          c.yaw += steer * 1.9 * dt * Math.min(1, Math.abs(c.speed) / 10) * (drifting ? 1.6 : 1);
          var nx = c.x + Math.sin(c.yaw) * c.speed * dt;
          var nz = c.z + Math.cos(c.yaw) * c.speed * dt;
          if (!hitsBuilding(nx, nz) && nx > -278 && nx < 278 && nz > -278 && nz < 278) {
            c.x = nx; c.z = nz;
          } else {
            c.speed *= 0.3; // bumped into something
          }
          if (p) { p.x = c.x; p.z = c.z; p.yaw = c.yaw; p.speed = c.speed; }
          continue;
        }
        if (!c.ai || !c.road) continue;
        // AI traffic.
        if (c.stopCd > 0) c.stopCd -= dt;
        if (c.stop > 0) { c.stop -= dt; continue; }
        var step = c.speed * c.dir * dt;
        if (c.road.axis === "z") c.z += step; else c.x += step;
        var along = c.road.axis === "z" ? c.z : c.x;
        // Pause briefly at crossings (grid lines) sometimes.
        if (c.stopCd <= 0) {
          var near = Math.abs(((along + 28) % 56) - 28);
          if (near < 3 && Math.random() < 0.4) {
            c.stop = 1 + Math.random() * 1.5;
            c.stopCd = 6 + Math.random() * 6;
          }
        }
        // End of the road: turn onto a crossing road at this intersection.
        if (along > 276 || along < -276) {
          var cross = pickRoad(SB.City.roads, c.road.axis === "z" ? "x" : "z");
          var at = Math.max(-280, Math.min(280, Math.round(along / 56) * 56));
          if (c.road.axis === "z") { c.z = at; c.road = cross; c.x = cross.at + c.lane; }
          else { c.x = at; c.road = cross; c.z = cross.at + c.lane; }
          c.dir = Math.random() < 0.5 ? 1 : -1;
          c.yaw = c.road.axis === "z" ? (c.dir > 0 ? 0 : Math.PI) : (c.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
        }
      }
    },

    draw: function () {
      if (!SB.GL || !SB.GL.draw || !SB.Meshes || !SB.Meshes.car) return;
      var i, c, m;
      for (i = 0; i < this.cars.length; i++) {
        c = this.cars[i];
        if (!c.mesh) c.mesh = SB.Meshes.car(c.color);
        m = SB.Math3.mat4Mul(
          // Mesh mobil beralas di y~0 (BUKAN berpusat) — tanpa offset 0.7.
          SB.Math3.mat4Translate(c.x, 0, c.z),
          SB.Math3.mat4RotateY(c.yaw)
        );
        SB.GL.draw(c.mesh, m);
      }
    }
  };

  SB.Vehicles = Vehicles;
})();
