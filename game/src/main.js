// Sunset Bay: boot, the fixed-step loop, input, the chase camera and rendering.
// ?seed=N fixes the world. ?shot=start|play|foot|end stages that scene instead
// of running the loop, paints it twice and sets window.__shotReady for a shot.
import { createRenderer } from './gl.js';
import { matIdentity, matModel, matModelScale, matModelTilt, turnToward, clamp } from './math3.js';
import { buildCityMesh, PLACES } from './city.js';
import { Game, PLAYER_CAR_COLOR } from './game.js';
import { buildAmmoMesh, buildCarMesh, buildHeliMesh, buildLightBarMesh, buildMarkerMesh, buildPersonMesh, buildRotorMesh, buildShadowMesh, buildCoinMesh, buildBeaconMesh, buildTracerMesh } from './meshes.js';
import { createHud, updateHud } from './hud.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';

const STEP = 1 / 60;
const IDENTITY = matIdentity();
// Low sun, orange-purple dusk: longer light, warmer fog, deeper sky.
const SUN = [-0.877, 0.28, -0.329];
const SKY_TOP = [0.3, 0.18, 0.52];
const SKY_MID = [0.98, 0.45, 0.3];
const SKY_BOT = [1.0, 0.68, 0.38];

const params = new URLSearchParams(location.search);
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : (Math.random() * 4294967296) | 0;
const shot = params.get('shot');

const canvas = document.getElementById('game');
const renderer = createRenderer(canvas);
const game = new Game(seed);
window.__game = game; // debug hook: live state for playtesting (read-only use)
const cityMesh = renderer.upload(buildCityMesh(game.city));
const hud = createHud();
const audio = createAudio();

const carMeshes = new Map();
function carMesh(color) {
  const key = color.join(',');
  if (!carMeshes.has(key)) carMeshes.set(key, renderer.upload(buildCarMesh(color)));
  return carMeshes.get(key);
}
const personMeshes = new Map();
function personMesh(p) {
  const key = `${p.shirt.join(',')}|${p.skin.join(',')}`;
  if (!personMeshes.has(key)) personMeshes.set(key, renderer.upload(buildPersonMesh(p.shirt, p.skin)));
  return personMeshes.get(key);
}
const shadowMesh = renderer.upload(buildShadowMesh());
const coinMesh = renderer.upload(buildCoinMesh());
const ammoMesh = renderer.upload(buildAmmoMesh());
const beaconMesh = renderer.upload(buildBeaconMesh());
const lightBarMesh = renderer.upload(buildLightBarMesh());
const heliMesh = renderer.upload(buildHeliMesh());
const rotorMesh = renderer.upload(buildRotorMesh());
const tracerMesh = renderer.upload(buildTracerMesh());
const markerMesh = renderer.upload(buildMarkerMesh());

// The player's look: a red shirt so they stand out in the crowd.
function ensurePlayerLook() {
  if (!game.player.shirt) {
    game.player.shirt = [0.9, 0.25, 0.2];
    game.player.skin = [0.9, 0.7, 0.55];
  }
}

// --- Camera: a low, close chase orbit (not a far top-down view). ---
const camera = { yaw: Math.PI, pitch: 0.26, dist: 12, target: [0, 2, 0] };
let userUntil = 0;

function computeEye(target, yaw, pitch, dist) {
  return [
    target[0] + Math.sin(yaw) * Math.cos(pitch) * dist,
    target[1] + Math.sin(pitch) * dist,
    target[2] + Math.cos(yaw) * Math.cos(pitch) * dist,
  ];
}

// --- Input ---
const keys = {};
const input = { forward: false, back: false, left: false, right: false, run: false, handbrake: false };

function refreshInput() {
  input.forward = !!(keys.KeyW || keys.ArrowUp);
  input.back = !!(keys.KeyS || keys.ArrowDown);
  input.left = !!(keys.KeyA || keys.ArrowLeft);
  input.right = !!(keys.KeyD || keys.ArrowRight);
  input.run = !!keys.ShiftLeft || !!keys.ShiftRight;
  input.handbrake = !!keys.Space;
}

let paused = false;
let mapOpen = false;

// The radio button in the widget cycles stations, same as M.
document.getElementById('radio-btn').addEventListener('click', () => {
  if (game.state !== 'playing') return;
  audio.unlock();
  const name = audio.cycleStation();
  game.setMessage(name ? `Radio: ${name}` : 'Radio off');
});
document.getElementById('map-close').addEventListener('click', () => {
  mapOpen = false;
});

// --- Save: best cash, jobs done and cars stolen persist in localStorage,
// loaded on start, with a Continue option on the title screen. ---
const SAVE_KEY = 'sunset-bay-save-v1';
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    return s && typeof s === 'object' ? s : null;
  } catch {
    return null;
  }
}
let savedProgress = loadSave();
function persistSave() {
  try {
    const data = {
      money: game.money,
      jobsDone: game.jobsDone,
      carsStolen: game.carsStolen,
      bestCash: Math.max(savedProgress?.bestCash || 0, game.money),
      // v2 fields: upgrades, ammo, weapon and armour ride along; a v1 save
      // simply lacks them and loads the defaults below.
      upgrades: { ...game.upgrades },
      ammo: { ...game.ammo },
      weaponIndex: game.weaponIndex,
      armour: game.armour,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    savedProgress = data;
  } catch {
    // Storage unavailable (private mode, etc.): the game plays on without it.
  }
}
const bestLine = document.getElementById('best-line');
const continueBtn = document.getElementById('continue-btn');
if (savedProgress && (savedProgress.bestCash > 0 || savedProgress.jobsDone > 0 || savedProgress.carsStolen > 0)) {
  bestLine.textContent = `Best run: $${(savedProgress.bestCash || 0).toLocaleString('en-US')} · ${savedProgress.jobsDone || 0} jobs done · ${savedProgress.carsStolen || 0} cars stolen`;
  bestLine.style.display = 'block';
  continueBtn.style.display = 'block';
}
window.addEventListener('beforeunload', () => {
  if (game.state === 'playing') persistSave();
});

function startGame(fromContinue = false) {
  if (game.state !== 'title') return;
  audio.unlock();
  if (fromContinue && savedProgress) {
    game.money = savedProgress.money || 0;
    game.jobsDone = savedProgress.jobsDone || 0;
    game.carsStolen = savedProgress.carsStolen || 0;
    if (savedProgress.upgrades) game.upgrades = { ...game.upgrades, ...savedProgress.upgrades };
    if (savedProgress.ammo) {
      game.ammo = { ...game.ammo, ...savedProgress.ammo };
      for (const k of Object.keys(game.ammo)) {
        if (game.ammo[k] > 0) game.unlocked[k] = true;
      }
    }
    if (Number.isInteger(savedProgress.weaponIndex)) game.weaponIndex = savedProgress.weaponIndex;
    if (typeof savedProgress.armour === 'number') game.armour = savedProgress.armour;
  }
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

window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
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
  if (e.code === 'KeyM') {
    const name = audio.cycleStation();
    game.setMessage(name ? `Radio: ${name}` : 'Radio off');
  }
  if (e.code === 'KeyN') {
    const muted = audio.toggleMute();
    game.setMessage(muted ? 'Sound off' : 'Sound on');
  }
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  refreshInput();
});
document.getElementById('play-btn').addEventListener('click', () => startGame(false));
document.getElementById('continue-btn').addEventListener('click', () => startGame(true));
document.getElementById('retry-btn').addEventListener('click', restartGame);
canvas.addEventListener('click', (e) => {
  if (game.state === 'title') {
    startGame();
    return;
  }
  // A real click (not the end of a camera drag) fires the selected weapon.
  if (game.state === 'playing' && game.player.onFoot && dragDist < 6) game.tryShoot();
});

let dragging = false;
let lastX = 0;
let lastY = 0;
let dragDist = 0;
canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  dragDist = 0;
  lastX = e.clientX;
  lastY = e.clientY;
});
window.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  dragDist += Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY);
  camera.yaw -= (e.clientX - lastX) * 0.005;
  camera.pitch = clamp(camera.pitch + (e.clientY - lastY) * 0.005, 0.08, 1.05);
  userUntil = performance.now() + 3000;
  lastX = e.clientX;
  lastY = e.clientY;
});
window.addEventListener('pointerup', () => {
  dragging = false;
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  camera.dist = clamp(camera.dist * (1 + e.deltaY * 0.001), 6, 32);
}, { passive: false });

// --- Rendering ---
let lastW = 0;
let lastH = 0;

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
  const eye = computeEye(camera.target, camera.yaw, camera.pitch, camera.dist);
  renderer.begin(eye, camera.target, 1.02, SUN);
  renderer.drawSky(SKY_TOP, SKY_MID, SKY_BOT, SUN);
  renderer.drawMesh(cityMesh, IDENTITY);
  if (game.jobTarget && game.state === 'playing') {
    renderer.drawMesh(beaconMesh, matModel(game.time * 0.6, game.jobTarget.x, 0, game.jobTarget.z), { alpha: 0.9 });
  }
  for (const coin of game.pickups) {
    if (coin.taken) continue;
    const bob = 1.1 + Math.sin(game.time * 2 + coin.spin) * 0.15;
    if (coin.kind === 'ammo') {
      renderer.drawMesh(ammoMesh, matModel(coin.spin, coin.x, 0.4, coin.z));
    } else if (coin.kind === 'job') {
      renderer.drawMesh(coinMesh, matModelTilt(coin.spin, Math.PI / 2, coin.x, bob, coin.z, 2.2), { tint: [1, 0.5, 0.9] });
    } else {
      renderer.drawMesh(coinMesh, matModelTilt(coin.spin, Math.PI / 2, coin.x, bob, coin.z, 1.5));
    }
  }
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
    const tint = car.kind === 'police' && car.down ? [0.45, 0.45, 0.48] : undefined;
    renderer.drawMesh(carMesh(car.color), matModel(car.heading, car.x, 0, car.z), tint ? { tint } : {});
    if (car.kind === 'police' && !car.down) {
      const red = Math.floor(car.flash * 2.5) % 2 === 0;
      renderer.drawMesh(lightBarMesh, matModel(car.heading, car.x, 0, car.z), {
        tint: red ? [1, 0.15, 0.15] : [0.25, 0.45, 1],
      });
    }
  }
  if (game.player.onFoot) {
    const bobY = game.player.moving ? Math.abs(Math.sin(game.player.bob)) * 0.08 : 0;
    renderer.drawMesh(shadowMesh, matModel(0, game.player.x, 0.12, game.player.z, 0.9), { alpha: 0.3 });
    // A punch leans the player forward for the swing.
    const lean = game.player.punchT > 0.25 ? 0.35 : 0;
    renderer.drawMesh(personMesh(game.player), lean
      ? matModelTilt(game.player.heading, lean, game.player.x, bobY, game.player.z)
      : matModel(game.player.heading, game.player.x, bobY, game.player.z));
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
  updateHud(hud, game, camera.yaw, paused, mapOpen);
}

// --- The loop: fixed 60 Hz steps, then one render. ---
let last = performance.now();
let acc = 0;
let prevMoney = 0;
let prevStars = 0;
let prevState = game.state;
let prevShots = 0;
let prevSwings = 0;
let prevBuys = 0;
let prevDenied = 0;
let wasNearSafehouse = false;

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
  // Camera follows the player or their car.
  const t = game.playerCar
    ? [game.playerCar.x, 1.8, game.playerCar.z]
    : [game.player.x, 1.7, game.player.z];
  camera.target[0] += (t[0] - camera.target[0]) * 0.25;
  camera.target[1] += (t[1] - camera.target[1]) * 0.25;
  camera.target[2] += (t[2] - camera.target[2]) * 0.25;
  if (game.playerCar && now > userUntil) {
    camera.yaw = turnToward(camera.yaw, game.playerCar.heading + Math.PI, 1.4 * dt);
  }
  // Sounds on what just happened.
  if (game.money > prevMoney) {
    if (game.message.startsWith('Job done')) { audio.jobDone(); persistSave(); }
    else audio.pickup();
  }
  if (game.stars > prevStars) audio.sting();
  if (game.message === 'Crash!' && game.messageT > 2.9) audio.crash();
  if (game.state === 'busted' && prevState !== 'busted') { audio.busted(); persistSave(); }
  if (game.shotsFired > prevShots) audio.shoot();
  if (game.swings > prevSwings) audio.punch();
  if (game.buys > prevBuys) audio.buy();
  if (game.denied > prevDenied) audio.denied();
  // Reaching the safehouse saves the run (once per visit).
  if (game.nearSafehouse && !wasNearSafehouse && game.state === 'playing') {
    persistSave();
    game.setMessage('Safehouse — progress saved, health restored.');
  }
  wasNearSafehouse = game.nearSafehouse;
  prevMoney = game.money;
  prevStars = game.stars;
  prevState = game.state;
  prevShots = game.shotsFired;
  prevSwings = game.swings;
  prevBuys = game.buys;
  prevDenied = game.denied;
  render();
}

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
