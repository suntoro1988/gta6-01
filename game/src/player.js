// Sunset Bay — player.js (v10, written from scratch)
// The on-foot player character.
//
// Movement: WASD relative to the camera yaw, Shift to run, Space to
// jump (simple gravity, ground y = 0 on land). The player is a small
// articulated 3D figure built from SB.Meshes boxes — head, torso,
// arms, legs, plus a visible gun when armed — so the character reads
// clearly in third person and in screenshots.
//   * E near a car steals / enters it; E while driving exits it.
//   * E near / on a speedboat boards it; E on a boat ALWAYS drops
//     the player off (see water.js — far from the pier the player
//     lands in the water and swims, never soft-locked on the boat).
//   * Left mouse (or F) fires while on foot; shooting is disabled
//     while driving, and a short cooldown keeps the fire rate sane.
// State machine: mode is "foot" | "car" | "boat" | "swim". The
// update() function is pure over (player, input, dt, world) — the
// world supplies city (building collision), water height, and the
// vehicles list — so the same code drives both the game loop and
// any test harness.

const SB = (globalThis.SB = globalThis.SB || {});

const WALK_SPEED = 4.2;
const RUN_SPEED = 8.0;
const SWIM_SPEED = 2.6;
const JUMP_SPEED = 7.5;
const GRAVITY = 20;
const PLAYER_RADIUS = 0.45;
const PLAYER_HEIGHT = 1.8;
const SHOOT_COOLDOWN = 0.28;
const ENTER_RANGE = 3.2;

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function createPlayer(spawn = { x: 0, z: 170, yaw: Math.PI }) {
  return {
    x: spawn.x,
    y: 0,
    z: spawn.z,
    yaw: spawn.yaw || 0, // facing direction, radians
    vx: 0,
    vy: 0,
    vz: 0,
    onGround: true,
    mode: "foot", // "foot" | "car" | "boat" | "swim"
    vehicle: null, // vehicle record when mode is car/boat
    health: 100,
    armed: true,
    shootCooldown: 0,
    shotsFired: 0,
    walkCycle: 0, // animates arms/legs in buildPlayerMesh
    moving: false,
    running: false,
    swimming: false,
  };
}

// Build the player's 3D figure at the player's position. Arms and
// legs swing with walkCycle while moving; the gun is a dark box in
// the right hand when armed. Meshes are rebuilt per frame from the
// live pose (cheap at this vertex count) so animation never needs
// a skeleton or bone system.
function buildPlayerMesh(player) {
  const M = SB.Meshes;
  if (!M) return null;
  const b = new M.MeshBuilder();
  const swing = player.moving ? Math.sin(player.walkCycle) * 0.55 : 0;
  const y = player.y;
  const skin = "#e8b98a";
  const shirt = "#2e6fb0";
  const pants = "#2b3440";
  const shoes = "#1c1c22";
  // Legs (swing opposite each other).
  const legSwing = swing * 0.35;
  b.boxAt(player.x - 0.16, y, player.z + legSwing, 0.26, 0.8, 0.3, pants);
  b.boxAt(player.x + 0.16, y, player.z - legSwing, 0.26, 0.8, 0.3, pants);
  // Shoes.
  b.boxAt(player.x - 0.16, y, player.z + legSwing + 0.06, 0.28, 0.12, 0.42, shoes);
  b.boxAt(player.x + 0.16, y, player.z - legSwing + 0.06, 0.28, 0.12, 0.42, shoes);
  // Torso.
  b.boxAt(player.x, y + 0.8, player.z, 0.72, 0.62, 0.4, shirt);
  // Arms (swing opposite the legs).
  b.boxAt(player.x - 0.48, y + 1.05, player.z - swing * 0.3, 0.2, 0.55, 0.22, shirt);
  b.boxAt(player.x + 0.48, y + 1.05, player.z + swing * 0.3, 0.2, 0.55, 0.22, shirt);
  // Hands.
  b.boxAt(player.x - 0.48, y + 0.78, player.z - swing * 0.3, 0.18, 0.14, 0.18, skin);
  b.boxAt(player.x + 0.48, y + 0.78, player.z + swing * 0.3, 0.18, 0.14, 0.18, skin);
  // Head + cap.
  b.boxAt(player.x, y + 1.48, player.z, 0.42, 0.4, 0.4, skin);
  b.boxAt(player.x, y + 1.72, player.z, 0.46, 0.1, 0.46, "#d94f3d");
  // Gun in the right hand when armed and on foot.
  if (player.armed && player.mode === "foot") {
    b.boxAt(player.x + 0.48, y + 0.9, player.z + 0.28, 0.1, 0.12, 0.5, "#22222a");
  }
  return b.build();
}

// --- input helpers -------------------------------------------------
// input: { forward, back, left, right, run, jump, shoot, interact,
//          cameraYaw } — booleans + camera yaw in radians.
// interact / jump / shoot are edge-triggered by the caller setting
// them true for exactly one update (see consumeEdges below).

function moveDirection(input, cameraYaw) {
  // v10 integration fix: forward MUST match the camera view direction
  // (sin yaw, cos yaw) — the old signs were exactly 180 deg flipped,
  // so W walked toward (and then behind) the camera. Right is the
  // camera-right vector (-cos yaw, sin yaw).
  let fx = 0, fz = 0;
  if (input.forward) { fx += Math.sin(cameraYaw); fz += Math.cos(cameraYaw); }
  if (input.back) { fx += -Math.sin(cameraYaw); fz += -Math.cos(cameraYaw); }
  if (input.left) { fx += Math.cos(cameraYaw); fz += -Math.sin(cameraYaw); }
  if (input.right) { fx += -Math.cos(cameraYaw); fz += Math.sin(cameraYaw); }
  const len = Math.hypot(fx, fz);
  if (len === 0) return { x: 0, z: 0 };
  return { x: fx / len, z: fz / len };
}

// Push the player out of a building AABB (circle vs box, XZ only).
function resolveBuildingCollision(player, city) {
  if (!city || !city.buildings) return;
  for (const b of city.buildings) {
    const dx = player.x - b.x;
    const dz = player.z - b.z;
    const px = b.w / 2 + PLAYER_RADIUS - Math.abs(dx);
    const pz = b.d / 2 + PLAYER_RADIUS - Math.abs(dz);
    if (px > 0 && pz > 0) {
      if (px < pz) player.x = b.x + Math.sign(dx || 1) * (b.w / 2 + PLAYER_RADIUS);
      else player.z = b.z + Math.sign(dz || 1) * (b.d / 2 + PLAYER_RADIUS);
    }
  }
  player.x = clamp(player.x, -city.half, city.half);
  player.z = clamp(player.z, -city.half, city.half);
}

function nearestVehicle(player, vehicles, maxDist = ENTER_RANGE) {
  let best = null;
  let bestD = maxDist;
  for (const v of vehicles || []) {
    if (v.driver) continue; // already driven
    const d = Math.hypot(v.x - player.x, v.z - player.z);
    if (d < bestD) {
      best = v;
      bestD = d;
    }
  }
  return best;
}

// Try to enter the nearest free vehicle (E). Returns the vehicle
// entered, or null. Boats are entered the same way as cars.
function tryEnterVehicle(player, vehicles) {
  const v = nearestVehicle(player, vehicles);
  if (!v) return null;
  v.driver = player;
  player.vehicle = v;
  player.mode = v.kind === "boat" ? "boat" : "car";
  player.vx = 0;
  player.vy = 0;
  player.vz = 0;
  return v;
}

// Leave the current vehicle (E while driving).
//   * Car: step out to the driver's side on solid ground.
//   * Boat: hand off to SB.Water.exitBoat — near the pier the player
//     steps onto the dock; anywhere else the player drops into the
//     water and swims (mode "swim"), so E can NEVER trap the player
//     on a boat far from shore. That is the v10 soft-lock fix.
function exitVehicle(player, world) {
  const v = player.vehicle;
  if (!v) return false;
  v.driver = null;
  player.vehicle = null;
  if (v.kind === "boat" && SB.Water && typeof SB.Water.exitBoat === "function") {
    SB.Water.exitBoat(player, v, world);
    return true;
  }
  if (v.kind === "boat") {
    // Fallback if water.js is not loaded: drop into the water
    // and swim — still never trap the player on the boat.
    player.mode = "swim";
    player.x = v.x;
    player.z = v.z + 2;
    player.y = 0;
    return true;
  }
  // Car: exit to the left of the car, clear of its body.
  const sideX = Math.cos(v.yaw || 0);
  const sideZ = -Math.sin(v.yaw || 0);
  player.x = v.x + sideX * 2.0;
  player.z = v.z + sideZ * 2.0;
  player.y = 0;
  player.mode = "foot";
  return true;
}

// Fire one shot while on foot. Returns a shot record
// { x, y, z, yaw, range } for the game loop / HUD, or null.
function shoot(player) {
  if (player.mode !== "foot" || !player.armed) return null;
  if (player.shootCooldown > 0) return null;
  player.shootCooldown = SHOOT_COOLDOWN;
  player.shotsFired++;
  return {
    x: player.x,
    y: player.y + 1.35,
    z: player.z,
    yaw: player.yaw,
    range: 60,
  };
}

function updateOnFoot(player, input, dt, world) {
  const dir = moveDirection(input, input.cameraYaw || 0);
  const speed = input.run ? RUN_SPEED : WALK_SPEED;
  player.moving = dir.x !== 0 || dir.z !== 0;
  player.running = player.moving && !!input.run;
  player.vx = dir.x * speed;
  player.vz = dir.z * speed;
  player.x += player.vx * dt;
  player.z += player.vz * dt;
  if (player.moving) {
    player.yaw = Math.atan2(-dir.x, -dir.z);
    player.walkCycle += dt * (player.running ? 13 : 9);
  }
  if (input.jump && player.onGround) {
    player.vy = JUMP_SPEED;
    player.onGround = false;
  }
  if (!player.onGround) {
    player.vy -= GRAVITY * dt;
    player.y += player.vy * dt;
    if (player.y <= 0) {
      player.y = 0;
      player.vy = 0;
      player.onGround = true;
    }
  }
  resolveBuildingCollision(player, world && world.city);
  // Walked into the sea? Start swimming instead of walking on water.
  if (world && world.water && typeof world.water.isInWater === "function") {
    if (world.water.isInWater(player.x, player.z) && player.mode === "foot") {
      player.mode = "swim";
      player.y = 0;
      player.swimming = true;
    }
  }
  if (input.shoot) shoot(player);
}

function updateSwimming(player, input, dt, world) {
  const dir = moveDirection(input, input.cameraYaw || 0);
  player.moving = dir.x !== 0 || dir.z !== 0;
  player.x += dir.x * SWIM_SPEED * dt;
  player.z += dir.z * SWIM_SPEED * dt;
  player.y = 0;
  player.swimming = true;
  if (player.moving) {
    player.yaw = Math.atan2(-dir.x, -dir.z);
    player.walkCycle += dt * 7;
  }
  // Reached dry land again? Climb out and walk.
  if (world && world.water && typeof world.water.isInWater === "function") {
    if (!world.water.isInWater(player.x, player.z)) {
      player.mode = "foot";
      player.swimming = false;
    }
  }
  resolveBuildingCollision(player, world && world.city);
}

// Main per-frame update. world = { city, water, vehicles }.
// Vehicles drive themselves in vehicles.js; while the player is in
// a car/boat this function only keeps the player glued to the seat
// and handles the E-to-exit edge.
function update(player, input, dt, world = {}) {
  if (player.shootCooldown > 0) player.shootCooldown -= dt;
  if (input.interact) {
    if (player.mode === "car" || player.mode === "boat") {
      exitVehicle(player, world);
    } else if (player.mode === "foot") {
      tryEnterVehicle(player, world.vehicles);
    }
    // In "swim" mode E does nothing — the player is already free.
  }
  if (player.mode === "foot") {
    updateOnFoot(player, input, dt, world);
  } else if (player.mode === "swim") {
    updateSwimming(player, input, dt, world);
  } else if (player.vehicle) {
    // Riding: the vehicle moves the player; mirror its position.
    player.x = player.vehicle.x;
    player.z = player.vehicle.z;
    player.y = player.vehicle.y || 0;
    player.yaw = player.vehicle.yaw || player.yaw;
    player.moving = Math.abs(player.vehicle.speed || 0) > 0.5;
  }
  return player;
}

SB.Player = {
  WALK_SPEED,
  RUN_SPEED,
  SWIM_SPEED,
  JUMP_SPEED,
  ENTER_RANGE,
  createPlayer,
  buildPlayerMesh,
  update,
  tryEnterVehicle,
  exitVehicle,
  nearestVehicle,
  shoot,
  moveDirection,
};

const Player = SB.Player;

export { Player, createPlayer, buildPlayerMesh, update, tryEnterVehicle, exitVehicle, nearestVehicle, shoot };
export default SB.Player;
