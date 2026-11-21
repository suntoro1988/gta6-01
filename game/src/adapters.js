// adapters.js — Sunset Bay v11 (Integrator: wiring modul asli ke game.js)
//
// MASALAH YANG DIPERBAIKI: modul city/player/vehicles/water/meshes adalah
// script IIFE yang mendaftarkan diri di globalThis.Sunset* TANPA export ES,
// sementara audio/hud/jobs/shots mengekspor class ES. game.js memanggil
// modul lewat duck-typing (mod.init/update/render/getState/...), jadi
// namespace mentah hasil dynamic import TIDAK PERNAH cocok — semua panggilan
// callModule() diam-diam no-op dan game jatuh ke scene fallback prosedural.
// File ini membangun ADAPTER per modul yang menerjemahkan kontrak game.js
// ke API asli tiap modul, sehingga kota 222 gedung, air + perahu, player,
// kendaraan, misi 18/49, audio 5 stasiun, HUD, dan shooting BENAR-BENAR
// dipakai — bukan fallback.
//
// Dipakai dari main.js: setelah semua modul dimuat dinamis,
//   import { buildAdapters } from './adapters.js'
//   const modules = buildAdapters(rawModules);
// lalu `modules` itu yang diberikan ke `new Game(...)`.
//
// Koordinat: modul city/water/jobs memakai frame "laut di utara"
// (garis pantai z = -168, laut z < -168). Adapter kota menggambar tanah
// hanya sampai z = -160; adapter air menggambar laut z -360..-160.

import * as M from './math3.js';
import { geoBox, geoPlane, geoQuad, geoCylinder } from './gl.js';

const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
const colorKey = (c) => (c || [0.5, 0.5, 0.5]).map((v) => v.toFixed(2)).join(',');

// =====================================================================
// CITY — Kota asli 222 gedung / 10 distrik + pejalan kaki.
// =====================================================================
function makeCityAdapter() {
  const api = globalThis.SunsetCity;
  let city = null;
  let built = null; // mesh yang sudah dikompilasi renderer
  const npcs = [];
  const npcMeshCache = new Map();

  function buildMeshes(r) {
    const b = {};
    b.ground = r.createMesh(geoPlane(760, 540, [0.58, 0.62, 0.50]));
    b.beach = r.createMesh(geoPlane(340, 55, [0.93, 0.85, 0.66]));
    b.roads = city.roads.map((road) => {
      const dx = road.x2 - road.x1, dz = road.z2 - road.z1;
      const len = Math.hypot(dx, dz) || 1;
      return {
        mesh: r.createMesh(geoPlane(road.width, len, [0.16, 0.16, 0.20])),
        pos: { x: (road.x1 + road.x2) / 2, y: 0.02, z: (road.z1 + road.z2) / 2 },
        yaw: Math.atan2(dx, dz),
      };
    });
    // Gedung digabung ke SATU mesh (MeshBuilder): 222 draw call per pass
    // jadi 1 — di SwiftShader 444 draw call gedung adalah bottleneck utama.
    const mb = new globalThis.SunsetMeshes.MeshBuilder();
    for (const bd of city.buildings) {
      mb.box(bd.x, bd.h / 2, bd.z, bd.w, bd.h, bd.d, bd.color);
      const roof = [Math.min(bd.color[0] + 0.12, 1), Math.min(bd.color[1] + 0.12, 1), Math.min(bd.color[2] + 0.12, 1)];
      mb.box(bd.x, bd.h + 0.15, bd.z, bd.w * 0.92, 0.3, bd.d * 0.92, roof);
    }
    b.buildingsMesh = r.createMesh(mb.build());
    // Jendela emissive (instanced) di fasad depan tiap gedung.
    const winList = [];
    for (const bd of city.buildings) {
      const rows = Math.max(1, Math.floor(bd.h / 6));
      for (let row = 0; row < rows; row++) {
        for (let c = 0; c < 3; c++) {
          winList.push({
            offset: { x: bd.x - bd.w / 2 + (c + 0.5) * (bd.w / 3), y: 3 + row * 5, z: bd.z + bd.d / 2 + 0.06 },
            scale: 1, rotY: 0, color: [1, 1, 1],
          });
        }
      }
    }
    const winMesh = r.createMesh(geoBox(1.8, 2.2, 0.15, [1, 1, 1]));
    b.windows = r.createInstancedMesh(winMesh, Math.max(1, winList.length));
    r.setInstances(b.windows, winList);
    // Palma (instanced): batang + tajuk.
    const palmList = city.palms.map((p) => ({ offset: { x: p.x, y: (p.h / 2), z: p.z }, scale: p.h / 6.8, rotY: 0, color: [0.55, 0.38, 0.22] }));
    const topList = city.palms.map((p) => ({ offset: { x: p.x, y: p.h, z: p.z }, scale: p.h / 6.8, rotY: 0, color: [0.25, 0.62, 0.30] }));
    b.palms = r.createInstancedMesh(r.createMesh(geoCylinder(0.22, 0.35, 6.8, [0.55, 0.38, 0.22], 7)), Math.max(1, palmList.length));
    r.setInstances(b.palms, palmList);
    b.palmTops = r.createInstancedMesh(r.createMesh(geoBox(4.6, 0.9, 4.6, [0.25, 0.62, 0.30])), Math.max(1, topList.length));
    r.setInstances(b.palmTops, topList);
    // Lampu jalan (instanced): tiang + bohlam.
    const lampList = city.lamps.map((l) => ({ offset: { x: l.x, y: 2.6, z: l.z }, scale: 1, rotY: 0, color: [0.25, 0.25, 0.30] }));
    const bulbList = city.lamps.map((l) => ({ offset: { x: l.x, y: 5.3, z: l.z }, scale: 1, rotY: 0, color: [1, 0.9, 0.6] }));
    b.lamps = r.createInstancedMesh(r.createMesh(geoCylinder(0.09, 0.12, 5.2, [0.25, 0.25, 0.30], 6)), Math.max(1, lampList.length));
    r.setInstances(b.lamps, lampList);
    b.bulbs = r.createInstancedMesh(r.createMesh(geoBox(0.5, 0.3, 0.5, [1, 0.9, 0.6])), Math.max(1, bulbList.length));
    r.setInstances(b.bulbs, bulbList);
    // Dermaga kayu.
    b.pier = r.createMesh(geoBox(6, 1, 60, [0.5, 0.38, 0.25]));
    b.pierPos = { x: -20, y: 0.5, z: -198 };
    return b;
  }

  function npcMesh(r, shirt) {
    const key = colorKey(shirt);
    if (!npcMeshCache.has(key)) {
      npcMeshCache.set(key, r.createMesh(globalThis.SunsetMeshes.createPedestrianMesh(shirt)));
    }
    return npcMeshCache.get(key);
  }

  return {
    get city() { return city; },
    get npcs() { return npcs; },
    buildingCount() { return city ? city.buildings.length : 0; },
    districtAt(x, z) { return city ? city.districtAt(x, z) : null; },
    interiorAt(x, z, rad) { return city ? city.interiorAt(x, z, rad) : null; },

    init(ctx) {
      if (!api) throw new Error('SunsetCity tidak terdaftar (city.js gagal dimuat)');
      city = new api.City(20261121);
      city.attachRenderer(ctx.renderer);
      built = buildMeshes(ctx.renderer);
      // Pejalan kaki: 24 orang jalan santai di area kota.
      const shirts = [[0.9, 0.3, 0.3], [0.3, 0.6, 0.9], [0.9, 0.8, 0.3], [0.5, 0.85, 0.5], [0.85, 0.5, 0.9], [0.95, 0.6, 0.3]];
      for (let i = 0; i < 24; i++) {
        npcs.push({
          x: -200 + Math.random() * 400, z: -140 + Math.random() * 300,
          heading: Math.random() * Math.PI * 2, speed: 1 + Math.random() * 1.2,
          shirt: shirts[i % shirts.length],
        });
      }
    },

    update(dt, ctx) {
      if (!city) return;
      const hour = ctx.env ? ctx.env.hour : 18.33;
      city.setTimeOfDay(hour);
      city.updateKioskQueues(hour);
      for (const n of npcs) {
        n.x += Math.sin(n.heading) * n.speed * dt;
        n.z += -Math.cos(n.heading) * n.speed * dt;
        if (Math.abs(n.x) > 300 || Math.abs(n.z) > 300 || Math.abs(n.x) < -300) n.heading += Math.PI * 0.9;
        if (Math.random() < 0.002) n.heading += (Math.random() - 0.5) * 1.5;
      }
    },

    render(ctx) {
      if (!city || !built) return;
      const r = ctx.renderer;
      const emissive = ctx.env ? ctx.env.emissive : 0.5;
      const shadow = ctx.mode === 'shadow';
      r.drawMesh(built.ground, M.m4FromTRS({ x: 0, y: 0, z: 110 }), { color: [1, 1, 1], specular: 0.05 });
      r.drawMesh(built.beach, M.m4FromTRS({ x: 0, y: 0.08, z: -175 }), { specular: 0.08 });
      for (const road of built.roads) {
        r.drawMesh(road.mesh, M.m4FromTRS(road.pos, road.yaw), { specular: 0.35, shininess: 40 });
      }
      r.drawMesh(built.buildingsMesh, M.m4Identity(), { specular: 0.12 });
      if (!shadow) {
        if (built.windows && built.windows.count > 0) {
          r.drawInstanced(built.windows, built.windows.count, M.m4Identity(), {
            emissive: [1, 0.75, 0.35], emissiveStrength: emissive * 1.4, specular: 0,
          });
        }
        if (built.bulbs) {
          r.drawInstanced(built.bulbs, built.bulbs.count, M.m4Identity(), {
            emissive: [1, 0.85, 0.5], emissiveStrength: emissive * 1.6, specular: 0,
          });
        }
      }
      if (built.palms) r.drawInstanced(built.palms, built.palms.count, M.m4Identity(), { specular: 0.05 });
      if (built.palmTops) r.drawInstanced(built.palmTops, built.palmTops.count, M.m4Identity(), { specular: 0.05 });
      if (built.lamps) r.drawInstanced(built.lamps, built.lamps.count, M.m4Identity(), { specular: 0.1 });
      r.drawMesh(built.pier, M.m4FromTRS(built.pierPos), { specular: 0.2 });
      for (const n of npcs) {
        r.drawMesh(npcMesh(r, n.shirt), M.m4FromTRS({ x: n.x, y: 0, z: n.z }, n.heading), { specular: 0.1 });
        if (!shadow) r.drawBlobShadow(n.x, 0, n.z, 0.9, 0.25);
      }
    },
  };
}

// =====================================================================
// WATER — Laut + perahu + 8 event ambient. Water.draw tiap frame.
// Renderer gl.js TIDAK punya drawWater, jadi adapter memasang shim.
// =====================================================================
function makeWaterAdapter(registry) {
  const api = globalThis.SunsetWater;
  let water = null;
  let ambient = null;
  let waterMesh = null;
  const boatMeshCache = new Map();

  function boatMesh(r, color) {
    const key = colorKey(color);
    if (!boatMeshCache.has(key)) {
      boatMeshCache.set(key, r.createMesh(globalThis.SunsetMeshes.createBoatMesh(color)));
    }
    return boatMeshCache.get(key);
  }

  return {
    get water() { return water; },
    get ambient() { return ambient; },
    get drawCalls() { return water ? water.drawCalls : 0; },
    getAmbientStatus() {
      if (!ambient) return { active: [], count: 0 };
      return { active: ambient.activeEvents().map((e) => ({ id: e.id, kind: e.kind, x: e.x, z: e.z })), count: ambient.activeCount };
    },
    nearestBoat(x, z, d) { return water ? water.nearestBoat(x, z, d) : null; },
    nearestShore(x, z) { return water ? water.nearestShore(x, z) : { x: 0, z: -166 }; },
    exitBoat(boat, player) { return water ? water.exitBoat(boat, player) : { ok: false }; },

    init(ctx) {
      if (!api) throw new Error('SunsetWater tidak terdaftar (water.js gagal dimuat)');
      water = new api.Water();
      water.attachRenderer(ctx.renderer);
      ambient = new api.AmbientEvents();
      // Shim drawWater: renderer gl.js tidak menyediakannya, dan fallback
      // draw() di water.js memanggil drawMesh dengan objek biasa (bukan
      // matriks) sehingga akan throw. Shim ini yang menggambar laut+perahu.
      const r = ctx.renderer;
      if (!r.drawWater) {
        waterMesh = r.createMesh(geoPlane(560, 200, [0.10, 0.35, 0.55]));
        r.drawWater = (state) => {
          r.drawMesh(waterMesh, M.m4FromTRS({ x: 0, y: 0.05, z: -260 }), {
            specular: 0.9, shininess: 90, emissive: [0.05, 0.12, 0.20], emissiveStrength: 0.25,
          });
          for (const b of state.boats || []) {
            r.drawMesh(boatMesh(r, b.color), M.m4FromTRS({ x: b.x, y: b.y || 0, z: b.z }, (b.heading || 0) + Math.PI), { specular: 0.6, shininess: 60 });
          }
        };
      }
    },

    update(dt, ctx) {
      if (!water || !ambient) return;
      const game = ctx.game;
      const city = registry.city ? registry.city.city : null;
      ambient.update(dt, {
        player: { x: game.player.pos.x, z: game.player.pos.z },
        city,
        timeOfDay: game.timeOfDay,
        onEvent: (type, data) => {
          if (type === 'ambient-start' && data) {
            const def = (api.AMBIENT_DEFS || []).find((d) => d.id === data.id);
            if (def && (def.kind === 'loud' || def.kind === 'weather')) game.showToast(def.desc);
          }
        },
      });
    },

    render(ctx) {
      // Hanya pass warna: air + perahu tidak perlu masuk shadow map.
      if (!water || ctx.mode === 'shadow') return;
      water.draw({ dt: ctx.dt || 0.016 });
    },
  };
}

// =====================================================================
// PLAYER — Modul Player asli (gerak, stamina, curi mobil, perahu,
// wanted, ganti baju). game.js adalah sumber kebenaran untuk uang /
// wanted / HP; adapter menyinkronkan sebelum & sesudah update.
// =====================================================================
function makePlayerAdapter(registry) {
  const api = globalThis.SunsetPlayer;
  let player = null;
  let game = null;
  let world = null;

  return {
    get player() { return player; },
    get world() { return world; },

    init(ctx) {
      if (!api) throw new Error('SunsetPlayer tidak terdaftar (player.js gagal dimuat)');
      game = ctx.game;
      player = new api.Player({ x: 0, z: 40 });
      player.yaw = Math.PI; // menghadap +Z (menjauhi kamera awal)
      // Kendali mobil: VehicleManager memanggil driver.driveCar(dt, world).
      player.driveCar = (dt, w) => {
        const car = player.inVehicle;
        if (!car) return;
        const keys = game.input ? game.input.keys : new Set();
        car.drive(dt, {
          forward: keys.has('KeyW') || keys.has('ArrowUp'),
          back: keys.has('KeyS') || keys.has('ArrowDown'),
          left: keys.has('KeyA') || keys.has('ArrowLeft'),
          right: keys.has('KeyD') || keys.has('ArrowRight'),
          handbrake: keys.has('Space'),
        }, w);
      };
    },

    update(dt, ctx) {
      if (!player) return;
      // Game sumber kebenaran untuk uang/wanted/HP/stamina.
      player.money = game.player.money;
      player.wanted = game.player.wanted;
      player.health = game.player.health;
      player.stamina = game.player.stamina;
      // Lompat: modul Player tidak punya gravitasi — adapter yang
      // menangani hop sederhana (vy + kembali ke tanah).
      if (game._jumpQueued) {
        if (!player.inVehicle && !player.inBoat) this._vy = 6.2;
        game._jumpQueued = false;
      }
      if (this._vy == null) this._vy = 0;
      if (this._vy !== 0 || (player.y || 0) > 0) {
        player.y = (player.y || 0) + this._vy * dt;
        this._vy -= 18 * dt;
        if (player.y <= 0) { player.y = 0; this._vy = 0; }
      }
      const keys = ctx.input ? ctx.input.keys : new Set();
      const input = {
        forward: keys.has('KeyW') || keys.has('ArrowUp'),
        back: keys.has('KeyS') || keys.has('ArrowDown'),
        left: keys.has('KeyA') || keys.has('ArrowLeft'),
        right: keys.has('KeyD') || keys.has('ArrowRight'),
        run: keys.has('ShiftLeft') || keys.has('ShiftRight'),
        mouseDX: (ctx.input && ctx.input.lookDX) || 0,
        mouseDY: (ctx.input && ctx.input.lookDY) || 0,
        shoot: false, // tembak ditangani ShootingSystem via game.fireWeapon()
        interact: false, // interaksi (E) ditangani game.toggleVehicle()
      };
      world = {
        city: registry.city ? registry.city.city : null,
        vehicles: registry.vehicles ? registry.vehicles.mgr : null,
        water: registry.water ? registry.water.water : null,
        npcs: registry.city ? registry.city.npcs : [],
        timeOfDay: game.timeOfDay,
        onEvent: (type, data) => {
          if (type === 'swim-start') game.showToast('Kamu berenang — baju basah');
          else if (type === 'board-boat') game.showToast('Naik perahu — WASD mengemudi, E untuk turun');
          else if (type === 'enter-interior') game.showToast('Masuk ' + (data && data.name ? data.name : 'toko'));
          else if (type === 'interior-closed') game.showToast('Toko ini tutup setelah dirampok');
          else if (type === 'outfit-changed') game.showToast('Ganti baju — polisi tak lagi mengenalimu');
        },
      };
      player.update(dt, input, world);
      // Kemudi perahu: Player.update return lebih awal saat inBoat.
      if (player.inBoat && player.inBoat.steer) player.inBoat.steer(dt, input);
    },

    getState() {
      if (!player) return null;
      const st = player.status();
      // Saat di perahu, posisi pemain MENGIKUTI perahu (modul Player diam
      // saat inBoat — tanpa ini kamera & game.player.pos tertinggal dan
      // perahu tampak tidak bergerak).
      const px = player.inBoat ? player.inBoat.x : player.x;
      const pz = player.inBoat ? player.inBoat.z : player.z;
      const py = player.inBoat ? (player.inBoat.y || 0) : (player.y || 0);
      return {
        pos: { x: px, y: py, z: pz },
        heading: player.yaw,
        health: player.health,
        stamina: player.stamina,
        money: player.money,
        inVehicle: !!player.inVehicle,
        inBoat: !!player.inBoat,
        speed: Math.hypot(player.vx || 0, player.vz || 0),
        weapon: player.weapon,
        ammo: player.ammo,
        alive: player.alive,
        outfitRecognized: st.outfitRecognized,
        wet: st.wet,
        swimming: st.swimming,
      };
    },
    getPosition() {
      if (!player) return null;
      return { x: player.x, y: player.y || 0, z: player.z };
    },

    render(ctx) {
      if (!player || player.inVehicle || player.inBoat) return;
      const r = ctx.renderer;
      if (!this._mesh) this._mesh = r.createMesh(globalThis.SunsetMeshes.createPedestrianMesh([0.95, 0.6, 0.3]));
      r.drawMesh(this._mesh, M.m4FromTRS({ x: player.x, y: 0, z: player.z }, player.yaw), { specular: 0.1 });
      if (ctx.mode !== 'shadow') r.drawBlobShadow(player.x, 0, player.z, 0.9, 0.3);
    },

    giveWeapon(kind, ammo) { if (player) player.giveWeapon(kind, ammo); },
    boardBoat(boat) { if (player && boat) player.boardBoat(boat, world); },
    exitBoat() { if (player) player.exitCurrentRide(world); },
    exitInterior() { if (player) player.exitInterior(); },
    changeOutfit(outfitId) { return player ? player.changeOutfit(outfitId, world) : { ok: false }; },
  };
}

// =====================================================================
// VEHICLES — Traffic + mobil pemain (akselerasi, drift +$50, respray).
// =====================================================================
function makeVehiclesAdapter(registry) {
  const api = globalThis.SunsetVehicles;
  let mgr = null;
  let game = null;
  const meshCache = new Map();

  function carMesh(r, car) {
    const key = colorKey(car.color) + '|' + (car.lod || 'full') + '|' + (car.headlightsOn || car.headlightsFlashing ? 'hl' : 'no');
    if (!meshCache.has(key)) {
      const geo = mgr.meshFor(car);
      if (!geo) return null;
      meshCache.set(key, r.createMesh(geo));
    }
    return meshCache.get(key);
  }

  return {
    get mgr() { return mgr; },

    init(ctx) {
      if (!api) throw new Error('SunsetVehicles tidak terdaftar (vehicles.js gagal dimuat)');
      game = ctx.game;
      const city = registry.city ? registry.city.city : null;
      mgr = new api.VehicleManager(city);
      mgr.spawnTraffic(18.33);
      mgr.sunsetBeachCars(18.33);
      // 5 mobil parkir yang bisa dicuri (titik yang sama dengan fallback v10).
      const spots = [
        { x: -195, z: 30 }, { x: -135, z: -90 }, { x: 45, z: 150 },
        { x: 165, z: -30 }, { x: -75, z: 210 },
      ];
      for (const s of spots) {
        const c = new api.Car({ x: s.x, z: s.z, ai: false });
        c.heading = 0;
        mgr.cars.push(c);
      }
    },

    update(dt, ctx) {
      if (!mgr) return;
      mgr.update(dt, {
        timeOfDay: game.timeOfDay,
        camera: { x: game.camera.pos.x, z: game.camera.pos.z },
        cars: mgr.cars,
        trafficLights: mgr.trafficLights,
        onEvent: (type, data) => {
          if (type === 'drift') {
            game.player.money += 50;
            game.showToast('Drift! +$50');
          }
        },
      });
    },

    render(ctx) {
      if (!mgr) return;
      const r = ctx.renderer;
      const shadow = ctx.mode === 'shadow';
      for (const car of mgr.cars) {
        const mesh = carMesh(r, car);
        if (!mesh) continue;
        // Mesh mobil menghadap +Z; arah jalan heading 0 = -Z.
        r.drawMesh(mesh, M.m4FromTRS({ x: car.x, y: 0, z: car.z }, car.heading + Math.PI), { specular: 0.6, shininess: 60 });
        if (!shadow) r.drawBlobShadow(car.x, 0, car.z, 2.6, 0.32);
      }
    },

    getNearestVehicle(pos, maxDist) {
      return mgr ? mgr.nearestCar(pos.x, pos.z, maxDist) : null;
    },
    enterVehicle(car) {
      const p = registry.player ? registry.player.player : null;
      if (!mgr || !car || !p) return null;
      car.driver = p;
      p.inVehicle = car;
      car.ai = false;
      car.stolen = true;
      return car;
    },
    exitVehicle() {
      const p = registry.player ? registry.player.player : null;
      if (p && p.inVehicle) {
        p.inVehicle.driver = null;
        p.inVehicle = null;
      }
    },
    getPlayerState() {
      const p = registry.player ? registry.player.player : null;
      if (!p || !p.inVehicle) return null;
      const c = p.inVehicle;
      return { pos: { x: c.x, y: 0, z: c.z }, heading: c.heading, speed: c.speed };
    },
    getPlayerPosition() {
      const s = this.getPlayerState();
      return s ? s.pos : null;
    },
    getCameraTarget() {
      const s = this.getPlayerState();
      return s ? { pos: s.pos, heading: s.heading } : null;
    },
    respray() {
      const p = registry.player ? registry.player.player : null;
      if (!p || !p.inVehicle) return { ok: false, reason: 'not-in-vehicle' };
      const proxy = { money: game.player.money };
      const res = api.respray(p.inVehicle, null, proxy);
      if (res.ok) {
        game.player.money = proxy.money;
        if (registry.jobs) registry.jobs.swapVehicle();
      }
      return res;
    },
  };
}

// =====================================================================
// JOBS — 18 misi / 49 stage, CopAI + helikopter AIR-1, wanted memory.
// =====================================================================
function makeJobsAdapter(raw, registry) {
  let jobs = null;
  let game = null;
  let lastWanted = -1;
  let copMesh = null;
  let heliBody = null;
  let heliNose = null;
  let heliTail = null;
  let heliFin = null;
  let heliSkidL = null;
  let heliSkidR = null;
  let heliRotor = null;
  let spotMesh = null;

  const clampCoord = (v) => clampN(v, -300, 300);

  return {
    get jobs() { return jobs; },
    get cops() { return jobs ? jobs.cops : null; },

    init(ctx) {
      game = ctx.game;
      jobs = new raw.JobSystem({
        onEvent: (type, data) => {
          if (type === 'mission-start' && data && data.mission) game.showToast('Misi: ' + data.mission.name);
          else if (type === 'stage-complete' && data && data.stage) game.showToast('Tahap selesai: ' + data.stage.label);
          else if (type === 'mission-complete' && data) game.showToast('Misi selesai! +$' + data.cash + ' • REP +' + data.rep);
        },
      });
    },

    getNextMission() {
      if (!jobs) return undefined;
      const m = jobs.availableMissions()[0];
      if (!m) return undefined;
      const stages = m.stages.map((s) => ({ ...s, x: clampCoord(s.x), z: clampCoord(s.z) }));
      return {
        id: m.id, title: m.name, desc: m.blurb, reward: m.reward,
        stages, target: { x: stages[0].x, z: stages[0].z },
        giver: m.giver, showcase: !!m.showcase, phases: m.phases || null,
      };
    },
    startMission(id) {
      if (!jobs || jobs.active) return { ok: false, error: 'mission already active' };
      return jobs.startMission(id);
    },
    completeMission() {
      if (!jobs || !jobs.active) return { ok: false, error: 'no active mission' };
      return jobs.completeMission();
    },
    completeStage(detail) {
      if (!jobs || !jobs.active) return { ok: false, error: 'no active mission' };
      return jobs.completeStage(detail);
    },
    currentStage() { return jobs ? jobs.currentStage() : null; },
    distanceToObjective(px, pz) { return jobs ? jobs.distanceToObjective(px, pz) : null; },
    routeToObjective(px, pz) { return jobs ? jobs.routeToObjective(px, pz) : []; },
    raiseWanted(levels, knows) {
      if (!jobs) return 0;
      return jobs.raiseWanted(levels, knows);
    },
    noteWantedMemory(kind) {
      if (!jobs || !kind) return;
      if (!jobs.wantedMemory.includes(kind)) jobs.wantedMemory.push(kind);
    },
    swapVehicle() { return jobs ? jobs.swapVehicle() : []; },
    changeClothes() { return jobs ? jobs.changeClothes() : []; },

    getTargets() {
      if (!jobs) return [];
      const out = [];
      for (const c of jobs.cops.cops) {
        if (!c._t) c._t = { id: 'cop-' + out.length, kind: 'police', x: c.x, y: 1.2, z: c.z, radius: 1.5, hp: 100 };
        c._t.x = c.x; c._t.z = c.z;
        out.push(c._t);
      }
      return out;
    },
    spawnCopNear(dist) {
      if (!jobs || !game) return null;
      const px = game.player.pos.x, pz = game.player.pos.z;
      game.player.wanted = Math.max(game.player.wanted, 3);
      lastWanted = -1; // paksa respawn di update berikutnya
      jobs.cops.spawnForWanted(game.player.wanted, px, pz);
      const c = jobs.cops.cops[0];
      if (!c) return null;
      const fx = Math.sin(game.camera.yaw), fz = Math.cos(game.camera.yaw);
      // Taruh polisi di depan kamera (arah pandang), agar bisa ditembak.
      const dx = -Math.sin(game.camera.yaw), dz = -Math.cos(game.camera.yaw);
      c.x = px + dx * (dist || 12);
      c.z = pz + dz * (dist || 12);
      c.hp = 100;
      c._t = { id: 'cop-qa', kind: 'police', x: c.x, y: 1.2, z: c.z, radius: 1.5, hp: 100 };
      return c;
    },

    update(dt, ctx) {
      if (!jobs) return;
      jobs.setTime(game.timeOfDay);
      const g = game.player;
      if (g.wanted !== lastWanted) {
        lastWanted = g.wanted;
        jobs.wanted = g.wanted;
        if (g.wanted === 0) {
          jobs.cops.clear();
        } else {
          // JANGAN reset semua polisi saat wanted naik: HP polisi yang
          // sedang ditembak (dan posisinya) harus dipertahankan — dulu
          // spawnForWanted() menghapus bukti tembakan (HP 66 -> 100).
          const target = jobs.cops.wantedToCopCount(g.wanted);
          const old = jobs.cops.cops.slice();
          jobs.cops.spawnForWanted(g.wanted, g.pos.x, g.pos.z);
          const merged = old.concat(jobs.cops.cops).slice(0, target);
          jobs.cops.cops = merged;
        }
      }
      jobs.wanted = g.wanted;
      const speed = Math.max(Math.abs(g.drivingSpeed || 0) / 3.6, g.speed || 0);
      jobs.cops.update(dt, g.pos.x, g.pos.z, speed);
      // Polisi yang HP-nya habis (ditembak) keluar dari kejar-kejaran.
      if (jobs.cops.cops.some((c) => c._t && c._t.hp <= 0)) {
        jobs.cops.cops = jobs.cops.cops.filter((c) => !c._t || c._t.hp > 0);
        game.showToast('Polisi tumbang!');
      }
      const sz = jobs.cops.searchZone;
      const inside = sz ? Math.hypot(g.pos.x - sz.x, g.pos.z - sz.z) < sz.radius : false;
      if (jobs.tickHiding(dt, inside)) {
        game.player.wanted = 0;
        lastWanted = 0;
        game.showToast('Polisi kehilangan jejakmu');
      }
    },

    render(ctx) {
      if (!jobs) return;
      const r = ctx.renderer;
      if (!copMesh) copMesh = r.createMesh(globalThis.SunsetMeshes.createPedestrianMesh([0.1, 0.15, 0.45]));
      const px = game.player.pos.x, pz = game.player.pos.z;
      for (const c of jobs.cops.cops) {
        const dx = px - c.x, dz = pz - c.z;
        const yaw = Math.atan2(dx, -dz);
        r.drawMesh(copMesh, M.m4FromTRS({ x: c.x, y: 0, z: c.z }, yaw), { specular: 0.1 });
        if (ctx.mode !== 'shadow') r.drawBlobShadow(c.x, 0, c.z, 0.9, 0.3);
      }
      // Helikopter AIR-1 + spotlight (hanya pass warna).
      // Heli logika (CopAI) melayang TEPAT di atas pemain di y=42 — dari
      // kamera third-person itu selalu di luar frame. Visualnya digeser
      // ke depan arah hadap pemain (24 m, y=11) agar AIR-1 kelihatan di
      // atas jalan di depan pemain, sementara spotlight tetap menyapu
      // jalan di posisi pemain (kolam terang radius 16 m + sapuan lebar).
      if (ctx.mode === 'color' && jobs.cops.heliActive) {
        if (!heliBody) heliBody = r.createMesh(geoBox(5, 2.2, 8, [0.85, 0.85, 0.9]));
        if (!heliNose) heliNose = r.createMesh(geoBox(4.6, 1.6, 2.5, [0.12, 0.18, 0.3]));
        if (!heliTail) heliTail = r.createMesh(geoBox(0.9, 0.9, 9, [0.8, 0.8, 0.85]));
        if (!heliFin) heliFin = r.createMesh(geoBox(0.3, 2.6, 1.6, [0.85, 0.85, 0.9]));
        if (!heliSkidL) heliSkidL = r.createMesh(geoBox(0.25, 0.25, 7, [0.2, 0.2, 0.2]));
        if (!heliSkidR) heliSkidR = r.createMesh(geoBox(0.25, 0.25, 7, [0.2, 0.2, 0.2]));
        if (!heliRotor) heliRotor = r.createMesh(geoBox(13, 0.15, 1.2, [0.2, 0.2, 0.2]));
        if (!spotMesh) spotMesh = r.createMesh(geoPlane(1, 1, [1, 1, 1]));
        const h = jobs.cops.heli;
        const hd = (game.player && typeof game.player.heading === 'number') ? game.player.heading : 0;
        const hx = h.x + Math.sin(hd) * 24, hz = h.z - Math.cos(hd) * 24;
        const yaw = h.spotlightAngle * 0.3;
        const base = M.m4FromTRS({ x: hx, y: 11, z: hz }, yaw);
        const part = (mesh, dx, dy, dz, mat) => r.drawMesh(mesh, M.m4Translate(base, { x: dx, y: dy, z: dz }), mat);
        part(heliBody, 0, 0, 0, { specular: 0.7, shininess: 80 });
        part(heliNose, 0, -0.1, 4.6, { specular: 0.9, shininess: 120 });
        part(heliTail, 0, 0.3, -8, { specular: 0.6, shininess: 60 });
        part(heliFin, 0, 1.2, -12, { specular: 0.6, shininess: 60 });
        part(heliSkidL, -1.8, -1.5, 0, { specular: 0.3 });
        part(heliSkidR, 1.8, -1.5, 0, { specular: 0.3 });
        r.drawMesh(heliRotor, M.m4FromTRS({ x: hx, y: 12.6, z: hz }, h.spotlightAngle * 3), { specular: 0.3 });
        // Kolam cahaya terang di jalan (radius 16 m, kelihatan tepinya)
        // + sapuan lebar yang redup (radius 55 m, sesuai logika CopAI).
        r.drawFlat(spotMesh, M.m4FromTRS({ x: h.x, y: 0.12, z: h.z }, h.spotlightAngle, { x: 32, y: 1, z: 32 }), {
          alpha: 0.38, tint: [1, 0.95, 0.6], blend: true, depthWrite: false, useFog: false,
        });
        const rad = h.spotlightRadius || 55;
        r.drawFlat(spotMesh, M.m4FromTRS({ x: h.x, y: 0.1, z: h.z }, h.spotlightAngle, { x: rad * 2, y: 1, z: rad * 2 }), {
          alpha: 0.08, tint: [1, 0.95, 0.6], blend: true, depthWrite: false, useFog: false,
        });
      }
    },

    getSaveData() { return jobs ? jobs.save() : undefined; },
    applySave(data) { if (jobs) jobs.load(data); },
    getState() {
      if (!jobs) return null;
      return {
        wantedMemory: jobs.wantedMemory.slice(),
        searchTimer: jobs.cops.searchTimer,
        searchZone: jobs.cops.searchZone,
        heliActive: jobs.cops.heliActive,
        cops: jobs.cops.cops.length,
        rep: jobs.rep,
      };
    },
  };
}

// =====================================================================
// AUDIO — 5 stasiun radio original + ambience distrik. Radio hanya
// berbunyi di dalam kendaraan (diegetic, sesuai audio.js).
// =====================================================================
function makeAudioAdapter(raw, registry) {
  let audio = null;
  let game = null;
  let sirenOn = false;
  let lastDistrict = null;
  let lastAmbienceAt = 0;

  return {
    get audio() { return audio; },
    getStation() {
      if (!audio || !audio.station) return null;
      return { name: audio.station.name, dj: audio.station.dj ? audio.station.dj.name : '' };
    },

    init(ctx) {
      game = ctx.game;
      audio = new raw.AudioEngine();
      try { audio.init(); } catch (err) { console.warn('[audio] init gagal (headless?):', err.message); }
    },

    update(dt, ctx) {
      if (!audio || !audio.ctx) return;
      const now = ctx.time || 0;
      if (now - lastAmbienceAt < 1) return;
      lastAmbienceAt = now;
      const city = registry.city ? registry.city.city : null;
      const d = city ? city.districtAt(game.player.pos.x, game.player.pos.z) : null;
      const id = d ? d.id : 'downtown';
      if (id !== lastDistrict) lastDistrict = id;
      try { audio.setDistrict(id, game.timeOfDay); } catch (err) { /* abaikan */ }
    },

    setRadio(name) {
      if (!audio) return null;
      const idx = raw.RADIO_STATIONS.findIndex((s) => s.name === name);
      if (idx < 0) return audio.station;
      try { audio.setStation(idx); } catch (err) { /* abaikan */ }
      return audio.station;
    },
    nextStation() {
      if (!audio) return null;
      try { return audio.nextStation(); } catch (err) { return audio.station; }
    },
    setMuted(m) { if (audio) { try { audio.setMuted(m); } catch (err) { /* abaikan */ } } },
    enterVehicle(vehicle) {
      if (!audio) return;
      try {
        audio.init();
        audio.currentVehicle = vehicle || {};
        audio.setRadio(true);
      } catch (err) { /* abaikan */ }
    },
    exitVehicle() {
      if (!audio) return;
      try { audio.exitVehicle(); } catch (err) { /* abaikan */ }
    },
    play(name) {
      if (!audio || !audio.ctx) return;
      try {
        if (name === 'pickup' || name === 'mission-complete' || name === 'checkpoint') audio.sfxCashPickup();
        else if (name === 'steal') audio.sfxHorn(true);
        else if (name === 'door') audio.sfxHorn(false);
      } catch (err) { /* abaikan */ }
    },
    setWanted(w) {
      if (!audio || !audio.ctx) return;
      try {
        if (w > 0 && !sirenOn) { audio.sfxSirenStart(); sirenOn = true; }
        else if (w === 0 && sirenOn) { audio.sfxSirenStop(); sirenOn = false; }
      } catch (err) { /* abaikan */ }
    },
  };
}

// =====================================================================
// HUD — Modul Hud asli (3 sudut + wanted bermemori + minimap rute +
// zona pencarian merah). Dibangun di dalam #hud; panel lama game.js
// disembunyikan agar tidak dobel.
// =====================================================================
function makeHudAdapter(raw) {
  let hud = null;
  return {
    init(ctx) {
      hud = new raw.Hud({ container: ctx.game.dom.hud });
      const container = ctx.game.dom.hud;
      if (container) {
        container.querySelectorAll('.hud-panel').forEach((el) => { el.style.display = 'none'; });
      }
      hud.build(container);
    },
    update(state) { if (hud) hud.update(state); },
  };
}

// =====================================================================
// SHOTS — ShootingSystem: ammo lowercase, buyAmmo $50/+24, polisi
// HP 100 -> 66 per tembakan (34 damage).
// =====================================================================
function makeShotsAdapter(raw, registry) {
  let shots = null;
  let game = null;
  return {
    get shots() { return shots; },
    init(ctx) {
      game = ctx.game;
      const audio = registry.audio ? registry.audio.audio : null;
      shots = new raw.ShootingSystem({ audio, onEvent: () => {} });
      shots.ammo = 48;
      shots.mag = 12;
    },
    update() { if (shots && game) shots.money = game.player.money; },
    giveWeapon() { if (shots) { shots.ammo = 48; shots.mag = 12; } },
    fire(aim, targets) { return shots ? shots.fire(aim, targets) : { ok: false, reason: 'no-shots' }; },
    reload() { return shots ? shots.reload() : { ok: false }; },
    buyAmmo() {
      if (!shots) return { ok: false, error: 'no-shots' };
      shots.money = game.player.money;
      const r = shots.buyAmmo();
      if (r.ok) game.player.money = r.money;
      return r;
    },
    getState() {
      if (!shots) return null;
      return { ammo: shots.ammo, mag: shots.mag, reloading: shots.reloading };
    },
    getSaveData() { return shots ? { ammo: shots.ammo, mag: shots.mag } : undefined; },
    applySave(data) {
      if (!shots || !data) return;
      if (data.ammo != null) shots.ammo = data.ammo;
      if (data.mag != null) shots.mag = data.mag;
    },
  };
}

// =====================================================================
// buildAdapters — dipanggil main.js setelah dynamic import semua modul.
// Mengembalikan objek `modules` untuk `new Game(...)`.
// =====================================================================
export function buildAdapters(raw) {
  const registry = {};
  registry.city = makeCityAdapter();
  registry.water = makeWaterAdapter(registry);
  registry.player = makePlayerAdapter(registry);
  registry.vehicles = makeVehiclesAdapter(registry);
  registry.jobs = makeJobsAdapter(raw.jobs, registry);
  registry.audio = makeAudioAdapter(raw.audio, registry);
  registry.hud = makeHudAdapter(raw.hud);
  registry.shots = makeShotsAdapter(raw.shots, registry);
  // rng & meshes dipakai sebagai library (tanpa init/update/render).
  return {
    city: registry.city,
    water: registry.water,
    player: registry.player,
    vehicles: registry.vehicles,
    jobs: registry.jobs,
    audio: registry.audio,
    hud: registry.hud,
    shots: registry.shots,
    rng: raw.rng || null,
    meshes: raw.meshes || null,
    __registry: registry,
  };
}
