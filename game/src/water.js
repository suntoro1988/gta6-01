// Sunset Bay — sea, beach, docks and speedboat physics (fresh v6 rewrite).
import { makeRng } from './rng.js';

function toRng(seed, fallback) {
  if (seed && typeof seed.next === 'function') return seed;
  return makeRng(seed == null ? fallback : seed);
}

export const SHORE_X = 318; // waterline: the sea is x > SHORE_X
export const SEA_LEVEL = 0;

export function buildWater(seed) {
  const rng = toRng(seed, 77);
  const beach = { x0: 292, x1: SHORE_X, z0: -330, z1: 330, kind: 'sand' };
  const docks = [];
  for (let i = 0; i < 3; i++) {
    docks.push({ x: SHORE_X + 14 + i * 4, z: -205 + i * 28 + (rng.next() - 0.5) * 6, len: 26, angle: 0, kind: 'dock' });
  }
  const boatSpawn = { x: SHORE_X + 34, z: -175, angle: Math.PI / 2 };
  return { level: SEA_LEVEL, shoreX: SHORE_X, beach, docks, boatSpawn };
}

// Simple speedboat physics. boat: {x, z, angle, speed}.
// input: {throttle: -1..1, steer: -1..1}. Returns the same boat object.
export function boatUpdate(boat, input, dt) {
  const th = input.throttle || 0, st = input.steer || 0;
  const maxF = 30, maxR = 9, accel = 16;
  boat.speed += th * accel * dt;
  boat.speed -= boat.speed * 0.55 * dt; // water drag
  if (boat.speed > maxF) boat.speed = maxF;
  if (boat.speed < -maxR) boat.speed = -maxR;
  const spdRatio = Math.min(1, Math.abs(boat.speed) / maxF);
  const turn = st * 1.5 * (1 - 0.55 * spdRatio);
  const grip = 0.15 + Math.min(1, Math.abs(boat.speed) / 6);
  boat.angle += turn * Math.sign(boat.speed || 1) * grip * dt;
  boat.x += Math.cos(boat.angle) * boat.speed * dt;
  boat.z += Math.sin(boat.angle) * boat.speed * dt;
  // Beaching: a boat cannot drive on land, it stops at the waterline.
  if (boat.x < SHORE_X + 3) {
    boat.x = SHORE_X + 3;
    boat.speed *= 0.4;
    if (Math.cos(boat.angle) < 0) boat.speed = Math.max(0, boat.speed);
  }
  if (boat.z < -400) { boat.z = -400; boat.speed *= 0.5; }
  if (boat.z > 400) { boat.z = 400; boat.speed *= 0.5; }
  if (boat.x > 560) { boat.x = 560; boat.speed *= 0.5; }
  return boat;
}
