window.SB = window.SB || {};
// math3.js — Sunset Bay v12 (Builder B: graphics engine)
// Matematika 3D mandiri, tanpa library eksternal.
// Konvensi:
//  - vec3 adalah OBJECT {x, y, z} — BUKAN array. (Pelajaran bug v8:
//    mat4LookAt yang menerima array menghasilkan matriks nol dan
//    layar hanya menampilkan langit.)
//  - mat4 adalah Float32Array(16) column-major, konvensi WebGL.
//  - Semua fungsi mat4 mengembalikan matriks BARU kecuali yang
//    namanya berakhiran "Into" atau menerima matriks tujuan.
(function () {
  'use strict';

  // ------------------------------------------------------------------
  // Skalar
  // ------------------------------------------------------------------

  // Batasi v ke [a, b]. NaN dilewatkan sebagai a (fail-safe).
  function clamp(v, a, b) {
    if (typeof v !== 'number' || isNaN(v)) return a;
    if (v < a) return a;
    if (v > b) return b;
    return v;
  }

  // Interpolasi linear a -> b pada t (t tidak di-clamp di sini agar
  // pemanggil bisa memakai ekstrapolasi bila perlu).
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  // Interpolasi linear dengan t di-clamp ke [0, 1].
  function lerpClamped(a, b, t) {
    return lerp(a, b, clamp(t, 0, 1));
  }

  // Interpolasi sudut (radian) lewat jalur terpendek.
  function lerpAngle(a, b, t) {
    var d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * clamp(t, 0, 1);
  }

  // Smoothstep klasik 0..1.
  function smoothstep(edge0, edge1, x) {
    var t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  // Derajat <-> radian.
  function degToRad(d) { return d * Math.PI / 180; }
  function radToDeg(r) { return r * 180 / Math.PI; }

  // Perbedaan sudut terpendek, hasil di (-PI, PI].
  function angleDiff(a, b) {
    var d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d <= -Math.PI) d += Math.PI * 2;
    return d;
  }

  // Normalisasi sudut ke (-PI, PI].
  function wrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a <= -Math.PI) a += Math.PI * 2;
    return a;
  }

  // Jarak 2D (bidang XZ, yang dipakai gameplay) dan 3D.
  function dist2D(ax, az, bx, bz) {
    var dx = bx - ax, dz = bz - az;
    return Math.sqrt(dx * dx + dz * dz);
  }
  function dist3D(a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // ------------------------------------------------------------------
  // vec3 — object {x, y, z}
  // ------------------------------------------------------------------

  function vec3(x, y, z) {
    return { x: x || 0, y: y || 0, z: z || 0 };
  }

  function vec3Zero() { return { x: 0, y: 0, z: 0 }; }
  function vec3Up() { return { x: 0, y: 1, z: 0 }; }
  function vec3Forward() { return { x: 0, y: 0, z: -1 }; }

  // Salinan baru dari v. Gagal aman: input tak valid -> {0,0,0}.
  function vec3Copy(v) {
    if (!v || typeof v.x !== 'number') return vec3Zero();
    return { x: v.x, y: v.y, z: v.z };
  }

  // Pastikan sebuah nilai berbentuk vec3 object; terima juga array
  // [x, y, z] sebagai input toleran — TAPI internal game selalu
  // memakai object. Konversi ini hanya pengaman, bukan jalur utama.
  function vec3From(v) {
    if (!v) return vec3Zero();
    if (Array.isArray(v)) return { x: v[0] || 0, y: v[1] || 0, z: v[2] || 0 };
    return { x: v.x || 0, y: v.y || 0, z: v.z || 0 };
  }

  function vec3Add(a, b) {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
  }
  function vec3Sub(a, b) {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  }
  function vec3Scale(v, s) {
    return { x: v.x * s, y: v.y * s, z: v.z * s };
  }
  function vec3Neg(v) {
    return { x: -v.x, y: -v.y, z: -v.z };
  }

  function dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  function cross(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x
    };
  }

  function length(v) {
    return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  }

  function lengthSq(v) {
    return v.x * v.x + v.y * v.y + v.z * v.z;
  }

  // Normalisasi; vektor nol -> {0,0,0} (bukan NaN).
  function normalize(v) {
    var len = length(v);
    if (len < 1e-8) return vec3Zero();
    return { x: v.x / len, y: v.y / len, z: v.z / len };
  }

  function vec3Lerp(a, b, t) {
    return {
      x: lerp(a.x, b.x, t),
      y: lerp(a.y, b.y, t),
      z: lerp(a.z, b.z, t)
    };
  }

  // Jarak titik p ke segmen garis a-b (berguna untuk checkpoint balapan).
  function distPointSegment(p, a, b) {
    var ab = vec3Sub(b, a);
    var denom = dot(ab, ab);
    if (denom < 1e-8) return dist3D(p, a);
    var t = clamp(dot(vec3Sub(p, a), ab) / denom, 0, 1);
    var closest = { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t };
    return dist3D(p, closest);
  }

  // Vektor arah dari sudut yaw (radian) di bidang XZ.
  // yaw 0 -> menghadap -Z (konvensi kamera WebGL).
  function dirFromYaw(yaw) {
    return { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) };
  }

  // Yaw (radian) dari sebuah vektor arah di bidang XZ.
  function yawFromDir(dx, dz) {
    return Math.atan2(-dx, -dz);
  }

  // ------------------------------------------------------------------
  // mat4 — Float32Array(16), column-major (konvensi WebGL)
  //
  // Indeks (kolom c, baris r) -> m[c * 4 + r]:
  //   m[0]  m[4]  m[8]   m[12]
  //   m[1]  m[5]  m[9]   m[13]
  //   m[2]  m[6]  m[10]  m[14]
  //   m[3]  m[7]  m[11]  m[15]
  // ------------------------------------------------------------------

  function mat4Identity() {
    var m = new Float32Array(16);
    m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
    return m;
  }

  function mat4Copy(m) {
    return new Float32Array(m);
  }

  // Perkalian a * b (kolom-mayor). Urutan penting: hasil = a diterapkan
  // SETELAH b. Untuk transformasi model: M = T * R * S.
  function mat4Multiply(a, b) {
    var out = new Float32Array(16);
    var a00 = a[0],  a01 = a[1],  a02 = a[2],  a03 = a[3];
    var a10 = a[4],  a11 = a[5],  a12 = a[6],  a13 = a[7];
    var a20 = a[8],  a21 = a[9],  a22 = a[10], a23 = a[11];
    var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    var b00 = b[0],  b01 = b[1],  b02 = b[2],  b03 = b[3];
    var b10 = b[4],  b11 = b[5],  b12 = b[6],  b13 = b[7];
    var b20 = b[8],  b21 = b[9],  b22 = b[10], b23 = b[11];
    var b30 = b[12], b31 = b[13], b32 = b[14], b33 = b[15];
    out[0]  = a00 * b00 + a10 * b01 + a20 * b02 + a30 * b03;
    out[1]  = a01 * b00 + a11 * b01 + a21 * b02 + a31 * b03;
    out[2]  = a02 * b00 + a12 * b01 + a22 * b02 + a32 * b03;
    out[3]  = a03 * b00 + a13 * b01 + a23 * b02 + a33 * b03;
    out[4]  = a00 * b10 + a10 * b11 + a20 * b12 + a30 * b13;
    out[5]  = a01 * b10 + a11 * b11 + a21 * b12 + a31 * b13;
    out[6]  = a02 * b10 + a12 * b11 + a22 * b12 + a32 * b13;
    out[7]  = a03 * b10 + a13 * b11 + a23 * b12 + a33 * b13;
    out[8]  = a00 * b20 + a10 * b21 + a20 * b22 + a30 * b23;
    out[9]  = a01 * b20 + a11 * b21 + a21 * b22 + a31 * b23;
    out[10] = a02 * b20 + a12 * b21 + a22 * b22 + a32 * b23;
    out[11] = a03 * b20 + a13 * b21 + a23 * b22 + a33 * b23;
    out[12] = a00 * b30 + a10 * b31 + a20 * b32 + a30 * b33;
    out[13] = a01 * b30 + a11 * b31 + a21 * b32 + a31 * b33;
    out[14] = a02 * b30 + a12 * b31 + a22 * b32 + a32 * b33;
    out[15] = a03 * b30 + a13 * b31 + a23 * b32 + a33 * b33;
    return out;
  }

  // Matriks proyeksi perspektif. fov dalam radian (vertikal).
  function mat4Perspective(fov, aspect, near, far) {
    var m = new Float32Array(16);
    var f = 1.0 / Math.tan(fov / 2);
    var nf = 1 / (near - far);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = (far + near) * nf;
    m[11] = -1;
    m[14] = 2 * far * near * nf;
    return m;
  }

  // Matriks proyeksi ortografik (dipakai shadow map directional).
  function mat4Ortho(left, right, bottom, top, near, far) {
    var m = new Float32Array(16);
    var lr = 1 / (left - right);
    var bt = 1 / (bottom - top);
    var nf = 1 / (near - far);
    m[0] = -2 * lr;
    m[5] = -2 * bt;
    m[10] = 2 * nf;
    m[12] = (left + right) * lr;
    m[13] = (top + bottom) * bt;
    m[14] = (far + near) * nf;
    m[15] = 1;
    return m;
  }

  // Matriks view look-at.
  // eye, look, up WAJIB object {x, y, z} — BUKAN array.
  // Bug v8: pemakaian array membuat semua akses .x undefined,
  // cross/dot menghasilkan NaN, matriks view menjadi nol, dan
  // yang terlihat di layar hanya langit.
  function mat4LookAt(eye, look, up) {
    // Pengaman eksplisit: bila ada yang masih mengirim array,
    // konversi dulu daripada menghasilkan matriks rusak diam-diam.
    var e = vec3From(eye);
    var c = vec3From(look);
    var u = vec3From(up);
    if (length(u) < 1e-8) u = { x: 0, y: 1, z: 0 };

    var zAxis = normalize(vec3Sub(e, c));       // kamera menghadap -Z
    // Jika eye == look, zAxis nol -> fallback menghadap -Z dunia.
    if (lengthSq(zAxis) < 1e-8) zAxis = { x: 0, y: 0, z: 1 };
    var xAxis = normalize(cross(u, zAxis));
    if (lengthSq(xAxis) < 1e-8) xAxis = { x: 1, y: 0, z: 0 };
    var yAxis = cross(zAxis, xAxis);

    var m = new Float32Array(16);
    m[0] = xAxis.x; m[4] = xAxis.y; m[8]  = xAxis.z; m[12] = -dot(xAxis, e);
    m[1] = yAxis.x; m[5] = yAxis.y; m[9]  = yAxis.z; m[13] = -dot(yAxis, e);
    m[2] = zAxis.x; m[6] = zAxis.y; m[10] = zAxis.z; m[14] = -dot(zAxis, e);
    m[3] = 0;       m[7] = 0;       m[11] = 0;       m[15] = 1;
    return m;
  }

  // Translasi: mengembalikan m * T(x, y, z).
  function mat4Translate(m, x, y, z) {
    var t = mat4Identity();
    t[12] = x; t[13] = y; t[14] = z;
    return mat4Multiply(m, t);
  }

  // Skala: mengembalikan m * S(sx, sy, sz).
  function mat4Scale(m, sx, sy, sz) {
    var s = mat4Identity();
    s[0] = sx; s[5] = sy; s[10] = sz;
    return mat4Multiply(m, s);
  }

  // Skala seragam.
  function mat4ScaleUniform(m, s) {
    return mat4Scale(m, s, s, s);
  }

  // Rotasi sumbu X (radian): m * Rx(a).
  function mat4RotateX(m, a) {
    var c = Math.cos(a), s = Math.sin(a);
    var r = mat4Identity();
    r[5] = c;  r[6] = s;
    r[9] = -s; r[10] = c;
    return mat4Multiply(m, r);
  }

  // Rotasi sumbu Y (radian): m * Ry(a).
  function mat4RotateY(m, a) {
    var c = Math.cos(a), s = Math.sin(a);
    var r = mat4Identity();
    r[0] = c;  r[2] = -s;
    r[8] = s;  r[10] = c;
    return mat4Multiply(m, r);
  }

  // Rotasi sumbu Z (radian): m * Rz(a).
  function mat4RotateZ(m, a) {
    var c = Math.cos(a), s = Math.sin(a);
    var r = mat4Identity();
    r[0] = c;  r[1] = s;
    r[4] = -s; r[5] = c;
    return mat4Multiply(m, r);
  }

  // Rotasi di sekitar sumbu sembarang (axis object {x,y,z}, radian).
  function mat4RotateAxis(m, axis, a) {
    var n = normalize(vec3From(axis));
    var c = Math.cos(a), s = Math.sin(a), t = 1 - c;
    var x = n.x, y = n.y, z = n.z;
    var r = mat4Identity();
    r[0] = t * x * x + c;     r[4] = t * x * y - s * z; r[8]  = t * x * z + s * y;
    r[1] = t * x * y + s * z; r[5] = t * y * y + c;     r[9]  = t * y * z - s * x;
    r[2] = t * x * z - s * y; r[6] = t * y * z + s * x; r[10] = t * z * z + c;
    return mat4Multiply(m, r);
  }

  // Terapkan matriks ke sebuah titik vec3 (w = 1), kembalikan vec3 baru.
  function mat4TransformPoint(m, v) {
    var x = v.x, y = v.y, z = v.z;
    var w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (Math.abs(w) < 1e-8) w = 1;
    return {
      x: (m[0] * x + m[4] * y + m[8]  * z + m[12]) / w,
      y: (m[1] * x + m[5] * y + m[9]  * z + m[13]) / w,
      z: (m[2] * x + m[6] * y + m[10] * z + m[14]) / w
    };
  }

  // Terapkan matriks ke sebuah arah (w = 0, tanpa translasi).
  function mat4TransformDir(m, v) {
    return {
      x: m[0] * v.x + m[4] * v.y + m[8]  * v.z,
      y: m[1] * v.x + m[5] * v.y + m[9]  * v.z,
      z: m[2] * v.x + m[6] * v.y + m[10] * v.z
    };
  }

  // Matriks model lengkap dari posisi + yaw + skala seragam.
  // Dipakai hampir semua modul draw() untuk menaruh mesh di dunia.
  function mat4Model(x, y, z, yaw, scale) {
    var m = mat4Identity();
    m = mat4Translate(m, x, y, z);
    if (yaw) m = mat4RotateY(m, yaw);
    if (scale && scale !== 1) m = mat4ScaleUniform(m, scale);
    return m;
  }

  // Matriks model dengan skala non-seragam.
  function mat4ModelScale(x, y, z, yaw, sx, sy, sz) {
    var m = mat4Identity();
    m = mat4Translate(m, x, y, z);
    if (yaw) m = mat4RotateY(m, yaw);
    m = mat4Scale(m, sx, sy, sz);
    return m;
  }

  // Transpos matriks (berguna untuk normal matrix 3x3 bagian atas).
  function mat4Transpose(m) {
    var out = new Float32Array(16);
    for (var c = 0; c < 4; c++) {
      for (var r = 0; r < 4; r++) {
        out[c * 4 + r] = m[r * 4 + c];
      }
    }
    return out;
  }

  // Invers matriks 4x4 umum (algoritma adjugate). Mengembalikan
  // matriks identitas bila matriks singular.
  function mat4Inverse(m) {
    var a00 = m[0],  a01 = m[1],  a02 = m[2],  a03 = m[3];
    var a10 = m[4],  a11 = m[5],  a12 = m[6],  a13 = m[7];
    var a20 = m[8],  a21 = m[9],  a22 = m[10], a23 = m[11];
    var a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    var b00 = a00 * a11 - a01 * a10;
    var b01 = a00 * a12 - a02 * a10;
    var b02 = a00 * a13 - a03 * a10;
    var b03 = a01 * a12 - a02 * a11;
    var b04 = a01 * a13 - a03 * a11;
    var b05 = a02 * a13 - a03 * a12;
    var b06 = a20 * a31 - a21 * a30;
    var b07 = a20 * a32 - a22 * a30;
    var b08 = a20 * a33 - a23 * a30;
    var b09 = a21 * a32 - a22 * a31;
    var b10 = a21 * a33 - a23 * a31;
    var b11 = a22 * a33 - a23 * a32;
    var det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (Math.abs(det) < 1e-12) return mat4Identity();
    var invDet = 1 / det;
    var out = new Float32Array(16);
    out[0]  = (a11 * b11 - a12 * b10 + a13 * b09) * invDet;
    out[1]  = (a02 * b10 - a01 * b11 - a03 * b09) * invDet;
    out[2]  = (a31 * b05 - a32 * b04 + a33 * b03) * invDet;
    out[3]  = (a22 * b04 - a21 * b05 - a23 * b03) * invDet;
    out[4]  = (a12 * b08 - a10 * b11 - a13 * b07) * invDet;
    out[5]  = (a00 * b11 - a02 * b08 + a03 * b07) * invDet;
    out[6]  = (a32 * b02 - a30 * b05 - a33 * b01) * invDet;
    out[7]  = (a20 * b05 - a22 * b02 + a23 * b01) * invDet;
    out[8]  = (a10 * b10 - a11 * b08 + a13 * b06) * invDet;
    out[9]  = (a01 * b08 - a00 * b10 - a03 * b06) * invDet;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * invDet;
    out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * invDet;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * invDet;
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * invDet;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * invDet;
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * invDet;
    return out;
  }

  // ------------------------------------------------------------------
  // Warna (dipakai gl.js untuk tint / fog / emissive)
  // ------------------------------------------------------------------

  // Konversi hex "#rrggbb" -> [r, g, b] float 0..1.
  function hexToRgb(hex) {
    var h = String(hex || '#ffffff').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (isNaN(n)) return [1, 1, 1];
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  // Campur dua warna [r,g,b] dengan t 0..1.
  function mixColor(a, b, t) {
    t = clamp(t, 0, 1);
    return [
      lerp(a[0], b[0], t),
      lerp(a[1], b[1], t),
      lerp(a[2], b[2], t)
    ];
  }

  // ------------------------------------------------------------------
  // Ekspor namespace
  // ------------------------------------------------------------------
  window.SB.Math3 = {
    // skalar
    clamp: clamp, lerp: lerp, lerpClamped: lerpClamped,
    lerpAngle: lerpAngle, smoothstep: smoothstep,
    degToRad: degToRad, radToDeg: radToDeg,
    angleDiff: angleDiff, wrapAngle: wrapAngle,
    dist2D: dist2D, dist3D: dist3D,
    // vec3
    vec3: vec3, vec3Zero: vec3Zero, vec3Up: vec3Up,
    vec3Forward: vec3Forward, vec3Copy: vec3Copy,
    vec3From: vec3From, vec3Add: vec3Add, vec3Sub: vec3Sub,
    vec3Scale: vec3Scale, vec3Neg: vec3Neg,
    dot: dot, cross: cross, length: length, lengthSq: lengthSq,
    normalize: normalize, vec3Lerp: vec3Lerp,
    distPointSegment: distPointSegment,
    dirFromYaw: dirFromYaw, yawFromDir: yawFromDir,
    // mat4
    mat4Identity: mat4Identity, mat4Copy: mat4Copy,
    mat4Multiply: mat4Multiply, mat4Perspective: mat4Perspective,
    mat4Ortho: mat4Ortho, mat4LookAt: mat4LookAt,
    mat4Translate: mat4Translate, mat4Scale: mat4Scale,
    mat4ScaleUniform: mat4ScaleUniform,
    mat4RotateX: mat4RotateX, mat4RotateY: mat4RotateY,
    mat4RotateZ: mat4RotateZ, mat4RotateAxis: mat4RotateAxis,
    mat4TransformPoint: mat4TransformPoint,
    mat4TransformDir: mat4TransformDir,
    mat4Model: mat4Model, mat4ModelScale: mat4ModelScale,
    mat4Transpose: mat4Transpose, mat4Inverse: mat4Inverse,
    // warna
    hexToRgb: hexToRgb, mixColor: mixColor
  };
})();
