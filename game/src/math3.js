// Sunset Bay — math3: vektor 3D dan matriks 4x4 (column-major, array 16 angka).
(function () {
  var SB = window.SB = window.SB || {};

  function v3(x, y, z) { return [x || 0, y || 0, z || 0]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function len(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }
  function norm(a) {
    var l = len(a);
    return l > 0.000001 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
  }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
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
    // column-major: kolom 0 = (c,0,-s), kolom 2 = (s,0,c)
    return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
  }
  function mat4Mul(a, b) {
    // hasil = a * b, column-major: out[col*4+row] = sum_k a[k*4+row]*b[col*4+k]
    var o = new Array(16);
    for (var c = 0; c < 4; c++) {
      for (var r = 0; r < 4; r++) {
        var s = 0;
        for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
      }
    }
    return o;
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
    var z = norm(sub(eye, center));       // sumbu kamera menghadap -z
    var x = norm(cross(up, z));
    var y = cross(z, x);
    return [
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -dot(x, eye), -dot(y, eye), -dot(z, eye), 1
    ];
  }

  SB.Math3 = {
    v3: v3, add: add, sub: sub, scale: scale, len: len, norm: norm,
    dot: dot, cross: cross,
    mat4Identity: mat4Identity, mat4Translate: mat4Translate,
    mat4RotateY: mat4RotateY, mat4Mul: mat4Mul,
    mat4Perspective: mat4Perspective, mat4LookAt: mat4LookAt
  };
})();
