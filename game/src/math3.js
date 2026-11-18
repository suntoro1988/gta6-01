// Tiny 3D math kit for Sunset Bay: column-major 4x4 matrices in the WebGL
// layout, plain [x, y, z] vectors, and a few angle helpers the driving and
// camera code leans on. No dependencies, no allocations beyond the matrix
// each call returns.

/** A fresh 4x4 identity matrix. */
export function matIdentity() {
  const out = new Float32Array(16);
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
  return out;
}

/** Perspective projection: fovY in radians, near/far clip planes. */
export function matPerspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const depth = near - far;
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / depth;
  out[11] = -1;
  out[14] = (2 * far * near) / depth;
  return out;
}

/** Camera matrix looking from `eye` at `target`, with `up` as the up hint. */
export function matLookAt(eye, target, up) {
  // Forward axis: eye minus target, normalised.
  let fx = eye[0] - target[0];
  let fy = eye[1] - target[1];
  let fz = eye[2] - target[2];
  let inv = 1 / (Math.hypot(fx, fy, fz) || 1);
  fx *= inv; fy *= inv; fz *= inv;
  // Right axis: up cross forward.
  let rx = up[1] * fz - up[2] * fy;
  let ry = up[2] * fx - up[0] * fz;
  let rz = up[0] * fy - up[1] * fx;
  inv = 1 / (Math.hypot(rx, ry, rz) || 1);
  rx *= inv; ry *= inv; rz *= inv;
  // True up: forward cross right.
  const ux = fy * rz - fz * ry;
  const uy = fz * rx - fx * rz;
  const uz = fx * ry - fy * rx;
  const out = new Float32Array(16);
  out[0] = rx; out[1] = ux; out[2] = fx; out[3] = 0;
  out[4] = ry; out[5] = uy; out[6] = fy; out[7] = 0;
  out[8] = rz; out[9] = uz; out[10] = fz; out[11] = 0;
  out[12] = -(rx * eye[0] + ry * eye[1] + rz * eye[2]);
  out[13] = -(ux * eye[0] + uy * eye[1] + uz * eye[2]);
  out[14] = -(fx * eye[0] + fy * eye[1] + fz * eye[2]);
  out[15] = 1;
  return out;
}

/** Model matrix: move to (x, y, z), spin around Y by `yaw`, scale evenly. */
export function matModel(yaw, x, y, z, scale = 1) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const out = new Float32Array(16);
  out[0] = c * scale; out[1] = 0; out[2] = -s * scale; out[3] = 0;
  out[4] = 0; out[5] = scale; out[6] = 0; out[7] = 0;
  out[8] = s * scale; out[9] = 0; out[10] = c * scale; out[11] = 0;
  out[12] = x; out[13] = y; out[14] = z; out[15] = 1;
  return out;
}

/** Model matrix with a pitch as well: yaw around Y, then pitch around X. */
export function matModelTilt(yaw, pitch, x, y, z, scale = 1) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const out = new Float32Array(16);
  out[0] = cy * scale; out[1] = 0; out[2] = -sy * scale; out[3] = 0;
  out[4] = sy * sp * scale; out[5] = cp * scale; out[6] = cy * sp * scale; out[7] = 0;
  out[8] = sy * cp * scale; out[9] = -sp * scale; out[10] = cy * cp * scale; out[11] = 0;
  out[12] = x; out[13] = y; out[14] = z; out[15] = 1;
  return out;
}

/** Model matrix with a separate scale per axis — stretching a unit mesh,
 * such as a tracer, to its real length. */
export function matModelScale(yaw, x, y, z, sx, sy, sz) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const out = new Float32Array(16);
  out[0] = c * sx; out[1] = 0; out[2] = -s * sx; out[3] = 0;
  out[4] = 0; out[5] = sy; out[6] = 0; out[7] = 0;
  out[8] = s * sz; out[9] = 0; out[10] = c * sz; out[11] = 0;
  out[12] = x; out[13] = y; out[14] = z; out[15] = 1;
  return out;
}

/** The upper-left 3x3 of a model matrix, for rotating surface normals. */
export function matNormalOf(model) {
  return new Float32Array([
    model[0], model[1], model[2],
    model[4], model[5], model[6],
    model[8], model[9], model[10],
  ]);
}

/** Clamp a number into [lo, hi]. */
export function clamp(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/** Clamp a number into [0, 1] — bar widths, fades, progress fills. */
export function clamp01(v) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** Shortest signed turn from angle `from` to angle `to`, in (-PI, PI]. */
export function angleDelta(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Move angle `from` toward `to` by no more than `maxStep` radians. */
export function turnToward(from, to, maxStep) {
  const d = angleDelta(from, to);
  if (Math.abs(d) <= maxStep) return to;
  return from + Math.sign(d) * maxStep;
}

/** Linear interpolation with t clamped to [0, 1]. */
export function lerp(a, b, t) {
  const k = clamp01(t);
  return a + (b - a) * k;
}

/** Smoothstep edge: 0 below `lo`, 1 above `hi`, eased between. */
export function smoothstep(lo, hi, v) {
  const k = clamp01((v - lo) / (hi - lo));
  return k * k * (3 - 2 * k);
}

/** Squared distance on the ground plane, for cheap range checks. */
export function dist2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

/** Component-wise lerp between two [r, g, b] colours. */
export function lerpColor(a, b, t) {
  const k = clamp01(t);
  return [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k,
  ];
}

/** Normalise a [x, y, z] vector; [0, 1, 0] when the input is near zero. */
export function vecNormalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}
