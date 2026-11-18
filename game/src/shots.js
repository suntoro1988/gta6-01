// The screenshot scenes behind ?shot=start|play|foot|end. Each one stages a
// real, reachable game state from the seeded world and runs it forward a few
// fixed steps, so the frame is what the game genuinely looks like.
// Every camera is a rear three-quarter chase camera (yaw = heading + PI):
// the player car ahead, the police behind it, the beacon ahead of both.
import { PLAYER_CAR_COLOR } from './game.js';
import { createPoliceCar } from './vehicles.js';

function giveCar(game, x, z, heading, speed) {
  const car = {
    kind: 'player',
    x,
    z,
    heading,
    speed,
    steer: 0,
    color: PLAYER_CAR_COLOR,
    model: 'Comet',
  };
  game.playerCar = car;
  game.player.onFoot = false;
  return car;
}

function driveFor(game, seconds, input) {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i += 1) {
    game.step(1 / 60, input, 0);
  }
}

/** Place police cars relative to the player's car: back = units behind it. */
function placePolice(game, car, offsets) {
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  const rx = Math.cos(car.heading);
  const rz = -Math.sin(car.heading);
  game.police = offsets.map(([back, side], i) => {
    const cop = createPoliceCar(
      car.x - fx * back + rx * side,
      car.z - fz * back + rz * side,
    );
    cop.heading = car.heading;
    cop.speed = 24;
    cop.name = `UNIT ${12 + i * 7}`;
    cop.dist = Math.hypot(cop.x - car.x, cop.z - car.z);
    cop.tactic = back < 0 ? 'ROADBLOCK' : 'PURSUIT';
    return cop;
  });
}

/** Put one traffic car and one pedestrian in the frame, ahead of the car. */
function stageTrafficAndPed(game, car, trafficX, trafficZ, trafficHeading, pedX, pedZ, pedHeading) {
  const t = game.traffic[0];
  t.x = trafficX;
  t.z = trafficZ;
  t.heading = trafficHeading;
  t.speed = 10;
  const p = game.pedestrians[0];
  p.x = pedX;
  p.z = pedZ;
  p.heading = pedHeading;
}

const DRIVE = { forward: true, back: false, left: false, right: false, run: false, handbrake: false };
const IDLE = { forward: false, back: false, left: false, right: false, run: false, handbrake: false };

/**
 * Stage the named scene and return the camera to shoot it with:
 * { target: [x, y, z], yaw, pitch, dist }.
 */
export function stageShot(name, game) {
  if (name === 'play') {
    game.state = 'playing';
    game.money = 1250;
    game.heat = 210;
    game.startMission(3); // Street Race: checkpoints + the race card on screen
    game.radioStationName = 'BAY FM';
    game.radioTrack = { title: 'Sunset Cruise', artist: 'The Palms' };
    game.ammo.pistol = 12;
    game.unlocked.pistol = true;
    game.weaponIndex = 1;
    giveCar(game, 0, -40, Math.PI, 26);
    driveFor(game, 1.6, DRIVE);
    const car = game.playerCar;
    game.jobTarget = { x: 0, z: -150, name: 'Checkpoint 1' };
    game.missionTimeLeft = 64;
    placePolice(game, car, [[12, 5], [18, -5]]);
    // Traffic and a pedestrian ahead, a coin on the road, beacon ahead:
    // the chase reads from behind, the mission reads in the middle.
    stageTrafficAndPed(game, car, 0, car.z - 45, Math.PI, -7, car.z - 28, Math.PI / 2);
    game.pickups[0] = { x: 2, z: car.z - 32, amount: 25, taken: false, spin: -2.3, respawn: 0 };
    // Rear three-quarter view: camera behind the car, cops between camera
    // and car, beacon straight ahead down the road.
    return {
      target: [car.x, 2, car.z],
      yaw: car.heading + Math.PI,
      pitch: 0.38,
      dist: 28,
    };
  }

  if (name === 'end') {
    game.state = 'playing';
    game.money = 4800;
    game.heat = 460;
    game.jobsDone = 6;
    game.startMission(6); // The Big Heist, at 4 stars: heli + roadblock in frame
    game.radioStationName = 'SUNSET DRIVE';
    game.radioTrack = { title: 'Full Throttle', artist: 'Neon Coast' };
    game.ammo.pistol = 24;
    game.ammo.smg = 30;
    game.unlocked.pistol = true;
    game.unlocked.smg = true;
    game.weaponIndex = 3;
    giveCar(game, -40, 0, Math.PI / 2, 16);
    driveFor(game, 1.2, DRIVE);
    const car = game.playerCar;
    game.jobTarget = { x: 120, z: 0, name: 'Marina Vault' };
    game.missionTimeLeft = 41;
    placePolice(game, car, [[8, 4], [13, -5], [18, 5], [-14, 6]]);
    // Park the helicopter in frame: ahead-right of the car, low enough to
    // read against the sky, its spotlight disc on the road below it.
    if (game.heli) {
      game.heli.x = car.x + 24;
      game.heli.z = car.z - 10;
      game.heli.y = 14;
      game.heli.rotor = 0.6;
    }
    stageTrafficAndPed(game, car, car.x + 45, 0, Math.PI / 2, car.x + 32, 7, -Math.PI / 2);
    game.pickups[0] = { x: car.x + 24, z: 2, amount: 25, taken: false, spin: -2.3, respawn: 0 };
    // v3: a stash pack sits in frame on the roadside — the golden briefcase
    // reads next to the coin, and the STASH 0/6 line shows in the HUD pill.
    const stash = game.pickups.find((p) => p.kind === 'stash' && !p.taken);
    if (stash) { stash.x = car.x + 18; stash.z = 6; stash.spin = -2.3; }
    // Rear view, raised and pulled back so all four cops read — the two
    // behind between camera and car, the roadblock ahead — and the beacon
    // at the pier stands in the middle of the frame.
    return {
      target: [car.x, 2, car.z],
      yaw: car.heading + Math.PI,
      pitch: 0.38,
      dist: 29,
    };
  }

  if (name === 'foot') {
    game.state = 'playing';
    game.money = 350;
    game.heat = 120;
    game.startMission(1); // Package Run, on foot with a pistol in hand
    game.radioStationName = 'NEON NIGHTS';
    game.radioTrack = { title: 'Ultraviolet', artist: 'DJ Sunset' };
    game.ammo.pistol = 12;
    game.unlocked.pistol = true;
    game.weaponIndex = 1;
    // On a city sidewalk, not the beach: the player stands on the z = 52
    // road, facing the camera, with the street running west.
    game.player.x = -20;
    game.player.z = 52;
    game.player.heading = Math.PI / 2;
    game.player.onFoot = true;
    game.jobTarget = { x: -110, z: 52, name: 'Bay Park' };
    game.missionTimeLeft = 72;
    driveFor(game, 0.5, IDLE);
    // A parked car and a coin on the street ahead, a traffic car coming
    // down the road, pedestrians on the sidewalk — after driveFor, so the
    // stepped world does not move them away again.
    game.parked.push({
      kind: 'parked',
      x: -38,
      z: 48,
      heading: Math.PI / 2,
      speed: 0,
      steer: 0,
      color: [0.2, 0.7, 0.7],
    });
    game.pickups[0] = { x: -30, z: 52, amount: 25, taken: false, spin: -2.3, respawn: 0 };
    const t = game.traffic[0];
    t.x = -58;
    t.z = 52;
    t.heading = Math.PI / 2;
    t.speed = 10;
    game.pedestrians[0].x = -28;
    game.pedestrians[0].z = 48;
    game.pedestrians[0].heading = -Math.PI / 2;
    game.pedestrians[1].x = -34;
    game.pedestrians[1].z = 47;
    game.pedestrians[1].heading = -Math.PI / 2;
    // Street level, looking west along the road: buildings, traffic,
    // pedestrians, parked car, coin and the beacon all in frame.
    return {
      target: [game.player.x, 1.6, game.player.z],
      yaw: Math.PI / 2 + 0.15,
      pitch: 0.22,
      dist: 10,
    };
  }

  // Default: start — the cover. Not the title screen: a gameplay chase
  // frame, driving north up the x = 0 road at 2 stars, HUD, minimap,
  // mission beacon and police all in one frame.
  game.state = 'playing';
  game.money = 1250;
  game.heat = 210;
  game.startMission(1); // Package Run: the mission card reads on the cover
  game.radioStationName = 'BAY FM';
  game.radioTrack = { title: 'Golden Hour', artist: 'Marina Lights' };
  giveCar(game, 0, -60, 0, 26);
  driveFor(game, 1.6, DRIVE);
  const car = game.playerCar;
  game.jobTarget = { x: 0, z: 40, name: 'Hotel Bayview' };
  game.missionTimeLeft = 64;
  placePolice(game, car, [[12, 5], [18, -5]]);
  stageTrafficAndPed(game, car, 0, car.z + 38, 0, 7, car.z + 24, -Math.PI / 2);
  game.pickups[0] = { x: -2, z: car.z + 28, amount: 25, taken: false, spin: -2.3, respawn: 0 };
  return {
    target: [car.x, 2, car.z],
    yaw: car.heading + Math.PI,
    pitch: 0.38,
    dist: 28,
  };
}
