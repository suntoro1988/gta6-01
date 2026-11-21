// Sunset Bay — gl.js (v9, ditulis ulang)
// Lapisan tipis di atas WebGL: satu program shader warna-per-vertex
// dengan fog linear, plus helper membuat buffer mesh dan menggambarnya.
//
// ATURAN PENTING: GL.draw() hanya menerima mesh yang sudah diproses
// lewat GL.mesh() (objek berisi posBuf/colBuf/count). Mesh mentah
// {pos, col} dari SB.Meshes TIDAK BOLEH dilempar ke draw() — draw()
// akan melempar error yang jelas bila itu terjadi, alih-alih gagal
// diam-diam tiap frame.
(function () {
  'use strict';
  window.SB = window.SB || {};

  var ctx = null;
  var program = null;
  var attrib = {};
  var uniform = {};
  var projMat = null;
  var viewMat = null;
  var fogRange = { near: 60, far: 220 };

  // Vertex: posisi + warna diteruskan ke fragment, kedalaman (view-space)
  // dipakai untuk fog.
  var VERT_SRC = [
    'attribute vec3 aPos;',
    'attribute vec3 aCol;',
    'uniform mat4 uMVP;',
    'varying vec3 vCol;',
    'varying float vDepth;',
    'void main() {',
    '  vec4 p = uMVP * vec4(aPos, 1.0);',
    '  gl_Position = p;',
    '  vCol = aCol;',
    '  vDepth = -p.z;',
    '}'
  ].join('\n');

  // Fragment: campur warna vertex dengan warna kabut berdasarkan jarak.
  var FRAG_SRC = [
    'precision mediump float;',
    'varying vec3 vCol;',
    'varying float vDepth;',
    'uniform vec2 uFog;',
    'void main() {',
    '  float f = clamp((vDepth - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);',
    '  vec3 fogCol = vec3(0.55, 0.62, 0.75);',
    '  gl_FragColor = vec4(mix(vCol, fogCol, f), 1.0);',
    '}'
  ].join('\n');

  function compileShader(kind, source) {
    var shader = ctx.createShader(kind);
    ctx.shaderSource(shader, source);
    ctx.compileShader(shader);
    if (!ctx.getShaderParameter(shader, ctx.COMPILE_STATUS)) {
      throw new Error('shader compile: ' + ctx.getShaderInfoLog(shader));
    }
    return shader;
  }

  function linkProgram() {
    var p = ctx.createProgram();
    ctx.attachShader(p, compileShader(ctx.VERTEX_SHADER, VERT_SRC));
    ctx.attachShader(p, compileShader(ctx.FRAGMENT_SHADER, FRAG_SRC));
    ctx.linkProgram(p);
    if (!ctx.getProgramParameter(p, ctx.LINK_STATUS)) {
      throw new Error('program link: ' + ctx.getProgramInfoLog(p));
    }
    return p;
  }

  function init(canvas) {
    ctx = canvas.getContext('webgl', { antialias: true }) ||
          canvas.getContext('experimental-webgl');
    if (!ctx) throw new Error('WebGL tidak tersedia');

    var M = window.SB.Math3;
    program = linkProgram();
    ctx.useProgram(program);

    attrib.pos = ctx.getAttribLocation(program, 'aPos');
    attrib.col = ctx.getAttribLocation(program, 'aCol');
    uniform.mvp = ctx.getUniformLocation(program, 'uMVP');
    uniform.fog = ctx.getUniformLocation(program, 'uFog');

    ctx.enable(ctx.DEPTH_TEST);
    ctx.enable(ctx.CULL_FACE);
    ctx.cullFace(ctx.BACK);

    viewMat = M.mat4Identity();
    fitViewport(canvas);
    setFog(fogRange.near, fogRange.far);
    return ctx;
  }

  // Samakan ukuran canvas + viewport dengan ukuran tampilannya, lalu
  // hitung ulang matriks proyeksi (fov ~60 derajat, far 600).
  function fitViewport(canvas) {
    var M = window.SB.Math3;
    var w = canvas.clientWidth || canvas.width;
    var h = canvas.clientHeight || canvas.height;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.viewport(0, 0, canvas.width, canvas.height);
    projMat = M.mat4Perspective(1.05, canvas.width / canvas.height, 0.1, 600);
  }

  function clear(r, g, b) {
    ctx.clearColor(r, g, b, 1.0);
    ctx.clear(ctx.COLOR_BUFFER_BIT | ctx.DEPTH_BUFFER_BIT);
  }

  // Ubah data mentah {pos, col} (array angka, 3 komponen per vertex)
  // menjadi mesh siap gambar: dua buffer GPU + jumlah vertex.
  // Data aslinya ikut disimpan (_pos/_col) untuk debugging saja.
  function makeMesh(positions, colors) {
    var posBuf = ctx.createBuffer();
    ctx.bindBuffer(ctx.ARRAY_BUFFER, posBuf);
    ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array(positions), ctx.STATIC_DRAW);

    var colBuf = ctx.createBuffer();
    ctx.bindBuffer(ctx.ARRAY_BUFFER, colBuf);
    ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array(colors), ctx.STATIC_DRAW);

    return {
      posBuf: posBuf,
      colBuf: colBuf,
      count: (positions.length / 3) | 0,
      _pos: positions,
      _col: colors
    };
  }

  // Gambar satu mesh yang SUDAH diproses dengan matriks model tertentu.
  // Mesh mentah (tanpa posBuf/colBuf) ditolak dengan error eksplisit.
  function drawMesh(prepared, modelMatrix) {
    if (!prepared || !prepared.posBuf || !prepared.colBuf ||
        typeof prepared.count !== 'number') {
      throw new Error('GL.draw: mesh mentah — proses dulu lewat GL.mesh()');
    }
    var M = window.SB.Math3;
    var model = modelMatrix || M.mat4Identity();
    var mvp = M.mat4Mul(projMat, M.mat4Mul(viewMat, model));
    ctx.uniformMatrix4fv(uniform.mvp, false, new Float32Array(mvp));

    ctx.bindBuffer(ctx.ARRAY_BUFFER, prepared.posBuf);
    ctx.enableVertexAttribArray(attrib.pos);
    ctx.vertexAttribPointer(attrib.pos, 3, ctx.FLOAT, false, 0, 0);

    ctx.bindBuffer(ctx.ARRAY_BUFFER, prepared.colBuf);
    ctx.enableVertexAttribArray(attrib.col);
    ctx.vertexAttribPointer(attrib.col, 3, ctx.FLOAT, false, 0, 0);

    ctx.drawArrays(ctx.TRIANGLES, 0, prepared.count);
  }

  function setCamera(eye, center) {
    var M = window.SB.Math3;
    viewMat = M.mat4LookAt(eye, center, M.v3(0, 1, 0));
  }

  function setFog(near, far) {
    fogRange.near = near;
    fogRange.far = far;
    if (ctx && uniform.fog) ctx.uniform2f(uniform.fog, near, far);
  }

  function alive() {
    return !!ctx && !ctx.isContextLost();
  }

  window.SB.GL = {
    init: init,
    clear: clear,
    mesh: makeMesh,
    draw: drawMesh,
    setCamera: setCamera,
    setFog: setFog,
    alive: alive,
    get ctx() { return ctx; }
  };
})();
