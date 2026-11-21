// Sunset Bay — vehicles.js (v10, written from scratch)
// Cars and boats for Sunset Bay.
//
// Cars: arcade physics — acceleration, braking / reverse, steering
// that bites harder at low speed and washes out at high speed, and
// a handbrake drift that cuts rear grip so the tail steps out.
// Traffic AI: civilian cars follow the street grid, slow for the
// car ahead, and stop at red traffic lights (SB.City lights).
// Boats: speedboats on the water south of the sea line; they steer
// freely, bob with the waves, and never beach themselves on land.
// Stealing: E next to a free car or boat puts the player in the
// driver's seat (player.js owns the key handling; this module owns
// the vehicle side — driver flag, seat position, exit clearance).
//
// A vehicle is a plain record:
//   { id, kind: "car" | "boat", x, y, z, yaw, speed, color,
//     driver, isTraffic, targetSpeed, ... }
// Speed is signed forward speed (m/s); yaw is heading in radians.

const SB = (globalThis.SB = globalThis.SB || {});

const CAR_ACCEL = 14;
const CAR_BRAKE = 26;
const CAR_REVERSE_ACCEL = 8;
const CAR_MAX_SPEED = 32;
const CAR_MAX_REVERSE = 9;
const CAR_DRAG = 0.6; // per-second speed decay when coasting
const CAR_MAX_STEER = 0.55; // radians of wheel angle at standstill
const BOAT_ACCEL = 9;
const BOAT_MAX_SPEED = 24;
const BOAT_TURN = 1.1;

const CAR_COLORS = ["#d94f3d", "#3d7bd9", "#e8c33a", "#37b06a", "#e8e8e8", "#22222a", "#7a4fd9", "#e07a2a"];
const BOAT_COLORS = ["#e8e8e8", "#d94f3d", "#3d7bd9", "#e8c33a"];

let nextVehicleId = 1;

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createCar(x, z, yaw = 0, color = null, isTraffic = false) {
  return {
    id: nextVehicleId++,
    kind: "car",
    x,
    y: 0,
    z,
    yaw,
    speed: 0,
    steer: 0, // smoothed steering angle, radians
    color: color || CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)],
    driver: null,
    isTraffic,
    targetSpeed: 0,
    drift: false,
    wheelSpin: 0,
  };
}

function createBoat(x, z, yaw = 0, color = null) {
  return {
    id: nextVehicleId++,
    kind: "boat",
    x,
    y: 0,
    z,
    yaw,
    speed: 0,
    steer: 0,
    color: color || BOAT_COLORS[Math.floor(Math.random() * BOAT_COLORS.length)],
    driver: null,
    isTraffic: false,
    targetSpeed: 0,
    drift: false,
    bobPhase: Math.random() * Math.PI * 2,
  };
}

// --- car physics ---------------------------------------------------
// drive input: { throttle: -1..1, steer: -1..1 (left -, right +),
//                handbrake: bool }. Steering authority fades with
// speed so the car stays controllable at 30 m/s; the handbrake
// (drift) cuts grip, lets the tail slide, and bleeds speed.
function driveCar(car, input, dt, city) {
  const throttle = clamp(input.throttle || 0, -1, 1);
  const steerTarget = clamp(input.steer || 0, -1, 1);
  const speedFactor = 1 / (1 + Math.abs(car.speed) * 0.045);
  const steerMax = CAR_MAX_STEER * speedFactor;
  car.steer += (steerTarget * steerMax - car.steer) * Math.min(1, dt * 8);

  if (throttle > 0) {
    car.speed += CAR_ACCEL * throttle * dt;
  } else if (throttle < 0) {
    if (car.speed > 0.5) car.speed -= CAR_BRAKE * dt; // brake first
    else car.speed -= CAR_REVERSE_ACCEL * dt; // then reverse
  } else {
    car.speed -= car.speed * CAR_DRAG * dt; // coast down
  }
  if (input.handbrake) {
    car.drift = true;
    car.speed -= car.speed * 1.4 * dt; // scrub speed in a slide
  } else {
    car.drift = Math.abs(car.steer) > 0.5 && Math.abs(car.speed) > 18;
  }

  car.speed = clamp(car.speed, -CAR_MAX_REVERSE, CAR_MAX_SPEED);
  if (Math.abs(car.speed) < 0.05 && throttle === 0) car.speed = 0;

  // Yaw rate grows with steering and speed; in a drift the tail
  // swings wider (extra yaw) while the car keeps most of its line.
  // steer (~0.55 max) * speed (~30 max) * 0.055 ~= 0.9 rad/s — a
  // full lock turn at speed, not a spin.
  const grip = car.drift ? 1.6 : 1.0;
  car.yaw += car.steer * car.speed * 0.055 * grip * dt;
  car.x += -Math.sin(car.yaw) * car.speed * dt;
  car.z += -Math.cos(car.yaw) * car.speed * dt;
  car.wheelSpin += car.speed * dt;
  if (city) collideWithBuildings(car, city);
  return car;
}

// Simplified, authoritative yaw step used by updateCar / traffic:
// yawRate = steer * speed * 0.055 * grip  (radians per second).
function stepCarMotion(car, dt, grip = 1) {
  car.yaw += car.steer * car.speed * 0.055 * grip * dt;
  car.x += -Math.sin(car.yaw) * car.speed * dt;
  car.z += -Math.cos(car.yaw) * car.speed * dt;
}

function collideWithBuildings(car, city) {
  if (!city || !city.buildings) return;
  for (const b of city.buildings) {
    const dx = car.x - b.x;
    const dz = car.z - b.z;
    const px = b.w / 2 + 1.1 - Math.abs(dx);
    const pz = b.d / 2 + 1.1 - Math.abs(dz);
    if (px > 0 && pz > 0) {
      // Shove out along the shallow axis and kill the speed —
      // a wall stop, not a slide-through.
      if (px < pz) car.x = b.x + Math.sign(dx || 1) * (b.w / 2 + 1.1);
      else car.z = b.z + Math.sign(dz || 1) * (b.d / 2 + 1.1);
      car.speed *= 0.25;
    }
  }
  car.x = clamp(car.x, -city.half + 2, city.half - 2);
  car.z = clamp(car.z, -city.half + 2, city.half - 2);
}

// Drift: handbrake turn. Returns the slide amount (radians of extra
// yaw) applied this frame — the HUD / tyre-smoke hook reads it.
function drift(car, dt) {
  if (Math.abs(car.speed) < 6) return 0;
  const extra = Math.sign(car.steer || 1) * Math.abs(car.speed) * 0.02 * dt;
  car.yaw += extra * 0.35;
  car.speed -= car.speed * 0.9 * dt;
  car.drift = true;
  return extra;
}

// --- boats ---------------------------------------------------------
function driveBoat(boat, input, dt, water) {
  const throttle = clamp(input.throttle || 0, -1, 1);
  const steerTarget = clamp(input.steer || 0, -1, 1);
  boat.steer += (steerTarget * 0.6 - boat.steer) * Math.min(1, dt * 4);
  boat.speed += BOAT_ACCEL * throttle * dt;
  boat.speed -= boat.speed * 0.35 * dt; // water drag
  boat.speed = clamp(boat.speed, -6, BOAT_MAX_SPEED);
  boat.yaw += boat.steer * BOAT_TURN * (boat.speed / BOAT_MAX_SPEED) * dt;
  boat.x += -Math.sin(boat.yaw) * boat.speed * dt;
  boat.z += -Math.cos(boat.yaw) * boat.speed * dt;
  // Stay on the water: never let a boat cross the sea line onto land.
  if (water && typeof water.isInWater === "function") {
    if (!water.isInWater(boat.x, boat.z)) {
      boat.speed *= -0.3; // bounce back off the shore
      boat.x += Math.sin(boat.yaw) * 2;
      boat.z += Math.cos(boat.yaw) * 2;
    }
  }
  // Bob with the waves; the renderer reads boat.y.
  boat.y = water && typeof water.waveHeight === "function"
    ? water.waveHeight(boat.x, boat.z, performance.now() / 1000)
    : Math.sin(performance.now() / 1000 * 1.4 + boat.bobPhase) * 0.18;
  return boat;
}

// --- traffic AI ----------------------------------------------------
// Traffic cars pick a random street, drive along it, and at each
// intersection choose straight / left / right. They stop for red
// lights and for the car ahead, and crawl through the turn.
function spawnTraffic(city, count = 10, seed = 42) {
  const rng = mulberry32(seed);
  const cars = [];
  const roads = city.roads || [];
  if (!roads.length) return cars;
  for (let i = 0; i < count; i++) {
    const road = roads[Math.floor(rng() * roads.length)];
    const t = (rng() * 2 - 1) * (city.half - 20);
    const along = road.axis === "x" ? { x: road.at + (rng() < 0.5 ? -2 : 2), z: t } : { x: t, z: road.at + (rng() < 0.5 ? -2 : 2) };
    const yaw = road.axis === "x"
      ? (t > 0 ? Math.PI : 0) + (rng() < 0.5 ? 0 : Math.PI)
      : (t > 0 ? Math.PI / 2 : -Math.PI / 2);
    const car = createCar(along.x, along.z, yaw, CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)], true);
    car.targetSpeed = 7 + rng() * 5;
    car.speed = car.targetSpeed * 0.8;
    car.axis = road.axis;
    car.lane = rng() < 0.5 ? -2 : 2;
    cars.push(car);
  }
  return cars;
}

function nearestLight(city, x, z) {
  let best = null;
  let bestD = 30;
  for (const l of city.trafficLights || []) {
    const d = Math.hypot(l.x - x, l.z - z);
    if (d < bestD) {
      best = l;
      bestD = d;
    }
  }
  return best;
}

function updateTraffic(cars, dt, city, allVehicles = []) {
  for (const car of cars) {
    if (car.driver) continue; // stolen by the player — player drives
    // Stop at a red light we are approaching.
    const light = city ? nearestLight(city, car.x, car.z) : null;
    const distToLight = light ? Math.hypot(light.x - car.x, light.z - car.z) : 999;
    const redAhead = light && light.state === "red" && distToLight < 14;
    // Slow for the vehicle ahead on the same street.
    let blocked = false;
    for (const other of allVehicles) {
      if (other === car) continue;
      const dx = other.x - car.x;
      const dz = other.z - car.z;
      const ahead = dx * -Math.sin(car.yaw) + dz * -Math.cos(car.yaw);
      const side = Math.abs(dx * Math.cos(car.yaw) - dz * Math.sin(car.yaw));
      if (ahead > 0 && ahead < 9 && side < 2.5) {
        blocked = true;
        break;
      }
    }
    const want = redAhead || blocked ? 0 : car.targetSpeed || 8;
    car.speed += clamp(want - car.speed, -CAR_BRAKE * dt, CAR_ACCEL * 0.5 * dt);
    car.steer *= 0.9;
    // At an intersection, sometimes turn onto the cross street.
    if (city) {
      const onIntersection =
        Math.abs(((car.x + city.half) % city.streetStep) - city.streetStep / 2) > city.streetStep / 2 - 3 &&
        Math.abs(((car.z + city.half) % city.streetStep) - city.streetStep / 2) > city.streetStep / 2 - 3;
      if (onIntersection && Math.abs(car.speed) > 3 && Math.random() < dt * 0.35) {
        car.yaw += (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
      }
    }
    car.x += -Math.sin(car.yaw) * car.speed * dt;
    car.z += -Math.cos(car.yaw) * car.speed * dt;
    if (city) collideWithBuildings(car, city);
  }
  return cars;
}

// Per-frame update for a player-driven vehicle: reads the same
// input shape player.js uses and routes cars / boats correctly.
function updateVehicle(vehicle, input, dt, world = {}) {
  if (!vehicle) return null;
  const drive = {
    throttle: (input.forward ? 1 : 0) - (input.back ? 1 : 0),
    steer: (input.right ? 1 : 0) - (input.left ? 1 : 0),
    handbrake: !!input.handbrake,
  };
  if (vehicle.kind === "boat") return driveBoat(vehicle, drive, dt, world.water);
  // Car: apply the shared physics, then the single yaw step.
  const before = vehicle.yaw;
  driveCar(vehicle, drive, dt, world.city);
  void before;
  return vehicle;
}

// Steal / enter check used by player.js: nearest free vehicle.
function nearestFreeVehicle(vehicles, x, z, maxDist = 3.2) {
  let best = null;
  let bestD = maxDist;
  for (const v of vehicles || []) {
    if (v.driver) continue;
    const d = Math.hypot(v.x - x, v.z - z);
    if (d < bestD) {
      best = v;
      bestD = d;
    }
  }
  return best;
}

function spawnParkedCars(city, count = 8, seed = 7) {
  const rng = mulberry32(seed);
  const cars = [];
  const roads = city.roads || [];
  for (let i = 0; i < count; i++) {
    const road = roads[Math.floor(rng() * roads.length)];
    const t = (rng() * 2 - 1) * (city.half - 20);
    const x = road.axis === "x" ? road.at + 3.4 : t;
    const z = road.axis === "x" ? t : road.at + 3.4;
    cars.push(createCar(x, z, road.axis === "x" ? 0 : Math.PI / 2));
  }
  return cars;
}

function spawnBoats(count = 3, seed = 11) {
  const rng = mulberry32(seed);
  const boats = [];
  for (let i = 0; i < count; i++) {
    boats.push(createBoat(-30 + i * 30 + rng() * 6, 215 + rng() * 20, rng() * Math.PI));
  }
  return boats;
}

// --- meshes --------------------------------------------------------
// Car: body + cabin + four wheels, built from SB.Meshes boxes so
// the winding rules in meshes.js apply here too.
function buildCarMesh(car) {
  const M = SB.Meshes;
  if (!M) return null;
  const b = new M.MeshBuilder();
  const c = Math.cos(car.yaw);
  const s = Math.sin(car.yaw);
  // Local offsets rotated by yaw: forward = (-sin yaw, -cos yaw).
  const at = (lx, lz) => ({
    x: car.x + lx * c - lz * s,
    z: car.z + lx * s + lz * c,
  });
  const body = at(0, 0);
  b.boxAt(body.x, 0.35, body.z, 1.9, 0.55, 4.2, car.color);
  const cabin = at(0, 0.3);
  b.boxAt(cabin.x, 0.9, cabin.z, 1.6, 0.5, 2.0, "#20242c");
  for (const [lx, lz] of [[-0.85, 1.4], [0.85, 1.4], [-0.85, -1.4], [0.85, -1.4]]) {
    const w = at(lx, lz);
    b.boxAt(w.x, 0.15, w.z, 0.28, 0.55, 0.55, "#111114");
  }
  return b.build();
}

function buildBoatMesh(boat) {
  const M = SB.Meshes;
  if (!M) return null;
  const b = new M.MeshBuilder();
  b.boxAt(boat.x, boat.y + 0.25, boat.z, 2.2, 0.5, 5.2, boat.color);
  b.boxAt(boat.x, boat.y + 0.7, boat.z + 0.8, 1.6, 0.45, 2.2, "#20242c");
  b.boxAt(boat.x, boat.y + 0.9, boat.z - 1.6, 0.5, 0.9, 0.3, "#d8dee6"); // windshield
  return b.build();
}

SB.Vehicles = {
  CAR_MAX_SPEED,
  BOAT_MAX_SPEED,
  createCar,
  createBoat,
  driveCar,
  driveBoat,
  drift,
  spawnTraffic,
  updateTraffic,
  updateVehicle,
  nearestFreeVehicle,
  spawnParkedCars,
  spawnBoats,
  buildCarMesh,
  buildBoatMesh,
};

const Vehicles = SB.Vehicles;

export { Vehicles, createCar, createBoat, driveCar, driveBoat, drift, spawnTraffic, updateTraffic, updateVehicle, nearestFreeVehicle, spawnParkedCars, spawnBoats, buildCarMesh, buildBoatMesh };
export default SB.Vehicles;
