// The player on foot: WASD moves relative to the camera, Shift runs,
// E gets in and out of cars (the car logic lives in game.js).
import { WORLD } from './city.js';
import { collideCircle, CAR_RADIUS } from './vehicles.js';
import { clamp, turnToward } from './math3.js';

export function createPlayer(x, z) {
  return {
    x,
    z,
    heading: 0,
    speed: 0,
    moving: false,
    bob: 0,
    onFoot: true,
    health: 100, // 0 = busted; restored at the safehouse, slowly when cool
    punchT: 0, // melee swing cooldown (also drives the punch lean in render)
    hurtT: 0, // invulnerable window after a cop shoves the player
  };
}

/** One step on foot. camYaw is the camera orbit angle (see main.js). */
export function stepPlayer(p, input, camYaw, dt, colliders, cars) {
  if (p.punchT > 0) p.punchT -= dt;
  if (p.hurtT > 0) p.hurtT -= dt;
  const fwd = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
  const strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  // Camera forward on the ground is (-sin yaw, -cos yaw); right is (cos yaw, -sin yaw).
  const fx = -Math.sin(camYaw);
  const fz = -Math.cos(camYaw);
  const rx = Math.cos(camYaw);
  const rz = -Math.sin(camYaw);
  let dx = fx * fwd + rx * strafe;
  let dz = fz * fwd + rz * strafe;
  const len = Math.hypot(dx, dz);
  p.moving = len > 0.01;
  if (p.moving) {
    dx /= len;
    dz /= len;
    const targetSpeed = input.run ? 10 : 6;
    p.speed += clamp(targetSpeed - p.speed, -30 * dt, 14 * dt);
    const targetHeading = Math.atan2(dx, dz);
    p.heading = turnToward(p.heading, targetHeading, 10 * dt);
    p.x += dx * p.speed * dt;
    p.z += dz * p.speed * dt;
    p.bob += p.speed * dt * 1.7;
  } else {
    p.speed = Math.max(0, p.speed - 30 * dt);
  }
  const fixed = collideCircle(p.x, p.z, 0.6, colliders);
  p.x = fixed.x;
  p.z = fixed.z;
  for (const car of cars) {
    const dxc = p.x - car.x;
    const dzc = p.z - car.z;
    const d = Math.hypot(dxc, dzc);
    const min = CAR_RADIUS + 0.5;
    if (d < min && d > 0.001) {
      p.x = car.x + (dxc / d) * min;
      p.z = car.z + (dzc / d) * min;
    }
  }
  p.x = clamp(p.x, WORLD.minX, Math.min(WORLD.maxX, 186)); // never walk on the water
  p.z = clamp(p.z, WORLD.minZ, WORLD.maxZ);
}
