// game.js — otak game Sunset Bay v5 (bounty make.fun).
// Ditulis SEPENUHNYA BARU dari design-spec round4 di dalam sesi recording v5.
// Tidak ada kode yang disalin dari round sebelumnya, dari file lain, atau dari laporan lama.
//
// KONTRAK INPUT (dibuat main.js tiap frame, dipakai stepGame/stepPlayer/stepCar/stepBoat):
//   { up, down, left, right,      // WASD / panah, boolean
//     sprint,                     // Shift
//     handbrake,                  // Spasi
//     interact,                   // E ditekan frame ini (edge)
//     punch,                      // F ditekan frame ini (edge)
//     shoot,                      // tombol mouse kiri ditahan
//     shootPressed,               // klik mouse frame ini (edge)
//     slot,                       // 1..4 bila tombol senjata ditekan frame ini, else 0
//     camYaw }                    // radian — arah kamera (gerak jalan kaki relatif ke kamera)
//
// KONTRAK KELUARAN ke main.js / hud.js (dibaca langsung dari state S, tanpa impor balik):
//   S.events   — array nama efek suara ('shoot','punch','pickup','cash','siren','splash','click');
//                main.js menguras (drain) array ini tiap frame lalu memanggil audio.sfx.
//   S.message / S.popup — teks + timer (S.messageT / S.popupT, detik); hud.js menampilkannya.
//   S.mission  — { index, stage, stageDef, target:{x,z,label}, checkpoints, cpIndex, elapsed, stageT, def }
//   S.heli     — { active, x, z, dist } — HUD menampilkan jarak heli bila active.
//   S.car.engineLevel (0..3) — stepCar harus memakai ini untuk menaikkan top speed.
//   S.cops    — [{ x, z, heading, speed, hp, kind:'foot'|'car', car }] — car = objek mobil polisi.
//   S.parkedCars / S.water.boats — kendaraan yang bisa dicuri / dinaiki (render + E untuk ambil).
import { createRng } from './rng.js';
import { dist2d, clamp, wrapAngle } from './math3.js';
import { buildCity, districtAt, isWater } from './city.js';
import { createTraffic, stepTraffic, createCar, stepCar, stepBoat } from './vehicles.js';
import { createPlayer, stepPlayer } from './player.js';
import { createTaxi, stepTaxi } from './jobs.js';
import { createWater, stepWater } from './water.js';

export const SAVE_KEY = 'sunset-bay-save-v1';

// ---------------------------------------------------------------------------
// Senjata (slot 0 = tinju, 1..3 = pistol / SMG / shotgun)
// ---------------------------------------------------------------------------
export const WEAPONS = [
  { name: 'Fists', range: 0, rate: 0.4, damage: 1, cone: 0, ammoKey: null },
  { name: 'Pistol', range: 42, rate: 0.28, damage: 1, cone: 0.12, ammoKey: 'pistol' },
  { name: 'SMG', range: 36, rate: 0.09, damage: 1, cone: 0.22, ammoKey: 'smg' },
  { name: 'Shotgun', range: 20, rate: 0.75, damage: 2, cone: 0.45, ammoKey: 'shotgun' },
];

export const ENGINE_COSTS = [300, 600, 1000]; // Lv1..Lv3

// ---------------------------------------------------------------------------
// 18 misi berantai. Stage: goto / collect / deliver / race / escape / boat /
// steal / stealSport. `place` diselesaikan ke koordinat saat misi jalan
// (placePos), jadi tidak ada koordinat kota yang di-hardcode di sini.
// fastTime = detik; selesai di bawah itu = bonus +50%.
// ---------------------------------------------------------------------------
export const MISSIONS = [
  {
    name: 'First Wheels', reward: 100, fastTime: 90,
    desc: 'Steal your first car and drive it to Sunset Mall.',
    stages: [
      { type: 'steal', desc: 'Steal a car — press E near one' },
      { type: 'goto', place: 'mall', desc: 'Drive to Sunset Mall' },
    ],
  },
  {
    name: 'Package Run', reward: 250, fastTime: 150,
    desc: 'Pick up a package Downtown, deliver it to Sunset Mall.',
    stages: [
      { type: 'collect', place: 'downtown', desc: 'Pick up the package in Downtown' },
      { type: 'deliver', place: 'mall', desc: 'Deliver the package to Sunset Mall' },
    ],
  },
  {
    name: 'Street Race', reward: 400, fastTime: 75,
    desc: 'Beat the street racers: Old Town, Downtown, Uptown.',
    stages: [
      { type: 'race', places: ['oldtown', 'downtown', 'uptown'], timeLimit: 80, desc: 'Race the checkpoints!' },
    ],
  },
  {
    name: 'Getaway Driver', reward: 350, fastTime: 120,
    desc: 'Lose the cops, then lay low at the safehouse.',
    stages: [
      { type: 'escape', timeLimit: 30, setHeat: 250, desc: 'Lose the cops — survive 30s!' },
      { type: 'goto', place: 'safehouse', desc: 'Lay low at the safehouse' },
    ],
  },
  {
    name: 'Night Shift', reward: 300, fastTime: 180, setTime: 21,
    desc: 'Night delivery: Southside to The Pier.',
    stages: [
      { type: 'collect', place: 'southside', desc: 'Pick up the night package' },
      { type: 'deliver', place: 'pier', desc: 'Deliver to The Pier' },
    ],
  },
  {
    name: 'Repo Man', reward: 450, fastTime: 180,
    desc: 'Find the repossessed car in Northside and bring it to the garage.',
    stages: [
      { type: 'goto', place: 'northside', desc: 'Find the car in Northside' },
      { type: 'steal', desc: 'Take the car — press E' },
      { type: 'deliver', place: 'garage', desc: 'Bring it to Sunset Garage' },
    ],
  },
  {
    name: 'Hot Wheels', reward: 500, fastTime: 150,
    desc: 'Steal a Comet sportscar and show it off at Beachfront.',
    stages: [
      { type: 'stealSport', desc: 'Steal a Comet sportscar' },
      { type: 'goto', place: 'beachfront', desc: 'Cruise to Beachfront' },
    ],
  },
  {
    name: "Smuggler's Run", reward: 700, fastTime: 210,
    desc: 'Move the goods from Marina Bay to Old Town. Quietly.',
    stages: [
      { type: 'collect', place: 'marinabay', desc: 'Pick up the goods at Marina Bay' },
      { type: 'deliver', place: 'oldtown', desc: 'Deliver to Old Town' },
    ],
  },
  {
    name: 'VIP Escort', reward: 600, fastTime: 150,
    desc: 'Pick up the VIP in Uptown, deliver to Hillcrest — fast and safe.',
    stages: [
      { type: 'collect', place: 'uptown', desc: 'Pick up the VIP' },
      { type: 'deliver', place: 'hillcrest', timeLimit: 120, desc: 'Deliver the VIP to Hillcrest' },
    ],
  },
  {
    name: 'Chase the Sunset', reward: 550, fastTime: 100, setTime: 17.5,
    desc: 'Sunset race to Beachfront.',
    stages: [
      { type: 'race', places: ['downtown', 'southside', 'beachfront'], timeLimit: 100, desc: 'Race to Beachfront before dark!' },
    ],
  },
  {
    name: 'The Big Heist', reward: 800, fastTime: 300,
    desc: 'Hit the Downtown bank, lose the heat, vanish at the safehouse.',
    stages: [
      { type: 'collect', place: 'downtown', desc: 'Grab the loot in Downtown' },
      { type: 'escape', timeLimit: 30, setHeat: 300, desc: 'Lose the cops!' },
      { type: 'deliver', place: 'safehouse', desc: 'Vanish at the safehouse' },
    ],
  },
  {
    name: 'Last Call', reward: 650, fastTime: 120,
    desc: 'Last delivery to The Pier before closing.',
    stages: [
      { type: 'collect', place: 'mall', desc: 'Pick up the last order at Sunset Mall' },
      { type: 'deliver', place: 'pier', timeLimit: 100, desc: 'Deliver to The Pier — hurry!' },
    ],
  },
  {
    name: 'Pier Pressure', reward: 850, fastTime: 300,
    desc: 'Grab the drop at The Pier, deliver to Sunset Mall, then shake the tail.',
    stages: [
      { type: 'collect', place: 'pier', desc: 'Grab the drop at The Pier' },
      { type: 'deliver', place: 'mall', desc: 'Deliver to Sunset Mall' },
      { type: 'escape', timeLimit: 20, setHeat: 250, desc: 'Shake the tail!' },
    ],
  },
  {
    name: 'Beach Run', reward: 950, fastTime: 120,
    desc: 'High-speed run to Beachfront.',
    stages: [
      { type: 'race', places: ['uptown', 'southside', 'beachfront'], timeLimit: 100, desc: 'Race to Beachfront!' },
    ],
  },
  {
    name: 'Midnight Courier', reward: 1100, fastTime: 300, setTime: 0,
    desc: 'Midnight deliveries across the city.',
    stages: [
      { type: 'collect', place: 'downtown', desc: 'Pick up the midnight package' },
      { type: 'deliver', place: 'hillcrest', desc: 'Deliver to Hillcrest' },
      { type: 'deliver', place: 'northside', desc: 'Final drop in Northside' },
    ],
  },
  {
    name: 'Harbor Lights', reward: 900, fastTime: 240,
    desc: 'Take the boat from Marina Bay out to sea and on to The Pier.',
    stages: [
      { type: 'goto', place: 'marina', desc: 'Get to Marina Bay' },
      { type: 'boat', place: 'water', desc: 'Board a speedboat (E near a boat) and sail out to sea' },
      { type: 'boat', place: 'pierwater', desc: 'Sail to The Pier' },
    ],
  },
  {
    name: 'Dockside Deal', reward: 1000, fastTime: 300,
    desc: 'Pick up the package at the docks, dodge the cops, deliver to Old Town.',
    stages: [
      { type: 'collect', place: 'dock', desc: 'Pick up the package at the docks' },
      { type: 'escape', timeLimit: 25, setHeat: 250, desc: 'Dodge the cops!' },
      { type: 'deliver', place: 'oldtown', desc: 'Deliver to Old Town' },
    ],
  },
  {
    name: 'Sunset Heist', reward: 1500, fastTime: 360, setTime: 18,
    desc: 'The big one: Downtown at sunset, escape by sea.',
    stages: [
      { type: 'collect', place: 'downtown', desc: 'Grab the Sunset Heist loot' },
      { type: 'escape', timeLimit: 30, setHeat: 300, desc: 'Lose the cops!' },
      { type: 'boat', place: 'water', desc: 'Escape by sea — take a boat from the marina!' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Helper kecil
// ---------------------------------------------------------------------------
export function starsFor(heat) {
  return clamp(Math.floor(heat / 100), 0, 5);
}

export function phaseName(t) {
  if (t >= 5 && t < 8) return 'DAWN';
  if (t >= 8 && t < 17) return 'DAY';
  if (t >= 17 && t < 20) return 'DUSK';
  return 'NIGHT';
}

function repLevelName(rep) {
  if (rep >= 1000) return 'KINGPIN';
  if (rep >= 300) return 'HUSTLER';
  return 'ROOKIE';
}

function setMessage(S, text) {
  S.message = text;
  S.messageT = 6;
}

function setPopup(S, text) {
  S.popup = text;
  S.popupT = 3;
}

function pushEvent(S, name) {
  S.events.push(name);
  if (S.events.length > 32) S.events.shift();
}

function turnToward(cur, target, maxStep) {
  let d = wrapAngle(target - cur);
  if (d > maxStep) d = maxStep;
  else if (d < -maxStep) d = -maxStep;
  return cur + d;
}

// Titik padat untuk pejalan kaki / polisi: batas kota, gedung, dan air.
function solidAt(city, x, z) {
  if (city && city.bounds) {
    const b = city.bounds;
    if (x < b.minX + 0.5 || x > b.maxX - 0.5 || z < b.minZ + 0.5 || z > b.maxZ - 0.5) return true;
  }
  if (city && city.buildings) {
    for (let i = 0; i < city.buildings.length; i++) {
      const bd = city.buildings[i];
      if (Math.abs(x - bd.x) < bd.w / 2 + 0.6 && Math.abs(z - bd.z) < bd.d / 2 + 0.6) return true;
    }
  }
  if (city && city.water) {
    for (let i = 0; i < city.water.length; i++) {
      const w = city.water[i];
      if (Math.abs(x - w.x) < w.w / 2 && Math.abs(z - w.z) < w.d / 2) return true;
    }
  }
  return false;
}

// Titik di air yang paling dekat dengan (x, z) — untuk target boat di dekat distrik.
function waterNear(S, x, z) {
  const w = S.city.water;
  if (!w || !w.length) return { x: S.city.marina.x, z: S.city.marina.z };
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < w.length; i++) {
    const r = w[i];
    const cx = clamp(x, r.x - r.w / 2 + 4, r.x + r.w / 2 - 4);
    const cz = clamp(z, r.z - r.d / 2 + 4, r.z + r.d / 2 - 4);
    const d = dist2d(x, z, cx, cz);
    if (d < bestD) {
      bestD = d;
      best = { x: cx, z: cz };
    }
  }
  return best || { x: w[0].x, z: w[0].z };
}

function districtCenter(S, key) {
  const d = S.city.districts.find((dd) => dd.name.toLowerCase().replace(/\s+/g, '') === key);
  return d ? { x: d.cx, z: d.cz } : null;
}

// Selesaikan nama tempat menjadi koordinat {x, z}. Dipakai semua stage misi.
function placePos(S, place) {
  const c = S.city;
  const p = String(place || '').toLowerCase().replace(/\s+/g, '');
  if (p === 'garage') return { x: c.garage.x, z: c.garage.z };
  if (p === 'shop') return { x: c.shop.x, z: c.shop.z };
  if (p === 'safehouse') return { x: c.safehouse.x, z: c.safehouse.z };
  if (p === 'marina') return { x: c.marina.x, z: c.marina.z };
  if (p === 'dock') {
    const d = (c.marina.docks && c.marina.docks[0]) || c.marina;
    return { x: d.x, z: d.z };
  }
  if (p === 'water') {
    const w = c.water[0];
    return w ? { x: w.x, z: w.z } : { x: c.marina.x, z: c.marina.z };
  }
  if (p === 'pierwater') {
    const dc = districtCenter(S, 'thepier');
    return waterNear(S, dc ? dc.x : c.marina.x, dc ? dc.z : c.marina.z);
  }
  if (p === 'marinawater') {
    const dc = districtCenter(S, 'marinabay');
    return waterNear(S, dc ? dc.x : c.marina.x, dc ? dc.z : c.marina.z);
  }
  if (p.startsWith('stash')) {
    const i = parseInt(p.slice(5), 10) || 0;
    const s = c.stashes[Math.min(Math.max(i, 0), c.stashes.length - 1)];
    return { x: s.x, z: s.z };
  }
  if (p === 'pier') {
    const dc = districtCenter(S, 'thepier');
    if (dc) return dc;
  }
  if (p === 'mall') {
    const dc = districtCenter(S, 'sunsetmall');
    if (dc) return dc;
  }
  const dc = districtCenter(S, p);
  if (dc) return dc;
  return { x: 0, z: 0 };
}

// Cari titik yang benar-benar bisa dipijak: tidak di dalam gedung/air dan
// dengan ruang gerak 3 unit ke segala arah (wall-slide butuh itu). Dipakai
// spawn pemain + mobil parkir — tanpa ini spawn bisa mendarat di dalam
// margin tabrakan gedung dan pemain macet total di tempat.
function findClearSpot(city, x, z, maxR) {
  const ok = (px, pz) =>
    !solidAt(city, px, pz) &&
    !solidAt(city, px + 3, pz) && !solidAt(city, px - 3, pz) &&
    !solidAt(city, px, pz + 3) && !solidAt(city, px, pz - 3);
  if (ok(x, z)) return { x, z };
  for (let r = 2; r <= maxR; r += 2) {
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      const px = Math.round(x + Math.sin(ang) * r);
      const pz = Math.round(z + Math.cos(ang) * r);
      if (ok(px, pz)) return { x: px, z: pz };
    }
  }
  return { x, z };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
export function createState(seed) {
  const useSeed = seed == null ? (Math.random() * 1e9) | 0 : seed;
  const rng = createRng(useSeed);
  const city = buildCity(rng);
  const S = {
    seed: useSeed,
    rng,
    city,
    money: 0,
    totalEarned: 0,
    missionIndex: 0,
    jobsDone: 0,
    mission: null,
    nextMissionT: 1,
    heat: 0,
    stars: 0,
    rep: 0,
    repLevel: 'ROOKIE',
    stashes: [false, false, false, false, false, false],
    stashCount: 0,
    upgrades: { speed: 0, armor: 0 },
    health: 100,
    weapons: { slot: 0, ammo: { pistol: 24, smg: 0, shotgun: 0 } },
    player: null,
    car: null,
    boat: null,
    parkedCars: [],
    cops: [],
    heli: { active: false, x: 0, z: 0, dist: 0 },
    time: 18.0,
    day: 1,
    weather: 'clear',
    weatherT: 0,
    district: '',
    traffic: null,
    taxi: null,
    water: null,
    message: '',
    messageT: 0,
    popup: '',
    popupT: 0,
    events: [],
    bustedT: 0,
    busted: false,
    bustedFlashT: 0,
    driftT: 0,
    driftCount: 0,
    fireT: 0,
    copSpawnT: 0,
    gameTime: 0,
  };
  const spawn = findClearSpot(city, city.safehouse.x + 3, city.safehouse.z + 3, 30);
  S.player = createPlayer(spawn.x, spawn.z);
  S.traffic = createTraffic(city, rng);
  S.water = createWater(city);
  S.taxi = createTaxi(S);
  // Parked cars (stealable without chasing moving traffic).
  // Positions nudged to a clear spot so no car spawns inside a building.
  const parkedSpots = [
    [-53, -128, 0, 'sedan', '#8a8f98'],
    [53, 78, Math.PI / 2, 'sport', '#e33e2b'],
    [-28, 55, 0, 'taxi', '#f5d90a'],
  ];
  S.parkedCars = parkedSpots.map(([px, pz, heading, model, color]) => {
    const spot = findClearSpot(city, px, pz, 12);
    return createCar(spot.x, spot.z, heading, model, color);
  });
  // Pedestrians wandering the sidewalks (22 shirt colours, 6 skins).
  const SHIRTS = ['#e33e2b', '#f2a007', '#2fae4e', '#1f8fff', '#7a3fd1', '#e26fb5', '#f2f2f2', '#ff7a1a', '#0fa3a3', '#9be15d', '#b3123f', '#3a6ea5', '#c9a227', '#6b7c93', '#d94f70', '#2b2b4a', '#a8e063', '#ffcf3f', '#4ecdc4', '#5b3a1e', '#8a8f98', '#2447d6'];
  const SKINS = ['#c98d64', '#8a5a3b', '#e8b88a', '#6e4426', '#f0c8a0', '#a06a42'];
  S.peds = [];
  for (let i = 0; i < 12; i++) {
    const gx = rng.pick([-100, -50, 0, 50, 100]);
    const gz = rng.pick([-100, -50, 0, 50, 100]);
    S.peds.push({
      x: gx + rng.range(-4, 4),
      z: gz + rng.range(-4, 4),
      heading: rng.range(0, Math.PI * 2),
      shirt: rng.pick(SHIRTS),
      skin: rng.pick(SKINS),
      speed: rng.range(1.2, 2.4),
      turnT: rng.range(0, 4),
    });
  }
  S.district = districtAt(city, S.player.x, S.player.z);
  return S;
}

// ---------------------------------------------------------------------------
// Misi
// ---------------------------------------------------------------------------
export function startMission(S, i) {
  if (i < 0 || i >= MISSIONS.length) return;
  const m = MISSIONS[i];
  S.mission = {
    index: i,
    stage: 0,
    elapsed: 0,
    stageT: 0,
    stageDef: null,
    target: null,
    checkpoints: [],
    cpIndex: 0,
    def: m,
  };
  if (typeof m.setTime === 'number') S.time = m.setTime;
  setupStage(S);
  setMessage(S, `MISSION ${i + 1}/18: ${m.name} — ${m.desc}`);
}

function setupStage(S) {
  const M = S.mission;
  const st = M.def.stages[M.stage];
  M.stageDef = st;
  M.stageT = 0;
  M.cpIndex = 0;
  M.checkpoints = [];
  if (st.setHeat) S.heat = Math.max(S.heat, st.setHeat);
  if (st.type === 'race') {
    M.checkpoints = (st.places || []).map((pl) => {
      const pos = placePos(S, pl);
      pos.label = pl;
      return pos;
    });
    M.target = M.checkpoints[0] || null;
  } else if (st.place) {
    const pos = placePos(S, st.place);
    pos.label = st.place;
    M.target = pos;
  } else {
    M.target = null;
  }
  setMessage(S, `${M.def.name} — ${st.desc}`);
}

function advanceStage(S) {
  const M = S.mission;
  M.stage++;
  pushEvent(S, 'pickup');
  if (M.stage >= M.def.stages.length) {
    completeMission(S);
    return;
  }
  setupStage(S);
}

export function completeMission(S) {
  const M = S.mission;
  if (!M) return;
  const m = M.def;
  const elapsed = M.elapsed;
  let bonus = 0;
  if (elapsed < m.fastTime) bonus = Math.floor(m.reward * 0.5);
  const total = m.reward + bonus;
  S.money += total;
  S.totalEarned += total;
  S.jobsDone++;
  S.missionIndex++;
  S.rep += 100;
  if (bonus > 0) setMessage(S, `Job done! +$${total} (+$${bonus} fast bonus)`);
  else setMessage(S, `Job done! +$${total}`);
  pushEvent(S, 'cash');
  S.mission = null;
  S.nextMissionT = 3;
  if (S.missionIndex >= MISSIONS.length) {
    setMessage(S, 'ALL MISSIONS COMPLETE — You run Sunset Bay!');
  }
}

function failMission(S, reason) {
  setMessage(S, `Mission failed: ${reason} — try again!`);
  S.mission = null;
  S.nextMissionT = 2.5;
  S.heat = 0;
}

function updateMission(S, dt) {
  if (!S.mission) {
    if (S.missionIndex < MISSIONS.length) {
      S.nextMissionT -= dt;
      if (S.nextMissionT <= 0) startMission(S, S.missionIndex);
    }
    return;
  }
  const M = S.mission;
  M.elapsed += dt;
  M.stageT += dt;
  const st = M.stageDef;
  const P = S.player;
  if (st.type === 'goto' || st.type === 'collect' || st.type === 'deliver') {
    if (M.target && dist2d(P.x, P.z, M.target.x, M.target.z) < (st.radius || 6)) advanceStage(S);
  } else if (st.type === 'steal') {
    if (S.car) advanceStage(S);
  } else if (st.type === 'stealSport') {
    if (S.car && S.car.model === 'sport') advanceStage(S);
  } else if (st.type === 'race') {
    if (st.timeLimit && M.stageT > st.timeLimit) {
      failMission(S, 'Out of time!');
      return;
    }
    const cp = M.checkpoints[M.cpIndex];
    if (cp && dist2d(P.x, P.z, cp.x, cp.z) < (st.radius || 10)) {
      M.cpIndex++;
      if (M.cpIndex >= M.checkpoints.length) {
        advanceStage(S);
        return;
      }
      M.target = M.checkpoints[M.cpIndex];
      setMessage(S, `Checkpoint ${M.cpIndex + 1}/${M.checkpoints.length} — ${st.desc}`);
      pushEvent(S, 'pickup');
    }
  } else if (st.type === 'escape') {
    if (S.heat < 200) S.heat = 200;
    if (M.stageT >= (st.timeLimit || 30)) advanceStage(S);
  } else if (st.type === 'boat') {
    if (S.boat && M.target && dist2d(S.boat.x, S.boat.z, M.target.x, M.target.z) < (st.radius || 14)) {
      advanceStage(S);
    }
  }
  // Batas waktu untuk stage deliver / collect yang punya timeLimit.
  if (S.mission !== M) return; // misi sudah selesai / gagal di atas
  if ((st.type === 'deliver' || st.type === 'collect') && st.timeLimit && M.stageT > st.timeLimit) {
    failMission(S, 'Out of time!');
  }
}

// ---------------------------------------------------------------------------
// Save / load (localStorage key sunset-bay-save-v1)
// ---------------------------------------------------------------------------
export function saveGame(S) {
  try {
    if (typeof localStorage === 'undefined') return false;
    const data = {
      v: 1,
      money: S.money,
      totalEarned: S.totalEarned,
      missionIndex: S.missionIndex,
      jobsDone: S.jobsDone,
      rep: S.rep,
      stashes: S.stashes.slice(),
      upgrades: { speed: S.upgrades.speed, armor: S.upgrades.armor },
      health: S.health,
      weapons: { slot: S.weapons.slot, ammo: { ...S.weapons.ammo } },
      player: { x: S.player.x, z: S.player.z, heading: S.player.heading },
      time: S.time,
      day: S.day,
      weather: S.weather,
      car: S.car
        ? { x: S.car.x, z: S.car.z, heading: S.car.heading, model: S.car.model, color: S.car.color }
        : null,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    return false;
  }
}

export function loadGame() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return d && d.v === 1 ? d : null;
  } catch (e) {
    return null;
  }
}

// Terapkan data save ke state yang sudah dibuat createState. Misi aktif
// diulang dari awal (stage 0) supaya tidak ada state misi setengah jalan.
export function applySave(S, d) {
  if (!d) return;
  S.money = d.money || 0;
  S.totalEarned = d.totalEarned || 0;
  S.missionIndex = d.missionIndex || 0;
  S.jobsDone = d.jobsDone || 0;
  S.rep = d.rep || 0;
  S.repLevel = repLevelName(S.rep);
  if (Array.isArray(d.stashes)) {
    S.stashes = d.stashes.slice(0, 6);
    while (S.stashes.length < 6) S.stashes.push(false);
    S.stashCount = S.stashes.filter(Boolean).length;
  }
  if (d.upgrades) S.upgrades = { speed: d.upgrades.speed || 0, armor: d.upgrades.armor || 0 };
  S.health = typeof d.health === 'number' ? d.health : 100;
  if (d.weapons) {
    S.weapons.slot = d.weapons.slot || 0;
    S.weapons.ammo = { pistol: 24, smg: 0, shotgun: 0, ...(d.weapons.ammo || {}) };
  }
  if (d.player) {
    S.player.x = d.player.x;
    S.player.z = d.player.z;
    S.player.heading = d.player.heading || 0;
    S.player.onFoot = true;
    S.player.speed = 0;
  }
  if (typeof d.time === 'number') S.time = d.time;
  if (typeof d.day === 'number') S.day = d.day;
  if (typeof d.weather === 'string') S.weather = d.weather;
  S.heat = 0;
  S.stars = 0;
  S.cops.length = 0;
  S.heli.active = false;
  S.mission = null;
  S.nextMissionT = 1.5;
  if (d.car) {
    const c = createCar(d.car.x, d.car.z, d.car.heading || 0, d.car.model || 'sedan', d.car.color || '#888888');
    c.engineLevel = S.upgrades.speed;
    c.upgrade = S.upgrades.speed;
    S.car = c;
    S.player.onFoot = false;
    S.player.x = c.x;
    S.player.z = c.z;
    S.player.heading = c.heading;
  }
}

// ---------------------------------------------------------------------------
// Interaksi (tombol E)
// ---------------------------------------------------------------------------
function nearestCarEntry(S, maxD) {
  const P = S.player;
  let best = null;
  let bestD = maxD;
  const lists = [S.traffic.cars, S.parkedCars];
  for (let li = 0; li < lists.length; li++) {
    const list = lists[li] || [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const d = dist2d(P.x, P.z, c.x, c.z);
      if (d < bestD) {
        bestD = d;
        best = { car: c, list, index: i };
      }
    }
  }
  return best;
}

function nearestBoat(S, maxD) {
  const P = S.player;
  const boats = (S.water && S.water.boats) || [];
  let best = null;
  let bestD = maxD;
  for (let i = 0; i < boats.length; i++) {
    const b = boats[i];
    const d = dist2d(P.x, P.z, b.x, b.z);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

function stealCar(S, entry) {
  entry.list.splice(entry.index, 1);
  const car = entry.car;
  car.engineLevel = S.upgrades.speed;
  car.upgrade = S.upgrades.speed;
  S.car = car;
  S.player.onFoot = false;
  S.player.x = car.x;
  S.player.z = car.z;
  S.player.heading = car.heading;
  S.player.speed = car.speed || 0;
  S.heat = Math.min(500, S.heat + 40);
  setMessage(S, 'Nice wheels!');
  pushEvent(S, 'pickup');
}

function exitCar(S) {
  const car = S.car;
  if (!car) return;
  S.parkedCars.push(car);
  S.car = null;
  const side = 2.5;
  S.player.x = car.x + Math.cos(car.heading) * side;
  S.player.z = car.z - Math.sin(car.heading) * side;
  S.player.heading = car.heading;
  S.player.speed = 0;
  S.player.onFoot = true;
}

function boardBoat(S, boat) {
  const boats = S.water.boats;
  const i = boats.indexOf(boat);
  if (i >= 0) boats.splice(i, 1);
  S.boat = boat;
  S.player.onFoot = false;
  S.player.x = boat.x;
  S.player.z = boat.z;
  S.player.heading = boat.heading || 0;
  S.player.speed = boat.speed || 0;
  setMessage(S, 'Speedboat ready — hold W to sail!');
  pushEvent(S, 'splash');
}

function tryExitBoat(S) {
  const boat = S.boat;
  if (!boat) return;
  // Cari titik darat terdekat di sekeliling boat; kalau tidak ada, tetap di boat.
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    const x = boat.x + Math.sin(ang) * 5;
    const z = boat.z + Math.cos(ang) * 5;
    if (!isWater(S.city, x, z) && !solidAt(S.city, x, z)) {
      S.water.boats.push(boat);
      S.boat = null;
      S.player.x = x;
      S.player.z = z;
      S.player.heading = boat.heading || 0;
      S.player.speed = 0;
      S.player.onFoot = true;
      setMessage(S, 'Back on dry land.');
      return;
    }
  }
  setMessage(S, 'Too deep — sail to a dock!');
}

function garageAction(S) {
  const lvl = S.upgrades.speed;
  if (lvl < 3) {
    const cost = ENGINE_COSTS[lvl];
    if (S.money >= cost) {
      S.money -= cost;
      S.upgrades.speed = lvl + 1;
      if (S.car) { S.car.engineLevel = S.upgrades.speed; S.car.upgrade = S.upgrades.speed; }
      setMessage(S, `ENGINE Lv${lvl + 1} INSTALLED -$${cost}`);
      pushEvent(S, 'cash');
    } else {
      setMessage(S, `Engine Lv${lvl + 1} costs $${cost} — you have $${S.money}`);
    }
    return;
  }
  if (S.heat >= 200 && S.money >= 200) {
    S.money -= 200;
    S.heat = 0;
    setMessage(S, 'RESPRAY -$200 — heat cleared!');
    pushEvent(S, 'cash');
  } else if (S.heat >= 200) {
    setMessage(S, `Respray costs $200 — you have $${S.money}`);
  } else {
    setMessage(S, 'Engine maxed. Respray needs heat 200+.');
  }
}

function shopAction(S) {
  const slot = S.weapons.slot;
  if (slot === 0) {
    if (S.money >= 100) {
      S.money -= 100;
      S.upgrades.armor = 100;
      setMessage(S, 'ARMOR RESTORED -$100');
      pushEvent(S, 'cash');
    } else {
      setMessage(S, `Armor costs $100 — you have $${S.money}`);
    }
    return;
  }
  const w = WEAPONS[slot];
  const pack = { pistol: { cost: 40, n: 24 }, smg: { cost: 60, n: 40 }, shotgun: { cost: 50, n: 10 } }[w.ammoKey];
  if (!pack) return;
  if (S.money >= pack.cost) {
    S.money -= pack.cost;
    S.weapons.ammo[w.ammoKey] = (S.weapons.ammo[w.ammoKey] || 0) + pack.n;
    setMessage(S, `${w.name} AMMO +${pack.n} -$${pack.cost}`);
    pushEvent(S, 'cash');
  } else {
    setMessage(S, `${w.name} ammo costs $${pack.cost} — you have $${S.money}`);
  }
}

function safehouseAction(S) {
  saveGame(S);
  S.health = 100;
  setMessage(S, 'GAME SAVED — health restored');
  pushEvent(S, 'cash');
}

function doInteract(S) {
  const P = S.player;
  if (S.boat) {
    tryExitBoat(S);
    return;
  }
  if (S.car) {
    exitCar(S);
    return;
  }
  const boat = nearestBoat(S, 9); // boats moor ~6.5u off the dock edge
  if (boat) {
    boardBoat(S, boat);
    return;
  }
  const carEntry = nearestCarEntry(S, 4.5);
  if (carEntry) {
    stealCar(S, carEntry);
    return;
  }
  if (dist2d(P.x, P.z, S.city.garage.x, S.city.garage.z) < 9) {
    garageAction(S);
    return;
  }
  if (dist2d(P.x, P.z, S.city.shop.x, S.city.shop.z) < 7) {
    shopAction(S);
    return;
  }
  if (dist2d(P.x, P.z, S.city.safehouse.x, S.city.safehouse.z) < 7) {
    safehouseAction(S);
    return;
  }
}

// ---------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------
function damageCop(S, cop, dmg) {
  cop.hp -= dmg;
  if (cop.hp <= 0) {
    const i = S.cops.indexOf(cop);
    if (i >= 0) S.cops.splice(i, 1);
    S.heat = Math.min(500, S.heat + 60);
    S.rep += 5;
    setMessage(S, 'Cop down!');
  }
}

function tryFire(S) {
  const w = WEAPONS[S.weapons.slot];
  if (!w || !w.ammoKey) return;
  if (S.fireT > 0) return;
  if ((S.weapons.ammo[w.ammoKey] || 0) <= 0) {
    S.fireT = 0.3;
    setMessage(S, `No ${w.name} ammo — visit the shop!`);
    return;
  }
  S.weapons.ammo[w.ammoKey] -= 1;
  S.fireT = w.rate;
  S.heat = Math.min(500, S.heat + 2);
  pushEvent(S, 'shoot');
  const px = S.player.x;
  const pz = S.player.z;
  const h = S.player.heading;
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < S.cops.length; i++) {
    const c = S.cops[i];
    const d = dist2d(px, pz, c.x, c.z);
    if (d > w.range) continue;
    const ang = Math.abs(wrapAngle(Math.atan2(c.x - px, c.z - pz) - h));
    if (ang > w.cone) continue;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  if (best) damageCop(S, best, w.damage);
}

function tryPunch(S) {
  pushEvent(S, 'punch');
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < S.cops.length; i++) {
    const c = S.cops[i];
    const d = dist2d(S.player.x, S.player.z, c.x, c.z);
    if (d < 2.6 && d < bestD) {
      bestD = d;
      best = c;
    }
  }
  if (best) {
    S.heat = Math.min(500, S.heat + 5);
    damageCop(S, best, 1);
  }
}

function damagePlayer(S, dmg) {
  if (S.health <= 0) return;
  const absorbed = Math.min(S.upgrades.armor, dmg);
  S.upgrades.armor -= absorbed;
  S.health -= dmg - absorbed;
  if (S.health <= 0) {
    S.health = 0;
    doWasted(S);
  }
}

// ---------------------------------------------------------------------------
// Wanted / polisi / BUSTED / WASTED
// ---------------------------------------------------------------------------
function releasePenalty(S, label) {
  const penalty = Math.min(S.money, Math.max(50, Math.floor(S.money * 0.1)));
  S.money -= penalty;
  S.heat = 0;
  S.stars = 0;
  S.cops.length = 0;
  S.heli.active = false;
  S.health = 100;
  S.bustedT = 0;
  if (S.car) S.car = null;
  if (S.boat) {
    S.water.boats.push(S.boat);
    S.boat = null;
  }
  S.player.x = S.city.safehouse.x + 3;
  S.player.z = S.city.safehouse.z + 3;
  S.player.heading = 0;
  S.player.speed = 0;
  S.player.onFoot = true;
  S.mission = null;
  S.nextMissionT = 4;
  S.busted = true;
  S.bustedFlashT = 3;
  setMessage(S, `${label} -$${penalty} — released at the safehouse`);
  pushEvent(S, 'siren');
}

function doBusted(S) {
  releasePenalty(S, 'BUSTED!');
}

function doWasted(S) {
  releasePenalty(S, 'WASTED!');
}

function spawnCop(S, desired) {
  const carCops = S.cops.filter((c) => c.kind === 'car').length;
  const wantCar = S.stars >= 2 && carCops < Math.floor(desired / 2);
  for (let tries = 0; tries < 8; tries++) {
    const a = S.rng.range(0, Math.PI * 2);
    const d = 45 + S.rng.range(0, 20);
    const x = S.player.x + Math.sin(a) * d;
    const z = S.player.z + Math.cos(a) * d;
    if (solidAt(S.city, x, z)) continue;
    if (wantCar) {
      const car = createCar(x, z, S.rng.range(0, Math.PI * 2), 'sedan', '#1c2f5e');
      car.speed = 0;
      S.cops.push({ x, z, heading: car.heading, speed: 0, hp: 3, kind: 'car', car });
    } else {
      S.cops.push({ x, z, heading: 0, speed: 0, hp: 3, kind: 'foot', car: null });
    }
    return;
  }
}

function updateCops(S, dt) {
  const desired = [0, 2, 4, 6, 8, 10][S.stars] || 0;
  if (desired === 0) {
    if (S.cops.length) S.cops.length = 0;
  } else {
    S.copSpawnT -= dt;
    if (S.cops.length < desired && S.copSpawnT <= 0) {
      S.copSpawnT = 0.7;
      spawnCop(S, desired);
    }
    for (let i = S.cops.length - 1; i >= 0; i--) {
      if (dist2d(S.cops[i].x, S.cops[i].z, S.player.x, S.player.z) > 140) {
        S.cops.splice(i, 1);
      }
    }
  }

  let nearest = Infinity;
  for (let i = 0; i < S.cops.length; i++) {
    const c = S.cops[i];
    const dx = S.player.x - c.x;
    const dz = S.player.z - c.z;
    const d = Math.hypot(dx, dz) || 1;
    if (d < nearest) nearest = d;
    if (c.kind === 'foot') {
      const sp = 8;
      const nx = c.x + (dx / d) * sp * dt;
      const nz = c.z + (dz / d) * sp * dt;
      if (!solidAt(S.city, nx, nz)) {
        c.x = nx;
        c.z = nz;
      } else if (!solidAt(S.city, nx, c.z)) {
        c.x = nx;
      } else if (!solidAt(S.city, c.x, nz)) {
        c.z = nz;
      }
      c.heading = Math.atan2(dx, dz);
      c.speed = sp;
      if (d < 2.5) damagePlayer(S, 6 * dt);
    } else {
      const wantH = Math.atan2(dx, dz);
      c.heading = turnToward(c.heading, wantH, 2.4 * dt);
      // Mobil polisi dibatasi 9 u/s saat pemain jalan kaki, supaya pemain
      // bisa kabur dengan sprint 12 u/s. Saat pemain di mobil, kejar 22 u/s.
      const maxSp = S.player.onFoot ? 9 : 22;
      const wantSp = d > 25 ? maxSp : 6;
      c.speed += clamp(wantSp - c.speed, -14 * dt, 10 * dt);
      const nx = c.x + Math.sin(c.heading) * c.speed * dt;
      const nz = c.z + Math.cos(c.heading) * c.speed * dt;
      if (!solidAt(S.city, nx, nz)) {
        c.x = nx;
        c.z = nz;
      } else if (!solidAt(S.city, nx, c.z)) {
        c.x = nx;
      } else if (!solidAt(S.city, c.x, nz)) {
        c.z = nz;
      }
      if (c.car) {
        c.car.x = c.x;
        c.car.z = c.z;
        c.car.heading = c.heading;
        c.car.speed = c.speed;
      }
      if (d < 3.5) damagePlayer(S, 4 * dt);
    }
  }

  // Aturan BUSTED yang adil: hanya tertangkap bila polisi < 5 unit DAN
  // kecepatan pemain < 4 selama 4,5 detik berturut-turut.
  const pSpeed = S.player.speed || 0;
  if (nearest < 5 && pSpeed < 4) {
    S.bustedT += dt;
  } else {
    S.bustedT = Math.max(0, S.bustedT - dt * 2);
  }
  if (S.bustedT >= 4.5) doBusted(S);

  // Helikopter AIR-1 muncul saat bintang >= 3, mengikuti pemain.
  // Hover DI DEPAN pemain (searah heading), bukan di (x+12, z+12) yang
  // arbitrer — supaya heli terlihat di depan kamera saat kejar-kejaran.
  if (S.stars >= 3) {
    S.heli.active = true;
    const k = 1 - Math.exp(-dt * 1.5);
    const hd = (S.player && S.player.heading) || 0;
    const tx = S.player.x + Math.sin(hd) * 30;
    const tz = S.player.z + Math.cos(hd) * 30;
    S.heli.x += (tx - S.heli.x) * k;
    S.heli.z += (tz - S.heli.z) * k;
    S.heli.dist = dist2d(S.heli.x, S.heli.z, S.player.x, S.player.z);
  } else {
    S.heli.active = false;
  }
}

// Pejalan kaki: jalan pelan, belok acak / saat mentok dinding (wall-slide
// sederhana: coba maju, bila terhalang belok 90 derajat).
function updatePeds(S, dt) {
  const peds = S.peds || [];
  for (let i = 0; i < peds.length; i++) {
    const p = peds[i];
    p.turnT -= dt;
    if (p.turnT <= 0) {
      p.turnT = 2 + S.rng.range(0, 4);
      p.heading = wrapAngle(p.heading + S.rng.range(-1.2, 1.2));
    }
    const nx = p.x + Math.sin(p.heading) * p.speed * dt;
    const nz = p.z + Math.cos(p.heading) * p.speed * dt;
    if (!solidAt(S.city, nx, nz)) {
      p.x = nx;
      p.z = nz;
    } else {
      p.heading = wrapAngle(p.heading + Math.PI / 2);
      p.turnT = 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Loop utama game
// ---------------------------------------------------------------------------
export function stepGame(S, input, dt) {
  const inp = input || {};
  if (!(dt > 0)) dt = 0.016;
  if (dt > 0.05) dt = 0.05;

  // --- jam game: 1 jam per 30 detik nyata, mulai 18:00 DUSK ---
  S.gameTime += dt;
  S.time += dt / 30;
  if (S.time >= 24) {
    S.time -= 24;
    S.day += 1;
  }
  S.weatherT += dt;
  if (S.weatherT > 150) {
    S.weatherT = 0;
    if (S.rng.chance(0.3)) S.weather = S.rng.pick(['clear', 'cloudy', 'rain']);
  }
  S.district = districtAt(S.city, S.player.x, S.player.z);
  S.repLevel = repLevelName(S.rep);

  // --- wanted: bintang dari heat, heat meluruh pelan (tidak saat escape) ---
  S.stars = starsFor(S.heat);
  const escaping =
    S.mission && S.mission.stageDef && S.mission.stageDef.type === 'escape';
  if (S.heat > 0) {
    if (escaping) {
      if (S.heat < 200) S.heat = 200;
    } else if (S.heli.active) {
      S.heat = Math.max(0, S.heat - 1 * dt);
    } else {
      S.heat = Math.max(0, S.heat - 2.5 * dt);
    }
  }

  // --- ganti senjata (1..4) ---
  if (inp.slot >= 1 && inp.slot <= 4) {
    const ns = inp.slot - 1;
    if (ns !== S.weapons.slot) {
      S.weapons.slot = ns;
      const w = WEAPONS[ns];
      if (w.ammoKey) setMessage(S, `${w.name} — ${S.weapons.ammo[w.ammoKey]} ammo`);
      else setMessage(S, 'Fists');
    }
  }

  // --- interaksi (E) ---
  if (inp.interact) doInteract(S);

  // --- gerak: boat / mobil / jalan kaki ---
  if (S.boat) {
    stepBoat(S.boat, inp, dt, S.city);
    S.player.x = S.boat.x;
    S.player.z = S.boat.z;
    S.player.heading = S.boat.heading;
    S.player.speed = S.boat.speed || 0;
    S.player.onFoot = false;
  } else if (S.car) {
    stepCar(S.car, inp, dt, S.city);
    S.player.x = S.car.x;
    S.player.z = S.car.z;
    S.player.heading = S.car.heading;
    S.player.speed = S.car.speed || 0;
    S.player.onFoot = false;
    // Drift payout: stepCar records it in car.driftPayout (50 per drift
    // >= 0.5s). Claim it here exactly once, then zero it.
    if (S.car.driftPayout > 0) {
      const payout = S.car.driftPayout;
      S.car.driftPayout = 0;
      S.money += payout;
      S.totalEarned += payout;
      S.rep += 2;
      setPopup(S, `DRIFT x${S.car.driftCount} +$${payout}`);
      pushEvent(S, 'cash');
    }
  } else {
    stepPlayer(S.player, inp, dt, S.city);
  }

  // --- combat (hanya jalan kaki) ---
  S.fireT = Math.max(0, S.fireT - dt);
  if (!S.car && !S.boat) {
    if (inp.shoot && S.weapons.slot > 0) tryFire(S);
    if (inp.punch) tryPunch(S);
  }

  // --- dunia: traffic, taksi, air, pejalan kaki ---
  stepTraffic(S.traffic, S, dt);
  stepTaxi(S.taxi, S, dt);
  stepWater(S.water, S, dt);
  updatePeds(S, dt);

  // --- fare taksi: jobs.js menambahkan ke S.money dan mengisi T.lastFare ---
  if (S.taxi && typeof S.taxi.lastFare === 'number' && S.taxi.lastFare > 0) {
    setPopup(S, `TAXI FARE +$${S.taxi.lastFare}`);
    S.rep += 5;
    S.taxi.lastFare = 0;
  }

  // --- stash: 6 paket tersembunyi, +$100 tiap paket (jalan kaki) ---
  if (!S.car && !S.boat) {
    for (let i = 0; i < S.city.stashes.length; i++) {
      if (S.stashes[i]) continue;
      const st = S.city.stashes[i];
      if (dist2d(S.player.x, S.player.z, st.x, st.z) < 3) {
        S.stashes[i] = true;
        S.stashCount++;
        S.money += 100;
        S.totalEarned += 100;
        S.rep += 10;
        setPopup(S, 'STASH PACK +$100');
        pushEvent(S, 'pickup');
      }
    }
  }

  // --- misi ---
  updateMission(S, dt);

  // --- polisi + heli + BUSTED ---
  updateCops(S, dt);

  // --- regen darah pelan saat tidak diburu ---
  if (S.stars === 0 && S.health > 0 && S.health < 100) {
    S.health = Math.min(100, S.health + 2 * dt);
  }

  // --- timer pesan / popup / busted ---
  if (S.messageT > 0) {
    S.messageT -= dt;
    if (S.messageT <= 0) S.message = '';
  }
  if (S.popupT > 0) {
    S.popupT -= dt;
    if (S.popupT <= 0) S.popup = '';
  }
  if (S.bustedFlashT > 0) {
    S.bustedFlashT -= dt;
    if (S.bustedFlashT <= 0) S.busted = false;
  }
}
