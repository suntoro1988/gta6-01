// player.js — gerakan jalan kaki untuk Sunset Bay v5 (bounty make.fun).
// Ditulis SEPENUHNYA BARU dari design-spec round4 di dalam sesi recording v5.
// Tidak ada kode yang disalin dari round sebelumnya.
import { wrapAngle } from './math3.js';

export const WALK_SPEED = 6;
export const SPRINT_SPEED = 12;

// Cek apakah titik (x, z) terhalang: di luar batas kota, di dalam gedung, atau di air.
function blockedAt(city, x, z) {
  if (city && city.bounds) {
    const b = city.bounds;
    if (x < b.minX + 0.5 || x > b.maxX - 0.5 || z < b.minZ + 0.5 || z > b.maxZ - 0.5) return true;
  }
  if (city && city.buildings) {
    for (let i = 0; i < city.buildings.length; i++) {
      const bd = city.buildings[i];
      if (Math.abs(x - bd.x) < bd.w / 2 + 0.6 && Math.abs(z - bd.z) < bd.d / 2 + 0.6) return true;
    }
  }
  if (city && city.water) {
    for (let i = 0; i < city.water.length; i++) {
      const w = city.water[i];
      if (Math.abs(x - w.x) < w.w / 2 && Math.abs(z - w.z) < w.d / 2) return true;
    }
  }
  return false;
}

function turnToward(cur, target, maxStep) {
  let d = wrapAngle(target - cur);
  if (d > maxStep) d = maxStep;
  else if (d < -maxStep) d = -maxStep;
  return cur + d;
}

export function createPlayer(x, z) {
  return { x, z, heading: 0, speed: 0, onFoot: true };
}

// Gerak jalan kaki. Input: {up, down, left, right, sprint, camYaw}.
// Gerak relatif terhadap arah kamera (camYaw, radian). Sprint 12 u/s, jalan 6 u/s.
// Tabrakan memakai wall-slide: coba gerak penuh, kalau terhalang coba per sumbu,
// jadi pemain meluncur sepanjang dinding, bukan macet menempel dinding.
export function stepPlayer(P, input, dt, city) {
  const inp = input || {};
  const yaw = typeof inp.camYaw === 'number' ? inp.camYaw : P.heading;
  let mx = 0;
  let mz = 0;
  if (inp.up) { mx += Math.sin(yaw); mz += Math.cos(yaw); }
  if (inp.down) { mx -= Math.sin(yaw); mz -= Math.cos(yaw); }
  if (inp.left) { mx -= Math.cos(yaw); mz += Math.sin(yaw); }
  if (inp.right) { mx += Math.cos(yaw); mz -= Math.sin(yaw); }
  const len = Math.hypot(mx, mz);
  const targetSpeed = len > 0 ? (inp.sprint ? SPRINT_SPEED : WALK_SPEED) : 0;
  let moved = 0;
  if (len > 0) {
    mx /= len;
    mz /= len;
    const wantHeading = Math.atan2(mx, mz);
    P.heading = turnToward(P.heading, wantHeading, 12 * dt);
    const nx = P.x + mx * targetSpeed * dt;
    const nz = P.z + mz * targetSpeed * dt;
    if (!blockedAt(city, nx, nz)) {
      moved = Math.hypot(nx - P.x, nz - P.z);
      P.x = nx;
      P.z = nz;
    } else if (!blockedAt(city, nx, P.z)) {
      moved = Math.abs(nx - P.x);
      P.x = nx;
    } else if (!blockedAt(city, P.x, nz)) {
      moved = Math.abs(nz - P.z);
      P.z = nz;
    }
  }
  P.speed = dt > 0 ? moved / dt : 0;
  P.onFoot = true;
}
