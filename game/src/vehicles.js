// Sunset Bay — traffic AI, parked cars and driving physics (fresh v6 rewrite).
import { makeRng } from './rng.js';

function toRng(seed, fallback) {
  if (seed && typeof seed.next === 'function') return seed;
  return makeRng(seed == null ? fallback : seed);
}
import { ROAD_STEP, ROAD_HALF, SEA_X } from './city.js';

export const CAR_COLORS = [
  '#c0392b', '#e74c3c', '#e67e22', '#f1c40f', '#f39c12', '#27ae60',
  '#16a085', '#2980b9', '#3498db', '#8e44ad', '#9b59b6', '#ecf0f1',
  '#bdc3c7', '#95a5a6', '#7f8c8d', '#2c3e50', '#34495e', '#d35400',
  '#1abc9c', '#ff6b81', '#ffd32a', '#2ed573', '#ffa502', '#ff4757',
];

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const CAR_R = 2.4; // collision radius used for cars (circle vs AABB)

function roadCoord(v) { return Math.round(v / ROAD_STEP) * ROAD_STEP; }

function nearCrossing(x, z) {
  return Math.abs(x - roadCoord(x)) < 4 && Math.abs(z - roadCoord(z)) < 4;
}

// Circle vs AABB: returns push-out info or null.
function hitBuilding(city, x, z, r) {
  for (const c of city.colliders) {
    const cx = Math.max(c.x0, Math.min(x, c.x1));
    const cz = Math.max(c.z0, Math.min(z, c.z1));
    let dx = x - cx, dz = z - cz;
    let d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    let d = Math.sqrt(d2);
    if (d < 0.001) { dx = 0; dz = -1; d = 1; }
    return { nx: dx / d, nz: dz / d, depth: r - d };
  }
  return null;
}

function spawnTrafficCar(city, rng) {
  const vertical = rng.next() < 0.5;
  const line = (Math.floor(rng.next() * 13) - 6) * ROAD_STEP;
  const along = (rng.next() * 2 - 1) * 300;
  const dir = vertical ? (rng.next() < 0.5 ? 1 : 3) : (rng.next() < 0.5 ? 0 : 2);
  const x = vertical ? line : along;
  const z = vertical ? along : line;
  const max = 9 + rng.next() * 8;
  return {
    kind: 'traffic',
    x, z, dir,
    angle: Math.atan2(DIRS[dir][1], DIRS[dir][0]),
    speed: max * (0.5 + rng.next() * 0.5), max,
    color: CAR_COLORS[Math.floor(rng.next() * CAR_COLORS.length)],
    len: 4.4, wid: 2, damage: 0,
  };
}

function spawnParkedCar(city, rng) {
  const vertical = rng.next() < 0.5;
  const line = (Math.floor(rng.next() * 13) - 6) * ROAD_STEP;
  const along = (rng.next() * 2 - 1) * 280;
  const side = rng.next() < 0.5 ? 1 : -1;
  const off = ROAD_HALF + 3.2;
  const x = vertical ? line + side * off : along;
  const z = vertical ? along : line + side * off;
  if (x > SEA_X - 8) return null;
  const angle = vertical ? (side > 0 ? Math.PI / 2 : -Math.PI / 2) : (side > 0 ? 0 : Math.PI);
  const max = 22 + rng.next() * 12;
  return {
    kind: 'parked',
    x, z, dir: vertical ? 1 : 0,
    angle, speed: 0, max,
    color: CAR_COLORS[Math.floor(rng.next() * CAR_COLORS.length)],
    len: 4.4, wid: 2, damage: 0,
  };
}

export function createTraffic(city, seed, count) {
  const rng = toRng(seed, 4242);
  const cars = [];
  const n = count || 14;
  for (let i = 0; i < n; i++) cars.push(spawnTrafficCar(city, rng));
  const parked = [];
  let guard = 0;
  while (parked.length < 5 && guard++ < 40) {
    const p = spawnParkedCar(city, rng);
    if (p) parked.push(p);
  }
  const all = () => cars.concat(parked);

  function carAhead(car, dist) {
    const dv = DIRS[car.dir];
    for (const o of cars) {
      if (o === car) continue;
      const dx = o.x - car.x, dz = o.z - car.z;
      const fwd = dx * dv[0] + dz * dv[1];
      if (fwd > 0 && fwd < dist && Math.abs(dx * dv[1] - dz * dv[0]) < 3.2) return o;
    }
    return null;
  }

  function stepTraffic(car, dt, player, wanted) {
    let want = car.max;
    if (carAhead(car, 16)) want = 0;
    if (wanted > 0 && player) {
      const dx = car.x - player.x, dz = car.z - player.z;
      if (dx * dx + dz * dz < 30 * 30) want = Math.min(want, car.max * 0.4);
    }
    car.speed += Math.max(-14, Math.min(10, want - car.speed)) * dt * 2;
    if (car.speed < 0) car.speed = 0;
    const dv = DIRS[car.dir];
    car.x += dv[0] * car.speed * dt;
    car.z += dv[1] * car.speed * dt;
    if (nearCrossing(car.x, car.z) && rng.next() < 0.3) {
      const turn = rng.next() < 0.5 ? 1 : 3; // left or right, never reverse
      car.dir = (car.dir + turn) % 4;
      car.x = roadCoord(car.x);
      car.z = roadCoord(car.z);
      car.angle = Math.atan2(DIRS[car.dir][1], DIRS[car.dir][0]);
    }
    if (car.x > 360 || car.x < -360 || car.z > 360 || car.z < -360) {
      car.dir = (car.dir + 2) % 4;
      car.angle = Math.atan2(DIRS[car.dir][1], DIRS[car.dir][0]);
    }
  }

  // Player driving physics for the car in player.vehicle.
  // player: {x, z, angle, speed, vehicle, input:{throttle, steer, handbrake}}
  function drivePlayer(player, dt) {
    const v = player.vehicle;
    if (!v || v.kind === 'boat') return;
    const inp = player.input || {};
    const th = inp.throttle || 0, st = inp.steer || 0;
    const maxF = v.max || 32, maxR = 10;
    const ratio = Math.min(1, Math.abs(player.speed) / maxF);
    // Progressive steering: sharp at low speed, stable at high speed.
    const steerMax = 1.9 - 1.15 * ratio;
    const grip = inp.handbrake ? 0.35 : 1;
    const spdSign = Math.sign(player.speed || 1);
    player.angle += st * steerMax * grip * spdSign * dt * (0.25 + 0.75 * ratio);
    if (inp.handbrake) player.angle += st * 0.9 * spdSign * dt; // drift yaw
    player.speed += th * 22 * dt;
    if (inp.handbrake) player.speed -= player.speed * 1.4 * dt;
    player.speed -= player.speed * 0.35 * dt; // drag + rolling resistance
    if (th < 0 && player.speed > 0.5) player.speed -= 26 * dt; // brake
    if (player.speed > maxF) player.speed = maxF;
    if (player.speed < -maxR) player.speed = -maxR;
    player.x += Math.cos(player.angle) * player.speed * dt;
    player.z += Math.sin(player.angle) * player.speed * dt;
    // Wall slide / bounce against buildings (circle vs AABB).
    const hit = hitBuilding(city, player.x, player.z, CAR_R);
    if (hit) {
      player.x += hit.nx * hit.depth;
      player.z += hit.nz * hit.depth;
      const fx = Math.cos(player.angle), fz = Math.sin(player.angle);
      const into = fx * hit.nx + fz * hit.nz;
      if (into < 0) {
        // Head-on component bounces back, sideways component slides.
        player.speed *= -0.3;
        v.damage = Math.min(1, (v.damage || 0) + 0.05);
      }
    }
    // Soft bump against other cars.
    for (const o of all()) {
      if (o === v) continue;
      const dx = player.x - o.x, dz = player.z - o.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 5 * 5 && d2 > 0.01) {
        const d = Math.sqrt(d2);
        player.x = o.x + dx / d * 5;
        player.z = o.z + dz / d * 5;
        player.speed *= 0.6;
      }
    }
    v.x = player.x; v.z = player.z; v.angle = player.angle; v.speed = player.speed;
  }

  function update(dt, player, wanted) {
    for (const c of cars) if (!c.driver) stepTraffic(c, dt, player, wanted || 0);
    if (player && player.vehicle) drivePlayer(player, dt);
  }

  function nearestRide(player, maxD) {
    let best = null, bd = maxD * maxD;
    for (const o of all()) {
      const dx = o.x - player.x, dz = o.z - player.z, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = o; }
    }
    if (player.boat) {
      const dx = player.boat.x - player.x, dz = player.boat.z - player.z;
      if (dx * dx + dz * dz < bd) best = player.boat;
    }
    return best;
  }

  // Player presses E near a car (or the speedboat) to get in.
  function enterNearest(player) {
    if (player.vehicle) return player.vehicle;
    const ride = nearestRide(player, 7.5);
    if (!ride) return null;
    player.vehicle = ride;
    player.inCar = true;
    player.angle = ride.angle || 0;
    player.speed = 0;
    ride.driver = player;
    return ride;
  }

  function exitCar(player) {
    const v = player.vehicle;
    if (!v) return false;
    const side = (v.angle || 0) + Math.PI / 2;
    player.x = v.x + Math.cos(side) * 4;
    player.z = v.z + Math.sin(side) * 4;
    player.vehicle = null;
    player.inCar = false;
    player.speed = 0;
    if (v.driver === player) v.driver = null;
    return true;
  }

  return { cars, parked, update, enterNearest, exitCar };
}
