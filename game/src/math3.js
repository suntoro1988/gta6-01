// Sunset Bay v5 — 3D vector and matrix math.
// Written fresh for v5 from the design spec. Vectors are plain [x, y, z] arrays.
// Matrices are flat 16-element arrays in COLUMN-MAJOR order (WebGL convention):
// element (row r, column c) lives at index c * 4 + r, so a translation sits at
// indices 12, 13, 14. matMul(a, b) returns a * b (apply b first, then a).

export function vec(x, y, z) {
  return [x, y, z];
}

export function vadd(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function vsub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vscale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function vdot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function vcross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function vlen(a) {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
}

export function vnorm(a) {
  const len = vlen(a);
  if (len === 0) return [0, 0, 0];
  return [a[0] / len, a[1] / len, a[2] / len];
}

export function clamp(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Wrap an angle in radians to the range [-PI, PI].
export function wrapAngle(a) {
  const twoPi = Math.PI * 2;
  let r = (a + Math.PI) % twoPi;
  if (r < 0) r += twoPi;
  return r - Math.PI;
}

// Horizontal (XZ-plane) distance between two points.
export function dist2d(ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  return Math.sqrt(dx * dx + dz * dz);
}

export function matIdentity() {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

// Column-major multiply: out = a * b.
export function matMul(a, b) {
  const out = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + r] * b[c * 4 + k];
      }
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

// Rotation about the Y axis (right-handed, positive angle turns +Z toward +X).
export function matRotY(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    c, 0, -s, 0,
    0, 1, 0, 0,
    s, 0, c, 0,
    0, 0, 0, 1,
  ];
}

export function matTrans(x, y, z) {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ];
}

// Apply a 4x4 matrix to a 3D point (w = 1), with perspective divide when needed.
export function matApply(m, v) {
  const x = v[0];
  const y = v[1];
  const z = v[2];
  const w =
    m[3] * x + m[7] * y + m[11] * z + m[15];
  const ox = m[0] * x + m[4] * y + m[8] * z + m[12];
  const oy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const oz = m[2] * x + m[6] * y + m[10] * z + m[14];
  if (w !== 0 && w !== 1) return [ox / w, oy / w, oz / w];
  return [ox, oy, oz];
}
