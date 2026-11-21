// game.js — Sunset Bay v11 (Builder B: game core + rendering)
// Logika utama: state machine (menu/playing/paused), kamera third-person,
// siklus waktu (pagi–siang–sunset–malam, sunset = default), cuaca hujan
// lokal, dan koordinator antar-modul (player, vehicles, city, jobs, hud,
// audio, water). Modul lain bersifat OPSIONAL: bila belum ada / gagal
// dimuat, game tetap jalan penuh dengan scene fallback prosedural —
// dunia 3D nyata selalu ter-render, tidak pernah langit saja.
//
// Kontrak modul (duck-typing, semua guarded):
//   mod.init(ctx)            — sekali saat boot
//   mod.update(dt, ctx)      — tiap frame logika
//   mod.render(ctx)          — tiap pass render; ctx.mode = 'shadow' | 'color'
//   mod.getSaveData() / mod.applySave(data) — opsional
//   ctx = { game, renderer, input, env, time, dt, mode }

import * as M from './math3.js';
import { geoBox, geoPlane, geoQuad, geoCylinder } from './gl.js';

export const VERSION = '11.0.0';
export const SAVE_KEY = 'sunset-bay-save-v1';

export const WORLD_BOUNDS = 320;      // setengah lebar peta (meter)
export const BEACH_X = -240;          // x < ini = pasir pantai
export const WATER_X = -292;          // x < ini = laut

const RADIO_STATIONS = ['Bay Breeze FM', 'Neon Tide', 'Palm Talk 88', 'Coral Rock Radio', 'Midnight Meridian'];
const WEAPONS = ['Tangan kosong', 'Pistol', 'SMG'];

// Palet pastel original kota pantai.
const PALETTE = [
  [0.95, 0.70, 0.55], // peach
  [0.66, 0.85, 0.73], // mint
  [0.96, 0.90, 0.78], // krem
  [0.95, 0.55, 0.55], // koral
  [0.66, 0.78, 0.91], // biru langit
  [0.78, 0.72, 0.91], // lavender
  [0.91, 0.85, 0.66], // pasir
  [0.98, 0.78, 0.62], // aprikot
];

// Keyframe siklus waktu. elev/azim = arah KE matahari/bulan (derajat).
// azim 0 = timur (+X), 90 = selatan (+Z), 180 = barat (-X).
// night 0..1 mengontrol bintang + seberapa kuat neon/jendela menyala.
const TIME_KEYFRAMES = [
  { h: 0.0,  elev: 28, azim: 210, sun: [0.55, 0.65, 1.0], sunI: 0.22, sky: [0.10, 0.12, 0.30], ground: [0.10, 0.10, 0.18], fog: [0.16, 0.16, 0.34], horizon: [0.20, 0.20, 0.42], mid: [0.13, 0.13, 0.32], zenith: [0.05, 0.06, 0.18], night: 1.0, emissive: 1.0, fogNear: 90, fogFar: 420 },
  { h: 5.0,  elev: -4, azim: 20,  sun: [0.70, 0.55, 0.75], sunI: 0.25, sky: [0.22, 0.18, 0.38], ground: [0.18, 0.14, 0.22], fog: [0.35, 0.28, 0.48], horizon: [0.55, 0.38, 0.55], mid: [0.30, 0.24, 0.48], zenith: [0.12, 0.12, 0.32], night: 0.85, emissive: 0.9, fogNear: 100, fogFar: 460 },
  { h: 6.5,  elev: 6,  azim: 8,   sun: [1.0, 0.62, 0.38], sunI: 0.85, sky: [0.55, 0.42, 0.62], ground: [0.55, 0.38, 0.32], fog: [0.85, 0.55, 0.55], horizon: [1.0, 0.62, 0.42], mid: [0.85, 0.50, 0.55], zenith: [0.42, 0.32, 0.62], night: 0.25, emissive: 0.35, fogNear: 120, fogFar: 520 },
  { h: 9.0,  elev: 35, azim: 55,  sun: [1.0, 0.92, 0.78], sunI: 1.25, sky: [0.55, 0.68, 0.90], ground: [0.65, 0.58, 0.48], fog: [0.78, 0.82, 0.90], horizon: [0.85, 0.88, 0.95], mid: [0.62, 0.75, 0.95], zenith: [0.35, 0.55, 0.90], night: 0.0, emissive: 0.0, fogNear: 140, fogFar: 600 },
  { h: 12.0, elev: 66, azim: 95,  sun: [1.0, 0.97, 0.88], sunI: 1.35, sky: [0.58, 0.72, 0.95], ground: [0.68, 0.62, 0.52], fog: [0.80, 0.85, 0.92], horizon: [0.88, 0.90, 0.96], mid: [0.65, 0.78, 0.96], zenith: [0.38, 0.58, 0.92], night: 0.0, emissive: 0.0, fogNear: 150, fogFar: 650 },
  { h: 16.0, elev: 38, azim: 140, sun: [1.0, 0.82, 0.55], sunI: 1.25, sky: [0.55, 0.62, 0.85], ground: [0.72, 0.58, 0.45], fog: [0.90, 0.78, 0.68], horizon: [1.0, 0.75, 0.55], mid: [0.80, 0.60, 0.68], zenith: [0.45, 0.45, 0.78], night: 0.0, emissive: 0.05, fogNear: 130, fogFar: 560 },
  // GOLDEN HOUR — default saat game dimulai (18:20).
  { h: 18.33, elev: 7, azim: 178, sun: [1.0, 0.55, 0.25], sunI: 1.15, sky: [0.45, 0.35, 0.75], ground: [0.90, 0.50, 0.30], fog: [0.95, 0.55, 0.45], horizon: [1.0, 0.55, 0.30], mid: [0.75, 0.40, 0.55], zenith: [0.35, 0.25, 0.60], night: 0.05, emissive: 0.55, fogNear: 120, fogFar: 520 },
  { h: 19.5, elev: -2, azim: 190, sun: [0.90, 0.45, 0.45], sunI: 0.45, sky: [0.30, 0.24, 0.55], ground: [0.45, 0.28, 0.30], fog: [0.55, 0.35, 0.55], horizon: [0.85, 0.42, 0.48], mid: [0.50, 0.32, 0.60], zenith: [0.20, 0.16, 0.42], night: 0.45, emissive: 0.9, fogNear: 110, fogFar: 480 },
  { h: 21.0, elev: 24, azim: 205, sun: [0.55, 0.65, 1.0], sunI: 0.28, sky: [0.14, 0.16, 0.38], ground: [0.12, 0.12, 0.20], fog: [0.20, 0.20, 0.40], horizon: [0.28, 0.26, 0.50], mid: [0.18, 0.17, 0.40], zenith: [0.06, 0.07, 0.22], night: 0.95, emissive: 1.0, fogNear: 90, fogFar: 430 },
  { h: 24.0, elev: 28, azim: 210, sun: [0.55, 0.65, 1.0], sunI: 0.22, sky: [0.10, 0.12, 0.30], ground: [0.10, 0.10, 0.18], fog: [0.16, 0.16, 0.34], horizon: [0.20, 0.20, 0.42], mid: [0.13, 0.13, 0.32], zenith: [0.05, 0.06, 0.18], night: 1.0, emissive: 1.0, fogNear: 90, fogFar: 420 },
];

function hash1(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function phaseName(hour) {
  if (hour < 5) return 'Dini Hari';
  if (hour < 9) return 'Pagi';
  if (hour < 15) return 'Siang';
  if (hour < 17.5) return 'Sore';
  if (hour < 19.5) return 'Sunset';
  if (hour < 21) return 'Senja';
  return 'Malam';
}

function formatClock(hour) {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour % 1) * 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function lerpColor(a, b, t) {
  return [M.lerp(a[0], b[0], t), M.lerp(a[1], b[1], t), M.lerp(a[2], b[2], t)];
}

// Misi fallback (dipakai bila modul jobs belum menyediakan misi).
const FALLBACK_MISSIONS = [
  { id: 'taxi', title: 'Taksi Sunset', desc: 'Antar penumpang ke dermaga pantai sebelum matahari tenggelam.', reward: 120, target: { x: -225, y: 0, z: 60 } },
  { id: 'packages', title: 'Kurir Pantai', desc: 'Kumpulkan 5 paket yang tersebar di sekitar kota.', reward: 200, target: null },
  { id: 'race', title: 'Balapan Sunset', desc: 'Lewati 3 checkpoint di sepanjang boulevard pantai.', reward: 350, target: { x: -200, y: 0, z: -180 } },
];

export class Game {
  constructor(opts) {
    this.renderer = opts.renderer;
    this.dom = opts.dom || {};
    this.modules = opts.modules || {};
    this.input = opts.input;
    this.onEvent = opts.onEvent || (() => {});

    this.mode = 'menu'; // menu | playing | paused
    this.time = 0;      // waktu nyata berjalan (detik)
    this.timeOfDay = 18.33; // jam game — default GOLDEN HOUR
    this.timeScale = 1 / 150; // 1 jam game per 150 detik nyata
    this.day = 1;

    this.player = {
      pos: { x: 0, y: 0, z: 40 },
      heading: Math.PI,
      speed: 0,
      velY: 0,
      onGround: true,
      health: 100,
      stamina: 100,
      money: 250,
      wanted: 0,
      weapon: 0,
      inVehicle: false,
      vehicleId: -1,
      vehicleFromFallback: false,
      drivingSpeed: 0,
    };

    this.camera = {
      yaw: Math.PI,
      pitch: 0.32,
      dist: 7.5,
      targetDist: 7.5,
      pos: { x: 0, y: 6, z: 50 },
      lookAt: { x: 0, y: 1.6, z: 40 },
    };

    this.weather = {
      rainX: 120, rainZ: -80, rainRadius: 95,
      rainStrength: 0, rainTarget: 0,
      rainTimer: 45,
      wetness: 0.12,
    };

    this.mission = null; // {def, progress, packages?, checkpoints?, stageIndex?}
    this.missionsDone = 0;
    this.rep = 0; // reputasi dari misi (modul jobs)
    this.radioIndex = 0;
    this.muted = false;
    this.headlights = false;
    this.wantedTimer = 0;
    this.hudTimer = 0;
    this.autosaveTimer = 0;
    this.menuOrbit = 0;
    this.toastTimer = null;
    this.fallback = null; // scene fallback bila modul city tidak ada
    this.env = null;
    this.stats = { distanceDriven: 0, carsStolen: 0, playSeconds: 0 };

    this._ctx = { game: this, renderer: this.renderer, input: this.input, env: null, time: 0, dt: 0, mode: 'color' };
    this._fallbackCars = [];
  }

  // ------------------------------------------------------------ init -----
  init() {
    const hasCity = !!this.modules.city;
    const hasWater = !!this.modules.water;
    if (!hasCity || !hasWater) {
      this.buildFallbackScene();
    }
    // Beri tahu modul lain bahwa game siap.
    this.callModule('city', 'init', this._ctx);
    this.callModule('player', 'init', this._ctx);
    this.callModule('vehicles', 'init', this._ctx);
    this.callModule('water', 'init', this._ctx);
    this.callModule('jobs', 'init', this._ctx);
    this.callModule('audio', 'init', this._ctx);
    this.callModule('hud', 'init', this._ctx);
    this.callModule('shots', 'init', this._ctx);
    this.env = this.computeEnv();
  }

  // Panggil method modul bila ada, dengan try/catch agar satu modul
  // yang rusak tidak mematikan game.
  callModule(name, method, ...args) {
    const mod = this.modules[name];
    if (!mod) return undefined;
    const fn = mod[method];
    if (typeof fn !== 'function') return undefined;
    try {
      return fn.apply(mod, args);
    } catch (err) {
      console.warn(`[game] modul ${name}.${method} gagal:`, err);
      return undefined;
    }
  }

  hasModule(name) {
    return !!this.modules[name];
  }

  // ------------------------------------------- scene fallback -----------
  // Kota prosedural minimal — dipakai bila modul city/water belum ada.
  // Semua mesh dibuat dari geo* di gl.js (instancing untuk yang berulang).
  buildFallbackScene() {
    const r = this.renderer;
    const fb = {
      ground: r.createMesh(geoPlane(760, 760, [0.62, 0.72, 0.55])),
      beach: r.createMesh(geoPlane(90, 760, [0.93, 0.85, 0.66])),
      water: r.createMesh(geoPlane(220, 760, [0.10, 0.35, 0.55])),
      roads: [],
      buildings: [],
      windows: null,
      palms: null,
      palmTops: null,
      lamps: null,
      lampBulbs: null,
      puddles: [],
    };
    // Jalan: grid tiap 60 m.
    for (let x = -240; x <= 240; x += 60) {
      fb.roads.push({ mesh: r.createMesh(geoPlane(10, 640, [0.16, 0.16, 0.20])), pos: { x, y: 0.02, z: 0 } });
    }
    for (let z = -240; z <= 240; z += 60) {
      fb.roads.push({ mesh: r.createMesh(geoPlane(640, 10, [0.16, 0.16, 0.20])), pos: { x: 0, y: 0.02, z } });
    }
    // Bangunan pastel di blok-blok kota (lewati beberapa blok = taman).
    const winList = [];
    for (let gx = -210; gx <= 210; gx += 60) {
      for (let gz = -210; gz <= 210; gz += 60) {
        const seed = Math.abs(gx * 13 + gz * 7);
        if (hash1(seed) < 0.22) continue; // taman / lahan kosong
        const w = 18 + hash1(seed + 1) * 12;
        const h = 8 + hash1(seed + 2) * 20;
        const d = 18 + hash1(seed + 3) * 12;
        const col = PALETTE[Math.floor(hash1(seed + 4) * PALETTE.length)];
        const cx = gx + 30 + (hash1(seed + 5) - 0.5) * 8;
        const cz = gz + 30 + (hash1(seed + 6) - 0.5) * 8;
        const roof = [Math.min(col[0] + 0.12, 1), Math.min(col[1] + 0.12, 1), Math.min(col[2] + 0.12, 1)];
        fb.buildings.push({
          mesh: r.createMesh(geoBox(w, h, d, col, [col, col, col, col, roof, col])),
          pos: { x: cx, y: h / 2, z: cz },
          w, h, d,
        });
        // Jendela emissive di fasad depan (instanced, menyala saat malam).
        const rows = Math.max(1, Math.floor(h / 6));
        for (let row = 0; row < rows; row++) {
          for (let colI = 0; colI < 3; colI++) {
            if (hash1(seed + 100 + row * 10 + colI) < 0.3) continue;
            winList.push({
              offset: { x: cx - w / 2 + (colI + 0.5) * (w / 3), y: 3 + row * 5, z: cz + d / 2 + 0.06 },
              scale: 1, rotY: 0,
              color: [1, 0.85, 0.55],
              _w: 2.2, _h: 2.6, _d: 0.15,
            });
          }
        }
      }
    }
    // Jendela: satu instanced mesh box satuan, skala per-instance lewat
    // trik — karena instancing kami hanya punya scale seragam, pakai
    // mesh box 2.2 x 2.6 x 0.15 dan scale = 1.
    const winMesh = r.createMesh(geoBox(2.2, 2.6, 0.15, [1, 1, 1]));
    fb.windows = r.createInstancedMesh(winMesh, Math.max(1, winList.length));
    r.setInstances(fb.windows, winList);

    // Palma di tepi pantai + taman (instanced, blob shadow per pohon).
    const palmList = [], topList = [];
    for (let i = 0; i < 42; i++) {
      const alongBeach = i < 26;
      const x = alongBeach ? BEACH_X + 8 + hash1(i * 3) * 14 : -220 + hash1(i * 7) * 440;
      const z = alongBeach ? -300 + i * 24 + hash1(i * 5) * 8 : -220 + hash1(i * 11) * 440;
      if (!alongBeach && Math.abs(x % 60) < 12) continue; // jangan di tengah jalan
      const s = 0.8 + hash1(i * 13) * 0.7;
      palmList.push({ offset: { x, y: 3.4 * s, z }, scale: s, rotY: hash1(i * 17) * Math.PI * 2, color: [0.55, 0.38, 0.22] });
      topList.push({ offset: { x, y: 6.8 * s, z }, scale: s, rotY: hash1(i * 19) * Math.PI * 2, color: [0.25, 0.62, 0.30] });
      fb.puddles.push({ x: x + 2, z: z + 2, w: 3, d: 2 });
    }
    const trunkMesh = r.createMesh(geoCylinder(0.22, 0.35, 6.8, [0.55, 0.38, 0.22], 7));
    fb.palms = r.createInstancedMesh(trunkMesh, Math.max(1, palmList.length));
    r.setInstances(fb.palms, palmList);
    const topMesh = r.createMesh(geoBox(4.6, 0.9, 4.6, [0.25, 0.62, 0.30]));
    fb.palmTops = r.createInstancedMesh(topMesh, Math.max(1, topList.length));
    r.setInstances(fb.palmTops, topList);
    fb.palmList = palmList;

    // Lampu jalan di boulevard pantai (x = -228).
    const lampList = [], bulbList = [];
    for (let z = -270; z <= 270; z += 45) {
      lampList.push({ offset: { x: -228, y: 2.6, z }, scale: 1, rotY: 0, color: [0.25, 0.25, 0.30] });
      bulbList.push({ offset: { x: -228, y: 5.3, z }, scale: 1, rotY: 0, color: [1, 0.9, 0.6] });
    }
    const poleMesh = r.createMesh(geoCylinder(0.09, 0.12, 5.2, [0.25, 0.25, 0.30], 6));
    fb.lamps = r.createInstancedMesh(poleMesh, lampList.length);
    r.setInstances(fb.lamps, lampList);
    const bulbMesh = r.createMesh(geoBox(0.5, 0.3, 0.5, [1, 0.9, 0.6]));
    fb.lampBulbs = r.createInstancedMesh(bulbMesh, bulbList.length);
    r.setInstances(fb.lampBulbs, bulbList);

    // Genangan acak (tampil saat basah).
    for (let i = 0; i < 8; i++) {
      fb.puddles.push({
        x: -220 + hash1(i * 31) * 440,
        z: -220 + hash1(i * 37) * 440,
        w: 4 + hash1(i * 41) * 6,
        d: 3 + hash1(i * 43) * 4,
      });
    }
    this.fallback = fb;

    // Mobil parkir fallback (bisa dicuri dengan E).
    const carColors = [[0.85, 0.25, 0.30], [0.25, 0.55, 0.90], [0.95, 0.80, 0.25], [0.35, 0.80, 0.45], [0.80, 0.80, 0.85]];
    for (let i = 0; i < 5; i++) {
      const spots = [
        { x: -195, z: 30, yaw: 0 }, { x: -135, z: -90, yaw: Math.PI / 2 },
        { x: 45, z: 150, yaw: 0 }, { x: 165, z: -30, yaw: Math.PI },
        { x: -75, z: 210, yaw: -Math.PI / 2 },
      ];
      const s = spots[i];
      const col = carColors[i];
      this._fallbackCars.push({
        id: i, pos: { x: s.x, y: 0, z: s.z }, yaw: s.yaw, color: col,
        body: r.createMesh(geoBox(2, 0.65, 4.4, col, [col, col, col, col, [col[0] * 0.85, col[1] * 0.85, col[2] * 0.85], col])),
        cabin: r.createMesh(geoBox(1.7, 0.55, 2.2, [0.15, 0.18, 0.25])),
        wheel: r.createMesh(geoBox(0.35, 0.7, 0.7, [0.08, 0.08, 0.08])),
        speed: 0,
      });
    }
  }

  renderFallbackWorld() {
    const r = this.renderer;
    const env = this.env;
    const fb = this.fallback;
    if (!fb) return;
    const emissive = env ? env.emissive : 0.5;

    // Tanah + pantai + laut.
    r.drawMesh(fb.ground, M.m4Identity(), { color: [1, 1, 1], specular: 0.05 });
    r.drawMesh(fb.beach, M.m4FromTRS({ x: BEACH_X - 12, y: 0.04, z: 0 }), { specular: 0.08 });
    if (!this.hasModule('water')) {
      r.drawMesh(fb.water, M.m4FromTRS({ x: WATER_X - 80, y: -0.35, z: 0 }), {
        specular: 0.9, shininess: 90, emissive: [0.05, 0.12, 0.20], emissiveStrength: 0.25,
      });
    }
    for (const road of fb.roads) {
      r.drawMesh(road.mesh, M.m4FromTRS(road.pos), { specular: 0.35, shininess: 40 });
    }
    for (const b of fb.buildings) {
      r.drawMesh(b.mesh, M.m4FromTRS(b.pos), { specular: 0.12 });
    }
    // Jendela menyala saat malam / sunset.
    if (fb.windows && fb.windows.count > 0) {
      r.drawInstanced(fb.windows, fb.windows.count, M.m4Identity(), {
        emissive: [1, 0.75, 0.35], emissiveStrength: emissive * 1.4, specular: 0,
      });
    }
    // Palma + blob shadow murah (bukan shadow per objek).
    if (fb.palms) r.drawInstanced(fb.palms, fb.palms.count, M.m4Identity(), { specular: 0.05 });
    if (fb.palmTops) r.drawInstanced(fb.palmTops, fb.palmTops.count, M.m4Identity(), { specular: 0.05 });
    for (const p of fb.palmList || []) {
      r.drawBlobShadow(p.offset.x, 0, p.offset.z, 2.2 * p.scale, 0.30);
    }
    // Lampu jalan.
    if (fb.lamps) r.drawInstanced(fb.lamps, fb.lamps.count, M.m4Identity(), { specular: 0.1 });
    if (fb.lampBulbs) {
      r.drawInstanced(fb.lampBulbs, fb.lampBulbs.count, M.m4Identity(), {
        emissive: [1, 0.85, 0.5], emissiveStrength: emissive * 1.6, specular: 0,
      });
    }
    // Genangan reflektif saat basah / dekat pantai.
    const wet = this.weather.wetness;
    if (wet > 0.25) {
      for (const p of fb.puddles) {
        r.drawPuddle(p.x, 0, p.z, p.w, p.d, env);
      }
    }
    // Mobil fallback.
    for (const car of this._fallbackCars) {
      const model = M.m4FromTRS(car.pos, car.yaw);
      r.drawMesh(car.body, M.m4Multiply(model, M.m4Translation({ x: 0, y: 0.55, z: 0 })), { specular: 0.6, shininess: 60 });
      r.drawMesh(car.cabin, M.m4Multiply(model, M.m4Translation({ x: 0, y: 1.1, z: -0.2 })), { specular: 0.8, shininess: 80 });
      const wheelOffsets = [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]];
      for (const [wx, wz] of wheelOffsets) {
        r.drawMesh(car.wheel, M.m4Multiply(model, M.m4Translation({ x: wx, y: 0.35, z: wz })), { specular: 0.1 });
      }
      r.drawBlobShadow(car.pos.x, 0, car.pos.z, 2.6, 0.32);
    }
  }

  // ------------------------------------------------------------- waktu ---
  computeEnv() {
    const h = ((this.timeOfDay % 24) + 24) % 24;
    let a = TIME_KEYFRAMES[0], b = TIME_KEYFRAMES[TIME_KEYFRAMES.length - 1];
    for (let i = 0; i < TIME_KEYFRAMES.length - 1; i++) {
      if (h >= TIME_KEYFRAMES[i].h && h <= TIME_KEYFRAMES[i + 1].h) {
        a = TIME_KEYFRAMES[i];
        b = TIME_KEYFRAMES[i + 1];
        break;
      }
    }
    const span = Math.max(0.0001, b.h - a.h);
    const t = M.clamp((h - a.h) / span, 0, 1);

    const elev = M.degToRad(M.lerp(a.elev, b.elev, t));
    const azim = M.degToRad(M.lerp(a.azim, b.azim, t));
    // Arah KE matahari/bulan, lalu dibalik = arah rambat cahaya.
    const toSun = { x: Math.cos(elev) * Math.cos(azim), y: Math.sin(elev), z: Math.cos(elev) * Math.sin(azim) };
    const sunDir = { x: -toSun.x, y: -toSun.y, z: -toSun.z };

    return {
      sunDir: [sunDir.x, sunDir.y, sunDir.z],
      sunTo: [toSun.x, toSun.y, toSun.z],
      sunColor: lerpColor(a.sun, b.sun, t),
      sunIntensity: M.lerp(a.sunI, b.sunI, t),
      skyColor: lerpColor(a.sky, b.sky, t),
      groundColor: lerpColor(a.ground, b.ground, t),
      fogColor: lerpColor(a.fog, b.fog, t),
      horizon: lerpColor(a.horizon, b.horizon, t),
      mid: lerpColor(a.mid, b.mid, t),
      zenith: lerpColor(a.zenith, b.zenith, t),
      night: M.lerp(a.night, b.night, t),
      emissive: M.lerp(a.emissive, b.emissive, t),
      fogNear: M.lerp(a.fogNear, b.fogNear, t),
      fogFar: M.lerp(a.fogFar, b.fogFar, t),
      wetness: this.weather.wetness,
      time: this.time,
      hour: h,
      phase: phaseName(h),
    };
  }

  updateWeather(dt) {
    const w = this.weather;
    // Zona hujan bergerak pelan melintasi peta.
    w.rainX += 1.4 * dt;
    w.rainZ += 0.55 * dt;
    if (w.rainX > 300) w.rainX = -300;
    if (w.rainZ > 300) w.rainZ = -300;
    // Target hujan berubah tiap 40–90 detik (70% kering, 30% hujan).
    w.rainTimer -= dt;
    if (w.rainTimer <= 0) {
      w.rainTimer = 40 + Math.random() * 50;
      w.rainTarget = Math.random() < 0.3 ? 0.6 + Math.random() * 0.4 : 0;
    }
    w.rainStrength += (w.rainTarget - w.rainStrength) * M.dampFactor(0.5, dt);

    // Kebasahan: naik saat pemain di zona hujan / dekat pantai, kering pelan.
    const p = this.player.pos;
    const inRain = Math.hypot(p.x - w.rainX, p.z - w.rainZ) < w.rainRadius;
    const nearBeach = p.x < BEACH_X + 30;
    if ((inRain && w.rainStrength > 0.15) || nearBeach) {
      w.wetness = Math.min(1, w.wetness + dt * (inRain ? 0.03 : 0.008));
    } else {
      w.wetness = Math.max(0.08, w.wetness - dt * 0.004);
    }
  }

  // ------------------------------------------------------------ kamera ---
  updateCamera(dt) {
    const p = this.player;
    const cam = this.camera;
    const input = this.input;

    if (this.mode === 'menu') {
      // Attract mode: orbit pelan di atas kota saat menu utama.
      this.menuOrbit += dt * 0.05;
      const cx = Math.cos(this.menuOrbit) * 150;
      const cz = Math.sin(this.menuOrbit) * 150;
      cam.pos = { x: cx, y: 55, z: cz };
      cam.lookAt = { x: -60, y: 4, z: 0 };
      return;
    }

    // Orbit dari mouse (drag) — input.lookDX/DY diakumulasi main.js.
    if (input) {
      cam.yaw -= (input.lookDX || 0) * 0.0042;
      cam.pitch = M.clamp(cam.pitch + (input.lookDY || 0) * 0.0032, -0.12, 1.15);
      input.lookDX = 0;
      input.lookDY = 0;
    }

    cam.targetDist = p.inVehicle ? 10.5 : 7.5;
    cam.dist += (cam.targetDist - cam.dist) * M.dampFactor(4, dt);

    const target = { x: p.pos.x, y: p.pos.y + 1.7, z: p.pos.z };
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const desired = {
      x: target.x + Math.sin(cam.yaw) * cp * cam.dist,
      y: target.y + sp * cam.dist,
      z: target.z + Math.cos(cam.yaw) * cp * cam.dist,
    };
    desired.y = Math.max(desired.y, 0.7); // jangan tembus tanah
    const k = M.dampFactor(9, dt);
    cam.pos = M.v3Lerp(cam.pos, desired, k);
    cam.lookAt = M.v3Lerp(cam.lookAt, target, M.dampFactor(14, dt));
  }

  getViewMatrix() {
    return M.m4LookAt(this.camera.pos, this.camera.lookAt, { x: 0, y: 1, z: 0 });
  }

  getProjectionMatrix(aspect) {
    return M.m4Perspective(M.degToRad(62), aspect, 0.1, 1500);
  }

  // ---------------------------------------------------- pemain fallback --
  // Dipakai bila modul player belum ada. Modul player yang asli
  // mengambil alih bila tersedia (lihat update()).
  updateFallbackPlayer(dt) {
    const p = this.player;
    const input = this.input;
    const keys = input ? input.keys : new Set();

    if (p.inVehicle) {
      // Mobil milik modul vehicles dikemudikan modul itu sendiri —
      // posisi pemain disinkronkan di update() via getPlayerState.
      if (!p.vehicleFromFallback) return;
      const car = this._fallbackCars[p.vehicleId];
      if (!car) { p.inVehicle = false; return; }
      const accel = (keys.has('KeyW') || keys.has('ArrowUp') ? 14 : 0) + (keys.has('KeyS') || keys.has('ArrowDown') ? -10 : 0);
      const steer = (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + (keys.has('KeyD') || keys.has('ArrowRight') ? -1 : 0);
      car.speed += accel * dt;
      car.speed *= Math.exp(-0.9 * dt); // gesekan
      car.speed = M.clamp(car.speed, -9, 26);
      if (Math.abs(car.speed) > 0.2) {
        car.yaw += steer * 1.9 * dt * Math.sign(car.speed) * Math.min(1, Math.abs(car.speed) / 8);
      }
      const fwd = M.forwardFromYaw(car.yaw);
      car.pos.x += fwd.x * car.speed * dt;
      car.pos.z += fwd.z * car.speed * dt;
      car.pos.x = M.clamp(car.pos.x, -WORLD_BOUNDS, WORLD_BOUNDS);
      car.pos.z = M.clamp(car.pos.z, -WORLD_BOUNDS, WORLD_BOUNDS);
      p.pos = { x: car.pos.x, y: 0, z: car.pos.z };
      p.heading = car.yaw;
      p.drivingSpeed = Math.abs(car.speed) * 3.6;
      this.stats.distanceDriven += Math.abs(car.speed) * dt;
      return;
    }

    const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const walkSpeed = sprint && p.stamina > 1 ? 8.5 : 4.6;
    if (sprint) p.stamina = Math.max(0, p.stamina - dt * 14);
    else p.stamina = Math.min(100, p.stamina + dt * 9);

    let mx = 0, mz = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) mz += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) mz -= 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;

    if (mx !== 0 || mz !== 0) {
      const len = Math.hypot(mx, mz);
      mx /= len; mz /= len;
      const fwd = M.forwardFromYaw(this.camera.yaw);
      const right = M.rightFromYaw(this.camera.yaw);
      const dx = fwd.x * mz + right.x * mx;
      const dz = fwd.z * mz + right.z * mx;
      p.pos.x += dx * walkSpeed * dt;
      p.pos.z += dz * walkSpeed * dt;
      p.heading = Math.atan2(-dx, -dz);
      p.speed = walkSpeed;
    } else {
      p.speed = 0;
    }

    // Lompat + gravitasi sederhana.
    if (p.onGround && this._jumpQueued) {
      p.velY = 6.2;
      p.onGround = false;
    }
    this._jumpQueued = false;
    if (!p.onGround) {
      p.velY -= 18 * dt;
      p.pos.y += p.velY * dt;
      if (p.pos.y <= 0) { p.pos.y = 0; p.velY = 0; p.onGround = true; }
    }

    p.pos.x = M.clamp(p.pos.x, -WORLD_BOUNDS, WORLD_BOUNDS);
    p.pos.z = M.clamp(p.pos.z, -WORLD_BOUNDS, WORLD_BOUNDS);
    p.drivingSpeed = p.speed * 3.6;
  }

  nearestFallbackCar(maxDist = 4.5) {
    const p = this.player.pos;
    let best = null, bestD = maxDist;
    for (const car of this._fallbackCars) {
      const d = Math.hypot(car.pos.x - p.x, car.pos.z - p.z);
      if (d < bestD) { bestD = d; best = car; }
    }
    return best;
  }

  toggleVehicle() {
    const p = this.player;
    // Turun dari perahu (anti-soft-lock: exitBoat selalu menemukan darat).
    if (p.inBoat) {
      this.callModule('player', 'exitBoat');
      p.inBoat = false;
      this.showToast('Turun dari perahu');
      return;
    }
    if (p.inVehicle) {
      // Keluar mobil: modul vehicles dulu bila mobilnya milik modul itu.
      if (this.hasModule('vehicles') && !p.vehicleFromFallback) {
        this.callModule('vehicles', 'exitVehicle');
      }
      const car = this._fallbackCars[p.vehicleId];
      if (p.vehicleFromFallback && car) {
        const r = M.rightFromYaw(car.yaw);
        p.pos = { x: car.pos.x + r.x * 2.2, y: 0, z: car.pos.z + r.z * 2.2 };
      }
      p.inVehicle = false;
      p.vehicleId = -1;
      p.vehicleFromFallback = false;
      p.drivingSpeed = 0;
      this.showToast('Keluar dari mobil');
      this.callModule('audio', 'play', 'door');
      this.callModule('audio', 'exitVehicle');
      return;
    }
    // Naik perahu terdekat di dermaga/pantai (modul water asli).
    const boat = this.callModule('water', 'nearestBoat', p.pos.x, p.pos.z, 4.5);
    if (boat) {
      this.callModule('player', 'boardBoat', boat);
      p.inBoat = true;
      return;
    }
    // Masuk mobil terdekat (mencuri = wanted +1).
    // Modul vehicles diprioritaskan; mobil fallback hanya bila modul
    // tidak ada atau tidak menemukan mobil di dekat pemain.
    let car = null;
    let fromFallback = false;
    if (this.hasModule('vehicles')) {
      car = this.callModule('vehicles', 'getNearestVehicle', p.pos, 4.5);
      if (car) this.callModule('vehicles', 'enterVehicle', car);
    }
    if (!car) {
      car = this.nearestFallbackCar(4.5);
      fromFallback = !!car;
    }
    if (car) {
      p.inVehicle = true;
      p.vehicleId = car.id !== undefined ? car.id : this._fallbackCars.indexOf(car);
      p.vehicleFromFallback = fromFallback;
      p.wanted = Math.min(5, p.wanted + 1);
      this.stats.carsStolen += 1;
      this.showToast('Mobil dicuri! Polisi mengejarmu ★');
      this.callModule('audio', 'play', 'steal');
      this.callModule('audio', 'setWanted', p.wanted);
      this.callModule('jobs', 'noteWantedMemory', 'car');
      this.callModule('audio', 'enterVehicle', car);
    } else {
      this.showToast('Tidak ada mobil di dekatmu');
    }
  }

  // ------------------------------------------------------------ tembak ---
  // Klik = tembak lewat ShootingSystem (raycast ke polisi CopAI).
  fireWeapon() {
    if (this.mode !== 'playing') return { ok: false, reason: 'not-playing' };
    if (this.player.weapon === 0) {
      this.showToast('Tidak ada senjata — tekan 1 (Pistol) atau 2 (SMG)');
      return { ok: false, reason: 'no-weapon' };
    }
    const cam = this.camera;
    // Tembak DARI pemain (setinggi dada) searah hadap kamera — bukan dari
    // kamera (ray kamera menukik ke bawah melewati target di depan).
    const fx = cam.lookAt.x - cam.pos.x, fz = cam.lookAt.z - cam.pos.z;
    const fl = Math.hypot(fx, fz) || 1;
    const aim = { ox: this.player.pos.x, oy: this.player.pos.y + 1.4, oz: this.player.pos.z, dx: fx / fl, dy: 0, dz: fz / fl };
    const targets = this.callModule('jobs', 'getTargets') || [];
    const res = this.callModule('shots', 'fire', aim, targets);
    if (!res) return { ok: false, reason: 'no-shots' };
    if (!res.ok) {
      if (res.reason === 'empty') {
        const rel = this.callModule('shots', 'reload');
        this.showToast(rel && rel.ok ? 'Reload…' : 'Ammo habis — tekan B untuk beli ammo ($50)');
      }
      return res;
    }
    if (res.hit && res.target) {
      this.showToast(`Kena! ${res.target.kind === 'police' ? 'Polisi' : 'Target'} HP ${res.hp}${res.down ? ' — tumbang!' : ''}`);
      if (res.target.kind === 'police') {
        this.player.wanted = Math.min(5, this.player.wanted + 1);
        this.callModule('jobs', 'raiseWanted', 1, ['face']);
        this.callModule('audio', 'setWanted', this.player.wanted);
      }
    }
    return res;
  }

  // Beli ammo: $50 untuk +24 (modul shots).
  buyAmmo() {
    const res = this.callModule('shots', 'buyAmmo');
    if (!res) return { ok: false };
    if (res.ok) this.showToast(`Ammo +24 ($50) — sisa $${Math.floor(this.player.money)}`);
    else this.showToast('Uang tidak cukup untuk ammo ($50)');
    return res;
  }

  // Respray di garasi: -$150, mobil tak lagi dikenali polisi.
  respray() {
    if (!this.player.inVehicle) {
      this.showToast('Respray hanya bisa di dalam mobil (tekan G saat mengemudi)');
      return { ok: false, reason: 'not-in-vehicle' };
    }
    const res = this.callModule('vehicles', 'respray');
    if (res && res.ok) this.showToast('Respray -$150 — mobil tak lagi dikenali polisi');
    else this.showToast('Respray gagal — butuh $150');
    return res || { ok: false };
  }

  setWeapon(idx) {
    this.player.weapon = idx % WEAPONS.length;
    if (this.dom.crosshair) {
      this.dom.crosshair.style.display = this.player.weapon > 0 ? 'block' : 'none';
    }
    this.showToast('Senjata: ' + WEAPONS[this.player.weapon]);
  }

  // ------------------------------------------------------------- misi ----
  startNextMission() {
    if (this.mission) return;
    const def = FALLBACK_MISSIONS[this.missionsDone % FALLBACK_MISSIONS.length];
    const jobsMission = this.callModule('jobs', 'getNextMission');
    const use = jobsMission || def;
    this.mission = {
      def: use,
      progress: 0,
      stageIndex: 0,
      target: use.target ? { x: use.target.x, y: 0, z: use.target.z } : null,
      packages: use.id === 'packages' ? this.spawnPackages() : null,
      checkpoints: use.id === 'race' ? [
        { x: -200, y: 0, z: 0 }, { x: -200, y: 0, z: 180 }, { x: 0, y: 0, z: 180 },
      ] : null,
      checkpointIndex: 0,
    };
    const stage = (use.stages && use.stages[0]) || null;
    this.showMission(use.title, stage ? stage.label : use.desc, stage ? `Tahap 1/${use.stages.length}` : '0%');
    this.callModule('jobs', 'startMission', use.id);
    this.showToast('Misi dimulai: ' + use.title);
  }

  spawnPackages() {
    const pkgs = [];
    for (let i = 0; i < 5; i++) {
      pkgs.push({
        x: -200 + hash1(i * 53 + 9) * 400,
        z: -200 + hash1(i * 59 + 4) * 400,
        taken: false,
      });
    }
    return pkgs;
  }

  updateMission(dt) {
    if (!this.mission) return;
    const m = this.mission;
    const p = this.player.pos;
    const def = m.def;

    // Misi bertahap modul jobs (18 misi / 49 stage): tiap stage = pergi
    // ke satu titik; choice/park/rob diselesaikan otomatis dengan pilihan
    // yang masuk akal (coupe cepat, parkir di tempat, masuk lewat gang).
    if (def.stages && def.stages.length > 0) {
      const st = def.stages[m.stageIndex];
      if (!st) return this.completeMission();
      const d = Math.hypot(st.x - p.x, st.z - p.z);
      m.target = { x: st.x, y: 0, z: st.z };
      this.showMission(def.title, st.label, `Tahap ${m.stageIndex + 1}/${def.stages.length} — ${Math.round(d)} m lagi`);
      if (d < 8) {
        let detail = null;
        if (st.kind === 'choice') detail = { choice: (st.choices && st.choices[0]) || 'coral-coupe' };
        else if (st.kind === 'park') detail = { x: p.x, z: p.z };
        else if (st.kind === 'rob') detail = { entrance: 'alley', loud: false };
        const res = this.callModule('jobs', 'completeStage', detail);
        if (res && res.completed) return this.completeMission(res);
        if (res && res.ok) {
          m.stageIndex += 1;
          const next = def.stages[m.stageIndex];
          if (next) m.target = { x: next.x, y: 0, z: next.z };
          this.showToast(`Tahap ${m.stageIndex}/${def.stages.length} selesai`);
        }
      }
      return;
    }

    const target = def.target;

    if (m.packages) {
      for (const pkg of m.packages) {
        if (!pkg.taken && Math.hypot(pkg.x - p.x, pkg.z - p.z) < 3) {
          pkg.taken = true;
          m.progress = m.packages.filter((q) => q.taken).length;
          this.showToast(`Paket ${m.progress}/5 diambil`);
          this.callModule('audio', 'play', 'pickup');
        }
      }
      this.showMission(def.title, def.desc, `${m.progress}/5 paket`);
      if (m.progress >= 5) return this.completeMission();
    } else if (m.checkpoints) {
      const cp = m.checkpoints[m.checkpointIndex];
      if (cp && Math.hypot(cp.x - p.x, cp.z - p.z) < 8) {
        m.checkpointIndex += 1;
        this.showToast(`Checkpoint ${m.checkpointIndex}/3`);
        this.callModule('audio', 'play', 'checkpoint');
      }
      this.showMission(def.title, def.desc, `Checkpoint ${m.checkpointIndex}/3`);
      if (m.checkpointIndex >= m.checkpoints.length) return this.completeMission();
    } else if (target) {
      const d = Math.hypot(target.x - p.x, target.z - p.z);
      this.showMission(def.title, def.desc, `${Math.round(d)} m lagi`);
      if (d < 8) return this.completeMission();
    }
  }

  completeMission(jobsResult) {
    const m = this.mission;
    if (!m) return;
    // Reward: angka (fallback) atau objek {cash, bonus, rep} (modul jobs).
    let cash = 0, rep = 0;
    if (typeof m.def.reward === 'number') cash = m.def.reward;
    else if (m.def.reward) {
      cash = (m.def.reward.cash || 0) + (m.def.reward.bonus || 0);
      rep = m.def.reward.rep || 0;
    }
    if (jobsResult && jobsResult.cash != null) cash = jobsResult.cash;
    if (jobsResult && jobsResult.rep != null) rep = jobsResult.rep;
    this.player.money += cash;
    this.rep += rep;
    this.missionsDone += 1;
    this.showToast(`Misi selesai! +$${cash}${rep ? ' • REP +' + rep : ''}`);
    this.callModule('audio', 'play', 'mission-complete');
    if (!jobsResult) this.callModule('jobs', 'completeMission', m.def.id);
    this.mission = null;
    this.hideMission();
  }

  // -------------------------------------------------------------- HUD ----
  showToast(msg, ms = 2600) {
    const el = this.dom.toast;
    if (el) {
      el.textContent = msg;
      el.classList.add('show');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => el.classList.remove('show'), ms);
    }
    this.onEvent('toast', msg);
  }

  showHint(msg) {
    const el = this.dom.hint;
    if (!el) return;
    if (msg) { el.textContent = msg; el.classList.add('show'); }
    else el.classList.remove('show');
  }

  showMission(title, desc, progress) {
    const o = this.dom.missionOverlay;
    if (!o) return;
    o.classList.add('show');
    if (this.dom.missionTitle) this.dom.missionTitle.textContent = title;
    if (this.dom.missionDesc) this.dom.missionDesc.textContent = desc;
    if (this.dom.missionProgress) this.dom.missionProgress.textContent = progress || '';
  }

  hideMission() {
    if (this.dom.missionOverlay) this.dom.missionOverlay.classList.remove('show');
  }

  updateHUD() {
    // Bila modul hud ada, ia yang menguasai DOM.
    if (this.hasModule('hud')) {
      this.callModule('hud', 'update', this.getHUDState());
      return;
    }
    const d = this.dom;
    const p = this.player;
    if (d.hpFill) d.hpFill.style.width = Math.max(0, p.health) + '%';
    if (d.staminaFill) d.staminaFill.style.width = Math.max(0, p.stamina) + '%';
    if (d.moneyText) d.moneyText.textContent = '$' + Math.floor(p.money).toLocaleString('en-US');
    if (d.wantedStars) {
      d.wantedStars.textContent = '★'.repeat(p.wanted) + '☆'.repeat(5 - p.wanted);
      d.wantedStars.classList.toggle('none', p.wanted === 0);
    }
    if (d.weaponText) {
      const sh = this.callModule('shots', 'getState');
      d.weaponText.textContent = (WEAPONS[p.weapon] || WEAPONS[0]) + (sh ? ` • ${sh.mag}/${sh.ammo} ammo` : '');
    }
    if (d.clockText && this.env) d.clockText.textContent = `${formatClock(this.env.hour)} — ${this.env.phase}`;
    if (d.radioText) d.radioText.textContent = 'RADIO: ' + RADIO_STATIONS[this.radioIndex] + (this.muted ? ' (bisukan)' : '');
    if (d.speedText) d.speedText.textContent = String(Math.round(p.drivingSpeed || 0));
    if (d.playerState) {
      d.playerState.textContent = p.inVehicle
        ? 'Mengemudi — tekan E untuk keluar'
        : (p.speed > 0.5 ? (p.stamina < 100 && (this.input.keys.has('ShiftLeft')) ? 'Berlari…' : 'Berjalan…') : 'Jalan kaki — tekan E di dekat mobil untuk mencuri');
    }
    if (d.vehicleText) {
      d.vehicleText.textContent = p.inVehicle
        ? 'Mobil • Lampu ' + (this.headlights ? 'ON (F)' : 'OFF (F)')
        : 'Tekan Q untuk misi';
    }
    this.drawMinimap();
  }

  getHUDState() {
    const p = this.player;
    const hour = this.env ? this.env.hour : 18.33;
    const district = this.callModule('city', 'districtAt', p.pos.x, p.pos.z);
    const radio = this.callModule('audio', 'getStation');
    const jobsState = this.callModule('jobs', 'getState');
    const shotsState = this.callModule('shots', 'getState');
    // Objektif saat ini: stage misi aktif (atau target fallback).
    let objective = null;
    if (this.mission) {
      const def = this.mission.def;
      const st = def.stages ? def.stages[this.mission.stageIndex] : null;
      const tgt = st || this.mission.target || def.target;
      if (tgt) {
        objective = {
          x: tgt.x, z: tgt.z,
          label: st ? st.label : def.title,
          distance: Math.hypot(tgt.x - p.pos.x, tgt.z - p.pos.z),
        };
      }
    }
    const route = this.mission && this.callModule('jobs', 'routeToObjective', p.pos.x, p.pos.z);
    return {
      health: p.health, stamina: p.stamina, money: p.money, wanted: p.wanted,
      weapon: WEAPONS[p.weapon], ammo: shotsState ? shotsState.mag : null,
      reserveAmmo: shotsState ? shotsState.ammo : null,
      clock: this.env ? formatClock(this.env.hour) : '18:20',
      hour: Math.floor(hour), minute: Math.floor((hour % 1) * 60),
      phase: this.env ? this.env.phase : 'Sunset',
      district: district ? district.name : '',
      radio: radio ? { station: radio.name, dj: radio.dj } : { station: RADIO_STATIONS[this.radioIndex], dj: '' },
      muted: this.muted,
      speed: Math.round(p.drivingSpeed || 0) / 100,
      speedKmh: Math.round(p.drivingSpeed || 0),
      inVehicle: p.inVehicle,
      inPursuit: p.wanted > 0 && jobsState ? jobsState.cops > 0 : false,
      missionActive: !!this.mission,
      objective,
      objectiveText: objective ? objective.label : '',
      route: route && route.length > 0 ? route : (objective ? [{ x: p.pos.x, z: p.pos.z }, { x: objective.x, z: objective.z }] : []),
      wantedMemory: jobsState ? jobsState.wantedMemory : [],
      searchTimer: jobsState ? jobsState.searchTimer : 0,
      searchZone: jobsState ? jobsState.searchZone : null,
      heliActive: jobsState ? jobsState.heliActive : false,
      mapBounds: { minX: -360, maxX: 360, minZ: -360, maxZ: 360 },
      pois: [
        { x: 320, z: 260, kind: 'safehouse' },
        { x: 100, z: 200, kind: 'shop' },
        { x: -20, z: -168, kind: 'shop' },
      ],
      pos: { x: p.pos.x, z: p.pos.z },
      player: { x: p.pos.x, z: p.pos.z, heading: (p.heading * 180) / Math.PI },
      heading: p.heading,
      mission: this.mission ? { title: this.mission.def.title, desc: this.mission.def.desc } : null,
    };
  }

  drawMinimap() {
    const cv = this.dom.minimap;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const S = cv.width;
    const scale = S / (WORLD_BOUNDS * 2 + 80);
    const toMap = (x, z) => [(x + WORLD_BOUNDS + 40) * scale, (z + WORLD_BOUNDS + 40) * scale];

    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#241a3d';
    ctx.fillRect(0, 0, S, S);
    // Laut (barat = kiri).
    ctx.fillStyle = '#1d4e6e';
    const [wx] = toMap(WATER_X, 0);
    ctx.fillRect(0, 0, wx, S);
    // Pasir.
    ctx.fillStyle = '#8a7a52';
    const [bx] = toMap(BEACH_X, 0);
    ctx.fillRect(wx, 0, bx - wx, S);
    // Jalan grid.
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1.5;
    for (let x = -240; x <= 240; x += 60) {
      const [mx] = toMap(x, 0);
      ctx.beginPath(); ctx.moveTo(mx, 0); ctx.lineTo(mx, S); ctx.stroke();
    }
    for (let z = -240; z <= 240; z += 60) {
      const [, mz] = toMap(0, z);
      ctx.beginPath(); ctx.moveTo(0, mz); ctx.lineTo(S, mz); ctx.stroke();
    }
    // Bangunan fallback.
    if (this.fallback) {
      ctx.fillStyle = 'rgba(255,255,255,0.30)';
      for (const b of this.fallback.buildings) {
        const [mx, mz] = toMap(b.pos.x, b.pos.z);
        ctx.fillRect(mx - 2, mz - 2, 4, 4);
      }
    }
    // Zona hujan.
    const w = this.weather;
    if (w.rainStrength > 0.15) {
      const [rx, rz] = toMap(w.rainX, w.rainZ);
      ctx.fillStyle = 'rgba(90,140,255,0.30)';
      ctx.beginPath(); ctx.arc(rx, rz, w.rainRadius * scale, 0, Math.PI * 2); ctx.fill();
    }
    // Target misi / paket.
    ctx.fillStyle = '#ffd23c';
    if (this.mission) {
      const m = this.mission;
      if (m.packages) {
        for (const pkg of m.packages) {
          if (pkg.taken) continue;
          const [px, pz] = toMap(pkg.x, pkg.z);
          ctx.beginPath(); ctx.arc(px, pz, 3, 0, Math.PI * 2); ctx.fill();
        }
      } else if (m.checkpoints) {
        const cp = m.checkpoints[m.checkpointIndex];
        if (cp) {
          const [cx, cz] = toMap(cp.x, cp.z);
          ctx.beginPath(); ctx.arc(cx, cz, 5, 0, Math.PI * 2); ctx.fill();
        }
      } else if (m.def.target) {
        const [tx, tz] = toMap(m.def.target.x, m.def.target.z);
        ctx.beginPath(); ctx.arc(tx, tz, 5, 0, Math.PI * 2); ctx.fill();
      }
    }
    // Mobil.
    ctx.fillStyle = '#7cf2a8';
    for (const car of this._fallbackCars) {
      const [cx, cz] = toMap(car.pos.x, car.pos.z);
      ctx.fillRect(cx - 1.5, cz - 1.5, 3, 3);
    }
    // Pemain: panah sesuai heading.
    const p = this.player.pos;
    const [px, pz] = toMap(p.x, p.z);
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(-this.player.heading + Math.PI);
    ctx.fillStyle = '#ff9a3c';
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(4.5, 5); ctx.lineTo(-4.5, 5); ctx.closePath();
    ctx.fill();
    ctx.restore();
    // Utara.
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('N', S - 12, 12);
  }

  // ------------------------------------------------------------ update ---
  update(dt) {
    this.time += dt;
    this.stats.playSeconds += dt;

    // Siklus waktu game.
    this.timeOfDay = (this.timeOfDay + dt * this.timeScale) % 24;
    if (this.timeOfDay < dt * this.timeScale) this.day += 1;

    this.updateWeather(dt);
    this.env = this.computeEnv();
    this._ctx.env = this.env;
    this._ctx.time = this.time;
    this._ctx.dt = dt;

    if (this.mode === 'playing') {
      this.consumeActions();

      // Player: modul asli bila ada, fallback bila tidak.
      if (this.hasModule('player')) {
        this.callModule('player', 'update', dt, this._ctx);
        const ps = this.callModule('player', 'getState') || this.callModule('player', 'getPosition');
        if (ps) {
          if (ps.pos) this.player.pos = { x: ps.pos.x, y: ps.pos.y || 0, z: ps.pos.z };
          if (ps.heading !== undefined) this.player.heading = ps.heading;
          if (ps.health !== undefined) this.player.health = ps.health;
          if (ps.stamina !== undefined) this.player.stamina = ps.stamina;
          if (ps.money !== undefined) this.player.money = ps.money;
          if (ps.inVehicle !== undefined) this.player.inVehicle = ps.inVehicle;
          if (ps.inBoat !== undefined) this.player.inBoat = ps.inBoat;
          if (ps.speed !== undefined) this.player.drivingSpeed = ps.speed * 3.6;
        }
      } else {
        this.updateFallbackPlayer(dt);
      }

      this.callModule('vehicles', 'update', dt, this._ctx);
      if (this.player.inVehicle && !this.player.vehicleFromFallback) {
        const vs = this.callModule('vehicles', 'getPlayerState')
          || this.callModule('vehicles', 'getPlayerPosition')
          || this.callModule('vehicles', 'getCameraTarget');
        if (vs) {
          const vp = vs.pos || vs;
          if (vp && typeof vp.x === 'number' && typeof vp.z === 'number') {
            this.player.pos = { x: vp.x, y: vp.y || 0, z: vp.z };
            if (vs.heading !== undefined) this.player.heading = vs.heading;
            if (vs.speed !== undefined) this.player.drivingSpeed = vs.speed * 3.6;
          }
        }
      }
      this.callModule('city', 'update', dt, this._ctx);
      this.callModule('jobs', 'update', dt, this._ctx);
      this.callModule('water', 'update', dt, this._ctx);
      this.callModule('audio', 'update', dt, this._ctx);

      // Wanted memudar bila lama tidak berbuat onar.
      if (this.player.wanted > 0) {
        this.wantedTimer += dt;
        if (this.wantedTimer > 25) {
          this.wantedTimer = 0;
          this.player.wanted -= 1;
          this.showToast(this.player.wanted === 0 ? 'Polisi kehilangan jejakmu' : 'Wanted turun: ' + '★'.repeat(this.player.wanted));
        }
      }

      this.updateMission(dt);

      // Autosave tiap 60 detik.
      this.autosaveTimer += dt;
      if (this.autosaveTimer > 60) {
        this.autosaveTimer = 0;
        this.onEvent('autosave', this.getSaveData());
      }

      // HUD 10x/detik sudah cukup.
      this.hudTimer += dt;
      if (this.hudTimer > 0.1) {
        this.hudTimer = 0;
        this.updateHUD();
      }
    }

    this.updateCamera(dt);
  }

  consumeActions() {
    const input = this.input;
    if (!input || !input.actions) return;
    while (input.actions.length > 0) {
      const a = input.actions.shift();
      switch (a.type) {
        case 'interact':
          this.toggleVehicle();
          break;
        case 'jump':
          this._jumpQueued = true;
          break;
        case 'radio':
          // Radio diegetic: hanya berbunyi di dalam mobil/perahu.
          if (this.player.inVehicle || this.player.inBoat) {
            this.radioIndex = (this.radioIndex + 1) % RADIO_STATIONS.length;
            this.showToast('Radio: ' + RADIO_STATIONS[this.radioIndex]);
            this.callModule('audio', 'setRadio', RADIO_STATIONS[this.radioIndex]);
          } else {
            this.showToast('Radio hanya menyala di dalam mobil');
          }
          break;
        case 'weapon': {
          const idx = a.data !== undefined ? a.data : (this.player.weapon + 1) % WEAPONS.length;
          this.setWeapon(idx % WEAPONS.length);
          break;
        }
        case 'buy-ammo':
          this.buyAmmo();
          break;
        case 'respray':
          this.respray();
          break;
        case 'mission':
          if (!this.mission) this.startNextMission();
          else this.showToast('Misi berjalan: ' + this.mission.def.title);
          break;
        case 'mute':
          this.muted = !this.muted;
          this.callModule('audio', 'setMuted', this.muted);
          this.showToast(this.muted ? 'Audio dibisukan' : 'Audio menyala');
          break;
        case 'headlights':
          this.headlights = !this.headlights;
          this.showToast(this.headlights ? 'Lampu mobil ON' : 'Lampu mobil OFF');
          break;
        case 'pause':
          this.togglePause();
          break;
        default:
          break;
      }
    }
  }

  // ------------------------------------------------------------ render ---
  render(aspect) {
    const r = this.renderer;
    const env = this.env || this.computeEnv();
    const camera = {
      view: this.getViewMatrix(),
      proj: this.getProjectionMatrix(aspect),
      position: this.camera.pos,
    };
    this._ctx.mode = 'shadow';
    this._ctx.env = env;

    // Pass 1 — shadow map directional (satu saja).
    const sunDir = M.toVec3(env.sunDir);
    const focus = this.mode === 'menu' ? { x: -60, y: 0, z: 0 } : this.player.pos;
    r.startShadow(sunDir, focus, 230, 1, 700);
    this.renderWorld('shadow');
    r.endShadow();

    // Pass 2 — frame utama.
    this._ctx.mode = 'color';
    r.beginFrame(camera, env);
    this.renderWorld('color');

    // Efek transparan setelah opaque: awan, hujan, genangan sudah di
    // renderWorld; awan + hujan digambar di sini (selalu setelah opaque).
    r.drawClouds(env, this.time);
    const w = this.weather;
    const camInRain = Math.hypot(this.camera.pos.x - w.rainX, this.camera.pos.z - w.rainZ) < w.rainRadius + 60;
    if (w.rainStrength > 0.05 && camInRain) {
      r.drawRain(this.camera.pos, 55, 420, this.time, w.rainStrength);
    }
    r.endFrame();
  }

  renderWorld(mode) {
    this.callModule('city', 'render', this._ctx);
    this.callModule('vehicles', 'render', this._ctx);
    this.callModule('player', 'render', this._ctx);
    this.callModule('water', 'render', this._ctx);
    this.callModule('jobs', 'render', this._ctx);
    this.renderFallbackWorld();

    // Beacon misi: pilar cahaya di target (hanya pass warna).
    if (mode === 'color' && this.mission) {
      const target = this.mission.target || this.mission.def.target
        || (this.mission.checkpoints ? this.mission.checkpoints[this.mission.checkpointIndex] : null);
      if (target) {
        const r = this.renderer;
        // Pilar digambar via quad vertikal transparan warna emas.
        if (!this._beaconMesh) {
          this._beaconMesh = r.createMesh(geoQuad(3, 60, [1, 0.8, 0.25]));
        }
        const dx = this.camera.pos.x - target.x;
        const dz = this.camera.pos.z - target.z;
        const yaw = Math.atan2(dx, dz);
        r.drawFlat(this._beaconMesh, M.m4FromTRS({ x: target.x, y: 30, z: target.z }, yaw), {
          alpha: 0.35, tint: [1, 0.8, 0.25], blend: true, depthWrite: false, useFog: false,
        });
      }
    }
  }

  // ------------------------------------------------------- state flow ---
  start(newGame, saveData) {
    if (newGame || !saveData) {
      this.resetNewGame();
    } else {
      this.applySave(saveData);
    }
    this.mode = 'playing';
    this.updateHUD();
    // Pemain mulai dengan pistol + 48 ammo (modul player + shots).
    if (this.player.weapon === 0) this.setWeapon(1);
    this.callModule('player', 'giveWeapon', 'pistol', 48);
    this.callModule('shots', 'giveWeapon');
    this.showToast(newGame ? 'Selamat datang di Sunset Bay!' : 'Selamat datang kembali di Sunset Bay!');
    if (!this.mission) {
      this.showHint('Tekan Q untuk misi pertama • E di dekat mobil untuk mencuri');
      setTimeout(() => this.showHint(''), 7000);
    }
    this.onEvent('started', { newGame: !!newGame });
  }

  resetNewGame() {
    this.player.pos = { x: 0, y: 0, z: 40 };
    this.player.heading = Math.PI;
    this.player.health = 100;
    this.player.stamina = 100;
    this.player.money = 250;
    this.player.wanted = 0;
    this.player.weapon = 0;
    this.player.inVehicle = false;
    this.player.vehicleId = -1;
    this.timeOfDay = 18.33;
    this.day = 1;
    this.missionsDone = 0;
    this.rep = 0;
    this.mission = null;
    this.player.inBoat = false;
    this.weather.wetness = 0.12;
    this.weather.rainStrength = 0;
    this.stats = { distanceDriven: 0, carsStolen: 0, playSeconds: 0 };
    this.hideMission();
  }

  togglePause() {
    if (this.mode === 'playing') this.pause();
    else if (this.mode === 'paused') this.resume();
  }

  pause() {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    this.onEvent('autosave', this.getSaveData());
    this.onEvent('paused', this.getStats());
  }

  resume() {
    if (this.mode !== 'paused') return;
    this.mode = 'playing';
    this.onEvent('resumed', null);
  }

  quitToMenu() {
    this.mode = 'menu';
    this.onEvent('autosave', this.getSaveData());
    this.onEvent('quit-to-menu', null);
    this.hideMission();
  }

  getStats() {
    return {
      day: this.day,
      money: Math.floor(this.player.money),
      missionsDone: this.missionsDone,
      carsStolen: this.stats.carsStolen,
      distanceDrivenKm: (this.stats.distanceDriven / 1000).toFixed(1),
      playMinutes: Math.floor(this.stats.playSeconds / 60),
      wanted: this.player.wanted,
      clock: this.env ? formatClock(this.env.hour) : '18:20',
      phase: this.env ? this.env.phase : 'Sunset',
    };
  }

  // ---------------------------------------------------------- save/load --
  getSaveData() {
    const data = {
      version: 1,
      savedAt: Date.now(),
      money: this.player.money,
      health: this.player.health,
      stamina: this.player.stamina,
      wanted: this.player.wanted,
      weapon: this.player.weapon,
      playerPos: { x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z },
      heading: this.player.heading,
      timeOfDay: this.timeOfDay,
      day: this.day,
      missionsDone: this.missionsDone,
      rep: this.rep,
      radioIndex: this.radioIndex,
      stats: { ...this.stats },
      weather: { wetness: this.weather.wetness },
      modules: {},
    };
    for (const name of Object.keys(this.modules)) {
      const modData = this.callModule(name, 'getSaveData');
      if (modData !== undefined) data.modules[name] = modData;
    }
    return data;
  }

  applySave(data) {
    if (!data) return;
    const p = this.player;
    p.money = data.money !== undefined ? data.money : 250;
    p.health = data.health !== undefined ? data.health : 100;
    p.stamina = data.stamina !== undefined ? data.stamina : 100;
    p.wanted = data.wanted || 0;
    p.weapon = data.weapon || 0;
    if (data.playerPos) p.pos = { x: data.playerPos.x, y: data.playerPos.y || 0, z: data.playerPos.z };
    if (data.heading !== undefined) p.heading = data.heading;
    if (data.timeOfDay !== undefined) this.timeOfDay = data.timeOfDay;
    if (data.day !== undefined) this.day = data.day;
    if (data.missionsDone !== undefined) this.missionsDone = data.missionsDone;
    if (data.rep !== undefined) this.rep = data.rep;
    if (data.radioIndex !== undefined) this.radioIndex = data.radioIndex;
    if (data.stats) this.stats = { ...this.stats, ...data.stats };
    if (data.weather && data.weather.wetness !== undefined) this.weather.wetness = data.weather.wetness;
    if (data.modules) {
      for (const name of Object.keys(data.modules)) {
        this.callModule(name, 'applySave', data.modules[name]);
      }
    }
    // Kamera langsung ke pemain agar tidak ada lompatan aneh.
    this.camera.lookAt = { x: p.pos.x, y: p.pos.y + 1.7, z: p.pos.z };
    this.camera.pos = {
      x: p.pos.x + Math.sin(this.camera.yaw) * 7,
      y: p.pos.y + 4,
      z: p.pos.z + Math.cos(this.camera.yaw) * 7,
    };
  }
}
