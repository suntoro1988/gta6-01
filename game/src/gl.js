// Sunset Bay v8 — gl.js
// Lapisan WebGL tipis: shader warna-per-vertex + fog linear (uniform vec2).
(function () {
  'use strict';
  window.SB = window.SB || {};

  var gl = null;
  var prog = null;
  var loc = {};
  var proj = null;   // matriks proyeksi (array 16)
  var view = null;   // matriks view (array 16)
  var fogNear = 60, fogFar = 220;
  var clearCol = [0.10, 0.12, 0.22];

  var VS =
    'attribute vec3 aPos;\n' +
    'attribute vec3 aCol;\n' +
    'uniform mat4 uMVP;\n' +
    'varying vec3 vCol;\n' +
    'varying float vDepth;\n' +
    'void main() {\n' +
    '  vec4 p = uMVP * vec4(aPos, 1.0);\n' +
    '  gl_Position = p;\n' +
    '  vCol = aCol;\n' +
    '  vDepth = -p.z;\n' +
    '}\n';

  var FS =
    'precision mediump float;\n' +
    'varying vec3 vCol;\n' +
    'varying float vDepth;\n' +
    'uniform vec2 uFog;\n' +
    'void main() {\n' +
    '  float f = clamp((vDepth - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);\n' +
    '  vec3 fogCol = vec3(0.55, 0.62, 0.75);\n' +
    '  gl_FragColor = vec4(mix(vCol, fogCol, f), 1.0);\n' +
    '}\n';

  function compile(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error('shader compile: ' + gl.getShaderInfoLog(sh));
    }
    return sh;
  }

  function init(canvas) {
    gl = canvas.getContext('webgl', { antialias: true }) ||
         canvas.getContext('experimental-webgl');
    if (!gl) throw new Error('WebGL tidak tersedia');
    var M = window.SB.Math3;
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('program link: ' + gl.getProgramInfoLog(prog));
    }
    gl.useProgram(prog);
    loc.aPos = gl.getAttribLocation(prog, 'aPos');
    loc.aCol = gl.getAttribLocation(prog, 'aCol');
    loc.uMVP = gl.getUniformLocation(prog, 'uMVP');
    loc.uFog = gl.getUniformLocation(prog, 'uFog');
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    resize(canvas);
    view = M.mat4Identity();
    setFog(fogNear, fogFar);
    return gl;
  }

  function resize(canvas) {
    var M = window.SB.Math3;
    var w = canvas.clientWidth || canvas.width;
    var h = canvas.clientHeight || canvas.height;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    proj = M.mat4Perspective(1.05, canvas.width / canvas.height, 0.1, 600);
  }

  function clear(r, g, b) {
    clearCol = [r, g, b];
    gl.clearColor(r, g, b, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  // positions/colors: Float32Array (atau array angka). Kembalikan mesh buffer.
  function mesh(positions, colors) {
    var posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
    var colBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);
    var count = (positions.length / 3) | 0;
    return { posBuf: posBuf, colBuf: colBuf, count: count, _pos: positions, _col: colors };
  }

  // matrix: matriks model (array 16). opts: {wireframe?} (diabaikan, reserved)
  function draw(m, matrix) {
    var M = window.SB.Math3;
    var mvp = M.mat4Mul(proj, M.mat4Mul(view, matrix || M.mat4Identity()));
    gl.uniformMatrix4fv(loc.uMVP, false, new Float32Array(mvp));
    gl.bindBuffer(gl.ARRAY_BUFFER, m.posBuf);
    gl.enableVertexAttribArray(loc.aPos);
    gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.colBuf);
    gl.enableVertexAttribArray(loc.aCol);
    gl.vertexAttribPointer(loc.aCol, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, m.count);
  }

  function setCamera(eye, center) {
    var M = window.SB.Math3;
    view = M.mat4LookAt(eye, center, M.v3(0, 1, 0));
  }

  function setFog(near, far) {
    fogNear = near; fogFar = far;
    if (gl && loc.uFog) gl.uniform2f(loc.uFog, near, far);
  }

  function alive() {
    return !!gl && !gl.isContextLost();
  }

  window.SB.GL = {
    init: init, clear: clear, mesh: mesh, draw: draw,
    setCamera: setCamera, setFog: setFog, alive: alive,
    get ctx() { return gl; }
  };
})();
