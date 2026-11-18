// Cars: arcade driving physics, road traffic and the police chase.
// Forward is (sin(heading), cos(heading)); heading grows turning left.
import { LINES, WORLD, onRoad } from './city.js';
import { clamp, turnToward } from './math3.js';

export const CAR_RADIUS = 1.7;

/** Push a circle out of every building AABB it overlaps. Returns the
 * corrected position, whether it hit, and the push direction (nx, nz):
 * the wall normal, for wall-following steering. */
export function collideCircle(x, z, r, colliders) {
  const ox = x;
  const oz = z;
  let hit = false;
  for (const c of colliders) {
    const nx = Math.max(c.x0, Math.min(x, c.x1));
    const nz = Math.max(c.z0, Math.min(z, c.z1));
    const dx = x - nx;
    const dz = z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    hit = true;
    if (d2 > 0.0001) {
      const d = Math.sqrt(d2);
      x = nx + (dx / d) * r;
      z = nz + (dz / d) * r;
    } else {
      const pl = x - c.x0;
      const pr = c.x1 - x;
      const pt = z - c.z0;
      const pb = c.z1 - z;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) x = c.x0 - r;
      else if (m === pr) x = c.x1 + r;
      else if (m === pt) z = c.z0 - r;
      else z = c.z1 + r;
    }
  }
  const px = x - ox;
  const pz = z - oz;
  const pl = Math.hypot(px, pz);
  return { x, z, hit, nx: pl > 0.0001 ? px / pl : 0, nz: pl > 0.0001 ? pz / pl : 0 };
}

/** Push two circular cars apart and swap a little speed along the impact line. */
export function resolveCarPair(a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  const min = CAR_RADIUS * 2 - 0.2;
  if (d >= min || d < 0.0001) return 0;
  const nx = dx / d;
  const nz = dz / d;
  const push = (min - d) / 2;
  a.x -= nx * push;
  a.z -= nz * push;
  b.x += nx * push;
  b.z += nz * push;
  const rel = (b.speed - a.speed) * 0.5;
  a.speed += rel * 0.4;
  b.speed -= rel * 0.4;
  return Math.abs(rel);
}

/** One step of the player's car. Returns { crashed, impact }. */
export function stepPlayerCar(car, input, dt, colliders, others) {
  const road = onRoad(car.x, car.z);
  const maxSpeed = road ? 38 : 25;
  // Top speed on a road (38) beats a police car (30): on a straight road
  // the player really does pull away. (Drag balances accel, so the accel
  // has to be well above drag * top speed, or the cap is never reached.)
  const accel = road ? 20 : 10;
  if (input.forward) car.speed += accel * dt;
  if (input.back) {
    car.speed -= car.speed > 0.5 ? 26 * dt : 8 * dt;
  }
  car.speed -= car.speed * (input.handbrake ? 1.6 : 0.4) * dt;
  car.speed = clamp(car.speed, -9, maxSpeed);
  // The speed the player is driving at, before any collision shoves it around:
  // a cop ramming a parked car must not make that car "fast".
  car.drivenSpeed = car.speed;
  const steerTarget = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  const steerMax = input.handbrake ? 0.85 : 0.55;
  car.steer += clamp(steerTarget * steerMax - car.steer, -3 * dt, 3 * dt);
  if (Math.abs(car.speed) > 0.2) {
    car.heading += (car.steer * car.speed * dt) / 2.6;
  }
  car.x += Math.sin(car.heading) * car.speed * dt;
  car.z += Math.cos(car.heading) * car.speed * dt;
  const before = car.speed;
  const fixed = collideCircle(car.x, car.z, CAR_RADIUS, colliders);
  car.x = fixed.x;
  car.z = fixed.z;
  let impact = 0;
  let wallImpact = 0;
  if (fixed.hit && Math.abs(before) > 6) {
    wallImpact = Math.abs(before);
    impact = wallImpact;
    car.speed *= 0.3;
  }
  let carBump = 0;
  for (const o of others) {
    if (o === car) continue;
    if (o.kind === 'parked') {
      // A parked car does not move: shove only the player car off it.
      const dx = car.x - o.x;
      const dz = car.z - o.z;
      const d = Math.hypot(dx, dz);
      const min = CAR_RADIUS * 2 - 0.2;
      if (d < min && d > 0.0001) {
        car.x = o.x + (dx / d) * min;
        car.z = o.z + (dz / d) * min;
        impact = Math.max(impact, Math.abs(before));
        carBump = Math.max(carBump, Math.abs(before));
        car.speed *= 0.5;
      }
      continue;
    }
    const bump = resolveCarPair(car, o);
    if (bump > 6) {
      impact = Math.max(impact, bump);
      carBump = Math.max(carBump, bump);
    }
  }
  // A ram must shove the car, not make it "fast": cap the speed at what the
  // player was driving at, so a cop ramming a parked car cannot keep it from
  // ever being busted (or fake a cop-ram by the player).
  if (car.drivenSpeed !== undefined) car.speed = Math.min(car.speed, car.drivenSpeed);
  car.x = clamp(car.x, WORLD.minX, WORLD.maxX);
  car.z = clamp(car.z, WORLD.minZ, WORLD.maxZ);
  car.x = Math.min(car.x, 186); // cars stay out of the ocean
  return { crashed: impact > 0, impact, wallImpact, carBump };
}

/** A traffic car drives along one road line and turns at intersections. */
export function createTrafficCar(rng, colors) {
  const axis = rng.chance(0.5) ? 'x' : 'z';
  const line = rng.pick(LINES);
  const s = rng.range(-150, 150);
  const dir = rng.chance(0.5) ? 1 : -1;
  return {
    kind: 'traffic',
    axis,
    line,
    s,
    dir,
    speed: rng.range(8, 12),
    baseSpeed: rng.range(8, 12),
    x: 0,
    z: 0,
    heading: 0,
    color: rng.pick(colors),
  };
}

function trafficPose(car) {
  if (car.axis === 'x') {
    car.x = car.s;
    car.z = car.line;
    car.heading = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  } else {
    car.x = car.line;
    car.z = car.s;
    car.heading = car.dir > 0 ? 0 : Math.PI;
  }
}

export function stepTraffic(cars, dt, rng, playerCar = null, player = null) {
  for (const car of cars) trafficPose(car);
  for (const car of cars) {
    // Slow down for the car ahead on the same lane.
    let want = car.baseSpeed;
    for (const other of cars) {
      if (other === car || other.axis !== car.axis || other.line !== car.line || other.dir !== car.dir) continue;
      const ahead = (other.s - car.s) * car.dir;
      if (ahead > 0 && ahead < 8) want = Math.min(want, Math.max(0, other.speed - 1));
      if (ahead > 0 && ahead < 4) want = 0;
    }
    // Traffic never stops for the player's car — that deadlocks the player
    // behind a stopped car. Instead it speeds up to get out of the way.
    if (playerCar) {
      const onSameRoad = car.axis === 'x'
        ? Math.abs(playerCar.z - car.line) < 4
        : Math.abs(playerCar.x - car.line) < 4;
      if (onSameRoad) {
        const ahead = car.axis === 'x'
          ? (playerCar.x - car.s) * car.dir
          : (playerCar.z - car.s) * car.dir;
        if (ahead > 0 && ahead < 12) want = Math.max(want, 16);
      }
    }
    // Traffic DOES stop for a pedestrian on foot in the road. A car must
    // not bulldoze a standing player along the street — that let a wanted
    // player escape the police for free just by standing in traffic.
    if (player) {
      const onSameRoad = car.axis === 'x'
        ? Math.abs(player.z - car.line) < 4
        : Math.abs(player.x - car.line) < 4;
      if (onSameRoad) {
        const ahead = car.axis === 'x'
          ? (player.x - car.s) * car.dir
          : (player.z - car.s) * car.dir;
        if (ahead > 0 && ahead < 12) want = 0;
      }
    }
    let turned = false;
    car.speed += clamp(want - car.speed, -14 * dt, 6 * dt);
    car.s += car.dir * car.speed * dt;
    // Turn at an intersection, sometimes.
    for (const line of LINES) {
      if (Math.abs(car.s - line) < 1.2 && rng.chance(dt * 0.35)) {
        const oldLine = car.line;
        car.axis = car.axis === 'x' ? 'z' : 'x';
        car.line = line;
        car.s = oldLine;
        car.dir = rng.chance(0.5) ? 1 : -1;
        turned = true;
        break;
      }
    }
    if (car.s > 168 || car.s < -168) car.dir *= -1;
    trafficPose(car);
    // Never drive through the player (in a car or on foot): shove this car
    // along its road away from the player (forward if the player is behind
    // it, back if the player is ahead of it) and give it speed to pull away.
    const blocker = playerCar || player;
    if (!turned && blocker) {
      const d = Math.hypot(car.x - blocker.x, car.z - blocker.z);
      const min = CAR_RADIUS * 2 - 0.2;
      if (d < min) {
        const tx = car.axis === 'x' ? car.dir : 0;
        const tz = car.axis === 'x' ? 0 : car.dir;
        const proj = (blocker.x - car.x) * tx + (blocker.z - car.z) * tz;
        car.s += car.dir * (proj > 0 ? -(min - d + 1) : (min - d + 1));
        car.speed = Math.max(car.speed, 14);
        trafficPose(car);
      }
    }
  }
}

/** A police car chases the target point, steering and accelerating. */
export function createPoliceCar(x, z) {
  return {
    kind: 'police',
    x,
    z,
    heading: 0,
    speed: 0,
    steer: 0,
    color: [0.92, 0.92, 0.95], // white livery, so a cop reads as a cop
    flash: 0,
  };
}

/** Chase the target. Close in, the cop slows right down and steers hard
 * onto the target instead of orbiting it at speed; on foot the cop is
 * slower than a running player (9 vs 10), so running away really escapes,
 * while standing still gets you busted. */
export function stepPolice(car, tx, tz, dt, colliders, others, onFoot = false) {
  const dist = Math.hypot(tx - car.x, tz - car.z);
  // If the cop is stuck behind something while still far from the target —
  // e.g. a traffic car stopped in the road between it and the player, which
  // pins the cop's speed near zero — aim 10 units to the side of the target
  // instead, so it drives around the blockage rather than pushing at it
  // forever. (At spawn the speed is also low, so only sidestep once close.)
  let aimX = tx;
  let aimZ = tz;
  if (car.speed < 3 && dist > 6 && dist < 25) {
    const dx = tx - car.x;
    const dz = tz - car.z;
    const d = Math.hypot(dx, dz) || 1;
    aimX = tx + (-dz / d) * 10;
    aimZ = tz + (dx / d) * 10;
  }
  const desired = Math.atan2(aimX - car.x, aimZ - car.z);
  car.heading = turnToward(car.heading, desired, (dist < 15 ? 6 : 2.6) * dt);
  let want;
  // The cop brakes earlier the closer it gets, so it arrives on the
  // target instead of overshooting into an orbit — and it keeps creeping
  // at 2 u/s once it is on the target, so it never just parks at range.
  if (onFoot) want = dist > 15 ? 9 : dist > 6 ? 7 : 2;
  else want = dist > 30 ? 30 : dist > 15 ? 20 : dist > 6 ? 10 : 2;
  car.speed += clamp(want - car.speed, -20 * dt, 12 * dt);
  car.x += Math.sin(car.heading) * car.speed * dt;
  car.z += Math.cos(car.heading) * car.speed * dt;
  const fixed = collideCircle(car.x, car.z, CAR_RADIUS, colliders);
  car.x = fixed.x;
  car.z = fixed.z;
  if (fixed.hit && (fixed.nx !== 0 || fixed.nz !== 0)) {
    // Wall-following: a cop that just drives into a building stalls there
    // forever (every step halves its speed). Instead, drive along the wall
    // on the side that leads toward the target, keeping speed up — once
    // past the corner, normal steering takes over again.
    const dx = tx - car.x;
    const dz = tz - car.z;
    const t1x = -fixed.nz;
    const t1z = fixed.nx;
    const t2x = fixed.nz;
    const t2z = -fixed.nx;
    const useFirst = t1x * dx + t1z * dz >= t2x * dx + t2z * dz;
    car.heading = Math.atan2(useFirst ? t1x : t2x, useFirst ? t1z : t2z);
    car.speed = Math.max(car.speed, 12);
  } else if (fixed.hit) {
    car.speed *= 0.5;
  }
  for (const o of others) {
    if (o === car || o.kind === 'parked') continue; // never shove a parked car
    resolveCarPair(car, o);
  }
  car.x = clamp(car.x, WORLD.minX, WORLD.maxX);
  car.z = clamp(car.z, WORLD.minZ, WORLD.maxZ);
  car.x = Math.min(car.x, 186); // police cars stay out of the ocean
  car.flash += dt;
}
