// math3.js — tiny 3D math helpers. Plain arrays for vectors,
// Float32Array (column-major) for 4x4 matrices, WebGL style.
export function v3(x = 0, y = 0, z = 0) { return [x, y, z]; }
export function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
export function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
export function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function len(a) { return Math.hypot(a[0], a[1], a[2]); }
export function norm(a) {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
export function mat4Identity() {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}
// Column-major multiply: out = a * b (apply b first, then a).
export function mat4Mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
export function mat4Persp(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2), m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f;
  m[10] = (far + near) / (near - far); m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}
export function mat4LookAt(eye, target, up) {
  const z = norm(sub(eye, target));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  const m = mat4Identity();
  m[0] = x[0]; m[1] = y[0]; m[2] = z[0];
  m[4] = x[1]; m[5] = y[1]; m[6] = z[1];
  m[8] = x[2]; m[9] = y[2]; m[10] = z[2];
  m[12] = -dot(x, eye); m[13] = -dot(y, eye); m[14] = -dot(z, eye);
  return m;
}
export function mat4Trans(x, y, z) {
  const m = mat4Identity();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}
export function mat4RotY(a) {
  const c = Math.cos(a), s = Math.sin(a), m = mat4Identity();
  m[0] = c; m[2] = -s; m[8] = s; m[10] = c;
  return m;
}
export function mat4RotX(a) {
  const c = Math.cos(a), s = Math.sin(a), m = mat4Identity();
  m[5] = c; m[6] = s; m[9] = -s; m[10] = c;
  return m;
}
