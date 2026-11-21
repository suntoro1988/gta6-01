// math3.js — Sunset Bay v11 (Builder B: game core + rendering)
// Matematika 3D mandiri: vec3 sebagai OBJECT {x, y, z} dan mat4
// column-major Float32Array(16) mengikuti konvensi WebGL.
//
// ATURAN PENTING (pelajaran bug v8): mat4LookAt HARUS menerima eye /
// target / up sebagai OBJECT {x, y, z}. Versi v8 gagal merender dunia
// 3D (hanya langit) karena lookAt menerima array tapi dipanggil dengan
// object. Di sini toVec3() menerima KEDUANYA (object dan array) sehingga
// pemanggil dari gaya manapun tetap benar.

export const VERSION = '11.0.0';

// ---------------------------------------------------------------- vec3 ---
// vec3 adalah object polos {x, y, z}. Semua fungsi di bawah pure
// (tidak mengubah argumen) kecuali yang namanya diakhiri "Into".

export function v3(x = 0, y = 0, z = 0) {
  return { x, y, z };
}

export function v3Clone(a) {
  return { x: a.x, y: a.y, z: a.z };
}

// Normalisasi input: terima {x,y,z} ATAU [x,y,z] ATAU {0,1,2}.
// Dipakai di semua fungsi mat4 supaya pemanggil object tidak pernah gagal.
export function toVec3(v, fallback) {
  if (!v) return fallback ? { x: fallback.x, y: fallback.y, z: fallback.z } : { x: 0, y: 0, z: 0 };
  if (typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number') {
    return { x: v.x, y: v.y, z: v.z };
  }
  if (Array.isArray(v) && v.length >= 3) {
    return { x: v[0], y: v[1], z: v[2] };
  }
  if (typeof v[0] === 'number' && typeof v[1] === 'number' && typeof v[2] === 'number') {
    return { x: v[0], y: v[1], z: v[2] };
  }
  return fallback ? { x: fallback.x, y: fallback.y, z: fallback.z } : { x: 0, y: 0, z: 0 };
}

export function v3Add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function v3Sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function v3Scale(a, s) {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function v3Dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function v3Cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function v3Length(a) {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function v3LengthSq(a) {
  return a.x * a.x + a.y * a.y + a.z * a.z;
}

export function v3Normalize(a) {
  const len = v3Length(a);
  if (len < 1e-8) return { x: 0, y: 0, z: 0 };
  return { x: a.x / len, y: a.y / len, z: a.z / len };
}

export function v3Distance(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function v3Lerp(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

export function v3Equals(a, b, eps = 1e-6) {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.z - b.z) < eps;
}

export const V3_ZERO = Object.freeze({ x: 0, y: 0, z: 0 });
export const V3_UP = Object.freeze({ x: 0, y: 1, z: 0 });
export const V3_FORWARD = Object.freeze({ x: 0, y: 0, z: -1 });

// ---------------------------------------------------------------- mat4 ---
// mat4 disimpan column-major Float32Array(16), sama seperti WebGL
// uniformMatrix4fv. Elemen m[col * 4 + row].

export function m4Identity() {
  const out = new Float32Array(16);
  out[0] = 1; out[5] = 1; out[10] = 1; out[15] = 1;
  return out;
}

export function m4Clone(m) {
  return new Float32Array(m);
}

// out = a * b (perkalian matriks standar, column-major).
export function m4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

export function m4Perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  out[15] = 0;
  return out;
}

export function m4Ortho(left, right, bottom, top, near, far) {
  const out = new Float32Array(16);
  const rl = 1 / (right - left);
  const tb = 1 / (top - bottom);
  const fn = 1 / (far - near);
  out[0] = 2 * rl;
  out[5] = 2 * tb;
  out[10] = -2 * fn;
  out[12] = -(right + left) * rl;
  out[13] = -(top + bottom) * tb;
  out[14] = -(far + near) * fn;
  out[15] = 1;
  return out;
}

export function m4Translation(v) {
  const p = toVec3(v);
  const out = m4Identity();
  out[12] = p.x; out[13] = p.y; out[14] = p.z;
  return out;
}

export function m4Scaling(v) {
  const p = toVec3(v);
  const out = new Float32Array(16);
  out[0] = p.x; out[5] = p.y; out[10] = p.z; out[15] = 1;
  return out;
}

export function m4RotateX(angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const out = m4Identity();
  out[5] = c; out[6] = s;
  out[9] = -s; out[10] = c;
  return out;
}

export function m4RotateY(angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const out = m4Identity();
  out[0] = c; out[2] = -s;
  out[8] = s; out[10] = c;
  return out;
}

export function m4RotateZ(angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const out = m4Identity();
  out[0] = c; out[1] = s;
  out[4] = -s; out[5] = c;
  return out;
}

// Rotasi di sekitar sumbu bebas (axis object {x,y,z}).
export function m4Rotate(angle, axis) {
  const a = v3Normalize(toVec3(axis));
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  const out = new Float32Array(16);
  out[0] = t * a.x * a.x + c;
  out[1] = t * a.x * a.y + s * a.z;
  out[2] = t * a.x * a.z - s * a.y;
  out[4] = t * a.x * a.y - s * a.z;
  out[5] = t * a.y * a.y + c;
  out[6] = t * a.y * a.z + s * a.x;
  out[8] = t * a.x * a.z + s * a.y;
  out[9] = t * a.y * a.z - s * a.x;
  out[10] = t * a.z * a.z + c;
  out[15] = 1;
  return out;
}

// Post-multiply: m * translate(v). Mengembalikan matriks baru.
export function m4Translate(m, v) {
  return m4Multiply(m, m4Translation(v));
}

export function m4Scale(m, v) {
  return m4Multiply(m, m4Scaling(v));
}

export function m4RotateXM(m, angle) {
  return m4Multiply(m, m4RotateX(angle));
}

export function m4RotateYM(m, angle) {
  return m4Multiply(m, m4RotateY(angle));
}

export function m4RotateZM(m, angle) {
  return m4Multiply(m, m4RotateZ(angle));
}

// Matriks view ala gluLookAt.
// eye, target, up: OBJECT {x, y, z} (array [x,y,z] juga diterima).
// Kamera right-handed, melihat ke -Z. eye === target menghasilkan
// matriks yang aman (tidak NaN).
export function m4LookAt(eye, target, up) {
  const e = toVec3(eye);
  const t = toVec3(target);
  const u = toVec3(up, { x: 0, y: 1, z: 0 });

  let zAxis = v3Normalize(v3Sub(e, t)); // sumbu Z kamera = eye - target
  if (v3LengthSq(zAxis) < 1e-12) zAxis = { x: 0, y: 0, z: 1 };
  let xAxis = v3Normalize(v3Cross(u, zAxis));
  if (v3LengthSq(xAxis) < 1e-12) {
    // up sejajar dengan arah pandang — pakai sumbu cadangan
    xAxis = v3Normalize(v3Cross({ x: 1, y: 0, z: 0 }, zAxis));
  }
  const yAxis = v3Cross(zAxis, xAxis);

  const out = new Float32Array(16);
  out[0] = xAxis.x; out[1] = yAxis.x; out[2] = zAxis.x; out[3] = 0;
  out[4] = xAxis.y; out[5] = yAxis.y; out[6] = zAxis.y; out[7] = 0;
  out[8] = xAxis.z; out[9] = yAxis.z; out[10] = zAxis.z; out[11] = 0;
  out[12] = -v3Dot(xAxis, e);
  out[13] = -v3Dot(yAxis, e);
  out[14] = -v3Dot(zAxis, e);
  out[15] = 1;
  return out;
}

// Matriks TRS untuk menempatkan objek: translate * rotateY(yaw) * scale.
// Dipakai untuk bangunan, mobil, pohon, dll.
export function m4FromTRS(pos, yaw = 0, scale = 1) {
  const p = toVec3(pos);
  const s = typeof scale === 'number' ? { x: scale, y: scale, z: scale } : toVec3(scale);
  let m = m4Translation(p);
  if (yaw) m = m4Multiply(m, m4RotateY(yaw));
  if (s.x !== 1 || s.y !== 1 || s.z !== 1) m = m4Multiply(m, m4Scaling(s));
  return m;
}

// Transformasi satu titik {x,y,z} oleh matriks (dengan w = 1).
export function m4TransformPoint(m, p) {
  const q = toVec3(p);
  const x = m[0] * q.x + m[4] * q.y + m[8] * q.z + m[12];
  const y = m[1] * q.x + m[5] * q.y + m[9] * q.z + m[13];
  const z = m[2] * q.x + m[6] * q.y + m[10] * q.z + m[14];
  const w = m[3] * q.x + m[7] * q.y + m[11] * q.z + m[15];
  if (Math.abs(w) > 1e-8 && Math.abs(w - 1) > 1e-8) {
    return { x: x / w, y: y / w, z: z / w };
  }
  return { x, y, z };
}

// Transformasi arah (vektor, w = 0): tanpa translasi.
export function m4TransformDirection(m, p) {
  const q = toVec3(p);
  return {
    x: m[0] * q.x + m[4] * q.y + m[8] * q.z,
    y: m[1] * q.x + m[5] * q.y + m[9] * q.z,
    z: m[2] * q.x + m[6] * q.y + m[10] * q.z,
  };
}

export function m4Transpose(m) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) out[c * 4 + r] = m[r * 4 + c];
  }
  return out;
}

// Invers matriks 4x4 generik (algoritma adjugate). Mengembalikan null
// bila matriks singular.
export function m4Invert(m) {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(det) < 1e-12) return null;
  det = 1 / det;

  const out = new Float32Array(16);
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

// ---------------------------------------------------------------- util ----
export function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad) {
  return (rad * 180) / Math.PI;
}

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Lerp sudut dengan wrap-around -PI..PI (untuk heading kamera/mobil).
export function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// Faktor smoothing bebas frame-rate: 1 - exp(-rate * dt).
export function dampFactor(rate, dt) {
  return 1 - Math.exp(-rate * dt);
}

// Arah maju dari yaw (0 = -Z, putar searah jarum jam dari atas).
export function forwardFromYaw(yaw) {
  return { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) };
}

export function rightFromYaw(yaw) {
  return { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
}
