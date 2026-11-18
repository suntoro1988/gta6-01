// Sunset Bay — entry point: boots the world, wires input, runs the
// fixed-step loop, steers the chase camera and paints every frame.
//
// The simulation itself lives in game.js; this file only assembles the
// pieces (renderer, city, player, cars, HUD, radio) and keeps them in
// step. ?seed=N pins the world, ?shot=start|play|foot|end stages one
// screenshot scene instead of starting the loop, then sets
// window.__shotReady once the frame is painted.
import { createRenderer } from './gl.js';
import { matIdentity, matModel, matModelScale, matModelTilt, turnToward, clamp } from './math3.js';
import { buildCityMesh, PLACES } from './city.js';
import { Game, PLAYER_CAR_COLOR } from './game.js';
import {
  buildAmmoMesh, buildBeaconMesh, buildCarMesh, buildCoinMesh, buildHeliMesh,
  buildLightBarMesh, buildMarkerMesh, buildPersonMesh, buildRotorMesh,
  buildShadowMesh, buildStashMesh, buildTracerMesh,
} from './meshes.js';
import { createHud, updateHud } from './hud.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';

function el(id) {
  return document.getElementById(id);
}

// --- Boot settings -------------------------------------------------------
const STEP = 1 / 60; // simulation ticks per second
const IDENTITY = matIdentity();
const SUN = [-0.877, 0.28, -0.329]; // low dusk sun
const SKY = {
  top: [0.3, 0.18, 0.52],
  mid: [0.98, 0.45, 0.3],
  bot: [1.0, 0.68, 0.38],
};

// A ?seed=N query pins the world; without one the seed is random.
function readSeed() {
  const raw = new URLSearchParams(location.search).get('seed');
  const parsed = Number.parseInt(raw ?? '', 10);
  if (Number.isInteger(parsed)) return parsed;
  return (Math.random() * 4294967296) | 0;
}

const seed = readSeed();
const shot = new URLSearchParams(location.search).get('shot');

const canvas = el('game');
const renderer = createRenderer(canvas);
const game = new Game(seed);
window.__game = game; // debug hook: live state for playtesting (read-only use)
const hud = createHud();
const audio = createAudio();

// --- Meshes --------------------------------------------------------------
// One upload per distinct paint job / outfit, reused across every car and
// pedestrian that shares it. The city itself is a single static mesh.
const cityMesh = renderer.upload(buildCityMesh(game.city));

function makeCache(build) {
  const seen = new Map();
  return (key, ...args) => {
    let mesh = seen.get(key);
    if (!mesh) {
      mesh = renderer.upload(build(...args));
      seen.set(key, mesh);
    }
    return mesh;
  };
}

const carMeshFor = makeCache((color) => buildCarMesh(color));
function carMesh(color) {
  return carMeshFor(color.join(','), color);
}
const personMeshFor = makeCache((shirt, skin) => buildPersonMesh(shirt, skin));
function personMesh(p) {
  return personMeshFor(`${p.shirt.join(',')}|${p.skin.join(',')}`, p.shirt, p.skin);
}

const shadowMesh = renderer.upload(buildShadowMesh());
const coinMesh = renderer.upload(buildCoinMesh());
const stashMesh = renderer.upload(buildStashMesh());
const ammoMesh = renderer.upload(buildAmmoMesh());
const beaconMesh = renderer.upload(buildBeaconMesh());
const lightBarMesh = renderer.upload(buildLightBarMesh());
const heliMesh = renderer.upload(buildHeliMesh());
const rotorMesh = renderer.upload(buildRotorMesh());
const tracerMesh = renderer.upload(buildTracerMesh());
const markerMesh = renderer.upload(buildMarkerMesh());

// The player reads at a glance in a crowd: red shirt, warm skin.
function ensurePlayerLook() {
  if (game.player.shirt) return;
  game.player.shirt = [0.9, 0.25, 0.2];
  game.player.skin = [0.9, 0.7, 0.55];
}

// --- Camera --------------------------------------------------------------
// A low, close chase orbit — never a far top-down view. Dragging orbits
// freely for three seconds; after that the camera eases back behind the
// car the player is driving.
const camera = { yaw: Math.PI, pitch: 0.26, dist: 12, target: [0, 2, 0] };
let userUntil = 0;

function cameraEye() {
  const { yaw, pitch, dist, target } = camera;
  return [
    target[0] + Math.sin(yaw) * Math.cos(pitch) * dist,
    target[1] + Math.sin(pitch) * dist,
    target[2] + Math.cos(yaw) * Math.cos(pitch) * dist,
  ];
}

function followTarget(dt) {
  const focus = game.playerCar
    ? [game.playerCar.x, 1.8, game.playerCar.z]
    : [game.player.x, 1.7, game.player.z];
  for (let i = 0; i < 3; i += 1) {
    camera.target[i] += (focus[i] - camera.target[i]) * 0.25;
  }
  if (game.playerCar && performance.now() > userUntil) {
    camera.yaw = turnToward(camera.yaw, game.playerCar.heading + Math.PI, 1.4 * dt);
  }
}

// --- Input ---------------------------------------------------------------
const keys = {};
const input = {
  forward: false, back: false, left: false, right: false, run: false, handbrake: false,
};

function refreshInput() {
  input.forward = !!(keys.KeyW || keys.ArrowUp);
  input.back = !!(keys.KeyS || keys.ArrowDown);
  input.left = !!(keys.KeyA || keys.ArrowLeft);
  input.right = !!(keys.KeyD || keys.ArrowRight);
  input.run = !!(keys.ShiftLeft || keys.ShiftRight);
  input.handbrake = !!keys.Space;
}

let paused = false;
let mapOpen = false;
let dragging = false;
let dragDist = 0;
let lastPointerX = 0;
let lastPointerY = 0;

// --- Save ----------------------------------------------------------------
// Best cash, jobs done and cars stolen persist in localStorage, so the
// title screen can offer a Continue that resumes the run.
const SAVE_KEY = 'sunset-bay-save-v1';

const save = {
  data: null,

  load() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SAVE_KEY));
      this.data = parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      this.data = null;
    }
    return this.data;
  },

  persist() {
    try {
      const data = {
        money: game.money,
        jobsDone: game.jobsDone,
        carsStolen: game.carsStolen,
        bestCash: Math.max(this.data?.bestCash || 0, game.money),
        // v2 fields: upgrades, ammo, weapon and armour ride along; a v1
        // save simply lacks them and loads the defaults below.
        upgrades: { ...game.upgrades },
        ammo: { ...game.ammo },
        weaponIndex: game.weaponIndex,
        armour: game.armour,
        // v3: the stash hunt rides along too; a v2 save lacks it and
        // starts at 0/6.
        stashesCollected: game.stashesCollected,
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      this.data = data;
    } catch {
      // Storage unavailable (private mode, etc.): play on without it.
    }
  },

  showBestLine() {
    const s = this.data;
    if (!s || !(s.bestCash > 0 || s.jobsDone > 0 || s.carsStolen > 0)) return;
    const line = el('best-line');
    line.textContent = `Best run: $${(s.bestCash || 0).toLocaleString('en-US')} · ${s.jobsDone || 0} jobs done · ${s.carsStolen || 0} cars stolen`;
    line.style.display = 'block';
    el('continue-btn').style.display = 'block';
  },

  // Fold a saved run back into the fresh world: progress carries over,
  // while the stash packs already found are marked taken so a Continue
  // can never collect more than 6 in total.
  applyToGame() {
    const s = this.data;
    if (!s) return;
    game.money = s.money || 0;
    game.jobsDone = s.jobsDone || 0;
    game.carsStolen = s.carsStolen || 0;
    if (s.upgrades) game.upgrades = { ...game.upgrades, ...s.upgrades };
    if (s.ammo) {
      game.ammo = { ...game.ammo, ...s.ammo };
      for (const key of Object.keys(game.ammo)) {
        if (game.ammo[key] > 0) game.unlocked[key] = true;
      }
    }
    if (Number.isInteger(s.weaponIndex)) game.weaponIndex = s.weaponIndex;
    if (typeof s.armour === 'number') game.armour = s.armour;
    if (typeof s.stashesCollected === 'number') {
      game.stashesCollected = s.stashesCollected;
      let left = game.stashesCollected;
      for (const pack of game.pickups) {
        if (left <= 0) break;
        if (pack.kind === 'stash' && !pack.taken) {
          pack.taken = true;
          left -= 1;
        }
      }
    }
  },
};

save.load();
save.showBestLine();
window.addEventListener('beforeunload', () => {
  if (game.state === 'playing') save.persist();
});

// --- Game flow -----------------------------------------------------------
function startGame(fromContinue = false) {
  if (game.state !== 'title') return;
  audio.unlock();
  if (fromContinue) save.applyToGame();
  game.state = 'playing';
  audio.startRadio();
  game.radioStationName = audio.stationName;
  game.radioTrack = audio.currentTrack;
  game.setMessage('Steal a car with E, then follow the golden beacon!');
}

function restartGame() {
  paused = false;
  mapOpen = false;
  audio.unlock();
  game.restart();
  ensurePlayerLook();
  camera.yaw = game.player.heading + Math.PI;
}

function cycleRadio() {
  const name = audio.cycleStation();
  game.setMessage(name ? `Radio: ${name}` : 'Radio off');
}

// The radio button in the widget cycles stations, same as M.
el('radio-btn').addEventListener('click', () => {
  if (game.state !== 'playing') return;
  audio.unlock();
  cycleRadio();
});
el('map-close').addEventListener('click', () => {
  mapOpen = false;
});

window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) {
    e.preventDefault();
  }
  keys[e.code] = true;
  refreshInput();
  if (e.repeat) return;
  if (e.code === 'Enter' && game.state === 'title') startGame();
  if (e.code === 'KeyE') game.tryEnterExit();
  if (e.code === 'KeyF' && game.state === 'playing') game.tryMelee();
  if (e.code === 'KeyG' && game.state === 'playing') game.tryInteract();
  if (e.code === 'KeyQ' && game.state === 'playing') game.cycleWeapon();
  if (e.code === 'Digit1') game.selectWeapon(0);
  if (e.code === 'Digit2') game.selectWeapon(1);
  if (e.code === 'Digit3') game.selectWeapon(2);
  if (e.code === 'Digit4') game.selectWeapon(3);
  if (e.code === 'Tab' && game.state === 'playing') mapOpen = !mapOpen;
  if (e.code === 'KeyR' && (game.state === 'busted' || game.state === 'playing')) restartGame();
  if (e.code === 'KeyP' && game.state === 'playing') {
    paused = !paused;
    mapOpen = false;
  }
  if (e.code === 'KeyM') cycleRadio();
  if (e.code === 'KeyN') {
    const muted = audio.toggleMute();
    game.setMessage(muted ? 'Sound off' : 'Sound on');
  }
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  refreshInput();
});

el('play-btn').addEventListener('click', () => startGame(false));
el('continue-btn').addEventListener('click', () => startGame(true));
el('retry-btn').addEventListener('click', restartGame);

canvas.addEventListener('click', () => {
  if (game.state === 'title') {
    startGame();
    return;
  }
  // A real click (not the end of a camera drag) fires the selected weapon.
  if (game.state === 'playing' && game.player.onFoot && dragDist < 6) game.tryShoot();
});

canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  dragDist = 0;
  lastPointerX = e.clientX;
  lastPointerY = e.clientY;
});
window.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  dragDist += Math.abs(e.clientX - lastPointerX) + Math.abs(e.clientY - lastPointerY);
  camera.yaw -= (e.clientX - lastPointerX) * 0.005;
  camera.pitch = clamp(camera.pitch + (e.clientY - lastPointerY) * 0.005, 0.08, 1.05);
  userUntil = performance.now() + 3000;
  lastPointerX = e.clientX;
  lastPointerY = e.clientY;
});
window.addEventListener('pointerup', () => {
  dragging = false;
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  camera.dist = clamp(camera.dist * (1 + e.deltaY * 0.001), 6, 32);
}, { passive: false });

// --- Rendering -----------------------------------------------------------
let lastW = 0;
let lastH = 0;

function drawPickups() {
  for (const coin of game.pickups) {
    if (coin.taken) continue;
    const bob = 1.1 + Math.sin(game.time * 2 + coin.spin) * 0.15;
    if (coin.kind === 'ammo') {
      renderer.drawMesh(ammoMesh, matModel(coin.spin, coin.x, 0.4, coin.z));
    } else if (coin.kind === 'stash') {
      // The hidden packs: a bigger golden briefcase, bobbing and spinning
      // so it catches the eye from down the street.
      renderer.drawMesh(stashMesh, matModel(coin.spin, coin.x, bob, coin.z), { tint: [1.15, 0.95, 0.45] });
    } else if (coin.kind === 'job') {
      renderer.drawMesh(coinMesh, matModelTilt(coin.spin, Math.PI / 2, coin.x, bob, coin.z, 2.2), { tint: [1, 0.5, 0.9] });
    } else {
      renderer.drawMesh(coinMesh, matModelTilt(coin.spin, Math.PI / 2, coin.x, bob, coin.z, 1.5));
    }
  }
}

function drawVehicles() {
  // The police helicopter, with its spinning rotor and ground spotlight.
  if (game.heli) {
    const h = game.heli;
    renderer.drawMesh(shadowMesh, matModel(0, h.x, 0.12, h.z, 7), { alpha: 0.22, tint: [1, 0.85, 0.3] });
    renderer.drawMesh(heliMesh, matModel(h.heading, h.x, h.y, h.z));
    renderer.drawMesh(rotorMesh, matModel(h.heading + h.rotor, h.x, h.y + 1.0, h.z));
  }
  const cars = [...game.parked, ...game.traffic, ...game.police];
  if (game.playerCar) cars.push(game.playerCar);
  for (const car of cars) {
    renderer.drawMesh(shadowMesh, matModel(0, car.x, 0.12, car.z, 2.7), { alpha: 0.32 });
    // A downed cop car reads as a dead grey shell, not a live unit.
    const tint = car.kind === 'police' && car.down ? [0.45, 0.45, 0.48] : undefined;
    renderer.drawMesh(carMesh(car.color), matModel(car.heading, car.x, 0, car.z), tint ? { tint } : {});
    if (car.kind === 'police' && !car.down) {
      const red = Math.floor(car.flash * 2.5) % 2 === 0;
      renderer.drawMesh(lightBarMesh, matModel(car.heading, car.x, 0, car.z), {
        tint: red ? [1, 0.15, 0.15] : [0.25, 0.45, 1],
      });
    }
  }
}

function drawActors() {
  if (game.player.onFoot) {
    const bobY = game.player.moving ? Math.abs(Math.sin(game.player.bob)) * 0.08 : 0;
    renderer.drawMesh(shadowMesh, matModel(0, game.player.x, 0.12, game.player.z, 0.9), { alpha: 0.3 });
    // A punch leans the player forward for the swing.
    const lean = game.player.punchT > 0.25 ? 0.35 : 0;
    renderer.drawMesh(
      personMesh(game.player),
      lean
        ? matModelTilt(game.player.heading, lean, game.player.x, bobY, game.player.z)
        : matModel(game.player.heading, game.player.x, bobY, game.player.z),
    );
  }
  for (const ped of game.pedestrians) {
    renderer.drawMesh(shadowMesh, matModel(0, ped.x, 0.12, ped.z, 0.9), { alpha: 0.28 });
    if (ped.state === 'down') {
      renderer.drawMesh(personMesh(ped), matModelTilt(ped.heading, Math.PI / 2 - 0.15, ped.x, 0.3, ped.z));
    } else {
      const bobY = Math.abs(Math.sin(ped.walkPhase)) * 0.06;
      renderer.drawMesh(personMesh(ped), matModel(ped.heading, ped.x, bobY, ped.z));
    }
  }
}

function render() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w !== lastW || h !== lastH) {
    renderer.resize(w, h);
    lastW = w;
    lastH = h;
  }
  ensurePlayerLook();
  renderer.clear();
  renderer.begin(cameraEye(), camera.target, 1.02, SUN);
  renderer.drawSky(SKY.top, SKY.mid, SKY.bot, SUN);
  renderer.drawMesh(cityMesh, IDENTITY);
  if (game.jobTarget && game.state === 'playing') {
    renderer.drawMesh(beaconMesh, matModel(game.time * 0.6, game.jobTarget.x, 0, game.jobTarget.z), { alpha: 0.9 });
  }
  drawPickups();
  // Place markers: pulsing pillars over the garage, shop and safehouse.
  for (const key of Object.keys(PLACES)) {
    const p = PLACES[key];
    const pulse = 0.75 + Math.sin(game.time * 3 + p.x) * 0.2;
    renderer.drawMesh(markerMesh, matModel(0, p.x, 0, p.z), { tint: p.color, alpha: pulse });
  }
  // Bullet tracers, fading over their short life.
  for (const t of game.tracers) {
    const dx = t.x2 - t.x1;
    const dz = t.z2 - t.z1;
    const len = Math.hypot(dx, dz) || 1;
    const yaw = Math.atan2(dx, dz);
    renderer.drawMesh(tracerMesh, matModelScale(yaw, (t.x1 + t.x2) / 2, 1.4, (t.z1 + t.z2) / 2, 1, 1, len), {
      alpha: Math.max(0, t.t / t.max),
    });
  }
  drawVehicles();
  drawActors();
  updateHud(hud, game, camera.yaw, paused, mapOpen);
}

// --- The loop ------------------------------------------------------------
// Fixed 60 Hz steps, then one render. Sounds are driven by watching what
// changed since the previous frame, so each event plays exactly once.
let last = performance.now();
let acc = 0;
const lastSeen = {
  money: 0,
  stashes: 0,
  stars: 0,
  state: game.state,
  shots: 0,
  swings: 0,
  buys: 0,
  denied: 0,
};
let wasNearSafehouse = false;

function playEventSounds() {
  if (game.stashesCollected > lastSeen.stashes) audio.stash();
  if (game.money > lastSeen.money) {
    if (game.message.startsWith('Job done')) {
      audio.jobDone();
      save.persist();
    } else if (game.stashesCollected <= lastSeen.stashes) {
      // A stash pack already played its own chime above — don't double it.
      audio.pickup();
    }
  }
  if (game.stars > lastSeen.stars) audio.sting();
  if (game.message === 'Crash!' && game.messageT > 2.9) audio.crash();
  if (game.state === 'busted' && lastSeen.state !== 'busted') {
    audio.busted();
    save.persist();
  }
  if (game.shotsFired > lastSeen.shots) audio.shoot();
  if (game.swings > lastSeen.swings) audio.punch();
  if (game.buys > lastSeen.buys) audio.buy();
  if (game.denied > lastSeen.denied) audio.denied();
  // Reaching the safehouse saves the run (once per visit).
  if (game.nearSafehouse && !wasNearSafehouse && game.state === 'playing') {
    save.persist();
    game.setMessage('Safehouse — progress saved, health restored.');
  }
  wasNearSafehouse = game.nearSafehouse;
  lastSeen.money = game.money;
  lastSeen.stashes = game.stashesCollected;
  lastSeen.stars = game.stars;
  lastSeen.state = game.state;
  lastSeen.shots = game.shotsFired;
  lastSeen.swings = game.swings;
  lastSeen.buys = game.buys;
  lastSeen.denied = game.denied;
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused && !mapOpen && game.state === 'playing') {
    acc += dt;
    while (acc >= STEP) {
      game.step(STEP, input, camera.yaw);
      acc -= STEP;
    }
  }
  // Radio + siren run on the audio clock, under the mute switch.
  if (!paused && game.state === 'playing') audio.radio(dt);
  if (!paused) audio.siren(dt, game.stars);
  // Keep the radio widget in sync with what is actually playing.
  game.radioStationName = audio.stationName;
  game.radioTrack = audio.currentTrack;
  followTarget(dt);
  playEventSounds();
  render();
}

// --- Boot ----------------------------------------------------------------
if (shot) {
  // A screenshot scene: stage it, paint it twice, signal readiness.
  const cam = stageShot(shot, game);
  camera.target = cam.target;
  camera.yaw = cam.yaw;
  camera.pitch = cam.pitch;
  camera.dist = cam.dist;
  render();
  render();
  window.__shotReady = true;
} else {
  requestAnimationFrame(frame);
}
