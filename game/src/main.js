// Sunset Bay v5 — main.js (Builder E)
// Bootstrap: wires every module together, owns the frame loop, input,
// the title/playing/paused state machine, camera + scene render, and
// the ?seed= / ?shot= URL hooks. Written fresh from the design spec.
//
// Assumptions about the shared state S (see design-spec.md section 3/4),
// documented here so the Integrator can align the other builders:
//   S.city            -> buildCity() result (districts, roads, buildings, props, water, bounds)
//   S.player          -> { x, z, heading, speed, onFoot }
//   S.car             -> player car object or null  { x, z, heading, speed, model, color }
//   S.boat            -> player speedboat or null   { x, z, heading, speed, color }
//   S.traffic         -> { cars: [...] }  (each car like createCar())
//   S.peds            -> [{ x, z, heading, shirt, skin }]  (may be empty)
//   S.cops            -> [{ x, z, heading, hp }]  (may be empty)
//   S.heli            -> { x, z, active } or null
//   S.money, S.heat, S.stars, S.rep, S.repName, S.time (0..24)
//   S.missions        -> array of 18 { name, reward, desc, done }
//   S.missionIndex    -> index of the current mission
//   S.missionTarget   -> { x, z } | null  (current objective marker)
//   S.weapons         -> [{ name, ammo }], S.weaponIndex
//   S.events          -> optional array of { type } consumed by main.js for sfx
//   S.phase           -> 'title' | 'playing' | 'paused' (main.js also mirrors it)
// Everything is read defensively (optional chaining / fallbacks) so a
// missing optional field degrades gracefully instead of crashing.

import { createRng } from './rng.js';
import { vec, vadd, vsub, vscale, vlen, vnorm, clamp, lerp, wrapAngle, dist2d, matIdentity, matMul, matRotY, matTrans, matApply } from './math3.js';
import { createRenderer } from './gl.js';
import { buildingPrims, carPrims, pedPrims, treePrims, propPrims } from './meshes.js';
import { buildCity, districtAt, isWater } from './city.js';
import { createTraffic, stepTraffic, createCar, stepCar, createBoat, stepBoat } from './vehicles.js';
import { createPlayer, stepPlayer } from './player.js';
import { createState, stepGame, saveGame, loadGame, applySave } from './game.js';
import { createTaxi, stepTaxi, taxiStatus } from './jobs.js';
import { createWater, stepWater, inWaterArea } from './water.js';
import { bindHud, updateHud, drawMinimap, drawFullMap, showMessage, showPopup } from './hud.js';
import { createAudio, sfx, setStation, nextStation, toggleMute, stationName, startRadio, stopRadio } from './audio.js';
import { applyShot, SHOT_NAMES } from './shots.js';

// ---------------------------------------------------------------------------
// URL params: ?seed=N and ?shot=<name>
// ---------------------------------------------------------------------------
const params = new URLSearchParams(window.location.search);
const seedParam = params.get('seed');
const shotParam = params.get('shot');
const seed = seedParam !== null && seedParam !== ''
  ? (parseInt(seedParam, 10) || 1)
  : Math.floor(Math.random() * 1000000) + 1;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game-canvas');
const minimapCanvas = document.getElementById('minimap');
const fullmapCanvas = document.getElementById('fullmap');

let renderer = null;
let audio = null;
let S = null;            // shared game state
let phase = 'title';     // 'title' | 'playing' | 'paused'
let mapOpen = false;
let saveTimer = 0;

try {
  renderer = createRenderer(canvas);
} catch (err) {
  document.getElementById('boot-error-text').textContent =
    'WebGL could not start: ' + (err && err.message ? err.message : err);
  document.getElementById('boot-error').classList.add('show');
  throw err;
}

try {
  audio = createAudio();
} catch (err) {
  audio = null; // game must still run without audio
}

// Build the world state. createState owns money, missions, wanted, time,
// player/car/traffic/peds, taxi, water, etc. If a saved game exists we keep
// it for the Continue button instead of overwriting it here.
S = createState(seed);
S.phase = 'title';
S.audio = audio; // hud.js reads station/mute state from S.audio
if (!S.city) S.city = buildCity(createRng(seed));
if (!S.traffic) S.traffic = createTraffic(S.city, createRng(seed + 101));
if (!S.taxi) S.taxi = createTaxi(S);
if (!S.water) S.water = createWater(S.city);
if (typeof S.time !== 'number') S.time = 18; // start at dusk, per spec

// Stage a screenshot scene (?shot=) after the state exists.
if (shotParam && SHOT_NAMES.includes(shotParam)) {
  applyShot(S, shotParam);
  if (shotParam !== 'start') {
    phase = 'playing';
    S.phase = 'playing';
    // Hide the title screen: it is an opaque overlay — without this the
    // staged scene renders behind it and screenshots show only the title.
    // (Use getElementById here: the `titleScreen` const is declared later.)
    document.getElementById('title-screen').classList.add('hidden');
  }
}

bindHud(S);

// Continue button: only visible when a save exists.
let savedGame = null;
try { savedGame = loadGame(); } catch (err) { savedGame = null; }
const btnContinue = document.getElementById('btn-continue');
if (savedGame) btnContinue.style.display = 'block';

window.__game = {
  state: S,
  renderer,
  audio,
  seed,
  shot: shotParam,
  version: 'v5',
  get phase() { return phase; },
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const keys = Object.create(null);
const input = {
  up: false, down: false, left: false, right: false,
  sprint: false, handbrake: false,
  interact: false, // E (edge)
  punch: false,    // F (edge)
  shoot: false,    // mouse held
  shootPressed: false, // mouse click this frame (edge)
  slot: 0,         // 1..4 when a weapon key was pressed this frame, else 0
  weaponIndex: -1, // legacy mirror of slot (kept for hud compat)
  camYaw: 0,       // camera yaw: walking is relative to this
  aimYaw: 0,
  dt: 0,
};
let mouseX = window.innerWidth / 2;
let mouseY = window.innerHeight / 2;

window.addEventListener('keydown', (e) => {
  if (e.repeat) { if (e.code === 'Tab') e.preventDefault(); return; }
  keys[e.code] = true;

  if (e.code === 'Enter' && phase === 'title') { startGame(false); return; }
  if ((e.code === 'KeyP' || e.code === 'Escape') && phase !== 'title') {
    togglePause(); return;
  }
  if (e.code === 'Tab') {
    e.preventDefault();
    if (phase === 'playing') toggleMap();
    return;
  }
  if (phase !== 'playing') return;

  if (e.code === 'KeyE') input.interact = true;
  if (e.code === 'KeyF') input.punch = true;
  if (e.code === 'KeyM') { nextStation(audio); }
  if (e.code === 'KeyN') { toggleMute(audio); }
  if (e.code === 'Digit1') { input.slot = 1; input.weaponIndex = 0; }
  if (e.code === 'Digit2') { input.slot = 2; input.weaponIndex = 1; }
  if (e.code === 'Digit3') { input.slot = 3; input.weaponIndex = 2; }
  if (e.code === 'Digit4') { input.slot = 4; input.weaponIndex = 3; }
});

window.addEventListener('keyup', (e) => { keys[e.code] = false; });

window.addEventListener('mousemove', (e) => { mouseX = e.clientX; mouseY = e.clientY; });
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0) { input.shoot = true; input.shootPressed = true; }
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) input.shoot = false;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('resize', () => { if (renderer) renderer.resize(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && phase === 'playing') togglePause();
});

function readHeldInput() {
  input.up = !!(keys['KeyW'] || keys['ArrowUp']);
  input.down = !!(keys['KeyS'] || keys['ArrowDown']);
  input.left = !!(keys['KeyA'] || keys['ArrowLeft']);
  input.right = !!(keys['KeyD'] || keys['ArrowRight']);
  input.sprint = !!keys['ShiftLeft'] || !!keys['ShiftRight'];
  input.handbrake = !!keys['Space'];
  // Aim: mouse offset from screen centre -> yaw around the player.
  const dx = mouseX - window.innerWidth / 2;
  const dy = mouseY - window.innerHeight / 2;
  input.aimYaw = Math.atan2(dx, -dy);
  // Walking is relative to the camera, which sits behind the focus
  // (car/boat/player) looking along its heading.
  const focus = S.car || S.boat || S.player;
  input.camYaw = focus ? (focus.heading || 0) : 0;
}

// ---------------------------------------------------------------------------
// State machine: title / playing / paused
// ---------------------------------------------------------------------------
const titleScreen = document.getElementById('title-screen');
const pauseOverlay = document.getElementById('pause-overlay');
const mapOverlay = document.getElementById('map-overlay');

function showTitle() {
  phase = 'title';
  S.phase = 'title';
  titleScreen.classList.remove('hidden');
  pauseOverlay.classList.remove('show');
  closeMap();
  stopRadio(audio);
}

function startGame(useSave) {
  if (useSave) {
    // loadGame() returns PLAIN save data (not a full state) — apply it
    // onto the fresh state with applySave, never replace S wholesale.
    let fresh = null;
    try { fresh = loadGame(); } catch (err) { fresh = null; }
    if (fresh) {
      savedGame = fresh;
      try { applySave(S, savedGame); } catch (err) { /* keep fresh state */ }
    }
    window.__game.state = S;
    bindHud(S);
  }
  phase = 'playing';
  S.phase = 'playing';
  titleScreen.classList.add('hidden');
  pauseOverlay.classList.remove('show');
  closeMap();
  try { startRadio(audio); } catch (err) { /* audio is optional */ }
  try { sfx(audio, 'click'); } catch (err) { /* ignore */ }
  showMessage(S, 'Welcome to Sunset Bay. Steal a car with E — your first job is waiting.');
}

function togglePause() {
  if (phase === 'playing') {
    phase = 'paused';
    S.phase = 'paused';
    pauseOverlay.classList.add('show');
    closeMap();
    try { saveGame(S); } catch (err) { /* save is best-effort */ }
  } else if (phase === 'paused') {
    phase = 'playing';
    S.phase = 'playing';
    pauseOverlay.classList.remove('show');
  }
}

function toggleMap() {
  if (mapOpen) closeMap();
  else {
    mapOpen = true;
    mapOverlay.classList.add('show');
    drawFullMap(S);
  }
}
function closeMap() {
  mapOpen = false;
  mapOverlay.classList.remove('show');
}

document.getElementById('btn-start').addEventListener('click', () => startGame(false));
document.getElementById('btn-continue').addEventListener('click', () => startGame(true));
document.getElementById('btn-resume').addEventListener('click', () => togglePause());
document.getElementById('btn-quit-title').addEventListener('click', () => {
  try { saveGame(S); } catch (err) { /* ignore */ }
  showTitle();
});

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------
// Rotate a local (lx, lz) offset by heading and place it at (px, pz).
// Forward in world is (sin h, cos h), so local +Z must map to that:
//   x' = lx*cos(h) + lz*sin(h),  z' = -lx*sin(h) + lz*cos(h).
function place(prims, px, pz, heading, y0) {
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  const out = [];
  for (const p of prims) {
    const lx = p.x || 0;
    const lz = p.z || 0;
    out.push({
      k: p.k,
      x: px + lx * cos + lz * sin,
      y: (y0 || 0) + (p.y || 0),
      z: pz - lx * sin + lz * cos,
      sx: p.sx, sy: p.sy, sz: p.sz,
      r: p.r, h: p.h, s: p.s,
      color: p.color,
    });
  }
  return out;
}

function drawPrims(R, prims) {
  for (const p of prims) {
    if (p.k === 'box') R.drawBox(p.x, p.y || 0, p.z, p.sx || 1, p.sy || 1, p.sz || 1, p.color);
    else if (p.k === 'cyl') R.drawCyl(p.x, p.y || 0, p.z, p.r || 0.5, p.h || 1, p.color);
    else if (p.k === 'pyr') R.drawPyramid(p.x, p.y || 0, p.z, p.s || 1, p.h || 1, p.color);
  }
}

function render(R, S, dt) {
  const city = S.city;
  const bounds = city.bounds || { minX: -200, maxX: 200, minZ: -200, maxZ: 200 };
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const w = bounds.maxX - bounds.minX;
  const d = bounds.maxZ - bounds.minZ;

  // --- Camera: third-person chase behind the player / vehicle. ---
  const focus = S.car || S.boat || S.player;
  const fx = focus ? focus.x : 0;
  const fz = focus ? focus.z : 0;
  const heading = focus ? (focus.heading || 0) : 0;
  const camDist = S.car || S.boat ? 13 : 9;
  const camHeight = S.car || S.boat ? 6.5 : 5;
  const cam = {
    pos: vec(
      fx - Math.sin(heading) * camDist,
      camHeight,
      fz - Math.cos(heading) * camDist,
    ),
    // gl.js: yaw=0 looks toward -Z, forward = (-sin yaw, -cos yaw).
    // Camera sits BEHIND the focus, so it must look along +heading:
    // yaw = heading + PI gives forward (sin h, cos h).
    yaw: heading + Math.PI,
    pitch: -0.34,
  };

  R.beginFrame(cam, typeof S.time === 'number' ? S.time : 18);

  // --- Ground + roads + water ---
  R.drawBox(cx, -0.15, cz, w, 0.3, d, '#2e4030'); // base terrain
  for (const road of city.roads || []) {
    const len = Math.hypot(road.x2 - road.x1, road.z2 - road.z1);
    const mx = (road.x1 + road.x2) / 2;
    const mz = (road.z1 + road.z2) / 2;
    const horiz = Math.abs(road.x2 - road.x1) >= Math.abs(road.z2 - road.z1);
    R.drawBox(mx, 0.02, mz, horiz ? len : (road.w || 8), 0.06, horiz ? (road.w || 8) : len, '#23232e');
  }
  for (const area of city.water || []) {
    R.drawBox(area.x, 0.05, area.z, area.w, 0.1, area.d, '#1d6fb8');
  }

  // --- Buildings, props, trees ---
  for (const b of city.buildings || []) drawPrims(R, buildingPrims(b));
  for (const p of city.props || []) {
    if (p.kind === 'tree') drawPrims(R, treePrims(p.x, p.z));
    else drawPrims(R, propPrims(p.kind, p.x, p.z));
  }

  // --- Stash packs (small glowing crates) ---
  // S.stashes is a BOOLEAN array (game.js); positions live in city.stashes.
  const stashPos = city.stashes || [];
  for (let i = 0; i < stashPos.length; i++) {
    if (S.stashes && S.stashes[i]) continue;
    const st = stashPos[i];
    drawPrims(R, [{ k: 'box', x: st.x, y: 0.5, z: st.z, sx: 0.9, sy: 0.9, sz: 0.9, color: '#ffc93c' }]);
  }

  // --- Mission target marker (live mission target wins, staged shot target next) ---
  const target = (S.mission && S.mission.target) || S.missionTarget || null;
  if (target && phase === 'playing') {
    const pulse = 1 + 0.25 * Math.sin(performance.now() / 300);
    R.drawCyl(target.x, 1.2 * pulse, target.z, 0.9, 2.4 * pulse, '#ffc93c');
    R.drawPyramid(target.x, 3.2, target.z, 1.4, 1.2, '#ff2e88');
  }

  // --- Taxi passenger marker ---
  if (S.taxi && S.taxi.passenger && S.taxi.state === 'waiting') {
    R.drawCyl(S.taxi.passenger.x, 1.0, S.taxi.passenger.z, 0.7, 2.0, '#7be495');
  }

  // --- Traffic ---
  for (const car of (S.traffic && S.traffic.cars) || []) {
    drawPrims(R, place(carPrims(car.color, car.model), car.x, car.z, car.heading || 0, 0));
  }

  // --- Pedestrians ---
  for (const ped of S.peds || []) {
    drawPrims(R, place(pedPrims(ped.shirt, ped.skin), ped.x, ped.z, ped.heading || 0, 0));
  }

  // --- Police on foot (dark-blue shirts) / police cars ---
  // Police car colour must match game.js spawnCop: '#1c2f5e'.
  for (const cop of S.cops || []) {
    if (cop.kind === 'car' && cop.car) {
      drawPrims(R, place(carPrims('#1c2f5e', 'sedan'), cop.x, cop.z, cop.heading || 0, 0));
    } else {
      drawPrims(R, place(pedPrims('#1c2f5e', cop.skin || '#c98d64'), cop.x, cop.z, cop.heading || 0, 0));
    }
  }

  // --- Police helicopter (simple dark body + rotor disc marker) ---
  if (S.heli && S.heli.active) {
    const heliY = (typeof S.heli.y === 'number' ? S.heli.y : 13);
    drawPrims(R, place(carPrims('#20242e', 'sedan'), S.heli.x, S.heli.z, S.heli.heading || 0, heliY));
    R.drawCyl(S.heli.x, heliY + 2.5, S.heli.z, 3.2, 0.15, '#ffc93c'); // spotlight disc
  }

  // --- Player car / boat ---
  if (S.car) {
    drawPrims(R, place(carPrims(S.car.color, S.car.model), S.car.x, S.car.z, S.car.heading || 0, 0));
  }
  if (S.boat) {
    const bobY = (typeof S.boat.y === 'number' ? S.boat.y : 0) + (S.boat.bobY || 0);
    drawPrims(R, place(carPrims(S.boat.color || '#e8f4ff', 'boat'), S.boat.x, S.boat.z, S.boat.heading || 0, 0.3 + bobY));
  }
  // --- Parked cars (stealable) ---
  for (const car of S.parkedCars || []) {
    drawPrims(R, place(carPrims(car.color, car.model), car.x, car.z, car.heading || 0, 0));
  }

  // --- Player on foot ---
  if (S.player && S.player.onFoot !== false && !S.car && !S.boat) {
    drawPrims(R, place(pedPrims(S.player.shirt || '#ff7a1a', S.player.skin || '#c98d64'), S.player.x, S.player.z, S.player.heading || 0, 0));
  }

  R.endFrame();
}

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------
let lastT = performance.now();
let lastMsg = '';
let lastPopup = '';

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - lastT) / 1000;
  lastT = now;
  if (dt > 0.05) dt = 0.05; // clamp hitches
  if (dt <= 0) dt = 0.001;
  input.dt = dt;

  readHeldInput();

  if (phase === 'playing' && !mapOpen) {
    // Advance the world. stepGame ALREADY steps traffic/taxi/water
    // internally — do NOT call them again here (double speed otherwise).
    stepGame(S, input, dt);

    // Drain one-frame sfx events pushed by game.js. Events are plain
    // STRINGS ('shoot','cash',...), not {type} objects.
    if (Array.isArray(S.events)) {
      for (const ev of S.events.splice(0, S.events.length)) {
        const name = typeof ev === 'string' ? ev : (ev.type || ev.name || 'click');
        try { sfx(audio, name); } catch (err) { /* ignore */ }
      }
    }

    // Sync game message/popup state to the DOM (game.js only sets
    // S.message/S.popup + timers; hud.js only renders on explicit call).
    if (S.message && S.messageT > 0 && S.message !== lastMsg) {
      lastMsg = S.message;
      try { showMessage(S, S.message); } catch (err) { /* ignore */ }
    } else if ((!S.message || S.messageT <= 0) && lastMsg !== '') {
      lastMsg = '';
      try { showMessage(S, ''); } catch (err) { /* ignore */ }
    }
    if (S.popup && S.popupT > 0 && S.popup !== lastPopup) {
      lastPopup = S.popup;
      try { showPopup(S.popup); } catch (err) { /* ignore */ }
    }

    // Autosave every ~15 seconds of play.
    saveTimer += dt;
    if (saveTimer > 15) {
      saveTimer = 0;
      try { saveGame(S); } catch (err) { /* best-effort */ }
    }
  }

  // Render every frame (title screen still shows the city behind it).
  render(renderer, S, dt);

  // HUD + minimap (cheap DOM writes only when values change are handled
  // inside hud.js; we just call it every frame).
  updateHud(S);
  drawMinimap(S, minimapCanvas);
  if (mapOpen) drawFullMap(S);

  // Consume one-frame edge flags.
  input.interact = false;
  input.punch = false;
  input.shootPressed = false;
  input.slot = 0;
  input.weaponIndex = -1;
}

renderer.resize();
requestAnimationFrame(frame);
