// The game itself: 12 named missions in stages, money, the wanted system,
// on-foot combat, the police helicopter, garage/shop/safehouse, pedestrians,
// pickups and hidden stash packs. Rendering lives in main.js; this file only
// moves the world forward. Deterministic: every random choice comes from the
// seeded rng.
import { LINES, WORLD, PLACES, districtAt, generateCity, buildingColliders } from './city.js';
import { createRng } from './rng.js';
import {
  CAR_RADIUS,
  CAR_MODELS,
  createHeli,
  createPoliceCar,
  createTrafficCar,
  resolveCarPair,
  stepHeli,
  stepPlayerCar,
  stepPolice,
  stepTraffic,
} from './vehicles.js';
import { createPlayer, stepPlayer } from './player.js';
import { clamp, dist2 } from './math3.js';

export const CAR_COLORS = [
  [0.85, 0.2, 0.2], [0.2, 0.4, 0.85], [0.95, 0.8, 0.2], [0.9, 0.9, 0.88],
  [0.2, 0.7, 0.7], [0.55, 0.35, 0.8], [0.95, 0.5, 0.15], [0.3, 0.65, 0.3],
  [0.95, 0.3, 0.6], [0.2, 0.85, 0.45], [1.0, 0.6, 0.1], [0.4, 0.85, 0.95],
];
export const PLAYER_CAR_COLOR = [0.95, 0.25, 0.15];
const SHIRTS = [
  [0.9, 0.3, 0.3], [0.3, 0.5, 0.9], [0.95, 0.85, 0.3], [0.4, 0.8, 0.4],
  [0.9, 0.6, 0.9], [0.95, 0.95, 0.95], [0.3, 0.7, 0.75], [1.0, 0.45, 0.1],
  [0.55, 0.3, 0.9], [0.2, 0.9, 0.6],
];
const SKINS = [[0.9, 0.7, 0.55], [0.75, 0.55, 0.4], [0.95, 0.8, 0.65]];

// --- The crew: mission contacts. MARA dispatches the jobs, RICO runs the
// garage. Their lines brief each mission and show on the dialog card. ---
export const CREW = [
  { name: 'MARA', role: 'Dispatcher', color: '#ff5e7a', initial: 'M' },
  { name: 'RICO', role: 'Mechanic', color: '#ff9a3c', initial: 'R' },
  { name: 'DEX', role: 'Wheelman', color: '#2dd4bf', initial: 'D' },
];

// --- Weapons: 4 slots (1-4 / Q to cycle). Fists are always there; guns
// unlock the first time you pick up their ammo. Ammo is bought at the shop. ---
export const WEAPONS = [
  { name: 'FISTS', key: null, range: 2.4, rate: 0.45, dmg: 1, pellets: 1, spread: 0, auto: false },
  { name: 'PISTOL', key: 'pistol', range: 45, rate: 0.35, dmg: 1, pellets: 1, spread: 0, auto: false },
  { name: 'SHOTGUN', key: 'shotgun', range: 18, rate: 0.85, dmg: 1, pellets: 3, spread: 0.12, auto: false },
  { name: 'SMG', key: 'smg', range: 30, rate: 0.13, dmg: 1, pellets: 1, spread: 0.03, auto: true },
];
const AMMO_PRICE = {
  pistol: { price: 50, amount: 12 },
  shotgun: { price: 60, amount: 6 },
  smg: { price: 80, amount: 24 },
};

// --- Garage upgrades: bought with G at the garage, level 0-3 each. ---
export const UPGRADE_DEFS = [
  { key: 'speed', name: 'Engine', base: 300 },
  { key: 'armor', name: 'Armor', base: 250 },
  { key: 'handling', name: 'Handling', base: 200 },
];

// --- Missions: 12 named jobs, each in 1-4 stages. A stage is one objective:
// steal (get in any car), goto (reach a beacon), safehouse (reach the
// safehouse), collect (grab a stash drop), hide (get the heat under 50).
// The first three missions are the original chain, kept as-is; missions
// 9-12 are the v3 additions, reusing the same stage kinds so every job
// stays completable with the existing mechanics. ---
const MISSIONS = [
  {
    name: 'First Wheels', reward: 100, time: 75, from: 'MARA',
    brief: 'First job, rookie. Steal a car — any car — and you are in.',
    stages: [{ kind: 'steal', text: 'Steal a car' }],
  },
  {
    name: 'Package Run', reward: 250, time: 150, from: 'MARA',
    brief: 'A package is waiting uptown. Pick it up, drop it off, no questions.',
    stages: [
      { kind: 'goto', text: 'Pick up the package' },
      { kind: 'goto', text: 'Deliver it to the drop' },
    ],
  },
  {
    name: 'Cool Down', reward: 400, time: 120, from: 'MARA',
    brief: 'Heat is on you. Lose the cops and lay low at the safehouse.',
    stages: [{ kind: 'safehouse', text: 'Lose the heat, reach the safehouse' }],
  },
  {
    name: 'Street Race', reward: 500, time: 150, from: 'RICO',
    brief: 'Dex set up a street race. Three checkpoints — beat the clock, not the cars.',
    stages: [
      { kind: 'goto', checkpoint: true, text: 'Reach checkpoint 1/3' },
      { kind: 'goto', checkpoint: true, text: 'Reach checkpoint 2/3' },
      { kind: 'goto', checkpoint: true, text: 'Reach checkpoint 3/3' },
    ],
  },
  {
    name: 'Stash Grab', reward: 450, time: 150, from: 'MARA',
    brief: 'Three drops stashed around town. Grab them all before someone else does.',
    stages: [
      { kind: 'collect', text: 'Grab the stash 1/3' },
      { kind: 'collect', text: 'Grab the stash 2/3' },
      { kind: 'collect', text: 'Grab the stash 3/3' },
    ],
  },
  {
    name: 'Getaway', reward: 600, time: 150, from: 'MARA',
    brief: 'Cops are closing in. Get across town — then vanish.',
    stages: [
      { kind: 'goto', far: true, text: 'Reach the far side of town' },
      { kind: 'hide', text: 'Stay hidden until the heat drops' },
    ],
  },
  {
    name: 'The Big Heist', reward: 900, time: 180, from: 'RICO',
    brief: 'The Marina vault. In, out, and gone before they know what hit them.',
    stages: [
      { kind: 'goto', fixed: 'Hotel Bayview', text: 'Reach the Marina vault' },
      { kind: 'goto', fixed: 'The Docks', text: 'Grab the take at the Docks' },
      { kind: 'safehouse', text: 'Escape to the safehouse' },
    ],
  },
  {
    name: 'Bay King', reward: 1200, time: 210, from: 'MARA',
    brief: 'Last one, king. Race, grab, deliver — then come home. The Bay is yours.',
    stages: [
      { kind: 'goto', checkpoint: true, text: 'Race to the checkpoint' },
      { kind: 'collect', text: 'Grab the stash' },
      { kind: 'goto', text: 'Deliver the take' },
      { kind: 'safehouse', text: 'Return to the safehouse' },
    ],
  },
  {
    name: 'Dockside Deal', reward: 700, time: 180, from: 'RICO',
    brief: 'A buyer is waiting at the Docks with cash in hand. Bring the goods, no cops.',
    stages: [
      { kind: 'goto', fixed: 'The Docks', text: 'Reach the Docks' },
      { kind: 'collect', text: 'Pick up the goods' },
      { kind: 'goto', fixed: 'Hotel Bayview', text: 'Deliver to the buyer' },
    ],
  },
  {
    name: 'Neon Nights', reward: 750, time: 180, from: 'DEX',
    brief: 'Three checkpoints, one night, no brakes. The Strip is watching — make it look easy.',
    stages: [
      { kind: 'goto', checkpoint: true, text: 'Reach checkpoint 1/3' },
      { kind: 'goto', checkpoint: true, text: 'Reach checkpoint 2/3' },
      { kind: 'goto', checkpoint: true, text: 'Reach checkpoint 3/3' },
    ],
  },
  {
    name: 'Payback Run', reward: 800, time: 180, from: 'MARA',
    brief: 'They set you up. Shake the heat, cross town, and lay low till it blows over.',
    stages: [
      { kind: 'hide', text: 'Lose the heat first' },
      { kind: 'goto', far: true, text: 'Cross to the far side of town' },
      { kind: 'safehouse', text: 'Lay low at the safehouse' },
    ],
  },
  {
    name: 'Sunset Showdown', reward: 1500, time: 240, from: 'MARA',
    brief: 'The final score. Race the checkpoint, grab the stash, deliver it, vanish. All of it.',
    stages: [
      { kind: 'goto', checkpoint: true, text: 'Race to the checkpoint' },
      { kind: 'collect', text: 'Grab the stash' },
      { kind: 'goto', text: 'Deliver the take' },
      { kind: 'safehouse', text: 'Vanish at the safehouse' },
    ],
  },
];

const REP_TITLES = ['ROOKIE', 'STREET', 'HUSTLER', 'BIG SHOT', 'BAY KING'];

function randomRoadPoint(rng) {
  const line = rng.pick(LINES);
  if (rng.chance(0.5)) return { x: rng.range(-150, 150), z: line };
  return { x: line, z: rng.range(-150, 150) };
}

export class Game {
  constructor(seed) {
    this.seed = seed;
    this.rng = createRng(seed);
    this.city = generateCity(this.rng);
    this.colliders = buildingColliders(this.city);
    this.time = 0;
    this.state = 'title'; // title | playing | busted
    this.money = 0;
    this.heat = 0; // 0..500; stars = floor(heat / 100)
    this.jobsDone = 0; // missions completed (kept name for the v1 save)
    this.carsStolen = 0;
    this.pedsHit = 0;
    this.copsDowned = 0;
    this.coinsCollected = 0;
    // Stash packs: 6 hidden money packs per run, worth $100 each. They never
    // respawn once taken — the counter is the collection goal for the run.
    this.stashesCollected = 0;
    this.stashTotal = 6;
    this.nearMisses = 0;
    this.drifts = 0;
    this.bustTimer = 0;
    this.escapeTimer = 0; // seconds with no cop within 45 units (hidden)
    this.prevNearestCop = Infinity; // for telling a closing cop from a losing one
    this.ramCooldown = 0;
    this.starLevel = 0; // displayed stars, with hysteresis at the boundaries
    this.message = '';
    this.messageT = 0;
    this.missionIndex = 0;
    this.stageIndex = 0;
    this.missionCycle = 0;
    this.missionTimeLeft = 0;
    this.doneThisCycle = MISSIONS.map(() => false);
    this.districtJobs = {};
    this.district = 'Old Town';
    this.jobTarget = null;
    this.player = createPlayer(-8, 24);
    this.playerCar = null;
    this.traffic = [];
    this.police = [];
    this.parked = [];
    this.pedestrians = [];
    this.pickups = [];
    this.heli = null;
    this.copSerial = 0;
    // Combat: 4 weapon slots, per-gun ammo, unlocks, tracers, sound counters.
    this.weaponIndex = 0;
    this.ammo = { pistol: 0, shotgun: 0, smg: 0 };
    this.unlocked = { pistol: false, shotgun: false, smg: false };
    this.shootT = 0;
    this.tracers = [];
    this.shotsFired = 0;
    this.swings = 0;
    this.buys = 0;
    this.denied = 0;
    this.armour = 0; // 0..100, absorbs 60% of a hit until it runs out
    this.upgrades = { speed: 0, armor: 0, handling: 0 };
    this.nearGarage = false;
    this.nearShop = false;
    this.nearSafehouse = false;
    this.popups = []; // { text, t } — drift / near-miss score popups
    this.dialog = null; // { name, color, text, t } — crew dialog card
    this.radioStationName = null;
    this.radioTrack = null;
    this.resetWorld();
  }

  get stars() {
    return this.starLevel;
  }

  /** Stars rise the instant heat crosses a boundary, but only fall once
   * heat has dropped 15 below it — so a cop is not despawned the moment
   * heat dips 200 -> 199.95. */
  updateStars() {
    const raw = Math.min(5, Math.floor(this.heat / 100));
    if (this.heat <= 0) this.starLevel = 0;
    else if (raw > this.starLevel) this.starLevel = raw;
    else if (raw < this.starLevel && this.heat < this.starLevel * 100 - 15) this.starLevel = raw;
  }

  /** Respect: missions, cops downed, cars stolen, coins and stash packs
   * all count — a full stash sweep is worth almost half a mission. */
  get repPoints() {
    return this.jobsDone * 150 + this.copsDowned * 25 + this.carsStolen * 10 + this.coinsCollected * 5 + this.stashesCollected * 15;
  }

  get repLevel() {
    const level = Math.min(5, Math.floor(this.repPoints / 400) + 1);
    return { level, title: REP_TITLES[level - 1], progress: (this.repPoints % 400) / 400 };
  }

  get completionPct() {
    return Math.round((this.doneThisCycle.filter(Boolean).length / MISSIONS.length) * 100);
  }

  get missionCard() {
    const m = MISSIONS[this.missionIndex];
    const st = m.stages[this.stageIndex];
    const next = m.stages[this.stageIndex + 1];
    return {
      num: this.missionIndex + 1,
      total: MISSIONS.length,
      name: m.name,
      reward: m.reward,
      stageCur: this.stageIndex + 1,
      stageTotal: m.stages.length,
      stageText: st ? st.text : '',
      nextText: next ? next.text : 'Finish the job',
      timeLeft: Math.max(0, Math.ceil(this.missionTimeLeft)),
      cycle: this.missionCycle,
    };
  }

  get jobText() {
    const card = this.missionCard;
    const where = this.jobTarget ? ` — ${this.jobTarget.name}` : '';
    return `${card.stageText}${where}`;
  }

  resetWorld() {
    const rng = this.rng;
    this.traffic = [];
    for (let i = 0; i < 14; i += 1) {
      this.traffic.push(createTrafficCar(rng, CAR_COLORS));
    }
    this.parked = [];
    for (const spot of this.city.parkSpots.slice(0, 6)) {
      this.parked.push({
        kind: 'parked',
        x: spot.x,
        z: spot.z,
        heading: spot.heading,
        speed: 0,
        steer: 0,
        color: rng.pick(CAR_COLORS),
        model: rng.pick(CAR_MODELS),
      });
    }
    // Guarantee a car to steal right by the spawn: the first parked car
    // waits at the kerb of the road east of the spawn point (~12 units).
    if (this.parked.length > 0) {
      this.parked[0].x = 4;
      this.parked[0].z = 24;
      this.parked[0].heading = 0;
      this.parked[0].model = 'Comet';
    }
    this.police = [];
    this.pedestrians = [];
    for (let i = 0; i < 10; i += 1) {
      this.pedestrians.push(this.spawnPedestrian());
    }
    this.pickups = [];
    for (let i = 0; i < 8; i += 1) {
      const p = randomRoadPoint(rng);
      this.pickups.push({ kind: 'cash', x: p.x, z: p.z, amount: 25, taken: false, spin: rng.range(0, 6), respawn: 0 });
    }
    for (const type of ['pistol', 'shotgun', 'smg', 'pistol']) {
      const p = randomRoadPoint(rng);
      const amount = type === 'pistol' ? 12 : type === 'shotgun' ? 6 : 24;
      this.pickups.push({ kind: 'ammo', ammoType: type, x: p.x, z: p.z, amount, taken: false, spin: rng.range(0, 6), respawn: 0 });
    }
    // Stash packs: 3 on random roads, 3 at fixed hiding spots a player can
    // actually learn — the pier end, Bay Park, and the far beach — so the
    // hunt is part exploration, part memory. Seeded, so the same seed hides
    // them in the same places every run.
    for (let i = 0; i < 3; i += 1) {
      const p = randomRoadPoint(rng);
      this.pickups.push({ kind: 'stash', x: p.x, z: p.z, amount: 100, taken: false, spin: rng.range(0, 6), respawn: 0 });
    }
    for (const spot of [{ x: 186, z: 0 }, { x: -26, z: -26 }, { x: 175, z: 100 }]) {
      this.pickups.push({ kind: 'stash', x: spot.x, z: spot.z, amount: 100, taken: false, spin: rng.range(0, 6), respawn: 0 });
    }
    this.startMission(0);
  }

  spawnPedestrian() {
    const rng = this.rng;
    const bx = rng.int(0, 5);
    const bz = rng.int(0, 5);
    if (bx === 2 && bz === 2) return this.spawnPedestrian();
    const x0 = LINES[bx] + 8;
    const x1 = LINES[bx + 1] - 8;
    const z0 = LINES[bz] + 8;
    const z1 = LINES[bz + 1] - 8;
    return {
      x: rng.range(x0, x1),
      z: rng.chance(0.5) ? z0 : z1,
      heading: rng.range(0, Math.PI * 2),
      speed: rng.range(1.4, 2.4),
      state: 'walk',
      downT: 0,
      shirt: rng.pick(SHIRTS),
      skin: rng.pick(SKINS),
      walkPhase: rng.range(0, 6),
      block: { x0, x1, z0, z1 },
      edge: rng.int(0, 3),
      along: rng.range(0, 1),
      dir: rng.chance(0.5) ? 1 : -1,
    };
  }

  /** Snap a landmark to the nearest road line, so the beacon never sits
   * inside a building no car or foot can reach. */
  snapToRoad(spot) {
    const nx = LINES.reduce((a, b) => (Math.abs(b - spot.x) < Math.abs(a - spot.x) ? b : a));
    const nz = LINES.reduce((a, b) => (Math.abs(b - spot.z) < Math.abs(a - spot.z) ? b : a));
    let tx = spot.x;
    let tz = spot.z;
    if (Math.abs(nx - spot.x) <= Math.abs(nz - spot.z)) tx = nx;
    else tz = nz;
    tx = Math.min(tx, 186); // the pier's street end is the sand, not the water
    return { x: tx, z: tz, name: spot.name };
  }

  startMission(index) {
    this.missionIndex = index;
    const m = MISSIONS[index];
    this.missionTimeLeft = m.time;
    const crew = CREW.find((c) => c.name === m.from) || CREW[0];
    this.setDialog(crew.name, crew.color, m.brief);
    this.startStage(0);
  }

  startStage(s) {
    this.stageIndex = s;
    const st = MISSIONS[this.missionIndex].stages[s];
    const rng = this.rng;
    if (st.kind === 'steal') {
      const car = this.parked[0];
      this.jobTarget = car ? { x: car.x, z: car.z, name: 'a parked car' } : { x: 4, z: 24, name: 'a parked car' };
    } else if (st.kind === 'hide') {
      this.jobTarget = null;
    } else if (st.kind === 'safehouse') {
      this.jobTarget = { x: PLACES.safehouse.x, z: PLACES.safehouse.z, name: 'Safehouse' };
    } else if (st.kind === 'collect') {
      this.pickups = this.pickups.filter((p) => p.kind !== 'job');
      const p = randomRoadPoint(rng);
      this.pickups.push({ kind: 'job', x: p.x, z: p.z, amount: 0, taken: false, spin: rng.range(0, 6), respawn: 0, jobActive: true });
      this.jobTarget = { x: p.x, z: p.z, name: 'the stash' };
    } else if (st.checkpoint) {
      const p = randomRoadPoint(rng);
      this.jobTarget = { x: p.x, z: p.z, name: `Checkpoint ${s + 1}` };
    } else if (st.fixed) {
      const lm = this.city.landmarks.find((l) => l.name === st.fixed) || this.city.landmarks[0];
      this.jobTarget = this.snapToRoad(lm);
    } else if (st.far) {
      // The far side of town from wherever the player is now.
      const px = this.playerCar ? this.playerCar.x : this.player.x;
      const pz = this.playerCar ? this.playerCar.z : this.player.z;
      let best = null;
      let bestD = -1;
      for (const lm of this.city.landmarks) {
        const d = Math.hypot(lm.x - px, lm.z - pz);
        if (d > bestD) {
          bestD = d;
          best = lm;
        }
      }
      this.jobTarget = this.snapToRoad(best);
    } else {
      // Plain goto: a landmark, never the same one twice in a row.
      let spot = rng.pick(this.city.landmarks);
      const prevName = this.jobTarget ? this.jobTarget.name : null;
      for (let i = 0; i < 4 && spot.name === prevName; i += 1) spot = rng.pick(this.city.landmarks);
      this.jobTarget = this.snapToRoad(spot);
    }
  }

  completeStage() {
    const m = MISSIONS[this.missionIndex];
    const next = this.stageIndex + 1;
    if (next >= m.stages.length) this.completeMission();
    else this.startStage(next);
  }

  completeMission() {
    const m = MISSIONS[this.missionIndex];
    const base = m.reward + this.missionCycle * 50;
    const bonus = this.missionTimeLeft > 0 ? Math.round(base * 0.5) : 0;
    this.money += base + bonus;
    this.jobsDone += 1;
    this.doneThisCycle[this.missionIndex] = true;
    const d = this.district;
    this.districtJobs[d] = (this.districtJobs[d] || 0) + 1;
    this.setMessage(`Job done! +$${base}${bonus ? ` (+$${bonus} fast bonus)` : ''}`);
    const praise = this.missionIndex % 2 === 0
      ? 'Clean work. The Bay notices that kind of driving.'
      : 'That is how you do it. Next job is already lined up.';
    this.setDialog('MARA', CREW[0].color, praise);
    this.advanceMission();
  }

  failMission() {
    this.setMessage('Job timed out — no pay. New job assigned.');
    this.setDialog('MARA', CREW[0].color, 'That one slipped. Shake it off — next job is up.');
    this.advanceMission();
  }

  advanceMission() {
    let next = this.missionIndex + 1;
    if (next >= MISSIONS.length) {
      next = 0;
      this.missionCycle += 1;
      this.doneThisCycle = MISSIONS.map(() => false);
    }
    this.startMission(next);
  }

  setMessage(text, seconds = 3) {
    this.message = text;
    this.messageT = seconds;
  }

  setDialog(name, color, text, seconds = 6) {
    this.dialog = { name, color, text, t: seconds };
  }

  addPopup(text) {
    this.popups.push({ text, t: 2.5 });
    if (this.popups.length > 4) this.popups.shift();
  }

  addHeat(points) {
    this.heat = clamp(this.heat + points, 0, 500);
    this.updateStars();
  }

  // --- Combat ---
  get weapon() {
    return WEAPONS[this.weaponIndex];
  }

  selectWeapon(i) {
    if (i < 0 || i >= WEAPONS.length) return;
    const w = WEAPONS[i];
    if (w.key && !this.unlocked[w.key]) {
      this.setMessage(`${w.name} not unlocked yet — grab its ammo first.`);
      return;
    }
    this.weaponIndex = i;
  }

  cycleWeapon() {
    for (let n = 1; n <= WEAPONS.length; n += 1) {
      const i = (this.weaponIndex + n) % WEAPONS.length;
      const w = WEAPONS[i];
      if (!w.key || this.unlocked[w.key]) {
        this.weaponIndex = i;
        return;
      }
    }
  }

  /** F pressed (or click with fists): a swing at whatever is in front. */
  tryMelee() {
    if (this.state !== 'playing' || !this.player.onFoot) return;
    if (this.player.punchT > 0) return;
    this.player.punchT = 0.45;
    this.swings += 1;
    const px = this.player.x;
    const pz = this.player.z;
    const h = this.player.heading;
    for (const cop of this.police) {
      if (cop.down) continue;
      const d = Math.hypot(cop.x - px, cop.z - pz);
      if (d < 2.8) {
        const ang = Math.atan2(cop.x - px, cop.z - pz);
        let diff = ang - h;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        if (Math.abs(diff) < 1.2) this.damageCop(cop, 1);
      }
    }
    for (const ped of this.pedestrians) {
      if (ped.state === 'down') continue;
      if (Math.hypot(ped.x - px, ped.z - pz) < 2.2) {
        ped.state = 'down';
        ped.downT = 4;
        this.addHeat(10);
        this.setMessage('You knocked a pedestrian down!');
      }
    }
  }

  /** Click on foot: fire the selected gun (fists fall back to a punch). */
  tryShoot() {
    if (this.state !== 'playing' || !this.player.onFoot) return;
    const w = this.weapon;
    if (!w.key) {
      this.tryMelee();
      return;
    }
    if (this.ammo[w.key] <= 0) {
      this.setMessage(`No ${w.name} ammo — buy some at the shop (G).`);
      this.tryMelee();
      return;
    }
    if (this.shootT > 0) return;
    this.shootT = w.rate;
    this.ammo[w.key] -= 1;
    this.shotsFired += 1;
    const px = this.player.x;
    const pz = this.player.z;
    const h = this.player.heading;
    for (let p = 0; p < w.pellets; p += 1) {
      const off = w.pellets > 1 ? (p - (w.pellets - 1) / 2) * w.spread : (this.rng.chance(0.5) ? w.spread : -w.spread);
      const ang = h + off;
      const dx = Math.sin(ang);
      const dz = Math.cos(ang);
      let hit = null;
      let hitD = w.range;
      for (const cop of this.police) {
        if (cop.down) continue;
        const cx = cop.x - px;
        const cz = cop.z - pz;
        const along = cx * dx + cz * dz;
        if (along < 1 || along > w.range) continue;
        const perp = Math.abs(cx * dz - cz * dx);
        if (perp < 2.2 && along < hitD) {
          hitD = along;
          hit = cop;
        }
      }
      const ex = px + dx * hitD;
      const ez = pz + dz * hitD;
      this.tracers.push({ x1: px, z1: pz, x2: ex, z2: ez, t: 0.14, max: 0.14 });
      if (hit) this.damageCop(hit, w.dmg);
    }
  }

  damageCop(cop, dmg) {
    if (cop.down) return;
    cop.hp -= dmg;
    if (cop.hp <= 0) {
      cop.down = true;
      cop.downT = 8;
      cop.speed = 0;
      this.copsDowned += 1;
      this.addHeat(60);
      this.setMessage('Cop down!');
      this.addPopup('COP DOWN');
    }
  }

  /** G pressed: garage upgrades / respray, or shop ammo + armour. */
  tryInteract() {
    if (this.state !== 'playing') return;
    const px = this.playerCar ? this.playerCar.x : this.player.x;
    const pz = this.playerCar ? this.playerCar.z : this.player.z;
    const dGarage = Math.hypot(px - PLACES.garage.x, pz - PLACES.garage.z);
    const dShop = Math.hypot(px - PLACES.shop.x, pz - PLACES.shop.z);
    if (dGarage < 9) {
      if (!this.playerCar) {
        this.setMessage('Get in a car to use the garage.');
        return;
      }
      // v3 (playtest round 2, case a): a respray used to come first whenever
      // any heat existed — but stealing a car (the first thing every player
      // does) already puts 1 star on you, so the upgrade path always cost
      // an extra $200 first, silently. Now the respray only jumps the queue
      // at 2+ stars, when losing the heat is the urgent need; at 1 star G
      // buys the upgrade you came for, and the heat can still be driven off
      // or cleared at the safehouse. (Case b still passes: heat 250 resprays.)
      if (this.heat >= 200 && this.money >= 200) {
        this.money -= 200;
        this.heat = 0;
        this.updateStars();
        this.buys += 1;
        this.setMessage('Respray — the heat is gone!');
        return;
      }
      if (this.heat >= 200 && this.money < 200) {
        this.setMessage('Respray costs $200 — earn a little more first.');
        return;
      }
      const next = UPGRADE_DEFS.find((u) => this.upgrades[u.key] < 3);
      if (!next) {
        this.setMessage('Ride is maxed out.');
        return;
      }
      const cost = next.base * (this.upgrades[next.key] + 1);
      if (this.money < cost) {
        this.denied += 1;
        this.setMessage(`${next.name} Lv${this.upgrades[next.key] + 1} costs $${cost}.`);
        return;
      }
      this.money -= cost;
      this.upgrades[next.key] += 1;
      if (this.playerCar) this.playerCar.upgrades = { ...this.upgrades };
      this.buys += 1;
      this.setMessage(`${next.name} Lv${this.upgrades[next.key]} installed!`);
      return;
    }
    if (dShop < 9) {
      if (this.playerCar) {
        this.setMessage('Get out of the car to shop.');
        return;
      }
      const w = this.weapon.key ? this.weapon : WEAPONS[1];
      const deal = AMMO_PRICE[w.key];
      if (this.ammo[w.key] < 6 && this.money >= deal.price) {
        this.money -= deal.price;
        this.ammo[w.key] += deal.amount;
        this.unlocked[w.key] = true;
        this.weaponIndex = WEAPONS.findIndex((x) => x.key === w.key);
        this.buys += 1;
        this.setMessage(`Bought ${deal.amount} ${w.name} rounds.`);
        return;
      }
      if (this.armour < 100 && this.money >= 120) {
        this.money -= 120;
        this.armour = 100;
        this.buys += 1;
        this.setMessage('Armour fitted — 100%.');
        return;
      }
      if (this.money >= deal.price) {
        this.money -= deal.price;
        this.ammo[w.key] += deal.amount;
        this.unlocked[w.key] = true;
        this.buys += 1;
        this.setMessage(`Bought ${deal.amount} ${w.name} rounds.`);
        return;
      }
      this.denied += 1;
      this.setMessage('Not enough cash.');
    }
  }

  /** E pressed: get in the nearest car, or get out of the one being driven. */
  tryEnterExit() {
    if (this.state !== 'playing') return;
    if (this.playerCar) {
      const car = this.playerCar;
      this.player.x = car.x - Math.sin(car.heading) * 2.5;
      this.player.z = car.z - Math.cos(car.heading) * 2.5;
      this.player.heading = car.heading;
      this.player.onFoot = true;
      this.playerCar = null;
      // The car stays in the world, parked where you left it — marked as
      // yours, so getting back in is free instead of another theft.
      car.kind = 'parked';
      car.mine = true;
      this.parked.push(car);
      return;
    }
    let best = null;
    let bestD = 4;
    for (const car of this.parked) {
      const d = Math.hypot(car.x - this.player.x, car.z - this.player.z);
      if (d < bestD) {
        bestD = d;
        best = car;
      }
    }
    if (best) {
      this.parked = this.parked.filter((c) => c !== best);
      best.kind = 'player';
      best.color = PLAYER_CAR_COLOR;
      best.model = best.model || this.rng.pick(CAR_MODELS);
      best.speed = 0;
      best.steer = 0;
      best.upgrades = { ...this.upgrades };
      best.driftT = 0;
      best.drifting = false;
      this.playerCar = best;
      this.player.onFoot = false;
      if (best.mine) {
        this.setMessage(`Back in your ${best.model}.`);
      } else {
        this.carsStolen += 1;
        this.addHeat(120); // stealing a car is a 1-star crime, visibly
        this.setMessage(`You stole a ${best.model}! The cops are coming.`);
      }
    }
  }

  step(dt, input, camYaw) {
    if (this.state !== 'playing') return;
    this.time += dt;
    if (this.messageT > 0) this.messageT -= dt;
    if (this.dialog && this.dialog.t > 0) this.dialog.t -= dt;
    if (this.shootT > 0) this.shootT -= dt;
    for (const t of this.tracers) t.t -= dt;
    this.tracers = this.tracers.filter((t) => t.t > 0);
    for (const p of this.popups) p.t -= dt;
    this.popups = this.popups.filter((p) => p.t > 0);

    // Move the player or their car.
    const others = [...this.traffic, ...this.police, ...this.parked];
    let crash = null;
    if (this.playerCar) {
      crash = stepPlayerCar(this.playerCar, input, dt, this.colliders, others);
      // A wall crash is a crime (+12 heat, less with armour); bumping
      // another car is just a bump (+6, and only a hard one) — it must not
      // ratchet the heat up faster than outrunning the police can bring it down.
      const armorCut = 1 - 0.25 * (this.playerCar.upgrades?.armor || 0);
      if (crash.wallImpact > 12) {
        this.addHeat(Math.round(12 * armorCut));
        this.setMessage('Crash!');
      } else if (crash.carBump > 18) {
        this.addHeat(Math.round(6 * armorCut));
        this.setMessage('Crash!');
      }
      // A finished drift pays: $50 times the multiplier (seconds held).
      if (this.playerCar.driftEnded && (this.playerCar.driftT || 0) > 0.8) {
        const mult = Math.min(5, 1 + Math.floor(this.playerCar.driftT));
        const pay = 50 * mult;
        this.money += pay;
        this.drifts += 1;
        this.addPopup(`DRIFT ×${mult}  +$${pay}`);
        this.playerCar.driftT = 0;
      }
      if (this.ramCooldown > 0) this.ramCooldown -= dt;
      // Hitting a police car is a bigger crime — but only when the player
      // drives INTO the cop. A cop ramming the player from behind is the
      // cop's doing, not a crime, so it adds no heat.
      const pvx = Math.sin(this.playerCar.heading) * this.playerCar.speed;
      const pvz = Math.cos(this.playerCar.heading) * this.playerCar.speed;
      for (const cop of this.police) {
        if (cop.down) continue;
        const dx = cop.x - this.playerCar.x;
        const dz = cop.z - this.playerCar.z;
        const d = Math.hypot(dx, dz);
        const closing = d > 0.001 ? (pvx * dx + pvz * dz) / d : 0;
        if (d < CAR_RADIUS * 2 && closing > 8 && this.ramCooldown <= 0) {
          this.addHeat(15);
          this.ramCooldown = 2;
          this.setMessage('You rammed a cop car!');
        }
      }
    } else {
      stepPlayer(this.player, input, camYaw, dt, this.colliders, others);
    }

    stepTraffic(this.traffic, dt, this.rng, this.playerCar, this.playerCar ? null : this.player);

    // Near miss: threading past traffic at speed pays $50 (once per car).
    if (this.playerCar && Math.abs(this.playerCar.speed) > 20) {
      for (const car of this.traffic) {
        if (car.nmT > 0) {
          car.nmT -= dt;
          continue;
        }
        const d = Math.hypot(car.x - this.playerCar.x, car.z - this.playerCar.z);
        if (d > CAR_RADIUS * 2 && d < 7) {
          this.money += 50;
          this.nearMisses += 1;
          this.addPopup('NEAR MISS  +$50');
          car.nmT = 5;
        }
      }
    } else {
      for (const car of this.traffic) if (car.nmT > 0) car.nmT -= dt;
    }

    // Pedestrians walk the block perimeters; a car hit knocks one down.
    for (const ped of this.pedestrians) {
      if (ped.state === 'down') {
        ped.downT -= dt;
        if (ped.downT <= 0) {
          Object.assign(ped, this.spawnPedestrian());
        }
        continue;
      }
      ped.walkPhase += ped.speed * dt * 2.2;
      const b = ped.block;
      const per = 2 * (b.x1 - b.x0) + 2 * (b.z1 - b.z0);
      ped.along += (ped.dir * ped.speed * dt) / per;
      if (ped.along > 1) ped.along -= 1;
      if (ped.along < 0) ped.along += 1;
      const d = ped.along * per;
      const w = b.x1 - b.x0;
      const h = b.z1 - b.z0;
      let x;
      let z;
      let heading;
      if (d < w) {
        x = b.x0 + d; z = b.z0; heading = Math.PI / 2;
      } else if (d < w + h) {
        x = b.x1; z = b.z0 + (d - w); heading = 0;
      } else if (d < 2 * w + h) {
        x = b.x1 - (d - w - h); z = b.z1; heading = -Math.PI / 2;
      } else {
        x = b.x0; z = b.z1 - (d - 2 * w - h); heading = Math.PI;
      }
      if (ped.dir < 0) heading += Math.PI;
      ped.x = x;
      ped.z = z;
      ped.heading = heading;
      if (this.playerCar) {
        const dist = Math.hypot(ped.x - this.playerCar.x, ped.z - this.playerCar.z);
        if (dist < 2 && Math.abs(this.playerCar.speed) > 3) {
          ped.state = 'down';
          ped.downT = 4;
          this.pedsHit += 1;
          this.addHeat(40);
          this.setMessage('You hit a pedestrian!');
        }
      }
    }

    // Cash, ammo and stash pickups.
    const px = this.playerCar ? this.playerCar.x : this.player.x;
    const pz = this.playerCar ? this.playerCar.z : this.player.z;
    for (const coin of this.pickups) {
      coin.spin += dt * 1.5;
      if (coin.taken) {
        coin.respawn -= dt;
        // Job drops and stash packs never come back: a taken stash stays taken.
        if (coin.respawn <= 0 && coin.kind !== 'job' && coin.kind !== 'stash') {
          const p = randomRoadPoint(this.rng);
          coin.x = p.x;
          coin.z = p.z;
          coin.taken = false;
        }
        continue;
      }
      if (dist2(coin.x, coin.z, px, pz) < 2.4 * 2.4) {
        coin.taken = true;
        coin.respawn = 20;
        if (coin.kind === 'cash') {
          coin.amount = coin.amount || 25;
          this.money += coin.amount;
          this.coinsCollected += 1;
          this.setMessage(`+$${coin.amount} cash!`);
        } else if (coin.kind === 'stash') {
          // A hidden stash pack: $100, a rep bump, and a popup — the hunt
          // pays better than a road coin, and it never respawns.
          this.money += coin.amount || 100;
          this.stashesCollected += 1;
          this.addPopup(`STASH PACK  +$${coin.amount || 100}`);
          this.setMessage(`Stash pack found! ${this.stashesCollected}/${this.stashTotal} collected.`);
        } else if (coin.kind === 'ammo') {
          this.ammo[coin.ammoType] += coin.amount;
          const first = !this.unlocked[coin.ammoType];
          this.unlocked[coin.ammoType] = true;
          if (first) this.weaponIndex = WEAPONS.findIndex((w) => w.key === coin.ammoType);
          this.setMessage(`Picked up ${coin.amount} ${coin.ammoType.toUpperCase()} rounds!`);
        } else if (coin.kind === 'job' && coin.jobActive) {
          this.coinsCollected += 1;
          this.completeStage();
        }
      }
    }

    // The mission: stage objectives, and the timer that fails the job.
    const stage = MISSIONS[this.missionIndex].stages[this.stageIndex];
    if (stage) {
      this.missionTimeLeft -= dt;
      let done = false;
      if (stage.kind === 'steal') done = !!this.playerCar;
      else if (stage.kind === 'hide') done = this.heat < 50;
      else if (stage.kind !== 'collect' && this.jobTarget) {
        done = Math.hypot(this.jobTarget.x - px, this.jobTarget.z - pz) < 7;
      }
      if (done) this.completeStage();
      else if (this.missionTimeLeft <= 0) {
        this.missionTimeLeft = 0;
        this.failMission();
      }
    }

    // Where the player is: district name, and the three fixed places.
    this.district = districtAt(px, pz).name;
    this.nearGarage = Math.hypot(px - PLACES.garage.x, pz - PLACES.garage.z) < 9;
    this.nearShop = Math.hypot(px - PLACES.shop.x, pz - PLACES.shop.z) < 9;
    this.nearSafehouse = Math.hypot(px - PLACES.safehouse.x, pz - PLACES.safehouse.z) < 8;
    if (this.nearSafehouse) {
      // The safehouse heals, re-arms the armour and bleeds the heat away.
      this.player.health = Math.min(100, this.player.health + 25 * dt);
      this.armour = Math.min(100, this.armour + 5 * dt);
      if (this.heat > 0) {
        this.heat = Math.max(0, this.heat - 60 * dt);
        this.updateStars();
      }
    } else if (this.stars === 0) {
      this.player.health = Math.min(100, this.player.health + 3 * dt);
    }

    // A cop car shoving the player on foot hurts — armour soaks 60% first.
    if (!this.playerCar && this.player.hurtT <= 0) {
      for (const cop of this.police) {
        if (cop.down) continue;
        if (Math.hypot(cop.x - px, cop.z - pz) < 2.4 && Math.abs(cop.speed) > 3) {
          const armorCut = 1 - 0.25 * this.upgrades.armor;
          const dmg = 12 * armorCut;
          const absorbed = Math.min(this.armour, dmg * 0.6);
          this.armour -= absorbed;
          this.player.health -= (dmg - absorbed);
          this.player.hurtT = 1;
          this.setMessage('A cop shoved you!');
          if (this.player.health <= 0) {
            this.player.health = 0;
            this.state = 'busted';
            this.setMessage('BUSTED!');
          }
          break;
        }
      }
    }

    // Wanted: police numbers follow the stars, heat fades when hidden.
    // Hidden means no cop within 45 units: heat bleeds away slowly at
    // once, and faster once you have stayed hidden for 2 seconds — so
    // outrunning the police on a straight road (your car is faster than
    // theirs) really does cool you off. But heat does NOT fade while a cop
    // is closing in on you: a 1-star cop must be able to reach a player
    // who just stole a car, or the wanted level evaporates before the
    // police ever arrive. In the middle band heat only falls when the
    // nearest cop is losing ground (or stuck), never while it gains.
    // The helicopter's spotlight halves every fade rate while it is up.
    const fade = this.heli ? 0.5 : 1;
    let nearestCop = Infinity;
    for (const cop of this.police) {
      if (cop.down) continue;
      nearestCop = Math.min(nearestCop, Math.hypot(cop.x - px, cop.z - pz));
    }
    const closing = nearestCop < this.prevNearestCop - 0.05;
    this.prevNearestCop = nearestCop;
    if (this.heat > 0 && nearestCop > 45) {
      this.escapeTimer += dt;
      this.heat = Math.max(0, this.heat - 3 * fade * dt);
      // The fast "hidden" decay only when the cop is not gaining on you:
      // a cop closing in from 60 units away is still on its way, and the
      // heat must survive long enough for it to arrive.
      if (this.escapeTimer > 2 && !closing) this.heat = Math.max(0, this.heat - 14 * fade * dt);
    } else if (this.heat > 0 && nearestCop > 15 && !closing) {
      this.escapeTimer = 0;
      this.heat = Math.max(0, this.heat - 8 * fade * dt);
    } else {
      this.escapeTimer = 0;
    }
    this.updateStars();
    const want = this.stars;
    while (this.police.length < want) {
      // Spawn on a road intersection 40-75 units from the player, so the
      // cop starts on a road it can actually drive from. A random angle
      // clamped to the world bounds could strand it 100+ units away near
      // the beach edge, where the heat drains before it ever arrives.
      let x = 0;
      let z = 0;
      let ok = false;
      for (let tries = 0; tries < 20 && !ok; tries += 1) {
        x = LINES[this.rng.int(0, LINES.length - 1)];
        z = LINES[this.rng.int(0, LINES.length - 1)];
        const d = Math.hypot(x - px, z - pz);
        ok = d >= 40 && d <= 75;
      }
      if (!ok) {
        const angle = this.rng.range(0, Math.PI * 2);
        const dist = this.rng.range(45, 65);
        x = clamp(px + Math.sin(angle) * dist, WORLD.minX + 5, 186);
        z = clamp(pz + Math.cos(angle) * dist, WORLD.minZ + 5, WORLD.maxZ - 5);
      }
      const cop = createPoliceCar(x, z);
      cop.name = `UNIT ${10 + (this.copSerial % 80)}`;
      this.copSerial += 1;
      this.police.push(cop);
    }
    while (this.police.length > want) this.police.pop();
    // Down cops leave after their timer: stepPolice counts it down.
    this.police = this.police.filter((c) => !(c.down && c.downT <= 0));
    // At 4+ stars one unit runs a roadblock: it drives to a point ahead of
    // the player and waits there instead of chasing from behind.
    if (want >= 4) {
      let rb = this.police.find((c) => c.mode === 'roadblock' && !c.down);
      if (!rb) rb = this.police.find((c) => !c.down);
      for (const c of this.police) c.mode = c === rb ? 'roadblock' : 'chase';
    } else {
      for (const c of this.police) c.mode = 'chase';
    }
    const pHeading = this.playerCar ? this.playerCar.heading : this.player.heading;
    const aheadX = px + Math.sin(pHeading) * 30;
    const aheadZ = pz + Math.cos(pHeading) * 30;
    let closeCops = 0;
    for (const cop of this.police) {
      cop.dist = Math.hypot(cop.x - px, cop.z - pz);
      if (cop.dist < 22) closeCops += 1;
    }
    for (const cop of this.police) {
      if (cop.down) {
        cop.tactic = 'DOWN';
        stepPolice(cop, px, pz, dt, this.colliders, others, !this.playerCar);
        continue;
      }
      if (cop.mode === 'roadblock') cop.tactic = 'ROADBLOCK';
      else if (cop.dist < 10 && Math.abs(cop.speed) > 12) cop.tactic = 'RAMMING';
      else if (closeCops >= 3 && cop.dist < 22) cop.tactic = 'BOXING IN';
      else cop.tactic = 'PURSUIT';
      const tx = cop.mode === 'roadblock' ? aheadX : px;
      const tz = cop.mode === 'roadblock' ? aheadZ : pz;
      stepPolice(cop, tx, tz, dt, this.colliders, others, !this.playerCar);
    }

    // The helicopter: up at 3+ stars, circling overhead with a spotlight.
    if (want >= 3 && !this.heli) {
      this.heli = createHeli(px + 30, pz - 30);
    } else if (want < 3) {
      this.heli = null;
    }
    if (this.heli) stepHeli(this.heli, px, pz, dt);

    // Busted: a cop sits on you while you are slow. The speed that counts is
    // the one you are driving at, not speed a ramming cop pushed into you.
    const mySpeed = this.playerCar
      ? Math.abs(this.playerCar.drivenSpeed ?? this.playerCar.speed)
      : this.player.speed;
    if (want > 0 && nearestCop < 6 && mySpeed < 4) {
      this.bustTimer += dt;
      if (this.bustTimer > 3) {
        this.state = 'busted';
        this.setMessage('BUSTED!');
      }
    } else {
      this.bustTimer = Math.max(0, this.bustTimer - dt * 2);
    }
  }

  restart() {
    this.rng = createRng(this.seed);
    this.time = 0;
    this.money = 0;
    this.heat = 0;
    this.jobsDone = 0;
    this.carsStolen = 0;
    this.pedsHit = 0;
    this.copsDowned = 0;
    this.coinsCollected = 0;
    this.stashesCollected = 0;
    this.nearMisses = 0;
    this.drifts = 0;
    this.bustTimer = 0;
    this.escapeTimer = 0;
    this.prevNearestCop = Infinity;
    this.ramCooldown = 0;
    this.starLevel = 0;
    this.missionIndex = 0;
    this.stageIndex = 0;
    this.missionCycle = 0;
    this.doneThisCycle = MISSIONS.map(() => false);
    this.districtJobs = {};
    this.district = 'Old Town';
    this.heli = null;
    this.copSerial = 0;
    this.weaponIndex = 0;
    this.ammo = { pistol: 0, shotgun: 0, smg: 0 };
    this.unlocked = { pistol: false, shotgun: false, smg: false };
    this.shootT = 0;
    this.tracers = [];
    this.shotsFired = 0;
    this.swings = 0;
    this.buys = 0;
    this.denied = 0;
    this.armour = 0;
    this.upgrades = { speed: 0, armor: 0, handling: 0 };
    this.popups = [];
    this.dialog = null;
    this.player = createPlayer(-8, 24);
    this.playerCar = null;
    this.city = generateCity(this.rng);
    this.colliders = buildingColliders(this.city);
    this.resetWorld();
    this.state = 'playing';
  }
}
