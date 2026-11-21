// vehicles.js — Kendaraan "Sunset Bay" v11
// Traffic AI (mobil lalu-lalang mengikuti jalan, berhenti di lampu,
// menghindar), mobil pemain (akselerasi, rem, drift +$50, respray -$150
// di garage), LOD (mobil jauh = siluet + 2 lampu depan), densitas lalu
// lintas mengikuti jam game (ramai pagi/sore, sepi dini hari, ramai di
// pantai saat sunset). Perahu di laut dirender lewat water.js (Water.draw).
// Modul logika murni; mesh diambil dari meshes.js bila tersedia.

(function (global) {
  'use strict';

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }

  const CAR_COLORS = [
    [0.8, 0.1, 0.1], [0.1, 0.2, 0.8], [0.9, 0.85, 0.2], [0.15, 0.15, 0.15],
    [0.9, 0.9, 0.9], [0.1, 0.6, 0.3], [0.85, 0.4, 0.1], [0.4, 0.2, 0.6],
  ];

  // ---------- lampu lalu lintas ----------
  class TrafficLight {
    constructor(x, z) {
      this.x = x; this.z = z;
      this.state = 'green'; // 'green' | 'yellow' | 'red'
      this.timer = rand(2, 6);
    }
    update(dt) {
      this.timer -= dt;
      if (this.timer <= 0) {
        if (this.state === 'green') { this.state = 'yellow'; this.timer = 2; }
        else if (this.state === 'yellow') { this.state = 'red'; this.timer = 5; }
        else { this.state = 'green'; this.timer = 6; }
      }
    }
  }

  // ---------- mobil ----------
  let carSeq = 0;
  class Car {
    constructor(opts) {
      const o = opts || {};
      this.id = 'car-' + (++carSeq);
      this.x = o.x || 0; this.z = o.z || 0;
      this.heading = o.heading || 0; // radian, 0 = -Z
      this.speed = 0;
      this.maxSpeed = o.maxSpeed || rand(9, 14);
      this.color = o.color || CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
      this.driver = null;      // Player bila dikendarai pemain
      this.ai = !!o.ai;        // traffic AI
      this.route = o.route || null; // {x1,z1,x2,z2} segmen jalan yang diikuti
      this.routeDir = 1;
      this.stopped = false;
      this.headlightsOn = false;
      this.highBeam = false;   // lampu jauh pemain
      this.flashTimer = 0;     // lampu lawan berkedip (lihat flashHeadlights)
      this.driftScore = 0;
      this.drifting = false;
      this.lod = 'full';       // 'full' | 'lod'
      this.stolen = false;
    }

    // --- kendali pemain: akselerasi, rem, drift ---
    // input: {forward, back, left, right, handbrake}
    drive(dt, input, world) {
      dt = Math.min(dt, 0.05);
      const accel = 12, brake = 22, maxReverse = 6;
      if (input.forward) this.speed += accel * dt;
      else if (input.back) {
        if (this.speed > 0.5) this.speed -= brake * dt; // rem
        else this.speed = Math.max(-maxReverse, this.speed - accel * 0.6 * dt);
      } else {
        // gesekan: melambat perlahan
        this.speed -= Math.sign(this.speed) * 4 * dt;
        if (Math.abs(this.speed) < 0.2) this.speed = 0;
      }
      this.speed = clamp(this.speed, -maxReverse, this.maxSpeed * 1.4);

      // Belok: makin cepat makin kecil sudut belok.
      const steer = (input.left ? 1 : 0) - (input.right ? 1 : 0);
      const steerFactor = clamp(Math.abs(this.speed) / 8, 0.2, 1);
      this.heading += steer * 1.9 * steerFactor * Math.sign(this.speed || 1) * dt;

      // Drift: handbrake + kecepatan tinggi + belok -> +$50 per drift.
      const wasDrifting = this.drifting;
      this.drifting = !!(input.handbrake && Math.abs(this.speed) > 9 && steer !== 0);
      if (this.drifting) {
        this.heading += steer * 1.2 * dt; // selip ekstra
        this.speed *= (1 - 0.25 * dt);
        if (!wasDrifting && world && world.onEvent) {
          this.driftScore += 50;
          world.onEvent('drift', { carId: this.id, reward: 50, x: this.x, z: this.z });
        }
      }

      // Maju searah heading: heading 0 = -Z, jadi arah = (sin h, -cos h).
      this.x += Math.sin(this.heading) * this.speed * dt;
      this.z += -Math.cos(this.heading) * this.speed * dt;
    }

    // --- AI lalu lintas ---
    aiUpdate(dt, world) {
      dt = Math.min(dt, 0.05);
      if (!this.route) return;
      // Lampu merah di depan -> berhenti.
      let wantStop = false;
      if (world && world.trafficLights) {
        for (const tl of world.trafficLights) {
          const d2 = dist2(this.x, this.z, tl.x, tl.z);
          if (d2 < 12 * 12 && tl.state !== 'green') {
            // Hanya berhenti bila lampu ada di depan arah jalan.
            const fx = Math.sin(this.heading), fz = -Math.cos(this.heading);
            const lx = tl.x - this.x, lz = tl.z - this.z;
            if (fx * lx + fz * lz > 0) { wantStop = true; break; }
          }
        }
      }
      // Menghindar: mobil di depan terlalu dekat -> melambat.
      if (world && world.cars) {
        for (const other of world.cars) {
          if (other === this) continue;
          const d2 = dist2(this.x, this.z, other.x, other.z);
          if (d2 < 7 * 7) {
            const fx = Math.sin(this.heading), fz = -Math.cos(this.heading);
            const ox = other.x - this.x, oz = other.z - this.z;
            if (fx * ox + fz * oz > 0) { wantStop = true; break; }
          }
        }
      }
      const target = wantStop ? 0 : this.maxSpeed;
      this.speed += clamp(target - this.speed, -10 * dt, 6 * dt);
      // Ikuti segmen jalan; balik arah di ujung.
      const tx = this.routeDir > 0 ? this.route.x2 : this.route.x1;
      const tz = this.routeDir > 0 ? this.route.z2 : this.route.z1;
      const dx = tx - this.x, dz = tz - this.z;
      const targetHeading = Math.atan2(dx, -dz);
      let dh = targetHeading - this.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      this.heading += clamp(dh, -1.4 * dt, 1.4 * dt);
      this.x += Math.sin(this.heading) * this.speed * dt;
      this.z += -Math.cos(this.heading) * this.speed * dt;
      if (dx * dx + dz * dz < 4) this.routeDir *= -1;
      this.stopped = wantStop;
    }

    // Lampu lawan berkedip bila pemain menyalakan lampu jauh.
    flashHeadlights(duration) {
      this.flashTimer = duration || 1.2;
    }
    updateFlash(dt) {
      if (this.flashTimer > 0) this.flashTimer -= dt;
    }
    get headlightsFlashing() { return this.flashTimer > 0; }

    // LOD: jauh dari kamera -> siluet + 2 lampu depan.
    updateLOD(camX, camZ) {
      const d2 = dist2(this.x, this.z, camX, camZ);
      this.lod = d2 > 90 * 90 ? 'lod' : 'full';
      return this.lod;
    }
  }

  // ---------- garage / respray ----------
  const RESPRAY_COST = 150;
  const DRIFT_REWARD = 50;
  function respray(car, newColor, player) {
    if (!car || !player) return { ok: false, reason: 'missing' };
    if (player.money < RESPRAY_COST) return { ok: false, reason: 'not-enough-money' };
    player.money -= RESPRAY_COST;
    car.color = newColor || CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
    car.stolen = false; // cat baru = mobil tak lagi dikenali sebagai curian
    return { ok: true, cost: RESPRAY_COST, color: car.color };
  }

  // ---------- manajer kendaraan ----------
  class VehicleManager {
    constructor(city) {
      this.city = city || null;
      this.cars = [];
      this.trafficLights = [];
      this.timeOfDay = 12;
      this._initLights();
    }

    _initLights() {
      // Lampu di persimpangan jalan utama.
      this.trafficLights.push(new TrafficLight(0, 10));
      this.trafficLights.push(new TrafficLight(0, -140));
      this.trafficLights.push(new TrafficLight(90, 10));
      this.trafficLights.push(new TrafficLight(-60, 10));
    }

    // Densitas lalu lintas mengikuti jam game:
    // ramai pagi (07-09) & sore (16-19), sepi dini hari (01-05),
    // ramai di pantai saat sunset (17-19).
    trafficDensity(hour) {
      const h = hour == null ? this.timeOfDay : hour;
      let d = 0.45;
      if (h >= 7 && h < 9) d = 1.0;
      else if (h >= 16 && h < 19) d = 0.95;
      else if (h >= 1 && h < 5) d = 0.12;
      else if (h >= 11 && h < 14) d = 0.7;
      else if (h >= 19 && h < 23) d = 0.55;
      return d;
    }

    targetCarCount(hour) {
      return Math.round(6 + this.trafficDensity(hour) * 22);
    }

    spawnTraffic(hour) {
      const target = this.targetCarCount(hour);
      const roads = this.city ? this.city.roads : [
        { x1: 0, z1: -200, x2: 0, z2: 200 },
        { x1: -180, z1: 10, x2: 180, z2: 10 },
      ];
      let guard = 0;
      while (this.cars.filter(c => c.ai).length < target && guard++ < 60) {
        const road = roads[Math.floor(Math.random() * roads.length)];
        const t = Math.random();
        const x = road.x1 + (road.x2 - road.x1) * t + rand(-2, 2);
        const z = road.z1 + (road.z2 - road.z1) * t + rand(-2, 2);
        const car = new Car({ x, z, ai: true, route: { x1: road.x1, z1: road.z1, x2: road.x2, z2: road.z2 } });
        car.heading = Math.atan2(road.x2 - road.x1, -(road.z2 - road.z1));
        car.headlightsOn = this.timeOfDay < 6 || this.timeOfDay >= 18.5;
        this.cars.push(car);
      }
      // Buang kelebihan saat sepi.
      while (this.cars.filter(c => c.ai).length > target) {
        const idx = this.cars.findIndex(c => c.ai && !c.driver);
        if (idx < 0) break;
        this.cars.splice(idx, 1);
      }
    }

    // Mobil di pantai saat sunset: tambah 4 mobil parkir di jalan pantai.
    sunsetBeachCars(hour) {
      if (hour < 17 || hour >= 19) return;
      const parked = this.cars.filter(c => c.ai && c.parkedBeach).length;
      for (let i = parked; i < 4; i++) {
        const car = new Car({ x: -60 + i * 30, z: -138, ai: false });
        car.parkedBeach = true;
        car.heading = 0;
        this.cars.push(car);
      }
    }

    nearestCar(x, z, maxDist) {
      let best = null, bestD = (maxDist || 4) * (maxDist || 4);
      for (const c of this.cars) {
        if (c.driver) continue;
        const d2 = dist2(x, z, c.x, c.z);
        if (d2 < bestD) { bestD = d2; best = c; }
      }
      return best;
    }

    // Pemain menyalakan lampu jauh -> mobil lawan di depan berkedip.
    playerHighBeam(playerCar) {
      if (!playerCar || !playerCar.highBeam) return;
      for (const c of this.cars) {
        if (c === playerCar || !c.ai) continue;
        const d2 = dist2(playerCar.x, playerCar.z, c.x, c.z);
        if (d2 < 30 * 30) {
          const fx = Math.sin(playerCar.heading), fz = -Math.cos(playerCar.heading);
          const ox = c.x - playerCar.x, oz = c.z - playerCar.z;
          if (fx * ox + fz * oz > 0) c.flashHeadlights(1.2);
        }
      }
    }

    update(dt, world) {
      const hour = world && world.timeOfDay != null ? world.timeOfDay : this.timeOfDay;
      this.timeOfDay = hour;
      for (const tl of this.trafficLights) tl.update(dt);
      const cam = (world && world.camera) || { x: 0, z: 0 };
      for (const car of this.cars) {
        car.updateFlash(dt);
        car.updateLOD(cam.x, cam.z);
        if (car.driver && car.driver.driveCar) car.driver.driveCar(dt, world);
        else if (car.ai) car.aiUpdate(dt, { cars: this.cars, trafficLights: this.trafficLights });
      }
      // Jaga jumlah traffic sesuai jam (cek tiap ~2 detik via akumulasi).
      this._spawnTimer = (this._spawnTimer || 0) + dt;
      if (this._spawnTimer > 2) {
        this._spawnTimer = 0;
        this.spawnTraffic(hour);
        this.sunsetBeachCars(hour);
      }
    }

    // Mesh untuk satu mobil (full atau LOD) — delegasi ke meshes.js bila ada.
    meshFor(car) {
      const M = global.SunsetMeshes;
      if (!M) return null;
      if (car.lod === 'lod') return M.createCarLodMesh(car.color);
      return M.createCarMesh(car.color, { headlightsOn: car.headlightsOn || car.headlightsFlashing });
    }
  }

  const api = { Car, TrafficLight, VehicleManager, respray, RESPRAY_COST, DRIFT_REWARD, CAR_COLORS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SunsetVehicles = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
