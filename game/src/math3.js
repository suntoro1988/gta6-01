window.SB = window.SB || {};
(function(){ 'use strict';
// ============================================================================
// SB.Math3 — matematika 3D untuk Sunset Bay (game open-world GTA-like)
// Semua vektor adalah OBJECT {x, y, z} (bukan array) — pelajaran bug v8:
// mat4LookAt(eye, look, up) menerima object, dan vec3 mengembalikan object.
// Matriks adalah Float32Array(16) column-major, sesuai konvensi WebGL.
// File ini murni matematika: tidak ada DOM, tidak ada WebGL, tidak ada I/O.
// ============================================================================

var EPSILON = 0.000001;
var PI = Math.PI;
var TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Vektor 3D
// ---------------------------------------------------------------------------

// Membuat vektor {x, y, z}. Argumen yang hilang default 0.
function vec3(x, y, z) {
  return {
    x: (typeof x === 'number' && isFinite(x)) ? x : 0,
    y: (typeof y === 'number' && isFinite(y)) ? y : 0,
    z: (typeof z === 'number' && isFinite(z)) ? z : 0
  };
}

// Salinan vektor (tidak mengubah aslinya).
function vec3Clone(v) {
  if (!v) { return vec3(0, 0, 0); }
  return vec3(v.x || 0, v.y || 0, v.z || 0);
}

// Vektor nol.
function vec3Zero() {
  return vec3(0, 0, 0);
}

// Vektor dari a menuju b: b - a.
function vec3FromTo(a, b) {
  return vec3((b.x || 0) - (a.x || 0), (b.y || 0) - (a.y || 0), (b.z || 0) - (a.z || 0));
}


// a + b (vektor baru).
function vec3Add(a, b) {
  return vec3((a.x || 0) + (b.x || 0), (a.y || 0) + (b.y || 0), (a.z || 0) + (b.z || 0));
}

// a - b (vektor baru).
function vec3Sub(a, b) {
  return vec3((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0), (a.z || 0) - (b.z || 0));
}

// a * s (skalar).
function vec3Scale(a, s) {
  return vec3((a.x || 0) * s, (a.y || 0) * s, (a.z || 0) * s);
}


// Negasi vektor.
function vec3Negate(a) {
  return vec3(-(a.x || 0), -(a.y || 0), -(a.z || 0));
}

// Dot product a . b.
function vec3Dot(a, b) {
  return (a.x || 0) * (b.x || 0) + (a.y || 0) * (b.y || 0) + (a.z || 0) * (b.z || 0);
}

// Cross product a x b.
function vec3Cross(a, b) {
  var ax = a.x || 0, ay = a.y || 0, az = a.z || 0;
  var bx = b.x || 0, by = b.y || 0, bz = b.z || 0;
  return vec3(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
}

// Panjang (magnitude) vektor.
function vec3Length(a) {
  var x = a.x || 0, y = a.y || 0, z = a.z || 0;
  return Math.sqrt(x * x + y * y + z * z);
}

// Kuadrat panjang (lebih murah bila hanya untuk perbandingan).
function vec3LengthSq(a) {
  var x = a.x || 0, y = a.y || 0, z = a.z || 0;
  return x * x + y * y + z * z;
}

// Jarak antara a dan b.
function vec3Distance(a, b) {
  return vec3Length(vec3Sub(a, b));
}

// Kuadrat jarak antara a dan b.
function vec3DistanceSq(a, b) {
  return vec3LengthSq(vec3Sub(a, b));
}

// Normalisasi: vektor satuan searah a. Vektor nol tetap nol.
function vec3Normalize(a) {
  var len = vec3Length(a);
  if (len < EPSILON) { return vec3(0, 0, 0); }
  return vec3Scale(a, 1 / len);
}

// Interpolasi linear antar vektor: a + (b - a) * t.
function vec3Lerp(a, b, t) {
  var tt = clamp(t, 0, 1);
  return vec3(
    (a.x || 0) + ((b.x || 0) - (a.x || 0)) * tt,
    (a.y || 0) + ((b.y || 0) - (a.y || 0)) * tt,
    (a.z || 0) + ((b.z || 0) - (a.z || 0)) * tt
  );
}





// Arah dari yaw (radian, 0 = menghadap -Z) menjadi vektor depan di bidang XZ.
function vec3FromYaw(yaw) {
  return vec3(-Math.sin(yaw), 0, -Math.cos(yaw));
}

// Yaw (radian) dari sebuah vektor arah di bidang XZ.
function yawFromVec3(v) {
  return Math.atan2(-(v.x || 0), -(v.z || 0));
}

// ---------------------------------------------------------------------------
// Skalar: clamp & lerp (bagian dari API wajib SB.Math3)
// ---------------------------------------------------------------------------

// Batasi v ke rentang [a, b]. Bila a > b, batas ditukar dulu.
function clamp(v, a, b) {
  var lo = a, hi = b;
  if (lo > hi) { var tmp = lo; lo = hi; hi = tmp; }
  if (v < lo) { return lo; }
  if (v > hi) { return hi; }
  return v;
}

// Interpolasi linear skalar: a + (b - a) * t.
function lerp(a, b, t) {
  return a + (b - a) * t;
}




// Selisih sudut terpendek (radian) antara a dan b, dalam (-PI, PI].
function angleDelta(a, b) {
  var d = (b - a) % TAU;
  if (d > PI) { d -= TAU; }
  if (d <= -PI) { d += TAU; }
  return d;
}

// Interpolasi sudut mengikuti jalur terpendek.
function lerpAngle(a, b, t) {
  return a + angleDelta(a, b) * clamp(t, 0, 1);
}

// Derajat ke radian dan sebaliknya.
function degToRad(deg) { return deg * PI / 180; }
function radToDeg(rad) { return rad * 180 / PI; }

// Bungkus sudut ke rentang [0, TAU).
function wrapAngle(a) {
  var r = a % TAU;
  if (r < 0) { r += TAU; }
  return r;
}

// ---------------------------------------------------------------------------
// Matriks 4x4 (Float32Array(16), column-major — konvensi WebGL / gl-matrix)
// Indeks: m[col * 4 + row].
// ---------------------------------------------------------------------------

// Matriks identitas 4x4.
function mat4Identity() {
  var m = new Float32Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  return m;
}

// Salinan matriks.
function mat4Clone(m) {
  var out = new Float32Array(16);
  for (var i = 0; i < 16; i++) { out[i] = m[i]; }
  return out;
}

// Matriks perspektif. fov dalam radian, aspect = lebar/tinggi.
function mat4Perspective(fov, aspect, near, far) {
  var m = new Float32Array(16);
  var f = 1 / Math.tan(fov / 2);
  var nf = 1 / (near - far);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  m[15] = 0;
  return m;
}

// Matriks ortografik (dipakai untuk bayangan / shadow map).
function mat4Ortho(left, right, bottom, top, near, far) {
  var m = new Float32Array(16);
  var lr = 1 / (right - left);
  var bt = 1 / (top - bottom);
  var nf = 1 / (far - near);
  m[0] = 2 * lr;
  m[5] = 2 * bt;
  m[10] = -2 * nf;
  m[12] = -(right + left) * lr;
  m[13] = -(top + bottom) * bt;
  m[14] = -(far + near) * nf;
  m[15] = 1;
  return m;
}

// Matriks look-at. eye, look (target), up adalah OBJECT {x, y, z}.
// BUKAN array — pelajaran bug v8: pemanggil mengirim object, jadi di sini
// kita membaca .x/.y/.z dan TIDAK pernah mengindeks [0]/[1]/[2].
function mat4LookAt(eye, look, up) {
  var ex = eye.x || 0, ey = eye.y || 0, ez = eye.z || 0;
  var lx = look.x || 0, ly = look.y || 0, lz = look.z || 0;
  var ux = (up && typeof up.x === 'number') ? up.x : 0;
  var uy = (up && typeof up.y === 'number') ? up.y : 1;
  var uz = (up && typeof up.z === 'number') ? up.z : 0;
  // Sumbu Z kamera = eye - look (menjauhi target), dinormalisasi.
  var zx = ex - lx, zy = ey - ly, zz = ez - lz;
  var zl = Math.sqrt(zx * zx + zy * zy + zz * zz);
  if (zl < EPSILON) { zx = 0; zy = 0; zz = 1; zl = 1; }
  zx /= zl; zy /= zl; zz /= zl;
  // Sumbu X = up x Z.
  var xx = uy * zz - uz * zy, xy = uz * zx - ux * zz, xz = ux * zy - uy * zx;
  var xl = Math.sqrt(xx * xx + xy * xy + xz * xz);
  if (xl < EPSILON) { xx = 1; xy = 0; xz = 0; xl = 1; }
  xx /= xl; xy /= xl; xz /= xl;
  // Sumbu Y = Z x X.
  var yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  var m = new Float32Array(16);
  m[0] = xx; m[1] = yx; m[2] = zx; m[3] = 0;
  m[4] = xy; m[5] = yy; m[6] = zy; m[7] = 0;
  m[8] = xz; m[9] = yz; m[10] = zz; m[11] = 0;
  m[12] = -(xx * ex + xy * ey + xz * ez);
  m[13] = -(yx * ex + yy * ey + yz * ez);
  m[14] = -(zx * ex + zy * ey + zz * ez);
  m[15] = 1;
  return m;
}

// Perkalian matriks: out = a * b (column-major, vektor kolom).
function mat4Multiply(a, b) {
  var out = new Float32Array(16);
  var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  var b0, b1, b2, b3;
  b0 = b[0]; b1 = b[1]; b2 = b[2]; b3 = b[3];
  out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
  out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
  out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
  out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  return out;
}

// Translasi: out = m * T(x, y, z) (matriks baru, m tidak diubah).
function mat4Translate(m, x, y, z) {
  var out = mat4Clone(m);
  out[12] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[13] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[14] = m[2] * x + m[6] * y + m[10] * z + m[14];
  out[15] = m[3] * x + m[7] * y + m[11] * z + m[15];
  return out;
}

// Rotasi terhadap sumbu Y: out = m * Ry(a).
function mat4RotateY(m, a) {
  var s = Math.sin(a), c = Math.cos(a);
  var out = mat4Clone(m);
  var m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3];
  var m8 = m[8], m9 = m[9], m10 = m[10], m11 = m[11];
  out[0] = m0 * c - m8 * s;
  out[1] = m1 * c - m9 * s;
  out[2] = m2 * c - m10 * s;
  out[3] = m3 * c - m11 * s;
  out[8] = m0 * s + m8 * c;
  out[9] = m1 * s + m9 * c;
  out[10] = m2 * s + m10 * c;
  out[11] = m3 * s + m11 * c;
  return out;
}

// Rotasi terhadap sumbu X: out = m * Rx(a).
function mat4RotateX(m, a) {
  var s = Math.sin(a), c = Math.cos(a);
  var out = mat4Clone(m);
  var m4 = m[4], m5 = m[5], m6 = m[6], m7 = m[7];
  var m8 = m[8], m9 = m[9], m10 = m[10], m11 = m[11];
  out[4] = m4 * c + m8 * s;
  out[5] = m5 * c + m9 * s;
  out[6] = m6 * c + m10 * s;
  out[7] = m7 * c + m11 * s;
  out[8] = m8 * c - m4 * s;
  out[9] = m9 * c - m5 * s;
  out[10] = m10 * c - m6 * s;
  out[11] = m11 * c - m7 * s;
  return out;
}

// Rotasi terhadap sumbu Z: out = m * Rz(a).
function mat4RotateZ(m, a) {
  var s = Math.sin(a), c = Math.cos(a);
  var out = mat4Clone(m);
  var m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3];
  var m4 = m[4], m5 = m[5], m6 = m[6], m7 = m[7];
  out[0] = m0 * c + m4 * s;
  out[1] = m1 * c + m5 * s;
  out[2] = m2 * c + m6 * s;
  out[3] = m3 * c + m7 * s;
  out[4] = m4 * c - m0 * s;
  out[5] = m5 * c - m1 * s;
  out[6] = m6 * c - m2 * s;
  out[7] = m7 * c - m3 * s;
  return out;
}

// Skala: out = m * S(x, y, z).
function mat4Scale(m, x, y, z) {
  var out = mat4Clone(m);
  out[0] = m[0] * x; out[1] = m[1] * x; out[2] = m[2] * x; out[3] = m[3] * x;
  out[4] = m[4] * y; out[5] = m[5] * y; out[6] = m[6] * y; out[7] = m[7] * y;
  out[8] = m[8] * z; out[9] = m[9] * z; out[10] = m[10] * z; out[11] = m[11] * z;
  return out;
}

// Matriks model dari posisi + yaw + skala seragam (pola paling umum di game).
function mat4FromPosYaw(pos, yaw, scale) {
  var s = (typeof scale === 'number' && scale > 0) ? scale : 1;
  var m = mat4Identity();
  m = mat4Translate(m, pos.x || 0, pos.y || 0, pos.z || 0);
  m = mat4RotateY(m, yaw || 0);
  if (s !== 1) { m = mat4Scale(m, s, s, s); }
  return m;
}

// Matriks model dari posisi + yaw + skala per sumbu.
function mat4FromPosYawScale(pos, yaw, sx, sy, sz) {
  var m = mat4Identity();
  m = mat4Translate(m, pos.x || 0, pos.y || 0, pos.z || 0);
  m = mat4RotateY(m, yaw || 0);
  m = mat4Scale(m, sx || 1, sy || 1, sz || 1);
  return m;
}


// Transformasi titik (x, y, z, w=1) oleh matriks -> object {x, y, z}.
function mat4TransformPoint(m, v) {
  var x = v.x || 0, y = v.y || 0, z = v.z || 0;
  var w = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (Math.abs(w) < EPSILON) { w = 1; }
  return vec3(
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w
  );
}

// Transformasi arah (w=0, tanpa translasi) oleh matriks -> object {x, y, z}.
function mat4TransformDirection(m, v) {
  var x = v.x || 0, y = v.y || 0, z = v.z || 0;
  return vec3(
    m[0] * x + m[4] * y + m[8] * z,
    m[1] * x + m[5] * y + m[9] * z,
    m[2] * x + m[6] * y + m[10] * z
  );
}

// Invers matriks 4x4 umum. Bila singular, kembalikan identitas.
function mat4Invert(m) {
  var a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  var a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  var a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  var a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  var b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
  var b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  var b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  var b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  var b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
  var b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  var det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(det) < EPSILON) { return mat4Identity(); }
  var inv = 1 / det;
  var out = new Float32Array(16);
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * inv;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * inv;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * inv;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * inv;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * inv;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * inv;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * inv;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * inv;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * inv;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * inv;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * inv;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * inv;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * inv;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * inv;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * inv;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * inv;
  return out;
}


// ---------------------------------------------------------------------------
// Warna (dipakai renderer + HUD): [r, g, b] 0..1 dan hex.
// ---------------------------------------------------------------------------





// ---------------------------------------------------------------------------
// Util acak deterministik ringan (bukan pengganti SB.Rng — hanya helper math).
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// Ekspor API
// ---------------------------------------------------------------------------
window.SB.Math3 = {
  vec3: vec3, vec3Clone: vec3Clone, vec3Zero: vec3Zero,
  vec3FromTo: vec3FromTo, vec3Add: vec3Add, vec3Sub: vec3Sub,
  vec3Scale: vec3Scale, vec3Negate: vec3Negate,
  vec3Dot: vec3Dot, vec3Cross: vec3Cross, vec3Length: vec3Length,
  vec3LengthSq: vec3LengthSq, vec3Distance: vec3Distance,
  vec3DistanceSq: vec3DistanceSq, vec3Normalize: vec3Normalize,
  vec3Lerp: vec3Lerp,
  vec3FromYaw: vec3FromYaw, yawFromVec3: yawFromVec3,
  mat4Identity: mat4Identity, mat4Clone: mat4Clone,
  mat4Perspective: mat4Perspective, mat4Ortho: mat4Ortho,
  mat4LookAt: mat4LookAt, mat4Multiply: mat4Multiply,
  mat4Translate: mat4Translate, mat4RotateY: mat4RotateY,
  mat4RotateX: mat4RotateX, mat4RotateZ: mat4RotateZ,
  mat4Scale: mat4Scale, mat4FromPosYaw: mat4FromPosYaw,
  mat4FromPosYawScale: mat4FromPosYawScale,
  mat4TransformPoint: mat4TransformPoint,
  mat4TransformDirection: mat4TransformDirection,
  mat4Invert: mat4Invert,
  clamp: clamp, lerp: lerp,
  angleDelta: angleDelta, lerpAngle: lerpAngle,
  degToRad: degToRad, radToDeg: radToDeg, wrapAngle: wrapAngle,
  EPSILON: EPSILON, PI: PI, TAU: TAU
};
})();
