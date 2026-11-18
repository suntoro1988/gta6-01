// The game itself: jobs, money, the wanted system, pedestrians and pickups.
// Rendering lives in main.js; this file only moves the world forward.
import { LINES, WORLD, generateCity, buildingColliders } from './city.js';
import { createRng } from './rng.js';
import {
  CAR_RADIUS,
  createPoliceCar,
  createTrafficCar,
  resolveCarPair,
  stepPlayerCar,
  stepPolice,
  stepTraffic,
} from './vehicles.js';
import { createPlayer, stepPlayer } from './player.js';
import { clamp } from './math3.js';

export const CAR_COLORS = [
  [0.85, 0.2, 0.2], [0.2, 0.4, 0.85], [0.95, 0.8, 0.2], [0.9, 0.9, 0.88],
  [0.2, 0.7, 0.7], [0.55, 0.35, 0.8], [0.95, 0.5, 0.15], [0.3, 0.65, 0.3],
];
export const PLAYER_CAR_COLOR = [0.95, 0.25, 0.15];
const SHIRTS = [
  [0.9, 0.3, 0.3], [0.3, 0.5, 0.9], [0.95, 0.85, 0.3], [0.4, 0.8, 0.4],
  [0.9, 0.6, 0.9], [0.95, 0.95, 0.95], [0.3, 0.7, 0.75],
];
const SKINS = [[0.9, 0.7, 0.55], [0.75, 0.55, 0.4], [0.95, 0.8, 0.65]];

const JOB_CHAIN = [
  { text: 'Pick up the package', reward: 150 },
  { text: 'Deliver it to the drop', reward: 250 },
  { text: 'Lose the heat, reach the safehouse', reward: 400 },
];

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
    this.jobsDone = 0;
    this.carsStolen = 0;
    this.pedsHit = 0;
    this.bustTimer = 0;
    this.escapeTimer = 0; // seconds with no cop within 45 units (hidden)
    this.prevNearestCop = Infinity; // for telling a closing cop from a losing one
    this.ramCooldown = 0;
    this.starLevel = 0; // displayed stars, with hysteresis at the boundaries
    this.message = '';
    this.messageT = 0;
    this.jobCycle = 0;
    this.jobLeg = 0;
    this.jobTimeLeft = 0;
    this.jobTarget = null;
    this.player = createPlayer(-8, 24);
    this.playerCar = null;
    this.traffic = [];
    this.police = [];
    this.parked = [];
    this.pedestrians = [];
    this.pickups = [];
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

  get jobText() {
    if (!this.jobTarget) return '';
    return `${JOB_CHAIN[this.jobLeg].text} — ${this.jobTarget.name}`;
  }

  resetWorld() {
    const rng = this.rng;
    this.traffic = [];
    for (let i = 0; i < 14; i += 1) {
      const car = createTrafficCar(rng, CAR_COLORS);
      this.traffic.push(car);
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
      });
    }
    // Guarantee a car to steal right by the spawn: the first parked car
    // waits at the kerb of the road east of the spawn point (~12 units).
    if (this.parked.length > 0) {
      this.parked[0].x = 4;
      this.parked[0].z = 24;
      this.parked[0].heading = 0;
    }
    this.police = [];
    this.pedestrians = [];
    for (let i = 0; i < 10; i += 1) {
      this.pedestrians.push(this.spawnPedestrian());
    }
    this.pickups = [];
    for (let i = 0; i < 8; i += 1) {
      const p = randomRoadPoint(rng);
      this.pickups.push({ x: p.x, z: p.z, amount: 25, taken: false, spin: rng.range(0, 6), respawn: 0 });
    }
    this.startJob(0);
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

  startJob(leg) {
    this.jobLeg = leg;
    const rng = this.rng;
    // Never send the player to the same landmark twice in a row: a fresh
    // leg must be somewhere new to drive to.
    let spot = rng.pick(this.city.landmarks);
    const prevName = this.jobTarget ? this.jobTarget.name : null;
    for (let i = 0; i < 4 && spot.name === prevName; i += 1) spot = rng.pick(this.city.landmarks);
    // The beacon goes on the street by the landmark, never inside a building:
    // a landmark's centre can sit under its own tower, which no car or foot
    // can ever reach, so snap to the nearest road line instead.
    const nx = LINES.reduce((a, b) => (Math.abs(b - spot.x) < Math.abs(a - spot.x) ? b : a));
    const nz = LINES.reduce((a, b) => (Math.abs(b - spot.z) < Math.abs(a - spot.z) ? b : a));
    let tx = spot.x;
    let tz = spot.z;
    if (Math.abs(nx - spot.x) <= Math.abs(nz - spot.z)) tx = nx;
    else tz = nz;
    tx = Math.min(tx, 186); // the pier's street end is the sand, not the water
    this.jobTarget = { x: tx, z: tz, name: spot.name };
    this.jobTimeLeft = 90;
  }

  setMessage(text, seconds = 3) {
    this.message = text;
    this.messageT = seconds;
  }

  addHeat(points) {
    this.heat = clamp(this.heat + points, 0, 500);
    this.updateStars();
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
      best.speed = 0;
      best.steer = 0;
      this.playerCar = best;
      this.player.onFoot = false;
      this.carsStolen += 1;
      this.addHeat(120); // stealing a car is a 1-star crime, visibly
      this.setMessage('You stole a car! The cops are coming.');
    }
  }

  step(dt, input, camYaw) {
    if (this.state !== 'playing') return;
    this.time += dt;
    if (this.messageT > 0) this.messageT -= dt;

    // Move the player or their car.
    const others = [...this.traffic, ...this.police, ...this.parked];
    let crash = null;
    if (this.playerCar) {
      crash = stepPlayerCar(this.playerCar, input, dt, this.colliders, others);
      // A wall crash is a crime (+12 heat); bumping another car is just a
      // bump (+6, and only a hard one) — it must not ratchet the heat up
      // faster than outrunning the police can bring it down.
      if (crash.wallImpact > 12) {
        this.addHeat(12);
        this.setMessage('Crash!');
      } else if (crash.carBump > 18) {
        this.addHeat(6);
        this.setMessage('Crash!');
      }
      if (this.ramCooldown > 0) this.ramCooldown -= dt;
      // Hitting a police car is a bigger crime — but only when the player
      // drives INTO the cop. A cop ramming the player from behind is the
      // cop's doing, not a crime, so it adds no heat.
      const pvx = Math.sin(this.playerCar.heading) * this.playerCar.speed;
      const pvz = Math.cos(this.playerCar.heading) * this.playerCar.speed;
      for (const cop of this.police) {
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

    // Cash pickups.
    const px = this.playerCar ? this.playerCar.x : this.player.x;
    const pz = this.playerCar ? this.playerCar.z : this.player.z;
    for (const coin of this.pickups) {
      coin.spin += dt * 1.5;
      if (coin.taken) {
        coin.respawn -= dt;
        if (coin.respawn <= 0) {
          const p = randomRoadPoint(this.rng);
          coin.x = p.x;
          coin.z = p.z;
          coin.taken = false;
        }
        continue;
      }
      if (Math.hypot(coin.x - px, coin.z - pz) < 2.4) {
        coin.taken = true;
        coin.respawn = 20;
        this.money += coin.amount;
        this.setMessage(`+$${coin.amount} cash!`);
      }
    }

    // The job: reach the beacon. The timer never goes below 0 on the HUD,
    // and when it runs out the leg fails with no pay and a fresh job starts.
    if (this.jobTarget) {
      this.jobTimeLeft -= dt;
      const d = Math.hypot(this.jobTarget.x - px, this.jobTarget.z - pz);
      if (d < 7) {
        const base = JOB_CHAIN[this.jobLeg].reward + this.jobCycle * 50;
        const bonus = this.jobTimeLeft > 0 ? Math.round(base * 0.5) : 0;
        this.money += base + bonus;
        this.jobsDone += 1;
        this.setMessage(`Job done! +$${base}${bonus ? ` (+$${bonus} fast bonus)` : ''}`);
        const next = this.jobLeg + 1;
        if (next >= JOB_CHAIN.length) {
          this.jobCycle += 1;
          this.startJob(0);
        } else {
          this.startJob(next);
        }
      } else if (this.jobTimeLeft <= 0) {
        this.jobTimeLeft = 0;
        this.setMessage('Job timed out — no pay. New job assigned.');
        const next = this.jobLeg + 1;
        if (next >= JOB_CHAIN.length) {
          this.jobCycle += 1;
          this.startJob(0);
        } else {
          this.startJob(next);
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
    let nearestCop = Infinity;
    for (const cop of this.police) {
      nearestCop = Math.min(nearestCop, Math.hypot(cop.x - px, cop.z - pz));
    }
    const closing = nearestCop < this.prevNearestCop - 0.05;
    this.prevNearestCop = nearestCop;
    if (this.heat > 0 && nearestCop > 45) {
      this.escapeTimer += dt;
      this.heat = Math.max(0, this.heat - 3 * dt);
      // The fast "hidden" decay only when the cop is not gaining on you:
      // a cop closing in from 60 units away is still on its way, and the
      // heat must survive long enough for it to arrive.
      if (this.escapeTimer > 2 && !closing) this.heat = Math.max(0, this.heat - 14 * dt);
    } else if (this.heat > 0 && nearestCop > 15 && !closing) {
      this.escapeTimer = 0;
      this.heat = Math.max(0, this.heat - 8 * dt);
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
      this.police.push(createPoliceCar(x, z));
    }
    while (this.police.length > want) this.police.pop();
    for (const cop of this.police) {
      stepPolice(cop, px, pz, dt, this.colliders, others, !this.playerCar);
    }

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
    this.bustTimer = 0;
    this.escapeTimer = 0;
    this.prevNearestCop = Infinity;
    this.ramCooldown = 0;
    this.starLevel = 0;
    this.jobCycle = 0;
    this.player = createPlayer(-8, 24);
    this.playerCar = null;
    this.city = generateCity(this.rng);
    this.colliders = buildingColliders(this.city);
    this.resetWorld();
    this.state = 'playing';
  }
}
