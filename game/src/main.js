// main.js — Sunset Bay v6 integration.
// Wires renderer (gl.js) + city + water + traffic + game state + player +
// HUD (index.html ids) + audio + screenshot staging.
// Real APIs: createRenderer->{draw,setCamera,setSun,clear,resize};
// buildCity(seed); buildWater(seed)/boatUpdate; createTraffic(city,seed,count);
// createGame(city,rng)->{G,update,startMission,missionState,addCash,setWanted,
// commitCrime,startTaxi,buyUpgrade,save,load,reset,applySave,...};
// player object from game.js: {pos,vel,yaw,health,armor,weapon,ammo,weapons,
// update,punch,shoot,takeDamage,selectWeapon}. Angles: x=cos(a), z=sin(a).
import { createRenderer } from './gl.js';
import { buildCity } from './city.js';
import { buildWater, boatUpdate } from './water.js';
import { createTraffic } from './vehicles.js';
import { createGame, STASH_SPOTS, SAVE_KEY } from './game.js';
import { MISSIONS } from './jobs.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { applyShot, SHOTS } from './shots.js';
import { makeRng } from './rng.js';
import { box, carMesh, personMesh, boatMesh, buildingMesh } from './meshes.js';
import { mat4Trans, mat4RotY, mat4Mul } from './math3.js';

const SAVE_EVERY_MS = 20000;
const $ = (id) => document.getElementById(id);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
function fmtClock(h) {
  h = ((h % 24) + 24) % 24;
  const hh = Math.floor(h) % 12 || 12, mm = String(Math.floor((h % 1) * 60)).padStart(2, '0');
  return hh + ':' + mm + ' ' + (h < 12 ? 'AM' : 'PM');
}
function hexRgb(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function hslRgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}
function readSaveRaw() {
  try { const raw = localStorage.getItem(SAVE_KEY); return raw ? JSON.parse(raw) : null; }
  catch (e) { return null; }
}

export function startGame(opts) { return init((opts && opts.canvasId) || 'game-canvas', opts || {}); }

export function init(canvasId, opts) {
  const o = opts || {};
  const canvas = $(canvasId);
  if (!canvas) throw new Error('Canvas #' + canvasId + ' not found');
  const q = new URLSearchParams(window.location.search);
  const seed = parseInt(q.get('seed') || o.seed || String((Math.random() * 1e9) | 0), 10) || 7;
  const shotName = q.get('shot') || o.shot || null;
  const shotMode = !!shotName && !!SHOTS[shotName];

  // --- world / state -------------------------------------------------------
  const city = buildCity(seed);
  const water = buildWater(seed);
  const traffic = createTraffic(city, seed, 14);
  const spawn = city.findClearSpot(city.spawn.x, city.spawn.z, 30);
  function collideCircle(x, z, r) {
    let cx = x, cz = z, hit = false;
    for (const c of city.colliders) {
      const nx = Math.max(c.x0, Math.min(cx, c.x1)), nz = Math.max(c.z0, Math.min(cz, c.z1));
      let dx = cx - nx, dz = cz - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      hit = true;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        cx = nx + (dx / d) * r; cz = nz + (dz / d) * r;
      } else {
        const pl = cx - c.x0, pr = c.x1 - cx, pt = cz - c.z0, pb = c.z1 - cz;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) cx = c.x0 - r; else if (m === pr) cx = c.x1 + r;
        else if (m === pt) cz = c.z0 - r; else cz = c.z1 + r;
      }
    }
    return hit ? { x: cx, z: cz } : null;
  }
  const cityEx = Object.assign({}, city, { SPAWN: spawn, SAFEHOUSE: spawn, collideCircle });
  const game = createGame(cityEx, makeRng(seed));
  const G = game.G;
  G.seed = seed; G.worldSize = 840;
  G.districts = city.districts; G.roads = city.roads; G.pois = city.pois;
  G.maxHealth = 100; G.maxArmor = 100;
  G.radioName = 'BAY FM';
  G.started = false; G.paused = false; G.mapOpen = false;
  G.mission = null; G.missionList = [];
  G.stash = 0; G.timeOfDay = G.clock; G.timeLabel = fmtClock(G.clock);
  G.shotScene = null; G.shotLabel = null;
  const boatObj = { kind: 'boat', x: water.boatSpawn.x, z: water.boatSpawn.z, angle: water.boatSpawn.angle, speed: 0, max: 30, color: '#ff7a3c' };
  G.player.boat = boatObj;
  G.player.x = G.player.pos.x; G.player.z = G.player.pos.z; G.player.heading = G.player.yaw;

  // --- renderer + cached meshes (same objects every frame: gl.js WeakMap) ---
  const renderer = createRenderer(canvas);
  const ground = box(840, 1, 840, [0.13, 0.17, 0.13]);
  const sea = box(244, 1, 840, [0.05, 0.25, 0.45]);
  const beach = box(26, 1, 660, [0.76, 0.7, 0.5]);
  const roadX = box(672, 0.12, 6, [0.14, 0.14, 0.16]);
  const roadZ = box(6, 0.12, 672, [0.14, 0.14, 0.16]);
  const carWhite = carMesh([1, 1, 1]);
  const person = personMesh([0.9, 0.3, 0.2], [0.85, 0.65, 0.5]);
  const boatM = boatMesh([1, 0.55, 0.25]);
  const marker = box(2, 7, 2, [1, 0.85, 0.2]);
  const stashM = box(1.2, 1.2, 1.2, [1, 0.85, 0.2]);
  const safeM = box(1.2, 1.2, 1.2, [1, 0.5, 0.85]);
  const heliM = box(3.4, 0.9, 1.8, [0.15, 0.2, 0.35]);
  const bMeshes = city.buildings.map((b) => ({ b, m: buildingMesh(b.w, b.h, b.d, [1, 0.85, 0.55]) }));

  // --- HUD + audio ---------------------------------------------------------
  const hud = createHud(document.body);
  const audio = createAudio();

  // --- title / pause screens (from index.html) -----------------------------
  const titleEl = $('title-screen'), pauseEl = $('pause-screen');
  const hudEl = $('hud'), loadEl = $('loading');
  const btnNew = $('btn-new'), btnCont = $('btn-continue'), btnHow = $('btn-howto');
  const howto = $('howto-panel'), saveInfo = $('save-info');
  let everStarted = false;
  let lastDone = 0, lastBusted = 0, lastWasted = 0, lastCashRef = null;
  let lastMissionIdx = -1, lastSave = 0;

  function refreshContinueBtn() {
    const s = readSaveRaw();
    if (s) {
      btnCont.classList.remove('hidden');
      btnCont.textContent = 'Continue — $' + Math.floor(s.money || 0);
      saveInfo.textContent = 'Save found — $' + Math.floor(s.money || 0) + ' • ' +
        ((s.stats && s.stats.missionsDone) || 0) + ' jobs done • REP ' + (s.rep || 0);
    } else {
      btnCont.classList.add('hidden');
      saveInfo.textContent = '';
    }
  }
  function refreshMissionList() {
    const ms = game.missionState();
    G.missionList = MISSIONS.map((m, i) => ({
      name: m.name,
      stageLabel: i < G.missionIndex ? 'Complete' : (i === G.missionIndex ? (ms ? ms.stage.text : m.stages[0].text) : 'Locked'),
      done: i < G.missionIndex,
    }));
    hud.refreshMissions(G.missionList);
  }
  function syncWeapons() {
    const pl = G.player;
    G.weapons = pl.weapons.map((w, i) => ({ name: w.name, ammo: pl.ammo[i], reserve: null, active: pl.weapon === i }));
  }
  function postReset() {
    G.seed = seed; G.worldSize = 840;
    G.districts = city.districts; G.roads = city.roads; G.pois = city.pois;
    G.maxHealth = 100; G.maxArmor = 100;
    G.radioName = audio.stationName();
    G.started = false; G.paused = false; G.mapOpen = false;
    G.mission = null; G.missionList = [];
    G.stash = 0; G.timeOfDay = G.clock; G.timeLabel = fmtClock(G.clock);
    G.player.boat = boatObj;
    lastDone = 0; lastBusted = 0; lastWasted = 0; lastCashRef = null; lastMissionIdx = -1;
  }
  function begin(isContinue) {
    if (G.started) return;
    if (isContinue && !game.load()) hud.toast('Save could not be loaded');
    everStarted = true;
    titleEl.classList.add('hidden');
    hudEl.classList.remove('hidden');
    G.started = true;
    audio.sfx('click');
    if (!G.missionActive && !G.over) game.startMission();
    refreshMissionList();
    syncWeapons();
    hud.toast(isContinue ? 'Save loaded — welcome back' : 'Welcome to Sunset Bay — follow the gold marker');
  }
  function setPaused(on) {
    G.paused = !!on;
    pauseEl.classList.toggle('hidden', !on);
    if (on && G.mapOpen) toggleMap();
    if (!on && G.started) hud.toast('Resumed');
  }
  function toggleMap() {
    if (!G.started) return;
    G.mapOpen = !G.mapOpen;
    hud.showMap(G.mapOpen, G);
    if (G.paused) pauseEl.classList.toggle('hidden', G.mapOpen);
  }
  refreshContinueBtn();
  btnNew.addEventListener('click', () => { if (everStarted) { game.reset(); postReset(); } begin(false); });
  btnCont.addEventListener('click', () => begin(true));
  btnHow.addEventListener('click', () => howto.classList.toggle('hidden'));
  $('btn-resume').addEventListener('click', () => setPaused(false));
  $('btn-map').addEventListener('click', () => toggleMap());
  $('btn-restart').addEventListener('click', () => {
    if (!G.started) return;
    game.startMission(G.missionIndex);
    setPaused(false);
    hud.toast('Job restarted');
  });
  $('btn-quit').addEventListener('click', () => {
    G.started = false;
    setPaused(false);
    if (G.mapOpen) toggleMap();
    hudEl.classList.add('hidden');
    titleEl.classList.remove('hidden');
    refreshContinueBtn();
  });

  // --- combat / crime / vehicle actions ------------------------------------
  const keys = new Set();
  let lastShotAt = 0, lastHitCrimeAt = 0;
  function policeTargets() {
    for (const c of G.police) {
      c.pos = c.pos || { x: 0, z: 0 };
      c.pos.x = c.x; c.pos.z = c.z;
    }
    return G.police;
  }
  function reapDeadCops() {
    for (let i = G.police.length - 1; i >= 0; i--) {
      if (G.police[i].hp <= 0) {
        G.police.splice(i, 1);
        game.commitCrime('kill');
        hud.toast('Officer down — heat up!');
      }
    }
  }
  function punch() {
    if (!G.started || G.paused || G.mapOpen || shotMode) return;
    const res = G.player.punch(policeTargets());
    audio.sfx('punch');
    if (res && res.hit) { game.commitCrime('hit'); reapDeadCops(); }
  }
  function fire() {
    if (!G.started || G.paused || G.mapOpen || shotMode) return;
    const now = performance.now();
    if (now - lastShotAt < 140) return;
    lastShotAt = now;
    const pl = G.player;
    if (pl.weapon === 0) { punch(); return; }
    const res = pl.shoot(policeTargets());
    if (!res) return;
    if (res.empty) { hud.toast('Out of ammo'); audio.sfx('click'); return; }
    audio.sfx('shoot');
    if (res.hit) { game.commitCrime('shoot'); reapDeadCops(); }
    syncWeapons();
  }
  function selectWeapon(i) {
    G.player.selectWeapon(i);
    syncWeapons();
    hud.setCrosshair(i !== 0);
    hud.toast(G.player.weapons[i].name + ' ready');
    audio.sfx('click');
  }
  function toggleVehicle() {
    const pl = G.player;
    if (pl.vehicle) {
      traffic.exitCar(pl);
      G.vehicle = null;
      audio.sfx('engineStop');
      hud.toast('On foot');
      return;
    }
    const ride = traffic.enterNearest(pl);
    if (!ride) { hud.toast('No vehicle close by'); return; }
    if (ride.baseMax == null) ride.baseMax = ride.max || 32;
    ride.max = ride.baseMax * (1 + 0.15 * (G.upgrades.engine || 0));
    G.vehicle = ride;
    game.commitCrime('steal');
    audio.sfx('engine');
    hud.toast(ride.kind === 'boat' ? 'Speedboat taken — open water!' : 'Vehicle taken — drive!');
  }
  function respray() {
    const v = G.vehicle;
    if (!v) { punch(); return; }
    if (G.money < 150) { hud.toast('Respray costs $150'); return; }
    if (G.wanted === 0 && !(v.damage > 0)) { hud.toast('Already clean — no heat'); return; }
    game.addCash(-150, 'respray');
    game.setWanted(0);
    v.damage = 0;
    audio.sfx('pickup');
    hud.toast('Respray — heat gone, car repaired');
  }
  function buyEngine() {
    if (game.buyUpgrade('engine')) {
      hud.toast('Engine upgrade Lv ' + G.upgrades.engine);
      audio.sfx('mission');
    } else {
      hud.toast(G.upgrades.engine >= 3 ? 'Engine maxed out' : 'Need $' + (300 * (G.upgrades.engine + 1)));
    }
  }

  // --- input ---------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); if (G.started && !shotMode) toggleMap(); return; }
    if (G.started && (e.key === ' ' || e.key.indexOf('Arrow') === 0)) e.preventDefault();
    if (e.key === 'Enter' && !G.started && !shotMode) { begin(false); return; }
    keys.add(e.key.toLowerCase());
    if (!G.started || G.paused || shotMode) {
      if (e.key === 'p' || e.key === 'P') setPaused(false);
      else if (e.key === 'Escape' && G.mapOpen) toggleMap();
      else if (e.key === 'Escape' && G.paused) setPaused(false);
      return;
    }
    const lk = e.key.toLowerCase();
    if (lk === 'm') { const st = audio.nextStation(); G.radioName = st; hud.toast('Radio: ' + st); }
    else if (lk === 'n') { hud.toast(audio.toggleMute() ? 'Muted' : 'Sound on — ' + audio.stationName()); }
    else if (lk === 'p' || e.key === 'Escape') { if (G.mapOpen) toggleMap(); else setPaused(true); }
    else if (lk === 'e') toggleVehicle();
    else if (lk === 'f') { if (G.player.vehicle) respray(); else punch(); }
    else if (lk === 'u') buyEngine();
    else if (lk >= '1' && lk <= '4') selectWeapon(parseInt(lk, 10) - 1);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  canvas.addEventListener('mousedown', (e) => { if (e.button === 0) fire(); });
  window.addEventListener('resize', () => { try { renderer.resize(window.innerWidth, window.innerHeight); } catch (err) {} });

  // --- camera (third person, BEHIND facing dir — never flipped) -------------
  const cam = { x: 0, y: 6, z: -12, lookX: 0, lookY: 1.5, lookZ: 0 };
  function updateCamera() {
    const pl = G.player, h = pl.yaw || 0;
    const fx = Math.sin(h), fz = Math.cos(h);
    const inCar = !!pl.vehicle;
    const dist = inCar ? 11 : 8, height = inCar ? 5 : 4.2;
    cam.x = pl.pos.x - fx * dist;
    cam.y = height;
    cam.z = pl.pos.z - fz * dist;
    cam.lookX = pl.pos.x + fx * 5;
    cam.lookY = 1.6;
    cam.lookZ = pl.pos.z + fz * 5;
  }

  // --- render (one cached mesh object per shape; gl.js caches buffers) -----
  function drawAt(mesh, x, y, z, angle, tint) {
    const m = angle ? mat4Mul(mat4Trans(x, y, z), mat4RotY(-angle)) : mat4Trans(x, y, z);
    renderer.draw(mesh, m, tint || [1, 1, 1]);
  }
  function render(now) {
    renderer.clear();
    renderer.setSun(G.clock);
    renderer.setCamera([cam.x, cam.y, cam.z], [cam.lookX, cam.lookY, cam.lookZ], [0, 1, 0]);
    const pl = G.player;
    renderer.draw(ground, mat4Trans(0, -0.5, 0));
    renderer.draw(sea, mat4Trans(440, -0.4, 0));
    renderer.draw(beach, mat4Trans(305, -0.45, 0));
    for (const r of city.roads) {
      if (r.axis === 'x') renderer.draw(roadX, mat4Trans(0, 0.02, r.at));
      else renderer.draw(roadZ, mat4Trans(r.at, 0.02, 0));
    }
    for (const bm of bMeshes) {
      renderer.draw(bm.m, mat4Trans(bm.b.x, bm.b.y, bm.b.z), hslRgb(bm.b.hue, 0.25, 0.75));
    }
    for (const c of traffic.cars) drawAt(carWhite, c.x, 0, c.z, c.angle, hexRgb(c.color));
    for (const c of traffic.parked) drawAt(carWhite, c.x, 0, c.z, c.angle, hexRgb(c.color));
    // Player's own vehicle (in shot mode this is a staged object, not a
    // traffic car; in normal play it is a traffic car drawn twice harmlessly).
    if (G.vehicle && G.vehicle.kind !== 'boat') {
      drawAt(carWhite, G.vehicle.x, 0, G.vehicle.z, G.vehicle.angle || G.vehicle.heading || 0,
        G.vehicle.color ? hexRgb(G.vehicle.color) : [0.85, 0.25, 0.2]);
    }
    drawAt(boatM, boatObj.x, 0, boatObj.z, boatObj.angle);
    if (!pl.vehicle) drawAt(person, pl.pos.x, 0, pl.pos.z, pl.yaw);
    for (const c of G.police) {
      drawAt(carWhite, c.x, 0, c.z, Math.atan2(pl.pos.z - c.z, pl.pos.x - c.x), [0.15, 0.35, 0.95]);
    }
    if (G.heli) renderer.draw(heliM, mat4Trans(G.heli.x, 55, G.heli.z));
    if (G.mission && G.mission.target) {
      const bob = 3.5 + Math.sin(now / 300) * 0.5;
      renderer.draw(marker, mat4Trans(G.mission.target.x, bob, G.mission.target.z));
    }
    if (G.taxi) {
      const t = G.taxi.stage === 'pickup' ? G.taxi.pickup : G.taxi.dropoff;
      renderer.draw(marker, mat4Trans(t.x, 3.5, t.z), [0.3, 0.8, 1]);
    }
    for (const s of STASH_SPOTS) {
      if (G.stashFound.indexOf(s.id) === -1) renderer.draw(stashM, mat4Trans(s.x, 0.6, s.z));
    }
    renderer.draw(safeM, mat4Trans(spawn.x, 0.6, spawn.z));
  }
  function nearestRideDist(pl) {
    let bd = Infinity;
    for (const c of traffic.cars) {
      const d = Math.hypot(c.x - pl.pos.x, c.z - pl.pos.z);
      if (d < bd) bd = d;
    }
    for (const c of traffic.parked) {
      const d = Math.hypot(c.x - pl.pos.x, c.z - pl.pos.z);
      if (d < bd) bd = d;
    }
    const db = Math.hypot(boatObj.x - pl.pos.x, boatObj.z - pl.pos.z);
    return Math.min(bd, db);
  }

  // --- shot mode: staged scene, frozen (no sim), HUD/title hidden ----------
  if (shotMode) {
    applyShot(shotName, G);
    const pl = G.player;
    if (typeof pl.x === 'number') pl.pos.x = pl.x;
    if (typeof pl.z === 'number') pl.pos.z = pl.z;
    if (typeof pl.heading === 'number') pl.yaw = pl.heading;
    pl.heading = pl.yaw;
    pl.x = pl.pos.x; pl.z = pl.pos.z; pl.angle = pl.yaw;
    G.clock = G.timeOfDay;
    titleEl.classList.add('hidden');
    loadEl.classList.add('hidden');
    G.started = true;
  } else {
    loadEl.classList.add('hidden');
  }

  // --- main loop -----------------------------------------------------------
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;
    if (dt <= 0) dt = 0.016;
    if (!shotMode && G.started && !G.paused) {
      const pl = G.player;
      const fwd = keys.has('w') || keys.has('arrowup');
      const back = keys.has('s') || keys.has('arrowdown');
      const left = keys.has('a') || keys.has('arrowleft');
      const right = keys.has('d') || keys.has('arrowright');
      const sprint = keys.has('shift');
      const brake = keys.has(' ');
      const inCar = !!pl.vehicle;
      const prevDamage = inCar ? (pl.vehicle.damage || 0) : 0;
      pl.x = pl.pos.x; pl.z = pl.pos.z; pl.angle = pl.yaw; pl.speed = G.speed;
      let gameInput;
      if (inCar) {
        pl.input = { throttle: fwd ? 1 : (back ? -1 : 0), steer: left ? -1 : (right ? 1 : 0), handbrake: brake };
        gameInput = { x: 0, z: 0, sprint: false, yaw: pl.yaw };
      } else {
        if (left) pl.yaw -= 2.2 * dt;
        if (right) pl.yaw += 2.2 * dt;
        gameInput = { x: 0, z: fwd ? 1 : (back ? -1 : 0), sprint, yaw: pl.yaw };
      }
      game.update(dt, gameInput);
      if (!G.vehicle && pl.vehicle) { pl.vehicle = null; pl.inCar = false; pl.speed = 0; }
      pl.x = pl.pos.x; pl.z = pl.pos.z; pl.angle = pl.yaw; pl.heading = pl.yaw;
      if (pl.vehicle) pl.speed = G.speed;
      traffic.update(dt, pl, G.wanted);
      if (pl.vehicle) {
        if (pl.vehicle.kind === 'boat') {
          boatUpdate(pl.vehicle, { throttle: fwd ? 1 : (back ? -1 : 0), steer: left ? -1 : (right ? 1 : 0) }, dt);
          pl.pos.x = pl.vehicle.x; pl.pos.z = pl.vehicle.z; pl.yaw = pl.vehicle.angle;
          pl.speed = pl.vehicle.speed;
        } else {
          pl.pos.x = pl.x; pl.pos.z = pl.z; pl.yaw = pl.angle;
          G.vehicle = pl.vehicle;
          G.vehicle.speed = pl.speed;
          G.vehicle.drifting = brake && Math.abs(pl.speed) > 8;
          if ((pl.vehicle.damage || 0) > prevDamage + 0.001 && now - lastHitCrimeAt > 1000) {
            lastHitCrimeAt = now;
            game.commitCrime('hit');
            audio.sfx('crash');
            hud.toast('Crash! The cops noticed');
          }
        }
        G.speed = pl.speed;
      } else {
        G.vehicle = null;
      }
      pl.x = pl.pos.x; pl.z = pl.pos.z; pl.angle = pl.yaw; pl.heading = pl.yaw;
      policeTargets();
      const ms = game.missionState();
      if (ms) {
        G.mission = {
          name: ms.name,
          stageLabel: 'Stage ' + (ms.stageIndex + 1) + ' of ' + ms.stageTotal + ' — ' + ms.stage.text,
          target: { x: ms.stage.x, z: ms.stage.z },
          distance: Math.hypot(ms.stage.x - pl.pos.x, ms.stage.z - pl.pos.z),
          stageIndex: ms.stageIndex, stageTotal: ms.stageTotal,
        };
      } else G.mission = null;
      if (G.stats.missionsDone !== lastDone) {
        lastDone = G.stats.missionsDone;
        const lc = G.lastCash;
        hud.toast('Job complete: ' + (lc ? lc.why.replace('mission:', '') : '') + ' +$' + (lc ? lc.n : 0));
        audio.sfx('mission');
        game.save();
        if (!G.over) { game.startMission(); refreshMissionList(); }
        else hud.toast('All 18 jobs done — you own the bay!');
      }
      if (G.stats.busted !== lastBusted) { lastBusted = G.stats.busted; hud.toast('BUSTED — lost 10% cash'); audio.sfx('fail'); }
      if (G.stats.wasted !== lastWasted) { lastWasted = G.stats.wasted; hud.toast('WASTED — lost 10% cash'); audio.sfx('fail'); }
      if (G.lastCash !== lastCashRef) {
        lastCashRef = G.lastCash;
        if (G.lastCash && G.lastCash.why) {
          if (G.lastCash.why.indexOf('stash:') === 0) { hud.toast('Stash found +$100'); audio.sfx('pickup'); }
          else if (G.lastCash.why === 'taxi') { hud.toast('Taxi fare +$' + G.lastCash.n); audio.sfx('pickup'); }
        }
      }
      G.stash = G.stashFound.length * 100;
      G.timeOfDay = G.clock; G.timeLabel = fmtClock(G.clock);
      G.radioName = audio.stationName();
      syncWeapons();
      if (G.missionIndex !== lastMissionIdx) { lastMissionIdx = G.missionIndex; refreshMissionList(); }
      if (!pl.vehicle) hud.setPrompt(nearestRideDist(pl) < 7.5 ? 'Press E to take the vehicle' : null);
      else hud.setPrompt('E exit  •  F respray $150  •  SPACE drift');
      if (now - lastSave > SAVE_EVERY_MS) { lastSave = now; game.save(); }
    }
    updateCamera();
    render(now);
    if (G.started && !shotMode) hud.update(G);
  }
  requestAnimationFrame(frame);
  try { renderer.resize(window.innerWidth, window.innerHeight); } catch (err) {}

  window.__SB = {
    G, game, traffic, city, water, boat: boatObj, hud, audio, renderer,
    save: () => game.save(), load: () => game.load(),
    startMission: (i) => game.startMission(i), setWanted: (n) => game.setWanted(n),
    commitCrime: (k) => game.commitCrime(k), buyUpgrade: (k) => game.buyUpgrade(k),
  };
  return { G, game, hud, audio, cam, traffic, save: () => game.save(), load: () => game.load(), setPaused, begin };
}

// Bootstrap: index.html loads this module as the game entry point.
init('game-canvas', {});
