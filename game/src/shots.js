// shots.js — Sunset Bay v5 (Builder D)
// Scene staged untuk screenshot (?shot=<nama>): atur uang, heat, posisi,
// misi, jam, dll. per scene. Modul mandiri, tanpa impor.
// Ditulis fresh dari design-spec, sesi recording 01a1f13f-5466-77cb-9088-12e78d473c06.

'use strict';

export const SHOT_NAMES = ['start', 'play', 'foot', 'end'];

// Cari pusat distrik dari S.city bila ada; fallback ke koordinat default.
function districtCenter(S, name, fallback) {
  const districts = (S && S.city && S.city.districts) || [];
  for (let i = 0; i < districts.length; i++) {
    if (districts[i].name === name) return { x: districts[i].cx || 0, z: districts[i].cz || 0 };
  }
  return fallback;
}

// Titik yang benar-benar bisa dipijak (bukan di dalam gedung/air, dengan
// ruang gerak 3 unit). Tanpa ini scene bisa menaruh pemain DI DALAM gedung
// — kamera ikut di dalam dan screenshot hanya menampilkan dinding.
function solidAt(S, x, z) {
  const city = S && S.city;
  if (!city) return false;
  const b = city.bounds;
  if (b && (x < b.minX + 0.5 || x > b.maxX - 0.5 || z < b.minZ + 0.5 || z > b.maxZ - 0.5)) return true;
  for (let i = 0; i < (city.buildings || []).length; i++) {
    const bd = city.buildings[i];
    if (Math.abs(x - bd.x) < bd.w / 2 + 0.6 && Math.abs(z - bd.z) < bd.d / 2 + 0.6) return true;
  }
  for (let i = 0; i < (city.water || []).length; i++) {
    const w = city.water[i];
    if (Math.abs(x - w.x) < w.w / 2 && Math.abs(z - w.z) < w.d / 2) return true;
  }
  return false;
}

function clearSpot(S, x, z, maxR) {
  const ok = (px, pz) => !solidAt(S, px, pz)
    && !solidAt(S, px + 3, pz) && !solidAt(S, px - 3, pz)
    && !solidAt(S, px, pz + 3) && !solidAt(S, px, pz - 3);
  if (ok(x, z)) return { x, z };
  for (let r = 2; r <= (maxR || 30); r += 2) {
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      const px = Math.round(x + Math.sin(ang) * r);
      const pz = Math.round(z + Math.cos(ang) * r);
      if (ok(px, pz)) return { x: px, z: pz };
    }
  }
  return { x, z };
}

function ensurePlayer(S) {
  if (!S.player) S.player = {};
  const P = S.player;
  if (typeof P.x !== 'number') P.x = 0;
  if (typeof P.z !== 'number') P.z = 0;
  if (typeof P.heading !== 'number') P.heading = 0;
  if (typeof P.speed !== 'number') P.speed = 0;
  if (typeof P.onFoot !== 'boolean') P.onFoot = true;
  if (typeof P.weapon !== 'number') P.weapon = 0;
  if (typeof P.hp !== 'number') P.hp = 100;
  return P;
}

function ensureCar(S, x, z, heading, model, color) {
  if (!S.car) S.car = {};
  const C = S.car;
  C.x = x; C.z = z;
  C.heading = heading;
  C.speed = 0;
  C.model = model || 'sport';
  C.color = color || '#e33e2b';
  C.steer = 0;
  C.drifting = false;
  C.driftTime = 0;
  C.driftPayout = 0;
  C.driftCount = 0;
  C.engineLevel = 0;
  C.upgrade = 0;
  return C;
}

function setCop(S, i, x, z, heading) {
  if (!Array.isArray(S.cops)) S.cops = [];
  while (S.cops.length <= i) S.cops.push({});
  const c = S.cops[i];
  c.x = x; c.z = z;
  c.heading = heading || 0;
  c.speed = 0;
  c.hp = 3;
  c.kind = 'foot';
  c.car = null;
  c.skin = '#c98d64';
  c.model = 'police';
  return c;
}

function setCommon(S, fields) {
  for (const k in fields) S[k] = fields[k];
  // Sinkronkan alias yang dipakai modul lain, supaya HUD/game membaca
  // nilai yang sama apa pun nama field yang mereka pakai.
  if (typeof S.money === 'number') S.cash = S.money;
  if (typeof S.heat === 'number') {
    S.stars = Math.max(0, Math.min(5, Math.floor(S.heat / 100)));
    S.wanted = S.stars;
  }
  if (typeof S.time === 'number') S.hour = S.time;
}

// 'start' — title screen: logo SUNSET BAY + tombol START ENGINE.
// Uang 0, tidak ada misi aktif, senja, pemain di pusat kota, jalan kaki.
function shotStart(S) {
  const P = ensurePlayer(S);
  const downtown = districtCenter(S, 'Downtown', { x: 0, z: -10 });
  const spot = clearSpot(S, downtown.x, downtown.z, 30);
  P.x = spot.x; P.z = spot.z; P.heading = 0; P.onFoot = true; P.weapon = 0;
  S.car = null;
  S.cops = [];
  // Heli must stay an OBJECT (game.js updateCops writes S.heli.active).
  S.heli = { active: false, x: 0, z: 0, dist: 0 };
  S.showMap = false;
  setCommon(S, {
    state: 'title',
    mode: 'title',
    screen: 'title',
    money: 0,
    heat: 0,
    rep: 0,
    repLevel: 'ROOKIE',
    missionIndex: 0,
    // S.mission is an OBJECT in game.js ({index, stage, ...}) or null —
    // NEVER a number: updateMission would crash on a number.
    mission: null,
    missionsDone: 0,
    missionsCompleted: 0,
    missionName: 'First Wheels',
    missionTarget: null,
    time: 18.0,
    district: 'Downtown',
    message: '',
    paused: false,
  });
}

// 'play' — mengemudi + misi + polisi: mobil sport merah, misi Street Race
// aktif (3/18), 2 bintang, senja, polisi di belakang, minimap ramai.
function shotPlay(S) {
  const P = ensurePlayer(S);
  const mall = districtCenter(S, 'Sunset Mall', { x: 40, z: 15 });
  const downtown = districtCenter(S, 'Downtown', { x: 0, z: -10 });
  const cx = (mall.x + downtown.x) / 2;
  const cz = (mall.z + downtown.z) / 2;
  const spot = clearSpot(S, cx, cz, 25);
  ensureCar(S, spot.x, spot.z, Math.PI * 0.25, 'sport', '#e33e2b');
  S.car.speed = 22;
  P.x = spot.x; P.z = spot.z; P.heading = Math.PI * 0.25; P.onFoot = false; P.weapon = 1;
  S.inCar = true;
  setCop(S, 0, spot.x - 18, spot.z - 14, Math.PI * 0.25);
  setCop(S, 1, spot.x - 26, spot.z + 6, Math.PI * 0.25);
  S.heli = { active: false, x: 0, z: 0, dist: 0 };
  S.showMap = false;
  setCommon(S, {
    state: 'playing',
    mode: 'playing',
    screen: 'playing',
    money: 1250,
    heat: 210,
    rep: 350,
    repLevel: 'HUSTLER',
    missionIndex: 2,
    mission: null,
    missionsDone: 2,
    missionsCompleted: 2,
    missionName: 'Street Race',
    missionTarget: { x: mall.x, z: mall.z },
    target: { x: mall.x, z: mall.z },
    time: 18.4,
    district: 'Downtown',
    message: 'Race to Sunset Mall!',
    paused: false,
  });
  // Ammo pistol terisi supaya slot senjata di HUD terlihat hidup.
  // Canonical shape (game.js): S.weapons = { slot, ammo: {...} }.
  if (!S.weapons) S.weapons = { slot: 1, ammo: { pistol: 48, smg: 120, shotgun: 12 } };
  else {
    S.weapons.slot = 1;
    S.weapons.ammo = { pistol: 48, smg: 120, shotgun: 12 };
  }
  S.weaponIndex = 1;
  S.weapon = 1;
}

// 'foot' — jalan kaki + crosshair: pemain bersenjata (pistol), siang hari,
// pejalan kaki & traffic di sekitar, tanpa polisi, tanpa mobil.
function shotFoot(S) {
  const P = ensurePlayer(S);
  const beach = districtCenter(S, 'Beachfront', { x: -70, z: -45 });
  const spot = clearSpot(S, beach.x, beach.z, 30);
  P.x = spot.x; P.z = spot.z; P.heading = 0;
  P.onFoot = true; P.weapon = 1; P.speed = 0;
  S.car = null;
  S.inCar = false;
  S.cops = [];
  S.heli = { active: false, x: 0, z: 0, dist: 0 };
  S.showMap = false;
  setCommon(S, {
    state: 'playing',
    mode: 'playing',
    screen: 'playing',
    money: 800,
    heat: 0,
    rep: 150,
    repLevel: 'ROOKIE',
    missionIndex: 1,
    mission: null,
    missionsDone: 1,
    missionsCompleted: 1,
    missionName: 'Package Run',
    missionTarget: { x: beach.x + 40, z: beach.z + 10 },
    target: { x: beach.x + 40, z: beach.z + 10 },
    time: 10.5,
    district: 'Beachfront',
    message: 'On foot — head to the marker',
    paused: false,
  });
  if (!S.weapons) S.weapons = { slot: 1, ammo: { pistol: 36, smg: 90, shotgun: 8 } };
  else {
    S.weapons.slot = 1;
    S.weapons.ammo = { pistol: 36, smg: 90, shotgun: 8 };
  }
  S.weaponIndex = 1;
  S.weapon = 1;
}

// 'end' — HUD padat: uang besar, 4 bintang, REP KINGPIN, misi 17/18
// (finale Sunset Heist), heli AIR-1 + roadblock polisi, matahari terbenam.
function shotEnd(S) {
  const P = ensurePlayer(S);
  const marina = districtCenter(S, 'Marina Bay', { x: 70, z: -20 });
  // Try open waterfront spots; the CAR spot AND the CAMERA spot (13u
  // behind the car) must both be clear, otherwise a building fills the
  // frame or hides the heli.
  const cands = [
    { x: -100, z: 172, h: -Math.PI / 2 },
    { x: -130, z: 172, h: -Math.PI / 2 },
    { x: -100, z: 172, h: Math.PI / 2 },
    { x: -70, z: 160, h: 0 },
    { x: marina.x, z: marina.z - 8, h: -Math.PI * 0.2 },
  ];
  let pick = null;
  for (const c of cands) {
    const spot = clearSpot(S, c.x, c.z, 10);
    const camX = spot.x - Math.sin(c.h) * 13;
    const camZ = spot.z - Math.cos(c.h) * 13;
    if (!solidAt(S, camX, camZ) && !solidAt(S, spot.x, spot.z)) {
      pick = { x: spot.x, z: spot.z, h: c.h };
      break;
    }
  }
  if (!pick) pick = { x: -100, z: 172, h: -Math.PI / 2 };
  const cx = pick.x;
  const cz = pick.z;
  const hd = pick.h;
  ensureCar(S, cx, cz, hd, 'sport', '#f2a007');
  S.car.speed = 18;
  P.x = cx; P.z = cz; P.heading = hd; P.onFoot = false; P.weapon = 2;
  S.inCar = true;
  setCop(S, 0, cx - 12, cz - 10, hd);
  setCop(S, 1, cx - 20, cz + 8, hd);
  setCop(S, 2, cx + 22, cz - 4, Math.PI * 0.8);
  setCop(S, 3, cx + 30, cz + 10, Math.PI * 0.8);
  // Heli ahead-and-to-the-side (forward + right of heading), y=20.
  const fx = Math.sin(hd), fz = Math.cos(hd);
  const rx = Math.cos(hd), rz = -Math.sin(hd);
  S.heli = { active: true, x: cx + fx * 30 + rx * 8, z: cz + fz * 30 + rz * 8, y: 13, heading: 0, speed: 12, dist: 31 };
  S.helicopter = S.heli;
  S.showMap = false;
  setCommon(S, {
    state: 'playing',
    mode: 'playing',
    screen: 'playing',
    money: 12480,
    heat: 430,
    rep: 1200,
    repLevel: 'KINGPIN',
    missionIndex: 17,
    mission: null,
    missionsDone: 17,
    missionsCompleted: 17,
    missionName: 'Sunset Heist',
    missionTarget: { x: marina.x, z: marina.z },
    target: { x: marina.x, z: marina.z },
    time: 18.2,
    district: 'Marina Bay',
    message: 'Sunset Heist — escape by sea!',
    paused: false,
  });
  if (!S.weapons) S.weapons = { slot: 2, ammo: { pistol: 60, smg: 200, shotgun: 24 } };
  else {
    S.weapons.slot = 2;
    S.weapons.ammo = { pistol: 60, smg: 200, shotgun: 24 };
  }
  S.weaponIndex = 2;
  S.weapon = 2;
  // 5 of 6 stash packs found (boolean array is the canonical shape).
  S.stashes = [true, true, true, true, true, false];
  S.stashCount = 5;
  S.stashFound = 5;
  S.stashesFound = 5;
}

const SHOTS = { start: shotStart, play: shotPlay, foot: shotFoot, end: shotEnd };

export function applyShot(S, name) {
  if (!S) return false;
  const fn = SHOTS[name];
  if (!fn) return false;
  // Reset ringan yang berlaku untuk semua scene: timer drift & pesan lama
  // tidak boleh bocor antar scene.
  if (S.car) { S.car.drifting = false; S.car.driftTime = 0; }
  fn(S);
  S.shot = name;
  // Jangan auto-start misi selama scene screenshot (target harus tetap
  // seperti yang di-stage di atas).
  S.nextMissionT = 9999;
  return true;
}
