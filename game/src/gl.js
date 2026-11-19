// Sunset Bay v5 — raw WebGL renderer (no external libraries).
// Written fresh for v5 from the design spec.
//
// Design: the renderer BATCHES every primitive of a frame into one vertex
// buffer and issues a single draw call in endFrame(), so drawing hundreds of
// boxes / cylinders / pyramids per frame stays cheap. World-space vertices
// are generated on the CPU (positions, face normals, colors); lighting
// (directional sun/moon + ambient) and distance fog are done in the shader.
//
// Conventions (documented for the other builders):
// - All draw calls take a CENTER position: the primitive is centred on
//   (x, y, z). A box spans y +/- sy/2, a cylinder y +/- h/2, a pyramid has
//   its square base at y - h/2 and its apex at y + h/2.
// - Colors may be [r, g, b] floats in 0..1 (or 0..255), a '#rrggbb' / '#rgb'
//   string, or a 0xRRGGBB number.
// - Camera: cam = { pos, yaw, pitch }. pos is [x, y, z] or {x, y, z}.
//   yaw = 0 looks toward -Z; yaw grows counter-clockwise seen from above.
//   pitch > 0 looks up. tod is the in-game hour, 0..24.

const VERT_SRC = `
attribute vec3 aPos;
attribute vec3 aNorm;
attribute vec3 aCol;
uniform mat4 uVP;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uAmb;
uniform vec3 uFogCol;
uniform vec2 uFog;   // near, far
uniform vec3 uCamPos;
varying vec3 vCol;
varying float vFog;
void main() {
  vec3 n = normalize(aNorm);
  float diff = max(dot(n, uSunDir), 0.0);
  vCol = aCol * (uAmb + uSunCol * diff);
  float d = distance(aPos, uCamPos);
  vFog = clamp((d - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
  gl_Position = uVP * vec4(aPos, 1.0);
}
`;

const FRAG_SRC = `
precision mediump float;
uniform vec3 uFogCol;
varying vec3 vCol;
varying float vFog;
void main() {
  gl_FragColor = vec4(mix(vCol, uFogCol, vFog), 1.0);
}
`;

// Sky keyframes: [hour, r, g, b]. Interpolated for a smooth day cycle.
const SKY_KEYS = [
  [0.0, 0.03, 0.04, 0.10], // deep night
  [4.5, 0.05, 0.06, 0.16], // late night
  [6.0, 0.42, 0.28, 0.36], // dawn
  [7.5, 0.60, 0.72, 0.88], // morning
  [12.0, 0.42, 0.68, 0.94], // midday
  [16.5, 0.50, 0.70, 0.92], // afternoon
  [18.0, 0.98, 0.55, 0.28], // sunset orange (game starts 18:00 DUSK)
  [19.5, 0.32, 0.20, 0.36], // twilight purple
  [21.0, 0.07, 0.08, 0.20], // night falls
  [24.0, 0.03, 0.04, 0.10], // deep night
];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function skyAt(tod) {
  let t = tod % 24;
  if (t < 0) t += 24;
  for (let i = 0; i < SKY_KEYS.length - 1; i++) {
    const a = SKY_KEYS[i];
    const b = SKY_KEYS[i + 1];
    if (t >= a[0] && t <= b[0]) {
      const f = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
      return [lerp(a[1], b[1], f), lerp(a[2], b[2], f), lerp(a[3], b[3], f)];
    }
  }
  const last = SKY_KEYS[SKY_KEYS.length - 1];
  return [last[1], last[2], last[3]];
}

// Sun/moon direction, colour and ambient light for a given hour.
function lightAt(tod) {
  // Sun path: 06:00 sunrise, 12:00 noon, 18:00 sunset.
  const dayFrac = (tod - 6) / 12;
  const elev = Math.sin(dayFrac * Math.PI); // > 0 while the sun is up
  if (elev > 0.02) {
    const az = dayFrac * Math.PI; // swings east -> west
    const dir = [Math.cos(az) * 0.55, elev, 0.45];
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    const warmth = 1 - Math.min(1, elev * 1.6); // low sun = warm orange
    const sunCol = [
      lerp(1.0, 1.0, warmth),
      lerp(0.95, 0.55, warmth),
      lerp(0.85, 0.28, warmth),
    ];
    const strength = lerp(0.85, 1.05, Math.min(1, elev * 1.4));
    const amb = [
      lerp(0.34, 0.44, Math.min(1, elev * 1.5)),
      lerp(0.30, 0.46, Math.min(1, elev * 1.5)),
      lerp(0.34, 0.52, Math.min(1, elev * 1.5)),
    ];
    return { dir: [dir[0] / len, dir[1] / len, dir[2] / len], sunCol: sunCol.map((c) => c * strength), amb };
  }
  // Night: dim bluish moonlight from high overhead.
  const dir = [-0.25, 0.75, -0.35];
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  return {
    dir: [dir[0] / len, dir[1] / len, dir[2] / len],
    sunCol: [0.30, 0.36, 0.55],
    amb: [0.17, 0.18, 0.26],
  };
}

function parseColor(color) {
  if (Array.isArray(color) && color.length >= 3) {
    const scale = color[0] > 1 || color[1] > 1 || color[2] > 1 ? 1 / 255 : 1;
    return [color[0] * scale, color[1] * scale, color[2] * scale];
  }
  if (typeof color === 'string') {
    let hex = color.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const n = parseInt(hex, 16);
    if (Number.isFinite(n)) {
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    }
    return [0.5, 0.5, 0.5];
  }
  if (typeof color === 'number') {
    return [((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255];
  }
  return [0.5, 0.5, 0.5];
}

// --- small column-major matrix helpers (internal; renderer stays standalone) ---
function matMul4(a, b) {
  const out = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ];
}

function lookAt(eye, target, up) {
  let zx = eye[0] - target[0];
  let zy = eye[1] - target[1];
  let zz = eye[2] - target[2];
  let zl = Math.hypot(zx, zy, zz) || 1;
  zx /= zl; zy /= zl; zz /= zl;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  const xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl; xy /= xl; xz /= xl;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  return [
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
    1,
  ];
}

function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('Sunset Bay renderer shader error: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

const FLOATS_PER_VERT = 9; // pos(3) + normal(3) + color(3)
const CYL_SEGMENTS = 10;

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false });
  if (!gl) throw new Error('Sunset Bay needs WebGL, which this browser did not provide.');

  const prog = gl.createProgram();
  gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, VERT_SRC));
  gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('Sunset Bay renderer link error: ' + gl.getProgramInfoLog(prog));
  }
  gl.useProgram(prog);

  const loc = {
    pos: gl.getAttribLocation(prog, 'aPos'),
    norm: gl.getAttribLocation(prog, 'aNorm'),
    col: gl.getAttribLocation(prog, 'aCol'),
    vp: gl.getUniformLocation(prog, 'uVP'),
    sunDir: gl.getUniformLocation(prog, 'uSunDir'),
    sunCol: gl.getUniformLocation(prog, 'uSunCol'),
    amb: gl.getUniformLocation(prog, 'uAmb'),
    fogCol: gl.getUniformLocation(prog, 'uFogCol'),
    fog: gl.getUniformLocation(prog, 'uFog'),
    camPos: gl.getUniformLocation(prog, 'uCamPos'),
  };

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(loc.pos);
  gl.enableVertexAttribArray(loc.norm);
  gl.enableVertexAttribArray(loc.col);
  const stride = FLOATS_PER_VERT * 4;
  gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, stride, 0);
  gl.vertexAttribPointer(loc.norm, 3, gl.FLOAT, false, stride, 12);
  gl.vertexAttribPointer(loc.col, 3, gl.FLOAT, false, stride, 24);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.disable(gl.CULL_FACE); // closed primitives are depth-sorted; culling off keeps winding bugs impossible

  // Growable vertex store, seeded for a busy city frame.
  let verts = new Float32Array(FLOATS_PER_VERT * 90000);
  let vcount = 0;
  let frameSky = [0.42, 0.68, 0.94];
  let camPos = [0, 0, 0];

  function ensure(extra) {
    if (vcount + extra > verts.length / FLOATS_PER_VERT) {
      const grown = new Float32Array(verts.length * 2);
      grown.set(verts);
      verts = grown;
    }
  }

  function pushVert(x, y, z, nx, ny, nz, r, g, b) {
    const o = vcount * FLOATS_PER_VERT;
    verts[o] = x; verts[o + 1] = y; verts[o + 2] = z;
    verts[o + 3] = nx; verts[o + 4] = ny; verts[o + 5] = nz;
    verts[o + 6] = r; verts[o + 7] = g; verts[o + 8] = b;
    vcount++;
  }

  function tri(a, b, c, n, col) {
    pushVert(a[0], a[1], a[2], n[0], n[1], n[2], col[0], col[1], col[2]);
    pushVert(b[0], b[1], b[2], n[0], n[1], n[2], col[0], col[1], col[2]);
    pushVert(c[0], c[1], c[2], n[0], n[1], n[2], col[0], col[1], col[2]);
  }

  function quad(a, b, c, d, n, col) {
    tri(a, b, c, n, col);
    tri(a, c, d, n, col);
  }

  function faceNormal(a, b, c) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    return [n[0] / l, n[1] / l, n[2] / l];
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round((canvas.clientWidth || 800) * dpr));
    const h = Math.max(1, Math.round((canvas.clientHeight || 600) * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function beginFrame(cam, tod) {
    const p = cam.pos;
    camPos = Array.isArray(p) ? [p[0], p[1], p[2]] : [p.x || 0, p.y || 0, p.z || 0];
    const yaw = cam.yaw || 0;
    const pitch = cam.pitch || 0;
    const cp = Math.cos(pitch);
    const fwd = [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
    const target = [camPos[0] + fwd[0], camPos[1] + fwd[1], camPos[2] + fwd[2]];

    frameSky = skyAt(tod == null ? 12 : tod);
    const light = lightAt(tod == null ? 12 : tod);
    // Fog tinted toward the horizon sky so distant buildings melt into the sky.
    const fogCol = [
      lerp(frameSky[0], 0.85, 0.25),
      lerp(frameSky[1], 0.85, 0.25),
      lerp(frameSky[2], 0.90, 0.25),
    ];
    const night = light.sunCol[0] < 0.5; // moonlight => shorter view distance
    const fogFar = night ? 300 : 480;

    gl.clearColor(frameSky[0], frameSky[1], frameSky[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = canvas.width / Math.max(1, canvas.height);
    const proj = perspective((62 * Math.PI) / 180, aspect, 0.1, 2000);
    const view = lookAt(camPos, target, [0, 1, 0]);
    const vp = matMul4(proj, view);
    gl.uniformMatrix4fv(loc.vp, false, new Float32Array(vp));
    gl.uniform3fv(loc.sunDir, new Float32Array(light.dir));
    gl.uniform3fv(loc.sunCol, new Float32Array(light.sunCol));
    gl.uniform3fv(loc.amb, new Float32Array(light.amb));
    gl.uniform3fv(loc.fogCol, new Float32Array(fogCol));
    gl.uniform2f(loc.fog, 70, fogFar);
    gl.uniform3fv(loc.camPos, new Float32Array(camPos));
    vcount = 0;
  }

  function drawBox(x, y, z, sx, sy, sz, color) {
    const col = parseColor(color);
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    ensure(36);
    const c = [
      [x - hx, y - hy, z - hz], [x + hx, y - hy, z - hz],
      [x + hx, y - hy, z + hz], [x - hx, y - hy, z + hz],
      [x - hx, y + hy, z - hz], [x + hx, y + hy, z - hz],
      [x + hx, y + hy, z + hz], [x - hx, y + hy, z + hz],
    ];
    quad(c[3], c[2], c[6], c[7], [0, 0, 1], col); // front +Z
    quad(c[1], c[0], c[4], c[5], [0, 0, -1], col); // back -Z
    quad(c[2], c[1], c[5], c[6], [1, 0, 0], col); // right +X
    quad(c[0], c[3], c[7], c[4], [-1, 0, 0], col); // left -X
    quad(c[4], c[7], c[6], c[5], [0, 1, 0], col); // top +Y
    quad(c[0], c[1], c[2], c[3], [0, -1, 0], col); // bottom -Y
  }

  function drawCyl(x, y, z, r, h, color) {
    const col = parseColor(color);
    const half = h / 2;
    const top = y + half;
    const bot = y - half;
    ensure(CYL_SEGMENTS * 12);
    for (let i = 0; i < CYL_SEGMENTS; i++) {
      const a0 = (i / CYL_SEGMENTS) * Math.PI * 2;
      const a1 = ((i + 1) / CYL_SEGMENTS) * Math.PI * 2;
      const x0 = x + Math.cos(a0) * r, z0 = z + Math.sin(a0) * r;
      const x1 = x + Math.cos(a1) * r, z1 = z + Math.sin(a1) * r;
      const n0 = [Math.cos(a0), 0, Math.sin(a0)];
      const n1 = [Math.cos(a1), 0, Math.sin(a1)];
      // Side quad (two triangles, per-vertex radial normals).
      pushVert(x0, bot, z0, n0[0], 0, n0[2], col[0], col[1], col[2]);
      pushVert(x1, bot, z1, n1[0], 0, n1[2], col[0], col[1], col[2]);
      pushVert(x1, top, z1, n1[0], 0, n1[2], col[0], col[1], col[2]);
      pushVert(x0, bot, z0, n0[0], 0, n0[2], col[0], col[1], col[2]);
      pushVert(x1, top, z1, n1[0], 0, n1[2], col[0], col[1], col[2]);
      pushVert(x0, top, z0, n0[0], 0, n0[2], col[0], col[1], col[2]);
      // Caps as a fan triangle pair from the centre.
      tri([x, top, z], [x0, top, z0], [x1, top, z1], [0, 1, 0], col);
      tri([x, bot, z], [x1, bot, z1], [x0, bot, z0], [0, -1, 0], col);
    }
  }

  function drawPyramid(x, y, z, s, h, color) {
    const col = parseColor(color);
    const half = s / 2;
    const baseY = y - h / 2;
    const apex = [x, y + h / 2, z];
    const b = [
      [x - half, baseY, z - half],
      [x + half, baseY, z - half],
      [x + half, baseY, z + half],
      [x - half, baseY, z + half],
    ];
    ensure(18);
    for (let i = 0; i < 4; i++) {
      const a = b[i];
      const c = b[(i + 1) % 4];
      const n = faceNormal(a, c, apex);
      // Keep the normal pointing outward/up, never downward into the base.
      if (n[1] < 0) { n[0] = -n[0]; n[1] = -n[1]; n[2] = -n[2]; }
      tri(a, c, apex, n, col);
    }
    quad(b[0], b[3], b[2], b[1], [0, -1, 0], col); // base (hidden under buildings, cheap)
  }

  function endFrame() {
    if (vcount > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, verts.subarray(0, vcount * FLOATS_PER_VERT), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, vcount);
    }
    gl.flush();
  }

  return { resize, beginFrame, drawBox, drawCyl, drawPyramid, endFrame };
}
