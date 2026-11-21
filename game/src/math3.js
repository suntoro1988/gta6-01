// Sunset Bay — math3.js (v9, ditulis ulang)
// Matematika 3D kecil untuk WebGL: vektor 3D sebagai objek {x,y,z} dan
// matriks 4x4 sebagai array 16 angka dalam urutan column-major (yang
// dipakai gl.uniformMatrix4fv). Tidak ada dependensi lain.
(function () {
  'use strict';
  window.SB = window.SB || {};

  // ---- vektor ----
  function vec(x, y, z) {
    return { x: x || 0, y: y || 0, z: z || 0 };
  }

  function vAdd(a, b) {
    return vec(a.x + b.x, a.y + b.y, a.z + b.z);
  }

  function vSub(a, b) {
    return vec(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  function vScale(a, s) {
    return vec(a.x * s, a.y * s, a.z * s);
  }

  function vLen(a) {
    return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
  }

  function vNorm(a) {
    var l = vLen(a);
    if (l === 0) return vec(0, 0, 0);
    return vec(a.x / l, a.y / l, a.z / l);
  }

  function vCross(a, b) {
    return vec(
      a.y * b.z - a.z * b.y,
      a.z * b.x - a.x * b.z,
      a.x * b.y - a.y * b.x
    );
  }

  function vDot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  // ---- matriks 4x4 (column-major) ----
  function identity() {
    return [1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1];
  }

  function translate(x, y, z) {
    var m = identity();
    m[12] = x;
    m[13] = y;
    m[14] = z;
    return m;
  }

  // Rotasi mengelilingi sumbu Y. Kolom-kolomnya:
  // col0 = (cos, 0, -sin), col1 = (0, 1, 0), col2 = (sin, 0, cos).
  function rotateY(angle) {
    var c = Math.cos(angle);
    var s = Math.sin(angle);
    return [c, 0, -s, 0,
            0, 1, 0, 0,
            s, 0, c, 0,
            0, 0, 0, 1];
  }

  // Perkalian matriks C = A * B. Elemen (baris r, kolom c) dihitung dari
  // baris r dari A dan kolom c dari B; dalam penyimpanan column-major
  // indeksnya adalah [kolom * 4 + baris].
  function mul(a, b) {
    var out = new Array(16);
    for (var col = 0; col < 4; col++) {
      for (var row = 0; row < 4; row++) {
        var acc = 0;
        for (var k = 0; k < 4; k++) {
          acc += a[k * 4 + row] * b[col * 4 + k];
        }
        out[col * 4 + row] = acc;
      }
    }
    return out;
  }

  // Proyeksi perspektif. fov dalam radian.
  function perspective(fov, aspect, near, far) {
    var f = 1 / Math.tan(fov / 2);
    var nf = 1 / (near - far);
    return [
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0
    ];
  }

  // Matriks view dari posisi kamera, titik yang dilihat, dan arah atas.
  // Sumbu kamera: z = arah dari target ke mata (mundur), x = up x z,
  // y = z x x; translasi = -dot(sumbu, mata).
  function lookAt(eye, center, up) {
    var zAxis = vNorm(vSub(eye, center));
    var xAxis = vNorm(vCross(up, zAxis));
    var yAxis = vCross(zAxis, xAxis);
    return [
      xAxis.x, yAxis.x, zAxis.x, 0,
      xAxis.y, yAxis.y, zAxis.y, 0,
      xAxis.z, yAxis.z, zAxis.z, 0,
      -vDot(xAxis, eye), -vDot(yAxis, eye), -vDot(zAxis, eye), 1
    ];
  }

  window.SB.Math3 = {
    v3: vec,
    add: vAdd,
    sub: vSub,
    scale: vScale,
    len: vLen,
    norm: vNorm,
    cross: vCross,
    dot: vDot,
    mat4Identity: identity,
    mat4Translate: translate,
    mat4RotateY: rotateY,
    mat4Mul: mul,
    mat4Perspective: perspective,
    mat4LookAt: lookAt
  };
})();
