// Sunset Bay v8 — math3.js
// Vector + matriks 4x4 (column-major, array 16 angka) untuk WebGL.
(function () {
  'use strict';
  window.SB = window.SB || {};

  function v3(x, y, z) { return { x: x || 0, y: y || 0, z: z || 0 }; }
  function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
  function scale(a, s) { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
  function len(a) { return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z); }
  function norm(a) {
    var l = len(a);
    if (l === 0) return { x: 0, y: 0, z: 0 };
    return { x: a.x / l, y: a.y / l, z: a.z / l };
  }

  function mat4Identity() {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  }

  function mat4Translate(x, y, z) {
    var m = mat4Identity();
    m[12] = x; m[13] = y; m[14] = z;
    return m;
  }

  function mat4RotateY(a) {
    var c = Math.cos(a), s = Math.sin(a);
    // column-major: col0=(c,0,-s), col1=(0,1,0), col2=(s,0,c)
    return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
  }

  // C = A * B, column-major: c[col*4+row] = sum_k a[k*4+row] * b[col*4+k]
  function mat4Mul(a, b) {
    var out = new Array(16);
    var r, c, k, sum;
    for (c = 0; c < 4; c++) {
      for (r = 0; r < 4; r++) {
        sum = 0;
        for (k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
        out[c * 4 + r] = sum;
      }
    }
    return out;
  }

  function mat4Perspective(fov, aspect, near, far) {
    var f = 1 / Math.tan(fov / 2);
    var nf = 1 / (near - far);
    return [
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0
    ];
  }

  function mat4LookAt(eye, center, up) {
    var z = norm(sub(eye, center)); // sumbu mundur kamera
    var x = norm({
      x: up.y * z.z - up.z * z.y,
      y: up.z * z.x - up.x * z.z,
      z: up.x * z.y - up.y * z.x
    });
    var y = {
      x: z.y * x.z - z.z * x.y,
      y: z.z * x.x - z.x * x.z,
      z: z.x * x.y - z.y * x.x
    };
    var tx = -(x.x * eye.x + x.y * eye.y + x.z * eye.z);
    var ty = -(y.x * eye.x + y.y * eye.y + y.z * eye.z);
    var tz = -(z.x * eye.x + z.y * eye.y + z.z * eye.z);
    // kolom: sumbu-x, sumbu-y, sumbu-z, translasi
    return [
      x.x, y.x, z.x, 0,
      x.y, y.y, z.y, 0,
      x.z, y.z, z.z, 0,
      tx, ty, tz, 1
    ];
  }

  window.SB.Math3 = {
    v3: v3, add: add, sub: sub, scale: scale, len: len, norm: norm,
    mat4Identity: mat4Identity,
    mat4Translate: mat4Translate,
    mat4RotateY: mat4RotateY,
    mat4Mul: mat4Mul,
    mat4Perspective: mat4Perspective,
    mat4LookAt: mat4LookAt
  };
})();
