// Sunset Bay — math3.js
// Library matematika 3D murni untuk Sunset Bay (v10, ditulis dari nol).
// Konvensi keras: SEMUA vektor adalah objek {x, y, z}, BUKAN array.
// mat4LookAt(eye, look, up) menerima objek {x,y,z} — memakai array akan
// menghasilkan matriks view nol dan dunia hanya terrender langit (bug v8).
// Matriks disimpan sebagai Float32Array(16) column-major (gaya WebGL).

const SB = (typeof window !== 'undefined' ? (window.SB = window.SB || {}) : (globalThis.SB = globalThis.SB || {}));

function vec3(x = 0, y = 0, z = 0) {
  return { x, y, z };
}

function vec3Add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function vec3Sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function vec3Scale(a, s) {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function vec3Dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function vec3Cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function vec3Length(a) {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

function vec3Normalize(a) {
  const len = vec3Length(a);
  if (len === 0) return { x: 0, y: 0, z: 0 };
  return { x: a.x / len, y: a.y / len, z: a.z / len };
}

function vec3Distance(a, b) {
  return vec3Length(vec3Sub(a, b));
}

function vec3Lerp(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

function radToDeg(rad) {
  return (rad * 180) / Math.PI;
}

// ---- mat4 (Float32Array 16, column-major) ----

function mat4Identity() {
  const m = new Float32Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  return m;
}

function mat4Multiply(a, b) {
  // Mengembalikan a * b (column-major). out[c*4+r] = sum_k a[k*4+r] * b[c*4+k]
  const out = new Float32Array(16);
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

function mat4Perspective(fovyRad, aspect, near, far) {
  const f = 1.0 / Math.tan(fovyRad / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

function mat4LookAt(eye, look, up) {
  // KRITIS: eye, look, up adalah OBJEK {x,y,z}. Jangan passing array.
  // zAxis = normalize(eye - look); xAxis = normalize(cross(up, zAxis));
  // yAxis = cross(zAxis, xAxis). Matriks view column-major.
  const zAxis = vec3Normalize(vec3Sub(eye, look));
  const xAxis = vec3Normalize(vec3Cross(up, zAxis));
  const yAxis = vec3Cross(zAxis, xAxis);
  const m = new Float32Array(16);
  m[0] = xAxis.x; m[1] = yAxis.x; m[2] = zAxis.x; m[3] = 0;
  m[4] = xAxis.y; m[5] = yAxis.y; m[6] = zAxis.y; m[7] = 0;
  m[8] = xAxis.z; m[9] = yAxis.z; m[10] = zAxis.z; m[11] = 0;
  m[12] = -vec3Dot(xAxis, eye);
  m[13] = -vec3Dot(yAxis, eye);
  m[14] = -vec3Dot(zAxis, eye);
  m[15] = 1;
  return m;
}

function mat4Translate(x, y, z) {
  const m = mat4Identity();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

function mat4TranslateVec(v) {
  return mat4Translate(v.x, v.y, v.z);
}

function mat4RotateY(angleRad) {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const m = mat4Identity();
  m[0] = c; m[2] = -s;
  m[8] = s; m[10] = c;
  return m;
}

function mat4RotateX(angleRad) {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const m = mat4Identity();
  m[5] = c; m[6] = s;
  m[9] = -s; m[10] = c;
  return m;
}

function mat4RotateZ(angleRad) {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const m = mat4Identity();
  m[0] = c; m[1] = s;
  m[4] = -s; m[5] = c;
  return m;
}

function mat4Scale(x, y, z) {
  const m = mat4Identity();
  m[0] = x; m[5] = y; m[10] = z;
  return m;
}

function mat4ScaleVec(v) {
  return mat4Scale(v.x, v.y, v.z);
}

function mat4TransformPoint(m, p) {
  // p adalah objek {x,y,z}; kembalikan objek {x,y,z} hasil m * [p,1].
  return {
    x: m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12],
    y: m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13],
    z: m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14],
  };
}

const Math3 = {
  vec3,
  vec3Add,
  vec3Sub,
  vec3Scale,
  vec3Dot,
  vec3Cross,
  vec3Length,
  vec3Normalize,
  vec3Distance,
  vec3Lerp,
  clamp,
  lerp,
  degToRad,
  radToDeg,
  mat4Identity,
  mat4Multiply,
  mat4Perspective,
  mat4LookAt,
  mat4Translate,
  mat4TranslateVec,
  mat4RotateY,
  mat4RotateX,
  mat4RotateZ,
  mat4Scale,
  mat4ScaleVec,
  mat4TransformPoint,
};

SB.Math3 = Math3;

export { Math3, vec3, vec3Add, vec3Sub, vec3Scale, vec3Dot, vec3Cross, vec3Length, vec3Normalize, vec3Distance, vec3Lerp, clamp, lerp, degToRad, radToDeg, mat4Identity, mat4Multiply, mat4Perspective, mat4LookAt, mat4Translate, mat4TranslateVec, mat4RotateY, mat4RotateX, mat4RotateZ, mat4Scale, mat4ScaleVec, mat4TransformPoint };
export default Math3;
