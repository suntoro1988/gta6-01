// game.js — Sunset Bay core: state, missions, wanted, clock, stash, save/load.
// Fresh build. Imports jobs (MISSIONS), player, city (collider) and vehicles
// (wanted/heli visuals only — every call guarded; game.js owns the logic).
import { MISSIONS, taxiJob } from './jobs.js';
import { createPlayer } from './player.js';
import * as City from './city.js';
import * as Vehicles from './vehicles.js';

export const SAVE_KEY = 'sunset-bay-save-v1';
const DAY_SECONDS = 360; // one full 24h cycle = 360 real seconds (1 game-hour = 15s)
const BOUND = 380;
const SAFEHOUSE = { x: 0, z: 0 };
const STASH_SPOTS = [
  { id: 0, x: 210, z: -140 }, { id: 1, x: -260, z: 90 }, { id: 2, x: 40, z: 300 },
  { id: 3, x: -120, z: -280 }, { id: 4, x: 300, z: 180 }, { id: 5, x: -40, z: -40 },
];
const REP_RANKS = [
  { min: 0, name: 'ROOKIE' }, { min: 600, name: 'HUSTLER' }, { min: 1300, name: 'KINGPIN' },
];
const CRIME_WANTED = { steal: 1, hit: 1, shoot: 1, kill: 2 };

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const d2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const num = (v, d, a, b) => { const n = Number(v); return Number.isFinite(n) ? clamp(n, a, b) : d; };

// 0 = deep night, 1 = noon. Clock 18:00 (sunset) -> 0, 12:00 -> 1, 0:00 -> 0.
export function daylight(clock) {
  const s = Math.sin((clock - 6) / 12 * Math.PI);
  if (s <= 0.001) return 0;
  if (s >= 0.999) return 1;
  return s;
}
function rankFor(rep) {
  let r = REP_RANKS[0];
  for (const k of REP_RANKS) if (rep >= k.min) r = k;
  return r.name;
}
function parTime(m) { return 60 + m.stages.length * 40; }

function defaultState() {
  return {
    money: 250, rep: 0, repRank: 'ROOKIE', wanted: 0, heat: 0,
    missionIndex: 0, stageIndex: 0, missionActive: false, missionTime: 0,
    clock: 18, daylight: 0, speed: 0, health: 100, armor: 0,
    stashFound: [], pos: { x: 0, y: 0, z: 0 }, vehicle: null, player: null,
    upgrades: { engine: 0, armor: 0, weapon: 0 },
    stats: { missionsDone: 0, earned: 0, stashes: 0, drifts: 0, busted: 0, wasted: 0, taxiDone: 0, crimes: 0, distance: 0 },
    police: [], heli: null, taxi: null,
    bustedTimer: 0, driftCd: 0, over: false, lastCash: null,
  };
}

// Merge a loaded save into live state field-by-field with validation.
// Never assigns raw save data onto state; unknown/missing fields keep live values.
export function applySave(G, data) {
  if (!G || !data || typeof data !== 'object') return G;
  G.money = num(data.money, G.money, 0, 9999999);
  G.rep = num(data.rep, G.rep, 0, 1800); // max legit: 18 missions x 100
  G.repRank = rankFor(G.rep);
  G.missionIndex = clamp(Math.floor(num(data.missionIndex, 0, 0, MISSIONS.length - 1)), 0, MISSIONS.length - 1);
  G.stageIndex = 0; G.missionActive = false; G.missionTime = 0;
  if (Array.isArray(data.stashFound)) {
    G.stashFound = [...new Set(data.stashFound)].filter(id => Number.isInteger(id) && id >= 0 && id < STASH_SPOTS.length);
  }
  if (data.upgrades && typeof data.upgrades === 'object') {
    for (const k of ['engine', 'armor', 'weapon']) G.upgrades[k] = clamp(Math.floor(num(data.upgrades[k], G.upgrades[k], 0, 3)), 0, 3);
  }
  if (data.stats && typeof data.stats === 'object') {
    for (const k of Object.keys(G.stats)) G.stats[k] = num(data.stats[k], G.stats[k], 0, 1e9);
  }
  G.clock = num(data.clock, G.clock, 0, 24);
  if (G.player && data.pos && typeof data.pos === 'object') {
    G.player.pos.x = num(data.pos.x, G.player.pos.x, -BOUND, BOUND);
    G.player.pos.z = num(data.pos.z, G.player.pos.z, -BOUND, BOUND);
    G.player.pos.y = 0; G.player.vel.x = 0; G.player.vel.z = 0;
  }
  if (G.player) {
    G.player.health = num(data.health, G.player.health, 0, 100);
    G.player.armor = num(data.armor, G.player.armor, 0, 100);
    G.health = G.player.health; G.armor = G.player.armor;
    if (Array.isArray(data.ammo)) {
      for (let i = 1; i < 4; i++) {
        const a = num(data.ammo[i], G.player.ammo[i], 0, 9999);
        if (Number.isFinite(a)) G.player.ammo[i] = a;
      }
    }
    if (Number.isInteger(data.weapon)) G.player.weapon = clamp(data.weapon, 0, 3);
  }
  // Fresh session starts clean: no cops, no heli, no active job.
  G.wanted = 0; G.heat = 0; G.police = []; G.heli = null; G.taxi = null; G.bustedTimer = 0;
  return G;
}

export function createGame(city, rng) {
  const rand = (rng && typeof rng.next === 'function') ? () => rng.next()
    : (typeof rng === 'function' ? rng : Math.random);
  const G = defaultState();
  const spawn = (city && city.SPAWN) || City.SPAWN || SAFEHOUSE;
  // `let`: reset() swaps in a fresh player object and every closure below
  // (update, respawn, doBusted, doWasted, ...) must follow the new one.
  // (Was `const`: after a New Game the closures kept driving the stale
  // pre-reset player while G.player/rendering used the new one, so the
  // visible player stopped moving and wasted/busted broke.)
  let player = createPlayer({ x: spawn.x || 0, z: spawn.z || 0 });
  G.player = player;
  G.pos = player.pos; // same object reference: G.pos always tracks the player
  G.health = player.health;
  G.armor = player.armor;

  function addCash(n, why) {
    G.money = Math.max(0, Math.round(G.money + n));
    if (n > 0) G.stats.earned += n;
    G.lastCash = { n, why: why || '', at: G.clock };
    return G.money;
  }
  function ensureHeli() {
    if (G.wanted >= 3 && !G.heli) {
      const a = rand() * Math.PI * 2;
      const hx = G.pos.x + Math.cos(a) * 30, hz = G.pos.z + Math.sin(a) * 30;
      let id = null;
      try { if (typeof Vehicles.spawnHeli === 'function') id = Vehicles.spawnHeli(hx, hz) || null; } catch (e) {}
      G.heli = { id, x: hx, z: hz, y: 55 };
    } else if (G.wanted < 3 && G.heli) {
      try { if (typeof Vehicles.removeHeli === 'function') Vehicles.removeHeli(G.heli.id); } catch (e) {}
      G.heli = null;
    }
  }
  function syncPolice() {
    const want = clamp(G.wanted, 0, 5);
    while (G.police.length < want) {
      const a = rand() * Math.PI * 2, d = 40 + rand() * 20;
      const x = G.pos.x + Math.cos(a) * d, z = G.pos.z + Math.sin(a) * d;
      let id = null;
      try { if (typeof Vehicles.spawnPoliceCar === 'function') id = Vehicles.spawnPoliceCar(x, z) || null; } catch (e) {}
      G.police.push({ id, x, z, hp: 100 });
    }
    while (G.police.length > want) {
      const c = G.police.pop();
      try { if (typeof Vehicles.removePoliceCar === 'function') Vehicles.removePoliceCar(c.id); } catch (e) {}
    }
  }
  function setWanted(n) {
    G.wanted = clamp(Math.round(n), 0, 5);
    G.heat = G.wanted > 0 ? Math.max(G.heat, G.wanted * 20) : 0;
    ensureHeli();
    syncPolice();
    return G.wanted;
  }
  // kind: 'steal' (take a car), 'hit' (ram/hit someone), 'shoot', 'kill' (down a cop).
  // Called by main/vehicles when the player commits the crime.
  function commitCrime(kind) {
    G.stats.crimes++;
    G.heat = 100;
    return setWanted(G.wanted + (CRIME_WANTED[kind] || 1));
  }
  function startMission(i) {
    const idx = (i === undefined || i === null) ? G.missionIndex : i;
    if (idx < 0 || idx >= MISSIONS.length) return false;
    G.missionIndex = idx; G.stageIndex = 0; G.missionActive = true; G.missionTime = 0;
    return true;
  }
  function missionState() {
    if (!G.missionActive) return null;
    const m = MISSIONS[G.missionIndex];
    const st = m.stages[G.stageIndex];
    return { missionId: m.id, name: m.name, brief: m.brief, stageIndex: G.stageIndex,
      stageTotal: m.stages.length, stage: st, reward: m.reward,
      elapsed: G.missionTime, par: parTime(m), fastBonus: Math.round(m.reward * 0.5) };
  }
  function completeMission() {
    const m = MISSIONS[G.missionIndex];
    const bonus = G.missionTime <= parTime(m) ? Math.round(m.reward * 0.5) : 0;
    addCash(m.reward + bonus, 'mission:' + m.name);
    G.rep += 100; G.repRank = rankFor(G.rep);
    G.stats.missionsDone++;
    G.missionActive = false; G.stageIndex = 0; G.missionTime = 0;
    if (G.missionIndex < MISSIONS.length - 1) G.missionIndex++;
    else G.over = true;
    return { reward: m.reward, bonus, total: m.reward + bonus, name: m.name };
  }
  function failMission() { G.missionActive = false; G.stageIndex = 0; G.missionTime = 0; }
  function startTaxi(pickup, dropoff) {
    const job = taxiJob(pickup, dropoff);
    G.taxi = { pickup: job.pickup, dropoff: job.dropoff, fare: job.fare, distance: job.distance, stage: 'pickup' };
    return G.taxi;
  }
  function buyUpgrade(kind) {
    if (!Object.prototype.hasOwnProperty.call(G.upgrades, kind)) return false;
    const lvl = G.upgrades[kind];
    if (lvl >= 3) return false;
    const cost = 300 * (lvl + 1);
    if (G.money < cost) return false;
    addCash(-cost, 'upgrade:' + kind);
    G.upgrades[kind] = lvl + 1;
    if (kind === 'armor') { player.armor = Math.min(100, player.armor + 50); G.armor = player.armor; }
    return true;
  }
  function respawn() {
    const sh = (city && city.SAFEHOUSE) || City.SAFEHOUSE || SAFEHOUSE;
    player.pos.x = sh.x || 0; player.pos.z = sh.z || 0; player.pos.y = 0;
    player.vel.x = 0; player.vel.z = 0;
    player.health = 100; player.armor = 0;
    G.health = 100; G.armor = 0; G.vehicle = null;
  }
  function clearPoliceVisuals() {
    try { if (typeof Vehicles.clearPolice === 'function') Vehicles.clearPolice(); } catch (e) {}
    try { if (typeof Vehicles.removeHeli === 'function' && G.heli) Vehicles.removeHeli(G.heli.id); } catch (e) {}
    G.police = []; G.heli = null;
  }
  function doBusted() {
    const loss = Math.round(G.money * 0.1);
    addCash(-loss, 'busted');
    G.stats.busted++;
    G.wanted = 0; G.heat = 0; G.bustedTimer = 0;
    failMission();
    clearPoliceVisuals();
    respawn();
    return { loss };
  }
  function doWasted() {
    const loss = Math.round(G.money * 0.1);
    addCash(-loss, 'wasted');
    G.stats.wasted++;
    G.wanted = Math.max(0, G.wanted - 1);
    G.heat = 0;
    failMission();
    respawn();
    ensureHeli(); syncPolice();
    return { loss };
  }
  function nearestPolice() {
    let best = Infinity;
    for (const c of G.police) best = Math.min(best, d2(c.x, c.z, G.pos.x, G.pos.z));
    return best;
  }

  function update(dt, input) {
    dt = clamp(dt || 0, 0, 0.05);
    G.clock = (G.clock + dt * 24 / DAY_SECONDS) % 24;
    G.daylight = daylight(G.clock);
    player.update(dt, input || {}, city);
    G.health = player.health; G.armor = player.armor;
    const speed = G.vehicle ? (G.vehicle.speed || 0) : Math.hypot(player.vel.x, player.vel.z);
    G.speed = speed;
    G.stats.distance += speed * dt;
    if (G.driftCd > 0) G.driftCd -= dt;

    // --- missions: reach the current stage target to advance ---
    if (G.missionActive) {
      G.missionTime += dt;
      const m = MISSIONS[G.missionIndex];
      const st = m.stages[G.stageIndex];
      const r = st.type === 'race' ? 7 : 9;
      if (d2(G.pos.x, G.pos.z, st.x, st.z) < r) {
        G.stageIndex++;
        if (G.stageIndex >= m.stages.length) completeMission();
      }
    }
    // --- taxi: pickup first, then dropoff pays the fare ---
    if (G.taxi) {
      const t = G.taxi.stage === 'pickup' ? G.taxi.pickup : G.taxi.dropoff;
      if (d2(G.pos.x, G.pos.z, t.x, t.z) < 8) {
        if (G.taxi.stage === 'pickup') G.taxi.stage = 'dropoff';
        else { addCash(G.taxi.fare, 'taxi'); G.stats.taxiDone++; G.taxi = null; }
      }
    }
    // --- hidden stash packs: +$100 each ---
    for (const s of STASH_SPOTS) {
      if (G.stashFound.indexOf(s.id) === -1 && d2(G.pos.x, G.pos.z, s.x, s.z) < 3.5) {
        G.stashFound.push(s.id);
        addCash(100, 'stash:' + s.id);
        G.stats.stashes++;
      }
    }
    // --- drift bonus: +$50, max once per 3s (vehicle.drifting set by vehicles.js) ---
    if (G.vehicle && G.vehicle.drifting && G.driftCd <= 0) {
      addCash(50, 'drift');
      G.stats.drifts++;
      G.driftCd = 3;
    }
    // --- wanted / heat: cools down while hiding, faster on 'escape' stages ---
    if (G.wanted > 0) {
      const near = nearestPolice();
      const hidden = speed < 3 && near > 35 && !G.heli;
      const escaping = G.missionActive && MISSIONS[G.missionIndex].stages[G.stageIndex].type === 'escape';
      let decay = hidden ? 6 : 0.8;
      if (escaping) decay *= 2;
      G.heat -= decay * dt;
      if (G.heat <= 0) {
        G.wanted--;
        G.heat = G.wanted > 0 ? 60 : 0;
        ensureHeli(); syncPolice();
      }
    }
    // --- police chase: prefer external positions when vehicles.js provides them ---
    let ext = null;
    try { if (typeof Vehicles.getPolicePositions === 'function') ext = Vehicles.getPolicePositions(); } catch (e) {}
    if (Array.isArray(ext)) {
      G.police = ext.map((e, i) => ({ id: (G.police[i] && G.police[i].id) || null,
        x: e.x, z: e.z, hp: (G.police[i] && G.police[i].hp) || 100 }));
    } else {
      for (const c of G.police) {
        const d = d2(c.x, c.z, G.pos.x, G.pos.z);
        if (d > 4) {
          const step = Math.min(15 * dt, d - 4);
          c.x += (G.pos.x - c.x) / d * step;
          c.z += (G.pos.z - c.z) / d * step;
        }
      }
    }
    // --- heli AIR-1 chases from above while wanted >= 3 ---
    if (G.heli) {
      let hx = null;
      try { if (typeof Vehicles.getHeliPosition === 'function') hx = Vehicles.getHeliPosition(); } catch (e) {}
      if (hx && typeof hx.x === 'number') { G.heli.x = hx.x; G.heli.z = hx.z; }
      else {
        const d = d2(G.heli.x, G.heli.z, G.pos.x, G.pos.z);
        if (d > 6) {
          const step = Math.min(20 * dt, d - 6);
          G.heli.x += (G.pos.x - G.heli.x) / d * step;
          G.heli.z += (G.pos.z - G.heli.z) / d * step;
        }
      }
    }
    // --- busted: cop within 5 units AND player speed < 4, sustained 4.5s ---
    if (nearestPolice() < 5 && speed < 4) {
      G.bustedTimer += dt;
      if (G.bustedTimer >= 4.5) doBusted();
    } else {
      G.bustedTimer = Math.max(0, G.bustedTimer - dt * 2);
    }
    // --- wasted: health 0 -> respawn at safehouse, lose 10% cash ---
    if (player.health <= 0) doWasted();
    G.health = player.health; G.armor = player.armor;
  }

  function saveData() {
    return { v: 1, money: G.money, rep: G.rep, missionIndex: G.missionIndex,
      stashFound: G.stashFound.slice(), upgrades: { ...G.upgrades },
      stats: { ...G.stats }, clock: G.clock,
      pos: { x: player.pos.x, z: player.pos.z },
      health: player.health, armor: player.armor,
      ammo: player.ammo.slice(), weapon: player.weapon };
  }
  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(saveData())); return true; }
    catch (e) { return false; }
  }
  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      applySave(G, JSON.parse(raw));
      return true;
    } catch (e) { return false; }
  }
  function reset() {
    const fresh = defaultState();
    for (const k of Object.keys(G)) delete G[k];
    Object.assign(G, fresh);
    const np = createPlayer({ x: spawn.x || 0, z: spawn.z || 0 });
    player = np; // keep the closure player in sync with G.player
    G.player = np; G.pos = np.pos; G.health = np.health; G.armor = np.armor;
    clearPoliceVisuals();
  }

  return { G, update, startMission, missionState, addCash, setWanted, commitCrime,
    startTaxi, buyUpgrade, save, load, reset, applySave, daylight, respawn, parTime };
}
export { STASH_SPOTS, REP_RANKS };
