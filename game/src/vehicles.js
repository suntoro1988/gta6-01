// Sunset Bay — SB.Vehicles
// 42 mobil kota: spawn per distrik, curi dengan E, nyetir WASD + Space rem,
// respray (biaya SB.Config.RESPRAY_COST = 150).
// Komunikasi antar modul HANYA lewat namespace SB (design spec §4).

window.SB = window.SB || {};

(function () {
  "use strict";

  // Pusat distrik — SAMA PERSIS dengan design spec §3.
  var DISTRICTS = [
    { name: "Marina Bay", x: 0, z: 0, r: 120 },
    { name: "Old Town", x: -120, z: 40, r: 90 },
    { name: "Fisherman's Wharf", x: -185, z: 40, r: 55 },
    { name: "Sunset Strip", x: 120, z: -60, r: 100 },
    { name: "North Hills", x: 60, z: 180, r: 110 },
    { name: "East Market", x: 200, z: 80, r: 90 },
    { name: "Harbor Point", x: -220, z: -80, r: 80 },
    { name: "Palm Court", x: 40, z: -180, r: 90 },
    { name: "Coral District", x: -60, z: -140, r: 80 },
    { name: "Beacon Hill", x: 180, z: 180, r: 100 },
    { name: "Little Havana", x: -160, z: 160, r: 90 },
    { name: "Airport South", x: 260, z: -160, r: 110 },
    { name: "University Row", x: -40, z: 220, r: 90 },
    { name: "Industrial Docks", x: 240, z: 20, r: 100 }
  ];

  var MODELS = [
    { name: "Comet", maxSpeed: 34, accel: 16, grip: 1.0 },
    { name: "Sunrise", maxSpeed: 28, accel: 13, grip: 1.05 },
    { name: "Paleto", maxSpeed: 26, accel: 12, grip: 1.1 },
    { name: "Viceroy", maxSpeed: 30, accel: 14, grip: 1.0 },
    { name: "Banshee", maxSpeed: 38, accel: 18, grip: 0.95 },
    { name: "Tropic", maxSpeed: 24, accel: 11, grip: 1.15 }
  ];

  // Palette warna mobil (RGB 0..1).
  var PAINT = [
    [0.85, 0.15, 0.2], [0.15, 0.3, 0.85], [0.9, 0.75, 0.15],
    [0.1, 0.7, 0.3], [0.95, 0.95, 0.95], [0.1, 0.1, 0.12],
    [0.85, 0.4, 0.05], [0.5, 0.15, 0.6], [0.2, 0.75, 0.8],
    [0.75, 0.75, 0.8], [0.9, 0.2, 0.5], [0.3, 0.3, 0.35]
  ];

  var STEAL_RADIUS = 4.5;
  var MAX_CARS = 60;

  function config() {
    return (window.SB && window.SB.Config) || {};
  }

  function resprayCost() {
    var c = config();
    if (typeof c.RESPRAY_COST === "number") return c.RESPRAY_COST;
    return 150;
  }

  function clamp(v, lo, hi) {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  function rand(lo, hi) {
    return lo + Math.random() * (hi - lo);
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function dist2(ax, az, bx, bz) {
    var dx = ax - bx;
    var dz = az - bz;
    return Math.sqrt(dx * dx + dz * dz);
  }

  function districtCenter(name) {
    // Utamakan data resmi dari SB.Config / SB.City bila tersedia.
    var src = null;
    var c = config();
    if (c.DISTRICTS) src = c.DISTRICTS;
    else if (window.SB && window.SB.City && window.SB.City.DISTRICTS) src = window.SB.City.DISTRICTS;
    if (src) {
      if (Array.isArray(src)) {
        for (var i = 0; i < src.length; i++) {
          if (src[i].name === name) return { x: src[i].x, z: src[i].z, r: src[i].r || src[i].radius || 80 };
          if (src[i].x != null && src[i].center) return null;
        }
      } else if (src[name]) {
        var d = src[name];
        return { x: d.x, z: d.z, r: d.r || d.radius || 80 };
      }
    }
    for (var j = 0; j < DISTRICTS.length; j++) {
      if (DISTRICTS[j].name === name) return DISTRICTS[j];
    }
    return DISTRICTS[0];
  }

  function keyDown(input, key) {
    if (!input) return false;
    if (input.keys) {
      if (typeof input.keys.has === "function") return input.keys.has(key);
      if (Array.isArray(input.keys)) return input.keys.indexOf(key) !== -1;
    }
    if (input[key]) return true;
    return false;
  }

  function collideAt(x, z) {
    var City = window.SB && window.SB.City;
    if (!City || typeof City.collide !== "function") return false;
    try {
      var r = City.collide({ x: x, y: 0, z: z }, 1.4);
      return !!r;
    } catch (e) {
      return false;
    }
  }

  function isRaining() {
    if (window.SB && window.SB.Weather && window.SB.Weather.current === "rain") return true;
    if (window.SB && window.SB.Game && window.SB.Game.state &&
        window.SB.Game.state.weather === "rain") return true;
    return false;
  }

  function sfx(name) {
    if (window.SB && window.SB.Audio && typeof window.SB.Audio.sfx === "function") {
      try { window.SB.Audio.sfx(name); } catch (e) { /* abaikan */ }
    }
  }

  function fxParticles(pos, color, n) {
    if (window.SB && window.SB.FX && typeof window.SB.FX.spawnParticles === "function") {
      try { window.SB.FX.spawnParticles(pos, color, n); } catch (e) { /* abaikan */ }
    }
  }

  var nextId = 1;

  var Vehicles = {
    CARS: [],
    STEAL_RADIUS: STEAL_RADIUS,
    _ePrev: false,
    _fPrev: false,

    spawnCar: function (district) {
      var center = districtCenter(district || pick(DISTRICTS).name);
      var model = pick(MODELS);
      var car = {
        id: "car-" + (nextId++),
        kind: "car",
        model: model.name,
        pos: {
          x: center.x + rand(-center.r * 0.6, center.r * 0.6),
          y: 0,
          z: center.z + rand(-center.r * 0.6, center.r * 0.6)
        },
        rotY: rand(0, Math.PI * 2),
        vel: { x: 0, y: 0, z: 0 },
        speed: 0,
        color: pick(PAINT).slice(),
        stolen: false,
        driver: null,
        district: center.name,
        maxSpeed: model.maxSpeed,
        accel: model.accel,
        grip: model.grip,
        health: 100
      };
      // Jangan spawn di dalam bangunan: geser sampai titik bebas.
      var tries = 0;
      while (collideAt(car.pos.x, car.pos.z) && tries < 12) {
        car.pos.x = center.x + rand(-center.r * 0.7, center.r * 0.7);
        car.pos.z = center.z + rand(-center.r * 0.7, center.r * 0.7);
        tries++;
      }
      this.CARS.push(car);
      // Batasi jumlah mobil: buang mobil parkir tertua yang bukan milik pemain.
      while (this.CARS.length > MAX_CARS) {
        var removed = false;
        for (var i = 0; i < this.CARS.length; i++) {
          if (!this.CARS[i].driver && !this.CARS[i].stolen) {
            this.CARS.splice(i, 1);
            removed = true;
            break;
          }
        }
        if (!removed) break;
      }
      return car;
    },

    nearestCar: function (pos) {
      if (!pos) return null;
      var best = null;
      var bestD = Infinity;
      for (var i = 0; i < this.CARS.length; i++) {
        var car = this.CARS[i];
        if (car.driver) continue; // mobil yang sudah ada pengemudinya tidak bisa dicuri
        var d = dist2(pos.x, pos.z, car.pos.x, car.pos.z);
        if (d < bestD) { bestD = d; best = car; }
      }
      if (!best) return null;
      return { car: best, dist: bestD };
    },

    // Curi mobil terdekat (tombol E). Mengembalikan mobil atau null.
    stealNearest: function () {
      var P = window.SB && window.SB.Player;
      if (!P || !P.pos || !P.onFoot) return null;
      var found = this.nearestCar(P.pos);
      if (!found || found.dist > STEAL_RADIUS) return null;
      var car = found.car;
      car.stolen = true;
      car.driver = "player";
      var G = window.SB && window.SB.Game;
      if (G && G.state) {
        G.state.stats.carsStolen = (G.state.stats.carsStolen || 0) + 1;
        // Pencurian mobil selalu terlihat seseorang di jalanan Sunset Bay:
        // wanted naik 1 bintang. Bila polisi dekat, heat langsung tinggi.
        if (typeof G.raiseWanted === "function") {
          try { G.raiseWanted(1); } catch (e) { /* abaikan */ }
        } else if (typeof G.setWanted === "function") {
          try { G.setWanted((G.state.wanted || 0) + 1); } catch (e) { /* abaikan */ }
        }
        if (this._policeNear(car.pos, 80)) {
          G.state.heat = Math.max(G.state.heat || 0, 70);
        }
      }
      if (typeof P.enterVehicle === "function") P.enterVehicle(car);
      sfx("engine");
      fxParticles(car.pos, [1, 0.8, 0.2], 10);
      return car;
    },

    _policeNear: function (pos, radius) {
      var Police = window.SB && window.SB.Police;
      if (!Police || !Police.COP_CARS) return false;
      for (var i = 0; i < Police.COP_CARS.length; i++) {
        var cop = Police.COP_CARS[i];
        if (cop && cop.pos && dist2(pos.x, pos.z, cop.pos.x, cop.pos.z) <= radius) return true;
      }
      return false;
    },

    // Mengemudi: W gas, S rem/mundur, A/D belok, Space rem tangan.
    drive: function (car, input, dt) {
      if (!car) return;
      if (!dt || dt <= 0) dt = 0.016;
      if (dt > 0.25) dt = 0.25;

      var rain = isRaining();
      var grip = car.grip * (rain ? 0.62 : 1.0);
      var maxSpeed = car.maxSpeed * (rain ? 0.82 : 1.0);
      var maxReverse = 10;

      var throttle = 0;
      if (keyDown(input, "KeyW") || keyDown(input, "ArrowUp")) throttle = 1;
      if (keyDown(input, "KeyS") || keyDown(input, "ArrowDown")) throttle = -1;

      var steering = 0;
      if (keyDown(input, "KeyA") || keyDown(input, "ArrowLeft")) steering = 1;
      if (keyDown(input, "KeyD") || keyDown(input, "ArrowRight")) steering = -1;

      var handbrake = keyDown(input, "Space");

      // Akselerasi / pengereman.
      if (throttle > 0) {
        car.speed += car.accel * grip * dt;
      } else if (throttle < 0) {
        if (car.speed > 0.5) car.speed -= 26 * dt; // rem
        else car.speed -= car.accel * 0.55 * dt; // mundur
      } else {
        // Meluncur: gesekan jalan + hambatan udara.
        var drag = 2.2 * dt + Math.abs(car.speed) * 0.02 * dt;
        if (car.speed > 0) car.speed = Math.max(0, car.speed - drag * 4);
        else if (car.speed < 0) car.speed = Math.min(0, car.speed + drag * 4);
      }
      if (handbrake) {
        car.speed *= Math.max(0, 1 - 3.2 * dt);
        if (Math.abs(car.speed) < 0.3) car.speed = 0;
      }
      car.speed = clamp(car.speed, -maxReverse, maxSpeed);

      // Belok: makin cepat makin lebar, mundur membalik arah belok.
      var speedFactor = clamp(Math.abs(car.speed) / 12, 0, 1);
      var turnRate = 2.1 * grip * speedFactor;
      if (car.speed < 0) turnRate = -turnRate;
      car.rotY += steering * turnRate * dt;

      // Gerak maju sesuai arah mobil.
      var nx = car.pos.x + Math.sin(car.rotY) * car.speed * dt;
      var nz = car.pos.z + Math.cos(car.rotY) * car.speed * dt;

      // Tabrakan dengan bangunan: pantul pelan + bunyi + rusak sedikit.
      if (Math.abs(car.speed) > 0.5 && collideAt(nx, nz)) {
        if (Math.abs(car.speed) > 12) {
          sfx("crash");
          fxParticles({ x: nx, y: 1, z: nz }, [1, 0.6, 0.1], 14);
          car.health = clamp((car.health || 100) - 8, 0, 100);
          var G = window.SB && window.SB.Game;
          if (G && typeof G.damagePlayer === "function" && Math.abs(car.speed) > 20) {
            try { G.damagePlayer(5); } catch (e) { /* abaikan */ }
          }
        }
        car.speed *= -0.25;
        nx = car.pos.x;
        nz = car.pos.z;
      }

      car.pos.x = nx;
      car.pos.z = nz;
      // Batas dunia.
      car.pos.x = clamp(car.pos.x, -590, 590);
      car.pos.z = clamp(car.pos.z, -590, 590);
      car.vel.x = Math.sin(car.rotY) * car.speed;
      car.vel.z = Math.cos(car.rotY) * car.speed;

      // Sinkronkan pemain & HUD game dengan mobil.
      var P = window.SB && window.SB.Player;
      if (P && !P.onFoot && P.vehicleId === car.id) {
        P.pos.x = car.pos.x; P.pos.y = car.pos.y; P.pos.z = car.pos.z;
        P.rotY = car.rotY;
      }
      var GS = window.SB && window.SB.Game;
      if (GS && GS.state) {
        GS.state.player.speed = Math.abs(car.speed);
        GS.state.player.pos.x = car.pos.x;
        GS.state.player.pos.y = car.pos.y;
        GS.state.player.pos.z = car.pos.z;
        GS.state.player.rotY = car.rotY;
      }
    },

    // Cat ulang mobil: ganti warna + kurangi cash sebesar RESPRAY_COST.
    respray: function (car) {
      if (!car) return false;
      var cost = resprayCost();
      var paid = false;
      var E = window.SB && window.SB.Economy;
      var G = window.SB && window.SB.Game;
      if (E && typeof E.spend === "function") {
        try { paid = E.spend(cost) !== false; } catch (e) { paid = false; }
        // SB.Economy.spend yang tidak mengembalikan nilai dianggap berhasil
        // bila kas game masih cukup — verifikasi lewat saldo game.
        if (paid && G && G.state && G.state.cash < 0) paid = false;
      }
      if (!paid && G && typeof G.spendCash === "function") {
        try { paid = G.spendCash(cost); } catch (e) { paid = false; }
      }
      if (!paid && G && G.state) {
        if (G.state.cash >= cost) {
          G.state.cash -= cost;
          paid = true;
        }
      }
      if (!paid) return false;
      // Warna baru, dijamin berbeda dari warna lama.
      var oldColor = car.color;
      var next = pick(PAINT).slice();
      var guard = 0;
      while (oldColor && next[0] === oldColor[0] && next[1] === oldColor[1] &&
             next[2] === oldColor[2] && guard < 10) {
        next = pick(PAINT).slice();
        guard++;
      }
      car.color = next;
      car.resprayed = true;
      if (window.SB && window.SB.Police && typeof window.SB.Police.clearWantedAfterRespray === "function") {
        try { window.SB.Police.clearWantedAfterRespray(); } catch (e) { /* abaikan */ }
      }
      if (G && G.state) {
        G.state.stats.carsResprayed = (G.state.stats.carsResprayed || 0) + 1;
      }
      sfx("pickup");
      fxParticles(car.pos, next, 16);
      return true;
    },

    // Dipanggil tiap frame dari SB.Game.update.
    update: function (dt, input) {
      if (!dt || dt <= 0) dt = 0.016;
      var P = window.SB && window.SB.Player;

      // E/F dimiliki SB.Main.handleActionKeys (E = curi/keluar mobil,
      // F = interaksi, sesuai spec §3 + How to Play). Bila update() ini
      // juga menangani E, sekali tekan E mencuri lalu langsung keluar
      // lagi di frame yang sama — jadi JANGAN tangani tombol di sini.
      // Mobil yang dikendarai pemain bergerak lewat drive().
      if (P && !P.onFoot && P.vehicleId) {
        var car = null;
        for (var i = 0; i < this.CARS.length; i++) {
          if (this.CARS[i].id === P.vehicleId) { car = this.CARS[i]; break; }
        }
        if (car) this.drive(car, input, dt);
      }
    },

    count: function () {
      return this.CARS.length;
    },

    byId: function (id) {
      for (var i = 0; i < this.CARS.length; i++) {
        if (this.CARS[i].id === id) return this.CARS[i];
      }
      return null;
    }
  };

  // Isi awal: 42 mobil, 3 per distrik (14 distrik).
  for (var d = 0; d < DISTRICTS.length; d++) {
    for (var k = 0; k < 3; k++) {
      Vehicles.spawnCar(DISTRICTS[d].name);
    }
  }

  window.SB.Vehicles = Vehicles;
})();
