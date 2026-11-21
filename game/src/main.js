// Sunset Bay — main.js
// Entry point game (v10, ditulis dari nol; wiring diperbaiki integrator v10).
// Game loop (requestAnimationFrame), input keyboard WASD/panah + mouse,
// state machine (menu, playing, paused, wasted), save/load localStorage
// key 'sunset-bay-save-v1', overlay pause. Menghubungkan player, vehicles,
// city, jobs, hud, audio, shots, water, meshes.
//
// Wiring yang diperbaiki di integrasi v10 (modul-modulnya sendiri sudah
// benar, tapi main.js lama tidak memanggilnya dengan benar):
//   * meshes.js + water.js di-import (SB.Meshes / SB.Water tadinya tidak
//     pernah ada — semua build*Mesh mengembalikan null).
//   * City.build()/render() dipanggil: kota 219 bangunan digambar.
//   * Water.draw() dipanggil SETIAP frame; laut + dermaga + buoy digambar.
//   * Player.update dipanggil dengan argumen benar (player, input, dt,
//     world) — tadinya (dt, input, state) sehingga pemain tak bergerak.
//   * Jobs.updateMission / updateTaxiJob / updateDeliveryJob per frame
//     (Jobs.update tidak ada); misi 1 auto-start saat permainan dimulai.
//   * Vehicles.updateVehicle (kendaraan pemain) + updateTraffic per frame
//     (Vehicles.update tidak ada).
//   * HUD.render(state) per frame (HUD.update tidak ada).
//   * Shots.fire dipanggil dengan (game, origin, dir, targets) yang benar
//     — tadinya Shots.fire(player) sehingga tembakan tak pernah terjadi.
//   * Audio.init/startMusic/toggleMute/playShot adalah alias di audio.js.
//   * Mesh kendaraan/pemain/heli/marker dibuat sekali (ruang lokal) lalu
//     digambar dengan model matrix — bukan rebuild tiap frame (bocor
//     buffer GL).

import { Math3 } from './math3.js';
import { GL } from './gl.js';
import { Game } from './game.js';
import { Player } from './player.js';
import { Vehicles } from './vehicles.js';
import { City } from './city.js';
import { Jobs } from './jobs.js';
import { HUD } from './hud.js';
import { Audio } from './audio.js';
import { Shots } from './shots.js';
import { Water } from './water.js';
import { Meshes } from './meshes.js';

const SB = (typeof window !== 'undefined' ? (window.SB = window.SB || {}) : (globalThis.SB = globalThis.SB || {}));
SB.Math3 = Math3;
SB.GL = GL;
SB.Game = Game;
SB.G = Game;
SB.Player = Player;
SB.Vehicles = Vehicles;
SB.City = City;
SB.Jobs = Jobs;
SB.HUD = HUD;
SB.Audio = Audio;
SB.Shots = Shots;
SB.Water = Water;
SB.Meshes = Meshes;

const SAVE_KEY = 'sunset-bay-save-v1';
const SHOOT_COOLDOWN_SECONDS = 0.35;
const DRIFT_REWARD = 50;
const DRIFT_REWARD_COOLDOWN_MS = 3000;
const RESPRAY_PRICE = 150;

const Main = {
  canvas: null,
  gl: null,
  running: false,
  lastTime: 0,
  shootCooldown: 0,
  keys: {},
  mouse: { x: 0, y: 0, down: false, dx: 0, dy: 0 },
  cameraYaw: Math.PI,
  cameraPitch: 0.32,
  cameraDistance: 9,
  paused: false,
  city: null,
  water: null,
  vehicles: [],
  traffic: [],
  stats: { frames: 0, waterDraws: 0, hudRenders: 0 },
  _carMeshes: {},
  _boatMeshes: {},
  _playerMesh: null,
  _playerMeshKey: '',
  _playerMeshAt: 0,
  _figureMesh: null,
  _heliMesh: null,
  _markerMesh: null,
  _tracerMesh: null,
  _driftPaidAt: 0,

  init() {
    const canvas = document.getElementById('game-canvas');
    if (!canvas) throw new Error('Canvas #game-canvas tidak ditemukan');
    this.canvas = canvas;
    const created = GL.initGL(canvas);
    this.gl = created.gl;

    this.bindInput();
    this.bindButtons();
    this.loadSaveIntoHud();

    // Dunia: kota (219 bangunan / 10 distrik), laut, kendaraan.
    if (City && typeof City.build === 'function') this.city = City.build();
    else if (City && typeof City.generateCity === 'function') this.city = City.generateCity(1337);
    if (Water && typeof Water.createWater === 'function') this.water = Water.createWater();
    if (Vehicles) {
      const parked = typeof Vehicles.spawnParkedCars === 'function' && this.city
        ? Vehicles.spawnParkedCars(this.city, 8) : [];
      const traffic = typeof Vehicles.spawnTraffic === 'function' && this.city
        ? Vehicles.spawnTraffic(this.city, 10) : [];
      const boats = typeof Vehicles.spawnBoats === 'function'
        ? Vehicles.spawnBoats(3) : [];
      this.vehicles = [...parked, ...traffic, ...boats];
      this.traffic = traffic;
    }
    if (Audio && typeof Audio.init === 'function') {
      try { Audio.init(); } catch (e) { /* audio butuh gesture; mulai di Start */ }
    }
    if (HUD && typeof HUD.init === 'function') HUD.init();

    this.showMenu();
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));
    return this;
  },

  bindInput() {
    window.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      this.keys[key] = true;
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) e.preventDefault();
      if (key === 'escape' || key === 'p') this.togglePause();
      if (key === 'f') this.tryShoot();
      if (key === 'enter' && Game.state.mode === 'menu') this.startPlaying();
      if (key === 'enter' && Game.state.mode === 'wasted') this.respawn();
      if (key === 'e') this.tryEnterVehicle();
      if (key === 'r') this.respray();
      if (key === 'q' && Audio && typeof Audio.nextStation === 'function') Audio.nextStation();
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false;
    });
    window.addEventListener('blur', () => {
      this.keys = {};
      this.mouse.down = false;
    });

    const canvas = this.canvas;
    canvas.addEventListener('mousedown', (e) => {
      this.mouse.down = true;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      if (Game.state.mode === 'playing') this.tryShoot();
    });
    window.addEventListener('mouseup', () => { this.mouse.down = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.mouse.down) return;
      const dx = e.clientX - this.mouse.x;
      const dy = e.clientY - this.mouse.y;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.cameraYaw -= dx * 0.005;
      this.cameraPitch = Math.max(0.05, Math.min(1.1, this.cameraPitch + dy * 0.003));
    });
    canvas.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      this.mouse.down = true;
      this.mouse.x = t.clientX;
      this.mouse.y = t.clientY;
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      const dx = t.clientX - this.mouse.x;
      const dy = t.clientY - this.mouse.y;
      this.mouse.x = t.clientX;
      this.mouse.y = t.clientY;
      this.cameraYaw -= dx * 0.006;
      this.cameraPitch = Math.max(0.05, Math.min(1.1, this.cameraPitch + dy * 0.004));
    }, { passive: true });
    canvas.addEventListener('touchend', () => { this.mouse.down = false; }, { passive: true });
  },

  bindButtons() {
    const bind = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    };
    bind('btn-start', () => this.startPlaying());
    bind('btn-resume', () => this.togglePause());
    bind('btn-restart', () => this.respawn());
    bind('btn-respawn', () => this.respawn());
    bind('btn-menu', () => this.showMenu());
    bind('btn-shoot', () => this.tryShoot());
    bind('btn-pause', () => this.togglePause());
    bind('btn-sound', () => {
      if (Audio && typeof Audio.toggleMute === 'function') Audio.toggleMute();
    });
  },

  startPlaying() {
    const saved = Game.load();
    if (saved && saved.cash !== undefined && Game.state.mode === 'menu') {
      // Lanjutkan save yang ada: kembalikan mode playing tanpa reset total.
      Game.state.mode = 'playing';
      Game.state.player.alive = true;
      Game.state.health = Math.max(Game.state.health, 50);
    } else {
      Game.startGame();
    }
    // Misi 1 auto-start: tidak ada pemicu lain di dunia untuk
    // "kunjungi Rico", jadi misi pertama dimulai saat bermain.
    if (Jobs && typeof Jobs.startMission === 'function' && Jobs.state) {
      if (!Jobs.state.active && !(Jobs.state.completed || []).includes(1)) {
        Jobs.startMission(Game.state, 1);
      }
    }
    if (Audio && typeof Audio.startMusic === 'function') Audio.startMusic();
    this.hideOverlays();
    this.updateHud();
  },

  respawn() {
    Game.respawn();
    this.hideOverlays();
    this.updateHud();
  },

  showMenu() {
    Game.state.mode = 'menu';
    this.setOverlay('menu-overlay', true);
    this.setOverlay('pause-overlay', false);
    this.setOverlay('wasted-overlay', false);
  },

  togglePause() {
    if (Game.state.mode === 'playing') {
      Game.pause();
      this.setOverlay('pause-overlay', true);
      if (Audio && typeof Audio.pauseMusic === 'function') Audio.pauseMusic();
    } else if (Game.state.mode === 'paused') {
      Game.resume();
      this.setOverlay('pause-overlay', false);
      if (Audio && typeof Audio.resumeMusic === 'function') Audio.resumeMusic();
    }
  },

  hideOverlays() {
    this.setOverlay('menu-overlay', false);
    this.setOverlay('pause-overlay', false);
    this.setOverlay('wasted-overlay', false);
  },

  setOverlay(id, visible) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('hidden', !visible);
    el.style.display = visible ? 'flex' : 'none';
  },

  // --- kendaraan ---------------------------------------------------
  tryEnterVehicle() {
    if (Game.state.mode !== 'playing') return;
    const p = Game.state.player;
    if (p.mode === 'car' || p.mode === 'boat') {
      // Keluar: player.js (exitBoat untuk kapal — tak pernah soft-lock).
      if (Player && typeof Player.exitVehicle === 'function') {
        Player.exitVehicle(p, { city: this.city, water: this.water });
      }
      Game.exitVehicle();
      if (Audio && typeof Audio.playSFX === 'function') Audio.playSFX('click');
      this.updateHud();
      return;
    }
    if (p.mode !== 'foot') return;
    if (!Player || typeof Player.tryEnterVehicle !== 'function') return;
    const v = Player.tryEnterVehicle(p, this.vehicles);
    if (!v) return;
    if (v.kind === 'boat') {
      p.mode = 'boat';
      p.vehicle = v;
    } else {
      // Curi mobil: +2 wanted (Game.stealCar), REP & cash menyusul.
      Game.stealCar(v.id);
      p.vehicle = v;
      p.mode = 'car';
    }
    if (Audio && typeof Audio.playSFX === 'function') Audio.playSFX('engineStart');
    this.updateHud();
  },

  // Respray: ganti warna mobil yang sedang dikendarai, -$150.
  respray() {
    if (Game.state.mode !== 'playing') return { ok: false, reason: 'not playing' };
    const p = Game.state.player;
    if (!p.vehicle || p.mode !== 'car') return { ok: false, reason: 'not in a car' };
    if (Game.state.cash < RESPRAY_PRICE) return { ok: false, reason: 'not enough cash' };
    const colors = ['#d94f3d', '#3d7bd9', '#e8c33a', '#37b06a', '#e8e8e8', '#22222a', '#7a4fd9', '#e07a2a'];
    let next = colors[Math.floor(Math.random() * colors.length)];
    let guard = 0;
    while (next === p.vehicle.color && guard++ < 8) {
      next = colors[Math.floor(Math.random() * colors.length)];
    }
    p.vehicle.color = next;
    Game.addCash(-RESPRAY_PRICE);
    if (Audio && typeof Audio.playSFX === 'function') Audio.playSFX('cash');
    this.updateHud();
    return { ok: true, color: next, cash: Game.state.cash };
  },

  // --- menembak ----------------------------------------------------
  cameraForward() {
    const cp = Math.cos(this.cameraPitch);
    const sp = Math.sin(this.cameraPitch);
    // Arah pandang kamera: dari eye ke look (lihat render()).
    return {
      x: Math.sin(this.cameraYaw) * cp,
      y: -sp - 0.18,
      z: Math.cos(this.cameraYaw) * cp,
    };
  },

  tryShoot() {
    if (Game.state.mode !== 'playing') return null;
    const p = Game.state.player;
    if (p.mode !== 'foot') return null; // tak bisa menembak sambil mengemudi
    if (this.shootCooldown > 0) return null;
    this.shootCooldown = SHOOT_COOLDOWN_SECONDS;
    const s = Game.state;
    if ((s.ammo || 0) <= 0) {
      if (Audio && typeof Audio.playSFX === 'function') Audio.playSFX('emptyClick');
      return { fired: false, reason: 'empty' };
    }
    const origin = { x: p.x, y: (p.y || 0) + 1.35, z: p.z };
    // Bidik polisi terdekat (aim assist): arah lurus ke polisi itu.
    let targetCop = null;
    let bestD = 60;
    for (const cop of s.cops) {
      if (cop.hp <= 0) continue;
      const d = Math.hypot(cop.pos.x - p.x, cop.pos.z - p.z);
      if (d < bestD) { bestD = d; targetCop = cop; }
    }
    let dir;
    if (targetCop) {
      const dx = targetCop.pos.x - origin.x;
      const dy = 1.0 - origin.y;
      const dz = targetCop.pos.z - origin.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      dir = { x: dx / len, y: dy / len, z: dz / len };
    } else {
      dir = this.cameraForward();
    }
    const targets = s.cops
      .filter((c) => c.hp > 0)
      .map((c) => ({ id: c.id, type: 'police', x: c.pos.x, y: 1.0, z: c.pos.z, radius: 1.4, hp: c.hp }));
    let res = null;
    if (Shots && typeof Shots.fire === 'function') {
      res = Shots.fire(s, origin, dir, targets);
    }
    if (res && res.fired) {
      s.stats.shotsFired += 1;
      if (res.hit && res.target) {
        // Shots.fire hanya mengubah SALINAN target; terapkan damage
        // ke polisi asli lewat Game.shootCop (34 dmg: 100 -> 66).
        Game.shootCop(res.target.id, res.damage);
      }
    }
    if (Audio && typeof Audio.playShot === 'function') Audio.playShot();
    this.updateHud();
    return res;
  },

  // --- input -------------------------------------------------------
  readMoveInput() {
    const k = this.keys;
    const p = Game.state.player;
    const inVehicle = p.mode === 'car' || p.mode === 'boat';
    return {
      forward: !!(k['w'] || k['arrowup']),
      back: !!(k['s'] || k['arrowdown']),
      left: !!(k['a'] || k['arrowleft']),
      right: !!(k['d'] || k['arrowright']),
      run: !!k['shift'],
      jump: !inVehicle && !!k[' '],
      shoot: false,
      interact: false,
      handbrake: inVehicle && !!k[' '],
      cameraYaw: this.cameraYaw,
    };
  },

  // --- loop --------------------------------------------------------
  loop(now) {
    if (!this.running) return;
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;
    if (this.shootCooldown > 0) this.shootCooldown -= dt;

    if (Game.state.mode === 'playing') {
      const input = this.readMoveInput();
      const p = Game.state.player;
      const world = { city: this.city, water: this.water, vehicles: this.vehicles };
      if ((p.mode === 'car' || p.mode === 'boat') && p.vehicle) {
        if (Vehicles && typeof Vehicles.updateVehicle === 'function') {
          Vehicles.updateVehicle(p.vehicle, input, dt, world);
        }
        // Hadiah drift: +$50 per episode drift (cooldown 3 detik).
        const v = p.vehicle;
        if (v.kind === 'car' && v.drift && Math.abs(v.speed) > 10) {
          if (now - this._driftPaidAt > DRIFT_REWARD_COOLDOWN_MS) {
            this._driftPaidAt = now;
            Game.addCash(DRIFT_REWARD);
            Game.state.score += DRIFT_REWARD;
          }
        }
      }
      if (Player && typeof Player.update === 'function') {
        Player.update(p, input, dt, world);
      }
      if (Vehicles && typeof Vehicles.updateTraffic === 'function' && this.traffic.length) {
        Vehicles.updateTraffic(this.traffic, dt, this.city, this.vehicles);
      }
      if (Jobs) {
        if (typeof Jobs.updateMission === 'function') Jobs.updateMission(Game.state, dt);
        if (typeof Jobs.updateTaxiJob === 'function') Jobs.updateTaxiJob(Game.state);
        if (typeof Jobs.updateDeliveryJob === 'function') Jobs.updateDeliveryJob(Game.state, dt);
      }
      if (Shots && typeof Shots.update === 'function') Shots.update(dt);
      Game.update(dt);
    }

    // WASTED overlay juga saat mode berubah di luar loop (mis. damage
    // langsung): jangan hanya di dalam blok 'playing'.
    if (Game.state.mode === 'wasted') {
      this.setOverlay('wasted-overlay', true);
      this.updateHud();
    }

    this.render();
    this.updateHud();
    this.stats.frames += 1;
    requestAnimationFrame((t) => this.loop(t));
  },

  // --- mesh lokal (dibangun sekali, digambar pakai model matrix) ---
  modelMatrix(x, y, z, yaw) {
    const t = Math3.mat4Translate(x, y, z);
    const r = Math3.mat4RotateY(-yaw);
    return Math3.mat4Multiply(t, r);
  },

  localCarMesh(color) {
    if (this._carMeshes[color]) return this._carMeshes[color];
    const b = new Meshes.MeshBuilder();
    b.boxAt(0, 0.35, 0, 1.9, 0.55, 4.2, color);
    b.boxAt(0, 0.9, 0.3, 1.6, 0.5, 2.0, '#20242c');
    for (const [lx, lz] of [[-0.85, 1.4], [0.85, 1.4], [-0.85, -1.4], [0.85, -1.4]]) {
      b.boxAt(lx, 0.15, lz, 0.28, 0.55, 0.55, '#111114');
    }
    const mesh = b.build();
    this._carMeshes[color] = mesh;
    return mesh;
  },

  localBoatMesh(color) {
    if (this._boatMeshes[color]) return this._boatMeshes[color];
    const b = new Meshes.MeshBuilder();
    b.boxAt(0, 0.25, 0, 2.2, 0.5, 5.2, color);
    b.boxAt(0, 0.7, 0.8, 1.6, 0.45, 2.2, '#20242c');
    b.boxAt(0, 0.9, -1.6, 0.5, 0.9, 0.3, '#d8dee6');
    const mesh = b.build();
    this._boatMeshes[color] = mesh;
    return mesh;
  },

  localFigureMesh(color) {
    if (this._figureMesh) return this._figureMesh;
    const b = new Meshes.MeshBuilder();
    b.boxAt(-0.16, 0, 0, 0.26, 0.8, 0.3, '#2b3440');
    b.boxAt(0.16, 0, 0, 0.26, 0.8, 0.3, '#2b3440');
    b.boxAt(0, 0.8, 0, 0.72, 0.62, 0.4, color);
    b.boxAt(-0.48, 1.05, 0, 0.2, 0.55, 0.22, color);
    b.boxAt(0.48, 1.05, 0, 0.2, 0.55, 0.22, color);
    b.boxAt(0, 1.48, 0, 0.42, 0.4, 0.4, '#e8b98a');
    b.boxAt(0, 1.72, 0, 0.46, 0.1, 0.46, '#1a2f5a');
    const mesh = b.build();
    this._figureMesh = mesh;
    return mesh;
  },

  localHeliMesh() {
    if (this._heliMesh) return this._heliMesh;
    const b = new Meshes.MeshBuilder();
    b.boxAt(0, 0, 0, 2.2, 1.0, 4.6, '#1a2f5a');
    b.boxAt(0, 0.6, 0.6, 1.6, 0.7, 2.0, '#d8dee6');
    b.boxAt(0, 0.1, -3.0, 0.4, 0.4, 2.4, '#1a2f5a');
    b.boxAt(0, 1.15, 0, 5.4, 0.08, 0.3, '#22222a');
    const mesh = b.build();
    this._heliMesh = mesh;
    return mesh;
  },

  localMarkerMesh() {
    if (this._markerMesh) return this._markerMesh;
    const b = new Meshes.MeshBuilder();
    b.cylinder(0, 0, 0, 1.6, 0.3, '#ffe14d', 12);
    b.pyramid(0, 0.3, 0, 1.2, 2.2, '#ffe14d');
    const mesh = b.build();
    this._markerMesh = mesh;
    return mesh;
  },

  localTracerMesh() {
    if (this._tracerMesh) return this._tracerMesh;
    const b = new Meshes.MeshBuilder();
    b.boxAt(0, 0, 0, 0.08, 0.08, 1.0, '#ffe14d');
    const mesh = b.build();
    this._tracerMesh = mesh;
    return mesh;
  },

  // --- render ------------------------------------------------------
  render() {
    const gl = this.gl;
    if (!gl) return;
    GL.beginFrame();
    const canvas = this.canvas;
    const aspect = canvas.width / Math.max(1, canvas.height);
    const proj = Math3.mat4Perspective(Math3.degToRad(62), aspect, 0.1, 500);
    GL.setProj(proj);

    // Kamera third-person mengikuti pemain; SEMUA vektor objek {x,y,z}.
    const p = Game.state.player;
    const eye = {
      x: p.x - Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch) * this.cameraDistance,
      y: (p.y || 0) + 3 + Math.sin(this.cameraPitch) * this.cameraDistance,
      z: p.z - Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch) * this.cameraDistance,
    };
    const look = { x: p.x, y: (p.y || 0) + 1.4, z: p.z };
    const up = { x: 0, y: 1, z: 0 };
    const view = Math3.mat4LookAt(eye, look, up);
    GL.setView(view);

    // Warna langit senja + kecerahan mengikuti jam game.
    const hour = Game.state.timeOfDay;
    const dusk = hour >= 16.5 && hour <= 19.5;
    GL.setClearColor(dusk ? 0.98 : 0.53, dusk ? 0.55 : 0.75, dusk ? 0.35 : 0.94, 1);
    GL.setBrightness(dusk ? 0.95 : 1.0);
    GL.setSunDir({ x: -0.4, y: 0.55, z: -0.6 });

    const identity = Math3.mat4Identity();

    // Kota (219 bangunan, jalan, trotoar, tanah).
    if (City && typeof City.render === 'function') City.render(GL, Math3);

    // Laut + dermaga + buoy — Water.draw() SETIAP frame, tanpa kecuali.
    if (Water && this.water && typeof Water.draw === 'function') {
      const w = Water.draw(this.water, Game.state.elapsed);
      this.stats.waterDraws += 1;
      if (w.sea) GL.drawMesh(w.sea, identity);
      if (w.pier) GL.drawMesh(w.pier, identity);
      if (w.buoys) GL.drawMesh(w.buoys, identity);
    }

    // Kendaraan (mesh lokal + model matrix, dibangun sekali per warna).
    for (const v of this.vehicles) {
      const mesh = v.kind === 'boat' ? this.localBoatMesh(v.color) : this.localCarMesh(v.color);
      GL.drawMesh(mesh, this.modelMatrix(v.x, v.y || 0, v.z, v.yaw || 0));
    }

    // Pemain di jalan kaki (mesh animasi dari player.js; di-cache
    // selama posisi / walkCycle tak berubah jauh).
    if (p.mode === 'foot' || p.mode === 'swim') {
      if (Player && typeof Player.buildPlayerMesh === 'function') {
        const key = Math.round(p.x * 20) + ':' + Math.round(p.z * 20) + ':' +
          Math.round((p.walkCycle || 0) * 6) + ':' + (p.mode || '');
        // Rebuild paling cepat tiap 120 ms: mesh kecil, tapi tiap rebuild
        // mengalokasi buffer GL baru (prepareMesh meng-cache per mesh),
        // jadi rebuild tiap frame = bocor memori GPU saat berjalan.
        const nowMs = performance.now();
        if ((key !== this._playerMeshKey || !this._playerMesh) && nowMs - this._playerMeshAt > 120) {
          const m = Player.buildPlayerMesh(p);
          if (m) { this._playerMesh = m; this._playerMeshKey = key; this._playerMeshAt = nowMs; }
        }
        if (this._playerMesh) GL.drawMesh(this._playerMesh, identity);
      }
    }

    // Polisi (figur seragam gelap).
    for (const cop of Game.state.cops) {
      if (cop.hp <= 0) continue;
      GL.drawMesh(this.localFigureMesh('#1a2f5a'),
        this.modelMatrix(cop.pos.x, cop.pos.y || 0, cop.pos.z, 0));
    }

    // Heli AIR-1.
    const heli = Game.state.heli;
    if (heli && heli.active) {
      GL.drawMesh(this.localHeliMesh(),
        this.modelMatrix(heli.pos.x, heli.pos.y, heli.pos.z, 0));
    }

    // Marker misi aktif (tujuan kuning).
    if (Jobs && typeof Jobs.activeMarker === 'function') {
      const marker = Jobs.activeMarker();
      if (marker) {
        GL.drawMesh(this.localMarkerMesh(),
          this.modelMatrix(marker.x, 0, marker.z, 0));
      }
    }

    // Tracer tembakan (garis kuning dari moncong ke titik kena).
    if (Shots && typeof Shots.getTracers === 'function') {
      for (const t of Shots.getTracers()) {
        const mx = (t.from.x + t.to.x) / 2;
        const my = (t.from.y + t.to.y) / 2;
        const mz = (t.from.z + t.to.z) / 2;
        const dx = t.to.x - t.from.x;
        const dy = t.to.y - t.from.y;
        const dz = t.to.z - t.from.z;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const yaw = Math.atan2(dx, dz);
        const m = Math3.mat4Multiply(
          Math3.mat4Multiply(
            Math3.mat4Translate(mx, my, mz),
            Math3.mat4RotateY(yaw)),
          Math3.mat4Scale(1, 1, len));
        GL.drawMesh(this.localTracerMesh(), m);
      }
    }
  },

  updateHud() {
    if (!HUD || typeof HUD.render !== 'function') return;
    const s = Game.state;
    const p = s.player;
    let speed = 0;
    if (p.vehicle && typeof p.vehicle.speed === 'number') speed = Math.abs(p.vehicle.speed) * 3.6;
    else if (p.moving) speed = p.running ? 28.8 : 15.1;
    let radio = null;
    if (Audio && typeof Audio.getCurrentStation === 'function') {
      radio = Audio.getCurrentStation();
    }
    let objective = '';
    if (Jobs && typeof Jobs.objectiveText === 'function') objective = Jobs.objectiveText();
    let marker = null;
    if (Jobs && typeof Jobs.activeMarker === 'function') marker = Jobs.activeMarker();
    HUD.render({
      cash: s.cash,
      health: s.health,
      maxHealth: 100,
      wanted: s.wanted,
      score: s.score,
      rep: s.rep,
      timeOfDay: s.timeOfDay,
      weather: s.weather,
      ammo: s.ammo,
      speed,
      speedUnit: 'km/h',
      radio,
      objective,
      player: { x: p.x, z: p.z, heading: p.yaw || 0 },
      police: s.cops.map((c) => ({ x: c.pos.x, z: c.pos.z })),
      missionMarker: marker,
      worldSize: 480,
      crosshair: { visible: s.mode === 'playing' && p.mode === 'foot', spread: 6 },
    });
    this.stats.hudRenders += 1;
  },

  loadSaveIntoHud() {
    const saved = Game.load();
    if (saved) Game.state = saved;
    this.updateHud();
  },

  saveNow() {
    return Game.save();
  },
};

SB.Main = Main;

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    try {
      Main.init();
    } catch (err) {
      console.error('[Sunset Bay] gagal init:', err);
      const el = document.getElementById('load-error');
      if (el) {
        el.textContent = 'Gagal memuat game: ' + err.message;
        el.style.display = 'block';
      }
    }
  });
}

export { Main, SAVE_KEY };
export default Main;
