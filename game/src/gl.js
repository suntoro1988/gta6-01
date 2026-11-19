// Sunset Bay — gl: wrapper WebGL minimal (shader warna + fog linear vec2).
(function () {
  var SB = window.SB = window.SB || {};

  var VS =
    'attribute vec3 aPos;\n' +
    'attribute vec3 aCol;\n' +
    'uniform mat4 uMVP;\n' +
    'varying vec3 vCol;\n' +
    'varying float vDepth;\n' +
    'void main(){\n' +
    '  vec4 p = uMVP * vec4(aPos, 1.0);\n' +
    '  gl_Position = p;\n' +
    '  vCol = aCol;\n' +
    '  vDepth = -p.z;\n' +
    '}\n';

  var FS =
    'precision mediump float;\n' +
    'varying vec3 vCol;\n' +
    'varying float vDepth;\n' +
    'uniform vec2 uFog;\n' +   // uFog.x = near, uFog.y = far (vec2, bukan vec3)
    'uniform vec3 uFogCol;\n' +
    'void main(){\n' +
    '  float f = clamp((vDepth - uFog.x) / max(uFog.y - uFog.x, 0.001), 0.0, 1.0);\n' +
    '  gl_FragColor = vec4(mix(vCol, uFogCol, f), 1.0);\n' +
    '}\n';

  var gl = null, prog = null;
  var uMVP = null, uFog = null, uFogCol = null;
  var proj = null, view = null;
  var fogNear = 60, fogFar = 260;
  var fogColor = [0.55, 0.62, 0.75];
  var canvas = null;

  function compile(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error('shader: ' + gl.getShaderInfoLog(sh));
    }
    return sh;
  }

  function init(cv) {
    canvas = cv;
    gl = cv.getContext('webgl', { antialias: true }) ||
         cv.getContext('experimental-webgl');
    if (!gl) throw new Error('WebGL tidak tersedia');
    var vs = compile(gl.VERTEX_SHADER, VS);
    var fs = compile(gl.FRAGMENT_SHADER, FS);
    prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('link: ' + gl.getProgramInfoLog(prog));
    }
    gl.useProgram(prog);
    uMVP = gl.getUniformLocation(prog, 'uMVP');
    uFog = gl.getUniformLocation(prog, 'uFog');
    uFogCol = gl.getUniformLocation(prog, 'uFogCol');
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    // fog default via vec2
    gl.uniform2f(uFog, fogNear, fogFar);
    gl.uniform3f(uFogCol, fogColor[0], fogColor[1], fogColor[2]);
    resize();
    return gl;
  }

  function resize() {
    if (!canvas) return;
    var w = canvas.clientWidth || canvas.width;
    var h = canvas.clientHeight || canvas.height;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    var M = SB.Math3;
    proj = M.mat4Perspective(1.15, canvas.width / canvas.height, 0.1, 600);
  }

  function alive() {
    return !!gl && !gl.isContextLost();
  }

  function clear(r, g, b) {
    resize();
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // warna kabut mengikuti warna langit (siang/malam diatur pemanggil via setFogColor)
    gl.uniform3f(uFogCol, fogColor[0], fogColor[1], fogColor[2]);
  }

  function mesh(positions, colors) {
    var pos = positions instanceof Float32Array ? positions : new Float32Array(positions);
    var col = colors instanceof Float32Array ? colors : new Float32Array(colors);
    var pb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pb);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    var cb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cb);
    gl.bufferData(gl.ARRAY_BUFFER, col, gl.STATIC_DRAW);
    return { posBuf: pb, colBuf: cb, count: pos.length / 3 };
  }

  function setCamera(eye, center) {
    var M = SB.Math3;
    view = M.mat4LookAt(eye, center, [0, 1, 0]);
  }

  function setFog(near, far) {
    fogNear = near; fogFar = far;
    if (gl) gl.uniform2f(uFog, near, far);   // fog = vec2 (near, far)
  }

  function setFogColor(r, g, b) {
    fogColor = [r, g, b];
    if (gl) gl.uniform3f(uFogCol, r, g, b);
  }

  function draw(m, matrix, opts) {
    if (!m || !m.posBuf || !proj || !view) return;
    var M = SB.Math3;
    var mvp = M.mat4Mul(proj, M.mat4Mul(view, matrix));
    gl.uniformMatrix4fv(uMVP, false, new Float32Array(mvp));
    gl.bindBuffer(gl.ARRAY_BUFFER, m.posBuf);
    var aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.colBuf);
    var aCol = gl.getAttribLocation(prog, 'aCol');
    gl.enableVertexAttribArray(aCol);
    gl.vertexAttribPointer(aCol, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, m.count);
  }

  SB.GL = {
    init: init, clear: clear, mesh: mesh, draw: draw,
    setCamera: setCamera, setFog: setFog, setFogColor: setFogColor,
    alive: alive,
    get ctx() { return gl; }
  };
})();
