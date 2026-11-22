// Sunset Bay v14 — SB.GL (Builder B: graphics / rendering)
// Raw WebGL, no libraries. One vertex shader + one fragment shader,
// per-vertex color + distance fog. Buffers are reused across frames so
// drawMesh can be called hundreds of times per frame with minimal
// allocation (bufferSubData when the data fits the current capacity).
//
// Contract (design spec section 4):
//   SB.GL.init(canvas)                 -> true/false
//   SB.GL.clear()
//   SB.GL.drawMesh(mesh, transform, color, opts?)
//   SB.GL.setCamera(pos, lookAt)
//   SB.GL.resize(w, h)
//   SB.GL.ctx                          -> WebGLRenderingContext | null
//
// Mesh format (owned by this module, used by SB.Render):
//   mesh = { verts: Float32Array, indices: Uint16Array|Uint32Array }
//   verts are interleaved: x, y, z, r, g, b  (6 floats per vertex)
//   color channels are 0..1 and are multiplied by the tint passed to
//   drawMesh, so one white mesh can be reused in many colors.
// Transform format:
//   { pos:{x,y,z}, rotY:number, scale:{x,y,z} }   (all parts optional)
//   or { x,y,z, rotY, sx,sy,sz }  or a Float32Array(16) model matrix.
// Color format: [r,g,b] 0..1, {r,g,b}, or a hex string like "#ff9a3c".

window.SB = window.SB || {};

(function () {
  "use strict";

  // ------------------------------------------------------------------
  // Small mat4 helpers (column-major, WebGL convention).
  // ------------------------------------------------------------------
  function mat4Identity() {
    var m = new Float32Array(16);
    m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
    return m;
  }

  function mat4Perspective(fovY, aspect, near, far) {
    var m = new Float32Array(16);
    var f = 1.0 / Math.tan(fovY / 2);
    var nf = 1.0 / (near - far);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = (far + near) * nf;
    m[11] = -1;
    m[14] = 2 * far * near * nf;
    return m;
  }

  // Classic lookAt: eye -> center, world-up +Y.
  function mat4LookAt(ex, ey, ez, cx, cy, cz) {
    var zx = ex - cx, zy = ey - cy, zz = ez - cz;
    var zl = Math.sqrt(zx * zx + zy * zy + zz * zz) || 1;
    zx /= zl; zy /= zl; zz /= zl;
    // x axis = up x z, with up = (0,1,0): (zz, 0, -zx)
    var xx = zz;
    var xy = 0;
    var xz = -zx;
    var xl = Math.sqrt(xx * xx + xy * xy + xz * xz) || 1;
    xx /= xl; xy /= xl; xz /= xl;
    // y axis = z x x
    var yx = zy * xz - zz * xy;
    var yy = zz * xx - zx * xz;
    var yz = zx * xy - zy * xx;
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

  function mat4Multiply(a, b) {
    // Returns a * b (apply b first, then a), column-major.
    var out = new Float32Array(16);
    for (var c = 0; c < 4; c++) {
      for (var r = 0; r < 4; r++) {
        var s = 0;
        for (var k = 0; k < 4; k++) {
          s += a[k * 4 + r] * b[c * 4 + k];
        }
        out[c * 4 + r] = s;
      }
    }
    return out;
  }

  // Compose T * RY * S from a transform description.
  function mat4FromTransform(t) {
    if (!t) return mat4Identity();
    if (t instanceof Float32Array && t.length === 16) return t;
    var px = 0, py = 0, pz = 0, rotY = 0, sx = 1, sy = 1, sz = 1;
    if (t.pos) { px = t.pos.x || 0; py = t.pos.y || 0; pz = t.pos.z || 0; }
    if (typeof t.x === "number") px = t.x;
    if (typeof t.y === "number") py = t.y;
    if (typeof t.z === "number") pz = t.z;
    if (typeof t.rotY === "number") rotY = t.rotY;
    if (t.scale) { sx = t.scale.x || 1; sy = t.scale.y || 1; sz = t.scale.z || 1; }
    if (typeof t.sx === "number") sx = t.sx;
    if (typeof t.sy === "number") sy = t.sy;
    if (typeof t.sz === "number") sz = t.sz;
    var c = Math.cos(rotY), s = Math.sin(rotY);
    var m = new Float32Array(16);
    // RY * S, then translation in the last column.
    m[0] = c * sx;  m[1] = 0;     m[2] = -s * sx; m[3] = 0;
    m[4] = 0;       m[5] = sy;    m[6] = 0;       m[7] = 0;
    m[8] = s * sz;  m[9] = 0;     m[10] = c * sz; m[11] = 0;
    m[12] = px;     m[13] = py;   m[14] = pz;     m[15] = 1;
    return m;
  }

  // ------------------------------------------------------------------
  // Color helpers.
  // ------------------------------------------------------------------
  function hexToRgb(hex) {
    if (typeof hex !== "string") return [1, 1, 1];
    var h = hex.replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (isNaN(n)) return [1, 1, 1];
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function normalizeColor(c, fallback) {
    if (!c) return fallback || [1, 1, 1];
    if (typeof c === "string") return hexToRgb(c);
    if (Array.isArray(c) && c.length >= 3) return [c[0], c[1], c[2]];
    if (typeof c === "object") {
      return [
        typeof c.r === "number" ? c.r : 1,
        typeof c.g === "number" ? c.g : 1,
        typeof c.b === "number" ? c.b : 1,
      ];
    }
    return fallback || [1, 1, 1];
  }

  // ------------------------------------------------------------------
  // Shaders: one vertex + one fragment, per-vertex color + fog.
  // ------------------------------------------------------------------
  var VERT_SRC = [
    "attribute vec3 aPos;",
    "attribute vec3 aColor;",
    "uniform mat4 uProj;",
    "uniform mat4 uView;",
    "uniform mat4 uModel;",
    "uniform vec3 uTint;",
    "uniform vec2 uFogRange;",
    "uniform float uFogStrength;",
    "varying vec3 vColor;",
    "varying float vFog;",
    "void main() {",
    "  vec4 world = uModel * vec4(aPos, 1.0);",
    "  vec4 view = uView * world;",
    "  float dist = -view.z;",
    "  float f = clamp((dist - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0);",
    "  vFog = f * uFogStrength;",
    "  vColor = aColor * uTint;",
    "  gl_Position = uProj * view;",
    "}",
  ].join("\n");

  var FRAG_SRC = [
    "precision mediump float;",
    "varying vec3 vColor;",
    "varying float vFog;",
    "uniform vec3 uFogColor;",
    "uniform float uAlpha;",
    "void main() {",
    "  vec3 c = mix(vColor, uFogColor, vFog);",
    "  gl_FragColor = vec4(c, uAlpha);",
    "}",
  ].join("\n");

  // ------------------------------------------------------------------
  // Module state.
  // ------------------------------------------------------------------
  var gl = null;
  var canvasEl = null;
  var program = null;
  var loc = {};
  var viewMat = mat4Identity();
  var projMat = mat4Perspective(Math.PI / 3, 16 / 9, 0.1, 2500);
  var vbo = null;
  var ibo = null;
  var vboCap = 0; // capacity in floats
  var iboCap = 0; // capacity in indices
  var uint32OK = false;
  var fogNear = 200, fogFar = 1100;
  var fogColor = [0.78, 0.62, 0.48]; // warm golden-hour haze
  var clearColor = [0.55, 0.68, 0.80]; // cool blue dusk sky
  var fovY = Math.PI / 3;
  var ready = false;
  var fallbackShown = false;

  function compileShader(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  function showFallback(msg) {
    if (fallbackShown || !canvasEl) return;
    fallbackShown = true;
    try {
      canvasEl.style.display = "none";
      var div = document.createElement("div");
      div.id = "webgl-fallback";
      div.textContent = msg;
      div.style.cssText = [
        "display:flex", "align-items:center", "justify-content:center",
        "width:100%", "height:100%", "min-height:360px",
        "background:#1a2233", "color:#ffd9a0",
        "font:16px/1.5 system-ui, sans-serif", "text-align:center",
        "padding:24px", "box-sizing:border-box",
      ].join(";");
      if (canvasEl.parentNode) canvasEl.parentNode.insertBefore(div, canvasEl.nextSibling);
    } catch (e) { /* never break the page over the fallback itself */ }
  }

  // ------------------------------------------------------------------
  // Mesh builders (procedural, no assets).
  // Vertex layout per face: 4 corners, so each face can carry its own
  // shade. Box base sits at y=0 (buildings/cars sit on the ground).
  // ------------------------------------------------------------------
  function pushFace(verts, idx, base, a, b, c, d, shade, rgb) {
    // a,b,c,d are [x,y,z] corners in CCW order seen from outside.
    var cols = [shade * rgb[0], shade * rgb[1], shade * rgb[2]];
    var pts = [a, b, c, d];
    for (var i = 0; i < 4; i++) {
      verts.push(pts[i][0], pts[i][1], pts[i][2], cols[0], cols[1], cols[2]);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return base + 4;
  }

  function makeBox(w, h, d, rgb) {
    var x = w / 2, z = d / 2;
    var verts = [], idx = [], n = 0;
    // top (brightest), bottom, then 4 sides with two alternating shades
    n = pushFace(verts, idx, n, [-x, h, -z], [x, h, -z], [x, h, z], [-x, h, z], 1.0, rgb);
    n = pushFace(verts, idx, n, [-x, 0, z], [x, 0, z], [x, 0, -z], [-x, 0, -z], 0.35, rgb);
    n = pushFace(verts, idx, n, [-x, 0, -z], [x, 0, -z], [x, h, -z], [-x, h, -z], 0.62, rgb);
    n = pushFace(verts, idx, n, [x, 0, z], [-x, 0, z], [-x, h, z], [x, h, z], 0.62, rgb);
    n = pushFace(verts, idx, n, [-x, 0, z], [-x, 0, -z], [-x, h, -z], [-x, h, z], 0.78, rgb);
    n = pushFace(verts, idx, n, [x, 0, -z], [x, 0, z], [x, h, z], [x, h, -z], 0.78, rgb);
    return { verts: new Float32Array(verts), indices: new Uint16Array(idx) };
  }

  // Box centered on the origin (vehicles, props, particles).
  function makeBoxCentered(w, h, d, rgb) {
    var m = makeBox(w, h, d, rgb);
    var v = m.verts;
    for (var i = 0; i < v.length; i += 6) v[i + 1] -= h / 2;
    return m;
  }

  // Flat quad on the ground plane (y = 0), facing up.
  function makePlane(w, d, rgb, shade) {
    var x = w / 2, z = d / 2;
    var s = (typeof shade === "number") ? shade : 1.0;
    var verts = new Float32Array([
      -x, 0, -z, s * rgb[0], s * rgb[1], s * rgb[2],
       x, 0, -z, s * rgb[0], s * rgb[1], s * rgb[2],
       x, 0,  z, s * rgb[0], s * rgb[1], s * rgb[2],
      -x, 0,  z, s * rgb[0], s * rgb[1], s * rgb[2],
    ]);
    return { verts: verts, indices: new Uint16Array([0, 1, 2, 0, 2, 3]) };
  }

  // Vertical quad facing +Z, centered on the origin (signs, billboards).
  function makeQuad(w, h, rgb) {
    var x = w / 2, y = h / 2;
    var verts = new Float32Array([
      -x, -y, 0, rgb[0], rgb[1], rgb[2],
       x, -y, 0, rgb[0], rgb[1], rgb[2],
       x,  y, 0, rgb[0], rgb[1], rgb[2],
      -x,  y, 0, rgb[0], rgb[1], rgb[2],
    ]);
    return { verts: verts, indices: new Uint16Array([0, 1, 2, 0, 2, 3]) };
  }

  // Sky box: top ring cold dusk blue, bottom ring warm sunset orange.
  // Drawn with culling off and depth write off, fog disabled.
  function makeSkyBox(size) {
    var s = size / 2;
    var top = [0.36, 0.55, 0.76];
    var bot = [1.0, 0.58, 0.22];
    var verts = [], idx = [], n = 0;
    function face(a, b, c, d, rgb) {
      var pts = [a, b, c, d];
      for (var i = 0; i < 4; i++) {
        verts.push(pts[i][0], pts[i][1], pts[i][2], rgb[0], rgb[1], rgb[2]);
      }
      idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
      n += 4;
    }
    // Each side wall: top edge uses the sky color, bottom edge the
    // horizon color. Two quads per wall would be exact; one quad with
    // per-vertex colors interpolates the gradient for free.
    function wall(a, b) {
      // a,b are bottom corners [x,z]; wall rises to y=+s.
      var pa = [a[0], -s, a[1]], pb = [b[0], -s, b[1]];
      var ta = [a[0], s, a[1]], tb = [b[0], s, b[1]];
      verts.push(pa[0], pa[1], pa[2], bot[0], bot[1], bot[2]);
      verts.push(pb[0], pb[1], pb[2], bot[0], bot[1], bot[2]);
      verts.push(tb[0], tb[1], tb[2], top[0], top[1], top[2]);
      verts.push(ta[0], ta[1], ta[2], top[0], top[1], top[2]);
      idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
      n += 4;
    }
    wall([-s, -s], [s, -s]);
    wall([s, -s], [s, s]);
    wall([s, s], [-s, s]);
    wall([-s, s], [-s, -s]);
    // Ceiling (cold blue) and floor (deep warm haze, never really seen).
    face([-s, s, -s], [s, s, -s], [s, s, s], [-s, s, s], top);
    face([-s, -s, s], [s, -s, s], [s, -s, -s], [-s, -s, -s], [0.55, 0.35, 0.30]);
    return { verts: new Float32Array(verts), indices: new Uint16Array(idx) };
  }

  // Merge many transformed parts into one static mesh. Parts:
  //   [{ mesh, transform, color }]  (color = tint for that part)
  // Stops adding parts before the 16-bit index limit (65535 verts) so
  // the result always renders on plain WebGL1.
  function mergeMeshes(parts) {
    var totalVerts = 0, totalIdx = 0;
    var usable = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p || !p.mesh || !p.mesh.verts || !p.mesh.indices) continue;
      var nv = p.mesh.verts.length / 6;
      if (totalVerts + nv > 65000) break;
      usable.push(p);
      totalVerts += nv;
      totalIdx += p.mesh.indices.length;
    }
    var verts = new Float32Array(totalVerts * 6);
    var indices = new Uint16Array(totalIdx);
    var vo = 0, io = 0;
    for (var j = 0; j < usable.length; j++) {
      var part = usable[j];
      var m = mat4FromTransform(part.transform || null);
      var tint = normalizeColor(part.color, [1, 1, 1]);
      var src = part.mesh.verts;
      var base = vo / 6;
      for (var v = 0; v < src.length; v += 6) {
        var x = src[v], y = src[v + 1], z = src[v + 2];
        verts[vo] = m[0] * x + m[4] * y + m[8] * z + m[12];
        verts[vo + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        verts[vo + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        verts[vo + 3] = src[v + 3] * tint[0];
        verts[vo + 4] = src[v + 4] * tint[1];
        verts[vo + 5] = src[v + 5] * tint[2];
        vo += 6;
      }
      var si = part.mesh.indices;
      for (var k = 0; k < si.length; k++) indices[io + k] = si[k] + base;
      io += si.length;
    }
    return { verts: verts, indices: indices, parts: usable.length };
  }

  // ------------------------------------------------------------------
  // Public API.
  // ------------------------------------------------------------------
  var GL = {
    ctx: null,
    canvas: null,
    ready: false,
    error: null,

    init: function (canvas) {
      canvasEl = (typeof canvas === "string")
        ? document.getElementById(canvas)
        : canvas;
      if (!canvasEl) {
        this.error = "canvas not found";
        return false;
      }
      this.canvas = canvasEl;
      var ctx = null;
      try {
        ctx = canvasEl.getContext("webgl", {
          antialias: true, alpha: false, depth: true,
          stencil: false, preserveDrawingBuffer: false,
        }) || canvasEl.getContext("experimental-webgl", {
          antialias: true, alpha: false, depth: true,
        });
      } catch (e) { ctx = null; }
      if (!ctx) {
        this.error = "WebGL not available";
        showFallback("WebGL is not available in this browser, so Sunset Bay cannot render its 3D world. Please try a browser with WebGL enabled.");
        return false;
      }
      gl = ctx;
      this.ctx = gl;
      uint32OK = !!gl.getExtension("OES_element_index_uint");

      var vs = compileShader(gl.VERTEX_SHADER, VERT_SRC);
      var fs = compileShader(gl.FRAGMENT_SHADER, FRAG_SRC);
      if (!vs || !fs) {
        this.error = "shader compile failed";
        showFallback("Sunset Bay could not start its graphics shaders on this device.");
        return false;
      }
      program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        this.error = "shader link failed";
        showFallback("Sunset Bay could not start its graphics shaders on this device.");
        return false;
      }
      gl.useProgram(program);
      loc = {
        aPos: gl.getAttribLocation(program, "aPos"),
        aColor: gl.getAttribLocation(program, "aColor"),
        uProj: gl.getUniformLocation(program, "uProj"),
        uView: gl.getUniformLocation(program, "uView"),
        uModel: gl.getUniformLocation(program, "uModel"),
        uTint: gl.getUniformLocation(program, "uTint"),
        uFogRange: gl.getUniformLocation(program, "uFogRange"),
        uFogStrength: gl.getUniformLocation(program, "uFogStrength"),
        uFogColor: gl.getUniformLocation(program, "uFogColor"),
        uAlpha: gl.getUniformLocation(program, "uAlpha"),
      };

      vbo = gl.createBuffer();
      ibo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, 1 << 20, gl.DYNAMIC_DRAW); // 1 MB start
      vboCap = (1 << 20) / 4;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, 1 << 18, gl.DYNAMIC_DRAW);
      iboCap = (1 << 18) / 2;
      gl.enableVertexAttribArray(loc.aPos);
      gl.enableVertexAttribArray(loc.aColor);
      gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, 24, 0);
      gl.vertexAttribPointer(loc.aColor, 3, gl.FLOAT, false, 24, 12);

      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.CULL_FACE);
      gl.clearDepth(1.0);

      this.resize(canvasEl.width || 1280, canvasEl.height || 720);
      ready = true;
      this.ready = true;
      return true;
    },

    clear: function () {
      if (!gl) return;
      gl.clearColor(clearColor[0], clearColor[1], clearColor[2], 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    },

    setCamera: function (pos, lookAt) {
      if (!gl) return;
      var p = pos || { x: 0, y: 40, z: 180 };
      var l = lookAt || { x: 0, y: 0, z: 0 };
      viewMat = mat4LookAt(p.x || 0, p.y || 0, p.z || 0, l.x || 0, l.y || 0, l.z || 0);
      this._view = viewMat;
    },

    resize: function (w, h) {
      if (!gl || !canvasEl) return;
      w = Math.max(2, w | 0);
      h = Math.max(2, h | 0);
      if (canvasEl.width !== w) canvasEl.width = w;
      if (canvasEl.height !== h) canvasEl.height = h;
      gl.viewport(0, 0, w, h);
      projMat = mat4Perspective(fovY, w / h, 0.1, 2500);
      this._proj = projMat;
    },

    // opts: { alpha (0..1), fog (bool, default true), depthWrite (bool,
    // default true), cull (bool, default false) }
    drawMesh: function (mesh, transform, color, opts) {
      if (!gl || !ready || !mesh || !mesh.verts || !mesh.indices) return;
      if (mesh.indices.length === 0 || mesh.verts.length === 0) return;
      opts = opts || {};
      var alpha = (typeof opts.alpha === "number") ? opts.alpha : 1;
      var useFog = opts.fog !== false;
      var depthWrite = opts.depthWrite !== false;

      // Reuse the one vertex/index buffer pair; grow only when needed.
      if (mesh.verts.length > vboCap) {
        vboCap = Math.max(mesh.verts.length * 2, vboCap * 2);
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, vboCap * 4, gl.DYNAMIC_DRAW);
      }
      var indexBytes = (mesh.indices instanceof Uint32Array) ? 4 : 2;
      if (mesh.indices.length * indexBytes > iboCap * 2) {
        iboCap = Math.max(mesh.indices.length * 2, iboCap * 2);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, iboCap * 2, gl.DYNAMIC_DRAW);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh.verts);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      if (mesh.indices instanceof Uint32Array) {
        gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, mesh.indices);
      } else {
        gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, mesh.indices);
      }

      gl.uniformMatrix4fv(loc.uProj, false, projMat);
      gl.uniformMatrix4fv(loc.uView, false, viewMat);
      gl.uniformMatrix4fv(loc.uModel, false, mat4FromTransform(transform));
      var tint = normalizeColor(color, [1, 1, 1]);
      gl.uniform3f(loc.uTint, tint[0], tint[1], tint[2]);
      gl.uniform2f(loc.uFogRange, fogNear, fogFar);
      gl.uniform1f(loc.uFogStrength, useFog ? 1 : 0);
      gl.uniform3f(loc.uFogColor, fogColor[0], fogColor[1], fogColor[2]);
      gl.uniform1f(loc.uAlpha, alpha);
      gl.depthMask(depthWrite);
      if (opts.cull) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
      var type = (mesh.indices instanceof Uint32Array) ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
      if (type === gl.UNSIGNED_INT && !uint32OK) return; // cannot draw safely
      gl.drawElements(gl.TRIANGLES, mesh.indices.length, type, 0);
      gl.depthMask(true);
    },

    setFog: function (near, far, color) {
      if (typeof near === "number") fogNear = near;
      if (typeof far === "number") fogFar = far;
      if (color) fogColor = normalizeColor(color, fogColor);
    },

    setClearColor: function (color) {
      if (color) clearColor = normalizeColor(color, clearColor);
    },

    setFov: function (deg) {
      fovY = (deg * Math.PI) / 180;
      if (canvasEl) {
        projMat = mat4Perspective(fovY, canvasEl.width / Math.max(1, canvasEl.height), 0.1, 2500);
      }
    },

    // Mesh builders, exposed so SB.Render (and only it, by convention)
    // can build procedural geometry without duplicating this code.
    makeBox: makeBox,
    makeBoxCentered: makeBoxCentered,
    makePlane: makePlane,
    makeQuad: makeQuad,
    makeSkyBox: makeSkyBox,
    mergeMeshes: mergeMeshes,
    hexToRgb: hexToRgb,
    normalizeColor: normalizeColor,
  };

  SB.GL = GL;
})();
